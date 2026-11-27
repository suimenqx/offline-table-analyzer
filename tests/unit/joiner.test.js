/**
 * Joiner 测试套件 — JOIN 类型 / 复合键 / 依赖循环检测
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
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

describe('Duplicate JOIN keys', () => {
  const tables = [
    { name: 'L', headers: ['id', 'value'], rows: [['x', 'a'], ['y', 'b'], ['x', 'c']] },
    { name: 'R', headers: ['id', 'name'], rows: [['z', 'u'], ['x', 'first'], ['z', 'v'], ['x', 'second']] },
  ];
  const run = (type, limits) => Joiner.run(tables, cfg(type), [], [], limits).rows;

  it('keeps left order and projects the first right match for semi joins', () => {
    assert.deepEqual(run('semi', { maxCells: 6 }), [['x', 'a', 'first'], ['x', 'c', 'first']]);
    assert.throws(() => run('semi', { maxCells: 5 }), /预算/);
    assert.deepEqual(run('anti', { maxCells: 3 }), [['y', 'b', '']]);
  });

  it('preserves all matching pairs and unmatched right rows in source order', () => {
    assert.deepEqual(run('full'), [
      ['x', 'a', 'first'], ['x', 'a', 'second'], ['y', 'b', ''],
      ['x', 'c', 'first'], ['x', 'c', 'second'], ['', '', 'u'], ['', '', 'v'],
    ]);
  });

  it('handles billions of potential matches in existence joins', () => {
    const count = 80000;
    const repeated = tables.map(table => ({
      ...table, rows: Array.from({ length: count }, (_, i) => ['x', String(i)]),
    }));
    for (const type of ['semi', 'anti']) {
      // Bound a synchronous regression that would otherwise visit 6.4 billion pairs.
      const result = runInNewContext('Joiner.run(tables, config)', {
        Joiner, tables: repeated, config: cfg(type),
      }, { timeout: 10000 });
      assert.equal(result.rows.length, type === 'semi' ? count : 0);
      if (type === 'semi') assert.deepEqual(result.rows.at(-1), ['x', String(count - 1), '0']);
    }
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

  it('rejects the whole compound relationship in execution, statistics and headers', () => {
    for (const on of ['id=id,value=removed','removed=name,id=id','id=id,broken']) {
      const join = {...cfg(), on};
      assert.equal(Joiner.run(basic,join),null);
      assert.equal(Joiner.stats(basic,join),null);
      assert.deepEqual(Joiner.getHeaders(basic,join),[]);
    }
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

describe('JOIN designer assistance', () => {
  it('ranks a foreign key ahead of a shared constant and explains sampled duplicates', () => {
    const tables = [
      {name:'订单', headers:['客户ID','状态','数量'], rows:[[0,'开',1],[2,'开',2],[2,'开',1]]},
      {name:'客户', headers:['ID','状态','备注'], rows:[[0,'开','零'],[2,'开','二']]},
    ];
    const keys = Joiner.suggestKeys(tables, '订单', '客户');
    assert.deepEqual([keys[0].l,keys[0].r], ['客户ID','ID']);
    assert.equal(keys[0].common, 2);
    assert.equal(keys[0].leftDuplicates, 1);
    assert.equal(keys[0].rightDuplicates, 0);
    assert.ok(!keys.some(k => k.l === '状态'));
    tables[1].rows = [['0','开','零'],['2','开','二']];
    assert.ok(!Joiner.suggestKeys(tables, '订单', '客户').some(k => k.l === '客户ID' && k.r === 'ID'));
  });

  for(const type of ['inner','left','right','full','semi','anti']) {
    it(`projects representative ${type} examples with the saved result's headers and values`, () => {
      const tables = basic.map(t => ({...t,rows:[...t.rows]}));
      tables[1].rows.unshift(...Array.from({length:10}, (_,i) => ['1', String(i)]));
      const config = {...cfg(type), select:'right.name as value,left.value,right.id'};
      const stats = Joiner.stats(tables, config, [], [], {samples:true});
      const sample = Joiner.projectSample(stats.sample, config.select);
      const saved = Joiner.run(tables,config);
      assert.deepEqual(sample.headers, saved.headers);
      assert.equal(sample.rows.length, Math.min(5, saved.rows.length));
      for(const row of sample.rows) assert.ok(saved.rows.some(savedRow => JSON.stringify(savedRow) === JSON.stringify(row.cells)));
      const kinds = new Set(sample.rows.map(row => row.kind));
      assert.equal(kinds.has('leftOnly'), ['left','full','anti'].includes(type));
      assert.equal(kinds.has('rightOnly'), ['right','full'].includes(type));
      assert.equal(kinds.has('matched'), type !== 'anti');
    });
  }

  it('takes only five pairs from a many-to-many result that exceeds the materialization budget', () => {
    const tables = ['L','R'].map(name => ({name,headers:['id'],rows:Array.from({length:2000}, () => ['x'])}));
    const config = {...cfg('inner'),select:'left.id'};
    const result = Joiner.stats(tables,config,[],[],{samples:true});
    assert.equal(result.outRows, 4000000);
    assert.equal(result.sample.pairs.length, 5);
  });
});
