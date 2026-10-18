/**
 * Dispatch 测试套件 — 命令总线与 Store.transition 的集成
 */
import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { createStorageMock } from '../mocks/storage.js';
import { loadModules } from '../helpers/load-modules.mjs';

let storage, Store, dispatch;

const { OTA } = loadModules([], {});

beforeEach(() => {
  storage = createStorageMock();
  globalThis.localStorage = storage;
  globalThis.document = {
    getElementById() { return null; },
    createElement() { return { style: {}, classList: { add() {}, remove() {}, contains() {} } }; },
    body: { appendChild() {}, removeChild() {} },
    documentElement: { setAttribute() {}, getAttribute() {} },
    dispatchEvent() { return true; },
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail || {}; }
  };

  Store = OTA.require('store').Store;
  dispatch = OTA.require('dispatch').dispatch;

  // Reset Store
  Store.state = {
    docs: [
      { id: 'a', title: 'Test 1', raw: '', visible: true, ui: {} },
      { id: 'b', title: 'Test 2', raw: '', visible: true, ui: {} },
    ],
    projects: [
      { id: 'p1', title: 'Test 1', cardIds: ['a'], activeCardId: 'a', enabledViews: [], views: [] },
      { id: 'p2', title: 'Test 2', cardIds: ['b'], activeCardId: 'b', enabledViews: [], views: [] },
    ],
    activeProjectId: 'p1',
    theme: 'light',
    nextAnalysisSeq: 1,
    copyFormat: 'default',
    spreadsheetSafe: true,
    persistRaw: true,
  };
  Store.loadFailed = false;
  Store.lastSaveError = null;
  Store._listeners = null;
});

// ---------------------------------------------------------------------------
describe('dispatch — command routing', () => {
  it('dispatch("project:create") adds a project with a card and returns it', () => {
    const project = dispatch('project:create');
    assert.equal(typeof project.id, 'string');
    assert.equal(Store.state.projects.length, 3);
    assert.equal(Store.state.activeProjectId, project.id);
    assert.equal(project.cardIds.length, 1);
  });

  it('dispatch("project:activate") switches active project', () => {
    const ok = dispatch('project:activate', { id: 'p2' });
    assert.equal(ok, true);
    assert.equal(Store.state.activeProjectId, 'p2');
  });

  it('dispatch("card:create") appends a card into the active project', () => {
    const card = dispatch('card:create', { title: '第二段' });
    assert.equal(Store.getActiveProject().cardIds.includes(card.id), true);
    assert.equal(Store.curr().id, card.id);
  });

  it('dispatch("source:changed") updates raw text', () => {
    const result = dispatch('source:changed', { text: 'hello' });
    assert.equal(result, 'hello');
    assert.equal(Store.curr().raw, 'hello');
  });

  it('dispatch("filter:global") updates globalFilter', () => {
    dispatch('filter:global', { value: 'x=1' });
    assert.equal(Store.curr().ui.globalFilter, 'x=1');
  });

  it('dispatch("filter:table") updates table rule', () => {
    dispatch('filter:table', { table: 'T1', field: 'filter', value: 'a=1' });
    assert.equal(Store.curr().ui.rules.T1.filter, 'a=1');
  });

  it('dispatch("ui:theme") toggles theme', () => {
    const before = Store.state.theme;
    dispatch('ui:theme', {});
    assert.notEqual(Store.state.theme, before);
  });

  it('dispatch("ui:copyFormat") validates format', () => {
    dispatch('ui:copyFormat', { format: 'lua-expanded' });
    assert.equal(Store.state.copyFormat, 'lua-expanded');

    dispatch('ui:copyFormat', { format: 'bogus' });
    assert.equal(Store.state.copyFormat, 'default');
  });

  it('dispatch("ui:copyHeaders") updates the copy header preference', () => {
    dispatch('ui:copyHeaders', { enabled: false });
    assert.equal(Store.state.copyWithHeaders, false);

    dispatch('ui:copyHeaders', { enabled: true });
    assert.equal(Store.state.copyWithHeaders, true);
  });

  it('dispatch returns null for unknown actions', () => {
    assert.equal(dispatch('no:such:action', {}), null);
  });
});

// ---------------------------------------------------------------------------
describe('dispatch — event emission', () => {
  it('state:changed fires for most transitions', async () => {
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push(evt));

    dispatch('project:create');
    dispatch('filter:global', { value: 'test' });
    dispatch('ui:theme', {});

    await new Promise(resolve => setTimeout(resolve, 10));

    const changedCount = events.filter(e => e === 'state:changed').length;
    assert.ok(changedCount >= 3, `state:changed should fire for each transition, got ${changedCount}`);

    unsub();
  });

  it('listeners receive correct payload', async () => {
    const received = [];
    const unsub = Store.onChange((evt, payload) => received.push({ evt, payload }));

    dispatch('filter:global', { value: 'status=active price>50' });

    await new Promise(resolve => setTimeout(resolve, 10));

    const filterEvents = received.filter(r => r.evt === 'filter:changed');
    assert.ok(filterEvents.length >= 1);
    assert.equal(filterEvents[0].payload.scope, 'global');
    assert.equal(filterEvents[0].payload.value, 'status=active price>50');

    unsub();
  });
});
