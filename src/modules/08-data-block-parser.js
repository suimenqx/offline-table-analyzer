OTA.define('data-block-parser', ["table-utils"], ({TableUtils}) => {
const IDENTIFIER_START = /[A-Za-z0-9_]/;
const IDENTIFIER_PART = /[A-Za-z0-9_$]/;

function isIdentifierStart(ch) {
    return !!ch && IDENTIFIER_START.test(ch);
}

function isIdentifierPart(ch) {
    return !!ch && IDENTIFIER_PART.test(ch);
}

function isWhitespace(ch) {
    return !!ch && /\s/.test(ch);
}

function skipWhitespace(text, index) {
    let cursor = index;
    while(cursor < text.length && isWhitespace(text[cursor])) cursor++;
    return cursor;
}

function isWordBoundary(text, index) {
    return !isIdentifierPart(text[index - 1]) && !isIdentifierPart(text[index + 4]);
}

function readIdentifier(text, index) {
    if(!isIdentifierStart(text[index])) return null;
    let cursor = index + 1;
    while(cursor < text.length && isIdentifierPart(text[cursor])) cursor++;
    return { value:text.slice(index, cursor), end:cursor };
}

function skipQuotedText(text, index) {
    let cursor = index + 1;
    while(cursor < text.length) {
        if(text[cursor] === '\\') {
            cursor += 2;
            continue;
        }
        if(text[cursor] === '"') return cursor + 1;
        cursor++;
    }
    return text.length;
}

function findClosingBracket(text, openIndex) {
    let cursor = openIndex + 1;
    while(cursor < text.length) {
        if(text[cursor] === '"') {
            cursor = skipQuotedText(text, cursor);
            continue;
        }
        if(text[cursor] === ']') return cursor;
        cursor++;
    }
    return -1;
}

function scanDataBlocks(text='') {
    const blocks = [];
    let cursor = 0;
    while(cursor < text.length) {
        if(text[cursor] === '"') {
            cursor = skipQuotedText(text, cursor);
            continue;
        }
        if(text.startsWith('data', cursor) && isWordBoundary(text, cursor)) {
            let nameStart = skipWhitespace(text, cursor + 4);
            const identifier = readIdentifier(text, nameStart);
            if(identifier) {
                const openIndex = skipWhitespace(text, identifier.end);
                if(text[openIndex] === '[') {
                    const closeIndex = findClosingBracket(text, openIndex);
                    blocks.push({
                        name:identifier.value,
                        openIndex,
                        closeIndex,
                        complete:closeIndex >= 0
                    });
                    cursor = closeIndex >= 0 ? closeIndex + 1 : text.length;
                    continue;
                }
            }
        }
        cursor++;
    }
    return blocks;
}

function nextComma(text, index) {
    let cursor = index;
    while(cursor < text.length) {
        if(text[cursor] === '"') {
            cursor = skipQuotedText(text, cursor);
            continue;
        }
        if(text[cursor] === ',') return cursor;
        cursor++;
    }
    return text.length;
}

function parseQuotedValue(text, index, diagnostics, tableName, rowNumber) {
    let cursor = index + 1;
    let value = '';
    while(cursor < text.length) {
        const ch = text[cursor];
        if(ch === '"') return { value, end:cursor + 1, closed:true };
        if(ch === '\\') {
            const next = text[cursor + 1];
            if(next === undefined) break;
            if(next === '"' || next === '\\') value += next;
            else if(next === 'n') value += '\n';
            else if(next === 'r') value += '\r';
            else if(next === 't') value += '\t';
            else value += `\\${next}`;
            cursor += 2;
            continue;
        }
        value += ch;
        cursor++;
    }
    diagnostics.push({
        level:'warning',
        code:'UNCLOSED_QUOTE',
        table:tableName,
        row:rowNumber,
        message:`${tableName} 第 ${rowNumber} 条记录的字段值缺少结束引号`
    });
    return { value, end:text.length, closed:false };
}

function parseRecord(body, tableName, rowNumber) {
    const diagnostics = [];
    const fields = [];
    const values = Object.create(null);
    let cursor = 0;

    const addMissingColon = (fragment) => diagnostics.push({
        level:'warning',
        code:'MISSING_COLON',
        table:tableName,
        row:rowNumber,
        message:`${tableName} 第 ${rowNumber} 条记录中的字段缺少冒号：${fragment.trim().slice(0, 80)}`
    });

    while(cursor < body.length) {
        cursor = skipWhitespace(body, cursor);
        while(body[cursor] === ',') cursor = skipWhitespace(body, cursor + 1);
        if(cursor >= body.length) break;

        const keyStart = cursor;
        const identifier = readIdentifier(body, cursor);
        if(!identifier) {
            const end = nextComma(body, cursor);
            addMissingColon(body.slice(cursor, end));
            cursor = end < body.length ? end + 1 : body.length;
            continue;
        }
        cursor = skipWhitespace(body, identifier.end);
        if(body[cursor] !== ':') {
            const end = nextComma(body, keyStart);
            addMissingColon(body.slice(keyStart, end));
            cursor = end < body.length ? end + 1 : body.length;
            continue;
        }
        const key = identifier.value;
        cursor = skipWhitespace(body, cursor + 1);
        let value = '';
        if(body[cursor] === '"') {
            const parsed = parseQuotedValue(body, cursor, diagnostics, tableName, rowNumber);
            value = parsed.value;
            cursor = parsed.end;
            if(!parsed.closed) break;
        } else {
            const end = nextComma(body, cursor);
            value = body.slice(cursor, end).trim();
            cursor = end;
        }
        if(!Object.prototype.hasOwnProperty.call(values, key)) fields.push(key);
        values[key] = value;
        cursor = skipWhitespace(body, cursor);
        if(body[cursor] === ',') cursor++;
    }

    return { fields, values, diagnostics };
}

function findRecordEnd(body, openIndex) {
    let cursor = openIndex + 1;
    while(cursor < body.length) {
        if(body[cursor] === '"') {
            cursor = skipQuotedText(body, cursor);
            continue;
        }
        if(body[cursor] === '}') return cursor;
        if(body[cursor] === '{') return { nextOpenIndex:cursor };
        cursor++;
    }
    return { nextOpenIndex:-1 };
}

function parseRecords(body, tableName) {
    const records = [];
    const diagnostics = [];
    let cursor = 0;
    let recordNumber = 0;
    while(cursor < body.length) {
        if(body[cursor] !== '{') {
            cursor++;
            continue;
        }
        recordNumber++;
        const recordEnd = findRecordEnd(body, cursor);
        if(typeof recordEnd === 'object') {
            const partialEnd = recordEnd.nextOpenIndex >= 0 ? recordEnd.nextOpenIndex : body.length;
            const parsed = parseRecord(body.slice(cursor + 1, partialEnd), tableName, recordNumber);
            if(parsed.fields.length) records.push(parsed);
            diagnostics.push({
                level:'warning',
                code:'UNMATCHED_BRACE',
                table:tableName,
                row:recordNumber,
                message:`${tableName} 第 ${recordNumber} 条记录缺少结束花括号`
            });
            diagnostics.push(...parsed.diagnostics);
            if(recordEnd.nextOpenIndex < 0) break;
            cursor = recordEnd.nextOpenIndex;
            continue;
        }
        const parsed = parseRecord(body.slice(cursor + 1, recordEnd), tableName, recordNumber);
        records.push(parsed);
        diagnostics.push(...parsed.diagnostics);
        cursor = recordEnd + 1;
    }
    return { records, diagnostics };
}

function inspectBlock(block, text) {
    if(!block.complete) return { complete:false, valid:false };
    const body = text.slice(block.openIndex + 1, block.closeIndex);
    if(!body.trim()) return { complete:true, valid:true };
    let depth = 0;
    let hasRecord = false;
    let balanced = true;
    let cursor = 0;
    while(cursor < body.length) {
        if(body[cursor] === '"') {
            cursor = skipQuotedText(body, cursor);
            continue;
        }
        if(body[cursor] === '{') {
            hasRecord = true;
            depth++;
        } else if(body[cursor] === '}') {
            if(depth === 0) balanced = false;
            else depth--;
        }
        cursor++;
    }
    return { complete:true, valid:hasRecord && balanced && depth === 0 };
}

const DataBlockParser = {
    id:'data-block',
    label:'Data-Block 数据块',
    confidence(source) {
        const text = TableUtils.normalizeText(source && source.text || '');
        const blocks = scanDataBlocks(text);
        if(!blocks.length) return 0;
        const inspected = blocks.map(block => inspectBlock(block, text));
        if(inspected.some(item => item.complete && item.valid)) return 0.96;
        if(inspected.some(item => item.complete)) return 0.42;
        return 0.34;
    },
    parse(source) {
        const text = TableUtils.normalizeText(source && source.text || '');
        const blocks = scanDataBlocks(text);
        const tables = [];
        const diagnostics = [];
        const usedNames = new Set();

        blocks.forEach((block, blockIndex) => {
            const name = TableUtils.makeTableName(block.name, blockIndex, usedNames);
            const end = block.complete ? block.closeIndex : text.length;
            const body = text.slice(block.openIndex + 1, end);
            const parsed = parseRecords(body, name);
            const headerOrder = [];
            const seenHeaders = new Set();
            parsed.records.forEach(record => record.fields.forEach(field => {
                if(!seenHeaders.has(field)) {
                    seenHeaders.add(field);
                    headerOrder.push(field);
                }
            }));
            const headers = TableUtils.ensureUniqueHeaders(headerOrder);
            const rows = parsed.records.map(record => headerOrder.map(header =>
                Object.prototype.hasOwnProperty.call(record.values, header) ? record.values[header] : ''
            ));
            const tableDiagnostics = [...parsed.diagnostics];
            if(!block.complete) {
                tableDiagnostics.push({
                    level:'error',
                    code:'UNCLOSED_DATA_BLOCK',
                    table:name,
                    message:`数据表 ${name} 缺少结束方括号`
                });
            }
            if(!rows.length && body.trim()) {
                tableDiagnostics.push({
                    level:'warning',
                    code:'NO_DATA_RECORDS',
                    table:name,
                    message:`数据表 ${name} 未找到有效记录`
                });
            }
            const table = {
                name,
                headers,
                rows,
                sourceType:this.id,
                meta:{
                    dataBlock:true,
                    sourceName:block.name,
                    hasHeader:true,
                    generatedHeaders:false,
                    headerConfidence:1,
                    headerReasons:['字段名来自 data-block 记录键']
                },
                diagnostics:tableDiagnostics
            };
            tables.push(table);
            diagnostics.push(...tableDiagnostics);
        });

        if(!blocks.length) diagnostics.push({ level:'info', code:'NO_DATA_BLOCK', message:'未找到有效 data 数据块' });
        return { tables, diagnostics };
    }
};

    return { DataBlockParser };
});
