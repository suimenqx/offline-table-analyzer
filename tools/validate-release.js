const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'index.html');

function cleanProductionHooks() {
  let html = fs.readFileSync(htmlPath, 'utf8');
  const startMarker = '/* Parser regression tests, exposed for development and safe to ignore in production. */';
  const endMarker = '/* Joiner */';
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start >= 0 && end > start) {
    html = html.slice(0, start) + html.slice(end);
    fs.writeFileSync(htmlPath, html, 'utf8');
  }
}

function validateRelease() {
  const html = fs.readFileSync(htmlPath, 'utf8').replace(/^\uFEFF/, '');
  const scripts = html.match(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi) || [];
  if (scripts.length !== 1) throw new Error(`expected one inline script, found ${scripts.length}`);
  const script = scripts[0].replace(/^<script(?:\s[^>]*)?>/i, '').replace(/<\/script>$/i, '');
  new vm.Script(script, { filename:'offline-table-analyzer-v20.js' });
  const checks = [
    [html.includes("const APP_VERSION = '20.0.0'"), 'missing APP_VERSION 20.0.0'],
    [html.includes('Offline Table Analyzer v20.0.0'), 'document title version mismatch'],
    [!html.includes('__OTA_TESTS__'), 'production test hook is present'],
    [!html.includes('offline_table_analyzer_v18'), 'legacy v18 filename reference is present'],
    [!/<script[^>]+src=/i.test(html), 'external script reference is present'],
    [!/<link[^>]+(?:stylesheet|preload)/i.test(html), 'external stylesheet or preload is present'],
    [!/(?:fetch\s*\(|XMLHttpRequest|WebSocket\s*\()/i.test(script), 'network API reference is present'],
    [html.includes('prefers-reduced-motion'), 'reduced motion style is missing'],
    [html.includes('role="tablist"'), 'tab accessibility semantics are missing'],
    [fs.existsSync(path.join(root, 'README.md')), 'README.md is missing'],
    [fs.existsSync(path.join(root, 'LICENSE')), 'LICENSE is missing']
  ];
  const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
  if (failures.length) throw new Error(failures.join('\n'));
  console.log('Release validation passed');
}

if (require.main === module) {
  if (process.argv.includes('--clean-production')) cleanProductionHooks();
  validateRelease();
}

module.exports = { cleanProductionHooks, validateRelease };
