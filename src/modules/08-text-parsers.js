OTA.define('text-parsers', ["table-utils","header-resolver","text-layout","delimited","delimited-parsers"], ({TableUtils}, {HeaderResolver}, {TextLayout}, {Delimited}, {buildSingleTableResult}) => {
const PipeTableParser = {
    id:'pipe-table', label:'竖线/网页表格文本', delimiter:'|',
    confidence(source) {
        const lines = TableUtils.lines(source.text || '').filter(l => l.trim());
        const pipeLines = lines.filter(l => (l.match(/\|/g) || []).length >= 2);
        if(pipeLines.length < 2) return 0;
        const hasMdSep = lines.some(l => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(l));
        const widths = pipeLines.map(line => {
            let value = line.trim();
            if(value.startsWith('|')) value = value.slice(1);
            if(value.endsWith('|')) value = value.slice(0, -1);
            return splitPipeCells(value).length;
        });
        const mode = new Map();
        widths.forEach(width => mode.set(width, (mode.get(width) || 0) + 1));
        const consistency = Math.max(...mode.values()) / widths.length;
        if(consistency < 0.5) return hasMdSep ? 0.45 : 0.12;
        const hasBareDoublePipe = !hasMdSep && pipeLines.every(line => /\|\|/.test(line) && !/^\s*\|/.test(line) && !/\|\s*$/.test(line));
        if(hasBareDoublePipe) return 0.05;
        return hasMdSep ? 0.9 : 0.62;
    },
    parse(source, options={}) {
        let lines = TableUtils.lines(source.text).filter(l => l.trim());
        const mdSep = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
        const hasMdSep = lines.some(l => mdSep.test(l));
        lines = lines.filter(l => !mdSep.test(l));
        const rows = lines.map(l => {
            let s = l.trim();
            if(s.startsWith('|')) s = s.slice(1);
            if(s.endsWith('|')) s = s.slice(0, -1);
            return splitPipeCells(s);
        }).filter(r => !TableUtils.isEmptyRow(r));
        return buildSingleTableResult(rows, 'Pipe Table 1', this.id, options, { delimiter:'|' }, hasMdSep || options.hasHeader);
    }
};

function splitPipeCells(line='') {
    const cells = [];
    let cell = '', escaped = false;
    for(const ch of String(line)) {
        if(escaped) { cell += ch; escaped = false; continue; }
        if(ch === '\\') { escaped = true; continue; }
        if(ch === '|') { cells.push(cell.trim()); cell = ''; continue; }
        cell += ch;
    }
    if(escaped) cell += '\\';
    cells.push(cell.trim());
    return cells;
}

function splitPipeRows(lines) {
    return lines.map(l => {
        let s = l.trim();
        if(s.startsWith('|')) s = s.slice(1);
        if(s.endsWith('|')) s = s.slice(0, -1);
        return splitPipeCells(s);
    }).filter(r => !TableUtils.isEmptyRow(r));
}

const AsciiTableParser = {
    id:'ascii-table', label:'ASCII/终端表格',
    confidence(source) {
        const text = source.text || '';
        const lines = TableUtils.lines(text).filter(l => l.trim());
        const border = /^[\s+|\-─┌┬┐├┼┤└┴┘│]+$/;
        const borderLines = lines.filter(l => border.test(l.trim()));
        const strongBorderLines = borderLines.filter(l => /[+┌┬┐├┼┤└┴┘]/.test(l));
        const dataLines = lines.filter(l => /[|│]/.test(l) && !border.test(l.trim()));
        return strongBorderLines.length >= 2 && dataLines.length >= 2 ? 0.88 : 0;
    },
    parse(source, options={}) {
        const border = /^[\s+|\-─┌┬┐├┼┤└┴┘│]+$/;
        const lines = TableUtils.lines(source.text)
            .map(l => l.replace(/[│┃]/g, '|'))
            .filter(l => l.trim() && !border.test(l.trim()));
        return buildSingleTableResult(splitPipeRows(lines), 'ASCII Table 1', this.id, options);
    }
};

const FixedWidthParser = {
    id:'fixed-width', label:'固定宽度/多空格表格',
    confidence(source) {
        const lines = TableUtils.lines(source.text || '').filter(l => l.trim());
        if(lines.length < 2 || /\t|,/.test(source.text || '')) return 0;
        const splitRows = lines.slice(0, 20).map(l => l.trim().split(/\s{2,}/));
        const widths = splitRows.map(r => r.length).filter(n => n > 1);
        if(widths.length < 2) return 0;
        const common = widths.filter(w => w === widths[0]).length / widths.length;
        return common >= 0.55 ? 0.56 + common * 0.18 : 0.22;
    },
    parse(source, options={}) {
        const rows = TableUtils.lines(source.text).filter(l => l.trim()).map(l => l.trim().split(/\s{2,}/).map(v => v.trim()));
        return buildSingleTableResult(rows, 'Fixed Width Table 1', this.id, options);
    }
};

function isCliSeparator(line='', marker='=') {
    const compact = String(line || '').replace(/\s/g, '');
    if(compact.length < 10) return false;
    const count = compact.split(marker).length - 1;
    if(count < 10 || count / compact.length < 0.6) return false;
    return marker === '=' ? /^[=|]+$/.test(compact) : /^[-|]+$/.test(compact);
}

function isCliBlockSeparator(line='') {
    return isCliSeparator(line, '=');
}

function isCliDataSeparator(line='') {
    return isCliSeparator(line, '-');
}

function collapseCliBlockSeparators(lines=[]) {
    const indexes = [];
    lines.forEach((line, index) => {
        if(!isCliBlockSeparator(line)) return;
        const previous = indexes[indexes.length - 1];
        if(previous !== undefined && lines.slice(previous + 1, index).every(line => !line.trim())) return;
        indexes.push(index);
    });
    return indexes;
}

function cleanCliTitle(line='') {
    const title = String(line || '').trim().replace(/\s*:\s*$/, '');
    return title || null;
}

function cliTitleBeforeMarker(lines, markerIndex, markerIndexes, ordinal, previousTitle, previousWidth) {
    const start = ordinal > 0 ? markerIndexes[ordinal - 1] + 1 : 0;
    const before = lines.slice(start, markerIndex);
    if(ordinal === 0) {
        for(let i = before.length - 1; i >= 0; i--) {
            if(before[i].trim() && !isCliBlockSeparator(before[i]) && !isCliDataSeparator(before[i])) {
                return cleanCliTitle(before[i]);
            }
        }
        return null;
    }
    let lastBlank = -1;
    before.forEach((line, index) => { if(!line.trim()) lastBlank = index; });
    if(lastBlank < 0) {
        for(let i = before.length - 1; i >= 0; i--) {
            if(!before[i].trim() || isCliBlockSeparator(before[i]) || isCliDataSeparator(before[i])) continue;
            if(previousWidth && cliWhitespaceParts(before[i]).length === previousWidth) return previousTitle || null;
            return cleanCliTitle(before[i]);
        }
        return previousTitle || null;
    }
    for(let i = before.length - 1; i > lastBlank; i--) {
        if(before[i].trim() && !isCliBlockSeparator(before[i]) && !isCliDataSeparator(before[i])) {
            return cleanCliTitle(before[i]);
        }
    }
    return previousTitle || null;
}

function cliBlockParts(lines, markerIndex, nextMarkerIndex) {
    const chunk = lines.slice(markerIndex + 1, nextMarkerIndex === undefined ? lines.length : nextMarkerIndex);
    const separatorIndex = chunk.findIndex(isCliDataSeparator);
    if(separatorIndex < 0) return { headerLine:null, extraHeaderLines:[], dataLines:[], hasSeparator:false };
    const headerLines = chunk.slice(0, separatorIndex).filter(line =>
        line.trim() && !isCliBlockSeparator(line) && !isCliDataSeparator(line)
    );
    if(!headerLines.length) return { headerLine:null, extraHeaderLines:[], dataLines:[], hasSeparator:true };
    const rawDataLines = [...headerLines.slice(1), ...chunk.slice(separatorIndex + 1)];
    const dataLines = [];
    for(const line of rawDataLines) {
        if(!line.trim()) break;
        if(isCliBlockSeparator(line) || isCliDataSeparator(line)) continue;
        dataLines.push(line);
    }
    return { headerLine:headerLines[0], extraHeaderLines:headerLines.slice(1), dataLines, hasSeparator:true };
}

function cliDisplayTokens(line='') {
    return TextLayout.tokenize(line);
}

function cliDisplayTokenStarts(line='') {
    return cliDisplayTokens(line).map(token => token.start);
}

function cliDisplayStartSupport(start, dataLines=[]) {
    return dataLines.reduce((count, line) => cliDisplayTokenStarts(line).includes(start) ? count + 1 : count, 0);
}

function cliDisplayRanges(headerLine='', dataLines=[]) {
    const tokens = cliDisplayTokens(headerLine);
    const ranges = [];
    const supportThreshold = Math.max(1, Math.ceil(dataLines.length * 0.6));
    tokens.forEach((token, index) => {
        const previous = tokens[index - 1];
        const gap = previous ? token.start - previous.end : Infinity;
        const alignedDataStart = dataLines.length > 0 && cliDisplayStartSupport(token.start, dataLines) >= supportThreshold;
        if(!previous || gap >= 2 || alignedDataStart) {
            ranges.push({ s:token.start });
        }
    });
    if(ranges.length && ranges[0].s > 0) ranges.unshift({ s:0, generated:true });
    for(let i = 0; i < ranges.length; i++) ranges[i].e = i + 1 < ranges.length ? ranges[i + 1].s : Infinity;
    return ranges;
}

function cliWhitespaceParts(line='') {
    return String(line).trim().split(/\s{2,}/).map(value => value.trim()).filter((value, index, values) => values.length === 1 || value !== '' || index < values.length - 1);
}

function inspectCliMultiBlock(source) {
    const lines = TableUtils.lines(source.text || '');
    const markerIndexes = collapseCliBlockSeparators(lines);
    let validBlocks = 0;
    let consistent = true;
    for(let i = 0; i < markerIndexes.length; i++) {
        const parts = cliBlockParts(lines, markerIndexes[i], markerIndexes[i + 1]);
        if(!parts.headerLine || !parts.dataLines.length) continue;
        const ranges = cliDisplayRanges(parts.headerLine, parts.dataLines);
        const width = ranges.length;
        if(!width) continue;
        validBlocks++;
        parts.dataLines.forEach(line => {
            const fallbackWidth = cliWhitespaceParts(line).length;
            const positioned = ranges.every(range => cliDisplayTokenStarts(line).includes(range.s));
            if(fallbackWidth >= width ? fallbackWidth !== width : !positioned) consistent = false;
        });
    }
    if(!validBlocks) return { markerIndexes, validBlocks, score:0, consistent:false };
    let score = 0.75;
    if(markerIndexes.length > 1) score += 0.10;
    if(consistent) score += 0.05;
    return { markerIndexes, validBlocks, score:Math.min(0.95, score), consistent };
}

const CliMultiBlockParser = {
    id:'cli-multi-block', label:'CLI 多块定宽表',
    confidence(source) {
        return inspectCliMultiBlock(source).score;
    },
    parse(source, options={}) {
        const lines = TableUtils.lines(source.text || '');
        const inspected = inspectCliMultiBlock(source);
        const markerIndexes = inspected.markerIndexes;
        const tables = [];
        const diagnostics = [];
        const used = new Set();
        const titleCounts = new Map();
        let previousTitle = null;
        let previousWidth = 0;
        const addDiagnostic = (item) => diagnostics.push({ level:'warning', ...item });

        for(let i = 0; i < markerIndexes.length; i++) {
            const markerIndex = markerIndexes[i];
            const title = cliTitleBeforeMarker(lines, markerIndex, markerIndexes, i, previousTitle, previousWidth);
            if(title) previousTitle = title;
            const parts = cliBlockParts(lines, markerIndex, markerIndexes[i + 1]);
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
            const ranges = cliDisplayRanges(parts.headerLine, parts.dataLines);
            if(!ranges.length) {
                addDiagnostic({ code:'MISSING_HEADER', block:i + 1, message:`CLI 块 ${i + 1} 缺少有效表头列` });
                continue;
            }
            previousWidth = ranges.length;
            const rawHeaders = ranges.map(range => sliceByDisplayColumns(parts.headerLine, range.s, range.e));
            const blockDiagnostics = [];
            if(ranges[0].generated) {
                blockDiagnostics.push({ level:'warning', code:'MISSING_FIRST_HEADER', row:1, message:'CLI 表格首列无表头，已生成 Column1' });
            }
            const rows = [];
            parts.dataLines.forEach((line, rowIndex) => {
                const sliced = ranges.map(range => sliceByDisplayColumns(line, range.s, range.e));
                const fallback = cliWhitespaceParts(line);
                const positioned = ranges.every(range => cliDisplayTokenStarts(line).includes(range.s));
                const widthMismatch = fallback.length > ranges.length || (fallback.length < ranges.length && !positioned);
                if(widthMismatch) {
                    blockDiagnostics.push({ level:'warning', code:'ROW_WIDTH_MISMATCH', row:rowIndex + 1, message:`CLI 数据行 ${rowIndex + 1} 列数为 ${fallback.length}，目标列数为 ${ranges.length}` });
                }
                const positionMismatch = fallback.length >= ranges.length && (
                    fallback.length !== ranges.length || fallback.some((value, index) => value !== sliced[index])
                );
                const values = positionMismatch ? fallback : sliced;
                if(positionMismatch) {
                    blockDiagnostics.push({ level:'warning', code:'POSITION_MISMATCH', row:rowIndex + 1, message:`CLI 定宽数据行 ${rowIndex + 1} 的位置截取与空白分割不一致，已按空白分割保留值` });
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

function isAlignedSeparator(line='') {
    const value = String(line).trim();
    // Require a real horizontal run so values such as "--" remain data cells.
    return value.length >= 3 && /^[\s+-]+$/.test(value) && /-{3,}/.test(value);
}

function isAlignedColumnLine(line='') {
    const words = TextLayout.tokenize(line);
    return words.length >= 2 && words.slice(1).every(word => word.gap >= 2);
}

function sliceByDisplayColumns(line='', start=0, end=Infinity) {
    return TextLayout.slice(line, start, end);
}

function alignedBlocks(source) {
    const clean = TableUtils.lines(source.text || '').map(line => isAlignedSeparator(line) ? '' : line);
    const blocks = [];
    let current = [];
    for(const line of clean) {
        if(!line.trim()) {
            if(current.length) { blocks.push(current); current = []; }
        } else current.push(line);
    }
    if(current.length) blocks.push(current);
    return blocks;
}

function inspectAlignedHeader(headerLine='', dataLines=[]) {
    const layout = TextLayout.inferAligned(headerLine, dataLines);
    if(layout.starts.length < 2 || !layout.rows.length || layout.headerCoverage < 1) return null;
    const analysis = HeaderResolver.analyze([layout.headers, ...layout.rows]);
    const structural = layout.score >= 0.72 && layout.dataSupport >= 0.7;
    const headerLike = isAlignedColumnLine(headerLine);
    const semantic = analysis.score >= 0.65;
    if(!headerLike && !semantic) return null;
    return {
        layout,
        analysis,
        score:semantic ? Math.min(0.92, 0.82 + layout.score * 0.08) : (structural ? 0.80 : 0.76)
    };
}

function isStrongAlignedHeader(headerLine='', dataLines=[]) {
    return Boolean(inspectAlignedHeader(headerLine, dataLines));
}

const AlignedTableParser = {
    id:'aligned-table', label:'定宽对齐表格',
    confidence(source) {
        const lines = TableUtils.lines(source.text || '').filter(l => l.trim());
        // CLI multi-block input has a more precise block/header model. Keep
        // the legacy aligned parser from winning auto-detection on its ----
        // separators while preserving explicit aligned-table parsing.
        const hasCliBlock = lines.some(isCliBlockSeparator) && lines.some(isCliDataSeparator);
        if(hasCliBlock) return 0;
        if(!lines.some(isAlignedSeparator)) return 0;
        const blocks = alignedBlocks(source);
        let best = 0;
        blocks.forEach((block, index) => {
            const own = block.length >= 2 ? inspectAlignedHeader(block[0], block.slice(1)) : null;
            if(own) best = Math.max(best, own.score);
            if(block.length === 1 && blocks[index + 1]) {
                const separated = inspectAlignedHeader(block[0], blocks[index + 1]);
                if(separated) best = Math.max(best, Math.min(0.94, separated.score + 0.04));
            }
        });
        return best;
    },
    parse(source, options={}) {
        // 1) 去掉定宽表分隔线（替换为空行，保留表间边界）
        const blocks = alignedBlocks(source);
        // 2) 合并被 --- 隔开的列头 block 与数据 block。
        //    旧规则只看表头自身的多空格；现在优先验证数据行的稳定列起点，
        //    因此 "Physical dascacsa" 这类多词表头仍然可以作为一列。
        const merged = [];
        for(let i = 0; i < blocks.length; i++) {
            const b = blocks[i];
            const nextBlock = blocks[i + 1];
            const nextOwnHeader = nextBlock && nextBlock.length >= 2
                ? inspectAlignedHeader(nextBlock[0], nextBlock.slice(1))
                : null;
            const nextContainsHeader = Boolean(nextOwnHeader && nextOwnHeader.analysis.score >= 0.65);
            if(b.length === 1 && nextBlock &&
                (isAlignedColumnLine(b[0]) || (isStrongAlignedHeader(b[0], nextBlock) && !nextContainsHeader))) {
                merged.push([b[0], ...blocks[i + 1]]);
                i++;
            } else {
                merged.push(b);
            }
        }
        // 4) 逐 block：首行 → 列头定位（复用 CLI FIXED 模式），后续行 → 位置截取
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
                // A wide/CJK header can legitimately be longer than the
                // values below it. Only report a position mismatch when the
                // row still follows most of the header's physical starts;
                // that keeps overflow warnings while avoiding false alarms
                // for a valid fallback split caused by long header labels.
                const shouldDiagnoseMismatch = positionMismatch && (
                    layout.source !== 'header' || alignedStartMatch >= 0.6
                );
                if(shouldDiagnoseMismatch) {
                    blockDiagnostics.push({
                        level:'warning',
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
            return { tables:[], diagnostics:[{ level:'warning', code:'NO_ALIGNED_TABLE', message:'未检测到定宽对齐表格' }] };
        }
        return { tables, diagnostics:tables.flatMap(table => table.diagnostics || []) };
    }
};

const PlainTextTableParser = {
    id:'plain-text', label:'空白分隔文本',
    confidence(source) { return (source.text || '').trim() ? 0.08 : 0; },
    parse(source, options={}) {
        const rows = TableUtils.lines(source.text).filter(l => l.trim()).map(l => l.trim().split(/\s+/));
        return buildSingleTableResult(rows, 'Text Table 1', this.id, options);
    }
};

const CliTableDataParser = {
    id:'cli-table-data', label:'CLI table-data',
    confidence(source) { return /table-data/i.test(source.text || '') ? 1 : 0; },
    tableNameFromLine(line, index, used) {
        const lower = String(line || '').toLowerCase();
        const pos = lower.lastIndexOf('table-data');
        const tail = pos >= 0 ? line.slice(pos + 'table-data'.length).trim() : '';
        const name = (tail.split(/\s+/)[0] || `T${index + 1}`).replace(/[|,;]+$/g, '');
        return TableUtils.makeTableName(name, index, used);
    },
    parse(source, options={}) {
        const lines = TableUtils.lines(source.text);
        const tables = [];
        const used = new Set();
        let cur = null;
        let inData = false;
        let ranges = [];
        const finalize = () => {
            if(!cur) return;
            if(cur.headers.length) {
                const diagnostics = [];
                const widest = TableUtils.maxWidth(cur.rows);
                while(cur.headers.length < widest) cur.headers.push(`Column${cur.headers.length + 1}`);
                cur.headers = TableUtils.ensureUniqueHeaders(cur.headers);
                cur.rows = TableUtils.normalizeRows(cur.rows, cur.headers.length, diagnostics, cur.name);
                cur.sourceType = this.id;
                cur.meta = { mode:cur.mode || 'WS', hasHeader:true, generatedHeaders:false, headerRule:'validflag' };
                cur.diagnostics = diagnostics;
                tables.push(cur);
            }
            cur = null;
            inData = false;
            ranges = [];
        };
        const parseByMode = (line) => {
            const trim = line.trim();
            const wsParts = trim.split(/\s+/);
            if(wsParts.length === cur.headers.length) return wsParts;
            if(cur.mode === 'FIXED') return ranges.map(r => (r.s >= line.length) ? '' : line.substring(r.s, Math.min(r.e, line.length)).trim());
            if(cur.mode === 'TAB') return Delimited.parse(trim, '\t')[0] || [];
            if(cur.mode === 'CSV') return Delimited.parse(trim, ',')[0] || [];
            if(cur.mode === 'PIPE') return splitPipeCells(trim.replace(/^\||\|$/g, ''));
            return wsParts;
        };
        const setValidFlagHeader = (line) => {
            const trim = line.trim();
            if(line.includes('\t')) {
                cur.mode = 'TAB';
                cur.headers = TableUtils.ensureUniqueHeaders(trim.split('\t'));
                return;
            }
            if(line.includes(',') && !line.includes('  ')) {
                cur.mode = 'CSV';
                cur.headers = TableUtils.ensureUniqueHeaders(Delimited.parse(trim, ',')[0] || []);
                return;
            }
            if((line.match(/\|/g) || []).length >= 2) {
                cur.mode = 'PIPE';
                cur.headers = TableUtils.ensureUniqueHeaders(splitPipeCells(trim.replace(/^\||\|$/g, '')));
                return;
            }
            cur.mode = 'FIXED';
            ranges = [];
            const regex = /\S+/g;
            let m;
            while((m = regex.exec(line)) !== null) ranges.push({s:m.index, e:null});
            for(let k=0; k<ranges.length; k++) ranges[k].e = (k === ranges.length - 1) ? 99999 : ranges[k+1].s;
            cur.headers = TableUtils.ensureUniqueHeaders(ranges.map(r => line.substring(r.s, Math.min(r.e, line.length)).trim()));
        };
        lines.forEach((line) => {
            const trim = line.trim();
            if(line.toLowerCase().includes('table-data')) {
                finalize();
                cur = { name:this.tableNameFromLine(line, tables.length, used), headers:[], rows:[], mode:'WS', diagnostics:[] };
                inData = false;
                return;
            }
            if(!cur) return;
            if(trim.toLowerCase().startsWith('validflag')) {
                setValidFlagHeader(line);
                inData = true;
                return;
            }
            if(!inData) return;
            if(trim.startsWith('<') || trim.startsWith('[')) { finalize(); return; }
            if(!trim) return;
            cur.rows.push(parseByMode(line));
        });
        finalize();
        return { tables, diagnostics:tables.flatMap(table => table.diagnostics || []) };
    }
};

    return { PipeTableParser, AsciiTableParser, FixedWidthParser, AlignedTableParser, PlainTextTableParser, CliTableDataParser, CliMultiBlockParser };
});
