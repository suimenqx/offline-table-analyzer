import {afterEach, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {loadModules} from '../helpers/load-modules.mjs';
import {createDOMSandbox} from '../mocks/dom.js';
import {createStorageMock} from '../mocks/storage.js';

let Store, SourceController;
afterEach(() => { clearTimeout(Store?.saveTimer); SourceController?.resetPendingInput(); });
function setup() {
  const dom=createDOMSandbox();
  const target=dom.getElementById('targetTableSelect');target.options=[];target.add=option=>target.options.push(option);
  const {OTA}=loadModules(['app'], {document:dom.document,window:dom.window,localStorage:createStorageMock(),
    CustomEvent:dom.MockCustomEvent,Option:function(text,value){return {text,value};}});
  const {App}=OTA.start('app');
  ({Store}=OTA.require('store'));({SourceController}=OTA.require('source-controller'));
  return {App,Store,SourceController,TableRegistry:OTA.require('table-registry').TableRegistry,dom};
}

describe('Card parse and preview UI metadata', () => {
  it('updates the legacy linked card label immediately when its project is renamed', async () => {
    const {Store,dom}=setup();
    Store.transition('card:rename',{id:Store.curr().id,title:Store.getActiveProject().title});
    await new Promise(resolve=>setTimeout(resolve,20));
    Store.transition('project:rename',{id:Store.getActiveProject().id,title:'Legacy renamed'});
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(dom.getElementById('sourceEditorLabel').textContent,'当前编辑：Legacy renamed');
  });

  it('keeps an excluded single card editable but out of preview and export', () => {
    const {App,Store,TableRegistry,SourceController}=setup();
    SourceController.displayText('[{"id":"1"}]');
    App.run(false);
    Store.transition('card:visible',{id:Store.curr().id,visible:false});
    App.renderPreview();
    assert.deepEqual(App.rendered, []);
    assert.deepEqual(App.getFullExportTables(), []);
    assert.equal(Store.curr().raw, '[{"id":"1"}]');
    assert.equal(TableRegistry.getRaw().length, 1, 'source parse details remain available');
  });

  it('does not prepare an empty workbook when the only source is excluded', async () => {
    const {App,Store,SourceController}=setup();
    SourceController.displayText('[{"id":"1"}]');
    App.run(false);
    Store.transition('card:visible',{id:Store.curr().id,visible:false});
    assert.equal(await App.prepareExport(),null);
  });

  it('shows actual card parse counts and separate full preview scope, then invalidates changed input', () => {
    const {App,SourceController,dom}=setup();
    SourceController.displayText('[{"id":"1"},{"id":"2"}]');
    assert.equal(App.run(false),true);
    App.renderPreview();
    assert.match(SourceController.getCardStatus(Store.curr().id).text,/2 行 · 已解析/);
    assert.match(dom.getElementById('datasetSummary').textContent,/表池 1\/1 张卡片.*1 表.*2 行/);
    Store.transition('source:replace',{text:'changed'});
    assert.equal(SourceController.getCardStatus(Store.curr().id).state,'pending');
  });
});
