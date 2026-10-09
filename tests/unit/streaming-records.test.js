import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {loadModules} from '../helpers/load-modules.mjs';

describe('incremental text consumption',()=>{
  it('yields complete quoted records before consuming an unfinished tail',()=>{
    const {OTA}=loadModules(['delimited']);const {Delimited}=OTA.require('delimited');
    const diagnostics=[];const records=Delimited.records('\uFEFF"first\r\nsecond","a""b"\r\n"unfinished',',',diagnostics);
    assert.deepEqual(records.next().value,['first\nsecond','a"b']);assert.deepEqual(diagnostics,[]);
    assert.deepEqual(records.next().value,['unfinished']);assert.equal(diagnostics[0].code,'UNCLOSED_QUOTE');
    assert.equal(records.next().done,true);
  });
  it('preserves the exact body-cell budget while consuming CSV records',()=>{
    const {OTA}=loadModules(['import-engine']);const {TableUtils}=OTA.require('table-utils');const {ImportEngine}=OTA.require('import-engine');
    TableUtils.MAX_CELLS=4;
    const input='ID,Name\n1,A\n2,B';
    assert.deepEqual(ImportEngine.parse(input,{format:'csv',headerMode:'first-row'}).tables[0].rows,[['1','A'],['2','B']]);
    assert.throws(()=>ImportEngine.parse(input+'\n3,C',{format:'csv',headerMode:'first-row'}),/预算/);
  });
  it('iterates CLI line endings without building a complete split list',()=>{
    const {OTA}=loadModules(['table-utils']);const {TableUtils}=OTA.require('table-utils');
    assert.deepEqual([...TableUtils.iterLines('\uFEFFfirst\r\nsecond\rthird\n')],['first','second','third','']);
  });
});
