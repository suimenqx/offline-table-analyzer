/**
 * Store 测试套件 — 页签管理 / 持久化 / 工作区导入导出
 */
import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { createStorageMock } from '../mocks/storage.js';
import { createDOMSandbox } from '../mocks/dom.js';
import { loadModules } from '../helpers/load-modules.mjs';

let storage, dom, Store, migrateWorkspacePayload;

// 首次加载所有模块（触发缓存）
const { OTA } = loadModules([], {});
({ Store, migrateWorkspacePayload } = OTA.require('store'));

function resetStore() {
  storage.reset();
  Store.state = {
    docs: [
      { id: 'a', title: 'Analysis 1', visible: true, ui: {} },
      { id: 'b', title: 'Analysis 2', visible: true, ui: {} },
      { id: 'c', title: 'Analysis 3', visible: true, ui: {} },
    ],
    projects: [
      { id: 'p1', title: 'Analysis 1', cardIds: ['a'], activeCardId: 'a', enabledViews: [], views: [] },
      { id: 'p2', title: 'Analysis 2', cardIds: ['b'], activeCardId: 'b', enabledViews: [], views: [] },
      { id: 'p3', title: 'Analysis 3', cardIds: ['c'], activeCardId: 'c', enabledViews: [], views: [] },
    ],
    activeProjectId: 'p2',
    theme: 'light',
    nextAnalysisSeq: 1,
    copyFormat: 'default',
    spreadsheetSafe: true,
    persistRaw: true,
  };
  Store.loadFailed = false;
  Store.lastSaveError = null;
}

beforeEach(() => {
  storage = createStorageMock();
  dom = createDOMSandbox();
  // 替换全局 mock（OTA 已缓存，只需覆盖全局变量）
  globalThis.localStorage = storage;
  globalThis.document = dom.document;
  globalThis.window = dom.window;
  globalThis.CustomEvent = dom.MockCustomEvent;
  Store = OTA.require('store').Store;
  resetStore();
});

// ---------------------------------------------------------------------------
describe('Store — 工程/卡片 renaming', () => {
  it('工程重命名：trims whitespace and newlines', () => {
    assert.equal(Store.renameProject('p1', '  Orders\n  Review\t '), true);
    assert.equal(Store.state.projects[0].title, 'Orders Review');
  });

  it('工程重命名：caps title length at 40 characters', () => {
    Store.renameProject('p1', 'x'.repeat(80));
    assert.equal(Store.state.projects[0].title.length, 40);
  });

  it('工程重命名：rejects empty/whitespace-only titles', () => {
    const prev = Store.state.projects[0].title;
    assert.equal(Store.renameProject('p1', '   '), false);
    assert.equal(Store.state.projects[0].title, prev);
  });

  it('工程重命名：makes duplicate titles unique with suffix', () => {
    assert.equal(Store.renameProject('p3', 'Analysis 2'), true);
    assert.equal(Store.state.projects[2].title, 'Analysis 2 (2)');
  });

  it('keeps default card labels separate from project names while preserving export prefixes', () => {
    const project = Store.transition('project:create');
    const card = Store.curr();
    assert.equal(Store.getExportTitle(), 'Analysis 4');
    Store.transition('project:rename', { id:project.id, title:'Orders' });
    assert.equal(card.title, '数据段 1');
    assert.equal(Store.getExportTitle(), 'Orders');
    Store.transition('card:rename', { id:card.id, title:'January' });
    assert.equal(Store.getExportTitle(), 'January');
  });

  it('does not infer export naming policy from a historical or explicitly chosen data-segment title', () => {
    Store.getCard('a').title = '数据段 2';
    assert.equal(Store.getExportTitle('a'), '数据段 2');
    const project = Store.transition('project:create');
    const card = Store.curr();
    Store.transition('card:rename', {id:card.id, title:'数据段 99'});
    assert.equal(Store.getExportTitle(), '数据段 99');
    Store.transition('project:rename', {id:project.id, title:'Changed'});
    assert.equal(Store.getExportTitle(), '数据段 99');
  });

  it('round trips the explicit export naming policy and does not change it when cards are reordered', () => {
    const project = Store.transition('project:create');
    const first = Store.curr();
    const second = Store.transition('card:create');
    Store.transition('card:reorder', {sourceId:first.id,targetId:second.id,place:'after'});
    assert.equal(Store.getExportTitle(first.id), 'Analysis 4');
    const backup={...Store.serializeState(), kind:'ota-workspace'};
    Store.transition('workspace:import', {workspace:backup});
    const restored = Store.getState().docs.find(card=>card.exportTitleFromProject === true);
    assert.equal(restored.title, '数据段 1');
    assert.equal(Store.getExportTitle(restored.id), project.title);
  });

  it('keeps project names unique after default card names no longer mirror them', () => {
    const first=Store.transition('project:create');
    const next=Store.transition('project:create');
    Store.transition('project:rename',{id:next.id,title:first.title});
    assert.equal(next.title,'Analysis 4 (2)');
    Store.transition('project:rename',{id:first.id,title:first.title});
    assert.equal(first.title,'Analysis 4', 'renaming to the existing name is stable');
  });

  it('卡片重命名：updates card title within its project', () => {
    assert.equal(Store.renameCard('a', '主数据段'), true);
    assert.equal(Store.state.docs[0].title, '主数据段');
    assert.equal(Store.state.projects[0].title, 'Analysis 1', '工程标题不受卡片重命名影响');
  });
});

describe('Store — auto-parse preference', () => {
  it('defaults auto-parse to enabled and persists changes', () => {
    assert.equal(Store.curr().ui.autoParse, true);
    assert.equal(Store.transition('ui:autoParse', { enabled: false }), true);
    assert.equal(Store.curr().ui.autoParse, false);
  });
});

// ---------------------------------------------------------------------------
describe('Store — 工程 reordering', () => {
  it('moves project before target', () => {
    assert.equal(Store.moveProject('p3', 'p1', 'before'), true);
    assert.equal(Store.state.projects.map(p => p.id).join(''), 'p3p1p2');
  });

  it('does not change active project on reorder', () => {
    Store.moveProject('p3', 'p1', 'before');
    assert.equal(Store.state.activeProjectId, 'p2');
  });

  it('moves project after target', () => {
    assert.equal(Store.moveProject('p1', 'p3', 'after'), true);
    assert.equal(Store.state.projects.map(p => p.id).join(''), 'p2p3p1');
  });

  it('returns false for invalid target', () => {
    assert.equal(Store.moveProject('p2', 'missing', 'before'), false);
    assert.equal(Store.state.projects.map(p => p.id).join(''), 'p1p2p3');
  });
});

// ---------------------------------------------------------------------------
describe('Store — 卡片顺序（= 拼接顺序）', () => {
  it('moves card within its project', () => {
    Store.transition('card:create', { title: '第二段' });
    const project = Store.getActiveProject();
    assert.equal(project.cardIds.length, 2);
    assert.equal(Store.moveCard(project.cardIds[1], project.cardIds[0], 'before'), true);
    assert.equal(project.cardIds[0], Store.state.docs[Store.state.docs.length - 1].id);
  });

  it('refuses to move a card across projects', () => {
    assert.equal(Store.moveCard('a', 'b', 'before'), false, '跨工程移动不是卡片职责');
    assert.deepEqual(Store.state.projects[0].cardIds, ['a']);
  });

  it('returns false for missing source', () => {
    assert.equal(Store.moveCard('missing', 'a', 'before'), false);
  });
});

// ---------------------------------------------------------------------------
describe('Store — 工程/卡片 add/remove', () => {
  it('addProject appends and activates new project with one default card', () => {
    const oldProjectIds = new Set(Store.state.projects.map(p => p.id));
    const oldCardIds = new Set(Store.state.docs.map(d => d.id));
    const project = Store.addProject();
    assert.equal(Store.state.projects.length, 4);
    assert.equal(oldProjectIds.has(project.id), false);
    assert.equal(Store.state.activeProjectId, project.id);
    assert.equal(project.title, 'Analysis 4');
    assert.equal(project.cardIds.length, 1);
    const card = Store.getCard(project.cardIds[0]);
    assert.equal(oldCardIds.has(card.id), false);
    assert.equal(card.raw, '');
    assert.equal(card.visible, true);
    assert.equal(card.ui.sidebarTab, 'data');
    assert.equal(card.ui.importFormat, 'auto');
  });

  it('uses data-segment names for every new default card without renaming historical cards', () => {
    const project = Store.transition('project:create');
    assert.equal(Store.getCard(project.cardIds[0]).title, '数据段 1');
    assert.equal(Store.transition('card:create').title, '数据段 2');
    const next = Store.transition('project:create');
    assert.equal(Store.getCard(next.cardIds[0]).title, '数据段 3');
    assert.equal(Store.getCard('a').title, 'Analysis 1');
  });

  it('addCard appends into the active project and activates it', () => {
    const project = Store.getActiveProject();
    const card = Store.addCard({});
    assert.equal(card.title, '数据段 1');
    assert.equal(project.cardIds.length, 2);
    assert.equal(project.activeCardId, card.id);
    assert.equal(card.visible, true);
  });

  it('removeProject returns false for missing project', () => {
    const before = Store.state.projects.map(p => p.id).join(',');
    assert.equal(Store.removeProject('missing'), false);
    assert.equal(Store.state.projects.map(p => p.id).join(','), before);
  });

  it('removeProject removes project with its cards and updates activeProjectId', () => {
    assert.equal(Store.removeProject('p2'), true);
    assert.equal(Store.state.projects.map(p => p.id).join(''), 'p1p3');
    assert.equal(Store.state.docs.some(d => d.id === 'b'), false, '工程内卡片一并删除');
    assert.equal(Store.state.activeProjectId, 'p1');
  });

  it('removeCard removes card and reassigns active card', () => {
    Store.addCard({ title: '第二段' });
    const project = Store.getActiveProject();
    const second = project.cardIds[1];
    assert.equal(Store.removeCard(second), true);
    assert.equal(project.cardIds.length, 1);
    assert.equal(project.activeCardId, 'b');
  });

  it('deletes the last card without deleting its project or recreating a card', () => {
    Store.transition('view:upsert', { view: { view:'Saved', left:'T', right:'U', on:'id=id' } });
    assert.equal(Store.transition('card:remove', { id:'b' }), true);
    const project = Store.getActiveProject();
    assert.equal(project.id, 'p2');
    assert.deepEqual(project.cardIds, []);
    assert.equal(project.activeCardId, null);
    assert.equal(Store.curr(), null);
    assert.equal(Store.getCard('b'), null);
    assert.equal(Store.getViews()[0].view, 'Saved', '删除卡片不删除工程的 view');
    Store.transition('project:activate', { id:'p1' });
    assert.equal(Store.getProject('p2').id, 'p2', '切换工程不会丢弃空工程');
    Store.transition('project:activate', { id:'p2' });
    const card = Store.transition('card:create');
    assert.notEqual(card.id, 'b');
    assert.equal(card.raw, '');
    assert.deepEqual(project.cardIds, [card.id]);
    assert.equal(Store.curr().id, card.id);
  });

  it('restarts project numbering at 1 after all projects are deleted', () => {
    Store.transition('project:create');
    for (const project of [...Store.getState().projects]) {
      assert.equal(Store.transition('project:remove', { id: project.id }), true);
    }
    const fresh = Store.transition('project:create');
    assert.equal(fresh.title, 'Analysis 1');
    assert.equal(Store.getState().projects.length, 1);
  });

  it('does not reset project numbers when only the cards have been cleared', () => {
    for (const card of [...Store.getState().docs]) Store.transition('card:remove', { id:card.id });
    assert.equal(Store.transition('project:create').title, 'Analysis 4');
  });

  it('deleted project numbers are not reused', () => {
    Store.removeProject('p2');
    const project = Store.addProject();
    assert.equal(project.title, 'Analysis 4');
  });

  it('card:visible toggles visibility and bumps query revision', async () => {
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));
    const before = Store.queryRevision;
    assert.equal(Store.transition('card:visible', { id:'a', visible:false }), true);
    assert.equal(Store.getCard('a').visible, false);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(events.some(e => e.evt === 'card:visibilityChanged'), true);
    assert.ok(Store.queryRevision > before, '显隐修订必须进入查询缓存失效');
    unsub();
  });

  it('duplicates an empty project without inventing a card', () => {
    Store.transition('card:remove', { id:'b' });
    const copy = Store.transition('project:duplicate', { id:'p2' });
    assert.deepEqual(copy.cardIds, []);
    assert.equal(copy.activeCardId, null);
    assert.equal(Store.getDocument(), null);
  });

  it('duplicateProject deep-copies cards and clears cell edits', () => {
    Store.getCard('a').ui.cellEdits = { '$T1': { 0: { 0: 'x' } } };
    const copy = Store.duplicateProject('p1');
    assert.equal(copy.cardIds.length, 1);
    const copiedCard = Store.getCard(copy.cardIds[0]);
    assert.notEqual(copiedCard.id, 'a');
    assert.deepEqual(copiedCard.ui.cellEdits, {});
    assert.equal(Store.state.activeProjectId, copy.id);
  });
});

// ---------------------------------------------------------------------------
describe('Store — copy format', () => {
  it('persists and restores copy format (round-trip)', () => {
    // 设置并持久化
    Store.setCopyFormat('lua-expanded');
    assert.equal(Store.state.copyFormat, 'lua-expanded');
    const raw = storage.getItem('ota_v21_workspace');
    assert.ok(raw);
    const persisted = JSON.parse(raw);
    assert.equal(persisted.copyFormat, 'lua-expanded');

    // 模拟新会话：手动改掉状态后 init() 应恢复
    Store.state.copyFormat = 'default';
    assert.equal(Store.state.copyFormat, 'default');
    Store.init();
    assert.equal(Store.state.copyFormat, 'lua-expanded');
  });

  it('supports markdown format', () => {
    Store.setCopyFormat('markdown');
    assert.equal(Store.state.copyFormat, 'markdown');
  });

  it('supports lua-inline format', () => {
    Store.setCopyFormat('lua-inline');
    assert.equal(Store.state.copyFormat, 'lua-inline');
  });

  it('persists and restores JSON copy format', () => {
    Store.setCopyFormat('json');
    assert.equal(Store.state.copyFormat, 'json');
    Store.init();
    assert.equal(Store.state.copyFormat, 'json');
  });

  it('persists both JSON layouts in the existing copy format field', () => {
    for (const format of ['json-inline', 'json-expanded']) {
      Store.setCopyFormat(format);
      assert.equal(Store.state.copyFormat, format);
      assert.equal(JSON.parse(storage.getItem('ota_v21_workspace')).copyFormat, format);
      Store.state.copyFormat = 'default';
      Store.init();
      assert.equal(Store.state.copyFormat, format);
    }
  });

  it('resets to default for invalid format', () => {
    Store.setCopyFormat('invalid');
    assert.equal(Store.state.copyFormat, 'default');
  });

  it('defaults to including headers for older saved workspaces', () => {
    Store.state.copyWithHeaders = undefined;
    Store.init();
    assert.equal(Store.state.copyWithHeaders, true);
  });

  it('persists the copy header preference', () => {
    Store.setCopyWithHeaders(false);
    assert.equal(Store.state.copyWithHeaders, false);
    const persisted = JSON.parse(storage.getItem('ota_v21_workspace'));
    assert.equal(persisted.copyWithHeaders, false);

    Store.state.copyWithHeaders = true;
    Store.init();
    assert.equal(Store.state.copyWithHeaders, false);
  });
});

// ---------------------------------------------------------------------------
describe('Store — persistence', () => {
  it('restores empty projects without adding cards or dropping inactive projects', () => {
    for (const card of [...Store.getState().docs]) {
      Store.transition('card:remove', { id:card.id });
    }
    Store.init();
    assert.deepEqual(Store.getState().projects.map(project => project.id), ['p1','p2','p3']);
    assert.deepEqual(Store.getState().docs, []);
    assert.equal(Store.getActiveProject().id, 'p2');
    assert.equal(Store.curr(), null);
  });

  it('restores a cleared workspace without consuming its first project number', () => {
    for (const project of [...Store.getState().projects]) {
      Store.transition('project:remove', { id:project.id });
    }
    Store.init();
    assert.deepEqual(Store.getState().projects, []);
    assert.equal(Store.getActiveProject(), null);
    assert.equal(Store.curr(), null);
    assert.equal(Store.transition('project:create').title, 'Analysis 1');
  });

  it('does not persist raw data in temporary mode', () => {
    Store.state.docs[0].raw = 'sensitive';
    Store.state.persistRaw = false;
    assert.equal(Store.save(), true);
    const serialized = JSON.parse(storage.getItem('ota_v21_workspace'));
    assert.equal(serialized.docs[0].raw, '');
    assert.equal(Store.state.docs[0].raw, 'sensitive');
  });

  it('handles QuotaExceededError', () => {
    storage.enableQuotaFailure();
    assert.equal(Store.save(), false);
    assert.ok(Store.lastSaveError.includes('空间不足'));
    storage.disableQuotaFailure();
  });
});

// ---------------------------------------------------------------------------
describe('Store — cell edits', () => {
  it('clearCellEdits invalidates corrections', () => {
    const doc = Store.curr();
    doc.ui.cellEdits = { '$Table 1': { 1: { 2: 'corrected' } } };
    assert.equal(Store.clearCellEdits(), true);
    assert.equal(Object.keys(doc.ui.cellEdits).length, 0);
  });

  it('clearCellEdits returns false when no edits', () => {
    assert.equal(Store.clearCellEdits(), false);
  });
});

// ---------------------------------------------------------------------------
describe('Store — workspace import', () => {
  it('imports a single project (v20 payload migrates to v22)', () => {
    const count = Store.importWorkspace({
      kind: 'ota-workspace', schemaVersion: 20,
      docs: [{ id: 'a', title: 'Analysis 1', raw: 'id,name\n1,Alice', ui: {} }],
      globalViews: [],
    }, true);
    assert.equal(count, 1);
    assert.equal(new Set(Store.state.docs.map(d => d.id)).size, Store.state.docs.length);
    assert.equal(Store.state.projects.length, 4, 'merge 模式下并入一个工程');
  });

  it('imports a v22 workspace with multiple cards per project', () => {
    const count = Store.importWorkspace({
      kind: 'ota-workspace', schemaVersion: 22,
      docs: [
        { id: 'x1', title: '卡1', raw: 'a\n1', visible: true, ui: {} },
        { id: 'x2', title: '卡2', raw: 'b\n2', visible: false, ui: {} },
      ],
      projects: [{ id: 'px', title: '工程X', cardIds: ['x1', 'x2'], activeCardId: 'x2', enabledViews: [], views: [] }],
    });
    assert.equal(count, 2);
    const project = Store.getProject(Store.state.activeProjectId);
    assert.equal(project.cardIds.length, 2);
    const hidden = project.cardIds.map(cid => Store.getCard(cid)).find(card => card.visible === false);
    assert.ok(hidden, '卡片显隐随导入保留');
  });

  it('restores explicit empty schema 21 and 22 backups without creating projects', () => {
    for (const schemaVersion of [21, 22]) {
      const count = Store.transition('workspace:import', { workspace:{ kind:'ota-workspace', schemaVersion, docs:[], projects:[] } });
      assert.equal(count, 0);
      assert.deepEqual(Store.getState().projects, []);
      assert.equal(Store.curr(), null);
      assert.equal(Store.transition('project:create').title, 'Analysis 1');
    }
  });

  it('does not mistake a malformed backup for an empty workspace', () => {
    assert.throws(() => Store.transition('workspace:import', { workspace:{kind:'ota-workspace'} }), /卡片数量无效/);
    assert.equal(Store.getState().projects.length, 3);
    assert.equal(Store.getDocument().id, 'b');
  });

  it('rejects future schema versions', () => {
    assert.throws(() => Store.importWorkspace({
      kind: 'ota-workspace', schemaVersion: 999, docs: [{}],
    }));
  });
});

// ---------------------------------------------------------------------------
describe('Store — source lifecycle and migration contract', () => {
  it('increments sourceRevision and clears edits before a new parse result can apply', async () => {
    const doc = Store.curr();
    doc.raw = 'old';
    doc.ui.cellEdits = { '$T1': { 0: { 0: 'edited' } } };
    const before = Store.revision;
    const events = [];
    const unsub = Store.onChange((event, payload) => events.push({ event, payload }));

    Store.transition('source:replace', { text:'new', format:'csv' });
    assert.equal(doc.sourceRevision, 1);
    assert.deepEqual(doc.ui.cellEdits, {});
    assert.equal(doc.lastParse, null);
    assert.ok(Store.revision > before);

    Store.transition('parse:completed', { docId:doc.id, sourceRevision:doc.sourceRevision, format:'csv', tables:[] });
    await new Promise(resolve => setTimeout(resolve, 10));
    const sourceEvent = events.find(item => item.event === 'source:textChanged');
    const parseEvent = events.find(item => item.event === 'parse:completed');
    assert.equal(sourceEvent.payload.sourceRevision, 1);
    assert.equal(parseEvent.payload.sourceRevision, 1);
    assert.equal(doc.lastParse.sourceRevision, 1);
    unsub();
  });

  it('migrates schema-less legacy payloads through the explicit schema pipeline', () => {
    const migrated = migrateWorkspacePayload({ docs:[{ id:'legacy', title:'Legacy', raw:'x', ui:{} }] });
    assert.equal(migrated.schemaVersion, 22);
    assert.equal(migrated.docs.length, 1);
    assert.equal(migrated.docs[0].visible, true);
    assert.deepEqual(migrateWorkspacePayload({ schemaVersion:20, docs:[] }).schemaVersion, 22);
    assert.throws(() => migrateWorkspacePayload({ schemaVersion:23, docs:[] }));
  });

  it('v21 → v22：页签 1:1 升级为工程+卡片、保 id、view 上移工程级', () => {
    const migrated = migrateWorkspacePayload({
      kind:'ota-workspace', schemaVersion:21,
      docs: [
        { id:'d1', title:'Tab One', raw:'a,b\n1,2', ui:{ enabledViews:['v1'] } },
        { id:'d2', title:'Tab Two', raw:'x', ui:{} },
      ],
      activeId: 'd2',
      globalViews: [{ view:'v1', tables:['T'] }],
    });
    assert.equal(migrated.schemaVersion, 22);
    assert.equal(migrated.projects.length, 2);
    assert.equal(migrated.projects[0].id, 'd1', '工程保 id');
    assert.equal(migrated.projects[0].title, 'Tab One');
    assert.deepEqual(migrated.projects[0].cardIds, ['d1']);
    assert.equal(migrated.projects[0].activeCardId, 'd1');
    assert.equal(migrated.projects[0].enabledViews.length, 1);
    assert.equal(migrated.projects[0].enabledViews[0], 'v1', 'enabledViews 上移工程级');
    assert.equal(migrated.projects[0].views.length, 1);
    assert.equal(migrated.projects[1].views[0].view, 'v1', 'globalViews 复制为每工程 views');
    assert.equal(migrated.projects[1].enabledViews.length, 0);
    assert.equal(migrated.docs[0].id, 'd1', '卡片保 id');
    assert.equal(migrated.docs[0].visible, true);
    assert.notEqual(migrated.docs[0].exportTitleFromProject, true, '旧卡片不推断或改写导出命名策略');
    assert.equal(migrated.activeProjectId, 'd2');
    assert.equal('globalViews' in migrated, false, '顶层 globalViews 移除');
  });

  it('rejects a parse result whose source revision is no longer current', async () => {
    const doc = Store.curr();
    Store.transition('source:replace', { text:'current' });
    const accepted = Store.transition('parse:completed', { docId:doc.id, sourceRevision:doc.sourceRevision, format:'csv', tables:[] });
    assert.equal(accepted, true);
    Store.transition('source:replace', { text:'newer' });
    const rejected = Store.transition('parse:completed', { docId:doc.id, sourceRevision:1, format:'csv', tables:[] });
    assert.equal(rejected, false);
    assert.equal(doc.lastParse, null);
    await new Promise(resolve => setTimeout(resolve, 10));
  });
});

// ---------------------------------------------------------------------------
// Store — transition / event protocol (v22 infrastructure)
// ---------------------------------------------------------------------------
describe('Store — transition protocol', () => {
  it('project:create emits project:created + state:changed', async () => {
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    const project = Store.transition('project:create');
    assert.equal(typeof project.id, 'string');
    assert.ok(project.title.startsWith('Analysis'));

    // _notify is batched with setTimeout(0) — wait
    await new Promise(resolve => setTimeout(resolve, 10));

    const createdEvents = events.filter(e => e.evt === 'project:created');
    const changedEvents = events.filter(e => e.evt === 'state:changed');
    assert.ok(createdEvents.length >= 1, 'project:created should be emitted');
    assert.ok(changedEvents.length >= 1, 'state:changed should be emitted');
    assert.equal(createdEvents[0].payload.id, project.id);
    assert.equal(createdEvents[0].payload.previousActiveId, 'p2');
    assert.equal(createdEvents[0].payload.activeChanged, true);

    unsub();
  });

  it('project:activate switches activeProjectId and emits events', async () => {
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    // Activate first project
    const ok = Store.transition('project:activate', { id: 'p1' });
    assert.equal(ok, true);
    assert.equal(Store.state.activeProjectId, 'p1');

    await new Promise(resolve => setTimeout(resolve, 10));

    const activatedEvents = events.filter(e => e.evt === 'project:activated');
    assert.ok(activatedEvents.length >= 1, 'project:activated should be emitted');
    assert.equal(activatedEvents[0].payload.id, 'p1');
    assert.equal(activatedEvents[0].payload.previousId, 'p2');

    unsub();
  });

  it('project:activate with same id is no-op without force', () => {
    // First switch to 'p1'
    Store.transition('project:activate', { id: 'p1' });
    assert.equal(Store.state.activeProjectId, 'p1');
    // Then try the same id again without force
    const ok = Store.transition('project:activate', { id: 'p1' });
    assert.equal(ok, false);
  });

  it('project:activate with force=true re-activates same project', async () => {
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    const ok = Store.transition('project:activate', { id: 'p1', force: true });
    assert.equal(ok, true);

    await new Promise(resolve => setTimeout(resolve, 10));
    const activatedEvents = events.filter(e => e.evt === 'project:activated');
    assert.ok(activatedEvents.length >= 1);

    unsub();
  });

  it('project:remove deletes the last remaining project and empties the workspace', () => {
    // We have several projects now. Remove until one left.
    while (Store.state.projects.length > 1) {
      Store.removeProject(Store.state.projects[Store.state.projects.length - 1].id);
    }
    const lastId = Store.state.projects[0].id;
    const result = Store.transition('project:remove', { id: lastId });
    assert.equal(result, true);
    assert.equal(Store.state.projects.length, 0, '最后一个工程也可删除');
    assert.equal(Store.state.docs.length, 0, '其卡片一并删除');
    assert.equal(Store.state.activeProjectId, null);
    assert.equal(Store.curr(), null, '读取空工作区不得自动创建工程或占用编号');
    assert.equal(Store.getDocument(), null);
    assert.equal(Store.getActiveProject(), null);
    assert.deepEqual(Store.getActiveUI().rules, {});
    assert.equal(Store.state.projects.length, 0);
    const fresh = Store.transition('project:create');
    assert.equal(fresh.title, 'Analysis 1');
    assert.equal(fresh.cardIds.length, 1);
  });

  it('project:remove reports active-project changes through the canonical event', async () => {
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    const result = Store.transition('project:remove', { id: 'p2' });
    assert.equal(result, true);
    assert.equal(Store.state.activeProjectId, 'p1');

    await new Promise(resolve => setTimeout(resolve, 10));
    const removed = events.find(item => item.evt === 'project:removed');
    assert.ok(removed, 'project:removed should be emitted');
    assert.equal(removed.payload.previousActiveId, 'p2');
    assert.equal(removed.payload.activeProjectId, 'p1');
    assert.equal(removed.payload.activeChanged, true);
    unsub();
  });

  it('does not report a missing id as a removal', () => {
    Store.state.docs = [{ id: 'only', title: 'Only', raw: '', visible: true, ui: {} }];
    Store.state.projects = [{ id: 'onlyp', title: 'Only', cardIds: ['only'], activeCardId: 'only', enabledViews: [], views: [] }];
    Store.state.activeProjectId = 'onlyp';
    assert.equal(Store.removeProject('missing'), false);
  });

  it('rejects card-bound writes and late parse results after deletion', () => {
    Store.transition('card:remove', { id:'b' });
    for (const [action, payload] of [
      ['source:replace', {text:'late input'}],
      ['ui:set', {key:'globalFilter', value:'late'}],
      ['import:setFormat', {format:'csv'}],
      ['import:setHeaderMode', {mode:'none'}],
      ['ui:autoParse', {enabled:false}],
      ['rule:set', {table:'T', field:'filter', value:'late'}],
      ['filter:column', {table:'T', column:'id', value:'late'}],
      ['filter:clearTable', {table:'T'}],
      ['preview:tablePage', {table:'T', page:2}],
      ['preview:tableCollapse', {table:'T'}],
      ['cell:edit', {table:'T', row:0, col:0, value:'late'}],
      ['parse:completed', {docId:'b', sourceRevision:0, format:'csv'}],
    ]) assert.equal(Store.transition(action, payload), false, action);
    assert.equal(Store.getDocument(), null);
    const fresh = Store.transition('card:create');
    assert.equal(Store.transition('source:replace', {docId:'b', text:'late original'}), false);
    assert.equal(Store.transition('parse:completed', {docId:'b', sourceRevision:0, format:'csv'}), false);
    assert.equal(fresh.raw, '');
    assert.equal(fresh.lastParse, null);
  });

  it('card:create emits card:created and appends into active project', async () => {
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));
    const card = Store.transition('card:create', { title: '差异部分' });
    assert.equal(Store.getActiveProject().cardIds.includes(card.id), true);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(events.some(e => e.evt === 'card:created'));
    unsub();
  });

  it('card:activate switches the active card within its project', () => {
    Store.transition('card:create', { title: '差异部分' });
    const project = Store.getActiveProject();
    const first = project.cardIds[0];
    assert.equal(Store.transition('card:activate', { id: first }), true);
    assert.equal(project.activeCardId, first);
    assert.equal(Store.curr().id, first);
  });

  it('filter:global updates ui.globalFilter and emits filter:changed', async () => {
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    Store.transition('filter:global', { value: 'status=active' });
    const doc = Store.curr();
    assert.equal(doc.ui.globalFilter, 'status=active');

    await new Promise(resolve => setTimeout(resolve, 10));
    const filterEvents = events.filter(e => e.evt === 'filter:changed');
    assert.ok(filterEvents.length >= 1);
    assert.equal(filterEvents[0].payload.scope, 'global');
    assert.equal(filterEvents[0].payload.value, 'status=active');

    unsub();
  });

  it('filter:column adds and removes column filters', () => {
    Store.transition('filter:column', { table: 'T1', column: 'Status', value: 'active' });
    const doc = Store.curr();
    assert.equal(doc.ui.columnFilters.T1.Status, 'active');

    Store.transition('filter:column', { table: 'T1', column: 'Status', value: '' });
    assert.equal('Status' in (doc.ui.columnFilters.T1 || {}), false);
  });

  it('ui:theme toggles light↔dark', () => {
    const initial = Store.state.theme;
    Store.transition('ui:theme', {});
    assert.notEqual(Store.state.theme, initial);
    Store.transition('ui:theme', {});
    assert.equal(Store.state.theme, initial);
  });

  it('ui:copyFormat sets and validates format', () => {
    Store.transition('ui:copyFormat', { format: 'lua-inline' });
    assert.equal(Store.state.copyFormat, 'lua-inline');

    Store.transition('ui:copyFormat', { format: 'invalid' });
    assert.equal(Store.state.copyFormat, 'default');
  });

  it('workspace:save emits workspace:saved on success', async () => {
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    const ok = Store.transition('workspace:save', {});
    assert.equal(ok, true);

    await new Promise(resolve => setTimeout(resolve, 10));
    const savedEvents = events.filter(e => e.evt === 'workspace:saved');
    assert.ok(savedEvents.length >= 1);

    unsub();
  });

  it('workspace:save emits workspace:saveFailed on quota error', async () => {
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    storage.enableQuotaFailure();
    const ok = Store.transition('workspace:save', {});
    assert.equal(ok, false);
    storage.disableQuotaFailure();

    await new Promise(resolve => setTimeout(resolve, 10));
    const failedEvents = events.filter(e => e.evt === 'workspace:saveFailed');
    assert.ok(failedEvents.length >= 1);

    unsub();
  });

  it('onChange returns unsubscribe function that works', async () => {
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    Store.transition('ui:theme', {});
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(events.length >= 1);

    unsub();
    const countBefore = events.length;
    Store.transition('ui:theme', {});
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(events.length, countBefore, 'no new events after unsubscribe');
  });

  it('listener errors do not prevent other listeners', async () => {
    const events = [];
    const unsub1 = Store.onChange(() => { throw new Error('BANG'); });
    const unsub2 = Store.onChange((evt, payload) => events.push({ evt, payload }));

    Store.transition('ui:theme', {});
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(events.length >= 1, 'second listener should still receive events');

    unsub1();
    unsub2();
  });

  it('_notify is a no-op when there are zero listeners', () => {
    // Should not throw
    Store._notify('noop', {});
  });
});

// ---------------------------------------------------------------------------
// Store — import options are UI/parse options, not source rewrites
// ---------------------------------------------------------------------------
describe('Store — import options leave source paste lifetime alone', () => {
  it('import:setHeaderMode updates header mode without source:textChanged or revision bump', async () => {
    const doc = Store.curr();
    doc.raw = 'id\tnote\n1\thello\nworld';
    doc.ui.importHeaderMode = 'auto';
    doc.ui.cellEdits = { '$T1': { 0: { 0: 'keep-until-app' } } };
    doc.sourceRevision = 3;
    doc.lastParse = { sourceRevision: 3, format: 'html-table' };
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    const ok = Store.transition('import:setHeaderMode', { mode: 'none' });
    assert.equal(ok, true);
    assert.equal(doc.ui.importHeaderMode, 'none');
    assert.equal(doc.raw, 'id\tnote\n1\thello\nworld');
    assert.equal(doc.sourceRevision, 3, 'option toggles must not bump sourceRevision');
    assert.equal(doc.lastParse && doc.lastParse.format, 'html-table', 'option toggles must not clear lastParse');
    assert.deepEqual(doc.ui.cellEdits, { '$T1': { 0: { 0: 'keep-until-app' } } });

    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(events.filter(e => e.evt === 'source:textChanged').length, 0);
    const modeEvents = events.filter(e => e.evt === 'import:headerModeChanged');
    assert.ok(modeEvents.length >= 1);
    assert.equal(modeEvents[0].payload.mode, 'none');
    unsub();
  });

  it('import:setFormat updates format without source:textChanged or revision bump', async () => {
    const doc = Store.curr();
    doc.raw = 'a,b\n1,2';
    doc.ui.importFormat = 'auto';
    doc.sourceRevision = 2;
    doc.ui.cellEdits = { '$T1': { 0: { 0: 'x' } } };
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    const ok = Store.transition('import:setFormat', { format: 'csv' });
    assert.equal(ok, true);
    assert.equal(doc.ui.importFormat, 'csv');
    assert.equal(doc.sourceRevision, 2);
    assert.deepEqual(doc.ui.cellEdits, { '$T1': { 0: { 0: 'x' } } });

    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(events.filter(e => e.evt === 'source:textChanged').length, 0);
    const formatEvents = events.filter(e => e.evt === 'import:formatChanged');
    assert.ok(formatEvents.length >= 1);
    assert.equal(formatEvents[0].payload.format, 'csv');
    unsub();
  });

  it('source:replace defaults preservePaste to true when text is unchanged', async () => {
    const doc = Store.curr();
    doc.raw = 'same';
    doc.ui.importFormat = 'auto';
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    Store.transition('source:replace', { text: 'same', format: 'csv' });
    await new Promise(resolve => setTimeout(resolve, 10));
    const changed = events.find(e => e.evt === 'source:textChanged');
    assert.ok(changed);
    assert.equal(changed.payload.preservePaste, true);
    assert.equal(doc.ui.importFormat, 'csv');
    unsub();
  });

  it('source:replace still clears paste contract when text changes', async () => {
    const doc = Store.curr();
    doc.raw = 'old';
    const events = [];
    const unsub = Store.onChange((evt, payload) => events.push({ evt, payload }));

    Store.transition('source:replace', { text: 'new' });
    await new Promise(resolve => setTimeout(resolve, 10));
    const changed = events.find(e => e.evt === 'source:textChanged');
    assert.ok(changed);
    assert.equal(changed.payload.preservePaste, false);
    unsub();
  });
});
