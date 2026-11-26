import { it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from '../helpers/load-modules.mjs';
import { createDOMSandbox } from '../mocks/dom.js';

it('keeps the latest JOIN statistics when background requests finish out of order', async t => {
  const dom = createDOMSandbox();
  const {OTA} = loadModules(['join-editor'], {document:dom.document});
  const {JoinEditor} = OTA.require('join-editor');
  const {TableRegistry} = OTA.require('table-registry');
  const requests = [];
  t.mock.method(TableRegistry, 'isBackground', () => true);
  t.mock.method(TableRegistry, 'getJoinStats', () => new Promise(resolve => requests.push(resolve)));

  dom.getElementById('jeLeftTable').value = 'Orders';
  dom.getElementById('jeRightTable').value = 'Customers';
  dom.getElementById('jeType').value = 'inner';
  JoinEditor.state.rels = [{l:'id', r:'id'}];
  const inner = JoinEditor.updatePreview();
  dom.getElementById('jeType').value = 'full';
  const full = JoinEditor.updatePreview();
  JoinEditor.state.order = [{side:'l', col:'id', alias:'Order ID'}];
  await JoinEditor.updatePreview();
  assert.equal(requests.length, 2);

  const counts = {matched:1, leftOnly:2, rightOnly:0};
  requests[1]({...counts, outRows:3});
  await full;
  const panel = dom.getElementById('jePreview');
  assert.match(panel.innerHTML, /输出行数<\/dt><dd>3<\/dd>/);
  const current = panel.innerHTML;
  requests[0]({...counts, outRows:1});
  await inner;
  assert.equal(panel.innerHTML, current);
});
