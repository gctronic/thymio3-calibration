export const MAIN_SERVICE_UUID = '0000abf0-0000-1000-8000-00805f9b34fb';

export const COMMAND_CHARACTERISTIC_UUID = '0000abf1-0000-1000-8000-00805f9b34fb';
export const SENSOR_STREAM_CHARACTERISTIC_UUID = '0000abf2-0000-1000-8000-00805f9b34fb';
export const PYTHON_CHARACTERISTIC_UUID = '0000abf3-0000-1000-8000-00805f9b34fb';
export const STD_OUT_CHARACTERISTIC_UUID = '0000abf7-0000-1000-8000-00805f9b34fb';
export const AUDIO_CHARACTERISTIC_UUID = '0000abf4-0000-1000-8000-00805f9b34fb';
export const FILE_CHARACTERISTIC_UUID = '0000abf6-0000-1000-8000-00805f9b34fb';
export const DEVICE_INFO_CHARACTERISTIC_UUID = '0000abf5-0000-1000-8000-00805f9b34fb';

export const OTA_SERVICE_UUID = 0x8018;
export const OTA_FIRMWARE_CHARACTERISTIC_UUID = 0x8020;
export const OTA_PROGRESS_BAR_CHARACTERISTIC_UUID = 0x8021;
export const OTA_COMMAND_CHARACTERISTIC_UUID = 0x8022;
export const OTA_CUSTOMER_CHARACTERISTIC_UUID = 0x8023;

/**
 * Safe default ATT write size for Web Bluetooth.
 * Chrome/macOS often negotiates ATT_MTU ≈ 185 → max payload 182.
 * The upstream API used 500, which commonly causes
 * "GATT operation failed for unknown reason".
 */
export const MTU = 182;

export const FIRMWARE_PAYLOAD_SIZE = MTU - 4;
export const FIRMWARE_SECTOR_SIZE = 4096; // 4KB;

export const THYMIO_CONNECTED_EVENT_ID = 'thymio-connected';
export const THYMIO_DISCONNECTED_EVENT_ID = 'thymio-disconnected';
export const THYMIO_PROMPT_MANUAL_RECONNECTION_EVENT_ID = 'thymio-prompt-manual-reconnection';
export const THYMIO_PYTHON_EXECUTION_STATUS_EVENT_ID = 'thymio-python-execution-status';
export const THYMIO_PYTHON_LOAD_RESULT_EVENT_ID = 'thymio-python-load-result';
export const THYMIO_PYTHON_UPLOAD_PROGRESS_EVENT_ID = 'thymio-python-upload-progress';
export const THYMIO_SENSOR_VALUES_EVENT_ID = 'thymio-sensor-values';
export const THYMIO_OTHER_SENSOR_VALUES_EVENT_ID = 'thymio-sensor-other-values';
export const THYMIO_FIRMWARE_UPLOAD_PROGRESS_EVENT_ID = 'thymio-ota-upload-progress';
export const THYMIO_AUDIO_UPLOAD_PROGRESS_EVENT_ID = 'thymio-audio-upload-progress';
export const THYMIO_FILE_UPLOAD_PROGRESS_EVENT_ID = 'thymio-file-upload-progress';
export const THYMIO_FILE_DOWNLOAD_PROGRESS_EVENT_ID = 'thymio-file-download-progress';
export const THYMIO_STD_OUT_EVENT_ID = 'thymio-std-out-values';
