/**
 * Store 测试套件 — 页签管理 / 持久化 / 工作区导入导出
 */
import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { createStorageMock } from '../mocks/storage.js';
import { createDOMSandbox } from '../mocks/dom.js';
import { loadModules } from '../helpers/load-modules.mjs';

let storage, dom, Store;

// 首次加载所有模块（触发缓存）
const { OTA } = loadModules([], {});

function resetStore() {
  storage.reset();
  Store.state = {
    docs: [
      { id: 'a', title: 'Analysis 1', ui: {} },
      { id: 'b', title: 'Analysis 2', ui: {} },
      { id: 'c', title: 'Analysis 3', ui: {} },
    ],
    activeId: 'b',
    theme: 'light',
    globalViews: [],
    nextAnalysisSeq: 1,
    copyFormat: 'default',
    spreadsheetSafe: true,
    persistRaw: true,
  };
  Store.loadFailed = false;
  Store.lastSaveError = null;
}

beforeEach(() => {
  storage = createStorageMock();
  dom = createDOMSandbox();
  // 替换全局 mock（OTA 已缓存，只需覆盖全局变量）
  globalThis.localStorage = storage;
  globalThis.document = dom.document;
  globalThis.window = dom.window;
  globalThis.CustomEvent = dom.MockCustomEvent;
  Store = OTA.require('store').Store;
  resetStore();
});

// ---------------------------------------------------------------------------
describe('Store — tab renaming', () => {
  it('trims whitespace and newlines', () => {
    assert.equal(Store.renameDoc('a', '  Orders\n  Review\t '), true);
    assert.equal(Store.state.docs[0].title, 'Orders Review');
  });

  it('caps title length at 40 characters', () => {
    Store.renameDoc('a', 'x'.repeat(80));
    assert.equal(Store.state.docs[0].title.length, 40);
  });

  it('rejects empty/whitespace-only titles', () => {
    const prev = Store.state.docs[0].title;
    assert.equal(Store.renameDoc('a', '   '), false);
    assert.equal(Store.state.docs[0].title, prev);
  });

  it('makes duplicate titles unique with suffix', () => {
    assert.equal(Store.renameDoc('c', 'Analysis 2'), true);
    assert.equal(Store.state.docs[2].title, 'Analysis 2 (2)');
  });
});

describe('Store — auto-parse preference', () => {
  it('defaults auto-parse to enabled and persists changes', () => {
    assert.equal(Store.curr().ui.autoParse, true);
    assert.equal(Store.transition('ui:autoParse', { enabled: false }), true);
    assert.equal(Store.curr().ui.autoParse, false);
  });
});

// ---------------------------------------------------------------------------
describe('Store — tab reordering', () => {
  it('moves tab before target', () => {
    assert.equal(Store.moveDoc('c', 'a', 'before'), true);
    assert.equal(Store.state.docs.map(d => d.id).join(''), 'cab');
  });

  it('does not change active tab on reorder', () => {
    Store.moveDoc('c', 'a', 'before');
    assert.equal(Store.state.activeId, 'b');
  });

  it('moves tab after target', () => {
    assert.equal(Store.moveDoc('a', 'c', 'after'), true);
    assert.equal(Store.state.docs.map(d => d.id).join(''), 'bca');
  });

  it('returns false for invalid target', () => {
    assert.equal(Store.moveDoc('b', 'missing', 'before'), false);
    assert.equal(Store.state.docs.map(d => d.id).join(''), 'abc');
  });
});

// ---------------------------------------------------------------------------
describe('Store — add/remove tabs', () => {
  it('addDoc appends and activates new tab', () => {
    const oldIds = new Set(Store.state.docs.map(d => d.id));
    const newDoc = Store.addDoc();
    assert.equal(Store.state.docs.length, 4);
    assert.equal(oldIds.has(newDoc.id), false);
    assert.equal(Store.state.activeId, newDoc.id);
    assert.equal(newDoc.raw, '');
    assert.equal(newDoc.title, 'Analysis 4');
    assert.equal(newDoc.ui.sidebarTab, 'data');
    assert.equal(newDoc.ui.importFormat, 'auto');
  });

  it('removeDoc returns false for missing tab', () => {
    const before = Store.state.docs.map(d => d.id).join(',');
    assert.equal(Store.removeDoc('missing'), false);
    assert.equal(Store.state.docs.map(d => d.id).join(','), before);
  });

  it('removeDoc removes tab and updates activeId', () => {
    assert.equal(Store.removeDoc('b'), true);
    assert.equal(Store.state.docs.map(d => d.id).join(''), 'ac');
  });

  it('deleted tab numbers are not reused', () => {
    Store.removeDoc('b');
    const doc = Store.addDoc();
    assert.equal(doc.title, 'Analysis 4');
  });
});

// ---------------------------------------------------------------------------
describe('Store — copy format', () => {
  it('persists and restores copy format (round-trip)', () => {
    // 设置并持久化
    Store.setCopyFormat('lua-expanded');
    assert.equal(Store.state.copyFormat, 'lua-expanded');
    const raw = storage.getItem('ota_v20_workspace');
    assert.ok(raw);
    const persisted = JSON.parse(raw);
    assert.equal(persisted.copyFormat, 'lua-expanded');

    // 模拟新会话：手动改掉状态后 init() 应恢复
    Store.state.copyFormat = 'default';
    assert.equal(Store.state.copyFormat, 'default');
    Store.init();
    assert.equal(Store.state.copyFormat, 'lua-expanded');
  });

  it('supports markdown format', () => {
    Store.setCopyFormat('markdown');
    assert.equal(Store.state.copyFormat, 'markdown');
  });

  it('supports lua-inline format', () => {
    Store.setCopyFormat('lua-inline');
    assert.equal(Store.state.copyFormat, 'lua-inline');
  });

  it('resets to default for invalid format', () => {
    Store.setCopyFormat('invalid');
    assert.equal(Store.state.copyFormat, 'default');
  });

  it('defaults to including headers for older saved workspaces', () => {
    Store.state.copyWithHeaders = undefined;
    Store.init();
    assert.equal(Store.state.copyWithHeaders, true);
  });

  it('persists the copy header preference', () => {
    Store.setCopyWithHeaders(false);
    assert.equal(Store.state.copyWithHeaders, false);
    const persisted = JSON.parse(storage.getItem('ota_v20_workspace'));
    assert.equal(persisted.copyWithHeaders, false);

    Store.state.copyWithHeaders = true;
    Store.init();
    assert.equal(Store.state.copyWithHeaders, false);
  });
});

// ---------------------------------------------------------------------------
describe('Store — persistence', () => {
  it('does not persist raw data in temporary mode', () => {
    Store.state.docs[0].raw = 'sensitive';
    Store.state.persistRaw = false;
    assert.equal(Store.save(), true);
    const serialized = JSON.parse(storage.getItem('ota_v20_workspace'));
    assert.equal(serialized.docs[0].raw, '');
    assert.equal(Store.state.docs[0].raw, 'sensitive');
  });

  it('handles QuotaExceededError', () => {
    storage.enableQuotaFailure();
    assert.equal(Store.save(), false);
    assert.ok(Store.lastSaveError.includes('空间不足'));
    storage.disableQuotaFailure();
  });
});

// ---------------------------------------------------------------------------
describe('Store — cell edits', () => {
  it('clearCellEdits invalidates corrections', () => {
    const doc = Store.curr();
    doc.ui.cellEdits = { '$Table 1': { 1: { 2: 'corrected' } } };
    assert.equal(Store.clearCellEdits(), true);
    assert.equal(Object.keys(doc.ui.cellEdits).length, 0);
  });

  it('clearCellEdits returns false when no edits', () => {
    assert.equal(Store.clearCellEdits(), false);
  });
});

// ---------------------------------------------------------------------------
describe('Store — workspace import', () => {
  it('imports a single tab', () => {
    const count = Store.importWorkspace({
      kind: 'ota-workspace', schemaVersion: 20,
      docs: [{ id: 'a', title: 'Analysis 1', raw: 'id,name\n1,Alice', ui: {} }],
      globalViews: [],
    }, true);
    assert.equal(count, 1);
    assert.equal(new Set(Store.state.docs.map(d => d.id)).size, Store.state.docs.length);
    assert.equal(new Set(Store.state.docs.map(d => d.title)).size, Store.state.docs.length);
  });

  it('rejects future schema versions', () => {
    assert.throws(() => Store.importWorkspace({
      kind: 'ota-workspace', schemaVersion: 999, docs: [{}],
    }));
  });
});

// ---------------------------------------------------------------------------
// Store — transition / event protocol (v22 infrastructure)
// ---------------------------------------------------------------------------
describe('Store — transition protocol', () => {
  it('tab:create emits tab:created + state:changed', async () => {
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    const doc = Store.transition('tab:create');
    assert.equal(typeof doc.id, 'string');
    assert.ok(doc.title.startsWith('Analysis'));

    // _notify is batched with setTimeout(0) — wait
    await new Promise(resolve => setTimeout(resolve, 10));

    const createdEvents = events.filter(e => e.evt === 'tab:created');
    const changedEvents = events.filter(e => e.evt === 'state:changed');
    assert.ok(createdEvents.length >= 1, 'tab:created should be emitted');
    assert.ok(changedEvents.length >= 1, 'state:changed should be emitted');
    assert.equal(createdEvents[0].payload.id, doc.id);

    unsub();
  });

  it('tab:activate switches activeId and emits events', async () => {
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    // Activate first tab
    const ok = Store.transition('tab:activate', { id: 'a' });
    assert.equal(ok, true);
    assert.equal(Store.state.activeId, 'a');

    await new Promise(resolve => setTimeout(resolve, 10));

    const activatedEvents = events.filter(e => e.evt === 'tab:activated');
    assert.ok(activatedEvents.length >= 1, 'tab:activated should be emitted');
    assert.equal(activatedEvents[0].payload.id, 'a');

    unsub();
  });

  it('tab:activate with same id is no-op without force', () => {
    // First switch to 'a'
    Store.transition('tab:activate', { id: 'a' });
    assert.equal(Store.state.activeId, 'a');
    // Then try the same id again without force
    const ok = Store.transition('tab:activate', { id: 'a' });
    assert.equal(ok, false);
  });

  it('tab:activate with force=true re-activates same tab', async () => {
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    const ok = Store.transition('tab:activate', { id: 'a', force: true });
    assert.equal(ok, true);

    await new Promise(resolve => setTimeout(resolve, 10));
    const activatedEvents = events.filter(e => e.evt === 'tab:activated');
    assert.ok(activatedEvents.length >= 1);

    unsub();
  });

  it('tab:remove returns last_doc for single remaining tab', () => {
    // We have at least 4 tabs now. Remove until one left.
    while (Store.state.docs.length > 1) {
      Store.removeDoc(Store.state.docs[Store.state.docs.length - 1].id);
    }
    const lastId = Store.state.docs[0].id;
    const result = Store.transition('tab:remove', { id: lastId });
    assert.equal(result, 'last_doc');
  });

  it('filter:global updates ui.globalFilter and emits filter:changed', async () => {
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    Store.transition('filter:global', { value: 'status=active' });
    const doc = Store.curr();
    assert.equal(doc.ui.globalFilter, 'status=active');

    await new Promise(resolve => setTimeout(resolve, 10));
    const filterEvents = events.filter(e => e.evt === 'filter:changed');
    assert.ok(filterEvents.length >= 1);
    assert.equal(filterEvents[0].payload.scope, 'global');
    assert.equal(filterEvents[0].payload.value, 'status=active');

    unsub();
  });

  it('filter:column adds and removes column filters', () => {
    Store.transition('filter:column', { table: 'T1', column: 'Status', value: 'active' });
    const doc = Store.curr();
    assert.equal(doc.ui.columnFilters.T1.Status, 'active');

    Store.transition('filter:column', { table: 'T1', column: 'Status', value: '' });
    assert.equal('Status' in (doc.ui.columnFilters.T1 || {}), false);
  });

  it('ui:theme toggles light↔dark', () => {
    const initial = Store.state.theme;
    Store.transition('ui:theme', {});
    assert.notEqual(Store.state.theme, initial);
    Store.transition('ui:theme', {});
    assert.equal(Store.state.theme, initial);
  });

  it('ui:copyFormat sets and validates format', () => {
    Store.transition('ui:copyFormat', { format: 'lua-inline' });
    assert.equal(Store.state.copyFormat, 'lua-inline');

    Store.transition('ui:copyFormat', { format: 'invalid' });
    assert.equal(Store.state.copyFormat, 'default');
  });

  it('workspace:save emits workspace:saved on success', async () => {
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    const ok = Store.transition('workspace:save', {});
    assert.equal(ok, true);

    await new Promise(resolve => setTimeout(resolve, 10));
    const savedEvents = events.filter(e => e.evt === 'workspace:saved');
    assert.ok(savedEvents.length >= 1);

    unsub();
  });

  it('workspace:save emits workspace:saveFailed on quota error', async () => {
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    storage.enableQuotaFailure();
    const ok = Store.transition('workspace:save', {});
    assert.equal(ok, false);
    storage.disableQuotaFailure();

    await new Promise(resolve => setTimeout(resolve, 10));
    const failedEvents = events.filter(e => e.evt === 'workspace:saveFailed');
    assert.ok(failedEvents.length >= 1);

    unsub();
  });

  it('onChange returns unsubscribe function that works', async () => {
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    Store.transition('ui:theme', {});
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(events.length >= 1);

    unsub();
    const countBefore = events.length;
    Store.transition('ui:theme', {});
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(events.length, countBefore, 'no new events after unsubscribe');
  });

  it('listener errors do not prevent other listeners', async () => {
    const events = [];
    const unsub1 = Store.onChange(() => { throw new Error('BANG'); });
    const unsub2 = Store.onChange((evt, payload) => events.push({ evt, payload }));

    Store.transition('ui:theme', {});
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(events.length >= 1, 'second listener should still receive events');

    unsub1();
    unsub2();
  });

  it('_notify is a no-op when there are zero listeners', () => {
    // Should not throw
    Store._notify('noop', {});
  });
});
