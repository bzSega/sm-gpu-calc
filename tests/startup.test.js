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
test('maintenance keeps old GPU placement until active work drains, including after restore',()=>{
 const g=ready();g.open();g.advanceTo(35000);assert.ok(g.inspect().copies[0].worker.active>0);
 g.maintain(1,'B300',4);const before=g.inspect().copies[0];assert.equal(before.hardware.gpu,'H200');assert.equal(before.hardware.cards,8);
 assert.equal(before.pendingSettings.gpu,'B300');assert.equal(before.memory.total,1128);
 const restored=B.restore(JSON.parse(JSON.stringify(g.save())));assert.deepEqual(restored.inspect(),g.inspect());
 for(const game of [g,restored])game.advanceTo(50000);
 assert.deepEqual(restored.inspect(),g.inspect());const after=g.inspect().copies[0];assert.equal(after.hardware.gpu,'B300');assert.equal(after.hardware.cards,4);assert.equal(after.memory.total,1152);assert.equal(after.pendingSettings,null);
});
test('copying selected upgraded hardware and switching worlds preserves serving work',()=>{
 const g=ready();g.open();g.advanceTo(35000);g.maintain(1,'B300',4);g.advanceTo(50000);g.addCopy(1);g.advanceTo(61000);
 const before=g.inspect();for(const w of ['workshop','orbital','server-room'])g.setWorld(w);
 assert.deepEqual(g.inspect(),before);assert.equal(g.inspect().copies[1].hardware.gpu,'B300');
 assert.deepEqual(B.restore(JSON.parse(JSON.stringify(g.save()))).inspect(),g.inspect());
});
test('bad live placement cannot mutate working hardware or waiting work',()=>{
 const g=ready();g.open();g.advanceTo(35000);const before=g.save();assert.throws(()=>g.maintain(1,'H200',1));assert.deepEqual(g.save(),before);
});
test('live game task changes preserve old requests and restore the mixed profile history',()=>{
 const g=ready();g.open();g.setPopularity(60);g.advanceTo(1500);const first=g.inspect().live.active[0];g.setTaskProfile('document');g.advanceTo(2500);
 assert.equal(g.inspect().taskProfile,'document');assert.equal(g.inspect().live.active.find(r=>r.request_id===first.request_id).input_tokens,10000);
 assert.equal(g.inspect().copies[0].memory.context,128000);assert.deepEqual(B.restore(JSON.parse(JSON.stringify(g.save()))).inspect(),g.inspect());
 g.setConcurrency(1,4);assert.ok(g.inspect().copies[0].pendingSettings||g.inspect().copies[0].worker.config.concurrency===4);
 assert.deepEqual(B.restore(JSON.parse(JSON.stringify(g.save()))).inspect(),g.inspect());
});
test('document profile exposes a real memory bottleneck instead of a fake lesson flag',()=>{
 const g=B.create();g.install('H200',3);g.useModel('flash');g.open();g.setTaskProfile('document');g.setPopularity(60);g.advanceTo(3000);
 const s=g.inspect();assert.equal(s.live.waitingReason,'memory');assert.equal(s.live.replicas[0].active,1);assert.equal(s.live.replicas[0].config.concurrency,2);assert.ok(s.live.queued>0);assert.equal(s.copies[0].memory.memorySlots,1);
});
test('copy hardware preview protects outstanding long tasks even after switching back',()=>{
 const g=ready();g.open();g.setTaskProfile('document');g.setPopularity(60);g.advanceTo(3000);g.setTaskProfile('short');
 assert.equal(g.previewCopy(1,'B200',2).fits,false);const before=g.save();assert.throws(()=>g.maintain(1,'B200',2));assert.deepEqual(g.save(),before);
});
test('the memory lesson has a feasible experiment for every selectable model',()=>{
 for(const model of ['flash','glm53','qwenflash']){
  const g=B.create();g.install('H200',8);g.useModel(model);g.open();const setup=g.memoryExperiment();assert.ok(setup,model);
  g.maintain(1,setup.gpu,setup.cards);g.setConcurrency(1,setup.concurrency);g.setTaskProfile('document');g.setPopularity(60);g.advanceTo(6000);
  assert.equal(g.inspect().live.waitingReason,'memory',model);assert.ok(g.inspect().live.replicas[0].active<setup.concurrency);assert.deepEqual(B.restore(JSON.parse(JSON.stringify(g.save()))).inspect(),g.inspect());
 }
});
