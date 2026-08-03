OTA.define('keyboard-controller', ["runtime", "store", "source-controller", "cell-edit-controller", "tab-controller", "join-editor", "modal-controller"], ({$, Toast}, {Store}, {SourceController}, {CellEditController}, {TabController}, {JoinEditor}, {ModalController}) => {
/* KeyboardController — global keyboard shortcut handler.

   Extracted from App.bind() to keep the orchestrator lean.
   App calls KeyboardController.init(app) once during bootstrap.
*/

const KeyboardController = {
    _app: null,

    /**
     * Register global keydown listener. Called once from App.init().
     * @param {Object} app — App instance (for run / createNewTab / showHelp / closeModal)
     */
    init(app) {
        this._app = app;
        if (typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('keydown', this._onKeydown.bind(this));
        }
    },

    _onKeydown(e) {
        const app = this._app;
        if (!app) return;

        // ── Fullscreen source editor: Escape closes ──
        const sourceModal = $('sourceEditorModal');
        if (sourceModal && !sourceModal.classList.contains('hidden')) {
            if (e.key === 'Escape') { e.preventDefault(); SourceController.close(); }
            return;
        }

        // ── Generic modal: Escape closes ──
        const modalOverlay = $('modalOverlay');
        if (modalOverlay && !modalOverlay.classList.contains('hidden')) {
            if (e.key === 'Escape') { e.preventDefault(); app.closeModal(); }
            return;
        }

        const mod = e.ctrlKey || e.metaKey;
        const tag = document.activeElement && document.activeElement.tagName || '';
        const typing = /INPUT|TEXTAREA|SELECT/.test(tag);

        // ── Workbench shortcuts ──
        if (mod && e.key.toLowerCase() === 'enter') { e.preventDefault(); app.run(); return; }
        if (mod && e.key.toLowerCase() === 'n')     { e.preventDefault(); app.createNewTab(e); return; }
        if (mod && e.key.toLowerCase() === 'o')     { e.preventDefault(); $('sourceFileInput').click(); return; }
        if (mod && e.key.toLowerCase() === 's')     {
            e.preventDefault();
            const inp = $('rawInput');
            if (inp) Store.curr().raw = inp.value;
            Store.save();
            Toast.show('工作区已保存');
            return;
        }
        if (mod && !typing && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); CellEditController.undo(); return; }
        if (mod && !typing && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); CellEditController.redo(); return; }
        if (e.key === 'F2' && !typing) { e.preventDefault(); TabController.startRename(Store.state.activeId); return; }
        if (e.key === '?' && !typing)  { e.preventDefault(); app.showHelp(); return; }

        // ── JOIN editor shortcuts (only when JOIN modal is open) ──
        const joinModal = $('joinModal');
        if (!joinModal || joinModal.classList.contains('hidden')) return;
        if (modalOverlay && !modalOverlay.classList.contains('hidden')) return;

        if (e.key === 'Escape') { e.preventDefault(); JoinEditor.close(); return; }
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            const idx = JoinEditor.state.selectedOrderIdx;
            if (idx >= 0) JoinEditor.moveOrder(idx, e.key === 'ArrowUp' ? -1 : 1);
            return;
        }
        if (e.key === '/' && !typing) { e.preventDefault(); $('jeLSearch').focus(); return; }
        if (e.key === 'Enter' && !e.shiftKey && !typing) { e.preventDefault(); JoinEditor.save(); return; }
    }
};

    return { KeyboardController };
});
