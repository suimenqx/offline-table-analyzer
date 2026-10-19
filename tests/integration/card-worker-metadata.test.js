import {afterEach, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {loadModules} from '../helpers/load-modules.mjs';
import {createStorageMock} from '../mocks/storage.js';

let service, previousWorker;
afterEach(() => {
  service?.cancel();
  if(previousWorker === undefined) delete globalThis.Worker;
  else globalThis.Worker=previousWorker;
});
function setup() {
  previousWorker=globalThis.Worker;
  const {OTA}=loadModules(['background-service','worker-runtime'],{localStorage:createStorageMock()});
  const {WorkerRuntime}=OTA.require('worker-runtime');
  // Browser transport boundary only: all parsing, pooling and queries remain real.
  globalThis.Worker=class WorkerAdapter {
    constructor() {
      this.port={postMessage:message=>queueMicrotask(()=>{if(!this.closed)this.onmessage?.({data:message});})};
      WorkerRuntime.start(this.port);
    }
    postMessage(message) { this.port.onmessage({data:message}); }
    terminate() { this.closed=true; }
  };
  service=OTA.require('background-service').BackgroundService;
  return service;
}
const input = (raw, revision) => ({visible:[{id:'a',name:'数据段 1'}], cardUis:{a:{}}, ui:{pageSize:50},
  cards:[{id:'a',sourceRevision:revision,raw,options:{format:'json',headerMode:'auto'}}]});

describe('Background card metadata transport', () => {
  it('returns descriptors for lazy parsing and replaces an older source revision instead of reusing stale data', async () => {
    const service=setup();
    const first=await service.query(input('[{"id":"1"}]',1));
    assert.equal(first.parsed[0].result.tables[0].rowCount,1);
    assert.deepEqual(first.parsed[0].result.tables[0].rows,[]);
    const next=await service.query(input('[{"id":"1"},{"id":"2"},{"id":"3"}]',2));
    assert.equal(next.tables[0].res.totalRows,3);
    assert.equal(next.parsed[0].context.sourceRevision,2);
    assert.deepEqual(next.parsed[0].result.tables[0].rows,[]);
  });
});
