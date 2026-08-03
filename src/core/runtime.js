OTA.define('runtime', [], () => {
/* --- Utils --- */
const $ = (id) => document.getElementById(id);
const createEl = (tag, cls) => { const e = document.createElement(tag); if(cls) e.className=cls; return e; };
const escapeHtml = (str='') => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const formatBytes = (bytes=0) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const Tooltip = {
    _initialized: false,
    el: null,
    init() {
        if(this._initialized || typeof document === 'undefined' || !document.body) return;
        this.el = $('tooltip');
        if(!this.el) return;
        this._initialized = true;
        document.body.addEventListener('mouseenter', e => {
            if(e.target.classList.contains('help-icon')) this.show(e.target, e.target.dataset.tip);
        }, true);
        document.body.addEventListener('mouseleave', e => {
            if(e.target.classList.contains('help-icon')) this.hide();
        }, true);
    },
    show(target, text) {
        if(!this.el) { this.init(); if(!this.el) return; }
        this.el.innerText = text; this.el.classList.add('show');
        const r = target.getBoundingClientRect();
        this.el.style.top = (r.top - 40) + 'px'; this.el.style.left = (r.left - 20) + 'px';
    },
    hide() { if(this.el) this.el.classList.remove('show'); }
};

const Toast = {
    show(msg, isError=false) {
        if(typeof document === 'undefined') return;
        const el = $('toast'); if(!el) return;
        el.textContent = msg; 
        el.className = isError ? 'show error' : 'show';
        setTimeout(()=>el.className='', 2000);
    }
};

    return { $, createEl, escapeHtml, formatBytes, Tooltip, Toast };
});
