'use strict';

const EventEmitter = require('events').EventEmitter;
const https = require('https');

const Request = require('../lib/request');

describe('Request', () => {
	let mockResponse;
	let mockRequest;

	beforeEach(() => {
		vi.clearAllMocks();

		mockResponse = new EventEmitter();
		mockResponse.statusCode = 200;
		mockResponse.headers = {};
		mockResponse.resume = vi.fn();
		mockResponse.destroy = vi.fn();

		mockRequest = new EventEmitter();
		mockRequest.setTimeout = vi.fn();
		mockRequest.destroy = vi.fn();

		vi.spyOn(https, 'get').mockImplementation((url, callback) => {
			setImmediate(() => callback(mockResponse));
			return mockRequest;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('creates instances with or without new', () => {
		expect(new Request('https://example.com')).toBeInstanceOf(Request);
		expect(Request('https://example.com')).toBeInstanceOf(Request);
	});

	it('emits error for invalid URLs', async () => {
		await new Promise((resolve) => {
			const request = new Request('not-a-valid-url');

			request.on('error', (err) => {
				expect(err.message).toContain('invalid url');
				resolve();
			});
		});
	});

	it('rejects non-https URLs', async () => {
		await new Promise((resolve) => {
			const request = new Request('http://example.com');

			request.on('error', (err) => {
				expect(err.message).toContain('invalid url');
				resolve();
			});
		});
	});

	it('emits success with text payload in text mode', async () => {
		await new Promise((resolve) => {
			const request = new Request('https://example.com', { responseType: 'text', maxBytes: 1024 });
			const chunks = [];

			request.on('data', (chunk) => chunks.push(chunk));
			request.on('success', (data) => {
				expect(data).toBe('hello world');
				expect(chunks).toHaveLength(0);
				resolve();
			});

			setImmediate(() => {
				mockResponse.emit('data', Buffer.from('hello '));
				mockResponse.emit('data', Buffer.from('world'));
				mockResponse.emit('end');
			});
		});
	});

	it('streams data through in stream mode', async () => {
		await new Promise((resolve) => {
			const request = new Request('https://example.com/font.ttf', {
				responseType: 'stream',
				maxBytes: 1024,
				sniffBytes: 32
			});
			const chunks = [];

			request.on('data', (chunk) => chunks.push(chunk));
			request.on('success', (data) => {
				expect(data).toBe('');
				expect(Buffer.concat(chunks).toString('utf8')).toBe('font-data');
				resolve();
			});

			setImmediate(() => {
				mockResponse.emit('data', Buffer.from('font-data'));
				mockResponse.emit('end');
			});
		});
	});

	it('follows https redirects', async () => {
		await new Promise((resolve) => {
			const redirectResponse = new EventEmitter();
			redirectResponse.statusCode = 301;
			redirectResponse.headers = { location: 'https://cdn.example.com/font.ttf' };
			redirectResponse.resume = vi.fn();

			const finalResponse = new EventEmitter();
			finalResponse.statusCode = 200;
			finalResponse.headers = {};
			finalResponse.resume = vi.fn();

			let callCount = 0;
			vi.mocked(https.get).mockImplementation((url, callback) => {
				callCount += 1;
				setImmediate(() => callback(callCount === 1 ? redirectResponse : finalResponse));
				return mockRequest;
			});

			const request = new Request('https://example.com/font.ttf');
			request.on('success', (data) => {
				expect(callCount).toBe(2);
				expect(redirectResponse.resume).toHaveBeenCalled();
				expect(data).toBe('final');
				resolve();
			});

			setTimeout(() => {
				finalResponse.emit('data', Buffer.from('final'));
				finalResponse.emit('end');
			}, 20);
		});
	});

	it('rejects redirects to non-https targets', async () => {
		await new Promise((resolve) => {
			const redirectResponse = new EventEmitter();
			redirectResponse.statusCode = 302;
			redirectResponse.headers = { location: 'http://insecure.example.com/font.ttf' };
			redirectResponse.resume = vi.fn();

			const request = new Request('https://example.com/font.ttf');

			request.on('error', (err) => {
				expect(err.message).toBe('Redirect target must use HTTPS.');
				resolve();
			});

			request.handleResponse(redirectResponse, 'https://example.com/font.ttf');
		});
	});

	it('errors when redirect limit is exceeded', async () => {
		await new Promise((resolve) => {
			const redirectResponse = new EventEmitter();
			redirectResponse.statusCode = 301;
			redirectResponse.headers = { location: 'https://cdn.example.com/font.ttf' };
			redirectResponse.resume = vi.fn();

			const request = new Request('https://example.com/font.ttf');
			request.redirect = 0;

			request.on('error', (err) => {
				expect(err.message).toBe('Too many redirects.');
				resolve();
			});

			request.handleResponse(redirectResponse, 'https://example.com/font.ttf');
		});
	});

	it('enforces max response size in text mode', async () => {
		await new Promise((resolve) => {
			const request = new Request('https://example.com', { responseType: 'text', maxBytes: 4 });

			request.on('error', (err) => {
				setImmediate(() => {
					expect(err.message).toBe('Response exceeded maximum allowed size.');
					expect(mockResponse.destroy).toHaveBeenCalled();
					expect(mockRequest.destroy).toHaveBeenCalled();
					resolve();
				});
			});

			setImmediate(() => {
				mockResponse.emit('data', Buffer.from('toolarge'));
			});
		});
	});

	it('enforces max response size in stream mode', async () => {
		await new Promise((resolve) => {
			const request = new Request('https://example.com/font.ttf', { responseType: 'stream', maxBytes: 4 });

			request.on('error', (err) => {
				setImmediate(() => {
					expect(err.message).toBe('Response exceeded maximum allowed size.');
					expect(mockResponse.destroy).toHaveBeenCalled();
					expect(mockRequest.destroy).toHaveBeenCalled();
					resolve();
				});
			});

			setImmediate(() => {
				mockResponse.emit('data', Buffer.from('toolarge'));
			});
		});
	});

	it('adds timeout handling once and destroys the request', async () => {
		await new Promise((resolve) => {
			const request = new Request('https://example.com');
			const timeoutHandler = mockRequest.setTimeout.mock.calls[0][1];
			const errorSpy = vi.fn();

			request.on('error', errorSpy);
			request.on('error', (err) => {
				setImmediate(() => {
					expect(err.message).toBe('Request timeout.');
					expect(mockRequest.destroy).toHaveBeenCalled();
					expect(errorSpy).toHaveBeenCalledTimes(1);
					resolve();
				});
			});

			timeoutHandler();
			timeoutHandler();
		});
	});

	it('wraps connection failures', async () => {
		await new Promise((resolve) => {
			const request = new Request('https://example.com');

			request.on('error', (err) => {
				expect(err.message).toContain('Connection to example.com failed');
				resolve();
			});

			setImmediate(() => {
				mockRequest.emit('error', new Error('Connection refused'));
			});
		});
	});
});
