OTA.define('table-registry', ["store", "joiner", "background-service"], ({Store}, {Joiner}, {BackgroundService}) => {
/* TableRegistry — single source of truth for parsed table data and metadata.

   This module holds the complete parse result (tables, format, diagnostics,
   candidates) and provides column/table metadata queries. It breaks the
   circular dependency between join-editor and app.

   App.run() calls setResult() after each parse. All downstream consumers
   read via getRaw() / getCols() / getAvailableTables() / getDiagnostics() etc.
*/

const TableRegistry = {
    /** @type {Object[]} raw parsed tables */
    _raw: [],
    /** @type {string} last successful format id */
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
    isBackground() {return !!this._background;},
    getBackgroundInput() {
        const doc=Store.getDocument();
        if(doc.sourceRevision!==this._sourceRevision)throw new Error('数据源已变化，请重新解析');
        return {rawTables:this._raw,ui:doc.ui,globalViews:Store.getState().globalViews,text:doc.raw,options:this._parseOptions,datasetKey:this._datasetKey,docId:doc.id,sourceRevision:doc.sourceRevision};
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
            candidates: this._candidates,
        };
    },

    /** @returns {string[]} all table and view names (raw + global JOIN views) */
    getAvailableTables() {
        const raws = this._raw.map(t => t.name);
        const views = (Store.state.globalViews || []).map(v => v.view);
        return [...raws, ...views];
    },

    /** @returns {string[]} column headers for a table or view by name */
    getCols(tableName) {
        if (!tableName) return [];
        const raw = this._raw.find(t => t.name === tableName);
        if (raw) return raw.headers.slice();
        const views = Store.state.globalViews || [];
        const view = views.find(v => v.view === tableName);
        if (view) {
            return Joiner.getHeaders(this._raw,view,views);
        }
        return [];
    },

    // ── Backward-compatible alias (setRaw still works, used by old callers) ──

    /** @deprecated Use setResult() instead */
    setRaw(tables) {
        this._raw = tables || [];
    },
};

    return { TableRegistry };
});
