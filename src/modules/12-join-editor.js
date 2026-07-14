/* Join Editor */
const JoinEditor = {
    state: { editIdx: -1, left: null, right: null, rels: [], lSel: [], rSel: [], order: [], dirty: false, initial: null, lOnlySel: false, rOnlySel: false, showL: true, showR: true, prevLeft: null, prevRight: null, titleBase: '' },
    metaCache: {},
    dragIdx: null,

    formatTime(ts) {
        if(!ts) return '';
        const d = new Date(ts);
        if(Number.isNaN(d.getTime())) return '';
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
    escapeHtml(str='') {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },
    formatBytes(bytes=0) {
        if(bytes < 1024) return `${bytes} B`;
        if(bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    },
    updateStorageStatus(detail={}) {
        const el = $('storageStatus');
        if(!el) return;
        const ok = detail.ok !== false && !Store.lastSaveError;
        const bytes = Number(detail.bytes ?? Store.storageBytes) || 0;
        const message = detail.message || (ok
            ? (Store.state.persistRaw === false ? '临时数据模式 · 规则已保存' : `已保存 · ${this.formatBytes(bytes)}`)
            : Store.lastSaveError || '保存失败');
        el.textContent = message;
        el.style.color = ok ? '' : 'var(--danger)';
        const fill = $('storageMeterFill');
        if(fill) {
            const ratio = Math.min(100, bytes / (5 * 1024 * 1024) * 100);
            fill.style.width = `${ratio}%`;
            fill.style.background = ratio > 85 ? 'var(--danger)' : ratio > 65 ? 'var(--warning)' : 'var(--accent)';
        }
    },
    updateWorkspaceSummary() {
        const title = $('workspaceTitle');
        const summary = $('datasetSummary');
        if(title) title.textContent = Store.curr().title || 'Analysis';
        if(!summary) return;
        const tableCount = this.raw.length;
        const rows = this.raw.reduce((sum, table) => sum + (table.rows || []).length, 0);
        const maxCols = this.raw.reduce((max, table) => Math.max(max, (table.headers || []).length), 0);
        const format = Parser.lastResult && Parser.lastResult.label;
        summary.textContent = tableCount ? `${format || '已解析'} · ${tableCount} 表 · ${rows.toLocaleString()} 行 · 最多 ${maxCols} 列` : '所有处理均在本地浏览器完成';
    },
    scheduleSourceInputPersist() {
        clearTimeout(this.sourceInputPersistTimer);
        this.sourceInputPersistTimer = setTimeout(() => {
            Store.curr().raw = $('rawInput').value;
            Store.save();
        }, 650);
    },
    sourceFileFormat(file) {
        const name = String(file && file.name || '').toLowerCase();
        if(/\.csv$/.test(name)) return 'csv';
        if(/\.tsv$/.test(name)) return 'excel-paste';
        if(/\.html?$/.test(name)) return 'html-table';
        if(/\.(md|markdown)$/.test(name)) return 'pipe-table';
        return 'auto';
    },
    loadSourceFile(file) {
        if(!file) return;
        if(file.size > MAX_IMPORT_BYTES) return Toast.show('文件超过 25 MB 安全限制', true);
        const reader = new FileReader();
        reader.onerror = () => Toast.show('无法读取该文件', true);
        reader.onload = event => {
            const text = String(event.target.result || '').replace(/^\uFEFF/, '');
            $('rawInput').value = text;
            const detected = this.sourceFileFormat(file);
            if(detected === 'html-table') this.lastPaste = { html:text, plain:text, docId:Store.state.activeId };
            else this.lastPaste = null;
            Store.curr().raw = text;
            const select = $('formatSelect');
            if(select && select.value === 'auto' && detected !== 'auto') {
                select.value = detected;
                Store.curr().ui.importFormat = detected;
            }
            Store.save();
            this.run();
            Toast.show(`已导入 ${file.name}`);
        };
        reader.readAsText(file);
    },
    applyStoredCellEdits() {
        const edits = Store.curr().ui.cellEdits || {};
        this.raw.forEach(table => {
            const tableEdits = edits[`$${table.name}`];
            if(!tableEdits) return;
            Object.entries(tableEdits).forEach(([rowKey, cols]) => {
                const rowIdx = Number(rowKey);
                if(!Number.isInteger(rowIdx) || !table.rows[rowIdx] || !cols || typeof cols !== 'object') return;
                Object.entries(cols).forEach(([colKey, value]) => {
                    const colIdx = Number(colKey);
                    if(Number.isInteger(colIdx) && colIdx >= 0 && colIdx < table.headers.length) table.rows[rowIdx][colIdx] = String(value ?? '');
                });
            });
        });
    },
    setCellEdit(tableName, rowIdx, colIdx, value, record=true) {
        const table = this.raw.find(item => item.name === tableName && !item.isView);
        if(!table || !table.rows[rowIdx] || colIdx < 0 || colIdx >= table.headers.length) return false;
        const previous = String(table.rows[rowIdx][colIdx] ?? '');
        const next = String(value ?? '');
        if(previous === next) return false;
        const ui = Store.curr().ui;
        if(!ui.cellEdits) ui.cellEdits = {};
        const tableKey = `$${tableName}`;
        if(!ui.cellEdits[tableKey]) ui.cellEdits[tableKey] = {};
        if(!ui.cellEdits[tableKey][rowIdx]) ui.cellEdits[tableKey][rowIdx] = {};
        ui.cellEdits[tableKey][rowIdx][colIdx] = next;
        table.rows[rowIdx][colIdx] = next;
        if(record) {
            this.editHistory.push({ tableName, rowIdx, colIdx, previous, next });
            if(this.editHistory.length > 100) this.editHistory.shift();
            this.editRedo = [];
        }
        Store.save();
        this.updateUndoButtons();
        return true;
    },
    undoCellEdit() {
        const edit = this.editHistory.pop();
        if(!edit) return;
        this.setCellEdit(edit.tableName, edit.rowIdx, edit.colIdx, edit.previous, false);
        this.editRedo.push(edit);
        this.updateUndoButtons();
        this.renderPreview();
    },
    redoCellEdit() {
        const edit = this.editRedo.pop();
        if(!edit) return;
        this.setCellEdit(edit.tableName, edit.rowIdx, edit.colIdx, edit.next, false);
        this.editHistory.push(edit);
        this.updateUndoButtons();
        this.renderPreview();
    },
    updateUndoButtons() {
        if($('undoEditBtn')) $('undoEditBtn').disabled = this.editHistory.length === 0;
        if($('redoEditBtn')) $('redoEditBtn').disabled = this.editRedo.length === 0;
    },
    setTablePage(tableName, page) {
        const ui = Store.curr().ui;
        if(!ui.tablePages) ui.tablePages = {};
        ui.tablePages[tableName] = Math.max(1, Number(page) || 1);
        Store.save();
        this.renderPreview();
    },
    showDiagnostics() {
        const result = Parser.lastResult || {};
        const candidates = (result.candidates || []).map(item => `<div class="diagnostic-item" style="display:flex;align-items:center;gap:10px;"><div style="flex:1;"><strong>${this.escapeHtml(item.label)}</strong><span class="muted">${item.manual ? '用户指定' : `识别分数 ${Math.round(item.score * 100)}%`}</span></div>${item.id !== result.format ? `<button class="sm diagnostic-format-btn" type="button" data-format="${this.escapeHtml(item.id)}">切换</button>` : '<span class="meta-tag">当前</span>'}</div>`).join('');
        const diagnostics = (result.diagnostics || []).map(item => `<div class="diagnostic-item"><strong>${this.escapeHtml(item.code || item.level || '提示')}</strong><span>${this.escapeHtml(item.message || '')}</span></div>`).join('');
        this.modal('解析详情', `<div class="diagnostic-list">${candidates || '<div class="muted">没有格式候选信息</div>'}${diagnostics || '<div class="muted">未发现需要处理的数据问题</div>'}</div>`);
        document.querySelectorAll('.diagnostic-format-btn').forEach(button => {
            button.onclick = () => { this.closeModal(); this.setImportFormat(button.dataset.format); };
        });
    },
    showHelp() {
        this.modal('帮助与快捷键', `<div class="shortcut-grid">
            <span>解析当前数据源</span><kbd>Ctrl/⌘ Enter</kbd>
            <span>新建分析页签</span><kbd>Ctrl/⌘ N</kbd>
            <span>选择本地数据文件</span><kbd>Ctrl/⌘ O</kbd>
            <span>保存当前工作区</span><kbd>Ctrl/⌘ S</kbd>
            <span>撤销 / 重做单元格编辑</span><span><kbd>Ctrl/⌘ Z</kbd> <kbd>Ctrl/⌘ Y</kbd></span>
            <span>重命名当前页签</span><kbd>F2</kbd>
            <span>全选当前预览表</span><kbd>Ctrl/⌘ A</kbd>
        </div><p class="muted" style="margin:16px 0 0;">支持 CSV、TSV、HTML、Markdown、ASCII、固定宽度文本与 CLI table-data。数据不会发送到网络。</p>`);
    },
    isNameConflict(name, excludeIdx=-1) {
        const rawNames = App.raw.map(t => t.name);
        const viewNames = Store.state.globalViews.filter((_,i)=>i!==excludeIdx).map(v => v.view);
        return rawNames.includes(name) || viewNames.includes(name);
    },
    makeUniqueName(base, excludeIdx=-1) {
        let name = base || 'View';
        let i = 1;
        while(this.isNameConflict(name, excludeIdx)) {
            name = `${base || 'View'}_${i++}`;
        }
        return name;
    },
    
    // Fixed: Ensure only Views are listed
    modManageViews() {
        const vs = Store.state.globalViews;
        const getFieldCount = (select) => (select || '').split(',').filter(Boolean).length;
        const joinTypeLabel = { inner:'Inner Join', left:'Left Join', right:'Right Join', full:'Full Join', semi:'Semi Join', anti:'Anti Join' };

        const renderList = (filterText = '') => {
            const filtered = vs.map((v, i) => ({ ...v, originalIndex: i }))
                .filter(v => {
                    if (!filterText) return true;
                    const searchLower = filterText.toLowerCase();
                    return v.view.toLowerCase().includes(searchLower) ||
                           v.left.toLowerCase().includes(searchLower) ||
                           v.right.toLowerCase().includes(searchLower) ||
                           (v.on || '').toLowerCase().includes(searchLower);
                });

            if (filtered.length === 0) {
                return filterText
                    ? '<div style="padding:20px; color:#999; text-align:center;">无匹配视图</div>'
                    : '<div style="padding:20px; color:#999; text-align:center;">暂无视图</div>';
            }

            return filtered.map((v, idx) => {
                const i = v.originalIndex;
                const stamp = this.formatTime(v.updatedAt || v.createdAt);
                const fieldCount = getFieldCount(v.select);
                const joinLabel = joinTypeLabel[v.type] || 'Inner Join';
                const meta = stamp
                    ? `${joinLabel} · ${v.left} | ${v.right} · ${fieldCount}列 · ${stamp}`
                    : `${joinLabel} · ${v.left} | ${v.right} · ${fieldCount}列`;

                return `
                <div class="view-item" data-index="${i}" style="display:flex; justify-content:space-between; align-items:center; padding:10px; border:1px solid var(--border-light); margin-bottom:8px; border-radius:6px; background:var(--bg-card);">
                    <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0;">
                        <input type="checkbox" class="view-checkbox" data-index="${i}" style="flex-shrink:0;">
                        <div style="min-width:0; flex:1;">
                            <div style="font-weight:600; color:var(--primary); margin-bottom:2px;">${this.escapeHtml(v.view)}</div>
                            <div style="font-size:11px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${this.escapeHtml(meta)}</div>
                        </div>
                    </div>
                    <div class="flex gap-2" id="jeActions_${i}" style="flex-shrink:0;">
                        <button class="sm" id="jeEdit_${i}" title="编辑视图">✎</button>
                        <button class="sm" id="jeCopy_${i}" title="复制视图">❐</button>
                        <button class="sm" id="jeExport_${i}" title="导出视图">⬇</button>
                        <button class="sm danger" id="jeDel_${i}" title="删除视图">×</button>
                    </div>
                    <div class="flex gap-2" id="jeConfirm_${i}" style="display:none; align-items:center;">
                        <span style="font-size:12px; color:var(--text-secondary);">确认删除？</span>
                        <button class="sm" id="jeDelCancel_${i}">取消</button>
                        <button class="sm danger" id="jeDelOk_${i}">删除</button>
                    </div>
                </div>`;
            }).join('');
        };

        App.modal('管理全局视图', `
            <div style="margin-bottom:12px;">
                <input type="text" id="jeViewSearch" placeholder="🔍 搜索视图名称、表名或关联条件..." style="width:100%; padding:8px; border:1px solid var(--border); border-radius:6px; font-size:13px;">
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
            <div id="viewList" style="max-height:300px; overflow-y:auto; margin-bottom:12px;">
                ${renderList()}
            </div>
            <div style="margin-bottom:12px;">
                <label>粘贴配置 (JSON)</label>
                <textarea id="jePaste" style="height:90px;" placeholder="{
  \"view\": \"MyView\", \"left\": \"A\", \"right\": \"B\", \"on\": \"ID=ID\", \"select\": \"left.ID,right.Name\"
}"></textarea>
                <div class="flex gap-2" style="margin-top:8px;">
                    <button class="sm" id="jePasteBtn">导入</button>
                    <button class="primary w-full" id="jeAddNew">＋ 新增视图</button>
                </div>
            </div>
        `);

        // 搜索过滤功能
        const searchInput = $('jeViewSearch');
        if (searchInput) {
            searchInput.oninput = () => {
                const filterText = searchInput.value.trim();
                $('viewList').innerHTML = renderList(filterText);
                this.bindViewActions(vs);
                updateBatchButtons();
            };
        }

        // 全选/取消全选
        const selectAllCheckbox = $('jeViewSelectAll');
        if (selectAllCheckbox) {
            selectAllCheckbox.onchange = () => {
                const checkboxes = document.querySelectorAll('.view-checkbox');
                checkboxes.forEach(cb => {
                    cb.checked = selectAllCheckbox.checked;
                });
                updateBatchButtons();
            };
        }

        // 更新批量操作按钮状态
        const updateBatchButtons = () => {
            const selectedCount = document.querySelectorAll('.view-checkbox:checked').length;
            const batchDeleteBtn = $('jeBatchDelete');
            const batchExportBtn = $('jeBatchExport');
            if (batchDeleteBtn) batchDeleteBtn.disabled = selectedCount === 0;
            if (batchExportBtn) batchExportBtn.disabled = selectedCount === 0;
        };

        // 批量删除
        const batchDeleteBtn = $('jeBatchDelete');
        if (batchDeleteBtn) {
            batchDeleteBtn.onclick = () => {
                const selectedCheckboxes = document.querySelectorAll('.view-checkbox:checked');
                if (selectedCheckboxes.length === 0) return;
                const selectedIndices = Array.from(selectedCheckboxes).map(cb => parseInt(cb.dataset.index)).sort((a, b) => b - a);
                if (confirm(`确定删除选中的 ${selectedIndices.length} 个视图吗？`)) {
                    selectedIndices.forEach(idx => {
                        Store.state.globalViews.splice(idx, 1);
                    });
                    Store.save();
                    App.updSelects();
                    this.modManageViews();
                    App.run();
                    Toast.show(`已删除 ${selectedIndices.length} 个视图`);
                }
            };
        }

        // 批量导出
        const batchExportBtn = $('jeBatchExport');
        if (batchExportBtn) {
            batchExportBtn.onclick = () => {
                const selectedCheckboxes = document.querySelectorAll('.view-checkbox:checked');
                if (selectedCheckboxes.length === 0) return;
                const selectedViews = Array.from(selectedCheckboxes).map(cb => Store.state.globalViews[parseInt(cb.dataset.index)]);
                Exporter.toJson({ kind: 'join-views', views: selectedViews }, `join_views_${Date.now()}`);
                Toast.show(`已导出 ${selectedViews.length} 个视图`);
            };
        }

        // 绑定单个视图的操作按钮
        this.bindViewActions = (views) => {
            views.forEach((v, i) => {
                const editBtn = $(`jeEdit_${i}`);
                const copyBtn = $(`jeCopy_${i}`);
                const exportBtn = $(`jeExport_${i}`);
                const delBtn = $(`jeDel_${i}`);
                const delCancelBtn = $(`jeDelCancel_${i}`);
                const delOkBtn = $(`jeDelOk_${i}`);
                const checkbox = document.querySelector(`.view-checkbox[data-index="${i}"]`);

                if (editBtn) editBtn.onclick = () => { $('modalOverlay').classList.add('hidden'); this.open(i); };
                if (copyBtn) copyBtn.onclick = () => {
                    const name = this.makeUniqueName(`${v.view}_copy`);
                    const nv = { ...v, view: name, createdAt: Date.now(), updatedAt: Date.now() };
                    Store.state.globalViews.push(nv);
                    Store.save();
                    App.updSelects();
                    this.modManageViews();
                    Toast.show('已复制');
                };
                if (exportBtn) exportBtn.onclick = () => Exporter.toJson({ kind: 'join-view', view: v }, `join_${v.view}`);
                if (delBtn) delBtn.onclick = () => {
                    const actions = $(`jeActions_${i}`);
                    const confirmRow = $(`jeConfirm_${i}`);
                    if (actions) actions.style.display = 'none';
                    if (confirmRow) confirmRow.style.display = 'flex';
                };
                if (delCancelBtn) delCancelBtn.onclick = () => {
                    const actions = $(`jeActions_${i}`);
                    const confirmRow = $(`jeConfirm_${i}`);
                    if (actions) actions.style.display = 'flex';
                    if (confirmRow) confirmRow.style.display = 'none';
                };
                if (delOkBtn) delOkBtn.onclick = () => {
                    Store.state.globalViews.splice(i, 1);
                    Store.save();
                    App.updSelects();
                    this.modManageViews();
                    App.run();
                };

                // 复选框变化时更新批量按钮状态
                if (checkbox) {
                    checkbox.onchange = updateBatchButtons;
                }
            });
        };

        // 初始绑定
        this.bindViewActions(vs);

        // 其他按钮绑定
        $('jeAddNew').onclick = () => { $('modalOverlay').classList.add('hidden'); this.open(-1); };
        const pasteBtn = $('jePasteBtn');
        if (pasteBtn) pasteBtn.onclick = () => this.importViewsFromText($('jePaste').value || '');
    },

    normalizeView(v) {
        if(!v || !v.view || !v.left || !v.right) return null;
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
    importViewsFromText(txt) {
        const raw = (txt || '').trim();
        if(!raw) return Toast.show('请输入配置内容', true);
        let data;
        try { data = JSON.parse(raw); } catch(e) { return alert('格式错误'); }
        let views = [];
        if(Array.isArray(data)) views = data;
        else if(data.kind === 'join-view' && data.view) views = [data.view];
        else if(data.globalViews) views = data.globalViews;
        else if(data.views) views = data.views;
        else if(data.view && data.left) views = [data];
        if(!views.length) return alert('未识别到视图配置');

        let imported = 0;
        views.forEach(v => {
            const nv = this.normalizeView(v);
            if(!nv) return;
            const idx = Store.state.globalViews.findIndex(x => x.view === nv.view);
            if(idx > -1) {
                if(confirm(`视图 ${nv.view} 已存在，是否覆盖？(取消则自动改名)`)) {
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
        if(imported) {
            Store.save(); App.updSelects(); App.run(); this.modManageViews();
            Toast.show(`已导入 ${imported} 个视图`);
        }
    },
    
    open(editIdx = -1) {
        const p = $('joinModal'); p.classList.remove('hidden');
        document.body.classList.add('modal-open');
        this.state.editIdx = editIdx;
        this.metaCache = {};
        const v = editIdx > -1 ? Store.state.globalViews[editIdx] : { view:'', left:'', right:'', type:'inner', on:'', select:'' };

        this.state.titleBase = editIdx > -1 ? '编辑全局视图' : '新增全局视图';
        $('jeTitle').textContent = this.state.titleBase;
        $('jeName').value = v.view;
        $('jeType').value = v.type;

        const availableTables = App.getAvailableTables();
        ['jeLeftTable','jeRightTable'].forEach(id => {
            const select = $(id);
            select.replaceChildren();
            availableTables.forEach(name => select.add(new Option(name, name)));
        });

        const setTableValue = (selectId, val) => {
            const sel = $(selectId);
            if (val && Array.from(sel.options).some(o => o.value === val)) {
                sel.value = val;
                return true;
            }
            if (sel.options.length > 0) sel.selectedIndex = 0;
            return !val;
        };
        const leftOk = setTableValue('jeLeftTable', v.left);
        const rightOk = setTableValue('jeRightTable', v.right);
        if (!leftOk && v.left) Toast.show(`左表"${v.left}"在当前数据中已不存在，关联条件和输出列可能失效`, true);
        if (!rightOk && v.right) Toast.show(`右表"${v.right}"在当前数据中已不存在，关联条件和输出列可能失效`, true);

        this.state.rels = v.on ? v.on.split(',').map(s => { const p=s.split('='); return {l:p[0].trim(), r:p[1].trim()}; }) : [];
        if(this.state.rels.length === 0) this.state.rels.push({l:'', r:''});

        this.state.lSel = []; this.state.rSel = []; this.state.order = [];
        if(v.select) {
            const tokens = Joiner.buildSelectTokens(v.select);
            tokens.forEach(t => {
                const side = (t.side === 'right' || t.side === 'r') ? 'r' : 'l';
                if(side === 'l') this.state.lSel.push(t.col);
                else this.state.rSel.push(t.col);
                this.state.order.push({ side, col: t.col, alias: t.alias || '' });
            });
        }

        this.state.lOnlySel = false;
        this.state.rOnlySel = false;
        this.state.showL = true;
        this.state.showR = true;
        if($('jeLOnlySel')) $('jeLOnlySel').checked = false;
        if($('jeROnlySel')) $('jeROnlySel').checked = false;
        if($('jeOrderShowL')) $('jeOrderShowL').checked = true;
        if($('jeOrderShowR')) $('jeOrderShowR').checked = true;

        this.state.prevLeft = $('jeLeftTable').value;
        this.state.prevRight = $('jeRightTable').value;

        this.refreshColumns();
        this.renderRels();
        this.renderSelectedOrder();
        this.updateAll();
        this.setDirty(false);
    },

    close(force=false) {
        if(!force && this.state.dirty) {
            if(!confirm('有未保存修改，确定关闭？')) return;
        }
        $('joinModal').classList.add('hidden');
        document.body.classList.remove('modal-open');
    },

    setDirty(flag) {
        this.state.dirty = flag;
        const title = this.state.titleBase || '全局视图';
        $('jeTitle').textContent = flag ? `${title} *` : title;
    },
    markDirty() { this.setDirty(true); },
    
    refreshColumns() {
        const lName = $('jeLeftTable').value;
        const rName = $('jeRightTable').value;
        const lCols = App.getCols(lName);
        const rCols = App.getCols(rName);

        this.state.lSel = this.state.lSel.filter(c => lCols.includes(c));
        this.state.rSel = this.state.rSel.filter(c => rCols.includes(c));
        this.state.rels.forEach(r => {
            if(r.l && !lCols.includes(r.l)) r.l = '';
            if(r.r && !rCols.includes(r.r)) r.r = '';
        });
        this.syncOrderFromSelections(lCols, rCols);

        this.renderColList('jeLList', lCols, this.state.lSel, 'l');
        this.renderColList('jeRList', rCols, this.state.rSel, 'r');
        this.renderSelectedOrder();
        this.renderRels();
        this.updateRelMeta();
        this.updateAll();
    },
    
    getFilteredCols(side, cols) {
        const search = $(side === 'l' ? 'jeLSearch' : 'jeRSearch').value.toLowerCase();
        const onlySelected = side === 'l' ? this.state.lOnlySel : this.state.rOnlySel;
        const selected = side === 'l' ? this.state.lSel : this.state.rSel;
        let list = (cols || []).slice();
        if(onlySelected) list = list.filter(c => selected.includes(c));
        if(search) list = list.filter(c => c.toLowerCase().includes(search));
        return list;
    },
    renderColList(id, cols, selected, side) {
        const list = this.getFilteredCols(side, cols);
        const html = list.map(c => `
            <label class="checkbox-row">
                <input type="checkbox" data-side="${side}" value="${this.escapeHtml(c)}" ${selected.includes(c)?'checked':''}>
                <span>${this.escapeHtml(c)}</span>
            </label>
        `).join('');
        $(id).innerHTML = html || '<div style="padding:8px; color:#999;">无匹配字段</div>';

        $(id).querySelectorAll('input').forEach(chk => {
            chk.onchange = () => this.setSelection(side, chk.value, chk.checked);
        });
    },
    
    renderRels() {
        const lName = $('jeLeftTable').value;
        const rName = $('jeRightTable').value;
        const lCols = App.getCols(lName);
        const rCols = App.getCols(rName);
        const lOpts = lCols.map(c=>`<option value="${this.escapeHtml(c)}">${this.escapeHtml(c)}</option>`).join('');
        const rOpts = rCols.map(c=>`<option value="${this.escapeHtml(c)}">${this.escapeHtml(c)}</option>`).join('');

        $('jeRelContainer').innerHTML = this.state.rels.map((r, i) => `
            <div class="join-rel-card" data-idx="${i}">
                <div class="je-row">
                    <select class="je-rel-l" data-idx="${i}">${lOpts || '<option>无字段</option>'}</select>
                    <span style="opacity:0.6;">=</span>
                    <select class="je-rel-r" data-idx="${i}">${rOpts || '<option>无字段</option>'}</select>
                    <button class="icon-btn sm" data-swap="${i}" title="交换左右">⇄</button>
                    <button class="icon-btn sm danger" data-del="${i}" title="删除">×</button>
                </div>
                <div class="rel-meta-row">
                    <span class="rel-meta" id="jeRelMetaL_${i}"></span>
                    <span class="rel-meta" id="jeRelMetaR_${i}"></span>
                </div>
            </div>
        `).join('');

        const ls = document.querySelectorAll('.je-rel-l');
        const rs = document.querySelectorAll('.je-rel-r');
        this.state.rels.forEach((r, i) => {
            if(r.l && lCols.includes(r.l)) ls[i].value = r.l; else r.l = '';
            if(r.r && rCols.includes(r.r)) rs[i].value = r.r; else r.r = '';
        });

        ls.forEach(s => s.onchange = e => {
            this.state.rels[e.target.dataset.idx].l = e.target.value;
            this.markDirty();
            this.updateRelMeta();
            this.updateAll();
        });
        rs.forEach(s => s.onchange = e => {
            this.state.rels[e.target.dataset.idx].r = e.target.value;
            this.markDirty();
            this.updateRelMeta();
            this.updateAll();
        });
        document.querySelectorAll('[data-swap]').forEach(btn => {
            btn.onclick = () => this.swapRel(+btn.dataset.swap);
        });
        document.querySelectorAll('[data-del]').forEach(btn => {
            btn.onclick = () => this.delRel(+btn.dataset.del);
        });
        this.updateRelMeta();
    },

    addRel() { this.state.rels.push({l:'', r:''}); this.markDirty(); this.renderRels(); this.updateAll(); },
    delRel(i) {
        this.state.rels.splice(i, 1);
        if(this.state.rels.length === 0) this.state.rels.push({l:'', r:''});
        this.markDirty();
        this.renderRels();
        this.updateAll();
    },
    swapRel(i) {
        const r = this.state.rels[i];
        if(!r) return;
        const tmp = r.l; r.l = r.r; r.r = tmp;
        this.markDirty();
        this.renderRels();
        this.updateAll();
    },
    autoMatchRels() {
        const lCols = App.getCols($('jeLeftTable').value);
        const rCols = App.getCols($('jeRightTable').value);
        const lSet = new Set(lCols);
        const common = rCols.filter(c => lSet.has(c));
        if(!common.length) return Toast.show('无同名字段可匹配', true);
        const hasExisting = this.state.rels.some(r => r.l || r.r);
        if(hasExisting && !confirm('将覆盖现有关联条件，继续？')) return;
        this.state.rels = common.map(c => ({ l: c, r: c }));
        this.markDirty();
        this.renderRels();
        this.updateAll();
    },
    
    buildOnString(rels) {
        return rels.map(r => `${r.l}=${r.r}`).join(',');
    },
    buildSelectString() {
        return this.state.order.map(o => {
            const side = o.side === 'r' ? 'right' : 'left';
            const base = `${side}.${o.col}`;
            const alias = (o.alias || '').trim();
            return alias ? `${base} as ${alias}` : base;
        }).join(',');
    },
    getCurrentConfig() {
        return {
            view: $('jeName').value.trim(),
            left: $('jeLeftTable').value,
            right: $('jeRightTable').value,
            type: $('jeType').value,
            on: this.buildOnString(this.state.rels.filter(r => r.l && r.r)),
            select: this.buildSelectString()
        };
    },

    validate() {
        const errors = [];
        const warnings = [];
        const name = $('jeName').value.trim();
        if(!name) errors.push('请填写视图名称');
        if(['__proto__','prototype','constructor'].includes(name)) errors.push('该视图名称不可使用');
        if(name && this.isNameConflict(name, this.state.editIdx)) errors.push('视图名称与已有表/视图冲突');
        if(!$('jeLeftTable').value || !$('jeRightTable').value) errors.push('请选择左右表');

        const rels = this.state.rels.filter(r => r.l || r.r);
        const invalidRels = rels.filter(r => !r.l || !r.r);
        const validRels = rels.filter(r => r.l && r.r);
        if(invalidRels.length) errors.push('关联条件存在空字段');
        if(validRels.length === 0) errors.push('至少配置一个关联条件');
        const leftCols = App.getCols($('jeLeftTable').value);
        const rightCols = App.getCols($('jeRightTable').value);
        if(validRels.some(rel => !leftCols.includes(rel.l) || !rightCols.includes(rel.r))) errors.push('关联条件引用了不存在的字段');
        if(this.state.order.length === 0) errors.push('至少选择一个输出列');

        const cfg = this.getCurrentConfig();
        if(name && Joiner.hasDependencyCycle(cfg, Store.state.globalViews, App.raw.map(table => table.name))) errors.push('视图依赖会形成循环');

        const headers = this.state.order.map(o => (o.alias || o.col || '').trim()).filter(Boolean);
        const dupes = headers.filter((h,i) => headers.indexOf(h) !== i);
        if(dupes.length) warnings.push(`输出列重名将自动去重: ${Array.from(new Set(dupes)).join(', ')}`);

        return { ok: errors.length === 0, errors, warnings };
    },
    updateSaveState() {
        const { ok, errors, warnings } = this.validate();
        const warn = $('jeWarn');
        if(errors.length) {
            warn.textContent = `⚠ ${errors.join('；')}`;
            warn.className = 'join-warn error';
        } else if(warnings.length) {
            warn.textContent = `提示: ${warnings.join('；')}`;
            warn.className = 'join-warn';
        } else {
            warn.textContent = '可以保存';
            warn.className = 'join-warn ok';
        }
        ['jeSave', 'jeSaveFooter'].forEach(id => { if($(id)) $(id).disabled = !ok; });
    },
    updateStatus() {
        const total = this.state.lSel.length + this.state.rSel.length;
        $('jeStatus').textContent = `已选输出列: ${total} (Left: ${this.state.lSel.length}, Right: ${this.state.rSel.length})`;
    },
    updatePreview() {
        const cfg = this.getCurrentConfig();
        const hasRel = this.state.rels.some(r => r.l && r.r);
        const el = $('jePreview');
        if(!cfg.left || !cfg.right || !hasRel) { el.textContent = '预览: -'; return; }
        const stats = Joiner.stats(App.raw, cfg, Store.state.globalViews);
        if(!stats) { el.textContent = '预览: -'; return; }
        el.textContent = `预览: 输出 ${stats.outRows} · 匹配 ${stats.matched} · 左未匹配 ${stats.leftOnly} · 右未匹配 ${stats.rightOnly}`;
    },
    updateDependencyInfo() {
        const rName = $('jeRightTable').value;
        const el = $('jeDependency');
        const v = Store.state.globalViews.find(x => x.view === rName);
        if(!el) return;
        if(!v) { el.textContent = '右表为原始表'; return; }
        const chain = this.buildDependencyChain(rName);
        const stamp = this.formatTime(v.updatedAt || v.createdAt);
        el.innerHTML = `<div style="font-weight:700; margin-bottom:4px;">视图依赖</div><div>${this.escapeHtml(chain)}</div><div class="muted" style="margin-top:4px;">更新: ${stamp || '未知'}</div>`;
    },
    buildDependencyChain(name, seen=new Set()) {
        const v = Store.state.globalViews.find(x => x.view === name);
        if(!v) return name;
        if(seen.has(name)) return `${name}(循环)`;
        const next = new Set(seen); next.add(name);
        const left = this.buildDependencyChain(v.left, next);
        const right = this.buildDependencyChain(v.right, next);
        return `${name} -> (${left} + ${right})`;
    },

    getTableData(name) {
        const raw = App.raw.find(t => t.name === name);
        if(raw) return raw;
        const view = Store.state.globalViews.find(v => v.view === name);
        if(view) return Joiner.run(App.raw, view, Store.state.globalViews);
        return null;
    },
    inferType(val) {
        if(val === null || val === undefined) return '空';
        const s = String(val).trim();
        if(!s) return '空';
        if(/^[-+]?\d+(\.\d+)?$/.test(s)) return '数值';
        if(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s)) return '日期';
        if(!Number.isNaN(Date.parse(s)) && /[-/]/.test(s)) return '日期';
        return '文本';
    },
    getColMeta(tableName, col) {
        if(!tableName || !col) return { type: '-', sample: '-' };
        const key = `${tableName}::${col}`;
        if(this.metaCache[key]) return this.metaCache[key];
        const table = this.getTableData(tableName);
        if(!table) return { type: '-', sample: '-' };
        const idx = table.headers.indexOf(col);
        if(idx === -1) return { type: '-', sample: '-' };
        let sample = '';
        for(const row of table.rows) {
            const v = row[idx];
            if(v !== undefined && v !== null && String(v).trim() !== '') { sample = v; break; }
        }
        const type = this.inferType(sample);
        const sText = sample === '' ? '-' : String(sample);
        const short = sText.length > 20 ? `${sText.slice(0, 20)}…` : sText;
        const res = { type, sample: short };
        this.metaCache[key] = res;
        return res;
    },
    updateRelMeta() {
        const lName = $('jeLeftTable').value;
        const rName = $('jeRightTable').value;
        this.state.rels.forEach((r, i) => {
            const l = this.getColMeta(lName, r.l);
            const rmeta = this.getColMeta(rName, r.r);
            const lEl = $(`jeRelMetaL_${i}`);
            const rEl = $(`jeRelMetaR_${i}`);
            if(lEl) lEl.textContent = `左: ${l.type} · 例 ${l.sample}`;
            if(rEl) rEl.textContent = `右: ${rmeta.type} · 例 ${rmeta.sample}`;
        });
    },

    handleTableChange(side) {
        const sel = side === 'l' ? $('jeLeftTable') : $('jeRightTable');
        const next = sel.value;
        const prev = side === 'l' ? this.state.prevLeft : this.state.prevRight;
        if(next === prev) return;
        const cols = App.getCols(next);
        const removedCols = (side === 'l' ? this.state.lSel : this.state.rSel).filter(c => !cols.includes(c));
        const removedRels = this.state.rels.filter(r => {
            const col = side === 'l' ? r.l : r.r;
            return col && !cols.includes(col);
        }).map(r => `${r.l || '?'}=${r.r || '?'}`);

        const applyChange = () => {
            if(side === 'l') this.state.prevLeft = next; else this.state.prevRight = next;
            this.refreshColumns();
            this.markDirty();
        };
        const cancelChange = () => { sel.value = prev; };

        if(removedCols.length || removedRels.length) {
            this.confirmTableChange({
                title: '切换表确认',
                removedCols,
                removedRels,
                onConfirm: applyChange,
                onCancel: cancelChange
            });
            return;
        }
        applyChange();
    },
    confirmTableChange({ title, removedCols, removedRels, onConfirm, onCancel }) {
        const colHtml = removedCols.length ? `<div class="muted">将移除列</div><div style="display:flex; flex-wrap:wrap; gap:6px; margin:6px 0;">${removedCols.map(c => `<span class="chip">${this.escapeHtml(c)}</span>`).join('')}</div>` : '';
        const relHtml = removedRels.length ? `<div class="muted" style="margin-top:6px;">失效关联</div><div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">${removedRels.map(c => `<span class="chip">${this.escapeHtml(c)}</span>`).join('')}</div>` : '';
        App.modal(title, `${colHtml}${relHtml}<div style="text-align:right; margin-top:12px;"><button class="sm" id="jeTblCancel">取消</button><button class="primary sm" id="jeTblOk" style="margin-left:8px;">继续</button></div>`);
        $('jeTblCancel').onclick = () => { $('modalOverlay').classList.add('hidden'); if(onCancel) onCancel(); };
        $('jeTblOk').onclick = () => { $('modalOverlay').classList.add('hidden'); if(onConfirm) onConfirm(); };
    },

    toggleAll(side) {
        const cols = this.getFilteredCols(side, App.getCols(side === 'l' ? $('jeLeftTable').value : $('jeRightTable').value));
        if(!cols.length) return;
        const selected = side === 'l' ? this.state.lSel : this.state.rSel;
        const allChecked = cols.every(c => selected.includes(c));
        cols.forEach(c => this.setSelection(side, c, !allChecked, false));
        this.syncOrderFromSelections(App.getCols($('jeLeftTable').value), App.getCols($('jeRightTable').value));
        this.renderColList(side === 'l' ? 'jeLList' : 'jeRList', App.getCols(side === 'l' ? $('jeLeftTable').value : $('jeRightTable').value), selected, side);
        this.renderSelectedOrder();
        this.updateAll();
        this.markDirty();
    },
    selectFiltered(side) {
        const cols = this.getFilteredCols(side, App.getCols(side === 'l' ? $('jeLeftTable').value : $('jeRightTable').value));
        if(!cols.length) return;
        cols.forEach(c => this.setSelection(side, c, true, false));
        this.syncOrderFromSelections(App.getCols($('jeLeftTable').value), App.getCols($('jeRightTable').value));
        this.renderColList(side === 'l' ? 'jeLList' : 'jeRList', App.getCols(side === 'l' ? $('jeLeftTable').value : $('jeRightTable').value), side === 'l' ? this.state.lSel : this.state.rSel, side);
        this.renderSelectedOrder();
        this.updateAll();
        this.markDirty();
    },

    setSelection(side, col, checked, appendToEnd=true) {
        const arr = side === 'l' ? this.state.lSel : this.state.rSel;
        const idx = arr.indexOf(col);
        if(checked) {
            if(idx === -1) arr.push(col);
        } else {
            if(idx > -1) arr.splice(idx,1);
        }
        this.syncOrderFromSelections(App.getCols($('jeLeftTable').value), App.getCols($('jeRightTable').value), appendToEnd ? {side, col, checked} : null);
        this.renderSelectedOrder();
        this.updateAll();
        this.markDirty();
    },

    syncOrderFromSelections(lCols, rCols, lastChange=null) {
        this.state.order = this.state.order.filter(o => {
            const list = o.side === 'l' ? this.state.lSel : this.state.rSel;
            return list.includes(o.col);
        });
        const seen = new Set(this.state.order.map(o => `${o.side}:${o.col}`));

        if(lastChange && lastChange.checked) {
            const key = `${lastChange.side}:${lastChange.col}`;
            if(!seen.has(key)) {
                this.state.order.push({ side:lastChange.side, col:lastChange.col, alias:'' });
                seen.add(key);
            }
        }

        const appendMissing = (side, arr, cols=[]) => {
            arr.forEach(c => {
                const key = `${side}:${c}`;
                if(!seen.has(key) && (!cols.length || cols.includes(c))) {
                    this.state.order.push({ side, col:c, alias:'' });
                    seen.add(key);
                }
            });
        };
        appendMissing('l', this.state.lSel, lCols || []);
        appendMissing('r', this.state.rSel, rCols || []);
    },

    renderSelectedOrder() {
        const box = $('jeOrderList'); if(!box) return;
        const visible = this.state.order.filter(o => (o.side === 'l' ? this.state.showL : this.state.showR));
        if(!visible.length) {
            box.innerHTML = '<div style="font-size:11px; color:var(--text-tertiary);">未选择输出列</div>';
            return;
        }
        const leftSel = $('jeLeftTable');
        const rightSel = $('jeRightTable');
        const leftName = (leftSel && leftSel.value) ? leftSel.value : '左表';
        const rightName = (rightSel && rightSel.value) ? rightSel.value : '右表';
        box.innerHTML = visible.map(o => {
            const idx = this.state.order.indexOf(o);
            const tableName = o.side === 'l' ? leftName : rightName;
            const labelRaw = `${tableName}.${o.col}`;
            const label = this.escapeHtml(labelRaw);
            const alias = this.escapeHtml(o.alias || '');
            return `
            <div class="join-chip" data-idx="${idx}" draggable="true">
                <div class="join-chip-main">
                    <span class="join-chip-label" title="${label}">${label}</span>
                    <input class="join-alias" data-idx="${idx}" placeholder="别名" value="${alias}">
                </div>
                <div class="join-chip-actions">
                    <button class="icon-btn sm" data-move="-1" title="上移" style="width:22px; height:22px;">↑</button>
                    <button class="icon-btn sm" data-move="1" title="下移" style="width:22px; height:22px;">↓</button>
                    <button class="icon-btn sm danger" data-remove="1" title="移除" style="width:22px; height:22px;">×</button>
                </div>
            </div>`;
        }).join('');

        box.querySelectorAll('button[data-move]').forEach(btn => {
            btn.onclick = () => {
                const idx = +btn.closest('[data-idx]').dataset.idx;
                this.moveOrder(idx, +btn.dataset.move);
            };
        });
        box.querySelectorAll('button[data-remove]').forEach(btn => {
            btn.onclick = () => {
                const idx = +btn.closest('[data-idx]').dataset.idx;
                this.removeOrder(idx);
            };
        });
        box.querySelectorAll('.join-alias').forEach(inp => {
            inp.oninput = () => {
                const idx = +inp.dataset.idx;
                this.state.order[idx].alias = inp.value.trim();
                this.markDirty();
                this.updateAll();
            };
        });

        box.querySelectorAll('.join-chip').forEach(chip => {
            chip.addEventListener('dragstart', e => {
                this.dragIdx = +chip.dataset.idx;
                chip.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            chip.addEventListener('dragend', () => {
                chip.classList.remove('dragging');
                this.dragIdx = null;
            });
            chip.addEventListener('dragover', e => e.preventDefault());
            chip.addEventListener('drop', e => {
                e.preventDefault();
                const to = +chip.dataset.idx;
                if(this.dragIdx === null || this.dragIdx === to) return;
                this.moveOrderTo(this.dragIdx, to);
            });
        });
    },

    moveOrder(idx, delta) {
        const target = idx + delta;
        if(target < 0 || target >= this.state.order.length) return;
        const [item] = this.state.order.splice(idx, 1);
        this.state.order.splice(target, 0, item);
        this.renderSelectedOrder();
        this.updateAll();
        this.markDirty();
    },
    moveOrderTo(from, to) {
        if(from < 0 || to < 0 || from === to) return;
        const [item] = this.state.order.splice(from, 1);
        this.state.order.splice(to, 0, item);
        this.renderSelectedOrder();
        this.updateAll();
        this.markDirty();
    },
    removeOrder(idx) {
        const item = this.state.order[idx];
        if(!item) return;
        this.state.order.splice(idx, 1);
        const arr = item.side === 'l' ? this.state.lSel : this.state.rSel;
        const sIdx = arr.indexOf(item.col);
        if(sIdx > -1) arr.splice(sIdx, 1);
        this.renderColList('jeLList', App.getCols($('jeLeftTable').value), this.state.lSel, 'l');
        this.renderColList('jeRList', App.getCols($('jeRightTable').value), this.state.rSel, 'r');
        this.renderSelectedOrder();
        this.updateAll();
        this.markDirty();
    },
    rebuildOrder() {
        const aliasMap = new Map(this.state.order.map(o => [`${o.side}:${o.col}`, o.alias]));
        this.state.order = [];
        this.state.lSel.forEach(c => this.state.order.push({ side:'l', col:c, alias: aliasMap.get(`l:${c}`) || '' }));
        this.state.rSel.forEach(c => this.state.order.push({ side:'r', col:c, alias: aliasMap.get(`r:${c}`) || '' }));
        this.renderSelectedOrder();
        this.updateAll();
        this.markDirty();
    },
    clearOrder() {
        this.state.lSel = [];
        this.state.rSel = [];
        this.state.order = [];
        this.renderColList('jeLList', App.getCols($('jeLeftTable').value), this.state.lSel, 'l');
        this.renderColList('jeRList', App.getCols($('jeRightTable').value), this.state.rSel, 'r');
        this.renderSelectedOrder();
        this.updateAll();
        this.markDirty();
    },
    keepOnly(side) {
        if(side === 'l') this.state.rSel = [];
        if(side === 'r') this.state.lSel = [];
        this.state.order = this.state.order.filter(o => o.side === side);
        this.renderColList('jeLList', App.getCols($('jeLeftTable').value), this.state.lSel, 'l');
        this.renderColList('jeRList', App.getCols($('jeRightTable').value), this.state.rSel, 'r');
        this.renderSelectedOrder();
        this.updateAll();
        this.markDirty();
    },

    updateAll() {
        this.updateStatus();
        this.updateSaveState();
        this.updatePreview();
        this.updateDependencyInfo();
    },
    
    save() {
        document.querySelectorAll('.je-rel-l').forEach((s,i) => this.state.rels[i].l = s.value);
        document.querySelectorAll('.je-rel-r').forEach((s,i) => this.state.rels[i].r = s.value);

        const check = this.validate();
        if(!check.ok) return alert(check.errors.join('；'));

        const name = $('jeName').value.trim();
        const onStr = this.buildOnString(this.state.rels.filter(r => r.l && r.r));
        const selStr = this.buildSelectString();

        const base = this.state.editIdx > -1 ? Store.state.globalViews[this.state.editIdx] : {};
        const nv = {
            view: name,
            left: $('jeLeftTable').value,
            right: $('jeRightTable').value,
            type: $('jeType').value,
            on: onStr,
            select: selStr,
            createdAt: base.createdAt || Date.now(),
            updatedAt: Date.now()
        };

        if(this.state.editIdx > -1) Store.state.globalViews[this.state.editIdx] = nv;
        else Store.state.globalViews.push(nv);

        Store.save();
        App.updSelects();
        App.run();
        this.setDirty(false);
        $('joinModal').classList.add('hidden');
        document.body.classList.remove('modal-open');
    }
};
