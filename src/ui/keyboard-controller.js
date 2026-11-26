OTA.define('keyboard-controller', ["runtime", "store", "dispatch", "source-controller", "cell-edit-controller", "tab-controller", "join-editor", "modal-controller"], ({$, Toast}, {Store}, {dispatch}, {SourceController}, {CellEditController}, {TabController}, {JoinEditor}, {ModalController}) => {
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

        // ── Generic modal: Escape closes ──
        const modalOverlay = $('modalOverlay');
        if (modalOverlay && !modalOverlay.classList.contains('hidden')) {
            if (e.key === 'Escape') { e.preventDefault(); app.closeModal(); }
            return;
        }

        const editor = $('joinModal');
        if(editor && !editor.classList.contains('hidden')) {
            JoinEditor.handleKeydown(e);
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
            if (inp) dispatch('source:replace', { text:SourceController.readText(inp) });
            dispatch('workspace:save');
            Toast.show(Store.lastSaveError || (Store.saving?'正在保存完整原文…':'工作区已保存'),!!Store.lastSaveError);
            return;
        }
        if (mod && !typing && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); CellEditController.undo(); return; }
        if (mod && !typing && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); CellEditController.redo(); return; }
        if (e.key === 'F2' && !typing) { e.preventDefault(); TabController.startRename(Store.state.activeProjectId); return; }
        if (e.key === '?' && !typing)  { e.preventDefault(); app.showHelp(); return; }

    }
};

    return { KeyboardController };
});
