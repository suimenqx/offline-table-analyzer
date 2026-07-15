const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sourceDir = path.join(root, 'src');
const moduleDir = path.join(sourceDir, 'modules');
const templatePath = path.join(sourceDir, 'index.template.html');
const outputPath = path.join(root, 'index.html');

const MODULES = [
  ['00-module-loader.js', 'runtime module registry'],
  ['00-runtime.js', 'runtime and feedback'],
  ['01-exporter.js', 'file and XLSX exporter'],
  ['02-store.js', 'workspace state and persistence'],
  ['03-table-utils.js', 'table normalization'],
  ['04-header-resolver.js', 'header inference'],
  ['04-text-layout.js', 'position-aware text layout inference'],
  ['05-delimited.js', 'quote-aware delimited parsing'],
  ['06-html-parser.js', 'HTML clipboard parser'],
  ['07-delimited-parsers.js', 'CSV, TSV, and parser factories'],
  ['08-text-parsers.js', 'pipe, ASCII, fixed-width, aligned, plain, and CLI parsers'],
  ['09-import-engine.js', 'parser selection and diagnostics'],
  ['10-parser-facade.js', 'legacy parser facade'],
  ['11-joiner.js', 'JOIN execution and dependency safety'],
  ['12-join-editor.js', 'JOIN editor UI'],
  ['13-clipboard.js', 'clipboard serialization'],
  ['14-selection.js', 'preview range selection'],
  ['15-app.js', 'application orchestration and UI'],
  ['16-bootstrap.js', 'application bootstrap']
];

function readUtf8(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function renderRelease() {
  const template = readUtf8(templatePath);
  const styles = readUtf8(path.join(sourceDir, 'styles.css')).trim();
  const modules = MODULES.map(([filename, label]) => {
    const source = readUtf8(path.join(moduleDir, filename)).trim();
    return `/* @module ${filename}: ${label} */\n${source}`;
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
