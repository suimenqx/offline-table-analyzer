OTA.define('cli-multi-block-parser', ["table-utils","header-resolver","text-layout","parser-helpers"], ({TableUtils}, {HeaderResolver}, {TextLayout}, H) => {
/* CLI multi-block fixed-width table parser */
const CliMultiBlockParser = {
    id:'cli-multi-block', label:'CLI 多块定宽表',
    parse(source, options={}) {
        const lines = TableUtils.lines(source.text || '');
        const inspected = H.inspectCliMultiBlock(source);
        const markerIndexes = inspected.markerIndexes;
        const tables = [];
        const diagnostics = [];
        const used = new Set();
        const titleCounts = new Map();
        let previousTitle = null;
        let previousWidth = 0;
        const addDiagnostic = (item) => diagnostics.push({ severity:'warning', ...item });

        for(let i = 0; i < markerIndexes.length; i++) {
            const markerIndex = markerIndexes[i];
            const title = H.cliTitleBeforeMarker(lines, markerIndex, markerIndexes, i, previousTitle, previousWidth);
            if(title) previousTitle = title;
            const parts = H.cliBlockParts(lines, markerIndex, markerIndexes[i + 1]);
            if(!parts.hasSeparator) {
                addDiagnostic({ code:'MISSING_SEPARATOR', block:i + 1, message:`CLI 块 ${i + 1} 缺少 ---- 表头/数据分隔线` });
                continue;
            }
            if(!parts.headerLine) {
                addDiagnostic({ code:'MISSING_HEADER', block:i + 1, message:`CLI 块 ${i + 1} 缺少表头行` });
                continue;
            }
            if(!parts.dataLines.length) {
                addDiagnostic({ code:'EMPTY_TABLE_BLOCK', block:i + 1, message:`CLI 块 ${i + 1} 的 ---- 分隔线后没有数据行` });
                continue;
            }
            const ranges = H.cliDisplayRanges(parts.headerLine, parts.dataLines);
            if(!ranges.length) {
                addDiagnostic({ code:'MISSING_HEADER', block:i + 1, message:`CLI 块 ${i + 1} 缺少有效表头列` });
                continue;
            }
            previousWidth = ranges.length;
            const rawHeaders = ranges.map(range => H.sliceByDisplayColumns(parts.headerLine, range.s, range.e));
            const blockDiagnostics = [];
            if(ranges[0].generated) {
                blockDiagnostics.push({ severity:'warning', code:'MISSING_FIRST_HEADER', row:1, message:'CLI 表格首列无表头，已生成 Column1' });
            }
            const rows = [];
            parts.dataLines.forEach((line, rowIndex) => {
                const sliced = ranges.map(range => H.sliceByDisplayColumns(line, range.s, range.e));
                const fallback = H.cliWhitespaceParts(line);
                const positioned = ranges.every(range => H.cliDisplayTokenStarts(line).includes(range.s));
                const widthMismatch = fallback.length > ranges.length || (fallback.length < ranges.length && !positioned);
                if(widthMismatch) {
                    blockDiagnostics.push({ severity:'warning', code:'ROW_WIDTH_MISMATCH', row:rowIndex + 1, message:`CLI 数据行 ${rowIndex + 1} 列数为 ${fallback.length}，目标列数为 ${ranges.length}` });
                }
                const positionMismatch = fallback.length >= ranges.length && (
                    fallback.length !== ranges.length || fallback.some((value, index) => value !== sliced[index])
                );
                const values = positionMismatch ? fallback : sliced;
                if(positionMismatch) {
                    blockDiagnostics.push({ severity:'warning', code:'POSITION_MISMATCH', row:rowIndex + 1, message:`CLI 定宽数据行 ${rowIndex + 1} 的位置截取与空白分割不一致，已按空白分割保留值` });
                }
                if(!TableUtils.isEmptyRow(values)) rows.push(values);
            });
            if(!rows.length) {
                addDiagnostic({ code:'EMPTY_TABLE_BLOCK', block:i + 1, message:`CLI 块 ${i + 1} 没有有效数据行` });
                continue;
            }
            const baseName = title || null;
            let requestedName;
            if(baseName) {
                const count = (titleCounts.get(baseName) || 0) + 1;
                titleCounts.set(baseName, count);
                requestedName = count > 1 ? `${baseName} (${count})` : baseName;
            } else {
                requestedName = `CLI Block Table ${tables.length + 1}`;
            }
            const name = TableUtils.makeTableName(requestedName, tables.length, used);
            const resolved = HeaderResolver.infer([rawHeaders, ...rows], { ...options, hasHeader:true, tableName:name });
            resolved.diagnostics.push(...blockDiagnostics.map(item => ({ ...item, table:name })));
            resolved.name = name;
            resolved.sourceType = this.id;
            resolved.meta = {
                delimiter:'position',
                hasHeader:resolved.hasHeader,
                generatedHeaders:resolved.generatedHeaders,
                headerConfidence:resolved.headerConfidence,
                blockIndex:i + 1
            };
            tables.push(resolved);
        }
        if(!markerIndexes.length && options.format === this.id) {
            addDiagnostic({ code:'MISSING_SEPARATOR', message:'未检测到 ==== CLI 块起始分隔线' });
        }
        return {
            tables,
            diagnostics:[...diagnostics, ...tables.flatMap(table => table.diagnostics || [])]
        };
    }
};
return CliMultiBlockParser;
});
