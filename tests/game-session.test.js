import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),G=require('../playground/session.js');
const settings={model:'flash',gpu:'H200',replicas:1,cards:8,prefill:4000,decode:100,price:3,reserve:10,concurrency:8,batchGain:50};
const save=s=>JSON.parse(JSON.stringify(s.save()));
const slow={settings:{...settings,decode:.01},popularity:.01,profile:{kind:'single',inputTokens:1000,outputTokens:100000}};
test('working clock repeats morning, rush and night on the same millisecond scale',()=>{
 assert.deepEqual(G.calendar(0),{day:1,hour:8,minute:0,phase:'morning',clock:'08:00'});
 assert.equal(G.calendar(10*G.HOUR).phase,'peak');assert.equal(G.calendar(15*G.HOUR).phase,'night');
 assert.equal(G.calendar(24*G.HOUR).phase,'morning');assert.equal(G.calendar(24*G.HOUR).day,2);
});
test('continuous arrivals and every event are independent of observation frequency',()=>{
 const a=G.create({settings,popularity:.01}),b=G.create({settings,popularity:.01});
 a.advanceTo(2*G.DAY);
 for(let t=0;t<2*G.DAY;t+=37123)b.advanceTo(t);
 b.advanceTo(2*G.DAY);assert.deepEqual(a.inspect(),b.inspect());assert.deepEqual(a.records(),b.records());
});
test('rush, night, midnight and next morning retain active work and waiting requests',()=>{
 const s=G.create(slow);s.advanceTo(10*G.HOUR);const morning=s.inspect();assert.ok(morning.active.length>0);
 const first=morning.active[0];s.advanceTo(15*G.HOUR);const peak=s.inspect();assert.ok(peak.queued>0);
 s.advanceTo(16*G.HOUR);const midnight=s.inspect();assert.equal(midnight.calendar.day,2);assert.ok(midnight.queued>=peak.queued);
 s.advanceTo(G.DAY);const next=s.inspect();assert.equal(next.calendar.phase,'morning');assert.ok(next.queued>=midnight.queued);
 assert.equal(next.active.find(r=>r.request_id===first.request_id).startMs,first.startMs);
 assert.equal(next.completed,0);assert.equal(next.arrived,next.queued+next.active.length);
});
test('stopping future visitors does not clear queue or active KV',()=>{
 const s=G.create(slow);s.advanceTo(15*G.HOUR);const before=s.inspect();s.setPopularity(0);s.advanceTo(G.DAY);
 const after=s.inspect();assert.equal(after.users,before.users);assert.equal(after.requestsGenerated,before.requestsGenerated);
 assert.equal(after.queued,before.queued);assert.equal(after.active.length,before.active.length);assert.ok(after.replicas[0].kvUsedGB>0);
});
test('increasing popularity takes effect only for future visitors',()=>{
 const s=G.create(slow);s.advanceTo(2*G.HOUR);const records=s.records();assert.ok(records.length>0);s.setPopularity(.03);s.advanceTo(3*G.HOUR);
 assert.ok(s.inspect().users>0);for(const old of records)assert.deepEqual(s.records().find(r=>r.request_id===old.request_id),old);
});
test('switching three worlds cannot change serving state, time or arrivals',()=>{
 const a=G.create(slow),b=G.create(slow);a.advanceTo(15*G.HOUR);b.advanceTo(15*G.HOUR);
 for(const w of G.WORLDS)a.setWorld(w);
 a.advanceTo(G.DAY);b.advanceTo(G.DAY);b.setWorld('orbital');assert.deepEqual(a.inspect(),b.inspect());assert.deepEqual(a.records(),b.records());
 assert.deepEqual(a.save().engine,b.save().engine);
});
test('JSON save restores exact ongoing work and source fractional arrival credit',()=>{
 const a=G.create(slow);a.advanceTo(1234567);a.setPopularity(.02);a.advanceTo(15*G.HOUR+12345);a.setWorld('workshop');
 const b=G.restore(save(a));assert.deepEqual(b.inspect(),a.inspect());a.advanceTo(2*G.DAY);b.advanceTo(2*G.DAY);
 assert.deepEqual(b.inspect(),a.inspect());assert.deepEqual(b.records(),a.records());
});
test('OpenClaw future calls remain scheduled when new visitor rate becomes zero',()=>{
 const s=G.create({settings,popularity:60,profile:{kind:'openclaw'}});s.advanceTo(1000);assert.equal(s.inspect().users,1);
 assert.equal(s.inspect().requestsGenerated,6);s.setPopularity(0);s.advanceTo(70000);
 assert.equal(s.inspect().users,1);assert.equal(s.inspect().arrived,6);assert.equal(s.inspect().requestsGenerated,6);
 assert.deepEqual(G.restore(save(s)).inspect(),s.inspect());
});
test('game maintenance and copy additions share the real event engine',()=>{
 const s=G.create(slow);s.advanceTo(15*G.HOUR);s.setPopularity(0);const a=s.inspect().active[0];
 s.maintain(1,{...slow.settings,decode:.02});assert.equal(s.inspect().replicas[0].maintenance,true);
 s.addCopy(slow.settings);assert.equal(s.inspect().replicas.length,2);assert.ok(s.inspect().replicas[1].active>0);
 assert.equal(s.inspect().active.find(r=>r.request_id===a.request_id).startMs,a.startMs);
 assert.deepEqual(G.restore(save(s)).inspect(),s.inspect());
});
test('session quota fails atomically instead of truncating requests or changing time',()=>{
 const s=G.create({settings,popularity:1000});const before=save(s);
 assert.throws(()=>s.advanceTo(G.HOUR),/limit/);assert.deepEqual(save(s),before);
 s.setPopularity(.01);s.advanceTo(G.HOUR);assert.equal(s.inspect().timeMs,G.HOUR);
});
test('malformed saves, invalid themes and invalid rates are rejected',()=>{
 const s=G.create({settings,popularity:0});s.advanceTo(1000);const data=save(s);
 for(const bad of [{...data,schema:'future'},{...data,world:'hack'},{...data,source:{...data.source,credit:2}},
 {...data,source:{...data.source,requests:10}}])assert.throws(()=>G.restore(bad));
 for(const n of [-1,Infinity,NaN,1001])assert.throws(()=>s.setPopularity(n));
 assert.throws(()=>s.setWorld('wrong'));assert.throws(()=>G.create({settings,profile:{kind:'single',inputTokens:1000000,outputTokens:1000000}}));
});
test('restoring a save cannot mislabel serving configuration with forged GPU metadata',()=>{
 const s=G.create({settings,popularity:0});const d=save(s);d.settingsByReplica[0].gpu='B300';
 assert.throws(()=>G.restore(d),/metadata/);
});
test('legacy saves without applied metadata restore idle and initial draining configurations',()=>{
 const g=G.create({settings,popularity:60});g.advanceTo(1100);g.maintain(1,{...settings,gpu:'B300',cards:4});
 const before=g.inspect();const saved=save(g);delete saved.appliedSettingsByReplica;
 assert.deepEqual(G.restore(saved).inspect(),before);
});
test('applied hardware metadata cannot be forged independently of active work',()=>{
 const g=G.create({settings,popularity:0});const saved=save(g);saved.appliedSettingsByReplica[0].gpu='B300';assert.throws(()=>G.restore(saved),/Applied model/);
});
test('task profile changes only future people and round-trips mixed request lengths',()=>{
 const g=G.create({settings,popularity:60,profile:{kind:'single',inputTokens:1000,outputTokens:100}});
 g.advanceTo(2500);const before=g.records();g.setProfile({kind:'single',inputTokens:120000,outputTokens:8000});g.advanceTo(3500);
 for(const r of before){const after=g.records().find(x=>x.request_id===r.request_id);assert.equal(after.input_tokens,r.input_tokens);assert.equal(after.startMs,r.startMs);}
 const rows=g.save().engine.actions.filter(a=>a.type==='enqueue').flatMap(a=>a.rows);assert.deepEqual(rows.map(r=>r.input_tokens),[1000,1000,120000]);
 const restored=G.restore(save(g));assert.deepEqual(restored.inspect(),g.inspect());g.advanceTo(8500);restored.advanceTo(8500);assert.deepEqual(restored.inspect(),g.inspect());assert.deepEqual(restored.records(),g.records());
});
test('switching profiles preserves fractional arrival credit and cannot change pending OpenClaw calls',()=>{
 const g=G.create({settings,popularity:60,profile:{kind:'openclaw'}});g.advanceTo(1500);g.setProfile({kind:'single',inputTokens:1000,outputTokens:100});g.advanceTo(2000);
 assert.equal(g.inspect().users,2);assert.equal(g.inspect().requestsGenerated,7);assert.deepEqual(G.restore(save(g)).inspect(),g.inspect());
});
test('invalid future profile is atomic and targets both current and maintenance hardware',()=>{
 const g=G.create({settings:{...settings,cards:3},popularity:60});g.advanceTo(1200);const before=save(g);
 assert.throws(()=>g.setProfile({kind:'single',inputTokens:200000,outputTokens:1000}));assert.deepEqual(save(g),before);
});
test('shrinking hardware must still fit long queued requests after reverting to short tasks',()=>{
 const g=G.create({settings:{...settings,gpu:'B300',cards:3,concurrency:1},popularity:60,profile:{kind:'single',inputTokens:120000,outputTokens:8000}});
 g.advanceTo(3000);assert.ok(g.inspect().queued>0);g.setProfile({kind:'single',inputTokens:1000,outputTokens:100});g.setPopularity(0);
 const before=save(g);assert.throws(()=>g.maintain(1,{...settings,gpu:'B200',cards:2,concurrency:1}),/Outstanding/);assert.deepEqual(save(g),before);
 g.advanceTo(1000000);g.maintain(1,{...settings,gpu:'B200',cards:2,concurrency:1});assert.ok(Math.abs(g.inspect().replicas[0].config.kvCapacityGB-25.6)<1e-9);
 assert.deepEqual(G.restore(save(g)).inspect(),g.inspect());
});
test('profile history and mixed task tokens are validated on load',()=>{
 const g=G.create({settings,popularity:60});g.advanceTo(1000);g.setProfile({kind:'single',inputTokens:120000,outputTokens:8000});g.advanceTo(2000);
 const d=save(g);d.profileChanges[1].afterUsers=0;assert.throws(()=>G.restore(d));
 const f=save(g);f.profileChanges[1].profile.inputTokens=119000;assert.throws(()=>G.restore(f));
 const h=save(g);h.profileChanges[1].atMs=2001;assert.throws(()=>G.restore(h));
});
test('queued long requests are protected even when the only active request is short',()=>{
 const g=G.create({settings:{...settings,gpu:'B300',cards:3,concurrency:1,decode:.01},popularity:60,profile:{kind:'single',inputTokens:1000,outputTokens:100}});
 g.advanceTo(1000);g.setProfile({kind:'single',inputTokens:120000,outputTokens:8000});g.advanceTo(2000);g.setProfile({kind:'single',inputTokens:1000,outputTokens:100});
 assert.equal(g.inspect().active[0].input_tokens,1000);assert.equal(g.inspect().queued,1);const before=save(g);
 assert.equal(g.previewPlacement({...settings,gpu:'B200',cards:2,concurrency:1}).fits,false);
 assert.throws(()=>g.maintain(1,{...settings,gpu:'B200',cards:2,concurrency:1}),/Outstanding/);assert.deepEqual(save(g),before);
});
test('profile fields added for lessons remain compatible with old fixed-profile files',()=>{
 const g=G.create({settings,popularity:60});g.advanceTo(2000);const d=save(g);delete d.initialProfile;delete d.profileChanges;assert.deepEqual(G.restore(d).inspect(),g.inspect());
});
test('mixed-profile arrivals are independent of render frequency on both sides of a change',()=>{
 const opts={settings,popularity:37,profile:{kind:'single',inputTokens:1000,outputTokens:100}},a=G.create(opts),b=G.create(opts);
 a.advanceTo(3711);for(let t=0;t<3711;t+=117)b.advanceTo(t);b.advanceTo(3711);
 for(const game of [a,b])game.setProfile({kind:'single',inputTokens:120000,outputTokens:8000});
 a.advanceTo(19523);for(let t=3800;t<19523;t+=113)b.advanceTo(t);b.advanceTo(19523);
 assert.deepEqual(a.inspect(),b.inspect());assert.deepEqual(a.records(),b.records());assert.deepEqual(G.restore(save(a)).inspect(),b.inspect());
});
test('future tasks must fit pending hardware as well as the currently draining copy',()=>{
 const base={...settings,model:'qwenflash',gpu:'H200',cards:2,concurrency:1,decode:.01};const g=G.create({settings:base,popularity:60,profile:{kind:'single',inputTokens:1000,outputTokens:100}});
 g.advanceTo(1000);g.maintain(1,{...base,cards:1});assert.equal(g.inspect().replicas[0].maintenance,true);const before=save(g);
 assert.throws(()=>g.setProfile({kind:'single',inputTokens:10000,outputTokens:1000}),/fit/);assert.deepEqual(save(g),before);
});
