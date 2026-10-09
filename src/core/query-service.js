OTA.define('query-service', ["filter-engine", "joiner", "table-utils"], ({FilterEngine}, {Joiner}, {TableUtils}) => {
/* QueryService — the single derived-data contract for preview and preview export.
   It deliberately receives snapshots and has no DOM, Store, or persistence access.
*/

const MAX_CACHE_ENTRIES = 2;
const cache = new Map();
const asyncCache = new Map();
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
        cellEdits:ui.cellEdits || {},
        globalViews:meta.globalViews || [],
    };
    return JSON.stringify({
        docId:meta.docId || '',
        sourceRevision:Number(meta.sourceRevision) || 0,
        viewRevision:Number(meta.viewRevision) || 0,
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
    MAX_CELLS:8000000,
    collectTables(rawTables, globalViews, ui, selectTables=true) {
        let tables=rawTables.slice();
        if(selectTables && Array.isArray(ui.displayTables))tables=tables.filter(table=>ui.displayTables.includes(table.name));
        let cells=tables.reduce((sum,table)=>sum+table.rows.length*table.headers.length,0);
        if(cells>this.MAX_CELLS)throw new Error('查询结果超过 800 万单元格合计预算，请减少显示表');
        for(const name of ui.enabledViews || []) {
            const config=globalViews.find(view=>view && view.view===name);
            if(!config)continue;
            const table=Joiner.run(rawTables,config,globalViews,[],{maxCells:this.MAX_CELLS-cells});
            if(table){cells+=table.rows.length*table.headers.length;tables.push(table);}
        }
        return tables;
    },
    clearCache() { cache.clear(); asyncCache.clear(); },

    getCacheSize() { return cache.size+asyncCache.size; },

    getPreview({rawTables=[], globalViews=[], ui={}, docId='', sourceRevision=0, stateRevision=0, viewRevision=0, queryRevision=0}={}) {
        const key = querySignature(ui, {
            docId,
            sourceRevision,
            stateRevision,
            viewRevision,
            queryRevision,
            rawToken:objectIdentity(rawTables),
            globalViews,
        });
        const cached = cache.get(key);
        if(cached) return cached;

        const tables=this.collectTables(rawTables,globalViews,ui);

        const processedTables = tables.map((table, tableIndex) => {
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

    getPagePreview(input) {
        const full=this.getPreview(input),ui=input.ui || {};
        const single=TableUtils.useSingleTableView(full.tables.map(item=>item.table));
        const active=full.tables.some(item=>item.table.name===ui.previewTable)?ui.previewTable:full.tables[0]?.table.name;
        return {tables:full.tables.map(item=>{
            const page=this.paginate(full.tables,item.table.name,ui.tablePages?.[item.table.name],ui.pageSize);
            const visible=(!single || item.table.name===active) && !ui.collapsedTables?.[item.table.name];
            return {tIdx:item.tIdx,table:TableUtils.describeTable(item.table),
                res:{...page,rows:visible?page.rows:[],offset:(page.page-1)*(Number(ui.pageSize) || 100),paged:true}};
        })};
    },

    getPreviewAsync(input, executor) {
        const key=querySignature(input.ui || {}, {...input,rawToken:objectIdentity(input.rawTables)})+JSON.stringify(stableValue({pageSize:input.ui?.pageSize,tablePages:input.ui?.tablePages,previewTable:input.ui?.previewTable,collapsedTables:input.ui?.collapsedTables}));
        if(asyncCache.has(key)) return asyncCache.get(key);
        executor.cancelQueries?.();
        const snapshot={...input,ui:JSON.parse(JSON.stringify(input.ui || {})),globalViews:JSON.parse(JSON.stringify(input.globalViews || []))};
        const promise=executor.query(snapshot).catch(error=>{if(asyncCache.get(key)===promise)asyncCache.delete(key);throw error;});
        asyncCache.set(key,promise);
        while(asyncCache.size>MAX_CACHE_ENTRIES) asyncCache.delete(asyncCache.keys().next().value);
        return promise;
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
