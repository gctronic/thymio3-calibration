import * as thymio from '@local/thymio3-api';
import testScript from './scripts/test.py?raw';
import calibScript from './scripts/calib.py?raw';

const scripts = {
  test: testScript,
  calib: calibScript,
};

let calibrationFinalState = null;

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
      } catch (err) {
        console.error('Failed to start sensor streaming', err);
      }
    }, 500);
  } catch (err) {
    console.error('Connection failed', err);
    els.connectionStatus.textContent = 'Connection Failed';
    els.connectionStatus.className = 'status-disconnected';
    alert(`Connection failed: ${err.message || err}`);
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
});

document.addEventListener('thymio-sensor-other-values', (event) => {
  const data = event.detail;
  if (data.colorRaw) {
    const c = data.colorRaw;
    document.getElementById('lbl-color').textContent =
      `${c.red}, ${c.green}, ${c.blue}, ${c.clear}`;
  }
});

document.addEventListener('thymio-python-upload-progress', (event) => {
  const { uploadedPackets, totalPackets, percentage } = event.detail;
  els.progressText.textContent =
    `Packet ${uploadedPackets}/${totalPackets} (${percentage.toFixed(0)}%) · MTU ${thymio.getWriteMtu()}`;
});

function resetCalibrationPanel() {
  calibrationFinalState = null;
  els.calibPanel.classList.remove('calibration-success', 'calibration-failure');
  els.calibTitle.textContent = 'Calibration Results';
  els.calibContainer.innerHTML = '<div class="placeholder">...</div>';
}

function updateCalibrationStatus(stdoutText) {
  if (calibrationFinalState !== null) return;

  if (stdoutText.includes('calibration completed successfully!')) {
    calibrationFinalState = 'success';
    els.calibPanel.classList.add('calibration-success');
    els.calibTitle.textContent = 'Calibration Results - SUCCESS';
  } else if (stdoutText.includes('calibration timeout!')) {
    calibrationFinalState = 'failure';
    els.calibPanel.classList.add('calibration-failure');
    els.calibTitle.textContent = 'Calibration Results - FAILED';
  }
}

document.addEventListener('thymio-std-out-values', (event) => {
  const outputText = String(event.detail);

  if (els.stdOut.textContent === 'Waiting for data...') {
    els.stdOut.textContent = '';
  }

  els.stdOut.textContent += outputText + (outputText.endsWith('\n') ? '' : '\n');
  els.stdOut.scrollTop = els.stdOut.scrollHeight;

  for (const line of outputText.split('\n')) {
    if (!line.includes('=')) continue;

    if (els.calibContainer.innerHTML.includes('...')) {
      els.calibContainer.innerHTML = '';
    }

    const eqIndex = line.indexOf('=');
    const key = line.substring(0, eqIndex).trim();
    const value = line.substring(eqIndex + 1).trim();
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
els.btnDisconnect.addEventListener('click', handleDisconnect);
els.btnTest.addEventListener('click', () => runScript('test'));
els.btnCalib.addEventListener('click', () => runScript('calib'));
els.btnStop.addEventListener('click', async () => {
  try {
    await thymio.stopScriptExecution();
  } catch (err) {
    console.error('Stop failed', err);
    alert(`Stop failed: ${err.message || err}`);
  }
});

if (!navigator.bluetooth) {
  alert('Web Bluetooth is not available. Use Chrome/Edge on localhost or HTTPS.');
}
