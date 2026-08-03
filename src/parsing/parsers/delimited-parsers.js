OTA.define('delimited-parsers', ["table-utils","header-resolver","delimited"], ({TableUtils}, {HeaderResolver}, {Delimited}) => {
function buildSingleTableResult(rows, name, sourceType, options={}, meta={}, forcedHeader) {
    const resolved = HeaderResolver.infer(rows, { ...options, hasHeader: forcedHeader === undefined ? options.hasHeader : forcedHeader, tableName:name });
    return {
        tables:[{ name, headers:resolved.headers, rows:resolved.rows, sourceType, meta:{ ...meta, hasHeader:resolved.hasHeader, generatedHeaders:resolved.generatedHeaders, headerConfidence:resolved.headerConfidence, headerReasons:resolved.headerReasons }, diagnostics:resolved.diagnostics }],
        diagnostics:resolved.diagnostics
    };
}

function createDelimitedParser({ id, label, delimiter, tableName }) {
    return {
        id, label, delimiter,
        parse(source, options={}) {
            const { rows: matrix, diagnostics: delimDiag } = Delimited.parse(source.text || '', delimiter);
            const result = buildSingleTableResult(matrix, tableName, id, options, { delimiter });
            if(delimDiag.length) {
                result.diagnostics.push(...delimDiag);
            }
            return result;
        }
    };
}

const CsvParser = createDelimitedParser({
    id:'csv', label:'CSV', delimiter:',', tableName:'CSV Table 1'
});

const SemicolonCsvParser = createDelimitedParser({
    id:'semicolon-csv', label:'分号分隔', delimiter:';', tableName:'Delimited Table 1'
});

const ExcelPasteParser = createDelimitedParser({
    id:'excel-paste', label:'Excel/表格复制 TSV', delimiter:'\t', tableName:'Excel Paste Table 1'
});

    return { buildSingleTableResult, CsvParser, SemicolonCsvParser, ExcelPasteParser };
});
