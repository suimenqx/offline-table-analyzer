/**
 * CellEditController 测试套件 — apply / undo / redo / reset
 */
import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { createStorageMock } from '../mocks/storage.js';
import { createDOMSandbox } from '../mocks/dom.js';
import { loadModules } from '../helpers/load-modules.mjs';

let storage, CellEditController, Store, TableRegistry;

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
  TableRegistry = OTA.require('table-registry').TableRegistry;

  // Setup Store with a doc and parsed tables
  Store.state = {
    docs: [{ id: 'a', title: 'Test', raw: '', ui: { cellEdits: {} } }],
    activeId: 'a', theme: 'light', globalViews: [], nextAnalysisSeq: 1,
    copyFormat: 'default', spreadsheetSafe: true, persistRaw: true,
  };
  Store.loadFailed = false;
  Store.lastSaveError = null;
  Store._listeners = null;

  // Setup raw tables in the shared registry (simulating parsed data)
  TableRegistry.setRaw([
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

function createEditableCell(value) {
  const dom = createDOMSandbox();
  globalThis.document = dom.document;
  globalThis.window = dom.window;

  const table = document.createElement('table');
  table.dataset.tableName = 'T1';
  const td = document.createElement('td');
  td.dataset.sourceRow = '0';
  td.dataset.sourceCol = '0';
  td.textContent = value;
  td.closest = (selector) => selector === 'table' ? table : null;
  table.appendChild(td);
  TableRegistry.getRaw()[0].rows[0][0] = value;
  return { td };
}

function keydown(editor, key, shiftKey = false) {
  editor.dispatchEvent({
    type: 'keydown',
    key,
    shiftKey,
    preventDefault() {},
  });
}

// ---------------------------------------------------------------------------
describe('CellEditController — inline editor', () => {
  it('preserves multiline cell text through open and commit', () => {
    const { td } = createEditableCell('a\nb');

    CellEditController.begin(td);
    const editor = td.children[0];
    assert.equal(editor.tagName, 'TEXTAREA');
    assert.equal(editor.className, 'cell-editor');
    assert.equal(editor.value, 'a\nb');

    editor.value = 'first\nsecond';
    keydown(editor, 'Enter');

    assert.equal(td.textContent, 'first\nsecond');
    assert.equal(TableRegistry.getRaw()[0].rows[0][0], 'first\nsecond');
    assert.equal(td.classList.contains('multiline-cell'), true);
  });

  it('inserts a newline with Shift+Enter without committing', () => {
    const { td } = createEditableCell('a');

    CellEditController.begin(td);
    const editor = td.children[0];
    editor.selectionStart = 1;
    editor.selectionEnd = 1;
    keydown(editor, 'Enter', true);

    assert.equal(editor.value, 'a\n');
    assert.ok(CellEditController.activeEditor, 'Shift+Enter should keep the editor open');

    keydown(editor, 'Enter');
    assert.equal(CellEditController.activeEditor, null);
    assert.equal(TableRegistry.getRaw()[0].rows[0][0], 'a\n');
  });
});

// ---------------------------------------------------------------------------
describe('CellEditController — apply', () => {
  it('shares untouched rows and preserves prior table revisions through a correction and undo',()=>{
    const parsed=TableRegistry.getTable('T1');
    Store.transition('cell:edit',{table:'T1',row:0,col:1,value:'saved'});
    TableRegistry.setResult({tables:[parsed]});
    const restored=TableRegistry.getTable('T1');
    assert.equal(parsed.rows[0][1],'1');
    assert.equal(restored.rows[0][1],'saved');
    assert.equal(restored.rows[1],parsed.rows[1]);
    CellEditController.apply('T1',1,1,'next');
    const edited=TableRegistry.getTable('T1');
    assert.equal(edited.rows[0],restored.rows[0]);
    assert.equal(restored.rows[1][1],'2');
    CellEditController.undo();
    assert.equal(edited.rows[1][1],'next');
    assert.equal(TableRegistry.getTable('T1').rows[1][1],'2');
  });
  it('applies a cell edit and records history', () => {
    const ok = CellEditController.apply('T1', 0, 0, 'modified');
    assert.equal(ok, true);
    assert.equal(TableRegistry.getRaw()[0].rows[0][0], 'modified');
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
    assert.equal(TableRegistry.getRaw()[0].rows[0][0], 'modified');

    CellEditController.undo();
    assert.equal(TableRegistry.getRaw()[0].rows[0][0], 'x');
    assert.equal(CellEditController.editHistory.length, 0);
    assert.equal(CellEditController.editRedo.length, 1);
  });

  it('redo re-applies the undone edit', () => {
    CellEditController.apply('T1', 0, 0, 'modified');
    CellEditController.undo();
    CellEditController.redo();
    assert.equal(TableRegistry.getRaw()[0].rows[0][0], 'modified');
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
describe('CellEditController — Worker page edits',()=>{
  it('rejects concatenated cells and applies single-source edits and history to the owning card',()=>{
    Store.transition('card:create',{title:'B'});
    const b=Store.curr();
    const session=OTA.require('worker-runtime').WorkerRuntime.createSession();
    const options={format:'csv',headerMode:'first-row'};
    const parse=(id,text)=>session.parse({cardId:id,text,options});
    const sources=[{id:'a',name:'A'},{id:b.id,name:'B'}];
    parse('a','id,label\n1,A');
    const result=parse(b.id,'id,label\n2,B');
    const describe=OTA.require('table-utils').TableUtils;
    TableRegistry.setResult({...result,background:true,tables:result.tables.map(table=>describe.describeTable(table))});
    const preview=()=>session.preview({sources,visible:sources,ui:{},cardUis:Object.fromEntries(
      sources.map(({id})=>[id,Store.getCard(id).ui]))});
    const joined=preview();
    TableRegistry.setPreview(joined);
    const name=joined[0].table.name;
    assert.equal(CellEditController.apply(name,0,1,'wrong'),false);
    assert.equal(Store.transition('cell:edit',{table:name,row:0,col:1,value:'wrong'}),false);
    assert.ok(joined[0].res.rows.every(row=>row._readOnly));
    assert.deepEqual(b.ui.cellEdits,{});
    parse(b.id,'id,other\n2,B');
    TableRegistry.setPreview(preview());
    assert.equal(CellEditController.apply(name,0,1,'A!'),true);
    assert.equal(CellEditController.apply(name+' (B)',0,1,'B!'),true);
    assert.deepEqual(preview().map(item=>item.res.rows[0].d),[['1','A!'],['2','B!']]);
    assert.equal(Store.getCard('a').ui.cellEdits['$'+name][0][1],'A!');
    assert.deepEqual(Object.keys(b.ui.cellEdits),['$'+name]);
    TableRegistry.setPreview([]);
    CellEditController.undo();
    CellEditController.undo();
    assert.deepEqual(preview().map(item=>item.res.rows[0].d),[['1','A'],['2','B']]);
    CellEditController.redo();
    Store.transition('source:replace',{docId:'a',text:'replacement'});
    CellEditController.undo();
    assert.deepEqual(Store.getCard('a').ui.cellEdits,{});
  });
  it('edits projected cells and undoes/redoes after their page has been released',()=>{
    TableRegistry.setResult({background:true,tables:[{name:'T1',headers:['A','B'],rows:[],rowCount:1000,remote:true}]});
    const record={d:['previous'],_sourceRow:100,_sourceCols:[1]};
    TableRegistry.setPreview([{table:TableRegistry.getTable('T1'),res:{rows:[record]}}]);
    assert.equal(CellEditController.apply('T1',100,1,'changed'),true);
    assert.equal(TableRegistry.getCell('T1',100,1),'changed');
    assert.deepEqual(record.d,['previous']); // Cached query pages retain their snapshot values.
    TableRegistry.setPreview([]);
    CellEditController.undo();assert.equal(Store.curr().ui.cellEdits.$T1[100][1],'previous');
    CellEditController.redo();assert.equal(Store.curr().ui.cellEdits.$T1[100][1],'changed');
    assert.deepEqual(TableRegistry.getTable('T1').rows,[]);
  });
});

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
