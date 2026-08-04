/**
 * SourceController 测试套件 — format detection / state integration
 */
import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { createStorageMock } from '../mocks/storage.js';
import { loadModules } from '../helpers/load-modules.mjs';

let storage, SourceController, Store, dispatch;

const { OTA } = loadModules([], {});

beforeEach(() => {
  storage = createStorageMock();
  globalThis.localStorage = storage;
  globalThis.document = {
    getElementById() { return null; },
    createElement() { return { style: {}, classList: { add() {}, remove() {}, contains() {} } }; },
    body: { addEventListener() {}, appendChild() {}, removeChild() {} },
    documentElement: { setAttribute() {}, getAttribute() {} },
    dispatchEvent() { return true; },
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail || {}; }
  };

  SourceController = OTA.require('source-controller').SourceController;
  Store = OTA.require('store').Store;
  dispatch = OTA.require('dispatch').dispatch;

  // Reset Store to minimal state
  Store.state = {
    docs: [{ id: 'a', title: 'Test', raw: 'hello', ui: {} }],
    activeId: 'a',
    theme: 'light',
    globalViews: [],
    nextAnalysisSeq: 1,
    copyFormat: 'default',
    spreadsheetSafe: true,
    persistRaw: true,
  };
  Store.loadFailed = false;
  Store.lastSaveError = null;
  Store._listeners = null;
});

// ---------------------------------------------------------------------------
// detectFormat — pure
// ---------------------------------------------------------------------------
describe('SourceController.detectFormat', () => {
  it('detects CSV', () => {
    assert.equal(SourceController.detectFormat('data.csv'), 'csv');
    assert.equal(SourceController.detectFormat('DATA.CSV'), 'csv');
  });

  it('detects TSV as excel-paste', () => {
    assert.equal(SourceController.detectFormat('export.tsv'), 'excel-paste');
  });

  it('detects HTML', () => {
    assert.equal(SourceController.detectFormat('table.html'), 'html-table');
    assert.equal(SourceController.detectFormat('table.htm'), 'html-table');
  });

  it('detects Markdown', () => {
    assert.equal(SourceController.detectFormat('readme.md'), 'pipe-table');
    assert.equal(SourceController.detectFormat('data.markdown'), 'pipe-table');
  });

  it('returns auto for unknown extensions', () => {
    assert.equal(SourceController.detectFormat('data.txt'), 'auto');
    assert.equal(SourceController.detectFormat('data.json'), 'auto');
    assert.equal(SourceController.detectFormat(''), 'auto');
  });

  it('handles null/undefined', () => {
    assert.equal(SourceController.detectFormat(null), 'auto');
    assert.equal(SourceController.detectFormat(undefined), 'auto');
  });
});

describe('SourceController auto-parse policy', () => {
  it('auto-parses small input by default', () => {
    Store.curr().ui.autoParse = true;
    assert.equal(SourceController.getAutoParseState('id,name\n1,Alice'), 'pending');
  });

  it('reports manual mode when auto-parse is disabled', () => {
    Store.curr().ui.autoParse = false;
    assert.equal(SourceController.getAutoParseState('id,name\n1,Alice'), 'manual');
  });

  it('requires explicit parsing for sources at or above 1 MB', () => {
    Store.curr().ui.autoParse = true;
    assert.equal(SourceController.getAutoParseState('x'.repeat(512 * 1024)), 'large');
  });
});

// ---------------------------------------------------------------------------
// getLastPaste / clearLastPaste
// ---------------------------------------------------------------------------
describe('SourceController paste metadata', () => {
  it('starts with null lastPaste', () => {
    assert.equal(SourceController.getLastPaste(), null);
  });

  it('clearLastPaste resets to null', () => {
    SourceController._lastPaste = { html: '<table>', plain: 'x', docId: 'a' };
    SourceController.clearLastPaste();
    assert.equal(SourceController.getLastPaste(), null);
  });
});

// ---------------------------------------------------------------------------
// dispatch integration
// ---------------------------------------------------------------------------
describe('SourceController — dispatch integration', () => {
  it('source:changed transition updates Store.curr().raw', () => {
    const result = dispatch('source:changed', { text: 'new text' });
    assert.equal(result, 'new text');
    assert.equal(Store.curr().raw, 'new text');
  });

  it('source:changed emits source:textChanged event', async () => {
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    dispatch('source:changed', { text: 'hello world' });
    await new Promise(resolve => setTimeout(resolve, 10));

    const textChanged = events.filter(e => e.evt === 'source:textChanged');
    assert.ok(textChanged.length >= 1, 'source:textChanged should be emitted');
    assert.equal(textChanged[0].payload.text, 'hello world');

    unsub();
  });

  it('keeps an async file import attached to its initiating tab', () => {
    Store.state.docs.push({ id: 'b', title: 'Other', raw: 'other', ui: {} });
    let reader;
    const previousFileReader = globalThis.FileReader;
    globalThis.FileReader = class MockFileReader {
      readAsText() { reader = this; }
    };

    try {
      SourceController.loadFile({ name: 'import.csv', size: 20 });
      Store.state.activeId = 'b';
      reader.onload({ target: { result: 'id,name\n1,Alice' } });

      assert.equal(Store.state.docs.find(doc => doc.id === 'a').raw, 'id,name\n1,Alice');
      assert.equal(Store.state.docs.find(doc => doc.id === 'b').raw, 'other');
      assert.equal(Store.state.docs.find(doc => doc.id === 'a').ui.importFormat, 'csv');
    } finally {
      if (previousFileReader === undefined) delete globalThis.FileReader;
      else globalThis.FileReader = previousFileReader;
    }
  });
});
