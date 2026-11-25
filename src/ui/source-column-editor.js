OTA.define('source-column-editor', ["runtime"], ({Toast}) => {
// Chunk at hard newlines so browser text ranges stay local. Unwrapped blocks
// have a known height and only need text nodes when the selection reaches them.
function buildLineBlocks(parent, text, unwrappedLineHeight = 0) {
    const fragment = document.createDocumentFragment();
    let firstLine = 1;
    for (let start = 0; start <= text.length;) {
        const newline = text.indexOf('\n', start + 16384);
        const end = newline < 0 ? text.length : newline;
        const block = document.createElement('div');
        block.dataset.start = start;
        block.dataset.firstLine = firstLine;
        let lines = 1;
        for (let i = text.indexOf('\n', start); i >= 0 && i < end; i = text.indexOf('\n', i + 1)) lines++;
        if (unwrappedLineHeight) block.style.height = (lines * unwrappedLineHeight) + 'px';
        else block.textContent = text.slice(start, end) + '\n';
        fragment.appendChild(block);
        firstLine += lines;
        start = end + 1;
    }
    parent.replaceChildren(fragment);
}

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function layer(parent, className) {
    const el = document.createElement('div');
    el.className = className;
    parent.appendChild(el);
    return el;
}

// Measure actual browser glyphs and soft wraps. The invisible probe is only
// hit-testable during a synchronous lookup. Moving its text under a fixed
// viewport point also allows measurement of rows outside the textarea.
function createLayout(input) {
    const overlay = layer(input.parentElement, 'column-overlay');
    overlay.setAttribute('aria-hidden', 'true');
    const probe = layer(overlay, 'column-probe');
    const page = layer(probe, 'column-text');
    const marks = layer(overlay, 'column-marks');
    const status = layer(input.parentElement, 'visually-hidden');
    status.setAttribute('role', 'status');
    const style = getComputedStyle(input);
    const height = parseFloat(style.lineHeight);
    const padX = parseFloat(style.paddingLeft), padY = parseFloat(style.paddingTop);
    Object.assign(page.style, {
        position:'absolute', left:'0', top:'0', font:style.font, lineHeight:style.lineHeight,
        tabSize:style.tabSize, letterSpacing:style.letterSpacing, whiteSpace:style.whiteSpace,
        overflowWrap:style.overflowWrap, wordBreak:style.wordBreak
    });
    let text;
    function sync(refreshText = false) {
        Object.assign(overlay.style, {
            left:(input.offsetLeft + input.clientLeft) + 'px', top:(input.offsetTop + input.clientTop) + 'px',
            width:input.clientWidth + 'px', height:input.clientHeight + 'px'
        });
        const width = input.clientWidth - padX - parseFloat(style.paddingRight);
        page.style.width = (input.wrap === 'off' ? Math.max(width, input.scrollWidth) : width) + 'px';
        if (refreshText) {
            text = input.value;
            buildLineBlocks(page, text, input.wrap === 'off' ? height : 0);
        }
    }
    function blockAt(value, position) {
        const blocks = page.children;
        let lo = 0, hi = blocks.length - 1;
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            if (position(blocks[mid]) <= value) lo = mid;
            else hi = mid - 1;
        }
        const block = blocks[lo];
        if (!block.firstChild) {
            const end = lo < blocks.length - 1 ? Number(blocks[lo + 1].dataset.start) - 1 : text.length;
            block.textContent = text.slice(Number(block.dataset.start), end) + '\n';
        }
        return block;
    }
    function point(clientX, clientY) {
        const rect = overlay.getBoundingClientRect();
        const x = clamp(clientX - rect.left, 0, rect.width) + input.scrollLeft - padX;
        const y = clamp(clientY - rect.top, 0, rect.height) + input.scrollTop - padY;
        return {x:Math.max(0, x), row:clamp(Math.floor(y / height), 0, lastRow())};
    }
    function lastRow() { return Math.max(0, Math.round(page.getBoundingClientRect().height / height) - 1); }
    function offset(row, x) {
        const y = (row + .5) * height;
        const block = blockAt(y, el => el.offsetTop);
        const box = probe.getBoundingClientRect();
        const cx = (Math.max(box.left, 0) + Math.min(box.right, window.innerWidth)) / 2;
        const cy = (Math.max(box.top, 0) + Math.min(box.bottom, window.innerHeight)) / 2;
        const px = clamp(x, 0, page.offsetWidth - .1);
        page.style.transform = 'translate(' + (cx - box.left - px) + 'px,' + (cy - box.top - y) + 'px)';
        probe.style.pointerEvents = 'auto';
        try {
            const pos = document.caretPositionFromPoint?.(cx, cy);
            const range = pos ? null : document.caretRangeFromPoint?.(cx, cy);
            const node = pos?.offsetNode || range?.startContainer;
            if (node !== block.firstChild) return null;
            return Number(block.dataset.start) + Math.min(pos?.offset ?? range.startOffset, node.length - 1);
        } finally {
            probe.style.pointerEvents = '';
        }
    }
    function location(at) {
        const block = blockAt(at, el => Number(el.dataset.start));
        const range = document.createRange();
        range.setStart(block.firstChild, at - Number(block.dataset.start));
        range.collapse(true);
        const box = range.getBoundingClientRect(), origin = page.getBoundingClientRect();
        return {x:box.left - origin.left, row:Math.floor((box.top + box.height / 2 - origin.top) / height)};
    }
    function paint(ranges) {
        const fragment = document.createDocumentFragment();
        for (const {start, end} of ranges) {
            const block = blockAt(start, el => Number(el.dataset.start));
            const last = blockAt(end, el => Number(el.dataset.start));
            const range = document.createRange();
            range.setStart(block.firstChild, start - Number(block.dataset.start));
            range.setEnd(last.firstChild, end - Number(last.dataset.start));
            const origin = page.getBoundingClientRect();
            for (const rect of range.getClientRects()) {
                const mark = document.createElement('div');
                mark.className = start === end ? 'column-mark caret' : 'column-mark';
                const row = Math.floor((rect.top + rect.height / 2 - origin.top) / height);
                Object.assign(mark.style, {left:(rect.left - origin.left + padX - input.scrollLeft) + 'px',
                    top:(row * height + padY - input.scrollTop) + 'px', width:Math.max(rect.width, 1.5) + 'px', height:height + 'px'});
                fragment.appendChild(mark);
            }
        }
        marks.replaceChildren(fragment);
    }
    sync(true);
    return {
        sync, point, offset, location, paint, lastRow, status,
        remove() { overlay.remove(); status.remove(); },
        visible() {
            const first = Math.floor((input.scrollTop - padY) / height);
            const last = Math.floor((input.scrollTop + input.clientHeight - padY) / height);
            return [Math.max(0, first), Math.min(lastRow(), last)];
        }
    };
}

function bindColumnEditor(input, maxBytes) {
    let layout, anchor, end, selection, edited, pointer, frame, lastPointer;
    let composition, writing = false, publishedText, publication;
    function release() {
        if (pointer != null && input.hasPointerCapture(pointer)) input.releasePointerCapture(pointer);
        pointer = null;
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
    }
    function clear() {
        if (!layout) return;
        release();
        layout.remove();
        layout = selection = composition = publishedText = null;
        edited = false;
        input.classList.remove('column-editing');
    }
    function ranges(first = 0, last = layout.lastRow()) {
        if (selection) {
            if (first === 0 && last === layout.lastRow()) return selection;
            const low = layout.offset(first, 0), high = layout.offset(last, Infinity);
            return selection.filter(r => r.start <= high && r.end >= low);
        }
        const result = [];
        for (let row = Math.max(first, Math.min(anchor.row, end.row)); row <= Math.min(last, Math.max(anchor.row, end.row)); row++) {
            const left = layout.offset(row, anchor.x), right = layout.offset(row, end.x);
            if (left == null || right == null) return [];
            result.push({start:Math.min(left, right), end:Math.max(left, right)});
        }
        return result;
    }
    function draw() {
        if (!layout || composition) return;
        layout.sync();
        layout.paint(ranges(...layout.visible()));
    }
    function finishSelection() {
        // Keep the chosen text even if the viewport subsequently rewraps.
        selection = ranges();
        const at = layout.offset(end.row, end.x);
        if (!selection.length || at == null) { clear(); return; }
        input.setSelectionRange(at, at);
        layout.status.textContent = '已选择 ' + (Math.abs(end.row - anchor.row) + 1) + ' 行，可直接列编辑。';
    }
    function begin() {
        clear();
        input.focus({preventScroll:true});
        layout = createLayout(input);
        input.classList.add('column-editing');
    }
    function drag() {
        frame = 0;
        const {x, y} = lastPointer;
        const box = input.getBoundingClientRect();
        const dx = x - clamp(x, box.left, box.left + input.clientWidth);
        const dy = y - clamp(y, box.top, box.top + input.clientHeight);
        if (dx || dy) input.scrollBy(clamp(dx, -40, 40), clamp(dy, -40, 40));
        end = layout.point(x, y);
        draw();
        if (dx || dy) frame = requestAnimationFrame(drag);
    }
    input.addEventListener('pointerdown', e => {
        clear();
        if (!e.altKey || e.button !== 0 || e.pointerType !== 'mouse' || input.readOnly || input.disabled) return;
        e.preventDefault();
        begin();
        pointer = e.pointerId;
        input.setPointerCapture(pointer);
        anchor = end = layout.point(e.clientX, e.clientY);
        const at = layout.offset(anchor.row, anchor.x);
        if (at != null) input.setSelectionRange(at, at);
        draw();
    });
    input.addEventListener('pointermove', e => {
        if (e.pointerId !== pointer) return;
        lastPointer = {x:e.clientX, y:e.clientY};
        if (frame) cancelAnimationFrame(frame);
        drag();
    });
    input.addEventListener('pointerup', e => {
        if (e.pointerId !== pointer) return;
        end = layout.point(e.clientX, e.clientY);
        release();
        draw();
        finishSelection();
    });
    input.addEventListener('lostpointercapture', e => { if (e.pointerId === pointer) clear(); });
    input.addEventListener('blur', clear);
    input.addEventListener('scroll', draw);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(draw).observe(input);

    const segmenter = new Intl.Segmenter(undefined, {granularity:'grapheme'});
    function adjacent(text, at, back) {
        const index = back ? at - 1 : at;
        if (index < 0 || index >= text.length || text[index] === '\n') return at;
        const start = text.lastIndexOf('\n', index) + 1;
        const newline = text.indexOf('\n', index);
        const line = text.slice(start, newline < 0 ? text.length : newline);
        const part = segmenter.segment(line).containing(index - start);
        return start + part.index + (back ? 0 : part.segment.length);
    }
    function edit(values, deletion) {
        const selected = ranges();
        if (!selected.length) return;
        if (values.length === selected.length + 1 && values.at(-1) === '') values = values.slice(0, -1);
        if (values.length > 1 && values.length !== selected.length) {
            Toast.show('请粘贴一行文字，或粘贴与列选区行数相同的文字。', true);
            return;
        }
        const text = input.value;
        const pieces = [], next = [];
        const deleteNeighbor = deletion && (edited || anchor.x === end.x);
        let delta = 0, previous, first;
        for (let i = 0; i < selected.length; i++) {
            let {start, end} = selected[i];
            if (start === end && deleteNeighbor) {
                if (deletion === 'back') start = adjacent(text, start, true);
                else end = adjacent(text, end, false);
            }
            // Two visual rows can meet at the same soft-wrap boundary.
            if (previous != null && start < previous) start = previous;
            end = Math.max(end, start);
            if (previous != null) pieces.push(text.slice(previous, start));
            else first = start;
            const value = values.length === 1 ? values[0] : values[i];
            pieces.push(value);
            delta += value.length - (end - start);
            const at = end + delta;
            next.push({start:at, end:at});
            previous = end;
        }
        if ((text.length + delta) * 2 > maxBytes) {
            Toast.show('列编辑后原文会超过 128 MiB 安全限制。', true);
            return;
        }
        const replacement = pieces.join('');
        const top = input.scrollTop, left = input.scrollLeft;
        if (text.slice(first, previous) !== replacement) {
            writing = true;
            try {
                // One native edit keeps the complete rectangle in textarea undo history.
                input.setSelectionRange(first, previous);
                if (!document.execCommand(replacement ? 'insertText' : 'delete', false, replacement)) {
                    input.setRangeText(replacement, first, previous, 'end');
                }
            } finally { writing = false; }
            // Engines may deliver several input events for one multiline
            // command, including after beforeinput returns. Publish once.
            publishedText = input.value;
            publication = new Event('input', {bubbles:true});
            input.dispatchEvent(publication);
            publication = null;
        }
        if (!layout) return; // The inline editor may have become a read-only large-source preview.
        selection = next;
        edited = true;
        layout.sync(true);
        const lead = end.row < anchor.row ? next[0] : next[next.length - 1];
        input.setSelectionRange(lead.end, lead.end);
        input.scrollTo(left, top);
        draw();
    }
    input.addEventListener('keydown', e => {
        if (e.isComposing || e.key === 'Process') return;
        if (e.altKey && e.shiftKey && e.key.startsWith('Arrow') && !input.readOnly && !input.disabled) {
            e.preventDefault();
            e.stopPropagation();
            if (!layout || edited) {
                begin();
                anchor = end = layout.location(input.selectionEnd);
            }
            selection = null;
            const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
            if (step) end = {...end, row:clamp(end.row + step, 0, layout.lastRow())};
            else {
                const at = layout.offset(end.row, end.x);
                if (at != null) end = layout.location(adjacent(input.value, at, e.key === 'ArrowLeft'));
            }
            finishSelection();
            draw();
            return;
        }
        if (!layout) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); clear(); return; }
        if (!e.ctrlKey && !e.metaKey && !e.altKey && ['Delete','Backspace'].includes(e.key)) {
            e.preventDefault();
            edit([''], e.key === 'Backspace' ? 'back' : 'forward');
            return;
        }
        if (e.ctrlKey || e.metaKey) {
            if (!['control','meta','shift','c','x','v'].includes(e.key.toLowerCase())) clear();
        } else if (/^(Arrow|Home$|End$|Page|Tab$)/.test(e.key)) clear();
    });
    input.addEventListener('beforeinput', e => {
        if (!layout || writing || e.isComposing || composition) return;
        if (e.inputType === 'insertText' || e.inputType === 'insertLineBreak') {
            e.preventDefault();
            edit([e.inputType === 'insertLineBreak' ? '\n' : e.data || '']);
        } else if (['deleteContentBackward','deleteContentForward'].includes(e.inputType)) {
            e.preventDefault();
            edit([''], e.inputType === 'deleteContentBackward' ? 'back' : 'forward');
        } else clear();
    });
    input.addEventListener('paste', e => {
        if (!layout || !e.clipboardData) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.clipboardData.types.includes('text/plain')) {
            const count = selection?.length ?? Math.abs(anchor.row - end.row) + 1;
            edit(e.clipboardData.getData('text/plain').split(/\r\n?|\n/, count + 2));
        }
    }, true);
    for (const type of ['copy', 'cut']) input.addEventListener(type, e => {
        if (!layout || !e.clipboardData) return;
        const text = input.value, selected = ranges();
        e.clipboardData.setData('text/plain', selected.map(r => text.slice(r.start, r.end)).join('\n'));
        e.preventDefault();
        if (type === 'cut') edit(['']);
    });
    input.addEventListener('compositionstart', () => {
        if (layout) composition = {text:input.value, at:input.selectionStart};
    });
    input.addEventListener('input', e => {
        if (e === publication) return;
        if (composition || writing || (layout && publishedText === input.value)) e.stopImmediatePropagation();
        else clear();
    }, true);
    input.addEventListener('compositionend', e => {
        if (!composition) return;
        const {text, at} = composition;
        if (input.value !== text) {
            document.execCommand('undo');
            if (input.value !== text) input.value = text;
            input.setSelectionRange(at, at);
        }
        composition = null;
        if (e.data) edit([e.data]);
    });
    return clear;
}

return {bindColumnEditor, buildLineBlocks};
});
