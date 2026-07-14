OTA.define('joiner', ["table-utils"], ({TableUtils}) => {
/* Joiner */
const Joiner = {
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
        if(!cfg || typeof cfg.on !== 'string') return [];
        const pairs = cfg.on.split(',').map(s => {
            const p = s.split('=');
            return p.length === 2 ? [p[0].trim(), p[1].trim()] : null;
        }).filter(Boolean);
        return pairs.filter(([leftCol, rightCol]) => L.headers.includes(leftCol) && R.headers.includes(rightCol));
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
    run(rawTables, cfg, views=[], stack=[]) {
        const L = this.resolve(cfg.left, rawTables, views, stack);
        const R = this.resolve(cfg.right, rawTables, views, stack);
        if(!L || !R) return null;

        const pairs = this.parsePairs(cfg, L, R);
        const cols = this.buildSelectTokens(cfg.select);
        if(!pairs.length || !cols.length) return null;
        
        const rIdx = new Map();
        const rMap = new Map(R.headers.map((h,i)=>[h,i]));
        R.rows.forEach(r => {
            const k = this.compositeKey(r, rMap, pairs.map(p => p[1]));
            if(!rIdx.has(k)) rIdx.set(k,[]); rIdx.get(k).push(r);
        });

        const rows = [];
        const matchedRight = new Set();
        const lMap = new Map(L.headers.map((h,i)=>[h,i]));
        L.rows.forEach(lr => {
            const k = this.compositeKey(lr, lMap, pairs.map(p => p[0]));
            const matches = rIdx.get(k);
            if(matches && matches.length) {
                matches.forEach(rr => matchedRight.add(rr));
                if(cfg.type === 'semi') rows.push({l:lr, r:matches[0]});
                else if(cfg.type !== 'anti') matches.forEach(rr => rows.push({l:lr, r:rr}));
            } else if(['left','full','anti'].includes(cfg.type)) rows.push({l:lr, r:null});
        });
        if(['right','full'].includes(cfg.type)) R.rows.forEach(rr => { if(!matchedRight.has(rr)) rows.push({l:null, r:rr}); });

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
