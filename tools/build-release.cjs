const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sourceDir = path.join(root, 'src');
const templatePath = path.join(sourceDir, 'templates', 'index.html');
const outputPath = path.join(root, 'index.html');

// Module load order: each entry is [path-relative-to-src/, description]
// Dependencies flow top→bottom; modules in the same directory are at the same layer.
const MODULES = [
  // ── Core infrastructure ──
  ['core/module-loader.js',      'runtime module registry'],
  ['core/runtime.js',             'DOM utils, Tooltip, Toast'],
  ['core/table-utils.js',         'table normalization'],
  ['core/filter-engine.js',       'pure filtering / highlighting logic'],

  // ── State ──
  ['state/store.js',              'workspace state and persistence'],
  ['core/dispatch.js',            'command bus between UI and Store'],

  // ── Export ──
  ['export/exporter.js',          'file and XLSX exporter'],
  ['export/clipboard.js',         'clipboard serialization'],

  // ── Parsing infrastructure ──
  ['parsing/header-resolver.js',  'header inference'],
  ['parsing/text-layout.js',      'position-aware text layout inference'],
  ['parsing/format-sniffer.js',   'statistical fingerprint format detection'],
  ['parsing/delimited-utils.js',  'quote-aware delimited parsing'],
  ['parsing/parser-helpers.js',   'shared parser helpers'],

  // ── Format-specific parsers ──
  ['parsing/parsers/html-parser.js',              'HTML clipboard parser'],
  ['parsing/parsers/delimited-parsers.js',        'CSV, TSV, and parser factories'],
  ['parsing/parsers/data-block-parser.js',        'data-block structured text parser'],
  ['parsing/parsers/pipe-table-parser.js',        'pipe/Markdown table parser'],
  ['parsing/parsers/ascii-table-parser.js',       'ASCII/terminal table parser'],
  ['parsing/parsers/fixed-width-parser.js',       'fixed-width table parser'],
  ['parsing/parsers/cli-multi-block-parser.js',   'CLI multi-block parser'],
  ['parsing/parsers/aligned-table-parser.js',     'aligned fixed-width parser'],
  ['parsing/parsers/plain-text-parser.js',        'whitespace-separated text parser'],
  ['parsing/parsers/cli-table-data-parser.js',    'CLI table-data legacy parser'],

  // ── Import orchestration ──
  ['parsing/import-engine.js',    'parser selection and diagnostics'],
  ['parsing/legacy-facade.js',    'legacy parser facade'],

  // ── Data transform ──
  ['transform/joiner.js',         'JOIN execution and dependency safety'],

  // ── UI layer ──
  ['ui/table-builder.js',         'preview table DOM construction'],
  ['ui/selection.js',             'preview range selection'],
  ['ui/join-editor.js',           'JOIN editor UI'],
  ['ui/source-controller.js',     'source editor and file import'],
  ['ui/cell-edit-controller.js',  'inline cell editing with undo/redo'],
  ['ui/filter-controller.js',     'column filter popover'],
  ['ui/modal-controller.js',      'modal dialogs and selectors'],
  ['ui/tab-controller.js',        'tab bar drag/drop/rename'],
  ['ui/export-controller.js',     'file exports and workspace backup'],
  ['ui/app.js',                   'application orchestration and UI'],

  // ── Bootstrap ──
  ['bootstrap.js',                'application bootstrap']
];

function readUtf8(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function renderRelease() {
  const template = readUtf8(templatePath);
  const styles = readUtf8(path.join(sourceDir, 'styles', 'styles.css')).trim();
  const modules = MODULES.map(([relPath, label]) => {
    const source = readUtf8(path.join(sourceDir, relPath)).trim();
    const filename = path.basename(relPath);
    return `/* @module ${relPath}: ${label} */\n${source}`;
  }).join('\n\n');

  if (!template.includes('{{STYLES}}') || !template.includes('{{MODULES}}')) {
    throw new Error('Release template must contain {{STYLES}} and {{MODULES}} placeholders');
  }
  return template
    .replace('{{STYLES}}', styles)
    .replace('{{MODULES}}', modules)
    .replace(/\n{3,}/g, '\n\n');
}

function buildRelease({ write = true } = {}) {
  const html = renderRelease();
  if (write) fs.writeFileSync(outputPath, `${html.trimEnd()}\n`, 'utf8');
  return html;
}

if (require.main === module) {
  buildRelease();
  console.log(`Release built from ${MODULES.length} source modules: ${path.relative(root, outputPath)}`);
}

module.exports = { MODULES, renderRelease, buildRelease };
