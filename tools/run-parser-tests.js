const fs = require('fs');
const vm = require('vm');
const path = require('path');

if(process.argv.includes('--clean-production')) require('./validate-release').cleanProductionHooks();

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8').replace(/^\uFEFF/, '');
const script = html.split('<script>')[1].split('</script>')[0];
const start = script.indexOf('/* Import Engine */');
const end = script.indexOf('/* Joiner */');
if (start < 0 || end < 0) throw new Error('Import Engine markers not found');
const code = script.slice(start, end) + '\nwindow.__IMPORTS__ = { ImportEngine, TableUtils, HeaderResolver, Delimited };';
const sandbox = {
  console,
  window: {},
  document: { createElement() { return { innerHTML: '', textContent: '', innerText: '' }; } }
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'import-engine.js' });
const { ImportEngine } = sandbox.window.__IMPORTS__;

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
test('HTML clipboard table', () => {
  const htmlTable = '<table><tr><th>id</th><th>name</th></tr><tr><td>1</td><td>Alice</td></tr></table>';
  const r = ImportEngine.parse({ text:'id\tname\n1\tAlice', html:htmlTable });
  assert(r.format === 'html-table' && r.tables[0].headers[1] === 'name', 'HTML failed');
});
test('HTML rowspan expansion', () => {
  const htmlTable = '<table><tr><th>group</th><th>name</th></tr><tr><td rowspan="2">A</td><td>Alice</td></tr><tr><td>Bob</td></tr></table>';
  const r = ImportEngine.parse({ text:'', html:htmlTable });
  assert(r.tables[0].rows.length === 2 && r.tables[0].rows[1][1] === 'Bob', 'rowspan failed');
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
  require('./run-copy-tests');
  require('./run-tab-tests');
  require('./run-join-tests');
  require('./run-ui-tests');
}
if(process.argv.includes('--validate-release')) require('./validate-release').validateRelease();
