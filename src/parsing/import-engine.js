OTA.define('import-engine', ["table-utils","format-sniffer","html-parser","json-parser","delimited-parsers","pipe-table-parser","ascii-table-parser","fixed-width-parser","cli-multi-block-parser","aligned-table-parser","plain-text-parser","cli-table-data-parser","data-block-parser"], ({TableUtils}, {FormatSniffer}, {HtmlTableParser}, {JsonTableParser}, {CsvParser, SemicolonCsvParser, ExcelPasteParser}, PipeTableParser, AsciiTableParser, FixedWidthParser, CliMultiBlockParser, AlignedTableParser, PlainTextTableParser, CliTableDataParser, {DataBlockParser}) => {
const hasClipboardTable=html=>/<table[\s>]/i.test(html || '') && /<tr[\s>]/i.test(html || '');
const REGION_DELIMITERS=new Map([['csv',','],['semicolon-csv',';'],['excel-paste','\t'],['pipe-table','|']]);
const REGION_FORMATS=new Set([...REGION_DELIMITERS.keys(),'fixed-width','aligned-table']);
const MAX_TABLE_REGIONS=128;

function findDelimitedRegions(text='',delimiter=',') {
    const regions=[];
    let run=null, recordStart=text.charCodeAt(0)===0xFEFF?1:0, delimiters=0, quoted=false, overBudget=false;
    const finishRun=()=>{
        if(run && run.rowCount>=2 && run.widthCounts.size) {
            let width=0, support=0;
            for(const [candidate,count] of run.widthCounts) if(count>support){width=candidate;support=count;}
            if(width>=2) {
                if(regions.length<MAX_TABLE_REGIONS) regions.push({start:run.start,end:run.end,rowCount:run.rowCount,width,support,rectangular:run.widthCounts.size===1,coverage:support/run.rowCount});
                else overBudget=true;
            }
        }
        run=null;
    };
    const finishRecord=(end,nextStart)=>{
        const value=text.slice(recordStart,end);
        if(value.trim() && delimiters>0) {
            const width=delimiters+1;
            if(!run) run={start:recordStart,end,rowCount:0,widthCounts:new Map()};
            run.end=end;run.rowCount++;
            run.widthCounts.set(width,(run.widthCounts.get(width)||0)+1);
        } else finishRun();
        recordStart=nextStart;delimiters=0;
    };
    for(let i=recordStart;i<text.length;i++) {
        const ch=text[i];
        if(delimiter!=='|' && ch==='"') {
            if(quoted && text[i+1]==='"'){i++;continue;}
            quoted=!quoted;continue;
        }
        if(ch===delimiter && !quoted) {
            if(delimiter==='|') {
                let slashes=0;
                for(let j=i-1;j>=0 && text[j]==='\\';j--)slashes++;
                if(slashes%2)continue;
            }
            delimiters++;
        } else if(ch==='\n' && !quoted) finishRecord(i,i+1);
    }
    if(recordStart<text.length)finishRecord(text.length,text.length);
    finishRun();
    return {regions,overBudget};
}

function findFixedWidthRegions(text='') {
    const regions=[];
    let run=null, lineStart=0, overBudget=false;
    const finishRun=()=>{
        if(run && run.rowCount>=2 && run.widthCounts.size) {
            let width=0, support=0;
            for(const [candidate,count] of run.widthCounts)if(count>support){width=candidate;support=count;}
            if(width>=2) {
                if(regions.length<MAX_TABLE_REGIONS)regions.push({start:run.start,end:run.end,rowCount:run.rowCount,width,support,rectangular:run.widthCounts.size===1,coverage:support/run.rowCount});
                else overBudget=true;
            }
        }
        run=null;
    };
    const finishLine=(end,nextStart)=>{
        const value=text.slice(lineStart,end);
        const trimmed=value.trim();
        const width=trimmed ? trimmed.split(/\s{2,}/).length : 0;
        if(width>=2) {
            if(!run)run={start:lineStart,end,rowCount:0,widthCounts:new Map()};
            run.end=end;run.rowCount++;run.widthCounts.set(width,(run.widthCounts.get(width)||0)+1);
        } else finishRun();
        lineStart=nextStart;
    };
    for(let i=0;i<text.length;i++)if(text[i]==='\n')finishLine(i,i+1);
    if(lineStart<text.length)finishLine(text.length,text.length);
    finishRun();
    return {regions,overBudget};
}

function findParserRegions(text,parserId) {
    if(parserId==='fixed-width')return findFixedWidthRegions(text);
    if(parserId==='aligned-table') {
        // Decorated reports already have a parser-owned block grammar. Leave
        // their separators intact so headers and data stay in the same block.
        if(/^\s*(?:[-=+|]\s*){3,}$/m.test(text))return {regions:[],overBudget:false};
        return findFixedWidthRegions(text);
    }
    const delimiter=REGION_DELIMITERS.get(parserId);
    return delimiter?findDelimitedRegions(text,delimiter):{regions:[],overBudget:false};
}

function previewRegion(text,region) {
    return text.slice(region.start,region.end).split('\n').slice(0,4).map(line=>{
        const clean=line.replace(/\r$/,'');
        return clean.length>180?`${clean.slice(0,177)}…`:clean;
    }).join('\n');
}

function mapNormalizedOffsetsToSource(originalText,offsets) {
    const targets=[...new Set(offsets.filter(Number.isInteger))].sort((a,b)=>a-b);
    const mapped=new Map();
    let sourceIndex=originalText.charCodeAt(0)===0xFEFF?1:0,normalizedIndex=0;
    for(const target of targets) {
        while(normalizedIndex<target && sourceIndex<originalText.length) {
            if(originalText[sourceIndex]==='\r' && originalText[sourceIndex+1]==='\n')sourceIndex+=2;
            else sourceIndex++;
            normalizedIndex++;
        }
        mapped.set(target,sourceIndex);
    }
    return mapped;
}

function mapTableRangesToSource(tables,originalText) {
    const ranged=(tables||[]).filter(table=>Number.isInteger(table.meta?.sourceRange?.start)&&Number.isInteger(table.meta?.sourceRange?.end));
    const offsets=ranged.flatMap(table=>[table.meta.sourceRange.start,table.meta.sourceRange.end]);
    const mapped=mapNormalizedOffsetsToSource(originalText,offsets);
    ranged.forEach(table=>{
        const range=table.meta.sourceRange;
        table.meta.sourceRange={start:mapped.get(range.start)??range.start,end:mapped.get(range.end)??range.end};
    });
}

function normalizeRegionSelection(selection,text,getParser) {
    if(!selection || typeof selection!=='object' || !Array.isArray(selection.regions))return null;
    const parser=getParser(selection.format);
    if(!parser || !REGION_FORMATS.has(parser.id))return null;
    const regions=selection.regions
        .filter(region=>region && Number.isInteger(region.start) && Number.isInteger(region.end) && region.start>=0 && region.end>region.start && region.end<=text.length)
        .map(region=>({start:region.start,end:region.end}))
        .sort((a,b)=>a.start-b.start);
    if(!regions.length || regions.some((region,index)=>index>0 && region.start<regions[index-1].end))return null;
    return {format:parser.id,regions};
}

function parseRegions(parser,text,regions,options={}) {
    const tables=[],diagnostics=[],used=new Set();
    regions.forEach((region,regionIndex)=>{
        const parsed=parser.parse({text:text.slice(region.start,region.end),html:''},{...options,regionSelection:undefined,format:parser.id});
        diagnostics.push(...(parsed.diagnostics||[]));
        (parsed.tables||[]).forEach(table=>{
            const priorName=table.name;
            const baseName=String(priorName||parser.label).replace(/\s+\d+$/,'');
            const requestedName=regionIndex===0 && !used.has(priorName)
                ? priorName
                : `${baseName} ${tables.length+1}`;
            table.name=TableUtils.makeTableName(requestedName,tables.length,used);
            table.meta={...(table.meta||{}),sourceRange:{start:region.start,end:region.end}};
            (table.diagnostics||[]).forEach(item=>{if(item.table===priorName)item.table=table.name;});
            tables.push(table);
        });
    });
    return {tables,diagnostics};
}

function collectDiagnostics(...groups) {
    const diagnostics=[],keys=new Set();
    for(const group of groups)for(const item of group||[]) {
        const key=`${item.code||''}|${item.table||''}|${item.row||''}|${item.message||''}`;
        if(!keys.has(key)){keys.add(key);diagnostics.push(item);}
    }
    return diagnostics;
}

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
        let evaluations=[],sniff=initial,sampleLength=0,truncated=false;
        for(const [limit,records] of [[16384,64],[65536,256],[this.MAX_SAMPLE_CHARS,this.MAX_SAMPLE_RECORDS]]) {
            const sample=this.sample(source.text,limit,records);
            sampleLength=sample.length;truncated=sample.truncated;
            sniff=FormatSniffer.sniff(sample.text,{maxChars:this.MAX_SAMPLE_CHARS,maxLines:this.MAX_SAMPLE_RECORDS});
            if(sniff.candidates[0]?.method==='hard')return {format:sniff.candidates[0].id,candidates:[{...sniff.candidates[0],manual:false}],diagnostics:sniff.diagnostics,sampleLength};
            evaluations=[];
            const evaluate=c=>{
                const parser=this.getParser(c.id);if(!parser)return;
                try {
                    const detectedRegions=findParserRegions(sample.text,parser.id);
                    const regions=detectedRegions.regions;
                    const parsed=regions.length && regions.every(region=>region.rectangular)
                        ? parseRegions(parser,sample.text,regions,options)
                        : parser.parse({text:sample.text,html:''},options);
                    const quality=this.parseQuality(parsed);
                    if(!parsed.tables?.length || !quality)return;
                    const width=parsed.tables.reduce((max,table)=>Math.max(max,table.headers.length),0);
                    const regionEvidence=regions.length && regions.every(region=>region.rectangular)?Math.min(0.08,regions.length*0.025):0;
                    const shapeEvidence=Math.min(0.3,Math.log2(Math.max(1,width))*0.025);
                    const score=Math.min(1,c.score*0.72+quality*0.18+shapeEvidence+regionEvidence*0.4);
                    // Retain evidence only; candidate tables can be collected now.
                    evaluations.push({parser,score,quality,structural:c.structural,reason:c.reason,regions});
                } catch (_) { /* An incompatible bounded probe is not a source failure. */ }
            };
            sniff.candidates.slice(0,6).forEach(evaluate);
            if(!evaluations.length && sample.text.trim())this.parsers.filter(parser=>parser.id!=='html-table').forEach(parser=>evaluate({id:parser.id,score:0.25}));
            evaluations.sort((a,b)=>b.score-a.score);
            const structure=evaluations.find(item=>item.structural && item.quality>=0.2);
            if(structure){evaluations=[structure,...evaluations.filter(item=>item!==structure)];break;}
            if(!sample.truncated || (evaluations.length && (evaluations.length===1 || evaluations[0].score-evaluations[1].score>=0.12)))break;
        }
        const scoreGap=evaluations.length>1?evaluations[0].score-evaluations[1].score:Infinity;
        const lowScore=Boolean(evaluations[0] && !evaluations[0].structural && evaluations[0].score<0.55);
        const ambiguous=Boolean(evaluations[0] && !evaluations[0].structural && (scoreGap<0.12 || lowScore));
        const diagnostics=[...(sniff.diagnostics || [])];
        if(ambiguous && !diagnostics.some(item=>item.code==='FORMAT_AMBIGUOUS'))diagnostics.push({severity:'warning',code:'FORMAT_AMBIGUOUS',message:'格式证据不足或多个候选接近；请在解析详情中选择格式后重试'});
        if(truncated && !evaluations.length && source.text.length)diagnostics.push({severity:'warning',code:'DETECTION_BUDGET',message:'识别样本中没有完整可解析记录，请手动选择格式'});
        return {format:ambiguous?'ambiguous':evaluations[0]?.parser.id || 'empty',candidates:evaluations.slice(0,3).map(item=>candidate(item.parser,item.score,{reason:item.reason,ambiguous})),diagnostics,sampleLength};
    },
    parse(input, options={}) {
        const source=typeof input==='string'?{text:input,html:options.html || ''}:{text:input.text || '',html:input.html || ''};
        const originalText=source.text;
        source.text=TableUtils.normalizeText(source.text);
        const selectedRegions=normalizeRegionSelection(options.regionSelection,source.text,id=>this.getParser(id));
        if(selectedRegions) {
            const parser=this.getParser(selectedRegions.format);
            const parsed=parseRegions(parser,source.text,selectedRegions.regions,options);
            mapTableRangesToSource(parsed.tables,originalText);
            const diagnostics=collectDiagnostics(parsed.diagnostics,parsed.tables.flatMap(table=>table.diagnostics||[]),[
                {severity:'info',code:'TABLE_REGIONS_CONFIRMED',message:`已按用户确认的 ${selectedRegions.regions.length} 个表格区域解析。`}
            ]);
            return this.resolveHeaderAmbiguity({tables:parsed.tables,format:parser.id,label:parser.label,diagnostics,candidates:[{id:parser.id,label:parser.label,score:1,manual:true}],sourceLength:source.text.length},options,selectedRegions);
        }
        const detection=this.detect(source,options);
        const chosen=this.getParser(detection.format);
        if(!chosen)return {tables:[],format:detection.format,label:detection.format==='ambiguous'?'请确认输入格式':'未识别出表格',diagnostics:detection.diagnostics,candidates:detection.candidates};
        let parsed;
        const regionScan=findParserRegions(source.text,chosen.id);
        if(regionScan.overBudget) {
            return {tables:[],format:'ambiguous',label:'表格区域过多，需确认',diagnostics:collectDiagnostics(detection.diagnostics,[{severity:'warning',code:'TABLE_REGION_BUDGET',message:`检测到超过 ${MAX_TABLE_REGIONS} 个候选区域；为避免误合并，请拆分输入后再解析。`}]),candidates:detection.candidates,sourceLength:source.text.length};
        }
        if(regionScan.regions.length && !regionScan.regions.every(region=>region.rectangular)) {
            const regionSelection={format:chosen.id,regions:regionScan.regions.map(({start,end})=>({start,end}))};
            const offsetMap=mapNormalizedOffsetsToSource(originalText,regionScan.regions.flatMap(region=>[region.start,region.end]));
            const irregular=regionScan.regions.map((region,index)=>({region,index})).filter(item=>!item.region.rectangular);
            const regionSummary=irregular.slice(0,5).map(({region,index})=>`区域 ${index+1}：原文字符 ${offsetMap.get(region.start)+1}–${offsetMap.get(region.end)}，${region.rowCount} 条记录，主列数 ${region.width}，列宽一致率 ${Math.round(region.coverage*100)}%`).join('；');
            const extraRegions=irregular.length>5?`；另有 ${irregular.length-5} 个宽度不稳定区域` : '';
            const candidate={kind:'region-set',id:chosen.id,format:chosen.id,label:`确认 ${regionScan.regions.length} 个表格区域`,reason:`检测到行列宽度变化。${regionSummary}${extraRegions}。确认后会保留溢出值并显示诊断。`,preview:previewRegion(source.text,irregular[0]?.region||regionScan.regions[0]),regionSelection};
            return {tables:[],format:'ambiguous',label:'表格区域需要确认',diagnostics:collectDiagnostics(detection.diagnostics,[{severity:'warning',code:'TABLE_REGION_AMBIGUOUS',message:'候选表格行列宽度不一致。请在解析详情中确认区域后继续，系统不会静默合并或丢弃异常行。'}]),candidates:[candidate],sourceLength:source.text.length};
        }
        if(regionScan.regions.length) parsed=parseRegions(chosen,source.text,regionScan.regions,options);
        else parsed=chosen.parse(source,options);
        const tables=parsed.tables || [];
        mapTableRangesToSource(tables,originalText);
        const outsideText=regionScan.regions.length && (
            regionScan.regions.length>1 || source.text.slice(0,regionScan.regions[0].start).trim() || source.text.slice(regionScan.regions.at(-1).end).trim()
        );
        const regionDiagnostics=outsideText?[{severity:'info',code:'TABLE_REGIONS_EXTRACTED',message:`已从混杂文本中提取 ${regionScan.regions.length} 个结构稳定的表格区域；原文仍完整保留。`}]:[];
        const diagnostics=collectDiagnostics(detection.diagnostics,parsed.diagnostics,tables.flatMap(table=>table.diagnostics||[]),regionDiagnostics);
        const result={tables,format:chosen.id,label:chosen.label,diagnostics,candidates:detection.candidates,sourceLength:source.text.length};
        return this.resolveHeaderAmbiguity(result,options,regionScan.regions.length?{format:chosen.id,regions:regionScan.regions.map(({start,end})=>({start,end}))}:null);
    },
    resolveHeaderAmbiguity(result,options={},regionSelection=null) {
        if((options.headerMode||'auto')!=='auto')return result;
        const uncertain=(result.tables||[]).filter(table=>table.meta?.headerAmbiguous);
        if(!uncertain.length)return result;
        const reasonTables=uncertain.map(table=>table.name).join('、');
        const candidates=[
            {kind:'header-mode',id:result.format,format:result.format,headerMode:'first-row',label:'本次解析：首行作为表头',reason:`${reasonTables} 的首行既可能是字段名，也可能是数据；选择会应用于当前输入中的所有表格，不更改之后的自动设置。`,regionSelection},
            {kind:'header-mode',id:result.format,format:result.format,headerMode:'none',label:'本次解析：首行作为数据',reason:`${reasonTables} 的首行既可能是字段名，也可能是数据；选择会应用于当前输入中的所有表格，不更改之后的自动设置。`,regionSelection}
        ];
        return {tables:[],format:'ambiguous',resolvedFormat:result.format,label:'表头需要确认',diagnostics:collectDiagnostics(result.diagnostics,[{severity:'warning',code:'HEADER_AMBIGUOUS',message:`${reasonTables} 的首行表头证据不足；请选择首行作为表头或数据后重试。`}]),candidates,sourceLength:result.sourceLength};
    }
};

    return { ImportEngine };
});
