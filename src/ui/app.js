OTA.define('app', ["runtime","exporter","store","import-engine","parser-facade","joiner","join-editor","clipboard","selection","filter-engine","table-builder","source-controller","cell-edit-controller","filter-controller","modal-controller","tab-controller","export-controller","dispatch","table-registry","keyboard-controller","view-manager"], ({$, createEl, escapeHtml, formatBytes, Tooltip, Toast}, {Exporter}, {APP_VERSION, WORKSPACE_SCHEMA_VERSION, MAX_IMPORT_BYTES, COPY_FORMATS, Store}, {ImportEngine}, {Parser}, {Joiner}, {JoinEditor}, {ClipboardFormatter}, {Select}, {FilterEngine}, {TableBuilder}, {SourceController}, {CellEditController}, {FilterController}, {ModalController}, {TabController}, {ExportController}, {dispatch}, {TableRegistry}, {KeyboardController}, {ViewManager}) => {
/* Main App */
const App = {
    raw: [], rendered: [],
    sourceParseState: 'ready',
    tabDrag: { sourceId:null },
    _renderQueued: false,
    _renderPending: false,
    requestRender() {
        this._renderPending = true;
        if(this._renderQueued) return;
        this._renderQueued = true;
        const flush = () => {
            this._renderQueued = false;
            if(!this._renderPending) return;
            this._renderPending = false;
            this.renderPreview();
        };
        if(typeof setTimeout === 'function') setTimeout(flush, 0);
        else flush();
    },
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
        if(input) dispatch('source:replace', { text:input.value });
        return dispatch('tab:activate', { id, force });
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
                    this.renderTabs();
                    this.loadDoc();
                    break;
                case 'tab:removed':
                    this.renderTabs();
                    if (payload && payload.activeChanged) this.loadDoc();
                    break;
                case 'tab:reordered':
                    this.renderTabs();
                    break;
                case 'source:textChanged':
                    if (!payload || payload.docId === Store.state.activeId) {
                        CellEditController.reset();
                        if(!payload || payload.preservePaste !== true) SourceController.clearLastPaste();
                        this.updatePasteSourceButton();
                        this.updateWorkspaceSummary();
                    }
                    break;
                case 'parse:stale':
                    Toast.show('解析结果已过期，请重新解析当前数据源', true);
                    break;
                case 'ui:changed':
                    if (!payload || payload.replaced || ['globalFilter','columnFilters','rules','displayTables','enabledViews','previewModes','pageSize','previewTable','tablePages'].includes(payload.key)) this.requestRender();
                    this.updateWorkspaceSummary();
                    break;
                case 'views:changed':
                    this.updSelects();
                    this.updChips();
                    this.requestRender();
                    break;
                case 'parse:completed':
                    this.updSelects();
                    this.updChips();
                    this.requestRender();
                    if (payload && payload.elapsed > 800) {
                        Toast.show(`\u89e3\u6790\u5b8c\u6210 \u00b7 ${payload.elapsed} ms`);
                    }
                    break;
                case 'filter:changed':
                    this.requestRender();
                    break;
                case 'preview:changed':
                case 'preview:renderRequested':
                    this.requestRender();
                    break;
                case 'workspace:saved':
                    this.updateStorageStatus(payload || {});
                    break;
                case 'workspace:saveFailed':
                    this.updateStorageStatus({ ok: false, message: payload && payload.error });
                    break;
                case 'ui:copyFormatChanged':
                    this.syncCopyFormatControl();
                    this.syncCopyHeaderControl();
                    break;
                case 'ui:copyHeadersChanged':
                    this.syncCopyHeaderControl();
                    break;
            }
        });

        // Listen for SourceController and cross-controller events
        if (typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('ota:sourceFileLoaded', () => { this.run(); });
            document.addEventListener('ota:sourceParseRequested', () => { this.run(); });
            document.addEventListener('ota:sourceAutoParse', () => { this.run(); });
            document.addEventListener('ota:sourceParseState', (e) => {
                this.updateSourceParseState(e.detail && e.detail.state);
            });
            document.addEventListener('ota:pasteSourceChanged', () => {
                this.updatePasteSourceButton();
            });
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
                this.requestRender();
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
        const res = TableRegistry.getLastResult();
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
        const previewModes = Object.assign({}, ui.previewModes || {});
        previewModes[tableName] = mode === 'row-header' ? 'row-header' : 'column-header';
        dispatch('ui:set', { key:'previewModes', value:previewModes });
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
        if(ui.previewTable !== selected) dispatch('ui:set', { key:'previewTable', value:selected });
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
        const tableCount = TableRegistry.getRaw().length;
        const rows = TableRegistry.getRaw().reduce((sum, table) => sum + (table.rows || []).length, 0);
        const maxCols = TableRegistry.getRaw().reduce((max, table) => Math.max(max, (table.headers || []).length), 0);
        const importItems = this.getImportSummaryItems();
        const format = (TableRegistry.getLastResult() && (TableRegistry.getLastResult().label || TableRegistry.getLastResult().format)) || (importItems[0] || '').replace(/^格式:\s*/, '');
        const header = importItems.find(text => text.indexOf('表头:') === 0) || '';
        if(summary) {
            summary.textContent = tableCount
                ? `${format || '已解析'}${header ? ` · ${header}` : ''} · ${tableCount} 表 · ${rows.toLocaleString()} 行 · 最多 ${maxCols} 列`
                : '所有处理均在本地浏览器完成';
            summary.title = summary.textContent;
        }
        this.updateAnalysisState();
        this.renderActiveFilterChips();
    },

    updateAnalysisState() {
        const el = $('analysisState');
        if(!el) return;
        const ui = Store.curr().ui;
        const filterCount = (ui.globalFilter ? 1 : 0)
            + Object.values(ui.rules || {}).reduce((sum, rules) => sum + ['filter','hl','focus'].filter(key => {
                const value = rules && rules[key];
                return Array.isArray(value) ? value.length > 0 : Boolean(String(value || '').trim());
            }).length, 0)
            + Object.values(ui.columnFilters || {}).reduce((sum, columns) => sum + Object.values(columns || {}).filter(value => String(value || '').trim()).length, 0);
        const joins = Array.isArray(ui.enabledViews) ? ui.enabledViews.length : 0;
        const edits = Object.values(ui.cellEdits || {}).reduce((sum, rows) => sum + Object.values(rows || {}).reduce((rowSum, cols) => rowSum + Object.keys(cols || {}).length, 0), 0);
        el.textContent = `过滤 ${filterCount} · JOIN ${joins} · 修订 ${edits} · 状态 #${Store.revision}`;
        el.title = '状态 revision 用于识别查询结果是否需要重新计算';
    },

    renderActiveFilterChips() {
        const container = $('activeFilterChips');
        if(!container) return;
        if(typeof container.replaceChildren === 'function') container.replaceChildren();
        else container.innerHTML = '';
        const ui = Store.curr().ui;
        const add = (label, clear) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'filter-chip';
            button.title = `移除 ${label}`;
            button.textContent = `${label} ×`;
            button.onclick = clear;
            container.appendChild(button);
        };
        if(ui.globalFilter) add(`全局: ${ui.globalFilter}`, () => dispatch('filter:global', { value:'' }));
        Object.entries(ui.rules || {}).forEach(([table, rules]) => {
            ['filter','hl','focus'].forEach(field => {
                const value = rules && rules[field];
                const active = Array.isArray(value) ? value.length > 0 : Boolean(String(value || '').trim());
                if(active) add(`${table}.${field}: ${Array.isArray(value) ? value.join(', ') : value}`, () => dispatch('rule:set', { table, field, value:Array.isArray(value) ? [] : '' }));
            });
        });
        Object.entries(ui.columnFilters || {}).forEach(([table, columns]) => Object.entries(columns || {}).forEach(([column, value]) => {
            if(String(value || '').trim()) add(`${table}.${column}: ${value}`, () => dispatch('filter:column', { table, column, value:'' }));
        }));
        (Array.isArray(ui.enabledViews) ? ui.enabledViews : []).forEach(view => add(`JOIN: ${view}`, () => dispatch('ui:set', { key:'enabledViews', value:ui.enabledViews.filter(name => name !== view) })));
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
        const result = TableRegistry.getLastResult();
        this.sourceParseState = 'ready';
        const diagnostics = result.diagnostics || [];
        const rowCount = (result.tables || []).reduce((sum, table) => sum + (table.rows || []).length, 0);
        if(status) status.className = `parse-status ${result.format === 'error' ? 'error' : diagnostics.length ? 'warning' : result.tables && result.tables.length ? 'ready' : ''}`;
        if(text) {
            if(result.format === 'error') text.textContent = '解析失败，请检查输入格式';
            else if(result.tables && result.tables.length) text.textContent = `${result.label} · ${result.tables.length} 表 · ${rowCount.toLocaleString()} 行${diagnostics.length ? ` · ${diagnostics.length} 项提示` : ''}`;
            else if ($('rawInput') && $('rawInput').value.trim()) text.textContent = '未识别出表格 · 可尝试手动选择格式';
            else text.textContent = '等待输入数据';
        }
        if(details) details.classList.toggle('hidden', !(result.candidates && result.candidates.length) && diagnostics.length === 0);
        this.updatePasteSourceButton();
        this.updateWorkspaceSummary();
    },

    updatePasteSourceButton() {
        const button = $('pasteSourceBtn');
        if(!button) return;
        const text = $('rawInput') ? $('rawInput').value : '';
        const snapshot = SourceController.getCurrentPaste(text);
        if(snapshot) button.classList.remove('hidden');
        else button.classList.add('hidden');
        if(snapshot) {
            const count = (snapshot.types || []).length;
            button.title = `${snapshot.kind === 'file' ? '查看导入文件' : '查看粘贴源'} · ${count} 种剪贴板格式`;
        }
    },

    updateSourceParseState(state) {
        if (!state || state === 'ready') return;
        this.sourceParseState = state;
        const status = $('parseStatus');
        const text = $('parseStatusText');
        const details = $('diagnosticsBtn');
        if (status) status.className = 'parse-status warning';
        if (details) details.classList.add('hidden');
        if (!text) return;
        if (state === 'pending') text.textContent = '输入已修改 · 自动解析中…';
        else if (state === 'large') text.textContent = '数据较大 · 请点击“立即解析”';
        else text.textContent = '自动解析已关闭 · 点击“立即解析”';
    },

    syncImportControls() {
        const d = Store.curr();
        const formatSelect = $('formatSelect');
        const headerSelect = $('headerModeSelect');
        if(formatSelect) formatSelect.value = (d.ui && d.ui.importFormat) || 'auto';
        if(headerSelect) {
            headerSelect.value = (d.ui && d.ui.importHeaderMode) || 'auto';
            const manualFormat = formatSelect ? formatSelect.value : 'auto';
            const parsedFormat = TableRegistry.getLastResult() && TableRegistry.getLastResult().format;
            const isCli = ['cli-table-data', 'cli-multi-block'].includes(manualFormat) || (manualFormat === 'auto' && ['cli-table-data', 'cli-multi-block'].includes(parsedFormat));
            headerSelect.disabled = isCli;
        }
        const autoParseToggle = $('autoParseToggle');
        if (autoParseToggle) autoParseToggle.checked = d.ui.autoParse !== false;
        if (SourceController._syncControls) SourceController._syncControls();
    },

    setHeaderMode(mode) {
        const current = Store.curr().ui.importHeaderMode || 'auto';
        if(current !== mode) this.invalidateCellEdits();
        dispatch('import:setHeaderMode', { mode });
        this.run();
    },

    setImportFormat(format) {
        const next = format || 'auto';
        const current = Store.curr().ui.importFormat || 'auto';
        if(current !== next) this.invalidateCellEdits();
        dispatch('import:setFormat', { format: next });
        this.run();
    },

    setCopyFormat(format='default') {
        dispatch('ui:copyFormat', { format });
        this.syncCopyFormatControl();
        this.syncCopyHeaderControl();
        Toast.show(`复制格式：${ClipboardFormatter.label(Store.state.copyFormat)}`);
    },

    syncCopyFormatControl() {
        const format = Store.state.copyFormat || 'default';
        const el = $('copyFormatSelect');
        if(el) el.value = format;
        const label = $('copySettingsLabel');
        if(label) {
            const display = format === 'default' ? 'TSV' : ClipboardFormatter.label(format);
            label.textContent = `复制: ${display}`;
        }
    },

    syncCopyHeaderControl() {
        const el = $('copyHeadersToggle');
        if(!el) return;
        const format = Store.state.copyFormat || 'default';
        const isLua = format === 'lua-inline' || format === 'lua-expanded';
        const includeHeaders = isLua || Store.state.copyWithHeaders !== false;
        el.checked = includeHeaders;
        el.disabled = isLua;
        const row = el.closest ? el.closest('.copy-settings-row') : null;
        const hint = $('copyHeaderHint');
        if(row) {
            row.classList.toggle('is-disabled', isLua);
            row.title = isLua
                ? 'Lua 格式使用表头作为字段名，因此始终包含表头'
                : '复制选中区域时是否包含列名';
        }
        if(hint) hint.textContent = isLua ? 'Lua 字段名依赖表头' : '复制选中区域时包含列名';

        const trigger = $('copySettingsBtn');
        const dot = $('copyHeaderStateDot');
        const customized = !isLua && !includeHeaders;
        if(trigger) {
            trigger.classList.toggle('is-customized', customized);
            trigger.title = customized ? '复制设置：不含表头' : '复制设置';
        }
        if(dot) dot.classList.toggle('hidden', !customized);
    },

    getParseOptions() {
        const d = Store.curr();
        const text = $('rawInput').value;
        const last = SourceController.getCurrentPaste(text) || {};
        const html = last.html || '';
        const formatEl = $('formatSelect');
        const headerEl = $('headerModeSelect');
        const format = (formatEl && formatEl.value) || (d.ui && d.ui.importFormat) || 'auto';
        const headerMode = (headerEl && headerEl.value) || (d.ui && d.ui.importHeaderMode) || 'auto';
        return { html, format, headerMode };
    },

    showPasteSource() {
        const text = $('rawInput') ? $('rawInput').value : '';
        const snapshot = SourceController.getCurrentPaste(text);
        if(!snapshot) {
            Toast.show('当前没有与输入内容对应的粘贴源', true);
            this.updatePasteSourceButton();
            return;
        }
        const result = TableRegistry.getLastResult() || {};
        const usesHtml = Boolean(snapshot.html && snapshot.hasHtmlTable && result.format === 'html-table');
        const selectedType = usesHtml ? 'text/html' : snapshot.plain ? 'text/plain' : '未确定';
        const selectedLabel = usesHtml ? 'HTML 表格' : selectedType === 'text/plain' ? '纯文本' : '未确定';
        const sourceLabel = snapshot.kind === 'file'
            ? `文件导入${snapshot.fileName ? `：${this.escapeHtml(snapshot.fileName)}` : ''}`
            : '用户粘贴';
        const typeRows = (snapshot.types || []).map(type => `<span class="clipboard-type">${this.escapeHtml(type)}</span>`).join('');
        const itemRows = (snapshot.items || []).map(item => `<div class="muted">项目：${this.escapeHtml(item.kind || '未知')} · ${this.escapeHtml(item.type || '未声明类型')}</div>`).join('');
        const fileRows = (snapshot.files || []).map(file => `<div class="muted">文件：${this.escapeHtml(file.name || '(未命名)')} · ${this.escapeHtml(file.type || '未知类型')} · ${Number(file.size || 0).toLocaleString()} 字节</div>`).join('');
        const formats = (snapshot.formats || []).map(format => {
            const label = format.type === 'text/plain' ? '纯文本' : format.type === 'text/html' ? 'HTML' : format.type === 'text/rtf' ? 'RTF' : format.type;
            const note = `${Number(format.length || 0).toLocaleString()} 字符${format.truncated ? ' · 仅显示前 200,000 字符' : ''}`;
            const preview = format.preview ? this.escapeHtml(format.preview) : '(空内容)';
            return `<section class="clipboard-format-block"><div class="clipboard-format-title"><strong>${this.escapeHtml(label)}</strong><span class="muted">${this.escapeHtml(format.type)} · ${note}</span></div><pre class="clipboard-source-preview">${preview}</pre></section>`;
        }).join('');
        const meta = `<div class="clipboard-source-meta"><div><strong>来源：</strong>${sourceLabel}</div><div><strong>实际解析：</strong>${this.escapeHtml(selectedLabel)} <span class="muted">(${this.escapeHtml(selectedType)})</span></div><div><strong>HTML 表格：</strong>${snapshot.hasHtmlTable ? '是' : '否'}</div><div><strong>可用格式：</strong>${typeRows || '<span class="muted">未声明</span>'}</div>${itemRows}${fileRows}</div>`;
        this.modal('粘贴源诊断', `${meta}<div class="clipboard-source-warning">原始内容仅以代码文本显示，不会执行其中的 HTML、脚本或其他格式。</div><div class="clipboard-source-formats">${formats || '<div class="muted">没有可显示的文本格式内容</div>'}</div>`);
    },


    getExportPrefix(kind) { return ExportController._getPrefix(kind); },

    getEnabledJoinTables(full) { return ExportController._getEnabledJoinTables(full); },
    projectTableForExport(table, shownOnly) { return ExportController._projectTableForExport(table, shownOnly); },

    getFullExportTables() { return ExportController._getFullExportTables(); },

    getPreviewProcessedTables() { return ExportController._getPreviewProcessedTables(); },

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
            dispatch('ui:set', { key:'sidebarTab', value:next });
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
        const doParse = () => {
            SourceController.clearAutoParse();
            this.run();
        };
        const doClear = () => {
            SourceController.clearAutoParse();
            $('rawInput').value='';
            SourceController.clearLastPaste();
            dispatch('source:replace', { text:'' });
            this.run();
        };
        $('parseBtn').onclick = doParse;
        $('clearBtn').onclick = doClear;
        const pasteSourceBtn = $('pasteSourceBtn');
        if(pasteSourceBtn) pasteSourceBtn.onclick = () => this.showPasteSource();
        const formatSelect = $('formatSelect');
        if(formatSelect) formatSelect.onchange = e => this.setImportFormat(e.target.value);
        const headerModeSelect = $('headerModeSelect');
        if(headerModeSelect) headerModeSelect.onchange = e => this.setHeaderMode(e.target.value);
        const autoParseToggle = $('autoParseToggle');
        if (autoParseToggle) autoParseToggle.onchange = e => {
            const enabled = e.target.checked;
            dispatch('ui:autoParse', { enabled });
            SourceController.clearAutoParse();
            if (enabled) SourceController.scheduleAutoParse({ text: $('rawInput').value });
            else this.updateSourceParseState('manual');
        };
        
        const loadSample = () => {
            SourceController.clearAutoParse();
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
            if(subK) {
                if(k==='rules') {
                    const tbl=$('targetTableSelect').value;
                    if(tbl) dispatch('rule:set', { table:tbl, field:subK, value:val });
                } else dispatch('ui:set', { key:k, value:val });
            } else dispatch('ui:set', { key:k, value:val });
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
            if(t) dispatch('rule:set', { table:t, field:'focus', value:e.target.value.split(',').filter(s=>s.trim()) });
        };

        $('tablesTrigger').onclick = () => this.modTables();
        $('viewsTrigger').onclick = () => this.modViews();
        // FIX: Correctly call JoinEditor.modManageViews
        $('manageViewsBtn').onclick = e => { e.stopPropagation(); JoinEditor.modManageViews(); };
        $('selectColsBtn').onclick = () => this.modCols();
        $('themeBtn').onclick = () => dispatch('ui:theme');
        if($('helpBtn')) $('helpBtn').onclick = () => this.showHelp();
        if($('undoEditBtn')) $('undoEditBtn').onclick = () => CellEditController.undo();
        if($('redoEditBtn')) $('redoEditBtn').onclick = () => CellEditController.redo();
        if($('pageSizeSelect')) $('pageSizeSelect').onchange = e => {
            const ui = Store.curr().ui;
            dispatch('ui:set', { key:'pageSize', value:Number(e.target.value) || 100 });
            dispatch('ui:set', { key:'tablePages', value:{} });
        };
        if($('previewTableSelect')) $('previewTableSelect').onchange = e => {
            const ui = Store.curr().ui;
            const previewTable = e.target.value || '';
            const tablePages = Object.assign({}, ui.tablePages || {});
            if(previewTable) tablePages[previewTable] = 1;
            dispatch('ui:set', { key:'previewTable', value:previewTable });
            dispatch('ui:set', { key:'tablePages', value:tablePages });
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

        // Keyboard shortcuts — delegated to KeyboardController
        KeyboardController.init(this);

        // Register ViewManager edit callback (ViewManager → JoinEditor)
        ViewManager.setEditCallback((idx) => JoinEditor.open(idx));


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
        this.syncCopyHeaderControl();
        this.updatePasteSourceButton();
        this.run(false);
        this.renderPreview();
        this.updateStorageStatus();
    },

    applyStoredCellEdits() {
        const edits = Store.curr().ui.cellEdits || {};
        TableRegistry.getRaw().forEach(table => {
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
        const result = TableRegistry.getLastResult();
        const candidates = (result.candidates || []).map(item => {
            const score = Number.isFinite(item.score) ? `识别分数 ${Math.round(item.score * 100)}%` : '';
            const reason = item.reason || item.explanation || '依据解析器特征进行判断';
            const ambiguous = item.ambiguous || (item.risk && item.risk !== 'low');
            return `<div class="diagnostic-item" style="display:flex;align-items:center;gap:10px;"><div style="flex:1;"><strong>${this.escapeHtml(item.label)}</strong><span class="muted">${item.manual ? '用户指定' : score}${ambiguous ? ' · 需确认' : ''}</span><div class="muted">${this.escapeHtml(reason)}</div></div>${item.id !== result.format ? `<button class="sm diagnostic-format-btn" type="button" data-format="${this.escapeHtml(item.id)}">切换</button>` : '<span class="meta-tag">当前</span>'}</div>`;
        }).join('');
        const diagnostics = (result.diagnostics || []).map(item => `<div class="diagnostic-item"><strong>${this.escapeHtml(item.code || item.severity || item.level || '提示')}</strong><span>${this.escapeHtml(item.message || '')}</span></div>`).join('');
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
            SourceController.clearAutoParse();
            const started = performance.now();
            const sourceText = $('rawInput').value;
            if(sourceText.length * 2 > MAX_IMPORT_BYTES) throw new Error('数据源超过 25 MB 安全限制，请拆分后再分析');
            if(Store.curr().raw !== sourceText) dispatch('source:replace', { text:sourceText });
            const result = Parser.parse(sourceText, this.getParseOptions());
            TableRegistry.setResult(result);
            Store.lastSuccessfulFormat = result.format;  // remember for faster future parses
            CellEditController.setRawTables(result.tables);
            this.applyStoredCellEdits();
            this.updateImportSummary();
            const elapsed = Math.round(performance.now() - started);
            dispatch('parse:completed', {
                docId:Store.state.activeId,
                sourceRevision:Store.curr().sourceRevision,
                format:result.format,
                tables: result.tables,
                elapsed: elapsed,
            });
            if(render) {
                this.updSelects();
                this.updChips();
                this.requestRender();
            }
            if(TableRegistry.getRaw().length && elapsed > 800) Toast.show(`解析完成 · ${elapsed} ms`);
        } catch(e) {
            console.error(e);
            const msg = e.message || String(e);
            TableRegistry.setResult({
                tables: [],
                format: 'error',
                label: '解析失败',
                diagnostics: [{ severity: 'error', code: 'PARSE_ERROR', message: msg }],
                candidates: [],
            });
            CellEditController.setRawTables([]);
            this.updateImportSummary();
            this.updSelects();
            this.updChips();
            this.renderPreview();
            // Map common errors to user-friendly Chinese messages
            const friendly =
                /超过.*25.*MB|MAX_IMPORT/i.test(msg)   ? '数据过大，请将输入控制在 25 MB 以内' :
                /quota|storage.*full/i.test(msg)        ? '浏览器存储空间不足；当前数据仍在内存中，请立即备份工作区' :
                /Unexpected.*token|JSON.*parse/i.test(msg) ? '数据格式无法识别，请尝试手动选择格式' :
                /URI.*malformed/i.test(msg)             ? '文件名包含不支持字符' :
                '';
            Toast.show(friendly || `解析失败：${msg}`, true);
        }
    },

    updSelects() {
        const s = $('targetTableSelect');
        const old = s.value; s.innerHTML = '';
        TableRegistry.getRaw().forEach(t => s.add(new Option(t.name, t.name)));
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
        const tableNames = TableRegistry.getRaw().map(t => t.name);
        const tsRaw = ui.displayTables;
        const ts = (tsRaw===null || tsRaw===undefined) ? null : (tsRaw || []).filter(n => tableNames.includes(n));
        $('tablesTrigger').innerHTML = (ts===null) ? `<span class="chip" style="background:var(--bg-hover); color:var(--text-secondary); border-color:transparent;">默认全显</span>` : (ts.length ? ts.map(n=>`<span class="chip">${this.escapeHtml(n)}</span>`).join('') : `<span class="placeholder">无</span>`);
        const viewNames = Store.state.globalViews.map(v => v.view);
        const vsRaw = ui.enabledViews || [];
        const vs = vsRaw.filter(v => viewNames.includes(v));
        if(vs.length !== vsRaw.length) dispatch('ui:set', { key:'enabledViews', value:vs });
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
        if(!TableRegistry.getRaw().length) { 
            div.innerHTML = `<div class="empty">
                <div class="empty-visual" aria-hidden="true">${'<span></span>'.repeat(9)}</div>
                <div style="font-weight:800; color:var(--text-strong);">把杂乱数据变成可分析表格</div>
                <div class="muted">在左侧粘贴、拖放或选择文件，然后点击“解析数据”</div>
                <button class="tonal" type="button" onclick="document.getElementById('sampleLink').click()">加载示例数据</button>
            </div>`; 
            return; 
        }
        
        const ui = Store.curr().ui;
        const processedTables = this.getPreviewProcessedTables();
        const combined = processedTables.map(({ table }) => table);
        if(!combined.length) {
            div.innerHTML = `<div class="empty">
                <div class="empty-visual" aria-hidden="true">${'<span></span>'.repeat(9)}</div>
                <div style="font-weight:700;">当前筛选下无可见表</div>
                <div class="muted">检查“显示原始表 / JOIN 视图”的选择</div>
            </div>`;
            return;
        }

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
            const tablePages = Object.assign({}, ui.tablePages || {});
            if(tablePages[t.name] !== page) {
                tablePages[t.name] = page;
                dispatch('ui:set', { key:'tablePages', value:tablePages });
            }
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

    modTables() { ModalController.showTableSelector(TableRegistry.getRaw().map(t => t.name), Store.curr().ui.displayTables); },
    modViews() { ModalController.showViewSelector(Store.state.globalViews, Store.curr().ui.enabledViews || []); },
    
    modCols() {
        const tName = $('targetTableSelect').value;
        if (!tName) return;
        let all = [];
        const rawTable = TableRegistry.getRaw().find(x => x.name === tName);
        if (rawTable) { all = rawTable.headers; }
        else if (tName.startsWith('JOIN:')) {
            const vName = tName.replace('JOIN:', '');
            const vCfg = Store.state.globalViews.find(v => v.view === vName);
            if (vCfg) { const res = Joiner.run(TableRegistry.getRaw(), vCfg, Store.state.globalViews); if (res) all = res.headers; }
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
