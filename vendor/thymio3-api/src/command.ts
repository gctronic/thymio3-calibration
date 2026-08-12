export type RGB = {
  r: number, // number 0-15
  g: number, // number 0-15
  b: number  // number 0-15
}

export type ActuatorData = {
  circleLEDs: number[],         // Array of 8 numbers (0-15)
  frontLegoLEDs: number[],      // Array of 8 numbers (0-15)
  rearLegoLEDs: number[],       // Array of 8 numbers (0-15)
  flRGB: RGB,              // { r: 0-15, g: 0-15, b: 0-15 }
  frRGB: RGB,              // { r: 0-15, g: 0-15, b: 0-15 }
  blRGB: RGB,              // { r: 0-15, g: 0-15, b: 0-15 }
  brRGB: RGB,              // { r: 0-15, g: 0-15, b: 0-15 }
  motorLeft: number,          // Integer -1000 to 1000
  motorRight: number,         // Integer -1000 to 1000
  sound: number               // Integer 0 to 19
}

/**
 * Set the state of the Thymio 3 actuators.
 * @param {*} actuatorData
 */
export async function setActuatorState(
  commandCharacteristic: BluetoothRemoteGATTCharacteristic,
  actuatorData: ActuatorData
) {
  const commandArray = createCommandByteArray(actuatorData);

  await commandCharacteristic.writeValue(commandArray);
}

/**
 * Auxiliary function that creates the command byte array.
 * @param {*} actuatorData The actuator data object
 * @returns The byte array containing the actuator data
 */
function createCommandByteArray({
    circleLEDs,         // Array of 8 numbers (0-15)
    frontLegoLEDs,      // Array of 8 numbers (0-15)
    rearLegoLEDs,       // Array of 8 numbers (0-15)
    flRGB,              // { r: 0-15, g: 0-15, b: 0-15 }
    frRGB,              // { r: 0-15, g: 0-15, b: 0-15 }
    blRGB,              // { r: 0-15, g: 0-15, b: 0-15 }
    brRGB,              // { r: 0-15, g: 0-15, b: 0-15 }
    motorLeft,          // Integer -1000 to 1000
    motorRight,         // Integer -1000 to 1000
    sound               // Integer 0 to 19
}: ActuatorData) {
    const buffer = new ArrayBuffer(26);
    const view = new DataView(buffer);
    let offset = 0;

    // ID (1 byte)
    view.setUint8(offset, 0x01); offset++;

    // Helper to pack 8 4-bit values into 4 bytes
    function pack4bitArray(arr: number[]) {
        const packed = new Uint8Array(4);
        for (let i = 0; i < 8; i++) {
            const val = arr[i] & 0x0F;
            const byteIndex = Math.floor(i / 2);
            if (i % 2 === 0) {
                packed[byteIndex] |= val;
            } else {
                packed[byteIndex] |= val << 4;
            }
        }
        return packed;
    }

    // Circle LEDs (4 bytes)
    pack4bitArray(circleLEDs).forEach(byte => view.setUint8(offset++, byte));

    // Front Lego LEDs (4 bytes)
    pack4bitArray(frontLegoLEDs).forEach(byte => view.setUint8(offset++, byte));

    // Rear Lego LEDs (4 bytes)
    pack4bitArray(rearLegoLEDs).forEach(byte => view.setUint8(offset++, byte));

    // Helper to pack RGB values into 2 bytes
    function packRGB({ r, g, b }: RGB) {
        let rgb = ((b & 0x0F) << 8) | ((g & 0x0F) << 4) | (r & 0x0F);
        return rgb;
    }

    // FL RGB (2 bytes)
    // Little-endian (explicite) for RGB values
    view.setUint16(offset, packRGB(flRGB),true); offset += 2;

    // FR RGB (2 bytes)
    view.setUint16(offset, packRGB(frRGB),true); offset += 2;

    // BL RGB (2 bytes)
    view.setUint16(offset, packRGB(blRGB),true); offset += 2;

    // BR RGB (2 bytes)
    view.setUint16(offset, packRGB(brRGB),true); offset += 2;

    // Motor left (2 bytes - signed 16-bit)
    view.setInt16(offset, motorLeft); offset += 2;

    // Motor right (2 bytes - signed 16-bit)
    view.setInt16(offset, motorRight); offset += 2;

    // Sound (1 byte)
    view.setUint8(offset, sound); offset++;

    return new Uint8Array(buffer);
}
