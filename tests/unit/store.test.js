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
