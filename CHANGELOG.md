# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project aims to follow Semantic Versioning.

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
