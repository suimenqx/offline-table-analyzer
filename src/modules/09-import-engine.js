const ImportEngine = {
    parsers: [CliTableDataParser, HtmlTableParser, AsciiTableParser, PipeTableParser, ExcelPasteParser, CsvParser, SemicolonCsvParser, FixedWidthParser, AlignedTableParser, PlainTextTableParser],
    getParser(type) { return this.parsers.find(p => p.id === type); },
    parse(input, options={}) {
        const source = typeof input === 'string' ? { text: input, html: options.html || '' } : { text: input.text || '', html: input.html || '' };
        source.text = TableUtils.normalizeText(source.text);
        const selectedType = options.format && options.format !== 'auto' ? options.format : null;
        let chosen = selectedType ? this.getParser(selectedType) : null;
        let scored = [];
        if(!chosen) {
            scored = this.parsers.map(parser => ({ parser, score: Math.max(0, Math.min(1, parser.confidence(source, options) || 0)) }))
                .filter(c => c.score > 0)
                .sort((a,b) => b.score - a.score);
            chosen = scored[0] && scored[0].parser;
        }
        if(!chosen) return { tables:[], format:'empty', label:'空输入', diagnostics:[], candidates:[] };
        const parsed = chosen.parse(source, options);
        const tables = parsed.tables || [];
        const diagnostics = Array.isArray(parsed.diagnostics) ? parsed.diagnostics : tables.flatMap(table => table.diagnostics || []);
        const candidates = selectedType
            ? [{ id:chosen.id, label:chosen.label, score:1, manual:true }]
            : scored.slice(0, 3).map(item => ({ id:item.parser.id, label:item.parser.label, score:item.score, manual:false }));
        return { tables, format:chosen.id, label:chosen.label, diagnostics, candidates, sourceLength:source.text.length };
    }
};
