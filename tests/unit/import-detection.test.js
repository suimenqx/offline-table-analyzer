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

  it('parses a delimited region with unstable row widths and preserves overflow immediately',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const text='报告\nid,name\n1,Alice\nbad,too,many,fields\n2,Bob\n结束';
    const result=ImportEngine.parse(text);
    assert.equal(result.format,'csv');
    assert.equal(result.tables.length,1);
    assert.deepEqual(result.tables[0].rows[1],['bad','too','many','fields']);
    assert.ok(result.diagnostics.some(item=>item.code==='ROW_WIDTH_MISMATCH'));
    assert.equal(result.tables[0].meta.sourceRange.start,text.indexOf('id,name'));
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

  it('resolves a comma and semicolon tie using repeated intact decimal fields before header inference',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const header='sku;price (EUR, incl. tax);tax (EUR, incl. fee)';
    const rows=[['S-001','12,50','1,20'],['S-002','9,90','0,99'],['S-003','10,50','1,05']];
    const input='\uFEFF'+[header,...rows.map(row=>row.join(';'))].join('\r\n');

    for(const headerMode of ['auto','first-row','none']) {
      const result=ImportEngine.parse(input,{headerMode});
      assert.equal(result.format,'semicolon-csv');
      assert.deepEqual(result.tables[0].rows.slice(-rows.length),rows);
      assert.deepEqual(result.tables[0].meta.sourceRange,{start:1,end:input.length});
      assert.equal(result.diagnostics.some(item=>item.code==='FORMAT_AMBIGUOUS'),false);
      assert.ok(result.diagnostics.some(item=>item.code==='DELIMITER_VALUE_EVIDENCE'));
    }
    const manual=ImportEngine.parse(input,{format:'csv',headerMode:'first-row'});
    assert.deepEqual(manual.tables[0].rows[0],['S-001;12','50;1','20']);
  });

  it('uses the same delimiter evidence for TSV with quoted multiline records',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const input='id\tprice (EUR, incl. tax)\ttax (EUR, incl. fee)\tnote\n'
      +'1\t12,50\t1,20\t"a\nb"\n2\t9,90\t0,99\t"c\nd"\n3\t10,50\t1,05\t"e\nf"';
    const result=ImportEngine.parse(input,{headerMode:'first-row'});
    assert.equal(result.format,'excel-paste');
    assert.deepEqual(result.tables[0].rows,[['1','12,50','1,20','a\nb'],['2','9,90','0,99','c\nd'],['3','10,50','1,05','e\nf']]);
  });

  it('preserves a repeated fractional timestamp as one field',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const input='device;time (local, ms);status (old, new)\n'
      +'A;14:02:30,123;UP,OK\nB;16:45:11,200;UP,OK\nC;09:10:53,011;DOWN,ERR';
    const result=ImportEngine.parse(input,{headerMode:'first-row'});
    assert.equal(result.format,'semicolon-csv');
    assert.deepEqual(result.tables[0].rows.map(row=>row[1]),['14:02:30,123','16:45:11,200','09:10:53,011']);
  });

  it('keeps comma-separated integers and abstains when only one column looks like comma decimals',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const integers=ImportEngine.parse('left,right\n12,50\n9,90\n10,50',{headerMode:'first-row'});
    assert.equal(integers.format,'csv');
    assert.deepEqual(integers.tables[0].rows,[['12','50'],['9','90'],['10','50']]);

    const uncertain=ImportEngine.parse('count,rate;note\n12,50;3\n9,90;4\n10,50;5');
    assert.equal(uncertain.format,'ambiguous');
    assert.deepEqual(uncertain.tables,[]);
  });

  it('does not use evidence from one table region to guess how a second region should be split',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const first='sku;price (EUR, incl. tax);tax (EUR, incl. fee)\n'
      +'S-001;12,50;1,20\nS-002;9,90;0,99\nS-003;10,50;1,05';
    const second='count,rate;note\n12,50;3\n9,90;4\n10,50;5';
    const result=ImportEngine.parse(first+'\n\n'+second);
    assert.equal(result.format,'ambiguous');
    assert.deepEqual(result.tables,[]);
  });

  it('expands past a confident prose sample to find a later table region with full-source offsets',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    // The first 64-record sampling round sees only prose and settles on
    // plain-text; expansion must keep looking so the CSV region and its
    // original source offsets survive detection and full-source parsing.
    const padding=Array.from({length:70},(_,i)=>'no delimiters in this padding line '+i).join('\n');
    const table=['id,name',...Array.from({length:20},(_,i)=>'0'+(i+1)+',Row'+(i+1))].join('\n');
    const text=`${padding}\n${table}\n共 20 条记录`;
    const result=ImportEngine.parse(text);
    assert.equal(result.format,'csv');
    assert.equal(result.tables.length,1);
    assert.deepEqual(result.tables[0].headers,['id','name']);
    assert.equal(result.tables[0].rows.length,20);
    assert.equal(result.tables[0].meta.sourceRange.start,text.indexOf('id,name'));
    assert.ok(result.diagnostics.some(item=>item.code==='TABLE_REGIONS_EXTRACTED'));
  });

  it('shows the inferred header result and offers an inline header alternative',()=>{
    const {OTA}=loadModules(['import-engine']);const {ImportEngine}=OTA.require('import-engine');
    const text='alpha,beta\none,two\nthree,four';
    const result=ImportEngine.parse(text);
    assert.equal(result.format,'csv');
    assert.equal(result.tables.length,1);
    assert.equal(result.tables[0].meta.headerAmbiguous,true);
    assert.ok(result.diagnostics.some(item=>item.code==='HEADER_AMBIGUOUS'));
    assert.deepEqual(result.candidates.filter(item=>item.kind==='header-mode').map(item=>item.headerMode),['first-row','none']);
    assert.deepEqual(result.tables[0].headers,['Column1','Column2']);
    assert.deepEqual(result.tables[0].rows,[['alpha','beta'],['one','two'],['three','four']]);
    const changed=ImportEngine.parse(text,{headerMode:'first-row'});
    assert.equal(changed.format,'csv');
    assert.deepEqual(changed.tables[0].headers,['alpha','beta']);
    assert.deepEqual(changed.tables[0].rows,[['one','two'],['three','four']]);
  });
});
