OTA.define('clipboard', ["store"], ({Store}) => {
/* Clipboard Formatting */
const ClipboardFormatter = {
    escapeHtml(str='') {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },
    normalizeCell(value='') {
        return String(value ?? '')
            .replace(/&lt;\s*br\s*\/?\s*&gt;/gi, '\n')
            .replace(/<\s*br\s*\/?\s*>/gi, '\n')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n');
    },
    protectSpreadsheetFormula(value='') {
        const text = this.normalizeCell(value);
        const enabled = typeof Store === 'undefined' || !Store.state || Store.state.spreadsheetSafe !== false;
        if(!enabled) return text;
        const dangerous = /^[=+@]/.test(text) || (/^-/.test(text) && !/^-\d+(?:\.\d+)?$/.test(text));
        return dangerous ? `'${text}` : text;
    },
    toDelimited(matrix, delimiter='\t') {
        const quoteFor = (value) => {
            const text = this.protectSpreadsheetFormula(value);
            const mustQuote = text.includes(delimiter) || /["\n\r]/.test(text);
            const escaped = text.replace(/"/g, '""');
            return mustQuote ? `"${escaped}"` : escaped;
        };
        return (matrix || []).map(row => (row || []).map(quoteFor).join(delimiter)).join('\n');
    },
    toMarkdown(matrix) {
        if(!matrix || !matrix.length) return '';
        const esc = value => this.normalizeCell(value).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
        const widths = this.getWidths(matrix.map(row => row.map(esc)));
        const line = row => `| ${row.map((cell, i) => esc(cell).padEnd(widths[i], ' ')).join(' | ')} |`;
        const sep = `| ${widths.map(w => '-'.repeat(Math.max(3, w))).join(' | ')} |`;
        const rows = [line(matrix[0]), sep];
        matrix.slice(1).forEach(row => rows.push(line(row)));
        return rows.join('\n');
    },
    toAscii(matrix) {
        if(!matrix || !matrix.length) return '';
        const clean = value => this.normalizeCell(value).replace(/\n/g, ' ');
        const normalized = matrix.map(row => row.map(clean));
        const widths = this.getWidths(normalized);
        const border = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+';
        const line = row => '| ' + row.map((cell, i) => String(cell).padEnd(widths[i], ' ')).join(' | ') + ' |';
        const out = [border, line(normalized[0]), border];
        normalized.slice(1).forEach(row => out.push(line(row)));
        out.push(border);
        return out.join('\n');
    },
    getWidths(matrix) {
        const width = Math.max(0, ...(matrix || []).map(row => row.length));
        return Array.from({length: width}, (_, i) => Math.max(3, ...(matrix || []).map(row => String(row[i] ?? '').length)));
    },
    toHtml(matrix) {
        if(!matrix || !matrix.length) return '<table></table>';
        const htmlCell = cell => this.escapeHtml(this.protectSpreadsheetFormula(cell)).replace(/\n/g, '<br>');
        const rowHtml = (row, tag) => `<tr>${(row || []).map(cell => `<${tag} style="border:1px solid #ccc; padding:2px 6px; white-space:pre-wrap;">${htmlCell(cell)}</${tag}>`).join('')}</tr>`;
        return `<table border="1"><thead>${rowHtml(matrix[0], 'th')}</thead><tbody>${matrix.slice(1).map(row => rowHtml(row, 'td')).join('')}</tbody></table>`;
    },
    toText(matrix, format='default') {
        switch(format) {
            case 'csv': return this.toDelimited(matrix, ',');
            case 'markdown': return this.toMarkdown(matrix);
            case 'ascii': return this.toAscii(matrix);
            case 'default':
            default: return this.toDelimited(matrix, '\t');
        }
    },
    label(format='default') {
        return ({ default:'默认', csv:'CSV', markdown:'Markdown', ascii:'ASCII' })[format] || '默认';
    }
};

    return { ClipboardFormatter };
});
