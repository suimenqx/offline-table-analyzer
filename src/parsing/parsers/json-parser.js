OTA.define('json-parser', ["table-utils", "header-resolver"], ({TableUtils}, {HeaderResolver}) => {
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const cellText = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);

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
        try { value = JSON.parse(source.text || ''); }
        catch(error) { throw new Error(`JSON 格式错误：${error.message}`); }
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
        return { tables, diagnostics:tables.flatMap(table => table.diagnostics) };
    }
};

    return { JsonTableParser };
});
