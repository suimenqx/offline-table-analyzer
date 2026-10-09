import {afterEach, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {loadModules} from '../helpers/load-modules.mjs';

const originalIndexedDB=globalThis.indexedDB;
afterEach(()=>{
  if(originalIndexedDB===undefined)delete globalThis.indexedDB;
  else globalThis.indexedDB=originalIndexedDB;
});

// Only the browser transaction boundary is mocked; values use real structured
// cloning, Blob and decoding, just as persisted source snapshots do.
function fixture(entries=[]) {
  const values=new Map(entries);
  const indexedDB={open(){
    const request={};
    queueMicrotask(()=>{
      request.result={close(){},transaction(){
        const tx={objectStore(){return {
          put(value,key){values.set(key,structuredClone(value));queueMicrotask(()=>tx.oncomplete());},
          get(key){const result={};queueMicrotask(()=>{result.result=structuredClone(values.get(key));result.onsuccess();});return result;}
        };}};
        return tx;
      }};
      request.onsuccess();
    });
    return request;
  }};
  const {OTA}=loadModules(['workspace-storage'],{indexedDB});
  return OTA.require('workspace-storage').WorkspaceStorage;
}

describe('WorkspaceStorage original text recovery',()=>{
  it('round trips all UTF-16 code units, including BOM, CRLF and lone surrogates',async()=>{
    const storage=fixture();
    const raw='\uFEFFtable-data 原文\r\n\uD800\uDC00\uD800 X \uDC00\r\n'+'001\r\n'.repeat(40000);
    await storage.write('current',{schemaVersion:21,docs:[{id:'a',sourceRevision:1,raw}]});
    const restored=await storage.read('current');
    assert.equal(restored.docs[0].raw,raw);
    assert.equal((await storage.read('current')).docs[0].raw,raw);
  });

  it('reads released UTF-8 Blob snapshots without stripping their original BOM',async()=>{
    const raw='\uFEFFtable-data Legacy\r\nvalidflag ID\r\n1 001\r\n';
    const storage=fixture([['legacy',{schemaVersion:21,docs:[{id:'old',sourceRevision:1,raw:new Blob([raw],{type:'text/plain;charset=utf-8'})}]}]]);
    assert.equal((await storage.read('legacy')).docs[0].raw,raw);
  });
});
