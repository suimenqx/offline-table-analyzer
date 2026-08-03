/**
 * Build 完整性测试
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const require = createRequire(import.meta.url);
const { renderRelease, MODULES } = require('../../tools/build-release.cjs');

const templatePath = path.join(ROOT, 'src', 'templates', 'index.html');
const htmlPath = path.join(ROOT, 'index.html');

describe('Build system', () => {
  it('template contains required placeholders', () => {
    const template = fs.readFileSync(templatePath, 'utf8');
    assert.ok(template.includes('{{STYLES}}'));
    assert.ok(template.includes('{{MODULES}}'));
  });

  it('module manifest has no duplicates', () => {
    const files = MODULES.map(([file]) => file);
    assert.equal(new Set(files).size, files.length);
  });

  it('all modules exist on disk', () => {
    for (const [file] of MODULES) {
      const fullPath = path.join(ROOT, 'src', file);
      assert.ok(fs.existsSync(fullPath), `Missing: ${file}`);
    }
  });

  it('release renders without errors', () => {
    const html = renderRelease();
    assert.ok(html);
    assert.ok(!html.includes('{{STYLES}}'));
    assert.ok(!html.includes('{{MODULES}}'));
  });

  it('index.html is up to date', () => {
    if (!fs.existsSync(htmlPath)) return;
    const html = fs.readFileSync(htmlPath, 'utf8').replace(/^\uFEFF/, '');
    const expected = `${renderRelease().trimEnd()}\n`;
    assert.equal(html, expected, 'index.html is stale; run npm run build:release');
  });

  it('generated script is syntactically valid', () => {
    const html = renderRelease();
    const scripts = html.match(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi) || [];
    assert.equal(scripts.length, 1);
    const script = scripts[0].replace(/^<script(?:\s[^>]*)?>/i, '').replace(/<\/script>$/i, '');
    assert.doesNotThrow(() => new vm.Script(script, { filename: 'offline-table-analyzer-built.js' }));
  });

  it('release module markers are complete', () => {
    const html = renderRelease();
    const markers = (html.match(/\/\* @module /g) || []);
    assert.equal(markers.length, MODULES.length);
  });

  it('does not leak Node test harness into production', () => {
    const html = renderRelease();
    assert.ok(!html.includes('new vm.Script'));
  });
});
