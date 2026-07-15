OTA.define('import-engine', ["table-utils","html-parser","delimited-parsers","text-parsers","data-block-parser"], ({TableUtils}, {HtmlTableParser}, {CsvParser, SemicolonCsvParser, ExcelPasteParser}, {PipeTableParser, AsciiTableParser, FixedWidthParser, AlignedTableParser, PlainTextTableParser, CliTableDataParser, CliMultiBlockParser}, {DataBlockParser}) => {
const ImportEngine = {
    parsers: [CliTableDataParser, DataBlockParser, HtmlTableParser, CliMultiBlockParser, AsciiTableParser, PipeTableParser, ExcelPasteParser, CsvParser, SemicolonCsvParser, FixedWidthParser, AlignedTableParser, PlainTextTableParser],
    getParser(type) { return this.parsers.find(p => p.id === type); },
    parseQuality(parsed) {
        const tables = parsed && Array.isArray(parsed.tables) ? parsed.tables : [];
        if(!tables.length) return 0;
        const diagnostics = Array.isArray(parsed.diagnostics) ? parsed.diagnostics : [];
        const totalCells = tables.reduce((sum, table) => {
            const headers = Array.isArray(table.headers) ? table.headers.length : 0;
            const rows = Array.isArray(table.rows) ? table.rows : [];
            return sum + headers + rows.reduce((n, row) => n + (Array.isArray(row) ? row.length : 0), 0);
        }, 0);
        if(!totalCells) return 0.2;
        let quality = 1;
        let alignedMismatchCount = 0;
        diagnostics.forEach(item => {
            if(item.code === 'UNCLOSED_QUOTE') quality -= 0.3;
            else if(item.code === 'ROW_WIDTH_MISMATCH') quality -= 0.04;
            else if(item.code === 'ALIGNED_POSITION_MISMATCH') alignedMismatchCount++;
            else if(item.level === 'error') quality -= 0.35;
        });
        if(alignedMismatchCount) quality -= Math.min(0.16, 0.08 + (alignedMismatchCount - 1) * 0.01);
        return Math.max(0.15, Math.min(1, quality));
    },
    parse(input, options={}) {
        const source = typeof input === 'string' ? { text: input, html: options.html || '' } : { text: input.text || '', html: input.html || '' };
        source.text = TableUtils.normalizeText(source.text);
        const selectedType = options.format && options.format !== 'auto' ? options.format : null;
        let chosen = selectedType ? this.getParser(selectedType) : null;
        let scored = [];
        let parsed;
        let selectedEvaluation = null;
        if(!chosen) {
            scored = this.parsers.map(parser => ({ parser, score: Math.max(0, Math.min(1, parser.confidence(source, options) || 0)) }))
                .filter(c => c.score > 0)
                .sort((a,b) => b.score - a.score);
            const evaluated = [];
            const probe = (candidate) => {
                try {
                    const result = candidate.parser.parse(source, options);
                    const quality = this.parseQuality(result);
                    if(quality > 0) evaluated.push({ ...candidate, parsed:result, quality, adjustedScore:candidate.score * (0.6 + quality * 0.4) });
                } catch(error) {
                    // A malformed candidate must not prevent trying the next parser.
                }
            };
            // A validated CLI block signature is structurally specific and
            // can contain thousands of rows. Avoid spending the detection
            // budget reparsing it as CSV/plain text after the precise parser
            // has already won the score race.
            const probeLimit = scored[0] && scored[0].parser.id === 'cli-multi-block' ? 1 : 3;
            scored.slice(0, probeLimit).forEach(probe);
            if(!evaluated.length) scored.slice(probeLimit).some(candidate => { probe(candidate); return evaluated.length > 0; });
            selectedEvaluation = evaluated.sort((a,b) => b.adjustedScore - a.adjustedScore)[0] || null;
            chosen = selectedEvaluation && selectedEvaluation.parser;
            parsed = selectedEvaluation && selectedEvaluation.parsed;
        }
        if(!chosen) return { tables:[], format:'empty', label:'空输入', diagnostics:[], candidates:[] };
        if(!parsed) parsed = chosen.parse(source, options);
        const tables = parsed.tables || [];
        const diagnostics = [];
        const diagnosticKeys = new Set();
        [...(Array.isArray(parsed.diagnostics) ? parsed.diagnostics : []), ...tables.flatMap(table => table.diagnostics || [])].forEach(item => {
            const key = `${item.code || ''}|${item.table || ''}|${item.row || ''}|${item.message || ''}`;
            if(!diagnosticKeys.has(key)) {
                diagnosticKeys.add(key);
                diagnostics.push(item);
            }
        });
        if(!selectedType && selectedEvaluation) {
            const next = scored.find(item => item.parser.id !== selectedEvaluation.parser.id);
            if(next && Math.abs(selectedEvaluation.adjustedScore - next.score) < 0.08) {
                diagnostics.push({ level:'info', code:'FORMAT_AMBIGUOUS', message:`自动识别存在接近候选：${selectedEvaluation.parser.label} 与 ${next.parser.label}，如结果不符合预期请在详情中切换格式` });
            }
        }
        const candidates = selectedType
            ? [{ id:chosen.id, label:chosen.label, score:1, manual:true }]
            : scored.slice(0, 3).map(item => {
                const evaluation = selectedEvaluation && selectedEvaluation.parser.id === item.parser.id ? selectedEvaluation : null;
                return { id:item.parser.id, label:item.parser.label, score:Math.max(0, Math.min(1, evaluation ? evaluation.adjustedScore : item.score)), rawScore:item.score, manual:false };
            });
        return { tables, format:chosen.id, label:chosen.label, diagnostics, candidates, sourceLength:source.text.length };
    }
};

    return { ImportEngine };
});
