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
    assert.equal(ImportEngine.parse(text,{lastSuccessfulFormat:'semicolon-csv'}).format,'ambiguous');
  });

  it('detects a large single-line data block using bounded structural evidence',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const text='data Records ['+Array(15000).fill('{id:1,name:"Alice"}').join(',')+']';
    const result=ImportEngine.parse(text);assert.equal(result.format,'data-block');assert.equal(result.tables[0].rows.length,15000);
    assert.equal(result.diagnostics.some(item=>item.code==='UNCLOSED_DATA_BLOCK'),false);
  });

  it('extracts exact rectangular CSV regions from mixed prose and preserves quoted multiline values',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const text=[
      '库存报告 · 导出时间 10:30',
      '筛选条件：状态=正常',
      'id,name,note',
      '001,Alice,"含逗号,和换行',
      '第二行"',
      '002,Bob,ok',
      '共 2 条记录'
    ].join('\n');
    const result=ImportEngine.parse(text);
    assert.equal(result.format,'csv');
    assert.equal(result.tables.length,1);
    assert.deepEqual(result.tables[0].headers,['id','name','note']);
    assert.deepEqual(result.tables[0].rows,[['001','Alice','含逗号,和换行\n第二行'],['002','Bob','ok']]);
    assert.equal(result.tables[0].meta.sourceRange.start,text.indexOf('id,name,note'));
    assert.ok(result.diagnostics.some(item=>item.code==='TABLE_REGIONS_EXTRACTED'));
  });

  it('maps extracted region offsets back to original BOM and CRLF source positions',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const text='\uFEFF报告\r\nid,name\r\n001,Alice\r\n002,Bob';
    const result=ImportEngine.parse(text);
    assert.equal(result.format,'csv');
    assert.equal(result.tables[0].meta.sourceRange.start,text.indexOf('id,name'));
    assert.equal(result.tables[0].meta.sourceRange.end,text.length);
  });

  it('returns separate rectangular tables when mixed prose separates same-format regions',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const text='导出一\nid,name\n001,Alice\n第一段结束\n导出二\ncode,status\nX1,ok\nX2,hold\n';
    const result=ImportEngine.parse(text);
    assert.equal(result.format,'csv');
    assert.equal(result.tables.length,2);
    assert.deepEqual(result.tables.map(table=>table.headers),[['id','name'],['code','status']]);
    assert.deepEqual(result.tables.map(table=>table.rows),[[['001','Alice']],[['X1','ok'],['X2','hold']]]);
    assert.deepEqual(result.tables.map(table=>table.meta.sourceRange.start),[text.indexOf('id,name'),text.indexOf('code,status')]);
  });

  it('extracts fixed-width rows from surrounding prose when the parser is explicitly selected',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const text='设备巡检报告\n设备范围：机房 A\nid    name    status\n001   Alice   ok\n002   Bob     hold\n共 2 台设备';
    const result=ImportEngine.parse(text,{format:'fixed-width'});
    assert.equal(result.format,'fixed-width');
    assert.deepEqual(result.tables[0].headers,['id','name','status']);
    assert.deepEqual(result.tables[0].rows,[['001','Alice','ok'],['002','Bob','hold']]);
    assert.equal(result.tables[0].meta.sourceRange.start,text.indexOf('id    name'));
  });

  it('uses aligned-table parsing on isolated aligned regions surrounded by prose',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const text='运行摘要\nID    Name     Status\n001   Alice    ok\n002   Bob      hold\n共 2 项';
    const result=ImportEngine.parse(text,{format:'aligned-table'});
    assert.equal(result.format,'aligned-table');
    assert.deepEqual(result.tables[0].headers,['ID','Name','Status']);
    assert.deepEqual(result.tables[0].rows,[['001','Alice','ok'],['002','Bob','hold']]);
    assert.equal(result.tables[0].meta.sourceRange.start,text.indexOf('ID    Name'));
  });

  it('asks before accepting a delimited region with unstable row widths, then preserves overflow when confirmed',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const text='报告\nid,name\n1,Alice\nbad,too,many,fields\n2,Bob\n结束';
    const result=ImportEngine.parse(text);
    assert.equal(result.format,'ambiguous');
    assert.deepEqual(result.tables,[]);
    assert.equal(result.candidates[0].kind,'region-set');
    assert.ok(result.candidates[0].preview.includes('bad,too,many,fields'));
    assert.equal(Object.hasOwn(result.candidates[0],'score'),false);
    const confirmed=ImportEngine.parse(text,{regionSelection:result.candidates[0].regionSelection});
    assert.equal(confirmed.format,'csv');
    assert.deepEqual(confirmed.tables[0].rows[1],['bad','too','many','fields']);
    assert.ok(confirmed.diagnostics.some(item=>item.code==='ROW_WIDTH_MISMATCH'));
  });

  it('asks for format confirmation on a small delimiter tie even when a format was used previously',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const text='id,name;state\n1,Alice;ok';
    const result=ImportEngine.parse(text,{lastSuccessfulFormat:'semicolon-csv'});
    assert.equal(result.format,'ambiguous');
    assert.deepEqual(result.tables,[]);
    assert.ok(result.candidates.some(item=>item.id==='csv'));
    assert.ok(result.candidates.some(item=>item.id==='semicolon-csv'));
    assert.ok(result.diagnostics.some(item=>item.code==='FORMAT_AMBIGUOUS'));
    assert.equal(ImportEngine.parse(text,{format:'csv'}).format,'csv');
  });

  it('asks whether an ambiguous first row is a header before returning a table',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const text='alpha,beta\none,two\nthree,four';
    const result=ImportEngine.parse(text);
    assert.equal(result.format,'ambiguous');
    assert.deepEqual(result.tables,[]);
    assert.deepEqual(result.candidates.filter(item=>item.kind==='header-mode').map(item=>item.headerMode),['first-row','none']);
    const confirmed=ImportEngine.parse(text,{headerMode:'first-row'});
    assert.equal(confirmed.format,'csv');
    assert.deepEqual(confirmed.tables[0].headers,['alpha','beta']);
    assert.deepEqual(confirmed.tables[0].rows,[['one','two'],['three','four']]);
  });
});
