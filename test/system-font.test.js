'use strict';

const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const EventEmitter = require('events').EventEmitter;
const proxyquire = require('proxyquire');

const RequestMock = vi.hoisted(() => vi.fn());

const systemFont = proxyquire('../lib/system-font', {
	'./request': RequestMock
});

describe('SystemFont', () => {
	let mockRequest;
	let writeStream;

	beforeEach(() => {
		writeStream = new EventEmitter();
		writeStream.end = vi.fn();
		writeStream.destroy = vi.fn();

		mockRequest = new EventEmitter();
		mockRequest.getMimeType = vi.fn().mockReturnValue({ mime: 'application/font-sfnt' });
		mockRequest.pipe = vi.fn().mockReturnValue(writeStream);

		RequestMock.mockImplementation(function MockRequest() {
			return mockRequest;
		});
		RequestMock.mockClear();

		vi.spyOn(fsPromises, 'mkdtemp').mockResolvedValue('/tmp/gfcli-12345');
		vi.spyOn(fsPromises, 'mkdir').mockResolvedValue(undefined);
		vi.spyOn(fsPromises, 'rename').mockResolvedValue(undefined);
		vi.spyOn(fsPromises, 'rm').mockResolvedValue(undefined);
		vi.spyOn(fsPromises, 'unlink').mockResolvedValue(undefined);
		vi.spyOn(fs, 'createWriteStream').mockReturnValue(writeStream);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('exports a SystemFont instance', () => {
		expect(systemFont).toBeDefined();
		expect(typeof systemFont.install).toBe('function');
		expect(typeof systemFont.saveAt).toBe('function');
		expect(typeof systemFont.saveHere).toBe('function');
	});

	it('_checkDestFolder resolves absolute paths', async () => {
		const result = await systemFont._checkDestFolder('./fonts');
		expect(path.isAbsolute(result)).toBe(true);
	});

	it('_checkDestFolder rejects non-string destinations', async () => {
		await expect(systemFont._checkDestFolder(123)).rejects.toThrow('Destination folder for font must be a string');
	});

	it('_saveTmp rejects empty remoteFile', async () => {
		await expect(systemFont._saveTmp('', 'TestFont')).rejects.toThrow('Nothing to download');
	});

	it('_saveTmp creates a unique temp directory and configures a secure Request', async () => {
		const savePromise = systemFont._saveTmp('https://example.com/font.ttf', 'TestFont');
		await new Promise((resolve) => setImmediate(resolve));
		writeStream.emit('finish');
		const result = await savePromise;

		expect(fsPromises.mkdtemp).toHaveBeenCalledWith(path.join(require('os').tmpdir(), 'gfcli-'));
		expect(fs.createWriteStream).toHaveBeenCalledWith('/tmp/gfcli-12345/TestFont.ttf');
		expect(RequestMock).toHaveBeenCalledWith('https://example.com/font.ttf', {
			responseType: 'stream',
			maxBytes: 50 * 1024 * 1024,
			sniffBytes: 8192
		});
		expect(result).toBe('/tmp/gfcli-12345/TestFont.ttf');
	});

	it('_saveTmp accepts extension fallback when MIME is unavailable', async () => {
		mockRequest.getMimeType.mockReturnValue(undefined);

		const savePromise = systemFont._saveTmp('https://example.com/font.woff2', 'TestFont');
		await new Promise((resolve) => setImmediate(resolve));
		writeStream.emit('finish');

		await expect(savePromise).resolves.toBe('/tmp/gfcli-12345/TestFont.woff2');
	});

	it('_saveTmp rejects MIME and extension mismatches and cleans up', async () => {
		mockRequest.getMimeType.mockReturnValue({ mime: 'font/woff2' });

		const savePromise = systemFont._saveTmp('https://example.com/font.ttf', 'TestFont');
		await new Promise((resolve) => setImmediate(resolve));
		writeStream.emit('finish');

		await expect(savePromise).rejects.toThrow('Downloaded file is not a supported font.');
		expect(fsPromises.rm).toHaveBeenCalledWith('/tmp/gfcli-12345', { recursive: true, force: true });
	});

	it('_saveTmp cleans up on request errors', async () => {
		const savePromise = systemFont._saveTmp('https://example.com/font.ttf', 'TestFont');
		await new Promise((resolve) => setImmediate(resolve));
		mockRequest.emit('error', new Error('boom'));

		await expect(savePromise).rejects.toThrow('boom');
		expect(writeStream.destroy).toHaveBeenCalled();
		expect(fsPromises.rm).toHaveBeenCalledWith('/tmp/gfcli-12345', { recursive: true, force: true });
	});

	it('saveHere delegates to saveAt with false destination', async () => {
		const saveAtSpy = vi.spyOn(systemFont, 'saveAt').mockResolvedValue('/tmp/font.ttf');
		await systemFont.saveHere('https://example.com/font.ttf', 'TestFont');
		expect(saveAtSpy).toHaveBeenCalledWith('https://example.com/font.ttf', false, 'TestFont');
	});

	it('_move moves the file and cleans up the temp directory', async () => {
		const result = await systemFont._move('/tmp/gfcli-12345/TestFont.ttf', '/tmp/dest');
		expect(fsPromises.rename).toHaveBeenCalledWith('/tmp/gfcli-12345/TestFont.ttf', '/tmp/dest/TestFont.ttf');
		expect(fsPromises.rm).toHaveBeenCalledWith('/tmp/gfcli-12345', { recursive: true, force: true });
		expect(result).toBe('/tmp/dest/TestFont.ttf');
	});

	it('_move surfaces rename failures', async () => {
		fsPromises.rename.mockRejectedValueOnce(new Error('Rename failed'));
		await expect(systemFont._move('/tmp/gfcli-12345/TestFont.ttf', '/tmp/dest')).rejects.toThrow('Something went wrong writing the file.');
	});

	it('_isValidFontFile enforces MIME and extension rules', () => {
		expect(systemFont._isValidFontFile({ mime: 'application/font-sfnt' }, '.ttf')).toBe(true);
		expect(systemFont._isValidFontFile({ mime: 'font/woff2' }, '.woff2')).toBe(true);
		expect(systemFont._isValidFontFile({ mime: 'font/woff2' }, '.ttf')).toBe(false);
		expect(systemFont._isValidFontFile(undefined, '.ttf')).toBe(true);
		expect(systemFont._isValidFontFile(undefined, '.pdf')).toBe(false);
	});
});
