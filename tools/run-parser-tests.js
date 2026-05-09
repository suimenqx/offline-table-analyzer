const fs = require('fs');
const vm = require('vm');
const path = require('path');
const htmlPath = path.join(__dirname, '..', 'offline_table_analyzer_v18.html');
const html = fs.readFileSync(htmlPath, 'utf8').replace(/^\uFEFF/, '');
const script = html.split('<script>')[1].split('</script>')[0];
const start = script.indexOf('/* Import Engine */');
const end = script.indexOf('/* Joiner */');
if (start < 0 || end < 0) throw new Error('Import Engine markers not found');
const code = script.slice(start, end);
const sandbox = {
  console,
  window: {},
  document: {
    createElement() {
      return { innerHTML: '', textContent: '', innerText: '' };
    }
  }
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'import-engine.js' });
const result = sandbox.window.__OTA_TESTS__.runAll();
console.log(`Parser regression tests passed: ${result.passed}`);
