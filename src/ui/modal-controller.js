OTA.define('modal-controller', ["runtime", "store", "dispatch"], ({$, escapeHtml}, {Store}, {dispatch}) => {
/* ModalController — generic modal dialog management.

   Responsibilities:
   - Open/close the modal overlay
   - Focus trapping and restoration
   - Table/column/view selection modals
   - Diagnostics and help display
*/

const ModalController = {
    returnFocus: null,
    activeContainer: null,

    /**
     * Bind modal overlay click-to-close. Called once from App.init().
     */
    init() {
        const overlay = $('modalOverlay');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) ModalController.close();
            });
        }
        if(typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('keydown', (event) => {
                if(!ModalController.activeContainer || event.key !== 'Tab') return;
                const root = ModalController.activeContainer;
                let focusable = [];
                try {
                    focusable = Array.from(root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
                        .filter(el => !el.disabled && el.getAttribute('aria-hidden') !== 'true');
                } catch(e) { return; }
                if(!focusable.length) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if(event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if(!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            });
        }
    },

    activate(container, initialFocus=null) {
        if(!container) return;
        ModalController.returnFocus = document.activeElement;
        ModalController.activeContainer = container;
        const target = initialFocus || (() => {
            try { return container.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'); } catch(e) { return null; }
        })();
        if(target && typeof target.focus === 'function') setTimeout(() => target.focus(), 0);
    },

    deactivate(container=null) {
        if(container && ModalController.activeContainer && ModalController.activeContainer !== container) return;
        ModalController.activeContainer = null;
        const target = ModalController.returnFocus;
        ModalController.returnFocus = null;
        if(target && typeof target.focus === 'function') target.focus();
    },

    /**
     * Close the modal and restore focus.
     */
    close() {
        const overlay = $('modalOverlay');
        if (overlay) overlay.classList.add('hidden');
        ModalController.deactivate(overlay ? $('modalContent') : null);
        if (ModalController.returnFocus && typeof ModalController.returnFocus.focus === 'function') {
            ModalController.returnFocus.focus();
        }
        ModalController.returnFocus = null;
    },

    /**
     * Open a modal with the given title and HTML body.
     */
    show(title, html) {
        ModalController.returnFocus = document.activeElement;
        const content = $('modalContent');
        if (!content) return;
        content.innerHTML = `<div class="panel-header" style="border-radius:8px 8px 0 0;"><span id="modalTitle">${escapeHtml(title)}</span><button class="icon-btn" id="modalCloseBtn" type="button" aria-label="关闭">&times;</button></div><div class="modal-body">${html}</div>`;
        const overlay = $('modalOverlay');
        if (overlay) overlay.classList.remove('hidden');
        const closeBtn = $('modalCloseBtn');
        if (closeBtn) {
            closeBtn.onclick = () => ModalController.close();
            ModalController.activate(content, closeBtn);
        }
    },

    /**
     * Show the "select tables" modal.
     * @param {string[]} tableNames  All available raw table names
     * @param {string[]|null} selected  Currently selected, or null for "all"
     */
    showTableSelector(tableNames, selected) {
        const sel = (selected === null || selected === undefined) ? tableNames : selected;
        const h = tableNames.map(t => {
            const safe = escapeHtml(t);
            return `<label class="checkbox-row"><input type="checkbox" value="${safe}" ${sel.includes(t) ? 'checked' : ''}><span>${safe}</span></label>`;
        }).join('');
        ModalController.show('选择显示表', `<div>${h}</div><div style="margin-top:16px; text-align:right;"><button class="primary" id="saveMod">确定</button></div>`);
        ModalController._bindSaveBtn(() => {
            const v = Array.from(document.querySelectorAll('.checkbox-row input:checked')).map(c => c.value);
            const next = (v.length === tableNames.length && tableNames.length > 0) ? null : v;
            dispatch('ui:set', { key:'displayTables', value:next });
            ModalController.close();
            dispatch('preview:renderRequested', {});
        });
    },

    /**
     * Show the "enable views" modal.
     * @param {Array} views  Global views from Store.state.globalViews
     * @param {string[]} selected  Currently enabled view names
     */
    showViewSelector(views, selected) {
        if (!views.length) {
            if (typeof alert === 'function') alert('请先管理视图');
            return;
        }
        const h = views.map(v => {
            const name = escapeHtml(v.view || '(未命名视图)');
            const meta = (v.left && v.right)
                ? `<span style="font-size:11px; color:var(--text-tertiary); margin-left:6px;">${escapeHtml(v.left)} &hArr; ${escapeHtml(v.right)}</span>`
                : '';
            return `<label class="checkbox-row"><input type="checkbox" value="${name}" ${selected.includes(v.view) ? 'checked' : ''}><span style="font-weight:600; color:var(--text-main);">${name}</span>${meta}</label>`;
        }).join('');
        ModalController.show('启用视图', `<div>${h}</div><div style="margin-top:16px; text-align:right;"><button class="primary" id="saveMod">确定</button></div>`);
        ModalController._bindSaveBtn(() => {
            const sel = Array.from(document.querySelectorAll('.checkbox-row input:checked')).map(c => c.value);
            dispatch('ui:set', { key:'enabledViews', value:sel });
            ModalController.close();
            dispatch('preview:renderRequested', {});
        });
    },

    /**
     * Show the "select and order columns" modal for a table.
     * Each column row has a drag handle (⋮⋮), a checkbox, and the column name.
     * Drag handles reorder; checkboxes include/exclude; search filters the list.
     *
     * @param {string} tableName
     * @param {string[]} allHeaders  All available column headers
     * @param {Object} rules  Current UI rules for this table
     */
    showColumnSelector(tableName, allHeaders, rules) {
        if (!allHeaders || !allHeaders.length) {
            if (typeof alert === 'function') alert('无法获取列信息');
            return;
        }
        const rule = rules || {};
        const cur = (rule.focus && rule.focus.length > 0) ? rule.focus : allHeaders;
        const isFocusActive = (rule.focus && rule.focus.length > 0);

        // Display order: focus order if active, otherwise natural order.
        // Include any headers not in the focus list at the end (new columns).
        const displayOrder = [];
        const seen = new Set();
        (isFocusActive ? cur : allHeaders).forEach(col => {
            if (allHeaders.includes(col) && !seen.has(col)) {
                displayOrder.push(col);
                seen.add(col);
            }
        });
        // Append any headers not yet in the display order
        allHeaders.forEach(col => {
            if (!seen.has(col)) displayOrder.push(col);
        });

        const html = `
            <div style="margin-bottom:10px; display:flex; gap:8px; align-items:center;">
                <input id="colSearch" placeholder="搜索列名..." style="flex:1;">
                <button class="sm" id="colAll" type="button">全选</button>
                <button class="sm" id="colNone" type="button">全不选</button>
                <button class="sm" id="colReset" type="button" title="重置为解析时的原始顺序并全选">↺ 重置</button>
            </div>
            <div style="margin-bottom:6px; font-size:11px; color:var(--text-tertiary);">
                <span>⋮⋮ 拖拽排序</span>
                <span style="margin:0 8px;">·</span>
                <span>☑ 控制可见列</span>
                <span style="margin:0 8px;">·</span>
                <span id="colInfo"></span>
            </div>
            <div id="colList" style="max-height:400px; overflow-y:auto; border:1px solid var(--border-light); padding:4px; border-radius:6px; background:var(--bg-elevated);">
                ${displayOrder.map(c => {
                    const safe = escapeHtml(c);
                    const checked = !isFocusActive || cur.includes(c) ? 'checked' : '';
                    return `
                <div class="col-sort-row" data-col="${safe}">
                    <span class="col-sort-handle" draggable="true" title="拖拽排序">⋮⋮</span>
                    <label class="col-sort-label">
                        <input type="checkbox" value="${safe}" ${checked}>
                        <span>${safe}</span>
                    </label>
                </div>`;
                }).join('')}
            </div>
            <div style="margin-top:16px; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:11px; color:var(--text-tertiary);">提示：搜索时拖拽暂不可用，清除搜索后恢复</span>
                <button class="primary" id="saveMod" type="button">应用</button>
            </div>
        `;
        ModalController.show(`排序列: ${tableName}`, html);

        const list = document.getElementById('colList');
        const search = document.getElementById('colSearch');
        const info = document.getElementById('colInfo');

        const updateInfo = () => {
            const checked = list.querySelectorAll('.col-sort-row input:checked').length;
            if (info) info.textContent = `已选 ${checked} / ${allHeaders.length} 列`;
        };
        updateInfo();

        // ── Drag-and-drop: only the handle is draggable ──
        let dragSrc = null;

        const clearIndicators = () => {
            list.querySelectorAll('.col-sort-row').forEach(r => {
                r.classList.remove('col-sort-drop-before', 'col-sort-drop-after');
            });
        };

        const bindDragHandle = (handle) => {
            handle.addEventListener('dragstart', (e) => {
                // Ignore drag if search is filtering
                if (search && search.value.trim()) {
                    e.preventDefault();
                    return;
                }
                dragSrc = handle.parentElement;
                dragSrc.classList.add('col-sort-dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', dragSrc.dataset.col);
            });

            handle.addEventListener('dragend', () => {
                if (dragSrc) dragSrc.classList.remove('col-sort-dragging');
                dragSrc = null;
                clearIndicators();
            });
        };

        const bindDropRow = (row) => {
            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (!dragSrc || dragSrc === row) return;
                // Don't show indicator between items of different visibility
                if (row.style.display === 'none' || dragSrc.style.display === 'none') return;
                clearIndicators();
                const rect = row.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                row.classList.add(e.clientY < mid ? 'col-sort-drop-before' : 'col-sort-drop-after');
            });

            row.addEventListener('dragleave', () => {
                row.classList.remove('col-sort-drop-before', 'col-sort-drop-after');
            });

            row.addEventListener('drop', (e) => {
                e.preventDefault();
                row.classList.remove('col-sort-drop-before', 'col-sort-drop-after');
                if (!dragSrc || dragSrc === row) return;
                const rect = row.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                if (e.clientY < mid) {
                    list.insertBefore(dragSrc, row);
                } else {
                    list.insertBefore(dragSrc, row.nextSibling);
                }
                // Reset drag state
                if (dragSrc) dragSrc.classList.remove('col-sort-dragging');
                dragSrc = null;
            });
        };

        // Bind to existing items
        list.querySelectorAll('.col-sort-handle').forEach(bindDragHandle);
        list.querySelectorAll('.col-sort-row').forEach(bindDropRow);

        // Allow dropping at the end of the list (empty area)
        list.addEventListener('dragover', (e) => {
            if (!dragSrc) return;
            e.preventDefault();
            const visibleRows = [...list.querySelectorAll('.col-sort-row')].filter(r => r.style.display !== 'none' && r !== dragSrc);
            const lastRow = visibleRows[visibleRows.length - 1];
            if (lastRow) {
                const lastRect = lastRow.getBoundingClientRect();
                if (e.clientY > lastRect.bottom) {
                    clearIndicators();
                    lastRow.classList.add('col-sort-drop-after');
                }
            }
        });

        list.addEventListener('drop', (e) => {
            if (!dragSrc) return;
            e.preventDefault();
            const visibleRows = [...list.querySelectorAll('.col-sort-row')].filter(r => r.style.display !== 'none' && r !== dragSrc);
            const lastRow = visibleRows[visibleRows.length - 1];
            if (lastRow) {
                const lastRect = lastRow.getBoundingClientRect();
                if (e.clientY > lastRect.bottom) {
                    list.appendChild(dragSrc);
                }
            }
        });

        // Checkbox changes update the counter
        list.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox') updateInfo();
        });

        // ── Search filter ──
        let dragHandlesDisabled = false;
        if (search && list) {
            search.oninput = () => {
                const v = search.value.toLowerCase().trim();
                const isFiltering = v.length > 0;
                list.querySelectorAll('.col-sort-row').forEach(row => {
                    const match = !isFiltering || row.dataset.col.toLowerCase().includes(v);
                    row.style.display = match ? '' : 'none';
                    const handle = row.querySelector('.col-sort-handle');
                    if (handle) {
                        handle.draggable = !isFiltering;
                        handle.title = isFiltering ? '清除搜索后可拖拽排序' : '拖拽排序';
                        handle.style.opacity = isFiltering ? '0.4' : '';
                        handle.style.cursor = isFiltering ? 'default' : 'grab';
                    }
                });
                if (isFiltering && !dragHandlesDisabled) {
                    dragHandlesDisabled = true;
                } else if (!isFiltering) {
                    dragHandlesDisabled = false;
                }
            };
        }

        // ── Buttons ──
        const allBtn = document.getElementById('colAll');
        const noneBtn = document.getElementById('colNone');
        const resetBtn = document.getElementById('colReset');

        if (allBtn) allBtn.onclick = () => {
            list.querySelectorAll('.col-sort-row').forEach(row => {
                if (row.style.display !== 'none') {
                    row.querySelector('input').checked = true;
                }
            });
            updateInfo();
        };

        if (noneBtn) noneBtn.onclick = () => {
            list.querySelectorAll('.col-sort-row').forEach(row => {
                if (row.style.display !== 'none') {
                    row.querySelector('input').checked = false;
                }
            });
            updateInfo();
        };

        if (resetBtn) resetBtn.onclick = () => {
            // Reorder to match allHeaders, check all
            const rowMap = new Map();
            list.querySelectorAll('.col-sort-row').forEach(r => rowMap.set(r.dataset.col, r));
            const fragment = document.createDocumentFragment();
            allHeaders.forEach(col => {
                const row = rowMap.get(col);
                if (row) {
                    row.querySelector('input').checked = true;
                    fragment.appendChild(row);
                }
            });
            list.appendChild(fragment);
            updateInfo();
        };

        // ── Save ──
        ModalController._bindSaveBtn(() => {
            const checked = [];
            list.querySelectorAll('.col-sort-row').forEach(row => {
                const cb = row.querySelector('input');
                if (cb && cb.checked) checked.push(cb.value);
            });
            dispatch('rule:set', { table:tableName, field:'focus', value:checked });
            const focusInput = document.getElementById('focusColsInput');
            if (focusInput) focusInput.value = checked.join(', ');
            ModalController.close();
            dispatch('preview:renderRequested', {});
        });
    },

    _bindSaveBtn(handler) {
        setTimeout(() => {
            const btn = document.getElementById('saveMod');
            if (btn) btn.onclick = handler;
        }, 0);
    }
};

    return { ModalController };
});
