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
    globalViews: [],
    nextAnalysisSeq: 1
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
reset();
const oldIds = new Set(Store.state.docs.map(d => d.id));
const newDoc = Store.addDoc();
assert(Store.state.docs.length === 4, 'addDoc should append a new tab');
assert(newDoc && newDoc.id && !oldIds.has(newDoc.id), 'addDoc should generate a unique id');
assert(Store.state.activeId === newDoc.id, 'addDoc should activate the new tab');
assert(newDoc.raw === '', 'new tab should start with an empty source');
assert(newDoc.title === 'Analysis 4', 'new tab should use next available analysis number');
assert(newDoc.ui && newDoc.ui.sidebarTab === 'data', 'new tab should have default sidebar UI');
assert(newDoc.ui.importFormat === 'auto' && newDoc.ui.importHeaderMode === 'auto', 'new tab should have import defaults');
const beforeRemove = Store.state.docs.map(d => d.id).join(',');
assert(Store.removeDoc('missing') === false, 'removing a missing tab should fail safely');
assert(Store.state.docs.map(d => d.id).join(',') === beforeRemove, 'removing a missing tab must not delete another tab');
reset();
assert(Store.removeDoc('b'), 'remove existing tab should succeed');
const afterDelete = Store.addDoc();
assert(afterDelete.title === 'Analysis 4', 'new tab after deletion should not reuse Analysis 2');
reset();
assert(Store.renameDoc('c', 'Analysis 2'), 'rename to duplicate should still succeed with suffix');
assert(Store.state.docs[2].title === 'Analysis 2 (2)', 'duplicate rename should be made unique');
Store.setCopyFormat('markdown');
assert(Store.state.copyFormat === 'markdown', 'copy format should persist globally');
Store.setCopyFormat('invalid');
assert(Store.state.copyFormat === 'default', 'invalid copy format should reset to default');
console.log('Tab interaction tests passed: 20');
