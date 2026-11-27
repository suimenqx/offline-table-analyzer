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

// A bounded, deterministic profile. Prioritize identifiers and shared names on wide tables.
const SAMPLE_ROWS = 5;
const PROFILE_ROWS = 64;
const PROFILE_COLUMNS = 96;
const indexHeaders = headers => new Map(headers.map((name,i) => [name,i]));
const normalizeName = name => name.normalize('NFKC').toLowerCase().replace(/[\s_.-]+/gu, '');
const keySuffix = name => name.match(/(?:identifier|number|code|key|id|编号|编码|标识|单号|序号)$/u)?.[0] || '';
function columnProfiles(table, otherNames) {
    const count = Math.min(PROFILE_ROWS, table.rows.length);
    const indexes = Array.from({length:count}, (_, i) =>
        Math.floor(i * (table.rows.length - 1) / Math.max(1, count - 1)));
    const columns = table.headers.map((header, index) => {
        const name = normalizeName(header);
        const suffix = keySuffix(name);
        return {header, index, name, suffix, priority:(suffix ? 2 : 0) + Number(otherNames.has(name))};
    });
    return columns.sort((a,b) => b.priority - a.priority).slice(0, PROFILE_COLUMNS).map(col => {
        const values = new Set();
        let usable = 0;
        for(const i of indexes) {
            const value = table.rows[i][col.index];
            if(value == null || (typeof value === 'string' && (value.length > 256 || !value.trim()))) continue;
            values.add(value);
            usable++;
        }
        return {...col, values, usable, duplicates:usable - values.size};
    }).filter(col => col.usable);
}

function rankPair(l, r, leftName, rightName, exhaustive) {
    const sameName = l.name === r.name;
    const identifiers = !!l.suffix && !!r.suffix;
    let common = 0;
    for(const value of l.values) if(r.values.has(value)) common++;
    if(!common && (exhaustive || !(sameName && identifiers))) return null;
    const distinct = Math.min(l.values.size, r.values.size);
    if(l.values.size === 1 && r.values.size === 1 && l.duplicates && r.duplicates) return null;
    const coverage = common / distinct;
    const rightUniqueness = r.values.size / r.usable;
    if(!identifiers && (distinct < 2 || (!sameName && (common < 3 || coverage < 0.6 || rightUniqueness < 0.75)))) return null;
    const qualified = identifiers && (l.name.slice(0, -l.suffix.length) === rightName || r.name.slice(0, -r.suffix.length) === leftName);
    const score = (sameName ? 4 : 0) + (identifiers ? 5 : 0) + (qualified ? 4 : 0) +
        coverage * 5 + rightUniqueness * 3 + Math.min(3, Math.log2(common + 1));
    return {l:l.header, r:r.header, common, leftSampled:l.usable, rightSampled:r.usable,
        leftDuplicates:l.duplicates, rightDuplicates:r.duplicates,
        nameReason:sameName ? '字段同名' : identifiers ? '标识字段名称相关' : '样本值相近', score};
}

// Use the same header normalization and cell lookup for saved JOINs and designer examples.
function projection(tokens, left, right) {
    const columns = tokens.map(t => {
        const side = t.side === 'right' || t.side === 'r' ? 'r' : 'l';
        return {side, index:(side === 'r' ? right : left).get(t.col)};
    });
    return {headers:TableUtils.ensureUniqueHeaders(tokens.map(t => t.alias || t.col || t.raw)),
        cells:pair => columns.map(c => pair[c.side]?.[c.index] ?? '')};
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
    suggestKeys(rawTables, leftName, rightName, views=[]) {
        const left = this.resolve(leftName, rawTables, views);
        const right = leftName === rightName ? left : this.resolve(rightName, rawTables, views);
        if(!left || !right) return [];
        const names = table => new Set(table.headers.map(normalizeName));
        const ls = columnProfiles(left, names(right)), rs = columnProfiles(right, names(left));
        const entity = name => normalizeName(name).replace(/s$/, '');
        const leftEntity = entity(leftName), rightEntity = entity(rightName);
        const exhaustive = left.rows.length <= PROFILE_ROWS && right.rows.length <= PROFILE_ROWS;
        const candidates = [];
        for(const l of ls) for(const r of rs) {
            const candidate = rankPair(l,r,leftEntity,rightEntity,exhaustive);
            if(candidate) candidates.push(candidate);
        }
        return candidates.sort((a,b) => Number(!!b.common) - Number(!!a.common) || b.score - a.score).slice(0,3);
    },
    projectSample(sample, select) {
        const output = projection(this.buildSelectTokens(select), indexHeaders(sample.leftHeaders), indexHeaders(sample.rightHeaders));
        return {headers:output.headers, rows:sample.pairs.map(pair => ({kind:pair.kind, cells:output.cells(pair)}))};
    },
    stats(rawTables, cfg, views=[], stack=[], {samples=false}={}) {
        const L = this.resolve(cfg.left, rawTables, views, stack);
        const R = this.resolve(cfg.right, rawTables, views, stack);
        if(!L || !R) return null;
        const pairs = this.parsePairs(cfg, L, R);
        if(!pairs.length) return null;
        const rIdx = new Map();
        const rMap = new Map(R.headers.map((h,i)=>[h,i]));
        const rightFields = pairs.map(p => p[1]);
        R.rows.forEach(r => {
            const k = this.compositeKey(r, rMap, rightFields);
            if(!rIdx.has(k)) rIdx.set(k,[]); rIdx.get(k).push(r);
        });
        let matched = 0;
        let leftMatched = 0;
        let leftOnly = 0;
        const leftKeys = new Set();
        const lMap = new Map(L.headers.map((h,i)=>[h,i]));
        const examples = {matched:[], leftOnly:[], rightOnly:[]};
        const leftFields = pairs.map(p => p[0]);
        L.rows.forEach((lr, index) => {
            const k = this.compositeKey(lr, lMap, leftFields);
            leftKeys.add(k);
            const matches = rIdx.get(k);
            if(matches) {
                matched += matches.length;
                leftMatched++;
                if(samples && cfg.type !== 'anti') {
                    const count = Math.min(SAMPLE_ROWS - examples.matched.length, cfg.type === 'semi' ? 1 : matches.length);
                    for(let i = 0; i < count; i++) examples.matched.push({l:lr, r:matches[i], kind:'matched', index});
                }
            } else {
                leftOnly++;
                if(samples && examples.leftOnly.length < SAMPLE_ROWS && ['left','full','anti'].includes(cfg.type)) {
                    examples.leftOnly.push({l:lr, r:null, kind:'leftOnly', index});
                }
            }
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
        const result = { matched, leftOnly, rightOnly, outRows, leftRows: L.rows.length, rightRows: R.rows.length };
        if(samples) {
            if(rightOnly && ['right','full'].includes(cfg.type)) {
                for(let i = 0; i < R.rows.length && examples.rightOnly.length < SAMPLE_ROWS; i++) {
                    const r = R.rows[i];
                    if(!leftKeys.has(this.compositeKey(r, rMap, rightFields))) {
                        examples.rightOnly.push({l:null, r, kind:'rightOnly', index:L.rows.length + i});
                    }
                }
            }
            // Reserve a place for each present kind, then fill in result order.
            const groups = Object.values(examples).filter(group => group.length);
            const byIndex = (a,b) => a.index - b.index;
            const extra = groups.flatMap(group => group.slice(1)).sort(byIndex);
            const picked = groups.map(group => group[0]).concat(extra.slice(0, SAMPLE_ROWS - groups.length)).sort(byIndex);
            result.sample = {leftHeaders:L.headers, rightHeaders:R.headers, pairs:picked};
        }
        return result;
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

        const output = projection(cols, lMap, rMap);
        return { name: `JOIN:${cfg.view}`, headers:output.headers, rows:rows.map(output.cells), isView:true };
    }
};

    return { Joiner };
});
