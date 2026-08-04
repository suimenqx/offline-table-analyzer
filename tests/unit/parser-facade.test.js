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

describe('Parser facade', () => {
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
});
