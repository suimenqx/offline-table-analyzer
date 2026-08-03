OTA.define('ascii-table-parser', ["table-utils","parser-helpers","delimited-parsers"], ({TableUtils}, {splitPipeRows}, {buildSingleTableResult}) => {
/* ASCII/terminal table parser */
const AsciiTableParser = {
    id:'ascii-table', label:'ASCII/终端表格',
    parse(source, options={}) {
        const border = /^[\s+|\-─┌┬┐├┼┤└┴┘│]+$/;
        const lines = TableUtils.lines(source.text)
            .map(l => l.replace(/[│┃]/g, '|'))
            .filter(l => l.trim() && !border.test(l.trim()));
        return buildSingleTableResult(splitPipeRows(lines), 'ASCII Table 1', this.id, options);
    }
};
return AsciiTableParser;
});
