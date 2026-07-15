OTA.define('text-layout', [], () => {
/*
 * Position-aware layout inference for delimiter-free text.
 *
 * A header is not necessarily formatted like a data row: a label such as
 * "Physical dascacsa" may contain a single space while the corresponding
 * data column starts much farther to the right.  Data rows usually provide
 * the stronger evidence because their fields repeat at stable display
 * positions.  This module keeps that evidence separate from header semantics
 * so other text parsers can reuse it without duplicating slicing logic.
 */

function terminalCodePointWidth(codePoint) {
    if(codePoint === 0 || codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
    if((codePoint >= 0x0300 && codePoint <= 0x036f) ||
        (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
        (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
        (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
        (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
        (codePoint >= 0xfe20 && codePoint <= 0xfe2f) ||
        (codePoint >= 0xe0100 && codePoint <= 0xe01ef)) return 0;
    const wide = codePoint >= 0x1100 && (
        codePoint <= 0x115f || codePoint === 0x2329 || codePoint === 0x232a ||
        (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
        (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
        (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
        (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
        (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
        (codePoint >= 0xff00 && codePoint <= 0xff60) ||
        (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
        (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
        (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    );
    return wide ? 2 : 1;
}

function displayWidth(value='') {
    let width = 0;
    for(const char of String(value)) width += terminalCodePointWidth(char.codePointAt(0));
    return width;
}

function tokenize(line='') {
    const tokens = [];
    const source = String(line || '');
    const regex = /\S+/g;
    let match;
    let previousEnd = 0;
    while((match = regex.exec(source)) !== null) {
        const start = displayWidth(source.substring(0, match.index));
        const end = start + displayWidth(match[0]);
        tokens.push({
            text:match[0],
            start,
            end,
            gap:displayWidth(source.substring(previousEnd, match.index))
        });
        previousEnd = match.index + match[0].length;
    }
    return tokens;
}

function starts(line='', options={}) {
    const minGap = Number.isFinite(options.minGap) ? options.minGap : 2;
    return tokenize(line)
        .filter((token, index) => index === 0 || token.gap >= minGap)
        .map(token => token.start);
}

function near(value, target, tolerance=1) {
    return Math.abs(value - target) <= tolerance;
}

function lineHasStart(line, start, options={}) {
    const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 1;
    return starts(line, options).some(value => near(value, start, tolerance));
}

function clusterStarts(lines=[], options={}) {
    const source = (lines || []).filter(line => String(line || '').trim());
    if(!source.length) return [];
    const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 1;
    const minSupport = Number.isFinite(options.minSupport) ? options.minSupport : Math.max(1, Math.ceil(source.length * 0.6));
    const observations = source.flatMap(line => starts(line, options));
    const positions = [...new Set(observations)].sort((a, b) => a - b);
    const clusters = [];
    positions.forEach(position => {
        const previous = clusters[clusters.length - 1];
        if(previous && position - previous.max <= tolerance) {
            previous.positions.push(position);
            previous.max = position;
        } else {
            clusters.push({ positions:[position], max:position });
        }
    });
    return clusters.map(cluster => {
        const positionCounts = new Map();
        cluster.positions.forEach(position => positionCounts.set(position, (positionCounts.get(position) || 0) + 1));
        const representative = [...positionCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
        const support = source.reduce((count, line) => lineHasStart(line, representative, { ...options, tolerance }) ? count + 1 : count, 0);
        return { start:representative, support, ratio:support / source.length };
    }).filter(cluster => cluster.start === 0 || cluster.support >= minSupport);
}

function slice(line='', start=0, end=Infinity) {
    let column = 0;
    let value = '';
    for(const char of String(line || '')) {
        const next = column + terminalCodePointWidth(char.codePointAt(0));
        if(column >= end) break;
        if(next > start && column < end) value += char;
        column = next;
    }
    return value.trim();
}

function rangesFromStarts(columnStarts=[]) {
    return (columnStarts || []).map((start, index) => ({
        s:start,
        e:index + 1 < columnStarts.length ? columnStarts[index + 1] : Infinity
    }));
}

function rowByRanges(line='', ranges=[]) {
    return ranges.map(range => slice(line, range.s, range.e));
}

function supportForStarts(columnStarts=[], dataLines=[], options={}) {
    if(!columnStarts.length || !dataLines.length) return 0;
    const supported = columnStarts.reduce((sum, start) => (
        sum + dataLines.reduce((count, line) => lineHasStart(line, start, options) ? count + 1 : count, 0) / dataLines.length
    ), 0);
    return supported / columnStarts.length;
}

function nonEmptyRatio(values=[]) {
    if(!values.length) return 0;
    return values.filter(value => String(value || '').trim()).length / values.length;
}

function boundaryQuality(line='', columnStarts=[]) {
    const boundaries = (columnStarts || []).slice(1);
    if(!boundaries.length) return 0;
    const tokens = tokenize(line);
    const cuts = boundaries.filter(boundary => tokens.some(token => token.start < boundary && boundary < token.end)).length;
    return 1 - cuts / boundaries.length;
}

function candidateScore(candidate, headerStarts, dataStarts, dataLines) {
    const selectedStarts = candidate.source === 'data' ? dataStarts : headerStarts;
    const support = supportForStarts(selectedStarts, dataLines);
    const ranges = rangesFromStarts(selectedStarts);
    const headers = ranges.map(range => slice(candidate.headerLine, range.s, range.e));
    const coverage = nonEmptyRatio(headers);
    const boundaries = boundaryQuality(candidate.headerLine, selectedStarts);
    const isBody = candidate.source === 'data';
    const countDiff = dataStarts.length && headerStarts.length !== dataStarts.length ? 0.10 : 0;
    const canonical = isBody && dataStarts.length !== headerStarts.length ? 0.08 : 0;
    const missingColumns = isBody && dataStarts.length < headerStarts.length ? -0.30 : 0;
    const headerBias = !isBody && coverage >= 1 && support >= 0.5 ? 0.04 : 0;
    return {
        starts:selectedStarts,
        source:candidate.source,
        support,
        headerCoverage:coverage,
        headerBoundaryQuality:boundaries,
        score:Math.max(0, Math.min(1, support * 0.40 + coverage * 0.25 + boundaries * 0.35 + countDiff + canonical + missingColumns + headerBias))
    };
}

function inferAligned(headerLine='', dataLines=[], options={}) {
    const header = String(headerLine || '');
    const body = (dataLines || []).filter(line => String(line || '').trim());
    const headerStarts = starts(header, options);
    const dataClusters = clusterStarts(body, options);
    const dataStarts = dataClusters.map(cluster => cluster.start);
    if(headerStarts.length < 2 && dataStarts.length < 2) {
        return { headerLine:header, dataLines:body, starts:[], ranges:[], headers:[], rows:[], score:0, source:null, headerCoverage:0, dataSupport:0 };
    }
    const candidates = [];
    if(headerStarts.length >= 2) candidates.push(candidateScore({ headerLine:header, source:'header' }, headerStarts, dataStarts, body));
    if(dataStarts.length >= 2) candidates.push(candidateScore({ headerLine:header, source:'data' }, headerStarts, dataStarts, body));
    const completeCandidates = candidates.filter(candidate => candidate.headerCoverage >= 1);
    const rankedCandidates = completeCandidates.length ? completeCandidates : candidates;
    rankedCandidates.sort((a, b) => b.score - a.score || (a.source === 'data' ? -1 : 1));
    const chosen = rankedCandidates[0] || { starts:headerStarts, source:'header', support:0, headerCoverage:0, score:0 };
    const ranges = rangesFromStarts(chosen.starts);
    const headers = ranges.map(range => slice(header, range.s, range.e));
    const rows = body.map(line => rowByRanges(line, ranges));
    return {
        headerLine:header,
        dataLines:body,
        starts:chosen.starts,
        ranges,
        headers,
        rows,
        score:chosen.score,
        source:chosen.source,
        headerCoverage:chosen.headerCoverage,
        dataSupport:chosen.support,
        headerTokenCount:headerStarts.length,
        dataColumnCount:dataStarts.length,
        dataStartClusters:dataClusters
    };
}

    return { TextLayout:{ displayWidth, tokenize, starts, clusterStarts, slice, rangesFromStarts, rowByRanges, inferAligned } };
});
