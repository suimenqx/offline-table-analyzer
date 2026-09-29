OTA.define('json-parser', ["table-utils", "header-resolver"], ({TableUtils}, {HeaderResolver}) => {
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const cellText = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);

// Parse copied JSON-like data without evaluating it as JavaScript. The lexer keeps
// punctuation inside strings inert, so braces and commas in cell values are safe.
function looseLexer(text) {
    let offset = 0;
    let relaxed = false;
    const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    return {
        get relaxed() { return relaxed; },
        next() {
            while(offset < text.length) {
                const ch = text[offset];
                if(/\s/.test(ch)) { offset++; continue; }
                if(text.startsWith('//', offset)) {
                    relaxed = true;
                    offset = text.indexOf('\n', offset + 2);
                    if(offset < 0) offset = text.length;
                    continue;
                }
                if(text.startsWith('/*', offset)) {
                    relaxed = true;
                    const end = text.indexOf('*/', offset + 2);
                    if(end < 0) throw new Error('注释未闭合');
                    offset = end + 2;
                    continue;
                }
                break;
            }
            const start = offset;
            if(start >= text.length) return { type:'eof', start, end:start };
            const ch = text[offset++];
            if('{}[]:,'.includes(ch)) return { type:ch, start, end:offset };
            if(ch === '"' || ch === "'") {
                if(ch === "'") relaxed = true;
                let value = '';
                while(offset < text.length) {
                    const next = text[offset++];
                    if(next === ch) return { type:'string', value, start, end:offset };
                    if(next !== '\\') { value += next; continue; }
                    if(offset >= text.length) break;
                    const escaped = text[offset++];
                    if(escaped === 'u' || escaped === 'x') {
                        const size = escaped === 'u' ? 4 : 2;
                        const digits = text.slice(offset, offset + size);
                        if(digits.length !== size || !/^[0-9a-fA-F]+$/.test(digits)) throw new Error('字符串转义无效');
                        value += String.fromCharCode(parseInt(digits, 16));
                        offset += size;
                        if(escaped === 'x') relaxed = true;
                    } else if(escaped === '\n') {
                        relaxed = true;
                    } else {
                        const escapes = { b:'\b', f:'\f', n:'\n', r:'\r', t:'\t' };
                        if(!'"\'\\/'.includes(escaped) && !Object.hasOwn(escapes, escaped)) throw new Error('字符串转义无效');
                        value += Object.hasOwn(escapes, escaped) ? escapes[escaped] : escaped;
                    }
                }
                throw new Error('字符串未闭合');
            }
            if(ch === '-' || /[0-9]/.test(ch)) {
                numberPattern.lastIndex = start;
                const number = numberPattern.exec(text);
                if(!number) throw new Error('数字格式无效');
                offset = start + number[0].length;
                return { type:'number', value:Number(number[0]), start, end:offset };
            }
            if(/[A-Za-z_$]/.test(ch)) {
                while(offset < text.length && /[A-Za-z0-9_$-]/.test(text[offset])) offset++;
                return { type:'identifier', value:text.slice(start, offset), start, end:offset };
            }
            throw new Error(`无法识别位置 ${start + 1} 附近的内容`);
        }
    };
}

function parseLooseCore(text) {
    const lexer = looseLexer(text);
    let token = lexer.next();
    let cropped = false;
    let fragment = false;
    const incomplete = new WeakSet();
    const advance = () => { token = lexer.next(); };
    const fail = () => { throw new Error(`位置 ${token.start + 1} 附近缺少有效字段或分隔符`); };
    const value = (depth=0) => {
        if(depth > 100) throw new Error('嵌套层级过深');
        if(token.type === '{') {
            advance();
            const record = Object.create(null);
            let count = 0;
            while(token.type !== '}') {
                if(token.type === 'eof') {
                    if(!count) fail();
                    cropped = true;
                    incomplete.add(record);
                    return record;
                }
                if(token.type !== 'string' && token.type !== 'identifier') fail();
                if(token.type === 'identifier') fragment = true;
                const key = token.value;
                advance();
                if(token.type !== ':') fail();
                advance();
                if(token.type === 'eof' && count) {
                    cropped = true;
                    incomplete.add(record);
                    return record;
                }
                record[key] = value(depth + 1);
                if(record[key] && typeof record[key] === 'object' && incomplete.has(record[key])) incomplete.add(record);
                count++;
                if(token.type === ',') {
                    advance();
                    if(token.type === '}') fragment = true;
                } else if(token.type !== '}' && token.type !== 'eof') fail();
            }
            advance();
            return record;
        }
        if(token.type === '[') {
            advance();
            const items = [];
            while(token.type !== ']') {
                if(token.type === 'eof') {
                    if(!items.length) fail();
                    cropped = true;
                    return items;
                }
                const item = value(depth + 1);
                if(item && typeof item === 'object' && incomplete.has(item)) cropped = true;
                else items.push(item);
                if(token.type === ',') {
                    advance();
                    if(token.type === ']') fragment = true;
                } else if(token.type !== ']' && token.type !== 'eof') fail();
            }
            advance();
            return items;
        }
        const current = token;
        if(current.type === 'string' || current.type === 'number') { advance(); return current.value; }
        if(current.type === 'identifier') {
            advance();
            if(current.value === 'true') return true;
            if(current.value === 'false') return false;
            if(current.value === 'null') return null;
            fragment = true;
            return current.value;
        }
        fail();
    };

    // A selection may start at the first field rather than at its opening brace.
    let result;
    if(token.type === 'string' || token.type === 'identifier') {
        let key = token.value;
        advance();
        if(token.type !== ':') fail();
        fragment = true;
        const record = Object.create(null);
        while(true) {
            advance();
            if(token.type === 'eof') {
                if(!Object.keys(record).length) fail();
                cropped = true;
                break;
            }
            record[key] = value(1);
            if(token.type === 'eof') break;
            if(token.type !== ',') fail();
            advance();
            if(token.type === 'eof') break;
            if(token.type !== 'string' && token.type !== 'identifier') fail();
            key = token.value;
            if(token.type === 'identifier') fragment = true;
            advance();
            if(token.type !== ':') fail();
        }
        result = record;
    } else {
        const values = [value()];
        while(token.type === ',') {
            advance();
            if(token.type === 'eof') { fragment = true; break; }
            values.push(value());
        }
        if(token.type !== 'eof') fail();
        if(values.length > 1) fragment = true;
        result = values.length === 1 ? values[0] : values;
    }
    return { value:result, relaxed:lexer.relaxed || fragment, cropped };
}

function recoverCompleteRecords(text, attempts=0) {
    const lexer = looseLexer(text);
    const stack = [];
    const spans = [];
    try {
        while(true) {
            const token = lexer.next();
            if(token.type === 'eof') break;
            if(token.type === '{' || token.type === '[') stack.push(token);
            else if(token.type === '}' || token.type === ']') {
                const opening = stack.pop();
                if(!opening || (opening.type === '{') !== (token.type === '}')) { stack.length = 0; continue; }
                if(token.type === '}') spans.push({ start:opening.start, end:token.end });
            }
        }
    } catch(_) { /* completed spans before a cut string are still usable */ }
    spans.sort((a, b) => a.start - b.start || b.end - a.end);
    const outer = [];
    let lastEnd = -1;
    for(const span of spans) {
        if(span.start < lastEnd) continue;
        outer.push(span);
        lastEnd = span.end;
    }
    const records = outer.map(span => {
        try { return parseLooseCore(text.slice(span.start, span.end)).value; }
        catch(_) { return null; }
    }).filter(isRecord);
    if(!records.length && attempts < 20) {
        // The selection can start halfway through a quoted value. Resume at
        // the next apparent record boundary if that prefix confused the lexer.
        const boundary = /(?:,|\n)\s*\{/.exec(text);
        if(boundary) {
            const start = boundary.index + boundary[0].lastIndexOf('{');
            if(start > 0) return recoverCompleteRecords(text.slice(start), attempts + 1);
        }
    }
    if(!records.length) throw new Error('无法从片段提取完整记录');
    return { value:records, relaxed:true, cropped:true };
}

function parseTable(values, name, options) {
    if(!values.length) throw new Error(`JSON 表格“${name}”没有记录`);
    if(values.every(isRecord)) {
        const keys = [];
        const seen = new Set();
        values.forEach(record => Object.keys(record).forEach(key => {
            if(!seen.has(key)) { seen.add(key); keys.push(key); }
        }));
        if(!keys.length) throw new Error(`JSON 表格“${name}”没有字段`);
        return {
            name,
            headers:TableUtils.ensureUniqueHeaders(keys),
            rows:values.map(record => keys.map(key => cellText(record[key]))),
            sourceType:'json',
            meta:{ hasHeader:true, generatedHeaders:false },
            diagnostics:[]
        };
    }
    if(values.every(Array.isArray)) {
        const matrix = values.map(row => row.map(cellText));
        const resolved = HeaderResolver.infer(matrix, { ...options, tableName:name });
        if(!resolved.headers.length) throw new Error(`JSON 表格“${name}”没有列`);
        return {
            name,
            headers:resolved.headers,
            rows:resolved.rows,
            sourceType:'json',
            meta:{ hasHeader:resolved.hasHeader, generatedHeaders:resolved.generatedHeaders, headerConfidence:resolved.headerConfidence, headerReasons:resolved.headerReasons },
            diagnostics:resolved.diagnostics
        };
    }
    throw new Error(`JSON 表格“${name}”须为对象记录数组或二维数组，且各行类型一致`);
}

const JsonTableParser = {
    id:'json',
    label:'JSON 表格',
    parse(source, options={}) {
        let value;
        let syntaxDiagnostics = [];
        try { value = JSON.parse(source.text || ''); }
        catch(error) {
            let recovered;
            try { recovered = parseLooseCore(source.text || ''); }
            catch(_) {
                try { recovered = recoverCompleteRecords(source.text || ''); }
                catch(_) { throw new Error(`JSON 格式错误：${error.message}；无法从片段提取完整字段或记录`); }
            }
            value = recovered.value;
            syntaxDiagnostics = [{
                code:recovered.cropped ? 'JSON_FRAGMENT_RECOVERED' : 'JSON_RELAXED_SYNTAX',
                severity:recovered.cropped ? 'warning' : 'info',
                message:recovered.cropped
                    ? '输入在记录边界处不完整；仅呈现可恢复的字段或记录，请核对行数和内容'
                    : '已按宽松 JSON 语法解析，请核对字段和记录'
            }];
        }
        const used = new Set();
        const tables = [];
        if(Array.isArray(value)) {
            tables.push(parseTable(value, TableUtils.makeTableName('JSON Table 1', 0, used), options));
        } else if(isRecord(value)) {
            const keys = Object.keys(value);
            if(keys.length && keys.every(key => Array.isArray(value[key]) &&
                (!value[key].length || value[key].every(isRecord) || value[key].every(Array.isArray)))) {
                keys.forEach((key, index) => tables.push(parseTable(value[key], TableUtils.makeTableName(key, index, used), options)));
            } else {
                tables.push(parseTable([value], TableUtils.makeTableName('JSON Table 1', 0, used), options));
            }
        } else {
            throw new Error('JSON 表格须为对象记录数组、二维数组或含表格数组的对象');
        }
        return { tables, diagnostics:[...syntaxDiagnostics, ...tables.flatMap(table => table.diagnostics)] };
    }
};

    return { JsonTableParser };
});
