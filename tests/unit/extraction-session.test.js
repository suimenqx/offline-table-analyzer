import {afterEach, beforeEach, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {loadModules} from '../helpers/load-modules.mjs';

const deferred=()=>{
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
};
const tableResult={format:'json',label:'JSON',tables:[{name:'T',headers:['id'],rows:[],rowCount:1,remote:true}]};
let session,context,Store,BackgroundService,TableRegistry,Parser,starts,results,releases;
beforeEach(()=>{
  const {OTA}=loadModules(['extraction-session']);
  ({Store}=OTA.require('store'));
  Store.state.docs=[{id:'a',title:'A',raw:'[{"id":"001"}]',sourceRevision:2,ui:{importFormat:'auto',importHeaderMode:'auto'}}];
  Store.state.projects=[{id:'p',title:'P',cardIds:['a'],activeCardId:'a',views:[],enabledViews:[]}];
  Store.state.activeProjectId='p';
  context={docId:'a',sourceRevision:2,text:Store.curr().raw,
    options:{format:'auto',headerMode:'auto',html:'',regionSelection:null},config:{format:'auto',headerMode:'auto'}};
  ({BackgroundService}=OTA.require('background-service'));
  ({TableRegistry}=OTA.require('table-registry'));
  ({Parser}=OTA.require('parser-facade'));
  starts=[];results=[];releases=[];
  session=OTA.require('extraction-session').ExtractionSession.create({readContext:()=>context,
    onStart:event=>{starts.push(event);return ()=>releases.push(event.context);},
    onResult:event=>results.push(event)});
});
afterEach(()=>{
  session.cancel();
  clearTimeout(Store.saveTimer);clearTimeout(Store._notifyTimer);
});

describe('ExtractionSession public lifetime contract',()=>{
  it('keeps Window extraction synchronous, reuses success and invalidates a receipt on explicit rerun',()=>{
    const first=session.run();
    assert.equal(first.ok,true);
    assert.deepEqual(TableRegistry.getRaw()[0].rows,[['001']]);
    assert.equal(session.run({reuse:true}),first);
    assert.equal(starts.length,1);
    assert.doesNotThrow(first.validate);
    const next=session.run();
    assert.equal(next.ok,true);
    assert.throws(first.validate,{name:'AbortError'});
    assert.doesNotThrow(next.validate);
    assert.equal(releases.length,2);
  });

  it('shares one Worker job and promotes its render request without transferring full tables',async()=>{
    BackgroundService.THRESHOLD=0;
    const held=deferred();let calls=0;
    BackgroundService.parse=()=>{calls++;return held.promise;};
    const first=session.run({render:false});
    assert.equal(session.run({reuse:true}),first);
    assert.equal(calls,1);
    held.resolve(tableResult);
    const done=await first;
    assert.equal(done.ok,true);
    assert.equal(results[0].render,true);
    assert.equal(TableRegistry.isBackground(),true);
    assert.deepEqual(TableRegistry.getRaw()[0].rows,[]);
    assert.equal(TableRegistry.getCardSummary('a').rowCount,1);
    assert.equal(session.run({reuse:true}),done);
    assert.doesNotThrow(done.validate);
  });

  for(const field of ['docId','sourceRevision','text','format','headerMode','html','regionSelection','config']) {
    it(`rejects a receipt and ignores late completion when ${field} changes`,async()=>{
      BackgroundService.THRESHOLD=0;
      const held=deferred();BackgroundService.parse=()=>held.promise;
      const pending=session.run();
      if(field==='docId') context={...context,docId:'other'};
      else if(field==='sourceRevision') context={...context,sourceRevision:3};
      else if(field==='text') context={...context,text:'[{"id":"002"}]'};
      else if(field==='config') context.config.headerMode='none';
      else if(field==='regionSelection') context.options.regionSelection=[{start:1,end:2}];
      else context.options[field]=field==='format'?'json':field==='headerMode'?'none':'<table></table>';
      assert.equal(session.invalidate({ifChanged:true}),true);
      const done=await pending;
      assert.equal(done.ok,false);
      assert.equal(done.failed,false);
      assert.throws(done.validate,/数据源或解析设置已变化/);
      held.resolve(tableResult);
      await Promise.resolve();
      assert.equal(results.length,0);
      assert.equal(TableRegistry.getFormat(),'empty');
      assert.equal(releases.length,1);
    });
  }

  it('does not cancel a matching job when a queued source event arrives',async()=>{
    BackgroundService.THRESHOLD=0;
    const held=deferred();BackgroundService.parse=()=>held.promise;
    const pending=session.run();
    context=structuredClone(context);
    assert.equal(session.invalidate({ifChanged:true}),false);
    held.resolve(tableResult);
    assert.equal((await pending).ok,true);
    assert.equal(results.length,1);
  });

  it('cleans up cancellation immediately, and late rejection cannot touch a newer result',async()=>{
    BackgroundService.THRESHOLD=0;
    const old=deferred();BackgroundService.parse=()=>old.promise;
    const pending=session.run();
    session.cancel();
    assert.equal(releases.length,1);
    const cancelled=await pending;
    assert.throws(cancelled.validate,{name:'AbortError'});
    BackgroundService.parse=async()=>tableResult;
    const next=await session.run();
    old.reject(new Error('late transport failure'));
    await Promise.resolve();
    assert.doesNotThrow(next.validate);
    assert.equal(results.length,1);
    assert.equal(releases.length,2);
    assert.equal(TableRegistry.getFormat(),'json');
  });

  for(const background of [false,true]) {
    it(`reports ${background?'Worker':'Window'} failure, reuses it for diagnostics and retries for export`,async()=>{
      let calls=0;
      if(background) {
        BackgroundService.THRESHOLD=0;
        BackgroundService.parse=async()=>{calls++;throw new Error('cannot parse');};
      } else Parser.parse=()=>{calls++;return {format:'error',tables:[],diagnostics:[{severity:'error',message:'cannot parse'}]};};
      const failed=await session.run();
      assert.equal(failed.ok,false);
      assert.equal(failed.failed,true);
      assert.doesNotThrow(failed.validate);
      assert.equal(await session.run({reuse:true,retryFailed:false}),failed);
      assert.equal(calls,1);
      assert.equal(TableRegistry.getDiagnostics()[0].message,'cannot parse');
      await session.run({reuse:true});
      assert.equal(calls,2);
      assert.equal(Store.curr().raw,'[{"id":"001"}]');
    });
  }

  it('treats transport AbortError as cancellation without publishing failure',async()=>{
    BackgroundService.THRESHOLD=0;
    BackgroundService.parse=async()=>{throw Object.assign(new Error('cancelled'),{name:'AbortError'});};
    const done=await session.run();
    assert.equal(done.failed,false);
    assert.equal(done.ok,false);
    assert.throws(done.validate,{name:'AbortError'});
    assert.equal(results.length,0);
    assert.equal(releases.length,1);
  });

  it('ignores completion even before a source-change event is delivered',async()=>{
    BackgroundService.THRESHOLD=0;
    const held=deferred();BackgroundService.parse=()=>held.promise;
    const pending=session.run();
    context={...context,text:'[{"id":"002"}]'};
    held.resolve(tableResult);
    const done=await pending;
    assert.equal(done.ok,false);
    assert.equal(results.length,0);
    assert.equal(releases.length,1);
  });

  it('copies nested region selections so caller mutation invalidates the original snapshot',async()=>{
    BackgroundService.THRESHOLD=0;
    context.options.regionSelection={regions:[{start:0,end:15}]};
    const held=deferred();BackgroundService.parse=()=>held.promise;
    const pending=session.run();
    context.options.regionSelection.regions[0].end=20;
    assert.equal(session.invalidate({ifChanged:true}),true);
    assert.throws((await pending).validate,{name:'SourceChangedError'});
    held.resolve(tableResult);
    await Promise.resolve();
    assert.equal(results.length,0);
  });

  it('routes a small multi-card source through Worker while preserving HTML DOMParser on Window',async()=>{
    Store.transition('card:create',{title:'B'});
    Store.transition('card:activate',{id:'a'});
    let backgroundCalls=0;
    BackgroundService.parse=async()=>{backgroundCalls++;return tableResult;};
    assert.equal((await session.run()).ok,true);
    assert.equal(starts[0].background,true);
    context.options.html='<table><tr><td>001</td></tr></table>';
    Parser.parse=()=>({...tableResult,format:'html-table'});
    assert.equal(session.run().ok,true);
    assert.equal(starts[1].background,false);
    assert.equal(backgroundCalls,1);
  });
});
