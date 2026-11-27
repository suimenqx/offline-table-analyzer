OTA.define('view-manager', ["runtime", "store", "exporter", "modal-controller", "dispatch", "table-registry"], ({$, escapeHtml, formatBytes, Toast}, {Store}, {Exporter}, {ModalController}, {dispatch}, {TableRegistry}) => {
/* ViewManager — JOIN view CRUD and management modal.

   Extracted from join-editor.js. All interactions go through Store.getViews().
   The host (join-editor) provides an onEdit(idx) callback for opening the editor.
*/

const ViewManager = {
    /** @type {function(number):void} callback to open JOIN editor for a view index */
    _onEdit: null,

    /**
     * Register the edit callback. Called once by JoinEditor during init.
     * @param {function(number):void} fn — receives the view index to edit
     */
    setEditCallback(fn) {
        this._onEdit = fn;
    },

    /** Emit a join-changed notification so App re-renders */
    _notifyChange() {
        if (typeof document !== 'undefined' && document.dispatchEvent) {
            document.dispatchEvent(new CustomEvent('ota:joinChanged'));
            document.dispatchEvent(new CustomEvent('ota:joinParseRequested'));
        }
    },

    /** Generate a unique view name */
    makeUniqueName(base) {
        const used = new Set(Store.getViews().map(v => v.view));
        let name = (base || 'NewView').trim() || 'NewView';
        if (!used.has(name)) return name;
        let i = 2;
        while (used.has(`${name}_${i}`)) i++;
        return `${name}_${i}`;
    },

    /** Normalize a raw view object */
    normalizeView(v) {
        if (!v || !v.view || !v.left || !v.right) return null;
        return {
            view: v.view,
            left: v.left,
            right: v.right,
            type: v.type || 'inner',
            on: v.on || '',
            select: v.select || '',
            createdAt: v.createdAt || Date.now(),
            updatedAt: Date.now()
        };
    },

    /** Import views from a JSON text blob */
    importViewsFromText(txt) {
        const raw = (txt || '').trim();
        if (!raw) return Toast.show('请输入配置内容', true);
        let data;
        try { data = JSON.parse(raw); } catch (e) { return alert('JSON格式错误: ' + e.message); }
        let views = [];
        if (Array.isArray(data)) views = data;
        else if (data.kind === 'join-view' && data.view) views = [data.view];
        else if (data.globalViews) views = data.globalViews;
        else if (data.views) views = data.views;
        else if (data.view && data.left) views = [data];
        if (!views.length) return alert('未识别到视图配置');

        let imported = 0;
        views.forEach(v => {
            const nv = this.normalizeView(v);
            if (!nv) return;
            const idx = Store.getViews().findIndex(x => x.view === nv.view);
            if (idx > -1) {
                if (confirm(`视图 "${nv.view}" 已存在，是否覆盖？\n确定=覆盖 | 取消=自动改名`)) {
                    nv.createdAt = Store.getViews()[idx].createdAt || nv.createdAt;
                    dispatch('view:upsert', { index:idx, view:nv });
                } else {
                    nv.view = this.makeUniqueName(nv.view);
                    dispatch('view:upsert', { view:nv });
                }
            } else {
                dispatch('view:upsert', { view:nv });
            }
            imported++;
        });
        if (imported) {
            this._notifyChange();
            this.modManageViews();
            Toast.show(`已导入 ${imported} 个视图`);
        }
    },

    /** Format a timestamp for display */
    _formatTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) return '';
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },

    // ── Main management modal ──

    modManageViews() {
        const vs = Store.getViews();
        const joinTypeLabel = { inner: 'Inner', left: 'Left', right: 'Right', full: 'Full', semi: 'Semi', anti: 'Anti' };
        let sortBy = 'name';
        const self = this;

        const getFieldCount = (select) => (select || '').split(',').filter(Boolean).length;

        const renderList = (filterText = '') => {
            let filtered = vs.map((v, i) => ({ ...v, originalIndex: i }))
                .filter(v => {
                    if (!filterText) return true;
                    const s = filterText.toLowerCase();
                    return v.view.toLowerCase().includes(s) ||
                           v.left.toLowerCase().includes(s) ||
                           v.right.toLowerCase().includes(s) ||
                           (v.on || '').toLowerCase().includes(s);
                });

            if (sortBy === 'time') {
                filtered.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
            } else {
                filtered.sort((a, b) => a.view.localeCompare(b.view));
            }

            if (filtered.length === 0) {
                return filterText
                    ? '<div class="join-empty">没有找到匹配的视图</div>'
                    : '<div class="join-empty">当前工程还没有 JOIN 视图。新建视图后，可在这里编辑或复用配置。</div>';
            }

            return filtered.map((v) => {
                const i = v.originalIndex;
                const stamp = self._formatTime(v.updatedAt || v.createdAt);
                const fieldCount = getFieldCount(v.select);
                const joinLabel = Object.hasOwn(joinTypeLabel, v.type) ? joinTypeLabel[v.type] : 'Inner';
                return `
                <div class="view-item" data-index="${i}">
                    <input type="checkbox" class="view-checkbox" data-index="${i}" aria-label="选择 ${escapeHtml(v.view)}">
                    <div class="view-item-info">
                        <strong>${escapeHtml(v.view)}</strong><span class="view-item-type">${joinLabel.toUpperCase()}</span>
                        <small>${escapeHtml(v.left)} × ${escapeHtml(v.right)} · ${fieldCount} 列</small>
                        <small>${escapeHtml(v.on || '')}${stamp ? ' · ' + stamp : ''}</small>
                    </div>
                    <div class="view-actions" id="jeActions_${i}">
                        <button class="sm" id="jeEdit_${i}">编辑</button>
                        <button class="sm text-button" id="jeCopy_${i}">复制</button>
                        <button class="sm text-button" id="jeExport_${i}">导出</button>
                        <button class="sm text-button" id="jeDel_${i}">删除</button>
                    </div>
                    <div class="view-actions" id="jeConfirm_${i}" hidden>
                        <span class="view-delete-impact" id="jeDelImpact_${i}" role="status"></span>
                        <span>确认删除？</span>
                        <button class="sm" id="jeDelCancel_${i}">取消</button>
                        <button class="sm danger" id="jeDelOk_${i}">删除</button>
                    </div>
                </div>`;
            }).join('');
        };

        ModalController.show('管理 JOIN 视图', `
            <div class="view-library">
                <div class="view-toolbar">
                    <input type="search" id="jeViewSearch" aria-label="搜索视图" placeholder="搜索名称、来源表或匹配字段">
                    <select id="jeViewSort" aria-label="排列视图"><option value="name">按名称</option><option value="time">最近修改</option></select>
                    <button class="primary" id="jeAddNew">新建视图</button>
                </div>
                <div class="view-batch" ${vs.length ? '' : 'hidden'}>
                    <label class="join-toggle"><input type="checkbox" id="jeViewSelectAll">全选当前列表</label>
                    <button class="sm" id="jeBatchExport" disabled>导出所选</button>
                    <button class="sm danger" id="jeBatchDelete" disabled>删除所选</button>
                </div>
                <div class="view-actions" id="jeBatchConfirm" hidden>
                    <span class="view-delete-impact" id="jeBatchImpact" role="status"></span>
                    <button class="sm" id="jeBatchCancel">取消</button>
                    <button class="sm danger" id="jeBatchOk">确认删除所选</button>
                </div>
                <div id="viewList">${renderList()}</div>
                <details class="view-import">
                    <summary>从 JSON 导入视图</summary>
                    <textarea id="jePaste" aria-label="视图 JSON 配置" placeholder="粘贴视图配置"></textarea>
                    <button class="sm" id="jePasteBtn">导入配置</button>
                </details>
            </div>
        `);

        // Search
        const searchInput = $('jeViewSearch');
        if (searchInput) {
            searchInput.oninput = () => {
                const filterText = searchInput.value.trim();
                $('viewList').innerHTML = renderList(filterText);
                self._bindActions(vs);
                self._updateBatchButtons();
            };
        }

        // Sort
        const sortSelect = $('jeViewSort');
        if (sortSelect) {
            sortSelect.onchange = () => {
                sortBy = sortSelect.value;
                $('viewList').innerHTML = renderList(searchInput ? searchInput.value.trim() : '');
                self._bindActions(vs);
                self._updateBatchButtons();
            };
        }

        const selectAllCheckbox = $('jeViewSelectAll');
        if (selectAllCheckbox) {
            selectAllCheckbox.onchange = () => {
                document.querySelectorAll('.view-checkbox').forEach(cb => { cb.checked = selectAllCheckbox.checked; });
                self._updateBatchButtons();
            };
        }

        const batchDeleteBtn = $('jeBatchDelete');
        if (batchDeleteBtn) {
            batchDeleteBtn.onclick = () => {
                const selectedCbs = document.querySelectorAll('.view-checkbox:checked');
                if (selectedCbs.length === 0) return;
                const indices = Array.from(selectedCbs).map(cb => parseInt(cb.dataset.index)).sort((a, b) => b - a);
                const removal = self.prepareRemoval(indices);
                $('jeBatchConfirm').hidden = false;
                $('jeBatchImpact').textContent = `将删除所选的 ${indices.length} 个视图。${removal.message}`;
                $('jeBatchCancel').onclick = () => { $('jeBatchConfirm').hidden = true; batchDeleteBtn.focus(); };
                $('jeBatchOk').onclick = removal.confirm;
                $('jeBatchCancel').focus();
            };
        }

        const batchExportBtn = $('jeBatchExport');
        if (batchExportBtn) {
            batchExportBtn.onclick = () => {
                const selectedCbs = document.querySelectorAll('.view-checkbox:checked');
                if (selectedCbs.length === 0) return;
                const selectedViews = Array.from(selectedCbs).map(cb => Store.getViews()[parseInt(cb.dataset.index)]);
                Exporter.toJson({ kind: 'join-views', views: selectedViews }, `join_views_${Date.now()}`);
                Toast.show(`已导出 ${selectedViews.length} 个视图`);
            };
        }

        this._bindActions(vs);
        this._updateBatchButtons();

        const addNewBtn = $('jeAddNew');
        if (addNewBtn) addNewBtn.onclick = () => {
            ModalController.close();
            if (typeof self._onEdit === 'function') self._onEdit(-1);
        };

        const pasteBtn = $('jePasteBtn');
        if (pasteBtn) pasteBtn.onclick = () => self.importViewsFromText($('jePaste').value || '');
    },

    // ── Internal helpers ──

    prepareRemoval(indexes) {
        const projectId = Store.getActiveProject()?.id;
        const viewRevision = Store.viewRevision;
        const rawNames = TableRegistry.getAvailableRawTables().map(t => t.name);
        const names = indexes.map(i => Store.getViews()[i].view);
        const affected = Store.getDependentViews(names,rawNames);
        return {
            message:affected.length ? `受影响的下游视图：${affected.join('、')}。将保留这些配置并停用，可在编辑来源后重新启用。` : '',
            confirm:() => {
                if(Store.getActiveProject()?.id !== projectId || Store.viewRevision !== viewRevision) {
                    this.modManageViews();
                    return Toast.show('视图列表已更新，请重新选择要删除的视图', true);
                }
                dispatch('view:removeMany', {indexes,rawNames});
                this._notifyChange();
                this.modManageViews();
                Toast.show(`已删除 ${names.length} 个视图`);
            }
        };
    },
    _updateBatchButtons() {
        $('jeBatchConfirm').hidden = true;
        const selectedCount = document.querySelectorAll('.view-checkbox:checked').length;
        const total = document.querySelectorAll('.view-checkbox').length;
        const selectAll = $('jeViewSelectAll');
        selectAll.checked = total > 0 && total === selectedCount;
        selectAll.indeterminate = selectedCount > 0 && selectedCount < total;
        selectAll.disabled = total === 0;
        const batchDeleteBtn = $('jeBatchDelete');
        const batchExportBtn = $('jeBatchExport');
        if (batchDeleteBtn) batchDeleteBtn.disabled = selectedCount === 0;
        if (batchExportBtn) batchExportBtn.disabled = selectedCount === 0;
    },

    _bindActions(views) {
        const self = this;
        views.forEach((v, i) => {
            const editBtn = $(`jeEdit_${i}`);
            const copyBtn = $(`jeCopy_${i}`);
            const exportBtn = $(`jeExport_${i}`);
            const delBtn = $(`jeDel_${i}`);
            const delCancelBtn = $(`jeDelCancel_${i}`);
            const delOkBtn = $(`jeDelOk_${i}`);
            const checkbox = document.querySelector(`.view-checkbox[data-index="${i}"]`);

            if (editBtn) editBtn.onclick = () => {
                ModalController.close();
                if (typeof self._onEdit === 'function') self._onEdit(i);
            };
            if (copyBtn) copyBtn.onclick = () => {
                const name = self.makeUniqueName(`${v.view}_copy`);
                dispatch('view:upsert', { view:{ ...v, view: name, createdAt: Date.now(), updatedAt: Date.now() } });
                self._notifyChange();
                self.modManageViews();
                Toast.show('视图已复制');
            };
            if (exportBtn) exportBtn.onclick = () => Exporter.toJson({ kind: 'join-view', view: v }, `join_${v.view}`);
            if (delBtn) delBtn.onclick = () => {
                const removal = self.prepareRemoval([i]);
                $(`jeDelImpact_${i}`).textContent = removal.message;
                delOkBtn.onclick = removal.confirm;
                $(`jeActions_${i}`).hidden = true;
                $(`jeConfirm_${i}`).hidden = false;
                delCancelBtn.focus();
            };
            if (delCancelBtn) delCancelBtn.onclick = () => {
                $(`jeActions_${i}`).hidden = false;
                $(`jeConfirm_${i}`).hidden = true;
                delBtn.focus();
            };
            if (checkbox) checkbox.onchange = () => self._updateBatchButtons();
        });
    }
};

    return { ViewManager };
});
