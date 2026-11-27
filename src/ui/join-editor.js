OTA.define('join-editor', ["runtime","store","joiner","exporter","table-registry","modal-controller","view-manager","dispatch","table-builder"], ({$, escapeHtml, formatBytes, Toast}, {Store}, {Joiner}, {Exporter}, {TableRegistry}, {ModalController}, {ViewManager}, {dispatch}, {TableBuilder}) => {
/* Project-scoped JOIN designer. */
const JoinEditor = {
    state: { editIdx: -1, rels: [], lSel: [], rSel: [], order: [], dirty: false, lOnlySel: false, rOnlySel: false, showL: true, showR: true, prevLeft: null, prevRight: null, selectedOrderIdx: -1 },
    metaCache: {},
    dragIdx: null,
    escapeHtml,
    formatBytes,

    init() {
        ViewManager.setEditCallback(idx => this.open(idx));
        $('jeCancel').onclick = () => this.close();
        $('jeSave').onclick = () => this.save();
        $('jeEnabled').onchange = () => this.markDirty();
        $('jeAddRel').onclick = () => this.addRel();
        $('jeAutoRel').onclick = () => this.autoMatchRels();
        $('jePresetEnrich').onclick = () => this.applyPreset('enrich');
        $('jePresetLeft').onclick = () => this.applyPreset('left');
        $('jePresetRight').onclick = () => this.applyPreset('right');
        $('jeOrderRebuild').onclick = () => this.rebuildOrder();
        $('jeOrderClear').onclick = () => this.clearOrder();
        $('jeOrderLeftOnly').onclick = () => this.keepOnly('l');
        $('jeOrderRightOnly').onclick = () => this.keepOnly('r');
        $('jeOrderMoveTop').onclick = () => this.moveOrderToEdge('top');
        $('jeOrderMoveBottom').onclick = () => this.moveOrderToEdge('bottom');
        $('jeLeftTable').onchange = () => this.handleTableChange('l');
        $('jeRightTable').onchange = () => this.handleTableChange('r');
        $('jeType').onchange = () => { this.markDirty(); this.updateAll(); };
        $('jeName').oninput = () => { this.markDirty(); this.updateSaveState(); };
        for(const side of ['l','r']) {
            const letter = side.toUpperCase();
            $(`je${letter}Search`).oninput = () => this.renderSide(side);
            $(`je${letter}All`).onclick = () => this.toggleAll(side);
            $(`je${letter}OnlySel`).onchange = e => {
                this.state[`${side}OnlySel`] = e.target.checked;
                this.renderSide(side);
            };
            $(`jeOrderShow${letter}`).onchange = e => {
                this.state[`show${letter}`] = e.target.checked;
                this.renderSelectedOrder();
            };
        }
        $('joinModal').addEventListener('click', e => { if(e.target === $('joinModal')) this.close(); });
    },

    handleKeydown(e) {
        if(e.isComposing || e.keyCode === 229) return;
        const target = e.target;
        const typing = target.matches('input,textarea,select');
        if(e.key === 'Escape') {
            e.preventDefault();
            this.close();
        } else if(e.key === 'Enter' && ((e.ctrlKey || e.metaKey) || (!e.shiftKey && !target.closest('button,summary,input,textarea,select')))) {
            e.preventDefault();
            if(!$('jeSave').disabled) this.save();
        } else if(e.key === '/' && !typing) {
            e.preventDefault();
            $('jeLSearch').focus();
        } else if(e.altKey && !typing && ['ArrowUp','ArrowDown'].includes(e.key)) {
            e.preventDefault();
            const row = target.closest('.join-chip');
            const idx = row ? Number(row.dataset.idx) : this.state.selectedOrderIdx;
            if(idx >= 0) this.moveOrder(idx, e.key === 'ArrowUp' ? -1 : 1);
        } else if(e.key === ' ' && target.matches('.join-chip')) {
            e.preventDefault();
            target.click();
        }
    },

    renderSide(side) {
        const cols = TableRegistry.getCols($(side === 'l' ? 'jeLeftTable' : 'jeRightTable').value);
        this.renderColList(`je${side.toUpperCase()}List`, cols, this.state[`${side}Sel`], side);
    },

    formatTime(ts) {
        if(!ts) return '';
        const d = new Date(ts);
        if(Number.isNaN(d.getTime())) return '';
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },

    /* ── Column type helpers ── */
    inferType(val) {
        if(val === null || val === undefined) return 'empty';
        const s = String(val).trim();
        if(!s) return 'empty';
        if(/^[-+]?\d+(\.\d+)?$/.test(s)) return 'numeric';
        if(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s)) return 'date';
        if(!Number.isNaN(Date.parse(s)) && /[-/]/.test(s)) return 'date';
        return 'text';
    },
    typeIcon(type) {
        const map = { numeric: ['#','col-num'], text: ['T','col-txt'], date: ['D','col-date'], empty: ['-','col-empty'] };
        const [letter, cls] = map[type] || ['?','col-txt'];
        return `<span aria-hidden="true" class="col-type-icon ${cls}">${letter}</span>`;
    },
    getColMeta(tableName, col) {
        if(!tableName || !col) return { type: 'empty', sample: '-' };
        const key = `${Store.revision}::${tableName}::${col}`;
        if(this.metaCache[key]) return this.metaCache[key];
        const table = this.getTableData(tableName);
        if(!table) return { type: 'empty', sample: '-' };
        const idx = table.headers.indexOf(col);
        if(idx === -1) return { type: 'empty', sample: '-' };
        let sample = table.columnSamples?.[idx]?.value ?? '';
        for(let i = 0; i < Math.min(table.rows.length, 1000); i++) {
            const v = table.rows[i][idx];
            if(v !== undefined && v !== null && String(v).trim() !== '') { sample = v; break; }
        }
        const type = table.columnSamples?.[idx]?.truncated || (sample==='' && (table.isView || table.remote || table.rows.length>1000))?'unknown':this.inferType(sample);
        const sText = sample === '' ? '-' : String(sample);
        const short = sText.length > 20 ? `${sText.slice(0, 20)}…` : sText;
        const res = { type, sample: short };
        this.metaCache[key] = res;
        return res;
    },
    getTableData(name) {
        const raw = TableRegistry.getRaw().find(t => t.name === name);
        if(raw) return raw;
        const pooled = TableRegistry.getAvailableRawTables().find(t => t.name === name);
        if(pooled) return {...pooled,remote:true};
        const view = Store.getViews().find(v => v.view === name);
        if(view && TableRegistry.isBackground())return {headers:TableRegistry.getCols(name),rows:[],isView:true};
        if(view) return Joiner.run(TableRegistry.getRaw(), view, Store.getViews());
        return null;
    },

    /* ── Column list rendering ── */
    getFilteredCols(side, cols) {
        const searchEl = $(side === 'l' ? 'jeLSearch' : 'jeRSearch');
        const search = (searchEl && searchEl.value || '').toLowerCase();
        const onlySelected = side === 'l' ? this.state.lOnlySel : this.state.rOnlySel;
        const selected = side === 'l' ? this.state.lSel : this.state.rSel;
        let list = (cols || []).slice();
        if(onlySelected) list = list.filter(c => selected.includes(c));
        if(search) list = list.filter(c => c.toLowerCase().includes(search));
        return list;
    },
    renderColList(id, cols, selected, side) {
        const tableName = $(side === 'l' ? 'jeLeftTable' : 'jeRightTable').value;
        const list = this.getFilteredCols(side, cols);
        const letter = side.toUpperCase();
        const bulk = $(`je${letter}All`);
        bulk.disabled = !list.length;
        const refreshCounts = () => {
            $(`je${letter}Count`).textContent = `${selected.length}/${cols.length}`;
            bulk.textContent = list.length && list.every(c => selected.includes(c)) ? '取消全选' : '全选';
        };
        refreshCounts();
        bulk.title = '作用于当前显示的字段';
        const box = $(id);
        const focused = box.contains(document.activeElement) ? document.activeElement.value : null;
        let anchor = null;
        if(!list.length) {
            box.innerHTML = '<div class="join-empty">没有符合条件的字段</div>';
            if(focused !== null) $(`je${letter}Search`).focus();
            return;
        }
        box.innerHTML = list.map(col => {
            const {type} = this.getColMeta(tableName, col);
            const safe = escapeHtml(col);
            return `<label class="checkbox-row"><input type="checkbox" value="${safe}" ${selected.includes(col) ? 'checked' : ''}>
                ${this.typeIcon(type)}<span>${safe}</span></label>`;
        }).join('');
        const checks = Array.from(box.querySelectorAll('input'));
        if(focused !== null) (checks.find(input => input.value === focused) || checks[0]).focus();
        checks.forEach((input, index) => {
            input.onclick = event => {
                const range = event.shiftKey && anchor !== null
                    ? list.slice(Math.min(anchor, index), Math.max(anchor, index) + 1)
                    : [input.value];
                anchor = index;
                this.selectColumns(side, range, input.checked);
                if(this.state[`${side}OnlySel`] && !input.checked) {
                    this.renderSide(side);
                } else {
                    if(range.length > 1) checks.forEach(check => { check.checked = selected.includes(check.value); });
                    refreshCounts();
                }
            };
        });
    },

    selectColumns(side, cols, checked) {
        const selected = this.state[`${side}Sel`];
        for(const col of cols) {
            const idx = selected.indexOf(col);
            if(checked && idx < 0) selected.push(col);
            if(!checked && idx >= 0) selected.splice(idx, 1);
        }
        this.syncOrderFromSelections();
        this.renderSelectedOrder();
        this.updateAll();
        this.markDirty();
    },
    toggleAll(side) {
        const table = $(side === 'l' ? 'jeLeftTable' : 'jeRightTable').value;
        const cols = this.getFilteredCols(side, TableRegistry.getCols(table));
        this.selectColumns(side, cols, !cols.every(col => this.state[`${side}Sel`].includes(col)));
        this.renderSide(side);
    },

    /* ── Order sync ── */
    applyPreset(preset) {
        const left = TableRegistry.getCols($('jeLeftTable').value);
        const right = TableRegistry.getCols($('jeRightTable').value);
        const keys = new Set(this.state.rels.filter(rel => rel.l && rel.r).map(rel => rel.r));
        this.state.lSel = preset === 'right' ? [] : left;
        this.state.rSel = preset === 'left' ? [] : preset === 'right' ? right : right.filter(col => !keys.has(col));
        const previous = new Map(this.state.order.map(o => [`${o.side}:${o.col}`,o]));
        this.state.order = ['l','r'].flatMap(side => this.state[`${side}Sel`].map(col =>
            previous.get(`${side}:${col}`) || {side,col,alias:''}));
        this.state.selectedOrderIdx = -1;
        this.renderSide('l');
        this.renderSide('r');
        this.renderSelectedOrder();
        this.markDirty();
        this.updateAll();
    },
    syncOrderFromSelections() {
        const current = this.state.order[this.state.selectedOrderIdx];
        this.state.order = this.state.order.filter(o => this.state[`${o.side}Sel`].includes(o.col));
        const seen = new Set(this.state.order.map(o => `${o.side}:${o.col}`));
        for(const side of ['l','r']) {
            for(const col of this.state[`${side}Sel`]) {
                if(!seen.has(`${side}:${col}`)) this.state.order.push({side, col, alias:''});
            }
        }
        this.state.selectedOrderIdx = this.state.order.indexOf(current);
    },

    /* ── Order rendering ── */
    renderSelectedOrder() {
        const box = $('jeOrderList'); if(!box) return;
        const visible = this.state.order.filter(o => (o.side === 'l' ? this.state.showL : this.state.showR));
        if(!visible.length) {
            box.innerHTML = this.state.order.length ? '<div class="join-empty">当前筛选下没有输出列</div>' : '<div class="join-empty">勾选来源字段后，可在此调整顺序与列名。</div>';
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
            const selectedClass = (this.state.selectedOrderIdx === idx) ? ' selected' : '';
            return `
            <div class="join-chip${selectedClass}" data-idx="${idx}" draggable="true" tabindex="0">
                <div class="join-chip-main">
                    <span class="join-chip-label" title="${label}">${this.escapeHtml(o.col)}<small>${o.side === 'l' ? '左表' : '右表'} · ${this.escapeHtml(tableName)}</small></span>
                    <input class="join-alias" data-idx="${idx}" aria-label="${label} 的输出别名" placeholder="别名" value="${alias}">
                </div>
                <div class="join-chip-actions">
                    <button class="icon-btn sm" data-move="-1" aria-label="上移 ${label}" title="上移 (Alt+↑)" ${idx === 0 ? 'disabled' : ''}>↑</button>
                    <button class="icon-btn sm" data-move="1" aria-label="下移 ${label}" title="下移 (Alt+↓)" ${idx === this.state.order.length - 1 ? 'disabled' : ''}>↓</button>
                    <button class="icon-btn sm danger" data-remove="1" aria-label="移除 ${label}" title="移除">×</button>
                </div>
            </div>`;
        }).join('');

        // Move buttons
        box.querySelectorAll('button[data-move]').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const idx = +btn.closest('[data-idx]').dataset.idx;
                this.moveOrder(idx, +btn.dataset.move);
            };
        });
        // Remove buttons
        box.querySelectorAll('button[data-remove]').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const idx = +btn.closest('[data-idx]').dataset.idx;
                this.removeOrder(idx);
            };
        });
        // Alias inputs
        box.querySelectorAll('.join-alias').forEach(inp => {
            inp.oninput = () => {
                const idx = +inp.dataset.idx;
                if(this.state.order[idx]) this.state.order[idx].alias = inp.value.trim();
                this.markDirty();
                this.updateAll();
            };
            inp.onclick = (e) => e.stopPropagation();
        });

        // Chip click to select
        box.querySelectorAll('.join-chip').forEach(chip => {
            chip.onclick = () => {
                const idx = +chip.dataset.idx;
                this.state.selectedOrderIdx = (this.state.selectedOrderIdx === idx) ? -1 : idx;
                box.querySelectorAll('.join-chip').forEach(row => row.classList.toggle('selected', +row.dataset.idx === this.state.selectedOrderIdx));
            };
            // DnD
            chip.addEventListener('dragstart', e => {
                this.dragIdx = +chip.dataset.idx;
                chip.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            chip.addEventListener('dragend', () => {
                chip.classList.remove('dragging');
                this.dragIdx = null;
                // Clear all drop indicators
                box.querySelectorAll('.join-chip').forEach(c => c.classList.remove('drop-before','drop-after'));
            });
            chip.addEventListener('dragover', e => {
                e.preventDefault();
                const rect = chip.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                // Clear all indicators first
                box.querySelectorAll('.join-chip').forEach(c => c.classList.remove('drop-before','drop-after'));
                if(e.clientY < mid) {
                    chip.classList.add('drop-before');
                } else {
                    chip.classList.add('drop-after');
                }
            });
            chip.addEventListener('dragleave', () => {
                chip.classList.remove('drop-before','drop-after');
            });
            chip.addEventListener('drop', e => {
                e.preventDefault();
                chip.classList.remove('drop-before','drop-after');
                const to = +chip.dataset.idx;
                if(this.dragIdx === null || this.dragIdx === to) return;
                // Determine if dropping before or after
                const rect = chip.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                const effectiveTo = e.clientY < mid ? to : to + 1;
                this.moveOrderTo(this.dragIdx, effectiveTo);
            });
        });
    },

    moveOrder(idx, delta) {
        const target = idx + delta;
        if(target < 0 || target >= this.state.order.length) return;
        const [item] = this.state.order.splice(idx, 1);
        this.state.order.splice(target, 0, item);
        this.state.selectedOrderIdx = target;
        this.renderSelectedOrder();
        $('jeOrderList').querySelector(`.join-chip[data-idx="${target}"]`)?.focus();
        this.updateAll();
        this.markDirty();
    },
    moveOrderTo(from, to) {
        if(from < 0 || to < 0 || from === to) return;
        const [item] = this.state.order.splice(from, 1);
        const adjustTo = to > from ? to - 1 : to;
        this.state.order.splice(adjustTo, 0, item);
        this.state.selectedOrderIdx = adjustTo;
        this.renderSelectedOrder();
        this.updateAll();
        this.markDirty();
    },
    moveOrderToEdge(pos) {
        const idx = this.state.selectedOrderIdx;
        if(idx < 0 || idx >= this.state.order.length) {
            Toast.show('请先在输出列表中点击选中一列');
            return;
        }
        const [item] = this.state.order.splice(idx, 1);
        if(pos === 'top') {
            this.state.order.unshift(item);
            this.state.selectedOrderIdx = 0;
        } else {
            this.state.order.push(item);
            this.state.selectedOrderIdx = this.state.order.length - 1;
        }
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
        this.state.selectedOrderIdx = -1;
        this.renderColList('jeLList', TableRegistry.getCols($('jeLeftTable').value), this.state.lSel, 'l');
        this.renderColList('jeRList', TableRegistry.getCols($('jeRightTable').value), this.state.rSel, 'r');
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
        Toast.show('输出顺序已按 左→右 重建');
    },
    clearOrder() {
        if(this.state.order.length === 0) return;
        if(!confirm(`清空全部 ${this.state.order.length} 个输出列及其别名？`)) return;
        this.state.lSel = [];
        this.state.rSel = [];
        this.state.order = [];
        this.state.selectedOrderIdx = -1;
        this.renderColList('jeLList', TableRegistry.getCols($('jeLeftTable').value), this.state.lSel, 'l');
        this.renderColList('jeRList', TableRegistry.getCols($('jeRightTable').value), this.state.rSel, 'r');
        this.renderSelectedOrder();
        this.updateAll();
        this.markDirty();
    },
    keepOnly(side) {
        const removeCount = side === 'l' ? this.state.rSel.length : this.state.lSel.length;
        if(removeCount === 0) return;
        const sideName = side === 'l' ? '右表' : '左表';
        if(!confirm(`确定移除全部 ${sideName} 输出列（${removeCount} 列）吗？`)) return;
        if(side === 'l') this.state.rSel = [];
        if(side === 'r') this.state.lSel = [];
        this.state.order = this.state.order.filter(o => o.side === side);
        this.state.selectedOrderIdx = -1;
        this.renderColList('jeLList', TableRegistry.getCols($('jeLeftTable').value), this.state.lSel, 'l');
        this.renderColList('jeRList', TableRegistry.getCols($('jeRightTable').value), this.state.rSel, 'r');
        this.renderSelectedOrder();
        this.updateAll();
        this.markDirty();
    },

    /* ── ON conditions (rels) ── */
    renderRels() {
        const opts = name => TableRegistry.getCols(name).map(col => {
            const safe = escapeHtml(col);
            return `<option value="${safe}">${safe}</option>`;
        }).join('');
        const left = opts($('jeLeftTable').value);
        const right = opts($('jeRightTable').value);
        const box = $('jeRelContainer');
        $('jeRelHint').textContent = this.state.rels.length > 1 ? '同时满足以下条件' : '';
        box.innerHTML = this.state.rels.map((rel, i) => `
            <div class="join-rel-card" data-idx="${i}">
                <div class="je-row">
                    <label><select class="je-rel-l" aria-label="条件 ${i+1} 左表字段" aria-describedby="jeRelMetaL_${i}"><option value="">选择左表字段</option>${left}</select>
                        <span class="rel-meta" id="jeRelMetaL_${i}"></span></label>
                    <span class="rel-equals" aria-hidden="true">=</span>
                    <label><select class="je-rel-r" aria-label="条件 ${i+1} 右表字段" aria-describedby="jeRelMetaR_${i}"><option value="">选择右表字段</option>${right}</select>
                        <span class="rel-meta" id="jeRelMetaR_${i}"></span></label>
                    <button class="icon-btn sm" data-swap title="交换左右字段" aria-label="交换条件 ${i+1} 的左右字段">⇄</button>
                    <button class="icon-btn sm" data-del title="删除条件" aria-label="删除条件 ${i+1}">×</button>
                </div>
            </div>`).join('');
        box.querySelectorAll('.join-rel-card').forEach((card, i) => {
            const relation = this.state.rels[i];
            for(const side of ['l','r']) {
                const select = card.querySelector(`.je-rel-${side}`);
                select.value = relation[side];
                select.onchange = () => {
                    relation[side] = select.value;
                    this.markDirty();
                    this.updateRelMeta();
                    this.updateAll();
                };
            }
            card.querySelector('[data-swap]').onclick = () => this.swapRel(i);
            card.querySelector('[data-del]').onclick = () => this.delRel(i);
        });
        this.updateRelMeta();
    },

    focusRel(index) {
        $('jeRelContainer').querySelectorAll('.je-rel-l')[index]?.focus();
    },
    addRel() {
        this.state.rels.push({l:'', r:''});
        this.markDirty();
        this.renderRels();
        this.updateAll();
        this.focusRel(this.state.rels.length - 1);
    },
    delRel(i) {
        this.state.rels.splice(i, 1);
        if(this.state.rels.length === 0) this.state.rels.push({l:'', r:''});
        this.markDirty();
        this.renderRels();
        this.updateAll();
        this.focusRel(Math.min(i, this.state.rels.length - 1));
    },
    swapRel(i) {
        const r = this.state.rels[i];
        if(!r) return;
        const tmp = r.l; r.l = r.r; r.r = tmp;
        this.markDirty();
        this.renderRels();
        this.updateAll();
        this.focusRel(i);
    },
    autoMatchRels() {
        const lName = $('jeLeftTable').value;
        const rName = $('jeRightTable').value;
        const lCols = TableRegistry.getCols(lName);
        const rCols = TableRegistry.getCols(rName);

        // Exact match first, then case-insensitive
        const lSet = new Set(lCols);
        const exact = rCols.filter(c => lSet.has(c));
        const lLowerMap = new Map(lCols.map(c => [c.toLowerCase(), c]));
        const caseInsensitive = rCols
            .filter(c => !lSet.has(c) && lLowerMap.has(c.toLowerCase()))
            .map(c => ({ r: c, l: lLowerMap.get(c.toLowerCase()) }));

        const allMatches = [
            ...exact.map(c => ({ l: c, r: c })),
            ...caseInsensitive
        ];

        if(!allMatches.length) {
            // Fuzzy suggestion: find columns with similar names
            const fuzzy = [];
            rCols.forEach(rc => {
                const rcLower = rc.toLowerCase().replace(/[_\-\s]/g, '');
                lCols.forEach(lc => {
                    const lcLower = lc.toLowerCase().replace(/[_\-\s]/g, '');
                    if(rcLower === lcLower && rcLower !== rc.toLowerCase()) {
                        fuzzy.push({ l: lc, r: rc, note: '大小写不同' });
                    }
                });
            });
            if(fuzzy.length) {
                if(!confirm(`未找到完全匹配的字段，但发现 ${fuzzy.length} 个可能匹配（大小写差异）:\n${fuzzy.map(f=>`  ${f.l} ↔ ${f.r}`).join('\n')}\n\n是否使用这些匹配？`)) return;
                this.state.rels = fuzzy.map(f => ({ l: f.l, r: f.r }));
            } else {
                return Toast.show('未找到可匹配字段（包括大小写不敏感和模糊匹配）', true);
            }
        } else {
            const hasExisting = this.state.rels.some(r => r.l || r.r);
            if(hasExisting && !confirm(`找到 ${allMatches.length} 个匹配字段对，将覆盖现有关联条件。继续？`)) return;
            this.state.rels = allMatches.map(m => ({ l: m.l, r: m.r }));
        }
        this.markDirty();
        this.renderRels();
        this.updateAll();
        Toast.show(`已自动匹配 ${this.state.rels.length} 个关联条件`);
    },

    async loadSuggestions(left, right) {
        const box = $('jeKeySuggestions');
        const request = {};
        this._suggestionRequest = request;
        box.textContent = left && right ? '正在比较字段样本…' : '选定两张来源表后可查看推荐。';
        if(!left || !right) return;
        try {
            const suggestions = await TableRegistry.getJoinSuggestions(left,right);
            if(this._suggestionRequest !== request) return;
            if(!suggestions.length) {
                box.textContent = '样本中没有明确的候选，请手动选择匹配字段。';
                return;
            }
            box.replaceChildren();
            for(const item of suggestions) {
                const row = document.createElement('div');
                row.className = 'join-suggestion';
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'sm';
                btn.textContent = `${item.l} = ${item.r}`;
                btn.setAttribute('aria-label', `采用 ${btn.textContent}`);
                btn.dataset.left = item.l;
                btn.dataset.right = item.r;
                btn.onclick = () => this.applySuggestion(item);
                const reason = document.createElement('span');
                reason.textContent = `${item.nameReason} · 共同值 ${item.common} 个 · 左样本重复 ${item.leftDuplicates}/${item.leftSampled} 行，右侧 ${item.rightDuplicates}/${item.rightSampled} 行`;
                row.append(btn,reason);
                box.appendChild(row);
            }
            this.updateSuggestionButtons();
        } catch(error) {
            if(this._suggestionRequest === request) box.textContent = `无法推荐关联键：${error.message}`;
        }
    },
    updateSuggestionButtons() {
        for(const button of $('jeKeySuggestions').querySelectorAll('button')) {
            button.disabled = this.state.rels.some(rel => rel.l === button.dataset.left && rel.r === button.dataset.right);
        }
    },
    applySuggestion({l,r}) {
        const rels = this.state.rels;
        if(rels.some(rel => rel.l === l && rel.r === r)) return;
        let index = rels.findIndex(rel => (!rel.l || rel.l === l) && (!rel.r || rel.r === r));
        if(index < 0) index = rels.length;
        rels[index] = {l,r};
        this.markDirty();
        this.renderRels();
        this.updateAll();
        this.focusRel(index);
    },

    updateRelMeta() {
        const left = $('jeLeftTable').value;
        const right = $('jeRightTable').value;
        const leftCols = TableRegistry.getCols(left);
        const rightCols = TableRegistry.getCols(right);
        this.state.rels.forEach((rel, i) => {
            for(const [side, table] of [['l', left], ['r', right]]) {
                const el = $(`jeRelMeta${side.toUpperCase()}_${i}`);
                const meta = this.getColMeta(table, rel[side]);
                el.textContent = rel[side] && meta.type !== 'empty' && meta.sample !== '-' ? `示例 · ${meta.sample}` : '';
            }
            const swap = $('jeRelContainer').children[i].querySelector('[data-swap]');
            swap.disabled = !rel.l || !rel.r || rel.l === rel.r || !leftCols.includes(rel.r) || !rightCols.includes(rel.l);
        });
    },

    /* ── Validation ── */
    buildOnString(rels) {
        return rels.filter(r => r.l && r.r).map(r => `${r.l}=${r.r}`).join(',');
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
            on: this.buildOnString(this.state.rels),
            select: this.buildSelectString()
        };
    },

    validate() {
        const errors = [];
        const warnings = [];
        const name = $('jeName').value.trim();
        const leftVal = $('jeLeftTable').value;
        const rightVal = $('jeRightTable').value;

        if(!name) errors.push('请填写视图名称');
        if(['__proto__','prototype','constructor'].includes(name)) errors.push('该视图名称不可使用');
        if(name && this.isNameConflict(name, this.state.editIdx)) errors.push('视图名称与已有表/视图冲突');
        if(!leftVal || !rightVal) errors.unshift('请先解析数据，再选择左右表');

        // Validate rels with specific indices
        const incompleteIdxs = [];
        const validRels = [];
        this.state.rels.forEach((r, i) => {
            if(r.l && r.r) validRels.push(i);
            else if(r.l || r.r) incompleteIdxs.push(i + 1);
        });
        if(incompleteIdxs.length) errors.push(`关联条件 #${incompleteIdxs.join(', #')} 字段不完整`);
        if(!validRels.length && !incompleteIdxs.length) errors.push('请选择至少一对匹配字段');

        const leftCols = TableRegistry.getCols(leftVal);
        const rightCols = TableRegistry.getCols(rightVal);
        const staleRels = [];
        this.state.rels.forEach((r, i) => {
            if(r.l && !leftCols.includes(r.l)) staleRels.push(`#${i+1} 左:${r.l}`);
            if(r.r && !rightCols.includes(r.r)) staleRels.push(`#${i+1} 右:${r.r}`);
        });
        if(staleRels.length) errors.push(`关联字段不存在: ${staleRels.join(', ')}`);

        if(this.state.order.length === 0) errors.push('至少选择一个输出列');

        const cfg = this.getCurrentConfig();
        if(name && leftVal && rightVal && Joiner.hasDependencyCycle(cfg, Store.getViews(), TableRegistry.getAvailableRawTables().map(t => t.name))) {
            errors.push('视图依赖会形成循环引用');
        }

        // Dedup warnings
        const headers = this.state.order.map(o => (o.alias || o.col || '').trim()).filter(Boolean);
        const dupeSet = new Set();
        const dupes = headers.filter(h => {
            if(dupeSet.has(h)) return true;
            dupeSet.add(h);
            return false;
        });
        if(dupes.length) {
            const uniqueDupes = Array.from(new Set(dupes));
            warnings.push(`输出列将自动去重: ${uniqueDupes.join(', ')}`);
        }

        return { ok: errors.length === 0, errors, warnings };
    },

    updateSaveState() {
        const {ok, errors, warnings} = this.validate();
        const warn = $('jeWarn');
        warn.textContent = errors[0] || warnings[0] || '可以保存';
        warn.title = [...errors, ...warnings].join('\n');
        warn.className = ok ? (warnings.length ? 'warning' : 'ok') : '';
        $('jeSave').disabled = !ok;
    },
    updateStatus() {
        $('jeStatus').textContent = `${this.state.order.length} 列`;
        $('jePresetEnrich').disabled = !this.state.rels.some(rel => rel.l && rel.r);
        $('jePresetLeft').disabled = !$('jeLeftTable').value;
        $('jePresetRight').disabled = !$('jeRightTable').value;
        this.updateSuggestionButtons();
        $('jeJoinShape').dataset.mode = $('jeType').value;
        $('jeTypeHint').textContent = {
            inner:'仅输出两侧匹配的行', left:'保留左表全部行', right:'保留右表全部行',
            full:'保留两侧全部行', semi:'每条匹配的左表行只输出一次', anti:'仅输出未匹配的左表行'
        }[$('jeType').value] || '';
    },
    renderSample(request, select) {
        if(!request.sample || request.select === select) return;
        request.select = select;
        const box = $('jeSample');
        const projected = Joiner.projectSample(request.sample, select);
        $('jeSampleCount').textContent = projected.headers.length ? `${projected.rows.length} 行` : '';
        if(!projected.headers.length) box.textContent = '勾选输出字段或套用选列组合即可查看样例。';
        else if(!projected.rows.length) box.textContent = '当前关联条件和连接方式没有输出行。';
        else box.replaceChildren(TableBuilder.buildJoinSample(projected));
    },
    async updatePreview() {
        const el = $('jePreview');
        const cfg = this.getCurrentConfig();
        if(!cfg.left || !cfg.right || !cfg.on || this.state.rels.some(r => !!r.l !== !!r.r)) {
            this._statsRequest = null;
            $('jeSampleCount').textContent = '';
            $('jeSample').textContent = '请先选好两侧的匹配字段。';
            el.textContent = cfg.left && cfg.right ? '选好两侧的匹配字段后，将显示输出行数。' : '请先解析数据，再选择参与关联的表。';
            return;
        }
        // Projection, aliases and the draft name do not affect row counts.
        const key = JSON.stringify([Store.revision, TableRegistry.isBackground(), cfg.left, cfg.right, cfg.on, cfg.type]);
        if(this._statsRequest?.key === key) {
            this.renderSample(this._statsRequest,cfg.select);
            return;
        }
        const request = {key};
        this._statsRequest = request;
        $('jeSampleCount').textContent = '';
        $('jeSample').textContent = '正在生成样例…';
        try {
            if(TableRegistry.isBackground()) el.textContent = '正在计算匹配行数…';
            const stats = await TableRegistry.getJoinStats(cfg,{samples:true});
            if(this._statsRequest !== request) return;
            if(!stats) { el.textContent = '无法预览，请检查来源表与关联条件。'; $('jeSample').textContent = ''; return; }
            const metrics = [['输出行数', stats.outRows], ['匹配对数', stats.matched], ['左表未匹配', stats.leftOnly], ['右表未匹配', stats.rightOnly]];
            el.innerHTML = `<dl class="join-metrics">${metrics.map(([label, value]) =>
                `<div><dt>${label}</dt><dd>${value.toLocaleString()}</dd></div>`).join('')}</dl>`;
            request.sample = stats.sample;
            this.renderSample(request,this.buildSelectString());
        } catch(error) {
            if(this._statsRequest === request) {
                el.textContent = `预览失败：${error.message}`;
                $('jeSample').textContent = '';
            }
        }
    },
    updateDependencyInfo() {
        const lName = $('jeLeftTable').value;
        const rName = $('jeRightTable').value;
        const el = $('jeDependency');
        if(!el) return;
        const lView = Store.getViews().find(x => x.view === lName);
        const rView = Store.getViews().find(x => x.view === rName);
        const parts = [];
        if(lView) {
            const stamp = this.formatTime(lView.updatedAt || lView.createdAt);
            parts.push(`<div class="dep-chain"><strong>左表 ${this.escapeHtml(lName)}</strong>: ${this.buildDependencyChain(lName)} · ${stamp || '?'}</div>`);
        } else if(lName) {
            const lCols = TableRegistry.getCols(lName);
            parts.push(`<div class="dep-chain"><strong>左表 ${this.escapeHtml(lName)}</strong>: 原始表 · ${lCols.length} 列</div>`);
        }
        if(rView) {
            const stamp = this.formatTime(rView.updatedAt || rView.createdAt);
            parts.push(`<div class="dep-chain"><strong>右表 ${this.escapeHtml(rName)}</strong>: ${this.buildDependencyChain(rName)} · ${stamp || '?'}</div>`);
        } else if(rName) {
            const rCols = TableRegistry.getCols(rName);
            parts.push(`<div class="dep-chain"><strong>右表 ${this.escapeHtml(rName)}</strong>: 原始表 · ${rCols.length} 列</div>`);
        }
        el.innerHTML = parts.length ? parts.join('') : '<span class="muted">选择左右表查看结构</span>';
    },
    buildDependencyChain(name, seen=new Set(), depth=0) {
        const v = Store.getViews().find(x => x.view === name);
        if(!v) return `<span style="color:var(--success)">${this.escapeHtml(name)}</span>`;
        if(seen.has(name)) return `<span style="color:var(--danger)">${this.escapeHtml(name)} (循环)</span>`;
        const next = new Set(seen); next.add(name);
        const indent = '&nbsp;&nbsp;'.repeat(depth);
        const left = this.buildDependencyChain(v.left, next, depth + 1);
        const right = this.buildDependencyChain(v.right, next, depth + 1);
        return `<b>${this.escapeHtml(name)}</b><br>${indent}├左: ${left}<br>${indent}└右: ${right}`;
    },

    updateAll() {
        this.updateStatus();
        this.updateSaveState();
        this.updatePreview();
    },

    /* ── Table changes ── */
    handleTableChange(side) {
        const sel = side === 'l' ? $('jeLeftTable') : $('jeRightTable');
        const next = sel.value;
        const prev = side === 'l' ? this.state.prevLeft : this.state.prevRight;
        if(next === prev) return;
        const cols = TableRegistry.getCols(next);
        const removedCols = (side === 'l' ? this.state.lSel : this.state.rSel).filter(c => !cols.includes(c));
        const removedRels = this.state.rels.filter(r => {
            const col = side === 'l' ? r.l : r.r;
            return col && !cols.includes(col);
        });

        const applyChange = () => {
            if(side === 'l') this.state.prevLeft = next; else this.state.prevRight = next;
            this.refreshColumns();
            this.markDirty();
        };
        const cancelChange = () => { sel.value = prev; };

        if(removedCols.length || removedRels.length) {
            const colNames = removedCols.map(c => `"${c}"`).join(', ');
            const relNames = removedRels.map(r => `${r.l || '?'}=${r.r || '?'}`).join(', ');
            let msg = `切换表将丢失:\n`;
            if(removedCols.length) msg += `• ${removedCols.length} 个输出列: ${colNames}\n`;
            if(removedRels.length) msg += `• ${removedRels.length} 个关联条件: ${relNames}\n`;
            msg += `\n确定切换吗？`;
            if(!confirm(msg)) { cancelChange(); return; }
        }
        applyChange();
    },

    /* ── Dirty tracking ── */
    setDirty(flag) {
        this.state.dirty = flag;
        $('jeDirty').hidden = !flag;
    },
    markDirty() { this.setDirty(true); },

    /* ── Column refresh ── */
    refreshColumns() {
        const lName = $('jeLeftTable').value;
        const rName = $('jeRightTable').value;
        const lCols = TableRegistry.getCols(lName);
        const rCols = TableRegistry.getCols(rName);

        this.state.lSel = this.state.lSel.filter(c => lCols.includes(c));
        this.state.rSel = this.state.rSel.filter(c => rCols.includes(c));
        this.state.rels.forEach(r => {
            if(r.l && !lCols.includes(r.l)) r.l = '';
            if(r.r && !rCols.includes(r.r)) r.r = '';
        });
        this.syncOrderFromSelections();

        $('jeLSourceName').textContent = lName;
        $('jeRSourceName').textContent = rName;
        this.renderColList('jeLList', lCols, this.state.lSel, 'l');
        this.renderColList('jeRList', rCols, this.state.rSel, 'r');
        this.renderSelectedOrder();
        this.renderRels();
        this.updateDependencyInfo();
        this.loadSuggestions(lName,rName);
        this.updateAll();
    },

    /* ── Name conflict ── */
    isNameConflict(name, excludeIdx=-1) {
        const rawNames = TableRegistry.getAvailableRawTables().map(t => t.name);
        const viewNames = Store.getViews().filter((_,i)=>i!==excludeIdx).map(v => v.view);
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

    /* ── Open / Close / Save ── */
    open(editIdx = -1) {
        const p = $('joinModal'); p.classList.remove('hidden');
        ModalController.activate(p, $('jeName'));
        this._statsRequest = null;
        for(const el of p.querySelectorAll('details')) el.open = el.classList.contains('join-key-suggestions');
        for(const el of p.querySelectorAll('.join-body,.join-result,.join-setup')) el.scrollTop = 0;
        $('jeLSearch').value = '';
        $('jeRSearch').value = '';
        document.body.classList.add('modal-open');
        this.state.editIdx = editIdx;
        this.metaCache = {};
        this.state.selectedOrderIdx = -1;
        const v = editIdx > -1 ? Store.getViews()[editIdx] : { view:'', left:'', right:'', type:'inner', on:'', select:'' };

        $('jeTitle').textContent = editIdx > -1 ? '编辑 JOIN 视图' : '新建 JOIN 视图';
        $('jeName').value = v.view;
        $('jeType').value = v.type;
        $('jeEnabled').checked = editIdx < 0 || Store.getEnabledViews().includes(v.view);

        const availableTables = TableRegistry.getAvailableTables();
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
        const rightOk = setTableValue('jeRightTable', editIdx < 0 ? availableTables[1] : v.right);
        if (!leftOk && v.left) Toast.show(`左表"${v.left}"已不存在，关联条件和输出列可能失效`, true);
        if (!rightOk && v.right) Toast.show(`右表"${v.right}"已不存在，关联条件和输出列可能失效`, true);

        this.state.rels = v.on ? v.on.split(',').map(s => { const p=s.split('='); return {l:p[0].trim(), r:(p[1] || '').trim()}; }) : [];
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

        this.setDirty(false);
        this.refreshColumns();
    },

    close(force=false) {
        if(!force && this.state.dirty) {
            if(!confirm('有未保存修改，确定关闭？')) return;
        }
        this._statsRequest = null;
        $('joinModal').classList.add('hidden');
        this._suggestionRequest = null;
        ModalController.deactivate($('joinModal'));
        document.body.classList.remove('modal-open');
    },

    save() {
        const check = this.validate();
        if(!check.ok) {
            const msg = check.errors.join('\n');
            return alert(`无法保存，请修正以下问题:\n\n${msg}`);
        }

        const base = this.state.editIdx > -1 ? Store.getViews()[this.state.editIdx] : {};
        const nv = {
            ...this.getCurrentConfig(),
            createdAt: base.createdAt || Date.now(),
            updatedAt: Date.now()
        };

        const enabled = Store.getEnabledViews();
        const nextEnabled = enabled.filter(view => view !== base.view || $('jeEnabled').checked)
            .map(view => view === base.view ? nv.view : view);
        if($('jeEnabled').checked && !nextEnabled.includes(nv.view)) nextEnabled.push(nv.view);
        dispatch('view:upsert', { index:this.state.editIdx > -1 ? this.state.editIdx : undefined, view:nv });
        if(enabled.length !== nextEnabled.length || enabled.some((v, i) => v !== nextEnabled[i])) {
            dispatch('view:setEnabled', {enabledViews:nextEnabled});
        }
        if (typeof document !== "undefined" && document.dispatchEvent) document.dispatchEvent(new CustomEvent("ota:joinChanged"));
        if (typeof document !== "undefined" && document.dispatchEvent) document.dispatchEvent(new CustomEvent("ota:joinParseRequested"));
        this.setDirty(false);
        this.close(true);
        Toast.show(this.state.editIdx > -1 ? '视图已更新' : '视图已创建');
    },

    /* ── View Management (delegates to ViewManager) ── */
    modManageViews() { ViewManager.modManageViews(); },
    normalizeView(v) { return ViewManager.normalizeView(v); },
    importViewsFromText(txt) { ViewManager.importViewsFromText(txt); }
};

    return { JoinEditor };
});
