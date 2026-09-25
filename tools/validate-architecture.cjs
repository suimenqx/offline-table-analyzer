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

function listJavaScriptFiles(directory, relativeDirectory = '') {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const relativePath = path.posix.join(relativeDirectory, entry.name);
        const fullPath = path.join(directory, entry.name);
        if(entry.isDirectory()) return listJavaScriptFiles(fullPath, relativePath);
        return entry.isFile() && entry.name.endsWith('.js') ? [relativePath] : [];
    });
}

function parseDependencyArray(source, file) {
    const dependencies = [];
    const stringLiteral = /(['"])([^'"]+)\1/g;
    let previousEnd = 0;
    let match;
    while((match = stringLiteral.exec(source))) {
        const separator = source.slice(previousEnd, match.index);
        const validSeparator = dependencies.length === 0 ? /^\s*$/.test(separator) : /^\s*,\s*$/.test(separator);
        if(!validSeparator) {
            fail(`${file} must declare module dependencies as a literal string array`);
            return null;
        }
        dependencies.push(match[2]);
        previousEnd = stringLiteral.lastIndex;
    }
    const trailing = source.slice(previousEnd);
    if(dependencies.length ? !/^\s*$/.test(trailing) : source.trim() !== '') {
        fail(`${file} must declare module dependencies as a literal string array`);
        return null;
    }
    return dependencies;
}

function validateModuleManifest() {
    const moduleLoader = 'core/module-loader.js';
    const bootstrap = 'bootstrap.js';
    const manifestFiles = MODULES.map(([file]) => file);
    const manifestSet = new Set(manifestFiles);
    const sourceFiles = listJavaScriptFiles(srcRoot).sort();

    if(manifestSet.size !== manifestFiles.length) fail('module manifest contains duplicate files');
    for(const file of sourceFiles) {
        if(!manifestSet.has(file)) fail(`source module is missing from build manifest: ${file}`);
    }
    for(const file of manifestFiles) {
        if(!sourceFiles.includes(file)) fail(`module is not a JavaScript source file: ${file}`);
    }
    if(manifestFiles[0] !== moduleLoader) fail(`${moduleLoader} must be first in the build manifest`);
    if(manifestFiles.at(-1) !== bootstrap) fail(`${bootstrap} must be last in the build manifest`);

    const moduleEntries = [];
    const moduleIndexes = new Map();
    const registrationPattern = /OTA\.define\(\s*(['"])([^'"]+)\1\s*,\s*\[([^\]]*)\]\s*,/g;
    for(let index = 0; index < MODULES.length; index++) {
        const [file] = MODULES[index];
        if(file === moduleLoader || file === bootstrap) continue;
        const source = read(path.join(srcRoot, file));
        const registrations = [...source.matchAll(registrationPattern)];
        if(registrations.length !== 1) {
            fail(`${file} must define exactly one OTA module`);
            continue;
        }

        const registration = registrations[0];
        const dependencies = parseDependencyArray(registration[3], file);
        if(!dependencies) continue;
        const name = registration[2];
        if(moduleIndexes.has(name)) fail(`duplicate OTA module name: ${name}`);
        else moduleIndexes.set(name, index);
        moduleEntries.push({ file, index, name, dependencies, source });
    }

    for(const module of moduleEntries) {
        const runtimeRequires = [...module.source.matchAll(/\b(?:window\s*\.\s*)?OTA\s*\.\s*require\s*\(\s*(['"])([^'"]+)\1\s*\)/g)]
            .map(match => match[2]);
        const dependencies = new Set([...module.dependencies, ...runtimeRequires]);
        for(const dependency of dependencies) {
            const dependencyIndex = moduleIndexes.get(dependency);
            if(dependencyIndex === undefined) {
                fail(`${module.file} depends on unknown OTA module: ${dependency}`);
            } else if(dependencyIndex >= module.index) {
                fail(`${module.file} depends on ${dependency}, which must appear earlier in the build manifest`);
            }
        }
    }
}

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

const appSource = read(path.join(uiDir, 'app.js'));
if(/ExportController\._getPreviewProcessedTables\s*\(/.test(appSource)) fail('App must query QueryService directly, not use ExportController preview internals');
if(!/QueryService\.getPreview\s*\(/.test(appSource)) fail('App preview must use the shared QueryService contract');

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
validateModuleManifest();

if(errors.length) {
    console.error('Architecture validation failed:');
    errors.forEach(error => console.error(`- ${error}`));
    process.exitCode = 1;
} else {
    console.log(`Architecture validation passed: ${MODULES.length} modules, dependency order, offline boundary, Store command boundary, version ${APP_VERSION}.`);
}
