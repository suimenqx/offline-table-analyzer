const { loadBuiltModules } = require('./load-built-modules');

if(process.argv.includes('--clean-production')) require('./validate-release').cleanProductionHooks();

const sandbox = {
  console,
  window: {},
  document: { createElement() { return { innerHTML: '', textContent: '', innerText: '' }; } }
};
const { OTA } = loadBuiltModules(sandbox);
const { ImportEngine } = OTA.require('import-engine');

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const assert = (cond, message) => { if (!cond) throw new Error(message); };

test('legacy CLI multi-table', () => {
  const r = ImportEngine.parse('table-data Users\nvalidflag ID Name\n1 100 Alice\n1 101 Bob\n\ntable-data Orders\nvalidflag OrderID UserID\n1 5001 100');
  assert(r.tables.length === 2 && r.tables[0].rows.length === 2, 'legacy CLI failed');
});
test('CSV quoted fields', () => {
  const r = ImportEngine.parse('id,name,comment\n1,Alice,"hello, world"\n2,Bob,"a ""quoted"" value"');
  assert(r.format === 'csv' && r.tables[0].rows[1][2] === 'a "quoted" value', 'CSV quotes failed');
});
test('CSV multiline field', () => {
  const r = ImportEngine.parse('id,comment\n1,"line 1\nline 2"', { format:'csv' });
  assert(r.tables[0].rows[0][1] === 'line 1\nline 2', 'CSV multiline failed');
});
test('CSV malformed quote diagnostic', () => {
  const r = ImportEngine.parse('id,name\n1,"Alice', { format:'csv' });
  assert(r.diagnostics.some(d => d.code === 'UNCLOSED_QUOTE'), 'missing quote diagnostic');
});
test('generated headers', () => {
  const r = ImportEngine.parse('1,Alice,20\n2,Bob,30');
  assert(r.tables[0].headers[0] === 'Column1' && r.tables[0].rows.length === 2, 'generated headers failed');
});
test('whitespace text should not be promoted to CSV', () => {
  const r = ImportEngine.parse('1 2\n3 4');
  assert(r.format === 'plain-text' && r.tables[0].headers.length === 2 && r.tables[0].rows.length === 2, 'whitespace text was misdetected as CSV');
});
test('CSV tabs inside quoted fields should remain CSV', () => {
  const r = ImportEngine.parse('id,note\n1,"hello\tworld"');
  assert(r.format === 'csv' && r.tables[0].rows[0][1] === 'hello\tworld', 'quoted tab changed CSV detection');
});
test('TSV recognition', () => {
  const r = ImportEngine.parse('id\tname\tage\n1\tAlice\t20');
  assert(r.format === 'excel-paste' && r.tables[0].headers[1] === 'name', 'TSV failed');
});
test('Markdown header separator', () => {
  const r = ImportEngine.parse('| id | name |\n|----|------|\n| 1 | Alice |');
  assert(r.format === 'pipe-table' && r.tables[0].headers[0] === 'id', 'Markdown failed');
});
test('Markdown escaped pipe', () => {
  const r = ImportEngine.parse('| id | note |\n|---|---|\n|1|a\\|b|');
  assert(r.tables[0].rows[0][1] === 'a|b', 'escaped pipe failed');
});
test('ASCII table', () => {
  const r = ImportEngine.parse('+----+-------+\n| id | name  |\n+----+-------+\n| 1  | Alice |\n+----+-------+');
  assert(r.format === 'ascii-table' && r.tables[0].rows[0][1] === 'Alice', 'ASCII failed');
});
test('pipe text with horizontal rule should not become ASCII', () => {
  const r = ImportEngine.parse('| a | b |\n| 1 | 2 |\n---\ntext');
  assert(r.format === 'pipe-table' && r.tables[0].rows[0][0] === '1', 'pipe text was misdetected as ASCII');
});
test('horizontal rule prose should fall back to plain text', () => {
  const r = ImportEngine.parse('Title\n---\nparagraph text');
  assert(r.format === 'plain-text' && r.tables.length === 1, 'horizontal rule prose produced an empty aligned result');
});
test('raw HTML text should auto-detect as HTML', () => {
  const r = ImportEngine.parse('<table><tr><th>id</th><th>name</th></tr><tr><td>1</td><td>Alice</td></tr></table>');
  assert(r.format === 'html-table' && r.tables[0].headers[1] === 'name', 'raw HTML was not auto-detected');
});
test('HTML clipboard table', () => {
  const htmlTable = '<table><tr><th>id</th><th>name</th></tr><tr><td>1</td><td>Alice</td></tr></table>';
  const r = ImportEngine.parse({ text:'id\tname\n1\tAlice', html:htmlTable });
  assert(r.format === 'html-table' && r.tables[0].headers[1] === 'name', 'HTML failed');
});
test('HTML rowspan expansion', () => {
  const htmlTable = '<table><tr><th>group</th><th>name</th></tr><tr><td rowspan="2">A</td><td>Alice</td></tr><tr><td>Bob</td></tr></table>';
  const r = ImportEngine.parse({ text:'', html:htmlTable });
  assert(r.tables[0].rows.length === 2 && r.tables[0].rows[1][0] === 'A' && r.tables[0].rows[1][1] === 'Bob', 'rowspan failed');
});
test('HTML rowspan and colspan expansion', () => {
  const htmlTable = '<table><tr><th>group</th><th>detail</th><th>name</th></tr><tr><td rowspan="2" colspan="2">A</td><td>Alice</td></tr><tr><td>Bob</td></tr></table>';
  const r = ImportEngine.parse({ text:'', html:htmlTable });
  assert(r.tables[0].rows[1].join('|') === 'A||Bob', 'combined rowspan/colspan failed');
});
test('literal and escaped BR', () => {
  const r = ImportEngine.parse('id\tdesc\n1\tline1<br>line2\n2\tlineA&lt;br /&gt;lineB', { format:'excel-paste' });
  assert(r.tables[0].rows[0][1] === 'line1\nline2' && r.tables[0].rows[1][1] === 'lineA\nlineB', 'BR failed');
});
test('semicolon delimiter', () => {
  const r = ImportEngine.parse('id;name;score\n1;Alice;9\n2;Bob;8');
  assert(r.format === 'semicolon-csv' && r.tables[0].rows[1][1] === 'Bob', 'semicolon failed');
});
test('fixed width', () => {
  const r = ImportEngine.parse('id   name       age\n1    Alice      20\n2    Bob        30');
  assert(r.format === 'fixed-width', 'fixed width failed');
});
test('aligned table - scenario A with separators', () => {
  const input = '---\ncol1    col2              col3             col4       col5\nval1    val2              val3             val4       val5\nval6    --                val7             --         val8\n---';
  const r = ImportEngine.parse(input);
  assert(r.format === 'aligned-table', 'format not aligned');
  assert(r.tables[0].headers.length === 5, 'header count');
  assert(r.tables[0].rows[0][0] === 'val1', 'val1');
  assert(r.tables[0].rows[1][1] === '--', '-- should be preserved');
  assert(r.tables[0].rows[1][3] === '--', 'second -- should be preserved');
  assert(r.tables[0].rows[0][4] === 'val5', 'val5');
});
test('aligned table - scenario B top separator only', () => {
  const input = '---\ncol1    col2              col3\nval1    val2              val3';
  const r = ImportEngine.parse(input);
  assert(r.format === 'aligned-table', 'format not aligned');
  assert(r.tables[0].headers[1] === 'col2', 'col2');
  assert(r.tables[0].rows[0][2] === 'val3', 'val3');
});
test('aligned table - scenario C bottom separator only', () => {
  const input = 'col1    col2              col3\nval1    val2              val3\n---';
  const r = ImportEngine.parse(input);
  assert(r.format === 'aligned-table', 'format not aligned');
  assert(r.tables[0].headers[0] === 'col1', 'col1');
  assert(r.tables[0].rows[0][1] === 'val2', 'val2');
});
test('aligned table - scenario D no separators', () => {
  const input = 'col1    col2              col3             col4       col5\nval1    val2              val3             val4       val5';
  const r = ImportEngine.parse(input, { format:'aligned-table' });
  assert(r.format === 'aligned-table', 'format not aligned');
  assert(r.tables[0].headers[3] === 'col4', 'col4');
  assert(r.tables[0].rows[0][0] === 'val1', 'val1');
});
test('aligned table - multi-table with separators', () => {
  const input = '---\nA    B              C\n1    x              y\n---\nX    Y              Z\n10   foo            bar\n---';
  const r = ImportEngine.parse(input);
  assert(r.tables.length === 2 && r.tables[0].rows.length === 1 && r.tables[1].rows.length === 1, 'multi-table count');
  assert(r.tables[0].headers[0] === 'A' && r.tables[1].headers[0] === 'X', 'multi headers');
});
test('aligned table - title between dashes', () => {
  const input = '---\nMy Table\n---\ncol1    col2\nval1    val2';
  const r = ImportEngine.parse(input);
  assert(r.format === 'aligned-table', 'format');
  assert(r.tables[0].name.startsWith('My Table'), 'title not used as name: ' + r.tables[0].name);
  assert(r.tables[0].headers[0] === 'col1', 'col1');
});
test('aligned table - header between dashes separated from data', () => {
  const input = '---\ncol1    col2              col3\n---\nval1    val2              val3\nval4    val5              val6';
  const r = ImportEngine.parse(input);
  assert(r.format === 'aligned-table', 'format');
  assert(r.tables[0].headers.length === 3, 'header count');
  assert(r.tables[0].rows.length === 2, 'row count');
  assert(r.tables[0].rows[0][0] === 'val1', 'val1');
  assert(r.tables[0].rows[1][2] === 'val6', 'val6');
});
test('aligned table - report header remains columns with a separator', () => {
  const input = [
    'ColA       ColB    ColC   ColD         ColE            ColF        ColG        ColH             ColI',
    '------------------------------------------------------------------------------------------------------------------------',
    'val1       down    full   type-1       attr-1          -40.00unit  -2.02unit   ModeA            PN-001',
    'val2       down    full   type-2       attr-2          -40.00unit  -5.73unit   ModeA            PN-002',
    'val3       up      full   type-3       attr-3          -2.44unit   -2.48unit   ModeB            PN-003'
  ].join('\n');
  const r = ImportEngine.parse(input);
  assert(r.format === 'aligned-table', 'report was not detected as aligned table');
  assert(r.tables.length === 1 && r.tables[0].name === 'Aligned Table', 'header was used as table name');
  assert(r.tables[0].headers.join('|') === 'ColA|ColB|ColC|ColD|ColE|ColF|ColG|ColH|ColI', 'report headers lost');
  assert(r.tables[0].rows.length === 3 && r.tables[0].rows[2][8] === 'PN-003', 'report rows were not mapped');
});
test('aligned table - compact headers with one data row', () => {
  const input = [
    '---------------------------------------------------------------------------------------------------------------------------------------------',
    'Port                   Status Duplex Type                 Wavelength            RxPower     TxPower     Mode             VendorPN',
    '---------------------------------------------------------------------------------------------------------------------------------------------',
    'ETH0/2/0               down   full   1G-40km-TEST         1310.00nm             -40.00dBm   -2.02dBm    SingleMode       TEST',
    '---------------------------------------------------------------------------------------------------------------------------------------------'
  ].join('\n');
  const r = ImportEngine.parse(input);
  assert(r.format === 'aligned-table', 'compact report was not detected as aligned table');
  assert(r.tables.length === 1, 'compact report table count');
  assert(r.tables[0].headers.join('|') === 'Port|Status|Duplex|Type|Wavelength|RxPower|TxPower|Mode|VendorPN', 'compact headers were not split by aligned positions');
  assert(r.tables[0].rows.length === 1, 'compact report data row was lost');
  assert(r.tables[0].rows[0].join('|') === 'ETH0/2/0|down|full|1G-40km-TEST|1310.00nm|-40.00dBm|-2.02dBm|SingleMode|TEST', 'compact report row mapping failed');
  assert(!r.tables[0].rows.some(row => row.some(cell => /^---+$/.test(cell))), 'separator was treated as data');
});
test('aligned table - CJK terminal-width inventory report', () => {
  const input = [
    '---------------------------------------------------------------------------------------------------------------------------------------------',
    'SKU                    Status  Pack   Spec                  NetWeight       CostPrice   ListPrice   Storage           SupplierCode',
    '---------------------------------------------------------------------------------------------------------------------------------------------',
    'SP-A02-00              缺货    整箱   500ml-24pk-PET        12.00kg         18.50       36.80       常温              HSF-243MD',
    'SP-A02-01              缺货    整箱   500ml-12pk-PET        6.00kg          15.20       32.50       常温              RXTX191-400',
    'SP-A02-02              缺货    整箱   500ml-12pk-PET        6.00kg          11.42       31.75       常温              HSF-243S',
    'SP-A02-03              缺货    整箱   500ml-12pk-PET        6.00kg          19.10       30.89       常温              LTD1302-BC1',
    'SP-A02-04              缺货    整箱   500ml-12pk-PET        6.00kg          16.64       28.64       常温              HSF-243S',
    'SP-A02-05              缺货    整箱   500ml-12pk-PET        6.00kg          20.99       29.99       常温              HSF-243S',
    'SP-A02-06              缺货    整箱   500ml-12pk-PET        6.00kg          18.07       27.07       常温              HSF-243S',
    'SP-A02-07              缺货    整箱   500ml-12pk-PET        6.00kg          14.60       30.60       常温              HSF-243S',
    'SP-A02-08              缺货    整箱   330ml-24pk-CAN        7.92kg          22.31       45.31       冷藏              PLRX-SCS43HW',
    'SP-A02-09              缺货    整箱   250ml-6pk-GLS         1.50kg          10.25       22.25       常温              HSF-033S',
    'SP-A02-17              在售    整箱   1L-12pk-PET           12.00kg         12.48       24.48       常温              RXTX228-401',
    'SP-A02-19              缺货    整箱   330ml-24pk-CAN        7.92kg          12.53       25.53       冷藏              LTF8502-BC1',
    'SP-A02-21              缺货    整箱   1L-6pk-GLS            6.00kg          13.37       27.37       常温              MTRS-02X13G',
    'SP-A02-22              在售    整箱   2L-6pk-PET            12.00kg         20.00       40.00       常温              MTRA-3E61A',
    'SP-A02-23              缺货    整箱   1L-6pk-GLS            6.00kg          21.45       42.45       常温              FTLX1471D3B',
    'SP-A02-24              缺货    整箱   2L-6pk-PET            12.00kg         17.16       34.76       常温              LTF1325-BH1',
    'SP-A02-25              缺货    整箱   330ml-24pk-CAN        7.92kg          10.75       21.75       冷藏              TR-PY85S-N00',
    '---------------------------------------------------------------------------------------------------------------------------------------------'
  ].join('\n');
  const r = ImportEngine.parse(input);
  assert(r.format === 'aligned-table', 'CJK inventory report was not detected as aligned table');
  assert(r.tables[0].headers.join('|') === 'SKU|Status|Pack|Spec|NetWeight|CostPrice|ListPrice|Storage|SupplierCode', 'CJK report headers lost');
  assert(r.tables[0].rows.length === 17, 'CJK report row count includes separator rows');
  assert(r.tables[0].rows[0].join('|') === 'SP-A02-00|缺货|整箱|500ml-24pk-PET|12.00kg|18.50|36.80|常温|HSF-243MD', 'CJK first row mapping failed');
  assert(r.tables[0].rows[10][1] === '在售' && r.tables[0].rows[10][8] === 'RXTX228-401', 'CJK middle row mapping failed');
  assert(r.tables[0].rows[16][8] === 'TR-PY85S-N00', 'CJK last row mapping failed');
  assert(!r.diagnostics.some(d => d.code === 'ALIGNED_POSITION_MISMATCH'), 'valid CJK alignment emitted position mismatch diagnostics');
});
test('aligned table - plus separator and one data row', () => {
  const input = 'ColA       ColB    ColC\n------+-------+----\nval1       down    full';
  const r = ImportEngine.parse(input);
  assert(r.format === 'aligned-table', 'plus separator was not detected as aligned table');
  assert(r.tables[0].headers.join('|') === 'ColA|ColB|ColC', 'plus separator lost headers');
  assert(r.tables[0].rows.length === 1 && r.tables[0].rows[0][1] === 'down', 'plus separator row mapping failed');
});
test('aligned table - value wider than header truncated', () => {
  const input = 'ID    Name\n1     VeryLongNameHere\n2     Short';
  const r = ImportEngine.parse(input);
  assert(r.tables[0].rows[0][1] === 'VeryLongNameHere' || r.tables[0].rows[0][1].startsWith('Very'), 'wide value');
});
test('aligned table - hex values preserved', () => {
  const input = 'Addr    Val\n0x1000  0xFF\n0x2000  0x1A';
  const r = ImportEngine.parse(input);
  assert(r.tables[0].rows[0][0] === '0x1000', 'hex addr');
  assert(r.tables[0].rows[1][1] === '0x1A', 'hex val');
});
test('aligned table - manual format', () => {
  const input = 'col1    col2\nval1    val2';
  const r = ImportEngine.parse(input, { format:'aligned-table' });
  assert(r.format === 'aligned-table', 'manual aligned');
});
test('aligned table preserves values that overflow a header position', () => {
  const input = 'ID    Name    Age\n1     VeryLongNameHere    20';
  const r = ImportEngine.parse(input, { format:'aligned-table' });
  assert(r.tables[0].rows[0].join('|') === '1|VeryLongNameHere|20', 'aligned overflow value was truncated');
  assert(r.diagnostics.some(d => d.code === 'ALIGNED_POSITION_MISMATCH'), 'missing aligned position diagnostic');
});
test('aligned table repeated recoverable overflow remains auto-detected', () => {
  const input = [
    '------------------------------',
    'ID    Name    Age',
    '------------------------------',
    '1     VeryLongNameOne    20',
    '2     VeryLongNameTwo    21',
    '3     VeryLongNameThree  22',
    '4     VeryLongNameFour   23',
    '5     VeryLongNameFive   24',
    '6     VeryLongNameSix    25',
    '------------------------------'
  ].join('\n');
  const r = ImportEngine.parse(input);
  assert(r.format === 'aligned-table', 'repeated recoverable overflow lost aligned format detection');
  assert(r.tables[0].rows.length === 6 && r.tables[0].rows[5].join('|') === '6|VeryLongNameSix|25', 'repeated overflow rows were not preserved');
});
test('ambiguous string rows keep the first row as data', () => {
  const r = ImportEngine.parse('Alice,NY\nBob,LA');
  assert(r.tables[0].headers[0] === 'Column1' && r.tables[0].rows.length === 2, 'ambiguous string rows were treated as a header');
});
test('duplicate and blank headers', () => {
  const r = ImportEngine.parse('id,,id\n1,Alice,100');
  assert(r.tables[0].headers.join('|') === 'id|Column2|id_2', 'header normalization failed');
});
test('row width mismatch preserves overflow', () => {
  const r = ImportEngine.parse('id,name,age\n1,Alice,20\n2,Bob\n3,Cindy,25,extra');
  assert(r.tables[0].rows[2][3] === 'extra' && r.diagnostics.length > 0, 'overflow was lost');
});
test('prefixed legacy marker', () => {
  const r = ImportEngine.parse('[TEST] table-data table-data Inventory\nvalidflag ID Product\n1 100 Widget');
  assert(r.tables[0].name === 'Inventory' && r.tables[0].meta.generatedHeaders === false, 'prefixed marker failed');
});
test('manual format selection', () => {
  assert(ImportEngine.parse('a,b\n1,2', { format:'csv' }).format === 'csv', 'manual CSV failed');
});
test('header mode none', () => {
  const r = ImportEngine.parse('id,name\n1,Alice', { headerMode:'none' });
  assert(r.tables[0].headers[0] === 'Column1' && r.tables[0].rows[0][0] === 'id', 'header none failed');
});
test('candidate explanations', () => {
  const r = ImportEngine.parse('id,name\n1,Alice');
  assert(Array.isArray(r.candidates) && r.candidates.length > 0 && typeof r.candidates[0].score === 'number', 'candidate metadata missing');
});

const failures = [];
for (const item of cases) {
  try { item.fn(); } catch (error) { failures.push(`${item.name}: ${error.message}`); }
}
if (failures.length) throw new Error(failures.join('\n'));
console.log(`Parser regression tests passed: ${cases.length}`);

if(process.argv.includes('--all')) {
  require('./run-build-tests');
  require('./run-startup-tests');
  require('./run-copy-tests');
  require('./run-tab-tests');
  require('./run-join-tests');
  require('./run-ui-tests');
}
if(process.argv.includes('--validate-release')) require('./validate-release').validateRelease();
