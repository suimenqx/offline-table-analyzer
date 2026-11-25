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
    anchor: null,
    docId: null,
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

        const commit = value => {
            if (this.open && this.docId === Store.getDocument()?.id && this.anchor?.isConnected) {
                dispatch('filter:column', { table:this.table, column:this.column, value });
            }
            this._hide(true);
        };
        if (btnClose) btnClose.onclick = () => this._hide(true);
        if (btnClear) btnClear.onclick = () => commit('');
        if (btnApply) btnApply.onclick = () => commit(this.input.value.trim());

        this.input.addEventListener('keydown', event => {
            if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 ||
                event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
            event.preventDefault();
            commit(this.input.value.trim());
        });

        // Global listeners for dismiss
        document.addEventListener('click', (e) => {
            if (!FilterController.open) return;
            if (pop.contains(e.target)) return;
            const th = e.target.closest && e.target.closest('.filterable-th');
            if (th) return;
            this._hide();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.open && !e.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                this._hide(pop.contains(document.activeElement));
            }
        });
        document.addEventListener('focusin', event => {
            if (this.open && !pop.contains(event.target)) this._hide();
        });

        const preview = $('previewArea');
        if (preview) preview.addEventListener('scroll', () => {
            if (this.open) this._hide(pop.contains(document.activeElement));
        }, true);
        window.addEventListener('resize', () => { if (this.open) this._position(); });
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

        const doc = Store.getDocument();
        if(!doc) return;
        const prev = ((doc.ui.columnFilters && doc.ui.columnFilters[tableName] && doc.ui.columnFilters[tableName][colName]) || '').toString();
        input.value = prev;
        title.textContent = `${tableName}.${colName}`;

        FilterController.open = true;
        FilterController.table = tableName;
        FilterController.column = colName;
        this.anchor = anchorEl;
        this.docId = doc.id;

        pop.classList.remove('hidden');
        this._position();
        input.focus({ preventScroll:true });
        input.select();
    },

    _position() {
        const rect = this.anchor.getBoundingClientRect();
        const box = this.pop.getBoundingClientRect();
        const bottomLimit = window.innerHeight - box.height - 10;
        const top = rect.bottom + 6 <= bottomLimit ? rect.bottom + 6 : rect.top - box.height - 6;
        this.pop.style.top = Math.max(10, Math.min(top, bottomLimit)) + 'px';
        this.pop.style.left = Math.max(10, Math.min(rect.left, window.innerWidth - box.width - 10)) + 'px';
    },

    // A preview refresh replaces the header nodes, including after a Worker query.
    syncPreview(preview, focusedHeader) {
        const oldHeader = this.open ? this.anchor : focusedHeader;
        if (!oldHeader) return;
        const tableName = oldHeader.closest('table')?.dataset.tableName;
        const table = Array.from(preview.querySelectorAll('table')).find(el => el.dataset.tableName === tableName);
        const header = table && Array.from(table.querySelectorAll('[data-filter-column]'))
            .find(el => el.dataset.filterColumn === oldHeader.dataset.filterColumn);
        if (this.open) {
            if (!header || this.docId !== Store.getDocument()?.id) { this._hide(); return; }
            this.anchor = header;
            this._position();
        } else {
            header?.focus({ preventScroll:true });
        }
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
        dispatch('filter:clearTable', { table: tableName });
        if (FilterController.open) FilterController._hide();
        dispatch('preview:renderRequested', {});
    },

    _hide(restoreFocus = false) {
        const anchor = this.anchor;
        if (FilterController.pop) FilterController.pop.classList.add('hidden');
        FilterController.open = false;
        FilterController.table = null;
        FilterController.column = null;
        this.anchor = null;
        this.docId = null;
        if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll:true });
    }
};

    return { FilterController };
});
