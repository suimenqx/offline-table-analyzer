OTA.define('filter-engine', ["table-utils"], ({TableUtils}) => {
/* FilterEngine — pure filtering, highlighting, and column-projection logic.
   No DOM, no storage, no side effects. Consumes normalized tables and UI rules,
   produces filtered/projected row arrays. */

const FilterEngine = {
    /**
     * Parse a rule string into tokens, respecting quoted substrings.
     * Tokens are separated by whitespace; "…" and '…' act as quoting.
     * Returns an array of token strings.
     */
    tokenize(ruleStr) {
        if (!ruleStr) return [];
        const tokens = [];
        let token = '', quote = '';
        for (const ch of ruleStr.trim()) {
            if (quote) {
                token += ch;
                if (ch === quote) quote = '';
            } else if (ch === '"' || ch === "'") {
                quote = ch; token += ch;
            } else if (/\s/.test(ch)) {
                if (token) { tokens.push(token); token = ''; }
            } else {
                token += ch;
            }
        }
        if (token) tokens.push(token);
        return tokens;
    },

    /**
     * Test a single token against a row.
     * Supported token formats:
     *   key=value       — equality (case-insensitive)
     *   key:value       — contains (case-insensitive)
     *   key!=value      — not equal
     *   key>value       — numeric greater-than
     *   key>=value      — numeric greater-or-equal
     *   key<value       — numeric less-than
     *   key<=value      — numeric less-or-equal
     *   /regex/         — full-row regex match (max pattern length 200)
     *   plaintext       — full-row contains (case-insensitive)
     *
     * @param {string} token  A single token, e.g. "status=active" or a /regex-pattern/
     * @param {string[]} row  The row values
     * @param {Map<string,number>} headerMap  Lowercase header → column index
     * @returns {boolean}
     */
    matchToken(token, row, headerMap) {
        // NOT prefix: negate the result of the inner token
        if (token.startsWith('!') && token.length > 1) {
            return !this.matchToken(token.slice(1), row, headerMap);
        }

        // Operator-prefixed token:  key op value
        const opMatch = token.match(/^(.+?)(!=|>=|<=|=|>|<|:)(.+)$/);
        if (opMatch) {
            const key = opMatch[1].toLowerCase();
            const op = opMatch[2];
            const rawVal = opMatch[3].trim();

            // Strip surrounding quotes from value
            const unquoted = ((rawVal.startsWith('"') && rawVal.endsWith('"')) ||
                              (rawVal.startsWith("'") && rawVal.endsWith("'")))
                ? rawVal.slice(1, -1) : rawVal;
            const val = unquoted.toLowerCase();

            const idx = headerMap.get(key);
            if (idx === undefined) return false;

            const cellVal = (row[idx] || '').toLowerCase();
            const numC = parseFloat(cellVal);
            const numV = parseFloat(val);
            const isNum = !isNaN(numC) && !isNaN(numV);

            switch (op) {
                case '=':  return cellVal === val;
                case ':':  return cellVal.includes(val);
                case '!=': return cellVal !== val;
                case '>':  return isNum && numC > numV;
                case '>=': return isNum && numC >= numV;
                case '<':  return isNum && numC < numV;
                case '<=': return isNum && numC <= numV;
                default:   return false;
            }
        }

        // Regex token: /pattern/
        if (token.startsWith('/') && token.endsWith('/')) {
            const pattern = token.slice(1, -1);
            if (pattern.length > 200) return false;
            try {
                return new RegExp(pattern, 'i').test(row.join(' '));
            } catch (e) {
                return false;
            }
        }

        // Plain-text token: full-row contains
        return row.join(' ').toLowerCase().includes(token.toLowerCase());
    },

    /**
     * Evaluate a whitespace-delimited rule string against a row.
     * Tokens combined with AND semantics.
     * A token containing '|' is treated as OR (matches if ANY sub-token matches).
     *
     * @param {string} ruleStr  e.g. "status=active price>100" or a /regex/
     * @param {string[]} row
     * @param {Map<string,number>} headerMap
     * @returns {boolean}
     */
    matchRule(ruleStr, row, headerMap) {
        if (!ruleStr) return true;
        const tokens = this.tokenize(ruleStr);
        return tokens.every(t => {
            if (t.startsWith('/') && t.endsWith('/')) return this.matchToken(t, row, headerMap);
            if (t.includes('|')) return t.split('|').some(st => this.matchToken(st, row, headerMap));
            return this.matchToken(t, row, headerMap);
        });
    },

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

    /**
     * Apply all filters, highlights, focus projection and paging to a table.
     *
     * @param {Object} table  NormalizedTable { name, headers, rows, isView }
     * @param {Object} rules  Per-table rules from ui.rules[tableName] or {}
     * @param {Object} ui     Current document ui object
     * @param {string} globalFilter  Global filter string (applied to all tables)
     * @param {boolean} enableHighlight  Whether highlighting is enabled
     * @param {boolean} onlyHighlighted  Whether only highlighted rows should be shown
     * @returns {{headers: string[], rows: {d:string[], _hl:boolean, _sourceRow:number, _sourceCols:number[], _readOnly:boolean}[]}}
     */
    processTable(table, rules, ui, globalFilter, enableHighlight, onlyHighlighted) {
        const { headers: focusHeaders, indexes: focusIndexes } =
            this.resolveFocusColumns(table.headers, rules.focus || null);

        const headerMap = this.buildHeaderMap(table.headers);

        const colFilterMap = (ui.columnFilters && ui.columnFilters[table.name]) || {};
        const activeColFilters = Object.entries(colFilterMap).filter(
            ([, v]) => (v ?? '').toString().trim()
        );

        const gF = globalFilter || '';
        const tF = rules.filter || '';
        const hlF = rules.hl || '';

        const rows = [];
        table.rows.forEach((row, sourceRow) => {
            // Global filter
            if (gF && !this.matchRule(gF, row, headerMap)) return;
            // Table-level filter
            if (tF && !this.matchRule(tF, row, headerMap)) return;
            // Column-level filters (contains / regex, case-insensitive)
            if (activeColFilters.length) {
                const pass = activeColFilters.every(([col, val]) => {
                    const idx = table.headers.indexOf(col);
                    if (idx === -1) return true;
                    const cellVal = (row[idx] ?? '').toString();
                    const filterVal = val.toString().trim();
                    // Regex token: /pattern/
                    if (filterVal.startsWith('/') && filterVal.endsWith('/')) {
                        const pattern = filterVal.slice(1, -1);
                        if (pattern.length > 200) return false;
                        try {
                            return new RegExp(pattern, 'i').test(cellVal);
                        } catch (e) {
                            return false;
                        }
                    }
                    // Default: contains (case-insensitive)
                    return cellVal.toLowerCase().includes(filterVal.toLowerCase());
                });
                if (!pass) return;
            }
            // Highlight check
            let hl = false;
            if (enableHighlight !== false && hlF && this.matchRule(hlF, row, headerMap)) hl = true;
            // Only-highlighted mode
            if (onlyHighlighted && !hl) return;

            rows.push({
                d: focusIndexes.map(i => row[i]),
                _hl: hl,
                _sourceRow: sourceRow,
                _sourceCols: focusIndexes.slice(),
                _readOnly: !!table.isView
            });
        });

        return { headers: focusHeaders, rows };
    }
};

    return { FilterEngine };
});
