OTA.define('delimited', ["table-utils"], ({TableUtils}) => {
const Delimited = {
    lastDiagnostics: [],
    parse(text='', delimiter=',') {
        const input = TableUtils.normalizeText(text);
        this.lastDiagnostics = [];
        const rows = [];
        let row = [], cell = '', inQuotes = false;
        for(let i=0; i<input.length; i++) {
            const ch = input[i];
            const next = input[i+1];
            if(inQuotes) {
                if(ch === '"' && next === '"') { cell += '"'; i++; }
                else if(ch === '"') inQuotes = false;
                else cell += ch;
                continue;
            }
            if(ch === '"') { inQuotes = true; continue; }
            if(ch === delimiter) { row.push(cell); cell = ''; continue; }
            if(ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
            cell += ch;
        }
        if(inQuotes) this.lastDiagnostics.push({ level:'warning', code:'UNCLOSED_QUOTE', message:'检测到未闭合的引号字段；已按当前内容继续解析' });
        row.push(cell); rows.push(row);
        return rows.filter(r => !TableUtils.isEmptyRow(r));
    },
    delimiterStats(text='', delimiter=',') {
        const rows = this.parse(text, delimiter).slice(0, 30);
        const widths = rows.map(r => r.length).filter(n => n > 1);
        if(!widths.length) return {score:0, rows, width:0, consistent:false};
        const freq = new Map(); widths.forEach(w => freq.set(w, (freq.get(w)||0)+1));
        const [width, count] = Array.from(freq.entries()).sort((a,b)=>b[1]-a[1])[0];
        const consistency = count / widths.length;
        const score = Math.min(0.95, 0.35 + consistency * 0.45 + Math.min(width, 12) / 40);
        return { score, rows, width, consistent: consistency >= 0.65 };
    }
};

    return { Delimited };
});
