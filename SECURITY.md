# Security Policy

## Supported version

Security fixes are provided for the latest v20 release line.

## Reporting a vulnerability

Please open a private GitHub Security Advisory for the repository. Do not post exploit details in a public issue before maintainers have had a reasonable opportunity to investigate.

Include:

- affected version and browser;
- minimal reproduction input or workspace file;
- expected and actual behavior;
- security impact;
- any proposed mitigation.

## Security model

- The application is intended to work with networking disabled.
- User-derived table names, headers, view names, and values must be rendered through DOM text APIs or escaping helpers.
- Imported JSON is versioned, size-limited, depth-limited, and rejects prototype-pollution keys.
- TSV/CSV clipboard output protects common spreadsheet formula prefixes by default.
- Excel output writes values as inline strings/numbers rather than formulas.
- Runtime dependencies and remote assets are not accepted without an explicit architecture decision.

## Not a secure vault

Browser local storage is not encrypted. Do not treat the application as a secrets manager. Use temporary-data mode and clear browser data when working on a shared device.

