/**
 * Parser facade regression tests.
 * The application consumes the complete ImportEngine result object.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { loadModules } from '../helpers/load-modules.mjs';

const { OTA } = loadModules(['parser-facade', 'table-registry']);
const { Parser } = OTA.require('parser-facade');
const { TableRegistry } = OTA.require('table-registry');
const { ImportEngine } = OTA.require('import-engine');

describe('Parser facade', () => {
  it('requires DOM parsing only for the selected HTML path',()=>{
    const text='table-data T\nvalidflag ID\n1 001';
    const html='<table><tr><th>ID</th></tr><tr><td>009</td></tr></table>';
    assert.equal(ImportEngine.requiresDOMParser(text,{html:'<pre>CLI output</pre>'}),false);
    assert.equal(ImportEngine.requiresDOMParser(text,{html}),true);
    assert.equal(Parser.parse(text,{html}).format,'html-table');
    assert.equal(ImportEngine.requiresDOMParser(text,{html,format:'cli-table-data'}),false);
    assert.equal(Parser.parse(text,{html,format:'cli-table-data'}).format,'cli-table-data');
    assert.equal(ImportEngine.requiresDOMParser(html),true);
    assert.equal(ImportEngine.requiresDOMParser(text,{format:'html-table'}),true);
    assert.equal(ImportEngine.requiresDOMParser('id,name\n001,Alice',{html,format:'csv'}),false);
  });

  it('passes the complete parse result to the table registry', () => {
    const input = [
      'table-data Inventory',
      'validflag ID Product',
      '1 1001 Widget_A',
      '1 1002 Widget_B',
      '',
      'table-data Orders',
      'validflag OrderID ProductID',
      '1 5001 1001',
    ].join('\n');

    const result = Parser.parse(input);

    assert.equal(Array.isArray(result), false);
    assert.equal(result.format, 'cli-table-data');
    assert.equal(result.tables.length, 2);

    TableRegistry.setResult(result);
    assert.equal(TableRegistry.getRaw().length, 2);
    assert.deepEqual(TableRegistry.getRaw().map(table => table.name), ['Inventory', 'Orders']);
  });

  it('returns parse failures as structured data for the application to present', () => {
    const previousParse = ImportEngine.parse;
    ImportEngine.parse = () => { throw new Error('invalid source'); };
    try {
      const result = Parser.parse('broken');
      assert.equal(result.format, 'error');
      assert.equal(result.diagnostics[0].message, 'invalid source');
    } finally {
      ImportEngine.parse = previousParse;
    }
  });
});
