OTA.define('import-engine', ["table-utils","format-sniffer","html-parser","json-parser","delimited-parsers","pipe-table-parser","ascii-table-parser","fixed-width-parser","cli-multi-block-parser","aligned-table-parser","plain-text-parser","cli-table-data-parser","data-block-parser"], ({TableUtils}, {FormatSniffer}, {HtmlTableParser}, {JsonTableParser}, {CsvParser, SemicolonCsvParser, ExcelPasteParser}, PipeTableParser, AsciiTableParser, FixedWidthParser, CliMultiBlockParser, AlignedTableParser, PlainTextTableParser, CliTableDataParser, {DataBlockParser}) => {
const hasClipboardTable=html=>/<table[\s>]/i.test(html || '') && /<tr[\s>]/i.test(html || '');
const ImportEngine = {
    parsers: [CliTableDataParser, DataBlockParser, HtmlTableParser, JsonTableParser, CliMultiBlockParser, AsciiTableParser, PipeTableParser, ExcelPasteParser, CsvParser, SemicolonCsvParser, FixedWidthParser, AlignedTableParser, PlainTextTableParser],
    getParser(type) { return this.parsers.find(p => p.id === type); },
    requiresDOMParser(input,options={}) {
        const source=typeof input==='string'?{text:input,html:options.html || ''}:input;
        const manual=this.getParser(options.format);
        if(manual)return manual.id==='html-table';
        // Rich clipboard metadata alone does not select the HTML adapter.
        // Feature extraction examines only the sniffer's bounded text sample.
        return hasClipboardTable(source.html) || FormatSniffer.extractFeatures(source.text).M_html;
    },
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
            else if((item.severity || item.level) === 'error') quality -= 0.35;
        });
        if(alignedMismatchCount) quality -= Math.min(0.16, 0.08 + (alignedMismatchCount - 1) * 0.01);
        return Math.max(0.15, Math.min(1, quality));
    },
    MAX_SAMPLE_CHARS:262144,
    MAX_SAMPLE_RECORDS:512,
    // Selection never asks an adapter to parse an unbounded input. Complete
    // records, rather than physical lines, are used for quoted delimited text.
    sample(text,limit,maxRecords=this.MAX_SAMPLE_RECORDS) {
        const end=Math.min(text.length,limit);
        let quoted=false,lastEnd=0,records=0,i=0;
        for(;i<end;i++) {
            const ch=text[i];
            if(ch==='"') {
                if(quoted && text[i+1]==='"'){i++;continue;}
                quoted=!quoted;
            }
            if(ch==='\n' && !quoted) {
                lastEnd=i+1;records++;
                if(records>=maxRecords){i++;break;}
            }
        }
        const complete=i>=text.length;
        const length=complete?text.length:(lastEnd || end);
        return {text:TableUtils.normalizeText(text.slice(0,length)),truncated:!complete,length,records};
    },
    detect(input,options={}) {
        const source=typeof input==='string'?{text:input,html:options.html || ''}:{text:input.text || '',html:input.html || ''};
        const manual=options.format && options.format!=='auto'?this.getParser(options.format):null;
        const candidate=(parser,score,extra={})=>({id:parser.id,label:parser.label,score,manual:!!manual,...extra});
        if(manual)return {format:manual.id,candidates:[candidate(manual,1)],diagnostics:[],sampleLength:0};
        if(hasClipboardTable(source.html))return {format:'html-table',candidates:[candidate(this.getParser('html-table'),1)],diagnostics:[],sampleLength:0};
        const initial=FormatSniffer.sniff(source.text);
        const hard=initial.candidates[0];
        if(hard?.method==='hard')return {format:hard.id,candidates:[{...hard,manual:false}],diagnostics:initial.diagnostics,sampleLength:0};
        let evaluations=[],sniff=initial,sampleLength=0,truncated=false,rememberedSelected=false;
        for(const [limit,records] of [[16384,64],[65536,256],[this.MAX_SAMPLE_CHARS,this.MAX_SAMPLE_RECORDS]]) {
            const sample=this.sample(source.text,limit,records);
            sampleLength=sample.length;truncated=sample.truncated;
            sniff=FormatSniffer.sniff(sample.text,{maxChars:this.MAX_SAMPLE_CHARS,maxLines:this.MAX_SAMPLE_RECORDS});
            if(sniff.candidates[0]?.method==='hard')return {format:sniff.candidates[0].id,candidates:[{...sniff.candidates[0],manual:false}],diagnostics:sniff.diagnostics,sampleLength};
            evaluations=[];
            const evaluate=c=>{
                const parser=this.getParser(c.id);if(!parser)return;
                try {
                    const parsed=parser.parse({text:sample.text,html:''},options);
                    const quality=this.parseQuality(parsed);
                    if(!parsed.tables?.length || !quality)return;
                    const width=parsed.tables.reduce((max,table)=>Math.max(max,table.headers.length),0);
                    const score=Math.min(1,c.score*(0.6+quality*0.4)+Math.min(0.06,Math.log2(Math.max(1,width))/100));
                    // Retain evidence only; candidate tables can be collected now.
                    evaluations.push({parser,score,quality,structural:c.structural,reason:c.reason});
                } catch (_) { /* An incompatible bounded probe is not a source failure. */ }
            };
            sniff.candidates.slice(0,6).forEach(evaluate);
            if(!evaluations.length && sample.text.trim())this.parsers.filter(parser=>parser.id!=='html-table').forEach(parser=>evaluate({id:parser.id,score:0.25}));
            evaluations.sort((a,b)=>b.score-a.score);
            const structure=evaluations.find(item=>item.structural && item.quality>=0.2);
            if(structure){evaluations=[structure,...evaluations.filter(item=>item!==structure)];break;}
            const remembered=evaluations.find(item=>item.parser.id===options.lastSuccessfulFormat && item.parser.id!=='plain-text' && item.quality>0.6);
            if(remembered && evaluations[0].score-remembered.score<0.12){rememberedSelected=true;evaluations=[remembered,...evaluations.filter(item=>item!==remembered)];break;}
            if(!sample.truncated || (evaluations.length && (evaluations.length===1 || evaluations[0].score-evaluations[1].score>=0.12)))break;
        }
        const ambiguous=evaluations.length>1 && !evaluations[0].structural && evaluations[0].score-evaluations[1].score<0.12;
        const diagnostics=[...(sniff.diagnostics || [])];
        if(ambiguous && !diagnostics.some(item=>item.code==='FORMAT_AMBIGUOUS'))diagnostics.push({severity:'info',code:'FORMAT_AMBIGUOUS',message:'候选格式接近，请检查预览；可在详情中选择格式'});
        if(truncated && !evaluations.length && source.text.length)diagnostics.push({severity:'warning',code:'DETECTION_BUDGET',message:'识别样本中没有完整可解析记录，请手动选择格式'});
        return {format:ambiguous && truncated && source.text.length>this.MAX_SAMPLE_CHARS && !rememberedSelected?'ambiguous':evaluations[0]?.parser.id || 'empty',candidates:evaluations.slice(0,3).map(item=>candidate(item.parser,item.score,{reason:item.reason,ambiguous})),diagnostics,sampleLength};
    },
    parse(input, options={}) {
        const source=typeof input==='string'?{text:input,html:options.html || ''}:{text:input.text || '',html:input.html || ''};
        const detection=this.detect(source,options);
        const chosen=this.getParser(detection.format);
        if(!chosen)return {tables:[],format:detection.format,label:detection.format==='ambiguous'?'请确认输入格式':'未识别出表格',diagnostics:detection.diagnostics,candidates:detection.candidates};
        // Only the selected adapter receives the complete normalized source.
        source.text=TableUtils.normalizeText(source.text);
        const parsed=chosen.parse(source,options),tables=parsed.tables || [];
        const diagnostics=[],keys=new Set();
        for(const item of [...detection.diagnostics,...(parsed.diagnostics || []),...tables.flatMap(table=>table.diagnostics || [])]) {
            const key=`${item.code || ''}|${item.table || ''}|${item.row || ''}|${item.message || ''}`;
            if(!keys.has(key)){keys.add(key);diagnostics.push(item);}
        }
        return {tables,format:chosen.id,label:chosen.label,diagnostics,candidates:detection.candidates,sourceLength:source.text.length};
    }
};

    return { ImportEngine };
});
