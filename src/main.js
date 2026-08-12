import * as thymio from '@local/thymio3-api';
import testScript from './scripts/test.py?raw';
import calibScript from './scripts/calib.py?raw';
import angleMonitorScript from './scripts/angle_monitor.py?raw';

const scripts = {
  test: testScript,
  calib: calibScript,
};

let calibrationFinalState = null;
let lastFailState = null;
let lastFailReason = null;
let angleMonitorWanted = false;

const els = {
  overlay: document.getElementById('upload-overlay'),
  statusText: document.getElementById('upload-status-text'),
  progressText: document.getElementById('upload-progress-text'),
  connectionStatus: document.getElementById('connection-status'),
  stdOut: document.getElementById('std-out-output'),
  calibPanel: document.getElementById('calibration-panel'),
  calibTitle: document.getElementById('calibration-title'),
  calibContainer: document.getElementById('calibration-results-container'),
  btnConnect: document.getElementById('btn-connect'),
  btnDisconnect: document.getElementById('btn-disconnect'),
  btnTest: document.getElementById('btn-test'),
  btnCalib: document.getElementById('btn-calib'),
  btnStop: document.getElementById('btn-stop'),
  lblAngleDeg: document.getElementById('lbl-angle-deg'),
  lblAngleRaw: document.getElementById('lbl-angle-raw'),
};

function setBusy(busy) {
  els.btnConnect.disabled = busy;
  els.btnTest.disabled = busy;
  els.btnCalib.disabled = busy;
}

async function connectAndStream() {
  try {
    els.connectionStatus.textContent = 'Connecting...';
    els.connectionStatus.className = 'status-disconnected';
    await thymio.requestAndConnect();

    // Settle GATT before enabling notifications traffic
    setTimeout(async () => {
      try {
        await thymio.startBothSensorStreaming();
        console.log('Sensor streaming active. Write MTU =', thymio.getWriteMtu());
        // Live get_angle_raw() is not in the BLE sensor packet — run a tiny printer script.
        angleMonitorWanted = true;
        await startAngleMonitor({ quiet: true });
      } catch (err) {
        console.error('Failed to start sensor streaming / angle monitor', err);
      }
    }, 500);
  } catch (err) {
    console.error('Connection failed', err);
    els.connectionStatus.textContent = 'Connection Failed';
    els.connectionStatus.className = 'status-disconnected';
    alert(`Connection failed: ${err.message || err}`);
  }
}

async function startAngleMonitor({ quiet = false } = {}) {
  if (!thymio.isConnected() || !angleMonitorWanted) return;
  try {
    if (!quiet) {
      els.overlay.style.display = 'flex';
      els.statusText.textContent = 'Starting angle raw monitor...';
      els.progressText.textContent = '';
    }
    await thymio.sendPythonScript(angleMonitorScript);
    await thymio.executeLoadedScript();
  } catch (err) {
    console.warn('Angle monitor failed', err);
  } finally {
    try {
      await thymio.startBothSensorStreaming();
    } catch (err) {
      console.warn('Failed to restore sensor streaming after angle monitor', err);
    }
    if (!quiet) {
      els.overlay.style.display = 'none';
    }
  }
}

async function handleDisconnect() {
  try {
    await thymio.disconnect();
  } catch (err) {
    console.error('Disconnect failed', err);
  }
}

document.addEventListener('thymio-connected', () => {
  const deviceName = thymio.getDeviceName();
  els.connectionStatus.textContent = `Connected to ${deviceName}`;
  els.connectionStatus.className = 'status-connected';
  console.log('Thymio link active.');
});

document.addEventListener('thymio-disconnected', () => {
  els.connectionStatus.textContent = 'Disconnected';
  els.connectionStatus.className = 'status-disconnected';
  els.overlay.style.display = 'none';
  setBusy(false);
  console.warn('Thymio link lost.');
});

document.addEventListener('thymio-sensor-values', (event) => {
  const data = event.detail;
  if (data.proximitySensors) {
    const p = data.proximitySensors;
    document.getElementById('lbl-prox').textContent = [
      p.left, p.frontLeft, p.center, p.frontRight, p.right, p.backLeft, p.backRight,
    ].join(', ');
  }
  if (data.groundSensors) {
    const g = data.groundSensors;
    document.getElementById('lbl-ground').textContent = [g.left, g.right].join(', ');
  }
  if (data.accelerationRaw) {
    const acc = data.accelerationRaw;
    document.getElementById('lbl-accel').textContent = [acc.x, acc.y, acc.z].join(', ');
  }
  if (data.gyroRaw) {
    const g = data.gyroRaw;
    document.getElementById('lbl-gyro-rate').textContent = [g.x, g.y, g.z].join(', ');
  }
});

document.addEventListener('thymio-sensor-other-values', (event) => {
  const data = event.detail;
  if (data.colorRaw) {
    const c = data.colorRaw;
    document.getElementById('lbl-color').textContent =
      `${c.red}, ${c.green}, ${c.blue}, ${c.clear}`;
  }
  if (data.angleDegrees !== undefined && data.angleDegrees !== null) {
    els.lblAngleDeg.textContent = String(data.angleDegrees);
  }
});

document.addEventListener('thymio-python-upload-progress', (event) => {
  const { uploadedPackets, totalPackets, percentage } = event.detail;
  els.progressText.textContent =
    `Packet ${uploadedPackets}/${totalPackets} (${percentage.toFixed(0)}%) · MTU ${thymio.getWriteMtu()}`;
});

function applyAngleStdoutLine(key, value) {
  if (key === 'angle_raw') {
    els.lblAngleRaw.textContent = value;
    return true;
  }
  if (key === 'angle_deg') {
    // Prefer explicit get_angle_deg() from the robot when printed
    els.lblAngleDeg.textContent = value;
    return true;
  }
  return false;
}

function resetCalibrationPanel() {
  calibrationFinalState = null;
  lastFailState = null;
  lastFailReason = null;
  els.calibPanel.classList.remove('calibration-success', 'calibration-failure');
  els.calibTitle.textContent = 'Calibration Results';
  els.calibContainer.innerHTML = '<div class="placeholder">...</div>';
}

function showFailureReason(reason, failState) {
  if (els.calibContainer.innerHTML.includes('...')) {
    els.calibContainer.innerHTML = '';
  }
  let box = document.getElementById('row-failreason');
  if (!box) {
    box = document.createElement('div');
    box.id = 'row-failreason';
    box.className = 'calib-data fail-reason';
    els.calibContainer.prepend(box);
  }
  const stateNote = failState !== undefined && failState !== null && failState !== ''
    ? ` (state ${failState})`
    : '';
  box.innerHTML = `<span>Failure:</span> <strong>${reason}${stateNote}</strong>`;
}

function updateCalibrationStatus(stdoutText) {
  if (calibrationFinalState === 'success') return;

  if (stdoutText.includes('calibration completed successfully!')) {
    calibrationFinalState = 'success';
    els.calibPanel.classList.add('calibration-success');
    els.calibPanel.classList.remove('calibration-failure');
    els.calibTitle.textContent = 'Calibration Results - SUCCESS';
  } else if (stdoutText.includes('calibration timeout!') || lastFailReason) {
    calibrationFinalState = 'failure';
    els.calibPanel.classList.add('calibration-failure');
    els.calibTitle.textContent = 'Calibration Results - FAILED';
    if (lastFailReason) {
      showFailureReason(lastFailReason, lastFailState);
    }
  }
}

document.addEventListener('thymio-std-out-values', (event) => {
  const outputText = String(event.detail);
  const lines = outputText.split('\n');
  const logLines = [];

  for (const line of lines) {
    if (line.includes('=')) {
      const eqIndex = line.indexOf('=');
      const key = line.substring(0, eqIndex).trim();
      const value = line.substring(eqIndex + 1).trim();
      if (applyAngleStdoutLine(key, value)) {
        continue; // update Live Sensors only — do not flood the log
      }
    }
    logLines.push(line);
  }

  const logText = logLines.join('\n').trim();
  if (logText) {
    if (els.stdOut.textContent === 'Waiting for data...') {
      els.stdOut.textContent = '';
    }
    els.stdOut.textContent += logText + '\n';
    els.stdOut.scrollTop = els.stdOut.scrollHeight;
  }

  for (const line of lines) {
    if (!line.includes('=')) continue;

    if (els.calibContainer.innerHTML.includes('...')) {
      els.calibContainer.innerHTML = '';
    }

    const eqIndex = line.indexOf('=');
    const key = line.substring(0, eqIndex).trim();
    const value = line.substring(eqIndex + 1).trim();

    if (key === 'angle_raw' || key === 'angle_deg') {
      continue;
    }

    if (key === 'fail reason') {
      lastFailReason = value;
      showFailureReason(lastFailReason, lastFailState);
      continue;
    }
    if (key === 'fail state') {
      lastFailState = value;
      if (lastFailReason) {
        showFailureReason(lastFailReason, lastFailState);
      }
      continue;
    }

    const rowId = `row-${key.replace(/[^a-zA-Z0-9]/g, '')}`;

    let row = document.getElementById(rowId);
    if (!row) {
      row = document.createElement('div');
      row.id = rowId;
      row.className = 'calib-data';
      row.innerHTML = `<span>${key}:</span> <strong>${value}</strong>`;
      els.calibContainer.appendChild(row);
    } else {
      row.querySelector('strong').textContent = value;
    }
  }

  updateCalibrationStatus(outputText);
});

async function runScript(type) {
  if (!thymio.isConnected()) {
    alert('Connect to a Thymio 3 first.');
    return;
  }

  angleMonitorWanted = false;
  setBusy(true);
  els.overlay.style.display = 'flex';
  els.statusText.textContent = 'Uploading script to Thymio...';
  els.progressText.textContent = '';

  try {
    els.stdOut.textContent = 'Waiting for data...';
    if (type === 'calib') {
      resetCalibrationPanel();
    }

    const script = scripts[type];
    console.log(`Uploading ${type} script (${new TextEncoder().encode(script).length} bytes)`);

    await thymio.sendPythonScript(script);

    els.statusText.textContent = 'Starting execution...';
    els.progressText.textContent = '';
    await thymio.executeLoadedScript();
  } catch (err) {
    console.error('Upload/Execution failed', err);
    alert(`Failed to send script: ${err.message || err}`);
  } finally {
    try {
      await thymio.startBothSensorStreaming();
    } catch (err) {
      console.warn('Failed to restore sensor streaming', err);
    }
    els.overlay.style.display = 'none';
    setBusy(false);
  }
}

els.btnConnect.addEventListener('click', connectAndStream);
els.btnDisconnect.addEventListener('click', async () => {
  angleMonitorWanted = false;
  await handleDisconnect();
});
els.btnTest.addEventListener('click', () => runScript('test'));
els.btnCalib.addEventListener('click', () => runScript('calib'));
els.btnStop.addEventListener('click', async () => {
  try {
    await thymio.stopScriptExecution();
    angleMonitorWanted = true;
    await startAngleMonitor({ quiet: true });
  } catch (err) {
    console.error('Stop failed', err);
    alert(`Stop failed: ${err.message || err}`);
  }
});

if (!navigator.bluetooth) {
  alert('Web Bluetooth is not available. Use Chrome/Edge on localhost or HTTPS.');
}
