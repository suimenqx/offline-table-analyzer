OTA.define('import-engine', ["table-utils","format-sniffer","html-parser","delimited-parsers","text-parsers","data-block-parser"], ({TableUtils}, {FormatSniffer}, {HtmlTableParser}, {CsvParser, SemicolonCsvParser, ExcelPasteParser}, {PipeTableParser, AsciiTableParser, FixedWidthParser, AlignedTableParser, PlainTextTableParser, CliTableDataParser, CliMultiBlockParser}, {DataBlockParser}) => {
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
        // 缓存 sniff 结果（避免重复扫描）
        let _sniffCache = null;
        const getSniff = () => {
            if (!_sniffCache) _sniffCache = FormatSniffer.sniff(source.text);
            return _sniffCache;
        };

        if(!chosen) {
            // ── 0. HTML 剪贴板优先检测 ──
            if (source.html && /<table[\s>]/i.test(source.html) && /<tr[\s>]/i.test(source.html)) {
                chosen = this.getParser('html-table');
                if (chosen) scored = [{ parser: chosen, score: 1 }];
            }

            // ── 1. FormatSniffer：特征指纹匹配 ──
            if (!chosen) {
                const sniff = getSniff();
                const sniffCandidates = sniff.candidates || [];

                if (sniffCandidates.length === 1 && sniffCandidates[0].method === 'hard') {
                    // 硬特征命中：直接解析，无需 probe
                    chosen = this.getParser(sniffCandidates[0].id);
                    if (chosen) scored = sniffCandidates.map(c => ({ parser: chosen, score: c.score }));
                }

                if (!chosen && sniffCandidates.length > 0) {
                    const evaluated = [];
                    sniffCandidates.slice(0, 3).forEach(c => {
                        const parser = this.getParser(c.id);
                        if (!parser) return;
                        try {
                            const result = parser.parse(source, options);
                            const quality = this.parseQuality(result);
                            if (quality > 0) evaluated.push({ parser, score: c.score, parsed: result, quality, adjustedScore: c.score * (0.6 + quality * 0.4) });
                        } catch (e) { /* 格式不兼容 */ }
                    });

                    if (evaluated.length > 0) {
                        selectedEvaluation = evaluated.sort((a, b) => b.adjustedScore - a.adjustedScore)[0];
                        chosen = selectedEvaluation.parser;
                        parsed = selectedEvaluation.parsed;
                        scored = sniffCandidates.slice(0, 3).map(c => {
                            const ev = evaluated.find(e => e.parser.id === c.id);
                            return { parser: ev ? ev.parser : this.getParser(c.id), score: ev ? ev.adjustedScore : c.score };
                        }).filter(c => c.parser);
                    }
                }

                // sniff 未产生可用结果 → 逐个尝试全部 parser（最终兜底）
                if (!chosen) {
                    for (const parser of this.parsers) {
                        try {
                            const result = parser.parse(source, options);
                            const quality = this.parseQuality(result);
                            if (quality > 0.2) {
                                chosen = parser;
                                parsed = result;
                                scored = [{ parser, score: quality }];
                                break;
                            }
                        } catch (e) { /* 继续尝试下一个 */ }
                    }
                }
            }
        }
        if(!chosen) return { tables:[], format:'empty', label:'空输入', diagnostics:[], candidates:[] };
        if(!parsed) parsed = chosen.parse(source, options);
        const tables = parsed.tables || [];

        // 合并诊断（sniff 诊断 + parse 诊断 + 表格诊断）
        const diagnostics = [];
        const diagnosticKeys = new Set();
        // sniff 诊断（复用缓存）
        const sniffDiag = !selectedType ? getSniff() : null;
        (sniffDiag && sniffDiag.diagnostics || []).forEach(item => {
            const key = `${item.code || ''}|${item.message || ''}`;
            if (!diagnosticKeys.has(key)) { diagnosticKeys.add(key); diagnostics.push(item); }
        });
        [...(Array.isArray(parsed.diagnostics) ? parsed.diagnostics : []), ...tables.flatMap(table => table.diagnostics || [])].forEach(item => {
            const key = `${item.code || ''}|${item.table || ''}|${item.row || ''}|${item.message || ''}`;
            if(!diagnosticKeys.has(key)) {
                diagnosticKeys.add(key);
                diagnostics.push(item);
            }
        });
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
