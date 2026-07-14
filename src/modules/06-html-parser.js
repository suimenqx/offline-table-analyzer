const HtmlTableParser = {
    id:'html-table', label:'HTML 网页表格',
    confidence(source) {
        const html = source.html || '';
        return /<table[\s>]/i.test(html) && /<tr[\s>]/i.test(html) ? 0.98 : 0;
    },
    parse(source, options={}) {
        const html = source.html || source.text || '';
        const tables = [];
        const diagnostics = [];
        const used = new Set();
        const getText = (value='') => TableUtils.normalizeCellText(String(value || '')
            .replace(/<br\s*\/?\s*>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/[^\S\n]+/g, ' ')
            .replace(/ *\n */g, '\n'))
            .trim();
        const parseTableHtml = (tableHtml, idx) => {
            const matrix = [];
            const rowSpans = [];
            let explicitHeader = false;
            const trMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
            trMatches.forEach(trHtml => {
                const cells = [];
                rowSpans.forEach((entry, col) => {
                    if(entry && entry.remaining > 0) {
                        cells[col] = entry.value;
                        entry.remaining--;
                    }
                });
                const cellRe = /<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi;
                let m;
                while((m = cellRe.exec(trHtml)) !== null) {
                    const tag = m[1].toLowerCase();
                    const attrs = m[2] || '';
                    const body = m[3] || '';
                    if(tag === 'th') explicitHeader = true;
                    const spanMatch = /colspan\s*=\s*["']?(\d+)/i.exec(attrs);
                    const span = Math.max(1, parseInt(spanMatch ? spanMatch[1] : '1', 10) || 1);
                    const rowSpanMatch = /rowspan\s*=\s*["']?(\d+)/i.exec(attrs);
                    const rowSpan = Math.max(1, parseInt(rowSpanMatch ? rowSpanMatch[1] : '1', 10) || 1);
                    const value = getText(body);
                    let col = 0;
                    while(cells[col] !== undefined) col++;
                    for(let i=0; i<span; i++) {
                        cells[col + i] = i === 0 ? value : '';
                        if(rowSpan > 1) rowSpans[col + i] = { remaining:rowSpan - 1, value:i === 0 ? value : '' };
                    }
                }
                if(cells.length) matrix.push(cells);
            });
            if(!matrix.length) return;
            const summary = /summary\s*=\s*["']([^"']+)/i.exec(tableHtml);
            const dataName = /data-name\s*=\s*["']([^"']+)/i.exec(tableHtml);
            const name = TableUtils.makeTableName((dataName && dataName[1]) || (summary && summary[1]) || `HTML Table ${idx + 1}`, idx, used);
            const resolved = HeaderResolver.infer(matrix, { ...options, hasHeader: explicitHeader || undefined, tableName:name });
            tables.push({ name, headers:resolved.headers, rows:resolved.rows, sourceType:this.id, meta:{ hasHeader:resolved.hasHeader, generatedHeaders:resolved.generatedHeaders }, diagnostics:resolved.diagnostics });
            diagnostics.push(...resolved.diagnostics);
        };
        if(typeof DOMParser !== 'undefined') {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            Array.from(doc.querySelectorAll('table')).forEach((tableEl, idx) => parseTableHtml(tableEl.outerHTML, idx));
        } else {
            (html.match(/<table[\s\S]*?<\/table>/gi) || []).forEach((tableHtml, idx) => parseTableHtml(tableHtml, idx));
        }
        return { tables, diagnostics };
    }
};
