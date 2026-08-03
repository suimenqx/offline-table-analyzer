/**
 * 共享 DOM Mock 工厂
 * 生成可配置的假浏览器 DOM 环境，供测试使用。
 * 所有 UI 相关测试共用此工厂，消除重复定义。
 */
export function createDOMSandbox(options = {}) {
  const elements = new Map();

  function defaultElement(tag = 'div') {
    const children = [];
    const listeners = {};
    const node = {
      tagName: tag.toUpperCase(),
      value: '',
      checked: false,
      disabled: false,
      hidden: false,
      innerHTML: '',
      textContent: '',
      innerText: '',
      className: '',
      id: '',
      style: {},
      dataset: {},
      children,
      childNodes: children,
      classList: {
        _list: [],
        add(...names) { names.forEach(n => { if (!this._list.includes(n)) this._list.push(n); }); },
        remove(...names) { this._list = this._list.filter(n => !names.includes(n)); },
        contains(name) { return this._list.includes(name); },
        toggle(name) {
          if (this.contains(name)) { this.remove(name); return false; }
          this.add(name); return true;
        },
      },
      addEventListener(event, fn) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(fn);
      },
      removeEventListener(event, fn) {
        if (!listeners[event]) return;
        listeners[event] = listeners[event].filter(f => f !== fn);
      },
      dispatchEvent(event) {
        const fns = listeners[event.type] || [];
        fns.forEach(fn => fn.call(this, event));
        return true;
      },
      setAttribute(name, value) { this[name] = value; },
      removeAttribute(name) { delete this[name]; },
      focus() {},
      select() {},
      click() { this.dispatchEvent(new (options.MouseEvent || MockMouseEvent)('click')); },
      appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
        return child;
      },
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0) this.children.splice(idx, 1);
        return child;
      },
      querySelector(selector) {
        // 简单支持 id/class/tag 选择器
        for (const child of this.children) {
          if (selector.startsWith('#') && child.id === selector.slice(1)) return child;
          if (selector.startsWith('.') && child.classList.contains(selector.slice(1))) return child;
          if (child.tagName && child.tagName.toLowerCase() === selector.toLowerCase()) return child;
        }
        // 递归搜索
        for (const child of this.children) {
          const found = child.querySelector && child.querySelector(selector);
          if (found) return found;
        }
        return null;
      },
      querySelectorAll(selector) {
        const results = [];
        for (const child of this.children) {
          if (selector.startsWith('.') && child.classList.contains(selector.slice(1))) results.push(child);
          if (child.tagName && child.tagName.toLowerCase() === selector.toLowerCase()) results.push(child);
          if (child.querySelectorAll) results.push(...child.querySelectorAll(selector));
        }
        return results;
      },
      closest(selector) {
        let el = this.parentNode;
        while (el) {
          if (selector.startsWith('.') && el.classList.contains(selector.slice(1))) return el;
          el = el.parentNode;
        }
        return null;
      },
      getBoundingClientRect() {
        return { top: 0, left: 0, width: 100, height: 30, right: 100, bottom: 30 };
      },
    };
    return node;
  }

  class MockMouseEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.target = init.target || null;
      this.ctrlKey = init.ctrlKey || false;
      this.shiftKey = init.shiftKey || false;
      this.key = init.key || '';
      this.preventDefault = () => {};
      this.stopPropagation = () => {};
    }
  }

  class MockCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail || {};
    }
  }

  class MockClipboardEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.clipboardData = init.clipboardData || {
        getData() { return ''; },
        setData() {},
      };
      this.preventDefault = () => {};
    }
  }

  function getElementById(id) {
    if (!elements.has(id)) {
      const el = defaultElement();
      el.id = id;
      elements.set(id, el);
    }
    return elements.get(id);
  }

  const document = {
    title: '',
    body: getElementById('body'),
    documentElement: getElementById('documentElement'),
    getElementById,
    createElement(tag) {
      const el = defaultElement(tag || 'div');
      if (tag === 'option') {
        return { text: '', value: '', ...el };
      }
      return el;
    },
    createTextNode(text) {
      return { textContent: text, nodeType: 3 };
    },
    querySelector(sel) { return document.body.querySelector(sel); },
    querySelectorAll(sel) { return document.body.querySelectorAll(sel); },
    addEventListener(event, fn) {},
    removeEventListener(event, fn) {},
    dispatchEvent(event) { return true; },
  };

  const window = {
    matchMedia() { return { matches: false, addEventListener() {} }; },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    getComputedStyle() { return {}; },
    requestAnimationFrame(fn) { return setTimeout(fn, 0); },
    cancelAnimationFrame(id) { clearTimeout(id); },
    MouseEvent: MockMouseEvent,
    CustomEvent: MockCustomEvent,
    ClipboardEvent: MockClipboardEvent,
    navigator: {
      clipboard: {
        writeText() { return Promise.resolve(); },
        write() { return Promise.resolve(); },
      },
    },
  };

  return { document, window, elements, getElementById, MockMouseEvent, MockCustomEvent };
}
