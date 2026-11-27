OTA.define('filter-engine', ["table-utils"], ({TableUtils}) => {
/* FilterEngine — pure filtering, highlighting, and column-projection logic.
   No DOM, no storage, no side effects. Consumes normalized tables and UI rules,
   produces filtered/projected row arrays. */

// A rule is an AND of whitespace-separated groups. Each group can contain OR
// alternatives. Delimiters inside a quoted value or a regex belong to the atom.
function regexEnd(text, start) {
    let inClass = false;
    for (let i = start + 1; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\\') i++;
        else if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass && (i + 1 === text.length || /[\s|]/.test(text[i + 1]))) return i;
    }
    return -1;
}

function ruleGroups(rule) {
    const groups = [];
    let alternatives = [], atom = '', quote = '';
    const finishGroup = () => {
        if (atom || alternatives.length) groups.push([...alternatives, atom]);
        alternatives = [];
        atom = '';
    };
    const text = (rule || '').trim();
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            atom += ch;
            if (ch === quote) quote = '';
        } else if (ch === '"' || ch === "'") {
            quote = ch;
            atom += ch;
        } else if (ch === '/' && /^!*$/.test(atom)) {
            const end = regexEnd(text, i);
            if (end >= 0) {
                atom += text.slice(i, end + 1);
                i = end;
            } else atom += ch;
        } else if (ch === '|') {
            alternatives.push(atom);
            atom = '';
        } else if (/\s/.test(ch)) {
            finishGroup();
        } else atom += ch;
    }
    finishGroup();
    return groups;
}

function compileRegex(token) {
    const pattern = token.slice(1, -1);
    if (pattern.length <= 200) {
        try {
            const regex = new RegExp(pattern, 'i');
            return text => regex.test(text);
        } catch (_) { /* Invalid patterns match no rows. */ }
    }
    return () => false;
}

function compileToken(token, headerMap) {
    if (token.startsWith('!') && token.length > 1) {
        const inner = compileToken(token.slice(1), headerMap);
        return row => !inner(row);
    }
    if (token.startsWith('/') && token.endsWith('/')) {
        const test = compileRegex(token);
        return row => test(row.join(' '));
    }
    const field = token.match(/^(.+?)(!=|>=|<=|=|>|<|:)(.+)$/);
    if (!field) {
        const needle = token.toLowerCase();
        return row => row.join(' ').toLowerCase().includes(needle);
    }
    const idx = headerMap.get(field[1].toLowerCase());
    if (idx === undefined) return () => false;
    const value = field[3].trim().replace(/^(["'])([\s\S]*)\1$/, (_, quote, body) => body.split(quote + quote).join(quote)).toLowerCase();
    const text = row => String(row[idx] ?? '').toLowerCase();
    const numeric = parseFloat(value);
    switch (field[2]) {
        case '=':  return row => text(row) === value;
        case '!=': return row => text(row) !== value;
        case ':':  return row => text(row).includes(value);
        case '>':  return row => parseFloat(row[idx]) > numeric;
        case '>=': return row => parseFloat(row[idx]) >= numeric;
        case '<':  return row => parseFloat(row[idx]) < numeric;
        case '<=': return row => parseFloat(row[idx]) <= numeric;
    }
}

function compileRule(rule, headerMap) {
    const tests = ruleGroups(rule).map(group => {
        const alternatives = group.map(token => compileToken(token, headerMap));
        return alternatives.length === 1 ? alternatives[0] : row => alternatives.some(test => test(row));
    });
    return tests.length === 1 ? tests[0] : row => tests.every(test => test(row));
}

function columnTests(headers, filters) {
    const tests = [];
    for (const [column, raw] of Object.entries(filters || {})) {
        const idx = headers.indexOf(column);
        const value = String(raw ?? '').trim();
        if (idx < 0 || !value) continue;
        if (value.startsWith('/') && value.endsWith('/')) {
            const test = compileRegex(value);
            tests.push(row => test(String(row[idx] ?? '')));
        } else {
            const needle = value.toLowerCase();
            tests.push(row => String(row[idx] ?? '').toLowerCase().includes(needle));
        }
    }
    return tests;
}

const FilterEngine = {
    tokenize(rule) { return ruleGroups(rule).map(group => group.join('|')); },
    matchToken(token, row, headerMap) { return compileToken(token, headerMap)(row); },
    matchRule(rule, row, headerMap) { return compileRule(rule, headerMap)(row); },

    /**
     * Build a lowercase-header → column-index map for fast lookups.
     */
    buildHeaderMap(headers) {
        return new Map(headers.map((h, i) => [h.toLowerCase(), i]));
    },

    /**
     * Resolve which columns to project (focus).
     * Returns {headers, indexes} where indexes are the indices into the original row.
     * If no focus is active, returns all columns.
     */
    resolveFocusColumns(tableHeaders, focusList) {
        if (!focusList || !focusList.length) {
            const indexes = tableHeaders.map((_, i) => i);
            return { headers: tableHeaders.slice(), indexes };
        }
        const headers = [];
        const indexes = [];
        focusList.forEach(col => {
            const i = tableHeaders.indexOf(col);
            if (i > -1) { headers.push(col); indexes.push(i); }
        });
        // Fall back to all columns if every focus column was invalid
        if (!headers.length) {
            const allIndexes = tableHeaders.map((_, i) => i);
            return { headers: tableHeaders.slice(), indexes: allIndexes };
        }
        return { headers, indexes };
    },

    /** Scan rules once per table. Paging only reads the requested matching positions. */
    indexTable(table, rules, ui, globalFilter, enableHighlight, onlyHighlighted) {
        const {headers, indexes} = this.resolveFocusColumns(table.headers, rules.focus);
        const sourceCols = Object.freeze(indexes);
        const allColumns = indexes.length === table.headers.length && indexes.every((col, i) => col === i);
        const headerMap = this.buildHeaderMap(table.headers);
        const filters = [globalFilter, rules.filter].filter(Boolean).map(rule => compileRule(rule, headerMap));
        filters.push(...columnTests(table.headers, ui.columnFilters?.[table.name]));
        const highlight = enableHighlight !== false && rules.hl ? compileRule(rules.hl, headerMap) : null;
        const matches = filters.length || onlyHighlighted ? [] : null;
        const highlighted = highlight ? new Uint8Array(table.rows.length) : null;
        if (matches || highlight) {
            table.rows.forEach((row, i) => {
                if (!filters.every(test => test(row))) return;
                const marked = highlight && highlight(row);
                if (marked) highlighted[i] = 1;
                if (matches && (!onlyHighlighted || marked)) matches.push(i);
            });
        }
        const totalRows = matches ? matches.length : table.rows.length;
        const sourceIndex = i => matches ? matches[i] : i;
        const project = i => {
            const row = table.rows[i];
            return allColumns && row.length === indexes.length ? row.slice() : indexes.map(col => row[col]);
        };
        return {
            headers, totalRows,
            readRows(start=0, end=totalRows) {
                const rows = [];
                for (let i = start; i < Math.min(end, totalRows); i++) {
                    const source = sourceIndex(i);
                    rows.push({d:project(source), _hl:!!highlighted?.[source], _sourceRow:source,
                        _sourceCols:sourceCols, _readOnly:!!table.isView || table.editSource === null, _resultIndex:i});
                }
                return rows;
            },
            exportRows() {
                return Array.from({length:totalRows}, (_, i) => project(sourceIndex(i)));
            },
        };
    },

    processTable(table, rules, ui, globalFilter, enableHighlight, onlyHighlighted) {
        const index = this.indexTable(table, rules, ui, globalFilter, enableHighlight, onlyHighlighted);
        return {headers:index.headers, rows:index.readRows()};
    }
};

    return { FilterEngine };
});
