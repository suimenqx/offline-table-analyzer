import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {loadModules} from '../helpers/load-modules.mjs';
import {createLargeTableData} from '../helpers/large-data.mjs';

describe('bounded automatic detection',()=>{
  it('recognizes a wide CSV with delimiter-like cell contents and parses the full source once',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const headers=Array.from({length:32},(_,i)=>`F${i+1}`);
    const row=Array.from({length:32},(_,i)=>i===31?'alpha;beta|gamma':String(i+1)).join(',');
    const text=[headers.join(','),...Array(10000).fill(row)].join('\n');
    const calls=[];
    for(const parser of ImportEngine.parsers){const original=parser.parse;parser.parse=function(source,options){calls.push({id:this.id,length:source.text.length});return original.call(this,source,options);};}
    const result=ImportEngine.parse(text);
    assert.equal(result.format,'csv');assert.equal(result.tables[0].headers.length,32);
    assert.equal(result.tables[0].rows.length,10000);assert.equal(result.tables[0].rows.at(-1)[31],'alpha;beta|gamma');
    assert.deepEqual(calls.filter(call=>call.length===text.length).map(call=>call.id),['csv']);
    assert.ok(calls.filter(call=>call.length!==text.length).every(call=>call.length<=ImportEngine.MAX_SAMPLE_CHARS));
  });

  it('detects without full-source adapter work, preserving quoted multiline record boundaries',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const record='001,"'+('quoted\n'.repeat(2500))+'tail",ok';
    const text='id,note,status\r\n'+Array(30).fill(record).join('\r\n');
    const detection=ImportEngine.detect(text);
    assert.equal(detection.format,'csv');assert.ok(detection.sampleLength<=ImportEngine.MAX_SAMPLE_CHARS);
    const parsed=ImportEngine.parse(text);assert.equal(parsed.tables[0].rows.length,30);
    assert.ok(parsed.tables[0].rows[0][1].endsWith('tail'));
    assert.equal(parsed.diagnostics.some(item=>item.code==='UNCLOSED_QUOTE'),false);
  });

  it('keeps hard signatures and explicit formats authoritative without candidate probes',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const fixture=createLargeTableData({rows:1500});
    const result=ImportEngine.detect(fixture.text,{lastSuccessfulFormat:'csv'});
    assert.equal(result.format,'cli-table-data');assert.equal(result.sampleLength,0);
    assert.equal(ImportEngine.detect('id,name;state\n1,Alice;ok',{format:'semicolon-csv'}).format,'semicolon-csv');
  });

  it('surfaces unresolved large-input ambiguity instead of exporting a guessed table',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const text='id,name;state\n'+Array(30000).fill('1,Alice;ok').join('\n');
    const result=ImportEngine.parse(text);
    assert.equal(result.format,'ambiguous');assert.deepEqual(result.tables,[]);
    assert.ok(result.candidates.length>1);assert.ok(result.diagnostics.some(item=>item.code==='FORMAT_AMBIGUOUS'));
    assert.equal(ImportEngine.parse(text,{format:'csv'}).tables[0].rows.length,30000);
    assert.equal(ImportEngine.parse(text,{lastSuccessfulFormat:'semicolon-csv'}).format,'semicolon-csv');
  });

  it('detects a large single-line data block using bounded structural evidence',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const text='data Records ['+Array(15000).fill('{id:1,name:"Alice"}').join(',')+']';
    const result=ImportEngine.parse(text);assert.equal(result.format,'data-block');assert.equal(result.tables[0].rows.length,15000);
    assert.equal(result.diagnostics.some(item=>item.code==='UNCLOSED_DATA_BLOCK'),false);
  });
});
