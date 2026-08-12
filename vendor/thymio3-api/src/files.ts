import { THYMIO_FILE_DOWNLOAD_PROGRESS_EVENT_ID, THYMIO_FILE_UPLOAD_PROGRESS_EVENT_ID } from "./constants";
import { createPayloadPackets, type UploadProgress } from "./utils";

export type FileListing = {
  name: string,
  size: number
};

export async function uploadFile(
  fileCharacteristic: BluetoothRemoteGATTCharacteristic,
  file: File
): Promise<void> {
  return new Promise<void>(async (resolve, reject) => {
    const onResponse = (event: Event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;

      const view = new DataView(value.buffer);
      const id = view.getUint8(0);

      if (id !== 0x01) return;

      const responseCode = view.getUint8(1);

      fileCharacteristic.removeEventListener("characteristicvaluechanged", onResponse);

      switch(responseCode) {
        case 0x00:
          resolve();
          break;
        case 0x01:
          reject(`File upload: CRC Mismatch`);
          break;
        case 0x02:
          reject('File upload: Partial upload');
          break;
        case 0x03:
          reject('File upload: Wrong sequence');
          break;
        case 0x04:
          reject('File upload: File too big');
          break;
        default:
          reject('File upload: Unknown response code')
      }
    };

    fileCharacteristic.addEventListener("characteristicvaluechanged", onResponse);

    try {
      const buffer = await file.arrayBuffer();
      const payload = new Uint8Array(buffer);

      const packets = createPayloadPackets(payload, true);

      const totalPackets = packets.length;
      let uploadedPackets = 0;

      for(const packet of packets) {
        await fileCharacteristic.writeValueWithResponse(packet);

        const uploadProgressData: UploadProgress = {
          uploadedPackets,
          totalPackets,
          percentage: (uploadedPackets / totalPackets) * 100
        };
        const uploadProgressEvent = new CustomEvent(THYMIO_FILE_UPLOAD_PROGRESS_EVENT_ID, {
          detail: uploadProgressData
        });
        document.dispatchEvent(uploadProgressEvent);
        uploadedPackets++;
      }
    } catch (err) {
      console.error(err);
      fileCharacteristic.removeEventListener("characteristicvaluechanged", onResponse);
      reject(err);
    }
  });
}

export async function saveFile(
  fileCharacteristic: BluetoothRemoteGATTCharacteristic,
  filename: string
): Promise<void> {
  return new Promise<void>(async (resolve, reject) => {
    const onResponse = (event: Event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;

      const view = new DataView(value.buffer);
      const id = view.getUint8(0);

      if (id !== 0x02) return;

      const responseCode = view.getUint8(1);

      fileCharacteristic.removeEventListener("characteristicvaluechanged", onResponse);

      switch(responseCode) {
        case 0x00:
          resolve();
          break;
        case 0x01:
          reject(`File save: File not found`);
          break;
        case 0x02:
          reject('File save: File too big');
          break;
        case 0x03:
          reject('File save: Unknown error');
          break;
        default:
          reject('File save: Unknown response code')
      }
    };

    fileCharacteristic.addEventListener("characteristicvaluechanged", onResponse);

    try {
      const id = 0x02;

      const encoder = new TextEncoder();
      const nullTerminatedFilename = filename + String.fromCharCode(0);
      const array = encoder.encode(nullTerminatedFilename);

      if(array.byteLength > 30) {
        throw new Error("File name too long.");
      }

      const body = new Uint8Array(30);
      body.set(array.slice(0, 30));
      const payload = new Uint8Array([id, ...body]);

      await fileCharacteristic.writeValueWithResponse(payload);
    } catch (err) {
      console.error(err);
      fileCharacteristic.removeEventListener("characteristicvaluechanged", onResponse);
      reject(err);
    }
  });
}

export async function deleteFile(
  fileCharacteristic: BluetoothRemoteGATTCharacteristic,
  filename: string
): Promise<void> {
  return new Promise<void>(async (resolve, reject) => {
    const onResponse = (event: Event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;

      const view = new DataView(value.buffer);
      const id = view.getUint8(0);

      if (id !== 0x03) return;

      const responseCode = view.getUint8(1);

      fileCharacteristic.removeEventListener("characteristicvaluechanged", onResponse);

      switch(responseCode) {
        case 0x00:
          resolve();
          break;
        case 0x01:
          reject(`File delete: File not found`);
          break;
        case 0x02:
          reject('File delete: Unknown error');
          break;
        default:
          reject('File delete: Unknown response code')
      }
    };

    fileCharacteristic.addEventListener("characteristicvaluechanged", onResponse);

    try {
      const id = 0x03;

      const encoder = new TextEncoder();
      const nullTerminatedFilename = filename + String.fromCharCode(0);
      const array = encoder.encode(nullTerminatedFilename);

      if(array.byteLength > 30) {
        throw new Error("File name too long.");
      }

      const body = new Uint8Array(30);
      body.set(array.slice(0, 30));
      const payload = new Uint8Array([id, ...body]);

      await fileCharacteristic.writeValueWithResponse(payload);
    } catch (err) {
        console.error(err);
        fileCharacteristic.removeEventListener("characteristicvaluechanged", onResponse);
        reject(err);
    }
  });
}

export async function listFiles(
  fileCharacteristic: BluetoothRemoteGATTCharacteristic
): Promise<FileListing[]> {
  return new Promise<FileListing[]>((resolve, reject) => {
    let totalLength = 0;
    let receivedLength = 0;
    let expectedCrc = 0;
    let chunks: Uint8Array[] = [];
    let messageData: Uint8Array | null = null;

    const onResponse = (event: Event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;

      const view = new DataView(value.buffer);
      const id = view.getUint8(0);

      if (id === 0x05) {
        fileCharacteristic.removeEventListener("characteristicvaluechanged", onResponse);
        reject("File list: could not generate file listing");
      }

      // We only care about the file list response (0x04)
      if (id !== 0x04 && receivedLength === 0) return;

      let offset = 0;
      if (receivedLength === 0) {
        // First packet
        offset = 1; // skip ID
        totalLength = view.getUint16(offset, true); offset += 2;
        expectedCrc = view.getUint32(offset, true); offset += 4;
      }

      const seqId = view.getUint16(offset, true); offset += 2;
      const data = new Uint8Array(value.buffer, offset);
      chunks.push(data);
      receivedLength += data.length;

      // Check if we got everything
      if (receivedLength >= totalLength) {
        // Concatenate all chunks
        messageData = new Uint8Array(totalLength);
        let pos = 0;
        for (const chunk of chunks) {
          messageData.set(chunk, pos);
          pos += chunk.length;
        }

        // Optional: validate CRC if you have a CRC32 function
        // const actualCrc = crc32(messageData);
        // if (actualCrc !== expectedCrc) return reject(new Error('CRC mismatch'));

        fileCharacteristic.removeEventListener("characteristicvaluechanged", onResponse);

        // Parse file listings from the payload
        const decoder = new TextDecoder();
        const listingString = decoder.decode(messageData);
        const fileListings = JSON.parse(listingString) as FileListing[];
        resolve(fileListings);
      }
    };

    fileCharacteristic.addEventListener("characteristicvaluechanged", onResponse);

    // Send the "list files" request to the device
    const id = 0x04;
    const payload = new Uint8Array([id]);
    fileCharacteristic.writeValueWithResponse(payload).catch(err => {
      fileCharacteristic.removeEventListener("characteristicvaluechanged", onResponse);
      reject(err);
    });
  });
}

export async function eraseAllFiles(
  fileCharacteristic: BluetoothRemoteGATTCharacteristic,
): Promise<void> {
  const id = 0x05;

  const payload = new Uint8Array([id]);

  return await fileCharacteristic.writeValueWithResponse(payload);
}

export async function downloadFile(
  fileCharacteristic: BluetoothRemoteGATTCharacteristic,
  filename: string
): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise<Uint8Array<ArrayBuffer>>(async (resolve, reject) => {
    let totalLength = 0;
    let receivedLength = 0;
    let expectedCrc = 0;
    let receivedChunks: Uint8Array[] = [];
    let fileArray: Uint8Array | null = null;

    const onResponse = async (event: Event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;

      const view = new DataView(value.buffer);
      const id = view.getUint8(0);

      console.log(`id : ${id}`)

      // We only care about the file download response 0x07
      if (id !== 0x07 && receivedLength === 0) return;

      let offset = 0;
      if (receivedLength === 0) {
        console.log('first response')
        // First packet
        offset = 1; // skip ID
        totalLength = view.getUint32(offset, true); offset += 4;
        expectedCrc = view.getUint32(offset, true); offset += 4;
      }

      const seqId = view.getUint16(offset, true); offset += 2;
      const data = new Uint8Array(value.buffer, offset);
      receivedChunks.push(data);
      receivedLength += data.length;
      console.log(receivedLength)

      // TODO put in a separate function
      const downloadProgressData: UploadProgress = {
        uploadedPackets: receivedLength,
        totalPackets: totalLength,
        percentage: (receivedLength / totalLength) * 100
      };
      const downloadProgressEvent = new CustomEvent(THYMIO_FILE_DOWNLOAD_PROGRESS_EVENT_ID, {
        detail: downloadProgressData
      });
      document.dispatchEvent(downloadProgressEvent);

      // Check if we got everything
      if (receivedLength >= totalLength) {
        // Concatenate all chunks
        fileArray = new Uint8Array(totalLength);
        let pos = 0;
        for (const chunk of receivedChunks) {
          fileArray.set(chunk, pos);
          pos += chunk.length;
        }

        // Optional: validate CRC if you have a CRC32 function
        // const actualCrc = crc32(messageData);
        // if (actualCrc !== expectedCrc) return reject(new Error('CRC mismatch'));

        fileCharacteristic.removeEventListener("characteristicvaluechanged", onResponse);

        resolve(fileArray as Uint8Array<ArrayBuffer>);
      }

      // Send the file download ack after each chunk reception
      await sendFileDownloadAck(fileCharacteristic);
    };

    fileCharacteristic.addEventListener("characteristicvaluechanged", onResponse);

    try {
      console.log('sending dw request')
      await sendFileDownloadRequest(fileCharacteristic, filename);
      console.log('keeping on')
    } catch (err) {
      fileCharacteristic.removeEventListener("characteristicvaluechanged", onResponse);
      reject(err);
    }
  });
}

export async function freeMemory(
  fileCharacteristic: BluetoothRemoteGATTCharacteristic
): Promise<void> {
  const id = 0x08;
  const payload = new Uint8Array([id]);
  return await fileCharacteristic.writeValueWithResponse(payload);
}

async function sendFileDownloadRequest(
  fileCharacteristic: BluetoothRemoteGATTCharacteristic,
  filename: string,
): Promise<void> {
  return new Promise<void>(async (resolve, reject) => {
    const onResponse = (event: Event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;

      const view = new DataView(value.buffer);
      const id = view.getUint8(0);

      if (id !== 0x08) return;

      const responseCode = view.getUint8(1);

      fileCharacteristic.removeEventListener("characteristicvaluechanged", onResponse);

      switch(responseCode) {
        case 0x00:
          resolve();
          break;
        case 0x01:
          reject(`File download: file not found: ${filename}`);
          break;
        case 0x02:
          reject(`File download: unknown error`);
          break;
        default:
          reject('File upload: Unknown response code')
      }
    };

    fileCharacteristic.addEventListener("characteristicvaluechanged", onResponse);

    try {
      const id = 0x06;
      const encoder = new TextEncoder();
      const nullTerminatedFilename = filename + String.fromCharCode(0);
      const array = encoder.encode(nullTerminatedFilename);

      if(array.byteLength > 30) {
        throw new Error("File name too long.");
      }

      const body = new Uint8Array(30);
      body.set(array.slice(0, 30));
      const payload = new Uint8Array([id, ...body]);

      await fileCharacteristic.writeValueWithResponse(payload);
    } catch (err) {
      console.error(err);
      fileCharacteristic.removeEventListener("characteristicvaluechanged", onResponse);
      reject(err);
    }
  })
}

async function sendFileDownloadAck(
  fileCharacteristic: BluetoothRemoteGATTCharacteristic
): Promise<void> {
  const id = 0x07;
  const payload = new Uint8Array([id]);
  return await fileCharacteristic.writeValueWithResponse(payload);
}
