/**
 * Parser 测试套件 — CSV / TSV / Pipe / ASCII / Fixed-Width / Aligned / CLI-Multi-Block / Data-Block / HTML
 *
 * 覆盖 ImportEngine.parse() 的所有格式自动检测、手动指定、诊断报告。
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { loadModules } from '../helpers/load-modules.mjs';

// 一次性加载所有 parser 相关模块
const { OTA } = loadModules(['import-engine', 'joiner']);
const { ImportEngine } = OTA.require('import-engine');
const { Joiner } = OTA.require('joiner');

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------
const parse = (input, opts = {}) => ImportEngine.parse(input, opts);
const firstTable = (r) => r.tables[0];

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
describe('CSV parser', () => {
  it('parses simple comma-separated values', () => {
    const r = parse('id,name,age\n1,Alice,20\n2,Bob,30');
    assert.equal(r.format, 'csv');
    assert.deepEqual(firstTable(r).headers, ['id', 'name', 'age']);
    assert.equal(firstTable(r).rows.length, 2);
    assert.deepEqual(firstTable(r).rows[0], ['1', 'Alice', '20']);
  });

  it('handles quoted fields with commas inside', () => {
    const r = parse('id,name,comment\n1,Alice,"hello, world"\n2,Bob,"a ""quoted"" value"');
    assert.equal(r.format, 'csv');
    assert.equal(firstTable(r).rows[0][2], 'hello, world');
    assert.equal(firstTable(r).rows[1][2], 'a "quoted" value');
  });

  it('handles multiline fields in quotes', () => {
    const r = parse('id,comment\n1,"line 1\nline 2"', { format: 'csv' });
    assert.equal(firstTable(r).rows[0][1], 'line 1\nline 2');
  });

  it('reports unclosed quote diagnostic', () => {
    const r = parse('id,name\n1,"Alice', { format: 'csv' });
    assert.ok(r.diagnostics.some(d => d.code === 'UNCLOSED_QUOTE'));
  });

  it('preserves tabs inside quoted CSV fields', () => {
    const r = parse('id,note\n1,"hello\tworld"');
    assert.equal(r.format, 'csv');
    assert.equal(firstTable(r).rows[0][1], 'hello\tworld');
  });

  it('does not misdetect whitespace-separated text as CSV', () => {
    const r = parse('1 2\n3 4');
    assert.equal(r.format, 'plain-text');
    assert.equal(firstTable(r).headers.length, 2);
    assert.equal(firstTable(r).rows.length, 2);
  });
});

// ---------------------------------------------------------------------------
// TSV / Excel-paste
// ---------------------------------------------------------------------------
describe('TSV (excel-paste) parser', () => {
  it('recognizes tab-separated values', () => {
    const r = parse('id\tname\tage\n1\tAlice\t20');
    assert.equal(r.format, 'excel-paste');
    assert.equal(firstTable(r).headers[1], 'name');
  });

  it('converts <br> tags to newlines', () => {
    const r = parse('id\tdesc\n1\tline1<br>line2\n2\tlineA&lt;br /&gt;lineB', { format: 'excel-paste' });
    assert.equal(firstTable(r).rows[0][1], 'line1\nline2');
    assert.equal(firstTable(r).rows[1][1], 'lineA\nlineB');
  });
});

// ---------------------------------------------------------------------------
// Semicolon CSV
// ---------------------------------------------------------------------------
describe('Semicolon CSV parser', () => {
  it('parses semicolon-delimited values', () => {
    const r = parse('id;name;score\n1;Alice;9\n2;Bob;8');
    assert.equal(r.format, 'semicolon-csv');
    assert.equal(firstTable(r).rows[1][1], 'Bob');
  });
});

// ---------------------------------------------------------------------------
// Generated headers / header modes
// ---------------------------------------------------------------------------
describe('Header resolution', () => {
  it('generates ColumnN headers when no header row detected', () => {
    const r = parse('1,Alice,20\n2,Bob,30');
    assert.equal(firstTable(r).headers[0], 'Column1');
    assert.equal(firstTable(r).rows.length, 2);
  });

  it('treats ambiguous string-first rows as data, not headers', () => {
    const r = parse('Alice,NY\nBob,LA');
    assert.equal(firstTable(r).headers[0], 'Column1');
    assert.equal(firstTable(r).rows.length, 2);
  });

  it('normalizes duplicate and blank headers', () => {
    const r = parse('id,,id\n1,Alice,100');
    assert.deepEqual(firstTable(r).headers, ['id', 'Column2', 'id_2']);
  });

  it('handles headerMode=none (forced no-header)', () => {
    const r = parse('id,name\n1,Alice', { headerMode: 'none' });
    assert.equal(firstTable(r).headers[0], 'Column1');
    assert.equal(firstTable(r).rows[0][0], 'id');
  });

  it('handles row width mismatch with overflow', () => {
    const r = parse('id,name,age\n1,Alice,20\n2,Bob\n3,Cindy,25,extra');
    assert.equal(firstTable(r).rows[2][3], 'extra');
    assert.ok(r.diagnostics.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Pipe table (Markdown)
// ---------------------------------------------------------------------------
describe('Pipe table (Markdown) parser', () => {
  it('parses standard Markdown tables', () => {
    const r = parse('| id | name |\n|----|------|\n| 1 | Alice |');
    assert.equal(r.format, 'pipe-table');
    assert.equal(firstTable(r).headers[0], 'id');
  });

  it('handles escaped pipe characters', () => {
    const r = parse('| id | note |\n|---|---|\n|1|a\\|b|');
    assert.equal(firstTable(r).rows[0][1], 'a|b');
  });

  it('is not confused by horizontal rules with pipe text', () => {
    const r = parse('| a | b |\n| 1 | 2 |\n---\ntext');
    assert.equal(r.format, 'pipe-table');
    assert.equal(firstTable(r).rows[0][0], '1');
  });

  it('falls back to plain text for horizontal rule prose', () => {
    const r = parse('Title\n---\nparagraph text');
    assert.equal(r.format, 'plain-text');
    assert.equal(r.tables.length, 1);
  });
});

// ---------------------------------------------------------------------------
// ASCII table
// ---------------------------------------------------------------------------
describe('ASCII table parser', () => {
  it('parses bordered ASCII tables', () => {
    const r = parse('+----+-------+\n| id | name  |\n+----+-------+\n| 1  | Alice |\n+----+-------+');
    assert.equal(r.format, 'ascii-table');
    assert.equal(firstTable(r).rows[0][1], 'Alice');
  });
});

// ---------------------------------------------------------------------------
// Fixed-width
// ---------------------------------------------------------------------------
describe('Fixed-width parser', () => {
  it('parses fixed-width columns', () => {
    const r = parse('id   name       age\n1    Alice      20\n2    Bob        30');
    assert.equal(r.format, 'fixed-width');
  });
});

// ---------------------------------------------------------------------------
// Aligned table
// ---------------------------------------------------------------------------
describe('Aligned table parser', () => {
  describe('separator scenarios', () => {
    it('scenario A — separators on both sides', () => {
      const input = '---\ncol1    col2              col3             col4       col5\nval1    val2              val3             val4       val5\nval6    --                val7             --         val8\n---';
      const r = parse(input);
      assert.equal(r.format, 'aligned-table');
      assert.equal(firstTable(r).headers.length, 5);
      assert.equal(firstTable(r).rows[0][0], 'val1');
      assert.equal(firstTable(r).rows[1][1], '--');
      assert.equal(firstTable(r).rows[1][3], '--');
      assert.equal(firstTable(r).rows[0][4], 'val5');
    });

    it('scenario B — top separator only', () => {
      const input = '---\ncol1    col2              col3\nval1    val2              val3';
      const r = parse(input);
      assert.equal(r.format, 'aligned-table');
      assert.equal(firstTable(r).headers[1], 'col2');
      assert.equal(firstTable(r).rows[0][2], 'val3');
    });

    it('scenario C — bottom separator only', () => {
      const input = 'col1    col2              col3\nval1    val2              val3\n---';
      const r = parse(input);
      assert.equal(r.format, 'aligned-table');
      assert.equal(firstTable(r).headers[0], 'col1');
      assert.equal(firstTable(r).rows[0][1], 'val2');
    });

    it('scenario D — no separators (manual format)', () => {
      const input = 'col1    col2              col3             col4       col5\nval1    val2              val3             val4       val5';
      const r = parse(input, { format: 'aligned-table' });
      assert.equal(r.format, 'aligned-table');
      assert.equal(firstTable(r).headers[3], 'col4');
      assert.equal(firstTable(r).rows[0][0], 'val1');
    });
  });

  it('handles multi-table input with separators', () => {
    const input = '---\nA    B              C\n1    x              y\n---\nX    Y              Z\n10   foo            bar\n---';
    const r = parse(input);
    assert.equal(r.tables.length, 2);
    assert.equal(r.tables[0].rows.length, 1);
    assert.equal(r.tables[1].rows.length, 1);
    assert.equal(r.tables[0].headers[0], 'A');
    assert.equal(r.tables[1].headers[0], 'X');
  });

  it('uses title between dashes as table name', () => {
    const input = '---\nMy Table\n---\ncol1    col2\nval1    val2';
    const r = parse(input);
    assert.equal(r.format, 'aligned-table');
    assert.ok(r.tables[0].name.startsWith('My Table'));
    assert.equal(firstTable(r).headers[0], 'col1');
  });

  it('does not promote header-like title to columns', () => {
    const input = ['---', 'Status Overview', '---', 'ID    Name', '1     Alice', '2     Bob'].join('\n');
    const r = parse(input);
    assert.equal(r.tables[0].name, 'Status Overview');
    assert.deepEqual(firstTable(r).headers, ['ID', 'Name']);
    assert.equal(firstTable(r).rows.length, 2);
  });

  it('handles header between dashes separated from data', () => {
    const input = '---\ncol1    col2              col3\n---\nval1    val2              val3\nval4    val5              val6';
    const r = parse(input);
    assert.equal(r.format, 'aligned-table');
    assert.equal(firstTable(r).headers.length, 3);
    assert.equal(firstTable(r).rows.length, 2);
    assert.equal(firstTable(r).rows[0][0], 'val1');
    assert.equal(firstTable(r).rows[1][2], 'val6');
  });

  it('handles report-style header with long separator line', () => {
    const input = [
      'ColA       ColB    ColC   ColD         ColE            ColF        ColG        ColH             ColI',
      '------------------------------------------------------------------------------------------------------------------------',
      'val1       down    full   type-1       attr-1          -40.00unit  -2.02unit   ModeA            PN-001',
      'val2       down    full   type-2       attr-2          -40.00unit  -5.73unit   ModeA            PN-002',
      'val3       up      full   type-3       attr-3          -2.44unit   -2.48unit   ModeB            PN-003'
    ].join('\n');
    const r = parse(input);
    assert.equal(r.format, 'aligned-table');
    assert.deepEqual(firstTable(r).headers, ['ColA', 'ColB', 'ColC', 'ColD', 'ColE', 'ColF', 'ColG', 'ColH', 'ColI']);
    assert.equal(firstTable(r).rows.length, 3);
    assert.equal(firstTable(r).rows[2][8], 'PN-003');
  });

  it('handles multi-word headers with stable data positions', () => {
    const input = [
      '------------------------------------------------------------------------------------',
      'Physical dascacsa    Feature Name    Needed Count    Used Count      Active Status',
      '------------------------------------------------------------------------------------',
      '0001da               AAAAAAAAAAA     0               0               No allocated',
      '0001da               AAAAAAAAAAA     1               1               Activated'
    ].join('\n');
    const r = parse(input);
    assert.equal(r.format, 'aligned-table');
    assert.deepEqual(firstTable(r).headers, ['Physical dascacsa', 'Feature Name', 'Needed Count', 'Used Count', 'Active Status']);
    assert.equal(firstTable(r).rows.length, 2);
    assert.equal(firstTable(r).rows[1].join('|'), '0001da|AAAAAAAAAAA|1|1|Activated');
  });

  it('handles compact headers with mixed data widths', () => {
    const input = [
      '---------------------------------------------------------------------------------------------------------------------------------------------',
      'Port                   Status Duplex Type                 Wavelength            RxPower     TxPower     Mode             VendorPN',
      '---------------------------------------------------------------------------------------------------------------------------------------------',
      'ETH0/2/0               down   full   1G-40km-TEST         1310.00nm             -40.00dBm   -2.02dBm    SingleMode       TEST',
      '---------------------------------------------------------------------------------------------------------------------------------------------'
    ].join('\n');
    const r = parse(input);
    assert.equal(r.format, 'aligned-table');
    assert.deepEqual(firstTable(r).headers, ['Port', 'Status', 'Duplex', 'Type', 'Wavelength', 'RxPower', 'TxPower', 'Mode', 'VendorPN']);
    assert.equal(firstTable(r).rows.length, 1);
    assert.equal(firstTable(r).rows[0].join('|'), 'ETH0/2/0|down|full|1G-40km-TEST|1310.00nm|-40.00dBm|-2.02dBm|SingleMode|TEST');
    assert.ok(!firstTable(r).rows.some(row => row.some(cell => /^---+$/.test(cell))));
  });

  it('handles CJK terminal-width inventory report', () => {
    const input = [
      '---------------------------------------------------------------------------------------------------------------------------------------------',
      'SKU                    Status  Pack   Spec                  NetWeight       CostPrice   ListPrice   Storage           SupplierCode',
      '---------------------------------------------------------------------------------------------------------------------------------------------',
      'SP-A02-00              缺货    整箱   500ml-24pk-PET        12.00kg         18.50       36.80       常温              HSF-243MD',
      'SP-A02-01              缺货    整箱   500ml-12pk-PET        6.00kg          15.20       32.50       常温              RXTX191-400',
      'SP-A02-17              在售    整箱   1L-12pk-PET           12.00kg         12.48       24.48       常温              RXTX228-401',
      '---------------------------------------------------------------------------------------------------------------------------------------------'
    ].join('\n');
    const r = parse(input);
    assert.equal(r.format, 'aligned-table');
    assert.deepEqual(firstTable(r).headers, ['SKU', 'Status', 'Pack', 'Spec', 'NetWeight', 'CostPrice', 'ListPrice', 'Storage', 'SupplierCode']);
    assert.equal(firstTable(r).rows.length, 3);
    assert.equal(firstTable(r).rows[0].join('|'), 'SP-A02-00|缺货|整箱|500ml-24pk-PET|12.00kg|18.50|36.80|常温|HSF-243MD');
    assert.equal(firstTable(r).rows[2][1], '在售');
    assert.ok(!r.diagnostics.some(d => d.code === 'ALIGNED_POSITION_MISMATCH'));
  });

  it('handles plus sign separators', () => {
    const input = 'ColA       ColB    ColC\n------+-------+----\nval1       down    full';
    const r = parse(input);
    assert.equal(r.format, 'aligned-table');
    assert.deepEqual(firstTable(r).headers, ['ColA', 'ColB', 'ColC']);
    assert.equal(firstTable(r).rows.length, 1);
    assert.equal(firstTable(r).rows[0][1], 'down');
  });

  it('preserves hex values', () => {
    const input = 'Addr    Val\n0x1000  0xFF\n0x2000  0x1A';
    const r = parse(input);
    assert.equal(firstTable(r).rows[0][0], '0x1000');
    assert.equal(firstTable(r).rows[1][1], '0x1A');
  });

  it('preserves values that overflow header positions', () => {
    const input = 'ID    Name    Age\n1     VeryLongNameHere    20';
    const r = parse(input, { format: 'aligned-table' });
    assert.equal(firstTable(r).rows[0].join('|'), '1|VeryLongNameHere|20');
    assert.ok(r.diagnostics.some(d => d.code === 'ALIGNED_POSITION_MISMATCH'));
  });

  it('keeps aligned detection on repeated recoverable overflow', () => {
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
    const r = parse(input);
    assert.equal(r.format, 'aligned-table');
    assert.equal(firstTable(r).rows.length, 6);
    assert.equal(firstTable(r).rows[5].join('|'), '6|VeryLongNameSix|25');
  });

  it('works with manual format selection', () => {
    const r = parse('col1    col2\nval1    val2', { format: 'aligned-table' });
    assert.equal(r.format, 'aligned-table');
  });
});

// ---------------------------------------------------------------------------
// CLI Multi-Block
// ---------------------------------------------------------------------------
describe('CLI multi-block parser', () => {
  describe('mode A — double-separator sections', () => {
    it('parses multiple named sections', () => {
      const input = [
        'Module Overview:',
        '====================================================================================',
        'ModuleName             Description',
        '------------------------------------------------------------------------------------',
        'SNPX200ACL1            Optix X8K 2*10G Service Board',
        '',
        'Resource allocation:',
        '====================================================================================',
        'ModuleName             Reserved     InUse        Free         Total',
        '------------------------------------------------------------------------------------',
        'SNPX200ACL1            0            1            3            4',
        '',
        'Port status:',
        '====================================================================================',
        'Slot/Port          ModuleName      Configured    Connected     OperState',
        '------------------------------------------------------------------------------------',
        '1/1/0              SNPX200ACL1     1             1             Up',
        '1/1/1              SNPX200ACL1     1             0             Down',
        '1/1/2              SNPX200ACL1     0             0             Idle'
      ].join('\n');
      const r = parse(input);
      assert.equal(r.format, 'cli-multi-block');
      assert.equal(r.tables.length, 3);
      assert.equal(r.tables.map(t => t.name).join('|'), 'Module Overview|Resource allocation|Port status');
      assert.equal(r.tables[1].headers.join('|'), 'ModuleName|Reserved|InUse|Free|Total');
      assert.equal(r.tables[1].rows[0].join('|'), 'SNPX200ACL1|0|1|3|4');
      assert.equal(r.tables[2].rows[2].join('|'), '1/1/2|SNPX200ACL1|0|0|Idle');
    });

    it('infers titles without blank lines', () => {
      const input = [
        'Module Overview:',
        '====================================================================================',
        'ModuleName             Description',
        '------------------------------------------------------------------------------------',
        'SNPX200ACL1            Optix X8K 2*10G Service Board',
        'Resource allocation:',
        '====================================================================================',
        'ModuleName             Reserved     InUse        Free         Total',
        '------------------------------------------------------------------------------------',
        'SNPX200ACL1            0            1            3            4'
      ].join('\n');
      const r = parse(input);
      assert.equal(r.tables.map(t => t.name).join('|'), 'Module Overview|Resource allocation');
    });

    it('preserves spaces inside header titles', () => {
      const input = [
        'Port status',
        '============================================================',
        'Slot/Port          Module Name      Oper State       Link Type',
        '------------------------------------------------------------',
        '1/1/0              SNPX200ACL1     Up               Ethernet',
        '1/1/1              SNPX200ACL2     Down             Optical'
      ].join('\n');
      const r = parse(input);
      assert.equal(r.format, 'cli-multi-block');
      assert.equal(firstTable(r).headers.join('|'), 'Slot/Port|Module Name|Oper State|Link Type');
      assert.equal(firstTable(r).rows[0].join('|'), '1/1/0|SNPX200ACL1|Up|Ethernet');
    });

    it('infers one-space adjacent columns from aligned data', () => {
      const input = [
        'Port status',
        '============================================================',
        'A B        Module Name    Oper State',
        '------------------------------------------------------------',
        '1 2        SNPX200ACL1    Up',
        '3 4        SNPX200ACL2    Down'
      ].join('\n');
      const r = parse(input, { format: 'cli-multi-block' });
      assert.equal(firstTable(r).headers.join('|'), 'A|B|Module Name|Oper State');
      assert.equal(firstTable(r).rows[0].join('|'), '1|2|SNPX200ACL1|Up');
      assert.equal(r.diagnostics.length, 0);
    });
  });

  describe('mode B — decorated separators', () => {
    it('parses sections with pipe-decorated separators', () => {
      const input = [
        'GE0/3/2 performance counters',
        '=============|=====================================================================================',
        '             sampling   highThresh   lowThresh    period       alarmCtrl  alarmType  counter',
        '-------------|-------------------------------------------------------------------------------------',
        'rx-unicast    on         5000         200          5            off        none       0',
        'tx-unicast    on         5000         200          5            off        none       0',
        '=============|=====================================================================================',
        '             enable        threshold       alarmCtrl   alarmType',
        '-------------|-------------------------------------------------------------------------------------',
        'bip8-sd      on            3                off         none'
      ].join('\n');
      const r = parse(input);
      assert.equal(r.format, 'cli-multi-block');
      assert.equal(r.tables.length, 2);
      assert.equal(r.tables[0].name, 'GE0/3/2 performance counters');
      assert.equal(r.tables[1].name, 'GE0/3/2 performance counters (2)');
      assert.equal(r.tables[0].headers[0], 'Column1');
      assert.equal(r.tables[0].headers[7], 'counter');
      assert.equal(r.tables[0].rows[1].join('|'), 'tx-unicast|on|5000|200|5|off|none|0');
      assert.equal(r.tables[1].rows[0].join('|'), 'bip8-sd|on|3|off|none');
      assert.equal(r.diagnostics.filter(d => d.code === 'MISSING_FIRST_HEADER').length, 2);
    });
  });

  describe('edge cases and diagnostics', () => {
    it('falls back and reports position mismatch', () => {
      const input = [
        'Table',
        '====================',
        'A     B     C',
        '--------------------',
        '1     wide value     2     overflow'
      ].join('\n');
      const r = parse(input);
      assert.equal(r.format, 'cli-multi-block');
      assert.equal(firstTable(r).rows[0].join('|'), '1|wide value|2|overflow');
      assert.ok(r.diagnostics.some(d => d.code === 'POSITION_MISMATCH'));
      assert.ok(r.diagnostics.some(d => d.code === 'ROW_WIDTH_MISMATCH'));
    });

    it('is not auto-detected without ==== separator', () => {
      const r = parse('A\n--------------------\n1');
      assert.notEqual(r.format, 'cli-multi-block');
    });

    it('reports MISSING_SEPARATOR diagnostic when forced but incomplete', () => {
      const r = parse('Title\n====================', { format: 'cli-multi-block' });
      assert.equal(r.tables.length, 0);
      assert.ok(r.diagnostics.some(d => d.code === 'MISSING_SEPARATOR'));
    });

    it('reports EMPTY_TABLE_BLOCK diagnostic for empty blocks', () => {
      const r = parse('Title\n====================\nA     B\n--------------------', { format: 'cli-multi-block' });
      assert.equal(r.tables.length, 0);
      assert.ok(r.diagnostics.some(d => d.code === 'EMPTY_TABLE_BLOCK'));
    });

    it('falls back to aligned-table when ==== is absent', () => {
      const r = parse('A     B\n--------------------\n1     2');
      assert.equal(r.format, 'aligned-table');
    });
  });

  it('meets 10×100 row performance target', () => {
    const chunks = [];
    for (let block = 0; block < 10; block++) {
      chunks.push(`Block ${block + 1}`, '='.repeat(80), 'Name             Value        State', '-'.repeat(80));
      for (let row = 0; row < 100; row++) chunks.push(`item-${block}-${row}       ${row}            Up`);
      if (block < 9) chunks.push('');
    }
    const started = Date.now();
    const r = parse(chunks.join('\n'));
    const elapsed = Date.now() - started;
    assert.equal(r.format, 'cli-multi-block');
    assert.equal(r.tables.length, 10);
    assert.ok(r.tables.every(t => t.rows.length === 100));
    assert.ok(elapsed <= 1000, `CLI 10×100 parse took ${elapsed}ms, expected ≤ 1000ms`);
  });
});

// ---------------------------------------------------------------------------
// Data-block
// ---------------------------------------------------------------------------
describe('Data-block parser', () => {
  it('handles multiple named tables and sparse fields', () => {
    const input = `module MALL;\n\ndata First [
    {id : "0x01", name : "Alice", note : "a, b"},
    {id : "0x02", name : "Bob"}
]
data Second [{id:"0x01", category:ELECTRONICS},{id:"0x03", category:"HOME"}]`;
    const r = parse(input);
    assert.equal(r.format, 'data-block');
    assert.equal(r.tables.length, 2);
    assert.equal(r.tables[0].name, 'First');
    assert.equal(r.tables[1].name, 'Second');
    assert.equal(r.tables[0].headers.join('|'), 'id|name|note');
    assert.equal(r.tables[0].rows[1].join('|'), '0x02|Bob|');
    assert.equal(r.tables[1].rows[0].join('|'), '0x01|ELECTRONICS');
    assert.equal(r.tables[0].rows[0][2], 'a, b');
    assert.ok(r.tables.every(t => t.headers.every(v => typeof v === 'string') &&
      t.rows.every(row => row.every(v => typeof v === 'string'))));

    const joined = Joiner.run(r.tables, {
      view: 'FirstSecond', left: 'First', right: 'Second', type: 'inner',
      on: 'id=id', select: 'left.id,right.category'
    });
    assert.equal(joined.rows.length, 1);
    assert.equal(joined.rows[0].join('|'), '0x01|ELECTRONICS');
  });

  it('handles same-line records, escaped quotes, and empty blocks', () => {
    const input = 'data Empty [] data Messages [{text:"say \\\"hello\\\"", path:"a/b"},{text:"next"}]';
    const r = parse(input, { format: 'data-block' });
    assert.equal(r.tables.length, 2);
    assert.equal(r.tables[0].rows.length, 0);
    assert.equal(r.tables[1].rows.length, 2);
    assert.equal(r.tables[1].rows[0][0], 'say "hello"');
    assert.equal(r.tables[1].rows[0][1], 'a/b');
    assert.equal(r.tables[1].rows[1][1], '');
  });

  it('recovers from malformed records and reports diagnostics', () => {
    const r = parse('data Broken [{id "1", name:"ok"},{id:"2"', { format: 'data-block' });
    assert.equal(r.tables.length, 1);
    assert.equal(r.tables[0].rows.length, 2);
    assert.ok(r.diagnostics.some(d => d.code === 'MISSING_COLON'));
    assert.ok(r.diagnostics.some(d => d.code === 'UNMATCHED_BRACE'));
  });

  it('is not falsely detected for non-data-block input', () => {
    assert.notEqual(parse('module MALL;').format, 'data-block');
    assert.notEqual(parse('data NotADataBlock;').format, 'data-block');
    const broken = parse('data Broken [{id:"1"]');
    const candidate = (broken.candidates || []).find(c => c.id === 'data-block');
    assert.ok(!candidate || candidate.score < 0.9);
  });

  it('degrades gracefully when forced on non-data-block input', () => {
    const r = parse('module MALL;', { format: 'data-block' });
    assert.equal(r.tables.length, 0);
    assert.ok(r.diagnostics.some(d => d.code === 'NO_DATA_BLOCK'));
  });
});

// ---------------------------------------------------------------------------
// HTML table
// ---------------------------------------------------------------------------
describe('HTML parser', () => {
  it('auto-detects raw HTML tables', () => {
    const r = parse('<table><tr><th>id</th><th>name</th></tr><tr><td>1</td><td>Alice</td></tr></table>');
    assert.equal(r.format, 'html-table');
    assert.equal(firstTable(r).headers[1], 'name');
  });

  it('prefers HTML clipboard over text', () => {
    const htmlTable = '<table><tr><th>id</th><th>name</th></tr><tr><td>1</td><td>Alice</td></tr></table>';
    const r = ImportEngine.parse({ text: 'id\tname\n1\tAlice', html: htmlTable });
    assert.equal(r.format, 'html-table');
    assert.equal(firstTable(r).headers[1], 'name');
  });

  it('expands rowspan', () => {
    const html = '<table><tr><th>group</th><th>name</th></tr><tr><td rowspan="2">A</td><td>Alice</td></tr><tr><td>Bob</td></tr></table>';
    const r = ImportEngine.parse({ text: '', html });
    assert.equal(firstTable(r).rows.length, 2);
    assert.equal(firstTable(r).rows[1][0], 'A');
    assert.equal(firstTable(r).rows[1][1], 'Bob');
  });

  it('expands combined rowspan and colspan', () => {
    const html = '<table><tr><th>group</th><th>detail</th><th>name</th></tr><tr><td rowspan="2" colspan="2">A</td><td>Alice</td></tr><tr><td>Bob</td></tr></table>';
    const r = ImportEngine.parse({ text: '', html });
    assert.equal(firstTable(r).rows[1].join('|'), 'A||Bob');
  });

  it('preserves br variants and escaped br as semantic newlines', () => {
    const html = '<table><tr><th>id</th><th>note</th></tr><tr><td>1</td><td>first<br>second<BR/>third<br />fourth&lt;br&gt;fifth</td></tr></table>';
    const r = ImportEngine.parse({ text: '', html });
    assert.equal(firstTable(r).rows[0][1], 'first\nsecond\nthird\nfourth\nfifth');
  });

  it('inserts one newline between block elements inside a cell', () => {
    const html = '<table><tr><th>id</th><th>note</th></tr><tr><td>1</td><td><div>first</div><p>second <strong>line</strong></p><ul><li>third</li><li>fourth</li></ul></td></tr></table>';
    const r = ImportEngine.parse({ text: '', html });
    assert.equal(firstTable(r).rows[0][1], 'first\nsecond line\nthird\nfourth');
  });

  it('normalizes source whitespace around preserved line breaks', () => {
    const html = '<table><tr><th>id</th><th>note</th></tr><tr><td>1</td><td>\n  line 1  \r\n\t line 2 \n</td></tr></table>';
    const r = ImportEngine.parse({ text: '', html });
    assert.equal(firstTable(r).rows[0][1], 'line 1\nline 2');
  });

  it('preserves meaningful indentation inside pre while trimming cell edges', () => {
    const html = '<table><tr><th>id</th><th>note</th></tr><tr><td>1</td><td><pre>  line 1\n    line 2</pre></td></tr></table>';
    const r = ImportEngine.parse({ text: '', html });
    assert.equal(firstTable(r).rows[0][1], 'line 1\n    line 2');
  });

  it('decodes named and numeric entities without turning ordinary tags into breaks', () => {
    const html = '<table><tr><th>id</th><th>note</th></tr><tr><td>1</td><td>&nbsp;A &amp; B &lt;div&gt;literal&lt;/div&gt; &#x4e2d;&#25991;</td></tr></table>';
    const r = ImportEngine.parse({ text: '', html });
    assert.equal(firstTable(r).rows[0][1], 'A & B <div>literal</div> 中文');
  });

  it('keeps intentional repeated br breaks but trims only cell-edge breaks', () => {
    const html = '<table><tr><th>id</th><th>note</th></tr><tr><td>1</td><td><br>first<br><br>third<br></td></tr></table>';
    const r = ImportEngine.parse({ text: '', html });
    assert.equal(firstTable(r).rows[0][1], 'first\n\nthird');
  });
});

// ---------------------------------------------------------------------------
// Legacy CLI table-data
// ---------------------------------------------------------------------------
describe('Legacy CLI table-data parser', () => {
  it('parses legacy format', () => {
    const r = parse('table-data Users\nvalidflag ID Name\n1 100 Alice\n1 101 Bob\n\ntable-data Orders\nvalidflag OrderID UserID\n1 5001 100');
    assert.equal(r.tables.length, 2);
    assert.equal(r.tables[0].rows.length, 2);
  });

  it('handles prefixed legacy marker', () => {
    const r = parse('[TEST] table-data table-data Inventory\nvalidflag ID Product\n1 100 Widget');
    assert.equal(r.tables[0].name, 'Inventory');
    assert.equal(r.tables[0].meta.generatedHeaders, false);
  });
});

// ---------------------------------------------------------------------------
// Format selection & candidates
// ---------------------------------------------------------------------------
describe('Format selection', () => {
  it('respects manual format selection', () => {
    assert.equal(parse('a,b\n1,2', { format: 'csv' }).format, 'csv');
  });

  it('provides candidate explanations', () => {
    const r = parse('id,name\n1,Alice');
    assert.ok(Array.isArray(r.candidates));
    assert.ok(r.candidates.length > 0);
    assert.equal(typeof r.candidates[0].score, 'number');
  });
});

// ---------------------------------------------------------------------------
// Edge cases & regression
// ---------------------------------------------------------------------------
describe('Edge cases', () => {
  it('handles empty input gracefully', () => {
    const r = parse('');
    assert.ok(r.tables);
    assert.ok(Array.isArray(r.tables));
  });

  it('handles whitespace-only input', () => {
    const r = parse('   \n  \n  ');
    assert.ok(r.tables);
    assert.ok(Array.isArray(r.tables));
  });

  it('handles single-cell input', () => {
    const r = parse('hello');
    assert.ok(r.tables.length >= 0);
  });

  it('handles very long lines without crashing', () => {
    const long = 'x'.repeat(10000);
    assert.doesNotThrow(() => parse(`a,b\n${long},y`));
  });

  it('handles Unicode gracefully', () => {
    const r = parse('名称,值\n项目1,💯\n项目2,🀄');
    assert.doesNotThrow(() => firstTable(r));
  });
});
