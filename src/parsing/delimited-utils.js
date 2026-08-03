OTA.define('delimited', ["table-utils"], ({TableUtils}) => {
const Delimited = {
    parse(text='', delimiter=',') {
        const input = TableUtils.normalizeText(text);
        const diagnostics = [];
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
        if(inQuotes) diagnostics.push({ severity:'warning', code:'UNCLOSED_QUOTE', message:'检测到未闭合的引号字段；已按当前内容继续解析' });
        row.push(cell); rows.push(row);
        const filtered = rows.filter(r => !TableUtils.isEmptyRow(r));
        return { rows: filtered, diagnostics };
    }
};

    return { Delimited };
});
