'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs').promises;

const Request = require('../lib/request');
const UpdateNotifier = require('../lib/update-notifier');

describe('Update notifier', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('exports update cache constants', () => {
		expect(UpdateNotifier.UPDATE_CACHE_FILE).toBe(path.join(os.homedir(), '.gfcli', 'update-check.json'));
		expect(UpdateNotifier.UPDATE_CHECK_TTL_MS).toBe(24 * 60 * 60 * 1000);
	});

	it('detects newer semver versions', () => {
		expect(UpdateNotifier.isUpdateAvailable('3.1.1', '3.1.2')).toBe(true);
		expect(UpdateNotifier.isUpdateAvailable('3.1.1', '3.2.0')).toBe(true);
		expect(UpdateNotifier.isUpdateAvailable('3.1.1', '4.0.0')).toBe(true);
		expect(UpdateNotifier.isUpdateAvailable('3.1.1', '3.1.1')).toBe(false);
		expect(UpdateNotifier.isUpdateAvailable('3.1.1', '3.1.0')).toBe(false);
	});

	it('builds npm registry URLs safely', () => {
		expect(UpdateNotifier.getRegistryUrl('google-font-cli')).toBe('https://registry.npmjs.org/google-font-cli');
		expect(UpdateNotifier.getRegistryUrl('@scope/pkg')).toBe('https://registry.npmjs.org/@scope%2Fpkg');
	});

	it('returns cached update data when fresh', async () => {
		vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify({
			checkedAt: Date.now(),
			latestVersion: '3.2.0'
		}));

		const result = await UpdateNotifier.readUpdateCache();

		expect(result.latestVersion).toBe('3.2.0');
	});

	it('ignores expired update cache data', async () => {
		vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify({
			checkedAt: Date.now() - (25 * 60 * 60 * 1000),
			latestVersion: '3.2.0'
		}));

		const result = await UpdateNotifier.readUpdateCache();

		expect(result).toBeNull();
	});

	it('writes update cache data without throwing', async () => {
		const mkdirSpy = vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
		const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

		await UpdateNotifier.writeUpdateCache('3.2.0');

		expect(mkdirSpy).toHaveBeenCalledWith(path.join(os.homedir(), '.gfcli'), { recursive: true });
		expect(writeFileSpy).toHaveBeenCalledWith(
			UpdateNotifier.UPDATE_CACHE_FILE,
			expect.stringContaining('"latestVersion":"3.2.0"'),
			'utf8'
		);
	});

	it('fetches the latest version from the npm registry response', async () => {
		vi.spyOn(Request.prototype, 'init').mockImplementation(function() {});

		const promise = UpdateNotifier.fetchLatestVersion('google-font-cli');
		const request = Request.prototype.init.mock.instances[0];

		setImmediate(() => {
			request.emit('success', JSON.stringify({ 'dist-tags': { latest: '3.2.0' } }));
		});

		await expect(promise).resolves.toBe('3.2.0');
	});

	it('uses cached latest version while checking for updates', async () => {
		vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify({
			checkedAt: Date.now(),
			latestVersion: '3.2.0'
		}));

		const result = await UpdateNotifier.checkForUpdate('google-font-cli', '3.1.1');

		expect(result).toEqual({
			currentVersion: '3.1.1',
			latestVersion: '3.2.0',
			updateAvailable: true
		});
	});
});
