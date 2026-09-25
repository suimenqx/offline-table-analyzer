OTA.define('source-snapshot', ['table-utils'], ({TableUtils}) => {
/* SourceSnapshot owns ephemeral source metadata that must match a document and
   its current text before the parser or diagnostics can use it. */
const SourceSnapshot = {
    PREVIEW_LIMIT: 200000,
    KNOWN_CLIPBOARD_TYPES: ['text/plain', 'text/html', 'text/rtf', 'text/csv', 'text/uri-list'],
    _lastSnapshot: null,

    createSourceFormat(type, value='') {
        const text = String(value || '');
        return {
            type,
            length: text.length,
            preview: text.slice(0, this.PREVIEW_LIMIT),
            truncated: text.length > this.PREVIEW_LIMIT,
        };
    },

    createSourceSnapshot({ kind='clipboard', docId, plain='', html='', types=[], formats=[], files=[], items=[], fileName='' } = {}) {
        const safePlain = String(plain || '');
        const safeHtml = String(html || '');
        const typeSet = new Set((Array.isArray(types) ? types : []).map(type => String(type || '')).filter(Boolean));
        if (safePlain && !typeSet.has('text/plain')) typeSet.add('text/plain');
        if (safeHtml && !typeSet.has('text/html')) typeSet.add('text/html');
        const knownFormats = (Array.isArray(formats) ? formats : []).map(item => {
            if (!item || !item.type) return null;
            if (typeof item.preview === 'string' && Number.isFinite(item.length)) {
                return {
                    type: item.type,
                    length: item.length,
                    preview: item.preview,
                    truncated: Boolean(item.truncated),
                };
            }
            return this.createSourceFormat(item.type, item.value);
        }).filter(Boolean);
        const knownTypes = new Set(knownFormats.map(item => item.type));
        if (safePlain && !knownTypes.has('text/plain')) knownFormats.push(this.createSourceFormat('text/plain', safePlain));
        if (safeHtml && !knownTypes.has('text/html')) knownFormats.push(this.createSourceFormat('text/html', safeHtml));
        return {
            kind,
            docId,
            fileName: String(fileName || ''),
            plain: safePlain,
            html: safeHtml,
            types: Array.from(typeSet),
            formats: knownFormats,
            files: Array.isArray(files) ? files.slice() : [],
            items: Array.isArray(items) ? items.slice() : [],
            hasHtmlTable: /<table[\s>]/i.test(safeHtml) && /<tr[\s>]/i.test(safeHtml),
        };
    },

    captureClipboard({ docId, plain='', html='', types=[], formats=[], files=[], items=[] } = {}) {
        return this.set(this.createSourceSnapshot({
            kind: 'clipboard', docId, plain, html, types, formats, files, items,
        }));
    },

    captureFile({ docId, fileName='', text='', format='auto' } = {}) {
        const source = String(text || '');
        const isHtml = format === 'html-table';
        const type = isHtml ? 'text/html' : 'text/plain';
        return this.set(this.createSourceSnapshot({
            kind: 'file',
            docId,
            fileName,
            plain: source,
            html: isHtml ? source : '',
            types: [type],
            formats: [{ type, value: source }],
        }));
    },

    set(snapshot) {
        this._lastSnapshot = snapshot || null;
        return this._lastSnapshot;
    },

    getLastPaste() {
        return this._lastSnapshot;
    },

    getCurrentPaste({ docId, text='' } = {}) {
        const snapshot = this._lastSnapshot;
        if (!snapshot || snapshot.docId !== docId) return null;
        if (TableUtils.normalizeText(snapshot.plain).trim() !== TableUtils.normalizeText(text).trim()) return null;
        return snapshot;
    },

    clear() {
        this._lastSnapshot = null;
        return null;
    },
};

    return { SourceSnapshot };
});
