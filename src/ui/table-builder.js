OTA.define('table-builder', ["runtime","filter-engine"], ({$, createEl, escapeHtml}, {FilterEngine}) => {
/* TableBuilder — DOM construction helpers for column-header and row-header
   preview tables. Extracted from app.js to keep the App orchestrator lean. */

const TableBuilder = {

    /**
     * Build a standard column-header preview <table>.
     * Each column in `headers` becomes a <th>; data rows follow.
     * Column headers support click-to-filter (caller wires handlers).
     *
     * @param {Object} t      NormalizedTable { name, headers, rows, isView }
     * @param {Object} res    Processed table { headers, rows[] }
     *                         where each row is { d, _hl, _sourceRow, _sourceCols, _readOnly, _resultIndex }
     * @param {number} tIdx   Table index for DOM dataset
     * @param {Object} colFilters  Active column filters: { colName: filterValue }
     * @param {function} onFilterClick  (tableName, colName, anchorEl) => void
     * @param {function} onFilterClear  (tableName, colName) => void
     * @returns {HTMLTableElement}
     */
    buildColumnHeaderTable(t, res, tIdx, colFilters, onFilterClick, onFilterClear) {
        const tbl = createEl('table');
        tbl.tabIndex = -1;
        tbl.dataset.idx = tIdx;
        tbl.dataset.tableName = t.name;
        tbl.dataset.viewMode = 'column-header';
        tbl.setAttribute('aria-label', `${t.name} 列表头预览`);

        const thead = createEl('thead');
        const thRow = createEl('tr');
        res.headers.forEach((h, hIdx) => {
            const th = createEl('th');
            th.classList.add('filterable-th');
            th.tabIndex = 0;
            th.setAttribute('role', 'button');
            const hasFilter = colFilters[h] && colFilters[h].toString().trim();
            th.title = hasFilter
                ? `已过滤：${colFilters[h]}`
                : '点击过滤该列（包含匹配，忽略大小写）';
            if (hasFilter) th.style.color = 'var(--primary)';

            const label = createEl('span', 'th-label');
            label.textContent = h;
            if (hasFilter) {
                const dot = createEl('span', 'th-filter-dot');
                label.appendChild(dot);
                const clearBtn = createEl('span', 'th-filter-clear');
                clearBtn.textContent = '×';
                clearBtn.title = '清除该列过滤';
                clearBtn.onclick = (ev) => {
                    ev.stopPropagation();
                    if (onFilterClear) onFilterClear(t.name, h);
                };
                th.appendChild(clearBtn);
            }
            th.appendChild(label);
            th.onclick = (ev) => {
                ev.stopPropagation();
                if (onFilterClick) onFilterClick(t.name, h, th);
            };
            th.onkeydown = (ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    if (onFilterClick) onFilterClick(t.name, h, th);
                }
            };
            th.dataset.vc = hIdx;
            thRow.appendChild(th);
        });
        thead.appendChild(thRow);
        tbl.appendChild(thead);

        const tbody = createEl('tbody');
        res.rows.forEach((r, rIdx) => {
            const tr = createEl('tr');
            if (r._hl) tr.className = 'highlight-row';
            r.d.forEach((c, cIdx) => {
                const td = createEl('td');
                const v = c === undefined || c === null ? '' : c;
                td.textContent = v;
                if (String(v).length > 18) td.dataset.full = v;
                td.dataset.r = rIdx;
                td.dataset.c = cIdx;
                td.dataset.vr = rIdx;
                td.dataset.vc = cIdx;
                td.dataset.resultRow = r._resultIndex ?? rIdx;
                if (!r._readOnly) {
                    td.dataset.sourceRow = r._sourceRow;
                    td.dataset.sourceCol = r._sourceCols[cIdx];
                    td.title = '双击编辑；修改会作为当前页签的修订保存';
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        tbl.appendChild(tbody);
        return tbl;
    },

    /**
     * Build a transposed row-header preview <table>.
     * Headers become the first column (field names), each data row
     * becomes a column.
     *
     * @param {Object} t      NormalizedTable
     * @param {Object} res    Processed table { headers, rows[] }
     * @param {number} tIdx   Table index for DOM dataset
     * @param {Object} colFilters  Active column filters
     * @param {function} onFilterClick  (tableName, colName, anchorEl) => void
     * @returns {HTMLTableElement}
     */
    buildRowHeaderTable(t, res, tIdx, colFilters, onFilterClick) {
        const tbl = createEl('table');
        tbl.tabIndex = -1;
        tbl.dataset.idx = tIdx;
        tbl.dataset.tableName = t.name;
        tbl.dataset.viewMode = 'row-header';
        tbl.setAttribute('aria-label', `${t.name} 行表头预览`);

        const thead = createEl('thead');
        const htr = createEl('tr');
        const corner = createEl('th', 'row-header-th');
        corner.textContent = '字段';
        htr.appendChild(corner);
        res.rows.forEach((row, rIdx) => {
            const th = createEl('th');
            th.textContent = `Row ${(row._resultIndex ?? rIdx) + 1}`;
            th.dataset.vc = rIdx + 1;
            htr.appendChild(th);
        });
        thead.appendChild(htr);
        tbl.appendChild(thead);

        const tbody = createEl('tbody');
        res.headers.forEach((h, cIdx) => {
            const tr = createEl('tr');
            const hCell = createEl('td', 'row-header-cell filterable-th');
            hCell.tabIndex = 0;
            hCell.setAttribute('role', 'button');
            const hasFilter = colFilters[h] && colFilters[h].toString().trim();
            hCell.textContent = h;
            hCell.title = hasFilter
                ? `已过滤：${colFilters[h]}`
                : '点击过滤该字段';
            if (hasFilter) hCell.style.color = 'var(--primary)';
            hCell.onclick = (ev) => {
                ev.stopPropagation();
                if (onFilterClick) onFilterClick(t.name, h, hCell);
            };
            hCell.onkeydown = (ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    if (onFilterClick) onFilterClick(t.name, h, hCell);
                }
            };
            tr.appendChild(hCell);

            res.rows.forEach((r, rIdx) => {
                const td = createEl('td');
                const v = r.d[cIdx] === undefined || r.d[cIdx] === null ? '' : r.d[cIdx];
                td.textContent = v;
                if (String(v).length > 18) td.dataset.full = v;
                td.dataset.r = rIdx;
                td.dataset.c = cIdx;
                td.dataset.vr = cIdx;
                td.dataset.vc = rIdx;
                td.dataset.resultRow = r._resultIndex ?? rIdx;
                if (!r._readOnly) {
                    td.dataset.sourceRow = r._sourceRow;
                    td.dataset.sourceCol = r._sourceCols[cIdx];
                    td.title = '双击编辑；修改会作为当前页签的修订保存';
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        tbl.appendChild(tbody);
        return tbl;
    },

    /**
     * Determine whether single-table view mode should be activated
     * to avoid rendering too many DOM nodes.
     */
    shouldUseSingleTableView(tables) {
        const tableCount = tables.length;
        const totalRows = tables.reduce((sum, table) => sum + (table.rows || []).length, 0);
        const totalCells = tables.reduce(
            (sum, table) => sum + (table.rows || []).length * (table.headers || []).length, 0
        );
        return tableCount >= 8 || totalRows >= 1000 || totalCells >= 30000;
    }
};

    return { TableBuilder };
});
