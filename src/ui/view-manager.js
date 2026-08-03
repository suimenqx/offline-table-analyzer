OTA.define('view-manager', ["runtime", "store", "exporter", "modal-controller"], ({$, escapeHtml, formatBytes, Toast}, {Store}, {Exporter}, {ModalController}) => {
/* ViewManager — JOIN view CRUD and management modal.

   Extracted from join-editor.js. All interactions go through Store.state.globalViews.
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
        const used = new Set(Store.state.globalViews.map(v => v.view));
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
            const idx = Store.state.globalViews.findIndex(x => x.view === nv.view);
            if (idx > -1) {
                if (confirm(`视图 "${nv.view}" 已存在，是否覆盖？\n确定=覆盖 | 取消=自动改名`)) {
                    nv.createdAt = Store.state.globalViews[idx].createdAt || nv.createdAt;
                    Store.state.globalViews[idx] = nv;
                } else {
                    nv.view = this.makeUniqueName(nv.view);
                    Store.state.globalViews.push(nv);
                }
            } else {
                Store.state.globalViews.push(nv);
            }
            imported++;
        });
        if (imported) {
            Store.save();
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
        const vs = Store.state.globalViews;
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
                    ? '<div style="padding:20px; color:#999; text-align:center;">无匹配视图</div>'
                    : '<div style="padding:20px; color:#999; text-align:center;">暂无视图</div>';
            }

            return filtered.map((v) => {
                const i = v.originalIndex;
                const stamp = self._formatTime(v.updatedAt || v.createdAt);
                const fieldCount = getFieldCount(v.select);
                const joinLabel = joinTypeLabel[v.type] || 'Inner';
                const meta = `${joinLabel} · ${v.left} ⟕ ${v.right} · ${fieldCount}列${stamp ? ' · ' + stamp : ''}`;

                return `
                <div class="view-item" data-index="${i}" style="display:flex; justify-content:space-between; align-items:center; padding:10px; border:1px solid var(--border-light); margin-bottom:8px; border-radius:6px; background:var(--bg-card);">
                    <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0;">
                        <input type="checkbox" class="view-checkbox" data-index="${i}" style="flex-shrink:0;">
                        <div style="min-width:0; flex:1;">
                            <div style="font-weight:600; color:var(--primary); margin-bottom:2px;">${escapeHtml(v.view)}</div>
                            <div style="font-size:11px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(meta)}">${escapeHtml(meta)}</div>
                        </div>
                    </div>
                    <div style="display:flex; gap:4px; flex-shrink:0; align-items:center;">
                        <span id="jeActions_${i}" style="display:flex; gap:4px;">
                            <button class="sm" id="jeEdit_${i}" title="编辑">✎</button>
                            <button class="sm" id="jeCopy_${i}" title="复制">❐</button>
                            <button class="sm" id="jeExport_${i}" title="导出">⬇</button>
                            <button class="sm danger" id="jeDel_${i}" title="删除">×</button>
                        </span>
                        <span id="jeConfirm_${i}" style="display:none; gap:4px; align-items:center; white-space:nowrap;">
                            <span style="font-size:11px; color:var(--danger);">确认删除?</span>
                            <button class="sm" id="jeDelCancel_${i}">取消</button>
                            <button class="sm danger" id="jeDelOk_${i}">删除</button>
                        </span>
                    </div>
                </div>`;
            }).join('');
        };

        ModalController.show('管理全局视图', `
            <div style="margin-bottom:10px; display:flex; gap:8px;">
                <input type="text" id="jeViewSearch" placeholder="🔍 搜索视图..." style="flex:1; padding:8px; border:1px solid var(--border); border-radius:6px; font-size:13px;">
                <select id="jeViewSort" style="width:100px; height:36px; font-size:12px;">
                    <option value="name">按名称</option>
                    <option value="time">按时间</option>
                </select>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <label class="flex items-center gap-2" style="font-size:12px; cursor:pointer;">
                    <input type="checkbox" id="jeViewSelectAll" style="cursor:pointer;">
                    <span>全选</span>
                </label>
                <div class="flex gap-2">
                    <button class="sm" id="jeBatchExport" disabled>⬇ 批量导出</button>
                    <button class="sm danger" id="jeBatchDelete" disabled>× 批量删除</button>
                </div>
            </div>
            <div id="viewList" style="max-height:340px; overflow-y:auto; margin-bottom:10px;">
                ${renderList()}
            </div>
            <div style="margin-bottom:10px;">
                <label>粘贴配置 (JSON)</label>
                <textarea id="jePaste" style="height:80px; font-size:12px;" placeholder='{"view":"MyView","left":"A","right":"B","on":"ID=ID","select":"left.ID,right.Name"}'></textarea>
                <div class="flex gap-2" style="margin-top:8px;">
                    <button class="sm" id="jePasteBtn">导入</button>
                    <button class="primary w-full" id="jeAddNew">＋ 新增视图</button>
                </div>
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
                if (!confirm(`确定删除选中的 ${indices.length} 个视图吗？此操作不可恢复。`)) return;
                indices.forEach(idx => Store.state.globalViews.splice(idx, 1));
                Store.save();
                self._notifyChange();
                self.modManageViews();
                Toast.show(`已删除 ${indices.length} 个视图`);
            };
        }

        const batchExportBtn = $('jeBatchExport');
        if (batchExportBtn) {
            batchExportBtn.onclick = () => {
                const selectedCbs = document.querySelectorAll('.view-checkbox:checked');
                if (selectedCbs.length === 0) return;
                const selectedViews = Array.from(selectedCbs).map(cb => Store.state.globalViews[parseInt(cb.dataset.index)]);
                Exporter.toJson({ kind: 'join-views', views: selectedViews }, `join_views_${Date.now()}`);
                Toast.show(`已导出 ${selectedViews.length} 个视图`);
            };
        }

        this._bindActions(vs);

        const addNewBtn = $('jeAddNew');
        if (addNewBtn) addNewBtn.onclick = () => {
            $('modalOverlay').classList.add('hidden');
            if (typeof self._onEdit === 'function') self._onEdit(-1);
        };

        const pasteBtn = $('jePasteBtn');
        if (pasteBtn) pasteBtn.onclick = () => self.importViewsFromText($('jePaste').value || '');
    },

    // ── Internal helpers ──

    _updateBatchButtons() {
        const selectedCount = document.querySelectorAll('.view-checkbox:checked').length;
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
                $('modalOverlay').classList.add('hidden');
                if (typeof self._onEdit === 'function') self._onEdit(i);
            };
            if (copyBtn) copyBtn.onclick = () => {
                const name = self.makeUniqueName(`${v.view}_copy`);
                Store.state.globalViews.push({ ...v, view: name, createdAt: Date.now(), updatedAt: Date.now() });
                Store.save();
                self._notifyChange();
                self.modManageViews();
                Toast.show('视图已复制');
            };
            if (exportBtn) exportBtn.onclick = () => Exporter.toJson({ kind: 'join-view', view: v }, `join_${v.view}`);
            if (delBtn) delBtn.onclick = () => {
                $(`jeActions_${i}`).style.display = 'none';
                $(`jeConfirm_${i}`).style.display = 'inline-flex';
            };
            if (delCancelBtn) delCancelBtn.onclick = () => {
                $(`jeActions_${i}`).style.display = 'inline-flex';
                $(`jeConfirm_${i}`).style.display = 'none';
            };
            if (delOkBtn) delOkBtn.onclick = () => {
                Store.state.globalViews.splice(i, 1);
                Store.save();
                self._notifyChange();
                self.modManageViews();
            };
            if (checkbox) checkbox.onchange = () => self._updateBatchButtons();
        });
    }
};

    return { ViewManager };
});
