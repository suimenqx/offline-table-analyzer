OTA.define('aligned-table-parser', ["table-utils","header-resolver","text-layout","parser-helpers"], ({TableUtils}, {HeaderResolver}, {TextLayout}, H) => {
/* Aligned fixed-width table parser (delimiter-free reports with separator lines) */
const AlignedTableParser = {
    id:'aligned-table', label:'定宽对齐表格',
    parse(source, options={}) {
        const blocks = H.alignedBlocks(source);
        const merged = [];
        for(let i = 0; i < blocks.length; i++) {
            const b = blocks[i];
            const nextBlock = blocks[i + 1];
            const nextOwnHeader = nextBlock && nextBlock.length >= 2
                ? H.inspectAlignedHeader(nextBlock[0], nextBlock.slice(1))
                : null;
            const nextContainsHeader = Boolean(nextOwnHeader && nextOwnHeader.analysis.score >= 0.65);
            if(b.length === 1 && nextBlock &&
                (H.isAlignedColumnLine(b[0]) || (H.isStrongAlignedHeader(b[0], nextBlock) && !nextContainsHeader))) {
                merged.push([b[0], ...blocks[i + 1]]);
                i++;
            } else {
                merged.push(b);
            }
        }
        const tables = []; const used = new Set(); let pendingName = null;
        for(const block of merged) {
            if(block.length < 2) {
                if(block.length === 1) pendingName = block[0].trim();
                continue;
            }
            const headerLine = block[0];
            const layout = TextLayout.inferAligned(headerLine, block.slice(1));
            const ranges = layout.ranges;
            if(ranges.length < 2 || layout.headerCoverage < 1) continue;
            const headers = layout.headers;
            const rows = [];
            const blockDiagnostics = [];
            for(let i = 1; i < block.length; i++) {
                const sliced = TextLayout.rowByRanges(block[i], ranges);
                const fallback = block[i].trim().split(/\s{2,}/).map(v => v.trim());
                const positionMismatch = fallback.length >= ranges.length && (
                    fallback.length !== ranges.length || fallback.some((value, index) => value !== sliced[index])
                );
                const vals = positionMismatch ? fallback : sliced;
                const alignedStartMatch = layout.starts.length
                    ? layout.starts.filter(start => TextLayout.starts(block[i]).some(actual => Math.abs(actual - start) <= 1)).length / layout.starts.length
                    : 0;
                const shouldDiagnoseMismatch = positionMismatch && (
                    layout.source !== 'header' || alignedStartMatch >= 0.6
                );
                if(shouldDiagnoseMismatch) {
                    blockDiagnostics.push({
                        severity:'warning',
                        code:'ALIGNED_POSITION_MISMATCH',
                        table:'',
                        row:i,
                        message:`定宽对齐行 ${i} 的实际分隔位置与表头不一致，已按空白分隔保留溢出值`
                    });
                }
                if(vals.every(v => !v)) continue;
                rows.push(vals);
            }
            if(!rows.length) continue;
            const name = TableUtils.makeTableName(pendingName || 'Aligned Table', tables.length, used);
            pendingName = null;
            const resolved = HeaderResolver.infer([headers, ...rows], { ...options, hasHeader:true, tableName:name });
            resolved.diagnostics.push(...blockDiagnostics.map(item => ({ ...item, table:name })));
            resolved.name = name;
            resolved.sourceType = this.id;
            resolved.meta = {
                delimiter:'position',
                hasHeader:resolved.hasHeader,
                generatedHeaders:resolved.generatedHeaders,
                headerConfidence:resolved.headerConfidence,
                layoutSource:layout.source,
                layoutScore:layout.score,
                dataColumnSupport:layout.dataSupport
            };
            tables.push(resolved);
        }
        if(!tables.length && options.format === this.id) {
            return { tables:[], diagnostics:[{ severity:'warning', code:'NO_ALIGNED_TABLE', message:'未检测到定宽对齐表格' }] };
        }
        return { tables, diagnostics:tables.flatMap(table => table.diagnostics || []) };
    }
};
return AlignedTableParser;
});
