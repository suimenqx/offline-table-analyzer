const HeaderResolver = {
    infer(rows, options={}) {
        const clean = (rows || []).map(r => TableUtils.trimRow(r)).filter(r => !TableUtils.isEmptyRow(r));
        const width = TableUtils.maxWidth(clean);
        const forced = options.headerMode || 'auto';
        if(!clean.length || !width) return { headers:[], rows:[], hasHeader:false, generatedHeaders:true, diagnostics:[] };
        let hasHeader = false;
        if(forced === 'first-row') hasHeader = true;
        else if(forced === 'none') hasHeader = false;
        else if(options.hasHeader === true) hasHeader = true;
        else if(options.hasHeader === false) hasHeader = false;
        else hasHeader = this.isLikelyHeader(clean);

        const diagnostics = [];
        let headers;
        let body;
        if(hasHeader) {
            const rawHeaders = clean[0].slice();
            while(rawHeaders.length < width) rawHeaders.push('');
            headers = TableUtils.ensureUniqueHeaders(rawHeaders.slice(0, width));
            body = clean.slice(1);
        } else {
            headers = TableUtils.generatedHeaders(width);
            body = clean;
        }
        const rowsOut = TableUtils.normalizeRows(body, headers.length, diagnostics, options.tableName || 'Table');
        return { headers, rows:rowsOut, hasHeader, generatedHeaders:!hasHeader, diagnostics };
    },
    isLikelyHeader(rows) {
        if(rows.length < 2) return false;
        const first = rows[0];
        const rest = rows.slice(1, Math.min(rows.length, 12));
        const nonEmpty = first.filter(v => String(v ?? '').trim() !== '').length;
        if(!nonEmpty) return false;
        const unique = new Set(first.map(v => String(v ?? '').trim().toLowerCase()).filter(Boolean)).size;
        const idLike = first.filter(v => TableUtils.looksIdentifier(v)).length;
        const firstTypes = first.map(v => TableUtils.cellType(v));
        const allFirstNumeric = firstTypes.every(t => t === 'number' || t === 'date' || t === 'empty');
        const typeDiff = first.reduce((count, val, idx) => {
            const t = TableUtils.cellType(val);
            const samples = rest.map(r => TableUtils.cellType((r || [])[idx])).filter(x => x !== 'empty');
            if(!samples.length) return count;
            const sampleMajor = samples.sort((a,b) => samples.filter(x=>x===b).length - samples.filter(x=>x===a).length)[0];
            return count + (t !== sampleMajor ? 1 : 0);
        }, 0);
        let score = 0;
        if(unique === nonEmpty) score += 0.2;
        if(idLike / nonEmpty >= 0.7) score += 0.35;
        if(typeDiff / Math.max(nonEmpty, 1) >= 0.45) score += 0.35;
        if(first.some(v => /^(id|name|key|type|date|time|status|amount|price|count|validflag)$/i.test(String(v).trim()))) score += 0.2;
        if(allFirstNumeric) score -= 0.45;
        return score >= 0.55;
    }
};
