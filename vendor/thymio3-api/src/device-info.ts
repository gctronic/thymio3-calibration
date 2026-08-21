export type FirmwareInfo = {
  esp32_ver: number,
  stm32_ver: number
};

export type MemoryInfo = {
  flash_bytes_free: number,
  ram_bytes_free: number
}

export async function getFirmwareInfo(
  deviceInfoCharacteristic: BluetoothRemoteGATTCharacteristic
): Promise<FirmwareInfo> {
  return new Promise<FirmwareInfo>(async (resolve, reject) => {
    const onResponse = (event: Event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;

      if (!value) return;

      const view = new DataView(value.buffer);
      const id = view.getUint8(0);

      if (id !== 0x01) return;

      deviceInfoCharacteristic.removeEventListener("characteristicvaluechanged", onResponse);

      try {
        // The ATT packet may be longer than the payload, so the body must be
        // cut at messageLength. Decoding to the end of the buffer feeds
        // trailing padding to JSON.parse, which throws inside this handler and
        // leaves the promise pending until the caller's timeout.
        const messageLength = view.getUint16(1, true);
        const available = value.buffer.byteLength - 3;
        const length = Math.min(messageLength, Math.max(0, available));
        const data = new Uint8Array(value.buffer, 3, length);

        const decoder = new TextDecoder();
        const firmwareInfoString = decoder.decode(data);
        const firmwareInfo = JSON.parse(firmwareInfoString) as FirmwareInfo;
        resolve(firmwareInfo);
      } catch (err) {
        reject(err);
      }
    };

    deviceInfoCharacteristic.addEventListener("characteristicvaluechanged", onResponse);

    try {
      const id = 0x01;
      const payload = new Uint8Array([id]);
      await deviceInfoCharacteristic.writeValueWithResponse(payload);
    } catch(err) {
      deviceInfoCharacteristic.removeEventListener("characteristicvaluechanged", onResponse);
      reject(err);
    }
  });
}

export async function getMemoryInfo(
  deviceInfoCharacteristic: BluetoothRemoteGATTCharacteristic
): Promise<MemoryInfo> {
  return new Promise<MemoryInfo>(async (resolve, reject) => {
    const onResponse = (event: Event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;

      if (!value) return;

      const view = new DataView(value.buffer);
      const id = view.getUint8(0);

      if (id !== 0x02) return;

      deviceInfoCharacteristic.removeEventListener("characteristicvaluechanged", onResponse);

      try {
        const messageLength = view.getUint16(1, true);
        const available = value.buffer.byteLength - 3;
        const length = Math.min(messageLength, Math.max(0, available));
        const data = new Uint8Array(value.buffer, 3, length);

        const decoder = new TextDecoder();
        const memoryInfoString = decoder.decode(data);
        const memoryInfo = JSON.parse(memoryInfoString) as MemoryInfo;
        resolve(memoryInfo);
      } catch (err) {
        reject(err);
      }
    };

    deviceInfoCharacteristic.addEventListener("characteristicvaluechanged", onResponse);

    try {
      const id = 0x02;
      const payload = new Uint8Array([id]);
      await deviceInfoCharacteristic.writeValueWithResponse(payload);
    } catch(err) {
      deviceInfoCharacteristic.removeEventListener("characteristicvaluechanged", onResponse);
      reject(err);
    }
  });
}
