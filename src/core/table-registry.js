OTA.define('table-registry', ["store", "joiner", "background-service", "table-utils"], ({Store}, {Joiner}, {BackgroundService}, {TableUtils}) => {
/* TableRegistry — single source of truth for parsed table data and metadata.

   This module holds local tables or Worker descriptors (tables, format, diagnostics,
   candidates) and provides column/table metadata queries. It breaks the
   circular dependency between join-editor and app.

   App.run() calls setResult() after each parse. All downstream consumers
   read via getRaw() / getCols() / getAvailableTables() / getDiagnostics() etc.
*/

const TableRegistry = {
    /** @type {Object[]} raw parsed tables */
    _raw: [],
    _pageCells:new Map(),
    _cardSummaries:new Map(),
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
        for(const id of this._cardSummaries.keys()) if(!Store.getCard(id)) this._cardSummaries.delete(id);
        return true;
    },
    getCardSummary(id) {
        const card = Store.getCard(id), saved = this._cardSummaries.get(id);
        if(!card || !saved || saved.sourceRevision !== card.sourceRevision
            || saved.format !== (card.ui.importFormat || 'auto') || saved.headerMode !== (card.ui.importHeaderMode || 'auto')) return null;
        return saved.summary;
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
     * Store the full parse result. Called by App.run() after each parse.
     * @param {Object} result — ImportEngine.parse() return value
     */
    setResult(result) {
        this._pageCells.clear();
        this._poolNames = [];
        this._previewSummary = null;
        this._diagnosticCount=result?.diagnosticCount ?? result?.diagnostics?.length ?? 0;
        this._background=!!result?.background;
        this._datasetKey=result?.datasetKey;
        this._parseOptions=result?.parseOptions;
        this._sourceRevision=result?.sourceRevision;
        if (!result) {
            this._raw = [];
            this._format = 'empty';
            this._label = '空输入';
            this._diagnostics = [];
            this._candidates = [];
            return;
        }
        this._raw = result.tables || [];
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
    getPoolNames() { return this._poolNames; },
    isBackground() {return !!this._background;},
    getPreviewSummary() { return this._previewSummary || null; },
    setPreview(tables) {
        this._poolNames = (tables || []).map(item => item.table.name);
        this._previewSummary = tables ? Object.freeze({tableCount:tables.length,
            rowCount:tables.reduce((sum, item) => sum + (item.res.totalRows ?? item.res.rows.length), 0)}) : null;
        this._pageCells.clear();
        if(!tables) return;
        for(const {table,res} of tables) {
            if(table.isView || !table.remote)continue;
            const cells=new Map();this._pageCells.set(table.name,cells);
            for(const record of res.rows)cells.set(record._sourceRow,{...record,d:record.d.slice()});
        }
    },
    hasCell(name,row,col) {
        const table=this.getTable(name);
        return !!table && !table.isView && Number.isInteger(row) && row>=0 && row<(table.remote?table.rowCount:table.rows.length) && Number.isInteger(col) && col>=0 && col<table.headers.length;
    },
    getCell(name,row,col) {
        const table=this.getTable(name);if(!this.hasCell(name,row,col))return undefined;
        if(!table.remote)return table.rows[row][col];
        const record=this._pageCells.get(name)?.get(row),index=record?._sourceCols.indexOf(col);
        return index>=0?record.d[index]:undefined;
    },
    updateCell(name,row,col,value) {
        const table=this.getTable(name);if(!this.hasCell(name,row,col))return;
        if(!table.remote){table.rows[row][col]=value;return;}
        const record=this._pageCells.get(name)?.get(row),index=record?._sourceCols.indexOf(col);
        if(index>=0)record.d[index]=value;
    },
    getBackgroundInput() {
        const doc=Store.getDocument();
        if(!doc || doc.sourceRevision!==this._sourceRevision)throw new Error('数据源已变化，请重新解析');
        const project=Store.getActiveProject() || {};
        const visible=(project.cardIds || [])
            .map(id => Store.getCard(id))
            .filter(card => card && card.visible !== false)
            .map(card => ({ id:card.id, name:card.title || card.id }));
        const cards=[];
        for(const v of visible) {
            const card=Store.getCard(v.id);
            if(!card || !card.raw) continue;
            const config={format:card.ui.importFormat || 'auto', headerMode:card.ui.importHeaderMode || 'auto'};
            cards.push({ id:card.id, sourceRevision:card.sourceRevision, raw:card.raw, config,
                options:card.id === doc.id && this._parseOptions ? this._parseOptions : {...config, html:''} });
        }
        const cardUis={};
        for(const v of visible) {
            const card=Store.getCard(v.id);
            if(card) cardUis[v.id]=Object.assign({}, card.ui, { enabledViews:project.enabledViews || [] });
        }
        const ui=Object.assign({}, doc.ui, { enabledViews:project.enabledViews || [] });
        return { rawTables:this._raw, ui, globalViews:project.views || [], visible, cardUis, cards,
            text:doc.raw, options:this._parseOptions, datasetKey:this._datasetKey, docId:doc.id, sourceRevision:doc.sourceRevision };
    },
    getJoinStats(cfg) {return BackgroundService.stats(this.getBackgroundInput(),cfg);},

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
        const raws = this._raw.map(t => t.name);
        const views = (Store.getViews() || []).map(v => v.view);
        return [...raws, ...views];
    },

    /** @returns {string[]} column headers for a table or view by name */
    getCols(tableName) {
        if (!tableName) return [];
        const raw = this._raw.find(t => t.name === tableName);
        if (raw) return raw.headers.slice();
        const views = Store.getViews() || [];
        const view = views.find(v => v.view === tableName);
        if (view) {
            return Joiner.getHeaders(this._raw,view,views);
        }
        return [];
    },

    // ── Backward-compatible alias (setRaw still works, used by old callers) ──

    /** @deprecated Use setResult() instead */
    setRaw(tables) {
        this._background=false;this._pageCells.clear();
        this._raw = tables || [];
    },
};

    return { TableRegistry };
});
