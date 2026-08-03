/**
 * FilterController 测试套件 — column filter management
 */
import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { createStorageMock } from '../mocks/storage.js';
import { loadModules } from '../helpers/load-modules.mjs';

let storage, FilterController, Store, dispatch;

const { OTA } = loadModules([], {});

beforeEach(() => {
  storage = createStorageMock();
  globalThis.localStorage = storage;
  globalThis.document = {
    getElementById() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    body: { addEventListener() {}, appendChild() {}, removeChild() {} },
    documentElement: { setAttribute() {}, getAttribute() {} },
    dispatchEvent() { return true; },
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail || {}; }
  };
  globalThis.window = { innerWidth: 1024, addEventListener() {} };

  FilterController = OTA.require('filter-controller').FilterController;
  Store = OTA.require('store').Store;
  dispatch = OTA.require('dispatch').dispatch;

  Store.state = {
    docs: [{ id: 'a', title: 'Test', raw: '', ui: { columnFilters: { T1: { Status: 'active' } } } }],
    activeId: 'a', theme: 'light', globalViews: [], nextAnalysisSeq: 1,
    copyFormat: 'default', spreadsheetSafe: true, persistRaw: true,
  };
  Store.loadFailed = false;
  Store._listeners = null;
});

// ---------------------------------------------------------------------------
describe('FilterController — clearColumn', () => {
  it('removes a single column filter', () => {
    FilterController.clearColumn('T1', 'Status');
    const doc = Store.curr();
    assert.equal('Status' in (doc.ui.columnFilters.T1 || {}), false);
  });

  it('is a no-op for non-existent table', () => {
    FilterController.clearColumn('NOPE', 'X');
    // Should not throw
  });
});

// ---------------------------------------------------------------------------
describe('FilterController — clearTableFilters', () => {
  it('removes all column filters for a table', () => {
    FilterController.clearTableFilters('T1');
    const doc = Store.curr();
    assert.equal(doc.ui.columnFilters.T1, undefined);
  });
});

// ---------------------------------------------------------------------------
describe('FilterController — dispatch integration', () => {
  it('dispatch filter:column sets a column filter', () => {
    dispatch('filter:column', { table: 'T2', column: 'Col', value: 'val' });
    const doc = Store.curr();
    assert.equal(doc.ui.columnFilters.T2.Col, 'val');
  });

  it('dispatch filter:column with empty value removes it', () => {
    dispatch('filter:column', { table: 'T1', column: 'Status', value: '' });
    const doc = Store.curr();
    assert.equal('Status' in (doc.ui.columnFilters.T1 || {}), false);
  });

  it('dispatch filter:table sets a table rule', () => {
    dispatch('filter:table', { table: 'T1', field: 'hl', value: 'x=1' });
    const doc = Store.curr();
    assert.equal(doc.ui.rules.T1.hl, 'x=1');
  });
});
