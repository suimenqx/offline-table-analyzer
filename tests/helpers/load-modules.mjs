/**
 * 核心测试助手：直接加载 src/ 源文件到 OTA 模块系统
 *
 * 不再依赖 build 产物（index.html），直接从源文件加载模块。
 * 每次调用都会创建独立 OTA 注册表和模块单例。
 * 模块通过独立的 host-realm 函数作用域加载，避免跨 realm 断言问题和顶层名称冲突。
 *
 * 用法：
 *   import { loadModules } from '../helpers/load-modules.mjs';
 *   const { OTA } = loadModules(['import-engine', 'joiner']);
 *   const { ImportEngine } = OTA.require('import-engine');
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const cjsRequire = createRequire(import.meta.url);
const { MODULES } = cjsRequire('../../tools/build-release.cjs');

// Tests and release generation use the same source module order.
const MODULE_ORDER = MODULES.map(([file]) => file);

// 需要注入的全局变量名
const INJECTED_GLOBALS = ['window', 'document', 'localStorage', 'CustomEvent', 'MouseEvent', 'Option', 'alert', 'confirm'];

const MODULE_NAMES = new Set(MODULE_ORDER.flatMap((relPath) => {
  const source = fs.readFileSync(path.join(SRC, relPath), 'utf8');
  return [...source.matchAll(/OTA\.define\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
}));

function defaultGlobals() {
  return {
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
}

/**
 * 加载所有源模块声明并返回一个全新的 OTA 实例。
 *
 * @param {string[]} targetModules - 需要的模块名，用于提前校验拼写；所有模块声明都会注册，依赖仍按需实例化
 * @param {object} overrides - 模块声明期间和后续测试中使用的全局覆盖（如 document/localStorage mock）
 * @returns {{ OTA }} OTA 实例
 */
export function loadModules(targetModules = [], overrides = {}) {
  const missing = targetModules.filter((name) => !MODULE_NAMES.has(name));
  if (missing.length) throw new Error(`Unknown test module(s): ${missing.join(', ')}`);

  const saved = new Map();
  const globals = { ...defaultGlobals(), ...overrides };
  const globalKeys = new Set([...INJECTED_GLOBALS, ...Object.keys(overrides)]);
  for (const key of globalKeys) {
    saved.set(key, { existed: key in globalThis, value: globalThis[key] });
    if (key in globals) globalThis[key] = globals[key];
  }

  const windowTarget = globalThis.window;
  globalThis.window = new Proxy(windowTarget, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop in globalThis && !INJECTED_GLOBALS.includes(prop)) return globalThis[prop];
      return undefined;
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });

  let OTA;
  try {
    for (const relPath of MODULE_ORDER) {
      if (relPath === 'bootstrap.js') continue;
      const fullPath = path.join(SRC, relPath);
      if (!fs.existsSync(fullPath)) continue;
      try {
        const source = fs.readFileSync(fullPath, 'utf8');
        const filename = fullPath;
        if (relPath === 'core/module-loader.js') {
          vm.compileFunction(source, [], { filename })();
          OTA = globalThis.window.OTA;
        } else {
          vm.compileFunction(source, ['OTA'], { filename })(OTA);
        }
      } catch (err) {
        throw new Error(`Failed to load module ${relPath}: ${err.message}`);
      }
    }
    if (!OTA) throw new Error('OTA module registry not found after loading modules.');
  } finally {
    for (const [key, original] of saved) {
      if (key in overrides) globalThis[key] = overrides[key];
      else if (original.existed) globalThis[key] = original.value;
      else delete globalThis[key];
    }
  }

  return { OTA };
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
