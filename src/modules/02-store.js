OTA.define('store', [], () => {
/* Core */
const APP_VERSION = '20.2.0';
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
        if(this.state.docs.length<=1) return alert("至少保留一个页签");
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
    applyTheme() { document.documentElement.setAttribute('data-theme', this.state.theme); }
};

    return { APP_VERSION, WORKSPACE_SCHEMA_VERSION, STORE_KEY, LEGACY_STORE_KEYS, MAX_IMPORT_BYTES, COPY_FORMATS, Store };
});
