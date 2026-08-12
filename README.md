# Thymio 3 Calibration App

Local production test/calibration tool for Thymio 3, with a patched Web Bluetooth upload path that fixes:

`Failed to send script: GATT operation failed for unknown reason.`

Based on the production page from [Mobsya/thymio3-ts-api](https://github.com/Mobsya/thymio3-ts-api/tree/production), with a vendored/patched API under `vendor/thymio3-api/`.

## Fixes vs upstream

- Default write MTU **182** (instead of 500), connect-time probe, and MTU halving fallback
- Sensor streaming paused during script upload
- Soft-reset before upload
- GATT write retries with backoff
- Wait for robot Python load acknowledgement before execute
- Packet upload progress in the UI
- Ground calibration API compatible with firmware **1.8.4** (`set_calibration_all` / `save_calibration`)

## Requirements

- Chrome or Edge (Web Bluetooth)
- Node.js 18+
- A Thymio 3 nearby

## Run

```bash
npm install
npm run dev
```

Open **http://localhost:5173**, connect to the robot, then run **Start Test** or **Start Calibration**.

## Layout

```
src/main.js              # UI + upload flow
src/scripts/test.py      # production test script
src/scripts/calib.py     # production calibration script
vendor/thymio3-api/      # patched Thymio 3 TS API
```

## Notes

- Prefer Chrome. Safari does not support Web Bluetooth.
- Keep the robot close during script upload.
- Color calibration is saved during the run; ground / motors / gyro / distance are saved at the end only if their values left the “not calibrated” defaults. Timeouts abort remaining steps.
