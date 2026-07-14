/* Import Engine */
const TableUtils = {
    normalizeText(text='') { return String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'); },
    lines(text='') { return this.normalizeText(text).split('\n'); },
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
    normalizeRows(rows=[], width=0, diagnostics=[], tableName='Table') {
        const out = [];
        rows.forEach((row, idx) => {
            const r = this.trimRow(row || []);
            if(this.isEmptyRow(r)) return;
            if(width && r.length !== width) {
                diagnostics.push({ level:'warning', code:'ROW_WIDTH_MISMATCH', table:tableName, row:idx + 1, message:`${tableName} 第 ${idx + 1} 行列数为 ${r.length}，目标列数为 ${width}` });
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
        const div = document.createElement('div');
        div.innerHTML = String(text || '');
        return div.textContent || div.innerText || '';
    }
};
