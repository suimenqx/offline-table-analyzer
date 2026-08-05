/**
 * ModalController 测试套件 — show / close / state management
 */
import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { createStorageMock } from '../mocks/storage.js';
import { createDOMSandbox } from '../mocks/dom.js';
import { loadModules } from '../helpers/load-modules.mjs';

let storage, dom, ModalController, Store;

const { OTA } = loadModules([], {});

beforeEach(() => {
  storage = createStorageMock();
  dom = createDOMSandbox();
  globalThis.localStorage = storage;
  globalThis.document = dom.document;
  globalThis.window = dom.window;
  globalThis.CustomEvent = dom.MockCustomEvent;
  globalThis.alert = () => {};

  ModalController = OTA.require('modal-controller').ModalController;
  Store = OTA.require('store').Store;

  Store.state = {
    docs: [{ id: 'a', title: 'Test', raw: '', ui: { displayTables: null, enabledViews: [], rules: {}, columnFilters: {} } }],
    activeId: 'a', theme: 'light', globalViews: [], nextAnalysisSeq: 1,
    copyFormat: 'default', spreadsheetSafe: true, persistRaw: true,
  };
  Store.loadFailed = false;
  Store._listeners = null;

  // Reset modal state
  ModalController.returnFocus = null;
});

// ---------------------------------------------------------------------------
describe('ModalController — show / close', () => {
  it('show populates modalContent and reveals overlay', () => {
    ModalController.show('Test Title', '<p>Body</p>');
    const overlay = dom.getElementById('modalOverlay');
    const content = dom.getElementById('modalContent');
    assert.ok(content.innerHTML.includes('Test Title'));
    assert.ok(content.innerHTML.includes('<p>Body</p>'));
    assert.ok(!overlay.classList.contains('hidden'));
  });

  it('close hides the overlay', () => {
    ModalController.show('X', 'Y');
    ModalController.close();
    const overlay = dom.getElementById('modalOverlay');
    assert.ok(overlay.classList.contains('hidden'));
  });

  it('close restores focus when returnFocus is set', () => {
    const fakeEl = { focus() { fakeEl._focused = true; }, _focused: false };
    ModalController.returnFocus = fakeEl;
    ModalController.close();
    assert.equal(fakeEl._focused, true);
    assert.equal(ModalController.returnFocus, null);
  });

  it('activates a dialog and restores the opener focus on deactivation', () => {
    const opener = { focus() { opener.focused = true; }, focused: false };
    const dialog = dom.getElementById('modalContent');
    globalThis.document.activeElement = opener;
    ModalController.activate(dialog);
    assert.equal(ModalController.activeContainer, dialog);
    ModalController.deactivate(dialog);
    assert.equal(opener.focused, true);
    assert.equal(ModalController.activeContainer, null);
  });
});

// ---------------------------------------------------------------------------
describe('ModalController — showTableSelector', () => {
  it('renders table checkboxes', () => {
    ModalController.showTableSelector(['T1', 'T2'], ['T1']);
    const content = dom.getElementById('modalContent');
    assert.ok(content.innerHTML.includes('T1'));
    assert.ok(content.innerHTML.includes('T2'));
    assert.ok(content.innerHTML.includes('checked'));
  });

  it('handles null selection (all selected)', () => {
    ModalController.showTableSelector(['A', 'B'], null);
    const content = dom.getElementById('modalContent');
    assert.ok(content.innerHTML.includes('checked')); // both checked
  });
});

// ---------------------------------------------------------------------------
describe('ModalController — showViewSelector', () => {
  it('shows alert when no views exist', () => {
    let alerted = false;
    globalThis.alert = () => { alerted = true; };
    ModalController.showViewSelector([], []);
    assert.equal(alerted, true);
  });

  it('renders view checkboxes', () => {
    const views = [
      { view: 'V1', left: 'T1', right: 'T2', type: 'inner' },
    ];
    ModalController.showViewSelector(views, ['V1']);
    const content = dom.getElementById('modalContent');
    assert.ok(content.innerHTML.includes('V1'));
    assert.ok(content.innerHTML.includes('T1'));
    assert.ok(content.innerHTML.includes('T2'));
  });
});

// ---------------------------------------------------------------------------
describe('ModalController — showColumnSelector', () => {
  it('renders column checkboxes with search', () => {
    ModalController.showColumnSelector('T1', ['ColA', 'ColB'], {});
    const content = dom.getElementById('modalContent');
    assert.ok(content.innerHTML.includes('ColA'));
    assert.ok(content.innerHTML.includes('ColB'));
    assert.ok(content.innerHTML.includes('colSearch'));
    assert.ok(content.innerHTML.includes('colAll'));
    assert.ok(content.innerHTML.includes('colNone'));
  });

  it('preselects focused columns', () => {
    ModalController.showColumnSelector('T1', ['X', 'Y', 'Z'], { focus: ['X'] });
    const content = dom.getElementById('modalContent');
    // X should be checked, Y and Z should not
    assert.ok(content.innerHTML.includes('value="X"'));
  });
});
