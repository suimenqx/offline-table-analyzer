OTA.define('delimited-parsers', ["table-utils","header-resolver","delimited"], ({TableUtils}, {HeaderResolver}, {Delimited}) => {
function buildSingleTableResult(rows, name, sourceType, options={}, meta={}, forcedHeader) {
    const resolved = HeaderResolver.infer(rows, { ...options, hasHeader: forcedHeader === undefined ? options.hasHeader : forcedHeader, tableName:name });
    return {
        tables:[{ name, headers:resolved.headers, rows:resolved.rows, sourceType, meta:{ ...meta, hasHeader:resolved.hasHeader, generatedHeaders:resolved.generatedHeaders, headerConfidence:resolved.headerConfidence, headerReasons:resolved.headerReasons }, diagnostics:resolved.diagnostics }],
        diagnostics:resolved.diagnostics
    };
}

function createDelimitedParser({ id, label, delimiter, tableName, confidence }) {
    return {
        id, label, delimiter,
        confidence(source) { return confidence(source); },
        parse(source, options={}) {
            const matrix = Delimited.parse(source.text || '', delimiter);
            const result = buildSingleTableResult(matrix, tableName, id, options, { delimiter });
            if(Delimited.lastDiagnostics.length) {
                result.diagnostics.push(...Delimited.lastDiagnostics);
            }
            return result;
        }
    };
}

const CsvParser = createDelimitedParser({
    id:'csv', label:'CSV', delimiter:',', tableName:'CSV Table 1',
    confidence(source) {
        const text = source.text || '';
        const tabStats = Delimited.delimiterStats(text, '\t');
        if(tabStats.hasDelimiter) return 0.05;
        const st = Delimited.delimiterStats(text, ',');
        if(!st.hasDelimiter) return 0;
        return st.consistent ? st.score : Math.min(0.25, st.score * 0.3);
    }
});

const SemicolonCsvParser = createDelimitedParser({
    id:'semicolon-csv', label:'分号分隔', delimiter:';', tableName:'Delimited Table 1',
    confidence(source) {
        const st = Delimited.delimiterStats(source.text || '', ';');
        return st.hasDelimiter && st.consistent ? st.score - 0.04 : 0;
    }
});

const ExcelPasteParser = createDelimitedParser({
    id:'excel-paste', label:'Excel/表格复制 TSV', delimiter:'\t', tableName:'Excel Paste Table 1',
    confidence(source) {
        const text = source.text || '';
        const st = Delimited.delimiterStats(text, '\t');
        if(!st.hasDelimiter) return 0;
        return st.consistent ? Math.max(0.82, st.score) : 0.35;
    }
});

    return { buildSingleTableResult, CsvParser, SemicolonCsvParser, ExcelPasteParser };
});
