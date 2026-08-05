OTA.define('query-service', ["filter-engine", "joiner"], ({FilterEngine}, {Joiner}) => {
/* QueryService — the single derived-data contract for preview and preview export.
   It deliberately receives snapshots and has no DOM, Store, or persistence access.
*/

const MAX_CACHE_ENTRIES = 8;
const cache = new Map();
const identities = new WeakMap();
let nextIdentity = 1;

function objectIdentity(value) {
    if(!value || typeof value !== 'object') return 0;
    if(!identities.has(value)) identities.set(value, nextIdentity++);
    return identities.get(value);
}

function stableValue(value) {
    if(value === null || typeof value !== 'object') return value;
    if(Array.isArray(value)) return value.map(stableValue);
    return Object.keys(value).sort().reduce((out, key) => {
        out[key] = stableValue(value[key]);
        return out;
    }, {});
}

function querySignature(ui, meta) {
    const query = {
        displayTables:ui.displayTables || null,
        enabledViews:ui.enabledViews || null,
        rules:ui.rules || {},
        columnFilters:ui.columnFilters || {},
        globalFilter:ui.globalFilter || '',
        enableHighlight:ui.enableHighlight !== false,
        onlyHighlighted:ui.onlyHighlighted || false,
    };
    return JSON.stringify({
        docId:meta.docId || '',
        sourceRevision:Number(meta.sourceRevision) || 0,
        stateRevision:Number(meta.stateRevision) || 0,
        viewRevision:Number(meta.viewRevision) || 0,
        queryRevision:Number(meta.queryRevision) || 0,
        rawToken:Number(meta.rawToken) || 0,
        query:stableValue(query),
    });
}

function cloneForResult(table) {
    return {
        name:table.name,
        headers:Array.isArray(table.headers) ? table.headers.slice() : [],
        rows:Array.isArray(table.rows) ? table.rows.map(row => row.slice()) : [],
        isView:!!table.isView,
    };
}

const QueryService = {
    clearCache() { cache.clear(); },

    getCacheSize() { return cache.size; },

    getPreview({rawTables=[], globalViews=[], ui={}, docId='', sourceRevision=0, stateRevision=0, viewRevision=0, queryRevision=0}={}) {
        const key = querySignature(ui, {
            docId,
            sourceRevision,
            stateRevision,
            viewRevision,
            queryRevision,
            rawToken:objectIdentity(rawTables),
        });
        const cached = cache.get(key);
        if(cached) return cached;

        let tables = rawTables.slice();
        if(Array.isArray(ui.displayTables)) {
            const selected = new Set(ui.displayTables);
            tables = tables.filter(table => selected.has(table.name));
        }

        const joins = Array.isArray(ui.enabledViews) && ui.enabledViews.length
            ? ui.enabledViews.map(name => {
                const config = globalViews.find(view => view && view.view === name);
                return config ? Joiner.run(rawTables, config, globalViews) : null;
            }).filter(Boolean)
            : [];

        const processedTables = tables.concat(joins).map((table, tableIndex) => {
            const snapshot = cloneForResult(table);
            const rules = (ui.rules && ui.rules[table.name]) || {};
            const result = FilterEngine.processTable(
                snapshot,
                rules,
                ui,
                ui.globalFilter || '',
                ui.enableHighlight !== false,
                ui.onlyHighlighted || false
            );
            result.rows.forEach((row, index) => { row._resultIndex = index; });
            return { table:snapshot, res:result, tIdx:tableIndex };
        });

        const result = Object.freeze({
            key,
            tables:Object.freeze(processedTables),
        sourceRevision:Number(sourceRevision) || 0,
        stateRevision:Number(stateRevision) || 0,
        viewRevision:Number(viewRevision) || 0,
        queryRevision:Number(queryRevision) || 0,
        });
        cache.set(key, result);
        while(cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
        return result;
    },

    paginate(processed, tableName, page=1, pageSize=100) {
        const item = (processed || []).find(entry => entry.table.name === tableName);
        if(!item) return {headers:[], rows:[], page:1, pageCount:1, totalRows:0};
        const size = Math.max(1, Number(pageSize) || 100);
        const totalRows = item.res.rows.length;
        const pageCount = Math.max(1, Math.ceil(totalRows / size));
        const current = Math.min(pageCount, Math.max(1, Number(page) || 1));
        return {
            headers:item.res.headers.slice(),
            rows:item.res.rows.slice((current - 1) * size, current * size),
            page:current,
            pageCount,
            totalRows,
        };
    },
};

    return { QueryService };
});
