import {afterEach, beforeEach, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {loadModules} from '../helpers/load-modules.mjs';
import {createStorageMock} from '../mocks/storage.js';
import {createDOMSandbox} from '../mocks/dom.js';

let Store;
beforeEach(() => {
  const dom=createDOMSandbox();
  const {OTA}=loadModules(['store'], {localStorage:createStorageMock(),document:dom.document,CustomEvent:dom.MockCustomEvent});
  ({Store}=OTA.require('store'));
  Store.init();
});
afterEach(() => {
  clearTimeout(Store.saveTimer);
  Store.clearCardRemoval?.();
});

describe('Session-only card deletion recovery', () => {
  it('restores the original position, raw, corrections, visibility and selected card through commands', () => {
    const first=Store.curr();
    Store.transition('source:replace',{text:'[{"id":"001"}]'});
    Store.transition('cell:edit',{table:'JSON Table 1',row:0,col:0,value:'corrected'});
    Store.transition('card:visible',{id:first.id,visible:false});
    const expected=JSON.parse(JSON.stringify(Store.getCard(first.id)));
    const second=Store.transition('card:create');
    Store.transition('card:reorder',{sourceId:second.id,targetId:first.id,place:'before'});
    assert.equal(Store.transition('card:remove',{id:first.id}),true);
    assert.equal(Store.getCard(first.id),null);
    assert.equal(Store.getCardRemoval().title,expected.title);
    const revision=Store.queryRevision;
    const restored=Store.transition('card:undoRemove');
    assert.deepEqual(restored,expected);
    assert.deepEqual(Store.getActiveProject().cardIds,[second.id,first.id]);
    assert.equal(Store.curr().id,first.id);
    assert.ok(Store.queryRevision>revision);
    assert.equal(Store.getCardRemoval(),null);
    assert.equal(Store.transition('card:undoRemove'),false);
  });

  it('restores the last card to its existing project and keeps deletion out of backups', () => {
    const card=Store.curr(), project=Store.getActiveProject();
    Store.transition('card:remove',{id:card.id});
    assert.equal(Store.curr(),null);
    const backup=Store.serializeState();
    assert.deepEqual(backup.docs,[]);
    assert.equal(JSON.stringify(backup).includes('expiresAt'),false);
    assert.equal(Store.transition('card:undoRemove').id,card.id);
    assert.equal(Store.getActiveProject(),project);
  });

  it('keeps only the latest removal, handles name collisions, and returns to the owning project', () => {
    const first=Store.curr();
    const second=Store.transition('card:create',{title:'Orders'});
    Store.transition('card:remove',{id:first.id});
    Store.transition('card:remove',{id:second.id});
    const replacement=Store.transition('card:create',{title:'Orders'});
    const project=Store.getActiveProject();
    Store.transition('project:create');
    const restored=Store.transition('card:undoRemove');
    assert.equal(restored.id,second.id);
    assert.equal(restored.title,'Orders (2)');
    assert.equal(Store.getActiveProject(),project);
    assert.deepEqual(project.cardIds,[second.id,replacement.id]);
    assert.equal(Store.getCard(first.id),null);
  });

  it('expires recovery and discards it when its project or workspace is removed', t => {
    const originalNow=Date.now;
    let now=originalNow();
    Date.now=()=>now;
    t.after(()=>{Date.now=originalNow;});
    Store.transition('card:remove',{id:Store.curr().id});
    now=Store.getCardRemoval().expiresAt+1;
    assert.equal(Store.transition('card:undoRemove'),false);
    assert.equal(Store.getCardRemoval(),null);
    const card=Store.transition('card:create');
    Store.transition('card:remove',{id:card.id});
    Store.transition('project:remove',{id:Store.getActiveProject().id});
    assert.equal(Store.getCardRemoval(),null);
    Store.transition('project:create');
    Store.transition('card:remove',{id:Store.curr().id});
    Store.transition('workspace:clearLocal');
    assert.equal(Store.getCardRemoval(),null);
  });

  it('clears recovery only after a valid workspace import', () => {
    Store.transition('card:remove',{id:Store.curr().id});
    assert.throws(()=>Store.transition('workspace:import',{workspace:{kind:'invalid'}}));
    assert.ok(Store.getCardRemoval());
    Store.transition('workspace:import',{workspace:{...Store.serializeState(),kind:'ota-workspace'}});
    assert.equal(Store.getCardRemoval(),null);
  });
});
