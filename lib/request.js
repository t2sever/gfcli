'use strict'

/**
 * @typedef {import('./types').MimeTypeResult} MimeTypeResult
 * @typedef {import('http').IncomingMessage} IncomingMessage
 * @typedef {import('./types').RequestOptions} RequestOptions
 */

var https = require('https');
var StreamPass = require('stream').PassThrough;
var util = require('util');

const DEFAULT_TEXT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_STREAM_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_SNIFF_BYTES = 8192;

/**
 * Handle API requests (extends EventEmitter via PassThrough)
 * @constructor
 * @param {string} uri - URL to fetch
 * @param {RequestOptions} [options] - Request behavior options
 * @fires Request#success
 * @fires Request#error
 */
function Request(uri, options) {
	if (!(this instanceof Request))
		return new Request(uri, options);

	StreamPass.call(this);
	/** @type {number} */
	this.redirect = 3; // Allow up to 3 redirects
	/** @type {MimeTypeResult | undefined} */
	this._mimeType = undefined;
	/** @type {import('http').ClientRequest | undefined} */
	this.req = undefined;
	/** @type {boolean | MimeTypeResult} */
	this.mimeType = false;
	/** @type {IncomingMessage | undefined} */
	this.res = undefined;
	/** @type {boolean} */
	this._finished = false;
	/** @type {RequestOptions & { responseType: 'text' | 'stream', maxBytes: number, sniffBytes: number }} */
	this.options = {
		responseType: options && options.responseType ? options.responseType : 'text',
		maxBytes: options && options.maxBytes ? options.maxBytes : ((options && options.responseType === 'stream') ? DEFAULT_STREAM_MAX_BYTES : DEFAULT_TEXT_MAX_BYTES),
		sniffBytes: options && options.sniffBytes ? options.sniffBytes : DEFAULT_SNIFF_BYTES
	};
	this.init(uri);
}

util.inherits(Request, StreamPass);

/**
 * Initialize the HTTP(S) request
 * @param {string} uri - URL to fetch
 * @returns {void}
 */
Request.prototype.init = function(uri) {
	var self = this;

	self.mimeType = false;
	try {
		var parsedUri = this._validateHttpsUrl(uri);
		var req = this.req = https.get(parsedUri, function(res) {
			self.handleResponse(res, parsedUri.toString());
		});

		req.setTimeout(10000, function(){
			self._fail(new Error('Request timeout.'));
			req.destroy();
		});

		req.on('error', function(e){
			if (self._finished) return;
			var errorMessage = util.format('Connection to %s failed: %s', parsedUri.hostname, e.message);
			self._fail(new Error(errorMessage));
		});
	} catch (e) {
		setImmediate(function(){
			self.handleError(new Error(uri + ' is an invalid url.'));
		});
	}
}

/**
 * Validate that a URL is HTTPS.
 * @param {string} uri
 * @returns {URL}
 */
Request.prototype._validateHttpsUrl = function(uri) {
	var parsedUri = new URL(uri);

	if (!parsedUri.protocol || parsedUri.hostname === '' || parsedUri.protocol !== 'https:') {
		throw new Error('Invalid URL');
	}

	return parsedUri;
}

/**
 * Handle the HTTP response
 * @param {IncomingMessage} res - HTTP response object
 * @param {string} originalUri - Original request URL (for redirect resolution)
 * @returns {void}
 */
Request.prototype.handleResponse = function(res, originalUri) {
	var self = this;
	self.res = res;

	if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode)) {
		if (res.headers.location && self.redirect > 0) {
			self.redirect -= 1;
			try {
				var nextUrl = self._validateHttpsUrl(new URL(res.headers.location, originalUri).toString()).toString();
			} catch (error) {
				return self.handleError(new Error('Redirect target must use HTTPS.'));
			}
			res.resume();
			return self.init(nextUrl);
		}
		return self.handleError(new Error('Too many redirects.'));
	}

	if (res.statusCode === 200) {
		/** @type {Buffer[]} */
		var textChunks = [];
		/** @type {Buffer[]} */
		var sniffChunks = [];
		var bytesRead = 0;
		var sniffBytesRead = 0;

		res.on('data', function(chunk) {
			bytesRead += chunk.length;
			if (bytesRead > self.options.maxBytes) {
				self._fail(new Error('Response exceeded maximum allowed size.'));
				res.destroy();
				if (self.req) self.req.destroy();
				return;
			}

			if (self.options.responseType === 'stream') {
				if (sniffBytesRead < self.options.sniffBytes) {
					var remaining = self.options.sniffBytes - sniffBytesRead;
					var sniffChunk = chunk.subarray(0, remaining);
					sniffChunks.push(sniffChunk);
					sniffBytesRead += sniffChunk.length;
				}
				// @ts-ignore - write inherited from PassThrough
				self.write(chunk);
			} else {
				textChunks.push(chunk);
			}
		});

		res.on('end', async function(){
			if (self._finished) return;

			if (self.options.responseType === 'stream') {
				try {
					if (sniffChunks.length > 0) {
						const { fileTypeFromBuffer } = await import('file-type');
						self._mimeType = await fileTypeFromBuffer(Buffer.concat(sniffChunks));
					}
				} catch (e) {}

				self._succeed('');
				return;
			}

			var fullBuffer = Buffer.concat(textChunks);
			self._succeed(fullBuffer.toString('utf8'));
		});

		res.on('error', function(error) {
			self._fail(error);
		});
	} else {
		var error = new Error('Bad response: ' + res.statusCode);
		/** @type {Error & { statusCode?: number }} */
		(error).statusCode = res.statusCode;
		self.handleError(error);
	}
}

/**
 * Handle and emit an error, then end the stream
 * @param {Error} error - Error to emit
 * @returns {void}
 */
Request.prototype.handleError = function(error){
	this._fail(error);
}

/**
 * Emit success once and close the stream.
 * @param {string} payload
 * @returns {void}
 */
Request.prototype._succeed = function(payload) {
	if (this._finished) return;
	this._finished = true;
	// @ts-ignore - emit inherited from PassThrough
	this.emit('success', payload);
	// @ts-ignore - end inherited from PassThrough
	this.end();
}

/**
 * Emit error once and close the stream.
 * @param {Error} error - Error to emit
 * @returns {void}
 */
Request.prototype._fail = function(error) {
	if (this._finished) return;
	this._finished = true;
	// @ts-ignore - emit inherited from PassThrough
	this.emit('error', error);
	// @ts-ignore - end inherited from PassThrough
	this.end();
}

/**
 * Get the detected MIME type of the response
 * @returns {MimeTypeResult | undefined} MIME type info or undefined
 */
Request.prototype.getMimeType = function(){
	return this._mimeType;
}

module.exports = Request;
