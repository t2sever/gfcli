'use strict'

/** @type {Promise<typeof import('change-case')> | undefined} */
let changeCasePromise;

async function loadChangeCase() {
	if (!changeCasePromise) {
		changeCasePromise = import('change-case');
	}

	return changeCasePromise;
}

/**
 * Convert a string to PascalCase using the ESM-only change-case package.
 * @param {string} value
 * @returns {Promise<string>}
 */
async function toPascalCase(value) {
	const { pascalCase } = await loadChangeCase();
	return pascalCase(value);
}

module.exports = {
	toPascalCase
};
