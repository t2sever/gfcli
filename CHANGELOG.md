# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project aims to follow Semantic Versioning.

## [3.2.0] - 2026-05-25

### Added

- Added a cached npm update notification that checks for newer `google-font-cli` releases and can be disabled with `--no-update-notifier`, `GFCLI_NO_UPDATE_NOTIFIER`, or `NO_UPDATE_NOTIFIER`.

### Fixed

- Set the loaded flag and replace existing data when populating font lists.
- Prevent filtered `GoogleFontList` clones from triggering an initial background load.
- Validate single-font GWFH API payloads before parsing font variants.
- Hardened GitHub Actions workflow token permissions.

### Changed

- Migrated the test runner from Jest to Vitest.
- Removed unused UI dependencies.
- Refreshed development dependencies and release workflow dependencies.
- Updated README badges and development documentation.

## [3.1.1] - 2026-03-20

### Changes

- Hardened remote fetching to require HTTPS, reject insecure redirects, and enforce response size limits for both metadata and font downloads.
- Reworked font download handling to use unique temporary directories, validate MIME types from a small sniff buffer, and clean up temporary files more reliably.
- Migrated filename casing from the deprecated `pascal-case` package to `change-case`.
- Updated the Node.js support baseline to `>=20` and aligned project documentation with that requirement.
- Upgraded key dependencies, including `file-type`, `commander`, `ink`, `ora`, `react`, `jest`, `typescript`, and `node-powershell`.
- Refreshed the test suite to cover the new request security model, temp-file handling, and PascalCase filename generation.


## Before

- Sadly, we haven't had a CHANGELOG.md before; but it seems like now is a good time to begin.
