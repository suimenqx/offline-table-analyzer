/**
 * CellEditController 测试套件 — apply / undo / redo / reset
 */
import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { createStorageMock } from '../mocks/storage.js';
import { loadModules } from '../helpers/load-modules.mjs';

let storage, CellEditController, Store;

const { OTA } = loadModules([], {});

beforeEach(() => {
  storage = createStorageMock();
  globalThis.localStorage = storage;
  globalThis.document = {
    getElementById() { return null; },
    querySelectorAll() { return []; },
    body: { addEventListener() {} },
    documentElement: { setAttribute() {}, getAttribute() {} },
    dispatchEvent() { return true; },
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail || {}; }
  };

  CellEditController = OTA.require('cell-edit-controller').CellEditController;
  Store = OTA.require('store').Store;

  // Setup Store with a doc and parsed tables
  Store.state = {
    docs: [{ id: 'a', title: 'Test', raw: '', ui: { cellEdits: {} } }],
    activeId: 'a', theme: 'light', globalViews: [], nextAnalysisSeq: 1,
    copyFormat: 'default', spreadsheetSafe: true, persistRaw: true,
  };
  Store.loadFailed = false;
  Store.lastSaveError = null;
  Store._listeners = null;

  // Setup raw tables (simulating parsed data)
  CellEditController.setRawTables([
    {
      name: 'T1',
      headers: ['A', 'B'],
      rows: [['x', '1'], ['y', '2']],
      isView: false,
    },
    {
      name: 'T2',
      headers: ['C'],
      rows: [['z']],
      isView: true, // JOIN view — read-only
    },
  ]);
  CellEditController.editHistory = [];
  CellEditController.editRedo = [];
  CellEditController.activeEditor = null;
});

// ---------------------------------------------------------------------------
describe('CellEditController — apply', () => {
  it('applies a cell edit and records history', () => {
    const ok = CellEditController.apply('T1', 0, 0, 'modified');
    assert.equal(ok, true);
    assert.equal(CellEditController._rawTables[0].rows[0][0], 'modified');
    assert.equal(CellEditController.editHistory.length, 1);
    assert.equal(CellEditController.editRedo.length, 0);
  });

  it('persists to Store overlay', () => {
    CellEditController.apply('T1', 0, 1, '99');
    const doc = Store.curr();
    assert.equal(doc.ui.cellEdits['$T1']['0']['1'], '99');
  });

  it('returns false for same value', () => {
    // Value is already 'x'
    const ok = CellEditController.apply('T1', 0, 0, 'x');
    assert.equal(ok, false);
    assert.equal(CellEditController.editHistory.length, 0);
  });

  it('returns false for non-existent table', () => {
    const ok = CellEditController.apply('NOPE', 0, 0, 'v');
    assert.equal(ok, false);
  });

  it('returns false for JOIN views (read-only)', () => {
    const ok = CellEditController.apply('T2', 0, 0, 'changed');
    assert.equal(ok, false);
  });

  it('returns false for out-of-range indices', () => {
    assert.equal(CellEditController.apply('T1', 99, 0, 'v'), false);
    assert.equal(CellEditController.apply('T1', 0, 99, 'v'), false);
  });
});

// ---------------------------------------------------------------------------
describe('CellEditController — undo / redo', () => {
  it('undo reverts the last edit', () => {
    CellEditController.apply('T1', 0, 0, 'modified');
    assert.equal(CellEditController._rawTables[0].rows[0][0], 'modified');

    CellEditController.undo();
    assert.equal(CellEditController._rawTables[0].rows[0][0], 'x');
    assert.equal(CellEditController.editHistory.length, 0);
    assert.equal(CellEditController.editRedo.length, 1);
  });

  it('redo re-applies the undone edit', () => {
    CellEditController.apply('T1', 0, 0, 'modified');
    CellEditController.undo();
    CellEditController.redo();
    assert.equal(CellEditController._rawTables[0].rows[0][0], 'modified');
    assert.equal(CellEditController.editHistory.length, 1);
    assert.equal(CellEditController.editRedo.length, 0);
  });

  it('undo with empty history is a no-op', () => {
    CellEditController.undo();
    // Should not throw
  });

  it('redo with empty redo stack is a no-op', () => {
    CellEditController.redo();
    // Should not throw
  });

  it('redo clears after a new edit', () => {
    CellEditController.apply('T1', 0, 0, 'first');
    CellEditController.undo();
    assert.equal(CellEditController.editRedo.length, 1);

    // New edit should clear redo stack
    CellEditController.apply('T1', 0, 0, 'second');
    assert.equal(CellEditController.editRedo.length, 0);
  });

  it('history is capped at 100 entries', () => {
    for (let i = 0; i < 110; i++) {
      CellEditController.apply('T1', 0, 0, `val${i}`);
    }
    assert.ok(CellEditController.editHistory.length <= 100);
    assert.equal(CellEditController.editHistory[0].next, 'val10');
  });
});

// ---------------------------------------------------------------------------
describe('CellEditController — reset', () => {
  it('clears history, redo, and active editor', () => {
    CellEditController.apply('T1', 0, 0, 'edited');
    CellEditController.undo();
    CellEditController.activeEditor = { cancel() {} };

    CellEditController.reset();
    assert.equal(CellEditController.editHistory.length, 0);
    assert.equal(CellEditController.editRedo.length, 0);
    assert.equal(CellEditController.activeEditor, null);
  });
});
