import {afterEach, beforeEach, describe, it} from 'node:test';
import {strict as assert} from 'node:assert/strict';
import {readSheet} from 'read-excel-file/node';
import {createDOMSandbox} from '../mocks/dom.js';
import {createStorageMock} from '../mocks/storage.js';
import {loadModules} from '../helpers/load-modules.mjs';
import {createLargeTableData} from '../helpers/large-data.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};
let App, Store, Parser, SourceController, ExportController, Exporter, BackgroundService, TableRegistry, WorkerRuntime, dom, downloads, messages;

beforeEach(() => {
  dom = createDOMSandbox();
  const {OTA} = loadModules(['app'], {document:dom.document, window:dom.window,
    localStorage:createStorageMock(), CustomEvent:dom.MockCustomEvent, Option:function(text,value){return {text,value};}});
  ({App} = OTA.require('app')); ({Store} = OTA.require('store')); ({Parser} = OTA.require('parser-facade'));
  ({SourceController} = OTA.require('source-controller')); ({ExportController} = OTA.require('export-controller'));
  ({BackgroundService} = OTA.require('background-service')); ({TableRegistry} = OTA.require('table-registry'));
  ({WorkerRuntime} = OTA.require('worker-runtime'));
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
    const title=Store.getDocument().title;
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
      const session=WorkerRuntime.createSession();session.parse({text:small,key:'projection'});
      const bytes=session.excel({key:'projection',mode:'full',ui:Store.getDocument().ui});
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

  for(const format of ['auto','cli-table-data']) {
    it(`keeps rich clipboard table-data parsing and full Excel in the background (${format})`,async()=>{
      const html=format==='auto'?'<pre>copied CLI output</pre>':'<table><tr><td>unrelated HTML table</td></tr></table>';
      SourceController.captureClipboard({types:['text/plain','text/html'],getData:type=>type==='text/plain'?large:type==='text/html'?html:''});
      Store.transition('source:replace',{text:large,preservePaste:true});SourceController.displayText(large);
      Store.transition('import:setFormat',{format});dom.getElementById('formatSelect').value=format;
      const session=WorkerRuntime.createSession();let parses=0,exports=0;
      BackgroundService.parse=async payload=>{parses++;return structuredClone(session.parse(payload));};
      BackgroundService.export=async(input,mode)=>{exports++;return new Blob([session.excel({key:input.datasetKey,ui:input.ui,globalViews:input.globalViews,mode})]);};
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

  it('reports empty source without generating a workbook', async () => {
    replace(''); await clickExport();
    assert.equal(downloads.length, 0); assert.ok(messages.some(message => message.includes('无数据可导出')));
  });
});
