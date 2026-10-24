import {afterEach, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {loadModules} from '../helpers/load-modules.mjs';
import {createDOMSandbox} from '../mocks/dom.js';
import {createStorageMock} from '../mocks/storage.js';

let Store, SourceController;
afterEach(() => { clearTimeout(Store?.saveTimer); SourceController?.resetPendingInput(); });
function setup() {
  const dom = createDOMSandbox();
  const target = dom.getElementById('targetTableSelect');
  target.options = []; target.add = option => target.options.push(option);
  const {OTA} = loadModules(['app'], {document:dom.document, window:dom.window,
    localStorage:createStorageMock(), CustomEvent:dom.MockCustomEvent});
  ({Store} = OTA.require('store')); ({SourceController} = OTA.require('source-controller'));
  Store.init();
  return {App:OTA.require('app').App, TableRegistry:OTA.require('table-registry').TableRegistry, dom};
}
const byClass = (root, name) => {
  if(root.className?.split(' ').includes(name)) return root;
  for(const child of root.children || []) { const found = byClass(child, name); if(found) return found; }
  return null;
};
const headerText = 'alpha,beta\none,two\nthree,four';

describe('Visible parse status and confirmation feedback', () => {
  it('keeps icon actions with the name and one compact status row without repeated instructions', () => {
    const {dom} = setup();
    SourceController.renderCards();
    const card = dom.getElementById('cardList').children[0];
    const head = byClass(card, 'data-card-head');
    const detail = byClass(card, 'data-card-detail');
    assert.equal(byClass(card, 'card-source-symbol'), null);
    assert.equal(byClass(card, 'card-editing-badge'), null);
    assert.deepEqual(head.children.map(node => node.className), [
      'card-drag-handle', 'data-card-title', 'card-visibility', 'card-remove',
    ]);
    assert.deepEqual(detail.children.map(node => node.className), ['card-status-badge', 'data-card-summary']);
    assert.equal(card['aria-current'], 'true');
    assert.match(card['aria-label'], /编辑中/);
    assert.equal(dom.getElementById('sourceEditorLabel').textContent, `原文 · ${Store.curr().title}`);
    const status = byClass(detail, 'card-status-label');
    Store.transition('source:replace', {text:headerText});
    SourceController.renderCards();
    assert.equal(dom.getElementById('cardList').children[0], card, 'status updates keep the keyed card node');
    assert.equal(byClass(detail, 'card-status-label'), status);
    assert.equal(status.textContent, '待解析');
  });

  it('keeps actionable state labels while merging success into its result summary', () => {
    const {TableRegistry, dom} = setup();
    const id = Store.curr().id;
    const label = () => byClass(dom.getElementById('cardList'), 'card-status-label')?.textContent;
    SourceController.renderCards();
    assert.equal(label(), '空');
    Store.transition('source:replace', {text:headerText});
    SourceController.renderCards();
    assert.equal(label(), '待解析');
    const context = {docId:id, sourceRevision:Store.curr().sourceRevision};
    SourceController.setCardParsing(context, true);
    assert.equal(label(), '解析中');
    SourceController.setCardParsing(context, false);
    for(const [result, expected] of [
      [{format:'ambiguous', tables:[]}, '待确认'],
      [{format:'error', tables:[]}, '解析失败'],
      [{format:'empty', tables:[]}, '未识别表格'],
      [{format:'csv', label:'CSV', tables:[{headers:['id'], rows:[['1']]}]}, '解析完成'],
    ]) {
      TableRegistry.recordParse(context, result);
      SourceController.renderCards();
      assert.equal(label(), expected);
      assert.ok(byClass(dom.getElementById('cardList'), 'card-status-badge'));
      assert.equal(byClass(dom.getElementById('cardList'), 'card-status-label').hidden, result.format === 'csv');
    }
  });

  it('uses an eye toggle without changing the active card, original input or parse summary', () => {
    const {App, dom} = setup();
    SourceController.displayText('[{"id":"1"}]');
    App.run(false);
    SourceController.renderCards();
    const id = Store.curr().id;
    const card = dom.getElementById('cardList').children[0];
    const toggle = byClass(card, 'card-visibility');
    assert.equal(toggle.tagName, 'BUTTON');
    assert.equal(toggle['aria-pressed'], 'true');
    toggle.onclick({stopPropagation(){}});
    SourceController.renderCards();
    assert.equal(toggle['aria-pressed'], 'false');
    assert.match(toggle.title, /在分析结果中显示/);
    assert.match(card.className, /active.*excluded-card/);
    assert.equal(Store.curr().id, id);
    assert.equal(Store.curr().raw, '[{"id":"1"}]');
    assert.equal(SourceController.getCardStatus(id).state, 'ready');
    toggle.onclick({stopPropagation(){}});
    SourceController.renderCards();
    assert.equal(toggle['aria-pressed'], 'true');
  });

  it('shows only actionable editor feedback and clears stale diagnostics as input changes', () => {
    const {App, dom} = setup();
    SourceController.displayText('[{"id":"1"}]');
    App.run(false);
    assert.equal(dom.getElementById('parseStatus').hidden, true);
    assert.equal(dom.getElementById('sourceDiagnosticsBtn').disabled, false);
    App.updateSourceParseState('pending');
    assert.equal(dom.getElementById('parseStatusText').textContent, '等待解析');
    assert.equal(dom.getElementById('sourceDiagnosticsBtn').disabled, true);
    App.updateSourceParseState('manual');
    assert.equal(dom.getElementById('parseStatus').hidden, true);
    App.updateSourceParseState('large');
    assert.equal(dom.getElementById('parseStatus').hidden, false);
    assert.match(dom.getElementById('parseStatusText').textContent, /手动解析/);
  });

  it('merges the large-preview and whole-card paste notice, keeping normal editing quiet', () => {
    const {dom} = setup();
    SourceController.displayText('small');
    SourceController.syncEditorContext();
    assert.equal(dom.getElementById('sourcePreviewNotice').hidden, true);
    Store.transition('source:replace', {text:'x'.repeat(SourceController.EDITOR_LIMIT + 1)});
    SourceController.displayText(Store.curr().raw);
    SourceController.syncEditorContext();
    assert.equal(dom.getElementById('sourcePreviewNotice').hidden, false);
    assert.match(dom.getElementById('sourcePreviewNotice').textContent, /完整原文.*已保留/);
    assert.match(dom.getElementById('sourcePreviewNotice').textContent, /粘贴.*替换整卡/);
  });

  for(const text of [headerText, 'id,name;state\n1,Alice;ok', '报告\nid,name\n1,Alice\nbad,too,many,fields\n2,Bob\n结束']) {
    it(`explains the withheld preview and opens existing confirmation choices for ${text.split('\n')[0]}`, () => {
      const {App, TableRegistry, dom} = setup();
      SourceController.displayText(text);
      assert.equal(App.run(false), true);
      assert.equal(TableRegistry.getFormat(), 'ambiguous');
      App.renderPreview();
      const notice = byClass(dom.getElementById('previewArea'), 'parse-feedback');
      assert.ok(notice, 'ambiguity must not look like a broken or first-use empty preview');
      assert.match(byClass(notice, 'parse-feedback-title').textContent, /待确认/);
      assert.match(byClass(notice, 'parse-feedback-description').textContent, /确认.*表格/);
      assert.match(byClass(notice, 'parse-feedback-description').textContent, /原文已保留/);
      assert.equal(dom.getElementById('diagnosticsBtn').textContent, '确认候选');
      assert.match(dom.getElementById('parseStatus').className, /confirm/);
      let shown;
      App.modal = (title, content) => { shown = {title, content}; };
      notice.querySelector('button').onclick();
      assert.equal(shown.title, '解析详情');
      assert.match(shown.content, /diagnostic-candidate-btn/);
      assert.equal(Store.curr().raw, text);
    });
  }

  it('offers diagnostics rather than promising a choice when no candidates are available', () => {
    const {App, TableRegistry, dom} = setup();
    TableRegistry.setResult({format:'ambiguous', tables:[], candidates:[], diagnostics:[]});
    App.updateImportSummary();
    App.renderPreview();
    const notice = byClass(dom.getElementById('previewArea'), 'parse-feedback');
    assert.equal(byClass(notice, 'parse-feedback-title').textContent, '解析方式待确认');
    assert.equal(notice.querySelector('button').textContent, '查看解析详情');
    assert.match(byClass(notice, 'parse-feedback-description').textContent, /手动选择格式/);
    assert.equal(dom.getElementById('diagnosticsBtn').classList.contains('hidden'), false);
  });

  it('retains already-parsed pool tables below the confirmation notice', () => {
    const {App, dom} = setup();
    SourceController.displayText('[{"id":"001","name":"Alice"}]');
    App.run(false);
    const tables = App.getPreviewProcessedTables();
    SourceController.displayText(headerText);
    App.run(false);
    App.renderPreview(tables);
    const preview = dom.getElementById('previewArea');
    assert.ok(byClass(preview, 'parse-feedback'));
    assert.ok(byClass(preview, 'table-container'));
    assert.equal(App.rendered[0].rows[0].d[1], 'Alice');
  });

  it('points to an unresolved participating card even when another card is active', () => {
    const {App, TableRegistry, dom} = setup();
    Store.transition('source:replace', {text:headerText});
    const unresolved = Store.curr();
    TableRegistry.recordParse({docId:unresolved.id, sourceRevision:unresolved.sourceRevision}, {format:'ambiguous', tables:[]});
    Store.transition('card:create', {});
    TableRegistry.setResult(null);
    App.renderPreview();
    const notice = byClass(dom.getElementById('previewArea'), 'parse-feedback');
    assert.ok(notice);
    assert.match(byClass(notice, 'parse-feedback-source').textContent, new RegExp(unresolved.title));
    notice.querySelector('button').onclick();
    assert.equal(Store.curr().id, unresolved.id);
  });

  it('does not use a stale or excluded other-card summary as a confirmation blocker', () => {
    const {App, TableRegistry, dom} = setup();
    Store.transition('source:replace', {text:headerText});
    const card = Store.curr();
    TableRegistry.recordParse({docId:card.id, sourceRevision:card.sourceRevision}, {format:'ambiguous', tables:[]});
    Store.transition('card:visible', {id:card.id, visible:false});
    Store.transition('card:create', {});
    App.renderPreview();
    assert.equal(byClass(dom.getElementById('previewArea'), 'parse-feedback'), null);
    Store.transition('card:visible', {id:card.id, visible:true});
    Store.transition('source:replace', {docId:card.id, text:'new source'});
    App.renderPreview();
    assert.equal(byClass(dom.getElementById('previewArea'), 'parse-feedback'), null);
  });
});
