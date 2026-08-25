import * as thymio from '@local/thymio3-api';
import testScript from './scripts/test.py?raw';
import calibScript from './scripts/calib.py?raw';

const scripts = {
  test: testScript,
  calib: calibScript,
};

let calibrationFinalState = null;
let lastFailState = null;
let lastFailReason = null;

// Raw values shown in the Calibration Results panel, keyed by the stdout key.
let panelValues = {};

// Set once the robot has emitted the end of the report (or of a readback pass).
// Before that, a value that is not there yet is simply still on its way.
let calibReportComplete = false;

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
  btnCalib: document.getElementById('btn-calib'),
  btnStop: document.getElementById('btn-stop'),
  lblAngleDeg: document.getElementById('lbl-angle-deg'),
  btnTestFull: document.getElementById('btn-test-full'),
  btnTestMain: document.getElementById('btn-test-main'),
  btnTestLow: document.getElementById('btn-test-low'),
  btnTestTouch: document.getElementById('btn-test-touch'),
  btnLogCopy: document.getElementById('btn-log-copy'),
  btnLogClear: document.getElementById('btn-log-clear'),
  logStatus: document.getElementById('log-status'),
};

const TEST_MODES = ['full', 'main', 'low', 'touch'];

const LOG_PLACEHOLDER = 'Waiting for data...';

// ==========================================
// LIVE SENSOR READOUTS
// ==========================================

/**
 * Live readouts are rendered one channel per fixed width column so the numbers
 * never shift sideways while the stream updates: the operator can read them
 * without the whole row dancing at every packet.
 *
 *   elementId  readout container in index.html
 *   count      number of channels printed on the row
 *   width      column width in monospace characters, sign included
 *   checks     predicates the channel has to satisfy, each one at least once,
 *              to be considered proven. Every check latches: the operator can
 *              exercise the ends of the range one after the other and the
 *              channel turns green only once all of them have been seen.
 *   untracked  channel indexes excluded from the checks
 *
 * A channel with no checks is only formatted, never coloured.
 */
const LIVE_SENSORS = {
  prox: {
    elementId: 'lbl-prox',
    count: 7,
    width: 4,
    // Proven when the sensor both goes fully dark and saturates.
    checks: [(v) => v <= 0, (v) => v > 3500],
  },
  ground: {
    elementId: 'lbl-ground',
    count: 2,
    width: 4,
    checks: [(v) => v <= 10, (v) => v >= 300],
  },
  color: {
    elementId: 'lbl-color',
    count: 4,
    width: 5,
    checks: [(v) => v < 50, (v) => v > 180],
    untracked: [3], // clear channel: not part of the acceptance criteria
  },
  accel: {
    elementId: 'lbl-accel',
    count: 3,
    width: 6,
    // One axis at a time: all three green means every axis reached 1 g.
    checks: [(v) => Math.abs(v) >= 15900],
  },
  gyro: {
    elementId: 'lbl-gyro-rate',
    count: 3,
    width: 6,
  },
  angle: {
    elementId: 'lbl-angle-deg',
    count: 1,
    width: 4,
  },
};

// key -> per channel array of latched check results.
const liveSensorLatches = {};

function latchesFor(key, count) {
  const spec = LIVE_SENSORS[key];
  const checkCount = spec.checks ? spec.checks.length : 0;
  let latch = liveSensorLatches[key];

  if (!latch || latch.length !== count) {
    latch = Array.from({ length: count }, () => new Array(checkCount).fill(false));
    liveSensorLatches[key] = latch;
  }

  return latch;
}

/**
 * Reuse the channel spans instead of rebuilding the row: this runs on every
 * sensor packet, and replacing the nodes each time makes the text flicker.
 */
function channelSpans(el, count) {
  if (el.childElementCount !== count) {
    el.replaceChildren();
    for (let i = 0; i < count; i += 1) {
      if (i > 0) {
        el.appendChild(document.createTextNode(', '));
      }
      const span = document.createElement('span');
      span.className = 'ch';
      el.appendChild(span);
    }
  }
  return el.children;
}

function formatChannel(value) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function renderLiveSensor(key, values) {
  const spec = LIVE_SENSORS[key];
  if (!spec) return;

  const el = document.getElementById(spec.elementId);
  if (!el) return;

  const count = spec.count || values.length;
  const latch = latchesFor(key, count);
  const untracked = spec.untracked || [];
  const spans = channelSpans(el, count);

  el.style.setProperty('--ch-width', `${spec.width}ch`);

  for (let i = 0; i < count; i += 1) {
    const raw = values[i];
    const number = Number(raw);
    const tracked = Boolean(spec.checks) && !untracked.includes(i);

    if (tracked && Number.isFinite(number)) {
      spec.checks.forEach((check, c) => {
        if (check(number)) latch[i][c] = true;
      });
    }

    const passed = tracked && latch[i].every(Boolean);
    const text = formatChannel(raw);

    // Touch the DOM only on an actual change.
    if (spans[i].textContent !== text) spans[i].textContent = text;
    spans[i].classList.toggle('pass', passed);
  }
}

/**
 * Lay out the columns before any packet arrives, so the rows already have
 * their final width and the first update does not move anything.
 */
function initLiveSensors() {
  for (const [key, spec] of Object.entries(LIVE_SENSORS)) {
    renderLiveSensor(key, new Array(spec.count).fill(null));
  }
}

/**
 * Called when a new robot goes on the bench and at every script start: the
 * green marks belong to one run and must not be inherited by the next one.
 */
function resetLiveSensorPasses() {
  for (const key of Object.keys(liveSensorLatches)) {
    delete liveSensorLatches[key];
  }
  for (const spec of Object.values(LIVE_SENSORS)) {
    const el = document.getElementById(spec.elementId);
    if (!el) continue;
    for (const span of el.children) {
      span.classList.remove('pass');
    }
  }
}

// ==========================================
// CALIBRATION FIELD SCHEMA
// ==========================================

// color.get_calibration() returns both reference sets inside a single list.
// calib.py stores white first (state 0, calibrate_and_save_white) and black
// later (state 4, calibrate_and_save_black), so the printed list is assumed to
// be [white..., black...]. Set this to false if the firmware reports black first.
const COLOR_CALIB_WHITE_FIRST = true;

/**
 * Every calibration output the robot is expected to report, in display order.
 * The panel shows all of these labels up front and later only refreshes values.
 *
 *   key     stdout key printed by calib.py, verbatim
 *   label   text shown in the panel
 *   range   [min, max] applied to every number found in the printed value
 *   groups  used instead of range when one printed value carries several number
 *           groups with different limits; the numbers found are split evenly
 *           between the groups, in order
 *
 * A value outside its range does not fail the calibration: it turns the panel
 * orange (warning) and the offending number is highlighted for the operator.
 */
const CALIB_FIELDS = [
  { key: 'mot left', label: 'Motor left', range: [240, 270] },
  { key: 'mot right', label: 'Motor right', range: [240, 270] },
  { key: 'imu scaling', label: 'IMU scaling', range: [-1000, 1000] },
  { key: 'imu offsets', label: 'IMU offsets (X, Y, Z)', range: [-600, 600] },
  { key: 'mot forward', label: 'Motor forward', range: [7900000, 9100000] },
  { key: 'mot backward', label: 'Motor backward', range: [7900000, 9100000] },
  {
    key: 'color calib',
    label: COLOR_CALIB_WHITE_FIRST
      ? 'Color calib (white, then black)'
      : 'Color calib (black, then white)',
    groups: COLOR_CALIB_WHITE_FIRST
      ? [[100, 600], [0, 100]]
      : [[0, 100], [100, 600]],
  },
  { key: 'ground black', label: 'Ground black (L, R)', range: [0, 100] },
  { key: 'ground white', label: 'Ground white (L, R)', range: [200, 1000] },
];

const CALIB_FIELD_BY_KEY = new Map(CALIB_FIELDS.map((field) => [field.key, field]));

// ==========================================
// OUTPUT LOG
// ==========================================

function clearLog() {
  els.stdOut.textContent = LOG_PLACEHOLDER;
}

function appendLog(text) {
  if (els.stdOut.textContent === LOG_PLACEHOLDER) {
    els.stdOut.textContent = '';
  }
  els.stdOut.textContent += text + '\n';
  els.stdOut.scrollTop = els.stdOut.scrollHeight;
}

async function copyLog() {
  const text = els.stdOut.textContent;
  if (!text || text === LOG_PLACEHOLDER) return;

  const label = els.btnLogCopy.textContent;
  try {
    await navigator.clipboard.writeText(text);
    els.btnLogCopy.textContent = 'Copied';
  } catch (err) {
    console.error('Copy failed', err);
    els.btnLogCopy.textContent = 'Copy failed';
  }
  setTimeout(() => { els.btnLogCopy.textContent = label; }, 1200);
}

function buildScript(type, mode) {
  const source = scripts[type];
  return mode ? source.replace('__TEST_MODE__', mode) : source;
}

function setBusy(busy) {
  els.btnConnect.disabled = busy;
  els.btnTestFull.disabled = busy;
  els.btnTestMain.disabled = busy;
  els.btnTestLow.disabled = busy;
  els.btnTestTouch.disabled = busy;
  els.btnCalib.disabled = busy;
}

/**
 * Connect and Disconnect are mutually exclusive: only the action that applies
 * to the current state is offered, so the operator cannot click the wrong one.
 */
function setConnectionUi(connected, statusText) {
  els.btnConnect.hidden = connected;
  els.btnDisconnect.hidden = !connected;

  els.connectionStatus.textContent = statusText;
  els.connectionStatus.className = connected ? 'status-connected' : 'status-disconnected';
}

async function connectAndStream() {
  try {
    setConnectionUi(false, 'Connecting...');
    els.btnConnect.disabled = true;
    await thymio.requestAndConnect();

    // Settle GATT before enabling notifications traffic
    setTimeout(async () => {
      try {
        // Read the firmware version while the link is still idle: once sensor
        // streaming is running, the notification traffic makes this request
        // time out on macOS.
        await captureFirmwareInfo();

        await thymio.startBothSensorStreaming();
        console.log('Sensor streaming active. Write MTU =', thymio.getWriteMtu());
      } catch (err) {
        console.error('Failed to start sensor streaming', err);
      }
    }, 500);
  } catch (err) {
    console.error('Connection failed', err);
    setConnectionUi(false, 'Connection Failed');
    els.btnConnect.disabled = false;
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

document.addEventListener('thymio-connected', (event) => {
  // The API fires this event with detail false on disconnection too, so the
  // flag has to be honoured rather than assumed.
  if (event.detail === false) return;

  setConnectionUi(true, `Connected to ${thymio.getDeviceName()}`);
  els.btnConnect.disabled = false;
  // New robot on the bench: nothing has been proven on it yet.
  resetLiveSensorPasses();
  console.log('Thymio link active.');
});

document.addEventListener('thymio-disconnected', () => {
  setConnectionUi(false, 'Disconnected');
  els.overlay.style.display = 'none';
  setBusy(false);
  lastFirmwareInfo = null;
  readbackActive = false;
  // The last reading belongs to a robot that is no longer on the bench.
  batteryMillivolts = null;
  // Bumped before the session is closed, so that the record this very
  // disconnection may finalize is already stamped as belonging to a robot that
  // has left: it gets the attempt in flight and no retries.
  connectionGeneration++;
  resetLiveSensorPasses();
  renderNotices();
  abortCalibrationSession('Disconnected');
  console.warn('Thymio link lost.');
});

document.addEventListener('thymio-sensor-values', (event) => {
  const data = event.detail;
  if (data.proximitySensors) {
    const p = data.proximitySensors;
    renderLiveSensor('prox', [
      p.left, p.frontLeft, p.center, p.frontRight, p.right, p.backLeft, p.backRight,
    ]);
  }
  if (data.accelerationRaw) {
    const acc = data.accelerationRaw;
    renderLiveSensor('accel', [acc.x, acc.y, acc.z]);
  }
  if (data.gyroRaw) {
    const g = data.gyroRaw;
    renderLiveSensor('gyro', [g.x, g.y, g.z]);
  }
});

document.addEventListener('thymio-sensor-other-values', (event) => {
  const data = event.detail;
  // Ground uses the reflected values from the extended stream: they are the
  // ambient compensated readings, unlike groundSensors in the main packet.
  if (data.groundReflected) {
    const g = data.groundReflected;
    renderLiveSensor('ground', [g.left, g.right]);
  }
  if (data.colorRaw) {
    const c = data.colorRaw;
    renderLiveSensor('color', [c.red, c.green, c.blue, c.clear]);
  }
  if (data.angleDegrees !== undefined && data.angleDegrees !== null) {
    renderLiveSensor('angle', [data.angleDegrees]);
  }
  if (data.batteryVoltage !== undefined && data.batteryVoltage !== null) {
    noteBatteryReading(data.batteryVoltage);
  }
});

document.addEventListener('thymio-python-upload-progress', (event) => {
  const { uploadedPackets, totalPackets, percentage } = event.detail;
  els.progressText.textContent =
    `Packet ${uploadedPackets}/${totalPackets} (${percentage.toFixed(0)}%) · MTU ${thymio.getWriteMtu()}`;
});

function applyAngleStdoutLine(key, value) {
  if (key === 'angle_raw') {
    return true; // no readout for it: swallow so it does not flood the log
  }
  if (key === 'angle_deg') {
    // Prefer explicit get_angle_deg() from the robot when printed
    renderLiveSensor('angle', [value]);
    return true;
  }
  return false;
}

// ==========================================
// BATTERY MONITOR
// ==========================================

// Below this the calibration is not trustworthy: the motors lose torque and the
// distance and left/right runs come out short.
const BATTERY_LOW_MV = 3400;

// batteryVoltage arrives in the extended sensor packet (id 0x02) as a uint16
// already expressed in millivolts, see OtherSensorData in sensor-stream.ts.
let batteryMillivolts = null;

function noteBatteryReading(value) {
  const millivolts = Number(value);
  if (!Number.isFinite(millivolts) || millivolts <= 0) return;

  const wasLow = isBatteryLow();
  batteryMillivolts = Math.round(millivolts);

  // Repaint only when the verdict flips: this runs on every sensor packet.
  if (wasLow !== isBatteryLow()) {
    renderNotices();
  }
}

function isBatteryLow() {
  return batteryMillivolts !== null && batteryMillivolts < BATTERY_LOW_MV;
}

// ==========================================
// CALIBRATION PANEL
// ==========================================

const NUMBER_RE = /-?\d+(?:\.\d+)?/g;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function calibRowId(key) {
  return `row-${key.replace(/[^a-zA-Z0-9]/g, '')}`;
}

/**
 * Limits that apply to the number at position index inside a printed value.
 * Returns null when no check is possible, which leaves that number unflagged.
 */
function rangeForNumber(field, index, total) {
  if (field.groups) {
    // An unexpected number count means the groups cannot be told apart:
    // better no verdict at all than a wrong one.
    if (total === 0 || total % field.groups.length !== 0) return null;
    const perGroup = total / field.groups.length;
    return field.groups[Math.floor(index / perGroup)];
  }
  return field.range || null;
}

/**
 * Checks every number inside a printed value against the field limits and
 * rebuilds the value as HTML with the offending numbers wrapped for
 * highlighting. Multi axis or coupled values (imu offsets, ground, color) stay
 * on a single row: the operator reads which of the numbers is the bad one.
 */
function checkValue(field, rawValue) {
  const text = String(rawValue);
  const matches = Array.from(text.matchAll(NUMBER_RE));
  const total = matches.length;

  let html = '';
  let cursor = 0;
  const badNumbers = [];

  for (let i = 0; i < total; i++) {
    const match = matches[i];
    const limits = rangeForNumber(field, i, total);
    const number = Number(match[0]);
    const bad = limits !== null && (number < limits[0] || number > limits[1]);

    html += escapeHtml(text.slice(cursor, match.index));
    html += bad
      ? `<span class="bad">${escapeHtml(match[0])}</span>`
      : escapeHtml(match[0]);

    if (bad) badNumbers.push(match[0]);
    cursor = match.index + match[0].length;
  }

  html += escapeHtml(text.slice(cursor));

  return { html, badNumbers, outOfRange: badNumbers.length > 0 };
}

/**
 * Rebuilds the panel with one row per expected calibration, value placeholder
 * only. Called at startup and before every calibration run, so the operator
 * always sees the full list of what the robot is supposed to report.
 */
function resetCalibrationPanel() {
  calibrationFinalState = null;
  lastFailState = null;
  lastFailReason = null;
  panelValues = {};
  calibReportComplete = false;

  els.calibPanel.classList.remove(
    'calibration-success', 'calibration-failure', 'calibration-warning');
  els.calibTitle.textContent = 'Calibration Results';

  els.calibContainer.innerHTML = '<div id="calib-notices"></div>';

  for (const field of CALIB_FIELDS) {
    const row = document.createElement('div');
    row.id = calibRowId(field.key);
    row.className = 'calib-data pending';
    row.innerHTML = `<span>${escapeHtml(field.label)}:</span> <strong>&mdash;</strong>`;
    els.calibContainer.appendChild(row);
  }
}

/**
 * Fills in one value. Known keys land on their fixed row; anything else (a test
 * script printing key = value pairs) is appended at the bottom as before.
 */
function setCalibValue(key, value) {
  panelValues[key] = value;

  const field = CALIB_FIELD_BY_KEY.get(key);
  const rowId = calibRowId(key);
  let row = document.getElementById(rowId);

  if (!row) {
    row = document.createElement('div');
    row.id = rowId;
    row.className = 'calib-data';
    row.innerHTML = `<span>${escapeHtml(key)}:</span> <strong></strong>`;
    els.calibContainer.appendChild(row);
  }

  row.classList.remove('pending', 'missing');
  const strong = row.querySelector('strong');

  if (field) {
    const checked = checkValue(field, value);
    strong.innerHTML = checked.html;
    row.classList.toggle('out-of-range', checked.outOfRange);
  } else {
    strong.textContent = value;
  }
}

/**
 * A value carrying no number at all counts as missing: the robot sometimes
 * prints an empty container (ground white = []) instead of dropping the line.
 * A non global regex is used on purpose, NUMBER_RE carries a lastIndex.
 */
function containsNumber(text) {
  return /-?\d+(?:\.\d+)?/.test(String(text));
}

/**
 * Splits the expected fields into the ones outside their range and the ones
 * that never arrived. Missing values are always reported: the caller decides
 * whether it is too early to show them to the operator.
 */
function calibrationIssues() {
  const outOfRange = [];
  const missing = [];

  for (const field of CALIB_FIELDS) {
    const raw = panelValues[field.key];
    if (raw === undefined || !containsNumber(raw)) {
      missing.push(field);
      continue;
    }
    const checked = checkValue(field, raw);
    if (checked.outOfRange) {
      outOfRange.push({ field, numbers: checked.badNumbers });
    }
  }

  return { outOfRange, missing };
}

function noticeBox(className, title, body) {
  const box = document.createElement('div');
  box.className = `calib-data ${className}`;
  box.innerHTML = body
    ? `<span>${escapeHtml(title)}</span> <strong>${escapeHtml(body)}</strong>`
    : `<span>${escapeHtml(title)}</span>`;
  return box;
}

/**
 * Only two things are worth a banner here. Out of range and missing values are
 * not listed: the tinted row and the boxed number already say it, and a second
 * copy only pushed the rows down.
 */
/**
 * Only two things earn a banner: why the run failed, and a flat battery. Out of
 * range and missing values are not listed here, the tinted row and the boxed
 * number already say it and a second copy only pushed the rows down.
 */
function renderNotices() {
  const notices = document.getElementById('calib-notices');
  if (!notices) return;
  notices.innerHTML = '';

  if (lastFailReason) {
    const stateNote =
      lastFailState !== undefined && lastFailState !== null && lastFailState !== ''
        ? ` (state ${lastFailState})`
        : '';
    notices.appendChild(
      noticeBox('fail-reason', 'Failure:', lastFailReason + stateNote));
  }

  if (isBatteryLow()) {
    notices.appendChild(noticeBox('warn-reason', 'Battery low!'));
  }
}

/**
 * Paints the panel from the current state: red on a failed run, orange when the
 * run succeeded but one or more values are outside their expected range or were
 * never received, green only when everything is in range.
 */
function applyCalibrationVerdict() {
  const issues = calibrationIssues();
  const outOfRange = issues.outOfRange;
  const missing = calibReportComplete ? issues.missing : [];

  for (const field of CALIB_FIELDS) {
    const row = document.getElementById(calibRowId(field.key));
    if (!row) continue;
    row.classList.toggle('missing', missing.indexOf(field) !== -1);
  }

  renderNotices();

  els.calibPanel.classList.remove(
    'calibration-success', 'calibration-failure', 'calibration-warning');

  const hasWarning = outOfRange.length > 0 || missing.length > 0;

  if (calibrationFinalState === 'failure') {
    els.calibPanel.classList.add('calibration-failure');
    els.calibTitle.textContent = 'Calibration Results - FAILED';
  } else if (calibrationFinalState === 'success') {
    if (hasWarning) {
      els.calibPanel.classList.add('calibration-warning');
      els.calibTitle.textContent = 'Calibration Results - WARNING';
    } else {
      els.calibPanel.classList.add('calibration-success');
      els.calibTitle.textContent = 'Calibration Results - SUCCESS';
    }
  }
}

function updateCalibrationStatus(stdoutText) {
  if (stdoutText.includes(CALIB_REPORT_END) || stdoutText.includes(CALIB_READBACK_END)) {
    calibReportComplete = true;
  }

  if (stdoutText.includes('calibration completed successfully!')) {
    calibrationFinalState = 'success';
    markCalibrationResult('success');
  } else if (calibrationFinalState !== 'success') {
    // calib.py prints "calibration failed or timed out!"; a fail reason is the
    // other, earlier, indication that the run went wrong.
    const timedOut = stdoutText.includes('calibration timeout!') ||
                     stdoutText.includes('calibration failed or timed out!');
    if (timedOut || lastFailReason) {
      calibrationFinalState = 'failure';
      markCalibrationResult(timedOut && !lastFailReason ? 'timeout' : 'failed');
    }
  }

  applyCalibrationVerdict();
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
    appendLog(logText);
  }

  for (const line of lines) {
    if (!line.includes('=')) continue;

    const eqIndex = line.indexOf('=');
    const key = line.substring(0, eqIndex).trim();
    const value = line.substring(eqIndex + 1).trim();

    if (key === 'angle_raw' || key === 'angle_deg') {
      continue;
    }

    if (key === 'fail reason') {
      lastFailReason = value;
      continue;
    }
    if (key === 'fail state') {
      lastFailState = value;
      continue;
    }

    setCalibValue(key, value);
  }

  updateCalibrationStatus(outputText);
  feedCalibrationSession(outputText);
});

// ==========================================
// CALIBRATION LOGGING (Google Sheets)
// ==========================================

const CALIB_LOG = {
  // Relay endpoint (calib_log.php). The bench never talks to Google directly:
  // script.google.com is unreachable from some of the sites where calibration
  // runs, while the relay is not. The relay writes the record to its own CSV,
  // answers, and only then forwards it to the sheet with its own retries.
  url: 'PROCESSING_URL_HERE',
  // Must match API_TOKEN in calib_log.php.
  token: 'PROCESSING_TOKEN_HERE',
  // Abort for a single upload attempt.
  //
  // The relay answers as soon as the record is in its CSV and forwards to the
  // sheet afterwards, on a detached worker: measured end to end, that answer
  // comes back in under 0.2 s. This only ever has to cover the network, so it
  // is deliberately far above the observed figure and far below the relay's own
  // forwarding budget, which the bench never waits for.
  //
  // The one thing that would break the assumption is the relay moving to a SAPI
  // that cannot detach the worker; the arithmetic for that case is written down
  // next to UPSTREAM_ATTEMPTS in calib_log.php.
  timeoutMs: 4000,
  // Attempts per record, first try included. Replaying is safe: the record
  // carries the same run_id every time, and both the CSV and the sheet key
  // their deduplication on it. Also bound by the connection generation: a
  // disconnection cuts the loop short whatever this says.
  maxAttempts: 2,
  // Backoff between attempts, multiplied by the attempt number. Worst case for
  // the operator is maxAttempts * timeoutMs + retryDelayMs, so 9 s.
  retryDelayMs: 1000,
  // Fallback only: used when the script does not print the end marker (older
  // calib.py). It must exceed the longest flash write in the report block,
  // otherwise the record is sent while the robot is still stalled and the
  // remaining values are lost.
  quietPeriodMs: 6000,
  // Hard stop in case stdout never goes quiet.
  maxWaitMs: 25000,
  // Upper bound for the whole readback pass (upload + run + output).
  readbackMaxWaitMs: 30000,
  // Pause inserted between two readback prints. The lost values are a symptom
  // of a saturated stdout pipe, so the second attempt is deliberately slow.
  readbackLineDelayMs: 150,
};

// Printed by calib.py once the whole report has been emitted. Deterministic,
// unlike waiting for silence: a flash write looks exactly like a finished run.
const CALIB_REPORT_END = 'calibration report end';

// Same idea for the readback script built by buildReadbackScript(). A distinct
// marker keeps the two passes apart: the first one may trigger a readback, the
// second must always finalize.
const CALIB_READBACK_END = 'readback report end';

// Live sensor readouts, not calibration outputs: they must never reach the sheet.
const CALIB_LOG_IGNORED_KEYS = new Set(['angle_raw', 'angle_deg']);

let calibSession = null;
let lastFirmwareInfo = null;
let readbackActive = false;

// Bumped on every disconnection. An upload carries the generation of the robot
// it belongs to: once that robot has left the bench there is no point in
// holding the log status hostage to retries nobody is waiting for.
let connectionGeneration = 0;

/**
 * Best effort read of the firmware version. Never blocks the workflow: if the
 * robot does not answer, the record is logged without it.
 */
async function captureFirmwareInfo() {
  try {
    const info = await Promise.race([
      thymio.getFirmwareInfo(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);

    if (typeof info === 'string') {
      lastFirmwareInfo = info;
    } else if (info && (info.esp32_ver !== undefined || info.stm32_ver !== undefined)) {
      lastFirmwareInfo = `esp32:${info.esp32_ver} stm32:${info.stm32_ver}`;
    } else {
      lastFirmwareInfo = info ? JSON.stringify(info) : null;
    }
  } catch (err) {
    lastFirmwareInfo = null;
    console.warn('Firmware info unavailable:', err.message || err);
  }
}

function setLogStatus(text, cls) {
  if (!els.logStatus) return;
  els.logStatus.textContent = text;
  els.logStatus.className = 'log-status' + (cls ? ' ' + cls : '');
}

/**
 * Drops an unfinished session. Without this, timers armed by a previous run
 * would fire against the new session and log a half empty record.
 */
function discardCalibrationSession() {
  if (!calibSession) return;
  clearTimeout(calibSession.quietTimer);
  clearTimeout(calibSession.hardTimer);
  calibSession = null;
}

/**
 * Called when the operator stops the script or the robot disconnects.
 * A session that already carries a result holds complete data, so it is saved
 * rather than thrown away; anything earlier is an interrupted run and is dropped.
 */
function abortCalibrationSession(reason) {
  if (!calibSession) return;

  if (calibSession.result) {
    finalizeCalibrationSession();
    return;
  }

  discardCalibrationSession();
  setLogStatus(reason + ', nothing logged');
}

function startCalibrationSession() {
  discardCalibrationSession();
  calibSession = {
    robot: thymio.getDeviceName(),
    // Identity of this run, minted once and repeated on every retry. It is what
    // lets the relay and the sheet tell a retry apart from a second genuine
    // calibration of the same robot: two runs that happen to produce identical
    // values are still two rows, because they carry two different ids.
    runId: crypto.randomUUID(),
    // Pinned here rather than read at upload time: the record belongs to this
    // robot, and the retry policy has to follow the robot, not the clock.
    generation: connectionGeneration,
    values: {},
    result: null,
    quietTimer: null,
    hardTimer: null,
    // A readback is attempted at most once per run: if the values are still
    // missing afterwards, retrying again would only hold up the operator.
    readbackDone: false,
  };
  setLogStatus('Recording calibration...');
}

function feedCalibrationSession(outputText) {
  if (!calibSession) return;

  for (const line of outputText.split('\n')) {
    const eqIndex = line.indexOf('=');
    if (eqIndex > 0) {
      const key = line.substring(0, eqIndex).trim();
      const value = line.substring(eqIndex + 1).trim();
      if (key && !CALIB_LOG_IGNORED_KEYS.has(key)) {
        calibSession.values[key] = value;
      }
    }
  }

  // The readback pass is the last word: log whatever it produced.
  if (outputText.includes(CALIB_READBACK_END)) {
    finalizeCalibrationSession();
    return;
  }

  // The report is complete: settle now instead of guessing from silence.
  if (outputText.includes(CALIB_REPORT_END)) {
    settleCalibrationSession();
    return;
  }

  // Only start the countdown once the robot has declared an outcome.
  if (!calibSession.result) return;
  clearTimeout(calibSession.quietTimer);
  calibSession.quietTimer = setTimeout(settleCalibrationSession, CALIB_LOG.quietPeriodMs);
}

function markCalibrationResult(result) {
  if (!calibSession || calibSession.result) return;
  calibSession.result = result;
  calibSession.quietTimer = setTimeout(settleCalibrationSession, CALIB_LOG.quietPeriodMs);
  calibSession.hardTimer = setTimeout(finalizeCalibrationSession, CALIB_LOG.maxWaitMs);
}

/**
 * End of the first pass. Every now and then a report line never makes it to the
 * host (stdout pipe saturated by the flash writes and the sensor stream), which
 * used to leave both the panel and the sheet with holes. The values are already
 * stored inside the robot, so they are asked for again with a tiny second script
 * before anything is logged.
 */
function settleCalibrationSession() {
  if (!calibSession) return;

  const missing = calibrationIssues().missing;

  if (missing.length > 0 && !calibSession.readbackDone && thymio.isConnected()) {
    calibSession.readbackDone = true;
    clearTimeout(calibSession.quietTimer);
    clearTimeout(calibSession.hardTimer);
    calibSession.hardTimer = setTimeout(
      finalizeCalibrationSession, CALIB_LOG.readbackMaxWaitMs);

    setLogStatus('Missing values, reading back...');
    appendLog('[host] missing calibration values: ' +
      missing.map((field) => field.key).join(', '));

    runCalibrationReadback(missing.map((field) => field.key));
    return;
  }

  finalizeCalibrationSession();
}

function finalizeCalibrationSession() {
  if (!calibSession) return;

  const generation = calibSession.generation;

  const record = {
    run_id: calibSession.runId,
    robot: calibSession.robot,
    result: calibSession.result,
    fw_version: lastFirmwareInfo || '',
    // Last reading of the run. The sheet applies its own threshold, so a low
    // battery is flagged there even when nobody was watching the bench UI.
    battery_mv: batteryMillivolts === null ? '' : batteryMillivolts,
    values: calibSession.values,
  };

  discardCalibrationSession();
  restoreStreamingAfterReadback();
  sendCalibration(record, generation);
}

// ==========================================
// CALIBRATION READBACK
// ==========================================

const CALIB_READBACK_PREAMBLE = [
  'import thymio',
  'import time',
  'mot = thymio.MOTORS()',
  'imu = thymio.IMU()',
  'color = thymio.COLOR_SENSOR()',
  'g0 = thymio.GROUND(0)',
  'g1 = thymio.GROUND(1)',
];

/**
 * One MicroPython line per calibration output, printing the value already
 * stored in the robot with exactly the same key as calib.py, so the existing
 * stdout parser picks it up unchanged.
 *
 * Ground is the odd one out: the robot stores it per sensor as [black, white],
 * while calib.py reports it per colour as [left, right]. The two getters are
 * therefore transposed here to keep the printed keys identical.
 */
const CALIB_READBACK_SNIPPETS = {
  'mot left': 'print("mot left = " + str(mot.get_straight_calibration()[0]))',
  'mot right': 'print("mot right = " + str(mot.get_straight_calibration()[1]))',
  'imu scaling': 'print("imu scaling = " + str(imu.get_gyro_scale_calib()))',
  'imu offsets': 'print("imu offsets = " + str(imu.get_gyro_calib()))',
  'mot forward': 'print("mot forward = " + str(mot.get_distance_calibration()[0]))',
  'mot backward': 'print("mot backward = " + str(mot.get_distance_calibration()[1]))',
  'color calib': 'print("color calib = " + str(color.get_calibration()))',
  'ground black':
    'print("ground black = [" + str(g0.get_calibration()[0]) + ", " +' +
    ' str(g1.get_calibration()[0]) + "]")',
  'ground white':
    'print("ground white = [" + str(g0.get_calibration()[1]) + ", " +' +
    ' str(g1.get_calibration()[1]) + "]")',
};

/**
 * Builds a read_calib.py for the requested keys only. Every getter is guarded:
 * a firmware that does not expose one of them logs the reason and the remaining
 * values are still read back.
 */
function buildReadbackScript(keys) {
  const delay = (CALIB_LOG.readbackLineDelayMs / 1000).toFixed(2);
  const lines = ['# read_calib.py - generated by main.js']
    .concat(CALIB_READBACK_PREAMBLE);

  lines.push('time.sleep(0.5)');

  for (const key of keys) {
    const snippet = CALIB_READBACK_SNIPPETS[key];
    if (!snippet) continue;
    lines.push('try:');
    lines.push('    ' + snippet);
    lines.push('except Exception as e:');
    // No '=' in this line: the host would otherwise parse it as a value.
    lines.push(`    print("${key} readback failed: " + str(e))`);
    lines.push(`time.sleep(${delay})`);
  }

  lines.push(`print("${CALIB_READBACK_END}")`);
  return lines.join('\n') + '\n';
}

/**
 * Sensor streaming is deliberately left off for the whole readback: its
 * notification traffic is what starves the stdout pipe in the first place.
 * It is restored by restoreStreamingAfterReadback() once the pass is over.
 */
async function runCalibrationReadback(keys) {
  const script = buildReadbackScript(keys);

  readbackActive = true;
  setBusy(true);
  els.overlay.style.display = 'flex';
  els.statusText.textContent = 'Reading back missing calibration values...';
  els.progressText.textContent = '';

  try {
    try {
      await thymio.stopScriptExecution();
      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      console.warn('Stop before readback failed, continuing', err);
    }

    await thymio.sendPythonScript(script);
    await thymio.executeLoadedScript();
  } catch (err) {
    console.error('Calibration readback failed', err);
    appendLog('[host] readback could not be started: ' + (err.message || err));
    finalizeCalibrationSession();
  } finally {
    els.overlay.style.display = 'none';
    setBusy(false);
  }
}

function restoreStreamingAfterReadback() {
  if (!readbackActive) return;
  readbackActive = false;
  thymio.startBothSensorStreaming().catch((err) => {
    console.warn('Failed to restore sensor streaming after readback', err);
  });
}

/**
 * Posts one record. The body is JSON but declared as text/plain: any other
 * content type triggers a CORS preflight that the relay would have to answer.
 *
 * Success means the relay wrote the record to its CSV, not that the sheet has
 * it: the relay forwards to Google after answering, precisely so the operator
 * never waits on a latency nobody controls.
 */
async function postCalibration(record) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALIB_LOG.timeoutMs);

  try {
    const response = await fetch(CALIB_LOG.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: CALIB_LOG.token, record: record }),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error('HTTP ' + response.status);

    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'rejected by server');
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('timeout after ' + CALIB_LOG.timeoutMs + ' ms');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Uploads one record. The retry loop is bound to the connection generation the
 * record was captured under: when the robot leaves the bench, the attempt
 * already in flight is left to finish on its own, but no new one is started.
 * Without this, a robot that is long gone keeps rewriting the log status while
 * the operator is already calibrating the next one.
 *
 * Retries are safe: the record carries the same run_id every time, and both the
 * relay CSV and the sheet key their deduplication on it.
 */
async function sendCalibration(record, generation) {
  setLogStatus('Saving...');

  for (let attempt = 1; attempt <= CALIB_LOG.maxAttempts; attempt++) {
    try {
      await postCalibration(record);
      setLogStatus('Saved', 'ok');
      return;
    } catch (err) {
      console.error(`Calibration upload attempt ${attempt} failed`, err);

      if (generation !== connectionGeneration) {
        setLogStatus('NOT saved (robot disconnected)', 'error');
        return;
      }

      if (attempt < CALIB_LOG.maxAttempts) {
        await new Promise((r) => setTimeout(r, attempt * CALIB_LOG.retryDelayMs));
      }
    }
  }

  // All attempts spent without the relay ever answering. The record is lost:
  // the operator sees it and can recalibrate, which is cheaper than keeping a
  // queue nobody watches.
  setLogStatus('NOT saved', 'ok');
}

async function runScript(type, mode = null) {
  if (!thymio.isConnected()) {
    alert('Connect to a Thymio 3 first.');
    return;
  }

  setBusy(true);
  // Each run judges the sensors on its own: the previous green marks go away.
  resetLiveSensorPasses();
  els.overlay.style.display = 'flex';
  els.statusText.textContent = 'Stopping running script...';
  els.progressText.textContent = '';

  try {
    // The angle monitor started at connection time is an endless loop. A soft
    // reset does not terminate it, so executeLoadedScript() would be answered
    // with "another script was already running" and nothing would start.
    // 0x03 is the only opcode that actually stops a running script.
    try {
      await thymio.stopScriptExecution();
      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      console.warn('Stop before upload failed, continuing', err);
    }

    els.statusText.textContent = 'Uploading script to Thymio...';
    els.stdOut.textContent = LOG_PLACEHOLDER;

    // A test run must not be absorbed by a calibration session left open.
    if (type !== 'calib') {
      discardCalibrationSession();
    } else {
      resetCalibrationPanel();
      startCalibrationSession();
    }

    const script = buildScript(type, mode);
    console.log(`Uploading ${type}${mode ? '/' + mode : ''} script ` +
              `(${new TextEncoder().encode(script).length} bytes)`);

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
els.btnTestFull.addEventListener('click', () => runScript('test', 'full'));
els.btnTestMain.addEventListener('click', () => runScript('test', 'main'));
els.btnTestLow.addEventListener('click', () => runScript('test', 'low'));
els.btnTestTouch.addEventListener('click', () => runScript('test', 'touch'));
els.btnCalib.addEventListener('click', () => runScript('calib'));
els.btnStop.addEventListener('click', async () => {
  try {
    readbackActive = false;
    abortCalibrationSession('Stopped');
    await thymio.stopScriptExecution();
    await thymio.startBothSensorStreaming();
  } catch (err) {
    console.error('Stop failed', err);
    alert(`Stop failed: ${err.message || err}`);
  }
});
els.btnLogCopy.addEventListener('click', copyLog);
els.btnLogClear.addEventListener('click', clearLog);

// Optional control: clears the green marks without restarting the test. Wired
// only when index.html provides the button.
const btnSensorsReset = document.getElementById('btn-sensors-reset');
if (btnSensorsReset) {
  btnSensorsReset.addEventListener('click', resetLiveSensorPasses);
}

// Initial UI state: nothing connected yet, panel already lists what is expected.
setConnectionUi(false, 'Disconnected');
initLiveSensors();
resetCalibrationPanel();

if (!navigator.bluetooth) {
  alert('Web Bluetooth is not available. Use Chrome/Edge on localhost or HTTPS.');
}
