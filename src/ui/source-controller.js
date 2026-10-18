OTA.define('source-controller', ["runtime", "store", "dispatch", "modal-controller", "source-snapshot", "exporter"], ({$, createEl, escapeHtml, formatBytes, Toast}, {Store, MAX_IMPORT_BYTES}, {dispatch}, {ModalController}, {SourceSnapshot}, {Exporter}) => {
/* SourceController — manages source text input, file import, fullscreen editor,
   and input resizer. Delegates all state changes to dispatch().

   Responsibilities:
   - Main editor + fullscreen editor lifecycle
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
        return Store.curr().ui.autoParse !== false;
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
    captureClipboard(data, docId=Store.curr().id) {
        if (!data) return this.setPasteSnapshot(null);
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
        return SourceSnapshot.getCurrentPaste({ docId: Store.curr().id, text });
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
            const prefix = Exporter.sanitizeFilePrefix(`${doc?.title || 'Analysis'}_source`);
            Exporter.download(`${prefix}_${Exporter.getTimestamp()}.txt`, doc?.raw || '', 'text/plain;charset=utf-8');
        };

    },

    // ── Main editor ──

    // ── 卡片列表（数据段区由 SourceController 拥有：选中/显隐/删除/重命名/新增） ──

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
    toggleCardVisible(id) {
        const card = Store.getCard(id);
        if(!card) return false;
        return dispatch('card:visible', { id, visible: card.visible === false });
    },

    /** 卡片删除（经确认） */
    removeCard(id) {
        const card = Store.getCard(id);
        if(!card) return false;
        if(typeof confirm === 'function' && !confirm(`删除卡片“${card.title}”？其数据与解析设置将移除。`)) return false;
        const result = dispatch('card:remove', { id });
        if(result === 'last_card') Toast.show('工程至少保留一张卡片', true);
        return result === true;
    },

    /** 卡片重命名（F2 / 双击） */
    renameCard(id) {
        const card = Store.getCard(id);
        if(!card) return false;
        const name = typeof prompt === 'function' ? prompt('卡片名称', card.title || '') : null;
        if(name) dispatch('card:rename', { id, title:name });
        return Boolean(name);
    },

    /**
     * 渲染卡片列表：点击=选中、👁=显隐、双击/F2=重命名、Delete=删除、
     * 键盘可聚焦（tabindex=0 + Enter/Space 激活）。
     */
    renderCards() {
        const container = $('cardList');
        if(!container) return;
        const project = Store.getActiveProject();
        if(!project) { container.innerHTML = ''; return; }
        const cards = project.cardIds.map(id => Store.getCard(id)).filter(Boolean);
        container.innerHTML = cards.map((card, idx) => {
            const active = card.id === project.activeCardId;
            const visible = card.visible !== false;
            const stats = `${(card.raw || '').length.toLocaleString()} 字符`;
            const preview = card.raw ? card.raw.slice(0, 200) : '';
            const label = `${escapeHtml(card.title || `数据段 ${idx + 1}`)}${active ? '（选中）' : ''}${visible ? '' : '（已隐藏）'}`;
            return `<div class="data-card ${active ? 'active' : ''} ${visible ? '' : 'hidden-card'}" data-card-id="${escapeHtml(card.id)}" role="listitem" tabindex="0" aria-label="${label}">
                <div class="data-card-head">
                    <button type="button" class="card-visibility ${visible ? '' : 'off'}" data-card-act="visible" title="${visible ? '隐藏：数据退出表池' : '显示：数据进入表池'}" aria-pressed="${visible}">${visible ? '👁' : '🚫'}</button>
                    <span class="data-card-title ${visible ? '' : 'strike'}">${escapeHtml(card.title || `数据段 ${idx + 1}`)}</span>
                    <button type="button" class="sm text-button" data-card-act="remove" title="删除卡片" aria-label="删除卡片 ${escapeHtml(card.title || '')}">×</button>
                </div>
                <div class="muted" style="font-size:11px;">${stats}${visible ? '' : ' · 已隐藏'}</div>
                ${preview ? `<pre class="data-card-preview">${escapeHtml(preview)}</pre>` : ''}
            </div>`;
        }).join('');
        container.querySelectorAll('.data-card').forEach(el => {
            const id = el.dataset.cardId;
            el.onclick = (e) => {
                if(e.target.closest('[data-card-act]')) return;
                SourceController.activateCard(id);
            };
            el.onkeydown = (e) => {
                if(e.target.closest('[data-card-act]')) return;
                if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); SourceController.activateCard(id); }
                if(e.key === 'F2') { e.preventDefault(); e.stopPropagation(); SourceController.renameCard(id); }
                if(e.key === 'Delete') { e.preventDefault(); e.stopPropagation(); SourceController.removeCard(id); }
            };
            el.querySelector('[data-card-act="visible"]').onclick = (e) => {
                e.stopPropagation();
                SourceController.toggleCardVisible(id);
            };
            el.querySelector('[data-card-act="remove"]').onclick = (e) => {
                e.stopPropagation();
                SourceController.removeCard(id);
            };
            el.ondblclick = (e) => {
                if(e.target.closest('[data-card-act]')) return;
                e.preventDefault();
                SourceController.renameCard(id);
            };
        });
        const addBtn = $('addCardBtn');
        if(addBtn) addBtn.onclick = (e) => {
            e.preventDefault();
            dispatch('card:create', {});
        };
        const poolCount = $('poolCount');
        if(poolCount) {
            const visibleCount = cards.filter(card => card.visible !== false).length;
            poolCount.textContent = `表池 ${visibleCount} 张卡片`;
        }
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
        this.clearAutoParse();
        if (file.size > MAX_IMPORT_BYTES) {
            Toast.show('文件超过 128 MiB 安全限制', true);
            return;
        }

        // Update lastPaste for HTML files
        const detected = SourceController.detectFormat(file.name);
        const targetDocId = Store.curr().id;

        const reader = new FileReader();
        reader.onerror = () => Toast.show('无法读取该文件', true);
        reader.onload = (event) => {
            const text = String(event.target.result || '');
            const targetDoc = Store.state.docs.find(doc => doc.id === targetDocId);
            if (!targetDoc) {
                Toast.show('导入目标页签已关闭，已取消导入', true);
                return;
            }

            if (Store.curr().id === targetDocId) {
                SourceSnapshot.captureFile({ docId: targetDocId, fileName: file.name, text, format: detected });
                SourceController.notifyPasteSourceChanged();
            }

            if (Store.curr().id === targetDocId) {
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
