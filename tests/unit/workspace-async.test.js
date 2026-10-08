import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {loadModules} from '../helpers/load-modules.mjs';
import {createStorageMock} from '../mocks/storage.js';
import {createDOMSandbox} from '../mocks/dom.js';

function fixture() {
  const storage=createStorageMock();globalThis.localStorage=storage;
  const dom=createDOMSandbox();
  const {OTA}=loadModules(['store'],{localStorage:storage,document:dom.document,window:dom.window,CustomEvent:dom.MockCustomEvent});
  const {Store,STORE_KEY}=OTA.require('store');const {BackgroundService}=OTA.require('background-service');
  Store.init();const raw='original\r\n'.repeat(30000);Store.curr().raw=raw;
  const calls=[];
  BackgroundService.storage=(kind,payload)=>{if(kind==='pruneWorkspace')return Promise.resolve();return new Promise((resolve,reject)=>calls.push({kind,payload,resolve,reject}));};
  return {Store,STORE_KEY,storage,raw,calls};
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

  it('prevents a late save from re-enabling raw persistence after temporary mode',async()=>{
    const {Store,STORE_KEY,storage,raw,calls}=fixture();const pending=Store.save();
    Store.transition('ui:persistRaw',{enabled:false});calls[0].resolve();assert.equal(await pending,false);
    const stub=JSON.parse(storage.getItem(STORE_KEY));assert.equal(stub.persistRaw,false);assert.equal(stub.rawExternal,undefined);assert.equal(stub.docs[0].raw,'');assert.equal(Store.curr().raw,raw);
  });

  it('restores a committed snapshot and blocks overwriting a missing snapshot',async()=>{
    const {Store,STORE_KEY,storage,calls}=fixture();const pending=Store.save();const snapshot=calls[0].payload.workspace;
    calls[0].resolve();await pending;Store.init();assert.equal(Store.restoring,true);assert.equal(Store.loadFailed,true);
    calls[1].resolve(snapshot);assert.equal(await Store.restorePromise,true);assert.equal(Store.curr().raw,snapshot.docs[0].raw);
    Store.init();calls[2].reject(new Error('missing'));assert.equal(await Store.restorePromise,false);assert.equal(Store.loadFailed,true);
    const old=storage.getItem(STORE_KEY);assert.equal(Store.save(),false);assert.equal(storage.getItem(STORE_KEY),old);
  });

  it('migrates schema 20 raw and correction overlays without changing cells',()=>{
    const {Store,STORE_KEY,storage}=fixture();
    storage.removeItem(STORE_KEY);storage.setItem('ota_v20_workspace',JSON.stringify({schemaVersion:20,docs:[{id:'old',title:'Old',raw:'id\r\n001',sourceRevision:1,ui:{cellEdits:{$T:{0:{0:'002'}}}}}],activeId:'old',persistRaw:true}));
    Store.init();assert.equal(Store.state.schemaVersion,21);assert.equal(Store.curr().raw,'id\r\n001');assert.equal(Store.curr().ui.cellEdits.$T[0][0],'002');assert.equal(storage.getItem('ota_v20_workspace'),null);assert.ok(storage.getItem(STORE_KEY));
  });
});
