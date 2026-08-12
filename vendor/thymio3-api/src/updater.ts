import { getFirmwareInfo } from "./device-info";
import { uploadFirmware } from "./ota";

const FIRMWARE_VERSIONS_URL = "https://mobsya.github.io/thymio-3-firmware/versions.json";
const FIRMWARE_BASE_URL = 'https://mobsya.github.io/thymio-3-firmware/firmware/';

interface FirmwareVersion {
	version: string;
	file: string;
	releaseDate: string;
	description: string;
}

export async function fetchFirmwareVersions(): Promise<FirmwareVersion[]> {
	try {
		const response = await fetch(FIRMWARE_VERSIONS_URL);

		if (!response.ok) {
				throw new Error('Failed to fetch firmware versions');
		}

		const data = await response.json();
		return data.firmware_versions;
	} catch (error) {
		console.error('Error fetching firmware versions:', error);
		throw error;
	}
}

export async function isNewerFirmwareAvailable(
	deviceInfoCharacteristic: BluetoothRemoteGATTCharacteristic
): Promise<boolean> {
	const localVersion = (await getFirmwareInfo(deviceInfoCharacteristic)).esp32_ver;
	const latestRelease = await getLatestRelease();

	const remoteVersion = latestRelease.version;

	return isNewerVersion(remoteVersion, localVersion);
}

export async function getNewFirmware(
	deviceInfoCharacteristic: BluetoothRemoteGATTCharacteristic
): Promise<ArrayBuffer> {
	const localVersion = (await getFirmwareInfo(deviceInfoCharacteristic)).esp32_ver;
	const latestRelease = await getLatestRelease();

	if (isNewerVersion(latestRelease.version, localVersion)) {
		const firmwareURL = `${FIRMWARE_BASE_URL}${latestRelease.file}`

		return downloadFirmware(firmwareURL);
	} else {
		throw new Error(
			`The local version ${localVersion} is the same or newer than the latest firmware version ${latestRelease.version}`
		);
	}
}

export async function updateFirmware(
  deviceInfoCharacteristic: BluetoothRemoteGATTCharacteristic,
  otaCommandCharacteristic: BluetoothRemoteGATTCharacteristic,
  otaFirmwareCharacteristic: BluetoothRemoteGATTCharacteristic
): Promise<void> {
  const newFirmware = await getNewFirmware(deviceInfoCharacteristic);
  return await uploadFirmware(otaCommandCharacteristic, otaFirmwareCharacteristic, newFirmware);
}

async function downloadFirmware(url: string): Promise<ArrayBuffer> {
	const response = await fetch(url);

	if (!response.ok) throw new Error("Firmware download failed");

	return await response.arrayBuffer();
}

async function getLatestRelease() {
	const firmwareVersions = await fetchFirmwareVersions();

	const latestVersion = firmwareVersions.reduce((prev, current) => {
		const prevValue = prev.version.substring(1);
		const currentValue = prev.version.substring(1);

		return (prevValue && prevValue > currentValue) ? prev : current;
	});

	return latestVersion;
}

function isNewerVersion(remoteTagName: string, localVersion: number): boolean {
  // Remove the "v" character from the tag
  const remoteVersion = Number(remoteTagName.substring(1));
  return remoteVersion > localVersion;
}

/*
function isNewerVersion(remoteVersion: string, localVersion: string): boolean {
	const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);

	const [r, l] = [parse(remoteVersion), parse(localVersion)];

	for (let i = 0; i < r.length; i++) {
		if (r[i] > (l[i] || 0)) return true;

		if (r[i] < (l[i] || 0)) return false;
	}

	return false;
}
*/
