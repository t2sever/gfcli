'use strict'

var fs = require('fs');
var os = require('os');
var path = require('path');
var Request = require('./request');

const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_DIR = path.join(os.homedir(), '.gfcli');
const UPDATE_CACHE_FILE = path.join(CACHE_DIR, 'update-check.json');

/**
 * @typedef {object} UpdateInfo
 * @property {string} currentVersion
 * @property {string} latestVersion
 * @property {boolean} updateAvailable
 */

/**
 * @typedef {object} UpdateCachePayload
 * @property {number} checkedAt
 * @property {string} latestVersion
 */

/**
 * Compare two semver-like versions.
 * @param {string} currentVersion
 * @param {string} latestVersion
 * @returns {boolean}
 */
function isUpdateAvailable(currentVersion, latestVersion) {
	var current = parseVersion(currentVersion);
	var latest = parseVersion(latestVersion);

	for (var i = 0; i < 3; i++) {
		if (latest[i] > current[i]) return true;
		if (latest[i] < current[i]) return false;
	}

	return false;
}

/**
 * @param {string} version
 * @returns {[number, number, number]}
 */
function parseVersion(version) {
	var cleanVersion = String(version || '').replace(/^v/, '').split('-')[0];
	var parts = cleanVersion.split('.').map(function(part) {
		var parsed = Number.parseInt(part, 10);
		return Number.isNaN(parsed) ? 0 : parsed;
	});

	return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * @param {string} packageName
 * @returns {string}
 */
function getRegistryUrl(packageName) {
	return 'https://registry.npmjs.org/' + encodeURIComponent(packageName).replace(/%40/gi, '@');
}

/**
 * @returns {Promise<UpdateCachePayload | null>}
 */
async function readUpdateCache() {
	try {
		var content = await fs.promises.readFile(UPDATE_CACHE_FILE, 'utf8');
		var parsed = JSON.parse(content);

		if (!parsed || typeof parsed.checkedAt !== 'number' || typeof parsed.latestVersion !== 'string') {
			return null;
		}

		if (Date.now() - parsed.checkedAt > UPDATE_CHECK_TTL_MS) {
			return null;
		}

		return parsed;
	} catch (err) {
		return null;
	}
}

/**
 * @param {string} latestVersion
 * @returns {Promise<void>}
 */
async function writeUpdateCache(latestVersion) {
	try {
		await fs.promises.mkdir(CACHE_DIR, { recursive: true });
		await fs.promises.writeFile(
			UPDATE_CACHE_FILE,
			JSON.stringify({ checkedAt: Date.now(), latestVersion: latestVersion }),
			'utf8'
		);
	} catch (err) {
		// Update checks are best-effort and should never interrupt CLI usage.
	}
}

/**
 * @param {string} packageName
 * @returns {Promise<string>}
 */
function fetchLatestVersion(packageName) {
	return new Promise(function(resolve, reject) {
		var request = /** @type {import('./types').RequestInstance} */ (/** @type {unknown} */ (new Request(getRegistryUrl(packageName), {
			responseType: 'text',
			maxBytes: 1024 * 1024
		})));

		request.on('success', function(/** @type {string} */ payload) {
			try {
				var parsed = JSON.parse(payload);
				var latest = parsed && parsed['dist-tags'] && parsed['dist-tags'].latest;

				if (typeof latest !== 'string') {
					return reject(new Error('Registry response did not include a latest version.'));
				}

				resolve(latest);
			} catch (err) {
				reject(err);
			}
		});

		request.on('error', reject);
	});
}

/**
 * @param {string} packageName
 * @param {string} currentVersion
 * @returns {Promise<UpdateInfo | null>}
 */
async function checkForUpdate(packageName, currentVersion) {
	var cached = await readUpdateCache();
	var latestVersion = cached ? cached.latestVersion : await fetchLatestVersion(packageName);

	if (!cached) {
		await writeUpdateCache(latestVersion);
	}

	return {
		currentVersion: currentVersion,
		latestVersion: latestVersion,
		updateAvailable: isUpdateAvailable(currentVersion, latestVersion)
	};
}

module.exports = {
	checkForUpdate,
	fetchLatestVersion,
	getRegistryUrl,
	isUpdateAvailable,
	parseVersion,
	readUpdateCache,
	writeUpdateCache,
	UPDATE_CACHE_FILE,
	UPDATE_CHECK_TTL_MS
};
