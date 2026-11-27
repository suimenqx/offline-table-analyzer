OTA.define('query-service', ["filter-engine", "joiner", "table-utils"], ({FilterEngine}, {Joiner}, {TableUtils}) => {
/* QueryService — the single derived-data contract for preview and Excel exports.
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
        ...('editSource' in table ? {editSource:table.editSource && {...table.editSource}} : {}),
        headers:Array.isArray(table.headers) ? table.headers.slice() : [],
        rows:Array.isArray(table.rows) ? table.rows.map(row => row.slice()) : [],
        isView:!!table.isView,
    };
}

function selectedRawTables(rawTables, ui, selectTables=true) {
    return selectTables && Array.isArray(ui.displayTables)
        ? rawTables.filter(table => ui.displayTables.includes(table.name)) : rawTables.slice();
}
const countCells = tables => tables.reduce((sum,table) => sum + table.rows.length * table.headers.length, 0);

function indexedQuery({rawTables=[], globalViews=[], ui={}, ...meta}={}) {
    const key = querySignature(ui, {...meta, globalViews, rawToken:objectIdentity(rawTables)});
    if (cache.has(key)) return cache.get(key);
    const tables = QueryService.collectTables(rawTables, globalViews, ui).map((table, tIdx) => {
        // Both execution contexts publish a new table revision when a cell changes.
        const index = FilterEngine.indexTable(table, ui.rules?.[table.name] || {}, ui,
            ui.globalFilter, ui.enableHighlight, ui.onlyHighlighted);
        return {table, index, tIdx};
    });
    const result = {
        tables, full:null,
        meta:{
            key,
            sourceRevision:Number(meta.sourceRevision) || 0, stateRevision:Number(meta.stateRevision) || 0,
            viewRevision:Number(meta.viewRevision) || 0, queryRevision:Number(meta.queryRevision) || 0,
        },
    };
    cache.set(key, result);
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    return result;
}

function pageBounds(totalRows, requested, pageSize) {
    const size = Math.max(1, Math.trunc(Number(pageSize)) || 100);
    const pageCount = Math.max(1, Math.ceil(totalRows / size));
    const page = Math.min(pageCount, Math.max(1, Math.trunc(Number(requested)) || 1));
    return {page, pageCount, offset:(page - 1) * size, size};
}

const QueryService = {
    MAX_CELLS:TableUtils.MAX_CELLS,
    /**
     * 表池派生（纯函数，无 DOM）：entries = [{cardId, table, visible?}] 按工程卡片顺序。
     * 已知但隐藏的来源仅提供命名/结构基准，不贡献记录。
     * 规则（多卡片工作区 ADR）：与首张卡结构（列名+顺序）一致的同名表直接拼接
     * （不去重、重复保留）；结构不同的同名表并列，显示名加卡片限定；单来源直通。
     * @returns {Array<{displayName:string, kind:'single'|'concat'|'side', sourceCardId:string, sourceCardIds:string[], columns:string[], rows:Array<Array<string>>}>}
     */
    computePool(entries) {
        const byName = new Map();
        for(const entry of entries || []) {
            if(!entry || !entry.table) continue;
            const name = entry.table.name;
            if(!byName.has(name)) byName.set(name, []);
            byName.get(name).push({ cardId:entry.cardId, cardName:entry.cardName || entry.cardId, table:entry.table, visible:entry.visible !== false });
        }
        const pool = [];
        for(const [name, group] of byName) {
            const first = group[0].table;
            const sameStructure = (a, b) => a.headers.length === b.headers.length && a.headers.every((h, i) => h === b.headers[i]);
            const same = group.filter(e => e.visible && sameStructure(first, e.table));
            const others = group.filter(e => e.visible && !sameStructure(first, e.table));
            if(same.length > 1) {
                pool.push({ displayName:name, kind:'concat', sourceCardId:null, sourceCardIds:same.map(e => e.cardId),
                    columns:first.headers, rows:[].concat(...same.map(e => e.table.rows)) });
            } else if(same.length) {
                pool.push({ displayName:name, sourceName:name, kind:'single', sourceCardId:same[0].cardId, sourceCardIds:[same[0].cardId],
                    columns:same[0].table.headers, rows:same[0].table.rows });
            }
            for(const e of others) {
                pool.push({ displayName:`${name} (${e.cardName})`, sourceName:name, kind:'side', sourceCardId:e.cardId, sourceCardIds:[e.cardId],
                    columns:e.table.headers, rows:e.table.rows });
            }
        }
        return pool;
    },
    checkViewBudget({rawTables,globalViews,ui}, known={}) {
        let cells = countCells(selectedRawTables(rawTables,ui));
        for(const name of ui.enabledViews || []) {
            const config = globalViews.find(v => v.view === name);
            if(!config) continue;
            const rows = known.view === name ? known.rows : Joiner.stats(rawTables,config,globalViews)?.outRows;
            if(rows == null) {
                if(known.requireAvailable?.includes(name)) {
                    const reason = Joiner.describeView(rawTables,config,globalViews).error || '请检查来源表与关联条件';
                    throw new Error(`无法启用“${name}”：${reason}。`);
                }
                continue; // Previously enabled, unavailable views are omitted by collectTables.
            }
            const columns = Joiner.buildSelectTokens(config.select).length;
            if(!columns) continue;
            const issue = Joiner.sizeWarning(rows,columns);
            if(issue) throw new Error(`“${name}”的结果为 ${issue}。`);
            cells += rows * columns;
        }
        if(cells > this.MAX_CELLS) throw new Error(`所选原始表和启用视图合计 ${cells.toLocaleString('zh-CN')} 个单元格，超过上限 ${this.MAX_CELLS.toLocaleString('zh-CN')} 个。请减少显示表、启用视图或输出列。`);
    },
    collectTables(rawTables, globalViews, ui, selectTables=true) {
        const tables=selectedRawTables(rawTables,ui,selectTables);
        let cells=countCells(tables);
        if(cells>this.MAX_CELLS)throw new Error('查询结果超过 800 万单元格合计预算，请减少显示表');
        for(const name of ui.enabledViews || []) {
            const config=globalViews.find(view=>view && view.view===name);
            if(!config)continue;
            const table=Joiner.run(rawTables,config,globalViews,[],{maxCells:this.MAX_CELLS-cells});
            if(table){cells+=table.rows.length*table.headers.length;tables.push(table);}
        }
        return tables;
    },
    /** Derive complete workbook tables in either execution context; never paginate or mutate the input. */
    getExportTables(input={}, mode='full') {
        const {rawTables=[], globalViews=[], ui={}} = input;
        if(mode === 'raw') return this.collectTables(rawTables, [], {}, false);
        for (const name of ui.enabledViews || []) {
            const cfg = globalViews.find(view => view && view.view === name);
            if (!cfg) continue;
            const status = Joiner.describeView(rawTables, cfg, globalViews);
            if (status.invalidRelation) throw new Error(`无法导出“${name}”。${status.error}`);
        }
        if(mode === 'preview') return indexedQuery(input).tables.map(({table, index}) => ({
            name:table.name || 'Sheet', headers:index.headers.slice(), rows:index.exportRows(),
        }));
        const tables = this.collectTables(rawTables, globalViews, ui, !!ui.exportOnlyChecked);
        return ui.exportCols === 'shown'
            ? tables.map(table => TableUtils.projectColumns(table, ui.rules?.[table.name]?.focus))
            : tables;
    },
    clearCache() { cache.clear(); asyncCache.clear(); },

    getCacheSize() { return cache.size+asyncCache.size; },

    getPreview(input) {
        const query = indexedQuery(input);
        if (!query.full) {
            const tables = query.tables.map(({table, index, tIdx}) => ({
                table:table.isView ? table : cloneForResult(table), res:{headers:index.headers, rows:index.readRows()}, tIdx
            }));
            query.full = Object.freeze({...query.meta, tables:Object.freeze(tables)});
        }
        return query.full;
    },

    getPagePreview(input={}) {
        const {tables} = indexedQuery(input);
        const ui = input.ui || {};
        const single = TableUtils.useSingleTableView(tables.map(item => item.table));
        const active = tables.some(item => item.table.name === ui.previewTable) ? ui.previewTable : tables[0]?.table.name;
        return {tables:tables.map(({table, index, tIdx}) => {
            const {page, pageCount, offset, size} = pageBounds(index.totalRows, ui.tablePages?.[table.name], ui.pageSize);
            const visible = (!single || table.name === active) && !ui.collapsedTables?.[table.name];
            return {tIdx, table:TableUtils.describeTable(table), res:{
                headers:index.headers.slice(), rows:visible ? index.readRows(offset, offset + size) : [],
                page, pageCount, totalRows:index.totalRows, offset, paged:true}};
        })};
    },

    getPreviewAsync(input, executor) {
        // 缓存键必须含可见清单：显隐只改表池成员，不改 ui/来源修订。
        const key=querySignature(input.ui || {}, {...input,rawToken:objectIdentity(input.rawTables)})
            + JSON.stringify(stableValue({pageSize:input.ui?.pageSize,tablePages:input.ui?.tablePages,previewTable:input.ui?.previewTable,
                collapsedTables:input.ui?.collapsedTables, visible:input.visible || [], sourceOrder:input.sources || input.visible || [], cardUis:input.cardUis || {},
                sourceVersions:(input.cards || []).map(card => ({id:card.id, sourceRevision:card.sourceRevision,
                    config:card.config || {format:card.options?.format, headerMode:card.options?.headerMode}}))}));
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
        const totalRows = item.res.rows.length;
        const bounds = pageBounds(totalRows, page, pageSize);
        return {
            headers:item.res.headers.slice(),
            rows:item.res.rows.slice(bounds.offset, bounds.offset + bounds.size),
            page:bounds.page,
            pageCount:bounds.pageCount,
            totalRows,
        };
    },
};

    return { QueryService };
});
