OTA.define('join-editor', ["runtime","store","joiner","exporter","table-registry","modal-controller"], ({$, escapeHtml, formatBytes, Toast}, {Store}, {Joiner}, {Exporter}, {TableRegistry}, {ModalController}) => {
/* Join Editor - v2: improved UX */
const JoinEditor = {
    state: { editIdx: -1, left: null, right: null, rels: [], lSel: [], rSel: [], order: [], dirty: false, initial: null, lOnlySel: false, rOnlySel: false, showL: true, showR: true, prevLeft: null, prevRight: null, titleBase: '', selectedOrderIdx: -1 },
    metaCache: {},
    dragIdx: null,
    _shiftSelecting: false,
    escapeHtml,
    formatBytes,

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
        return `<span class="col-type-icon ${cls}">${letter}</span>`;
    },
    getColMeta(tableName, col) {
        if(!tableName || !col) return { type: 'empty', sample: '-' };
        const key = `${tableName}::${col}`;
        if(this.metaCache[key]) return this.metaCache[key];
        const table = this.getTableData(tableName);
        if(!table) return { type: 'empty', sample: '-' };
        const idx = table.headers.indexOf(col);
        if(idx === -1) return { type: 'empty', sample: '-' };
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
    getTableData(name) {
        const raw = TableRegistry.getRaw().find(t => t.name === name);
        if(raw) return raw;
        const view = Store.state.globalViews.find(v => v.view === name);
        if(view) return Joiner.run(TableRegistry.getRaw(), view, Store.state.globalViews);
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
        const tableName = side === 'l' ? ($('jeLeftTable') && $('jeLeftTable').value) : ($('jeRightTable') && $('jeRightTable').value);
        const list = this.getFilteredCols(side, cols);
        const allCols = cols || [];
        const total = allCols.length;
        const selCount = selected.length;

        // Update count badge
        const badgeId = side === 'l' ? 'jeLCount' : 'jeRCount';
        const badge = $(badgeId);
        if(badge) {
            badge.textContent = `${selCount}/${total}`;
            badge.title = `已选 ${selCount} / 共 ${total} 列`;
        }

        if(!list.length) {
            $(id).innerHTML = '<div style="padding:8px; color:#999;">无匹配字段</div>';
            return;
        }

        const html = list.map((c, fi) => {
            const meta = this.getColMeta(tableName, c);
            const icon = this.typeIcon(meta.type);
            const checked = selected.includes(c);
            return `
            <label class="checkbox-row" data-col="${this.escapeHtml(c)}" data-idx="${fi}">
                <input type="checkbox" data-side="${side}" value="${this.escapeHtml(c)}" ${checked?'checked':''}>
                ${icon}<span>${this.escapeHtml(c)}</span>
            </label>`;
        }).join('');
        $(id).innerHTML = html;

        // Bind checkbox events with shift-click support
        const checkboxes = $(id).querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach((chk, idx) => {
            chk.onchange = () => {
                if(this._shiftSelecting) return;
                this.setSelection(side, chk.value, chk.checked);
            };
            chk.onclick = (e) => {
                if(e.shiftKey && this._lastCheckIdx && this._lastCheckIdx.side === side) {
                    e.preventDefault();
                    this._shiftSelecting = true;
                    const prevIdx = this._lastCheckIdx.idx;
                    const start = Math.min(prevIdx, idx);
                    const end = Math.max(prevIdx, idx);
                    const willCheck = !chk.checked;
                    for(let i = start; i <= end; i++) {
                        if(checkboxes[i]) {
                            checkboxes[i].checked = willCheck;
                            this.setSelection(side, checkboxes[i].value, willCheck, false);
                        }
                    }
                    this._shiftSelecting = false;
                    this.syncOrderFromSelections(TableRegistry.getCols($('jeLeftTable').value), TableRegistry.getCols($('jeRightTable').value));
                    this.renderSelectedOrder();
                    this.updateAll();
                    this.markDirty();
                }
                this._lastCheckIdx = { side, idx };
            };
        });
    },

    /* ── Selection management ── */
    setSelection(side, col, checked, appendToEnd=true) {
        const arr = side === 'l' ? this.state.lSel : this.state.rSel;
        const idx = arr.indexOf(col);
        if(checked) {
            if(idx === -1) arr.push(col);
        } else {
            if(idx > -1) arr.splice(idx,1);
        }
        this.syncOrderFromSelections(TableRegistry.getCols($('jeLeftTable').value), TableRegistry.getCols($('jeRightTable').value), appendToEnd ? {side, col, checked} : null);
        this.renderSelectedOrder();
        this.updateAll();
        this.markDirty();
    },

    toggleAll(side) {
        const cols = this.getFilteredCols(side, TableRegistry.getCols(side === 'l' ? $('jeLeftTable').value : $('jeRightTable').value));
        if(!cols.length) return;
        const selected = side === 'l' ? this.state.lSel : this.state.rSel;
        const allChecked = cols.every(c => selected.includes(c));
        // Batch update: modify array directly, then sync once
        const arr = side === 'l' ? this.state.lSel : this.state.rSel;
        cols.forEach(c => {
            const idx = arr.indexOf(c);
            if(!allChecked && idx === -1) arr.push(c);
            else if(allChecked && idx > -1) arr.splice(idx, 1);
        });
        this.syncOrderFromSelections(TableRegistry.getCols($('jeLeftTable').value), TableRegistry.getCols($('jeRightTable').value));
        this.renderColList(side === 'l' ? 'jeLList' : 'jeRList', TableRegistry.getCols(side === 'l' ? $('jeLeftTable').value : $('jeRightTable').value), side === 'l' ? this.state.lSel : this.state.rSel, side);
        this.renderSelectedOrder();
        this.updateAll();
        this.markDirty();
    },
    selectFiltered(side) {
        const cols = this.getFilteredCols(side, TableRegistry.getCols(side === 'l' ? $('jeLeftTable').value : $('jeRightTable').value));
        if(!cols.length) return;
        // Batch: add all missing at once
        const arr = side === 'l' ? this.state.lSel : this.state.rSel;
        cols.forEach(c => { if(!arr.includes(c)) arr.push(c); });
        this.syncOrderFromSelections(TableRegistry.getCols($('jeLeftTable').value), TableRegistry.getCols($('jeRightTable').value));
        this.renderColList(side === 'l' ? 'jeLList' : 'jeRList', TableRegistry.getCols(side === 'l' ? $('jeLeftTable').value : $('jeRightTable').value), side === 'l' ? this.state.lSel : this.state.rSel, side);
        this.renderSelectedOrder();
        this.updateAll();
        this.markDirty();
    },

    /* ── Order sync ── */
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

    /* ── Order rendering ── */
    renderSelectedOrder() {
        const box = $('jeOrderList'); if(!box) return;
        const visible = this.state.order.filter(o => (o.side === 'l' ? this.state.showL : this.state.showR));
        if(!visible.length) {
            box.innerHTML = '<div style="font-size:11px; color:var(--text-tertiary);">未选择输出列 — 勾选左侧字段列表</div>';
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
                    <span class="join-chip-label" title="${label}">${label}</span>
                    <input class="join-alias" data-idx="${idx}" placeholder="别名" value="${alias}">
                </div>
                <div class="join-chip-actions">
                    <button class="icon-btn sm" data-move="-1" title="上移 (Alt+↑)" style="width:22px; height:22px;">↑</button>
                    <button class="icon-btn sm" data-move="1" title="下移 (Alt+↓)" style="width:22px; height:22px;">↓</button>
                    <button class="icon-btn sm danger" data-remove="1" title="移除" style="width:22px; height:22px;">×</button>
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
                this.renderSelectedOrder();
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
        if(!confirm(`确定清空全部 ${this.state.order.length} 个输出列吗？此操作可撤销（重新勾选字段即可恢复）。`)) return;
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
        const lName = $('jeLeftTable').value;
        const rName = $('jeRightTable').value;
        const lCols = TableRegistry.getCols(lName);
        const rCols = TableRegistry.getCols(rName);
        const lOpts = lCols.map(c=>`<option value="${this.escapeHtml(c)}">${this.escapeHtml(c)}</option>`).join('');
        const rOpts = rCols.map(c=>`<option value="${this.escapeHtml(c)}">${this.escapeHtml(c)}</option>`).join('');

        $('jeRelContainer').innerHTML = this.state.rels.map((r, i) => {
            const valid = r.l && r.r;
            const cardClass = valid ? 'valid' : (r.l || r.r ? 'incomplete' : '');
            return `
            <div class="join-rel-card ${cardClass}" data-idx="${i}">
                <div class="je-row">
                    <select class="je-rel-l" data-idx="${i}" title="左表: ${this.escapeHtml(lName || '?')}">${lOpts || '<option>无字段</option>'}</select>
                    <span style="opacity:0.6; flex-shrink:0;">=</span>
                    <select class="je-rel-r" data-idx="${i}" title="右表: ${this.escapeHtml(rName || '?')}">${rOpts || '<option>无字段</option>'}</select>
                    <button class="icon-btn sm" data-swap="${i}" title="交换左右">⇄</button>
                    <button class="icon-btn sm danger" data-del="${i}" title="删除此条件">×</button>
                </div>
                <div class="rel-meta-row">
                    <span class="rel-meta" id="jeRelMetaL_${i}"></span>
                    <span class="rel-meta" id="jeRelMetaR_${i}"></span>
                </div>
            </div>`;
        }).join('');

        // Set values from state (DOM-to-state sync point)
        const ls = document.querySelectorAll('.je-rel-l');
        const rs = document.querySelectorAll('.je-rel-r');
        this.state.rels.forEach((r, i) => {
            if(ls[i] && r.l && lCols.includes(r.l)) ls[i].value = r.l;
            else if(ls[i]) { ls[i].selectedIndex = 0; r.l = ''; }
            if(rs[i] && r.r && rCols.includes(r.r)) rs[i].value = r.r;
            else if(rs[i]) { rs[i].selectedIndex = 0; r.r = ''; }
        });

        // Bind events - sync DOM → state immediately
        ls.forEach(s => {
            s.onchange = () => {
                const i = +s.dataset.idx;
                this.state.rels[i].l = s.value;
                this.markDirty();
                this.updateRelMeta();
                this.updateAll();
            };
        });
        rs.forEach(s => {
            s.onchange = () => {
                const i = +s.dataset.idx;
                this.state.rels[i].r = s.value;
                this.markDirty();
                this.updateRelMeta();
                this.updateAll();
            };
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

    updateRelMeta() {
        const lName = $('jeLeftTable').value;
        const rName = $('jeRightTable').value;
        this.state.rels.forEach((r, i) => {
            const l = this.getColMeta(lName, r.l);
            const rmeta = this.getColMeta(rName, r.r);
            const lEl = $(`jeRelMetaL_${i}`);
            const rEl = $(`jeRelMetaR_${i}`);
            if(lEl) {
                lEl.textContent = `左: ${l.type==='numeric'?'#':l.type==='date'?'D':l.type==='text'?'T':'-'} ${l.sample}`;
                lEl.className = `rel-meta type-${l.type}`;
            }
            if(rEl) {
                rEl.textContent = `右: ${rmeta.type==='numeric'?'#':rmeta.type==='date'?'D':rmeta.type==='text'?'T':'-'} ${rmeta.sample}`;
                rEl.className = `rel-meta type-${rmeta.type}`;
            }
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

        if(!name) errors.push('❌ 请填写视图名称');
        if(['__proto__','prototype','constructor'].includes(name)) errors.push('❌ 该视图名称不可使用');
        if(name && this.isNameConflict(name, this.state.editIdx)) errors.push('❌ 视图名称与已有表/视图冲突');
        if(!leftVal || !rightVal) errors.push('❌ 请选择左右表');

        // Validate rels with specific indices
        const incompleteIdxs = [];
        const validRels = [];
        this.state.rels.forEach((r, i) => {
            if(r.l && r.r) validRels.push(i);
            else if(r.l || r.r) incompleteIdxs.push(i + 1);
        });
        if(incompleteIdxs.length) errors.push(`❌ 关联条件 #${incompleteIdxs.join(', #')} 字段不完整`);
        if(validRels.length === 0 && this.state.rels.some(r => r.l || r.r)) errors.push(`❌ 关联条件不完整：${incompleteIdxs.length}个条件缺少字段`);
        else if(this.state.rels.length === 0 || (this.state.rels.length === 1 && !this.state.rels[0].l && !this.state.rels[0].r)) errors.push('❌ 至少配置一个关联条件（点击 添加条件 按钮）');

        const leftCols = TableRegistry.getCols(leftVal);
        const rightCols = TableRegistry.getCols(rightVal);
        const staleRels = [];
        this.state.rels.forEach((r, i) => {
            if(r.l && !leftCols.includes(r.l)) staleRels.push(`#${i+1} 左:${r.l}`);
            if(r.r && !rightCols.includes(r.r)) staleRels.push(`#${i+1} 右:${r.r}`);
        });
        if(staleRels.length) errors.push(`❌ 关联字段不存在: ${staleRels.join(', ')}`);

        if(this.state.order.length === 0) errors.push('❌ 至少选择一个输出列');

        const cfg = this.getCurrentConfig();
        if(name && leftVal && rightVal && Joiner.hasDependencyCycle(cfg, Store.state.globalViews, TableRegistry.getRaw().map(t => t.name))) {
            errors.push('❌ 视图依赖会形成循环引用');
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
            warnings.push(`⚠ 输出列将自动去重: ${uniqueDupes.join(', ')}`);
        }

        return { ok: errors.length === 0, errors, warnings };
    },

    updateSaveState() {
        const { ok, errors, warnings } = this.validate();
        const warn = $('jeWarn');
        if(errors.length) {
            // Show first error as summary, full list on hover
            warn.textContent = `⚠ ${errors[0].replace('❌ ','')}${errors.length > 1 ? ` ...共${errors.length}个问题` : ''}`;
            warn.title = errors.join('\n');
            warn.className = 'join-warn error';
        } else if(warnings.length) {
            warn.textContent = `⚠ ${warnings[0].replace('⚠ ','')}`;
            warn.title = warnings.join('\n');
            warn.className = 'join-warn';
        } else {
            warn.textContent = '✓ 可以保存';
            warn.title = '';
            warn.className = 'join-warn ok';
        }
        ['jeSave', 'jeSaveFooter'].forEach(id => { if($(id)) $(id).disabled = !ok; });
    },
    updateStatus() {
        const total = this.state.lSel.length + this.state.rSel.length;
        const el = $('jeStatus');
        if(el) el.textContent = `已选输出列: ${total} (左 ${this.state.lSel.length} · 右 ${this.state.rSel.length})`;
    },
    updatePreview() {
        const cfg = this.getCurrentConfig();
        const hasRel = this.state.rels.some(r => r.l && r.r);
        const el = $('jePreview');
        if(!cfg.left || !cfg.right || !hasRel) { el.textContent = '预览: —'; return; }
        const stats = Joiner.stats(TableRegistry.getRaw(), cfg, Store.state.globalViews);
        if(!stats) { el.textContent = '预览: —'; return; }
        el.textContent = `预览: 输出 ${stats.outRows.toLocaleString()} 行 · 匹配 ${stats.matched.toLocaleString()} · 左未匹配 ${stats.leftOnly.toLocaleString()} · 右未匹配 ${stats.rightOnly.toLocaleString()}`;
    },
    updateDependencyInfo() {
        const lName = $('jeLeftTable').value;
        const rName = $('jeRightTable').value;
        const el = $('jeDependency');
        if(!el) return;
        const lView = Store.state.globalViews.find(x => x.view === lName);
        const rView = Store.state.globalViews.find(x => x.view === rName);
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
        const v = Store.state.globalViews.find(x => x.view === name);
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
        this.updateDependencyInfo();
    },

    /* ── Table change handling (inline confirm, not modal-on-modal) ── */
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
        const title = this.state.titleBase || '全局视图';
        $('jeTitle').textContent = flag ? `${title} *` : title;
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
        this.syncOrderFromSelections(lCols, rCols);

        this.renderColList('jeLList', lCols, this.state.lSel, 'l');
        this.renderColList('jeRList', rCols, this.state.rSel, 'r');
        this.renderSelectedOrder();
        this.renderRels();
        this.updateRelMeta();
        this.updateAll();
    },

    /* ── Name conflict ── */
    isNameConflict(name, excludeIdx=-1) {
        const rawNames = TableRegistry.getRaw().map(t => t.name);
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

    /* ── Open / Close / Save ── */
    open(editIdx = -1) {
        const p = $('joinModal'); p.classList.remove('hidden');
        document.body.classList.add('modal-open');
        this.state.editIdx = editIdx;
        this.metaCache = {};
        this.state.selectedOrderIdx = -1;
        const v = editIdx > -1 ? Store.state.globalViews[editIdx] : { view:'', left:'', right:'', type:'inner', on:'', select:'' };

        this.state.titleBase = editIdx > -1 ? '编辑全局视图' : '新增全局视图';
        $('jeTitle').textContent = this.state.titleBase;
        $('jeName').value = v.view;
        $('jeType').value = v.type;

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
        const rightOk = setTableValue('jeRightTable', v.right);
        if (!leftOk && v.left) Toast.show(`左表"${v.left}"已不存在，关联条件和输出列可能失效`, true);
        if (!rightOk && v.right) Toast.show(`右表"${v.right}"已不存在，关联条件和输出列可能失效`, true);

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

    save() {
        // Ensure rels state is synced from DOM
        document.querySelectorAll('.je-rel-l').forEach((s,i) => { if(this.state.rels[i]) this.state.rels[i].l = s.value; });
        document.querySelectorAll('.je-rel-r').forEach((s,i) => { if(this.state.rels[i]) this.state.rels[i].r = s.value; });

        const check = this.validate();
        if(!check.ok) {
            const msg = check.errors.map(e => e.replace('❌ ','• ')).join('\n');
            return alert(`无法保存，请修正以下问题:\n\n${msg}`);
        }

        const name = $('jeName').value.trim();
        const onStr = this.buildOnString(this.state.rels);
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
        if (typeof document !== "undefined" && document.dispatchEvent) document.dispatchEvent(new CustomEvent("ota:joinChanged"));
        if (typeof document !== "undefined" && document.dispatchEvent) document.dispatchEvent(new CustomEvent("ota:joinParseRequested"));
        this.setDirty(false);
        $('joinModal').classList.add('hidden');
        document.body.classList.remove('modal-open');
        Toast.show(this.state.editIdx > -1 ? '视图已更新' : '视图已创建');
    },

    /* ── View Management ── */
    modManageViews() {
        const vs = Store.state.globalViews;
        const getFieldCount = (select) => (select || '').split(',').filter(Boolean).length;
        const joinTypeLabel = { inner:'Inner', left:'Left', right:'Right', full:'Full', semi:'Semi', anti:'Anti' };
        let sortBy = 'name'; // 'name' | 'time'

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

            // Sort
            if(sortBy === 'time') {
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
                const stamp = this.formatTime(v.updatedAt || v.createdAt);
                const fieldCount = getFieldCount(v.select);
                const joinLabel = joinTypeLabel[v.type] || 'Inner';
                const meta = `${joinLabel} · ${v.left} ⟕ ${v.right} · ${fieldCount}列${stamp ? ' · '+stamp : ''}`;

                return `
                <div class="view-item" data-index="${i}" style="display:flex; justify-content:space-between; align-items:center; padding:10px; border:1px solid var(--border-light); margin-bottom:8px; border-radius:6px; background:var(--bg-card);">
                    <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0;">
                        <input type="checkbox" class="view-checkbox" data-index="${i}" style="flex-shrink:0;">
                        <div style="min-width:0; flex:1;">
                            <div style="font-weight:600; color:var(--primary); margin-bottom:2px;">${this.escapeHtml(v.view)}</div>
                            <div style="font-size:11px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${this.escapeHtml(meta)}">${this.escapeHtml(meta)}</div>
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
        if(searchInput) {
            searchInput.oninput = () => {
                const filterText = searchInput.value.trim();
                $('viewList').innerHTML = renderList(filterText);
                this.bindViewActions(vs);
                updateBatchButtons();
            };
        }

        // Sort
        const sortSelect = $('jeViewSort');
        if(sortSelect) {
            sortSelect.onchange = () => {
                sortBy = sortSelect.value;
                $('viewList').innerHTML = renderList(searchInput ? searchInput.value.trim() : '');
                this.bindViewActions(vs);
                updateBatchButtons();
            };
        }

        const selectAllCheckbox = $('jeViewSelectAll');
        if(selectAllCheckbox) {
            selectAllCheckbox.onchange = () => {
                document.querySelectorAll('.view-checkbox').forEach(cb => { cb.checked = selectAllCheckbox.checked; });
                updateBatchButtons();
            };
        }

        const updateBatchButtons = () => {
            const selectedCount = document.querySelectorAll('.view-checkbox:checked').length;
            const batchDeleteBtn = $('jeBatchDelete');
            const batchExportBtn = $('jeBatchExport');
            if(batchDeleteBtn) batchDeleteBtn.disabled = selectedCount === 0;
            if(batchExportBtn) batchExportBtn.disabled = selectedCount === 0;
        };

        const batchDeleteBtn = $('jeBatchDelete');
        if(batchDeleteBtn) {
            batchDeleteBtn.onclick = () => {
                const selectedCbs = document.querySelectorAll('.view-checkbox:checked');
                if(selectedCbs.length === 0) return;
                const indices = Array.from(selectedCbs).map(cb => parseInt(cb.dataset.index)).sort((a,b) => b-a);
                if(!confirm(`确定删除选中的 ${indices.length} 个视图吗？此操作不可恢复。`)) return;
                indices.forEach(idx => Store.state.globalViews.splice(idx, 1));
                Store.save();
                if (typeof document !== "undefined" && document.dispatchEvent) document.dispatchEvent(new CustomEvent("ota:joinChanged"));
                if (typeof document !== "undefined" && document.dispatchEvent) document.dispatchEvent(new CustomEvent("ota:joinParseRequested"));
                this.modManageViews();
                Toast.show(`已删除 ${indices.length} 个视图`);
            };
        }

        const batchExportBtn = $('jeBatchExport');
        if(batchExportBtn) {
            batchExportBtn.onclick = () => {
                const selectedCbs = document.querySelectorAll('.view-checkbox:checked');
                if(selectedCbs.length === 0) return;
                const selectedViews = Array.from(selectedCbs).map(cb => Store.state.globalViews[parseInt(cb.dataset.index)]);
                Exporter.toJson({ kind: 'join-views', views: selectedViews }, `join_views_${Date.now()}`);
                Toast.show(`已导出 ${selectedViews.length} 个视图`);
            };
        }

        this.bindViewActions = (views) => {
            views.forEach((v, i) => {
                const editBtn = $(`jeEdit_${i}`);
                const copyBtn = $(`jeCopy_${i}`);
                const exportBtn = $(`jeExport_${i}`);
                const delBtn = $(`jeDel_${i}`);
                const delCancelBtn = $(`jeDelCancel_${i}`);
                const delOkBtn = $(`jeDelOk_${i}`);
                const checkbox = document.querySelector(`.view-checkbox[data-index="${i}"]`);

                if(editBtn) editBtn.onclick = () => { $('modalOverlay').classList.add('hidden'); this.open(i); };
                if(copyBtn) copyBtn.onclick = () => {
                    const name = this.makeUniqueName(`${v.view}_copy`);
                    Store.state.globalViews.push({ ...v, view: name, createdAt: Date.now(), updatedAt: Date.now() });
                    Store.save();
                    if (typeof document !== "undefined" && document.dispatchEvent) document.dispatchEvent(new CustomEvent("ota:joinChanged"));
                    this.modManageViews();
                    Toast.show('视图已复制');
                };
                if(exportBtn) exportBtn.onclick = () => Exporter.toJson({ kind: 'join-view', view: v }, `join_${v.view}`);
                if(delBtn) delBtn.onclick = () => {
                    $(`jeActions_${i}`).style.display = 'none';
                    $(`jeConfirm_${i}`).style.display = 'inline-flex';
                };
                if(delCancelBtn) delCancelBtn.onclick = () => {
                    $(`jeActions_${i}`).style.display = 'inline-flex';
                    $(`jeConfirm_${i}`).style.display = 'none';
                };
                if(delOkBtn) delOkBtn.onclick = () => {
                    Store.state.globalViews.splice(i, 1);
                    Store.save();
                    if (typeof document !== "undefined" && document.dispatchEvent) document.dispatchEvent(new CustomEvent("ota:joinChanged"));
                    this.modManageViews();
                    if (typeof document !== "undefined" && document.dispatchEvent) document.dispatchEvent(new CustomEvent("ota:joinParseRequested"));
                };
                if(checkbox) checkbox.onchange = updateBatchButtons;
            });
        };

        this.bindViewActions(vs);

        $('jeAddNew').onclick = () => { $('modalOverlay').classList.add('hidden'); this.open(-1); };
        const pasteBtn = $('jePasteBtn');
        if(pasteBtn) pasteBtn.onclick = () => this.importViewsFromText($('jePaste').value || '');
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
        try { data = JSON.parse(raw); } catch(e) { return alert('JSON格式错误: ' + e.message); }
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
                if(confirm(`视图 "${nv.view}" 已存在，是否覆盖？\n确定=覆盖 | 取消=自动改名`)) {
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
            Store.save(); if (typeof document !== "undefined" && document.dispatchEvent) document.dispatchEvent(new CustomEvent("ota:joinChanged")); if (typeof document !== "undefined" && document.dispatchEvent) document.dispatchEvent(new CustomEvent("ota:joinParseRequested")); this.modManageViews();
            Toast.show(`已导入 ${imported} 个视图`);
        }
    }
};

    return { JoinEditor };
});
