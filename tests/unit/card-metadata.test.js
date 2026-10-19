import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from '../helpers/load-modules.mjs';
import { createStorageMock } from '../mocks/storage.js';

let Store, TableRegistry;
beforeEach(() => {
  const { OTA } = loadModules(['table-registry'], { localStorage:createStorageMock() });
  ({ Store } = OTA.require('store'));
  ({ TableRegistry } = OTA.require('table-registry'));
  Store.state.docs = [{ id:'a', title:'数据段 1', raw:'id\n1', sourceRevision:2, ui:{importFormat:'csv', importHeaderMode:'first-row'} }];
  Store.state.projects = [{ id:'p', title:'Analysis 1', cardIds:['a'], activeCardId:'a', views:[], enabledViews:[] }];
  Store.state.activeProjectId = 'p';
});

const context = () => ({ docId:'a', sourceRevision:2, options:{format:'csv', headerMode:'first-row'} });

describe('TableRegistry card and pool metadata', () => {
  it('reports full filtered preview counts, not just the current page', () => {
    TableRegistry.setPreview([{table:{name:'Pooled', rows:[], remote:true, rowCount:200000}, res:{totalRows:150000, rows:[]}},
      {table:{name:'JOIN:V', isView:true, rows:[]}, res:{totalRows:5, rows:[]}}]);
    assert.deepEqual(TableRegistry.getPreviewSummary(), {tableCount:2, rowCount:150005});
    assert.deepEqual(TableRegistry.getPoolNames(), ['Pooled','JOIN:V']);
    TableRegistry.setResult(null);
    assert.equal(TableRegistry.getPreviewSummary(), null);
  });

  it('invalidates counts on strategy changes and accepts temporary confirmations without changing saved strategies', () => {
    TableRegistry.recordParse(context(), {format:'ambiguous', tables:[]});
    assert.equal(TableRegistry.getCardSummary('a').format, 'ambiguous');
    Store.transition('import:setHeaderMode', {mode:'auto'});
    assert.equal(TableRegistry.getCardSummary('a'), null);
    assert.equal(TableRegistry.recordParse({...context(), config:{format:'csv', headerMode:'auto'}},
      {format:'csv', label:'CSV', tables:[{rows:[['1']], headers:['id']}]}), true);
    assert.equal(TableRegistry.getCardSummary('a').rowCount, 1);
  });

  it('keeps only bounded parse counts for a card, with Worker row counts rather than page length', () => {
    const result = {format:'csv', label:'CSV', tables:[{name:'CSV Table 1', headers:['id'], rows:[], rowCount:200000, remote:true}]};
    assert.equal(TableRegistry.recordParse(context(), result), true);
    assert.deepEqual(TableRegistry.getCardSummary('a'), {format:'csv', label:'CSV', tableCount:1, rowCount:200000});
    assert.equal('tables' in TableRegistry.getCardSummary('a'), false);
    Store.transition('source:replace', {text:'id\n2'});
    assert.equal(TableRegistry.getCardSummary('a'), null, 'changed source cannot reuse old counts');
    assert.equal(TableRegistry.recordParse(context(), result), false, 'late metadata must be rejected');
  });
});
