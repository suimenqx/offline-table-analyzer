OTA.define('cell-edit-controller', ["runtime", "dispatch", "table-registry"], ({$, Toast}, {dispatch}, {TableRegistry}) => {
/* CellEditController — inline cell editing with undo/redo.

   Responsibilities:
   - Double-click → inline textarea
   - Commit/cancel with Enter/Tab/Escape/blur
   - Non-destructive overlay in ui.cellEdits
   - 100-step undo/redo stacks
   - Only a cell belonging to one identified source can be edited
*/

const MAX_HISTORY = 100;

const CellEditController = {
    activeEditor: null,
    editHistory: [],
    editRedo: [],

    /** Kept for callers that used to supply tables after parsing. TableRegistry now owns them. */
    setRawTables() {},

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

        const source = TableRegistry.cellSource(tableName,sourceRow,sourceCol);
        if (!source) {
            Toast.show('此单元格为只读，请编辑单一来源的原始表', true);
            return;
        }

        const orig = td.textContent;
        const origHeight = td.getBoundingClientRect().height;
        td.style.height = `${origHeight}px`;
        td.style.minHeight = `${origHeight}px`;
        td.classList.add('editing');

        const input = document.createElement('textarea');
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
            td.classList.toggle('multiline-cell', String(orig).includes('\n'));
            td.style.height = '';
            td.style.minHeight = '';
            td.classList.remove('editing');
            CellEditController.activeEditor = null;
        };

        const commit = () => {
            if (done) return;
            done = true;
            const changed = CellEditController.apply(tableName, sourceRow, sourceCol, input.value, source);
            if(!changed && input.value !== orig) Toast.show('预览或数据源已变化，请重新编辑此单元格',true);
            const val = changed ? input.value : orig;
            if (input.parentNode === td) td.removeChild(input);
            td.textContent = val;
            td.classList.toggle('multiline-cell', String(val).includes('\n'));
            if (String(val).length > 18) td.dataset.full = val;
            else td.removeAttribute('data-full');
            td.style.height = '';
            td.style.minHeight = '';
            td.classList.remove('editing');
            CellEditController.activeEditor = null;
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
                const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
                input.value = input.value.slice(0, start) + '\n' + input.value.slice(end);
                const caret = start + 1;
                if (typeof input.setSelectionRange === 'function') input.setSelectionRange(caret, caret);
                else {
                    input.selectionStart = caret;
                    input.selectionEnd = caret;
                }
                return;
            }
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
     * Apply cell edit (persist overlay via dispatch + record history locally).
     */
    apply(tableName, rowIdx, colIdx, value, openedSource) {
        const source = TableRegistry.cellSource(tableName,rowIdx,colIdx);
        if (!source || (openedSource && Object.keys(openedSource).some(key=>openedSource[key] !== source[key]))) return false;

        const current=TableRegistry.getCell(tableName,rowIdx,colIdx);
        if(current===undefined)return false;
        const previous = String(current);
        const next = String(value ?? '');
        if (previous === next) return false;

        const edit = {source, tableName, rowIdx, colIdx, previous, next};
        if(!this._write(edit,next)) return false;
        CellEditController.editHistory.push(edit);
        if (CellEditController.editHistory.length > MAX_HISTORY) CellEditController.editHistory.shift();
        CellEditController.editRedo = [];

        CellEditController._updateButtons();
        return true;
    },

    undo() {
        const edit = CellEditController.editHistory.pop();
        if (!edit) return;
        if(this._write(edit,edit.previous)) CellEditController.editRedo.push(edit);
        CellEditController._updateButtons();
        dispatch('preview:renderRequested', {});
    },

    redo() {
        const edit = CellEditController.editRedo.pop();
        if (!edit) return;
        if(this._write(edit,edit.next)) CellEditController.editHistory.push(edit);
        CellEditController._updateButtons();
        dispatch('preview:renderRequested', {});
    },

    /** Apply edit without recording history. Uses dispatch for consistency. */
    _write({source,tableName,rowIdx,colIdx}, value) {
        if(!dispatch('cell:edit', {...source, row:rowIdx, col:colIdx, value})) return false;
        TableRegistry.updateCell(tableName,rowIdx,colIdx,value,source);
        return true;
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
