/**
 * ClipboardFormatter + Exporter 测试套件
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { createStorageMock } from '../mocks/storage.js';
import { createDOMSandbox } from '../mocks/dom.js';
import { loadModules } from '../helpers/load-modules.mjs';

const storage = createStorageMock();
const dom = createDOMSandbox();

const { OTA } = loadModules(
  ['clipboard', 'exporter'],
  { document: dom.document, window: dom.window, localStorage: storage }
);
const { ClipboardFormatter: F } = OTA.require('clipboard');
const { Exporter: E } = OTA.require('exporter');

// ---------------------------------------------------------------------------
describe('ClipboardFormatter — text formats', () => {
  const matrix = [['id', 'name'], ['1', 'Alice'], ['2', 'Bob, Jr.']];

  it('default format is TSV', () => {
    assert.equal(F.toText(matrix, 'default'), 'id\tname\n1\tAlice\n2\tBob, Jr.');
  });

  it('CSV quotes comma cells', () => {
    assert.equal(F.toText(matrix, 'csv'), 'id,name\n1,Alice\n2,"Bob, Jr."');
  });

  it('Markdown includes pipe header', () => {
    assert.ok(F.toText(matrix, 'markdown').includes('| id  | name     |'));
  });

  it('ASCII includes border', () => {
    assert.ok(F.toText(matrix, 'ascii').startsWith('+'));
  });
});

// ---------------------------------------------------------------------------
describe('ClipboardFormatter — multiline cells', () => {
  const multiline = [['id', 'desc'], ['1', 'line1\nline2'], ['2', 'literal<br>break']];

  it('default TSV quotes multiline and normalizes BR', () => {
    const text = F.toText(multiline, 'default');
    assert.ok(text.includes('"line1\nline2"'));
    assert.ok(text.includes('"literal\nbreak"'));
  });

  it('CSV quotes multiline', () => {
    assert.ok(F.toText(multiline, 'csv').includes('"line1\nline2"'));
  });

  it('Markdown renders multiline as <br>', () => {
    assert.ok(F.toText(multiline, 'markdown').includes('line1<br>line2'));
  });

  it('ASCII flattens multiline', () => {
    assert.ok(F.toText(multiline, 'ascii').includes('line1 line2'));
  });
});

// ---------------------------------------------------------------------------
describe('ClipboardFormatter — Lua formats', () => {
  it('lua-inline serializes one field per record', () => {
    const result = F.toText([['fieldA'], ['0'], ['1']], 'lua-inline');
    assert.equal(result, '{\n    [1] = { ["fieldA"] = 0 },\n    [2] = { ["fieldA"] = 1 },\n}');
  });

  it('lua-expanded serializes one field per line', () => {
    const result = F.toText([['fieldA'], ['0'], ['1']], 'lua-expanded');
    assert.ok(result.includes('["fieldA"] = 0,'));
    assert.ok(result.includes('["fieldA"] = 1,'));
  });

  it('lua-inline aligns expressions by field column', () => {
    const result = F.toText([['fieldA', 'fieldB'], ['0', '10'], ['100', '2']], 'lua-inline');
    assert.equal(result, '{\n    [1] = { ["fieldA"] = 0,   ["fieldB"] = 10 },\n    [2] = { ["fieldA"] = 100, ["fieldB"] = 2 },\n}');
  });

  it('returns empty table for header-only', () => {
    assert.equal(F.toText([['fieldA', 'fieldB']], 'lua-inline'), '{}');
  });
});

// ---------------------------------------------------------------------------
describe('ClipboardFormatter.formatLuaValue', () => {
  it('normalizes zero hex values', () => {
    assert.equal(F.formatLuaValue('0x0'), '0');
    assert.equal(F.formatLuaValue('0X0'), '0');
    assert.equal(F.formatLuaValue('0x00'), '0');
  });

  it('preserves non-zero hex spelling', () => {
    assert.equal(F.formatLuaValue('0x01'), '0x01');
    assert.equal(F.formatLuaValue('0XFF'), '0XFF');
  });

  it('keeps numeric literals', () => {
    assert.equal(F.formatLuaValue('10'), '10');
    assert.equal(F.formatLuaValue('-20'), '-20');
    assert.equal(F.formatLuaValue('1.5'), '1.5');
    assert.equal(F.formatLuaValue('-0.25'), '-0.25');
  });

  it('quotes leading-zero integers', () => {
    assert.equal(F.formatLuaValue('00123'), '"00123"');
    assert.equal(F.formatLuaValue('0001'), '"0001"');
  });

  it('only lowercase booleans stay literal', () => {
    assert.equal(F.formatLuaValue('true'), 'true');
    assert.equal(F.formatLuaValue('false'), 'false');
    assert.equal(F.formatLuaValue('TRUE'), '"TRUE"');
  });

  it('quotes empty and nil cells', () => {
    assert.equal(F.formatLuaValue(''), '""');
    assert.equal(F.formatLuaValue('nil'), '"nil"');
  });

  it('escapes special characters', () => {
    assert.equal(F.formatLuaValue('a"b\\c\n\r\t'), '"a\\"b\\\\c\\n\\r\\t"');
  });

  it('does not apply spreadsheet formula prefixes', () => {
    const result = F.toText([['fieldA'], ['=value']], 'lua-inline');
    assert.ok(result.includes('["fieldA"] = "=value"'));
  });
});

// ---------------------------------------------------------------------------
describe('ClipboardFormatter.toHtml', () => {
  const matrix = [['id', 'name'], ['1', 'Alice']];

  it('uses table markup by default', () => {
    const html = F.toHtml(matrix);
    assert.ok(html.includes('<table'));
    assert.ok(html.includes('<th'));
  });

  it('uses code markup for lua formats', () => {
    const html = F.toHtml([['fieldA'], ['=value']], 'lua-inline');
    assert.ok(html.startsWith('<pre><code>'));
    assert.ok(html.includes('&quot;=value&quot;'));
    assert.ok(!html.includes('<table'));
  });

  it('preserves visual line breaks in HTML', () => {
    const html = F.toHtml([['id', 'desc'], ['1', 'line1\nline2']]);
    assert.ok(html.includes('line1<br>line2'));
  });
});

// ---------------------------------------------------------------------------
describe('ClipboardFormatter — spreadsheet safety', () => {
  it('prefixes dangerous formula characters', () => {
    const formulas = [['value'], ['=CMD()'], ['+1+1'], ['@SUM(A1:A2)']];
    const safe = F.toText(formulas, 'csv');
    assert.ok(safe.includes("'=CMD()"));
    assert.ok(safe.includes("'+1+1"));
    assert.ok(safe.includes("'@SUM"));
  });

  it('keeps negative numbers as numeric text', () => {
    const formulas = [['value'], ['-10']];
    const safe = F.toText(formulas, 'csv');
    // 负数是纯数字文本，不添加前缀
    assert.ok(safe.endsWith('-10'));
    assert.ok(!safe.includes("'-10"));
  });
});

// ---------------------------------------------------------------------------
describe('Exporter — Excel XML', () => {
  const excelCell = value => E.buildSheetXml({
    headers: ['value'],
    rows: [[value]],
  }).match(/<row r="2">(.*?)<\/row>/)[1];

  it('exports short numeric text as number', () => {
    assert.ok(excelCell('12345').includes('t="n"'));
  });

  it('exports long integer identifiers as text', () => {
    assert.ok(excelCell('123456789012345678').includes('t="inlineStr"'));
  });

  it('exports high precision decimals as text', () => {
    assert.ok(excelCell('123.456789012345678').includes('t="inlineStr"'));
  });

  it('exports leading-zero negatives as text', () => {
    assert.ok(excelCell('-00123').includes('t="inlineStr"'));
  });

  it('exports finite numbers as numeric', () => {
    assert.ok(excelCell(123456789012345).includes('t="n"'));
  });
});
