OTA.define('parser-helpers', ["table-utils","header-resolver","text-layout"], ({TableUtils}, {HeaderResolver}, {TextLayout}) => {
/* Shared parser helpers */

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

function sliceByDisplayColumns(line='', start=0, end=Infinity) {
    return TextLayout.slice(line, start, end);
}

function isAlignedSeparator(line='') {
    const value = String(line).trim();
    return value.length >= 3 && /^[\s+-]+$/.test(value) && /-{3,}/.test(value);
}

function isAlignedColumnLine(line='') {
    const words = TextLayout.tokenize(line);
    return words.length >= 2 && words.slice(1).every(word => word.gap >= 2);
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

/* CLI helpers */
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

return {
    splitPipeCells, splitPipeRows, sliceByDisplayColumns,
    isAlignedSeparator, isAlignedColumnLine, alignedBlocks,
    inspectAlignedHeader, isStrongAlignedHeader,
    isCliSeparator, isCliBlockSeparator, isCliDataSeparator,
    collapseCliBlockSeparators, cleanCliTitle, cliTitleBeforeMarker,
    cliBlockParts, cliDisplayTokens, cliDisplayTokenStarts,
    cliDisplayStartSupport, cliDisplayRanges, cliWhitespaceParts,
    inspectCliMultiBlock
};
});
