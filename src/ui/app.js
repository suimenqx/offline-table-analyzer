OTA.define('app', ["runtime","exporter","store","joiner","join-editor","clipboard","selection","filter-engine","table-builder","source-controller","cell-edit-controller","filter-controller","modal-controller","tab-controller","export-controller","dispatch","table-registry","keyboard-controller","view-manager","query-service","background-service","table-utils","extraction-session"], ({$, createEl, escapeHtml, formatBytes, Tooltip, Toast}, {Exporter}, {APP_VERSION, WORKSPACE_SCHEMA_VERSION, COPY_FORMATS, Store}, {Joiner}, {JoinEditor}, {ClipboardFormatter}, {Select}, {FilterEngine}, {TableBuilder}, {SourceController}, {CellEditController}, {FilterController}, {ModalController}, {TabController}, {ExportController}, {dispatch}, {TableRegistry}, {KeyboardController}, {ViewManager}, {QueryService}, {BackgroundService}, {TableUtils}, {ExtractionSession}) => {
/* Main App */
const App = {
    raw: [], rendered: [],
    sourceParseState: 'ready',
    tabDrag: { sourceId:null },
    _renderQueued: false,
    _renderPending: false,
    _renderGeneration:0,
    _jobGeneration:0,
    _regionSelection:null,
    _headerModeConfirmation:null,
    _diagnosticsRequest:0,
    showJob(label) {
        const id=++this._jobGeneration;
        const status=$('backgroundJob');if(status)status.hidden=false;
        if($('backgroundJobText'))$('backgroundJobText').textContent=label;
        return id;
    },
    finishJob(id) {if(id===this._jobGeneration && $('backgroundJob'))$('backgroundJob').hidden=true;},
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
        if(!Store.state.projects.some(p => p.id === id)) return false;
        if(!force && Store.state.activeProjectId === id) return false;
        const input = $('rawInput');
        if(input) dispatch('source:replace', { text:SourceController.readText(input) });
        return dispatch('project:activate', { id, force });
    },
    /** 选中卡片（左侧面板显示其内容，解析作用于它） */
    activateCard(id, force=false) {
        if(!id) return false;
        const project = Store.state.projects.find(p => p.cardIds.includes(id));
        if(!project) return false;
        if(!force && project.activeCardId === id) return false;
        const input = $('rawInput');
        if(input) dispatch('source:replace', { text:SourceController.readText(input) });
        return dispatch('card:activate', { id });
    },
    /** 卡片显隐（范围控制）：表池成员随显隐变化 */
    toggleCardVisible(id) {
        const card = Store.getCard(id);
        if(!card) return false;
        return dispatch('card:visible', { id, visible: card.visible === false });
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
                case 'project:created':
                case 'project:duplicated':
                case 'project:activated':
                    this.renderTabs();
                    this.loadDoc();
                    break;
                case 'project:removed':
                    for(const id of payload?.cardIds || []) BackgroundService.removeCard(id).catch(error => Toast.show(`卡片数据释放失败：${error.message}`, true));
                    this.renderTabs();
                    if (payload && payload.activeChanged) {
                        this.loadDoc();
                        const tab = Array.from(document.querySelectorAll('.doc-tab')).find(el => el.dataset.id === Store.getState().activeProjectId);
                        (tab || $('addTabBtn'))?.focus();
                    }
                    break;
                case 'project:reordered':
                    this.renderTabs();
                    break;
                case 'project:renamed':
                    this.renderTabs();
                    SourceController.renderCards();
                    this.requestRender();
                    break;
                case 'card:created':
                case 'card:duplicated':
                    // 新卡自动选中，并把键盘粘贴落点移到它的原文框。
                    SourceController.renderCards();
                    this.loadDoc();
                    $('rawInput')?.focus();
                    this.requestRender();
                    break;
                case 'card:removed':
                    if(Store.getCard(payload.id)) break;
                    BackgroundService.removeCard(payload.id).catch(error => Toast.show(`卡片数据释放失败：${error.message}`, true));
                    QueryService.clearCache();
                    if(payload.activeChanged) {
                        this.loadDoc();
                        if(!SourceController.focusCard(Store.getDocument()?.id)) {
                            const search = $('cardSearchRow');
                            (search && !search.hidden ? $('cardSearchInput') : $('addCardBtn'))?.focus();
                        }
                    } else {
                        SourceController.renderCards();
                        this.requestRender();
                    }
                    break;
                case 'card:undoChanged':
                    SourceController.renderCards();
                    break;
                case 'card:restored':
                    this.renderTabs();
                    SourceController.renderCards();
                    QueryService.clearCache();
                    // Finish any queued release before rebuilding this restored source.
                    BackgroundService.removeCard(payload.id).then(() => {
                        if(Store.getDocument()?.id !== payload.id) return;
                        this.loadDoc();
                        SourceController.focusCard(payload.id);
                    }).catch(error => Toast.show(`恢复卡片解析失败：${error.message}；完整原文仍保留`, true));
                    break;
                case 'card:renamed':
                case 'card:reordered':
                    SourceController.renderCards();
                    this.requestRender();
                    break;
                case 'card:visibilityChanged':
                    // 表池成员变化：显隐既改卡片区，也改 view 引用可用性标记与查询结果
                    SourceController.renderCards();
                    this.updChips();
                    this.requestRender();
                    break;
                case 'card:activated':
                    SourceController.renderCards();
                    this.loadDoc();
                    break;
                case 'source:textChanged':
                    SourceController.renderCards();
                    if (!payload || payload.docId === Store.getDocument()?.id) {
                        if(payload && payload.sourceRevision!==Store.getDocument()?.sourceRevision)break;
                        // A queued notification may describe a source already parsed and confirmed.
                        const source=Store.getDocument();
                        for(const key of ['_regionSelection','_headerModeConfirmation']) {
                            const choice=this[key];
                            if(choice && (choice.docId!==source?.id || choice.sourceRevision!==source?.sourceRevision || choice.text!==source?.raw)) this[key]=null;
                        }
                        if(this._getExtractionSession().invalidate({ifChanged:true})) {
                            // 作业级取消 + 只作废该卡的数据集（其他卡的数据不受影响）
                            if(payload && payload.docId) BackgroundService.removeCard(payload.docId);
                            TableRegistry.setResult(null);this.requestRender();
                        }
                        CellEditController.reset();
                        // Paste lifetime follows the source text, not the transition that
                        // happened to deliver it. Option toggles do not emit this event;
                        // any source event keeps the snapshot only while text still matches.
                        const text = payload && typeof payload.text === 'string' ? payload.text : '';
                        const keepPaste = Boolean(SourceController.getCurrentPaste(text));
                        if(!keepPaste) SourceController.clearLastPaste();
                        this.updatePasteSourceButton();
                        this.updateWorkspaceSummary();
                    }
                    break;
                case 'parse:stale':
                    Toast.show('解析结果已过期，请重新解析当前数据源', true);
                    break;
                case 'ui:changed':
                    SourceController.renderCards();
                    if (!payload || payload.replaced || ['globalFilter','columnFilters','rules','displayTables','enabledViews','previewModes','pageSize','previewTable','tablePages'].includes(payload.key)) this.requestRender();
                    this.updateWorkspaceSummary();
                    break;
                case 'views:changed':
                    this.updSelects();
                    this.updChips();
                    this.requestRender();
                    break;
                case 'parse:completed':
                    SourceController.renderCards();
                    this.updSelects();
                    this.updChips();
                    this.requestRender();
                    if (payload && payload.format !== 'error' && payload.elapsed > 800) {
                        Toast.show(`\u89e3\u6790\u5b8c\u6210 \u00b7 ${payload.elapsed} ms`);
                    }
                    break;
                case 'filter:changed':
                    this.requestRender();
                    break;
                case 'preview:changed':
                case 'cell:edited':
                case 'preview:renderRequested':
                    this.requestRender();
                    break;
                case 'workspace:saved':
                    this.updateStorageStatus(payload || {});
                    break;
                case 'workspace:restored':
                    this.renderTabs();this.loadDoc();
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
            document.addEventListener('ota:cardDiagnosticsRequested', event => { this.showCardDiagnostics(event.detail?.id); });
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
                this.requestRender();
            });
            document.addEventListener('ota:backgroundJob',e=>{
                if(e.detail.busy)this._exportJob=this.showJob(e.detail.label);
                else this.finishJob(this._exportJob);
            });
        }

        // --- Init sub-controllers ---
        SourceController.init();
        CellEditController.init();
        FilterController.init();
        ModalController.init();
        TabController.init();
        ExportController.init({prepareSource:()=>this.prepareExport()});

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
        const ui = Store.getActiveUI();
        return (ui.previewModes && ui.previewModes[tableName]) === 'row-header' ? 'row-header' : 'column-header';
    },

    setTablePreviewMode(tableName, mode) {
        const ui = Store.getActiveUI();
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
        const ui = Store.getActiveUI();
        const selected = tables.some(table => table.name === ui.previewTable) ? ui.previewTable : tables[0].name;
        if(ui.previewTable !== selected) dispatch('ui:set', { key:'previewTable', value:selected });
        tables.forEach(table => {
            const option = document.createElement('option');
            const rowCount = TableUtils.rowCount(table);
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
        const project = Store.getActiveProject();
        if(title) title.textContent = project ? `${project.title} · 表池` : '工作区为空';
        const cards = (project?.cardIds || []).map(id => Store.getCard(id)).filter(Boolean);
        const visibleCount = cards.filter(card => card.visible !== false).length;
        const preview = TableRegistry.getPreviewSummary();
        if(summary) {
            summary.textContent = `显示 ${visibleCount}/${cards.length} 张卡片 · ` + (preview
                ? `${preview.tableCount} 表 · ${preview.rowCount.toLocaleString()} 行`
                : '等待解析或更新结果');
            summary.title = `${summary.textContent}。统计当前筛选结果的全部记录，包含启用的 JOIN 视图。`;
        }
        this.updateAnalysisState();
        this.renderActiveFilterChips();
    },

    updateAnalysisState() {
        const el = $('analysisState');
        if(!el) return;
        const ui = Store.getActiveUI();
        const filterCount = (ui.globalFilter ? 1 : 0)
            + Object.values(ui.rules || {}).reduce((sum, rules) => sum + ['filter','hl','focus'].filter(key => {
                const value = rules && rules[key];
                return Array.isArray(value) ? value.length > 0 : Boolean(String(value || '').trim());
            }).length, 0)
            + Object.values(ui.columnFilters || {}).reduce((sum, columns) => sum + Object.values(columns || {}).filter(value => String(value || '').trim()).length, 0);
        const joins = Array.isArray(Store.getEnabledViews()) ? Store.getEnabledViews().length : 0;
        const edits = Object.values(ui.cellEdits || {}).reduce((sum, rows) => sum + Object.values(rows || {}).reduce((rowSum, cols) => rowSum + Object.keys(cols || {}).length, 0), 0);
        el.textContent = `过滤 ${filterCount} · JOIN ${joins} · 修订 ${edits} · 状态 #${Store.revision}`;
        el.title = '状态 revision 用于识别查询结果是否需要重新计算';
    },

    renderActiveFilterChips() {
        const container = $('activeFilterChips');
        if(!container) return;
        if(typeof container.replaceChildren === 'function') container.replaceChildren();
        else container.innerHTML = '';
        const ui = Store.getActiveUI();
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
        (Array.isArray(Store.getEnabledViews()) ? Store.getEnabledViews() : []).forEach(view => add(`JOIN: ${view}`, () => dispatch('view:setEnabled', { enabledViews:Store.getEnabledViews().filter(name => name !== view) })));
    },

    updateStorageStatus(detail={}) {
        const shell=document.querySelector('.app-shell');if(shell)shell.inert=Store.restoring;
        const el = $('storageStatus');
        if(!el) return;
        const ok = detail.ok !== false && !Store.lastSaveError;
        const bytes = Number(detail.bytes ?? Store.storageBytes) || 0;
        if(Store.restoring || Store.saving || Store.cleaning){el.textContent=Store.restoring?'正在恢复完整原文…':Store.cleaning?'正在清理旧原文…':'正在保存完整原文…';return;}
        const message = ok && Store.state.persistRaw === false ? '原文仅保留在当前页面 · 规则已保存' : detail.message || (ok
            ? `已保存 · ${this.formatBytes(bytes)}`
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
        const issues = diagnostics.filter(item => (item.severity || item.level) !== 'info');
        const needsConfirmation = result.format === 'ambiguous';
        const failed = result.format === 'error';
        const unrecognized = Store.getDocument() && SourceController.readText().trim() && !result.tables?.length && !needsConfirmation && !failed;
        const attention = Boolean(Store.getDocument() && (needsConfirmation || failed || unrecognized || issues.length || result.diagnosticCount > diagnostics.length));
        if(status) {
            status.className = `parse-status ${needsConfirmation ? 'confirm' : failed ? 'error' : 'warning'}`;
            status.hidden = !attention;
        }
        if(text) {
            text.textContent = failed ? '解析失败' : needsConfirmation ? '需要确认解析方式' : unrecognized ? '未识别表格，可手动选择格式'
                : diagnostics.length ? `${result.diagnosticCount ?? diagnostics.length} 项解析提示` : '';
        }
        if(details) {
            details.textContent = needsConfirmation && result.candidates?.length ? '确认候选' : failed ? '查看错误' : '查看详情';
            details.classList.toggle('hidden', !attention);
        }
        const sourceDetails = $('sourceDiagnosticsBtn');
        if(sourceDetails) sourceDetails.disabled = !Store.getDocument() || !result.format || result.format === 'empty';
        this.updatePasteSourceButton();
        this.updateWorkspaceSummary();
    },

    updatePasteSourceButton() {
        const button = $('pasteSourceBtn');
        if(!button) return;
        const text = $('rawInput') ? SourceController.readText() : '';
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
        if (status) {
            status.className = 'parse-status pending';
            status.hidden = state === 'manual' || !Store.getDocument() || !SourceController.readText().trim();
        }
        if (details) details.classList.add('hidden');
        if ($('sourceDiagnosticsBtn')) $('sourceDiagnosticsBtn').disabled = true;
        if (!text) return;
        text.textContent = state === 'pending' ? '等待解析' : state === 'large' ? '数据较大，请手动解析' : '';
    },

    syncImportControls() {
        const ui = Store.getActiveUI();
        const formatSelect = $('formatSelect');
        const headerSelect = $('headerModeSelect');
        if(formatSelect) formatSelect.value = ui.importFormat || 'auto';
        if(headerSelect) {
            headerSelect.value = ui.importHeaderMode || 'auto';
            const manualFormat = formatSelect ? formatSelect.value : 'auto';
            const parsedFormat = TableRegistry.getLastResult() && TableRegistry.getLastResult().format;
            const isCli = ['cli-table-data', 'cli-multi-block'].includes(manualFormat) || (manualFormat === 'auto' && ['cli-table-data', 'cli-multi-block'].includes(parsedFormat));
            headerSelect.disabled = !Store.getDocument() || isCli;
        }
        const autoParseToggle = $('autoParseToggle');
        if (autoParseToggle) autoParseToggle.checked = ui.autoParse !== false;
        if (SourceController._syncControls) SourceController._syncControls();
    },

    setHeaderMode(mode) {
        if(!Store.getDocument()) return false;
        this._headerModeConfirmation=null;
        const current = Store.getActiveUI().importHeaderMode || 'auto';
        if(current !== mode) this.invalidateCellEdits();
        dispatch('import:setHeaderMode', { mode });
        this.syncImportControls();
        this.run();
    },

    setImportFormat(format) {
        if(!Store.getDocument()) return false;
        this._regionSelection=null;
        this._headerModeConfirmation=null;
        const next = format || 'auto';
        const current = Store.curr().ui.importFormat || 'auto';
        if(current !== next) this.invalidateCellEdits();
        dispatch('import:setFormat', { format: next });
        this.syncImportControls();
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
        if(el) el.value = format === 'json' ? 'json-expanded' : format;
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
        const needsHeaders = ClipboardFormatter.isRecordFormat(format);
        const includeHeaders = needsHeaders || Store.state.copyWithHeaders !== false;
        el.checked = includeHeaders;
        el.disabled = needsHeaders;
        const row = el.closest ? el.closest('.copy-settings-row') : null;
        const hint = $('copyHeaderHint');
        if(row) {
            row.classList.toggle('is-disabled', needsHeaders);
            row.title = needsHeaders
                ? 'JSON 和 Lua 格式使用表头作为字段名，因此始终包含表头'
                : '复制选中区域时是否包含列名';
        }
        if(hint) hint.textContent = needsHeaders ? '字段名依赖表头' : '复制选中区域时包含列名';

        const trigger = $('copySettingsBtn');
        const dot = $('copyHeaderStateDot');
        const customized = !needsHeaders && !includeHeaders;
        if(trigger) {
            trigger.classList.toggle('is-customized', customized);
            trigger.title = customized ? '复制设置：不含表头' : '复制设置';
        }
        if(dot) dot.classList.toggle('hidden', !customized);
    },

    getParseOptions() {
        const d = Store.getDocument();
        const ui = Store.getActiveUI();
        const text = SourceController.readText();
        const last = SourceController.getCurrentPaste(text) || {};
        const html = last.html || '';
        const formatEl = $('formatSelect');
        const headerEl = $('headerModeSelect');
        const format = (formatEl && formatEl.value) || ui.importFormat || 'auto';
        const storedHeaderMode=(headerEl && headerEl.value) || ui.importHeaderMode || 'auto';
        const confirmation=this._headerModeConfirmation;
        const confirmationMatches=d && confirmation && confirmation.docId===d.id && confirmation.sourceRevision===d.sourceRevision && confirmation.text===text;
        const headerMode=confirmationMatches?confirmation.mode:storedHeaderMode;
        const selectedRegion=this._regionSelection;
        const regionSelection=d && selectedRegion && selectedRegion.docId===d.id && selectedRegion.sourceRevision===d.sourceRevision && selectedRegion.text===text
            ? selectedRegion.selection
            : null;
        return { html, format, headerMode, regionSelection };
    },

    getSourceContext(text=SourceController.readText()) {
        const doc=Store.getDocument();
        if(!doc) return null;
        return {docId:doc.id,sourceRevision:doc.sourceRevision,text,options:this.getParseOptions(),
            config:{format:doc.ui.importFormat || 'auto', headerMode:doc.ui.importHeaderMode || 'auto'}};
    },

    /** Resolve the current parse and return a validator for the eventual download. */
    async prepareExport() {
        if(!Store.getDocument()) { Toast.show('请先新增卡片并导入数据', true); return null; }
        const requestedId=Store.getDocument().id;
        // An empty or excluded editor must not block other participating sources.
        const canUseOtherSources=()=>TableRegistry.isBackground()
            && (!Store.getDocument()?.raw || Store.getDocument()?.visible === false)
            && TableRegistry.getBackgroundInput().cards.some(card=>card.id!==requestedId);
        const extraction=await this._extractSource({reuse:true});
        if(!extraction) return null;
        extraction.validate();
        if(!extraction.ok && !(extraction.failed && canUseOtherSources())) return null;
        const noVisibleTables = TableRegistry.isBackground() ? !TableRegistry.getBackgroundInput().cards.length : !TableRegistry.getQueryTables().length;
        if(noVisibleTables || (!TableRegistry.getRaw().length && !canUseOtherSources())){
            if(TableRegistry.getFormat()==='ambiguous')Toast.show('请先在解析详情中确认格式、表格区域或表头',true);
            else Toast.show('无数据可导出',true);
            return null;
        }
        return {validate:extraction.validate}; // Rechecked immediately before download.
    },

    showPasteSource() {
        const text = $('rawInput') ? SourceController.readText() : '';
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


    getPreviewProcessedTables() {
        const doc = Store.curr();
        return QueryService.getPreview({
            rawTables: TableRegistry.getQueryTables(),
            globalViews: Store.getViews(),
            ui: Store.getActiveUI(),
            docId: doc?.id,
            sourceRevision: doc?.sourceRevision,
            stateRevision: Store.revision,
            viewRevision: Store.viewRevision,
            queryRevision: Store.queryRevision,
        }).tables;
    },

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
        if($('persistRawToggle'))$('persistRawToggle').onchange=e=>dispatch('ui:persistRaw',{enabled:e.target.checked});
        if($('cancelJobBtn'))$('cancelJobBtn').onclick=()=>{
            this._getExtractionSession().cancel();this._renderGeneration++;
            if($('backgroundJob'))$('backgroundJob').hidden=true;
            if($('previewArea'))$('previewArea').setAttribute('aria-busy','false');
            Toast.show('操作已取消，完整原文仍保留');
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
        this.applySidebarTab(Store.getActiveUI().sidebarTab || 'data', false);
    },

    bindAccordions() {
        document.querySelectorAll('.acc-head').forEach(head => {
            head.onclick = () => {
                const item = head.parentElement;
                item.classList.toggle('open');
                head.setAttribute('aria-expanded', String(item.classList.contains('open')));
            };
        });
    },

    /** Native disclosures keep ordinary buttons and tab navigation; close before an
     * action runs so dialogs restore focus to a visible summary, not a hidden item. */
    bindToolMenus() {
        const menus = Array.from(document.querySelectorAll('details[data-menu]'));
        const close = (menu, restore=false) => {
            if(!menu.open) return;
            menu.open = false;
            if(restore) menu.querySelector('summary')?.focus();
        };
        for(const menu of menus) {
            menu.addEventListener('click', event => {
                if(event.target.closest('button')) close(menu, true);
            }, true);
            menu.addEventListener('keydown', event => {
                if(event.key === 'Escape' && menu.open) {
                    event.preventDefault(); event.stopPropagation(); close(menu, true);
                }
            });
            menu.addEventListener('toggle', () => {
                if(menu.open) for(const other of menus) if(other !== menu) close(other);
            });
        }
        document.addEventListener('click', event => {
            for(const menu of menus) if(!menu.contains(event.target)) close(menu);
        });
        document.addEventListener('focusin', event => {
            for(const menu of menus) if(!menu.contains(event.target)) close(menu);
        });
    },

    bind() {
        this.bindToolMenus();
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
            SourceController.displayText('');
            SourceController.clearLastPaste();
            dispatch('source:replace', { text:'' });
            this.run();
        };
        $('parseBtn').onclick = doParse;
        $('clearBtn').onclick = doClear;
        const pasteSourceBtn = $('pasteSourceBtn');
        if(pasteSourceBtn) pasteSourceBtn.onclick = () => this.showPasteSource();
        const diagnosticsBtn = $('diagnosticsBtn');
        if(diagnosticsBtn) diagnosticsBtn.onclick = () => this.showDiagnostics();
        if($('sourceDiagnosticsBtn')) $('sourceDiagnosticsBtn').onclick = () => this.showDiagnostics();
        if($('ruleHelpBtn')) $('ruleHelpBtn').onclick = () => this.showRuleHelp();
        const formatSelect = $('formatSelect');
        if(formatSelect) formatSelect.onchange = e => this.setImportFormat(e.target.value);
        const headerModeSelect = $('headerModeSelect');
        if(headerModeSelect) headerModeSelect.onchange = e => this.setHeaderMode(e.target.value);
        const autoParseToggle = $('autoParseToggle');
        if (autoParseToggle) autoParseToggle.onchange = e => {
            const enabled = e.target.checked;
            dispatch('ui:autoParse', { enabled });
            SourceController.clearAutoParse();
            if (enabled) SourceController.scheduleAutoParse({ text: SourceController.readText() });
            else this.updateSourceParseState('manual');
        };
        
        const loadSample = () => {
            SourceController.clearAutoParse();
            this.invalidateCellEdits();
            SourceController.displayText(`table-data Inventory
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
 1        10:15:01  INFO    Retry connection...     0x00`);
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
        if($('clearLocalDataBtn')) $('clearLocalDataBtn').onclick = async () => {
            if(!confirm('确定清除本浏览器中保存的全部工作区数据？建议先备份工作区。')) return;
            if(await dispatch('workspace:clearLocal')) {
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
        window.addEventListener('beforeunload',event=>{
            if(Store.cleaning || (Store.getState().persistRaw!==false && (Store.saveTimer || Store.saving))) {
                event.preventDefault();event.returnValue='';
            }
        });

        // Register ViewManager edit callback (ViewManager → JoinEditor)
        ViewManager.setEditCallback((idx) => JoinEditor.open(idx));


    },

    loadDoc() {
        const d = Store.getDocument();
        const ui = Store.getActiveUI();
        SourceController.resetPendingInput();
        SourceController.clearLastPaste();
        CellEditController.reset();
        SourceController.displayText(d?.raw || '');
        // 没有选中卡片时保留空状态，禁止编辑/解析旧内容；新增与备份恢复仍可用。
        for(const id of ['rawInput','parseBtn','clearBtn','importSourceBtn','sourceFileInput','formatSelect','headerModeSelect','autoParseToggle','exportSourceBtn','exportRawBtn','exportFullBtn','exportPrevBtn','sampleLink','sampleBtn','globalFilter','hlInput','filterInput','focusColsInput','targetTableSelect','selectColsBtn','checkHl','checkOnlyHl','checkExpSelected','expColSelect','pageSizeSelect']) {
            const control = $(id);
            if(control) control.disabled = !d;
        }
        $('globalFilter').value = ui.globalFilter || '';
        const formatSelect = $('formatSelect'); if(formatSelect) formatSelect.value = ui.importFormat || 'auto';
        const headerModeSelect = $('headerModeSelect'); if(headerModeSelect) headerModeSelect.value = ui.importHeaderMode || 'auto';
        $('checkHl').checked = ui.enableHighlight !== false;
        $('checkOnlyHl').checked = ui.onlyHighlighted || false;
        $('checkExpSelected').checked = ui.exportOnlyChecked || false;
        $('expColSelect').value = ui.exportCols || 'all';
        if($('pageSizeSelect')) $('pageSizeSelect').value = String(ui.pageSize || 100);
        if($('persistRawToggle')) $('persistRawToggle').checked = Store.state.persistRaw !== false;
        if($('checkFormulaSafe')) $('checkFormulaSafe').checked = Store.state.spreadsheetSafe !== false;
        if($('sidebar')) this.applySidebarTab(ui.sidebarTab || 'data',false);
        this.syncCopyFormatControl();
        this.syncCopyHeaderControl();
        this.updatePasteSourceButton();
        SourceController.renderCards();
        if(!d) {
            this._getExtractionSession().invalidate();
            this._regionSelection=null;this._headerModeConfirmation=null;
            TableRegistry.setResult(null);
            if($('backgroundJob')) $('backgroundJob').hidden=true;
            this.updSelects();this.updChips();this.updateImportSummary();
            this.renderPreview();this.updateStorageStatus();
            return;
        }
        if(Store.restoring) {
            if($('previewArea'))$('previewArea').textContent='正在恢复完整原文…';
            this.updateStorageStatus();return;
        }
        this.run(false);
        this.renderPreview();
        this.updateStorageStatus();
    },

    applyStoredCellEdits() {
        if(TableRegistry.isBackground())return;
        const edits = Store.getActiveUI().cellEdits || {};
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



    async showCardDiagnostics(id) {
        const card = Store.getCard(id);
        if(!card || Store.getDocument()?.id !== id) return false;
        const request = ++this._diagnosticsRequest;
        const revision = card.sourceRevision;
        // Activation is delivered through Store's existing batched events.
        await new Promise(resolve => setTimeout(resolve, 0));
        if(Store.getDocument()?.id !== id || Store.getCard(id)?.sourceRevision !== revision) return false;
        try {
            const extraction=await this._extractSource({reuse:true,retryFailed:false,render:false});
            if(!extraction || request !== this._diagnosticsRequest) return false;
            extraction.validate();
            if(TableRegistry.getFormat() === 'empty') return false;
            SourceController.focusCard(id, 'statusAction');
            this.showDiagnostics();
            return true;
        } catch(error) {
            if(!['AbortError','SourceChangedError'].includes(error.name)) Toast.show(`无法打开解析详情：${error.message || error}`, true);
            return false;
        }
    },

    showDiagnostics() {
        const result = TableRegistry.getLastResult();
        const fromPreview = Boolean(document.activeElement?.closest?.('.parse-feedback'));
        const candidates = (result.candidates || []).map((item,index) => {
            const score = Number.isFinite(item.score) ? `候选排序参考 ${item.score.toFixed(2)}` : '';
            const reason = item.reason || item.explanation || '依据解析器特征进行判断';
            const ambiguous = item.ambiguous || (item.risk && item.risk !== 'low');
            const requiresAction=item.kind==='region-set'||item.kind==='header-mode'||item.id!==result.format;
            const action=item.kind==='region-set'?'使用这些区域':item.kind==='header-mode'?'按此表头方式解析':'切换格式';
            const preview=item.preview?`<pre class="diagnostic-preview">${this.escapeHtml(item.preview)}</pre>`:'';
            return `<div class="diagnostic-item" style="display:flex;align-items:center;gap:10px;"><div style="flex:1;min-width:0;"><strong>${this.escapeHtml(item.label)}</strong><span class="muted" title="启发式排序参考值，不是正确概率">${item.manual ? '用户指定' : score}${ambiguous ? ' · 需确认' : ''}</span><div class="muted">${this.escapeHtml(reason)}</div>${preview}</div>${requiresAction ? `<button class="sm diagnostic-candidate-btn" type="button" data-candidate-index="${index}">${action}</button>` : '<span class="meta-tag">当前</span>'}</div>`;
        }).join('');
        const diagnostics = (result.diagnostics || []).map(item => `<div class="diagnostic-item"><strong>${this.escapeHtml(item.code || item.severity || item.level || '提示')}</strong><span>${this.escapeHtml(item.message || '')}</span></div>`).join('');
        const summary=result.diagnosticCount>result.diagnostics.length?`<p class="muted">共 ${result.diagnosticCount.toLocaleString()} 项提示，显示前 ${result.diagnostics.length} 项。完整原文仍保留。</p>`:'';
        this.modal('解析详情', `${summary}<div class="diagnostic-list">${candidates || '<div class="muted">没有格式候选信息</div>'}${diagnostics || '<div class="muted">未发现需要处理的数据问题</div>'}</div>`);
        document.querySelectorAll('.diagnostic-candidate-btn').forEach(button => {
            button.onclick = () => {
                const candidate=(result.candidates||[])[Number(button.dataset.candidateIndex)];
                if(!candidate)return;
                this.closeModal();
                if(fromPreview) $('parseBtn')?.focus({preventScroll:true});
                if(candidate.kind==='header-mode') {
                    this.rememberRegionSelection(candidate.regionSelection);
                    this.rememberHeaderMode(candidate.headerMode);
                    this.run();
                } else if(candidate.kind==='region-set') {
                    this.rememberRegionSelection(candidate.regionSelection);
                    this.run();
                } else this.setImportFormat(candidate.id);
            };
        });
    },

    rememberRegionSelection(selection) {
        if(!selection){this._regionSelection=null;return;}
        const doc=Store.getDocument();
        if(!doc) return;
        this._regionSelection={docId:doc.id,sourceRevision:doc.sourceRevision,text:SourceController.readText(),selection};
    },

    rememberHeaderMode(mode) {
        const doc=Store.getDocument();
        if(!doc) return;
        this._headerModeConfirmation={docId:doc.id,sourceRevision:doc.sourceRevision,text:SourceController.readText(),mode};
    },

    showHelp() {
        this.modal('帮助与快捷键', `<div class="shortcut-grid">
            <span>解析当前数据源</span><kbd>Ctrl/⌘ Enter</kbd>
            <span>新建分析工程</span><kbd>Ctrl/⌘ N</kbd>
            <span>选择本地数据文件</span><kbd>Ctrl/⌘ O</kbd>
            <span>保存当前工作区</span><kbd>Ctrl/⌘ S</kbd>
            <span>撤销 / 重做单元格编辑</span><span><kbd>Ctrl/⌘ Z</kbd> <kbd>Ctrl/⌘ Y</kbd></span>
            <span>重命名当前工程</span><kbd>F2</kbd>
            <span>全选当前预览表</span><kbd>Ctrl/⌘ A</kbd>
            <span>聚焦上一张 / 下一张卡片</span><span><kbd>↑</kbd> <kbd>↓</kbd></span>
            <span>聚焦首张 / 末张卡片</span><span><kbd>Home</kbd> <kbd>End</kbd></span>
            <span>选中聚焦的卡片编辑</span><span><kbd>Enter</kbd> <kbd>Space</kbd></span>
            <span>卡片改名 / 删除</span><span><kbd>F2</kbd> <kbd>Delete</kbd></span>
            <span>调整卡片拼接顺序</span><kbd>Alt ↑ / ↓</kbd>
        </div><p>卡片可双击改名，拖动手柄调整拼接顺序。眼睛按钮决定数据是否进入分析结果；隐藏的卡片仍可选中编辑。删除后 15 秒内可撤销最近一张卡片。</p>
        <p>卡片较多时可展开列表，选中卡片后自动收起；八张起可搜索卡片名称。搜索只影响左侧列表，清除后可调整拼接顺序。点击卡片的待确认或失败状态可直接打开解析详情。</p>
        <p>普通粘贴按光标位置插入或替换选区；全选后粘贴替换整卡。超过 128 Ki 字符的大段粘贴，以及在只读预览中粘贴，会替换整卡原文。</p>
        <p>“工作区”菜单提供备份、恢复和本地保存设置。关闭“本地保存原文”后，原文只保留在当前页面，刷新后不会恢复；规则和界面偏好仍会保存。</p>
        <p class="muted">支持 JSON、CSV、TSV、HTML、Markdown、ASCII、固定宽度文本、CLI table-data 与 Data-Block。数据不会发送到网络。</p>`);
    },

    showRuleHelp() {
        this.modal('规则语法', `<p>高亮规则和行过滤作用于目标表；全局过滤作用于所有表。三者使用相同语法。</p>
        <div class="shortcut-grid">
            <span>包含文字</span><code>error</code>
            <span>字段等于 / 不等于</span><code>Status=OK / Status!=OK</code>
            <span>数值比较</span><code>CPU&gt;90</code>
            <span>字段包含</span><code>Msg:Error</code>
            <span>正则表达式</span><code>/err[0-9]+/</code>
            <span>排除匹配</span><code>!Status=OK</code>
            <span>满足任意条件（OR）</span><code>error|warn</code>
            <span>同时满足（AND）</span><code>Status=OK Qty&gt;0</code>
        </div>`);
    },

    _getExtractionSession() {
        if(!this._extractionSession) this._extractionSession=ExtractionSession.create({
            readContext:()=>this.getSourceContext(),
            onStart:({context,background})=>{
                if($('parseStatus')) $('parseStatus').hidden=true;
                if($('sourceDiagnosticsBtn')) $('sourceDiagnosticsBtn').disabled=true;
                if(!background) return;
                const job=this.showJob('正在后台解析完整原文…');
                SourceController.setCardParsing(context,true);
                if($('previewArea')) $('previewArea').setAttribute('aria-busy','true');
                return ()=>{
                    SourceController.setCardParsing(context,false);
                    this.finishJob(job);
                    if($('previewArea')) $('previewArea').setAttribute('aria-busy','false');
                };
            },
            onResult:({background,ok,error,render,elapsed})=>{
                SourceController.renderCards();
                if(!background) CellEditController.setRawTables(TableRegistry.getRaw());
                if(ok) this.applyStoredCellEdits();
                this.updateImportSummary();
                if(ok) {
                    if(render) {
                        if(!background) {this.updSelects();this.updChips();}
                        this.requestRender();
                    }
                    if(!background && TableRegistry.getRaw().length && elapsed>800) Toast.show(`解析完成 · ${elapsed} ms`);
                    return;
                }
                if(background) this.requestRender();
                else {this.updSelects();this.updChips();this.renderPreview();}
                const msg=error.message || String(error);
                const friendly=
                    /超过.*128.*MiB|MAX_IMPORT/i.test(msg) ? '数据过大，请将输入控制在 128 MiB 以内' :
                    /quota|storage.*full/i.test(msg) ? '浏览器存储空间不足；当前数据仍在内存中，请立即备份工作区' :
                    /Unexpected.*token|JSON.*parse/i.test(msg) ? '数据格式无法识别，请尝试手动选择格式' :
                    /URI.*malformed/i.test(msg) ? '文件名包含不支持字符' : '';
                Toast.show(friendly || `解析失败：${msg}`,true);
            },
        });
        return this._extractionSession;
    },

    _extractSource(options={}) {
        if(!Store.getDocument()) return null;
        SourceController.clearAutoParse();
        const text=SourceController.readText();
        if(Store.getDocument().raw!==text) dispatch('source:replace',{text});
        return this._getExtractionSession().run(options);
    },

    run(render=true) {
        const extraction=this._extractSource({render});
        return extraction?.then?extraction.then(result=>!!result?.ok):!!extraction?.ok;
    },

    updSelects() {
        const s = $('targetTableSelect');
        const old = s.value; s.innerHTML = '';
        TableRegistry.getRaw().forEach(t => s.add(new Option(t.name, t.name)));
        Store.getViews().forEach(v => s.add(new Option(`JOIN:${v.view}`, `JOIN:${v.view}`)));
        if(old && Array.from(s.options).some(o=>o.value===old)) s.value=old;
        else if(s.options.length>0) s.selectedIndex=0;
        this.syncRules();
    },

    syncRules() {
        const t = $('targetTableSelect').value;
        const r = Store.getActiveUI().rules[t] || {};
        $('hlInput').value = r.hl || '';
        $('filterInput').value = r.filter || '';
        $('focusColsInput').value = (r.focus || []).join(', ');
    },

    updChips() {
        const ui = Store.getActiveUI();
        // 只显示表/视图名称，过滤掉误保存的字段名
        const tableNames = TableRegistry.getRaw().map(t => t.name);
        const tsRaw = ui.displayTables;
        const ts = (tsRaw===null || tsRaw===undefined) ? null : (tsRaw || []).filter(n => tableNames.includes(n));
        $('tablesTrigger').innerHTML = (ts===null) ? `<span class="chip" style="background:var(--bg-hover); color:var(--text-secondary); border-color:transparent;">默认全显</span>` : (ts.length ? ts.map(n=>`<span class="chip">${this.escapeHtml(n)}</span>`).join('') : `<span class="placeholder">无</span>`);
        const viewNames = Store.getViews().map(v => v.view);
        const vsRaw = Store.getEnabledViews();
        const vs = vsRaw.filter(v => viewNames.includes(v));
        if(vs.length !== vsRaw.length) dispatch('view:setEnabled', { enabledViews:vs });
        const poolNames = TableRegistry.getPoolNames().length ? TableRegistry.getPoolNames() : TableRegistry.getRaw().map(t => t.name);
        $('viewsTrigger').innerHTML = vs.length ? vs.map(n=>{
            const cfg = Store.getViews().find(v => v.view === n);
            const missing = cfg && [cfg.left, cfg.right].filter(Boolean).some(t => !poolNames.includes(t));
            return `<span class="chip${missing ? ' view-unavailable' : ''}" title="${missing ? '引用的表不在表池（所在卡片已隐藏）' : ''}">${this.escapeHtml(n)}${missing ? ' · 不可用' : ''}</span>`;
        }).join('') : `<span class="placeholder">未启用</span>`;
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

    appendParseConfirmation(container) {
        const active = Store.getDocument();
        const result = TableRegistry.getLastResult();
        const current = result.format === 'ambiguous';
        const unresolved = (Store.getActiveProject()?.cardIds || []).map(id => Store.getCard(id))
            .filter(card => card && card.visible !== false && TableRegistry.getCardSummary(card.id)?.format === 'ambiguous');
        const card = current ? active : unresolved.find(item => item.id !== active?.id);
        if(!card) return null;
        const notice = createEl('section', 'parse-feedback is-empty');
        notice.setAttribute('aria-labelledby', 'parseFeedbackTitle');
        const icon = createEl('span', 'parse-feedback-icon');
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16h.01"/></svg>';
        const body = createEl('div', 'parse-feedback-body');
        const title = createEl('h2', 'parse-feedback-title');
        title.id = 'parseFeedbackTitle';
        title.textContent = current && !result.candidates.length ? '解析方式待确认' : '有候选结果待确认';
        const source = createEl('p', 'parse-feedback-source');
        const others = unresolved.filter(item => item.id !== card.id).length;
        source.textContent = `${current ? '当前卡片' : '待确认卡片'}：${card.title}${others ? ` · 另有 ${others} 张卡片待确认` : ''}`;
        const description = createEl('p', 'parse-feedback-description');
        description.textContent = card.visible === false
            ? '此卡片未参与分析。可先确认解析方式；勾选“参与分析”后才会显示表格，原文已保留。'
            : current && !result.candidates.length
                ? '自动识别还不能确定解析方式。请查看详情，或手动选择格式后再生成表格，原文已保留。'
                : '检测到多种可能的解析方式。确认候选后才会显示这张卡片的表格，原文已保留。';
        const button = createEl('button', 'primary parse-feedback-action');
        button.type = 'button';
        button.textContent = current ? (result.candidates.length ? '查看并确认候选' : '查看解析详情') : '选中卡片并确认';
        if(current) button.setAttribute('aria-haspopup', 'dialog');
        button.onclick = () => {
            if(current) this.showDiagnostics();
            else if(this.activateCard(card.id)) SourceController.focusCard(card.id);
        };
        body.appendChild(title); body.appendChild(source); body.appendChild(description); body.appendChild(button);
        notice.appendChild(icon); notice.appendChild(body); container.appendChild(notice);
        return notice;
    },

    renderPreview(processedOverride=null) {
        const generation=++this._renderGeneration;
        if(!Store.getDocument()) TableRegistry.setResult(null);
        if(TableRegistry.isBackground() && !processedOverride) {
            const doc=Store.getDocument();const revision=Store.revision;
            TableRegistry.setPreview(null);this.updateWorkspaceSummary();
            const job=this.showJob('正在后台更新筛选与 JOIN…');
            if($('previewArea'))$('previewArea').setAttribute('aria-busy','true');
            let input;
            try {input=TableRegistry.getBackgroundInput();} catch(error) {this.finishJob(job);Toast.show(error.message,true);return;}
            QueryService.getPreviewAsync(input,BackgroundService).then(result=>{
                if(generation!==this._renderGeneration || Store.getDocument()?.id!==doc.id || Store.getDocument()?.sourceRevision!==input.sourceRevision)return;
                if(revision!==Store.revision){this.requestRender();return;}
                for(const parsed of result.parsed || []) TableRegistry.recordParse(parsed.context, parsed.result);
                SourceController.renderCards();
                this.renderPreview(result.tables);
                this.updChips();
            }).catch(error=>{if(generation===this._renderGeneration && error.name!=='AbortError')Toast.show(error.message,true);}).finally(()=>{
                this.finishJob(job);
                if(generation===this._renderGeneration && $('previewArea'))$('previewArea').setAttribute('aria-busy','false');
            });
            return;
        }
        if($('previewArea'))$('previewArea').setAttribute('aria-busy','false');
        if(CellEditController.activeEditor) CellEditController.finish(true);
        const div = $('previewArea'); div.innerHTML = '';
        this.rendered = []; Select.clear();
        TableRegistry.setPreview([]);this.updateWorkspaceSummary();
        this.syncPreviewTablePicker([], false);
        if(!Store.getDocument()) {
            const hasProject = !!Store.getActiveProject();
            div.innerHTML = `<div class="empty">
                <div style="font-weight:700; color:var(--text-strong);">${hasProject ? '当前工程没有卡片' : '工作区为空'}</div>
                <div class="muted">${hasProject ? '新增卡片后，再粘贴或导入数据。' : '新建页签后开始；页签编号从 1 开始。'}</div>
            </div>`;
            const button = createEl('button', 'tonal');
            button.type = 'button';
            button.textContent = hasProject ? '新增卡片' : '新建页签';
            button.onclick = () => hasProject ? dispatch('card:create', {}) : TabController.createNew();
            div.querySelector('.empty')?.appendChild(button);
            return;
        }
        const confirmation = this.appendParseConfirmation(div);
        if(!TableRegistry.getRaw().length && !processedOverride) {
            if(confirmation) return;
            div.innerHTML = `<div class="empty">
                <div class="empty-visual" aria-hidden="true">${'<span></span>'.repeat(9)}</div>
                <div style="font-weight:800; color:var(--text-strong);">把杂乱数据变成可分析表格</div>
                <div class="muted">在左侧粘贴、拖放或选择文件，然后点击“解析数据”</div>
                <button class="tonal" type="button" onclick="document.getElementById('sampleLink').click()">加载示例数据</button>
            </div>`; 
            return; 
        }
        
        const ui = Store.curr().ui;
        const processedTables = processedOverride || this.getPreviewProcessedTables();
        TableRegistry.setPreview(processedTables);
        this.updateWorkspaceSummary();
        if($('previewArea'))$('previewArea').setAttribute('aria-busy','false');
        const combined = processedTables.map(({ table }) => table);
        if(!combined.length) {
            if(confirmation) return;
            div.innerHTML = `<div class="empty">
                <div class="empty-visual" aria-hidden="true">${'<span></span>'.repeat(9)}</div>
                <div style="font-weight:700;">当前筛选下无可见表</div>
                <div class="muted">检查“显示原始表 / JOIN 视图”的选择</div>
            </div>`;
            return;
        }

        if(confirmation) confirmation.className = 'parse-feedback';

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
            const rowTag = createEl('span', 'meta-tag'); rowTag.textContent = `Row: ${TableUtils.rowCount(t)}`; meta.appendChild(rowTag);
            const showTag = createEl('span', 'meta-tag'); showTag.textContent = `Show: ${res.totalRows ?? res.rows.length}`; meta.appendChild(showTag);
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
            const totalRows=res.totalRows ?? res.rows.length;
            const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
            const requestedPage = Number(ui.tablePages && ui.tablePages[t.name]) || 1;
            const page = Math.min(totalPages, Math.max(1, requestedPage));
            const tablePages = Object.assign({}, ui.tablePages || {});
            if(tablePages[t.name] !== page) {
                tablePages[t.name] = page;
                dispatch('ui:set', { key:'tablePages', value:tablePages });
            }
            const pageRes = { headers:res.headers, rows:res.paged?res.rows:res.rows.slice((page - 1) * pageSize, page * pageSize) };
            const tbl = mode === 'row-header' ? this.buildRowHeaderTable(t, pageRes, tIdx, colFilters) : this.buildColumnHeaderTable(t, pageRes, tIdx, colFilters);
            const tableScroll = createEl('div', 'table-scroll');
            tableScroll.appendChild(tbl);
            card.appendChild(tableScroll);
            if(totalPages > 1) {
                const pager = createEl('div', 'table-pagination');
                const info = createEl('span');
                const from = (page - 1) * pageSize + 1;
                const to = Math.min(totalRows, page * pageSize);
                info.textContent = `${from.toLocaleString()}–${to.toLocaleString()} / ${totalRows.toLocaleString()} 行 · 第 ${page}/${totalPages} 页`;
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

    modTables() { ModalController.showTableSelector(TableRegistry.getRaw().map(t => t.name), Store.getActiveUI().displayTables); },
    modViews() { ModalController.showViewSelector(Store.getViews(), Store.getEnabledViews()); },
    
    modCols() {
        const tName = $('targetTableSelect').value;
        if (!tName) return;
        let all = [];
        const rawTable = TableRegistry.getRaw().find(x => x.name === tName);
        if (rawTable) { all = rawTable.headers; }
        else if (tName.startsWith('JOIN:')) {
            const vName = tName.replace('JOIN:', '');
            const vCfg = Store.getViews().find(v => v.view === vName);
            if (vCfg) all=Joiner.getHeaders(TableRegistry.getRaw(),vCfg,Store.getViews());
        }
        if (!all || !all.length) { const rt = this.rendered.find(x => x.name === tName); if (rt) all = rt.headers; }
        if (!all || !all.length) { if (typeof alert === 'function') alert('无法获取列信息'); return; }
        ModalController.showColumnSelector(tName, all, Store.getActiveUI().rules[tName] || {});
    }

};


    Tooltip.init();
    App.init();
    return { App };
});
