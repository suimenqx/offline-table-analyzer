OTA.define('filter-controller', ["runtime", "store", "dispatch"], ({$, createEl}, {Store}, {dispatch}) => {
/* FilterController — column filter popover and table-level filter clearing.

   Responsibilities:
   - Popover UI for per-column "contains" filters
   - Position the popover near the clicked column header
   - Apply / clear / close actions
   - Clear all filters for a table

   Global/table-level filter inputs are bound directly in App.bind().
*/

const FilterController = {
    /** Popover state */
    open: false,
    table: null,
    column: null,
    pop: null,
    input: null,
    title: null,

    /**
     * Initialise popover DOM references and global listeners.
     * Called once from App.init().
     */
    init() {
        const pop = $('filterPopover');
        if (!pop) return;

        FilterController.pop = pop;
        FilterController.input = $('fpInput');
        FilterController.title = $('fpTitle');

        const btnApply = $('fpApply');
        const btnClear = $('fpClear');
        const btnClose = $('fpClose');

        const hide = () => FilterController._hide();

        if (btnClose) btnClose.onclick = hide;
        if (btnClear) btnClear.onclick = () => {
            if (!FilterController.table || !FilterController.column) { hide(); return; }
            dispatch('filter:column', { table: FilterController.table, column: FilterController.column, value: '' });
            hide();
            dispatch('preview:renderRequested', {});
        };
        if (btnApply) btnApply.onclick = () => {
            if (!FilterController.table || !FilterController.column) { hide(); return; }
            const val = (FilterController.input.value || '').trim();
            dispatch('filter:column', { table: FilterController.table, column: FilterController.column, value: val });
            hide();
            dispatch('preview:renderRequested', {});
        };

        // Global listeners for dismiss
        document.addEventListener('click', (e) => {
            if (!FilterController.open) return;
            if (pop.contains(e.target)) return;
            const th = e.target.closest && e.target.closest('.filterable-th');
            if (th) return;
            hide();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && FilterController.open) hide();
        });

        const preview = $('previewArea');
        if (preview) preview.addEventListener('scroll', () => {
            if (FilterController.open) hide();
        });
    },

    /**
     * Show the filter popover for a specific column.
     * Called by TableBuilder when a filterable column header is clicked.
     */
    show(tableName, colName, anchorEl) {
        if (FilterController.open) FilterController._hide();

        const pop = FilterController.pop;
        const input = FilterController.input;
        const title = FilterController.title;
        if (!pop || !input || !title) return;

        const doc = Store.curr();
        const prev = ((doc.ui.columnFilters && doc.ui.columnFilters[tableName] && doc.ui.columnFilters[tableName][colName]) || '').toString();
        input.value = prev;
        title.textContent = `${tableName}.${colName}`;

        FilterController.open = true;
        FilterController.table = tableName;
        FilterController.column = colName;

        pop.classList.remove('hidden');

        // Position near the header
        const rect = anchorEl.getBoundingClientRect();
        const popRect = pop.getBoundingClientRect();
        const top = Math.max(10, rect.bottom + 6);
        let left = rect.left;
        const maxLeft = window.innerWidth - popRect.width - 10;
        if (left > maxLeft) left = maxLeft;
        if (left < 10) left = 10;
        pop.style.top = `${top}px`;
        pop.style.left = `${left}px`;

        input.focus();
        input.select();
    },

    /**
     * Clear a single column filter immediately (no popover).
     */
    clearColumn(tableName, colName) {
        dispatch('filter:column', { table: tableName, column: colName, value: '' });
        if (FilterController.open) FilterController._hide();
        dispatch('preview:renderRequested', {});
    },

    /**
     * Clear all column filters for a table.
     */
    clearTableFilters(tableName) {
        const doc = Store.curr();
        if (doc.ui.columnFilters) {
            delete doc.ui.columnFilters[tableName];
            Store.save();
            if (FilterController.open) FilterController._hide();
            dispatch('preview:renderRequested', {});
        }
    },

    _hide() {
        if (FilterController.pop) FilterController.pop.classList.add('hidden');
        FilterController.open = false;
        FilterController.table = null;
        FilterController.column = null;
    }
};

    return { FilterController };
});
