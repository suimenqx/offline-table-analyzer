import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {loadModules} from '../helpers/load-modules.mjs';
import {createLargeTableData} from '../helpers/large-data.mjs';
import {readSheet} from 'read-excel-file/node';

describe('Worker-owned tables and page transport',()=>{
  it('publishes metadata only and returns source-indexed pages while exports retain every record',async()=>{
    const {OTA}=loadModules(['worker-runtime']);const {WorkerRuntime}=OTA.require('worker-runtime');
    const fixture=createLargeTableData({rows:1201});
    const messages=[],waiters=[];
    const port={postMessage(message){if(waiters.length)waiters.shift()(message);else messages.push(message);}};
    const receive=()=>messages.length?Promise.resolve(messages.shift()):new Promise(resolve=>waiters.push(resolve));
    WorkerRuntime.start(port);await receive();
    port.onmessage({data:{id:1,kind:'parse',payload:{text:fixture.text,key:'data',publish:true}}});
    const parsed=await receive();assert.equal(parsed.value.tables[0].rowCount,1201);
    assert.deepEqual(parsed.value.tables[0].rows,[]);const completed=await receive();assert.equal(completed.id,1);assert.equal(completed.type,undefined);
    port.onmessage({data:{id:2,kind:'query',payload:{key:'data',ui:{pageSize:50,tablePages:{Wide:3}},globalViews:[]}}});
    const page=await receive();const wide=page.value.find(item=>item.table.name==='Wide');
    assert.equal(wide.res.totalRows,1201);assert.equal(wide.res.rows.length,50);
    assert.equal(wide.res.rows[0]._sourceRow,100);assert.equal(wide.res.rows[0].d[1],'101');
    assert.ok(page.value.every(item=>item.table.rows.length===0));
  });

  it('supports off-page corrections/undo, projected filtering, chained JOIN and full preview Excel',async()=>{
    const {OTA}=loadModules(['worker-runtime']);const session=OTA.require('worker-runtime').WorkerRuntime.createSession();
    session.parse({text:createLargeTableData({rows:1201}).text,key:'data'});
    const views=[{view:'Joined',left:'Wide',right:'Lookup',type:'inner',on:'Bucket=Bucket',select:'left.ID,right.Label'},
      {view:'Chained',left:'Joined',right:'Wide',type:'inner',on:'ID=ID',select:'left.ID,right.F3'}];
    const ui={pageSize:50,tablePages:{Wide:3},cellEdits:{$Wide:{100:{3:'changed'}}},rules:{Wide:{focus:['ID','F3']}}};
    const page=session.preview({key:'data',ui});const wide=page.find(item=>item.table.name==='Wide');
    assert.deepEqual(wide.res.rows[0].d,['101','changed']);assert.deepEqual(wide.res.rows[0]._sourceCols,[1,3]);
    const moved=session.preview({key:'data',ui:{...ui,tablePages:{Wide:1}}});assert.equal(moved[0].res.rows[0].d[0],'1');
    const undone=session.preview({key:'data',ui:{...ui,cellEdits:{}}});assert.equal(undone[0].res.rows[0].d[1],'104');
    const joined=session.preview({key:'data',globalViews:views,ui:{enabledViews:['Chained'],previewTable:'JOIN:Chained',pageSize:50}});
    const chain=joined.find(item=>item.table.name==='JOIN:Chained');assert.equal(chain.res.totalRows,2402);
    assert.equal(chain.res.rows.length,50);assert.ok(chain.res.rows.every(row=>row._readOnly));
    const bytes=session.excel({key:'data',mode:'preview',ui:{...ui,globalFilter:'ID<=125'}});
    const rows=await readSheet(Buffer.from(bytes),'Wide');assert.equal(rows.length,126);assert.deepEqual(rows[101],[101,'changed']);
  });
});
