OTA.define('store', [], () => {
/* Core */
const APP_VERSION = '22.0.0';
const WORKSPACE_SCHEMA_VERSION = 20;
const STORE_KEY = 'ota_v20_workspace';
const LEGACY_STORE_KEYS = ['v16_4_store'];
const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
const COPY_FORMATS = Object.freeze(['default', 'csv', 'markdown', 'ascii', 'lua-inline', 'lua-expanded']);

const Store = {
    state: { schemaVersion:WORKSPACE_SCHEMA_VERSION, docs:[], activeId:null, theme:'light', globalViews:[], nextAnalysisSeq:1, copyFormat:'default', spreadsheetSafe:true, persistRaw:true, lastSavedAt:null },
    lastSaveError: null,
    storageBytes: 0,
    migratedFrom: null,
    saveTimer: null,
    loadFailed: false,
    _listeners: null,  // Set of onChange callbacks; lazily initialised
    _notifyQueue: null, // pending events queued for batched async delivery
    _notifyTimer: null, // single batched async timer
    init() {
        let loaded = null;
        try {
            const current = localStorage.getItem(STORE_KEY);
            if(current) loaded = JSON.parse(current);
            if(!loaded) {
                for(const key of LEGACY_STORE_KEYS) {
                    const legacy = localStorage.getItem(key);
                    if(!legacy) continue;
                    const parsed = JSON.parse(legacy);
                    if(parsed && Array.isArray(parsed.docs)) {
                        loaded = parsed;
                        this.migratedFrom = key;
                        break;
                    }
                }
            }
        } catch(e) {
            this.lastSaveError = `读取本地工作区失败：${e.message}`;
            this.loadFailed = true;
        }
        if(loaded && Array.isArray(loaded.docs)) this.state = Object.assign({}, this.state, loaded);
        this.state.schemaVersion = WORKSPACE_SCHEMA_VERSION;
        if(!Array.isArray(this.state.docs)) this.state.docs = [];
        if(!Array.isArray(this.state.globalViews)) this.state.globalViews = [];
        if(!COPY_FORMATS.includes(this.state.copyFormat)) this.state.copyFormat = 'default';
        if(typeof this.state.spreadsheetSafe !== 'boolean') this.state.spreadsheetSafe = true;
        if(typeof this.state.persistRaw !== 'boolean') this.state.persistRaw = true;
        if(!Number.isFinite(this.state.nextAnalysisSeq) || this.state.nextAnalysisSeq < 1) this.state.nextAnalysisSeq = 1;
        this.state.nextAnalysisSeq = Math.max(this.state.nextAnalysisSeq, this.getMaxAnalysisNumber() + 1);
        if(this.state.docs.length===0) {
            if(this.loadFailed) {
                const doc = this.normalizeDoc({ id:this.generateDocId(), title:'Analysis 1', raw:'', ui:{} }, 0);
                this.state.docs.push(doc);
                this.state.activeId = doc.id;
            } else this.addDoc();
        }
        const seenIds = new Set();
        this.state.docs.forEach((d, idx) => {
            this.normalizeDoc(d, idx);
            if(seenIds.has(d.id)) d.id = this.generateDocId();
            seenIds.add(d.id);
        });
        this.state.nextAnalysisSeq = Math.max(this.state.nextAnalysisSeq, this.getMaxAnalysisNumber() + 1);
        if(!this.state.docs.some(d => d.id === this.state.activeId)) this.state.activeId = this.state.docs[0] && this.state.docs[0].id;
        this.applyTheme();
        if(this.loadFailed) this.notifyStorage(false, this.lastSaveError);
        else this.save();
    },
    serializeState() {
        const payload = JSON.parse(JSON.stringify(this.state));
        payload.schemaVersion = WORKSPACE_SCHEMA_VERSION;
        payload.appVersion = APP_VERSION;
        if(payload.persistRaw === false) payload.docs.forEach(doc => { doc.raw = ''; });
        return payload;
    },
    notifyStorage(ok, message='') {
        if(typeof document === 'undefined' || typeof document.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return;
        document.dispatchEvent(new CustomEvent('ota:storage', { detail:{ ok, message, bytes:this.storageBytes, savedAt:this.state.lastSavedAt } }));
    },
    save() {
        if(this.loadFailed) {
            this.notifyStorage(false, this.lastSaveError || '本地工作区读取失败；请先备份或清除损坏的数据');
            return false;
        }
        try {
            this.state.schemaVersion = WORKSPACE_SCHEMA_VERSION;
            this.state.lastSavedAt = new Date().toISOString();
            const json = JSON.stringify(this.serializeState());
            localStorage.setItem(STORE_KEY, json);
            this.storageBytes = json.length * 2;
            this.lastSaveError = null;
            if(this.migratedFrom && typeof localStorage.removeItem === 'function') {
                localStorage.removeItem(this.migratedFrom);
                this.migratedFrom = null;
            }
            this.notifyStorage(true, this.state.persistRaw === false ? '规则已保存，原始数据仅保留在本次会话' : '工作区已保存到此设备');
            return true;
        } catch(e) {
            this.lastSaveError = e && e.name === 'QuotaExceededError'
                ? '本地存储空间不足；当前页面数据仍在，请立即备份工作区或关闭原始数据持久化。'
                : `本地保存失败：${e.message || e}`;
            this.notifyStorage(false, this.lastSaveError);
            return false;
        }
    },
    scheduleSave(delay=320) {
        if(typeof setTimeout !== 'function') return this.save();
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.save(), delay);
        return true;
    },
    clearLocalData() {
        try {
            if(typeof localStorage.removeItem === 'function') {
                localStorage.removeItem(STORE_KEY);
                LEGACY_STORE_KEYS.forEach(key => localStorage.removeItem(key));
                localStorage.removeItem('v16_4_inputHeight');
            }
            this.loadFailed = false;
            this.lastSaveError = null;
            return true;
        } catch(e) {
            this.lastSaveError = `清除本地数据失败：${e.message || e}`;
            return false;
        }
    },
    isSafePayload(value, depth=0) {
        if(depth > 12) return false;
        if(value === null || ['string','number','boolean'].includes(typeof value)) return true;
        if(Array.isArray(value)) return value.length <= 10000 && value.every(item => this.isSafePayload(item, depth + 1));
        if(typeof value !== 'object') return false;
        const keys = Object.keys(value);
        if(keys.some(key => ['__proto__','prototype','constructor'].includes(key))) return false;
        return keys.length <= 2000 && keys.every(key => this.isSafePayload(value[key], depth + 1));
    },
    importWorkspace(payload, merge=false) {
        if(!payload || typeof payload !== 'object' || !this.isSafePayload(payload)) throw new Error('工作区文件包含不安全或过深的数据结构');
        if(!['ota-workspace','table-tool-tabs'].includes(payload.kind)) throw new Error('不是受支持的工作区文件');
        if(!Array.isArray(payload.docs) || payload.docs.length === 0 || payload.docs.length > 100) throw new Error('工作区页签数量无效');
        if(payload.schemaVersion && payload.schemaVersion > WORKSPACE_SCHEMA_VERSION) throw new Error('该工作区由更高版本创建');
        const imported = payload.docs.map((doc, idx) => {
            if(!doc || typeof doc !== 'object') throw new Error(`第 ${idx + 1} 个页签无效`);
            const raw = typeof doc.raw === 'string' ? doc.raw : '';
            if(raw.length * 2 > MAX_IMPORT_BYTES) throw new Error(`页签“${doc.title || idx + 1}”的数据超过 25 MB 限制`);
            return { id:typeof doc.id === 'string' ? doc.id : '', title:typeof doc.title === 'string' ? doc.title : `Analysis ${idx + 1}`, raw, ui:(doc.ui && typeof doc.ui === 'object') ? doc.ui : {} };
        });
        const base = merge ? this.state.docs.slice() : [];
        const usedIds = new Set(base.map(doc => doc.id));
        imported.forEach(doc => {
            if(!doc.id || usedIds.has(doc.id)) doc.id = this.generateDocId();
            usedIds.add(doc.id);
            base.push(doc);
        });
        this.state.docs = base;
        const usedTitles = new Set();
        this.state.docs.forEach((doc, idx) => {
            this.normalizeDoc(doc, idx);
            const clean = String(doc.title || `Analysis ${idx + 1}`).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim() || `Analysis ${idx + 1}`;
            let title = clean.slice(0, 40), suffixNo = 2;
            while(usedTitles.has(title)) {
                const suffix = ` (${suffixNo++})`;
                title = `${clean.slice(0, Math.max(1, 40 - suffix.length))}${suffix}`;
            }
            doc.title = title;
            usedTitles.add(title);
        });
        if(Array.isArray(payload.globalViews)) this.state.globalViews = payload.globalViews.slice(0, 500);
        this.state.activeId = imported[0].id;
        this.state.nextAnalysisSeq = Math.max(this.state.nextAnalysisSeq || 1, this.getMaxAnalysisNumber() + 1);
        this.loadFailed = false;
        this.save();
        return imported.length;
    },
    createDefaultUI() {
        return { displayTables:null, enabledViews:null, targetTable:"", rules:{}, columnFilters:{}, collapsedTables:{}, previewModes:{}, tablePages:{}, previewTable:"", pageSize:100, cellEdits:{}, sidebarTab:"data", importFormat:"auto", importHeaderMode:"auto", exportOnlyChecked:false, exportCols:'all' };
    },
    normalizeDoc(doc, idx=0) {
        if(!doc.id) doc.id = this.generateDocId();
        if(!doc.title) doc.title = this.makeUniqueTitle(`Analysis ${idx + 1}`, doc.id);
        if(doc.raw === undefined || doc.raw === null) doc.raw = "";
        const defaults = this.createDefaultUI();
        doc.ui = Object.assign(defaults, doc.ui || {});
        if(!doc.ui.rules) doc.ui.rules = {};
        if(!doc.ui.columnFilters) doc.ui.columnFilters = {};
        if(!doc.ui.collapsedTables) doc.ui.collapsedTables = {};
        if(!doc.ui.previewModes) doc.ui.previewModes = {};
        if(!doc.ui.tablePages) doc.ui.tablePages = {};
        if(!doc.ui.cellEdits) doc.ui.cellEdits = {};
        if(![50,100,250,500].includes(Number(doc.ui.pageSize))) doc.ui.pageSize = 100;
        if(!doc.ui.sidebarTab) doc.ui.sidebarTab = 'data';
        if(!doc.ui.importFormat) doc.ui.importFormat = 'auto';
        if(!doc.ui.importHeaderMode) doc.ui.importHeaderMode = 'auto';
        return doc;
    },
    generateDocId() {
        let id;
        do {
            id = `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        } while(this.state.docs.some(d => d.id === id));
        return id;
    },
    getAnalysisNumber(title='') {
        const m = String(title || '').trim().match(/^Analysis\s+(\d+)$/i);
        return m ? parseInt(m[1], 10) : 0;
    },
    getMaxAnalysisNumber() {
        return Math.max(0, ...(this.state.docs || []).map(d => this.getAnalysisNumber(d && d.title)));
    },
    makeUniqueTitle(title, excludeId=null) {
        const clean = String(title || 'Analysis').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Analysis';
        const used = new Set((this.state.docs || []).filter(d => d.id !== excludeId).map(d => String(d.title || '').trim()));
        const trimWithSuffix = (base, suffix='') => (base.slice(0, Math.max(1, 40 - suffix.length)) + suffix).trim();
        const base = trimWithSuffix(clean);
        if(!used.has(base)) return base;
        let i = 2;
        let suffix = ` (${i})`;
        let next = trimWithSuffix(clean, suffix);
        while(used.has(next)) {
            suffix = ` (${++i})`;
            next = trimWithSuffix(clean, suffix);
        }
        return next;
    },
    nextDocTitle() {
        const n = Math.max(this.state.nextAnalysisSeq || 1, this.getMaxAnalysisNumber() + 1);
        this.state.nextAnalysisSeq = n + 1;
        return this.makeUniqueTitle(`Analysis ${n}`);
    },
    addDoc(initial={}) {
        const title = initial.title ? this.makeUniqueTitle(initial.title) : this.nextDocTitle();
        const doc = this.normalizeDoc(Object.assign({ id:this.generateDocId(), title, raw:"" }, initial, { title }), this.state.docs.length);
        this.state.docs.push(doc);
        this.state.activeId = doc.id;
        this.save();
        return doc;
    },
    removeDoc(id) {
        if(this.state.docs.length<=1) return 'last_doc';
        const idx = this.state.docs.findIndex(d=>d.id===id);
        if(idx < 0) return false;
        this.state.docs.splice(idx,1);
        if(this.state.activeId===id) this.state.activeId = this.state.docs[Math.max(0,idx-1)].id;
        this.save();
        return true;
    },
    renameDoc(id, title) {
        const doc = this.state.docs.find(d => d.id === id);
        if(!doc) return false;
        const next = String(title ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
        if(!next) return false;
        doc.title = this.makeUniqueTitle(next, id);
        this.save();
        return true;
    },
    moveDoc(sourceId, targetId, place='before') {
        if(!sourceId || !targetId || sourceId === targetId) return false;
        const from = this.state.docs.findIndex(d => d.id === sourceId);
        if(from < 0) return false;
        const [doc] = this.state.docs.splice(from, 1);
        let to = this.state.docs.findIndex(d => d.id === targetId);
        if(to < 0) {
            this.state.docs.splice(from, 0, doc);
            return false;
        }
        if(place === 'after') to += 1;
        this.state.docs.splice(to, 0, doc);
        this.save();
        return true;
    },
    curr() { 
        if(!Array.isArray(this.state.docs)) this.state.docs = [];
        if(this.state.docs.length === 0) this.addDoc();
        let d = this.state.docs.find(d=>d.id===this.state.activeId) || this.state.docs[0];
        if(!d) d = this.addDoc();
        return this.normalizeDoc(d, this.state.docs.indexOf(d));
    },
    updateUI(k, v) { this.curr().ui[k]=v; this.scheduleSave(); },
    updateRule(table, field, value) {
        const ui = this.curr().ui; if(!ui.rules[table]) ui.rules[table] = {}; ui.rules[table][field] = value; this.scheduleSave();
    },
    clearCellEdits() {
        const ui = this.curr().ui;
        const edits = ui.cellEdits && typeof ui.cellEdits === 'object' ? ui.cellEdits : {};
        const hadEdits = Object.keys(edits).length > 0;
        ui.cellEdits = {};
        if(hadEdits) this.scheduleSave();
        return hadEdits;
    },
    setCopyFormat(format='default') {
        this.state.copyFormat = COPY_FORMATS.includes(format) ? format : 'default';
        this.save();
    },
    setPersistRaw(enabled=true) {
        this.state.persistRaw = enabled !== false;
        this.save();
    },
    setSpreadsheetSafe(enabled=true) {
        this.state.spreadsheetSafe = enabled !== false;
        this.save();
    },
    toggleTheme() { this.state.theme = this.state.theme==='light'?'dark':'light'; this.applyTheme(); this.save(); },
    applyTheme() { document.documentElement.setAttribute('data-theme', this.state.theme); },

    // ── Command / event protocol ──

    /**
     * Subscribe to state-change events.
     * @param {(event: string, payload: any) => void} fn
     * @returns {() => void} unsubscribe function
     */
    onChange(fn) {
        if (!this._listeners) this._listeners = new Set();
        this._listeners.add(fn);
        return () => { if (this._listeners) this._listeners.delete(fn); };
    },

    /**
     * Emit a state-change event to all listeners (batched async).
     * Multiple calls within the same synchronous block are coalesced:
     * all queued events are delivered together in one async tick.
     *
     * Falls back to synchronous delivery when setTimeout is unavailable.
     */
    _notify(event, payload) {
        if (!this._listeners || this._listeners.size === 0) return;
        if (!this._notifyQueue) this._notifyQueue = [];
        this._notifyQueue.push({ event, payload });

        if (typeof setTimeout === 'function') {
            if (this._notifyTimer === null) {
                this._notifyTimer = setTimeout(() => {
                    this._notifyTimer = null;
                    const queue = this._notifyQueue;
                    this._notifyQueue = null;
                    if (!queue || !this._listeners) return;
                    queue.forEach(({ event: evt, payload: pl }) => {
                        this._listeners.forEach(fn => {
                            try { fn(evt, pl); } catch (e) { /* swallow */ }
                        });
                    });
                }, 0);
            }
        } else {
            // Synchronous fallback (Node tests without setTimeout)
            const queue = this._notifyQueue;
            this._notifyQueue = null;
            if (!queue || !this._listeners) return;
            queue.forEach(({ event: evt, payload: pl }) => {
                this._listeners.forEach(fn => {
                    try { fn(evt, pl); } catch (e) { /* swallow */ }
                });
            });
        }
    },

    /**
     * Execute a state transition. This is the canonical entry-point for all
     * state-changing operations from the UI layer.
     *
     * Existing convenience methods (addDoc, updateUI, etc.) remain available
     * and will gradually delegate here.
     *
     * @param {string} action  Command name (e.g. 'tab:create')
     * @param {any}     payload Command-specific data
     * @returns Result of the transition (varies by action)
     */
    transition(action, payload) {
        switch (action) {
            // ── Tabs ──
            case 'tab:create': {
                const doc = this.addDoc(payload || {});
                this._notify('tab:created', { id: doc.id });
                this._notify('state:changed', {});
                return doc;
            }
            case 'tab:activate': {
                const id = payload && payload.id;
                if (!id) return false;
                const prev = this.state.activeId;
                if (prev === id && !(payload && payload.force)) return false;
                if (!this.state.docs.some(d => d.id === id)) return false;
                this.state.activeId = id;
                this.save();
                this._notify('tab:activated', { id, previousId: prev });
                this._notify('state:changed', {});
                return true;
            }
            case 'tab:remove': {
                const result = this.removeDoc(payload && payload.id);
                if (result === true) {
                    this._notify('tab:removed', { id: payload.id });
                    this._notify('state:changed', {});
                }
                return result;
            }
            case 'tab:rename': {
                const id = payload && payload.id;
                const title = payload && payload.title;
                if (!id || title === undefined || title === null) return false;
                const ok = this.renameDoc(id, title);
                if (ok) {
                    this._notify('tab:renamed', { id, title: this.state.docs.find(d => d.id === id)?.title || title });
                    this._notify('state:changed', {});
                }
                return ok;
            }
            case 'tab:reorder': {
                const sourceId = payload && payload.sourceId;
                const targetId = payload && payload.targetId;
                const place = (payload && payload.place) || 'before';
                if (!sourceId || !targetId) return false;
                const ok = this.moveDoc(sourceId, targetId, place);
                if (ok) {
                    this._notify('tab:reordered', { sourceId, targetId, place });
                    this._notify('state:changed', {});
                }
                return ok;
            }

            // ── Source ──
            case 'source:changed': {
                // Payload: { text }  — raw text was modified by user
                const doc = this.curr();
                doc.raw = payload && typeof payload.text === 'string' ? payload.text : '';
                this._notify('source:textChanged', { text: doc.raw });
                this._notify('state:changed', {});
                this.scheduleSave();
                return doc.raw;
            }

            // ── Parse ──
            case 'parse:completed': {
                // Emitted by App.run() after Parser.parse() succeeds.
                // Payload: { tables, elapsed, diagnostics }
                this._notify('parse:completed', payload || {});
                this._notify('state:changed', {});
                return true;
            }

            // ── Filters ──
            case 'filter:global': {
                const doc = this.curr();
                doc.ui.globalFilter = payload && payload.value ? String(payload.value) : '';
                this.scheduleSave();
                this._notify('filter:changed', { scope: 'global', value: doc.ui.globalFilter });
                this._notify('state:changed', {});
                return doc.ui.globalFilter;
            }
            case 'filter:table': {
                const tableName = payload && payload.table;
                const field = payload && payload.field;
                const value = payload && payload.value ? String(payload.value) : '';
                if (!tableName || !field) return false;
                this.updateRule(tableName, field, value);
                this._notify('filter:changed', { scope: 'table', table: tableName, field, value });
                this._notify('state:changed', {});
                return true;
            }
            case 'filter:column': {
                // Payload: { table, column, value }
                const table = payload && payload.table;
                const column = payload && payload.column;
                if (!table || !column) return false;
                const ui = this.curr().ui;
                if (!ui.columnFilters) ui.columnFilters = {};
                if (!ui.columnFilters[table]) ui.columnFilters[table] = {};
                const val = (payload.value || '').trim();
                if (val) {
                    ui.columnFilters[table][column] = val;
                } else {
                    delete ui.columnFilters[table][column];
                }
                this.save();
                this._notify('filter:changed', { scope: 'column', table, column, value: val });
                this._notify('state:changed', {});
                return true;
            }

            // ── Cell editing ──
            case 'cell:edit':
                // Handled via App.setCellEdit — delegates to existing method
                return null;

            // ── Preview ──
            case 'preview:renderRequested': {
                // Lightweight trigger — App.onChange listens for this and re-renders
                this._notify('preview:renderRequested', {});
                this._notify('state:changed', {});
                return true;
            }
            case 'preview:tableCollapse': {
                const doc = this.curr();
                if (!doc.ui.collapsedTables) doc.ui.collapsedTables = {};
                doc.ui.collapsedTables[payload.table] = !doc.ui.collapsedTables[payload.table];
                this.save();
                this._notify('preview:changed', {});
                this._notify('state:changed', {});
                return true;
            }
            case 'preview:tablePage': {
                const doc = this.curr();
                if (!doc.ui.tablePages) doc.ui.tablePages = {};
                doc.ui.tablePages[payload.table] = Math.max(1, Number(payload.page) || 1);
                this.save();
                this._notify('preview:changed', {});
                this._notify('state:changed', {});
                return true;
            }

            // ── UI settings ──
            case 'ui:sidebarTab': {
                this.updateUI('sidebarTab', payload && payload.tab || 'data');
                this._notify('ui:sidebarChanged', { tab: payload && payload.tab });
                this._notify('state:changed', {});
                return true;
            }
            case 'ui:copyFormat': {
                this.setCopyFormat(payload && payload.format);
                this._notify('ui:copyFormatChanged', { format: this.state.copyFormat });
                this._notify('state:changed', {});
                return true;
            }
            case 'ui:theme': {
                this.toggleTheme();
                this._notify('ui:themeChanged', { theme: this.state.theme });
                this._notify('state:changed', {});
                return this.state.theme;
            }
            case 'ui:persistRaw': {
                this.setPersistRaw(payload && payload.enabled !== false);
                this._notify('ui:persistRawChanged', { enabled: this.state.persistRaw });
                this._notify('state:changed', {});
                return this.state.persistRaw;
            }

            // ── Workspace ──
            case 'workspace:save': {
                const ok = this.save();
                if (ok) {
                    this._notify('workspace:saved', { bytes: this.storageBytes, savedAt: this.state.lastSavedAt });
                } else {
                    this._notify('workspace:saveFailed', { error: this.lastSaveError });
                }
                return ok;
            }

            default:
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[Store] unknown transition action: %s', action);
                }
                return null;
        }
    }
};

    return { APP_VERSION, WORKSPACE_SCHEMA_VERSION, STORE_KEY, LEGACY_STORE_KEYS, MAX_IMPORT_BYTES, COPY_FORMATS, Store };
});
