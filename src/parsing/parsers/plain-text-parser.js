OTA.define('plain-text-parser', ["table-utils","delimited-parsers"], ({TableUtils}, {buildSingleTableResult}) => {
/* Whitespace-separated plain text table parser */
const PlainTextTableParser = {
    id:'plain-text', label:'空白分隔文本',
    parse(source, options={}) {
        const rows = TableUtils.lines(source.text).filter(l => l.trim()).map(l => l.trim().split(/\s+/));
        return buildSingleTableResult(rows, 'Text Table 1', this.id, options);
    }
};
return PlainTextTableParser;
});
