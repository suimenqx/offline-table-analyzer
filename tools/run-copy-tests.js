const { loadBuiltModules } = require('./load-built-modules');
const { OTA } = loadBuiltModules({ window: {}, console });
const F = OTA.require('clipboard').ClipboardFormatter;
const E = OTA.require('exporter').Exporter;
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const matrix = [['id', 'name'], ['1', 'Alice'], ['2', 'Bob, Jr.']];
assert(F.toText(matrix, 'default') === 'id\tname\n1\tAlice\n2\tBob, Jr.', 'default copy should remain TSV');
assert(F.toText(matrix, 'csv') === 'id,name\n1,Alice\n2,"Bob, Jr."', 'csv copy should quote comma cells');
assert(F.toText(matrix, 'markdown').includes('| id  | name     |'), 'markdown copy should include pipe header');
assert(F.toText(matrix, 'ascii').startsWith('+'), 'ascii copy should include border');
assert(F.toText([['fieldA'], ['0'], ['1']], 'lua-inline') === '{\n    [1] = { ["fieldA"] = 0 },\n    [2] = { ["fieldA"] = 1 },\n}', 'lua inline should serialize one field per record');
assert(F.toText([['fieldA'], ['0'], ['1']], 'lua-expanded') === '{\n    [1] = {\n        ["fieldA"] = 0,\n    },\n    [2] = {\n        ["fieldA"] = 1,\n    },\n}', 'lua expanded should serialize one field per line');
const luaMatrix = [['fieldA', 'fieldB'], ['0', '10'], ['100', '2']];
assert(F.toText(luaMatrix, 'lua-inline') === '{\n    [1] = { ["fieldA"] = 0,   ["fieldB"] = 10 },\n    [2] = { ["fieldA"] = 100, ["fieldB"] = 2 },\n}', 'lua inline should align expressions by field column');
assert(F.toText([['fieldA', 'fieldB']], 'lua-inline') === '{}', 'lua should return an empty table when only headers are selected');
assert(F.formatLuaValue('0x0') === '0' && F.formatLuaValue('0X0') === '0' && F.formatLuaValue('0x00') === '0', 'zero hex values should normalize to zero');
assert(F.formatLuaValue('0x01') === '0x01' && F.formatLuaValue('0XFF') === '0XFF', 'non-zero hex values should preserve spelling');
assert(F.formatLuaValue('10') === '10' && F.formatLuaValue('-20') === '-20' && F.formatLuaValue('1.5') === '1.5' && F.formatLuaValue('-0.25') === '-0.25', 'lua numeric values should remain literals');
assert(F.formatLuaValue('00123') === '"00123"' && F.formatLuaValue('0001') === '"0001"', 'leading-zero integers should remain strings');
assert(F.formatLuaValue('true') === 'true' && F.formatLuaValue('false') === 'false' && F.formatLuaValue('TRUE') === '"TRUE"', 'only lowercase booleans should remain literals');
assert(F.formatLuaValue('') === '""' && F.formatLuaValue('nil') === '"nil"', 'empty and nil cells should remain present as strings');
assert(F.formatLuaValue('a"b\\c\n\r\t') === '"a\\"b\\\\c\\n\\r\\t"', 'lua strings should escape quotes, slashes, and controls');
assert(F.toText([['fieldA'], ['=value']], 'lua-inline').includes('["fieldA"] = "=value"'), 'lua should not apply spreadsheet formula prefixes');
assert(F.toHtml(matrix).includes('<table') && F.toHtml(matrix).includes('<th'), 'html clipboard should use table markup');
const luaHtml = F.toHtml([['fieldA'], ['=value']], 'lua-inline');
assert(luaHtml.startsWith('<pre><code>') && luaHtml.includes('&quot;=value&quot;') && !luaHtml.includes('<table'), 'lua html clipboard should be code, not a table');
const multiline = [['id', 'desc'], ['1', 'line1\nline2'], ['2', 'literal<br>break']];
assert(F.toText(multiline, 'default') === 'id\tdesc\n1\t"line1\nline2"\n2\t"literal\nbreak"', 'default TSV should quote multiline cells and normalize br');
assert(F.toText(multiline, 'csv') === 'id,desc\n1,"line1\nline2"\n2,"literal\nbreak"', 'csv should quote multiline cells');
assert(F.toText(multiline, 'markdown').includes('line1<br>line2'), 'markdown should render multiline cells as br');
assert(F.toText(multiline, 'ascii').includes('line1 line2'), 'ascii should flatten multiline cells');
assert(F.toHtml(multiline).includes('line1<br>line2'), 'html clipboard should preserve visual line breaks');
const formulas = [['value'], ['=CMD()'], ['+1+1'], ['-10'], ['@SUM(A1:A2)']];
const safe = F.toText(formulas, 'csv');
assert(safe.includes("'=CMD()") && safe.includes("'+1+1") && safe.includes("'@SUM"), 'dangerous spreadsheet formulas should be text-prefixed');
assert(safe.includes('\n-10\n'), 'negative numbers should remain numeric text');
const excelCell = value => E.buildSheetXml({ headers:['value'], rows:[[value]] }).match(/<row r="2">(.*?)<\/row>/)[1];
assert(excelCell('12345').includes('t="n"'), 'short numeric text should export as a number');
assert(excelCell('123456789012345678').includes('t="inlineStr"'), 'long integer identifiers must export as text');
assert(excelCell('123.456789012345678').includes('t="inlineStr"'), 'high precision decimals must export as text');
assert(excelCell('-00123').includes('t="inlineStr"'), 'negative identifiers with leading zeros must export as text');
assert(excelCell(123456789012345).includes('t="n"'), 'finite numeric values should remain numeric');
const { Select } = OTA.require('selection');
const rowHeaderNames = ['fieldA', 'fieldB'];
const rowHeaderValues = { '0:0':'1', '0:1':'2', '1:0':'3', '1:1':'4' };
const fakeRowHeaderTable = {
  dataset: { viewMode:'row-header' },
  querySelectorAll(selector) {
    if(selector === 'tbody tr') return rowHeaderNames.map(name => ({ querySelector() { return { textContent:name }; } }));
    return [];
  },
  querySelector(selector) {
    const match = /data-vr="(\d+)"\]\[data-vc="(\d+)"/.exec(selector);
    if(!match) return null;
    const value = rowHeaderValues[`${match[1]}:${match[2]}`];
    return value === undefined ? null : { textContent:value };
  }
};
const restoredRowHeaderMatrix = Select.buildLuaClipboardMatrix(fakeRowHeaderTable, 0, 1, 0, 1);
assert(JSON.stringify(restoredRowHeaderMatrix) === JSON.stringify([['fieldA', 'fieldB'], ['1', '3'], ['2', '4']]), 'row-header Lua copy should restore original record orientation');
console.log('Copy/export formatter tests passed: 31');
