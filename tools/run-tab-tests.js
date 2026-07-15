const { loadBuiltModules } = require('./load-built-modules');
const storage = new Map();
let quotaFail = false;
const sandbox = {
  console,
  alert() {},
  window: {},
  document: { documentElement: { setAttribute() {} } },
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) {
      if(quotaFail) { const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error; }
      storage.set(key, String(value));
    },
    removeItem(key) { storage.delete(key); }
  }
};
const { OTA } = loadBuiltModules(sandbox);
const Store = OTA.require('store').Store;
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
Store.setCopyFormat('lua-inline');
assert(Store.state.copyFormat === 'lua-inline', 'lua inline copy format should persist globally');
Store.setCopyFormat('lua-expanded');
assert(Store.state.copyFormat === 'lua-expanded', 'lua expanded copy format should persist globally');
const persistedCopyFormat = JSON.parse(storage.get('ota_v20_workspace'));
assert(persistedCopyFormat.copyFormat === 'lua-expanded', 'lua copy format should be written to workspace storage');
Store.state.copyFormat = 'default';
Store.init();
assert(Store.state.copyFormat === 'lua-expanded', 'lua copy format should restore during store initialization');
Store.setCopyFormat('invalid');
assert(Store.state.copyFormat === 'default', 'invalid copy format should reset to default');
reset();
Store.state.docs[0].raw = 'sensitive';
Store.state.persistRaw = false;
assert(Store.save(), 'temporary mode save should succeed');
const serialized = JSON.parse(storage.get('ota_v20_workspace'));
assert(serialized.docs[0].raw === '', 'temporary mode must not persist raw data');
assert(Store.state.docs[0].raw === 'sensitive', 'temporary mode must retain in-memory raw data');
const activeDoc = Store.curr();
activeDoc.ui.cellEdits = { '$Table 1': { 1: { 2:'corrected' } } };
assert(Store.clearCellEdits() === true, 'existing cell corrections should be invalidated');
assert(Object.keys(activeDoc.ui.cellEdits).length === 0, 'invalidated cell corrections should be removed');
assert(Store.clearCellEdits() === false, 'invalidating an empty correction set should be a no-op');
quotaFail = true;
assert(Store.save() === false, 'quota failure must be reported');
assert(Store.lastSaveError.includes('空间不足'), 'quota failure should have an actionable message');
quotaFail = false;
reset();
const importedCount = Store.importWorkspace({
  kind:'ota-workspace', schemaVersion:20,
  docs:[{ id:'a', title:'Analysis 1', raw:'id,name\n1,Alice', ui:{} }],
  globalViews:[]
}, true);
assert(importedCount === 1, 'workspace should import one tab');
assert(new Set(Store.state.docs.map(d => d.id)).size === Store.state.docs.length, 'workspace import must normalize duplicate ids');
assert(new Set(Store.state.docs.map(d => d.title)).size === Store.state.docs.length, 'workspace import must normalize duplicate titles');
let rejected = false;
try { Store.importWorkspace({ kind:'ota-workspace', schemaVersion:999, docs:[{}] }); } catch(error) { rejected = true; }
assert(rejected, 'future workspace schema must be rejected');
console.log('Tab and storage tests passed: 34');
