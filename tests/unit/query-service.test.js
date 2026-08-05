import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { loadModules } from '../helpers/load-modules.mjs';

const { OTA } = loadModules([], {});
const { QueryService } = OTA.require('query-service');

beforeEach(() => QueryService.clearCache());

describe('QueryService — shared result contract', () => {
  it('uses one processed result for preview paging and export-shaped rows', () => {
    const rawTables = [{ name:'Orders', headers:['id','status'], rows:[['1','ok'],['2','hold'],['3','ok']] }];
    const ui = { displayTables:null, enabledViews:[], rules:{}, columnFilters:{}, globalFilter:'status=ok' };
    const result = QueryService.getPreview({ rawTables, globalViews:[], ui, docId:'a', sourceRevision:1, stateRevision:4 });
    assert.equal(result.tables.length, 1);
    assert.deepEqual(result.tables[0].res.rows.map(row => row.d), [['1','ok'],['3','ok']]);
    assert.deepEqual(QueryService.paginate(result.tables, 'Orders', 1, 1).rows.map(row => row.d), [['1','ok']]);
  });

  it('reuses a result for the same revisions and invalidates on query changes', () => {
    const rawTables = [{ name:'T', headers:['value'], rows:[['a'],['b']] }];
    const base = { displayTables:null, enabledViews:[], rules:{}, columnFilters:{}, globalFilter:'' };
    const first = QueryService.getPreview({ rawTables, globalViews:[], ui:base, docId:'a', sourceRevision:2, stateRevision:7 });
    const same = QueryService.getPreview({ rawTables, globalViews:[], ui:base, docId:'a', sourceRevision:2, stateRevision:7 });
    assert.equal(first, same);
    const changed = QueryService.getPreview({ rawTables, globalViews:[], ui:Object.assign({}, base, { globalFilter:'b' }), docId:'a', sourceRevision:2, stateRevision:8 });
    assert.notEqual(changed, first);
    assert.equal(changed.tables[0].res.rows.length, 1);
  });

  it('resolves enabled JOIN views before applying the same filters', () => {
    const rawTables = [
      { name:'Users', headers:['id','name'], rows:[['1','A']] },
      { name:'Scores', headers:['id','score'], rows:[['1','9']] },
    ];
    const views = [{ view:'UserScores', left:'Users', right:'Scores', type:'inner', on:'id=id', select:'left.name,right.score' }];
    const ui = { displayTables:null, enabledViews:['UserScores'], rules:{}, columnFilters:{}, globalFilter:'' };
    const result = QueryService.getPreview({ rawTables, globalViews:views, ui, docId:'a', sourceRevision:1, stateRevision:1 });
    const joined = result.tables.find(item => item.table.name === 'JOIN:UserScores');
    assert.ok(joined);
    assert.deepEqual(joined.res.headers, ['name','score']);
    assert.deepEqual(joined.res.rows[0].d, ['A','9']);
  });
});
