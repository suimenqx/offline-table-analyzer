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
            notice.textContent = large ? `只读预览，完整原文 ${formatBytes(text.length * 2)} 已保留。粘贴会替换整卡；也可导出原文后在本地编辑。` : '';
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

    _parsingCards: new Map(),
    /** Session-only presentation, matched by context identity so late jobs cannot clear newer feedback. */
    setCardParsing(context, active) {
        const card = Store.getCard(context?.docId);
        if(active) {
            if(!card || card.sourceRevision !== context.sourceRevision) return false;
            this._parsingCards.set(card.id, context);
        } else {
            if(this._parsingCards.get(context?.docId) !== context) return false;
            this._parsingCards.delete(context.docId);
        }
        this.renderCards();
        return true;
    },

    getCardStatus(id) {
        const card = Store.getCard(id);
        const parsing = this._parsingCards.get(id);
        const config = parsing && (parsing.config || parsing.options || {});
        if(card && parsing && card.sourceRevision === parsing.sourceRevision
            && (card.ui.importFormat || 'auto') === (config.format || 'auto')
            && (card.ui.importHeaderMode || 'auto') === (config.headerMode || 'auto')) return {state:'parsing', label:'解析中', text:''};
        if(!card?.raw) return {state:'empty', label:'空', text:''};
        const summary = TableRegistry.getCardSummary(id);
        if(!summary) return {state:'pending', label:'待解析', text:''};
        if(summary.format === 'ambiguous') return {state:'confirm', label:'待确认', text:''};
        if(summary.format === 'error') return {state:'error', label:'解析失败', text:''};
        if(!summary.tableCount) return {state:'unrecognized', label:'未识别表格', text:''};
        return {state:'ready', label:'解析完成', text:`${summary.label} · ${summary.tableCount > 1 ? `${summary.tableCount} 表 · ` : ''}${summary.rowCount.toLocaleString()} 行`};
    },

    /** 选中卡片（左侧面板显示其内容，解析作用于它） */
    activateCard(id, force=false) {
        if(!id) return false;
        const project = Store.state.projects.find(p => p.cardIds.includes(id));
        if(!project) return false;
        this.setCardListExpanded(false);
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
        if(changed) this.announceCardChange(`${card.title}${enabled ? '已在分析结果中显示' : '已从分析结果中隐藏，仍可编辑'}`);
        return changed;
    },

    announceCardChange(text) {
        const feedback = $('cardFeedback');
        if(feedback) feedback.textContent = text;
    },

    _cardSearch:'',
    _cardListExpanded:false,
    _cardProjectId:null,
    setCardSearch(value='') {
        this._clearCardDrag(false);
        this._cardSearch = String(value);
        if($('cardReorderHint')) $('cardReorderHint').hidden = true;
        this.renderCards();
    },
    setCardListExpanded(expanded) {
        this._clearCardDrag(false);
        this._cardListExpanded = expanded === true;
        this.renderCards();
    },
    requestCardDiagnostics(id) {
        if(!['confirm','error','unrecognized'].includes(this.getCardStatus(id).state)) return false;
        this.activateCard(id);
        this.focusCard(id, 'statusAction');
        document.dispatchEvent(new CustomEvent('ota:cardDiagnosticsRequested', {detail:{id}}));
        return true;
    },
    undoCardRemoval() {
        const input = $('rawInput');
        if(Store.getDocument() && input) dispatch('source:replace', {text:this.readText(input)});
        try {
            const card = dispatch('card:undoRemove');
            if(!card) { this.renderCards(); return false; }
            this._cardSearch = '';
            this._cardListExpanded = false;
            this.renderCards();
            this.announceCardChange(`已恢复卡片 ${card.title}`);
            return true;
        } catch(error) {
            Toast.show(error.message || '撤销删除失败，其他数据仍保留', true);
            return false;
        }
    },

    focusCard(id, control='root') {
        const nodes = this._cardNodes.get(id);
        if(!nodes || nodes.root.hidden) return false;
        this._focusedCardId = id;
        this._syncCardTabStops();
        const target = nodes[control];
        (target && !target.hidden && !target.disabled ? target : nodes.root).focus({preventScroll:true});
        nodes.root.scrollIntoView?.({block:'nearest'});
        return true;
    },

    _syncCardTabStops() {
        const insideList = $('cardList')?.contains?.(document.activeElement);
        const available = id => this._cardNodes.has(id) && !this._cardNodes.get(id).root.hidden;
        const activeId = insideList && available(this._focusedCardId) ? this._focusedCardId
            : available(Store.getDocument()?.id) ? Store.getDocument().id
                : (Store.getActiveProject()?.cardIds || []).find(available);
        for(const [id, nodes] of this._cardNodes) {
            const tabIndex = id === activeId ? 0 : -1;
            nodes.root.tabIndex = tabIndex;
            nodes.visible.tabIndex = tabIndex;
            nodes.remove.tabIndex = tabIndex;
            nodes.drag.tabIndex = nodes.drag.disabled ? -1 : tabIndex;
            nodes.statusAction.tabIndex = nodes.statusAction.hidden ? -1 : tabIndex;
        }
    },

    /** Reordering changes pool concatenation order, never the active card. */
    moveCardBy(id, offset) {
        const ids = Store.getActiveProject()?.cardIds || [];
        const index = ids.indexOf(id), target = ids[index + offset];
        return target ? this.reorderCard(id, target, offset < 0 ? 'before' : 'after') : false;
    },

    reorderCard(sourceId, targetId, place) {
        if(this._cardSearch.trim()) { this.announceCardChange('清除搜索后可调整拼接顺序'); return false; }
        const before = this._cardRects();
        this._clearCardDrag(false);
        const moved = dispatch('card:reorder', {sourceId, targetId, place});
        if(moved) {
            this.renderCards(); this.focusCard(sourceId);
            const index = Store.getActiveProject().cardIds.indexOf(sourceId) + 1;
            this.announceCardChange(`${Store.getCard(sourceId).title}已移至第 ${index} 位，拼接顺序已更新`);
            const hint = $('cardReorderHint');
            if(hint) { hint.textContent = `已移至第 ${index} 位 · 顺序决定数据拼接顺序`; hint.hidden = false; }
        }
        this._animateCardPositions(before);
        return moved;
    },

    _cardMoves: new Map(),
    _cardRects() {
        const list = $('cardList');
        if(!list) return new Map();
        const origin = list.getBoundingClientRect().top - (list.scrollTop || 0);
        return new Map(Array.from(this._cardNodes, ([id, {root}]) => {
            const rect = root.getBoundingClientRect();
            return [id, {top:rect.top - origin, height:rect.height}];
        }));
    },
    _stopCardMotion() {
        for(const animation of this._cardMoves.values()) animation.cancel();
        this._cardMoves.clear();
    },
    _animateCardPositions(before) {
        this._stopCardMotion();
        if(document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        const after = this._cardRects();
        for(const [id, from] of before) {
            const root = this._cardNodes.get(id)?.root, to = after.get(id);
            if(!root?.animate || !to || Math.abs(from.top - to.top) < .5) continue;
            const offset = this._cardDrag?.offsets.get(id) || 0;
            const animation = root.animate([
                {transform:`translateY(${offset + from.top - to.top}px)`},
                {transform:`translateY(${offset}px)`}
            ], {duration:180, easing:'cubic-bezier(0.16, 1, 0.3, 1)'});
            this._cardMoves.set(id, animation);
            const clear = () => { if(this._cardMoves.get(id) === animation) this._cardMoves.delete(id); };
            animation.onfinish = clear; animation.oncancel = clear;
        }
    },
    _startCardDrag(id, event) {
        if(this._cardSearch.trim()) { event.preventDefault(); return; }
        this._clearCardDrag(false); this._stopCardMotion();
        const order = (Store.getActiveProject()?.cardIds || []).slice();
        if(!order.includes(id)) return;
        this._dragCardId = id;
        this._cardDrag = {order, rects:this._cardRects(), offsets:new Map(), preview:order.join('\u0001'), target:null};
        const root = this._cardNodes.get(id).root;
        if(event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', id);
            event.dataTransfer.setDragImage?.(root, 12, 12);
        }
        root.classList.add('dragging');
        $('cardList').classList.add('card-list-dragging');
        const hint = $('cardReorderHint');
        if(hint) { hint.textContent = `当前位置：第 ${order.indexOf(id)+1} 位 · 顺序决定数据拼接顺序`; hint.hidden = false; }
    },
    /** Visual-only insertion preview. Store order changes once, on an accepted drop. */
    _previewCardDrag(event) {
        const drag = this._cardDrag;
        if(!drag) return;
        event.preventDefault(); event.stopPropagation();
        if(event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        const list = $('cardList');
        const y = event.clientY - list.getBoundingClientRect().top + (list.scrollTop || 0);
        const others = drag.order.filter(id => id !== this._dragCardId);
        let index = others.findIndex(id => y < drag.rects.get(id).top + drag.rects.get(id).height / 2);
        if(index < 0) index = others.length;
        const preview = others.slice(); preview.splice(index, 0, this._dragCardId);
        const signature = preview.join('\u0001');
        if(signature === drag.preview) return;
        const before = this._cardRects();
        const gap = parseFloat(window.getComputedStyle(list).gap) || 0;
        let top = drag.rects.get(drag.order[0]).top;
        for(const id of preview) {
            const rect = drag.rects.get(id), offset = top - rect.top;
            drag.offsets.set(id, offset);
            this._cardNodes.get(id).root.style.transform = offset ? `translateY(${offset}px)` : '';
            top += rect.height + gap;
        }
        drag.preview = signature;
        drag.target = signature === drag.order.join('\u0001') ? null
            : {id:others[index] || others[others.length - 1], place:index < others.length ? 'before' : 'after'};
        this._animateCardPositions(before);
        this.announceCardChange(`放置到第 ${index + 1} 位以调整拼接顺序`);
        const hint = $('cardReorderHint');
        if(hint) { hint.textContent = `移至第 ${index+1} 位 · 顺序决定数据拼接顺序`; hint.hidden = false; }
    },
    _clearCardDrag(animate=true) {
        if(!this._cardDrag) return false;
        const before = animate ? this._cardRects() : null;
        this._stopCardMotion();
        for(const {root} of this._cardNodes.values()) {
            root.classList.remove('dragging'); root.style.transform = '';
        }
        $('cardList')?.classList.remove('card-list-dragging');
        this._cardDrag = null; this._dragCardId = null;
        if($('cardReorderHint')) $('cardReorderHint').hidden = true;
        if(before) this._animateCardPositions(before);
        return true;
    },

    /** 点击删除或按 Delete，直接通过命令路径删除卡片。 */
    removeCard(id) {
        if(!Store.getCard(id)) return false;
        const input = $('rawInput');
        if(Store.getDocument() && input) dispatch('source:replace', {text:this.readText(input)});
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
        const statusBadge = createEl('span', 'card-status-badge');
        const statusDot = createEl('span', 'card-status-dot');
        statusDot.setAttribute('aria-hidden', 'true');
        const statusLabel = createEl('span', 'card-status-label');
        const statusAction = createEl('button', 'card-status-action');
        statusAction.type = 'button'; statusAction.dataset.cardAct = 'diagnostics'; statusAction.hidden = true;
        statusAction.setAttribute('aria-haspopup', 'dialog');
        statusAction.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m4 2 4 4-4 4"/></svg>';
        statusAction.onclick = event => { event.stopPropagation(); this.requestCardDiagnostics(id); };
        statusBadge.appendChild(statusDot); statusBadge.appendChild(statusLabel); statusBadge.appendChild(statusAction);
        const remove = createEl('button', 'card-remove');
        remove.type = 'button'; remove.dataset.cardAct = 'remove';
        remove.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>';
        const visible = createEl('button', 'card-visibility');
        visible.type = 'button'; visible.dataset.cardAct = 'visible';
        visible.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="eye-outline" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle class="eye-pupil" cx="12" cy="12" r="3"/><path class="eye-slash" d="m3 3 18 18"/></svg>';
        head.appendChild(drag); head.appendChild(title); head.appendChild(visible); head.appendChild(remove);
        const detail = createEl('div', 'data-card-detail');
        const summary = createEl('span', 'data-card-summary');
        detail.appendChild(statusBadge); detail.appendChild(summary);
        root.appendChild(head); root.appendChild(detail);
        root.onclick = event => {
            if(event.target.closest('[data-card-act], .data-card-title-input')) return;
            this.activateCard(id);
        };
        root.ondblclick = event => {
            if(event.target.closest('[data-card-act], .data-card-title-input')) return;
            event.preventDefault(); this.startCardRename(id);
        };
        root.addEventListener('focusin', () => { this._focusedCardId = id; this._syncCardTabStops(); });
        root.onkeydown = event => {
            if(event.target.closest('.data-card-title-input')) return;
            const control = event.target.closest('[data-card-act]');
            if(control && control.dataset.cardAct !== 'drag') return;
            if(event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
                event.preventDefault(); event.stopPropagation();
                this.moveCardBy(id, event.key === 'ArrowUp' ? -1 : 1);
                return;
            }
            const ids = (Store.getActiveProject()?.cardIds || []).filter(cardId => !this._cardNodes.get(cardId)?.root.hidden);
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
        visible.onclick = event => { event.stopPropagation(); this.toggleCardVisible(id); };
        remove.onclick = event => { event.stopPropagation(); this.removeCard(id); };
        drag.onclick = event => event.stopPropagation();
        drag.ondragstart = event => { event.stopPropagation(); this._startCardDrag(id, event); };
        drag.ondragend = () => { if(this._clearCardDrag()) this.announceCardChange('排序已取消，拼接顺序未改变'); };
        return {root, title, remove, visible, summary, statusBadge, statusDot, statusLabel, statusAction, drag};
    },

    syncEditorContext() {
        const card = Store.getDocument();
        const label = $('sourceEditorLabel');
        if(label) { label.textContent = card ? `原文 · ${card.title}` : '原文'; label.title = label.textContent; label.dataset.hasCard = String(Boolean(card)); }
        const editor = $('rawInput');
        if(editor) editor.setAttribute('aria-label', card ? `原文：${card.title}` : '原始表格数据');
        const sample = $('sampleBtn');
        if(sample) sample.hidden = !card || Boolean(this.readText(editor));
    },

    renderCards() {
        const container = $('cardList');
        if(!container) return;
        const project = Store.getActiveProject();
        const cards = (project?.cardIds || []).map(id => Store.getCard(id)).filter(Boolean);
        if(this._cardProjectId !== project?.id) {
            this._cardProjectId = project?.id;
            this._cardSearch = ''; this._cardListExpanded = false;
            this._clearCardDrag(false);
            if($('cardReorderHint')) $('cardReorderHint').hidden = true;
        } else if(project?.activeCardId && !this._cardNodes.has(project.activeCardId)) {
            this._cardSearch = '';
        }
        if(this._renderedActiveCardId !== project?.activeCardId) {
            this._cardListExpanded = false;
            const active = cards.find(card => card.id === project?.activeCardId);
            if(active && !active.title.toLocaleLowerCase().includes(this._cardSearch.trim().toLocaleLowerCase())) this._cardSearch = '';
        }
        const query = this._cardSearch.trim().toLocaleLowerCase();
        const matching = cards.filter(card => !query || card.title.toLocaleLowerCase().includes(query));
        const matchingIds = new Set(matching.map(card => card.id));
        const focused = document.activeElement;
        let restoreFocus = focused;
        const focusedCard = [...this._cardNodes.values()].find(nodes => nodes.root === focused || nodes.root.contains?.(focused));
        const ids = new Set(cards.map(card => card.id));
        if(this._cardDrag && this._cardDrag.order.join('\u0001') !== cards.map(card => card.id).join('\u0001')) this._clearCardDrag(false);
        for(const id of this._parsingCards.keys()) if(!Store.getCard(id)) this._parsingCards.delete(id);
        for(const [id, nodes] of this._cardNodes) if(!ids.has(id) || nodes.root.parentNode !== container) {
            this._cardMoves.get(id)?.cancel(); this._cardMoves.delete(id);
            if(nodes.root.parentNode === container) container.removeChild(nodes.root);
            this._cardNodes.delete(id);
        }
        container.ondragover = event => this._previewCardDrag(event);
        container.ondrop = event => {
            if(!this._cardDrag) return;
            event.preventDefault(); event.stopPropagation();
            const target = this._cardDrag.target;
            if(target) this.reorderCard(this._dragCardId, target.id, target.place);
            else this._clearCardDrag();
        };
        cards.forEach((card, index) => {
            let nodes = this._cardNodes.get(card.id);
            if(!nodes) { nodes = this._createCard(card.id); this._cardNodes.set(card.id, nodes); }
            const active = card.id === project.activeCardId;
            const status = this.getCardStatus(card.id);
            nodes.root.className = `data-card${active ? ' active' : ''}${card.visible === false ? ' excluded-card' : ''}${card.id === this._dragCardId ? ' dragging' : ''}`;
            nodes.root.hidden = !matchingIds.has(card.id);
            nodes.root.tabIndex = active ? 0 : -1;
            nodes.root.setAttribute('aria-current', String(active));
            nodes.root.setAttribute('aria-label', `${card.title}，${active ? '编辑中，' : ''}${card.visible === false ? '已隐藏' : '已显示'}，${status.label}${status.text ? `，${status.text}` : ''}`);
            if(!nodes.title.querySelector('input')) nodes.title.textContent = card.title;
            nodes.title.title = `${card.title} · 双击或 F2 重命名`;
            nodes.visible.setAttribute('aria-pressed', String(card.visible !== false));
            nodes.visible.setAttribute('aria-label', `显示 ${card.title} 的分析结果`);
            nodes.visible.title = card.visible === false ? '在分析结果中显示' : '从分析结果中隐藏';
            nodes.remove.title = `删除卡片 ${card.title}`;
            nodes.remove.setAttribute('aria-label', nodes.remove.title);
            nodes.root.dataset.parseState = status.state;
            nodes.root.setAttribute('aria-busy', String(status.state === 'parsing'));
            nodes.statusBadge.dataset.state = status.state;
            nodes.statusDot.dataset.state = status.state;
            nodes.statusLabel.textContent = status.label;
            nodes.statusLabel.hidden = status.state === 'ready';
            const actionable = ['confirm','error','unrecognized'].includes(status.state);
            nodes.statusAction.hidden = !actionable;
            if(!actionable && focused === nodes.statusAction) restoreFocus = nodes.root;
            nodes.statusBadge.className = `card-status-badge${actionable ? ' is-actionable' : ''}`;
            nodes.statusAction.setAttribute('aria-label', `${status.state === 'confirm' ? '确认' : '查看'} ${card.title} 的解析${status.state === 'confirm' ? '方式' : '详情'}`);
            nodes.statusAction.title = status.state === 'confirm' ? '查看并确认解析候选' : '查看解析详情';
            nodes.drag.disabled = Boolean(query);
            nodes.drag.draggable = !query;
            nodes.drag.title = query ? '清除搜索后可调整拼接顺序' : '拖拽调整数据拼接顺序，也可按 Alt+↑/↓';
            nodes.summary.textContent = status.text;
            nodes.summary.hidden = !status.text;
            nodes.summary.dataset.state = status.state;
            nodes.summary.title = `${status.label} · ${status.text}`;
            if(container.children[index] !== nodes.root) {
                if(container.insertBefore) container.insertBefore(nodes.root, container.children[index] || null);
                else { if(nodes.root.parentNode === container) container.removeChild(nodes.root); container.appendChild(nodes.root); }
            }
        });
        this._syncCardTabStops();
        if(this._renderedActiveCardId !== project?.activeCardId) {
            const active = this._cardNodes.get(project?.activeCardId)?.root;
            if(active && !active.hidden) active.scrollIntoView?.({block:'nearest'});
            this._renderedActiveCardId = project?.activeCardId;
        }
        if(focusedCard?.root.isConnected === false) {
            const next = matching.find(card => card.id === project?.activeCardId) || matching[0];
            restoreFocus = this._cardNodes.get(next?.id)?.root || $('cardSearchInput');
        }
        if(restoreFocus?.isConnected && document.activeElement !== restoreFocus) restoreFocus.focus({preventScroll:true});
        const addBtn = $('addCardBtn');
        if(addBtn) {
            addBtn.disabled = !project;
            addBtn.onclick = event => { event.preventDefault(); this._cardSearch = ''; this._cardListExpanded = false; dispatch('card:create', {}); };
        }
        const cardCount = $('cardCount');
        if(cardCount) cardCount.textContent = String(cards.length);
        const search = $('cardSearchInput'), searchRow = $('cardSearchRow');
        if(searchRow) searchRow.hidden = cards.length < 8 && !this._cardSearch;
        if(search) {
            if(search.value !== this._cardSearch) search.value = this._cardSearch;
            search.oninput = () => this.setCardSearch(search.value);
            search.onkeydown = event => {
                if(event.key === 'Escape' && this._cardSearch) { event.preventDefault(); event.stopPropagation(); this.setCardSearch(''); search.focus(); }
                if(event.key === 'ArrowDown' && matching[0]) { event.preventDefault(); this.focusCard(matching[0].id); }
            };
        }
        const clearSearch = $('clearCardSearchBtn');
        if(clearSearch) {
            clearSearch.hidden = !this._cardSearch;
            clearSearch.onclick = () => { this.setCardSearch(''); (cards.length >= 8 ? search : $('addCardBtn'))?.focus(); };
        }
        const searchStatus = $('cardSearchStatus');
        if(searchStatus) { searchStatus.hidden = !query; searchStatus.textContent = query ? `找到 ${matching.length} / ${cards.length} 张卡片` : ''; }
        if($('cardSearchEmpty')) $('cardSearchEmpty').hidden = !query || matching.length > 0;
        const controls = $('cardListControls'), expand = $('expandCardListBtn');
        if(matching.length <= 3) this._cardListExpanded = false;
        if(controls) controls.hidden = matching.length <= 3;
        container.classList[this._cardListExpanded ? 'add' : 'remove']('is-expanded');
        if(expand) {
            expand.textContent = this._cardListExpanded ? '收起列表' : '展开列表';
            expand.setAttribute('aria-expanded', String(this._cardListExpanded));
            expand.onclick = () => {
                this.setCardListExpanded(!this._cardListExpanded);
                const active = this._cardNodes.get(Store.getDocument()?.id)?.root;
                if(active && !active.hidden) active.scrollIntoView?.({block:'nearest'});
            };
        }
        const removed = Store.getCardRemoval(), undoNotice = $('cardUndoNotice');
        if(undoNotice) undoNotice.hidden = !removed;
        const undoText = $('cardUndoText');
        if(undoText) undoText.textContent = removed ? `已删除“${removed.title}”` : '';
        const undo = $('undoCardRemovalBtn');
        if(undo) { undo.onclick = () => this.undoCardRemoval(); undo.setAttribute('aria-label', removed ? `撤销删除卡片 ${removed.title}` : '撤销删除卡片'); }
        if(!removed && focused === undo) {
            if(!this.focusCard(Store.getDocument()?.id)) $('addCardBtn')?.focus();
        }
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
