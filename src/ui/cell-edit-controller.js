OTA.define('cell-edit-controller', ["runtime", "store", "dispatch"], ({$, Toast}, {Store}, {dispatch}) => {
/* CellEditController — inline cell editing with undo/redo.

   Responsibilities:
   - Double-click → inline input
   - Commit/cancel with Enter/Tab/Escape/blur
   - Non-destructive overlay in ui.cellEdits
   - 100-step undo/redo stacks
   - Disabled for JOIN views (read-only)

   App.setRawTablesForEditing(rawTables) must be called after each parse.
*/

const MAX_HISTORY = 100;

const CellEditController = {
    activeEditor: null,
    editHistory: [],
    editRedo: [],
    _rawTables: [],

    /** Called by App after each successful parse. */
    setRawTables(tables) {
        CellEditController._rawTables = tables || [];
    },

    /**
     * Bind events on preview area. Called once from App.init().
     */
    init() {
        const previewArea = $('previewArea');
        if (previewArea) {
            previewArea.addEventListener('dblclick', (e) => {
                const td = e.target.closest('td');
                if (!td || !td.closest('table') || td.classList.contains('row-header-cell')) return;
                e.stopPropagation();
                // Clear visual selection before editing
                document.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
                CellEditController.begin(td);
            });
        }
    },

    /**
     * Begin inline editing a cell.
     */
    begin(td) {
        if (CellEditController.activeEditor) CellEditController.finish(true);

        const tbl = td.closest('table');
        const tableName = tbl && tbl.dataset.tableName;
        const sourceRow = Number(td.dataset.sourceRow);
        const sourceCol = Number(td.dataset.sourceCol);

        if (!tableName || !Number.isInteger(sourceRow) || !Number.isInteger(sourceCol)) {
            Toast.show('JOIN 视图为只读，请编辑来源表', true);
            return;
        }

        const orig = td.textContent;
        const origHeight = td.getBoundingClientRect().height;
        td.style.height = `${origHeight}px`;
        td.style.minHeight = `${origHeight}px`;
        td.classList.add('editing');

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cell-editor';
        input.value = orig;
        td.innerHTML = '';
        td.appendChild(input);
        input.focus();
        input.select();

        let done = false;

        const cancel = () => {
            if (done) return;
            done = true;
            if (input.parentNode === td) td.removeChild(input);
            td.textContent = orig;
            td.style.height = '';
            td.style.minHeight = '';
            td.classList.remove('editing');
            CellEditController.activeEditor = null;
        };

        const commit = () => {
            if (done) return;
            done = true;
            const val = input.value;
            if (input.parentNode === td) td.removeChild(input);
            td.textContent = val;
            if (String(val).length > 18) td.dataset.full = val;
            else td.removeAttribute('data-full');
            CellEditController.apply(tableName, sourceRow, sourceCol, val);
            td.style.height = '';
            td.style.minHeight = '';
            td.classList.remove('editing');
            CellEditController.activeEditor = null;
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        input.addEventListener('blur', commit, { once: true });

        CellEditController.activeEditor = { td, input, orig, commit, cancel };
    },

    /** Force-finish active editor. */
    finish(commit) {
        if (!CellEditController.activeEditor) return;
        const { commit: doCommit, cancel } = CellEditController.activeEditor;
        if (commit) doCommit(); else cancel();
        CellEditController.activeEditor = null;
    },

    /**
     * Apply cell edit (persist overlay + record history).
     */
    apply(tableName, rowIdx, colIdx, value) {
        const table = CellEditController._rawTables.find(item => item.name === tableName && !item.isView);
        if (!table || !table.rows[rowIdx] || colIdx < 0 || colIdx >= table.headers.length) return false;

        const previous = String(table.rows[rowIdx][colIdx] ?? '');
        const next = String(value ?? '');
        if (previous === next) return false;

        const ui = Store.curr().ui;
        if (!ui.cellEdits) ui.cellEdits = {};
        const tableKey = `$${tableName}`;
        if (!ui.cellEdits[tableKey]) ui.cellEdits[tableKey] = {};
        if (!ui.cellEdits[tableKey][rowIdx]) ui.cellEdits[tableKey][rowIdx] = {};
        ui.cellEdits[tableKey][rowIdx][colIdx] = next;
        table.rows[rowIdx][colIdx] = next;

        CellEditController.editHistory.push({ tableName, rowIdx, colIdx, previous, next });
        if (CellEditController.editHistory.length > MAX_HISTORY) CellEditController.editHistory.shift();
        CellEditController.editRedo = [];

        Store.save();
        CellEditController._updateButtons();
        return true;
    },

    undo() {
        const edit = CellEditController.editHistory.pop();
        if (!edit) return;
        CellEditController._applySilent(edit.tableName, edit.rowIdx, edit.colIdx, edit.previous);
        CellEditController.editRedo.push(edit);
        CellEditController._updateButtons();
        dispatch('preview:renderRequested', {});
    },

    redo() {
        const edit = CellEditController.editRedo.pop();
        if (!edit) return;
        CellEditController._applySilent(edit.tableName, edit.rowIdx, edit.colIdx, edit.next);
        CellEditController.editHistory.push(edit);
        CellEditController._updateButtons();
        dispatch('preview:renderRequested', {});
    },

    /** Apply edit without recording history. */
    _applySilent(tableName, rowIdx, colIdx, value) {
        const table = CellEditController._rawTables.find(item => item.name === tableName && !item.isView);
        if (!table || !table.rows[rowIdx]) return;
        const ui = Store.curr().ui;
        const tableKey = `$${tableName}`;
        if (!ui.cellEdits) ui.cellEdits = {};
        if (!ui.cellEdits[tableKey]) ui.cellEdits[tableKey] = {};
        if (!ui.cellEdits[tableKey][rowIdx]) ui.cellEdits[tableKey][rowIdx] = {};
        ui.cellEdits[tableKey][rowIdx][colIdx] = value;
        table.rows[rowIdx][colIdx] = value;
        Store.save();
    },

    /** Clear all history when source changes. */
    reset() {
        CellEditController.editHistory = [];
        CellEditController.editRedo = [];
        if (CellEditController.activeEditor) CellEditController.finish(false);
        CellEditController._updateButtons();
    },

    _updateButtons() {
        const undoBtn = $('undoEditBtn');
        const redoBtn = $('redoEditBtn');
        if (undoBtn) undoBtn.disabled = CellEditController.editHistory.length === 0;
        if (redoBtn) redoBtn.disabled = CellEditController.editRedo.length === 0;
    }
};

    return { CellEditController };
});
