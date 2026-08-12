/// <reference types="web-bluetooth" />

import type { ActuatorData } from "./command";
import * as command from './command';
import * as python from './python';
import * as sensorStream from './sensor-stream';
import * as updater from './updater';
import * as ota from './ota';
import * as audio from './audio';
import * as files from './files';
import * as deviceInfo from './device-info';
import { delay, getWriteMtu, setWriteMtu } from "./utils";
import { MAIN_SERVICE_UUID, OTA_SERVICE_UUID, COMMAND_CHARACTERISTIC_UUID, SENSOR_STREAM_CHARACTERISTIC_UUID, PYTHON_CHARACTERISTIC_UUID, AUDIO_CHARACTERISTIC_UUID, OTA_FIRMWARE_CHARACTERISTIC_UUID, OTA_COMMAND_CHARACTERISTIC_UUID, FILE_CHARACTERISTIC_UUID, DEVICE_INFO_CHARACTERISTIC_UUID, STD_OUT_CHARACTERISTIC_UUID, THYMIO_CONNECTED_EVENT_ID, THYMIO_DISCONNECTED_EVENT_ID, THYMIO_PROMPT_MANUAL_RECONNECTION_EVENT_ID, MTU } from "./constants";
import type { FileListing } from "./files";
import type { FirmwareInfo, MemoryInfo } from "./device-info";
import { handleStdOutResponse } from "./std-out";
import type { PythonLoadResult } from "./python";

let device: BluetoothDevice | undefined;
let reconnecting = false;
let streamingActive = false;
let commandCharacteristic: BluetoothRemoteGATTCharacteristic;
let sensorStreamCharacteristic: BluetoothRemoteGATTCharacteristic;
let pythonCharacteristic: BluetoothRemoteGATTCharacteristic;
let stdOutCharacteristic: BluetoothRemoteGATTCharacteristic;
let audioCharacteristic: BluetoothRemoteGATTCharacteristic;
let fileCharacteristic: BluetoothRemoteGATTCharacteristic;
let deviceInfoCharacteristic: BluetoothRemoteGATTCharacteristic;

let otaFirmwareCharacteristic: BluetoothRemoteGATTCharacteristic;
let otaCommandCharacteristic: BluetoothRemoteGATTCharacteristic;

/**
 * Request a bluetooth device and connect to it.
 */
export async function requestAndConnect(): Promise<void> {
  if (!navigator.bluetooth) {
    throw new Error("Web Bluetooth not supported");
  }

  device = await navigator.bluetooth.requestDevice({
    filters: [
      { services: [MAIN_SERVICE_UUID, OTA_SERVICE_UUID]}
    ]
  });

  if (!device.name?.startsWith('THYMIO')) {
    device = undefined;
    throw new Error('Not a Thymio device');
  }

  // To handle the reconnects
  device.addEventListener('gattserverdisconnected', onDisconnected);

  await connect();
  await probeWriteMtu();

  console.log("done")
}

export function isConnected(): boolean {
  if(device && device.gatt) {
    return device.gatt.connected;
  } else {
    return false;
  }
}

export function getDeviceName(): string {
  return device?.name || "Unknown Device";
}

export async function disconnect(): Promise<void> {
  if (device) {
    device.removeEventListener('gattserverdisconnected', onDisconnected);
    await device.gatt?.disconnect();

    streamingActive = false;
    dispatchConnectedEvent(false);
    dispatchDisconnectedEvent();

    console.log("✅ Disconnected from Thymio 3.");
  } else {
    throw new Error('Bluetooth device is undefined');
  }
}

/**
 * Connect to the device and to all of the exposed services and characteristics.
 */
async function connect() {
  if (device && device.gatt) {
    const server = await device.gatt.connect();
    const mainService = await server.getPrimaryService(MAIN_SERVICE_UUID);

    commandCharacteristic = await mainService.getCharacteristic(COMMAND_CHARACTERISTIC_UUID);

    sensorStreamCharacteristic = await mainService.getCharacteristic(SENSOR_STREAM_CHARACTERISTIC_UUID);
    await sensorStreamCharacteristic.startNotifications();
    sensorStreamCharacteristic.addEventListener('characteristicvaluechanged', sensorStream.handleStreamResponse);

    pythonCharacteristic = await mainService.getCharacteristic(PYTHON_CHARACTERISTIC_UUID);
    await pythonCharacteristic.startNotifications();
    pythonCharacteristic.addEventListener('characteristicvaluechanged', python.handlePythonResponse);

    stdOutCharacteristic = await mainService.getCharacteristic(STD_OUT_CHARACTERISTIC_UUID);
    await stdOutCharacteristic.startNotifications();
    stdOutCharacteristic.addEventListener('characteristicvaluechanged', handleStdOutResponse);

    audioCharacteristic = await mainService.getCharacteristic(AUDIO_CHARACTERISTIC_UUID);
    await audioCharacteristic.startNotifications();
    audioCharacteristic.addEventListener('characteristicvaluechanged', audio.handleAudioResponse);

    fileCharacteristic = await mainService.getCharacteristic(FILE_CHARACTERISTIC_UUID);
    await fileCharacteristic.startNotifications();

    deviceInfoCharacteristic = await mainService.getCharacteristic(DEVICE_INFO_CHARACTERISTIC_UUID);
    await deviceInfoCharacteristic.startNotifications();

    const otaService = await server.getPrimaryService(OTA_SERVICE_UUID);

    otaFirmwareCharacteristic = await otaService.getCharacteristic(OTA_FIRMWARE_CHARACTERISTIC_UUID);
    await otaFirmwareCharacteristic.startNotifications();
    otaFirmwareCharacteristic.addEventListener('characteristicvaluechanged', ota.otaFirmwareNotificationHandler);

    otaCommandCharacteristic = await otaService.getCharacteristic(OTA_COMMAND_CHARACTERISTIC_UUID);
    await otaCommandCharacteristic.startNotifications();
    otaCommandCharacteristic.addEventListener('characteristicvaluechanged', ota.otaCommandNotificationHandler);

    dispatchConnectedEvent(true);

    console.log("✅ Connected to Thymio 3 !");
  } else {
    throw new Error("Bluetooth GATT is not available.")
  }
}

/**
 * Probe the largest reliable ATT write size using the Python characteristic
 * with a soft-reset opcode padded to candidate sizes. Falls back to MTU 182.
 */
async function probeWriteMtu(): Promise<void> {
  setWriteMtu(MTU);
  const candidates = [500, 247, 182, 100, 50, 20];
  for (const size of candidates) {
    const packet = new Uint8Array(size);
    packet[0] = 0x05; // soft reset opcode; remaining bytes are ignored padding
    try {
      await pythonCharacteristic.writeValueWithResponse(packet);
      setWriteMtu(size);
      console.log(`[BLE]: Write MTU probe succeeded at ${size}`);
      await delay(50);
      return;
    } catch (err) {
      console.warn(`[BLE]: Write MTU probe failed at ${size}`, err);
      await delay(40);
    }
  }
  setWriteMtu(20);
  console.warn(`[BLE]: Write MTU probe fell back to ${getWriteMtu()}`);
}

function onDisconnected() {
  dispatchConnectedEvent(false);
  dispatchDisconnectedEvent();
  streamingActive = false;

  console.log('⚠️ Disconnected. Attempting to reconnect...');

  if (!reconnecting) {
    reconnecting = true;
    retryConnection();
  }
}

// The automatic BT re-connection fails for devices that have not been manually connected
// for more than three minutes.
async function retryConnection() {
  if (!device) {
    throw new Error('Bluetooth device is undefined');
  }

  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    try {
      await delay(3000);
      if (!device.gatt!.connected) {
        await connect();
        await probeWriteMtu();
        reconnecting = false;
        return;
      }
    } catch (e) {
      console.warn(`Retry ${attempts + 1} failed:`, e);
    }
    attempts++;
  }

  console.log(`❌ Failed to reconnect after ${attempts} attempts`);

  // Disconnect and prompt for manual reconnection if automatic reconnection fails
  disconnect();
  dispatchManualReconnectionEvent();
}

// COMMAND CHARACTERISTIC

/**
 * Set the state of the Thymio 3 actuators.
 * @param {*} actuatorData
 */
export async function setActuatorState(actuatorData: ActuatorData) {
  await command.setActuatorState(commandCharacteristic, actuatorData)
}

// PYTHON CHARACTERISTIC

/**
 * Upload a Python script with soft-reset, retries, and load ACK.
 * Pauses sensor streaming for the duration of the upload and leaves it paused
 * so the caller can execute the script before restoring streaming.
 */
export async function sendPythonScript(script: string): Promise<PythonLoadResult> {
  if (streamingActive) {
    await stopSensorStreaming();
    await delay(150);
  }

  try {
    await python.softResetPythonInterpreter(pythonCharacteristic);
    await delay(100);
  } catch (err) {
    console.warn("[Python upload]: soft reset failed, continuing", err);
  }

  return await python.sendPythonScript(pythonCharacteristic, script);
}

export async function executeLoadedScript() {
  await python.executeLoadedScript(pythonCharacteristic);
}

export async function stopScriptExecution() {
  await python.stopScriptExecution(pythonCharacteristic);
}

export async function saveScriptToPartition(scriptId: number) {
	await python.saveScriptToPartition(pythonCharacteristic, scriptId);
}

export async function softResetPythonInterpreter() {
	await python.softResetPythonInterpreter(pythonCharacteristic);
}

//// SENSOR STREAM CHARACTERISTIC

/**
 * Start the sensor streaming. By default, only the main sensors are enabled.
 * @param other Enable/disable other sensors
 */
export async function startSensorStreaming(other = false) {
  const result = await sensorStream.startSensorStreaming(sensorStreamCharacteristic, other);
  streamingActive = true;
  return result;
}

/**
 * Start both main and other sensor streams.
 */
export async function startBothSensorStreaming() {
  const result = await sensorStream.startBothSensorStreaming(sensorStreamCharacteristic);
  streamingActive = true;
  return result;
}

/**
 * Stop all sensor streaming.
 */
export async function stopSensorStreaming() {
  const result = await sensorStream.stopSensorStreaming(sensorStreamCharacteristic);
  streamingActive = false;
  return result;
}

//// FIRMWARE UPDATE

export async function isNewerFirmwareAvailable(): Promise<boolean> {
  return await updater.isNewerFirmwareAvailable(deviceInfoCharacteristic);
}

export async function getNewFirmware(): Promise<ArrayBuffer> {
  return await updater.getNewFirmware(deviceInfoCharacteristic);
}

export async function updateFirmware(): Promise<void> {
  // Temporary fix for the OTA slowdown
  unsubscribeFromCharacteristics();

  return await updater.updateFirmware(
    deviceInfoCharacteristic,
    otaCommandCharacteristic,
    otaFirmwareCharacteristic
  );
}

//// OTA CHARACTERISTIC

export async function uploadFirmware(firmware: ArrayBuffer): Promise<void> {
  // Temporary fix for the OTA slowdown
  unsubscribeFromCharacteristics();

  return await ota.uploadFirmware(
    otaCommandCharacteristic,
    otaFirmwareCharacteristic,
    firmware
  );
}

export async function stopFirmwareUpload(): Promise<void> {
  return await ota.stopFirmwareUpload(otaCommandCharacteristic);
}

//// AUDIO CHARACTERISTIC

/**
 * Upload a custom audio file.
 * @param file The audio file to upload.
 */
export async function uploadAudioFile(file: File) {
  return await audio.uploadAudioFile(audioCharacteristic, file)
}

/**
 * Play the audio file that is currently in memory.
 */
export async function playAudioFile() {
  return await audio.playAudioFile(audioCharacteristic);
}

/**
 * Stop the audio file that is currently playing.
 */
export async function stopAudioFile() {
  return await audio.stopAudioFile(audioCharacteristic);
}

/**
 * Start recording audio to memory.
 * @param duration The duration of the recording (maximum 10 seconds).
 */
export async function recordAudio(duration: number) {
  return await audio.recordAudio(audioCharacteristic, duration);
}

/**
 * Play a frequency.
 * @param frequency Frequency in Hz (up to 3kHz)
 * @param duration Duration in tenths of a second, 0 means play forever
 */
export async function playFrequency(
  frequency: number,
  duration: number
) {
  return await audio.playFrequency(audioCharacteristic, frequency, duration);
}

//// FILES CHARACTERISTIC

/**
 * Upload a file to the Thymio. It will be placed in RAM.
 * @param file File to upload
 */
export async function uploadFile(file: File): Promise<void> {
  return await files.uploadFile(fileCharacteristic, file);
}

/**
 * Save the file that is present in the RAM to the storage.
 * @param filename Name of the file new file.
 */
export async function saveFile(filename: string): Promise<void> {
  return await files.saveFile(fileCharacteristic, filename);
}

/**
 * Delete a file from the storage.
 * @param filename Name of the file to delete.
 * @returns
 */
export async function deleteFile(filename: string): Promise<void> {
  return await files.deleteFile(fileCharacteristic, filename);
}

/**
 * List files present in the Thymio storage.
 * @returns A listing of files with their names and sizes.
 */
export async function listFiles(): Promise<FileListing[]> {
  return await files.listFiles(fileCharacteristic);
}

/**
 * Erase all files from the Thymio storage.
 */
export async function eraseAllFiles(): Promise<void> {
  return await files.eraseAllFiles(fileCharacteristic);
}

/**
 * Download a file from the robot.
 * @param filename Name of the file to download.
 * @returns An byte array of the downloaded file.
 */
export async function downloadFile(filename: string): Promise<Uint8Array<ArrayBuffer>> {
  return await files.downloadFile(fileCharacteristic, filename);
}

/**
 * Free the RAM from the uploaded files.
 */
export async function freeMemory(): Promise<void> {
  return await files.freeMemory(fileCharacteristic);
}

//// DEVICE INFO CHARACTERISTIC

/**
 * Get the device firmware info.
 */
export async function getFirmwareInfo(): Promise<FirmwareInfo> {
  return await deviceInfo.getFirmwareInfo(deviceInfoCharacteristic);
}

/**
 * Get the device memory info.
 */
export async function getMemoryInfo(): Promise<MemoryInfo> {
  return await deviceInfo.getMemoryInfo(deviceInfoCharacteristic);
}

export { getWriteMtu };

function dispatchManualReconnectionEvent() {
  const manualReconnEvent = new CustomEvent(THYMIO_PROMPT_MANUAL_RECONNECTION_EVENT_ID);
  document.dispatchEvent(manualReconnEvent);
}
function dispatchConnectedEvent(connected: boolean) {
  const connectedEvent = new CustomEvent(THYMIO_CONNECTED_EVENT_ID, {
    detail: connected
  });
  document.dispatchEvent(connectedEvent);
}
function dispatchDisconnectedEvent() {
  document.dispatchEvent(new CustomEvent(THYMIO_DISCONNECTED_EVENT_ID));
}

// Temporary fix for the OTA slowdown
async function unsubscribeFromCharacteristics() {
  await sensorStreamCharacteristic.stopNotifications();
  sensorStreamCharacteristic.removeEventListener('characteristicvaluechanged', sensorStream.handleStreamResponse);

  await pythonCharacteristic.stopNotifications();
  pythonCharacteristic.removeEventListener('characteristicvaluechanged', python.handlePythonResponse);

  await stdOutCharacteristic.stopNotifications();
  stdOutCharacteristic.removeEventListener('characteristicvaluechanged', handleStdOutResponse);

  await audioCharacteristic.stopNotifications();
  audioCharacteristic.removeEventListener('characteristicvaluechanged', audio.handleAudioResponse);

  await fileCharacteristic.stopNotifications();

  await deviceInfoCharacteristic.stopNotifications();
}
