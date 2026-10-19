OTA.define('source-controller', ["runtime", "store", "dispatch", "source-snapshot", "exporter", "table-registry"], ({$, createEl, formatBytes, Toast}, {Store, MAX_IMPORT_BYTES}, {dispatch}, {SourceSnapshot}, {Exporter}, {TableRegistry}) => {
/* SourceController — source input, card interaction, file import and input
   resizer. Delegates all persisted state changes to dispatch().

   Responsibilities:
   - Main editor and compact keyed card list, focus/rename/participation/order
   - File drag/drop and file picker
   - Format detection from file extension (pure)
   - Input height persistence and resizer
   - Source change → dispatch('source:changed')

   Non-responsibilities (stay in App):
   - Parsing orchestration (App.run)
   - Cell edit invalidation on source change (App)
*/

const SourceController = {
    AUTO_PARSE_MAX_BYTES: 1024 * 1024,
    AUTO_PARSE_DELAY: 500,
    CLIPBOARD_PREVIEW_LIMIT: SourceSnapshot.PREVIEW_LIMIT,
    CLIPBOARD_KNOWN_TYPES: SourceSnapshot.KNOWN_CLIPBOARD_TYPES,
    EDITOR_LIMIT: 128 * 1024,

    readText(editor=$('rawInput')) {
        if (!editor) return Store.getDocument()?.raw || '';
        return editor.dataset && editor.dataset.sourcePreview === 'true'
            ? Store.getDocument()?.raw || '' : editor.value;
    },

    displayText(text='', editor=$('rawInput')) {
        if (!editor) return;
        const large = text.length > this.EDITOR_LIMIT;
        if(!editor.dataset)editor.dataset={};
        editor.dataset.sourcePreview = String(large);
        editor.readOnly = large;
        editor.value = large ? text.slice(0, 10000).split('\n').slice(0, 100).join('\n') : text;
        const notice = $('sourcePreviewNotice');
        if (notice) {
            notice.hidden = !large;
            notice.textContent = large ? `完整原文 ${formatBytes(text.length * 2)} 已保留，此处仅预览。需要修改时，请在本地编辑器中完成后再粘贴替换，或导出原文备份。` : '';
        }
    },

    handlePaste(event) {
        if (!event.clipboardData) return;
        const snapshot = this.captureClipboard(event.clipboardData);
        if(!snapshot || !snapshot.plain) return;
        const editor = event.target;
        if (snapshot.plain.length <= this.EDITOR_LIMIT && !(editor.dataset && editor.dataset.sourcePreview === 'true')) return;
        event.preventDefault();
        this.clearAutoParse();
        clearTimeout(this._persistTimer);
        dispatch('source:replace', { text:snapshot.plain, preservePaste:true });
        this.displayText(snapshot.plain);
        this.scheduleAutoParse({text:snapshot.plain});
    },
    resetPendingInput() {
        this.clearAutoParse();clearTimeout(this._persistTimer);clearTimeout(this._statsTimer);
        this._persistTimer=null;this._statsTimer=null;
    },
    // ── Timers (held here rather than on App) ──
    _persistTimer: null,
    _statsTimer: null,
    _autoParseTimer: null,

    // ── Pure helpers ──

    /**
     * Detect import format from file extension.
     * @param {string} fileName
     * @returns {string} format id or 'auto'
     */
    detectFormat(fileName) {
        const name = String(fileName || '').toLowerCase();
        if (/\.csv$/.test(name)) return 'csv';
        if (/\.tsv$/.test(name)) return 'excel-paste';
        if (/\.json$/.test(name)) return 'json';
        if (/\.html?$/.test(name)) return 'html-table';
        if (/\.(md|markdown)$/.test(name)) return 'pipe-table';
        return 'auto';
    },

    isAutoParseEnabled() {
        return !!Store.getDocument() && Store.getActiveUI().autoParse !== false;
    },

    getAutoParseState(text='') {
        if (!this.isAutoParseEnabled()) return 'manual';
        return String(text || '').length * 2 >= this.AUTO_PARSE_MAX_BYTES ? 'large' : 'pending';
    },

    notifyParseState(state) {
        if (typeof document === 'undefined' || !document.dispatchEvent || typeof CustomEvent !== 'function') return;
        document.dispatchEvent(new CustomEvent('ota:sourceParseState', { detail: { state } }));
    },

    clearAutoParse() {
        clearTimeout(this._autoParseTimer);
        this._autoParseTimer = null;
    },

    notifyPasteSourceChanged() {
        if (typeof document === 'undefined' || !document.dispatchEvent || typeof CustomEvent !== 'function') return;
        const snapshot = SourceSnapshot.getLastPaste();
        document.dispatchEvent(new CustomEvent('ota:pasteSourceChanged', {
            detail: {
                hasSource: Boolean(snapshot),
                docId: snapshot && snapshot.docId,
            },
        }));
    },

    readClipboardText(data, type) {
        if (!data || typeof data.getData !== 'function') return '';
        try { return String(data.getData(type) || ''); } catch (_) { return ''; }
    },

    setPasteSnapshot(snapshot) {
        SourceSnapshot.set(snapshot);
        this.notifyPasteSourceChanged();
        return SourceSnapshot.getLastPaste();
    },

    /**
     * Capture all useful clipboard metadata during the user paste event.
     * Only bounded previews of non-parser formats are retained; text/plain
     * and text/html remain available in full for the existing parse path.
     */
    captureClipboard(data, docId=Store.getDocument()?.id) {
        if (!docId || !data) return this.setPasteSnapshot(null);
        const declaredTypes = Array.from(data.types || []).map(type => String(type || '')).filter(Boolean);
        const candidateTypes = new Set([...declaredTypes, ...this.CLIPBOARD_KNOWN_TYPES]);
        const formats = [];
        const values=new Map();
        candidateTypes.forEach(type => {
            if (type.toLowerCase() === 'files') return;
            const value = this.readClipboardText(data, type);
            values.set(type,value);
            if (value || declaredTypes.includes(type)) formats.push({ type, value });
        });
        const files = Array.from(data.files || []).map(file => ({
            name: String(file && file.name || ''),
            type: String(file && file.type || ''),
            size: Number(file && file.size) || 0,
        }));
        const items = Array.from(data.items || []).map(item => ({
            kind: String(item && item.kind || ''),
            type: String(item && item.type || ''),
        })).filter(item => item.kind || item.type);
        const plain = values.get('text/plain') || '';
        const html = values.get('text/html') || '';
        if (!formats.length && !files.length && !items.length) return this.setPasteSnapshot(null);
        const snapshot = SourceSnapshot.captureClipboard({
            docId, plain, html, types: declaredTypes, formats, files, items,
        });
        this.notifyPasteSourceChanged();
        return snapshot;
    },

    /** Return the current source snapshot only when it still matches the editor. */
    getCurrentPaste(text='') {
        return SourceSnapshot.getCurrentPaste({ docId: Store.getDocument()?.id, text });
    },

    scheduleAutoParse({ text='', syncToMain=false } = {}) {
        this.clearAutoParse();
        const state = this.getAutoParseState(text);
        this.notifyParseState(state);
        if (state !== 'pending') return false;

        this._autoParseTimer = setTimeout(() => {
            this._autoParseTimer = null;
            if (typeof document !== 'undefined' && document.dispatchEvent) {
                document.dispatchEvent(new CustomEvent('ota:sourceAutoParse'));
            }
        }, this.AUTO_PARSE_DELAY);
        return true;
    },

    // ── Init ──

    /**
     * Bind source-editor DOM events.
     * Called once from App.init().
     */
    init() {
        this._bindMainEditor();
        this._bindDragDrop();
        this._bindInputResizer();
        this._bindFilePicker();
        const exportSource = $('exportSourceBtn');
        if (exportSource) exportSource.onclick = () => {
            const doc = Store.getDocument();
            const prefix = Exporter.sanitizeFilePrefix(`${Store.getExportTitle()}_source`);
            Exporter.download(`${prefix}_${Exporter.getTimestamp()}.txt`, doc?.raw || '', 'text/plain;charset=utf-8');
        };

    },

    // ── Main editor ──

    // ── 卡片列表（数据段区由 SourceController 拥有：选中/显隐/删除/重命名/新增） ──

    getCardStatus(id) {
        const card = Store.getCard(id);
        if(!card?.raw) return {state:'empty', text:'空卡片'};
        const summary = TableRegistry.getCardSummary(id);
        if(!summary) return {state:'pending', text:`待解析 · ${card.raw.length.toLocaleString()} 字符`};
        if(summary.format === 'ambiguous') return {state:'confirm', text:'待确认 · 选中后查看解析详情'};
        if(summary.format === 'error') return {state:'error', text:'解析失败 · 选中后查看详情'};
        if(!summary.tableCount) return {state:'confirm', text:'未识别出表格 · 请检查格式'};
        return {state:'ready', text:`${summary.label} · ${summary.rowCount.toLocaleString()} 行 · 已解析`};
    },

    /** 选中卡片（左侧面板显示其内容，解析作用于它） */
    activateCard(id, force=false) {
        if(!id) return false;
        const project = Store.state.projects.find(p => p.cardIds.includes(id));
        if(!project) return false;
        if(!force && project.activeCardId === id) return false;
        const input = $('rawInput');
        if(input) dispatch('source:replace', { text:SourceController.readText(input) });
        return dispatch('card:activate', { id });
    },

    /** 卡片显隐（范围控制）：表池成员随显隐变化 */
    toggleCardVisible(id, visible) {
        const card = Store.getCard(id);
        if(!card) return false;
        const enabled = visible === undefined ? card.visible === false : visible;
        const changed = dispatch('card:visible', { id, visible:enabled });
        if(changed) this.announceCardChange(`${card.title}${enabled ? '已参与分析' : '已退出表池，仍可编辑'}`);
        return changed;
    },

    announceCardChange(text) {
        const feedback = $('cardFeedback');
        if(feedback) feedback.textContent = text;
    },

    focusCard(id, control='root') {
        const nodes = this._cardNodes.get(id);
        if(!nodes) return false;
        this._focusedCardId = id;
        this._syncCardTabStops();
        (nodes[control] || nodes.root).focus({preventScroll:true});
        nodes.root.scrollIntoView?.({block:'nearest'});
        return true;
    },

    _syncCardTabStops() {
        const insideList = $('cardList')?.contains?.(document.activeElement);
        const activeId = insideList && this._cardNodes.has(this._focusedCardId) ? this._focusedCardId : Store.getDocument()?.id;
        for(const [id, nodes] of this._cardNodes) {
            const tabIndex = id === activeId ? 0 : -1;
            nodes.root.tabIndex = tabIndex;
            nodes.visible.tabIndex = tabIndex;
            nodes.remove.tabIndex = tabIndex;
            nodes.drag.tabIndex = tabIndex;
        }
    },

    /** Reordering changes pool concatenation order, never the active card. */
    moveCardBy(id, offset) {
        const ids = Store.getActiveProject()?.cardIds || [];
        const index = ids.indexOf(id), target = ids[index + offset];
        return target ? this.reorderCard(id, target, offset < 0 ? 'before' : 'after') : false;
    },

    reorderCard(sourceId, targetId, place) {
        const moved = dispatch('card:reorder', {sourceId, targetId, place});
        if(moved) {
            this.renderCards(); this.focusCard(sourceId);
            const index = Store.getActiveProject().cardIds.indexOf(sourceId) + 1;
            this.announceCardChange(`${Store.getCard(sourceId).title}已移至第 ${index} 位，拼接顺序已更新`);
        }
        return moved;
    },

    _clearCardDrag() {
        for(const {root} of this._cardNodes.values()) root.classList.remove('drag-before', 'drag-after', 'dragging');
        this._dragCardId = null;
    },

    /** 卡片删除（经确认） */
    removeCard(id) {
        const card = Store.getCard(id);
        if(!card) return false;
        if(typeof confirm === 'function' && !confirm(`删除卡片“${card.title}”？其数据与解析设置将移除。`)) return false;
        return dispatch('card:remove', { id }) === true;
    },

    /** 卡片重命名：双击/F2 在卡片内就地编辑（与页签栏一致），不用全局弹窗 */
    startCardRename(id) {
        const nodes = this._cardNodes.get(id);
        const titleEl = nodes?.title;
        const card = Store.getCard(id);
        if(!titleEl || !card) return;
        const existing = titleEl.querySelector('input');
        if(existing) { existing.focus(); return; }
        const input = document.createElement('input');
        input.className = 'data-card-title-input';
        input.value = card.title || '';
        input.maxLength = 40;
        input.setAttribute('aria-label', '卡片名称');
        titleEl.textContent = '';
        titleEl.appendChild(input);
        let done = false;
        const finish = (save, restoreFocus=false) => {
            if(done) return;
            done = true;
            if(save && String(input.value || '').trim()) dispatch('card:rename', { id, title: input.value });
            if(input.parentNode === titleEl) titleEl.removeChild(input);
            titleEl.textContent = Store.getCard(id)?.title || '';
            this.renderCards();
            if(restoreFocus) this.focusCard(id);
            if(save) this.announceCardChange(`卡片名称：${Store.getCard(id)?.title || ''}`);
        };
        input.onclick = e => e.stopPropagation();
        input.ondblclick = e => e.stopPropagation();
        input.onkeydown = e => {
            e.stopPropagation();
            if(e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); finish(e.key === 'Enter', true); }
        };
        input.onblur = () => finish(true);
        setTimeout(() => { if(!done) { input.focus(); input.select(); } }, 0);
    },

    _cardNodes: new Map(),
    _focusedCardId: null,

    /** DOM nodes are keyed by card id: status/visibility refreshes must not discard focus or an inline rename. */
    _createCard(id) {
        const root = createEl('div', 'data-card');
        root.dataset.cardId = id;
        root.setAttribute('role', 'listitem');
        root.setAttribute('aria-describedby', 'cardKeyboardHint');
        root.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown Home End Enter F2 Delete Alt+ArrowUp Alt+ArrowDown');
        const head = createEl('div', 'data-card-head');
        const drag = createEl('button', 'card-drag-handle');
        drag.type = 'button'; drag.draggable = true; drag.dataset.cardAct = 'drag';
        drag.title = '拖拽调整拼接顺序，也可按 Alt+↑/↓';
        drag.setAttribute('aria-label', '调整卡片拼接顺序');
        drag.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3h.01M10 3h.01M6 8h.01M10 8h.01M6 13h.01M10 13h.01"/></svg>';
        const title = createEl('span', 'data-card-title');
        const badge = createEl('span', 'card-editing-badge');
        badge.textContent = '编辑中';
        const remove = createEl('button', 'card-remove');
        remove.type = 'button'; remove.dataset.cardAct = 'remove';
        remove.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>';
        head.appendChild(drag); head.appendChild(title); head.appendChild(badge); head.appendChild(remove);
        const detail = createEl('div', 'data-card-detail');
        const participation = createEl('label', 'card-participation');
        const visible = document.createElement('input');
        visible.type = 'checkbox'; visible.dataset.cardAct = 'visible';
        const visibleLabel = createEl('span'); visibleLabel.textContent = '参与分析';
        participation.appendChild(visible); participation.appendChild(visibleLabel);
        const summary = createEl('span', 'data-card-summary');
        detail.appendChild(participation); detail.appendChild(summary);
        root.appendChild(head); root.appendChild(detail);
        root.onclick = event => {
            if(event.target.closest('[data-card-act], .card-participation, .data-card-title-input')) return;
            this.activateCard(id);
        };
        root.ondblclick = event => {
            if(event.target.closest('[data-card-act], .card-participation, .data-card-title-input')) return;
            event.preventDefault(); this.startCardRename(id);
        };
        root.onfocusin = () => { this._focusedCardId = id; this._syncCardTabStops(); };
        root.onkeydown = event => {
            if(event.target.closest('.data-card-title-input')) return;
            const control = event.target.closest('[data-card-act]');
            if(control && control.dataset.cardAct !== 'drag') return;
            if(event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
                event.preventDefault(); event.stopPropagation();
                this.moveCardBy(id, event.key === 'ArrowUp' ? -1 : 1);
                return;
            }
            const ids = Store.getActiveProject()?.cardIds || [];
            const index = ids.indexOf(id);
            if(['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) && !event.altKey) {
                event.preventDefault(); event.stopPropagation();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1
                    : Math.max(0, Math.min(ids.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
                this.focusCard(ids[next]);
            }
            if(['Enter', ' ', 'F2', 'Delete'].includes(event.key)) {
                event.preventDefault(); event.stopPropagation();
                if(event.key === 'F2') this.startCardRename(id);
                else if(event.key === 'Delete') this.removeCard(id);
                else this.activateCard(id);
            }
        };
        visible.onchange = () => this.toggleCardVisible(id, visible.checked);
        remove.onclick = event => { event.stopPropagation(); this.removeCard(id); };
        drag.onclick = event => event.stopPropagation();
        drag.ondragstart = event => {
            event.stopPropagation();
            this._dragCardId = id;
            root.classList.add('dragging');
            if(event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', id);
                event.dataTransfer.setDragImage?.(root, 10, 10);
            }
        };
        drag.ondragend = () => this._clearCardDrag();
        root.ondragover = event => {
            if(!this._dragCardId || this._dragCardId === id) return;
            event.preventDefault(); event.stopPropagation();
            const rect = root.getBoundingClientRect();
            const after = event.clientY > rect.top + rect.height / 2;
            root.classList.toggle('drag-before', !after); root.classList.toggle('drag-after', after);
            if(event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        };
        root.ondragleave = event => {
            if(!root.contains(event.relatedTarget)) root.classList.remove('drag-before', 'drag-after');
        };
        root.ondrop = event => {
            if(!this._dragCardId) return;
            event.preventDefault(); event.stopPropagation();
            const sourceId = this._dragCardId, rect = root.getBoundingClientRect();
            const place = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
            this._clearCardDrag(); this.reorderCard(sourceId, id, place);
        };
        return {root, title, badge, remove, visible, summary, drag};
    },

    syncEditorContext() {
        const card = Store.getDocument();
        const label = $('sourceEditorLabel'), hint = $('pasteBehaviorHint');
        if(label) label.textContent = card ? `当前编辑：${card.title}${card.visible === false ? '（未参与分析）' : ''}` : '尚未选择卡片';
        const editor = $('rawInput');
        if(editor) editor.setAttribute('aria-label', card ? `原文：${card.title}` : '原始表格数据');
        if(hint) hint.textContent = !card ? '请先新增卡片，再粘贴或导入数据。'
            : editor?.dataset.sourcePreview === 'true' ? '当前为只读预览；粘贴会替换这张卡片的完整原文。'
            : '普通粘贴在光标处插入或替换选区；全选后粘贴可替换整卡。大段粘贴会替换整卡。';
    },

    renderCards() {
        const container = $('cardList');
        if(!container) return;
        const project = Store.getActiveProject();
        const cards = (project?.cardIds || []).map(id => Store.getCard(id)).filter(Boolean);
        const focused = document.activeElement;
        const ids = new Set(cards.map(card => card.id));
        for(const [id, nodes] of this._cardNodes) if(!ids.has(id) || nodes.root.parentNode !== container) {
            if(nodes.root.parentNode === container) container.removeChild(nodes.root);
            this._cardNodes.delete(id);
        }
        cards.forEach((card, index) => {
            let nodes = this._cardNodes.get(card.id);
            if(!nodes) { nodes = this._createCard(card.id); this._cardNodes.set(card.id, nodes); }
            const active = card.id === project.activeCardId;
            nodes.root.className = `data-card${active ? ' active' : ''}${card.visible === false ? ' excluded-card' : ''}`;
            nodes.root.tabIndex = active ? 0 : -1;
            nodes.root.setAttribute('aria-current', String(active));
            nodes.root.setAttribute('aria-label', `${card.title}，${active ? '编辑中，' : ''}${card.visible === false ? '未参与分析' : '参与分析'}`);
            if(!nodes.title.querySelector('input')) nodes.title.textContent = card.title;
            nodes.title.title = `${card.title} · 双击或 F2 重命名`;
            nodes.badge.hidden = !active;
            nodes.visible.checked = card.visible !== false;
            nodes.visible.setAttribute('aria-label', `${card.title}：参与分析`);
            nodes.remove.title = `删除卡片 ${card.title}`;
            nodes.remove.setAttribute('aria-label', nodes.remove.title);
            const status = this.getCardStatus(card.id);
            nodes.summary.textContent = status.text;
            nodes.summary.dataset.state = status.state;
            nodes.summary.title = status.text;
            if(container.children[index] !== nodes.root) {
                if(container.insertBefore) container.insertBefore(nodes.root, container.children[index] || null);
                else { if(nodes.root.parentNode === container) container.removeChild(nodes.root); container.appendChild(nodes.root); }
            }
        });
        this._syncCardTabStops();
        if(this._renderedActiveCardId !== project?.activeCardId) {
            this._cardNodes.get(project?.activeCardId)?.root.scrollIntoView?.({block:'nearest'});
            this._renderedActiveCardId = project?.activeCardId;
        }
        if(focused?.isConnected && document.activeElement !== focused) focused.focus({preventScroll:true});
        const addBtn = $('addCardBtn');
        if(addBtn) {
            addBtn.disabled = !project;
            addBtn.onclick = event => { event.preventDefault(); dispatch('card:create', {}); };
        }
        const poolCount = $('poolCount');
        if(poolCount) poolCount.textContent = `表池 ${cards.filter(card => card.visible !== false).length}/${cards.length} 张卡片`;
        this.syncEditorContext();
    },

    _bindMainEditor() {
        const rawInput = $('rawInput');
        if (!rawInput) return;

        // Input changes → dispatch source:changed
        rawInput.oninput = () => {
            dispatch('source:changed', { text: rawInput.value, preservePaste:Boolean(SourceController.getCurrentPaste(rawInput.value)) });
        };

        // Paste with HTML detection
        rawInput.addEventListener('paste', (e) => {
            const data = e.clipboardData;
            if (!data) return;
            SourceController.handlePaste(e);
        });

        // Source transitions already schedule persistence; this listener only
        // drives the debounced auto-parse state.
        rawInput.addEventListener('input', () => {
            // Debounced auto-parse: fire when input stabilises, unless disabled
            // or the source is large enough to require an explicit parse.
            SourceController.scheduleAutoParse({ text: rawInput.value });
        });
    },

    /** Clear stored paste metadata. */
    clearLastPaste() {
        if (!SourceSnapshot.getLastPaste()) return;
        SourceSnapshot.clear();
        SourceController.notifyPasteSourceChanged();
    },

    // ── File import ──

    _bindFilePicker() {
        const btn = $('importSourceBtn');
        const input = $('sourceFileInput');
        if (btn && input) {
            btn.onclick = () => input.click();
            input.onchange = (e) => {
                const file = e.target.files && e.target.files[0];
                SourceController.loadFile(file);
                e.target.value = '';
            };
        }
    },

    _bindDragDrop() {
        const zone = $('sourceDropZone');
        if (!zone) return;
        ['dragenter', 'dragover'].forEach(type => {
            zone.addEventListener(type, (e) => {
                if(this._dragCardId) return;
                e.preventDefault();
                zone.classList.add('drag-over');
            });
        });
        ['dragleave', 'drop'].forEach(type => {
            zone.addEventListener(type, (e) => {
                e.preventDefault();
                zone.classList.remove('drag-over');
            });
        });
        zone.addEventListener('drop', (e) => {
            SourceController.loadFile(
                e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
            );
        });
    },

    /**
     * Read a local file and dispatch source:changed.
     * @param {File} file
     */
    loadFile(file) {
        if (!file) return;
        const targetDocId = Store.getDocument()?.id;
        if(!targetDocId) {
            Toast.show('请先新增卡片，再导入文件', true);
            return;
        }
        this.clearAutoParse();
        if (file.size > MAX_IMPORT_BYTES) {
            Toast.show('文件超过 128 MiB 安全限制', true);
            return;
        }

        // Update lastPaste for HTML files
        const detected = SourceController.detectFormat(file.name);

        const reader = new FileReader();
        reader.onerror = () => Toast.show('无法读取该文件', true);
        reader.onload = (event) => {
            const text = String(event.target.result || '');
            const targetDoc = Store.state.docs.find(doc => doc.id === targetDocId);
            if (!targetDoc) {
                Toast.show('导入目标页签已关闭，已取消导入', true);
                return;
            }

            if (Store.getDocument()?.id === targetDocId) {
                SourceSnapshot.captureFile({ docId: targetDocId, fileName: file.name, text, format: detected });
                SourceController.notifyPasteSourceChanged();
            }

            if (Store.getDocument()?.id === targetDocId) {
                // Update main editor only when the initiating tab is still active.
                const rawInput = $('rawInput');
                if (rawInput) SourceController.displayText(text, rawInput);
                const formatSelect = $('formatSelect');
                if (formatSelect && detected !== 'auto' && formatSelect.value === 'auto') formatSelect.value = detected;
                dispatch('source:replace', { docId:targetDocId, text, format:detected, preservePaste:detected === 'html-table' });
                Toast.show(`已导入 ${file.name}`);

                // Trigger parse only for the visible initiating tab.
                if (typeof document !== 'undefined' && document.dispatchEvent) {
                    document.dispatchEvent(new CustomEvent('ota:sourceFileLoaded', {
                        detail: { text, format: detected, fileName: file.name }
                    }));
                }
            } else {
                // Keep the import attached to its initiating tab without disturbing the visible tab.
                dispatch('source:replace', { docId:targetDocId, text, format:detected });
                Toast.show(`已导入 ${file.name} 到页签“${targetDoc.title || 'Analysis'}”`);
            }
        };
        reader.readAsText(file);
    },

    // ── Input resizer (drag handle) ──

    _bindInputResizer() {
        const resizer = $('inputResizer');
        const rawInput = $('rawInput');
        if (!resizer || !rawInput) return;

        // Restore saved height
        const savedHeight = typeof localStorage !== 'undefined'
            ? localStorage.getItem('v16_4_inputHeight')
            : null;
        if (savedHeight) {
            const h = parseInt(savedHeight, 10);
            if (h >= 120 && h <= 600) {
                rawInput.style.height = h + 'px';
            }
        }

        let isDragging = false;
        let startY = 0;
        let startHeight = 0;

        const onMouseDown = (e) => {
            isDragging = true;
            startY = e.clientY;
            startHeight = rawInput.offsetHeight;
            resizer.classList.add('dragging');
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;
            const delta = e.clientY - startY;
            let newHeight = startHeight + delta;
            if (newHeight < 120) newHeight = 120;
            if (newHeight > 600) newHeight = 600;
            rawInput.style.height = newHeight + 'px';
        };

        const onMouseUp = () => {
            if (!isDragging) return;
            isDragging = false;
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('v16_4_inputHeight', rawInput.style.height);
            }
        };

        resizer.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        // Touch support
        resizer.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            onMouseDown({ clientY: touch.clientY, preventDefault: () => e.preventDefault() });
        }, { passive: false });

        document.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            const touch = e.touches[0];
            onMouseMove({ clientY: touch.clientY });
        }, { passive: false });

        document.addEventListener('touchend', onMouseUp);
    }
};

    return { SourceController };
});
