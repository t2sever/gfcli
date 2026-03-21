'use strict';

const EventEmitter = require('events').EventEmitter;
const https = require('https');

jest.mock('https');

const Request = require('../lib/request');

describe('Request', () => {
	let mockResponse;
	let mockRequest;

	beforeEach(() => {
		jest.clearAllMocks();

		mockResponse = new EventEmitter();
		mockResponse.statusCode = 200;
		mockResponse.headers = {};
		mockResponse.resume = jest.fn();
		mockResponse.destroy = jest.fn();

		mockRequest = new EventEmitter();
		mockRequest.setTimeout = jest.fn();
		mockRequest.destroy = jest.fn();

		https.get.mockImplementation((url, callback) => {
			setImmediate(() => callback(mockResponse));
			return mockRequest;
		});
	});

	it('creates instances with or without new', () => {
		expect(new Request('https://example.com')).toBeInstanceOf(Request);
		expect(Request('https://example.com')).toBeInstanceOf(Request);
	});

	it('emits error for invalid URLs', (done) => {
		const request = new Request('not-a-valid-url');

		request.on('error', (err) => {
			expect(err.message).toContain('invalid url');
			done();
		});
	});

	it('rejects non-https URLs', (done) => {
		const request = new Request('http://example.com');

		request.on('error', (err) => {
			expect(err.message).toContain('invalid url');
			done();
		});
	});

	it('emits success with text payload in text mode', (done) => {
		const request = new Request('https://example.com', { responseType: 'text', maxBytes: 1024 });
		const chunks = [];

		request.on('data', (chunk) => chunks.push(chunk));
		request.on('success', (data) => {
			expect(data).toBe('hello world');
			expect(chunks).toHaveLength(0);
			done();
		});

		setImmediate(() => {
			mockResponse.emit('data', Buffer.from('hello '));
			mockResponse.emit('data', Buffer.from('world'));
			mockResponse.emit('end');
		});
	});

	it('streams data through in stream mode', (done) => {
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
			done();
		});

		setImmediate(() => {
			mockResponse.emit('data', Buffer.from('font-data'));
			mockResponse.emit('end');
		});
	});

	it('follows https redirects', (done) => {
		const redirectResponse = new EventEmitter();
		redirectResponse.statusCode = 301;
		redirectResponse.headers = { location: 'https://cdn.example.com/font.ttf' };
		redirectResponse.resume = jest.fn();

		const finalResponse = new EventEmitter();
		finalResponse.statusCode = 200;
		finalResponse.headers = {};
		finalResponse.resume = jest.fn();

		let callCount = 0;
		https.get.mockImplementation((url, callback) => {
			callCount += 1;
			setImmediate(() => callback(callCount === 1 ? redirectResponse : finalResponse));
			return mockRequest;
		});

		const request = new Request('https://example.com/font.ttf');
		request.on('success', (data) => {
			expect(callCount).toBe(2);
			expect(redirectResponse.resume).toHaveBeenCalled();
			expect(data).toBe('final');
			done();
		});

		setTimeout(() => {
			finalResponse.emit('data', Buffer.from('final'));
			finalResponse.emit('end');
		}, 20);
	});

	it('rejects redirects to non-https targets', (done) => {
		const redirectResponse = new EventEmitter();
		redirectResponse.statusCode = 302;
		redirectResponse.headers = { location: 'http://insecure.example.com/font.ttf' };
		redirectResponse.resume = jest.fn();

		const request = new Request('https://example.com/font.ttf');

		request.on('error', (err) => {
			expect(err.message).toBe('Redirect target must use HTTPS.');
			done();
		});

		request.handleResponse(redirectResponse, 'https://example.com/font.ttf');
	});

	it('errors when redirect limit is exceeded', (done) => {
		const redirectResponse = new EventEmitter();
		redirectResponse.statusCode = 301;
		redirectResponse.headers = { location: 'https://cdn.example.com/font.ttf' };
		redirectResponse.resume = jest.fn();

		const request = new Request('https://example.com/font.ttf');
		request.redirect = 0;

		request.on('error', (err) => {
			expect(err.message).toBe('Too many redirects.');
			done();
		});

		request.handleResponse(redirectResponse, 'https://example.com/font.ttf');
	});

	it('enforces max response size in text mode', (done) => {
		const request = new Request('https://example.com', { responseType: 'text', maxBytes: 4 });

		request.on('error', (err) => {
			setImmediate(() => {
				expect(err.message).toBe('Response exceeded maximum allowed size.');
				expect(mockResponse.destroy).toHaveBeenCalled();
				expect(mockRequest.destroy).toHaveBeenCalled();
				done();
			});
		});

		setImmediate(() => {
			mockResponse.emit('data', Buffer.from('toolarge'));
		});
	});

	it('enforces max response size in stream mode', (done) => {
		const request = new Request('https://example.com/font.ttf', { responseType: 'stream', maxBytes: 4 });

		request.on('error', (err) => {
			setImmediate(() => {
				expect(err.message).toBe('Response exceeded maximum allowed size.');
				expect(mockResponse.destroy).toHaveBeenCalled();
				expect(mockRequest.destroy).toHaveBeenCalled();
				done();
			});
		});

		setImmediate(() => {
			mockResponse.emit('data', Buffer.from('toolarge'));
		});
	});

	it('adds timeout handling once and destroys the request', (done) => {
		const request = new Request('https://example.com');
		const timeoutHandler = mockRequest.setTimeout.mock.calls[0][1];
		const errorSpy = jest.fn();

		request.on('error', errorSpy);
		request.on('error', (err) => {
			setImmediate(() => {
				expect(err.message).toBe('Request timeout.');
				expect(mockRequest.destroy).toHaveBeenCalled();
				expect(errorSpy).toHaveBeenCalledTimes(1);
				done();
			});
		});

		timeoutHandler();
		timeoutHandler();
	});

	it('wraps connection failures', (done) => {
		const request = new Request('https://example.com');

		request.on('error', (err) => {
			expect(err.message).toContain('Connection to example.com failed');
			done();
		});

		setImmediate(() => {
			mockRequest.emit('error', new Error('Connection refused'));
		});
	});
});
