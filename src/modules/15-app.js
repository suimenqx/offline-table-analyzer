OTA.define('app', ["runtime","exporter","store","import-engine","parser-facade","joiner","join-editor","clipboard","selection"], ({$, createEl, Tooltip, Toast}, {Exporter}, {APP_VERSION, WORKSPACE_SCHEMA_VERSION, MAX_IMPORT_BYTES, COPY_FORMATS, Store}, {ImportEngine}, {Parser}, {Joiner}, {JoinEditor}, {ClipboardFormatter}, {Select}) => {
/* Main App */
const App = {
    raw: [], rendered: [],
    filterPopover: { open:false, table:null, col:null },
    activeEditor: null,
    tabDrag: { sourceId:null },
    sourceEditorPersistTimer: null,
    sourceEditorStatsTimer: null,
    sourceInputPersistTimer: null,
    sourceEditorReturnFocus: null,
    modalReturnFocus: null,
    editHistory: [],
    editRedo: [],
    lastPaste: null,
    escapeHtml(str='') {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },
    formatBytes(bytes=0) {
        if(bytes < 1024) return `${bytes} B`;
        if(bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    },
    sourceFileFormat(file) {
        const name = String(file && file.name || '').toLowerCase();
        if(/\.csv$/.test(name)) return 'csv';
        if(/\.tsv$/.test(name)) return 'excel-paste';
        if(/\.html?$/.test(name)) return 'html-table';
        if(/\.(md|markdown)$/.test(name)) return 'pipe-table';
        return 'auto';
    },
    persistCurrentDocFromInputs() {
        const input = $('rawInput');
        const doc = Store.curr();
        if(input) doc.raw = input.value;
        Store.save();
    },
    createNewTab(e) {
        if(e) {
            e.preventDefault();
            e.stopPropagation();
        }
        this.persistCurrentDocFromInputs();
        Store.addDoc();
        this.renderTabs();
        this.loadDoc();
    },
    activateTab(id, force=false) {
        if(!id) return false;
        if(!Store.state.docs.some(d => d.id === id)) return false;
        if(!force && Store.state.activeId === id) return false;
        this.persistCurrentDocFromInputs();
        Store.state.activeId = id;
        Store.save();
        this.renderTabs();
        this.loadDoc();
        return true;
    },
    init() {
        document.title = `Offline Table Analyzer v${APP_VERSION}`;
        Store.init(); Select.init();
        this.bindSidebar(); this.bindAccordions();
        this.bind(); this.renderTabs(); this.loadDoc();
        if(window.matchMedia && window.matchMedia('(max-width: 760px)').matches) {
            $('sidebar').classList.add('collapsed');
            $('sidebarToggle').setAttribute('aria-expanded', 'false');
        }
        this.initInputResizer();

        // Picker Logic
        $('previewArea').addEventListener('click', e => {
            if(!document.body.classList.contains('picker-active')) return;
            const th = e.target.closest('th');
            if(th && JoinEditor.lastFocusedInput) {
                // ... logic for picker ...
            }
        });
    },

    initInputResizer() {
        const resizer = $('inputResizer');
        const rawInput = $('rawInput');
        if(!resizer || !rawInput) return;

        // Restore saved height
        const savedHeight = localStorage.getItem('v16_4_inputHeight');
        if(savedHeight) {
            const h = parseInt(savedHeight, 10);
            if(h >= 120 && h <= 600) {
                rawInput.style.height = h + 'px';
            }
        }

        let isDragging = false;
        let startY = 0;
        let startHeight = 0;

        const onMouseDown = (e) => {
            isDragging = true;
            startY = e.clientY;
            startHeight = rawInput.offsetHeight;
            resizer.classList.add('dragging');
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        };

        const onMouseMove = (e) => {
            if(!isDragging) return;
            const delta = e.clientY - startY;
            let newHeight = startHeight + delta;

            // Constrain height
            if(newHeight < 120) newHeight = 120;
            if(newHeight > 600) newHeight = 600;

            rawInput.style.height = newHeight + 'px';
        };

        const onMouseUp = () => {
            if(isDragging) {
                isDragging = false;
                resizer.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';

                // Save height to localStorage
                localStorage.setItem('v16_4_inputHeight', rawInput.style.height);
            }
        };

        resizer.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        // Touch support for mobile
        resizer.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            onMouseDown({ clientY: touch.clientY, preventDefault: () => e.preventDefault() });
        }, { passive: false });

        document.addEventListener('touchmove', (e) => {
            if(!isDragging) return;
            const touch = e.touches[0];
            onMouseMove({ clientY: touch.clientY });
        }, { passive: false });

        document.addEventListener('touchend', onMouseUp);
    },
    
    getAvailableTables() {
        const raws = this.raw.map(t => t.name);
        const views = Store.state.globalViews.map(v => v.view);
        return [...raws, ...views];
    },
    
    getCols(tableName) {
        if(!tableName) return [];
        const raw = this.raw.find(t => t.name === tableName);
        if(raw) return raw.headers;
        const view = Store.state.globalViews.find(v => v.view === tableName);
        if(view) {
            const res = Joiner.run(this.raw, view, Store.state.globalViews);
            return res ? res.headers : [];
        }
        return [];
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
        this.syncSourceEditorControls();
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
        const last = this.lastPaste || {};
        const html = last.html && last.plain && last.docId === Store.state.activeId && text.trim() === last.plain.trim() ? last.html : '';
        const formatEl = $('formatSelect');
        const headerEl = $('headerModeSelect');
        const format = (formatEl && formatEl.value) || (d.ui && d.ui.importFormat) || 'auto';
        const headerMode = (headerEl && headerEl.value) || (d.ui && d.ui.importHeaderMode) || 'auto';
        return { html, format, headerMode };
    },

    getSourceEditorText() {
        const input = $('rawInputLarge');
        return input ? input.value : '';
    },

    getExportPrefix(kind='export') {
        const title = Store.curr().title || 'Analysis';
        return Exporter.sanitizeFilePrefix(`${title}_${kind}`);
    },

    getEnabledJoinTables(full=true) {
        const ui = Store.curr().ui;
        const names = ui.enabledViews || [];
        return names.map(v => {
            const cfg = Store.state.globalViews.find(g=>g.view===v);
            return cfg ? Joiner.run(this.raw, cfg, Store.state.globalViews) : null;
        }).filter(Boolean);
    },
    projectTableForExport(table, shownOnly=false) {
        const headers = table.headers || [];
        const rows = (table.rows || []).map(row => Array.isArray(row) ? row : (row.d || row.data || []));
        if(!shownOnly) return { name:table.name || 'Sheet', headers, rows };
        const focus = ((Store.curr().ui.rules || {})[table.name] || {}).focus;
        if(!Array.isArray(focus) || focus.length === 0) return { name:table.name || 'Sheet', headers, rows };
        const indexes = focus.map(name => headers.indexOf(name)).filter(index => index >= 0);
        if(!indexes.length) return { name:table.name || 'Sheet', headers, rows };
        return { name:table.name || 'Sheet', headers:indexes.map(index => headers[index]), rows:rows.map(row => indexes.map(index => row[index])) };
    },

    getFullExportTables() {
        const ui = Store.curr().ui;
        let tables = this.raw || [];
        if(ui.exportOnlyChecked && Array.isArray(ui.displayTables)) {
            const selected = new Set(ui.displayTables);
            tables = tables.filter(t => selected.has(t.name));
        }
        const joins = this.getEnabledJoinTables(true);
        const shownOnly = ui.exportCols === 'shown';
        return [...tables, ...joins].map(table => this.projectTableForExport(table, shownOnly));
    },

    getPreviewExportTables() {
        return this.rendered.map(r => ({
            name: r.name || 'Sheet',
            headers: r.headers,
            rows: r.rows.map(row => row.d)
        }));
    },

    updateSourceEditorStats() {
        const stats = $('sourceEditorStats');
        if(!stats) return;
        const text = this.getSourceEditorText();
        let lines = text ? 1 : 0;
        for(let i = 0; i < text.length; i++) if(text.charCodeAt(i) === 10) lines++;
        stats.textContent = `${text.length} 字符 · ${lines} 行`;
    },

    scheduleSourceEditorStats() {
        clearTimeout(this.sourceEditorStatsTimer);
        this.sourceEditorStatsTimer = setTimeout(() => this.updateSourceEditorStats(), 180);
    },

    scheduleSourceEditorPersist() {
        clearTimeout(this.sourceEditorPersistTimer);
        this.sourceEditorPersistTimer = setTimeout(() => {
            const large = $('rawInputLarge');
            if(!large) return;
            Store.curr().raw = large.value;
            Store.save();
        }, 900);
    },

    syncSourceEditorControls() {
        const formatMain = $('formatSelect');
        const headerMain = $('headerModeSelect');
        const formatLarge = $('formatSelectLarge');
        const headerLarge = $('headerModeSelectLarge');
        if(formatLarge && formatMain) formatLarge.value = formatMain.value || 'auto';
        if(headerLarge && headerMain) headerLarge.value = headerMain.value || 'auto';
        const manualFormat = formatLarge ? formatLarge.value : (formatMain ? formatMain.value : 'auto');
        const parsedFormat = Parser.lastResult && Parser.lastResult.format;
        const isCli = ['cli-table-data', 'cli-multi-block'].includes(manualFormat) || (manualFormat === 'auto' && ['cli-table-data', 'cli-multi-block'].includes(parsedFormat));
        if(headerLarge) headerLarge.disabled = isCli;
        if(headerMain) headerMain.disabled = isCli;
    },

    syncSourceTextFromLarge() {
        const large = $('rawInputLarge');
        const main = $('rawInput');
        if(!large || !main) return;
        clearTimeout(this.sourceEditorPersistTimer);
        clearTimeout(this.sourceEditorStatsTimer);
        main.value = large.value;
        Store.curr().raw = large.value;
        Store.save();
        this.updateSourceEditorStats();
    },

    invalidateCellEdits() {
        if(!Store.clearCellEdits()) return false;
        this.editHistory = [];
        this.editRedo = [];
        this.updateUndoButtons();
        Toast.show('源数据或解析方式已变化，旧单元格修订已清除');
        return true;
    },

    openSourceEditor() {
        const modal = $('sourceEditorModal');
        const large = $('rawInputLarge');
        const main = $('rawInput');
        if(!modal || !large || !main) return;
        this.sourceEditorReturnFocus = document.activeElement;
        large.value = main.value || '';
        this.syncSourceEditorControls();
        this.updateSourceEditorStats();
        modal.classList.remove('hidden');
        document.body.classList.add('modal-open');
        setTimeout(() => { large.focus(); }, 0);
    },

    closeSourceEditor() {
        this.syncSourceTextFromLarge();
        const modal = $('sourceEditorModal');
        if(modal) modal.classList.add('hidden');
        document.body.classList.remove('modal-open');
        if(this.sourceEditorReturnFocus && typeof this.sourceEditorReturnFocus.focus === 'function') this.sourceEditorReturnFocus.focus();
        this.sourceEditorReturnFocus = null;
    },

    runFromSourceEditor(close=false) {
        this.syncSourceTextFromLarge();
        this.run();
        this.syncSourceEditorControls();
        if(close) this.closeSourceEditor();
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
            addTabBtn.onclick = e => this.createNewTab(e);
        }
        const doParse = () => this.run();
        const doClear = () => {
            $('rawInput').value='';
            this.lastPaste = null;
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

        $('rawInput').oninput = e => {
            this.invalidateCellEdits();
            Store.curr().raw = e.target.value;
            if(this.lastPaste && String(e.target.value).trim() !== String(this.lastPaste.plain || '').trim()) this.lastPaste = null;
            this.scheduleSourceInputPersist();
        };
        $('rawInput').addEventListener('paste', e => {
            const data = e.clipboardData;
            if(!data) return;
            const html = data.getData('text/html');
            const plain = data.getData('text/plain');
            this.lastPaste = html && /<table[\s>]/i.test(html) ? { html, plain, docId:Store.state.activeId } : null;
        });
        const importSourceBtn = $('importSourceBtn');
        const sourceFileInput = $('sourceFileInput');
        if(importSourceBtn && sourceFileInput) importSourceBtn.onclick = () => sourceFileInput.click();
        if(sourceFileInput) sourceFileInput.onchange = e => {
            const file = e.target.files && e.target.files[0];
            this.loadSourceFile(file);
            e.target.value = '';
        };
        const sourceDropZone = $('sourceDropZone');
        if(sourceDropZone) {
            ['dragenter','dragover'].forEach(type => sourceDropZone.addEventListener(type, e => { e.preventDefault(); sourceDropZone.classList.add('drag-over'); }));
            ['dragleave','drop'].forEach(type => sourceDropZone.addEventListener(type, e => { e.preventDefault(); sourceDropZone.classList.remove('drag-over'); }));
            sourceDropZone.addEventListener('drop', e => this.loadSourceFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]));
        }
        if($('diagnosticsBtn')) $('diagnosticsBtn').onclick = () => this.showDiagnostics();
        if($('persistRawToggle')) $('persistRawToggle').onchange = e => {
            Store.setPersistRaw(e.target.checked);
            this.updateStorageStatus();
            Toast.show(e.target.checked ? '原始数据将保存在此设备' : '已切换为临时数据模式');
        };
        if($('checkFormulaSafe')) $('checkFormulaSafe').onchange = e => Store.setSpreadsheetSafe(e.target.checked);
        const expandSourceBtn = $('expandSourceBtn');
        if(expandSourceBtn) expandSourceBtn.onclick = () => this.openSourceEditor();
        const sourceClose = $('sourceEditorCloseBtn');
        if(sourceClose) sourceClose.onclick = () => this.closeSourceEditor();
        const sourceDone = $('sourceEditorDoneBtn');
        if(sourceDone) sourceDone.onclick = () => this.closeSourceEditor();
        const sourceParse = $('sourceEditorParseBtn');
        if(sourceParse) sourceParse.onclick = () => this.runFromSourceEditor(false);
        const rawLarge = $('rawInputLarge');
        if(rawLarge) {
            rawLarge.oninput = () => {
                this.invalidateCellEdits();
                if(this.lastPaste && String(rawLarge.value).trim() !== String(this.lastPaste.plain || '').trim()) this.lastPaste = null;
                this.scheduleSourceEditorStats();
                this.scheduleSourceEditorPersist();
            };
            rawLarge.addEventListener('paste', e => {
                const data = e.clipboardData;
                if(!data) return;
                const html = data.getData('text/html');
                const plain = data.getData('text/plain');
                this.lastPaste = html && /<table[\s>]/i.test(html) ? { html, plain, docId:Store.state.activeId } : null;
            });
            rawLarge.onkeydown = e => {
                if((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this.runFromSourceEditor(false); }
                if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.syncSourceTextFromLarge(); Toast.show('工作区已保存'); }
            };
        }
        const formatLarge = $('formatSelectLarge');
        if(formatLarge) formatLarge.onchange = e => {
            const main = $('formatSelect');
            if(main) main.value = e.target.value;
            this.setImportFormat(e.target.value);
            this.syncSourceEditorControls();
        };
        const headerLarge = $('headerModeSelectLarge');
        if(headerLarge) headerLarge.onchange = e => {
            const main = $('headerModeSelect');
            if(main) main.value = e.target.value;
            this.setHeaderMode(e.target.value);
            this.syncSourceEditorControls();
        };
        const sourceModal = $('sourceEditorModal');
        if(sourceModal) sourceModal.addEventListener('click', e => {
            // Full-page editor returns only through explicit 完成/关闭 actions.
            if(e.target === sourceModal) e.stopPropagation();
        });
        const modalOverlay = $('modalOverlay');
        if(modalOverlay) modalOverlay.addEventListener('click', e => { if(e.target === modalOverlay) this.closeModal(); });
        const tabsContainer = $('tabsContainer');
        tabsContainer.onclick = e => {
            if(e.target.closest('.doc-tab-title-input')) return;
            if(e.target.classList.contains('doc-tab-close')) {
                e.stopPropagation();
                const t = e.target.closest('.doc-tab');
                if(t && Store.removeDoc(t.dataset.id)) {
                    App.renderTabs(); App.loadDoc();
                }
                return;
            }
            const t = e.target.closest('.doc-tab'); if(!t) return;
            this.activateTab(t.dataset.id);
        };
        tabsContainer.ondblclick = e => {
            const titleEl = e.target.closest('.doc-tab-title');
            if(!titleEl) return;
            const tab = titleEl.closest('.doc-tab');
            if(!tab) return;
            e.preventDefault();
            e.stopPropagation();
            const id = tab.dataset.id;
            if(Store.state.activeId !== id) this.activateTab(id);
            setTimeout(() => this.startTabRename(id), 0);
        };
        tabsContainer.onkeydown = e => {
            const tab = e.target.closest('.doc-tab');
            if(!tab || e.target.closest('.doc-tab-title-input')) return;
            const tabs = Array.from(tabsContainer.querySelectorAll('.doc-tab'));
            const index = tabs.indexOf(tab);
            if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.activateTab(tab.dataset.id); }
            if(e.key === 'F2') { e.preventDefault(); e.stopPropagation(); this.startTabRename(tab.dataset.id); }
            if(e.key === 'Delete' && Store.state.docs.length > 1) {
                e.preventDefault();
                if(Store.removeDoc(tab.dataset.id)) { this.renderTabs(); this.loadDoc(); }
            }
            if(['ArrowLeft','ArrowRight'].includes(e.key)) {
                e.preventDefault();
                const offset = e.key === 'ArrowRight' ? 1 : -1;
                const next = tabs[(index + offset + tabs.length) % tabs.length];
                if(next) this.activateTab(next.dataset.id);
            }
        };
        tabsContainer.addEventListener('dragstart', e => {
            const tab = e.target.closest('.doc-tab');
            if(!tab || e.target.closest('.doc-tab-close') || e.target.closest('.doc-tab-title-input')) {
                e.preventDefault();
                return;
            }
            this.tabDrag.sourceId = tab.dataset.id;
            tab.classList.add('dragging');
            if(e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', tab.dataset.id);
            }
        });
        tabsContainer.addEventListener('dragover', e => {
            const tab = e.target.closest('.doc-tab');
            if(!this.tabDrag.sourceId) return;
            if(!tab && e.target === tabsContainer) {
                e.preventDefault();
                if(e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                return;
            }
            if(!tab || tab.dataset.id === this.tabDrag.sourceId) return;
            e.preventDefault();
            const rect = tab.getBoundingClientRect();
            const place = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
            this.markTabDrop(tab, place);
            if(e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        });
        tabsContainer.addEventListener('dragleave', e => {
            const tab = e.target.closest('.doc-tab');
            if(tab && !tab.contains(e.relatedTarget)) this.clearTabDragMarkers(tab);
        });
        tabsContainer.addEventListener('drop', e => {
            let tab = e.target.closest('.doc-tab');
            if(!this.tabDrag.sourceId) return;
            if(!tab && e.target === tabsContainer) {
                const tabs = Array.from(tabsContainer.querySelectorAll('.doc-tab')).filter(el => el.dataset.id !== this.tabDrag.sourceId);
                tab = tabs[tabs.length - 1];
                if(!tab) return;
            }
            if(!tab || tab.dataset.id === this.tabDrag.sourceId) return;
            e.preventDefault();
            const place = tab.classList.contains('drag-over-after') || e.target === tabsContainer ? 'after' : 'before';
            Store.moveDoc(this.tabDrag.sourceId, tab.dataset.id, place);
            this.clearAllTabDragMarkers();
            this.tabDrag.sourceId = null;
            this.renderTabs();
        });
        tabsContainer.addEventListener('dragend', () => {
            this.clearAllTabDragMarkers();
            this.tabDrag.sourceId = null;
        });

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
        if($('undoEditBtn')) $('undoEditBtn').onclick = () => this.undoCellEdit();
        if($('redoEditBtn')) $('redoEditBtn').onclick = () => this.redoCellEdit();
        if($('pageSizeSelect')) $('pageSizeSelect').onchange = e => {
            const ui = Store.curr().ui;
            ui.pageSize = Number(e.target.value) || 100;
            ui.tablePages = {};
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
        const copyFormatSelect = $('copyFormatSelect');
        if(copyFormatSelect) {
            copyFormatSelect.value = Store.state.copyFormat || 'default';
            copyFormatSelect.onchange = e => this.setCopyFormat(e.target.value);
        }

        $('exportRawBtn').onclick = () => Exporter.toExcel(this.raw, this.getExportPrefix('raw'));
        const exportFullBtn = $('exportFullBtn');
        if(exportFullBtn) exportFullBtn.onclick = () => Exporter.toExcel(this.getFullExportTables(), this.getExportPrefix('full'));
        $('exportPrevBtn').onclick = () => Exporter.toExcel(this.getPreviewExportTables(), this.getExportPrefix('preview'));
        $('exportTabBtn').onclick = () => Exporter.toJson({
            kind:'ota-workspace',
            schemaVersion:WORKSPACE_SCHEMA_VERSION,
            appVersion:APP_VERSION,
            exportedAt:new Date().toISOString(),
            docs:Store.state.docs,
            globalViews:Store.state.globalViews,
            preferences:{ theme:Store.state.theme, copyFormat:Store.state.copyFormat, persistRaw:Store.state.persistRaw, spreadsheetSafe:Store.state.spreadsheetSafe }
        }, this.getExportPrefix('workspace'));
        $('importTabBtn').onclick = () => $('fileInputTab').click();
        $('fileInputTab').onchange = e => {
            const f = e.target.files[0]; if(!f) return;
            if(f.size > MAX_IMPORT_BYTES) { Toast.show('工作区文件超过 25 MB 限制', true); e.target.value=''; return; }
            const r = new FileReader();
            r.onload = evt => {
                try {
                    const d = JSON.parse(evt.target.result);
                    const replace = confirm('确定：替换当前工作区\n取消：把备份追加为新页签');
                    const count = Store.importWorkspace(d, !replace);
                    if(d.preferences && typeof d.preferences === 'object') {
                        if(['light','dark'].includes(d.preferences.theme)) Store.state.theme = d.preferences.theme;
                        if(COPY_FORMATS.includes(d.preferences.copyFormat)) Store.state.copyFormat = d.preferences.copyFormat;
                        if(typeof d.preferences.persistRaw === 'boolean') Store.state.persistRaw = d.preferences.persistRaw;
                        if(typeof d.preferences.spreadsheetSafe === 'boolean') Store.state.spreadsheetSafe = d.preferences.spreadsheetSafe;
                        Store.applyTheme(); Store.save();
                    }
                    App.renderTabs(); App.loadDoc(); Toast.show(`已恢复 ${count} 个页签`);
                } catch(error){ Toast.show(`工作区导入失败：${error.message || '格式错误'}`, true); }
                e.target.value = '';
            };
            r.readAsText(f);
        };
        $('exportConfigBtn').onclick = () => Exporter.toJson({ kind:'table-tool-config', globalViews: Store.state.globalViews, docs: Store.state.docs.map(d=>({id:d.id, title:d.title, ui:d.ui})) }, this.getExportPrefix('config'));
        $('importConfigBtn').onclick = () => $('fileInputConfig').click();
        $('fileInputConfig').onchange = e => {
            const f = e.target.files[0]; if(!f) return;
            if(f.size > 5 * 1024 * 1024) { Toast.show('配置文件超过 5 MB 限制', true); e.target.value=''; return; }
            const r = new FileReader();
            r.onload = evt => {
                try {
                    const d = JSON.parse(evt.target.result);
                    if(d.kind !== 'table-tool-config' || !Store.isSafePayload(d)) throw new Error('配置结构无效');

                    // 更新全局视图
                    if(Array.isArray(d.globalViews)) {
                        const oldCount = Store.state.globalViews.length;
                        Store.state.globalViews = d.globalViews.slice(0, 500).filter(view => view && typeof view === 'object' && typeof view.view === 'string');
                        Toast.show(`全局视图已更新 (${oldCount} → ${d.globalViews.length} 个)`, false, 2000);
                    }

                    // 更新文档配置
                    if(Array.isArray(d.docs) && d.docs.length > 0 && d.docs.length <= 100) {
                        let appliedCount = 0;
                        let ignoredDocs = [];
                        let createdDocs = [];

                        d.docs.filter(x => x && typeof x === 'object').forEach(x => {
                            // 优先使用 title 匹配（更符合用户预期），如果 title 不存在才用 id 匹配
                            let t = Store.state.docs.find(y => y.title === x.title);
                            if(!t) t = Store.state.docs.find(y => y.id === x.id);

                            if(t) {
                                // 匹配到文档，更新配置
                                if(x.ui && typeof x.ui === 'object') t.ui = x.ui;
                                appliedCount++;
                            } else {
                                // 没有匹配到，记录下来
                                ignoredDocs.push(x.title || x.id);
                            }
                        });

                        // 如果有被忽略的配置，询问用户是否创建新文档
                        if(ignoredDocs.length > 0) {
                            const msg = `配置导入完成：\n• 已应用 ${appliedCount} 个文档的配置\n• ${ignoredDocs.length} 个配置无法匹配（${ignoredDocs.slice(0, 3).join(', ')}${ignoredDocs.length > 3 ? '...' : ''}）\n\n是否为这些配置创建新文档？`;

                            if(confirm(msg)) {
                                ignoredDocs.forEach((docName, idx) => {
                                    const config = d.docs.find(dc => (dc.title === docName) || (dc.id === docName));
                                    if(config) {
                                        const newDoc = Store.addDoc({ title:config.title, raw:'', ui:(config.ui && typeof config.ui === 'object') ? config.ui : {} });
                                        createdDocs.push(newDoc.title);
                                    }
                                });

                                Store.save();
                                App.renderTabs();
                                App.loadDoc();

                                if(createdDocs.length > 0) {
                                    Toast.show(`配置已更新，新增 ${createdDocs.length} 个文档`, false, 3000);
                                }
                            } else {
                                Store.save();
                                App.loadDoc();
                                Toast.show(`配置已更新（应用了 ${appliedCount} 个文档）`, false, 2000);
                            }
                        } else {
                            // 所有配置都成功应用
                            Store.save();
                            App.loadDoc();
                            Toast.show(`配置已更新（应用了 ${appliedCount} 个文档）`, false, 2000);
                        }
                    } else {
                        Store.save();
                        App.loadDoc();
                        Toast.show('配置已更新');
                    }
                } catch(e) {
                    console.error(e);
                    alert('配置文件格式错误，请检查文件是否完整');
                }
                e.target.value = '';
            };
            r.readAsText(f);
        };
        
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

        $('jeLeftTable').onchange = () => JoinEditor.handleTableChange('l');
        $('jeRightTable').onchange = () => JoinEditor.handleTableChange('r');
        $('jeType').onchange = () => { JoinEditor.markDirty(); JoinEditor.updateAll(); };
        $('jeName').oninput = () => { JoinEditor.markDirty(); JoinEditor.updateSaveState(); };

        $('jeLSearch').oninput = () => JoinEditor.renderColList('jeLList', App.getCols($('jeLeftTable').value), JoinEditor.state.lSel, 'l');
        $('jeRSearch').oninput = () => JoinEditor.renderColList('jeRList', App.getCols($('jeRightTable').value), JoinEditor.state.rSel, 'r');
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
                if(e.key === 'Escape') { e.preventDefault(); this.closeSourceEditor(); }
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
            if(mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.persistCurrentDocFromInputs(); Toast.show('工作区已保存'); return; }
            if(mod && !typing && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); this.undoCellEdit(); return; }
            if(mod && !typing && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); this.redoCellEdit(); return; }
            if(e.key === 'F2' && !typing) { e.preventDefault(); this.startTabRename(Store.state.activeId); return; }
            if(e.key === '?' && !typing) { e.preventDefault(); this.showHelp(); return; }
            if($('joinModal').classList.contains('hidden')) return;
            if(!$('modalOverlay').classList.contains('hidden')) return;
            if(e.key === 'Escape') { e.preventDefault(); JoinEditor.close(); }
            if(e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('jeLSearch').focus(); }
            if(e.key === 'Enter' && !e.shiftKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); JoinEditor.save(); }
        });

        // Filter popover bindings
        this.initFilterPopover();

        // Cell inline editing
        $('previewArea').addEventListener('dblclick', e => {
            const td = e.target.closest('td');
            if(!td || !td.closest('table') || td.classList.contains('row-header-cell')) return;
            e.stopPropagation();
            Select.clear();
            this.startCellEdit(td);
        });
    },

    loadDoc() {
        const d = Store.curr();
        this.lastPaste = null;
        this.editHistory = [];
        this.editRedo = [];
        this.updateUndoButtons();
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

    scheduleSourceInputPersist() {
        clearTimeout(this.sourceInputPersistTimer);
        this.sourceInputPersistTimer = setTimeout(() => {
            Store.curr().raw = $('rawInput').value;
            Store.save();
        }, 650);
    },

    loadSourceFile(file) {
        if(!file) return;
        if(file.size > MAX_IMPORT_BYTES) return Toast.show('文件超过 25 MB 安全限制', true);
        const reader = new FileReader();
        reader.onerror = () => Toast.show('无法读取该文件', true);
        reader.onload = event => {
            const text = String(event.target.result || '').replace(/^\uFEFF/, '');
            this.invalidateCellEdits();
            $('rawInput').value = text;
            const detected = this.sourceFileFormat(file);
            if(detected === 'html-table') this.lastPaste = { html:text, plain:text, docId:Store.state.activeId };
            else this.lastPaste = null;
            Store.curr().raw = text;
            const select = $('formatSelect');
            if(select && select.value === 'auto' && detected !== 'auto') {
                select.value = detected;
                Store.curr().ui.importFormat = detected;
            }
            Store.save();
            this.run();
            Toast.show(`已导入 ${file.name}`);
        };
        reader.readAsText(file);
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
            this.applyStoredCellEdits();
            this.updateImportSummary();
            this.updSelects();
            if(render) this.renderPreview();
            this.updChips();
            const elapsed = Math.round(performance.now() - started);
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

    renderTabs() {
        const container = $('tabsContainer');
        if(!container) return;
        container.innerHTML = Store.state.docs.map((d, idx) => {
            Store.normalizeDoc(d, idx);
            const title = d.title || `Analysis ${idx + 1}`;
            const safeTitle = this.escapeHtml(title);
            const safeId = this.escapeHtml(d.id);
            const active = d.id === Store.state.activeId;
            return `<div class="doc-tab ${active?'active':''}" data-id="${safeId}" draggable="true" title="${safeTitle}" role="tab" aria-selected="${active?'true':'false'}" tabindex="${active?'0':'-1'}"><span class="doc-tab-title">${safeTitle}</span><button class="doc-tab-close" type="button" draggable="false" title="关闭" aria-label="关闭 ${safeTitle}">×</button></div>`;
        }).join('');
    },

    startTabRename(id) {
        const tab = Array.from(document.querySelectorAll('.doc-tab')).find(el => el.dataset.id === id);
        if(!tab) return;
        const titleEl = tab.querySelector('.doc-tab-title');
        const doc = Store.state.docs.find(d => d.id === id);
        if(!titleEl || !doc) return;
        const oldTitle = doc.title || '';
        tab.setAttribute('draggable', 'false');
        const input = document.createElement('input');
        input.className = 'doc-tab-title-input';
        input.value = oldTitle;
        input.maxLength = 40;
        titleEl.innerHTML = '';
        titleEl.appendChild(input);
        let done = false;
        const finish = (save) => {
            if(done) return;
            done = true;
            if(save) Store.renameDoc(id, input.value);
            this.renderTabs();
        };
        input.onclick = e => e.stopPropagation();
        input.ondblclick = e => e.stopPropagation();
        input.onkeydown = e => {
            e.stopPropagation();
            if(e.key === 'Enter') finish(true);
            if(e.key === 'Escape') finish(false);
        };
        input.onblur = () => finish(true);
        setTimeout(() => { input.focus(); input.select(); }, 0);
    },

    markTabDrop(tab, place) {
        document.querySelectorAll('.doc-tab.drag-over-before, .doc-tab.drag-over-after').forEach(el => {
            if(el !== tab) this.clearTabDragMarkers(el);
        });
        tab.classList.toggle('drag-over-before', place === 'before');
        tab.classList.toggle('drag-over-after', place === 'after');
    },

    clearTabDragMarkers(tab) {
        if(!tab) return;
        tab.classList.remove('dragging', 'drag-over-before', 'drag-over-after');
    },

    clearAllTabDragMarkers() {
        document.querySelectorAll('.doc-tab').forEach(tab => this.clearTabDragMarkers(tab));
    },

    buildColumnHeaderTable(t, res, tIdx, colFilters={}) {
        const tbl = createEl('table');
        // Selection focuses the table after a cell click so keyboard shortcuts
        // apply to the preview rather than the source editor.
        tbl.tabIndex = -1;
        tbl.dataset.idx = tIdx;
        tbl.dataset.tableName = t.name;
        tbl.dataset.viewMode = 'column-header';
        tbl.setAttribute('aria-label', `${t.name} 列表头预览`);
        const thRow = createEl('tr');
        res.headers.forEach((h, hIdx) => {
            const th=createEl('th');
            th.classList.add('filterable-th');
            th.tabIndex = 0;
            th.setAttribute('role', 'button');
            const hasFilter = colFilters[h] && colFilters[h].toString().trim();
            th.title= hasFilter ? `已过滤：${colFilters[h]}` : '点击过滤该列（包含匹配，忽略大小写）';
            if(hasFilter) th.style.color = 'var(--primary)';
            const label = createEl('span','th-label');
            label.textContent = h;
            if(hasFilter) {
                const dot = createEl('span','th-filter-dot');
                label.appendChild(dot);
                const clearBtn = createEl('span','th-filter-clear');
                clearBtn.textContent = '×';
                clearBtn.title = '清除该列过滤';
                clearBtn.onclick = (ev) => { ev.stopPropagation(); this.clearColumnFilter(t.name, h); };
                th.appendChild(clearBtn);
            }
            th.appendChild(label);
            th.onclick = (ev) => { ev.stopPropagation(); this.promptColumnFilter(t.name, h, th); };
            th.onkeydown = ev => { if(ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.promptColumnFilter(t.name, h, th); } };
            th.dataset.vc = hIdx;
            thRow.appendChild(th);
        });
        const thead = createEl('thead'); thead.appendChild(thRow); tbl.appendChild(thead);
        const tbody = createEl('tbody');
        res.rows.forEach((r, rIdx) => {
            const tr = createEl('tr');
            if(r._hl) tr.className = 'highlight-row';
            r.d.forEach((c, cIdx) => {
                const td=createEl('td');
                const v = c===undefined||c===null?'':c;
                td.textContent=v;
                if(String(v).length > 18) td.dataset.full=v;
                td.dataset.r=rIdx; td.dataset.c=cIdx;
                td.dataset.vr=rIdx; td.dataset.vc=cIdx;
                td.dataset.resultRow = r._resultIndex ?? rIdx;
                if(!r._readOnly) {
                    td.dataset.sourceRow = r._sourceRow;
                    td.dataset.sourceCol = r._sourceCols[cIdx];
                    td.title = '双击编辑；修改会作为当前页签的修订保存';
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        tbl.appendChild(tbody);
        return tbl;
    },

    buildRowHeaderTable(t, res, tIdx, colFilters={}) {
        const tbl = createEl('table');
        tbl.tabIndex = -1;
        tbl.dataset.idx = tIdx;
        tbl.dataset.tableName = t.name;
        tbl.dataset.viewMode = 'row-header';
        tbl.setAttribute('aria-label', `${t.name} 行表头预览`);
        const thead = createEl('thead');
        const htr = createEl('tr');
        const corner = createEl('th', 'row-header-th');
        corner.textContent = '字段';
        htr.appendChild(corner);
        res.rows.forEach((row, rIdx) => {
            const th = createEl('th');
            th.textContent = `Row ${(row._resultIndex ?? rIdx) + 1}`;
            th.dataset.vc = rIdx + 1;
            htr.appendChild(th);
        });
        thead.appendChild(htr);
        tbl.appendChild(thead);
        const tbody = createEl('tbody');
        res.headers.forEach((h, cIdx) => {
            const tr = createEl('tr');
            const hCell = createEl('td', 'row-header-cell filterable-th');
            hCell.tabIndex = 0;
            hCell.setAttribute('role', 'button');
            const hasFilter = colFilters[h] && colFilters[h].toString().trim();
            hCell.textContent = h;
            hCell.title = hasFilter ? `已过滤：${colFilters[h]}` : '点击过滤该字段';
            if(hasFilter) hCell.style.color = 'var(--primary)';
            hCell.onclick = ev => { ev.stopPropagation(); this.promptColumnFilter(t.name, h, hCell); };
            hCell.onkeydown = ev => { if(ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.promptColumnFilter(t.name, h, hCell); } };
            tr.appendChild(hCell);
            res.rows.forEach((r, rIdx) => {
                const td = createEl('td');
                const v = r.d[cIdx] === undefined || r.d[cIdx] === null ? '' : r.d[cIdx];
                td.textContent = v;
                if(String(v).length > 18) td.dataset.full = v;
                td.dataset.r = rIdx; td.dataset.c = cIdx;
                td.dataset.vr = cIdx; td.dataset.vc = rIdx;
                td.dataset.resultRow = r._resultIndex ?? rIdx;
                if(!r._readOnly) {
                    td.dataset.sourceRow = r._sourceRow;
                    td.dataset.sourceCol = r._sourceCols[cIdx];
                    td.title = '双击编辑；修改会作为当前页签的修订保存';
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        tbl.appendChild(tbody);
        return tbl;
    },

    renderPreview() {
        if(this.activeEditor) this.finishCellEdit(true);
        const div = $('previewArea'); div.innerHTML = '';
        this.rendered = []; Select.clear();
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

        combined.forEach((t, tIdx) => {
            const res = this.proc(t, ui);
            res.rows.forEach((row, index) => { row._resultIndex = index; });
            this.rendered.push({name: t.name, ...res}); 
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
            if(filterCount>0) { 
                const fTag = createEl('span','meta-tag'); 
                fTag.textContent = `列过滤: ${filterCount}`; 
                fTag.style.cursor = 'pointer';
                fTag.title = '清除本表全部列过滤';
                fTag.onclick = () => this.clearTableFilters(t.name);
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
            card.appendChild(tbl);
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

    initFilterPopover() {
        const pop = $('filterPopover');
        if(!pop) return;
        const title = $('fpTitle');
        const input = $('fpInput');
        const btnApply = $('fpApply');
        const btnClear = $('fpClear');
        const btnClose = $('fpClose');
        const hide = () => { pop.classList.add('hidden'); this.filterPopover = {open:false, table:null, col:null, pop, input, title}; };
        this.filterPopover.pop = pop;
        this.filterPopover.input = input;
        this.filterPopover.title = title;
        btnClose.onclick = hide;
        btnClear.onclick = () => {
            if(!this.filterPopover.table || !this.filterPopover.col) { hide(); return; }
            const ui = Store.curr().ui;
            if(ui.columnFilters && ui.columnFilters[this.filterPopover.table]) {
                delete ui.columnFilters[this.filterPopover.table][this.filterPopover.col];
            }
            Store.save();
            hide();
            this.renderPreview();
        };
        btnApply.onclick = () => {
            if(!this.filterPopover.table || !this.filterPopover.col) { hide(); return; }
            const val = (input.value || '').trim();
            const ui = Store.curr().ui;
            if(!ui.columnFilters) ui.columnFilters = {};
            if(!ui.columnFilters[this.filterPopover.table]) ui.columnFilters[this.filterPopover.table] = {};
            if(val) ui.columnFilters[this.filterPopover.table][this.filterPopover.col] = val;
            else delete ui.columnFilters[this.filterPopover.table][this.filterPopover.col];
            Store.save();
            hide();
            this.renderPreview();
        };
        document.addEventListener('click', e => {
            if(!this.filterPopover.open) return;
            if(pop.contains(e.target)) return;
            const th = e.target.closest && e.target.closest('.filterable-th');
            if(th) return; // allow new popover open handler to manage
            hide();
        });
        document.addEventListener('keydown', e => {
            if(e.key === 'Escape' && this.filterPopover.open) hide();
        });
        const preview = $('previewArea');
        if(preview) preview.addEventListener('scroll', () => { if(this.filterPopover.open) hide(); });
        this.filterPopover.hide = hide;
    },

    promptColumnFilter(tableName, colName, anchorEl) {
        if(this.filterPopover.open && this.filterPopover.hide) this.filterPopover.hide();
        const pop = this.filterPopover.pop;
        const input = this.filterPopover.input;
        const title = this.filterPopover.title;
        if(!pop || !input || !title) return;
        const ui = Store.curr().ui;
        const prev = ((ui.columnFilters && ui.columnFilters[tableName] && ui.columnFilters[tableName][colName]) || '').toString();
        input.value = prev;
        title.textContent = `${tableName}.${colName}`;
        this.filterPopover.open = true;
        this.filterPopover.table = tableName;
        this.filterPopover.col = colName;
        pop.classList.remove('hidden');

        // Position near header
        const rect = anchorEl.getBoundingClientRect();
        const popRect = pop.getBoundingClientRect();
        const top = Math.max(10, rect.bottom + 6);
        let left = rect.left;
        const maxLeft = window.innerWidth - popRect.width - 10;
        if(left > maxLeft) left = maxLeft;
        if(left < 10) left = 10;
        pop.style.top = `${top}px`;
        pop.style.left = `${left}px`;
        input.focus();
        input.select();
    },

    clearColumnFilter(tableName, colName) {
        const ui = Store.curr().ui;
        if(ui.columnFilters && ui.columnFilters[tableName]) {
            delete ui.columnFilters[tableName][colName];
        }
        Store.save();
        if(this.filterPopover.hide) this.filterPopover.hide();
        this.renderPreview();
    },

    clearTableFilters(tableName) {
        const ui = Store.curr().ui;
        if(ui.columnFilters) {
            delete ui.columnFilters[tableName];
            Store.save();
            if(this.filterPopover.hide) this.filterPopover.hide();
            this.renderPreview();
        }
    },

    toggleTableCollapse(tableName) {
        const ui = Store.curr().ui;
        if(!ui.collapsedTables) ui.collapsedTables = {};
        ui.collapsedTables[tableName] = !ui.collapsedTables[tableName];
        Store.save();
        this.renderPreview();
    },

    setCellEdit(tableName, rowIdx, colIdx, value, record=true) {
        const table = this.raw.find(item => item.name === tableName && !item.isView);
        if(!table || !table.rows[rowIdx] || colIdx < 0 || colIdx >= table.headers.length) return false;
        const previous = String(table.rows[rowIdx][colIdx] ?? '');
        const next = String(value ?? '');
        if(previous === next) return false;
        const ui = Store.curr().ui;
        if(!ui.cellEdits) ui.cellEdits = {};
        const tableKey = `$${tableName}`;
        if(!ui.cellEdits[tableKey]) ui.cellEdits[tableKey] = {};
        if(!ui.cellEdits[tableKey][rowIdx]) ui.cellEdits[tableKey][rowIdx] = {};
        ui.cellEdits[tableKey][rowIdx][colIdx] = next;
        table.rows[rowIdx][colIdx] = next;
        if(record) {
            this.editHistory.push({ tableName, rowIdx, colIdx, previous, next });
            if(this.editHistory.length > 100) this.editHistory.shift();
            this.editRedo = [];
        }
        Store.save();
        this.updateUndoButtons();
        return true;
    },

    undoCellEdit() {
        const edit = this.editHistory.pop();
        if(!edit) return;
        this.setCellEdit(edit.tableName, edit.rowIdx, edit.colIdx, edit.previous, false);
        this.editRedo.push(edit);
        this.updateUndoButtons();
        this.renderPreview();
    },

    redoCellEdit() {
        const edit = this.editRedo.pop();
        if(!edit) return;
        this.setCellEdit(edit.tableName, edit.rowIdx, edit.colIdx, edit.next, false);
        this.editHistory.push(edit);
        this.updateUndoButtons();
        this.renderPreview();
    },

    updateUndoButtons() {
        if($('undoEditBtn')) $('undoEditBtn').disabled = this.editHistory.length === 0;
        if($('redoEditBtn')) $('redoEditBtn').disabled = this.editRedo.length === 0;
    },

    setTablePage(tableName, page) {
        const ui = Store.curr().ui;
        if(!ui.tablePages) ui.tablePages = {};
        ui.tablePages[tableName] = Math.max(1, Number(page) || 1);
        Store.save();
        this.renderPreview();
    },

    startCellEdit(td) {
        if(this.activeEditor) this.finishCellEdit(true);
        const tbl = td.closest('table');
        const tableName = tbl.dataset.tableName;
        const sourceRow = Number(td.dataset.sourceRow);
        const sourceCol = Number(td.dataset.sourceCol);
        if(!tableName || !Number.isInteger(sourceRow) || !Number.isInteger(sourceCol)) return Toast.show('JOIN 视图为只读，请编辑来源表', true);
        const orig = td.textContent;
        const origHeight = td.getBoundingClientRect().height;
        td.style.height = `${origHeight}px`;
        td.style.minHeight = `${origHeight}px`;
        td.classList.add('editing');

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cell-editor';
        input.value = orig;
        td.innerHTML = '';
        td.appendChild(input);
        input.focus();
        input.select();
        let done = false;

        const cancel = () => {
            if(done) return;
            done = true;
            if(input.parentNode === td) td.removeChild(input);
            td.textContent = orig;
            td.style.height = '';
            td.style.minHeight = '';
            td.classList.remove('editing');
            this.activeEditor = null;
        };
        const commit = () => {
            if(done) return;
            done = true;
            const val = input.value;
            if(input.parentNode === td) td.removeChild(input);
            td.textContent = val;
            if(String(val).length > 18) td.dataset.full = val; else td.removeAttribute('data-full');
            this.setCellEdit(tableName, sourceRow, sourceCol, val, true);
            td.style.height = '';
            td.style.minHeight = '';
            td.classList.remove('editing');
            this.activeEditor = null;
        };

        const onKey = (e) => {
            if(e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commit(); }
            else if(e.key === 'Escape') { e.preventDefault(); cancel(); }
        };
        input.addEventListener('keydown', onKey);
        input.addEventListener('blur', commit, { once: true });
        this.activeEditor = { td, input, orig, commit, cancel };
    },

    finishCellEdit(commit=true) {
        if(!this.activeEditor) return;
        const { commit: doCommit, cancel } = this.activeEditor;
        if(commit) doCommit(); else cancel();
        this.activeEditor = null;
    },

    proc(t, ui) {
        const r = ui.rules[t.name] || {};
        let head = t.headers, idxs = t.headers.map((_,i)=>i);
        if(r.focus && r.focus.length) {
            head=[]; idxs=[];
            r.focus.forEach(c => { const i=t.headers.indexOf(c); if(i>-1){ head.push(c); idxs.push(i); } });
            if(!head.length) { head=t.headers; idxs=t.headers.map((_,i)=>i); }
        }

        const hMap = new Map(t.headers.map((h, i) => [h.toLowerCase(), i]));
        const colFilterMap = (ui.columnFilters && ui.columnFilters[t.name]) || {};
        const activeColFilters = Object.entries(colFilterMap).filter(([,v]) => (v ?? '').toString().trim());

        // --- SMART FILTER LOGIC ---
        const checkToken = (token, row) => {
            const opMatch = token.match(/^(.+?)(!=|>=|<=|=|>|<|:)(.+)$/);
            if (opMatch) {
                const key = opMatch[1].toLowerCase();
                const op = opMatch[2];
                const rawVal = opMatch[3].trim();
                const unquoted = ((rawVal.startsWith('"') && rawVal.endsWith('"')) || (rawVal.startsWith("'") && rawVal.endsWith("'"))) ? rawVal.slice(1, -1) : rawVal;
                const val = unquoted.toLowerCase();
                const idx = hMap.get(key);
                if (idx === undefined) return false;
                
                let cellVal = (row[idx] || "").toLowerCase();
                const numC = parseFloat(cellVal);
                const numV = parseFloat(val);
                const isNum = !isNaN(numC) && !isNaN(numV);

                switch(op) {
                    case '=': return cellVal === val; 
                    case ':': return cellVal.includes(val); 
                    case '!=': return cellVal !== val;
                    case '>': return isNum && numC > numV;
                    case '>=': return isNum && numC >= numV;
                    case '<': return isNum && numC < numV;
                    case '<=': return isNum && numC <= numV;
                }
            }
            if (token.startsWith('/') && token.endsWith('/')) {
                const pattern = token.slice(1, -1);
                if(pattern.length > 200) return false;
                try { return new RegExp(pattern, 'i').test(row.join(' ')); } catch (e) { return false; }
            }
            return row.join(' ').toLowerCase().includes(token.toLowerCase());
        };

        const checkRule = (ruleStr, row) => {
            if (!ruleStr) return true;
            const tokens = [];
            let token = '', quote = '';
            for(const ch of ruleStr.trim()) {
                if(quote) {
                    token += ch;
                    if(ch === quote) quote = '';
                } else if(ch === '"' || ch === "'") {
                    quote = ch; token += ch;
                } else if(/\s/.test(ch)) {
                    if(token) { tokens.push(token); token = ''; }
                } else token += ch;
            }
            if(token) tokens.push(token);
            return tokens.every(t => {
                if(t.startsWith('/') && t.endsWith('/')) return checkToken(t, row);
                if (t.includes('|')) return t.split('|').some(st => checkToken(st, row));
                return checkToken(t, row);
            });
        };

        const gF = (ui.globalFilter||'');
        const tF = (r.filter||'');
        const hlF = (r.hl||'');

        const rows = [];
        t.rows.forEach((row, sourceRow) => {
            if(gF && !checkRule(gF, row)) return;
            if(tF && !checkRule(tF, row)) return;
            if(activeColFilters.length) {
                const pass = activeColFilters.every(([col, val]) => {
                    const idx = t.headers.indexOf(col);
                    if(idx===-1) return true;
                    const cell = row[idx];
                    return (cell ?? '').toString().toLowerCase().includes(val.toString().toLowerCase());
                });
                if(!pass) return;
            }
            let hl = false;
            if(ui.enableHighlight!==false && hlF && checkRule(hlF, row)) hl = true;
            if(ui.onlyHighlighted && !hl) return;
            rows.push({ d: idxs.map(i=>row[i]), _hl: hl, _sourceRow:sourceRow, _sourceCols:idxs.slice(), _readOnly:!!t.isView });
        });
        return { headers: head, rows };
    },

    closeModal() {
        $('modalOverlay').classList.add('hidden');
        if(this.modalReturnFocus && typeof this.modalReturnFocus.focus === 'function') this.modalReturnFocus.focus();
        this.modalReturnFocus = null;
    },
    modal(title, html) {
        this.modalReturnFocus = document.activeElement;
        $('modalContent').innerHTML = `<div class="panel-header" style="border-radius:8px 8px 0 0;"><span id="modalTitle">${this.escapeHtml(title)}</span><button class="icon-btn" id="modalCloseBtn" type="button" aria-label="关闭">×</button></div><div class="modal-body">${html}</div>`;
        $('modalOverlay').classList.remove('hidden');
        $('modalCloseBtn').onclick = () => this.closeModal();
        setTimeout(() => $('modalCloseBtn').focus(), 0);
    },

    modTables() {
        const ts = this.raw.map(t=>t.name);
        const selSaved = Store.curr().ui.displayTables;
        const sel = (selSaved===null || selSaved===undefined) ? ts : selSaved;
        const h = ts.map(t => `<label class="checkbox-row"><input type="checkbox" value="${this.escapeHtml(t)}" ${sel.includes(t)?'checked':''}><span>${this.escapeHtml(t)}</span></label>`).join('');
        this.modal('选择显示表', `<div>${h}</div><div style="margin-top:16px; text-align:right;"><button class="primary" id="saveMod">确定</button></div>`);
        $('saveMod').onclick = () => {
            const v = Array.from(document.querySelectorAll('.checkbox-row input:checked')).map(c=>c.value);
            // v.length===ts.length 但 ts 为空时，保持空数组代表“全不选”
            const next = (v.length===ts.length && ts.length>0) ? null : v;
            Store.updateUI('displayTables', next); $('modalOverlay').classList.add('hidden'); this.run();
        };
    },
    modViews() {
        const vs = Store.state.globalViews, sel = Store.curr().ui.enabledViews || [];
        if(!vs.length) return alert('请先管理视图');
        const h = vs.map(v => {
            const name = v.view || '(未命名视图)';
            const meta = (v.left && v.right) ? `<span style="font-size:11px; color:var(--text-tertiary); margin-left:6px;">${this.escapeHtml(v.left)} ⇔ ${this.escapeHtml(v.right)}</span>` : '';
            return `<label class="checkbox-row"><input type="checkbox" value="${this.escapeHtml(name)}" ${sel.includes(name)?'checked':''}><span style="font-weight:600; color:var(--text-main);">${this.escapeHtml(name)}</span>${meta}</label>`;
        }).join('');
        this.modal('启用视图', `<div>${h}</div><div style="margin-top:16px; text-align:right;"><button class="primary" id="saveMod">确定</button></div>`);
        $('saveMod').onclick = () => {
            Store.updateUI('enabledViews', Array.from(document.querySelectorAll('.checkbox-row input:checked')).map(c=>c.value));
            $('modalOverlay').classList.add('hidden'); this.run();
        };
    },
    
    modCols() {
        const tName = $('targetTableSelect').value; if(!tName) return;
        
        let all = [];
        const rawTable = this.raw.find(x => x.name === tName);
        
        if(rawTable) { all = rawTable.headers; } 
        else if (tName.startsWith('JOIN:')) {
            const vName = tName.replace('JOIN:', '');
            const vCfg = Store.state.globalViews.find(v => v.view === vName);
            if(vCfg) { const res = Joiner.run(this.raw, vCfg, Store.state.globalViews); if(res) all = res.headers; }
        }
        if((!all || !all.length)) { const rt = this.rendered.find(x => x.name === tName); if(rt) all = rt.headers; }
        if(!all || !all.length) return alert('无法获取列信息');

        const rule = Store.curr().ui.rules[tName] || {};
        const cur = (rule.focus && rule.focus.length > 0) ? rule.focus : all;
        const isFocusActive = (rule.focus && rule.focus.length > 0);
        
        const html = `
            <div style="margin-bottom:10px; display:flex; gap:8px;">
                <input id="colSearch" placeholder="搜索列名..." style="flex:1;">
                <button class="sm" id="colAll">全选</button>
                <button class="sm" id="colNone">全不选</button>
            </div>
            <div id="colList" style="max-height:400px; overflow-y:auto; border:1px solid var(--border-light); padding:8px; border-radius:4px;">
                ${all.map(c => `<label class="checkbox-row" data-val="${this.escapeHtml(c.toLowerCase())}"><input type="checkbox" value="${this.escapeHtml(c)}" ${!isFocusActive || cur.includes(c)?'checked':''}><span>${this.escapeHtml(c)}</span></label>`).join('')}
            </div>
            <div style="margin-top:16px; text-align:right;"><button class="primary" id="saveMod">应用</button></div>
        `;
        this.modal(`选择列: ${tName}`, html);
        const list = $('colList');
        $('colSearch').oninput = e => { const v=e.target.value.toLowerCase(); Array.from(list.children).forEach(r => r.style.display = r.dataset.val.includes(v)?'flex':'none'); };
        $('colAll').onclick = () => Array.from(list.children).forEach(r => { if(r.style.display!=='none') r.querySelector('input').checked=true; });
        $('colNone').onclick = () => Array.from(list.children).forEach(r => { if(r.style.display!=='none') r.querySelector('input').checked=false; });
        $('saveMod').onclick = () => {
            const v = Array.from(list.querySelectorAll('input:checked')).map(c=>c.value);
            Store.updateRule(tName, 'focus', v); $('focusColsInput').value=v.join(', ');
            $('modalOverlay').classList.add('hidden'); this.renderPreview();
        };
    }
};


    Tooltip.init();
    App.init();
    return { App };
});
