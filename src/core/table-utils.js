OTA.define('table-utils', [], () => {
/* Table utilities — normalization, headers, cell types */
const TableUtils = {
    MAX_CELLS:8000000,
    rowCount(table) { return table.remote ? Math.max(0,Number(table.rowCount) || 0) : (table.rows || []).length; },
    describeTable(table,{samples=false}={}) {
        const descriptor={name:table.name,headers:table.headers,rows:[],rowCount:this.rowCount(table),remote:true,isView:!!table.isView,
            sourceType:table.sourceType,meta:table.meta,diagnostics:(table.diagnostics || []).slice(0,200)};
        if(samples)descriptor.columnSamples=table.headers.map((_,col)=>{
            let sample='';
            for(let row=0;row<Math.min(1000,table.rows.length);row++){if(table.rows[row][col]?.trim()){sample=table.rows[row][col];break;}}
            return {value:sample.slice(0,128),truncated:sample.length>128};
        });
        return descriptor;
    },
    useSingleTableView(tables) {
        const rows=tables.reduce((n,table)=>n+this.rowCount(table),0);
        const cells=tables.reduce((n,table)=>n+this.rowCount(table)*table.headers.length,0);
        return tables.length>=8 || rows>=1000 || cells>=30000;
    },
    normalizeText(text='') { return String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'); },
    lines(text='') { return this.normalizeText(text).split('\n'); },
    *iterLines(text='') {
        let start=text.charCodeAt(0)===0xFEFF?1:0;
        for(let i=start;i<text.length;i++)if(text[i]==='\n' || text[i]==='\r') {
            yield text.slice(start,i);
            if(text[i]==='\r' && text[i+1]==='\n')i++;
            start=i+1;
        }
        yield text.slice(start);
    },
    isEmptyRow(row=[]) { return !row || row.every(v => String(v ?? '').trim() === ''); },
    normalizeCellText(value='', options={}) {
        const convertHtmlBreaks = options.convertHtmlBreaks !== false;
        let text = String(value ?? '').replace(/\u00a0/g, ' ');
        if(convertHtmlBreaks) {
            text = text
                .replace(/&lt;\s*br\s*\/?\s*&gt;/gi, '\n')
                .replace(/<\s*br\s*\/?\s*>/gi, '\n');
        }
        return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    },
    trimRow(row=[]) { return row.map(v => this.normalizeCellText(v).trim()); },
    maxWidth(rows=[]) { return rows.reduce((m, r) => Math.max(m, (r || []).length), 0); },
    projectColumns(table,focus=[]) {
        const indexes=(Array.isArray(focus)?focus:[]).map(column=>table.headers.indexOf(column)).filter(index=>index>=0);
        return {
            name:table.name,
            headers:indexes.length?indexes.map(index=>table.headers[index]):table.headers.slice(),
            rows:table.rows.map(row=>indexes.length?indexes.map(index=>row[index]):row.slice())
        };
    },
    generatedHeaders(width) { return Array.from({length: Math.max(0, width)}, (_, i) => `Column${i + 1}`); },
    ensureUniqueHeaders(headers=[]) {
        const seen = new Map();
        return headers.map((h, idx) => {
            let base = this.normalizeCellText(h).trim();
            if(!base) base = `Column${idx + 1}`;
            const key = base.toLowerCase();
            const next = (seen.get(key) || 0) + 1;
            seen.set(key, next);
            return next === 1 ? base : `${base}_${next}`;
        });
    },
    normalizeRows(rows=[], width=0, diagnostics=[], tableName='Table', {normalized=false}={}) {
        const out = [];
        let cells=0;
        rows.forEach((row, idx) => {
            const r = normalized?row:this.trimRow(row || []);
            if(this.isEmptyRow(r)) return;
            cells+=Math.max(r.length,width);
            if(cells>this.MAX_CELLS)throw new Error('解析结果超过 800 万单元格预算，请拆分数据；原文仍保留');
            if(width && r.length !== width) {
                diagnostics.push({ severity:'warning', code:'ROW_WIDTH_MISMATCH', table:tableName, row:idx + 1, message:`${tableName} 第 ${idx + 1} 行列数为 ${r.length}，目标列数为 ${width}` });
            }
            while(r.length < width) r.push('');
            out.push(r);
        });
        return out;
    },
    makeTableName(base, index, used) {
        let name = (base || `Table ${index + 1}`).trim() || `Table ${index + 1}`;
        if(['__proto__','prototype','constructor'].includes(name)) name = `Table ${index + 1}`;
        let final = name, i = 2;
        while(used.has(final)) final = `${name}_${i++}`;
        used.add(final);
        return final;
    },
    cellType(v) {
        const s = String(v ?? '').trim();
        if(!s) return 'empty';
        if(/^(true|false|yes|no|是|否)$/i.test(s)) return 'boolean';
        if(/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(s)) return 'number';
        if(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(s)) return 'date';
        return 'string';
    },
    looksIdentifier(v) {
        const s = String(v ?? '').trim();
        if(!s) return false;
        if(/^[-+]?\d+(?:\.\d+)?$/.test(s)) return false;
        return /^[A-Za-z_\u4e00-\u9fa5][\w\s.()\-/\u4e00-\u9fa5]*$/.test(s);
    },
    stripHtml(text='') {
        // Pure regex-based HTML tag stripper — no DOM dependency.
        const s = String(text || '');
        // Remove script/style blocks entirely
        const noBlocks = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
        // Remove remaining tags and decode common entities
        return noBlocks
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ')
            .trim();
    }
};

    return { TableUtils };
});
