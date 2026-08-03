OTA.define('source-controller', ["runtime", "store", "dispatch"], ({$, createEl, escapeHtml, formatBytes, Toast}, {Store, MAX_IMPORT_BYTES}, {dispatch}) => {
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
    // ── Timers (held here rather than on App) ──
    _persistTimer: null,
    _statsTimer: null,
    _autoParseTimer: null,
    _returnFocus: null,

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
        if (/\.html?$/.test(name)) return 'html-table';
        if (/\.(md|markdown)$/.test(name)) return 'pipe-table';
        return 'auto';
    },

    // ── Init ──

    /**
     * Bind DOM events and subscribe to Store changes.
     * Called once from App.init().
     */
    init() {
        this._bindMainEditor();
        this._bindFullscreenEditor();
        this._bindDragDrop();
        this._bindInputResizer();
        this._bindFilePicker();

        // Subscribe to store events the source controller cares about
        Store.onChange((event, payload) => {
            if (event === 'tab:activated' || event === 'tab:created') {
                this._restoreSource();
            }
        });
    },

    // ── Main editor ──

    _bindMainEditor() {
        const rawInput = $('rawInput');
        if (!rawInput) return;

        // Input changes → dispatch source:changed
        rawInput.oninput = () => {
            dispatch('source:changed', { text: rawInput.value });
        };

        // Paste with HTML detection
        rawInput.addEventListener('paste', (e) => {
            const data = e.clipboardData;
            if (!data) return;
            const html = data.getData('text/html');
            const plain = data.getData('text/plain');
            if (html && /<table[\s>]/i.test(html)) {
                // Store paste metadata on the controller; App can read it via getLastPaste()
                SourceController._lastPaste = { html, plain, docId: Store.state.activeId };
            } else {
                SourceController._lastPaste = null;
            }
        });

        // Schedule persistence on input (debounced save to localStorage)
        rawInput.addEventListener('input', () => {
            clearTimeout(SourceController._persistTimer);
            SourceController._persistTimer = setTimeout(() => {
                Store.curr().raw = rawInput.value;
                Store.save();
            }, 650);

            // Debounced auto-parse: fire parse when input stabilises (≤1 MB)
            clearTimeout(SourceController._autoParseTimer);
            const text = rawInput.value;
            if (text.length * 2 < 1024 * 1024) {
                SourceController._autoParseTimer = setTimeout(() => {
                    if (typeof document !== 'undefined' && document.dispatchEvent) {
                        document.dispatchEvent(new CustomEvent('ota:sourceAutoParse'));
                    }
                }, 500);
            }
        });
    },

    /** Return the last HTML paste, if any. */
    getLastPaste() {
        return SourceController._lastPaste || null;
    },

    /** Clear stored paste metadata. */
    clearLastPaste() {
        SourceController._lastPaste = null;
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
        if (file.size > MAX_IMPORT_BYTES) {
            Toast.show('文件超过 25 MB 安全限制', true);
            return;
        }

        // Update lastPaste for HTML files
        const detected = SourceController.detectFormat(file.name);
        if (detected === 'html-table') {
            SourceController._lastPaste = null; // will be set after reading
        }

        const reader = new FileReader();
        reader.onerror = () => Toast.show('无法读取该文件', true);
        reader.onload = (event) => {
            const text = String(event.target.result || '').replace(/^\uFEFF/, '');

            if (detected === 'html-table') {
                SourceController._lastPaste = { html: text, plain: text, docId: Store.state.activeId };
            } else {
                SourceController._lastPaste = null;
            }

            // Update main editor
            const rawInput = $('rawInput');
            if (rawInput) rawInput.value = text;

            dispatch('source:changed', { text: text });

            // Auto-detect format from extension
            if (detected !== 'auto') {
                const formatSelect = $('formatSelect');
                if (formatSelect && formatSelect.value === 'auto') {
                    formatSelect.value = detected;
                    Store.curr().ui.importFormat = detected;
                }
            }

            Store.save();
            Toast.show(`已导入 ${file.name}`);

            // Trigger parse via custom event — App listens for this
            if (typeof document !== 'undefined' && document.dispatchEvent) {
                document.dispatchEvent(new CustomEvent('ota:sourceFileLoaded', {
                    detail: { text, format: detected, fileName: file.name }
                }));
            }
        };
        reader.readAsText(file);
    },

    // ── Fullscreen editor ──

    _bindFullscreenEditor() {
        const expandBtn = $('expandSourceBtn');
        const closeBtn = $('sourceEditorCloseBtn');
        const doneBtn = $('sourceEditorDoneBtn');
        const parseBtn = $('sourceEditorParseBtn');

        if (expandBtn) expandBtn.onclick = () => SourceController.open();
        if (closeBtn) closeBtn.onclick = () => SourceController.close();
        if (doneBtn) doneBtn.onclick = () => SourceController.close();

        const modal = $('sourceEditorModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                // Prevent closing when clicking inside the modal content
                if (e.target === modal) e.stopPropagation();
            });
        }

        // Wire parse button — emits a custom event that App listens to
        if (parseBtn) {
            parseBtn.onclick = () => {
                SourceController._syncToMain();
                if (typeof document !== 'undefined' && document.dispatchEvent) {
                    document.dispatchEvent(new CustomEvent('ota:sourceParseRequested', {}));
                }
            };
        }

        const rawLarge = $('rawInputLarge');
        if (rawLarge) {
            rawLarge.oninput = () => {
                SourceController._syncStats();
                SourceController._syncPersist();
            };
            rawLarge.addEventListener('paste', (e) => {
                const data = e.clipboardData;
                if (!data) return;
                const html = data.getData('text/html');
                const plain = data.getData('text/plain');
                if (html && /<table[\s>]/i.test(html)) {
                    SourceController._lastPaste = { html, plain, docId: Store.state.activeId };
                } else {
                    SourceController._lastPaste = null;
                }
            });
            rawLarge.onkeydown = (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    if (parseBtn) parseBtn.click();
                }
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                    e.preventDefault();
                    SourceController._syncToMain();
                    Toast.show('工作区已保存');
                }
            };
        }

        // Sync format/header controls between main and fullscreen editors
        const formatLarge = $('formatSelectLarge');
        if (formatLarge) {
            formatLarge.onchange = (e) => {
                const main = $('formatSelect');
                if (main) main.value = e.target.value;
                // Notify App to update import format
                if (typeof document !== 'undefined' && document.dispatchEvent) {
                    document.dispatchEvent(new CustomEvent('ota:formatChanged', { detail: { format: e.target.value } }));
                }
            };
        }

        const headerLarge = $('headerModeSelectLarge');
        if (headerLarge) {
            headerLarge.onchange = (e) => {
                const main = $('headerModeSelect');
                if (main) main.value = e.target.value;
                if (typeof document !== 'undefined' && document.dispatchEvent) {
                    document.dispatchEvent(new CustomEvent('ota:headerModeChanged', { detail: { mode: e.target.value } }));
                }
            };
        }
    },

    open() {
        const mainInput = $('rawInput');
        const largeInput = $('rawInputLarge');
        if (!largeInput) return;

        SourceController._returnFocus = document.activeElement;
        largeInput.value = mainInput ? mainInput.value : '';

        // Sync controls from main editor
        SourceController._syncControls();

        const modal = $('sourceEditorModal');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('active');
            modal.setAttribute('aria-hidden', 'false');
        }
        document.body.classList.add('source-editor-open');

        SourceController._refreshStats();
        setTimeout(() => largeInput.focus(), 100);
    },

    close() {
        const modal = $('sourceEditorModal');
        if (modal) {
            modal.classList.remove('active');
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden', 'true');
        }
        document.body.classList.remove('source-editor-open');

        SourceController._syncToMain();

        // Restore focus
        if (SourceController._returnFocus && typeof SourceController._returnFocus.focus === 'function') {
            SourceController._returnFocus.focus();
        }
        SourceController._returnFocus = null;
    },

    /** Copy fullscreen editor text back to main editor + Store. */
    _syncToMain() {
        const mainInput = $('rawInput');
        const largeInput = $('rawInputLarge');
        if (!mainInput || !largeInput) return;

        const text = largeInput.value;
        mainInput.value = text;
        dispatch('source:changed', { text: text });
    },

    /** Reflect format/header controls from main → fullscreen. */
    _syncControls() {
        const mainFormat = $('formatSelect');
        const largeFormat = $('formatSelectLarge');
        if (mainFormat && largeFormat) largeFormat.value = mainFormat.value;

        const mainHeader = $('headerModeSelect');
        const largeHeader = $('headerModeSelectLarge');
        if (mainHeader && largeHeader) largeHeader.value = mainHeader.value;
    },

    /** Update character/line count in the fullscreen editor. */
    _refreshStats() {
        const largeInput = $('rawInputLarge');
        const statEl = $('sourceEditorStats');
        if (!largeInput || !statEl) return;

        const text = largeInput.value;
        const chars = text.length;
        const lines = text ? text.split(/\n/).length : 0;
        statEl.textContent = `${chars.toLocaleString()} 字符 · ${lines} 行 · ${formatBytes(chars * 2)}`;
    },

    /** Debounced stats refresh on input. */
    _syncStats() {
        clearTimeout(SourceController._statsTimer);
        SourceController._statsTimer = setTimeout(() => SourceController._refreshStats(), 300);
    },

    /** Debounced persist from fullscreen editor. */
    _syncPersist() {
        clearTimeout(SourceController._persistTimer);
        SourceController._persistTimer = setTimeout(() => {
            const largeInput = $('rawInputLarge');
            if (largeInput) {
                Store.curr().raw = largeInput.value;
                Store.save();
            }
        }, 650);
    },

    // ── Tab switch → restore source ──

    _restoreSource() {
        const doc = Store.curr();
        const rawInput = $('rawInput');
        if (rawInput) rawInput.value = doc.raw || '';
        SourceController.clearLastPaste();
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
