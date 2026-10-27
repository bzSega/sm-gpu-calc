import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),P=require('../playground/presentation.js'),B=require('../playground/startup.js');
test('all pool layouts contain every copy within the game floor without overlapping cabinets',()=>{
 for(let count=1;count<=64;count++){
  const items=P.layout(count);assert.deepEqual(items.map(x=>x.id),Array.from({length:count},(_,i)=>i+1));
  for(const a of items){assert.ok(a.x>=0&&a.y>=0&&a.x+186*a.scale<=1586&&a.y+345*a.scale<=992);
   for(const b of items)if(a.id!==b.id)assert.ok(a.x+186*a.scale<=b.x||b.x+186*b.scale<=a.x||a.y+268*a.scale<=b.y||b.y+268*b.scale<=a.y);
  }
 }
});
test('saved selection migrates old files and rejects missing copies or cards',()=>{
 const g=B.create();assert.deepEqual(P.selection(undefined,g.inspect()),{selected:1,detail:null});
 assert.throws(()=>P.selection({selected:2,detail:null},g.inspect()));
 assert.throws(()=>P.selection({selected:1,detail:{kind:'card',card:1}},g.inspect()));
 g.install('H200',8);g.useModel('flash');g.open();g.addCopy();
 const ui={selected:2,detail:{kind:'card',card:8}};assert.deepEqual(P.selection(ui,g.inspect()),ui);
 assert.throws(()=>P.selection({...ui,detail:{kind:'card',card:9}},g.inspect()));
 assert.throws(()=>P.selection({...ui,detail:{kind:'arbitrary'}},g.inspect()));
});
test('every world preserves a busy 64-copy pool across morning, peak and night and JSON restore',()=>{
 for(const time of [35000,10*3600000+35000,15*3600000+35000]){
  const g=B.create();g.install('H200',8);g.useModel('flash');g.open();for(let i=1;i<64;i++)g.addCopy();g.setPopularity(.01);g.advanceTo(time-35000);g.setPopularity(1000);g.advanceTo(time);const baseline=g.inspect();assert.ok(baseline.live.queued>0);assert.ok(baseline.live.active.length>0);
  for(const world of P.worlds){g.setWorld(world);const actual=g.inspect();assert.deepEqual({...actual,world:baseline.world,live:{...actual.live,world:baseline.live.world}},baseline);assert.deepEqual(B.restore(JSON.parse(JSON.stringify(g.save()))).inspect(),actual);}
 }
});
