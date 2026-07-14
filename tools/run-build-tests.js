const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { MODULES, renderRelease } = require('./build-release');

const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
const template = fs.readFileSync(path.join(root, 'src', 'index.template.html'), 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8').replace(/^\uFEFF/, '');
const expected = `${renderRelease().trimEnd()}\n`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(template.includes('{{STYLES}}') && template.includes('{{MODULES}}'), 'template placeholders are missing');
assert(MODULES.length === 16, `unexpected module count: ${MODULES.length}`);
assert(new Set(MODULES.map(([file]) => file)).size === MODULES.length, 'module manifest contains duplicates');
assert(MODULES.every(([file]) => fs.existsSync(path.join(root, 'src', 'modules', file))), 'module manifest references a missing file');
assert(html === expected, 'index.html is stale; run npm run build:release');
assert(!html.includes('{{STYLES}}') && !html.includes('{{MODULES}}'), 'release placeholders leaked into index.html');
assert((html.match(/\/\* @module /g) || []).length === MODULES.length, 'release module markers are incomplete');

const scripts = html.match(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi) || [];
assert(scripts.length === 1, `expected one generated script, found ${scripts.length}`);
const script = scripts[0].replace(/^<script(?:\s[^>]*)?>/i, '').replace(/<\/script>$/i, '');
new vm.Script(script, { filename: 'offline-table-analyzer-built.js' });

console.log(`Build/module tests passed: ${MODULES.length} modules`);
