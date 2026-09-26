# Browser validation from Termux

This project targets desktop browsers. Termux on a phone is a development host, not the target browser platform. The generated `index.html` works as a local `file://` page, so a web server is optional.

## What this path proves

Termux's Firefox, geckodriver, and Xvfb provide a real desktop Gecko browser that WebDriver can click, inspect, and screenshot without HDB, ADB, or Playwright. This was verified on a Huawei Mate 60 Pro+ running HarmonyOS 4.2 with Firefox 156.0.1 and geckodriver 0.37.1: the local file loaded, the sample produced three tables and 12 rows, a table filter changed the preview, and an exported XLSX was read back with `read-excel-file`.

This is local Firefox coverage. It does not replace `npm run test:e2e`, which runs the project's full Chromium workflow in CI. It also does not test an Android browser or native touch behavior.

## Prepare the host

From the repository root in Termux:

```sh
pkg install x11-repo
pkg install firefox geckodriver xorg-server-xvfb
npm ci --bin-links=false
npm run build:release
```

Use `npm ci` without `--bin-links=false` when the checkout filesystem supports symlinks. If Termux reports incompatible package versions, select current main and X11 repositories with `termux-change-repo`, refresh package metadata, and retry. Avoid mixing stale mirror packages with current ones.

Start the virtual display and driver in the same shell:

```sh
Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp >"$PREFIX/tmp/ota-xvfb.log" 2>&1 &
ota_xvfb_pid=$!
DISPLAY=:99 MOZ_DISABLE_CONTENT_SANDBOX=1 geckodriver --port 4444 >"$PREFIX/tmp/ota-geckodriver.log" 2>&1 &
ota_gecko_pid=$!
```

The Xvfb resolution is the virtual display size, not the page viewport. Check `innerWidth` and `innerHeight` in the browser result when judging desktop layout.

## Run a real-browser smoke check

Run this from the repository root after geckodriver is listening on `127.0.0.1:4444`:

```sh
node <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const server = 'http://127.0.0.1:4444';
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';

async function webdriver(method, route, body) {
  const response = await fetch(server + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result.value));
  return result.value;
}

(async () => {
  const { sessionId } = await webdriver('POST', '/session', {
    capabilities: { alwaysMatch: { browserName: 'firefox' } },
  });
  const session = `/session/${sessionId}`;
  try {
    await webdriver('POST', `${session}/window/rect`, { width: 1440, height: 900 });
    await webdriver('POST', `${session}/url`, {
      url: pathToFileURL(path.resolve('index.html')).href,
    });
    const sample = await webdriver('POST', `${session}/element`, {
      using: 'css selector', value: '#sampleLink',
    });
    await webdriver('POST', `${session}/element/${sample[elementKey]}/click`, {});
    const state = await webdriver('POST', `${session}/execute/sync`, {
      script: 'return { protocol: location.protocol, width: innerWidth, height: innerHeight, tables: document.querySelectorAll("#previewArea table").length, rows: document.querySelectorAll("#previewArea tbody tr").length }',
      args: [],
    });
    assert.equal(state.protocol, 'file:');
    assert.equal(state.tables, 3);
    assert.equal(state.rows, 12);
    const png = await webdriver('GET', `${session}/screenshot`);
    const output = path.join(process.env.PREFIX, 'tmp', 'ota-desktop-smoke.png');
    fs.writeFileSync(output, Buffer.from(png, 'base64'));
    console.log({ ...state, screenshot: output });
  } finally {
    await webdriver('DELETE', session);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
NODE
```

Inspect the PNG for actual layout and visual regressions. For changed filters, JOINs, clipboard behavior, or downloads, drive the corresponding visible controls and assert the resulting DOM or file contents; use `read-excel-file` to read XLSX output back. Keep permanent browser tests in `e2e/` and run the Chromium job on CI for UI changes.

When finished, stop the background services from the same shell:

```sh
kill "$ota_gecko_pid" "$ota_xvfb_pid"
```

The commands above do not add packages or assets to the generated HTML. For an interactive Firefox window on the phone screen, [Termux:X11](https://github.com/termux/termux-x11/blob/master/README.md) can replace the virtual display; it is optional for automated checks.
