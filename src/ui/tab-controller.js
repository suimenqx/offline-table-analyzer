OTA.define('tab-controller', ["runtime", "store", "dispatch"], ({$, escapeHtml, Toast}, {Store}, {dispatch}) => {
/* TabController — tab bar rendering, drag-and-drop, rename, keyboard navigation.

   Responsibilities:
   - Render tab bar DOM
   - Inline rename (F2 / double-click)
   - Drag-and-drop reorder
   - Keyboard navigation (arrows, Enter, Delete)
   - Create / activate / remove tabs via dispatch
*/

const TabController = {
    /** Drag state */
    dragSourceId: null,

    /**
     * Bind tab bar events. Called once from App.init().
     */
    init() {
        const container = $('tabsContainer');
        if (!container) return;

        // Click: activate or close
        container.onclick = (e) => {
            if (e.target.closest('.doc-tab-title-input')) return;
            if (e.target.classList.contains('doc-tab-close')) {
                e.stopPropagation();
                const t = e.target.closest('.doc-tab');
                const removed = t && Store.removeDoc(t.dataset.id);
                if (removed === true) {
                    dispatch('tab:removed', { id: t.dataset.id });
                    TabController.render();
                    // Trigger full doc reload via custom event
                    TabController._emit('tabsChanged');
                } else if (removed === 'last_doc') {
                    Toast.show('至少保留一个页签', true);
                }
                return;
            }
            const t = e.target.closest('.doc-tab');
            if (!t) return;
            dispatch('tab:activate', { id: t.dataset.id });
        };

        // Double-click: rename
        container.ondblclick = (e) => {
            const titleEl = e.target.closest('.doc-tab-title');
            if (!titleEl) return;
            const tab = titleEl.closest('.doc-tab');
            if (!tab) return;
            e.preventDefault();
            e.stopPropagation();
            const id = tab.dataset.id;
            if (Store.state.activeId !== id) dispatch('tab:activate', { id: id });
            setTimeout(() => TabController.startRename(id), 0);
        };

        // Keyboard navigation
        container.onkeydown = (e) => {
            const tab = e.target.closest('.doc-tab');
            if (!tab || e.target.closest('.doc-tab-title-input')) return;
            const tabs = Array.from(container.querySelectorAll('.doc-tab'));
            const index = tabs.indexOf(tab);
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                dispatch('tab:activate', { id: tab.dataset.id });
            }
            if (e.key === 'F2') {
                e.preventDefault();
                e.stopPropagation();
                TabController.startRename(tab.dataset.id);
            }
            if (e.key === 'Delete' && Store.state.docs.length > 1) {
                e.preventDefault();
                if (Store.removeDoc(tab.dataset.id)) {
                    dispatch('tab:removed', { id: tab.dataset.id });
                    TabController.render();
                    TabController._emit('tabsChanged');
                }
            }
            if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                const offset = e.key === 'ArrowRight' ? 1 : -1;
                const next = tabs[(index + offset + tabs.length) % tabs.length];
                if (next) dispatch('tab:activate', { id: next.dataset.id });
            }
        };

        // Drag events
        container.addEventListener('dragstart', (e) => {
            const tab = e.target.closest('.doc-tab');
            if (!tab || e.target.closest('.doc-tab-close') || e.target.closest('.doc-tab-title-input')) {
                e.preventDefault();
                return;
            }
            TabController.dragSourceId = tab.dataset.id;
            tab.classList.add('dragging');
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', tab.dataset.id);
            }
        });

        container.addEventListener('dragover', (e) => {
            const tab = e.target.closest('.doc-tab');
            if (!TabController.dragSourceId) return;
            if (!tab && e.target === container) {
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                return;
            }
            if (!tab || tab.dataset.id === TabController.dragSourceId) return;
            e.preventDefault();
            const rect = tab.getBoundingClientRect();
            const place = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
            TabController._markDrop(tab, place);
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        });

        container.addEventListener('dragleave', (e) => {
            const tab = e.target.closest('.doc-tab');
            if (tab && !tab.contains(e.relatedTarget)) TabController._clearMarkers(tab);
        });

        container.addEventListener('drop', (e) => {
            let tab = e.target.closest('.doc-tab');
            if (!TabController.dragSourceId) return;
            if (!tab && e.target === container) {
                const tabs = Array.from(container.querySelectorAll('.doc-tab')).filter(el => el.dataset.id !== TabController.dragSourceId);
                tab = tabs[tabs.length - 1];
                if (!tab) return;
            }
            if (!tab || tab.dataset.id === TabController.dragSourceId) return;
            e.preventDefault();
            const place = tab.classList.contains('drag-over-after') || e.target === container ? 'after' : 'before';
            const sourceId = TabController.dragSourceId;
            Store.moveDoc(sourceId, tab.dataset.id, place);
            TabController._clearAllMarkers();
            TabController.dragSourceId = null;
            TabController.render();
            dispatch('tab:reordered', { sourceId, targetId: tab.dataset.id, place });
        });

        container.addEventListener('dragend', () => {
            TabController._clearAllMarkers();
            TabController.dragSourceId = null;
        });
    },

    /**
     * Render the tab bar from Store.state.docs.
     */
    render() {
        const container = $('tabsContainer');
        if (!container) return;
        container.innerHTML = Store.state.docs.map((d, idx) => {
            Store.normalizeDoc(d, idx);
            const title = d.title || `Analysis ${idx + 1}`;
            const safeTitle = escapeHtml(title);
            const safeId = escapeHtml(d.id);
            const active = d.id === Store.state.activeId;
            return `<div class="doc-tab ${active ? 'active' : ''}" data-id="${safeId}" draggable="true" title="${safeTitle}" role="tab" aria-selected="${active ? 'true' : 'false'}" tabindex="${active ? '0' : '-1'}"><span class="doc-tab-title">${safeTitle}</span><button class="doc-tab-close" type="button" draggable="false" title="关闭" aria-label="关闭 ${safeTitle}">&times;</button></div>`;
        }).join('');
    },

    /**
     * Start inline rename of a tab.
     */
    startRename(id) {
        const tab = Array.from(document.querySelectorAll('.doc-tab')).find(el => el.dataset.id === id);
        if (!tab) return;
        const titleEl = tab.querySelector('.doc-tab-title');
        const doc = Store.state.docs.find(d => d.id === id);
        if (!titleEl || !doc) return;

        tab.setAttribute('draggable', 'false');
        const input = document.createElement('input');
        input.className = 'doc-tab-title-input';
        input.value = doc.title || '';
        input.maxLength = 40;
        titleEl.innerHTML = '';
        titleEl.appendChild(input);

        let done = false;
        const finish = (save) => {
            if (done) return;
            done = true;
            if (save) dispatch('tab:rename', { id: id, title: input.value });
            TabController.render();
        };
        input.onclick = e => e.stopPropagation();
        input.ondblclick = e => e.stopPropagation();
        input.onkeydown = e => {
            e.stopPropagation();
            if (e.key === 'Enter') finish(true);
            if (e.key === 'Escape') finish(false);
        };
        input.onblur = () => finish(true);
        setTimeout(() => { input.focus(); input.select(); }, 0);
    },

    /** Create a new tab via the "add tab" button. */
    createNew(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        const input = $('rawInput');
        if (input) Store.curr().raw = input.value;
        dispatch('tab:create');
        TabController.render();
        TabController._emit('tabsChanged');
    },

    // ── Internal helpers ──

    _markDrop(tab, place) {
        document.querySelectorAll('.doc-tab.drag-over-before, .doc-tab.drag-over-after').forEach(el => {
            if (el !== tab) TabController._clearMarkers(el);
        });
        tab.classList.toggle('drag-over-before', place === 'before');
        tab.classList.toggle('drag-over-after', place === 'after');
    },

    _clearMarkers(tab) {
        if (!tab) return;
        tab.classList.remove('dragging', 'drag-over-before', 'drag-over-after');
    },

    _clearAllMarkers() {
        document.querySelectorAll('.doc-tab').forEach(tab => TabController._clearMarkers(tab));
    },

    _emit(name) {
        if (typeof document !== 'undefined' && document.dispatchEvent) {
            document.dispatchEvent(new CustomEvent('ota:' + name, {}));
        }
    }
};

    return { TabController };
});
