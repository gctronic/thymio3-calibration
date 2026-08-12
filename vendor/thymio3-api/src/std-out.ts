import { THYMIO_STD_OUT_EVENT_ID } from "./constants";

export function handleStdOutResponse(event: Event) {
	const value = (event.target! as BluetoothRemoteGATTCharacteristic).value;

  if (value) {
    const decoder = new TextDecoder();
    const stdOut = decoder.decode(value.buffer);

    const stdOutEvent = new CustomEvent(THYMIO_STD_OUT_EVENT_ID, {
      detail: stdOut
    });
    document.dispatchEvent(stdOutEvent);
  }
}
