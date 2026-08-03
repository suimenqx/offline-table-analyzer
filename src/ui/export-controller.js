OTA.define('export-controller', ["runtime", "store", "exporter", "clipboard", "dispatch", "table-registry"], ({$, Toast}, {Store, MAX_IMPORT_BYTES, COPY_FORMATS}, {Exporter}, {ClipboardFormatter}, {dispatch}, {TableRegistry}) => {
/* ExportController — file exports, workspace/config backup, copy format.

   Responsibilities:
   - Export raw/full/preview XLSX
   - Export/import workspace JSON
   - Export/import config JSON
   - Copy format selection
   - Export helper methods (getFullExportTables, projectTableForExport, etc.)

   App must call setContext({ raw, rendered, joinTables }) after each parse.
*/

const ExportController = {
    _rendered: [],
    _joinTables: [],

    /** Called by App after each parse to keep transient references fresh. */
    setContext(ctx) {
        if (ctx.rendered) ExportController._rendered = ctx.rendered;
        if (ctx.joinTables !== undefined) ExportController._joinTables = ctx.joinTables;
    },

    /**
     * Bind export buttons. Called once from App.init().
     */
    init() {
        // Copy format selector
        const copyFormatSelect = $('copyFormatSelect');
        if (copyFormatSelect) {
            copyFormatSelect.value = Store.state.copyFormat || 'default';
            copyFormatSelect.onchange = (e) => {
                dispatch('ui:copyFormat', { format: e.target.value });
            };
        }

        // XLSX exports
        const rawBtn = $('exportRawBtn');
        if (rawBtn) rawBtn.onclick = () => Exporter.toExcel(TableRegistry.getRaw(), ExportController._getPrefix('raw'));

        const fullBtn = $('exportFullBtn');
        if (fullBtn) fullBtn.onclick = () => Exporter.toExcel(ExportController._getFullExportTables(), ExportController._getPrefix('full'));

        const prevBtn = $('exportPrevBtn');
        if (prevBtn) prevBtn.onclick = () => Exporter.toExcel(ExportController._getPreviewExportTables(), ExportController._getPrefix('preview'));

        // Workspace backup
        const exportTabBtn = $('exportTabBtn');
        if (exportTabBtn) exportTabBtn.onclick = () => Exporter.toJson({
            kind: 'ota-workspace',
            schemaVersion: (Store.schemaVersion || 20),
            appVersion: (Store._appVersion || '21.0.0'),
            exportedAt: new Date().toISOString(),
            docs: Store.state.docs,
            globalViews: Store.state.globalViews,
            preferences: {
                theme: Store.state.theme,
                copyFormat: Store.state.copyFormat,
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
            if (f.size > MAX_IMPORT_BYTES) { Toast.show('工作区文件超过 25 MB 限制', true); e.target.value = ''; return; }
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

    _getPreviewExportTables() {
        return ExportController._rendered.map(r => ({
            name: r.name || 'Sheet',
            headers: r.headers,
            rows: r.rows.map(row => row.d)
        }));
    },

    // ── Pure business-logic helpers (testable without FileReader/DOM) ──

    /** Parse + apply workspace JSON. Returns imported doc count. */
    _importWorkspacePayload(json) {
        const d = JSON.parse(json);
        const replace = typeof confirm === 'function' ? confirm('确定：替换当前工作区\n取消：把备份追加为新页签') : true;
        const count = Store.importWorkspace(d, !replace);
        this._applyPreferences(d.preferences);
        dispatch('workspace:imported', { count });
        return count;
    },

    /** Parse + apply config JSON. Returns matched doc count. */
    _importConfigPayload(json) {
        const d = JSON.parse(json);
        if (d.kind !== 'table-tool-config' || !Store.isSafePayload(d)) throw new Error('配置结构无效');

        if (Array.isArray(d.globalViews)) {
            const oldCount = Store.state.globalViews.length;
            Store.state.globalViews = d.globalViews.slice(0, 500).filter(
                view => view && typeof view === 'object' && typeof view.view === 'string'
            );
            Toast.show(`全局视图已更新 (${oldCount} → ${Store.state.globalViews.length} 个)`);
        }

        let appliedCount = 0;
        const unmatched = [];
        if (Array.isArray(d.docs) && d.docs.length > 0 && d.docs.length <= 100) {
            d.docs.filter(x => x && typeof x === 'object').forEach(x => {
                let t = Store.state.docs.find(y => y.title === x.title);
                if (!t) t = Store.state.docs.find(y => y.id === x.id);
                if (t) {
                    if (x.ui && typeof x.ui === 'object') t.ui = x.ui;
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
                    if (cfg) Store.addDoc({ title: cfg.title, raw: '', ui: cfg.ui || {} });
                });
            }
        }
        Store.save();
        return appliedCount;
    },

    /** Apply workspace preferences block to current Store. */
    _applyPreferences(prefs) {
        if (!prefs || typeof prefs !== 'object') return;
        if (['light', 'dark'].includes(prefs.theme)) Store.state.theme = prefs.theme;
        if (COPY_FORMATS.includes(prefs.copyFormat)) Store.state.copyFormat = prefs.copyFormat;
        if (typeof prefs.persistRaw === 'boolean') Store.state.persistRaw = prefs.persistRaw;
        if (typeof prefs.spreadsheetSafe === 'boolean') Store.state.spreadsheetSafe = prefs.spreadsheetSafe;
        Store.applyTheme();
        Store.save();
    },

    _emit(name) {
        if (typeof document !== 'undefined' && document.dispatchEvent) {
            document.dispatchEvent(new CustomEvent('ota:' + name, {}));
        }
    }
};

    return { ExportController };
});
