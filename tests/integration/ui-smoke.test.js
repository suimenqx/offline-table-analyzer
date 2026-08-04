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
