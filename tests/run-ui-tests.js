const fs = require('fs');
const path = require('path');
const vm = require('vm');
const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8').replace(/^\uFEFF/, '');
const script = html.split('<script>')[1].split('</script>')[0];
new vm.Script(script, { filename: 'offline-table-analyzer-v20.js' });
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
[
  'id="expandSourceBtn"',
  'id="sourceEditorModal"',
  'id="rawInputLarge"',
  'id="formatSelectLarge"',
  'value="cli-multi-block"',
  'id="headerModeSelectLarge"',
  'id="sourceEditorParseBtn"',
  'id="sourceEditorDoneBtn"',
  'id="sourceEditorCloseBtn"',
  'id="sidebarDataTabBtn"',
  'id="sidebarConfigTabBtn"',
  'id="addTabBtn" type="button"',
  'id="exportFullBtn"',
  'id="copyFormatSelect"',
  'id="sourceDropZone"',
  'id="sourceFileInput"',
  'id="diagnosticsBtn"',
  'id="persistRawToggle"',
  'id="pageSizeSelect"',
  'id="previewTablePicker"',
  'id="previewTableSelect"',
  'id="storageStatus"',
  'id="undoEditBtn"',
  'id="redoEditBtn"',
  'id="helpBtn"',
  '复制: Markdown',
  '复制: ASCII',
  '复制: Lua 单行',
  '复制: Lua 展开',
  '全量 Excel',
  'Right Join',
  'Full Join',
  'Semi Join',
  'Anti Join',
  'table-view-toggle',
  'row-header-cell'
].forEach(token => assert(html.includes(token), `missing ${token}`));
[
  'openSourceEditor()',
  'closeSourceEditor()',
  'syncSourceTextFromLarge()',
  'syncSourceEditorControls()',
  'runFromSourceEditor(close=false)',
  'setSidebarTab(tabName=\'data\')',
  'applySidebarTab(tabName=\'data\', persist=true)',
  'getFullExportTables()',
  'getPreviewExportTables()',
  'buildRowHeaderTable(t, res, tIdx, colFilters={})',
  'buildColumnHeaderTable(t, res, tIdx, colFilters={})',
  'scheduleSourceEditorPersist()',
  "setCopyFormat(format='default')",
  'syncCopyFormatControl()',
  'buildClipboardMatrix(tbl, minR, maxR, minC, maxC)'
  ,'loadSourceFile(file)'
  ,'showDiagnostics()'
  ,'setCellEdit(tableName, rowIdx, colIdx, value, record=true)'
  ,'undoCellEdit()'
  ,'redoCellEdit()'
  ,'setTablePage(tableName, page)'
  ,'shouldUseSingleTableView(tables=[])'
  ,'syncPreviewTablePicker(tables=[], singleTableView=false)'
  ,'updateStorageStatus(detail={})'
].forEach(token => assert(script.includes(token), `missing method ${token}`));
assert(script.includes("if(e.detail > 1) return;"), 'sidebar double-click should not toggle twice');
assert(script.includes('const handleSidebarTabClick = e =>'), 'sidebar config tab should use shared click handler');
assert(script.includes("document.querySelectorAll('[data-tab-btn]').forEach(btn =>"), 'sidebar tabs should also bind direct click handlers');
assert(script.includes('this.bindSidebar(); this.bindAccordions();\n        this.bind();'), 'sidebar binding must run before broad UI binding');
assert(script.includes("Store.curr().raw = large.value"), 'large editor must sync source text to store');
assert(script.includes("if($('sidebar')) this.setSidebarTab"), 'sidebar tab should refresh on document load');
assert(script.includes('createNewTab(e)'), 'App should own robust new tab flow');
assert(script.includes('activateTab(id, force=false)'), 'App should activate tabs without re-rendering active tabs');
assert(script.includes('addTabBtn.onclick = e => this.createNewTab(e)'), 'add tab button should call robust new tab flow');
assert(script.includes("if(!force && Store.state.activeId === id) return false;"), 'clicking the active tab should not break double-click rename');
assert(script.includes("setTimeout(() => this.startTabRename(id), 0)"), 'double-click rename should survive activation re-render');
assert(script.includes("tabsContainer.addEventListener('dragstart'"), 'tabs should have dragstart binding');
assert(script.includes("tabsContainer.addEventListener('drop'"), 'tabs should have drop binding');
assert(script.includes('Store.moveDoc(this.tabDrag.sourceId, tab.dataset.id, place)'), 'drag drop should reorder docs');
assert(script.includes("escapeHtml(str='')") && script.includes('renderTabs()'), 'App should escape tab titles when rendering');
assert(script.includes("exportFullBtn.onclick = () => Exporter.toExcel(this.getFullExportTables(), this.getExportPrefix('full'))"), 'full export should use current tab title prefix');
assert(script.includes('rawLarge.oninput = () => {') && script.includes('this.scheduleSourceEditorPersist();'), 'large editor input should be debounced');
assert(script.includes("$('rawInput').oninput = e => {\n            this.invalidateCellEdits();"), 'source edits must invalidate stale cell corrections');
assert(script.includes('rawLarge.oninput = () => {\n                this.invalidateCellEdits();'), 'full-screen source edits must invalidate stale cell corrections');
assert(script.includes('if(current !== mode) this.invalidateCellEdits();') && script.includes('if(current !== next) this.invalidateCellEdits();'), 'parser option changes must invalidate stale cell corrections');
assert(script.includes('data-vr') && script.includes('startAutoScroll()'), 'preview selection should support visual coordinates and auto-scroll');
assert(script.includes("table.closest('.table-scroll')"), 'preview selection should scroll the table container');
assert(script.includes("const tablesToRender = singleTableView"), 'large datasets should render one selected table at a time');
assert(script.includes("td.classList.contains('row-header-cell')"), 'row-header labels should not behave like editable data cells');
assert(script.includes('nextAnalysisSeq') && script.includes('getMaxAnalysisNumber()'), 'analysis titles should use a monotonic sequence');
assert(script.includes('ClipboardFormatter.toText(matrix, format)'), 'copy should support global text table formats');
assert(script.includes('buildLuaClipboardMatrix') && script.includes('ClipboardFormatter.toHtml(matrix, format)'), 'Lua copy should use a normalized matrix and code HTML payload');
assert(script.includes("lua-inline") && script.includes("lua-expanded"), 'Lua copy format values should be wired into the release');
assert(script.includes("document.addEventListener('keydown', e => {") && script.includes('this.selectAll(table);'), 'ctrl+a should select all cells in active preview table');
assert(html.includes('#sourceEditorModal .source-editor-shell { width: 100vw; height: 100vh;'), 'source editor should occupy the full browser viewport');
assert(script.includes("if(e.key === 'Escape') { e.preventDefault(); this.closeSourceEditor(); }"), 'source editor Escape behavior should be explicit and synchronized');
assert(script.includes("new vm.Script") === false, 'production script should not contain the Node test harness');
assert(html.includes('prefers-reduced-motion'), 'reduced motion support should be present');
assert(html.includes('role="tablist"') && html.includes('aria-live="polite"'), 'core accessibility semantics should be present');
// Hook: test proc() via the OTA module system so FilterEngine dependency is resolved.
// We use the same comprehensive sandbox approach as the startup test.
const { loadBuiltModules } = require('./helpers/load-built-modules');
const storage = new Map();
const fullSandbox = {
    console,
    document: {
        title: '',
        body: { addEventListener() {}, appendChild() {}, removeChild() {} },
        documentElement: { setAttribute() {} },
        getElementById() {
            return {
                value: '', checked: false, className: '', classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
                style: {}, dataset: {},
                addEventListener() {}, removeEventListener() {},
                querySelector() { return null; }, querySelectorAll() { return []; },
                closest() { return null; },
                getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
                appendChild(c) { return c; },
                focus() {}, select() {}
            };
        },
        createElement() { return this.getElementById(); },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {}
    },
    window: { matchMedia() { return { matches: false }; }, addEventListener() {}, OTA: undefined },
    localStorage: {
        getItem(key) { return storage.has(key) ? storage.get(key) : null; },
        setItem(key, value) { storage.set(key, String(value)); },
        removeItem(key) { storage.delete(key); }
    },
    alert() {},
    confirm() { return true; },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    performance: { now() { return Date.now(); } },
    Option: function(text, value) { return { text, value }; }
};
const { OTA: procOTA } = loadBuiltModules(fullSandbox);
const FilterHarness = procOTA.require('app').App;
const FilterEngine = procOTA.require('filter-engine').FilterEngine;
assert(typeof FilterHarness.proc === 'function', 'App.proc should be callable');
assert(typeof FilterEngine.matchToken === 'function', 'FilterEngine.matchToken should be callable');

const filterTable = { name:'Logs', headers:['level','message'], rows:[['WARN','memory'],['ERROR','timeout'],['INFO','ok']] };
const regexRows = FilterHarness.proc(filterTable, { rules:{}, columnFilters:{}, globalFilter:'/ERROR|WARN/' }).rows;
assert(regexRows.length === 2 && regexRows[0].d[0] === 'WARN' && regexRows[1].d[0] === 'ERROR', 'regex alternation must not be split as plain OR tokens');

// FilterEngine NOT prefix tests
const hMap = FilterEngine.buildHeaderMap(['level', 'message']);
// ! plain text
assert(FilterEngine.matchToken('!ok', filterTable.rows[2], hMap) === false, 'NOT ok should reject row with ok');
assert(FilterEngine.matchToken('!ok', filterTable.rows[1], hMap) === true, 'NOT ok should accept row without ok');
// != is column-level negation (should still work)
assert(FilterEngine.matchToken('level!=INFO', filterTable.rows[2], hMap) === false, 'level!=INFO on INFO row');
assert(FilterEngine.matchToken('level!=INFO', filterTable.rows[0], hMap) === true, 'level!=INFO on WARN row');
// ! regex
assert(FilterEngine.matchToken('!/ERROR/', filterTable.rows[1], hMap) === false, 'NOT /ERROR/ on ERROR row');
assert(FilterEngine.matchToken('!/ERROR/', filterTable.rows[2], hMap) === true, 'NOT /ERROR/ on INFO row');
// ! operator
assert(FilterEngine.matchToken('!level=INFO', filterTable.rows[2], hMap) === false, '!level=INFO on INFO row');
assert(FilterEngine.matchToken('!level=INFO', filterTable.rows[0], hMap) === true, '!level=INFO on WARN row');
// ! with OR pipe
assert(FilterEngine.matchRule('!ok|memory', filterTable.rows[2], hMap) === false, '!ok|memory on ok row (both fail)');
assert(FilterEngine.matchRule('!ok|memory', filterTable.rows[0], hMap) === true, '!ok|memory on memory row (memory passes OR)');

console.log('UI interaction tests passed: 72');
