/* --- Utils --- */
const $ = (id) => document.getElementById(id);
const createEl = (tag, cls) => { const e = document.createElement(tag); if(cls) e.className=cls; return e; };

const Tooltip = {
    el: $('tooltip'),
    init() {
        document.body.addEventListener('mouseenter', e => {
            if(e.target.classList.contains('help-icon')) this.show(e.target, e.target.dataset.tip);
        }, true);
        document.body.addEventListener('mouseleave', e => {
            if(e.target.classList.contains('help-icon')) this.hide();
        }, true);
    },
    show(target, text) {
        this.el.innerText = text; this.el.classList.add('show');
        const r = target.getBoundingClientRect();
        this.el.style.top = (r.top - 40) + 'px'; this.el.style.left = (r.left - 20) + 'px';
    },
    hide() { this.el.classList.remove('show'); }
};
Tooltip.init();

const Toast = {
    show(msg, isError=false) {
        const el = $('toast'); el.textContent = msg; 
        el.className = isError ? 'show error' : 'show';
        setTimeout(()=>el.className='', 2000);
    }
};
