OTA.define('table-registry', ["store", "joiner"], ({Store}, {Joiner}) => {
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
            const res = Joiner.run(this._raw, view, views);
            return res ? res.headers.slice() : [];
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
