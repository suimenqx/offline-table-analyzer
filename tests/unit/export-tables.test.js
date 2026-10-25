import {beforeEach, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {loadModules} from '../helpers/load-modules.mjs';

let QueryService, input;
beforeEach(() => {
  const {OTA}=loadModules(['query-service']);
  ({QueryService}=OTA.require('query-service'));
  input={
    rawTables:[
      {name:'Orders',headers:['id','key','status'],rows:[['001','A','ok'],['002','B','hold'],['003','A','ok']]},
      {name:'Products',headers:['key','label'],rows:[['A','Alpha'],['B','Beta']]},
    ],
    globalViews:[{view:'OrderLabels',left:'Orders',right:'Products',type:'inner',on:'key=key',select:'left.id,left.status,right.label'}],
    ui:{displayTables:['Orders'],enabledViews:['OrderLabels'],exportOnlyChecked:true,exportCols:'shown',
      rules:{Orders:{focus:['status','Missing','id']},'JOIN:OrderLabels':{focus:['label','id']}},
      globalFilter:'id=001',pageSize:1,tablePages:{Orders:3},collapsedTables:{Orders:true}},
  };
});

describe('QueryService Excel table contract', () => {
  it('raw preserves every source table and ignores selection, JOIN, filters and projection', () => {
    const before=structuredClone(input);
    assert.deepEqual(QueryService.getExportTables(input,'raw'),input.rawTables);
    assert.deepEqual(input,before);
  });

  it('full selects raw tables and enabled JOINs, projects columns in requested order, and keeps every row', () => {
    const before=structuredClone(input);
    assert.deepEqual(QueryService.getExportTables(input,'full'),[
      {name:'Orders',headers:['status','id'],rows:[['ok','001'],['hold','002'],['ok','003']]},
      {name:'JOIN:OrderLabels',headers:['label','id'],rows:[['Alpha','001'],['Beta','002'],['Alpha','003']]},
    ]);
    assert.deepEqual(input,before);
  });

  it('preview exports all matching records and projected columns independently of pages and collapse state', () => {
    input.ui.globalFilter='status=ok';
    const before=structuredClone(input);
    assert.deepEqual(QueryService.getExportTables(input,'preview'),[
      {name:'Orders',headers:['status','id'],rows:[['ok','001'],['ok','003']]},
      {name:'JOIN:OrderLabels',headers:['label','id'],rows:[['Alpha','001'],['Alpha','003']]},
    ]);
    assert.deepEqual(input,before);
  });

  it('full includes unselected raw tables when exportOnlyChecked is off and ignores disabled views', () => {
    input.ui.exportOnlyChecked=false;
    input.ui.exportCols='all';
    input.ui.enabledViews=[];
    assert.deepEqual(QueryService.getExportTables(input,'full'),input.rawTables);
  });

  for(const focus of [[],['Missing']]) {
    it(`falls back to all columns when focus is ${focus.length?'invalid':'empty'}`, () => {
      input.ui.enabledViews=[];
      input.ui.rules.Orders.focus=focus;
      const before=structuredClone(input);
      assert.deepEqual(QueryService.getExportTables(input,'full'),[input.rawTables[0]]);
      assert.deepEqual(input,before);
    });
  }

  it('exports enabled JOINs when no raw table is checked and returns no tables when nothing is selected', () => {
    input.ui.displayTables=[];
    assert.deepEqual(QueryService.getExportTables(input,'full').map(table=>table.name),['JOIN:OrderLabels']);
    input.ui.enabledViews=[];
    assert.deepEqual(QueryService.getExportTables(input,'full'),[]);
    assert.deepEqual(QueryService.getExportTables(input,'preview'),[]);
    assert.deepEqual(QueryService.getExportTables({},'raw'),[]);
  });

  it('enforces the combined raw-table budget before serialization without modifying input', () => {
    const before=structuredClone(input);
    QueryService.MAX_CELLS=12;
    assert.throws(()=>QueryService.getExportTables(input,'raw'),/预算/);
    assert.deepEqual(input,before);
    QueryService.MAX_CELLS=13;
    assert.deepEqual(QueryService.getExportTables(input,'raw'),input.rawTables);
  });

  for(const mode of ['full','preview']) {
    it(`${mode} budgets selected raw tables and JOIN expansion together before column projection`, () => {
      const before=structuredClone(input);
      QueryService.MAX_CELLS=17;
      assert.throws(()=>QueryService.getExportTables(input,mode),/预算/);
      assert.deepEqual(input,before);
      QueryService.MAX_CELLS=18;
      assert.equal(QueryService.getExportTables(input,mode).length,2);
    });
  }
});
