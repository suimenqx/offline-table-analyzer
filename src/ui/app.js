OTA.define('app', ["runtime","exporter","store","import-engine","parser-facade","joiner","join-editor","clipboard","selection","filter-engine","table-builder","source-controller","cell-edit-controller","filter-controller","modal-controller","tab-controller","export-controller","dispatch","table-registry"], ({$, createEl, escapeHtml, formatBytes, Tooltip, Toast}, {Exporter}, {APP_VERSION, WORKSPACE_SCHEMA_VERSION, MAX_IMPORT_BYTES, COPY_FORMATS, Store}, {ImportEngine}, {Parser}, {Joiner}, {JoinEditor}, {ClipboardFormatter}, {Select}, {FilterEngine}, {TableBuilder}, {SourceController}, {CellEditController}, {FilterController}, {ModalController}, {TabController}, {ExportController}, {dispatch}, {TableRegistry}) => {
/* Main App */
const App = {
    raw: [], rendered: [],
    tabDrag: { sourceId:null },
    // Shared utilities (imported from runtime)
    escapeHtml,
    formatBytes,
    createNewTab(e) {
        TabController.createNew(e);
    },
    activateTab(id, force=false) {
        if(!id) return false;
        if(!Store.state.docs.some(d => d.id === id)) return false;
        if(!force && Store.state.activeId === id) return false;
        const input = $('rawInput');
        if(input) Store.curr().raw = input.value;
        Store.state.activeId = id;
        Store.save();
        this.renderTabs();
        this.loadDoc();
        return true;
    },
    init() {
        document.title = `Offline Table Analyzer v${APP_VERSION}`;
        Store.init(); Select.init();

        // --- Register Store -> UI event subscribers ---
        Store.onChange((event, payload) => {
            switch (event) {
                case 'state:changed':
                    this.updateWorkspaceSummary();
                    this.updateStorageStatus();
                    break;
                case 'tab:created':
                case 'tab:activated':
                case 'tab:removed':
                    this.renderTabs();
                    break;
                case 'parse:completed':
                    this.updSelects();
                    this.renderPreview();
                    this.updChips();
                    if (payload && payload.elapsed > 800) {
                        Toast.show(`\u89e3\u6790\u5b8c\u6210 \u00b7 ${payload.elapsed} ms`);
                    }
                    break;
                case 'filter:changed':
                    this.renderPreview();
                    break;
                case 'preview:changed':
                case 'preview:renderRequested':
                    this.renderPreview();
                    break;
                case 'workspace:saved':
                    this.updateStorageStatus(payload || {});
                    break;
                case 'workspace:saveFailed':
                    this.updateStorageStatus({ ok: false, message: payload && payload.error });
                    break;
                case 'ui:copyFormatChanged':
                    this.syncCopyFormatControl();
                    break;
            }
        });

        // Listen for SourceController and cross-controller events
        if (typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('ota:sourceFileLoaded', () => { this.run(); });
            document.addEventListener('ota:sourceParseRequested', () => { this.run(); });
            document.addEventListener('ota:sourceAutoParse', () => { this.run(); });
            document.addEventListener('ota:formatChanged', (e) => {
                if (e.detail && e.detail.format) this.setImportFormat(e.detail.format);
            });
            document.addEventListener('ota:headerModeChanged', (e) => {
                if (e.detail && e.detail.mode) this.setHeaderMode(e.detail.mode);
            });
            document.addEventListener('ota:tabsChanged', () => {
                this.renderTabs();
                this.loadDoc();
            });
            document.addEventListener('ota:joinChanged', () => {
                this.updSelects();
                this.updChips();
                this.renderPreview();
            });
            document.addEventListener('ota:joinParseRequested', () => {
                this.run();
            });
        }

        // --- Init sub-controllers ---
        SourceController.init();
        CellEditController.init();
        FilterController.init();
        ModalController.init();
        TabController.init();
        ExportController.init();

        this.bindSidebar(); this.bindAccordions();
        this.bind(); this.renderTabs(); this.loadDoc();
        if(window.matchMedia && window.matchMedia('(max-width: 760px)').matches) {
            $('sidebar').classList.add('collapsed');
            $('sidebarToggle').setAttribute('aria-expanded', 'false');
        }

        // Picker Logic
        $('previewArea').addEventListener('click', e => {
            if(!document.body.classList.contains('picker-active')) return;
            const th = e.target.closest('th');
            if(th && JoinEditor.lastFocusedInput) {
                // ... logic for picker ...
            }
        });
    },

    getAvailableTables() {
        return TableRegistry.getAvailableTables();
    },
    
    getCols(tableName) {
        return TableRegistry.getCols(tableName);
    },

    getImportSummaryItems() {
        const res = Parser.lastResult || {};
        if(!res.format || res.format === 'empty') return [];
        const tables = res.tables || [];
        const hasGeneratedHeaders = tables.some(t => t.meta && t.meta.generatedHeaders);
        const isLegacyCli = res.format === 'cli-table-data';
        const isMultiBlockCli = res.format === 'cli-multi-block';
        const headerText = isLegacyCli ? 'validflag 行' : (isMultiBlockCli ? (hasGeneratedHeaders ? 'CLI 表头 · 自动生成列名' : 'CLI 表头') : (hasGeneratedHeaders ? '自动生成 Column1...' : '已识别'));
        return [
            `格式: ${res.label || res.format}`,
            `表头: ${headerText}`
        ];
    },

    getTablePreviewMode(tableName) {
        const ui = Store.curr().ui;
        return (ui.previewModes && ui.previewModes[tableName]) === 'row-header' ? 'row-header' : 'column-header';
    },

    setTablePreviewMode(tableName, mode) {
        const ui = Store.curr().ui;
        if(!ui.previewModes) ui.previewModes = {};
        ui.previewModes[tableName] = mode === 'row-header' ? 'row-header' : 'column-header';
        Store.save();
        this.renderPreview();
    },

    appendPreviewModeToggle(meta, tableName, mode) {
        const wrap = createEl('span', 'table-view-toggle');
        wrap.title = '切换预览方向：列表头 / 行表头';
        wrap.onclick = e => e.stopPropagation();
        wrap.ondblclick = e => e.stopPropagation();
        const colBtn = createEl('button');
        colBtn.type = 'button';
        colBtn.textContent = '列表头';
        colBtn.className = mode === 'column-header' ? 'active' : '';
        colBtn.onclick = e => { e.stopPropagation(); this.setTablePreviewMode(tableName, 'column-header'); };
        const rowBtn = createEl('button');
        rowBtn.type = 'button';
        rowBtn.textContent = '行表头';
        rowBtn.className = mode === 'row-header' ? 'active' : '';
        rowBtn.onclick = e => { e.stopPropagation(); this.setTablePreviewMode(tableName, 'row-header'); };
        wrap.appendChild(colBtn);
        wrap.appendChild(rowBtn);
        meta.appendChild(wrap);
    },

    shouldUseSingleTableView(tables=[]) {
        return TableBuilder.shouldUseSingleTableView(tables);
    },

    syncPreviewTablePicker(tables=[], singleTableView=false) {
        const picker = $('previewTablePicker');
        const select = $('previewTableSelect');
        if(!picker || !select) return '';
        picker.classList.toggle('active', singleTableView && tables.length > 0);
        select.innerHTML = '';
        if(!singleTableView || !tables.length) return '';
        const ui = Store.curr().ui;
        const selected = tables.some(table => table.name === ui.previewTable) ? ui.previewTable : tables[0].name;
        ui.previewTable = selected;
        tables.forEach(table => {
            const option = document.createElement('option');
            const rowCount = (table.rows || []).length;
            const colCount = (table.headers || []).length;
            option.value = table.name;
            option.textContent = `${table.name} · ${rowCount.toLocaleString()} 行 × ${colCount} 列`;
            select.appendChild(option);
        });
        select.value = selected;
        select.title = `大数据单表模式：当前查看 ${selected}`;
        return selected;
    },

    updateWorkspaceSummary() {
        const title = $('workspaceTitle');
        const summary = $('datasetSummary');
        if(title) title.textContent = Store.curr().title || 'Analysis';
        if(!summary) return;
        const tableCount = this.raw.length;
        const rows = this.raw.reduce((sum, table) => sum + (table.rows || []).length, 0);
        const maxCols = this.raw.reduce((max, table) => Math.max(max, (table.headers || []).length), 0);
        const importItems = this.getImportSummaryItems();
        const format = (Parser.lastResult && (Parser.lastResult.label || Parser.lastResult.format)) || (importItems[0] || '').replace(/^格式:\s*/, '');
        const header = importItems.find(text => text.indexOf('表头:') === 0) || '';
        summary.textContent = tableCount
            ? `${format || '已解析'}${header ? ` · ${header}` : ''} · ${tableCount} 表 · ${rows.toLocaleString()} 行 · 最多 ${maxCols} 列`
            : '所有处理均在本地浏览器完成';
        summary.title = summary.textContent;
    },

    updateStorageStatus(detail={}) {
        const el = $('storageStatus');
        if(!el) return;
        const ok = detail.ok !== false && !Store.lastSaveError;
        const bytes = Number(detail.bytes ?? Store.storageBytes) || 0;
        const message = detail.message || (ok
            ? (Store.state.persistRaw === false ? '临时数据模式 · 规则已保存' : `已保存 · ${this.formatBytes(bytes)}`)
            : Store.lastSaveError || '保存失败');
        el.textContent = message;
        el.style.color = ok ? '' : 'var(--danger)';
        const fill = $('storageMeterFill');
        if(fill) {
            const ratio = Math.min(100, bytes / (5 * 1024 * 1024) * 100);
            fill.style.width = `${ratio}%`;
            fill.style.background = ratio > 85 ? 'var(--danger)' : ratio > 65 ? 'var(--warning)' : 'var(--accent)';
        }
    },

    updateImportSummary() {
        this.syncImportControls();
        const status = $('parseStatus');
        const text = $('parseStatusText');
        const details = $('diagnosticsBtn');
        const result = Parser.lastResult || {};
        const diagnostics = result.diagnostics || [];
        const rowCount = (result.tables || []).reduce((sum, table) => sum + (table.rows || []).length, 0);
        if(status) status.className = `parse-status ${result.format === 'error' ? 'error' : diagnostics.length ? 'warning' : result.tables && result.tables.length ? 'ready' : ''}`;
        if(text) {
            if(result.format === 'error') text.textContent = '解析失败，请检查输入格式';
            else if(result.tables && result.tables.length) text.textContent = `${result.label} · ${result.tables.length} 表 · ${rowCount.toLocaleString()} 行${diagnostics.length ? ` · ${diagnostics.length} 项提示` : ''}`;
            else text.textContent = '等待输入数据';
        }
        if(details) details.classList.toggle('hidden', !(result.candidates && result.candidates.length) && diagnostics.length === 0);
        this.updateWorkspaceSummary();
    },

    syncImportControls() {
        const d = Store.curr();
        const formatSelect = $('formatSelect');
        const headerSelect = $('headerModeSelect');
        if(formatSelect) formatSelect.value = (d.ui && d.ui.importFormat) || 'auto';
        if(headerSelect) {
            headerSelect.value = (d.ui && d.ui.importHeaderMode) || 'auto';
            const manualFormat = formatSelect ? formatSelect.value : 'auto';
            const parsedFormat = Parser.lastResult && Parser.lastResult.format;
            const isCli = ['cli-table-data', 'cli-multi-block'].includes(manualFormat) || (manualFormat === 'auto' && ['cli-table-data', 'cli-multi-block'].includes(parsedFormat));
            headerSelect.disabled = isCli;
        }
        if (SourceController._syncControls) SourceController._syncControls();
    },

    setHeaderMode(mode) {
        const current = Store.curr().ui.importHeaderMode || 'auto';
        if(current !== mode) this.invalidateCellEdits();
        Store.updateUI('importHeaderMode', mode);
        this.run();
    },

    setImportFormat(format) {
        const next = format || 'auto';
        const current = Store.curr().ui.importFormat || 'auto';
        if(current !== next) this.invalidateCellEdits();
        Store.updateUI('importFormat', next);
        this.run();
    },

    setCopyFormat(format='default') {
        Store.setCopyFormat(format);
        this.syncCopyFormatControl();
        Toast.show(`复制格式：${ClipboardFormatter.label(Store.state.copyFormat)}`);
    },

    syncCopyFormatControl() {
        const el = $('copyFormatSelect');
        if(el) el.value = Store.state.copyFormat || 'default';
    },

    getParseOptions() {
        const d = Store.curr();
        const text = $('rawInput').value;
        const last = SourceController.getLastPaste() || {};
        const html = last.html && last.plain && last.docId === Store.state.activeId && text.trim() === last.plain.trim() ? last.html : '';
        const formatEl = $('formatSelect');
        const headerEl = $('headerModeSelect');
        const format = (formatEl && formatEl.value) || (d.ui && d.ui.importFormat) || 'auto';
        const headerMode = (headerEl && headerEl.value) || (d.ui && d.ui.importHeaderMode) || 'auto';
        return { html, format, headerMode };
    },


    getExportPrefix(kind) { return ExportController._getPrefix(kind); },

    getEnabledJoinTables(full) { return ExportController._getEnabledJoinTables(full); },
    projectTableForExport(table, shownOnly) { return ExportController._projectTableForExport(table, shownOnly); },

    getFullExportTables() { return ExportController._getFullExportTables(); },

    getPreviewExportTables() { return ExportController._getPreviewExportTables(); },






    invalidateCellEdits() {
        if(!Store.clearCellEdits()) return false;
        CellEditController.reset();
        Toast.show('源数据或解析方式已变化，旧单元格修订已清除');
        return true;
    },




    applySidebarTab(tabName='data', persist=true) {
        const next = tabName === 'config' ? 'config' : 'data';
        const tabBtns = document.querySelectorAll('[data-tab-btn]');
        const panes = document.querySelectorAll('.sidebar-pane');
        tabBtns.forEach(btn => {
            const active = btn.dataset.tabBtn === next;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        panes.forEach(pane => {
            pane.classList.toggle('active', pane.dataset.tab === next);
        });
        if(persist) {
            const d = Store.curr();
            if(d && d.ui) d.ui.sidebarTab = next;
            Store.save();
        }
    },

    setSidebarTab(tabName='data') {
        this.applySidebarTab(tabName, true);
    },

    bindSidebar() {
        const sidebar = $('sidebar');
        const toggle = $('sidebarToggle');
        const toggleSidebar = () => {
            if(!sidebar) return;
            sidebar.classList.toggle('collapsed');
            if(toggle) toggle.setAttribute('aria-expanded', sidebar.classList.contains('collapsed') ? 'false' : 'true');
        };
        if(toggle) {
            toggle.onclick = (e) => {
                if(e.detail > 1) return;
                toggleSidebar();
            };
            toggle.ondblclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };
        }
        const hint = sidebar ? sidebar.querySelector('.collapse-hint') : null;
        if(hint) hint.onclick = () => sidebar.classList.remove('collapsed');

        const handleSidebarTabClick = e => {
            const btn = e.target.closest('[data-tab-btn]');
            if(!btn) return;
            e.preventDefault();
            e.stopPropagation();
            if(sidebar && sidebar.classList.contains('collapsed')) sidebar.classList.remove('collapsed');
            this.applySidebarTab(btn.dataset.tabBtn, true);
        };
        const tabs = document.querySelector('.sidebar-tabs');
        if(tabs) tabs.onclick = handleSidebarTabClick;
        document.querySelectorAll('[data-tab-btn]').forEach(btn => {
            btn.onclick = handleSidebarTabClick;
            btn.disabled = false;
            btn.removeAttribute('disabled');
            btn.setAttribute('type', 'button');
        });
        this.applySidebarTab((Store.curr().ui && Store.curr().ui.sidebarTab) || 'data', false);
    },

    bindAccordions() {
        document.querySelectorAll('.acc-head').forEach(head => {
            head.onclick = () => {
                const item = head.parentElement;
                item.classList.toggle('open');
            };
        });
    },

    bind() {
        const addTabBtn = $('addTabBtn');
        if(addTabBtn) {
            addTabBtn.type = 'button';
            addTabBtn.onclick = e => TabController.createNew(e);
        }
        const doParse = () => this.run();
        const doClear = () => {
            $('rawInput').value='';
            SourceController.clearLastPaste();
            Store.curr().ui.cellEdits = {};
            this.run();
        };
        $('parseBtn').onclick = doParse;
        $('clearBtn').onclick = doClear;
        const formatSelect = $('formatSelect');
        if(formatSelect) formatSelect.onchange = e => this.setImportFormat(e.target.value);
        const headerModeSelect = $('headerModeSelect');
        if(headerModeSelect) headerModeSelect.onchange = e => this.setHeaderMode(e.target.value);
        
        const loadSample = () => {
            this.invalidateCellEdits();
            $('rawInput').value = `table-data Inventory
validflag ID      Product       Category    Stock   Price
 1        1001    Widget_A      Hardware    50      10.50
 1        1002    Widget_B      Hardware    0       25.00
 1        1003    Gadget_X      Electronics 15      99.99
 1        1004    Gadget_Y      Electronics 5       150.00

table-data Orders
validflag OrderID CustID  ProdID  Qty   Status
 1        5001    C001    1001    5     Shipped
 1        5002    C002    1003    1     Pending
 1        5003    C001    1002    2     Backorder
 1        5004    C003    1001    10    Shipped

table-data SystemLogs
validflag Time      Level   Message                 Code
 1        10:00:01  INFO    System started          0x00
 1        10:05:23  WARN    High memory usage       0x04
 1        10:15:00  ERROR   Connection timeout      0x99
 1        10:15:01  INFO    Retry connection...     0x00`;
            this.run();
        };
        const sampleBtn = $('sampleBtn'); if(sampleBtn) sampleBtn.onclick = loadSample;
        const sampleLink = $('sampleLink'); if(sampleLink) sampleLink.onclick = loadSample;

        // Note: rawInput, file import, drag/drop, fullscreen editor are now handled by SourceController.init()
        const modalOverlay = $('modalOverlay');
        if(modalOverlay) modalOverlay.addEventListener('click', e => { if(e.target === modalOverlay) this.closeModal(); });
        // Tab events handled by TabController.init()

        const inputBind = (id, k, subK) => $(id).oninput = e => {
            const val = e.target.type==='checkbox'?e.target.checked:e.target.value;
            if(subK) { if(k==='rules') { const tbl=$('targetTableSelect').value; if(tbl) Store.updateRule(tbl, subK, val); } else Store.updateUI(k, val); } else Store.updateUI(k, val);
            this.renderPreview();
        };
        inputBind('globalFilter', 'globalFilter');
        inputBind('checkHl', 'enableHighlight');
        inputBind('checkOnlyHl', 'onlyHighlighted');
        inputBind('checkExpSelected', 'exportOnlyChecked');
        inputBind('expColSelect', 'exportCols');

        $('targetTableSelect').onchange = () => this.syncRules();
        inputBind('hlInput', 'rules', 'hl');
        inputBind('filterInput', 'rules', 'filter');
        $('focusColsInput').onchange = e => {
            const t = $('targetTableSelect').value;
            if(t) Store.updateRule(t, 'focus', e.target.value.split(',').filter(s=>s.trim()));
            this.renderPreview();
        };

        $('tablesTrigger').onclick = () => this.modTables();
        $('viewsTrigger').onclick = () => this.modViews();
        // FIX: Correctly call JoinEditor.modManageViews
        $('manageViewsBtn').onclick = e => { e.stopPropagation(); JoinEditor.modManageViews(); };
        $('selectColsBtn').onclick = () => this.modCols();
        $('themeBtn').onclick = () => Store.toggleTheme();
        if($('helpBtn')) $('helpBtn').onclick = () => this.showHelp();
        if($('undoEditBtn')) $('undoEditBtn').onclick = () => CellEditController.undo();
        if($('redoEditBtn')) $('redoEditBtn').onclick = () => CellEditController.redo();
        if($('pageSizeSelect')) $('pageSizeSelect').onchange = e => {
            const ui = Store.curr().ui;
            ui.pageSize = Number(e.target.value) || 100;
            ui.tablePages = {};
            Store.save();
            this.renderPreview();
        };
        if($('previewTableSelect')) $('previewTableSelect').onchange = e => {
            const ui = Store.curr().ui;
            ui.previewTable = e.target.value || '';
            if(!ui.tablePages) ui.tablePages = {};
            ui.tablePages[ui.previewTable] = 1;
            Store.save();
            this.renderPreview();
        };
        if($('toggleSidebarMobileBtn')) $('toggleSidebarMobileBtn').onclick = () => {
            const sidebar = $('sidebar');
            if(sidebar) sidebar.classList.toggle('collapsed');
        };
        if($('clearLocalDataBtn')) $('clearLocalDataBtn').onclick = () => {
            if(!confirm('确定清除本浏览器中保存的全部工作区数据？建议先备份工作区。')) return;
            if(Store.clearLocalData()) {
                Toast.show('本地数据已清除，刷新页面后生效');
                $('storageStatus').textContent = '本地数据已清除';
            } else Toast.show(Store.lastSaveError || '清除失败', true);
        };
        document.addEventListener('ota:storage', event => this.updateStorageStatus(event.detail || {}));

        // Export/copy/workspace/config handled by ExportController.init()

        
        // Editor Bindings
        const closeJoin = () => JoinEditor.close();
        $('jeCancel').onclick = closeJoin;
        $('jeCancelFooter').onclick = closeJoin;
        $('jeSave').onclick = () => JoinEditor.save();
        $('jeSaveFooter').onclick = () => JoinEditor.save();
        $('jeAddRel').onclick = () => JoinEditor.addRel();
        $('jeAutoRel').onclick = () => JoinEditor.autoMatchRels();
        $('jeOrderRebuild').onclick = () => JoinEditor.rebuildOrder();
        $('jeOrderClear').onclick = () => JoinEditor.clearOrder();
        $('jeOrderLeftOnly').onclick = () => JoinEditor.keepOnly('l');
        $('jeOrderRightOnly').onclick = () => JoinEditor.keepOnly('r');
        $('jeOrderShowL').onchange = e => { JoinEditor.state.showL = e.target.checked; JoinEditor.renderSelectedOrder(); };
        $('jeOrderShowR').onchange = e => { JoinEditor.state.showR = e.target.checked; JoinEditor.renderSelectedOrder(); };
        if($('jeOrderMoveTop')) $('jeOrderMoveTop').onclick = () => JoinEditor.moveOrderToEdge('top');
        if($('jeOrderMoveBottom')) $('jeOrderMoveBottom').onclick = () => JoinEditor.moveOrderToEdge('bottom');

        $('jeLeftTable').onchange = () => JoinEditor.handleTableChange('l');
        $('jeRightTable').onchange = () => JoinEditor.handleTableChange('r');
        $('jeType').onchange = () => { JoinEditor.markDirty(); JoinEditor.updateAll(); };
        $('jeName').oninput = () => { JoinEditor.markDirty(); JoinEditor.updateSaveState(); };

        $('jeLSearch').oninput = () => {
            clearTimeout(JoinEditor._searchTimerL);
            JoinEditor._searchTimerL = setTimeout(() => JoinEditor.renderColList('jeLList', App.getCols($('jeLeftTable').value), JoinEditor.state.lSel, 'l'), 200);
        };
        $('jeRSearch').oninput = () => {
            clearTimeout(JoinEditor._searchTimerR);
            JoinEditor._searchTimerR = setTimeout(() => JoinEditor.renderColList('jeRList', App.getCols($('jeRightTable').value), JoinEditor.state.rSel, 'r'), 200);
        };
        $('jeLAll').onclick = () => JoinEditor.toggleAll('l');
        $('jeRAll').onclick = () => JoinEditor.toggleAll('r');
        $('jeLAllFiltered').onclick = () => JoinEditor.selectFiltered('l');
        $('jeRAllFiltered').onclick = () => JoinEditor.selectFiltered('r');
        $('jeLOnlySel').onchange = e => { JoinEditor.state.lOnlySel = e.target.checked; JoinEditor.renderColList('jeLList', App.getCols($('jeLeftTable').value), JoinEditor.state.lSel, 'l'); };
        $('jeROnlySel').onchange = e => { JoinEditor.state.rOnlySel = e.target.checked; JoinEditor.renderColList('jeRList', App.getCols($('jeRightTable').value), JoinEditor.state.rSel, 'r'); };
        const helpToggle = $('jeHelpToggle');
        const helpBody = $('jeHelpBody');
        if(helpToggle && helpBody) {
            helpToggle.onclick = () => helpBody.classList.toggle('show');
        }
        const jm = $('joinModal');
        if(jm) jm.addEventListener('click', e => { if(e.target === jm) closeJoin(); });

        document.addEventListener('keydown', e => {
            const sourceModal = $('sourceEditorModal');
            if(sourceModal && !sourceModal.classList.contains('hidden')) {
                if(e.key === 'Escape') { e.preventDefault(); SourceController.close(); }
                return;
            }
            const modalOverlay = $('modalOverlay');
            if(modalOverlay && !modalOverlay.classList.contains('hidden')) {
                if(e.key === 'Escape') { e.preventDefault(); this.closeModal(); }
                return;
            }
            const mod = e.ctrlKey || e.metaKey;
            const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName || '');
            if(mod && e.key.toLowerCase() === 'enter') { e.preventDefault(); this.run(); return; }
            if(mod && e.key.toLowerCase() === 'n') { e.preventDefault(); this.createNewTab(e); return; }
            if(mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('sourceFileInput').click(); return; }
            if(mod && e.key.toLowerCase() === 's') { e.preventDefault(); const inp = $('rawInput'); if(inp) Store.curr().raw = inp.value; Store.save(); Toast.show('工作区已保存'); return; }
            if(mod && !typing && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); CellEditController.undo(); return; }
            if(mod && !typing && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); CellEditController.redo(); return; }
            if(e.key === 'F2' && !typing) { e.preventDefault(); TabController.startRename(Store.state.activeId); return; }
            if(e.key === '?' && !typing) { e.preventDefault(); this.showHelp(); return; }
            if($('joinModal').classList.contains('hidden')) return;
            if(!$('modalOverlay').classList.contains('hidden')) return;
            if(e.key === 'Escape') { e.preventDefault(); JoinEditor.close(); return; }
            if(e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                const idx = JoinEditor.state.selectedOrderIdx;
                if(idx >= 0) JoinEditor.moveOrder(idx, e.key === 'ArrowUp' ? -1 : 1);
                return;
            }
            if(e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('jeLSearch').focus(); return; }
            if(e.key === 'Enter' && !e.shiftKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); JoinEditor.save(); return; }
        });


    },

    loadDoc() {
        const d = Store.curr();
        SourceController.clearLastPaste();
        CellEditController.reset();
        $('rawInput').value = d.raw || '';
        $('globalFilter').value = d.ui.globalFilter || '';
        const formatSelect = $('formatSelect'); if(formatSelect) formatSelect.value = d.ui.importFormat || 'auto';
        const headerModeSelect = $('headerModeSelect'); if(headerModeSelect) headerModeSelect.value = d.ui.importHeaderMode || 'auto';
        $('checkHl').checked = d.ui.enableHighlight !== false;
        $('checkOnlyHl').checked = d.ui.onlyHighlighted || false;
        $('checkExpSelected').checked = d.ui.exportOnlyChecked || false;
        $('expColSelect').value = d.ui.exportCols || 'all';
        if($('pageSizeSelect')) $('pageSizeSelect').value = String(d.ui.pageSize || 100);
        if($('persistRawToggle')) $('persistRawToggle').checked = Store.state.persistRaw !== false;
        if($('checkFormulaSafe')) $('checkFormulaSafe').checked = Store.state.spreadsheetSafe !== false;
        if($('sidebar')) this.setSidebarTab(d.ui.sidebarTab || 'data');
        this.syncCopyFormatControl();
        this.run(false);
        this.renderPreview();
        this.updateStorageStatus();
    },

    applyStoredCellEdits() {
        const edits = Store.curr().ui.cellEdits || {};
        this.raw.forEach(table => {
            const tableEdits = edits[`$${table.name}`];
            if(!tableEdits) return;
            Object.entries(tableEdits).forEach(([rowKey, cols]) => {
                const rowIdx = Number(rowKey);
                if(!Number.isInteger(rowIdx) || !table.rows[rowIdx] || !cols || typeof cols !== 'object') return;
                Object.entries(cols).forEach(([colKey, value]) => {
                    const colIdx = Number(colKey);
                    if(Number.isInteger(colIdx) && colIdx >= 0 && colIdx < table.headers.length) table.rows[rowIdx][colIdx] = String(value ?? '');
                });
            });
        });
    },



    showDiagnostics() {
        const result = Parser.lastResult || {};
        const candidates = (result.candidates || []).map(item => `<div class="diagnostic-item" style="display:flex;align-items:center;gap:10px;"><div style="flex:1;"><strong>${this.escapeHtml(item.label)}</strong><span class="muted">${item.manual ? '用户指定' : `识别分数 ${Math.round(item.score * 100)}%`}</span></div>${item.id !== result.format ? `<button class="sm diagnostic-format-btn" type="button" data-format="${this.escapeHtml(item.id)}">切换</button>` : '<span class="meta-tag">当前</span>'}</div>`).join('');
        const diagnostics = (result.diagnostics || []).map(item => `<div class="diagnostic-item"><strong>${this.escapeHtml(item.code || item.level || '提示')}</strong><span>${this.escapeHtml(item.message || '')}</span></div>`).join('');
        this.modal('解析详情', `<div class="diagnostic-list">${candidates || '<div class="muted">没有格式候选信息</div>'}${diagnostics || '<div class="muted">未发现需要处理的数据问题</div>'}</div>`);
        document.querySelectorAll('.diagnostic-format-btn').forEach(button => {
            button.onclick = () => { this.closeModal(); this.setImportFormat(button.dataset.format); };
        });
    },

    showHelp() {
        this.modal('帮助与快捷键', `<div class="shortcut-grid">
            <span>解析当前数据源</span><kbd>Ctrl/⌘ Enter</kbd>
            <span>新建分析页签</span><kbd>Ctrl/⌘ N</kbd>
            <span>选择本地数据文件</span><kbd>Ctrl/⌘ O</kbd>
            <span>保存当前工作区</span><kbd>Ctrl/⌘ S</kbd>
            <span>撤销 / 重做单元格编辑</span><span><kbd>Ctrl/⌘ Z</kbd> <kbd>Ctrl/⌘ Y</kbd></span>
            <span>重命名当前页签</span><kbd>F2</kbd>
            <span>全选当前预览表</span><kbd>Ctrl/⌘ A</kbd>
        </div><p class="muted" style="margin:16px 0 0;">支持 CSV、TSV、HTML、Markdown、ASCII、固定宽度文本与 CLI table-data。数据不会发送到网络。</p>`);
    },

    run(render=true) {
        try {
            const started = performance.now();
            const sourceText = $('rawInput').value;
            if(sourceText.length * 2 > MAX_IMPORT_BYTES) throw new Error('数据源超过 25 MB 安全限制，请拆分后再分析');
            Store.curr().raw = sourceText; Store.save();
            this.raw = Parser.parse(sourceText, this.getParseOptions());
            TableRegistry.setRaw(this.raw);
            CellEditController.setRawTables(this.raw);
            ExportController.setContext({ raw: this.raw });
            this.applyStoredCellEdits();
            this.updateImportSummary();
            const elapsed = Math.round(performance.now() - started);
            dispatch('parse:completed', { tables: this.raw, elapsed: elapsed });
            if(render) {
                this.updSelects();
                this.renderPreview();
                this.updChips();
            }
            if(this.raw.length && elapsed > 800) Toast.show(`解析完成 · ${elapsed} ms`);
        } catch(e) {
            console.error(e);
            Toast.show("解析错误: " + e.message, true);
        }
    },

    updSelects() {
        const s = $('targetTableSelect');
        const old = s.value; s.innerHTML = '';
        this.raw.forEach(t => s.add(new Option(t.name, t.name)));
        Store.state.globalViews.forEach(v => s.add(new Option(`JOIN:${v.view}`, `JOIN:${v.view}`)));
        if(old && Array.from(s.options).some(o=>o.value===old)) s.value=old;
        else if(s.options.length>0) s.selectedIndex=0;
        this.syncRules();
    },

    syncRules() {
        const t = $('targetTableSelect').value;
        const r = Store.curr().ui.rules[t] || {};
        $('hlInput').value = r.hl || '';
        $('filterInput').value = r.filter || '';
        $('focusColsInput').value = (r.focus || []).join(', ');
    },

    updChips() {
        const ui = Store.curr().ui;
        // 只显示表/视图名称，过滤掉误保存的字段名
        const tableNames = this.raw.map(t => t.name);
        const tsRaw = ui.displayTables;
        const ts = (tsRaw===null || tsRaw===undefined) ? null : (tsRaw || []).filter(n => tableNames.includes(n));
        $('tablesTrigger').innerHTML = (ts===null) ? `<span class="chip" style="background:var(--bg-hover); color:var(--text-secondary); border-color:transparent;">默认全显</span>` : (ts.length ? ts.map(n=>`<span class="chip">${this.escapeHtml(n)}</span>`).join('') : `<span class="placeholder">无</span>`);
        const viewNames = Store.state.globalViews.map(v => v.view);
        const vsRaw = ui.enabledViews || [];
        const vs = vsRaw.filter(v => viewNames.includes(v));
        if(vs.length !== vsRaw.length) Store.updateUI('enabledViews', vs);
        $('viewsTrigger').innerHTML = vs.length ? vs.map(n=>`<span class="chip">${this.escapeHtml(n)}</span>`).join('') : `<span class="placeholder">未启用</span>`;
    },

    renderTabs() { TabController.render(); },

    startTabRename(id) { TabController.startRename(id); },

    markTabDrop(tab, place) { TabController._markDrop(tab, place); },

    clearTabDragMarkers(tab) { TabController._clearMarkers(tab); },

    clearAllTabDragMarkers() { TabController._clearAllMarkers(); },

    buildColumnHeaderTable(t, res, tIdx, colFilters={}) {
        return TableBuilder.buildColumnHeaderTable(t, res, tIdx, colFilters,
            (tableName, colName, anchorEl) => FilterController.show(tableName, colName, anchorEl),
            (tableName, colName) => FilterController.clearColumn(tableName, colName)
        );
    },

    buildRowHeaderTable(t, res, tIdx, colFilters={}) {
        return TableBuilder.buildRowHeaderTable(t, res, tIdx, colFilters,
            (tableName, colName, anchorEl) => FilterController.show(tableName, colName, anchorEl)
        );
    },

    renderPreview() {
        if(CellEditController.activeEditor) CellEditController.finish(true);
        const div = $('previewArea'); div.innerHTML = '';
        this.rendered = []; Select.clear();
        this.syncPreviewTablePicker([], false);
        if(!this.raw.length) { 
            div.innerHTML = `<div class="empty">
                <div class="empty-visual" aria-hidden="true">${'<span></span>'.repeat(9)}</div>
                <div style="font-weight:800; color:var(--text-strong);">把杂乱数据变成可分析表格</div>
                <div class="muted">在左侧粘贴、拖放或选择文件，然后点击“解析数据”</div>
                <button class="tonal" type="button" onclick="document.getElementById('sampleLink').click()">加载示例数据</button>
            </div>`; 
            return; 
        }
        
        const ui = Store.curr().ui;
        let list = this.raw;
        if(ui.displayTables) list = list.filter(t=>ui.displayTables.includes(t.name));
        
        let joins = [];
        if(ui.enabledViews) {
            joins = ui.enabledViews.map(v => {
                const cfg = Store.state.globalViews.find(g=>g.view===v);
                return cfg ? Joiner.run(this.raw, cfg, Store.state.globalViews) : null;
            }).filter(x=>x);
        }
        const combined = [...list, ...joins];
        if(!combined.length) {
            div.innerHTML = `<div class="empty">
                <div class="empty-visual" aria-hidden="true">${'<span></span>'.repeat(9)}</div>
                <div style="font-weight:700;">当前筛选下无可见表</div>
                <div class="muted">检查“显示原始表 / JOIN 视图”的选择</div>
            </div>`;
            return;
        }

        const processedTables = combined.map((table, tIdx) => {
            const res = this.proc(table, ui);
            res.rows.forEach((row, index) => { row._resultIndex = index; });
            return { table, res, tIdx };
        });
        // Keep filtered results for full preview export and column configuration,
        // while only materializing one table's DOM in large-table mode.
        this.rendered = processedTables.map(({table, res}) => ({name:table.name, ...res}));
        const singleTableView = this.shouldUseSingleTableView(combined);
        const activeTableName = this.syncPreviewTablePicker(combined, singleTableView);
        const tablesToRender = singleTableView
            ? processedTables.filter(({table}) => table.name === activeTableName).slice(0, 1)
            : processedTables;

        tablesToRender.forEach(({table:t, res, tIdx}) => {
            const colFilters = (ui.columnFilters && ui.columnFilters[t.name]) || {};
            const filterCount = Object.values(colFilters).filter(v => (v ?? '').toString().trim()).length;
            const isCollapsed = ui.collapsedTables && ui.collapsedTables[t.name];

            const card = createEl('div', 'table-container');
            const meta = createEl('div', 'table-meta');
            meta.ondblclick = () => this.toggleTableCollapse(t.name);
            const nameSpan = createEl('span', 'table-title');
            nameSpan.textContent = t.name;
            meta.appendChild(nameSpan);
            if(t.isView) {
                const badge = createEl('span', 'meta-tag'); badge.style.color='var(--primary)'; badge.style.background='var(--primary-soft)'; badge.textContent='VIEW'; meta.appendChild(badge);
            }
            const rowTag = createEl('span', 'meta-tag'); rowTag.textContent = `Row: ${t.rows.length}`; meta.appendChild(rowTag);
            const showTag = createEl('span', 'meta-tag'); showTag.textContent = `Show: ${res.rows.length}`; meta.appendChild(showTag);
            if(singleTableView) {
                const modeTag = createEl('span', 'meta-tag');
                modeTag.textContent = `单表查看 · 共 ${combined.length} 表`;
                meta.appendChild(modeTag);
            }
            if(filterCount>0) { 
                const fTag = createEl('span','meta-tag'); 
                fTag.textContent = `列过滤: ${filterCount}`; 
                fTag.style.cursor = 'pointer';
                fTag.title = '清除本表全部列过滤';
                fTag.onclick = () => FilterController.clearTableFilters(t.name);
                meta.appendChild(fTag); 
            }
            const tableActions = createEl('span', 'table-meta-actions');
            const collapseBtn = createEl('button', 'icon-btn sm table-collapse-toggle');
            collapseBtn.type = 'button';
            collapseBtn.setAttribute('aria-expanded', String(!isCollapsed));
            collapseBtn.setAttribute('aria-label', isCollapsed ? '展开表格' : '折叠表格');
            collapseBtn.title = isCollapsed ? '展开表格' : '折叠表格';
            collapseBtn.appendChild(createEl('span', 'collapse-chevron'));
            collapseBtn.onclick = event => { event.stopPropagation(); this.toggleTableCollapse(t.name); };
            meta.appendChild(tableActions);
            const mode = this.getTablePreviewMode(t.name);
            this.appendPreviewModeToggle(tableActions, t.name, mode);
            tableActions.appendChild(collapseBtn);
            card.appendChild(meta);
            if(isCollapsed) {
                div.appendChild(card);
                return;
            }

            const pageSize = Number(ui.pageSize) || 100;
            const totalPages = Math.max(1, Math.ceil(res.rows.length / pageSize));
            const requestedPage = Number(ui.tablePages && ui.tablePages[t.name]) || 1;
            const page = Math.min(totalPages, Math.max(1, requestedPage));
            if(!ui.tablePages) ui.tablePages = {};
            ui.tablePages[t.name] = page;
            const pageRes = { headers:res.headers, rows:res.rows.slice((page - 1) * pageSize, page * pageSize) };
            const tbl = mode === 'row-header' ? this.buildRowHeaderTable(t, pageRes, tIdx, colFilters) : this.buildColumnHeaderTable(t, pageRes, tIdx, colFilters);
            const tableScroll = createEl('div', 'table-scroll');
            tableScroll.appendChild(tbl);
            card.appendChild(tableScroll);
            if(totalPages > 1) {
                const pager = createEl('div', 'table-pagination');
                const info = createEl('span');
                const from = (page - 1) * pageSize + 1;
                const to = Math.min(res.rows.length, page * pageSize);
                info.textContent = `${from.toLocaleString()}–${to.toLocaleString()} / ${res.rows.length.toLocaleString()} 行 · 第 ${page}/${totalPages} 页`;
                const prev = createEl('button'); prev.type = 'button'; prev.textContent = '上一页'; prev.disabled = page <= 1; prev.onclick = () => this.setTablePage(t.name, page - 1);
                const next = createEl('button'); next.type = 'button'; next.textContent = '下一页'; next.disabled = page >= totalPages; next.onclick = () => this.setTablePage(t.name, page + 1);
                pager.appendChild(info); pager.appendChild(prev); pager.appendChild(next); card.appendChild(pager);
            }
            div.appendChild(card);
        });
    },




    clearTableFilters(tableName) {
        FilterController.clearTableFilters(tableName);
    },

    toggleTableCollapse(tableName) { dispatch('preview:tableCollapse', { table: tableName }); },

    setCellEdit(a,b,c,d) { return CellEditController.apply(a,b,c,d); },

    undoCellEdit() { CellEditController.undo(); },

    redoCellEdit() { CellEditController.redo(); },

    updateUndoButtons() { CellEditController._updateButtons(); },

    setTablePage(tableName, page) { dispatch('preview:tablePage', { table: tableName, page: page }); },

    startCellEdit(td) { CellEditController.begin(td); },

    finishCellEdit(commit) { CellEditController.finish(commit); },

    proc(t, ui) {
        const r = ui.rules[t.name] || {};
        return FilterEngine.processTable(t, r, ui,
            ui.globalFilter || '',
            ui.enableHighlight !== false,
            ui.onlyHighlighted || false
        );
    },

    closeModal() { ModalController.close(); },
    modal(title, html) { ModalController.show(title, html); },

    modTables() { ModalController.showTableSelector(this.raw.map(t => t.name), Store.curr().ui.displayTables); },
    modViews() { ModalController.showViewSelector(Store.state.globalViews, Store.curr().ui.enabledViews || []); },
    
    modCols() {
        const tName = $('targetTableSelect').value;
        if (!tName) return;
        let all = [];
        const rawTable = this.raw.find(x => x.name === tName);
        if (rawTable) { all = rawTable.headers; }
        else if (tName.startsWith('JOIN:')) {
            const vName = tName.replace('JOIN:', '');
            const vCfg = Store.state.globalViews.find(v => v.view === vName);
            if (vCfg) { const res = Joiner.run(this.raw, vCfg, Store.state.globalViews); if (res) all = res.headers; }
        }
        if (!all || !all.length) { const rt = this.rendered.find(x => x.name === tName); if (rt) all = rt.headers; }
        if (!all || !all.length) { if (typeof alert === 'function') alert('无法获取列信息'); return; }
        ModalController.showColumnSelector(tName, all, Store.curr().ui.rules[tName] || {});
    }

};


    Tooltip.init();
    App.init();
    return { App };
});
