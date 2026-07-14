const { loadBuiltModules } = require('./load-built-modules');

const sandbox = {
  console,
  window:{},
  document:{ createElement(){ return { innerHTML:'', textContent:'', innerText:'' }; } }
};
const { OTA } = loadBuiltModules(sandbox);
const { Joiner } = OTA.require('joiner');
const assert = (cond, msg) => { if(!cond) throw new Error(msg); };

const basic = [
  { name:'L', headers:['id','value'], rows:[['1',0],['2',false],['3','left']] },
  { name:'R', headers:['id','name'], rows:[['1','one'],['2','two'],['4','right']] }
];
const cfg = (type='inner') => ({ view:'V', left:'L', right:'R', type, on:'id=id', select:'left.id,left.value,right.name' });

const inner = Joiner.run(basic, cfg('inner'));
assert(inner.rows.length === 2, 'inner row count');
assert(inner.rows[0][1] === 0 && inner.rows[1][1] === false, 'zero/false must be preserved');
assert(Joiner.run(basic, cfg('left')).rows.length === 3, 'left join row count');
assert(Joiner.run(basic, cfg('right')).rows.length === 3, 'right join row count');
assert(Joiner.run(basic, cfg('full')).rows.length === 4, 'full join row count');
assert(Joiner.run(basic, cfg('semi')).rows.length === 2, 'semi join row count');
assert(Joiner.run(basic, cfg('anti')).rows.length === 1, 'anti join row count');

const collisionTables = [
  { name:'L', headers:['a','b'], rows:[['a|||b','c']] },
  { name:'R', headers:['x','y'], rows:[['a','b|||c']] }
];
const collision = Joiner.run(collisionTables, { view:'Safe', left:'L', right:'R', type:'inner', on:'a=x,b=y', select:'left.a,right.x' });
assert(collision.rows.length === 0, 'composite keys must not collide');

const duplicate = Joiner.run(basic, { ...cfg(), select:'left.id as id,right.id as id' });
assert(duplicate.headers.join('|') === 'id|id_2', 'duplicate output headers should normalize');
assert(Joiner.run(basic, { ...cfg(), on:'missing=id' }) === null, 'missing join field must reject');
assert(Joiner.hasDependencyCycle({ view:'A', left:'B', right:'L' }, [{ view:'B', left:'A', right:'R' }], ['L','R']), 'dependency cycle should be detected');

console.log('Joiner regression tests passed: 11');
