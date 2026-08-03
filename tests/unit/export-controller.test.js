/**
 * ExportController 测试套件 — export helpers / context management
 */
import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { createStorageMock } from '../mocks/storage.js';
import { loadModules } from '../helpers/load-modules.mjs';

let storage, ExportController, Store;

const { OTA } = loadModules([], {});

beforeEach(() => {
  storage = createStorageMock();
  globalThis.localStorage = storage;
  globalThis.document = {
    getElementById() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    body: { appendChild() {}, removeChild() {} },
    documentElement: { setAttribute() {}, getAttribute() {} },
    dispatchEvent() { return true; },
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail || {}; }
  };
  globalThis.window = { OTA };

  ExportController = OTA.require('export-controller').ExportController;
  Store = OTA.require('store').Store;

  Store.state = {
    docs: [{ id: 'a', title: 'Analysis 1', raw: '', ui: { exportOnlyChecked: false, exportCols: 'all', enabledViews: [], displayTables: null, rules: {} } }],
    activeId: 'a', theme: 'light', globalViews: [], nextAnalysisSeq: 1,
    copyFormat: 'default', spreadsheetSafe: true, persistRaw: true,
  };
  Store.loadFailed = false;
  Store._listeners = null;
});

// ---------------------------------------------------------------------------
describe('ExportController — setContext', () => {
  it('stores raw tables', () => {
    const tables = [{ name: 'T1', headers: ['A'], rows: [['1']] }];
    ExportController.setContext({ raw: tables });
    assert.equal(ExportController._raw, tables);
  });

  it('updates rendered data', () => {
    const rendered = [{ name: 'T1', headers: ['A'], rows: [{ d: ['1'] }] }];
    ExportController.setContext({ rendered });
    assert.equal(ExportController._rendered, rendered);
  });
});

// ---------------------------------------------------------------------------
describe('ExportController — _getFullExportTables', () => {
  it('returns tables with all columns when exportCols is all', () => {
    const tables = [
      { name: 'T1', headers: ['A', 'B'], rows: [['1', '2']] },
    ];
    ExportController.setContext({ raw: tables });
    const result = ExportController._getFullExportTables();
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].headers, ['A', 'B']);
    assert.deepEqual(result[0].rows[0], ['1', '2']);
  });

  it('projects focus columns when exportCols is shown', () => {
    const tables = [
      { name: 'T1', headers: ['A', 'B', 'C'], rows: [['1', '2', '3']] },
    ];
    Store.curr().ui.exportCols = 'shown';
    Store.curr().ui.rules = { T1: { focus: ['A', 'C'] } };
    ExportController.setContext({ raw: tables });

    const result = ExportController._getFullExportTables();
    assert.deepEqual(result[0].headers, ['A', 'C']);
    assert.deepEqual(result[0].rows[0], ['1', '3']);
  });
});

// ---------------------------------------------------------------------------
describe('ExportController — _projectTableForExport', () => {
  it('returns all columns when shownOnly is false', () => {
    const table = { name: 'T1', headers: ['X', 'Y'], rows: [['a', 'b']] };
    const result = ExportController._projectTableForExport(table, false);
    assert.deepEqual(result.headers, ['X', 'Y']);
    assert.deepEqual(result.rows[0], ['a', 'b']);
  });

  it('falls back to all columns when focus is empty', () => {
    const table = { name: 'T1', headers: ['X', 'Y'], rows: [['a', 'b']] };
    Store.curr().ui.rules = { T1: { focus: [] } };
    const result = ExportController._projectTableForExport(table, true);
    assert.deepEqual(result.headers, ['X', 'Y']);
  });

  it('filters invalid focus columns gracefully', () => {
    const table = { name: 'T1', headers: ['X', 'Y'], rows: [['a', 'b']] };
    Store.curr().ui.rules = { T1: { focus: ['Z', 'W'] } }; // none valid
    const result = ExportController._projectTableForExport(table, true);
    assert.deepEqual(result.headers, ['X', 'Y']); // fallback to all
  });
});

// ---------------------------------------------------------------------------
describe('ExportController — _getPrefix', () => {
  it('generates a non-empty file prefix', () => {
    const prefix = ExportController._getPrefix('full');
    assert.equal(typeof prefix, 'string');
    assert.ok(prefix.length > 0);
  });
});
