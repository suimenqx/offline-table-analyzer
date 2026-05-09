const fs = require('fs');
const vm = require('vm');
const path = require('path');
const htmlPath = path.join(__dirname, '..', 'offline_table_analyzer_v18.html');
const html = fs.readFileSync(htmlPath, 'utf8').replace(/^\uFEFF/, '');
const script = html.split('<script>')[1].split('</script>')[0];
const start = script.indexOf('/* Core */');
const end = script.indexOf('/* Import Engine */');
if (start < 0 || end < 0) throw new Error('Core markers not found');
const code = script.slice(start, end) + '\nwindow.Store = Store;';
const storage = new Map();
const sandbox = {
  console,
  alert() {},
  window: {},
  document: { documentElement: { setAttribute() {} } },
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); }
  }
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'tab-store.js' });
const Store = sandbox.window.Store;
function reset() {
  Store.state = {
    docs: [
      { id: 'a', title: 'Analysis 1', ui: {} },
      { id: 'b', title: 'Analysis 2', ui: {} },
      { id: 'c', title: 'Analysis 3', ui: {} }
    ],
    activeId: 'b',
    theme: 'light',
    globalViews: []
  };
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
reset();
assert(Store.renameDoc('a', '  Orders\n  Review\t '), 'rename should succeed');
assert(Store.state.docs[0].title === 'Orders Review', 'rename should trim whitespace and newlines');
const longTitle = 'x'.repeat(80);
Store.renameDoc('a', longTitle);
assert(Store.state.docs[0].title.length === 40, 'rename should cap title length');
const prev = Store.state.docs[0].title;
assert(Store.renameDoc('a', '   ') === false, 'empty rename should fail');
assert(Store.state.docs[0].title === prev, 'empty rename must keep previous title');
reset();
assert(Store.moveDoc('c', 'a', 'before'), 'move before should succeed');
assert(Store.state.docs.map(d => d.id).join('') === 'cab', 'move before order failed');
assert(Store.state.activeId === 'b', 'active tab should not change after reorder');
reset();
assert(Store.moveDoc('a', 'c', 'after'), 'move after should succeed');
assert(Store.state.docs.map(d => d.id).join('') === 'bca', 'move after order failed');
reset();
assert(Store.moveDoc('b', 'missing', 'before') === false, 'invalid target should fail');
assert(Store.state.docs.map(d => d.id).join('') === 'abc', 'invalid target should restore original order');
console.log('Tab interaction tests passed: 7');
