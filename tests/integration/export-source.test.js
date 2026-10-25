import {afterEach, beforeEach, describe, it} from 'node:test';
import {strict as assert} from 'node:assert/strict';
import readExcelFile, {readSheet} from 'read-excel-file/node';
import {createDOMSandbox} from '../mocks/dom.js';
import {createStorageMock} from '../mocks/storage.js';
import {loadModules} from '../helpers/load-modules.mjs';
import {createLargeTableData} from '../helpers/large-data.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};
let App, Store, Parser, SourceController, ExportController, Exporter, BackgroundService, TableRegistry, WorkerRuntime, QueryService, dom, downloads, messages;

beforeEach(() => {
  dom = createDOMSandbox();
  const {OTA} = loadModules(['app'], {document:dom.document, window:dom.window,
    localStorage:createStorageMock(), CustomEvent:dom.MockCustomEvent, Option:function(text,value){return {text,value};}});
  ({App} = OTA.require('app')); ({Store} = OTA.require('store')); ({Parser} = OTA.require('parser-facade'));
  ({SourceController} = OTA.require('source-controller')); ({ExportController} = OTA.require('export-controller'));
  ({BackgroundService} = OTA.require('background-service')); ({TableRegistry} = OTA.require('table-registry'));
  ({WorkerRuntime} = OTA.require('worker-runtime'));
  ({QueryService} = OTA.require('query-service'));
  downloads = []; messages = [];
  ({Exporter} = OTA.require('exporter'));
  Exporter.download = (filename, blob, type) => downloads.push({filename,blob,type});
  OTA.require('runtime').Toast.show = message => messages.push(message);
  const select = dom.getElementById('targetTableSelect'); select.options = []; select.add = option => select.options.push(option);
  App.init();
  Store.transition('ui:autoParse', {enabled:false});
  Store.transition('ui:persistRaw', {enabled:false});
});

afterEach(async () => {
  SourceController.clearAutoParse(); BackgroundService.cancel();
  await new Promise(resolve => setTimeout(resolve, 10));
  clearTimeout(Store.saveTimer);
});

function replace(text) {
  Store.transition('source:replace', {text}); SourceController.displayText(text);
}
const clickExport = () => dom.getElementById('exportFullBtn').onclick();
const small = 'table-data Items\nvalidflag ID Name\n1 001 Alice\n1 002 Bob';
const large = createLargeTableData({rows:2000}).text;

const exportSource=JSON.stringify({
  Orders:[{id:'001',key:'A',status:'ok'},{id:'002',key:'B',status:'hold'},{id:'003',key:'A',status:'ok'}],
  Products:[{key:'A',label:'Alpha'},{key:'B',label:'Beta'}],
});
const orderSheet={sheet:'Orders',data:[['id','key','status'],['001','A','ok'],['002','B','hold'],['003','A','ok']]};
const productSheet={sheet:'Products',data:[['key','label'],['A','Alpha'],['B','Beta']]};
const projectedOrders={sheet:'Orders',data:[['status','id'],['ok','001'],['hold','002'],['ok','003']]};
const projectedJoin={sheet:'JOIN_OrderLabels',data:[['label','id'],['Alpha','001'],['Beta','002'],['Alpha','003']]};
function prepareExportPair(overrides={}) {
  replace(exportSource);
  Store.transition('document:replaceUI',{docId:Store.curr().id,ui:{
    ...Store.getActiveUI(),displayTables:['Orders'],exportOnlyChecked:true,exportCols:'shown',globalFilter:'status=ok',
    rules:{Orders:{focus:['status','Missing','id']},'JOIN:OrderLabels':{focus:['label','id']}},
    pageSize:1,tablePages:{Orders:3},collapsedTables:{Orders:true},...overrides,
  }});
  Store.transition('view:upsert',{view:{view:'OrderLabels',left:'Orders',right:'Products',type:'inner',on:'key=key',select:'left.id,left.status,right.label'}});
  Store.transition('view:setEnabled',{enabledViews:overrides.enabledViews || ['OrderLabels']});
  assert.equal(App.run(false),true);
  assert.equal(TableRegistry.isBackground(),false);
  const session=WorkerRuntime.createSession();
  session.parse({cardId:'export-pair',text:exportSource});
  const ui=Store.getActiveUI();
  return {session,input:{visible:[{id:'export-pair',name:'Data'}],cardUis:{'export-pair':ui},globalViews:Store.getViews(),ui}};
}

describe('Window and Worker Excel export parity', () => {
  const cases=[
    {name:'raw ignores all analysis/export settings',mode:'raw',ui:{},expected:[orderSheet,productSheet]},
    {name:'full selects tables and projects ordered columns plus JOIN',mode:'full',ui:{},expected:[projectedOrders,projectedJoin]},
    {name:'full includes every source when table selection is disabled',mode:'full',ui:{exportOnlyChecked:false},expected:[projectedOrders,productSheet,projectedJoin]},
    {name:'full can export only an enabled JOIN',mode:'full',ui:{displayTables:[]},expected:[projectedJoin]},
    {name:'full ignores disabled JOINs and keeps all source rows/columns',mode:'full',ui:{enabledViews:[],exportCols:'all'},expected:[orderSheet]},
    {name:'full falls back to all columns when no requested column exists',mode:'full',ui:{enabledViews:[],rules:{Orders:{focus:['Missing']}}},expected:[orderSheet]},
    {name:'preview includes all filtered records regardless of page, collapse and full-export column settings',mode:'preview',ui:{exportCols:'all'},expected:[
      {sheet:'Orders',data:[['status','id'],['ok','001'],['ok','003']]},
      {sheet:'JOIN_OrderLabels',data:[['label','id'],['Alpha','001'],['Alpha','003']]},
    ]},
  ];
  for(const {name,mode,ui,expected} of cases) {
    it(name,async()=>{
      const {session,input}=prepareExportPair(ui);
      const before=structuredClone(TableRegistry.getRaw());
      await ExportController.exportExcel(mode);
      assert.equal(downloads.length,1,messages.join('\n'));
      assert.match(downloads[0].filename,new RegExp(`_${mode}_\\d{8}_\\d{6}\\.xlsx$`));
      const workerBytes=session.excel({...input,mode});
      assert.deepEqual(await readExcelFile(Buffer.from(await downloads[0].blob.arrayBuffer())),expected);
      assert.deepEqual(await readExcelFile(Buffer.from(workerBytes)),expected);
      assert.deepEqual(TableRegistry.getRaw(),before);
      assert.equal(Store.curr().raw,exportSource);
    });
  }

  for(const [mode,limit] of [['raw',12],['full',17],['preview',17]]) {
    it(`${mode} reports the same aggregate budget failure without downloading or losing source`,async()=>{
      const {session,input}=prepareExportPair();
      const before=structuredClone(TableRegistry.getRaw());
      const previous=QueryService.MAX_CELLS;
      try {
        QueryService.MAX_CELLS=limit;
        QueryService.clearCache();
        assert.throws(()=>session.excel({...input,mode}),/预算/);
        await ExportController.exportExcel(mode);
        assert.equal(downloads.length,0);
        assert.ok(messages.some(message=>/预算/.test(message)),messages.join('\n'));
        assert.deepEqual(TableRegistry.getRaw(),before);
        assert.equal(Store.curr().raw,exportSource);
      } finally { QueryService.MAX_CELLS=previous; }
    });
  }
});

describe('Copy formula-protection preference', () => {
  it('writes the existing global preference through the copy control and Store command', () => {
    const control = dom.getElementById('checkFormulaSafe');
    assert.equal(Store.getState().spreadsheetSafe, true);
    control.onchange({target:{checked:false}});
    assert.equal(Store.getState().spreadsheetSafe, false);
    assert.equal(Store.serializeState().spreadsheetSafe, false);
    control.onchange({target:{checked:true}});
    assert.equal(Store.getState().spreadsheetSafe, true);
  });
});

describe('Original source export filenames', () => {
  it('matches the full Excel naming style and preserves the original text', async () => {
    const source='\uFEFF'+small.replace(/\n/g,'\r\n');
    replace(source);
    Store.transition('tab:rename',{id:Store.getDocument().id,title:'排查 / 数据 : 1'});
    Exporter.getTimestamp=()=> '20261009_160708';
    dom.getElementById('exportSourceBtn').onclick();
    await clickExport();
    assert.equal(downloads[0].filename,'排查_数据_1_source_20261009_160708.txt');
    assert.equal(downloads[1].filename,'排查_数据_1_full_20261009_160708.xlsx');
    assert.equal(downloads[0].blob,source);
    assert.equal(downloads[0].type,'text/plain;charset=utf-8');
    assert.equal(Store.getDocument().raw,source);
  });

  it('timestamps each click and exports the full large source independently of parsing', () => {
    replace(large);
    assert.ok(dom.getElementById('rawInput').value.length<large.length);
    Exporter.getTimestamp=()=> '20261009_160708';
    dom.getElementById('exportSourceBtn').onclick();
    const title='Analysis 1';
    Exporter.getTimestamp=()=> '20261009_160709';
    dom.getElementById('exportSourceBtn').onclick();
    assert.equal(downloads[0].filename,`${title.replace(/\s+/g,'_')}_source_20261009_160708.txt`);
    assert.equal(downloads[1].filename,`${title.replace(/\s+/g,'_')}_source_20261009_160709.txt`);
    assert.equal(downloads[0].blob,large);
    assert.equal(downloads[1].blob,large);
    assert.equal(TableRegistry.getRaw().length,0);
  });
});

describe('Excel export prepares the current source', () => {
  it('exports a newly pasted source without clicking parse, including all rows and text IDs', async () => {
    replace(small);
    await clickExport();
    assert.equal(downloads.length, 1);
    const rows = await readSheet(Buffer.from(await downloads[0].blob.arrayBuffer()), 'Items');
    assert.deepEqual(rows, [['validflag','ID','Name'], [1,'001','Alice'], [1,'002','Bob']]);
    assert.equal(Store.getDocument().raw, small);
    assert.equal(Store.getDocument().lastParse.format, 'cli-table-data');
  });

  it('reuses a completed parse and its correction overlay', async () => {
    replace(small); Store.transition('cell:edit', {table:'Items',row:0,col:2,value:'Corrected'});
    const parse = Parser.parse; let calls = 0;
    Parser.parse = (...args) => {calls++; return parse(...args);};
    App.run();
    await clickExport(); await clickExport();
    assert.equal(calls, 1);
    assert.equal(downloads.length, 2);
    const rows = await readSheet(Buffer.from(await downloads[0].blob.arrayBuffer()), 'Items');
    assert.equal(rows[1][2], 'Corrected');
  });

  for(const focus of [['Name','Missing','ID'],['Missing'],[]]) {
    it(`preserves column projection in Window and Worker Excel (${focus.join(',') || 'empty focus'})`,async()=>{
      replace(small);
      Store.transition('rule:set',{table:'Items',field:'focus',value:focus});
      Store.transition('ui:set',{key:'exportCols',value:'shown'});
      await clickExport();
      const session=WorkerRuntime.createSession();session.parse({text:small,cardId:'projection'});
      const ui=Store.getDocument().ui;
      const bytes=session.excel({visible:[{id:'projection',name:'投影卡'}],cardUis:{projection:ui},ui,mode:'full'});
      const expected=focus.includes('Name')?[['Name','ID'],['Alice','001'],['Bob','002']]
        :[['validflag','ID','Name'],[1,'001','Alice'],[1,'002','Bob']];
      assert.deepEqual(await readSheet(Buffer.from(await downloads[0].blob.arrayBuffer()),'Items'),expected);
      assert.deepEqual(await readSheet(Buffer.from(bytes),'Items'),expected);
      assert.deepEqual(TableRegistry.getTable('Items').headers,['validflag','ID','Name']);
    });
  }

  for (const mode of ['raw','preview']) {
    it(`also prepares the source for ${mode} export and preserves that export's semantics`, async () => {
      replace(small);
      Store.transition('filter:global', {value:'ID=001'});
      Store.transition('rule:set', {table:'Items',field:'focus',value:['Name']});
      await dom.getElementById(mode === 'raw' ? 'exportRawBtn' : 'exportPrevBtn').onclick();
      assert.equal(downloads.length, 1);
      const rows = await readSheet(Buffer.from(await downloads[0].blob.arrayBuffer()), 'Items');
      assert.deepEqual(rows, mode === 'raw'
        ? [['validflag','ID','Name'],[1,'001','Alice'],[1,'002','Bob']]
        : [['Name'],['Alice']]);
    });
  }

  it('never reuses the old table during queued source-change notifications', async () => {
    replace(small); App.run();
    replace('table-data New\nvalidflag ID\n1 009');
    await clickExport();
    const rows = await readSheet(Buffer.from(await downloads[0].blob.arrayBuffer()), 'New');
    assert.deepEqual(rows, [['validflag','ID'],[1,'009']]);
  });

  it('preserves a matching temporary header confirmation when source notifications arrive late',async()=>{
    replace('alpha,beta\none,two\nthree,four');
    App.run(false);
    App.rememberHeaderMode('first-row');
    App.run(false);
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(App.getParseOptions().headerMode,'first-row');
    assert.equal(TableRegistry.getFormat(),'csv');
    await clickExport();
    assert.equal(downloads.length,1);
    assert.deepEqual((await readExcelFile(Buffer.from(await downloads[0].blob.arrayBuffer())))[0].data,
      [['alpha','beta'],['one','two'],['three','four']]);
  });

  it('respects explicit parser and header choices instead of forcing automatic detection', async () => {
    replace('id,name\n001,Alice'); App.run();
    Store.transition('import:setFormat', {format:'csv'}); dom.getElementById('formatSelect').value = 'csv';
    Store.transition('import:setHeaderMode', {mode:'none'}); dom.getElementById('headerModeSelect').value = 'none';
    await clickExport();
    assert.equal(TableRegistry.getFormat(), 'csv');
    assert.deepEqual(TableRegistry.getRaw()[0].rows, [['id','name'],['001','Alice']]);
  });

  it('waits for an existing background parse and prevents duplicate export clicks', async () => {
    replace(large); const pending = deferred(); let parses = 0, exports = 0;
    BackgroundService.parse = () => {parses++; return pending.promise;};
    BackgroundService.export = async () => {exports++; return new Blob(['xlsx']);};
    const parsing = App.run(); const exporting = clickExport(); await clickExport();
    assert.equal(parses, 1); assert.equal(downloads.length, 0);
    pending.resolve(Parser.parse(large, {format:'auto'})); await parsing; await exporting;
    assert.equal(parses, 1); assert.equal(exports, 1); assert.equal(downloads.length, 1);
    assert.ok(messages.some(message => message.includes('导出正在进行')));
  });

  it('shares one pending parse between export and diagnostics', async () => {
    replace(large);
    const pending=deferred(); let parses=0, opened=0;
    BackgroundService.parse=()=>{parses++;return pending.promise;};
    BackgroundService.export=async()=>new Blob(['xlsx']);
    App.showDiagnostics=()=>{opened++;};
    const parsing=App.run();
    const exporting=clickExport();
    const diagnostics=App.showCardDiagnostics(Store.curr().id);
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(parses,1);
    pending.resolve(Parser.parse(large,{format:'auto'}));
    assert.equal(await parsing,true);
    assert.equal(await diagnostics,true);
    await exporting;
    assert.equal(parses,1);
    assert.equal(opened,1);
    assert.equal(downloads.length,1);
  });

  it('cancels export and diagnostics immediately even when a parse transport finishes late', async () => {
    replace(large);
    const late=deferred(); let opened=0;
    BackgroundService.parse=()=>late.promise;
    App.showDiagnostics=()=>{opened++;};
    const exporting=clickExport();
    const diagnostics=App.showCardDiagnostics(Store.curr().id);
    await new Promise(resolve=>setTimeout(resolve,10));
    dom.getElementById('cancelJobBtn').onclick();
    const cancelled=await Promise.race([
      Promise.all([exporting,diagnostics]).then(()=>true),
      new Promise(resolve=>setTimeout(()=>resolve(false),40)),
    ]);
    // Always release the held transport, including on the old implementation.
    late.resolve(Parser.parse(large,{format:'auto'}));
    await Promise.all([exporting,diagnostics]);
    assert.equal(cancelled,true,'waiting consumers must not depend on a late transport response');
    assert.equal(SourceController.getCardStatus(Store.curr().id).state,'pending');
    assert.equal(opened,0);
    assert.equal(downloads.length,0);
    assert.equal(Store.curr().raw,large);
  });

  it('does not let an old parse finish or clear a newer parse after cancel and retry', async () => {
    replace(large);
    const old=deferred(),next=deferred();let parses=0;
    BackgroundService.parse=()=>++parses===1?old.promise:next.promise;
    const first=App.run();
    dom.getElementById('cancelJobBtn').onclick();
    assert.equal(SourceController.getCardStatus(Store.curr().id).state,'pending');
    const second=App.run();
    old.resolve(Parser.parse(large,{format:'auto'}));
    assert.equal(await first,false);
    assert.equal(SourceController.getCardStatus(Store.curr().id).state,'parsing');
    assert.equal(dom.getElementById('previewArea')['aria-busy'],'true');
    next.resolve(Parser.parse(large,{format:'auto'}));
    assert.equal(await second,true);
    assert.equal(SourceController.getCardStatus(Store.curr().id).state,'ready');
    assert.equal(dom.getElementById('previewArea')['aria-busy'],'false');
  });

  for(const mutation of ['source','card','format','header']) {
    it(`rejects both waiting consumers when ${mutation} changes during extraction`,async()=>{
      replace(large);
      const held=deferred();let parses=0,opened=0;
      BackgroundService.parse=payload=>++parses===1?held.promise:Promise.resolve(Parser.parse(payload.text,payload.options));
      App.showDiagnostics=()=>{opened++;};
      const exporting=clickExport();
      const diagnostics=App.showCardDiagnostics(Store.curr().id);
      await new Promise(resolve=>setTimeout(resolve,10));
      if(mutation==='source') replace(small);
      if(mutation==='card') Store.transition('card:create');
      if(mutation==='format') {
        Store.transition('import:setFormat',{format:'csv'});
        dom.getElementById('formatSelect').value='csv';
      }
      if(mutation==='header') {
        Store.transition('import:setHeaderMode',{mode:'none'});
        dom.getElementById('headerModeSelect').value='none';
      }
      held.resolve(Parser.parse(large,{format:'auto'}));
      assert.equal(await diagnostics,false);
      await exporting;
      assert.equal(opened,0);
      assert.equal(downloads.length,0);
      assert.ok(messages.some(message=>message.includes('数据源或解析设置已变化')));
    });
  }

  for(const format of ['auto','cli-table-data']) {
    it(`keeps rich clipboard table-data parsing and full Excel in the background (${format})`,async()=>{
      const html=format==='auto'?'<pre>copied CLI output</pre>':'<table><tr><td>unrelated HTML table</td></tr></table>';
      SourceController.captureClipboard({types:['text/plain','text/html'],getData:type=>type==='text/plain'?large:type==='text/html'?html:''});
      Store.transition('source:replace',{text:large,preservePaste:true});SourceController.displayText(large);
      Store.transition('import:setFormat',{format});dom.getElementById('formatSelect').value=format;
      const session=WorkerRuntime.createSession();let parses=0,exports=0;
      BackgroundService.parse=async payload=>{parses++;BackgroundService.datasetKeys.add(payload.cardId || payload.key);return structuredClone(session.parse({text:payload.text,options:payload.options,cardId:payload.cardId || payload.key}));};
      BackgroundService.export=async(input,mode)=>{exports++;return new Blob([session.excel({visible:input.visible,cardUis:input.cardUis,ui:input.ui,globalViews:input.globalViews,mode})]);};
      await clickExport();
      assert.equal(TableRegistry.getFormat(),'cli-table-data');assert.equal(TableRegistry.isBackground(),true);
      assert.equal(parses,1);assert.equal(exports,1);assert.equal(downloads.length,1);
      const rows=await readSheet(Buffer.from(await downloads[0].blob.arrayBuffer()),'Wide');
      assert.equal(rows.length,2001);assert.equal(rows[0].length,32);assert.equal(rows[2000][1],2000);
      assert.equal(Store.getDocument().raw,large);
    });
  }

  it('stops the parse/export chain on cancellation and allows retry with the intact original', async () => {
    replace(large); const pending = deferred();
    BackgroundService.parse = () => pending.promise;
    const exporting = clickExport();
    dom.getElementById('cancelJobBtn').onclick();
    pending.reject(Object.assign(new Error('cancelled'), {name:'AbortError'})); await exporting;
    assert.equal(downloads.length, 0); assert.equal(Store.getDocument().raw, large);
    BackgroundService.parse = async () => Parser.parse(large, {format:'auto'});
    BackgroundService.export = async () => new Blob(['xlsx']);
    await clickExport(); assert.equal(downloads.length, 1);
  });

  it('clears the old preview when source changes after cancelling a completed extraction',async()=>{
    replace(small);App.run();
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(TableRegistry.getRaw().length,1);
    dom.getElementById('cancelJobBtn').onclick();
    replace('table-data New\nvalidflag ID\n1 009');
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(TableRegistry.getFormat(),'empty');
    assert.equal(TableRegistry.getRaw().length,0);
  });

  it('stops an export when the source changes while its initial parse is pending', async () => {
    replace(large); const pending = deferred(); let exports = 0;
    BackgroundService.parse = () => pending.promise;
    BackgroundService.export = async () => {exports++; return new Blob(['old xlsx']);};
    const exporting = clickExport(); replace(small);
    pending.resolve(Parser.parse(large, {format:'auto'})); await exporting;
    assert.equal(exports, 0); assert.equal(downloads.length, 0);
    assert.equal(Store.getDocument().raw, small);
    assert.ok(messages.some(message => message.includes('数据源或解析设置已变化')));
  });

  it('checks cancellation again immediately before downloading an already generated workbook', async () => {
    replace(large); BackgroundService.parse = async () => Parser.parse(large, {format:'auto'});
    await App.run();
    BackgroundService.export = async () => {
      const blob = new Blob(['ready workbook']);
      queueMicrotask(() => dom.getElementById('cancelJobBtn').onclick());
      return blob;
    };
    await clickExport();
    assert.equal(downloads.length, 0);
  });

  for (const mutation of ['source', 'tab', 'format']) {
    it(`does not download an old workbook when ${mutation} changes during serialization`, async () => {
      replace(large); BackgroundService.parse = async () => Parser.parse(large, {format:'auto'});
      await App.run(); await new Promise(resolve => setTimeout(resolve, 10));
      const pending = deferred(), started = deferred();
      BackgroundService.export = () => {started.resolve(); return pending.promise;};
      const exporting = clickExport(); await started.promise;
      if(mutation === 'source') replace(small);
      if(mutation === 'tab') Store.transition('tab:create', {});
      if(mutation === 'format') {Store.transition('import:setFormat', {format:'csv'}); dom.getElementById('formatSelect').value = 'csv';}
      pending.resolve(new Blob(['old xlsx'])); await exporting;
      assert.equal(downloads.length, 0);
      assert.ok(messages.some(message => message.includes('数据源或解析设置已变化')));
    });
  }

  it('shows parse failure and keeps the original instead of exporting old tables', async () => {
    replace(small); App.run(); replace('{broken JSON');
    Store.transition('import:setFormat', {format:'json'}); dom.getElementById('formatSelect').value = 'json';
    const previous = console.error; console.error = () => {};
    try {await clickExport();} finally {console.error = previous;}
    assert.equal(downloads.length, 0); assert.equal(TableRegistry.getFormat(), 'error');
    assert.equal(Store.getDocument().raw, '{broken JSON');
    assert.ok(messages.some(message => message.includes('解析失败')));
  });

  it('blocks workbook export until an ambiguous header interpretation is confirmed', async () => {
    const ambiguous = 'alpha,beta\none,two\nthree,four';
    replace(ambiguous);
    await clickExport();
    assert.equal(downloads.length, 0);
    assert.equal(TableRegistry.getFormat(), 'ambiguous');
    assert.ok(messages.some(message => message.includes('请先在解析详情中确认')));
    assert.equal(Store.getDocument().raw, ambiguous);
  });

  it('reports empty source without generating a workbook', async () => {
    replace(''); await clickExport();
    assert.equal(downloads.length, 0); assert.ok(messages.some(message => message.includes('无数据可导出')));
  });
});
