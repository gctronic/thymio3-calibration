import { THYMIO_OTHER_SENSOR_VALUES_EVENT_ID, THYMIO_SENSOR_VALUES_EVENT_ID } from "./constants";

export type SensorsData = {
  colorSensor: {
    h: number; // 2 bytes
    s: number; // 1 byte
    v: number; // 1 byte
  };
  groundSensors: {
    left: number;  // 2 bytes
    right: number; // 2 bytes
  };
  accelerationRaw: {
    x: number; // 2 bytes
    y: number;
    z: number;
  };
  gyroRaw: {
    x: number; // 2 bytes
    y: number;
    z: number;
  };
  buttons: {
    back: boolean;
    left: boolean;
    center: boolean;
    forward: boolean;
    right: boolean;
  };
  microphoneVolume: number; // 2 bytes
  proximitySensors: {
    left: number;
    frontLeft: number;
    center: number;
    frontRight: number;
    right: number;
    backLeft: number;
    backRight: number;
  };
  tvRemote: number; // 1 byte
};

export type OtherSensorData = {
  colorRaw: {
    red: number;
    green: number;
    blue: number;
    clear: number;
  };
  colorDetected: number;
  groundAmbient: {
    left: number;
    right: number;
  };
  groundReflected: {
    left: number;
    right: number;
  };
  angleDegrees: number;
  eventFlags: {
    tapDetected: boolean;
    freefallDetected: boolean;
    clapDetected: boolean;
  };
  motor: {
    leftSpeed: number;
    rightSpeed: number;
    leftPwmDuty: number;
    rightPwmDuty: number;
  };
  batteryVoltage: number;
};

/**
 * Start the sensor streaming. By default, only the main sensors are enabled.
 * @param other Enable/disable other sensors
 */
export async function startSensorStreaming(
  sensorStreamCharacteristic: BluetoothRemoteGATTCharacteristic,
  other = false
) {
  const id = 0x01;

  let body = 0;
  if (!other) {
    body |= 0b00000001;
  } else {
    body |= 0b00000010;
  }

  const payload = new Uint8Array([id, body]);

  return await sensorStreamCharacteristic.writeValueWithResponse(payload);
}

/**
 * Stop all sensor streaming.
 */
export async function stopSensorStreaming(
  sensorStreamCharacteristic: BluetoothRemoteGATTCharacteristic,
) {
  const id = 0x01;

  const body = 0x00;
  const payload = new Uint8Array([id, body]);

  return await sensorStreamCharacteristic.writeValueWithResponse(payload);
}

/**
 * Start both main and other sensor streams in one command.
 */
export async function startBothSensorStreaming(
  sensorStreamCharacteristic: BluetoothRemoteGATTCharacteristic,
) {
  const id = 0x01;
  const body = 0b00000011;
  const payload = new Uint8Array([id, body]);

  return await sensorStreamCharacteristic.writeValueWithResponse(payload);
}

/**
 * Handler for the stream response. Captures the event data, transforms it into the appropriate
 * object and fires the appropriate event with the transformed data.
 */
export async function handleStreamResponse(event: Event) {
	const value = (event.target! as BluetoothRemoteGATTCharacteristic).value;

  if (value) {
    const id = value.getUint8(0);
    const data = new Uint8Array(value.buffer.slice(1));

    if (id === 0x01) {
      const sensorsData = parseSensorsData(data);

      const mostValuesEvent = new CustomEvent(THYMIO_SENSOR_VALUES_EVENT_ID, {
        detail: sensorsData
      });
      document.dispatchEvent(mostValuesEvent);
    } else if(id === 0x02) {
      const otherSensorData = parseOtherSensorData(data);

      const otherValueEvent = new CustomEvent(THYMIO_OTHER_SENSOR_VALUES_EVENT_ID, {
        detail: otherSensorData
      });
      document.dispatchEvent(otherValueEvent);
    }
  }
}

/**
 * Parses the main sensor data.
 * @param bytes Raw main sensor data
 * @returns A typed sensor data object
 */
function parseSensorsData(bytes: Uint8Array): SensorsData {
  if (bytes.length !== 38) {
    throw new Error("Invalid byte array length. Expected 38 bytes.");
  }

  const dv = new DataView(bytes.buffer);
  let offset = 0;

  const h = dv.getUint16(offset, true); offset += 2;
  const s = dv.getUint8(offset); offset += 1;
  const v = dv.getUint8(offset); offset += 1;

  const groundLeft = dv.getUint16(offset, true); offset += 2;
  const groundRight = dv.getUint16(offset, true); offset += 2;

  const accelX = dv.getInt16(offset, true); offset += 2;
  const accelY = dv.getInt16(offset, true); offset += 2;
  const accelZ = dv.getInt16(offset, true); offset += 2;

  const gyroX = dv.getInt16(offset, true); offset += 2;
  const gyroY = dv.getInt16(offset, true); offset += 2;
  const gyroZ = dv.getInt16(offset, true); offset += 2;

  const buttonsByte = dv.getUint8(offset); offset += 1;

  const micVolume = dv.getUint16(offset, true); offset += 2;

  const proximity = {
    left: dv.getUint16(offset, true), offset1: offset += 2,
    frontLeft: dv.getUint16(offset, true), offset2: offset += 2,
    center: dv.getUint16(offset, true), offset3: offset += 2,
    frontRight: dv.getUint16(offset, true), offset4: offset += 2,
    right: dv.getUint16(offset, true), offset5: offset += 2,
    backLeft: dv.getUint16(offset, true), offset6: offset += 2,
    backRight: dv.getUint16(offset, true), offset7: offset += 2,
  };

  const tvRemote = dv.getUint8(offset); offset += 1;

  return {
    colorSensor: { h, s, v },
    groundSensors: { left: groundLeft, right: groundRight },
    accelerationRaw: { x: accelX, y: accelY, z: accelZ },
    gyroRaw: { x: gyroX, y: gyroY, z: gyroZ },
    buttons: {
      back: !!(buttonsByte & (1 << 0)),
      left: !!(buttonsByte & (1 << 1)),
      center: !!(buttonsByte & (1 << 2)),
      forward: !!(buttonsByte & (1 << 3)),
      right: !!(buttonsByte & (1 << 4)),
    },
    microphoneVolume: micVolume,
    proximitySensors: {
      left: proximity.left,
      frontLeft: proximity.frontLeft,
      center: proximity.center,
      frontRight: proximity.frontRight,
      right: proximity.right,
      backLeft: proximity.backLeft,
      backRight: proximity.backRight,
    },
    tvRemote
  };
}

/**
 * Parses the additional sensor data.
 * @param bytes Raw extra sensor data
 * @returns A typed other sensor data object
 */
function parseOtherSensorData(bytes: Uint8Array): OtherSensorData {
  if (bytes.length !== 30) {
    throw new Error("Invalid byte array length. Expected 30 bytes.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  const red = view.getUint16(offset, true); offset += 2;
  const green = view.getUint16(offset, true); offset += 2;
  const blue = view.getUint16(offset, true); offset += 2;
  const clear = view.getUint16(offset, true); offset += 2;

  const colorDetected = bytes[offset]; offset += 1;

  const groundAmbientLeft = view.getUint16(offset, true); offset += 2;
  const groundAmbientRight = view.getUint16(offset, true); offset += 2;

  const groundReflectedLeft = view.getUint16(offset, true); offset += 2;
  const groundReflectedRight = view.getUint16(offset, true); offset += 2;

  const angleDegrees = view.getInt16(offset, true); offset += 2;

  const eventByte = bytes[offset]; offset += 1;

  const leftSpeed = view.getInt16(offset, true); offset += 2;
  const rightSpeed = view.getInt16(offset, true); offset += 2;
  const leftPwmDuty = view.getInt16(offset, true); offset += 2;
  const rightPwmDuty = view.getInt16(offset, true); offset += 2;

  const batteryVoltage = view.getUint16(offset, true); offset += 2;

  return {
    colorRaw: { red, green, blue, clear },
    colorDetected,
    groundAmbient: { left: groundAmbientLeft, right: groundAmbientRight },
    groundReflected: { left: groundReflectedLeft, right: groundReflectedRight },
    angleDegrees,
    eventFlags: {
      tapDetected: (eventByte & 0b00000001) !== 0,
      freefallDetected: (eventByte & 0b00000010) !== 0,
      clapDetected: (eventByte & 0b00000100) !== 0,
    },
    motor: {
      leftSpeed,
      rightSpeed,
      leftPwmDuty,
      rightPwmDuty,
    },
    batteryVoltage,
  };
}
