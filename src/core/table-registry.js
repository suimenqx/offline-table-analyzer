OTA.define('table-registry', ["store", "joiner", "background-service", "table-utils", "query-service"], ({Store}, {Joiner}, {BackgroundService}, {TableUtils}, {QueryService}) => {
/* TableRegistry — single source of truth for parsed table data and metadata.

   This module holds local tables or Worker descriptors (tables, format, diagnostics,
   candidates) and provides column/table metadata queries. It breaks the
   circular dependency between join-editor and app.

   ExtractionSession calls setResult() after each current parse. All downstream consumers
   read via getRaw() / getCols() / getAvailableTables() / getDiagnostics() etc.
*/

const TableRegistry = {
    /** @type {Object[]} raw parsed tables */
    _raw: [],
    _pageCells:new Map(),
    _cardSummaries:new Map(),
    _cardTables:new Map(),
    /** Session-only counts; never retain raw text or complete tables here. */
    recordParse(context, result) {
        const card = Store.getCard(context?.docId);
        if(!card || card.sourceRevision !== context.sourceRevision) return false;
        const config = context.config || context.options || {};
        const format = config.format || 'auto', headerMode = config.headerMode || 'auto';
        if((card.ui.importFormat || 'auto') !== format || (card.ui.importHeaderMode || 'auto') !== headerMode) return false;
        this._cardSummaries.set(card.id, {sourceRevision:card.sourceRevision, format, headerMode,
            summary:Object.freeze({format:result.format, label:result.label || result.format,
                tableCount:(result.tables || []).length,
                rowCount:(result.tables || []).reduce((sum, table) => sum + TableUtils.rowCount(table), 0)})});
        this._cardTables.set(card.id, {sourceRevision:card.sourceRevision, format, headerMode,
            tables:(result.tables || []).filter(table=>table && typeof table.name==='string' && Array.isArray(table.headers))
                .map(table=>({name:table.name,headers:table.headers.slice(),rows:[]}))});
        for(const id of this._cardSummaries.keys()) if(!Store.getCard(id)) {this._cardSummaries.delete(id);this._cardTables.delete(id);}
        return true;
    },
    getCardSummary(id) {
        const card = Store.getCard(id), saved = this._cardSummaries.get(id);
        if(!card || !saved || saved.sourceRevision !== card.sourceRevision
            || saved.format !== (card.ui.importFormat || 'auto') || saved.headerMode !== (card.ui.importHeaderMode || 'auto')) return null;
        return saved.summary;
    },
    /** Column-only catalog for visible cards; row data remains in Worker for multi-card sessions. */
    getAvailableRawTables() {
        const project=Store.getActiveProject();
        if(!project) return this._raw;
        const entries=[];
        for(const id of project.cardIds || []) {
            const card=Store.getCard(id),saved=this._cardTables.get(id);
            if(!card || !saved || saved.sourceRevision!==card.sourceRevision
                || saved.format!==(card.ui.importFormat || 'auto') || saved.headerMode!==(card.ui.importHeaderMode || 'auto'))continue;
            for(const table of saved.tables)entries.push({cardId:id,cardName:card.title || id,visible:card.visible!==false,table});
        }
        if(!entries.length) {
            const active=Store.getDocument();
            if(active && active.visible!==false && (project.cardIds || []).includes(active.id)) return this._raw;
        }
        return QueryService.computePool(entries).map(entry=>({name:entry.displayName,headers:entry.columns.slice(),rows:[],isView:false}));
    },
    /** 最近一次预览的表池显示名（view 引用可用性判定用） */
    _poolNames: [],
    /** @type {string} format id from the last parse result */
    _format: 'empty',
    /** @type {string} human-readable format label */
    _label: '',
    /** @type {Object[]} parse diagnostics */
    _diagnostics: [],
    /** @type {Object[]} format candidates with scores */
    _candidates: [],

    /**
     * Store the full parse result or Worker descriptors published by ExtractionSession.
     * @param {Object} result — ImportEngine.parse() return value
     */
    setResult(result, readLocalDataset=null) {
        this._pageCells.clear();
        this._previewScope=null;
        this._poolNames = [];
        this._previewSummary = null;
        this._diagnosticCount=result?.diagnosticCount ?? result?.diagnostics?.length ?? 0;
        this._background=!!result?.background;
        this._readLocalDataset=readLocalDataset;
        this._datasetKey=result?.datasetKey;
        this._parseOptions=result?.parseOptions;
        this._sourceRevision=result?.sourceRevision;
        const card = Store.getDocument();
        this._localSource = card && {docId:card.id, sourceRevision:card.sourceRevision,
            format:card.ui.importFormat || 'auto', headerMode:card.ui.importHeaderMode || 'auto'};
        if (!result) {
            this._raw = [];
            this._format = 'empty';
            this._label = '空输入';
            this._diagnostics = [];
            this._candidates = [];
            return;
        }
        const edits = card?.ui.cellEdits;
        const tables=result.tables || [];
        if(readLocalDataset) this._raw = tables.map(table=>TableUtils.describeTable(table,{samples:true}));
        else this._raw = this._background ? tables : tables.map(table=>TableUtils.withCellEdits(table, edits?.[`$${table.name}`]));
        this._format = result.format || 'empty';
        this._label = result.label || '';
        this._diagnostics = result.diagnostics || [];
        this._candidates = result.candidates || [];
    },

    // ── Read accessors ──

    /** @returns {Object[]} all raw parsed tables */
    getRaw() { return this._raw; },
    /** Window-only single-card query scope; source diagnostics still use getRaw(). */
    getQueryTables() { const card=Store.getDocument(); return card && card.visible !== false ? this._raw : []; },
    setPoolNames(names) { this._poolNames = (names || []).slice(); },
    getPoolNames() {
        if(Store.getActiveProject()) {
            const names=this.getAvailableRawTables().map(table=>table.name);
            if(names.length) return names;
        }
        return this._poolNames;
    },
    isBackground() {return !!this._background;},
    getPreviewSummary() { return this._previewSummary || null; },
    setPreview(tables) {
        this._poolNames = (tables || []).map(item => item.table.name);
        this._previewSummary = tables ? Object.freeze({tableCount:tables.length,
            rowCount:tables.reduce((sum, item) => sum + (item.res.totalRows ?? item.res.rows.length), 0)}) : null;
        this._pageCells.clear();
        this._previewScope=this._background && tables?.length ? JSON.stringify(this.getProjectSources()) : null;
        if(!tables) return;
        for(const {table,res} of tables) {
            if(!this._background || table.isView || !table.remote || table.editSource === null)continue;
            const cells=new Map();this._pageCells.set(table.name,{table,cells});
            for(const record of res.rows)cells.set(record._sourceRow,{...record,d:record.d.slice()});
        }
    },
    cellSource(name,row,col) {
        const table = this._background ? this._pageCells.get(name)?.table : this.getTable(name);
        if(!table || table.isView || table.editSource === null || !Number.isInteger(row) || row<0 ||
            row>=TableUtils.rowCount(table) || !Number.isInteger(col) || col<0 || col>=table.headers.length) return null;
        if(this._background && this._previewScope !== JSON.stringify(this.getProjectSources())) return null;
        const project = Store.getActiveProject();
        if(this._background && !table.editSource && project?.cardIds.length !== 1) return null;
        const source = table.editSource || (this._localSource && {...this._localSource,table:name});
        const card = source && Store.getCard(source.docId);
        if(!card || card.visible === false || !project?.cardIds.includes(card.id)) return null;
        return { ...source, sourceRevision:source.sourceRevision ?? card.sourceRevision,
            format:source.format ?? (card.ui.importFormat || 'auto'), headerMode:source.headerMode ?? (card.ui.importHeaderMode || 'auto') };
    },
    hasCell(name,row,col) { return !!this.cellSource(name,row,col); },
    getCell(name,row,col) {
        if(!this.cellSource(name,row,col))return undefined;
        if(!this._background)return this.getTable(name).rows[row][col];
        const record=this._pageCells.get(name)?.cells.get(row),index=record?._sourceCols.indexOf(col);
        return index>=0?record.d[index]:undefined;
    },
    updateCell(name,row,col,value,source) {
        const current = this.cellSource(name,row,col);
        if(!current || (source && (current.docId !== source.docId || current.table !== source.table))) return;
        if(!this._background) {
            const table=this.getTable(name);
            const next=TableUtils.withCellEdits(table,{[row]:{[col]:value}});
            this._raw=this._raw.map(item=>item===table ? next : item);
            return;
        }
        const record=this._pageCells.get(name)?.cells.get(row),index=record?._sourceCols.indexOf(col);
        if(index>=0)record.d[index]=value;
    },
    getProjectSources() {
        const project=Store.getActiveProject();
        const cards=(project?.cardIds || []).map(id=>Store.getCard(id)).filter(Boolean);
        const sources=cards.map(card=>({id:card.id, name:card.title || card.id}));
        const visible=cards.flatMap((card,i)=>{
            const activeHtml=this._localSource?.docId === card.id && this._localSource.sourceRevision === card.sourceRevision && this._parseOptions?.html;
            if(card.visible === false || !(card.raw || activeHtml)) return [];
            return [{...sources[i], sourceRevision:card.sourceRevision,
                config:{format:card.ui.importFormat || 'auto', headerMode:card.ui.importHeaderMode || 'auto'}}];
        });
        return {sources,visible};
    },
    getBackgroundInput() {
        const doc=Store.getDocument();
        if(!doc || doc.sourceRevision!==this._sourceRevision)throw new Error('数据源已变化，请重新解析');
        const project=Store.getActiveProject() || {};
        const {sources,visible}=this.getProjectSources();
        const cards=[];
        for(const v of visible) {
            const card=Store.getCard(v.id);
            const config=v.config;
            cards.push({ id:card.id, sourceRevision:card.sourceRevision, raw:card.raw, config,
                readLocalDataset:card.id === doc.id ? this._readLocalDataset : null,
                options:card.id === doc.id && this._parseOptions ? this._parseOptions : {...config, html:''} });
        }
        const cardUis={};
        for(const v of visible) {
            const card=Store.getCard(v.id);
            if(card) cardUis[v.id]=Object.assign({}, card.ui, { enabledViews:project.enabledViews || [] });
        }
        const ui=Object.assign({}, doc.ui, { enabledViews:project.enabledViews || [] });
        return { rawTables:this._raw, ui, globalViews:project.views || [], sources, visible, cardUis, cards,
            text:doc.raw, options:this._parseOptions, datasetKey:this._datasetKey, docId:doc.id, sourceRevision:doc.sourceRevision };
    },
    getJoinStats(cfg, {samples=false}={}) {
        if(this.isBackground()) return BackgroundService.stats(this.getBackgroundInput(),cfg,samples);
        return Joiner.stats(this.getQueryTables(),cfg,Store.getViews(),[],{samples});
    },
    checkViewBudget(enabledViews, globalViews=Store.getViews(), known={}) {
        const input = this.isBackground() ? this.getBackgroundInput() : {rawTables:this.getQueryTables(), ui:Store.getActiveUI()};
        input.globalViews = globalViews;
        input.ui = {...input.ui,enabledViews};
        const existing = new Set(Store.getEnabledViews());
        const check = {...known,requireAvailable:enabledViews.filter(name => !existing.has(name))};
        return this.isBackground() ? BackgroundService.joinRequest('checkViewBudget',input,check)
            : QueryService.checkViewBudget(input,check);
    },
    getJoinSuggestions(left,right) {
        if(this.isBackground()) return BackgroundService.joinRequest('suggestKeys',this.getBackgroundInput(),{left,right});
        return Joiner.suggestKeys(this.getQueryTables(),left,right,Store.getViews());
    },

    /** @returns {Object|null} a raw table by name, or null */
    getTable(name) {
        return this._raw.find(t => t.name === name) || null;
    },

    /** @returns {string} last parse result's format id */
    getFormat() { return this._format; },

    /** @returns {string} last parse result's human label */
    getLabel() { return this._label; },

    /** @returns {Object[]} diagnostics from last parse */
    getDiagnostics() { return this._diagnostics; },

    /** @returns {Object[]} format candidates from last parse */
    getCandidates() { return this._candidates; },

    /** @returns {Object} the full last parse result (shallow copy) */
    getLastResult() {
        return {
            tables: this._raw,
            format: this._format,
            label: this._label,
            diagnostics: this._diagnostics,
            diagnosticCount:this._diagnosticCount,
            candidates: this._candidates,
        };
    },

    /** @returns {string[]} all table and view names (raw + global JOIN views) */
    getAvailableTables() {
        const raws = this.getAvailableRawTables().map(t => t.name);
        const views = (Store.getViews() || []).map(v => v.view);
        return [...raws, ...views];
    },

    /** Resolve headers and preserve the reason an upstream schema is unavailable. */
    describeSource(tableName) {
        if (!tableName) return {headers:[]};
        const rawTables = this.getAvailableRawTables();
        const raw = rawTables.find(t => t.name === tableName);
        if (raw) return {headers:raw.headers.slice()};
        const views = Store.getViews() || [];
        const view = views.find(v => v.view === tableName);
        return view ? Joiner.describeView(rawTables,view,views)
            : {headers:[],error:`来源“${tableName}”不在当前表池`};
    },
    /** @returns {string[]} column headers for a table or view by name */
    getCols(tableName) {
        return this.describeSource(tableName).headers;
    },

    // ── Backward-compatible alias (setRaw still works, used by old callers) ──

    /** @deprecated Use setResult() instead */
    setRaw(tables) {
        this.setResult({...this.getLastResult(),tables});
    },
};

    return { TableRegistry };
});
