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
      { id: 'a', title: 'Analysis 1', raw: '', visible: true, ui: {} },
      { id: 'b', title: 'Analysis 2', raw: '', visible: true, ui: {} },
      { id: 'c', title: 'Analysis 3', raw: '', visible: true, ui: {} },
    ],
    projects: [
      { id: 'a', title: 'Analysis 1', cardIds: ['a'], activeCardId: 'a', enabledViews: [], views: [] },
      { id: 'b', title: 'Analysis 2', cardIds: ['b'], activeCardId: 'b', enabledViews: [], views: [] },
      { id: 'c', title: 'Analysis 3', cardIds: ['c'], activeCardId: 'c', enabledViews: [], views: [] },
    ],
    activeProjectId: 'b',
    theme: 'light',
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

  it('builds 1:1 projects for legacy doc-shaped state (ensureProjects)', () => {
    Store.state.docs.push({ id: 'd', title: 'Raw', raw: undefined, ui: null });
    Store.state.projects = [];
    Store.state.activeId = 'b';
    Store.ensureProjects();
    const project = Store.getProject('d');
    assert.equal(typeof project, 'object');
    assert.deepEqual(project.cardIds, ['d']);
    assert.equal(Store.state.activeProjectId, 'b');
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
      assert.equal(Store.state.activeProjectId, 'a');
    } finally {
      if (previousConfirm === undefined) delete globalThis.confirm;
      else globalThis.confirm = previousConfirm;
    }
  });

  it('removes the final tab without automatically rebuilding it', () => {
    const previousConfirm = globalThis.confirm;
    globalThis.confirm = () => true;
    try {
      Store.state.docs = [{ id: 'only', title: 'Only', raw: '', visible: true, ui: {} }];
      Store.state.projects = [{ id: 'only', title: 'Only', cardIds: ['only'], activeCardId: 'only', enabledViews: [], views: [] }];
      Store.state.activeProjectId = 'only';
      Store.state.activeId = 'only';
      assert.equal(TabController.remove('only'), true);
      assert.equal(Store.state.projects.length, 0);
      assert.equal(Store.state.docs.length, 0);
    } finally {
      if (previousConfirm === undefined) delete globalThis.confirm;
      else globalThis.confirm = previousConfirm;
    }
  });
});
