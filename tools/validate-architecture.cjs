const fs = require('fs');
const path = require('path');
const { MODULES, APP_VERSION, renderRelease } = require('./build-release.cjs');

const root = path.join(__dirname, '..');
const srcRoot = path.join(root, 'src');
const indexPath = path.join(root, 'index.html');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const errors = [];

function read(file) { return fs.readFileSync(file, 'utf8'); }
function fail(message) { errors.push(message); }

const uiDir = path.join(srcRoot, 'ui');
for(const filename of fs.readdirSync(uiDir).filter(name => name.endsWith('.js'))) {
    const file = path.join(uiDir, filename);
    read(file).split(/\r?\n/).forEach((line, index) => {
        const code = line.replace(/\/\/.*$/, '').trim();
        if(!code) return;
        if(/Store\.save\s*\(/.test(code)) fail(`${filename}:${index + 1} UI must dispatch persistence, not call Store.save()`);
        if(/Store\.state\.[A-Za-z0-9_$]+\s*(?<![=!<>])=(?!=)/.test(code)) fail(`${filename}:${index + 1} UI must not assign Store.state directly`);
        if(/Store\.state\.globalViews\.(?:push|splice)\s*\(/.test(code)) fail(`${filename}:${index + 1} UI must mutate JOIN views through view transitions`);
        if(/Store\.curr\(\)\.raw\s*=/.test(code)) fail(`${filename}:${index + 1} UI must replace source through source transition`);
        if(/(?:Store\.curr\(\)|Store\.getDocument\([^)]*\))\.ui(?:\.[A-Za-z0-9_$]+|\[[^\]]+\])\s*(?<![=!<>])=(?!=)/.test(code)) fail(`${filename}:${index + 1} UI must update document UI through transitions`);
    });
}

const sourceText = MODULES.map(([file]) => read(path.join(srcRoot, file))).join('\n');
if(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b/.test(sourceText)) fail('runtime source must not use network APIs');
if(/\b(?:new\s+Worker|new\s+SharedWorker|indexedDB)\b/.test(sourceText)) fail('runtime source must not add large-data capabilities');
if(packageJson.version !== APP_VERSION) fail(`package version ${packageJson.version} differs from build version ${APP_VERSION}`);
if(!/const WORKSPACE_SCHEMA_VERSION = 20;/.test(read(path.join(srcRoot, 'state', 'store.js')))) fail('workspace schema version must remain 20');

const html = read(indexPath).replace(/^\uFEFF/, '');
const expected = `${renderRelease().trimEnd()}\n`;
if(html !== expected) fail('index.html is not the deterministic output of the source build');
if(/\{\{(?:STYLES|MODULES|APP_VERSION|APP_MAJOR_VERSION)\}\}/.test(html) || html.includes('__OTA_APP_VERSION__')) fail('generated release contains unresolved build placeholders');
if(!html.includes(`Offline Table Analyzer v${APP_VERSION}`)) fail('generated title does not match package version');
if(!html.includes(`const APP_VERSION = '${APP_VERSION}';`)) fail('generated runtime version does not match package version');
if(new Set(MODULES.map(([file]) => file)).size !== MODULES.length) fail('module manifest contains duplicate files');
for(const [file] of MODULES) if(!fs.existsSync(path.join(srcRoot, file))) fail(`module missing from disk: ${file}`);

if(errors.length) {
    console.error('Architecture validation failed:');
    errors.forEach(error => console.error(`- ${error}`));
    process.exitCode = 1;
} else {
    console.log(`Architecture validation passed: ${MODULES.length} modules, offline boundary, Store command boundary, version ${APP_VERSION}.`);
}
