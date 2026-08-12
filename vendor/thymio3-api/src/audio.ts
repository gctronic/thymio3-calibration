import { THYMIO_AUDIO_UPLOAD_PROGRESS_EVENT_ID } from "./constants";
import { createPayloadPackets, type UploadProgress } from "./utils";

/**
 * Upload a custom audio file.
 * @param file The audio file to upload.
 */
export async function uploadAudioFile(
  audioCharacteristic: BluetoothRemoteGATTCharacteristic,
  file: File
) {
  // Perform the audio file checks
  await isFileWavOrMp3(file);
  await isMonoAndCorrectSampleRate(file);

  const buffer = await file.arrayBuffer();
  const payload = new Uint8Array(buffer);

  const packets = createPayloadPackets(payload, true);

  const totalPackets = packets.length;
  let uploadedPackets = 0;

  for(const packet of packets) {
    await audioCharacteristic.writeValueWithResponse(packet);

    const uploadProgressData: UploadProgress = {
      uploadedPackets,
      totalPackets,
      percentage: (uploadedPackets / totalPackets) * 100
    };
    const uploadProgressEvent = new CustomEvent(THYMIO_AUDIO_UPLOAD_PROGRESS_EVENT_ID, {
      detail: uploadProgressData
    });
    document.dispatchEvent(uploadProgressEvent);
    uploadedPackets++;
  }
}

/**
 * Play the audio file that is currently in memory.
 */
export async function playAudioFile(
  audioCharacteristic: BluetoothRemoteGATTCharacteristic,
) {
  const id = 0x02;

  const body = new Array(20).fill(0x00);
  const payload = new Uint8Array([id, ...body]);

  return await audioCharacteristic.writeValueWithResponse(payload);
}

/**
 * Stop the audio file that is currently playing.
 */
export async function stopAudioFile(
  audioCharacteristic: BluetoothRemoteGATTCharacteristic,
) {
  const id = 0x03;

  const payload = new Uint8Array([id]);

  return await audioCharacteristic.writeValueWithResponse(payload);
}

/**
 * Start recording audio to memory.
 * @param duration The duration of the recording (maximum 10 seconds).
 */
export async function recordAudio(
  audioCharacteristic: BluetoothRemoteGATTCharacteristic,
  duration: number
) {
  if (duration > 10) {
    throw new Error(`Can not record more than 10 seconds.`);
  }

  const id = 0x05;

  const buffer = new ArrayBuffer(2);
  const view = new DataView(buffer);
  view.setUint8(0, id);
  view.setUint8(1, duration);
  const payload = new Uint8Array(buffer);

  return await audioCharacteristic.writeValueWithResponse(payload);
}

/**
 * Play a frequency.
 * @param frequency Frequency in Hz (up to 3kHz)
 * @param duration Duration in tenths of a second, 0 means play forever
 */
export async function playFrequency(
  audioCharacteristic: BluetoothRemoteGATTCharacteristic,
  frequency: number,
  duration: number
) {
  const id = 0x06;

  const buffer = new ArrayBuffer(5);
  const view = new DataView(buffer);
  view.setUint8(0, id);
  view.setUint16(1, frequency);
  view.setUint16(3, duration);
  const payload = new Uint8Array(buffer);

  return await audioCharacteristic.writeValueWithResponse(payload);
}

export function handleAudioResponse(event: Event) {
	const value = (event.target! as BluetoothRemoteGATTCharacteristic).value;

  if (value) {
    const buffer = value.buffer;
    const view = new DataView(buffer);

    const id = view.getUint8(0);
    const cmd = view.getUint8(1);

    if (id === 0x01) {
      if (cmd === 0x00) {
        console.log(`Audio loaded correctly`);
      } else if (cmd === 0x01) {
        console.log(`Audio file CRC mismatch`);
      } else if (cmd === 0x02) {
        console.log(`Audio partial upload`);
      } else if (cmd === 0x03) {
        console.log(`Audio wrong sequence`);
      } else if (cmd === 0x04) {
        console.log(`Audio file too big`);
      } else {
        throw new Error(`Command ID unknown`)
      }
    } else if (id === 0x02) {
      if (cmd === 0x00) {
        console.log(`Audio command executed correctly`);
      } else if (cmd === 0x01) {
        console.log(`Audio play error`);
      } else if (cmd === 0x02) {
        console.log(`Audio file not found`);
      } else if (cmd === 0x03) {
        console.log(`Audio file not supported`);
      } else {
        throw new Error(`Command ID unknown`)
      }
    } else if (id === 0x03) {
      if (cmd === 0x00) {
        console.log(`Audio recording saved correctly`);
      } else if (cmd === 0x01) {
        console.log(`Audio recording error`);
      } else if (cmd === 0x02) {
        console.log(`Audio recording duration too long`);
      } else {
        throw new Error(`Command ID unknown`)
      }
    }
  }
}

// Audio helper functions
async function isFileWavOrMp3(file: File): Promise<boolean> {
  const buffer = await file.slice(0, 12).arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // WAV files start with "RIFF....WAVE"
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) {
    return true;
  }

  // MP3 files may start with "ID3" or frame sync bits (e.g., 0xFF 0xFB)
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return true; // ID3 tag
  }

  if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) {
    return true; // MPEG frame sync
  }

  throw new Error(`The audio file must be in WAV or MP3 format`);
}

async function isMonoAndCorrectSampleRate(file: File): Promise<boolean> {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new AudioContext({sampleRate: 12000});

  try {
    // Decode the audio file
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Check if the audio has only 1 channel (mono) and that it has a sample rate of 12kHz (12000)
    if (audioBuffer.numberOfChannels !== 1) {
      throw new Error(`The audio file is not mono.`);
    } else if (audioBuffer.sampleRate !== 12000) {
      throw new Error(`The audio file's sample rate is not 12kHz`);
    } else {
      return true;
    }
  } catch (error) {
    throw new Error(`Error decoding audio: ${error}`) // Could not decode, not sure if mono or not
  }
}

/* TODO evaluate if this is needed, since it needs an external library
import * as mm from 'music-metadata';

async function checkBitDepth(filePath: string): Promise<boolean> {
  try {
    const metadata = await mm.parseFile(filePath);
    return metadata.format.bitsPerSample === 16;  // Check if it's 16-bit
  } catch (error) {
    console.error('Error reading audio metadata:', error);
    return false;  // Error reading file, assume not 16-bit
  }
}
*/
