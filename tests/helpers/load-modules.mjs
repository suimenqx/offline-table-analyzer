/**
 * 核心测试助手：直接加载 src/ 源文件到 OTA 模块系统
 *
 * 不再依赖 build 产物（index.html），直接从源文件加载模块。
 * 使用 vm.runInThisContext 保持同一 realm，避免 assert.deepStrictEqual 跨 realm 失败。
 * 所有模块在第一次调用时一次性加载，后续调用直接复用缓存的 OTA 实例。
 *
 * 用法：
 *   import { loadModules } from '../helpers/load-modules.mjs';
 *   const { OTA } = loadModules(['import-engine', 'joiner']);
 *   const { ImportEngine } = OTA.require('import-engine');
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

// 模块加载顺序 —— 与 tools/build-release.cjs 中的 MODULES 保持一致
const MODULE_ORDER = [
  'core/module-loader.js',
  'core/runtime.js',
  'core/table-utils.js',
  'core/filter-engine.js',
  'state/store.js',
  'core/dispatch.js',
  'export/exporter.js',
  'export/clipboard.js',
  'parsing/header-resolver.js',
  'parsing/text-layout.js',
  'parsing/format-sniffer.js',
  'parsing/delimited-utils.js',
  'parsing/parser-helpers.js',
  'parsing/parsers/html-parser.js',
  'parsing/parsers/delimited-parsers.js',
  'parsing/parsers/data-block-parser.js',
  'parsing/parsers/pipe-table-parser.js',
  'parsing/parsers/ascii-table-parser.js',
  'parsing/parsers/fixed-width-parser.js',
  'parsing/parsers/cli-multi-block-parser.js',
  'parsing/parsers/aligned-table-parser.js',
  'parsing/parsers/plain-text-parser.js',
  'parsing/parsers/cli-table-data-parser.js',
  'parsing/import-engine.js',
  'parsing/legacy-facade.js',
  'transform/joiner.js',
  'core/table-registry.js',
  'ui/table-builder.js',
  'ui/selection.js',
  'ui/join-editor.js',
  'ui/view-manager.js',
  'ui/source-controller.js',
  'ui/cell-edit-controller.js',
  'ui/filter-controller.js',
  'ui/modal-controller.js',
  'ui/tab-controller.js',
  'ui/keyboard-controller.js',
  'ui/export-controller.js',
  'ui/app.js',
  'bootstrap.js',
];

// 需要注入的全局变量名
const INJECTED_GLOBALS = ['window', 'document', 'localStorage', 'CustomEvent', 'MouseEvent', 'Option', 'alert', 'confirm'];

// 全局一次性加载状态
let _modulesLoaded = false;
let _cachedOTA = null;

/**
 * 加载源模块（全局仅执行一次）并返回 OTA 实例
 *
 * @param {string[]} _targetModules - 保留参数，兼容旧接口（实际忽略，全量加载）
 * @param {object} overrides - 每次调用时覆盖全局变量（如更换 localStorage mock）
 * @returns {{ OTA }} OTA 实例
 */
export function loadModules(_targetModules = [], overrides = {}) {
  // === 首次加载：注入全局 mock 并执行所有源文件 ===
  if (!_modulesLoaded) {
    const defaults = {
      window: {},
      document: {
        getElementById() { return null; },
        createElement() { return { style: {}, classList: { add() {}, remove() {}, contains() { return false; } } }; },
        createTextNode(text) { return { textContent: text }; },
        body: { addEventListener() {}, appendChild() {}, removeChild() {} },
        documentElement: { setAttribute() {}, getAttribute() { return null; } },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return true; },
      },
      localStorage: {
        _data: new Map(),
        getItem(key) { return this._data.get(key) ?? null; },
        setItem(key, value) { this._data.set(key, String(value)); },
        removeItem(key) { this._data.delete(key); },
        get length() { return this._data.size; },
      },
      alert() {},
      confirm() { return true; },
      CustomEvent: class CustomEvent {
        constructor(type, init = {}) { this.type = type; this.detail = init.detail || {}; }
      },
      MouseEvent: class MouseEvent {
        constructor(type, init = {}) { this.type = type; this.ctrlKey = init.ctrlKey || false; this.shiftKey = init.shiftKey || false; }
      },
      Option: function(text, value) { return { text, value }; },
    };

    // 保存原始全局变量，注入默认 mock
    const saved = {};
    for (const key of INJECTED_GLOBALS) {
      if (key in globalThis) saved[key] = globalThis[key];
      globalThis[key] = defaults[key];
    }

    // window -> globalThis 代理
    globalThis.window = new Proxy(globalThis.window, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop in globalThis && !INJECTED_GLOBALS.includes(prop)) return globalThis[prop];
        return undefined;
      },
      set(target, prop, value) { target[prop] = value; return true; },
    });

    try {
      const runFile = (filePath) => {
        const source = fs.readFileSync(filePath, 'utf8');
        vm.runInThisContext(source, { filename: path.basename(filePath) });
      };

      // 加载所有模块（除 bootstrap.js — 它会立即调用 OTA.start('app')）
      for (const relPath of MODULE_ORDER) {
        if (relPath === 'bootstrap.js') continue;
        const fullPath = path.join(SRC, relPath);
        if (!fs.existsSync(fullPath)) continue;
        try {
          runFile(fullPath);
        } catch (err) {
          throw new Error(`Failed to load module ${relPath}: ${err.message}`);
        }
      }

      _cachedOTA = globalThis.window.OTA;
      if (!_cachedOTA) throw new Error('OTA module registry not found after loading modules.');
      _modulesLoaded = true;
    } finally {
      // 恢复原始全局变量
      for (const key of INJECTED_GLOBALS) {
        if (key in saved) {
          globalThis[key] = saved[key];
        } else {
          delete globalThis[key];
        }
      }
    }
  }

  // === 每次调用：应用 overrides 到 globalThis ===
  if (Object.keys(overrides).length > 0) {
    for (const key of Object.keys(overrides)) {
      globalThis[key] = overrides[key];
    }
    // 确保 window 代理也能访问到 overrides
    if (overrides.window) {
      globalThis.window = overrides.window;
    }
  }

  return { OTA: _cachedOTA };
}

/**
 * 快速加载模块并获取导出
 */
export function quickRequire(exportName, moduleName) {
  const { OTA } = loadModules();
  const mod = OTA.require(moduleName);
  if (!mod || !(exportName in mod)) {
    throw new Error(`Export "${exportName}" not found in module "${moduleName}"`);
  }
  return mod[exportName];
}
