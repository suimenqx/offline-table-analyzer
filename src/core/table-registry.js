OTA.define('table-registry', ["store", "joiner"], ({Store}, {Joiner}) => {
/* TableRegistry — shared access to parsed tables and column metadata.

   This module breaks the circular dependency between join-editor and app:
   both depend on TableRegistry, neither depends on each other for data access.

   App.run() calls setRaw() after each parse. All downstream consumers
   (JoinEditor, CellEditController, ExportController, etc.) read via
   getAvailableTables() / getCols() / getRaw().
*/

const TableRegistry = {
    _raw: [],

    /** Called by App.run() after each successful parse. */
    setRaw(tables) {
        this._raw = tables || [];
    },

    /** @returns {Object[]} all raw parsed tables (read-only; do not mutate) */
    getRaw() {
        return this._raw;
    },

    /** @returns {Object|null} a raw table by name, or null */
    getTable(name) {
        return this._raw.find(t => t.name === name) || null;
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
    }
};

    return { TableRegistry };
});
