import {afterEach,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {loadModules} from '../helpers/load-modules.mjs';
import {createStorageMock} from '../mocks/storage.js';
import {createDOMSandbox} from '../mocks/dom.js';

const stores=[];
afterEach(()=>{for(const store of stores.splice(0)){clearTimeout(store.saveTimer);clearTimeout(store._notifyTimer);}});

function fixture() {
  const storage=createStorageMock();globalThis.localStorage=storage;
  const dom=createDOMSandbox();
  const {OTA}=loadModules(['store'],{localStorage:storage,document:dom.document,window:dom.window,CustomEvent:dom.MockCustomEvent});
  const {Store,STORE_KEY}=OTA.require('store');const {BackgroundService}=OTA.require('background-service');
  stores.push(Store);
  Store.init();const raw='original\r\n'.repeat(30000);Store.curr().raw=raw;
  const calls=[];
  BackgroundService.storage=(kind,payload)=>{if(kind==='pruneWorkspace')return Promise.resolve();return new Promise((resolve,reject)=>calls.push({kind,payload,resolve,reject}));};
  return {Store,STORE_KEY,storage,raw,calls,BackgroundService,OTA,dom};
}

describe('Store asynchronous snapshot lifecycle',()=>{
  it('publishes a raw reference only after durable commit and retains exact source',async()=>{
    const {Store,STORE_KEY,storage,raw,calls}=fixture();
    const old=storage.getItem(STORE_KEY);const pending=Store.save();
    assert.equal(Store.saving,true);assert.equal(storage.getItem(STORE_KEY),old);
    assert.equal(calls[0].payload.workspace.docs[0].raw,raw);
    calls[0].resolve();assert.equal(await pending,true);
    const stub=JSON.parse(storage.getItem(STORE_KEY));assert.equal(stub.rawExternal,calls[0].payload.key);assert.equal(stub.docs[0].raw,'');
    assert.equal(Store.curr().raw,raw);assert.equal(Store.saving,false);
  });

  it('reuses unchanged raw while recovering the latest query settings',async()=>{
    const {Store,STORE_KEY,storage,raw,calls}=fixture();
    const pending=Store.save();const snapshot=calls[0].payload.workspace;calls[0].resolve();await pending;
    Store.curr().ui.globalFilter='ID=009';Store.curr().ui.cellEdits={$T:{0:{1:'fixed'}}};Store.curr().ui.cellEditsRevision=Store.curr().sourceRevision;
    assert.equal(Store.save(),true);assert.equal(calls.length,1);
    const key=JSON.parse(storage.getItem(STORE_KEY)).rawExternal;assert.equal(key,calls[0].payload.key);
    Store.init();calls[1].resolve(snapshot);assert.equal(await Store.restorePromise,true);
    assert.equal(Store.curr().raw,raw);assert.equal(Store.curr().ui.globalFilter,'ID=009');assert.equal(Store.curr().ui.cellEdits.$T[0][1],'fixed');
    Store.curr().sourceRevision+=1;const optionSave=Store.save();assert.equal(calls.length,3);calls[2].resolve();assert.equal(await optionSave,true);
    Store.curr().raw+='new';const next=Store.save();assert.equal(calls.length,4);calls[3].resolve();assert.equal(await next,true);
  });

  it('preserves the previous durable value and in-memory source when storage fails',async()=>{
    const {Store,STORE_KEY,storage,raw,calls}=fixture();const old=storage.getItem(STORE_KEY);
    const pending=Store.save();calls[0].reject(new Error('quota'));assert.equal(await pending,false);
    assert.equal(storage.getItem(STORE_KEY),old);assert.equal(Store.curr().raw,raw);assert.match(Store.lastSaveError,/quota/);
  });

  it('reports failed snapshot cleanup and retries it while reusing the committed raw',async()=>{
    const {Store,STORE_KEY,storage,raw,calls,BackgroundService,dom}=fixture();
    const storageJob=BackgroundService.storage,prunes=[],statuses=[];
    dom.document.dispatchEvent=event=>{if(event.type==='ota:storage')statuses.push(event.detail);return true;};
    BackgroundService.storage=(kind,payload)=>kind==='pruneWorkspace'
      ? new Promise((resolve,reject)=>prunes.push({payload,resolve,reject})) : storageJob(kind,payload);
    const pending=Store.save();calls[0].resolve();assert.equal(await pending,true);
    const committed=storage.getItem(STORE_KEY);
    assert.equal(Store.cleaning,true);
    prunes[0].reject(new Error('prune failed'));
    assert.equal(await Store.cleanupPromise,false);
    assert.equal(Store.cleaning,false);
    assert.match(Store.lastSaveError,/完整原文已保存.*清理失败.*prune failed/);
    assert.equal(statuses.at(-1).ok,false);
    assert.match(statuses.at(-1).message,/prune failed/);
    assert.equal(storage.getItem(STORE_KEY),committed);assert.equal(Store.getDocument().raw,raw);
    assert.equal(Store.save(),true);assert.equal(calls.length,1);
    assert.equal(prunes.length,2);assert.equal(Store.cleaning,true);
    assert.equal(prunes[1].payload.keep,JSON.parse(committed).rawExternal);
    prunes[1].resolve();assert.equal(await Store.cleanupPromise,true);
    assert.equal(Store.cleaning,false);assert.equal(Store.lastSaveError,null);
  });

  it('recovers the latest 2001 corrected rows from new and released full snapshots',async()=>{
    const {Store,storage,STORE_KEY,calls,raw}=fixture();
    const firstId=Store.getDocument().id;
    const first=Store.save();calls[0].resolve();assert.equal(await first,true);
    for(let row=0;row<2001;row++)Store.transition('cell:edit',{table:'T',row,col:0,value:`fixed-${row}`});
    const legacy=Store.serializeState(); // Released snapshots also contained UI.
    Store.transition('tab:create',{});
    const saved=Store.savePromise,snapshot=calls[1].payload.workspace;
    calls[1].resolve();assert.equal(await saved,true);
    const committed=storage.getItem(STORE_KEY);
    for(const payload of [snapshot,{...legacy,docs:[...legacy.docs,snapshot.docs[1]]}]){
      storage.setItem(STORE_KEY,committed);Store.init();calls.at(-1).resolve(payload);
      assert.equal(await Store.restorePromise,true);
      const doc=Store.getDocument(firstId);
      assert.equal(doc.raw,raw);
      assert.equal(Object.keys(doc.ui.cellEdits.$T).length,2001);
      assert.equal(doc.ui.cellEdits.$T[2000][0],'fixed-2000');
      assert.equal(Store.loadFailed,false);
    }
  });

  it('cleans an abandoned replacement when returning to the committed documents',async()=>{
    const {Store,calls,BackgroundService}=fixture();
    const jobs=[],storageJob=BackgroundService.storage;
    BackgroundService.storage=(kind,payload)=>{if(kind==='pruneWorkspace'){jobs.push(payload);return Promise.resolve();}return storageJob(kind,payload);};
    const first=Store.save();calls[0].resolve();await first;await Store.cleanupPromise;
    const added=Store.transition('tab:create',{}),replacement=Store.savePromise;
    Store.transition('tab:remove',{id:added.id});
    calls[1].resolve();assert.equal(await replacement,false);await Store.cleanupPromise;
    assert.equal(jobs.length,2);assert.equal(jobs[1].keep,calls[0].payload.key);
    assert.equal(Store.saving,false);assert.equal(Store.cleaning,false);
  });

  it('ignores an obsolete cleanup error while a newer cleanup is still pending',async()=>{
    const {Store,calls,BackgroundService}=fixture();
    const prunes=[],storageJob=BackgroundService.storage;
    BackgroundService.storage=(kind,payload)=>kind==='pruneWorkspace'
      ? new Promise((resolve,reject)=>prunes.push({resolve,reject})) : storageJob(kind,payload);
    const first=Store.save();calls[0].resolve();await first;
    const oldCleanup=Store.cleanupPromise;
    Store.transition('ui:persistRaw',{enabled:false});const currentCleanup=Store.cleanupPromise;
    prunes[0].reject(new Error('old cleanup failed'));assert.equal(await oldCleanup,false);
    assert.equal(Store.cleaning,true);assert.equal(Store.lastSaveError,null);
    prunes[1].resolve();assert.equal(await currentCleanup,true);assert.equal(Store.cleaning,false);
  });

  it('prevents a late save from re-enabling raw persistence after temporary mode',async()=>{
    const {Store,STORE_KEY,storage,raw,calls}=fixture();const pending=Store.save();
    Store.transition('ui:persistRaw',{enabled:false});calls[0].resolve();assert.equal(await pending,false);
    const stub=JSON.parse(storage.getItem(STORE_KEY));assert.equal(stub.persistRaw,false);assert.equal(stub.rawExternal,undefined);assert.equal(stub.docs[0].raw,'');assert.equal(Store.curr().raw,raw);
  });

  it('shows the budget failure after superseding every pending save',async()=>{
    const {Store,STORE_KEY,storage,calls,OTA,dom}=fixture();
    const {App}=OTA.require('app');await Store.cleanupPromise;
    const committed=storage.getItem(STORE_KEY);
    Store.transition('source:replace',{text:'a'.repeat(60*1024*1024)});
    const first=Store.save();
    Store.transition('tab:create',{raw:'b'.repeat(60*1024*1024)});
    const second=Store.savePromise;
    Store.transition('tab:create',{raw:'c'.repeat(20*1024*1024)});
    assert.equal(Store.save(),false);
    for(const call of calls)call.resolve();
    assert.deepEqual(await Promise.all([first,second]),[false,false]);
    assert.equal(Store.saving,false);
    assert.equal(storage.getItem(STORE_KEY),committed);
    assert.equal(Store.getDocument().raw.length,20*1024*1024);
    App.updateStorageStatus();
    assert.match(dom.getElementById('storageStatus').textContent,/256 MiB.*预算/);
  });

  it('retries interrupted raw cleanup when reopening a small temporary stub',async()=>{
    const {Store,STORE_KEY,storage}=fixture();
    const {OTA}=loadModules(['store'],{localStorage:storage});
    const restored=OTA.require('store').Store;const background=OTA.require('background-service').BackgroundService;
    storage.setItem(STORE_KEY,JSON.stringify({...Store.serializeState({omitRaw:true}),persistRaw:false}));
    const calls=[];background.canUse=()=>true;background.storage=async(kind,payload)=>calls.push({kind,payload});
    restored.init();assert.equal(restored.cleaning,true);assert.equal(await restored.cleanupPromise,true);
    assert.equal(calls[0].kind,'pruneWorkspace');assert.equal(calls[0].payload.keep,null);assert.equal(restored.cleaning,false);assert.equal(restored.curr().raw,'');
  });

  it('restores a committed snapshot and blocks overwriting a missing snapshot',async()=>{
    const {Store,STORE_KEY,storage,calls}=fixture();const pending=Store.save();const snapshot=calls[0].payload.workspace;
    calls[0].resolve();await pending;Store.init();assert.equal(Store.restoring,true);assert.equal(Store.loadFailed,true);
    calls[1].resolve(snapshot);assert.equal(await Store.restorePromise,true);assert.equal(Store.curr().raw,snapshot.docs[0].raw);
    Store.init();calls[2].reject(new Error('missing'));assert.equal(await Store.restorePromise,false);assert.equal(Store.loadFailed,true);
    const old=storage.getItem(STORE_KEY);assert.equal(Store.save(),false);assert.equal(storage.getItem(STORE_KEY),old);
  });

  it('migrates released unprefixed correction keys exactly once',()=>{
    const {Store}=fixture();
    const {OTA}=loadModules(['store']);const {migrateWorkspacePayload}=OTA.require('store');
    const old={schemaVersion:20,appVersion:'22.0.0',docs:[{id:'old',raw:'001',sourceRevision:1,ui:{cellEdits:{Wide:{0:{1:'002'}},$Special:{0:{0:'kept'}}}}}]};
    const migrated=migrateWorkspacePayload(old);
    assert.deepEqual(migrated.docs[0].ui.cellEdits,{$Wide:{0:{1:'002'}},$$Special:{0:{0:'kept'}}});
    assert.deepEqual(migrateWorkspacePayload(migrated).docs[0].ui.cellEdits,migrated.docs[0].ui.cellEdits);
    assert.equal(old.docs[0].ui.cellEdits.Wide[0][1],'002');assert.equal(Store.curr().raw.length>0,true);
  });

  it('migrates schema 20 raw and correction overlays without changing cells',()=>{
    const {Store,STORE_KEY,storage}=fixture();
    storage.removeItem(STORE_KEY);storage.setItem('ota_v20_workspace',JSON.stringify({schemaVersion:20,docs:[{id:'old',title:'Old',raw:'id\r\n001',sourceRevision:1,ui:{cellEdits:{$T:{0:{0:'002'}}}}}],activeId:'old',persistRaw:true}));
    Store.init();assert.equal(Store.state.schemaVersion,21);assert.equal(Store.curr().raw,'id\r\n001');assert.equal(Store.curr().ui.cellEdits.$T[0][0],'002');assert.equal(storage.getItem('ota_v20_workspace'),null);assert.ok(storage.getItem(STORE_KEY));
  });
});
