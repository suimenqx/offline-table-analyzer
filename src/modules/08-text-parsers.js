const PipeTableParser = {
    id:'pipe-table', label:'竖线/网页表格文本', delimiter:'|',
    confidence(source) {
        const lines = TableUtils.lines(source.text || '').filter(l => l.trim());
        const pipeLines = lines.filter(l => (l.match(/\|/g) || []).length >= 2);
        if(pipeLines.length < 2) return 0;
        const hasMdSep = lines.some(l => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(l));
        return hasMdSep ? 0.9 : 0.62;
    },
    parse(source, options={}) {
        let lines = TableUtils.lines(source.text).filter(l => l.trim());
        const mdSep = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
        const hasMdSep = lines.some(l => mdSep.test(l));
        lines = lines.filter(l => !mdSep.test(l));
        const rows = lines.map(l => {
            let s = l.trim();
            if(s.startsWith('|')) s = s.slice(1);
            if(s.endsWith('|')) s = s.slice(0, -1);
            return splitPipeCells(s);
        }).filter(r => !TableUtils.isEmptyRow(r));
        return buildSingleTableResult(rows, 'Pipe Table 1', this.id, options, { delimiter:'|' }, hasMdSep || options.hasHeader);
    }
};

function splitPipeCells(line='') {
    const cells = [];
    let cell = '', escaped = false;
    for(const ch of String(line)) {
        if(escaped) { cell += ch; escaped = false; continue; }
        if(ch === '\\') { escaped = true; continue; }
        if(ch === '|') { cells.push(cell.trim()); cell = ''; continue; }
        cell += ch;
    }
    if(escaped) cell += '\\';
    cells.push(cell.trim());
    return cells;
}

function splitPipeRows(lines) {
    return lines.map(l => {
        let s = l.trim();
        if(s.startsWith('|')) s = s.slice(1);
        if(s.endsWith('|')) s = s.slice(0, -1);
        return splitPipeCells(s);
    }).filter(r => !TableUtils.isEmptyRow(r));
}

const AsciiTableParser = {
    id:'ascii-table', label:'ASCII/终端表格',
    confidence(source) {
        const text = source.text || '';
        const hasBorders = /^[\s+|\-─┌┬┐├┼┤└┴┘│]+$/m.test(text) && /[|│]/.test(text);
        const rows = TableUtils.lines(text).filter(l => /[|│]/.test(l));
        return hasBorders && rows.length >= 2 ? 0.88 : 0;
    },
    parse(source, options={}) {
        const border = /^[\s+|\-─┌┬┐├┼┤└┴┘│]+$/;
        const lines = TableUtils.lines(source.text)
            .map(l => l.replace(/[│┃]/g, '|'))
            .filter(l => l.trim() && !border.test(l.trim()));
        return buildSingleTableResult(splitPipeRows(lines), 'ASCII Table 1', this.id, options);
    }
};

const FixedWidthParser = {
    id:'fixed-width', label:'固定宽度/多空格表格',
    confidence(source) {
        const lines = TableUtils.lines(source.text || '').filter(l => l.trim());
        if(lines.length < 2 || /\t|,/.test(source.text || '')) return 0;
        const splitRows = lines.slice(0, 20).map(l => l.trim().split(/\s{2,}/));
        const widths = splitRows.map(r => r.length).filter(n => n > 1);
        if(widths.length < 2) return 0;
        const common = widths.filter(w => w === widths[0]).length / widths.length;
        return common >= 0.55 ? 0.56 + common * 0.18 : 0.22;
    },
    parse(source, options={}) {
        const rows = TableUtils.lines(source.text).filter(l => l.trim()).map(l => l.trim().split(/\s{2,}/).map(v => v.trim()));
        return buildSingleTableResult(rows, 'Fixed Width Table 1', this.id, options);
    }
};

const AlignedTableParser = {
    id:'aligned-table', label:'定宽对齐表格',
    confidence(source) {
        const hasDashLine = TableUtils.lines(source.text || '').some(l => /^[\s-]+$/.test(l) && /-/.test(l) && !/[+|]/.test(l));
        return hasDashLine ? 0.80 : 0;
    },
    parse(source, options={}) {
        // 1) 去掉纯 - 分隔线（替换为空行，保留表间边界）
        const isSep = (l) => /^[\s-]+$/.test(l) && /-/.test(l) && !/[+|]/.test(l);
        const clean = TableUtils.lines(source.text).map(l => isSep(l) ? '' : l);
        // 2) 按空行切 block
        const blocks = []; let cur = [];
        for(const l of clean) {
            if(!l.trim()) { if(cur.length) { blocks.push(cur); cur = []; } }
            else cur.push(l);
        }
        if(cur.length) blocks.push(cur);
        // 3) 合并被 --- 隔开的列头 block 与数据 block（列头有 ≥2 个 ≥2 空格间隔的单词）
        const isHeaderLike = (line) => {
            const re = /\S+/g; let w; const words = [];
            while((w = re.exec(line)) !== null) words.push({s:w.index, e:w.index + w[0].length});
            if(words.length < 2) return false;
            for(let k = 1; k < words.length; k++) {
                if(words[k].s - words[k-1].e < 2) return false;
            }
            return true;
        };
        const merged = [];
        for(let i = 0; i < blocks.length; i++) {
            const b = blocks[i];
            if(b.length === 1 && isHeaderLike(b[0]) && i + 1 < blocks.length) {
                merged.push([b[0], ...blocks[i + 1]]);
                i++;
            } else {
                merged.push(b);
            }
        }
        // 4) 逐 block：首行 → 列头定位（复用 CLI FIXED 模式），后续行 → 位置截取
        const tables = []; const used = new Set(); let pendingName = null;
        for(const block of merged) {
            if(block.length < 2) {
                if(block.length === 1) pendingName = block[0].trim();
                continue;
            }
            const headerLine = block[0];
            const regex = /\S+/g; let m; const ranges = [];
            while((m = regex.exec(headerLine)) !== null) ranges.push({s:m.index});
            if(ranges.length < 2) continue;
            // 校验列间间隙 ≥ 2 空格（isHeaderLike 已保证，但安全起见再校验）
            const words = []; const re2 = /\S+/g; let gapOk = true;
            while((m = re2.exec(headerLine)) !== null) words.push({s:m.index, e:m.index + m[0].length});
            if(words.length < 2) continue;
            for(let k = 1; k < words.length; k++) {
                if(words[k].s - words[k-1].e < 2) { gapOk = false; break; }
            }
            if(!gapOk) continue;
            // 构建列区间（复刻 CliTableDataParser FIXED 模式）
            for(let k = 0; k < ranges.length; k++) {
                ranges[k].e = (k < ranges.length - 1) ? ranges[k + 1].s : 99999;
            }
            const headers = ranges.map(r => headerLine.substring(r.s, Math.min(r.e, headerLine.length)).trim());
            const rows = [];
            for(let i = 1; i < block.length; i++) {
                const vals = ranges.map(r => {
                    const v = block[i].substring(r.s, Math.min(r.e, block[i].length)).trim();
                    return v === '--' ? '' : v;
                });
                if(vals.every(v => !v)) continue;
                rows.push(vals);
            }
            if(!rows.length) continue;
            const name = TableUtils.makeTableName(pendingName || 'Aligned Table', tables.length, used);
            pendingName = null;
            const resolved = HeaderResolver.infer([headers, ...rows], { ...options, hasHeader:true, tableName:name });
            resolved.name = name;
            resolved.sourceType = this.id;
            resolved.meta = { delimiter:'position', hasHeader:true, generatedHeaders:false };
            tables.push(resolved);
        }
        if(!tables.length && options.format === this.id) {
            return { tables:[], diagnostics:[{ level:'warning', code:'NO_ALIGNED_TABLE', message:'未检测到定宽对齐表格' }] };
        }
        return { tables, diagnostics:[] };
    }
};

const PlainTextTableParser = {
    id:'plain-text', label:'空白分隔文本',
    confidence(source) { return (source.text || '').trim() ? 0.08 : 0; },
    parse(source, options={}) {
        const rows = TableUtils.lines(source.text).filter(l => l.trim()).map(l => l.trim().split(/\s+/));
        return buildSingleTableResult(rows, 'Text Table 1', this.id, options);
    }
};

const CliTableDataParser = {
    id:'cli-table-data', label:'CLI table-data',
    confidence(source) { return /table-data/i.test(source.text || '') ? 1 : 0; },
    tableNameFromLine(line, index, used) {
        const lower = String(line || '').toLowerCase();
        const pos = lower.lastIndexOf('table-data');
        const tail = pos >= 0 ? line.slice(pos + 'table-data'.length).trim() : '';
        const name = (tail.split(/\s+/)[0] || `T${index + 1}`).replace(/[|,;]+$/g, '');
        return TableUtils.makeTableName(name, index, used);
    },
    parse(source, options={}) {
        const lines = TableUtils.lines(source.text);
        const tables = [];
        const used = new Set();
        let cur = null;
        let inData = false;
        let ranges = [];
        const finalize = () => {
            if(!cur) return;
            if(cur.headers.length) {
                const diagnostics = [];
                const widest = TableUtils.maxWidth(cur.rows);
                while(cur.headers.length < widest) cur.headers.push(`Column${cur.headers.length + 1}`);
                cur.headers = TableUtils.ensureUniqueHeaders(cur.headers);
                cur.rows = TableUtils.normalizeRows(cur.rows, cur.headers.length, diagnostics, cur.name);
                cur.sourceType = this.id;
                cur.meta = { mode:cur.mode || 'WS', hasHeader:true, generatedHeaders:false, headerRule:'validflag' };
                cur.diagnostics = diagnostics;
                tables.push(cur);
            }
            cur = null;
            inData = false;
            ranges = [];
        };
        const parseByMode = (line) => {
            const trim = line.trim();
            const wsParts = trim.split(/\s+/);
            if(wsParts.length === cur.headers.length) return wsParts;
            if(cur.mode === 'FIXED') return ranges.map(r => (r.s >= line.length) ? '' : line.substring(r.s, Math.min(r.e, line.length)).trim());
            if(cur.mode === 'TAB') return Delimited.parse(trim, '\t')[0] || [];
            if(cur.mode === 'CSV') return Delimited.parse(trim, ',')[0] || [];
            if(cur.mode === 'PIPE') return splitPipeCells(trim.replace(/^\||\|$/g, ''));
            return wsParts;
        };
        const setValidFlagHeader = (line) => {
            const trim = line.trim();
            if(line.includes('\t')) {
                cur.mode = 'TAB';
                cur.headers = TableUtils.ensureUniqueHeaders(trim.split('\t'));
                return;
            }
            if(line.includes(',') && !line.includes('  ')) {
                cur.mode = 'CSV';
                cur.headers = TableUtils.ensureUniqueHeaders(Delimited.parse(trim, ',')[0] || []);
                return;
            }
            if((line.match(/\|/g) || []).length >= 2) {
                cur.mode = 'PIPE';
                cur.headers = TableUtils.ensureUniqueHeaders(splitPipeCells(trim.replace(/^\||\|$/g, '')));
                return;
            }
            cur.mode = 'FIXED';
            ranges = [];
            const regex = /\S+/g;
            let m;
            while((m = regex.exec(line)) !== null) ranges.push({s:m.index, e:null});
            for(let k=0; k<ranges.length; k++) ranges[k].e = (k === ranges.length - 1) ? 99999 : ranges[k+1].s;
            cur.headers = TableUtils.ensureUniqueHeaders(ranges.map(r => line.substring(r.s, Math.min(r.e, line.length)).trim()));
        };
        lines.forEach((line) => {
            const trim = line.trim();
            if(line.toLowerCase().includes('table-data')) {
                finalize();
                cur = { name:this.tableNameFromLine(line, tables.length, used), headers:[], rows:[], mode:'WS', diagnostics:[] };
                inData = false;
                return;
            }
            if(!cur) return;
            if(trim.toLowerCase().startsWith('validflag')) {
                setValidFlagHeader(line);
                inData = true;
                return;
            }
            if(!inData) return;
            if(trim.startsWith('<') || trim.startsWith('[')) { finalize(); return; }
            if(!trim) return;
            cur.rows.push(parseByMode(line));
        });
        finalize();
        return { tables, diagnostics:tables.flatMap(table => table.diagnostics || []) };
    }
};
