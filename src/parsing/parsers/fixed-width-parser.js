OTA.define('fixed-width-parser', ["table-utils","delimited-parsers"], ({TableUtils}, {buildSingleTableResult}) => {
/* Fixed-width / multi-space table parser */
const FixedWidthParser = {
    id:'fixed-width', label:'固定宽度/多空格表格',
    parse(source, options={}) {
        const rows = TableUtils.lines(source.text).filter(l => l.trim()).map(l => l.trim().split(/\s{2,}/).map(v => v.trim()));
        return buildSingleTableResult(rows, 'Fixed Width Table 1', this.id, options);
    }
};
return FixedWidthParser;
});
