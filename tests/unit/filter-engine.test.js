/**
 * FilterEngine 测试套件 — tokenize / matchToken / matchRule / processTable
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { loadModules } from '../helpers/load-modules.mjs';

const { OTA } = loadModules(['filter-engine']);
const { FilterEngine } = OTA.require('filter-engine');

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------
describe('FilterEngine.tokenize', () => {
  it('splits on whitespace', () => {
    assert.deepEqual(FilterEngine.tokenize('a b c'), ['a', 'b', 'c']);
  });

  it('preserves quoted substrings', () => {
    assert.deepEqual(FilterEngine.tokenize('key="hello world" x'), ['key="hello world"', 'x']);
  });

  it('handles single quotes', () => {
    assert.deepEqual(FilterEngine.tokenize("key='hello world'"), ["key='hello world'"]);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(FilterEngine.tokenize(''), []);
    assert.deepEqual(FilterEngine.tokenize(null), []);
    assert.deepEqual(FilterEngine.tokenize(undefined), []);
  });

  it('handles multiple spaces', () => {
    assert.deepEqual(FilterEngine.tokenize('a    b'), ['a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// buildHeaderMap
// ---------------------------------------------------------------------------
describe('FilterEngine.buildHeaderMap', () => {
  it('builds case-insensitive header map', () => {
    const map = FilterEngine.buildHeaderMap(['ID', 'Name', 'Value']);
    assert.equal(map.get('id'), 0);
    assert.equal(map.get('name'), 1);
    assert.equal(map.get('value'), 2);
  });
});

// ---------------------------------------------------------------------------
// matchToken
// ---------------------------------------------------------------------------
describe('FilterEngine.matchToken', () => {
  const headers = ['level', 'message', 'count'];
  const hMap = FilterEngine.buildHeaderMap(headers);

  it('matches key=value (equality)', () => {
    assert.equal(FilterEngine.matchToken('level=ERROR', ['ERROR', 'timeout', '5'], hMap), true);
    assert.equal(FilterEngine.matchToken('level=WARN', ['ERROR', 'timeout', '5'], hMap), false);
  });

  it('matches key:value (contains)', () => {
    assert.equal(FilterEngine.matchToken('message:time', ['ERROR', 'timeout', '5'], hMap), true);
    assert.equal(FilterEngine.matchToken('message:xyz', ['ERROR', 'timeout', '5'], hMap), false);
  });

  it('matches key!=value (not equal)', () => {
    assert.equal(FilterEngine.matchToken('level!=ERROR', ['WARN', 'memory', '3'], hMap), true);
    assert.equal(FilterEngine.matchToken('level!=ERROR', ['ERROR', 'timeout', '5'], hMap), false);
  });

  it('matches numeric comparisons', () => {
    assert.equal(FilterEngine.matchToken('count>3', ['WARN', 'x', '5'], hMap), true);
    assert.equal(FilterEngine.matchToken('count>3', ['WARN', 'x', '2'], hMap), false);
    assert.equal(FilterEngine.matchToken('count>=5', ['WARN', 'x', '5'], hMap), true);
    assert.equal(FilterEngine.matchToken('count<10', ['WARN', 'x', '5'], hMap), true);
    assert.equal(FilterEngine.matchToken('count<=3', ['WARN', 'x', '5'], hMap), false);
  });

  it('matches /regex/ patterns', () => {
    assert.equal(FilterEngine.matchToken('/ERROR/', ['ERROR', 'timeout', '5'], hMap), true);
    assert.equal(FilterEngine.matchToken('/WARN/', ['ERROR', 'timeout', '5'], hMap), false);
  });

  it('matches plain text (full-row contains)', () => {
    assert.equal(FilterEngine.matchToken('timeout', ['ERROR', 'timeout', '5'], hMap), true);
    assert.equal(FilterEngine.matchToken('missing', ['ERROR', 'timeout', '5'], hMap), false);
  });

  it('matches case-insensitively', () => {
    assert.equal(FilterEngine.matchToken('level=error', ['ERROR', 'timeout', '5'], hMap), true);
    assert.equal(FilterEngine.matchToken('TIMEOUT', ['ERROR', 'timeout', '5'], hMap), true);
  });

  // NOT 前缀
  describe('NOT prefix (!)', () => {
    it('negates plain text', () => {
      assert.equal(FilterEngine.matchToken('!ok', ['INFO', 'ok', '1'], hMap), false);
      assert.equal(FilterEngine.matchToken('!ok', ['INFO', 'timeout', '1'], hMap), true);
    });

    it('negates regex', () => {
      assert.equal(FilterEngine.matchToken('!/ERROR/', ['ERROR', 'x', '1'], hMap), false);
      assert.equal(FilterEngine.matchToken('!/ERROR/', ['INFO', 'x', '1'], hMap), true);
    });

    it('negates operator expressions', () => {
      assert.equal(FilterEngine.matchToken('!level=INFO', ['INFO', 'x', '1'], hMap), false);
      assert.equal(FilterEngine.matchToken('!level=INFO', ['WARN', 'x', '1'], hMap), true);
    });
  });

  describe('regex edge cases', () => {
    it('rejects patterns longer than 200 chars', () => {
      const long = '/' + 'x'.repeat(201) + '/';
      assert.equal(FilterEngine.matchToken(long, ['a', 'b', 'c'], hMap), false);
    });

    it('handles invalid regex gracefully', () => {
      assert.equal(FilterEngine.matchToken('/[invalid/', ['a', 'b', 'c'], hMap), false);
    });
  });

  it('returns false for missing column', () => {
    assert.equal(FilterEngine.matchToken('nonexistent=value', ['a', 'b', 'c'], hMap), false);
  });
});

// ---------------------------------------------------------------------------
// matchRule
// ---------------------------------------------------------------------------
describe('FilterEngine.matchRule', () => {
  const headers = ['level', 'message'];
  const hMap = FilterEngine.buildHeaderMap(headers);

  it('returns true for empty rule', () => {
    assert.equal(FilterEngine.matchRule('', ['x', 'y'], hMap), true);
    assert.equal(FilterEngine.matchRule(null, ['x', 'y'], hMap), true);
  });

  it('combines tokens with AND semantics', () => {
    assert.equal(FilterEngine.matchRule('level=ERROR message:timeout', ['ERROR', 'timeout'], hMap), true);
    assert.equal(FilterEngine.matchRule('level=ERROR message:memory', ['ERROR', 'timeout'], hMap), false);
  });

  it('handles OR with pipe', () => {
    assert.equal(FilterEngine.matchRule('timeout|memory', ['ERROR', 'timeout'], hMap), true);
    assert.equal(FilterEngine.matchRule('timeout|memory', ['ERROR', 'missing'], hMap), false);
  });

  it('handles NOT with OR pipe', () => {
    assert.equal(FilterEngine.matchRule('!ok|memory', ['INFO', 'ok'], hMap), false);
    assert.equal(FilterEngine.matchRule('!ok|memory', ['ERROR', 'memory'], hMap), true);
  });
});

// ---------------------------------------------------------------------------
// resolveFocusColumns
// ---------------------------------------------------------------------------
describe('FilterEngine.resolveFocusColumns', () => {
  const headers = ['id', 'name', 'age', 'city'];

  it('returns all columns when no focus', () => {
    const { headers: h, indexes } = FilterEngine.resolveFocusColumns(headers, []);
    assert.deepEqual(h, headers);
    assert.deepEqual(indexes, [0, 1, 2, 3]);
  });

  it('returns only focused columns', () => {
    const { headers: h, indexes } = FilterEngine.resolveFocusColumns(headers, ['name', 'city']);
    assert.deepEqual(h, ['name', 'city']);
    assert.deepEqual(indexes, [1, 3]);
  });

  it('falls back to all columns when focus columns are invalid', () => {
    const { headers: h, indexes } = FilterEngine.resolveFocusColumns(headers, ['missing']);
    assert.deepEqual(h, headers);
    assert.deepEqual(indexes, [0, 1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// processTable
// ---------------------------------------------------------------------------
describe('FilterEngine.processTable', () => {
  const table = {
    name: 'Logs',
    headers: ['level', 'message'],
    rows: [['WARN', 'memory'], ['ERROR', 'timeout'], ['INFO', 'ok']],
  };
  const ui = { columnFilters: {} };

  it('returns all rows with no filters', () => {
    const result = FilterEngine.processTable(table, {}, ui, '', true, false);
    assert.equal(result.rows.length, 3);
  });

  it('filters by global filter', () => {
    const result = FilterEngine.processTable(table, {}, ui, 'ERROR', true, false);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].d[0], 'ERROR');
  });

  it('supports regex alternation in global filter', () => {
    const result = FilterEngine.processTable(table, {}, ui, '/ERROR|WARN/', true, false);
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].d[0], 'WARN');
    assert.equal(result.rows[1].d[0], 'ERROR');
  });

  it('filters by table-level rules', () => {
    const result = FilterEngine.processTable(table, { filter: 'level=INFO' }, ui, '', true, false);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].d[0], 'INFO');
  });

  it('applies column-level filters', () => {
    const ui2 = { columnFilters: { Logs: { level: 'WARN' } } };
    const result = FilterEngine.processTable(table, {}, ui2, '', true, false);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].d[0], 'WARN');
  });

  it('marks highlighted rows', () => {
    const result = FilterEngine.processTable(table, { hl: 'ERROR' }, ui, '', true, false);
    assert.equal(result.rows.some(r => r._hl), true);
    assert.equal(result.rows.find(r => r.d[0] === 'ERROR')._hl, true);
    assert.equal(result.rows.find(r => r.d[0] === 'WARN')._hl, false);
  });

  it('shows only highlighted rows when onlyHighlighted is true', () => {
    const result = FilterEngine.processTable(table, { hl: 'ERROR' }, ui, '', true, true);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].d[0], 'ERROR');
  });

  it('projects focused columns', () => {
    const result = FilterEngine.processTable(table, { focus: ['message'] }, ui, '', true, false);
    assert.deepEqual(result.headers, ['message']);
    assert.deepEqual(result.rows[0].d, ['memory']);
  });

  it('sets _readOnly for view tables', () => {
    const viewTable = { ...table, isView: true };
    const result = FilterEngine.processTable(viewTable, {}, ui, '', true, false);
    assert.equal(result.rows.every(r => r._readOnly), true);
  });
});
