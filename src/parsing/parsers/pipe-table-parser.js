OTA.define('pipe-table-parser', ["table-utils","parser-helpers","delimited-parsers"], ({TableUtils}, {splitPipeCells}, {buildSingleTableResult}) => {
/* Pipe/Markdown table parser */
const PipeTableParser = {
    id:'pipe-table', label:'竖线/网页表格文本', delimiter:'|',
    parse(source, options={}) {
        let lines = TableUtils.lines(source.text).filter(l => l.trim());
        const mdSep = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
        const hasMdSep = lines.some(l => mdSep.test(l));
        lines = lines.filter(l => !mdSep.test(l));
        const rows = lines.map(l => {
            let s = l.trim();
            if(s.startsWith('|')) s = s.slice(1);
            if(s.endsWith('|')) s = s.slice(0, -1);
            return splitPipeCells(s);
        }).filter(r => !TableUtils.isEmptyRow(r));
        return buildSingleTableResult(rows, 'Pipe Table 1', this.id, options, { delimiter:'|' }, hasMdSep || options.hasHeader);
    }
};
return PipeTableParser;
});
