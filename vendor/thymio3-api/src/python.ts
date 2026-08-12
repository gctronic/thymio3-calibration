import {
  THYMIO_PYTHON_EXECUTION_STATUS_EVENT_ID,
  THYMIO_PYTHON_LOAD_RESULT_EVENT_ID,
  THYMIO_PYTHON_UPLOAD_PROGRESS_EVENT_ID,
} from "./constants";
import {
  createPayloadPackets,
  delay,
  getWriteMtu,
  isGattFailure,
  setWriteMtu,
  type UploadProgress,
  writeWithRetry,
} from "./utils";

export type PythonLoadResult = {
  code: number;
  ok: boolean;
  message: string;
};

const LOAD_RESULT_MESSAGES: Record<number, string> = {
  0: "Script loaded successfully.",
  1: "CRC mismatch.",
  2: "Partial upload.",
  3: "Wrong sequence.",
  4: "Script too big (firmware limit).",
};

let loadResultWaiter: {
  resolve: (result: PythonLoadResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
} | null = null;

function dispatchLoadResult(result: PythonLoadResult) {
  document.dispatchEvent(
    new CustomEvent(THYMIO_PYTHON_LOAD_RESULT_EVENT_ID, { detail: result })
  );
}

function cancelLoadWaiter(reason = "[Python load]: cancelled") {
  if (!loadResultWaiter) return;
  clearTimeout(loadResultWaiter.timer);
  const waiter = loadResultWaiter;
  loadResultWaiter = null;
  waiter.reject(new Error(reason));
}

function settleLoadResult(result: PythonLoadResult) {
  if (!loadResultWaiter) return;
  clearTimeout(loadResultWaiter.timer);
  const waiter = loadResultWaiter;
  loadResultWaiter = null;
  if (result.ok) {
    waiter.resolve(result);
  } else {
    waiter.reject(new Error(`[Python load]: ${result.message}`));
  }
}

function waitForLoadResult(timeoutMs = 15000): Promise<PythonLoadResult> {
  cancelLoadWaiter();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      loadResultWaiter = null;
      reject(new Error("[Python load]: timed out waiting for robot acknowledgement"));
    }, timeoutMs);
    loadResultWaiter = { resolve, reject, timer };
  });
}

async function writeAllPackets(
  pythonCharacteristic: BluetoothRemoteGATTCharacteristic,
  scriptDataArray: Uint8Array,
  mtu: number
) {
  const packets = createPayloadPackets(scriptDataArray, false, mtu);
  const totalPackets = packets.length;
  let uploadedPackets = 0;

  for (const packet of packets) {
    await writeWithRetry(pythonCharacteristic, packet);
    uploadedPackets++;
    const uploadProgressData: UploadProgress = {
      uploadedPackets,
      totalPackets,
      percentage: (uploadedPackets / totalPackets) * 100,
    };
    document.dispatchEvent(
      new CustomEvent(THYMIO_PYTHON_UPLOAD_PROGRESS_EVENT_ID, {
        detail: uploadProgressData,
      })
    );
  }
}

async function writePacketsWithMtuFallback(
  pythonCharacteristic: BluetoothRemoteGATTCharacteristic,
  scriptDataArray: Uint8Array
): Promise<PythonLoadResult> {
  let mtu = getWriteMtu();
  const minMtu = 20;
  let lastError: unknown;

  while (mtu >= minMtu) {
    setWriteMtu(mtu);
    const loadPromise = waitForLoadResult();

    try {
      await writeAllPackets(pythonCharacteristic, scriptDataArray, mtu);
      return await loadPromise;
    } catch (err) {
      lastError = err;
      // Prevent unhandled rejection if we cancel a still-pending load waiter
      loadPromise.catch(() => {});
      cancelLoadWaiter();

      const canShrink = isGattFailure(err) && mtu > minMtu;
      if (!canShrink) {
        throw err;
      }

      const nextMtu = Math.max(minMtu, Math.floor(mtu / 2));
      console.warn(
        `[Python upload]: GATT write failed at MTU ${mtu}. Retrying with MTU ${nextMtu}.`,
        err
      );
      mtu = nextMtu;

      // Soft-reset so a partial upload does not poison the next attempt
      try {
        await writeWithRetry(pythonCharacteristic, new Uint8Array([0x05]));
      } catch (resetErr) {
        console.warn("[Python upload]: soft reset after failed attempt failed", resetErr);
      }
      await delay(120);
    }
  }

  throw lastError;
}

export async function sendPythonScript(
  pythonCharacteristic: BluetoothRemoteGATTCharacteristic,
  script: string
): Promise<PythonLoadResult> {
  const encoder = new TextEncoder();
  const scriptDataArray = encoder.encode(script);
  return await writePacketsWithMtuFallback(pythonCharacteristic, scriptDataArray);
}

export async function executeLoadedScript(
  pythonCharacteristic: BluetoothRemoteGATTCharacteristic,
) {
  const packet = new Uint8Array([0x02]);

  await writeWithRetry(pythonCharacteristic, packet);
}

export async function stopScriptExecution(
  pythonCharacteristic: BluetoothRemoteGATTCharacteristic,
) {
  const packet = new Uint8Array([0x03]);

  await writeWithRetry(pythonCharacteristic, packet);
}

export async function saveScriptToPartition(
	pythonCharacteristic: BluetoothRemoteGATTCharacteristic,
	scriptId: number
) {
	if(!scriptId) {
		throw new Error("Script ID must not be empty");
	}

	return new Promise<void>((resolve, reject) => {
		const onResponse = (event: Event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;

      const view = new DataView(value.buffer);
      const id = view.getUint8(0);

      // We only care about the save to partition response (0x05)
      if (id === 0x05) {
				const result = view.getInt8(1);

				pythonCharacteristic.removeEventListener("characteristicvaluechanged", onResponse);

				switch(result) {
					case 0:
						resolve();
						break;
					case 1:
						reject(`[Python save file to partition]: ${scriptId} not found`);
						break;
					case 2:
						reject(`[Python save file to partition]: unknown error`);
						break;
				}
			}
		};

		pythonCharacteristic.addEventListener("characteristicvaluechanged", onResponse);

		const id = 0x04;
		const packet = new Uint8Array([id, scriptId]);

		writeWithRetry(pythonCharacteristic, packet).catch(err => {
			pythonCharacteristic.removeEventListener("characteristicvaluechanged", onResponse);
			reject(err);
		});
	});
}

export async function softResetPythonInterpreter(
	pythonCharacteristic: BluetoothRemoteGATTCharacteristic
) {
	const packet = new Uint8Array([0x05]);

	await writeWithRetry(pythonCharacteristic, packet);
}

export function handlePythonResponse(event: Event) {
	const value = (event.target! as BluetoothRemoteGATTCharacteristic).value;
	if (value) {
		const id = value.getUint8(0);

		if (id === 0x01) {
			const loadResult = value.getUint8(1);
      const message = LOAD_RESULT_MESSAGES[loadResult] ?? `Unknown return code ${loadResult}`;
      const result: PythonLoadResult = {
        code: loadResult,
        ok: loadResult === 0,
        message,
      };

      console.log(`[Python execution]: ${result.ok ? "✅" : "❌"} ${message}`);
      dispatchLoadResult(result);
      settleLoadResult(result);

      if (loadResult === 0) {
        dispatchExecutionStatusEvent(true);
      }
		} else if (id === 0x02) {
			const result = value.getUint8(1);

			const exception = (result & 0b00000001) !== 0;
			const scriptRunning = (result & 0b00000010) !== 0;

			let terminationReason;
			if (!exception && !scriptRunning) {
				terminationReason = "✅ Script terminated normally.";
			} else {
				if (exception) {
					terminationReason = "❌ Script terminated with exception.";
				}
				else if (scriptRunning) {
					terminationReason = "⚠️ Another script was already running.";
				}
			}
			console.log(`[Python execution]: Script Terminated: ${terminationReason}`);

			dispatchExecutionStatusEvent(false);
		} else {
			console.warn(
				`[Notification] Unknown ID: 0x${id.toString(16).padStart(2, "0")}`
			);
		}
	}
}

function dispatchExecutionStatusEvent(executing: boolean) {
	const executionStatusEvent = new CustomEvent(THYMIO_PYTHON_EXECUTION_STATUS_EVENT_ID, {
		detail: executing
	});
	document.dispatchEvent(executionStatusEvent);
}
