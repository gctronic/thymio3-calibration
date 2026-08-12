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

      const messageLength = view.getUint16(1, true);
      const data = new Uint8Array(value.buffer, 3);

      const decoder = new TextDecoder();
      const firmwareInfoString = decoder.decode(data);
      const firmwareInfo = JSON.parse(firmwareInfoString) as FirmwareInfo;
      resolve(firmwareInfo);
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

      const messageLength = view.getUint16(1, true);
      const data = new Uint8Array(value.buffer, 3);

      const decoder = new TextDecoder();
      const memoryInfoString = decoder.decode(data);
      const memoryInfo = JSON.parse(memoryInfoString) as MemoryInfo;
      resolve(memoryInfo);
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
