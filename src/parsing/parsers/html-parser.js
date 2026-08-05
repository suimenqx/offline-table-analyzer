OTA.define('html-parser', ["table-utils","header-resolver"], ({TableUtils}, {HeaderResolver}) => {
const BLOCK_TAGS = new Set([
    'address', 'article', 'aside', 'blockquote', 'dd', 'details', 'div', 'dl', 'dt',
    'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4',
    'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
    'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'
]);
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const SKIP_TAGS = new Set(['script', 'style', 'template']);

const decodeHtmlEntities = (value='') => String(value).replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39|#\d+|#x[\da-f]+);/gi, entity => {
    const lower = entity.toLowerCase();
    const named = { '&nbsp;':' ', '&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&apos;':"'", '&#39;':"'" };
    if(named[lower] !== undefined) return named[lower];
    const hex = /^&#x([\da-f]+);$/i.exec(entity);
    const decimal = /^&#(\d+);$/.exec(entity);
    const codePoint = hex ? parseInt(hex[1], 16) : decimal ? parseInt(decimal[1], 10) : NaN;
    if(!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) return entity;
    try { return String.fromCodePoint(codePoint); } catch (_) { return entity; }
});

const findTagEnd = (html, start) => {
    let quote = '';
    for(let i = start + 1; i < html.length; i++) {
        const ch = html[i];
        if(quote) {
            if(ch === quote) quote = '';
        } else if(ch === '"' || ch === "'") {
            quote = ch;
        } else if(ch === '>') {
            return i;
        }
    }
    return -1;
};

/**
 * Extract readable cell text without relying on tag stripping alone.
 * HTML block elements are visual line boundaries, while inline elements
 * stay adjacent.  The returned chunks retain <pre> whitespace until the
 * final normalization step.
 */
const extractHtmlText = (fragment='') => {
    const html = String(fragment ?? '');
    const chunks = [];
    const openTags = [];
    const isSkipped = () => openTags.some(tag => SKIP_TAGS.has(tag));
    const isPreserved = () => openTags.includes('pre');
    const append = (text, preserve=isPreserved()) => {
        if(!text) return;
        const last = chunks[chunks.length - 1];
        if(last && last.preserve === preserve) last.text += text;
        else chunks.push({ text, preserve });
    };
    const appendBoundary = () => {
        if(isSkipped()) return;
        const last = chunks[chunks.length - 1];
        if(last && last.text.endsWith('\n') && last.preserve === isPreserved()) return;
        append('\n', isPreserved());
    };

    let i = 0;
    while(i < html.length) {
        if(html[i] !== '<') {
            const next = html.indexOf('<', i);
            const text = html.slice(i, next < 0 ? html.length : next);
            if(!isSkipped()) {
                let decoded = decodeHtmlEntities(text);
                // Keep compatibility with existing literal/escaped <br> support.
                if(!isPreserved()) decoded = decoded.replace(/<\s*br\s*\/?>/gi, '\n');
                append(decoded);
            }
            i = next < 0 ? html.length : next;
            continue;
        }

        if(html.startsWith('<!--', i)) {
            const endComment = html.indexOf('-->', i + 4);
            i = endComment < 0 ? html.length : endComment + 3;
            continue;
        }

        const end = findTagEnd(html, i);
        if(end < 0) {
            if(!isSkipped()) append(decodeHtmlEntities(html.slice(i)));
            break;
        }
        const rawTag = html.slice(i, end + 1);
        const match = /^<\s*(\/?)\s*([A-Za-z][\w:-]*)[\s\S]*>$/i.exec(rawTag);
        if(!match) {
            if(!isSkipped()) append(decodeHtmlEntities(rawTag));
            i = end + 1;
            continue;
        }

        const closing = Boolean(match[1]);
        const tag = match[2].toLowerCase();
        const skippedBefore = isSkipped();
        if(closing) {
            if(!skippedBefore && BLOCK_TAGS.has(tag)) appendBoundary();
            const index = openTags.lastIndexOf(tag);
            if(index >= 0) openTags.splice(index, 1);
        } else {
            if(!skippedBefore && tag === 'br') append('\n', isPreserved());
            else if(!skippedBefore && BLOCK_TAGS.has(tag)) appendBoundary();
            const selfClosing = /\/\s*>$/.test(rawTag) || VOID_TAGS.has(tag);
            if(!selfClosing) openTags.push(tag);
        }
        i = end + 1;
    }

    const normalizePlain = value => TableUtils.normalizeCellText(value, { convertHtmlBreaks:false })
        .replace(/[^\S\n]+/g, ' ')
        .replace(/ *\n */g, '\n');
    const normalized = chunks.map(chunk => chunk.preserve
        ? TableUtils.normalizeCellText(chunk.text, { convertHtmlBreaks:false })
        : normalizePlain(chunk.text)
    ).join('');
    return normalized.trim();
};

const HtmlTableParser = {
    id:'html-table', label:'HTML 网页表格',
    parse(source, options={}) {
        const html = source.html || source.text || '';
        const tables = [];
        const diagnostics = [];
        const used = new Set();
        const getText = (value='') => extractHtmlText(value);
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
            tables.push({ name, headers:resolved.headers, rows:resolved.rows, sourceType:this.id, meta:{ hasHeader:resolved.hasHeader, generatedHeaders:resolved.generatedHeaders, headerConfidence:resolved.headerConfidence, headerReasons:resolved.headerReasons }, diagnostics:resolved.diagnostics });
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

    return { HtmlTableParser };
});
