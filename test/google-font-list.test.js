'use strict';

const GoogleFont = require('../lib/google-font');

// Mock modules before requiring GoogleFontList
vi.mock('../lib/cache', () => ({
	readCache: vi.fn().mockResolvedValue(null),
	writeCache: vi.fn()
}));

// Simple mock that doesn't emit anything - tests will manually set data
vi.mock('../lib/request', () => {
	const { EventEmitter } = require('events');
	const { vi } = require('vitest');
	return {
		__esModule: true,
		default: vi.fn(() => new EventEmitter())
	};
});

const GoogleFontList = require('../lib/google-font-list');

describe('GoogleFontList', () => {
	let consoleSpy;

	beforeAll(() => {
		// Suppress console.log during tests
		consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterAll(() => {
		consoleSpy.mockRestore();
	});

	describe('constructor', () => {
		it('should create instance', () => {
			const fontList = new GoogleFontList();
			expect(fontList).toBeInstanceOf(GoogleFontList);
		});

		it('should work without new keyword', () => {
			const list = GoogleFontList();
			expect(list).toBeInstanceOf(GoogleFontList);
		});

		it('should initialize with empty data array', () => {
			const list = new GoogleFontList();
			expect(Array.isArray(list.data)).toBe(true);
		});

		it('should be an EventEmitter', () => {
			const fontList = new GoogleFontList();
			expect(typeof fontList.on).toBe('function');
			expect(typeof fontList.emit).toBe('function');
		});
	});

	describe('load', () => {
		it('should return a promise', async () => {
			const list = new GoogleFontList();
			const result = list.load();
			expect(result).toBeInstanceOf(Promise);
		});

		it('should return the same promise if already loading', async () => {
			const list = new GoogleFontList();
			const promise1 = list.load();
			const promise2 = list.load();
			expect(promise1).toBe(promise2);
		});
	});

	describe('parseRawData', () => {
		it('should parse valid JSON array', async () => {
			const list = new GoogleFontList();
			await new Promise((resolve) => {
				list.on('success', () => {
					expect(list.data.length).toBe(2);
					resolve();
				});
				list.parseRawData(JSON.stringify([
					{ family: 'Test1', category: 'serif' },
					{ family: 'Test2', category: 'sans-serif' }
				]));
			});
		});

		it('should emit error for invalid JSON', async () => {
			const list = new GoogleFontList();
			await new Promise((resolve) => {
				list.on('error', (err) => {
					expect(err.isInvalidJson).toBe(true);
					resolve();
				});
				list.parseRawData('invalid json');
			});
		});

		it('should emit error for non-array JSON', async () => {
			const list = new GoogleFontList();
			await new Promise((resolve) => {
				list.on('error', (err) => {
					expect(err.isInvalidJson).toBe(true);
					resolve();
				});
				list.parseRawData(JSON.stringify({ not: 'an array' }));
			});
		});
	});

	describe('populate', () => {
		it('should populate data with GoogleFont instances', async () => {
			const list = new GoogleFontList();
			await new Promise((resolve) => {
				list.on('success', () => {
					expect(list.data.length).toBe(2);
					expect(list.data[0]).toBeInstanceOf(GoogleFont);
					expect(list.data[0].getFamily()).toBe('Font1');
					resolve();
				});
				list.populate([
					{ family: 'Font1' },
					{ family: 'Font2' }
				]);
			});
		});

		it('should emit success event', async () => {
			const list = new GoogleFontList();
			await new Promise((resolve) => {
				list.on('success', (result) => {
					expect(result).toBe(list);
					resolve();
				});
				list.populate([{ family: 'Test' }]);
			});
		});
	});

	describe('clone', () => {
		it('should return new GoogleFontList instance', () => {
			const list = new GoogleFontList();
			list.data = [new GoogleFont({ family: 'Test' })];
			const cloned = list.clone();

			expect(cloned).toBeInstanceOf(GoogleFontList);
			expect(cloned).not.toBe(list);
		});

		it('should share the same data reference', () => {
			const list = new GoogleFontList();
			list.data = [new GoogleFont({ family: 'Test' })];
			const cloned = list.clone();

			expect(cloned.data).toBe(list.data);
		});

		it('should not trigger load when cloning (skipInitialLoad)', () => {
			const loadSpy = vi.spyOn(GoogleFontList.prototype, 'load');
			try {
				const list = new GoogleFontList({ skipInitialLoad: true });
				list.data = [new GoogleFont({ family: 'Test' })];
				list.loaded = true;
				const cloned = list.clone();
				expect(loadSpy).not.toHaveBeenCalled();
				expect(cloned.loaded).toBe(true);
			} finally {
				loadSpy.mockRestore();
			}
		});
	});

	describe('searchFont', () => {
		it('should find fonts matching search term', async () => {
			const list = new GoogleFontList();
			list.data = [
				new GoogleFont({ family: 'Roboto', category: 'sans-serif' }),
				new GoogleFont({ family: 'Open Sans', category: 'sans-serif' }),
				new GoogleFont({ family: 'Roboto Mono', category: 'monospace' }),
				new GoogleFont({ family: 'Lato', category: 'sans-serif' })
			];

			await new Promise((resolve) => {
				list.searchFont('Roboto', 'family', (err, result) => {
					expect(err).toBeNull();
					expect(result.data.length).toBe(2);
					expect(result.data[0].getFamily()).toBe('Roboto');
					expect(result.data[1].getFamily()).toBe('Roboto Mono');
					resolve();
				});
			});
		});

		it('should search case-insensitively', async () => {
			const list = new GoogleFontList();
			list.data = [
				new GoogleFont({ family: 'Roboto' }),
				new GoogleFont({ family: 'Roboto Mono' })
			];

			await new Promise((resolve) => {
				list.searchFont('roboto', 'family', (err, result) => {
					expect(err).toBeNull();
					expect(result.data.length).toBe(2);
					resolve();
				});
			});
		});

		it('should return empty array for no matches', async () => {
			const list = new GoogleFontList();
			list.data = [new GoogleFont({ family: 'Roboto' })];

			await new Promise((resolve) => {
				list.searchFont('NonExistent', 'family', (err, result) => {
					expect(err).toBeNull();
					expect(result.data.length).toBe(0);
					resolve();
				});
			});
		});

		it('should search by category', async () => {
			const list = new GoogleFontList();
			list.data = [
				new GoogleFont({ family: 'Roboto', category: 'sans-serif' }),
				new GoogleFont({ family: 'Roboto Mono', category: 'monospace' })
			];

			await new Promise((resolve) => {
				list.searchFont('monospace', 'category', (err, result) => {
					expect(err).toBeNull();
					expect(result.data.length).toBe(1);
					expect(result.data[0].getFamily()).toBe('Roboto Mono');
					resolve();
				});
			});
		});

		it('should handle multiple search terms', async () => {
			const list = new GoogleFontList();
			list.data = [
				new GoogleFont({ family: 'Open Sans' }),
				new GoogleFont({ family: 'Roboto' })
			];

			await new Promise((resolve) => {
				list.searchFont('open sans', 'family', (err, result) => {
					expect(err).toBeNull();
					expect(result.data.length).toBe(1);
					expect(result.data[0].getFamily()).toBe('Open Sans');
					resolve();
				});
			});
		});

		it('should return no matches for empty search term', async () => {
			const list = new GoogleFontList();
			list.data = [new GoogleFont({ family: 'Test' })];

			await new Promise((resolve) => {
				list.searchFont('', 'family', (err, result) => {
					expect(err).toBeNull();
					expect(result.data.length).toBe(0);
					resolve();
				});
			});
		});

		it('should set filter metadata on result', async () => {
			const list = new GoogleFontList();
			list.data = [new GoogleFont({ family: 'Roboto' })];

			await new Promise((resolve) => {
				list.searchFont('Roboto', 'family', (err, result) => {
					expect(result._filterField).toBe('family');
					expect(result._filterTerm).toBe('Roboto');
					resolve();
				});
			});
		});
	});

	describe('searchFontByName', () => {
		it('should search fonts by family name', async () => {
			const list = new GoogleFontList();
			list.data = [
				new GoogleFont({ family: 'Roboto' }),
				new GoogleFont({ family: 'Open Sans' })
			];

			await new Promise((resolve) => {
				list.searchFontByName('Roboto', (err, result) => {
					expect(err).toBeNull();
					expect(result.data.length).toBe(1);
					expect(result.data[0].getFamily()).toBe('Roboto');
					resolve();
				});
			});
		});
	});

	describe('searchFontByType', () => {
		it('should search fonts by category', async () => {
			const list = new GoogleFontList();
			list.data = [
				new GoogleFont({ family: 'Roboto', category: 'sans-serif' }),
				new GoogleFont({ family: 'Merriweather', category: 'serif' })
			];

			await new Promise((resolve) => {
				list.searchFontByType('serif', (err, result) => {
					expect(err).toBeNull();
					expect(result.data.length).toBe(2); // Both contain 'serif'
					resolve();
				});
			});
		});
	});

	describe('getFont', () => {
		it('should get exact font match', async () => {
			const list = new GoogleFontList();
			list.data = [
				new GoogleFont({ family: 'Roboto' }),
				new GoogleFont({ family: 'Roboto Mono' })
			];

			await new Promise((resolve) => {
				list.getFont('Roboto', 'family', (err, result) => {
					expect(err).toBeNull();
					expect(result.data.length).toBe(1);
					expect(result.data[0].getFamily()).toBe('Roboto');
					resolve();
				});
			});
		});

		it('should be case insensitive', async () => {
			const list = new GoogleFontList();
			list.data = [new GoogleFont({ family: 'Roboto' })];

			await new Promise((resolve) => {
				list.getFont('roboto', 'family', (err, result) => {
					expect(err).toBeNull();
					expect(result.data.length).toBe(1);
					expect(result.data[0].getFamily()).toBe('Roboto');
					resolve();
				});
			});
		});

		it('should return empty for partial matches', async () => {
			const list = new GoogleFontList();
			list.data = [new GoogleFont({ family: 'Roboto' })];

			await new Promise((resolve) => {
				list.getFont('Rob', 'family', (err, result) => {
					expect(err).toBeNull();
					expect(result.data.length).toBe(0);
					resolve();
				});
			});
		});
	});

	describe('getFontByName', () => {
		it('should get font by exact name', async () => {
			const list = new GoogleFontList();
			list.data = [
				new GoogleFont({ family: 'Inter' }),
				new GoogleFont({ family: 'Inter Tight' })
			];

			await new Promise((resolve) => {
				list.getFontByName('Inter', (err, result) => {
					expect(err).toBeNull();
					expect(result.data.length).toBe(1);
					expect(result.data[0].getFamily()).toBe('Inter');
					resolve();
				});
			});
		});
	});

	describe('getFontByType', () => {
		it('should get fonts by exact category', async () => {
			const list = new GoogleFontList();
			list.data = [
				new GoogleFont({ family: 'Roboto', category: 'sans-serif' }),
				new GoogleFont({ family: 'Courier', category: 'monospace' })
			];

			await new Promise((resolve) => {
				list.getFontByType('monospace', (err, result) => {
					expect(err).toBeNull();
					expect(result.data.length).toBe(1);
					resolve();
				});
			});
		});
	});

	describe('getFirst', () => {
		it('should return first font if data exists', () => {
			const list = new GoogleFontList();
			list.data = [
				new GoogleFont({ family: 'First' }),
				new GoogleFont({ family: 'Second' })
			];

			const first = list.getFirst();
			expect(first.getFamily()).toBe('First');
		});

		it('should return false if data is empty', () => {
			const list = new GoogleFontList();
			list.data = [];

			expect(list.getFirst()).toBe(false);
		});
	});

	describe('isSingle', () => {
		it('should return true for single item', () => {
			const list = new GoogleFontList();
			list.data = [new GoogleFont({ family: 'Only' })];

			expect(list.isSingle()).toBe(true);
		});

		it('should return false for multiple items', () => {
			const list = new GoogleFontList();
			list.data = [
				new GoogleFont({ family: 'First' }),
				new GoogleFont({ family: 'Second' })
			];

			expect(list.isSingle()).toBe(false);
		});

		it('should return false for empty list', () => {
			const list = new GoogleFontList();
			list.data = [];

			expect(list.isSingle()).toBe(false);
		});
	});

	describe('forEachFont', () => {
		it('should iterate over all fonts', () => {
			const list = new GoogleFontList();
			list.data = [
				new GoogleFont({ family: 'Font1' }),
				new GoogleFont({ family: 'Font2' }),
				new GoogleFont({ family: 'Font3' })
			];
			
			const families = [];
			list.forEachFont((font) => {
				families.push(font.getFamily());
			});

			expect(families).toEqual(['Font1', 'Font2', 'Font3']);
		});

		it('should provide index in callback', () => {
			const list = new GoogleFontList();
			list.data = [
				new GoogleFont({ family: 'Font1' }),
				new GoogleFont({ family: 'Font2' })
			];
			
			const indices = [];
			list.forEachFont((font, index) => {
				indices.push(index);
			});

			expect(indices).toEqual([0, 1]);
		});

		it('should call callback after iteration', async () => {
			const list = new GoogleFontList();
			list.data = [new GoogleFont({ family: 'Test' })];

			await new Promise((resolve) => {
				list.forEachFont(() => {}, () => {
					resolve();
				});
			});
		});

		it('should work without callback', () => {
			const list = new GoogleFontList();
			list.data = [new GoogleFont({ family: 'Test' })];
			
			expect(() => {
				list.forEachFont(() => {});
			}).not.toThrow();
		});
	});
});
