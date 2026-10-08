OTA.define('export-controller', ["runtime", "store", "exporter", "clipboard", "dispatch", "table-registry", "filter-engine", "query-service", "background-service"], ({$, Toast}, {Store, APP_VERSION, WORKSPACE_SCHEMA_VERSION, MAX_WORKSPACE_BYTES, COPY_FORMATS}, {Exporter}, {ClipboardFormatter}, {dispatch}, {TableRegistry}, {FilterEngine}, {QueryService}, {BackgroundService}) => {
/* ExportController — file exports, workspace/config backup, copy format.

   Responsibilities:
   - Export raw/full/preview XLSX
   - Export/import workspace JSON
   - Export/import config JSON
   - Copy format selection
   - Export helper methods (getFullExportTables, projectTableForExport, etc.)

   Preview exports are rebuilt from the current TableRegistry and UI state so
   they always use the same data as the visible preview.
*/

const ExportController = {
    async runExport(label,task,prefix,type,extension) {
        if(this._exporting)return Toast.show('导出正在进行，请等待或取消');
        this._exporting=true;
        const notify=busy=>document.dispatchEvent(new CustomEvent('ota:backgroundJob',{detail:{busy,label}}));
        notify(true);
        try {
            const buffer=await task();
            Exporter.download(`${Exporter.sanitizeFilePrefix(prefix)}_${Exporter.getTimestamp()}.${extension}`,buffer instanceof Blob?buffer:new Blob([buffer],{type}),type);
        } catch(error) {if(error.name!=='AbortError')Toast.show(`导出失败：${error.message}`,true);}
        finally {this._exporting=false;notify(false);}
    },
    exportExcel(mode) {
        if(TableRegistry.isBackground()) {
            let input;
            try {input=TableRegistry.getBackgroundInput();}catch(error){return Toast.show(error.message,true);}
            return this.runExport('正在后台生成 Excel…',()=>BackgroundService.export(input,mode),this._getPrefix(mode),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','xlsx');
        }
        const tables=mode==='raw'?TableRegistry.getRaw():mode==='full'?this._getFullExportTables():this._getPreviewExportTables();
        return Exporter.toExcel(tables,this._getPrefix(mode));
    },
    exportJson(payload,prefix) {
        const bytes=(payload.docs || []).reduce((sum,doc)=>sum+(doc.raw || '').length*2,0);
        if(bytes>256*1024*1024)return Toast.show('工作区超过 256 MiB 备份预算，请分别导出原文',true);
        if(bytes>BackgroundService.THRESHOLD*2)return this.runExport('正在后台生成工作区备份…',()=>BackgroundService.request('json',payload,{},'export'),prefix,'application/json','json');
        return Exporter.toJson(payload,prefix);
    },
    /**
     * Bind export buttons. Called once from App.init().
     */
    init() {
        // Copy settings popover
        const copyPreferences = $('copyPreferences');
        const copySettingsBtn = $('copySettingsBtn');
        const copySettingsPopover = $('copySettingsPopover');
        const copySettingsCloseBtn = $('copySettingsCloseBtn');
        const setCopySettingsOpen = (open) => {
            if(!copySettingsPopover || !copySettingsBtn) return;
            copySettingsPopover.classList.toggle('hidden', !open);
            copySettingsBtn.setAttribute('aria-expanded', String(open));
            if(open) {
                const select = $('copyFormatSelect');
                if(select && typeof select.focus === 'function') setTimeout(() => select.focus(), 0);
            }
        };
        if(copySettingsBtn && copySettingsPopover) {
            copySettingsBtn.onclick = (e) => {
                e.stopPropagation();
                setCopySettingsOpen(copySettingsPopover.classList.contains('hidden'));
            };
            if(copySettingsCloseBtn) copySettingsCloseBtn.onclick = () => setCopySettingsOpen(false);
            if(typeof document !== 'undefined' && document.addEventListener) {
                document.addEventListener('click', (e) => {
                    const inside = copyPreferences && typeof copyPreferences.contains === 'function'
                        ? copyPreferences.contains(e.target) : false;
                    if(!copySettingsPopover.classList.contains('hidden') && !inside) {
                        setCopySettingsOpen(false);
                    }
                });
                document.addEventListener('keydown', (e) => {
                    if(e.key === 'Escape' && !copySettingsPopover.classList.contains('hidden')) {
                        setCopySettingsOpen(false);
                        copySettingsBtn.focus();
                    }
                });
            }
        }

        // Copy format selector
        const copyFormatSelect = $('copyFormatSelect');
        if (copyFormatSelect) {
            copyFormatSelect.value = Store.state.copyFormat === 'json' ? 'json-expanded' : Store.state.copyFormat || 'default';
            copyFormatSelect.onchange = (e) => {
                dispatch('ui:copyFormat', { format: e.target.value });
            };
        }

        const copyHeadersToggle = $('copyHeadersToggle');
        if (copyHeadersToggle) {
            copyHeadersToggle.checked = Store.state.copyWithHeaders !== false;
            copyHeadersToggle.onchange = (e) => {
                dispatch('ui:copyHeaders', { enabled: e.target.checked });
            };
        }

        // XLSX exports
        const rawBtn = $('exportRawBtn');
        if (rawBtn) rawBtn.onclick = () => ExportController.exportExcel('raw');

        const fullBtn = $('exportFullBtn');
        if (fullBtn) fullBtn.onclick = () => ExportController.exportExcel('full');

        const prevBtn = $('exportPrevBtn');
        if (prevBtn) prevBtn.onclick = () => ExportController.exportExcel('preview');

        // Workspace backup
        const exportTabBtn = $('exportTabBtn');
        if (exportTabBtn) exportTabBtn.onclick = () => ExportController.exportJson({
            kind: 'ota-workspace',
            schemaVersion: WORKSPACE_SCHEMA_VERSION,
            appVersion: APP_VERSION,
            exportedAt: new Date().toISOString(),
            docs: Store.state.docs,
            globalViews: Store.state.globalViews,
            preferences: {
                theme: Store.state.theme,
                copyFormat: Store.state.copyFormat,
                copyWithHeaders: Store.state.copyWithHeaders !== false,
                persistRaw: Store.state.persistRaw,
                spreadsheetSafe: Store.state.spreadsheetSafe
            }
        }, ExportController._getPrefix('workspace'));

        const importTabBtn = $('importTabBtn');
        const fileInputTab = $('fileInputTab');
        if (importTabBtn && fileInputTab) importTabBtn.onclick = () => fileInputTab.click();
        if (fileInputTab) fileInputTab.onchange = (e) => {
            const f = e.target.files[0];
            if (!f) return;
            if (f.size > MAX_WORKSPACE_BYTES) { Toast.show('工作区文件超过 256 MiB 限制', true); e.target.value = ''; return; }
            const r = new FileReader();
            r.onload = (evt) => {
                try {
                    const count = ExportController._importWorkspacePayload(evt.target.result);
                    ExportController._emit('tabsChanged');
                    Toast.show(`已恢复 ${count} 个页签`);
                } catch (error) {
                    Toast.show(`工作区导入失败：${error.message || '格式错误'}`, true);
                }
                e.target.value = '';
            };
            r.readAsText(f);
        };

        // Config export/import
        const exportCfgBtn = $('exportConfigBtn');
        if (exportCfgBtn) exportCfgBtn.onclick = () => Exporter.toJson({
            kind: 'table-tool-config',
            globalViews: Store.state.globalViews,
            docs: Store.state.docs.map(d => ({ id: d.id, title: d.title, ui: d.ui }))
        }, ExportController._getPrefix('config'));

        const importCfgBtn = $('importConfigBtn');
        const fileInputCfg = $('fileInputConfig');
        if (importCfgBtn && fileInputCfg) importCfgBtn.onclick = () => fileInputCfg.click();
        if (fileInputCfg) fileInputCfg.onchange = (e) => {
            const f = e.target.files[0];
            if (!f) return;
            if (f.size > 5 * 1024 * 1024) { Toast.show('配置文件超过 5 MB 限制', true); e.target.value = ''; return; }
            const r = new FileReader();
            r.onload = (evt) => {
                try {
                    ExportController._importConfigPayload(evt.target.result);
                    ExportController._emit('tabsChanged');
                    Toast.show('配置已更新');
                } catch (err) {
                    console.error(err);
                    if (typeof alert === 'function') alert('配置文件格式错误，请检查文件是否完整');
                }
                e.target.value = '';
            };
            r.readAsText(f);
        };
    },

    // ── Export helpers (used by App.renderPreview and other methods) ──

    _getPrefix(kind) {
        const title = Store.curr().title || 'Analysis';
        return Exporter.sanitizeFilePrefix(`${title}_${kind}`);
    },

    _getEnabledJoinTables(full) {
        const ui = Store.curr().ui;
        if (!ui.enabledViews || !ui.enabledViews.length) return [];
        // Joiner is required at runtime; accessed via OTA to avoid circular dep
        const Joiner = (typeof window !== 'undefined' && window.OTA)
            ? window.OTA.require('joiner').Joiner : null;
        if (!Joiner) return [];
        return ui.enabledViews.map(v => {
            const cfg = Store.state.globalViews.find(g => g.view === v);
            return cfg ? Joiner.run(TableRegistry.getRaw(), cfg, Store.state.globalViews) : null;
        }).filter(x => x);
    },

    _projectTableForExport(table, shownOnly) {
        if (!shownOnly) {
            return { name: table.name, headers: table.headers.slice(), rows: table.rows.map(r => r.slice()) };
        }
        const ui = Store.curr().ui;
        const rules = ui.rules && ui.rules[table.name];
        const focus = (rules && rules.focus && rules.focus.length > 0) ? rules.focus : null;
        if (!focus) {
            return { name: table.name, headers: table.headers.slice(), rows: table.rows.map(r => r.slice()) };
        }
        const indexes = [];
        const headers = [];
        focus.forEach(col => {
            const i = table.headers.indexOf(col);
            if (i > -1) { headers.push(col); indexes.push(i); }
        });
        if (!headers.length) {
            return { name: table.name, headers: table.headers.slice(), rows: table.rows.map(r => r.slice()) };
        }
        return {
            name: table.name,
            headers: headers,
            rows: table.rows.map(r => indexes.map(i => r[i]))
        };
    },

    _getFullExportTables() {
        const ui = Store.curr().ui;
        let tables = TableRegistry.getRaw();
        if (ui.exportOnlyChecked && Array.isArray(ui.displayTables)) {
            const selected = new Set(ui.displayTables);
            tables = tables.filter(t => selected.has(t.name));
        }
        const joins = ExportController._getEnabledJoinTables(true);
        const shownOnly = ui.exportCols === 'shown';
        return [...tables, ...joins].map(table => ExportController._projectTableForExport(table, shownOnly));
    },

    _getPreviewProcessedTables() {
        const doc = Store.curr();
        return QueryService.getPreview({
            rawTables:TableRegistry.getRaw(),
            globalViews:Store.state.globalViews,
            ui:doc.ui,
            docId:doc.id,
            sourceRevision:doc.sourceRevision,
            stateRevision:Store.revision,
            viewRevision:Store.viewRevision,
            queryRevision:Store.queryRevision,
        }).tables;
    },

    _getPreviewExportTables() {
        return ExportController._getPreviewProcessedTables().map(({table, res}) => ({
            name: table.name || 'Sheet',
            headers: res.headers,
            rows: res.rows.map(row => row.d)
        }));
    },

    // ── Pure business-logic helpers (testable without FileReader/DOM) ──

    /** Parse + apply workspace JSON. Returns imported doc count. */
    _importWorkspacePayload(json) {
        const d = JSON.parse(json);
        const replace = typeof confirm === 'function' ? confirm('确定：替换当前工作区\n取消：把备份追加为新页签') : true;
        const count = dispatch('workspace:import', { workspace:d, merge:!replace });
        this._applyPreferences(d.preferences);
        dispatch('workspace:imported', { count });
        return count;
    },

    /** Parse + apply config JSON. Returns matched doc count. */
    _importConfigPayload(json) {
        const d = JSON.parse(json);
        if (d.kind !== 'table-tool-config' || !Store.isSafePayload(d)) throw new Error('配置结构无效');

        if (Array.isArray(d.globalViews)) {
            const nextViews = d.globalViews.slice(0, 500).filter(
                view => view && typeof view === 'object' && typeof view.view === 'string'
            );
            const oldCount = Store.state.globalViews.length;
            dispatch('view:replaceAll', { views:nextViews });
            Toast.show(`全局视图已更新 (${oldCount} → ${nextViews.length} 个)`);
        }

        let appliedCount = 0;
        const unmatched = [];
        if (Array.isArray(d.docs) && d.docs.length > 0 && d.docs.length <= 100) {
            d.docs.filter(x => x && typeof x === 'object').forEach(x => {
                let t = Store.state.docs.find(y => y.title === x.title);
                if (!t) t = Store.state.docs.find(y => y.id === x.id);
                if (t) {
                    if (x.ui && typeof x.ui === 'object') dispatch('document:replaceUI', { docId:t.id, ui:x.ui });
                    appliedCount++;
                } else {
                    unmatched.push(x.title || x.id);
                }
            });
        }

        if (unmatched.length > 0) {
            const names = unmatched.slice(0, 3).join(', ') + (unmatched.length > 3 ? '...' : '');
            if (typeof confirm === 'function' && confirm(
                `配置导入完成：\n• 已应用 ${appliedCount} 个文档\n• ${unmatched.length} 个无法匹配 (${names})\n\n为未匹配项创建新文档？`
            )) {
                unmatched.forEach(docName => {
                    const cfg = d.docs.find(dc => (dc.title === docName) || (dc.id === docName));
                    if (cfg) dispatch('tab:create', { title:cfg.title, raw:'', ui:cfg.ui || {} });
                });
            }
        }
        return appliedCount;
    },

    /** Apply workspace preferences block to current Store. */
    _applyPreferences(prefs) {
        if (!prefs || typeof prefs !== 'object') return;
        dispatch('preferences:replace', { preferences:prefs });
    },

    _emit(name) {
        if (typeof document !== 'undefined' && document.dispatchEvent) {
            document.dispatchEvent(new CustomEvent('ota:' + name, {}));
        }
    }
};

    return { ExportController };
});
