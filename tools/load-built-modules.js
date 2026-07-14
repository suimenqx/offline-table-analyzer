const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.join(__dirname, '..', 'index.html');

function readBuiltScript() {
  const html = fs.readFileSync(htmlPath, 'utf8').replace(/^\uFEFF/, '');
  const match = html.match(/<script>([\s\S]*?)<\/script>/i);
  if(!match) throw new Error('Generated script not found');
  return match[1].replace(/window\.OTA\.start\('app'\);\s*$/, '');
}

function defaultElement() {
  return {
    className: '',
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    style: {},
    dataset: {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getBoundingClientRect() { return { top: 0, left: 0 }; }
  };
}

function loadBuiltModules(sandbox = {}) {
  sandbox.console ||= console;
  sandbox.window ||= {};
  sandbox.document ||= {
    getElementById() { return defaultElement(); },
    createElement() { return defaultElement(); },
    body: { addEventListener() {} },
    documentElement: { setAttribute() {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(readBuiltScript(), sandbox, { filename: 'offline-table-analyzer-built.js' });
  return { sandbox, OTA: sandbox.window.OTA };
}

module.exports = { loadBuiltModules, readBuiltScript };
