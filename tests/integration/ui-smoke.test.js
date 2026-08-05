/**
 * UI 冒烟测试 — 验证核心功能在沙箱中的行为
 * 替代旧的 72 个 html.includes(token) 字符串匹配
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { createStorageMock } from '../mocks/storage.js';
import { createDOMSandbox } from '../mocks/dom.js';
import { loadModules } from '../helpers/load-modules.mjs';

// 首次加载触发缓存
const { OTA } = loadModules([], {});

function setupDOM() {
  const storage = createStorageMock();
  const dom = createDOMSandbox();
  globalThis.document = dom.document;
  globalThis.window = dom.window;
  globalThis.localStorage = storage;
  globalThis.CustomEvent = dom.MockCustomEvent;
  globalThis.MouseEvent = dom.MockMouseEvent;
  return { storage, dom };
}

describe('App bootstrap', () => {
  it('initializes and creates a workspace', () => {
    setupDOM();
    const app = OTA.start('app').App;
    assert.ok(app);
    assert.ok(OTA.require('store').Store.state.docs.length > 0);
  });

  it('late-bound App dependency works', () => {
    setupDOM();
    OTA.start('app');
    const { JoinEditor } = OTA.require('join-editor');
    assert.equal(JoinEditor.getTableData('missing'), null);
  });

  it('reloads the active document when an existing tab is activated', async () => {
    setupDOM();
    const { App } = OTA.require('app');
    const { Store } = OTA.require('store');
    const { TableRegistry } = OTA.require('table-registry');
    Store.state.docs = [
      { id: 'a', title: 'First', raw: 'id,name\n1,Alice', ui: {} },
      { id: 'b', title: 'Second', raw: 'id,name\n2,Bob', ui: {} },
    ];
    Store.state.activeId = 'a';
    App.loadDoc();

    Store.transition('tab:activate', { id: 'b' });
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.equal(document.getElementById('rawInput').value, 'id,name\n2,Bob');
    assert.equal(TableRegistry.getRaw()[0].rows[0][1], 'Bob');
  });

  it('clears the previous table registry when parsing the active document fails', () => {
    setupDOM();
    const { App } = OTA.require('app');
    const { Store } = OTA.require('store');
    const { Parser } = OTA.require('parser-facade');
    const { TableRegistry } = OTA.require('table-registry');
    const targetSelect = document.getElementById('targetTableSelect');
    targetSelect.options = [];
    targetSelect.add = option => targetSelect.options.push(option);
    Store.state.docs = [{ id: 'a', title: 'First', raw: '', ui: {} }];
    Store.state.activeId = 'a';
    TableRegistry.setResult({
      tables: [{ name: 'Old', headers: ['id'], rows: [['1']] }],
      format: 'csv', label: 'CSV', diagnostics: [], candidates: [],
    });
    const previousParse = Parser.parse;
    const previousConsoleError = console.error;
    Parser.parse = () => { throw new Error('forced parse failure'); };
    console.error = () => {};
    try {
      document.getElementById('rawInput').value = 'broken input';
      App.run(false);
      assert.equal(TableRegistry.getRaw().length, 0);
      assert.equal(TableRegistry.getFormat(), 'error');
    } finally {
      Parser.parse = previousParse;
      console.error = previousConsoleError;
    }
  });

  it('coalesces multiple render requests from one state batch', async () => {
    setupDOM();
    const { App } = OTA.require('app');
    await new Promise(resolve => setTimeout(resolve, 20));
    const original = App.renderPreview;
    let renders = 0;
    App.renderPreview = () => { renders++; };
    App._renderQueued = false;
    App._renderPending = false;
    try {
      App.requestRender();
      App.requestRender();
      App.requestRender();
      await new Promise(resolve => setTimeout(resolve, 15));
      assert.equal(renders, 1);
    } finally {
      App.renderPreview = original;
      App._renderQueued = false;
      App._renderPending = false;
    }
  });
});

describe('Selection.buildLuaClipboardMatrix', () => {
  it('restores original record orientation for row-header mode', () => {
    setupDOM();
    const { Select } = OTA.require('selection');

    const rowHeaderNames = ['fieldA', 'fieldB'];
    const rowHeaderValues = { '0:0': '1', '0:1': '2', '1:0': '3', '1:1': '4' };

    const fakeTable = {
      dataset: { viewMode: 'row-header' },
      querySelectorAll(selector) {
        if (selector === 'tbody tr') {
          return rowHeaderNames.map(name => ({
            querySelector() { return { textContent: name }; },
          }));
        }
        return [];
      },
      querySelector(selector) {
        const match = /data-vr="(\d+)"\]\[data-vc="(\d+)"/.exec(selector);
        if (!match) return null;
        const value = rowHeaderValues[`${match[1]}:${match[2]}`];
        return value === undefined ? null : { textContent: value };
      },
    };

    const restored = Select.buildLuaClipboardMatrix(fakeTable, 0, 1, 0, 1);
    assert.equal(JSON.stringify(restored), JSON.stringify([['fieldA', 'fieldB'], ['1', '3'], ['2', '4']]));
  });
});

describe('Selection.copy', () => {
  it('omits the header when the copy preference is disabled', () => {
    setupDOM();
    const { Select } = OTA.require('selection');
    const { Store } = OTA.require('store');
    Store.state.copyFormat = 'default';
    Store.state.copyWithHeaders = false;

    const values = { '0:0': '1', '0:1': 'Alice', '1:0': '2', '1:1': 'Bob' };
    const fakeTable = {
      dataset: { viewMode: 'column-header' },
      querySelectorAll(selector) {
        if(selector === 'thead th') return [{ textContent: 'id' }, { textContent: 'name' }];
        return [];
      },
      querySelector(selector) {
        const match = /data-vr="(\d+)"\]\[data-vc="(\d+)"/.exec(selector);
        if(!match) return null;
        const value = values[`${match[1]}:${match[2]}`];
        return value === undefined ? null : { textContent: value };
      },
    };

    const originalQuery = document.querySelector;
    document.querySelector = selector => selector === 'table[data-idx="0"]' ? fakeTable : null;
    Select.start = { idx: 0, r: 0, c: 0 };
    Select.end = { idx: 0, r: 1, c: 1 };
    const copied = {};
    Select.copy({ clipboardData: { setData(type, value) { copied[type] = value; } } });
    document.querySelector = originalQuery;

    assert.equal(copied['text/plain'], '1\tAlice\n2\tBob');
    assert.ok(!copied['text/html'].includes('<thead>'));
    Select.clear();
  });
});

describe('Filter via App.proc', () => {
  it('applies regex alternation correctly', () => {
    setupDOM();
    const App = OTA.require('app').App;
    assert.equal(typeof App.proc, 'function');

    const filterTable = {
      name: 'Logs', headers: ['level', 'message'],
      rows: [['WARN', 'memory'], ['ERROR', 'timeout'], ['INFO', 'ok']],
    };

    const regexRows = App.proc(filterTable, {
      rules: {}, columnFilters: {}, globalFilter: '/ERROR|WARN/',
    }).rows;
    assert.equal(regexRows.length, 2);
    assert.equal(regexRows[0].d[0], 'WARN');
    assert.equal(regexRows[1].d[0], 'ERROR');
  });
});

describe('Runtime API surface', () => {
  it('exposes all required methods on App and Store', () => {
    setupDOM();
    const App = OTA.require('app').App;
    const Store = OTA.require('store').Store;

    for (const method of ['proc', 'init', 'bind']) {
      assert.equal(typeof App[method], 'function', `App.${method} should be callable`);
    }

    for (const method of ['addDoc', 'removeDoc', 'renameDoc', 'moveDoc', 'curr', 'save', 'init']) {
      assert.equal(typeof Store[method], 'function', `Store.${method} should be callable`);
    }
  });
});

describe('Paste source diagnostics', () => {
  it('shows escaped source formats without executing pasted HTML', () => {
    setupDOM();
    const { App } = OTA.require('app');
    const { SourceController } = OTA.require('source-controller');
    const { TableRegistry } = OTA.require('table-registry');
    const plain = 'id\tname\n1\tAlice';
    const html = '<table><tr><td>Alice</td></tr></table><script>alert(1)</script>';
    document.getElementById('rawInput').value = plain;
    SourceController.setPasteSnapshot(SourceController.createSourceSnapshot({
      plain,
      html,
      types: ['text/plain', 'text/html'],
      formats: [
        SourceController.createSourceFormat('text/plain', plain),
        SourceController.createSourceFormat('text/html', html),
      ],
    }));
    TableRegistry.setResult({ format: 'html-table', tables: [], diagnostics: [], candidates: [] });

    const sourceButton = document.getElementById('pasteSourceBtn');
    App.updatePasteSourceButton();
    assert.equal(sourceButton.classList.contains('hidden'), false);

    let modalTitle = '';
    let modalBody = '';
    const originalModal = App.modal;
    App.modal = (title, body) => { modalTitle = title; modalBody = body; };
    try {
      App.showPasteSource();
    } finally {
      App.modal = originalModal;
    }
    assert.equal(modalTitle, '粘贴源诊断');
    assert.ok(modalBody.includes('&lt;table&gt;'));
    assert.ok(modalBody.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!modalBody.includes('<table>'));
  });
});
