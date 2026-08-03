OTA.define('cli-table-data-parser', ["table-utils","delimited","parser-helpers"], ({TableUtils}, {Delimited}, {splitPipeCells}) => {
/* CLI table-data legacy format parser */
const CliTableDataParser = {
    id:'cli-table-data', label:'CLI table-data',
    tableNameFromLine(line, index, used) {
        const lower = String(line || '').toLowerCase();
        const pos = lower.lastIndexOf('table-data');
        const tail = pos >= 0 ? line.slice(pos + 'table-data'.length).trim() : '';
        const name = (tail.split(/\s+/)[0] || `T${index + 1}`).replace(/[|,;]+$/g, '');
        return TableUtils.makeTableName(name, index, used);
    },
    parse(source, options={}) {
        const lines = TableUtils.lines(source.text);
        const tables = [];
        const used = new Set();
        let cur = null;
        let inData = false;
        let ranges = [];
        const finalize = () => {
            if(!cur) return;
            if(cur.headers.length) {
                const diagnostics = [];
                const widest = TableUtils.maxWidth(cur.rows);
                while(cur.headers.length < widest) cur.headers.push(`Column${cur.headers.length + 1}`);
                cur.headers = TableUtils.ensureUniqueHeaders(cur.headers);
                cur.rows = TableUtils.normalizeRows(cur.rows, cur.headers.length, diagnostics, cur.name);
                cur.sourceType = this.id;
                cur.meta = { mode:cur.mode || 'WS', hasHeader:true, generatedHeaders:false, headerRule:'validflag' };
                cur.diagnostics = diagnostics;
                tables.push(cur);
            }
            cur = null;
            inData = false;
            ranges = [];
        };
        const parseByMode = (line) => {
            const trim = line.trim();
            const wsParts = trim.split(/\s+/);
            if(wsParts.length === cur.headers.length) return wsParts;
            if(cur.mode === 'FIXED') return ranges.map(r => (r.s >= line.length) ? '' : line.substring(r.s, Math.min(r.e, line.length)).trim());
            if(cur.mode === 'TAB') return (Delimited.parse(trim, '\t').rows[0]) || [];
            if(cur.mode === 'CSV') return (Delimited.parse(trim, ',').rows[0]) || [];
            if(cur.mode === 'PIPE') return splitPipeCells(trim.replace(/^\||\|$/g, ''));
            return wsParts;
        };
        const setValidFlagHeader = (line) => {
            const trim = line.trim();
            if(line.includes('\t')) {
                cur.mode = 'TAB';
                cur.headers = TableUtils.ensureUniqueHeaders(trim.split('\t'));
                return;
            }
            if(line.includes(',') && !line.includes('  ')) {
                cur.mode = 'CSV';
                cur.headers = TableUtils.ensureUniqueHeaders(Delimited.parse(trim, ',').rows[0] || []);
                return;
            }
            if((line.match(/\|/g) || []).length >= 2) {
                cur.mode = 'PIPE';
                cur.headers = TableUtils.ensureUniqueHeaders(splitPipeCells(trim.replace(/^\||\|$/g, '')));
                return;
            }
            cur.mode = 'FIXED';
            ranges = [];
            const regex = /\S+/g;
            let m;
            while((m = regex.exec(line)) !== null) ranges.push({s:m.index, e:null});
            for(let k=0; k<ranges.length; k++) ranges[k].e = (k === ranges.length - 1) ? 99999 : ranges[k+1].s;
            cur.headers = TableUtils.ensureUniqueHeaders(ranges.map(r => line.substring(r.s, Math.min(r.e, line.length)).trim()));
        };
        lines.forEach((line) => {
            const trim = line.trim();
            if(line.toLowerCase().includes('table-data')) {
                finalize();
                cur = { name:this.tableNameFromLine(line, tables.length, used), headers:[], rows:[], mode:'WS', diagnostics:[] };
                inData = false;
                return;
            }
            if(!cur) return;
            if(trim.toLowerCase().startsWith('validflag')) {
                setValidFlagHeader(line);
                inData = true;
                return;
            }
            if(!inData) return;
            if(trim.startsWith('<') || trim.startsWith('[')) { finalize(); return; }
            if(!trim) return;
            cur.rows.push(parseByMode(line));
        });
        finalize();
        return { tables, diagnostics:tables.flatMap(table => table.diagnostics || []) };
    }
};
return CliTableDataParser;
});
