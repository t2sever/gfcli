'use strict';

const EventEmitter = require('events').EventEmitter;
const proxyquire = require('proxyquire');

const RequestMock = vi.hoisted(() => vi.fn());
const systemFontMock = vi.hoisted(() => ({
	install: vi.fn(),
	saveAt: vi.fn()
}));
const toPascalCaseMock = vi.hoisted(() =>
	vi.fn(async (value) =>
		value
			.replace(/[^a-z0-9]+/gi, ' ')
			.trim()
			.split(/\s+/)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join('')
	)
);

const GoogleFont = proxyquire('../lib/google-font', {
	'./request': RequestMock,
	'./system-font': systemFontMock,
	'./case': { toPascalCase: toPascalCaseMock }
});

describe('GoogleFont', () => {
	let pendingRequests;

	beforeEach(() => {
		pendingRequests = [];
		RequestMock.mockImplementation(function MockRequest() {
			const emitter = new EventEmitter();
			pendingRequests.push(emitter);
			return emitter;
		});
		RequestMock.mockClear();
		systemFontMock.install.mockClear();
		systemFontMock.saveAt.mockClear();
		toPascalCaseMock.mockClear();
	});

	describe('constructor and getters', () => {
		it('creates an instance with expected properties', () => {
			const font = new GoogleFont({
				family: 'Roboto',
				category: 'sans-serif',
				variants: ['regular', 'italic', '700']
			});

			expect(font.family).toBe('Roboto');
			expect(font.category).toBe('sans-serif');
			expect(font.getVariants()).toEqual(['regular', 'italic', '700']);
			expect(font.apiUrl).toBe('https://gwfh.mranftl.com/api/fonts/roboto');
		});

		it('works without new', () => {
			expect(GoogleFont({ family: 'Open Sans' })).toBeInstanceOf(GoogleFont);
		});

		it('returns the family and CSS URL', () => {
			const font = new GoogleFont({ family: 'Open Sans' });
			expect(font.getFamily()).toBe('Open Sans');
			expect(font.getCssUrl()).toBe('https://fonts.googleapis.com/css?family=Open+Sans');
		});

		it('normalizes variants', () => {
			const font = new GoogleFont({ family: 'Inter' });
			expect(font._normalizeVariant('400')).toBe('regular');
			expect(font._normalizeVariant('400italic')).toBe('italic');
			expect(font._normalizeVariant('700')).toBe('700');
		});
	});

	describe('_getFileMapAsync', () => {
		it('uses the hardened Request helper and parses TTF URLs', async () => {
			const font = new GoogleFont({ family: 'Roboto' });
			const promise = font._getFileMapAsync('ttf');

			expect(RequestMock).toHaveBeenCalledWith('https://gwfh.mranftl.com/api/fonts/roboto', {
				responseType: 'text',
				maxBytes: 5 * 1024 * 1024
			});

			pendingRequests[0].emit('success', JSON.stringify({
				variants: [
					{ id: 'regular', ttf: 'https://cdn.example.com/roboto-regular.ttf', woff2: 'https://cdn.example.com/roboto-regular.woff2' },
					{ id: '700', ttf: 'https://cdn.example.com/roboto-700.ttf' }
				]
			}));

			await expect(promise).resolves.toEqual({
				regular: 'https://cdn.example.com/roboto-regular.ttf',
				'700': 'https://cdn.example.com/roboto-700.ttf'
			});
		});

		it('parses WOFF2 URLs', async () => {
			const font = new GoogleFont({ family: 'Roboto' });
			const promise = font._getFileMapAsync('woff2');

			pendingRequests[0].emit('success', JSON.stringify({
				variants: [
					{ id: 'regular', ttf: 'https://cdn.example.com/roboto-regular.ttf', woff2: 'https://cdn.example.com/roboto-regular.woff2' }
				]
			}));

			await expect(promise).resolves.toEqual({
				regular: 'https://cdn.example.com/roboto-regular.woff2'
			});
		});

		it('fails on invalid JSON', async () => {
			const font = new GoogleFont({ family: 'Roboto' });
			const promise = font._getFileMapAsync('ttf');

			pendingRequests[0].emit('success', 'not-json');

			await expect(promise).rejects.toThrow('Failed to parse GWFH JSON response');
		});

		it('fails when variants is missing or not an array', async () => {
			const font = new GoogleFont({ family: 'Roboto' });
			const promise = font._getFileMapAsync('ttf');

			pendingRequests[0].emit('success', JSON.stringify({}));

			await expect(promise).rejects.toThrow('Invalid GWFH response: expected variants array');
		});

		it('propagates request errors', async () => {
			const font = new GoogleFont({ family: 'Roboto' });
			const promise = font._getFileMapAsync('ttf');

			pendingRequests[0].emit('error', new Error('boom'));

			await expect(promise).rejects.toThrow('boom');
		});
	});

	describe('filename generation and save/install flows', () => {
		it('uses PascalCase filenames for installAsync', async () => {
			const font = new GoogleFont({ family: 'Open Sans' });
			systemFontMock.install.mockResolvedValue('/fonts/OpenSans-regular.ttf');

			const promise = font.installAsync(['regular']);
			pendingRequests[0].emit('success', JSON.stringify({
				variants: [{ id: 'regular', ttf: 'https://cdn.example.com/open-sans-regular.ttf' }]
			}));

			await expect(promise).resolves.toEqual([
				{ family: 'Open Sans', variant: 'regular', path: '/fonts/OpenSans-regular.ttf' }
			]);
			expect(toPascalCaseMock).toHaveBeenCalledWith('Open Sans');
			expect(systemFontMock.install).toHaveBeenCalledWith('https://cdn.example.com/open-sans-regular.ttf', 'OpenSans-regular');
		});

		it('uses PascalCase filenames for saveAtAsync', async () => {
			const font = new GoogleFont({ family: 'Roboto Mono' });
			systemFontMock.saveAt.mockResolvedValue('/fonts/RobotoMono-regular.woff2');

			const promise = font.saveAtAsync(['regular'], '/fonts', 'woff2');
			pendingRequests[0].emit('success', JSON.stringify({
				variants: [{ id: 'regular', woff2: 'https://cdn.example.com/roboto-mono-regular.woff2' }]
			}));

			await expect(promise).resolves.toEqual([
				{ family: 'Roboto Mono', variant: 'regular', path: '/fonts/RobotoMono-regular.woff2' }
			]);
			expect(toPascalCaseMock).toHaveBeenCalledWith('Roboto Mono');
			expect(systemFontMock.saveAt).toHaveBeenCalledWith('https://cdn.example.com/roboto-mono-regular.woff2', '/fonts', 'RobotoMono-regular');
		});

		it('preserves readable output for punctuation-heavy names', async () => {
			const font = new GoogleFont({ family: 'Noto Sans JP' });
			systemFontMock.saveAt.mockResolvedValue('/fonts/NotoSansJP-regular.ttf');

			const promise = font.saveAtAsync(['regular'], '/fonts', 'ttf');
			pendingRequests[0].emit('success', JSON.stringify({
				variants: [{ id: 'regular', ttf: 'https://cdn.example.com/noto-sans-jp-regular.ttf' }]
			}));

			await promise;
			expect(systemFontMock.saveAt).toHaveBeenCalledWith('https://cdn.example.com/noto-sans-jp-regular.ttf', '/fonts', 'NotoSansJP-regular');
		});

		it('collects partial save results and throws AggregateError for failures', async () => {
			const font = new GoogleFont({ family: 'Inter' });
			systemFontMock.saveAt
				.mockResolvedValueOnce('/fonts/Inter-regular.ttf')
				.mockRejectedValueOnce(new Error('disk full'));

			const promise = font.saveAtAsync(['regular', '700'], '/fonts', 'ttf');
			pendingRequests[0].emit('success', JSON.stringify({
				variants: [
					{ id: 'regular', ttf: 'https://cdn.example.com/inter-regular.ttf' },
					{ id: '700', ttf: 'https://cdn.example.com/inter-700.ttf' }
				]
			}));

			await expect(promise).rejects.toMatchObject({
				message: 'Failed to save 1 variant(s)',
				results: [{ family: 'Inter', variant: 'regular', path: '/fonts/Inter-regular.ttf' }]
			});
		});
	});

	describe('callback wrappers', () => {
		it('supports install callback style', () => {
			const font = new GoogleFont({ family: 'Roboto' });
			font.installAsync = vi.fn().mockResolvedValue([]);

			expect(() => font.install(['regular'], () => {})).not.toThrow();
		});

		it('supports saveAt callback style', () => {
			const font = new GoogleFont({ family: 'Roboto' });
			font.saveAtAsync = vi.fn().mockResolvedValue([]);

			expect(() => font.saveAt(['regular'], '/tmp', 'ttf', () => {})).not.toThrow();
			expect(() => font.saveAt(['regular'], '/tmp', () => {})).not.toThrow();
		});
	});
});
