const { loadBuiltModules } = require('./load-built-modules');
const { performance } = require('perf_hooks');

function classList() {
  return { add() {}, remove() {}, contains() { return false; }, toggle() {} };
}

function element() {
  const node = {
    value: '', checked: false, disabled: false, hidden: false, innerHTML: '', textContent: '', innerText: '',
    style: {}, dataset: {}, children: [], classList: classList(),
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, click() {},
    appendChild(child) { this.children.push(child); return child; }, removeChild() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; }
  };
  return new Proxy(node, {
    get(target, key) {
      if(key in target) return target[key];
      if(key === 'length') return 0;
      if(key === 'options') return [];
      return () => {};
    },
    set(target, key, value) { target[key] = value; return true; }
  });
}

const elements = new Map();
const getElement = id => {
  if(!elements.has(id)) elements.set(id, element());
  return elements.get(id);
};
const storage = new Map();
const document = {
  title: '',
  body: getElement('body'),
  documentElement: getElement('documentElement'),
  getElementById: getElement,
  createElement: element,
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
  removeEventListener() {}
};
const Option = function(text = '', value = '') {
  const option = element();
  option.text = text;
  option.value = value;
  return option;
};
const sandbox = {
  console,
  document,
  window: { matchMedia() { return { matches: false }; }, addEventListener() {} },
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  },
  alert() {},
  confirm() { return true; },
  setTimeout,
  clearTimeout,
  performance,
  Option
};

const { OTA } = loadBuiltModules(sandbox);
const app = OTA.start('app').App;
if(!app || !OTA.require('store').Store.state.docs.length) throw new Error('application bootstrap did not create a workspace');
if(OTA.require('join-editor').JoinEditor.getTableData('missing') !== null) throw new Error('late-bound App dependency is not working');
console.log('Startup smoke test passed: app module initialized');
