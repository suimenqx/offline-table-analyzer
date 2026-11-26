OTA.define('joiner', ["table-utils"], ({TableUtils}) => {
/* Joiner */
function checkRelations(cfg, leftHeaders, rightHeaders) {
    const pairs = [];
    const missing = new Set();
    for (const clause of (typeof cfg.on === 'string' ? cfg.on : '').split(',')) {
        const fields = clause.split('=').map(field => field.trim());
        if (fields.length !== 2 || fields.some(field => !field)) {
            return {pairs:[], error:`视图“${cfg.view}”的关联条件不完整（${clause}）`};
        }
        const [left, right] = fields;
        if (!leftHeaders.includes(left)) missing.add(`${cfg.left}.${left}`);
        if (!rightHeaders.includes(right)) missing.add(`${cfg.right}.${right}`);
        pairs.push(fields);
    }
    if (missing.size) return {pairs:[], error:`视图“${cfg.view}”缺少关联列 ${[...missing].join('、')}`};
    return {pairs};
}

const Joiner = {
    MAX_ROWS:1000000,
    MAX_CELLS:8000000,
    describeView(rawTables, cfg, views=[], stack=[], memo=new Map()) {
        if (!cfg || stack.includes(cfg.view)) return {headers:[], error:'视图引用无效'};
        if (memo.has(cfg.view)) return memo.get(cfg.view);
        const resolve = name => {
            const raw = rawTables.find(table => table.name === name);
            if (raw) return {headers:raw.headers};
            const view = views.find(item => item && item.view === name);
            return view ? this.describeView(rawTables, view, views, [...stack, cfg.view], memo)
                : {headers:[], error:`来源“${name}”不在当前表池`};
        };
        const left = resolve(cfg.left), right = resolve(cfg.right);
        let result = [left,right].find(source => source.error);
        if (!result) {
            const {error} = checkRelations(cfg, left.headers, right.headers);
            result = error ? {headers:[], error, invalidRelation:true} : {
                headers:TableUtils.ensureUniqueHeaders(this.buildSelectTokens(cfg.select).map(token => token.alias || token.col || token.raw))
            };
        }
        memo.set(cfg.view, result);
        return result;
    },
    getHeaders(rawTables,cfg,views=[],stack=[]) {
        return this.describeView(rawTables,cfg,views,stack).headers;
    },
    resolve(name, rawTables, views, stack=[]) {
        if(stack.includes(name)) return null; 
        const raw = rawTables.find(t=>t.name===name);
        if(raw) return raw;
        const v = views.find(v=>v.view===name);
        if(v) return this.run(rawTables, v, views, [...stack, name]);
        return null;
    },
    parseSelectToken(token) {
        const raw = (token || '').trim();
        if(!raw) return null;
        let base = raw;
        let alias = '';
        const m = /^(.*?)(?:\s+as\s+|\s*:\s*)(.+)$/i.exec(raw);
        if(m) { base = m[1].trim(); alias = m[2].trim(); }
        let side = 'left';
        let col = base;
        if(base.includes('.')) {
            const parts = base.split('.');
            side = (parts[0] || 'left').toLowerCase();
            col = parts.slice(1).join('.').trim();
        }
        if(!col) return null;
        return { side, col, alias, raw };
    },
    buildSelectTokens(selectStr) {
        return (selectStr || '').replace(/\n/g, ',').split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .map(t => this.parseSelectToken(t))
            .filter(Boolean);
    },
    parsePairs(cfg, L, R) {
        return cfg ? checkRelations(cfg, L.headers, R.headers).pairs : [];
    },
    compositeKey(row, map, cols) {
        return JSON.stringify(cols.map(col => {
            const idx = map.get(col);
            const value = idx === undefined ? null : row[idx];
            return [typeof value, value ?? null];
        }));
    },
    hasDependencyCycle(cfg, views=[], rawNames=[]) {
        const graph = new Map();
        views.forEach(view => {
            if(view && view.view && view.view !== cfg.view) graph.set(view.view, [view.left, view.right].filter(name => !rawNames.includes(name)));
        });
        graph.set(cfg.view, [cfg.left, cfg.right].filter(name => !rawNames.includes(name)));
        const visiting = new Set(), visited = new Set();
        const walk = name => {
            if(visiting.has(name)) return true;
            if(visited.has(name) || !graph.has(name)) return false;
            visiting.add(name);
            for(const dep of graph.get(name)) if(walk(dep)) return true;
            visiting.delete(name);
            visited.add(name);
            return false;
        };
        return walk(cfg.view);
    },
    stats(rawTables, cfg, views=[], stack=[]) {
        const L = this.resolve(cfg.left, rawTables, views, stack);
        const R = this.resolve(cfg.right, rawTables, views, stack);
        if(!L || !R) return null;
        const pairs = this.parsePairs(cfg, L, R);
        if(!pairs.length) return null;
        const rIdx = new Map();
        const rMap = new Map(R.headers.map((h,i)=>[h,i]));
        R.rows.forEach(r => {
            const k = this.compositeKey(r, rMap, pairs.map(p => p[1]));
            if(!rIdx.has(k)) rIdx.set(k,[]); rIdx.get(k).push(r);
        });
        let matched = 0;
        let leftMatched = 0;
        let leftOnly = 0;
        const leftKeys = new Set();
        const lMap = new Map(L.headers.map((h,i)=>[h,i]));
        L.rows.forEach(lr => {
            const k = this.compositeKey(lr, lMap, pairs.map(p => p[0]));
            leftKeys.add(k);
            const matches = rIdx.get(k);
            if(matches) { matched += matches.length; leftMatched++; }
            else leftOnly++;
        });
        let rightOnly = 0;
        rIdx.forEach((rows, k) => { if(!leftKeys.has(k)) rightOnly += rows.length; });
        const outRows = ({
            left:matched + leftOnly,
            right:matched + rightOnly,
            full:matched + leftOnly + rightOnly,
            semi:leftMatched,
            anti:leftOnly
        })[cfg.type] ?? matched;
        return { matched, leftOnly, rightOnly, outRows, leftRows: L.rows.length, rightRows: R.rows.length };
    },
    run(rawTables, cfg, views=[], stack=[], limits={}) {
        const L = this.resolve(cfg.left, rawTables, views, stack);
        const R = this.resolve(cfg.right, rawTables, views, stack);
        if(!L || !R) return null;

        const pairs = this.parsePairs(cfg, L, R);
        const cols = this.buildSelectTokens(cfg.select);
        if(!pairs.length || !cols.length) return null;

        const existenceOnly = cfg.type === 'semi' || cfg.type === 'anti';
        const rIdx = new Map();
        const rMap = new Map(R.headers.map((h,i)=>[h,i]));
        const rightKeys = pairs.map(pair => pair[1]);
        R.rows.forEach(r => {
            const key = this.compositeKey(r, rMap, rightKeys);
            const bucket = rIdx.get(key);
            if(!bucket) rIdx.set(key, [r]);
            else if(!existenceOnly) bucket.push(r);
        });

        const rows = [];
        const append=value=>{if(rows.length>=this.MAX_ROWS || (rows.length+1)*cols.length>Math.min(this.MAX_CELLS,limits.maxCells ?? this.MAX_CELLS))throw new Error('JOIN 结果超过行数或单元格预算，请减少显示表或收紧关联条件');rows.push(value);};
        const matchedRight = ['right','full'].includes(cfg.type) ? new Set() : null;
        const lMap = new Map(L.headers.map((h,i)=>[h,i]));
        const leftKeys = pairs.map(pair => pair[0]);
        L.rows.forEach(lr => {
            const k = this.compositeKey(lr, lMap, leftKeys);
            const matches = rIdx.get(k);
            if(matches) {
                if(cfg.type === 'semi') append({l:lr, r:matches[0]});
                else if(cfg.type !== 'anti') matches.forEach(rr => {
                    matchedRight?.add(rr);
                    append({l:lr, r:rr});
                });
            } else if(['left','full','anti'].includes(cfg.type)) append({l:lr, r:null});
        });
        if(matchedRight) R.rows.forEach(rr => { if(!matchedRight.has(rr)) append({l:null, r:rr}); });

        const headers = TableUtils.ensureUniqueHeaders(cols.map(t => t.alias || t.col || t.raw));
        const resRows = rows.map(({l, r}) => cols.map(t => {
            const src = (t.side === 'right' || t.side === 'r') ? 'right' : 'left';
            const col = t.col;
            if(src==='left') return l ? (l[lMap.get(col)] ?? '') : '';
            return r ? (r[rMap.get(col)] ?? '') : '';
        }));
        return { name: `JOIN:${cfg.view}`, headers, rows: resRows, isView: true };
    }
};

    return { Joiner };
});
