import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),B=require('../playground/startup.js'),K=require('../playground/clock.js');
const ready=()=>{const g=B.create();g.install('H200',8);g.useModel('flash');return g;};
test('new game starts with a genuinely empty rack and closed service',()=>{
 const g=B.create();assert.equal(g.inspect().stage,'empty');assert.equal(g.inspect().hardware,null);assert.equal(g.inspect().live,null);
 assert.throws(()=>g.open());assert.throws(()=>g.preview('flash'));
});
test('installation, model selection and service opening are distinct actions',()=>{
 const g=B.create();g.install('H200',8);assert.equal(g.inspect().stage,'hardware');assert.equal(g.inspect().model,null);
 g.useModel('flash');assert.equal(g.inspect().stage,'ready');assert.equal(g.inspect().live,null);
 assert.equal(g.inspect().memory.kvCapacityGB,695.2);g.open();assert.equal(g.inspect().stage,'open');assert.equal(g.inspect().live.calendar.clock,'08:00');
 assert.throws(()=>g.open());assert.throws(()=>g.install('B300',8));
});
test('invalid placement is repairable without deleting installed hardware',()=>{
 const g=B.create();g.install('H200',1);assert.equal(g.preview('flash').fits,false);assert.throws(()=>g.useModel('flash'));
 assert.equal(g.inspect().hardware.cards,1);assert.equal(g.inspect().model,null);
 g.install('H200',8);g.useModel('flash');assert.equal(g.inspect().stage,'ready');
});
test('all construction states survive JSON restore',()=>{
 const g=B.create();
 for(const action of [()=>{},()=>g.install('B300',8),()=>g.useModel('flash'),()=>g.open(),()=>g.advanceTo(12345)]){
  action();assert.deepEqual(B.restore(JSON.parse(JSON.stringify(g.save()))).inspect(),g.inspect());
 }
});
test('game copy expansion and presentation preserve current work',()=>{
 const g=ready();g.open();g.advanceTo(35000);const a=g.inspect().live.active[0];assert.ok(a);
 g.addCopy();g.setWorld('orbital');const now=g.inspect();assert.equal(now.live.replicas.length,2);assert.equal(now.world,'orbital');
 assert.equal(now.live.active.find(r=>r.request_id===a.request_id).startMs,a.startMs);
 assert.deepEqual(B.restore(JSON.parse(JSON.stringify(g.save()))).inspect(),now);
});
test('saves cannot substitute different construction or profile metadata',()=>{
 const g=ready();g.open();const s=g.save();
 assert.throws(()=>B.restore({...s,hardware:{gpu:'B300',cards:8}}));assert.throws(()=>B.restore({...s,schema:'future'}));
 assert.throws(()=>B.restore({...s,model:null}));
});
test('one clock scale applies to service work and day progression',()=>{
 const g=ready();g.open();const clock=K.create({advance:t=>g.advanceTo(t)});
 clock.tick(100);clock.tick(200);assert.equal(g.inspect().live.timeMs,100*K.SCALE);
 clock.tick(360100);assert.equal(g.inspect().live.calendar.day,2);assert.equal(g.inspect().live.calendar.clock,'08:00');
});
test('hidden tab time is never processed as offline catch-up',()=>{
 const seen=[],c=K.create({timeMs:123,advance:t=>seen.push(t)});c.tick(100);c.tick(200);const before=c.time();
 c.visibility(false);c.tick(999999);assert.equal(c.time(),before);c.visibility(true);c.tick(1000000);assert.equal(c.time(),before);
 c.tick(1000100);assert.equal(c.time(),before+100*K.SCALE);assert.equal(seen.length,2);
});
test('failed advances do not move clock or discard the time delta',()=>{
 let fail=true,seen;const c=K.create({advance:t=>{if(fail)throw Error('limit');seen=t;}});c.tick(0);assert.throws(()=>c.tick(100));assert.equal(c.time(),0);
 fail=false;c.tick(100);assert.equal(seen,24000);assert.equal(c.time(),24000);
});
test('replacing hardware unloads a model only when it no longer fits',()=>{
 const g=ready();g.install('B300',8);assert.equal(g.inspect().model,'flash');
 g.install('H200',1);assert.equal(g.inspect().model,null);assert.equal(g.inspect().stage,'hardware');
});
test('JSON object key order is irrelevant when validating a saved construction',()=>{
 const g=ready();g.open();const d=g.save();d.live.settings=Object.fromEntries(Object.entries(d.live.settings).reverse());
 d.live.profile=Object.fromEntries(Object.entries(d.live.profile).reverse());assert.deepEqual(B.restore(d).inspect(),g.inspect());
});
