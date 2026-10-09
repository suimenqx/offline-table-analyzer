import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {loadModules} from '../helpers/load-modules.mjs';
import {createLargeTableData} from '../helpers/large-data.mjs';

describe('background dataset session',()=>{
  it('preserves strings, applies corrections and undo, and shares filtering/JOIN semantics',()=>{
    const {OTA}=loadModules(['worker-runtime']);
    const session=OTA.require('worker-runtime').WorkerRuntime.createSession();
    const result=session.parse({text:'table-data T\nvalidflag ID Bucket\n1 001 B1\n1 002 B2\ntable-data R\nvalidflag Bucket Label\n1 B1 A\n1 B1 B',key:'a:1'});
    assert.equal(result.tables[0].rows[0][1],'001');
    const views=[{view:'V',left:'T',right:'R',type:'inner',on:'Bucket=Bucket',select:'left.ID,right.Label'}];
    const input={key:'a:1',globalViews:views,ui:{enabledViews:['V'],globalFilter:'ID=001'}};
    const first=session.query(input);
    assert.equal(first[0].res.rows.length,1);
    const joined=first.find(item=>item.table.name==='JOIN:V');assert.equal(joined.res.rows.length,2);
    assert.deepEqual(joined.res.rows.map(row=>row.d),[['001','A'],['001','B']]);
    const edited=session.query({...input,ui:{...input.ui,cellEdits:{$T:{0:{1:'009'}}},globalFilter:'ID=009'}});
    assert.equal(edited[0].res.rows[0].d[1],'009');
    assert.equal(first[0].res.rows[0].d[1],'001');
    const undone=session.query(input);assert.equal(undone[0].res.rows[0].d[1],'001');
    assert.throws(()=>session.query({...input,key:'another'}),/数据源已变化/);
    assert.throws(()=>session.stats({...input,key:'another',cfg:views[0]}),/数据源已变化/);
    assert.throws(()=>session.excel({...input,key:'another',mode:'raw'}),/数据源已变化/);
    assert.ok(session.excel({...input,mode:'preview'}).byteLength>100);
  });

  it('limits all selected tables and JOINs together before allocating another result',()=>{
    const {OTA}=loadModules(['query-service']);const {QueryService}=OTA.require('query-service');
    QueryService.MAX_CELLS=7;
    const rawTables=[{name:'L',headers:['k'],rows:[['a'],['a']]},{name:'R',headers:['k'],rows:[['a'],['a']]}];
    const globalViews=[{view:'V',left:'L',right:'R',type:'inner',on:'k=k',select:'left.k'}];
    assert.throws(()=>QueryService.getPreview({rawTables,globalViews,ui:{enabledViews:['V']}}),/预算/);
    const result=QueryService.getPreview({rawTables,globalViews,ui:{displayTables:['L'],enabledViews:['V']}});assert.equal(result.tables.length,2);
    assert.equal(rawTables[0].rows.length,2);
  });

  it('keeps parsed rows out of the Window publication',async()=>{
    const {OTA}=loadModules(['worker-runtime']);const {WorkerRuntime}=OTA.require('worker-runtime');
    const messages=[],waiters=[];
    const port={postMessage(message){if(waiters.length)waiters.shift()(message);else messages.push(message);}};
    const receive=()=>messages.length?Promise.resolve(messages.shift()):new Promise(resolve=>waiters.push(resolve));
    WorkerRuntime.start(port);assert.equal((await receive()).ready,1);
    const fixture=createLargeTableData({rows:1201,columns:32});
    port.onmessage({data:{id:1,kind:'parse',payload:{text:fixture.text,key:'a',publish:true}}});
    const start=await receive();assert.equal(start.type,'start');assert.equal(start.value.tables[0].rowCount,1201);
    assert.ok(start.value.tables.every(table=>table.remote && table.rows.length===0));
    const complete=await receive();assert.equal(complete.id,1);assert.equal(complete.type,undefined);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(messages.length,0);
  });

  it('rejects JOIN and export expansion at budgets without truncating source',()=>{
    const {OTA}=loadModules(['worker-runtime']);const {Joiner}=OTA.require('joiner');const {Exporter}=OTA.require('exporter');
    assert.equal(Joiner.MAX_ROWS,1000000);assert.equal(Exporter.MAX_OUTPUT_BYTES,256*1024*1024);
    const tables=[{name:'L',headers:['k'],rows:[['a'],['a']]},{name:'R',headers:['k'],rows:[['a'],['a']]}];
    Joiner.MAX_ROWS=3;
    assert.throws(()=>Joiner.run(tables,{view:'V',left:'L',right:'R',type:'inner',on:'k=k',select:'left.k'}),/预算/);
    assert.equal(tables[0].rows.length,2);
    const sheet={name:'one',headers:['k'],rows:[['a']]};
    const byteLength=new TextEncoder().encode(Exporter.buildSheetXml(sheet)).length;
    Exporter.MAX_OUTPUT_BYTES=byteLength*2;
    assert.throws(()=>Exporter.createExcelBytes([sheet,{...sheet,name:'two'},{...sheet,name:'three'}]),/预算/);
    Exporter.MAX_OUTPUT_BYTES=200;
    assert.throws(()=>Exporter.createExcelBytes(tables),/预算/);
  });
});
