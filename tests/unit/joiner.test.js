/**
 * Joiner 测试套件 — JOIN 类型 / 复合键 / 依赖循环检测
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { loadModules } from '../helpers/load-modules.mjs';

const { OTA } = loadModules(['joiner']);
const { Joiner } = OTA.require('joiner');

const basic = [
  { name: 'L', headers: ['id', 'value'], rows: [['1', 0], ['2', false], ['3', 'left']] },
  { name: 'R', headers: ['id', 'name'], rows: [['1', 'one'], ['2', 'two'], ['4', 'right']] },
];

const cfg = (type = 'inner') => ({
  view: 'V', left: 'L', right: 'R', type,
  on: 'id=id', select: 'left.id,left.value,right.name',
});

describe('JOIN types', () => {
  it('inner join', () => {
    const r = Joiner.run(basic, cfg('inner'));
    assert.equal(r.rows.length, 2);
    assert.equal(r.rows[0][1], 0);
    assert.equal(r.rows[1][1], false);
  });

  it('left join', () => {
    const r = Joiner.run(basic, cfg('left'));
    assert.equal(r.rows.length, 3);
    assert.equal(r.rows[2][2], '');
  });

  it('right join', () => {
    const r = Joiner.run(basic, cfg('right'));
    assert.equal(r.rows.length, 3);
  });

  it('full join', () => {
    const r = Joiner.run(basic, cfg('full'));
    assert.equal(r.rows.length, 4);
  });

  it('semi join', () => {
    const r = Joiner.run(basic, cfg('semi'));
    assert.equal(r.rows.length, 2);
  });

  it('anti join', () => {
    const r = Joiner.run(basic, cfg('anti'));
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0][0], '3');
  });
});

describe('Composite keys & edge cases', () => {
  it('composite keys do not collide with separator chars', () => {
    const tables = [
      { name: 'L', headers: ['a', 'b'], rows: [['a|||b', 'c']] },
      { name: 'R', headers: ['x', 'y'], rows: [['a', 'b|||c']] },
    ];
    const r = Joiner.run(tables, {
      view: 'Safe', left: 'L', right: 'R', type: 'inner',
      on: 'a=x,b=y', select: 'left.a,right.x',
    });
    assert.equal(r.rows.length, 0);
  });

  it('normalizes duplicate output headers', () => {
    const r = Joiner.run(basic, {
      ...cfg(), select: 'left.id as id,right.id as id',
    });
    assert.equal(r.headers.join('|'), 'id|id_2');
  });

  it('rejects missing join fields', () => {
    const r = Joiner.run(basic, { ...cfg(), on: 'missing=id' });
    assert.equal(r, null);
  });
});

describe('Dependency cycle detection', () => {
  it('detects simple cycles', () => {
    const cycle = Joiner.hasDependencyCycle(
      { view: 'A', left: 'B', right: 'L' },
      [{ view: 'B', left: 'A', right: 'R' }],
      ['L', 'R']
    );
    assert.equal(cycle, true);
  });

  it('allows acyclic views', () => {
    const acyclic = Joiner.hasDependencyCycle(
      { view: 'A', left: 'B', right: 'L' },
      [{ view: 'B', left: 'L', right: 'R' }],
      ['L', 'R']
    );
    assert.equal(acyclic, false);
  });
});

describe('Joiner.stats', () => {
  it('returns match statistics', () => {
    const stats = Joiner.stats(basic, cfg('inner'));
    assert.ok(stats !== null);
    assert.equal(stats.matched, 2);
    assert.equal(stats.leftOnly, 1);
    assert.equal(stats.rightOnly, 1);
    assert.equal(stats.outRows, 2);
  });

  it('returns null for invalid config', () => {
    const stats = Joiner.stats(basic, { ...cfg(), on: 'missing=id' });
    assert.equal(stats, null);
  });
});
