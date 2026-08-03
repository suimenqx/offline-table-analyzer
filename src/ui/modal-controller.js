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
    },

    /**
     * Close the modal and restore focus.
     */
    close() {
        const overlay = $('modalOverlay');
        if (overlay) overlay.classList.add('hidden');
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
            setTimeout(() => closeBtn.focus(), 0);
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
            Store.updateUI('displayTables', next);
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
            Store.updateUI('enabledViews', sel);
            ModalController.close();
            dispatch('preview:renderRequested', {});
        });
    },

    /**
     * Show the "select columns" modal for a table.
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

        const html = `
            <div style="margin-bottom:10px; display:flex; gap:8px;">
                <input id="colSearch" placeholder="搜索列名..." style="flex:1;">
                <button class="sm" id="colAll">全选</button>
                <button class="sm" id="colNone">全不选</button>
            </div>
            <div id="colList" style="max-height:400px; overflow-y:auto; border:1px solid var(--border-light); padding:8px; border-radius:4px;">
                ${allHeaders.map(c => `<label class="checkbox-row" data-val="${escapeHtml(c.toLowerCase())}"><input type="checkbox" value="${escapeHtml(c)}" ${!isFocusActive || cur.includes(c) ? 'checked' : ''}><span>${escapeHtml(c)}</span></label>`).join('')}
            </div>
            <div style="margin-top:16px; text-align:right;"><button class="primary" id="saveMod">应用</button></div>
        `;
        ModalController.show(`选择列: ${tableName}`, html);

        const list = document.getElementById('colList');
        const search = document.getElementById('colSearch');
        if (search && list) {
            search.oninput = () => {
                const v = search.value.toLowerCase();
                Array.from(list.children).forEach(r => {
                    r.style.display = r.dataset.val.includes(v) ? 'flex' : 'none';
                });
            };
        }
        const allBtn = document.getElementById('colAll');
        const noneBtn = document.getElementById('colNone');
        if (allBtn && list) allBtn.onclick = () => Array.from(list.children).forEach(r => {
            if (r.style.display !== 'none') r.querySelector('input').checked = true;
        });
        if (noneBtn && list) noneBtn.onclick = () => Array.from(list.children).forEach(r => {
            if (r.style.display !== 'none') r.querySelector('input').checked = false;
        });

        ModalController._bindSaveBtn(() => {
            const v = Array.from(list.querySelectorAll('input:checked')).map(c => c.value);
            Store.updateRule(tableName, 'focus', v);
            const focusInput = $('focusColsInput');
            if (focusInput) focusInput.value = v.join(', ');
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
