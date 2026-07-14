OTA.define('selection', ["runtime","store","clipboard"], ({$ , Toast}, {Store}, {ClipboardFormatter}) => {
/* Selection Logic */
const Select = {
    start: null, end: null, active: false, tableEl: null, lastPointer: null, autoScrollRaf: null,
    init() {
        const p = $('previewArea');
        p.addEventListener('mousedown', e => {
            const td = e.target.closest('td');
            if(!td || td.classList.contains('row-header-cell') || td.classList.contains('editing')) { this.clear(); return; }
            if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
            this.active = true;
            this.tableEl = td.closest('table');
            this.lastPointer = { x:e.clientX, y:e.clientY };
            this.start = this.end = this.getCoord(td);
            this.draw();
            this.startAutoScroll();
            e.preventDefault();
        });
        document.addEventListener('mousemove', e => {
            if(!this.active) return;
            this.lastPointer = { x:e.clientX, y:e.clientY };
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const td = el && el.closest ? el.closest('td') : null;
            if(td && this.tableEl && td.closest('table') === this.tableEl && !td.classList.contains('row-header-cell')) {
                const next = this.getCoord(td);
                if(next.idx === this.start.idx) { this.end = next; this.draw(); }
            }
        });
        document.addEventListener('mouseup', () => {
            this.active=false;
            this.stopAutoScroll();
        });
        document.addEventListener('copy', e => { if(this.start && this.end) { e.preventDefault(); this.copy(e); } });
        document.addEventListener('keydown', e => {
            if(!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') return;
            const tag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
            if(['input','textarea','select'].includes(tag) || (document.activeElement && document.activeElement.isContentEditable)) return;
            const table = this.tableEl || (this.start ? document.querySelector(`table[data-idx="${this.start.idx}"]`) : null);
            if(!table) return;
            e.preventDefault();
            this.selectAll(table);
        });
    },
    getCoord(td) {
        return {
            idx: +td.closest('table').dataset.idx,
            r: +(td.dataset.vr ?? td.dataset.r),
            c: +(td.dataset.vc ?? td.dataset.c)
        };
    },
    findVisualCell(tbl, r, c) { return tbl.querySelector(`td[data-vr="${r}"][data-vc="${c}"]`); },
    getBounds(tbl) {
        const cells = Array.from(tbl.querySelectorAll('tbody td:not(.row-header-cell)'));
        if(!cells.length) return null;
        const coords = cells.map(td => this.getCoord(td));
        return {
            minR: Math.min(...coords.map(c => c.r)),
            maxR: Math.max(...coords.map(c => c.r)),
            minC: Math.min(...coords.map(c => c.c)),
            maxC: Math.max(...coords.map(c => c.c)),
            idx: +(tbl.dataset.idx || 0)
        };
    },
    selectAll(tbl=this.tableEl) {
        const bounds = tbl && this.getBounds(tbl);
        if(!bounds) return false;
        this.tableEl = tbl;
        this.start = { idx: bounds.idx, r: bounds.minR, c: bounds.minC };
        this.end = { idx: bounds.idx, r: bounds.maxR, c: bounds.maxC };
        this.draw();
        return true;
    },
    draw() {
        document.querySelectorAll('.selected-cell').forEach(e=>e.classList.remove('selected-cell'));
        if(!this.start) return;
        const tbl = document.querySelector(`table[data-idx="${this.start.idx}"]`); if(!tbl) return;
        const minR=Math.min(this.start.r,this.end.r), maxR=Math.max(this.start.r,this.end.r);
        const minC=Math.min(this.start.c,this.end.c), maxC=Math.max(this.start.c,this.end.c);
        for(let r=minR; r<=maxR; r++) {
            for(let c=minC; c<=maxC; c++) {
                const td = this.findVisualCell(tbl, r, c);
                if(td) td.classList.add('selected-cell');
            }
        }
    },
    clear() { this.start=null; this.end=null; this.tableEl=null; this.stopAutoScroll(); this.draw(); },
    startAutoScroll() {
        if(this.autoScrollRaf) return;
        const tick = () => {
            if(!this.active || !this.tableEl || !this.lastPointer) { this.autoScrollRaf = null; return; }
            const pointer = this.lastPointer;
            const table = this.tableEl;
            const tr = table.getBoundingClientRect();
            const edge = 36;
            let dx = 0;
            if(pointer.x > tr.right - edge) dx = Math.min(34, Math.ceil((pointer.x - (tr.right - edge)) / 2));
            else if(pointer.x < tr.left + edge) dx = -Math.min(34, Math.ceil(((tr.left + edge) - pointer.x) / 2));
            if(dx) table.scrollLeft += dx;

            const preview = $('previewArea');
            if(preview) {
                const pr = preview.getBoundingClientRect();
                let dy = 0;
                if(pointer.y > pr.bottom - edge) dy = Math.min(28, Math.ceil((pointer.y - (pr.bottom - edge)) / 2));
                else if(pointer.y < pr.top + edge) dy = -Math.min(28, Math.ceil(((pr.top + edge) - pointer.y) / 2));
                if(dy) preview.scrollTop += dy;
            }
            this.autoScrollRaf = requestAnimationFrame(tick);
        };
        this.autoScrollRaf = requestAnimationFrame(tick);
    },
    stopAutoScroll() {
        if(this.autoScrollRaf) cancelAnimationFrame(this.autoScrollRaf);
        this.autoScrollRaf = null;
    },
    getColumnHeaderText(tbl, c) {
        const ths = tbl.querySelectorAll('thead th');
        return ths[c] ? ths[c].textContent : '';
    },
    getRowHeaderColumnText(tbl, c) {
        const ths = tbl.querySelectorAll('thead th');
        return ths[c + 1] ? ths[c + 1].textContent : `Row ${c + 1}`;
    },
    getRowHeaderText(tbl, r) {
        const direct = tbl.querySelectorAll('tbody tr')[r];
        const cell = direct && direct.querySelector('.row-header-cell');
        return cell ? cell.textContent : `字段 ${r + 1}`;
    },
    buildClipboardMatrix(tbl, minR, maxR, minC, maxC) {
        const mode = tbl.dataset.viewMode || 'column-header';
        if(mode === 'row-header') {
            const header = ['字段'];
            for(let c=minC; c<=maxC; c++) header.push(this.getRowHeaderColumnText(tbl, c));
            const matrix = [header];
            for(let r=minR; r<=maxR; r++) {
                const row = [this.getRowHeaderText(tbl, r)];
                for(let c=minC; c<=maxC; c++) {
                    const td = this.findVisualCell(tbl, r, c);
                    row.push(td ? td.textContent : '');
                }
                matrix.push(row);
            }
            return matrix;
        }
        const header = [];
        for(let c=minC; c<=maxC; c++) header.push(this.getColumnHeaderText(tbl, c));
        const matrix = [header];
        for(let r=minR; r<=maxR; r++) {
            const row = [];
            for(let c=minC; c<=maxC; c++) {
                const td = this.findVisualCell(tbl, r, c);
                row.push(td ? td.textContent : '');
            }
            matrix.push(row);
        }
        return matrix;
    },
    copy(e) {
        const tbl = document.querySelector(`table[data-idx="${this.start.idx}"]`);
        if(!tbl) return;
        const minR=Math.min(this.start.r,this.end.r), maxR=Math.max(this.start.r,this.end.r);
        const minC=Math.min(this.start.c,this.end.c), maxC=Math.max(this.start.c,this.end.c);
        const matrix = this.buildClipboardMatrix(tbl, minR, maxR, minC, maxC);
        const format = Store.state.copyFormat || 'default';
        e.clipboardData.setData('text/html', ClipboardFormatter.toHtml(matrix));
        e.clipboardData.setData('text/plain', ClipboardFormatter.toText(matrix, format));
        Toast.show(`已复制 ${Math.max(0, matrix.length - 1)} 行 · ${ClipboardFormatter.label(format)}`);
    }
};

    return { Select };
});
