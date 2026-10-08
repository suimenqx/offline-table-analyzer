import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLargeTableData } from '../helpers/large-data.mjs';
import { loadModules } from '../helpers/load-modules.mjs';

for (const variant of ['short', 'unicode-crlf', 'long']) {
  test(`benchmark ${variant} fixture preserves CLI columns, records and duplicate JOIN keys`, () => {
    const fixture = createLargeTableData({ rows: 4, variant });
    const { OTA } = loadModules(['import-engine', 'joiner']);
    const { ImportEngine } = OTA.require('import-engine');
    const { Joiner } = OTA.require('joiner');
    const result = ImportEngine.parse(fixture.text, { format: 'cli-table-data' });
    assert.equal(result.format, 'cli-table-data');
    assert.equal(result.tables.length, 2);
    const wide = result.tables.find(table => table.name === 'Wide');
    const lookup = result.tables.find(table => table.name === 'Lookup');
    assert.equal(wide.rows.length, 4);
    assert.deepEqual(wide.headers, fixture.headers);
    assert.ok(wide.rows.every(row => row.length === 32));
    assert.deepEqual(wide.rows[0].slice(0, 3), ['1', '1', 'B1']);
    assert.equal(wide.rows[3][1], '4');
    assert.equal(wide.rows[0][3], variant === 'short' ? '4' : variant === 'unicode-crlf' ? '值4' : 'xxxxxxxxxxx4');
    assert.equal(lookup.rows.length, 20);
    const joined = Joiner.run(result.tables, {
      view: 'FixtureJoin', left: 'Wide', right: 'Lookup', type: 'inner',
      on: 'Bucket=Bucket', select: 'left.ID,right.Label',
    });
    assert.equal(joined.rows.length, 8);
    assert.deepEqual(joined.rows[0], ['1', 'Label1_a']);
    assert.deepEqual(joined.rows[1], ['1', 'Label1_b']);
  });
}
