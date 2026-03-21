'use strict'

/**
 * @typedef {import('./types').MimeTypeResult} MimeTypeResult
 */

var util = require('util');
var path = require('path');
var os = require('os');
var fs = require('fs').promises;
var fsSync = require('fs');
var child_process = require('child_process');
var { exec } = require('child_process');
var Request = require('./request');

/** @type {NodeJS.Platform} */
const platform = os.platform();
/** @type {number} */
const FONT_DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;
/** @type {number} */
const FONT_SNIFF_BYTES = 8192;

if (platform === 'win32') {
	var PowerShell = require('node-powershell');
}

/**
 * System font operations - download, save, and install fonts
 * @class
 */
function SystemFont() {}

/**
 * Download a font file to a temporary location
 * @param {string} remoteFile - URL of the font file to download
 * @param {string} fileName - Base name for the saved file (without extension)
 * @returns {Promise<string>} Path to the downloaded temporary file
 * @throws {Error} If download fails or file is corrupted
 */
SystemFont.prototype._saveTmp = async function(remoteFile, fileName) {
	if (!remoteFile) {
		throw new Error('Nothing to download');
	}

	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'gfcli-'));
	const remoteExt = this._getRemoteExtension(remoteFile);
	const filePath = path.join(folder, fileName + remoteExt);
	const localFile = fsSync.createWriteStream(filePath);
	const download = new Request(remoteFile, {
		responseType: 'stream',
		maxBytes: FONT_DOWNLOAD_MAX_BYTES,
		sniffBytes: FONT_SNIFF_BYTES
	});
	
	return new Promise((resolve, reject) => {
		const cleanup = async () => {
			try {
				await fs.rm(folder, { recursive: true, force: true });
			} catch (e) {}
		};

		// @ts-ignore - Request inherits from PassThrough which has EventEmitter
		download.on('error', async (error) => {
			localFile.destroy();
			await cleanup();
			reject(error);
		})
			.pipe(localFile)
			.on('finish', async () => {
				const mimeType = download.getMimeType();
				const ext = path.parse(filePath).ext.toLowerCase();
				
				const isValidFont = this._isValidFontFile(mimeType, ext);
				
				if (isValidFont) {
					resolve(filePath);
				} else {
					try {
						await cleanup();
					} catch (e) {}
					reject(new Error('Downloaded file is not a supported font.'));
				}
			})
			.on('error', async (/** @type {Error} */ error) => {
				await cleanup();
				reject(error);
			});
	});
};

/**
 * Move a file from one location to another
 * @param {string} oldPath - Current file path
 * @param {string | false} destFolder - Destination folder path (false for CWD)
 * @returns {Promise<string>} New file path after move
 * @throws {Error} If move operation fails
 */
SystemFont.prototype._move = async function(oldPath, destFolder) {
	const folder = await this._checkDestFolder(destFolder);
	const fileName = path.basename(oldPath).trim() || 'font.ttf';
	const newPath = path.join(folder, fileName);
	const sourceDir = path.dirname(oldPath);
	
	try {
		await fs.rename(oldPath, newPath);
		try {
			await fs.rm(sourceDir, { recursive: true, force: true });
		} catch (cleanupErr) {}
		return newPath;
	} catch (err) {
		const error = new Error('Something went wrong writing the file.');
		// Preserve original error information for debugging
		error.cause = err;
		throw error;
	}
};

/**
 * Validate and resolve the destination folder path
 * @param {string | null | undefined | false} [destFolder] - Destination folder or null for CWD
 * @returns {Promise<string>} Resolved absolute folder path
 * @throws {Error} If destFolder is not a string when provided
 */
SystemFont.prototype._checkDestFolder = async function(destFolder) {
	if (destFolder === null || destFolder === undefined || !destFolder) {
		destFolder = process.cwd() || os.homedir();
	} else if (typeof destFolder !== 'string') {
		throw new Error('Destination folder for font must be a string');
	}
	const absFolder = path.resolve(destFolder);
	await this._isFolderOk(absFolder);
	return absFolder;
};

/**
 * Ensure a folder exists, creating it if necessary
 * @param {string} folder - Folder path to check/create
 * @returns {Promise<void>}
 * @throws {Error} If folder cannot be created
 */
SystemFont.prototype._isFolderOk = async function(folder) {
	try {
		await fs.mkdir(folder, { recursive: true });
	} catch (err) {
		if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'EEXIST') {
			throw new Error('Error while creating folder ' + folder + ': ' + err);
		}
	}
};

/**
 * Download and save a font file to a specified folder
 * @param {string} remoteFile - URL of the font file
 * @param {string | false} destFolder - Destination folder path
 * @param {string} fileName - Base name for the saved file
 * @returns {Promise<string>} Path to the saved file
 */
SystemFont.prototype.saveAt = async function(remoteFile, destFolder, fileName) {
	const tmpPath = await this._saveTmp(remoteFile, fileName);
	// @ts-ignore - destFolder can be false, which _move handles
	return await this._move(tmpPath, destFolder);
};

/**
 * Download and save a font file to the current working directory
 * @param {string} remoteFile - URL of the font file
 * @param {string} fileName - Base name for the saved file
 * @returns {Promise<string>} Path to the saved file
 */
SystemFont.prototype.saveHere = async function(remoteFile, fileName) {
	// @ts-ignore - false is handled by _checkDestFolder
	return await this.saveAt(remoteFile, false, fileName);
};

/**
 * Download and install a font to the system font folder
 * @param {string} remoteFile - URL of the font file
 * @param {string} fileName - Base name for the font file
 * @returns {Promise<string>} Installation result message or path
 * @throws {Error} If platform is not supported
 */
SystemFont.prototype.install = async function(remoteFile, fileName) {
	switch (platform) {
		case 'linux':
			const xdgDataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
			const linuxDestFolder = path.join(xdgDataHome, 'fonts');
			const result = await this.saveAt(remoteFile, linuxDestFolder, fileName);
			try {
				await util.promisify(exec)('fc-cache -f');
			} catch (err) {
				// fc-cache might not be available or fail, but the font is already saved
			}
			return result;
			
		case 'darwin':
			const darwinDestFolder = path.join(os.homedir(), 'Library', 'Fonts/');
			return await this.saveAt(remoteFile, darwinDestFolder, fileName);
			
		case 'win32':
			const tmpPath = await this._saveTmp(remoteFile, fileName);
			const ver = os.release().split('.');
			let majorVer = 0;

			if (ver.length >= 1) {
				majorVer = parseInt(ver[0], 10);
			}
			
			if (majorVer >= 6) {
				const ps = new PowerShell({
					executionPolicy: 'Bypass',
					noProfile: true
				});

				ps.addCommand('$fonts = (New-Object -ComObject Shell.Application).Namespace(0x14)');
				ps.addCommand(`Get-ChildItem -Path "${tmpPath}" -Recurse -include *.ttf | % { $fonts.CopyHere($_.fullname) }`);
				
				try {
					await ps.invoke();
					ps.dispose();
					return 'Font System Folder with Powershell.';
				} catch (err) {
					ps.dispose();
					throw err;
				}
			} else {
				return new Promise((resolve, reject) => {
					child_process.execFile(
						'cscript.exe',
						[path.join(__dirname, 'windows', 'installFont.js'), tmpPath],
						(err, stdout, stderr) => {
							if (err) reject(err);
							else resolve('Font System Folder with cscript.');
						}
					);
				});
			}
			
		default:
			throw new Error('Platform not supported.');
	}
};

/**
 * Get a supported extension from the remote URL.
 * @param {string} remoteFile
 * @returns {string}
 */
SystemFont.prototype._getRemoteExtension = function(remoteFile) {
	const ext = path.parse(new URL(remoteFile).pathname).ext.toLowerCase();
	return (ext === '.ttf' || ext === '.woff2') ? ext : '.ttf';
};

/**
 * Validate a downloaded file based on MIME and extension.
 * @param {MimeTypeResult | undefined} mimeType
 * @param {string} ext
 * @returns {boolean}
 */
SystemFont.prototype._isValidFontFile = function(mimeType, ext) {
	const isValidExtension = ext === '.ttf' || ext === '.woff2';
	if (mimeType) {
		if (mimeType.mime === 'application/font-sfnt' && ext === '.ttf') return true;
		if (mimeType.mime === 'font/woff2' && ext === '.woff2') return true;
		return false;
	}

	return isValidExtension;
};

module.exports = new SystemFont();
