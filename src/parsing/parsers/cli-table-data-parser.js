OTA.define('cli-table-data-parser', ["table-utils","delimited","parser-helpers"], ({TableUtils}, {Delimited}, {splitPipeCells}) => {
/* CLI table-data legacy format parser */
const TABLE_DECLARATION = /^(?:\[[^\]\r\n]{1,80}\]\s*)?(?:[>$#]\s*)?table[-_]data\b(?:\s+table[-_]data\b)*/i;
const COMMAND_KEYWORD = /\btable[-_]data\b/i;
const TABLE_MARKER = /table[-_]data(?:\s+table[-_]data\b)*/i;
const COMMAND_PREFIX = /^(?!\d+(?:\s|$))[^,;|\t]*[\s>$#\]]$/;
const VALIDFLAG_HEADER = /^validflag/i;
const FIXED_WIDTH_FRAGMENT_HEADER = /^validflag +[^\s,|][^\t,|]*$/i;
const VALIDFLAG_RECORD = /^[01] +\S/;

function* scanLines(text) {
    let pending = null;
    for(const line of TableUtils.iterLines(text)) {
        const trim = line.trim();
        if(!trim) continue;
        if(pending) {
            // A prefixed marker inside a table is a declaration when a header follows it.
            const prefix = pending.trim.slice(0, pending.marker.index);
            pending.declaration = VALIDFLAG_HEADER.test(trim) && (!prefix || COMMAND_PREFIX.test(prefix));
            yield pending;
            pending = null;
        }
        const declaration = TABLE_DECLARATION.exec(trim);
        const marker = declaration || TABLE_MARKER.exec(trim);
        const entry = {line, trim, marker, declaration:Boolean(declaration)};
        if(marker && !declaration) pending = entry;
        else yield entry;
    }
    if(pending) yield pending;
}

const CliTableDataParser = {
    id:'cli-table-data', label:'CLI table-data',
    hasSignature(sample) {
        let firstNonBlank = true;
        let fragmentHeader = false;
        let openingKeyword = false;
        for(const {trim, declaration} of scanLines(sample)) {
            if(declaration || (fragmentHeader && VALIDFLAG_RECORD.test(trim))) return true;
            if(firstNonBlank) {
                openingKeyword = COMMAND_KEYWORD.test(trim);
                // A command may print status lines before its header. When it also
                // looks like a delimited record, wait for a CLI header to confirm it.
                if(openingKeyword && !/[,;|\t"'{}]/.test(trim)) return true;
            } else if(openingKeyword && FIXED_WIDTH_FRAGMENT_HEADER.test(trim)) return true;
            fragmentHeader = firstNonBlank && FIXED_WIDTH_FRAGMENT_HEADER.test(trim);
            firstNonBlank = false;
        }
        return false;
    },
    parse(source, options={}) {
        const tables = [];
        const used = new Set();
        let cur = null;
        let inData = false;
        let ranges = [];
        let firstNonBlank = true;
        const startTable = (tail='') => {
            const name = (tail.trim().split(/\s+/, 1)[0] || `T${tables.length + 1}`).replace(/[|,;]+$/g, '');
            cur = { name:TableUtils.makeTableName(name, tables.length, used), headers:[], rows:[], mode:'WS', diagnostics:[] };
        };
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
        for(const {line, trim, marker, declaration} of scanLines(source.text)) {
            if(firstNonBlank && FIXED_WIDTH_FRAGMENT_HEADER.test(trim)) startTable();
            firstNonBlank = false;
            if(declaration || (marker && !inData)) {
                finalize();
                startTable(trim.slice(marker.index + marker[0].length).replace(/^:/, ''));
                continue;
            }
            if(!cur) continue;
            if(VALIDFLAG_HEADER.test(trim)) {
                setValidFlagHeader(line);
                inData = true;
                continue;
            }
            if(!inData) continue;
            if(trim.startsWith('<') || trim.startsWith('[')) { finalize(); continue; }
            cur.rows.push(parseByMode(line));
        }
        finalize();
        return { tables, diagnostics:tables.flatMap(table => table.diagnostics || []) };
    }
};
return CliTableDataParser;
});
