import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { loadModules } from '../helpers/load-modules.mjs';

const { OTA } = loadModules([], {});
const { QueryService } = OTA.require('query-service');

beforeEach(() => QueryService.clearCache());

describe('QueryService — shared result contract', () => {
  it('materializes only page rows on a new filter and keeps previously returned values stable', () => {
    let copies=0;
    class CountedRow extends Array {
      static get [Symbol.species]() { return Array; }
      slice(...args) { copies++; return super.slice(...args); }
    }
    const rawTables=[{name:'T',headers:['id'],rows:Array.from({length:1000},(_,i)=>CountedRow.of(String(i)))}];
    const page=filter=>QueryService.getPagePreview({rawTables,ui:{pageSize:50,globalFilter:filter}}).tables[0].res;
    const first=page('id>=10');
    assert.equal(page('id>=20').totalRows,980);
    assert.equal(first.rows[0].d[0],'10');
    assert.ok(copies<=100,`two 50-row pages copied ${copies} rows`);
  });
  it('checks exact JOIN rows and the combined preview cell budget before materialization', t => {
    const {Joiner} = OTA.require('joiner');
    t.mock.method(Joiner, 'run', () => assert.fail('counting a raw-to-raw JOIN must not expand its result'));
    const rawTables = [{name:'T', headers:['id'], rows:Array(1000).fill(['x'])}];
    const config = {view:'V', left:'T', right:'T', type:'inner', on:'id=id', select:Array(8).fill('left.id').join(',')};
    const globalViews = [config,{...config,view:'Other',select:'left.id'}];
    const check = (enabledViews,displayTables) => QueryService.checkViewBudget({rawTables,globalViews,ui:{enabledViews,displayTables}});
    assert.doesNotThrow(() => check(['V'], [])); // Both limits are inclusive.
    assert.throws(() => check(['V'], null), /8,001,000.*8,000,000/);
    assert.throws(() => check(['Other','V'], []), /9,000,000.*8,000,000/);
    globalViews[0].select += ',left.id';
    assert.throws(() => check(['V'], []), /9,000,000.*8,000,000/);
    rawTables[0].rows.push(['x']);
    assert.throws(() => check(['Other'], []), /1,002,001.*1,000,000/);
  });
  it('reports the missing source of a newly enabled view while tolerating existing unavailable views', () => {
    const input = {rawTables:[],globalViews:[{view:'Child',left:'Missing',right:'Other',on:'k=k',select:'left.k'}],ui:{enabledViews:['Child']}};
    assert.throws(() => QueryService.checkViewBudget(input,{requireAvailable:['Child']}), /Child.*Missing/);
    assert.doesNotThrow(() => QueryService.checkViewBudget(input));
  });
  it('never weakens a saved compound JOIN after a source column changes, including dependent views', () => {
    const left = {name:'Stock', headers:['id','region'], rows:[['42','east'],['42','west']]};
    const right = {name:'Prices', headers:['id','region','price'], rows:[['42','east','10'],['42','west','20']]};
    const join = {view:'Regional', left:'Stock', right:'Prices', on:'id=id,region=region', select:'left.id,right.price'};
    const child = {view:'Child', left:'Regional', right:'Stock', on:'id=id', select:'left.price'};
    const input = {rawTables:[left,right], globalViews:[join,child], ui:{enabledViews:['Regional']}};
    const names = data => QueryService.getPagePreview(data).tables.map(item => item.table.name);
    const stale = {...input, rawTables:[left,{...right,headers:['id','area','price']}]};
    for (const name of ['Regional','Child']) {
      stale.ui = {enabledViews:[name]};
      assert.deepEqual(names(stale), ['Stock','Prices']);
      for (const mode of ['preview','full']) assert.throws(() => QueryService.getExportTables(stale,mode), /Regional.*Prices.*region/);
      assert.deepEqual(QueryService.getExportTables(stale,'raw'),stale.rawTables);
    }
    assert.deepEqual(QueryService.getExportTables(input,'full').at(-1).rows,[['42','10'],['42','20']]);
  });

  it('matches complete regexes in preview and export, including spaces, operators and negated alternation', () => {
    const rawTables = [{name:'Log', headers:['message'], rows:[['id=42'],['connection timeout'],['fine']]}];
    for (const [globalFilter, expected] of [
      ['/id=42/', ['id=42']], ['/connection timeout/', ['connection timeout']],
      ['!/id=42|connection timeout/', ['fine']], ['message="fine|other"|/id=42/', ['id=42']],
    ]) {
      const input = {rawTables, ui:{globalFilter}};
      assert.deepEqual(QueryService.getPagePreview(input).tables[0].res.rows.map(row => row.d[0]), expected);
      assert.deepEqual(QueryService.getExportTables(input,'preview')[0].rows.flat(), expected);
    }
  });

  it('reuses matching rows across pages and exports, with stable source positions and shared column mapping', () => {
    const table = {name:'T', headers:['id','note'], rows:Array.from({length:40}, (_,i) => [String(i), i%2?'hit':'skip'])};
    const input = {rawTables:[table], ui:{globalFilter:'note=hit',pageSize:3,rules:{T:{focus:['note','id'],hl:'id>=9'}}}};
    const first = QueryService.getPagePreview(input).tables[0].res;
    assert.equal(first.totalRows,20);
    assert.equal(first.rows[0]._sourceCols,first.rows[1]._sourceCols);
    assert.ok(Object.isFrozen(first.rows[0]._sourceCols));
    const second = QueryService.getPagePreview({...input, ui:{...input.ui,tablePages:{T:2}}}).tables[0].res;
    assert.equal(second.rows[0]._sourceCols, first.rows[0]._sourceCols);
    assert.deepEqual(second.rows.map(row => [row._resultIndex,row._sourceRow,row._hl,row.d[1]]),
      [[3,7,false,'7'],[4,9,true,'9'],[5,11,true,'11']]);
    const exported = QueryService.getExportTables(input,'preview')[0];
    assert.equal(exported.rows.length,20);
    assert.deepEqual(exported.rows.at(-1),['hit','39']);
  });
  it('reuses the full query across pagination and invalidates corrections', () => {
    const rawTables=[{name:'T',headers:['id'],rows:[['001']]}];
    const first=QueryService.getPreview({rawTables,ui:{tablePages:{T:1}},stateRevision:1,queryRevision:1});
    const paged=QueryService.getPreview({rawTables,ui:{tablePages:{T:2},pageSize:50},stateRevision:2,queryRevision:2});
    assert.equal(first,paged);
    rawTables[0].rows[0][0]='002';
    const corrected=QueryService.getPreview({rawTables,ui:{cellEdits:{$T:{0:{0:'002'}}}},stateRevision:3});
    assert.notEqual(first,corrected);
    assert.equal(first.tables[0].res.rows[0].d[0],'001');
    assert.equal(corrected.tables[0].res.rows[0].d[0],'002');
  });
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

  it('invalidates pooled previews on card names, source revisions and per-card corrections', async () => {
    const base={rawTables:[],ui:{},visible:[{id:'a',name:'Old'}],cards:[{id:'a',sourceRevision:1,config:{format:'csv',headerMode:'auto'}}],cardUis:{a:{cellEdits:{}}}};
    let serial=0;
    const executor={async query(){return {tables:[],serial:++serial};}};
    assert.equal((await QueryService.getPreviewAsync(base,executor)).serial,1);
    assert.equal((await QueryService.getPreviewAsync({...base,visible:[{id:'a',name:'New'}]},executor)).serial,2);
    assert.equal((await QueryService.getPreviewAsync({...base,cards:[{...base.cards[0],sourceRevision:2}]},executor)).serial,3);
    assert.equal((await QueryService.getPreviewAsync({...base,cardUis:{a:{cellEdits:{$T:{0:{0:'changed'}}}}}},executor)).serial,4);
  });

  it('fetches a new page while the Worker can reuse the complete query',async()=>{
    const input={rawTables:[],ui:{pageSize:50,tablePages:{T:1}}};
    const pages=[];const executor={async query(snapshot){pages.push(snapshot.ui.tablePages.T);return {tables:[]};}};
    await QueryService.getPreviewAsync(input,executor);
    await QueryService.getPreviewAsync(input,executor);
    await QueryService.getPreviewAsync({...input,ui:{...input.ui,tablePages:{T:2}}},executor);
    assert.deepEqual(pages,[1,2]);assert.ok(QueryService.getCacheSize()<=2);
  });
});
