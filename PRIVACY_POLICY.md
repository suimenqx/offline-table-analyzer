# Privacy

Offline Table Analyzer is designed to process data locally.

## Network behavior

The release `index.html` contains no external scripts, stylesheets, fonts, images, analytics, telemetry, update checks, or network API calls. Opening the file does not send table data to this project or its contributors.

## Data stored on the device

The application may store the following in browser `localStorage`:

- analysis tabs and their names;
- raw source text, when **Save raw data on this device** is enabled;
- filters, highlight rules, visible columns, pagination, and preview orientation;
- JOIN view definitions;
- theme, copy format, and privacy preferences;
- persisted cell-correction overlays.

Disable raw-data persistence to omit source text from saved state. The current source remains in memory until the page is closed or refreshed.

## Removing data

Use **Clear local data** in the bottom status bar, then refresh the page. Clearing site data through browser settings has the same effect. Workspace JSON or Excel files you downloaded are outside the browser storage and must be deleted separately.

## Browser storage limitations

`localStorage` capacity and behavior vary by browser and by `file://` privacy policy. The application reports write failures but cannot guarantee durable storage. Export a workspace backup for important work.

## Clipboard and downloads

Copied table data is written to the system clipboard only after a copy action. Exported files are generated locally with browser `Blob` APIs and downloaded through the browser.

## Threat model

This application reduces exposure to remote services; it does not protect data from other users, browser extensions, malware, device backups, or administrators who can access the same device/profile.

