/**
 * TabController 测试套件 — render / state management
 */
import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { createStorageMock } from '../mocks/storage.js';
import { createDOMSandbox } from '../mocks/dom.js';
import { loadModules } from '../helpers/load-modules.mjs';

let storage, dom, TabController, Store;

const { OTA } = loadModules([], {});

beforeEach(() => {
  storage = createStorageMock();
  dom = createDOMSandbox();
  globalThis.localStorage = storage;
  globalThis.document = dom.document;
  globalThis.window = dom.window;
  globalThis.CustomEvent = dom.MockCustomEvent;

  TabController = OTA.require('tab-controller').TabController;
  Store = OTA.require('store').Store;

  Store.state = {
    docs: [
      { id: 'a', title: 'Analysis 1', raw: '', ui: {} },
      { id: 'b', title: 'Analysis 2', raw: '', ui: {} },
      { id: 'c', title: 'Analysis 3', raw: '', ui: {} },
    ],
    activeId: 'b',
    theme: 'light',
    globalViews: [],
    nextAnalysisSeq: 4,
    copyFormat: 'default',
    spreadsheetSafe: true,
    persistRaw: true,
  };
  Store.loadFailed = false;
  Store._listeners = null;
});

// ---------------------------------------------------------------------------
describe('TabController — render', () => {
  it('renders tabs into tabsContainer', () => {
    // Ensure tabsContainer element exists
    const container = dom.getElementById('tabsContainer');
    container.innerHTML = '';

    TabController.render();
    const html = container.innerHTML;
    assert.ok(html.includes('Analysis 1'));
    assert.ok(html.includes('Analysis 2'));
    assert.ok(html.includes('Analysis 3'));
    assert.ok(html.includes('active'));
    assert.ok(html.includes('data-id="b"'));
  });

  it('active tab has aria-selected true', () => {
    TabController.render();
    const container = dom.getElementById('tabsContainer');
    assert.ok(container.innerHTML.includes('aria-selected="true"'));
  });

  it('normalizes docs on render', () => {
    // Add a doc with missing fields
    Store.state.docs.push({ id: 'd', title: 'Raw', raw: undefined, ui: null });
    TabController.render();
    const doc = Store.state.docs[3];
    assert.equal(typeof doc.ui, 'object');
    assert.equal(doc.raw, '');
  });
});

// ---------------------------------------------------------------------------
describe('TabController — drag state', () => {
  it('dragSourceId starts null', () => {
    assert.equal(TabController.dragSourceId, null);
  });

  it('_clearMarkers handles null', () => {
    TabController._clearMarkers(null);
    // Should not throw
  });

  it('_clearAllMarkers handles empty DOM', () => {
    TabController._clearAllMarkers();
    // Should not throw
  });
});

// ---------------------------------------------------------------------------
describe('TabController — startRename', () => {
  it('is a no-op for non-existent tab id', () => {
    TabController.startRename('no-such-id');
    // Should not throw
  });
});

// ---------------------------------------------------------------------------
describe('TabController — canonical mutations', () => {
  it('removes through tab:remove and activates the adjacent tab', () => {
    const previousConfirm = globalThis.confirm;
    globalThis.confirm = () => true;
    try {
      const result = TabController.remove('b');
      assert.equal(result, true);
      assert.equal(Store.state.docs.map(doc => doc.id).join(''), 'ac');
      assert.equal(Store.state.activeId, 'a');
    } finally {
      if (previousConfirm === undefined) delete globalThis.confirm;
      else globalThis.confirm = previousConfirm;
    }
  });

  it('does not remove the final tab', () => {
    const previousConfirm = globalThis.confirm;
    globalThis.confirm = () => true;
    try {
      Store.state.docs = [{ id: 'only', title: 'Only', raw: '', ui: {} }];
      Store.state.activeId = 'only';
      assert.equal(TabController.remove('only'), 'last_doc');
      assert.equal(Store.state.docs.length, 1);
    } finally {
      if (previousConfirm === undefined) delete globalThis.confirm;
      else globalThis.confirm = previousConfirm;
    }
  });
});
