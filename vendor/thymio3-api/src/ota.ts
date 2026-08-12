import { BehaviorSubject, filter, firstValueFrom, timeout } from "rxjs";
import { crc16_ccitt, type UploadProgress } from "./utils";
import { FIRMWARE_PAYLOAD_SIZE, FIRMWARE_SECTOR_SIZE, THYMIO_FIRMWARE_UPLOAD_PROGRESS_EVENT_ID } from "./constants";

let otaCommandResponse$: BehaviorSubject<boolean>;
let otaSectorUploadResponse$: BehaviorSubject<number>;

export async function uploadFirmware(
  otaCommandCharacteristic: BluetoothRemoteGATTCharacteristic,
  otaFirmwareCharacteristic: BluetoothRemoteGATTCharacteristic,
  firmware: ArrayBuffer
): Promise<void> {
  // Start the OTA
  otaCommandResponse$ = new BehaviorSubject<boolean>(false);
  await startOTA(otaCommandCharacteristic, firmware.byteLength);

  otaSectorUploadResponse$ = new BehaviorSubject<number>(0);
  // Send the firmware
  return await uploadFirmwareData(otaFirmwareCharacteristic, firmware);
}

export async function stopFirmwareUpload(
  otaCommandCharacteristic: BluetoothRemoteGATTCharacteristic,
): Promise<void> {
  return await stopOTA(otaCommandCharacteristic);
}

// OTA Commands

async function startOTA(
  otaCommandCharacteristic: BluetoothRemoteGATTCharacteristic,
  firmwareLength: number
): Promise<void> {
  const buffer = new ArrayBuffer(20);
  const view = new DataView(buffer);

  // Command ID - 2 bytes
  view.setUint16(0, 0x0001, true);

  // FirmwareLength - 4 bytes
  view.setUint32(2, firmwareLength, true);

  // CRC16 - 2 bytes
  const crcInput = new Uint8Array(buffer, 0, 18);
  const crc = crc16_ccitt(crcInput);
  view.setUint16(18, crc, true);

  // Send packet
  const packet = new Uint8Array(buffer);
  await otaCommandCharacteristic.writeValueWithResponse(packet);

  await firstValueFrom(
    otaCommandResponse$.pipe(
      filter(res => res),
      timeout(10000) // timeout of 3 seconds
    )
  );
}

async function stopOTA(
  otaCommandCharacteristic: BluetoothRemoteGATTCharacteristic,
): Promise<void> {
  const buffer = new ArrayBuffer(20);
  const view = new DataView(buffer);

  // Command ID - 2 bytes
  view.setUint16(0, 0x0002, true);

  // Payload can be left at 0

  // CRC16 - 2 bytes
  const crcInput = new Uint8Array(buffer, 0, 18);
  const crc = crc16_ccitt(crcInput);
  view.setUint16(18, crc, true);

  const packet = new Uint8Array(buffer);
  return await otaCommandCharacteristic.writeValueWithResponse(packet);
}

async function responseCommandOTA(
  otaCommandCharacteristic: BluetoothRemoteGATTCharacteristic,
  commandId: number,
  responseStatus: 0x0000 | 0x0001
): Promise<void> {
  const buffer = new ArrayBuffer(20);
  const view = new DataView(buffer);

  // Command ID - 2 bytes
  view.setUint16(0, 0x0003, true);

  // Payload bytes 2-3: command ID
  view.setUint16(2, commandId, true);

  // Payload bytes 4-5: responseStatus
  view.setUint16(4, responseStatus, true);

  // CRC16 - 2 bytes
  const crcInput = new Uint8Array(buffer, 0, 18);
  const crc = crc16_ccitt(crcInput);
  view.setUint16(18, crc, true);

  const packet = new Uint8Array(buffer);
  return await otaCommandCharacteristic.writeValueWithResponse(packet);
}

// OTA File transfer

async function uploadFirmwareData(
  otaFirmwareCharacteristic: BluetoothRemoteGATTCharacteristic,
  firmware: ArrayBuffer
): Promise<void> {
  const firmwareBytes = new Uint8Array(firmware);
  const totalSectors = Math.ceil(firmwareBytes.length / FIRMWARE_SECTOR_SIZE);

  console.log(
    `Uploading firmware: ${firmwareBytes.length} bytes, ${totalSectors} sectors`
  );

  for (let sector = 0; sector < totalSectors; sector++) {
    const start = sector * FIRMWARE_SECTOR_SIZE;
    const end = Math.min(start + FIRMWARE_SECTOR_SIZE, firmwareBytes.length);
    const sectorData = firmwareBytes.slice(start, end);

    console.log(`Sending sector ${sector}`);

    // Send packets
    let seq = 0;
    while (seq * FIRMWARE_PAYLOAD_SIZE < sectorData.length) {
      const slice = sectorData.slice(
        seq * FIRMWARE_PAYLOAD_SIZE,
        (seq + 1) * FIRMWARE_PAYLOAD_SIZE
      );
      const packet = buildPacket(sector, seq, slice);
      await otaFirmwareCharacteristic.writeValueWithResponse(packet);
      seq++;
      //await delay(10); // pacing
    }

    // Send final packet with CRC
    const finalPacket = buildFinalPacket(sector, sectorData);
    await otaFirmwareCharacteristic.writeValueWithResponse(finalPacket);

    await firstValueFrom(
      otaSectorUploadResponse$.pipe(
        filter(res => res === sector),
        timeout(10000) // timeout of 3 seconds
      )
    );

    const uploadProgressData: UploadProgress = {
      uploadedPackets: sector,
      totalPackets: totalSectors,
      percentage: (sector / totalSectors) * 100
    };
    const uploadProgressEvent = new CustomEvent(THYMIO_FIRMWARE_UPLOAD_PROGRESS_EVENT_ID, {
      detail: uploadProgressData
    });
    document.dispatchEvent(uploadProgressEvent);
  }

  console.log("Firmware upload complete.");
}

export function otaCommandNotificationHandler(event: Event) {
	const value = (event.target! as BluetoothRemoteGATTCharacteristic).value;

  if (value && value.buffer.byteLength === 20) {
    const buffer = value.buffer;
    const view = new DataView(buffer);

    const ack = view.getUint16(0, true);
    const cmd = view.getUint16(2, true);
    const response = view.getUint16(4, true);
    const crc = view.getUint16(18, true);

    // Check CRC error
    const crcInput = new Uint8Array(buffer, 0, 18);
    const calculatedCRC = crc16_ccitt(crcInput);
    if (calculatedCRC !== crc) {
      otaCommandResponse$.error(new Error(`OTA CRC error: the transmitted crc is ${crc}, while the calculated crc is ${calculatedCRC}`));
    }

    switch(response) {
      case 0x0000:
        otaCommandResponse$.next(true);
        break;
      case 0x0001:
        otaCommandResponse$.error(new Error(`Command rejected`));
        break;
      default:
        otaCommandResponse$.error(new Error("Unknown command response"));
    }
  }
}

// OTA Notification handlers

export function otaFirmwareNotificationHandler(event: Event) {
	const value = (event.target! as BluetoothRemoteGATTCharacteristic).value;

  if (value && value.buffer.byteLength === 20) {
    const buffer = value.buffer;
    const view = new DataView(buffer);

    const sectorIndex = view.getUint16(0, true);
    const status = view.getUint16(2, true);
    const desiredSector = view.getUint16(4, true);
    const crc = view.getUint16(18, true);

    // Check CRC error
    const crcInput = new Uint8Array(buffer, 0, 18);
    const calculatedCRC = crc16_ccitt(crcInput);
    if (calculatedCRC !== crc) {
      otaSectorUploadResponse$.error(new Error(`OTA CRC error: the transmitted crc is ${crc}, while the calculated crc is ${calculatedCRC}`));
    }

    switch(status) {
      case 0x0000:
        console.log("Success");
        break;
      case 0x0001:
        otaSectorUploadResponse$.error(new Error(`CRC Error`));
        break;
      case 0x0002:
        otaSectorUploadResponse$.error(new Error(`Sector Index error. Desired sector: ${desiredSector}`));
        break;
      case 0x0003:
        otaSectorUploadResponse$.error(new Error(`Payload length error`));
        break;
      default:
        otaSectorUploadResponse$.error(new Error('Unknown response status'));
    }

    otaSectorUploadResponse$.next(sectorIndex);
  }
}

// OTA Helper functions

function buildPacket(
  sectorIndex: number,
  seq: number,
  payload: Uint8Array
): Uint8Array<ArrayBuffer> {
  const packetLength = 3 + payload.length;
  const buffer = new ArrayBuffer(packetLength);
  const view = new DataView(buffer);

  // Sector_Index: bytes 0-1 (little endian)
  view.setUint16(0, sectorIndex, true);

  // Packet_Seq: byte 2
  view.setUint8(2, seq);

  // Payload: bytes 3 ~ (3 + payload.length - 1)
  const payloadView = new Uint8Array(buffer, 3);
  payloadView.set(payload);

  return new Uint8Array(buffer);
}

function buildFinalPacket(
  sectorIndex: number,
  data: Uint8Array
): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(3 + FIRMWARE_PAYLOAD_SIZE);
  const view = new DataView(buffer);

  // Sector_Index: bytes 0-1 (little endian)
  view.setUint16(0, sectorIndex, true);

  // Packet_Seq: byte 2 = 0xFF (last packet indicator)
  view.setUint8(2, 0xFF);

  // Payload: initialize all 0x00 first
  const payloadView = new Uint8Array(buffer, 3);
  payloadView.fill(0);

  // Calculate CRC16 of sector data
  const crc = crc16_ccitt(data);

  // Set last 2 bytes of payload to CRC16 (little endian)
  view.setUint16(3 + FIRMWARE_PAYLOAD_SIZE - 2, crc, true);

  return new Uint8Array(buffer);
}
