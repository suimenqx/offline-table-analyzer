import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDOMSandbox } from '../mocks/dom.js';
import { createStorageMock } from '../mocks/storage.js';
import { loadModules } from '../helpers/load-modules.mjs';

const settle = () => new Promise(resolve => setTimeout(resolve, 25));

function setup() {
  const dom = createDOMSandbox();
  const target = dom.getElementById('targetTableSelect');
  target.options = [];
  target.add = option => target.options.push(option);
  const { OTA } = loadModules(['app'], {
    document:dom.document, window:dom.window, localStorage:createStorageMock(),
    CustomEvent:dom.MockCustomEvent, confirm:() => assert.fail('Card and tab deletion must not request confirmation'),
    Option:function(text, value) { return { text, value }; },
  });
  const { App } = OTA.start('app');
  return {
    App, Store:OTA.require('store').Store,
    TabController:OTA.require('tab-controller').TabController,
    SourceController:OTA.require('source-controller').SourceController,
    TableRegistry:OTA.require('table-registry').TableRegistry,
    dom,
  };
}

describe('Workspace deletion through the UI controllers', () => {
  it('backs up and restores a cardless project with its saved views', async () => {
    const { Store, dom } = setup();
    await settle();
    const { OTA } = dom.window;
    const { Exporter } = OTA.require('exporter');
    Store.transition('project:rename', { id:Store.getActiveProject().id, title:'Empty project' });
    Store.transition('view:upsert', { view:{view:'Saved', left:'T', right:'U', on:'id=id'} });
    Store.transition('card:remove', { id:Store.curr().id });
    await settle();
    let backup;
    const download = Exporter.download;
    Exporter.download = (filename, content) => { backup = JSON.parse(content); };
    try {
      dom.getElementById('exportTabBtn').onclick();
    } finally {
      Exporter.download = download;
    }
    assert.deepEqual(backup.docs, []);
    assert.equal(backup.projects.length, 1);
    Store.transition('project:create');
    assert.equal(Store.transition('workspace:import', { workspace:backup }), 0);
    await settle();
    assert.equal(Store.getState().projects.length, 1);
    assert.equal(Store.getActiveProject().title, 'Empty project');
    assert.deepEqual(Store.getActiveProject().cardIds, []);
    assert.equal(Store.getViews()[0].view, 'Saved');
    assert.equal(Store.getDocument(), null);
  });

  it('clears the editor and results after deleting the final card, then accepts a fresh card', async () => {
    const { App, Store, SourceController, TableRegistry, dom } = setup();
    await settle();
    const projectId = Store.getActiveProject().id;
    const text = '[{"id":"1","name":"old"}]';
    dom.getElementById('rawInput').value = text;
    assert.equal(App.run(), true);
    await settle();
    assert.equal(TableRegistry.getRaw().length, 1);
    SourceController.captureClipboard({ types:['text/plain'], getData:() => text });
    const cardId = Store.curr().id;
    assert.equal(SourceController.removeCard(cardId), true);
    await settle();
    assert.equal(Store.getActiveProject().id, projectId);
    assert.deepEqual(Store.getActiveProject().cardIds, []);
    assert.equal(Store.getDocument(), null);
    assert.equal(dom.getElementById('rawInput').value, '');
    assert.equal(dom.getElementById('rawInput').disabled, true);
    assert.equal(dom.getElementById('addCardBtn').disabled, false);
    assert.deepEqual(TableRegistry.getRaw(), []);
    assert.deepEqual(App.rendered, []);
    assert.equal(SourceController.getCurrentPaste(text), null);
    Store.transition('card:create');
    await settle();
    assert.equal(Store.getActiveProject().cardIds.length, 1);
    assert.equal(Store.curr().raw, '');
    assert.equal(dom.getElementById('rawInput').disabled, false);
  });

  it('keeps a deleted final project empty until New tab creates Analysis 1', async () => {
    const { Store, TabController, TableRegistry, dom } = setup();
    await settle();
    dom.getElementById('rawInput').value = 'old original';
    Store.transition('source:replace', { text:'old original' });
    const id = Store.getActiveProject().id;
    assert.equal(TabController.remove(id), true);
    await settle();
    assert.deepEqual(Store.getState().projects, [], 'rendering must not recreate a project');
    assert.equal(dom.getElementById('rawInput').value, '');
    assert.equal(dom.getElementById('rawInput').disabled, true);
    assert.deepEqual(TableRegistry.getRaw(), []);
    TabController.createNew();
    await settle();
    assert.equal(Store.getActiveProject().title, 'Analysis 1');
    assert.equal(Store.getState().projects.length, 1);
    assert.equal(Store.curr().raw, '');
    assert.equal(dom.getElementById('rawInput').disabled, false);
  });
});
