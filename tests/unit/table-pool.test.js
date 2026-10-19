/**
 * QueryService.computePool — 表池派生纯函数测试（多卡片工作区基线）
 * 规则：与首卡同结构（列名+顺序）的同名表拼接（不去重）；异结构同名表并列限定名；单来源直通。
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { loadModules } from '../helpers/load-modules.mjs';

const { OTA } = loadModules([], {});
const { QueryService } = OTA.require('query-service');

function table(name, headers, rows) {
    return { name, headers, rows, isView: false };
}

describe('QueryService.computePool — 表池派生', () => {
  it('同名同结构 → 拼接（不去重，重复行保留）', () => {
    const pool = QueryService.computePool([
      { cardId: 'c1', cardName: '基础数据', table: table('data', ['id', 'name'], [['1', '甲'], ['2', '乙'], ['3', '丙']]) },
      { cardId: 'c2', cardName: '差异部分', table: table('data', ['id', 'name'], [['3', '丙'], ['4', '丁']]) },
    ]);
    assert.equal(pool.length, 1);
    assert.equal(pool[0].displayName, 'data');
    assert.equal(pool[0].kind, 'concat');
    assert.deepEqual(pool[0].sourceCardIds, ['c1', 'c2']);
    assert.equal(pool[0].rows.length, 5);
    assert.equal(pool[0].rows.filter(r => r[0] === '3').length, 2, '重复行保留，不去重');
  });

  it('同名不同结构 → 并列限定名，不拼接', () => {
    const pool = QueryService.computePool([
      { cardId: 'c1', cardName: '基础数据', table: table('data', ['id', 'name'], [['1', '甲']]) },
      { cardId: 'c3', cardName: '维度表', table: table('data', ['id', 'desc'], [['1', '说明']]) },
    ]);
    assert.equal(pool.length, 2);
    const base = pool.find(p => p.displayName === 'data');
    const side = pool.find(p => p.displayName === 'data (维度表)');
    assert.equal(base.kind, 'single');
    assert.equal(base.sourceCardId, 'c1');
    assert.equal(side.kind, 'side');
    assert.equal(side.sourceCardId, 'c3');
  });

  it('三卡混合：与首卡同结构合并拼接，异结构并列', () => {
    const pool = QueryService.computePool([
      { cardId: 'c1', cardName: '基础数据', table: table('data', ['id', 'name'], [['1', '甲']]) },
      { cardId: 'c2', cardName: '差异部分', table: table('data', ['id', 'name'], [['2', '乙']]) },
      { cardId: 'c3', cardName: '维度表', table: table('data', ['id', 'desc'], [['1', '说明']]) },
      { cardId: 'c3', cardName: '维度表', table: table('lookup', ['k'], [['x']]) },
    ]);
    assert.equal(pool.length, 3);
    const concat = pool.find(p => p.displayName === 'data');
    assert.equal(concat.kind, 'concat');
    assert.deepEqual(concat.sourceCardIds, ['c1', 'c2']);
    assert.equal(pool.find(p => p.displayName === 'data (维度表)').kind, 'side');
    assert.equal(pool.find(p => p.displayName === 'lookup').kind, 'single');
  });

  it('列顺序不同视为结构不同', () => {
    const pool = QueryService.computePool([
      { cardId: 'c1', cardName: 'A', table: table('data', ['a', 'b'], [['1', '2']]) },
      { cardId: 'c2', cardName: 'B', table: table('data', ['b', 'a'], [['3', '4']]) },
    ]);
    assert.equal(pool.length, 2);
    assert.equal(pool.every(p => p.kind !== 'concat'), true, '换序列不拼接');
  });

  it('隐藏首来源只移除其记录，不使异结构来源失去限定名', () => {
    const pool = QueryService.computePool([
      {cardId:'a',cardName:'A',visible:false,table:table('data',['id','name'],[['1','A']])},
      {cardId:'b',cardName:'B',visible:true,table:table('data',['id','label'],[['2','B']])},
    ]);
    assert.deepEqual(pool.map(entry=>entry.displayName),['data (B)']);
    assert.deepEqual(pool[0].rows,[['2','B']]);
    assert.deepEqual(pool[0].sourceCardIds,['b']);
  });

  it('隐藏同结构首来源后，剩余来源保持基础表名及单来源语义', () => {
    const remaining=table('data',['id'],[['2']]);
    const pool=QueryService.computePool([
      {cardId:'a',visible:false,table:table('data',['id'],[['1']])},
      {cardId:'b',table:remaining},
    ]);
    assert.equal(pool.length,1);
    assert.equal(pool[0].displayName,'data');
    assert.equal(pool[0].kind,'single');
    assert.equal(pool[0].rows,remaining.rows);
  });

  it('单来源直通：行数组为原表同一引用（可修正语义）', () => {
    const t = table('data', ['id'], [['1']]);
    const pool = QueryService.computePool([{ cardId: 'c1', cardName: 'A', table: t }]);
    assert.equal(pool[0].kind, 'single');
    assert.equal(pool[0].rows, t.rows, 'rows 引用不变，行级修正索引对齐');
  });

  it('空输入返回空池', () => {
    assert.deepEqual(QueryService.computePool([]), []);
    assert.deepEqual(QueryService.computePool(null), []);
  });
});
