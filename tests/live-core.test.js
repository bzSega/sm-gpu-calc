import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url),C=require('../sim-core.js');
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/finite-core-0.3.0.json',import.meta.url)));
const config={replicas:1,prefillTokensPerSecond:1000,decodeTokensPerSecond:100,hourlyUSDPerReplica:1,concurrency:2,batchGain:.5,kvBytesPerToken:1e6,kvCapacityGB:10};
const row=(id,t=0,i=1000,o=100)=>({request_id:id,arrival_ms:t,input_tokens:i,output_tokens:o});
const roundTrip=s=>C.restoreSession(JSON.parse(JSON.stringify(s.save())));
for(const f of fixture.cases){
 test(`live observation frequency preserves every legacy event: ${f.name}`,()=>{
  const s=C.createSession(f.config).enqueue(f.workload);
  for(let t=0;t<f.expected.durationMs;t+=137.5)s.advanceTo(t);
  assert.deepEqual(s.finish(),f.expected);
 });
 test(`save midway preserves exact continuation: ${f.name}`,()=>{
  const s=C.createSession(f.config).enqueue(f.workload);s.advanceTo(f.expected.durationMs*.37);
  const restored=roundTrip(s);assert.deepEqual(restored.inspect(),s.inspect());
  assert.deepEqual(restored.finish(),s.finish());assert.deepEqual(restored.finish(),f.expected);
 });
}
test('live arrivals preserve existing active work and FIFO queue',()=>{
 const s=C.createSession({...config,concurrency:1}).enqueue([row('a'),row('b')]);
 s.advanceTo(500);const before=s.inspect();s.enqueue([row('c',600)]);s.advanceTo(600);
 assert.equal(s.inspect().queued,2);assert.equal(s.inspect().active[0].request_id,'a');
 assert.equal(s.inspect().active[0].startMs,before.active[0].startMs);
 const out=s.finish();assert.deepEqual(out.requests.map(r=>r.request_id),['a','b','c']);
 assert.deepEqual(out,C.simulate([row('a'),row('b'),row('c',600)],{...config,concurrency:1}));
});
test('save includes immediate arrivals before any explicit advance',()=>{
 const s=C.createSession(config).enqueue([row('a')]);assert.deepEqual(roundTrip(s).inspect(),s.inspect());
});
test('maintenance drains current work at old rates before admitting new work',()=>{
 const s=C.createSession({...config,concurrency:1}).enqueue([row('a'),row('b')]);s.advanceTo(500);
 const newConfig={...config,concurrency:1,prefillTokensPerSecond:2000,decodeTokensPerSecond:200};
 s.maintain(1,newConfig);assert.equal(s.inspect().replicas[0].maintenance,true);
 assert.equal(s.inspect().queued,1);assert.equal(s.inspect().waitingReason,'maintenance');
 const restored=roundTrip(s);assert.deepEqual(restored.finish(),s.finish());
 const [a,b]=s.records();assert.equal(a.endMs,2000);assert.equal(b.startMs,a.endMs);assert.equal(b.endMs,3000);
});
test('an added copy serves waiting work without accelerating work on old copy',()=>{
 const s=C.createSession({...config,concurrency:1}).enqueue([row('a'),row('b')]);s.advanceTo(500);
 s.addReplica({...config,concurrency:1});const active=s.inspect().active;
 assert.equal(active.length,2);assert.equal(active.find(r=>r.request_id==='b').startMs,500);
 const restored=roundTrip(s);assert.deepEqual(restored.finish(),s.finish());
 assert.equal(s.records().find(r=>r.request_id==='a').endMs,2000);
 assert.equal(s.records().find(r=>r.request_id==='b').endMs,2500);
});
test('memory and slot waiting are distinct; all KV is freed after completion',()=>{
 const s=C.createSession({...config,concurrency:8,kvCapacityGB:1.2}).enqueue([row('a'),row('b')]);
 assert.equal(s.inspect().waitingReason,'memory');assert.ok(s.inspect().replicas[0].active<8);
 s.finish();assert.equal(s.inspect().queued,0);assert.equal(s.inspect().active.length,0);assert.equal(s.inspect().replicas[0].kvUsedGB,0);
 const slots=C.createSession({...config,concurrency:1}).enqueue([row('a'),row('b')]);assert.equal(slots.inspect().waitingReason,'slots');
});
test('rejected future memory change and invalid arrivals leave session unchanged',()=>{
 const s=C.createSession({...config,concurrency:1}).enqueue([row('a'),row('b')]);s.advanceTo(500);const saved=s.save();
 assert.throws(()=>s.maintain(1,{...config,kvCapacityGB:.1}));assert.deepEqual(s.save(),saved);
 for(const bad of [[row('old',100)],[row('a',600)],[row('large',600,100000,1)]])assert.throws(()=>s.enqueue(bad));
 assert.deepEqual(s.save(),saved);assert.throws(()=>s.advanceTo(499));
});
test('inspection and finish never rewind an idle live clock',()=>{
 const s=C.createSession(config).enqueue([row('a')]);s.advanceTo(10000);s.finish();assert.equal(s.inspect().timeMs,10000);
 s.enqueue([row('b',10000)]);assert.equal(s.inspect().active[0].startMs,10000);
 assert.deepEqual(roundTrip(s).inspect(),s.inspect());
});
test('empty idle session restores, advances and remains idle',()=>{
 const s=C.createSession(config);s.advanceTo(1000);assert.equal(s.inspect().completed,0);
 assert.deepEqual(roundTrip(s).inspect(),s.inspect());assert.equal(s.finish().completed,0);
});
test('save rejects unknown versions, action kinds, past times and forged results',()=>{
 const s=C.createSession(config).enqueue([row('a')]);s.advanceTo(500);const saved=s.save();
 for(const bad of [{...saved,schema:'future'},{...saved,timeMs:-1},{...saved,actions:[{atMs:0,type:'hack'}]},
 {...saved,actions:[{atMs:600,type:'enqueue',rows:[row('b',600)]}]}])assert.throws(()=>C.restoreSession(bad));
 const restored=C.restoreSession({...saved,result:{completed:1e9}});assert.equal(restored.inspect().completed,0);
});
test('uniform fractional rental preserves the original multiplication order',()=>{
 const s=C.simulate([row('a')],{...config,replicas:6,hourlyUSDPerReplica:.1});
 assert.equal(s.totalCostUSD,6*.1*(s.durationMs/3600000));
});
test('maintenance changes fractional rental only after draining and charges idle copies',()=>{
 const cfg={...config,concurrency:1,hourlyUSDPerReplica:36};const s=C.createSession(cfg).enqueue([row('a'),row('b')]);
 s.advanceTo(500);s.maintain(1,{...cfg,hourlyUSDPerReplica:72});s.advanceTo(5000);
 // Old rate until 2000ms, new rate for the next3000ms including idle time.
 assert.equal(s.inspect().totalCostUSD,36*(2000/3600000)+72*(3000/3600000));
 assert.deepEqual(roundTrip(s).inspect(),s.inspect());
});
test('legacy unlimited-memory config survives JSON without serializing Infinity',()=>{
 const cfg={replicas:1,prefillTokensPerSecond:1000,decodeTokensPerSecond:100,hourlyUSDPerReplica:0};
 const s=C.createSession(cfg).enqueue([row('a')]);s.advanceTo(123.45);
 assert.deepEqual(roundTrip(s).finish(),s.finish());
});
test('a 64-copy 10000-request session conserves all work and restores mid-run',()=>{
 const cfg={...config,replicas:64,concurrency:8};
 const rows=Array.from({length:10000},(_,i)=>row(`load-${i}`,i*2,1000+(i%17)*111,10+i%100));
 const s=C.createSession(cfg).enqueue(rows);s.advanceTo(12345);const mid=s.inspect();
 assert.equal(mid.arrived,mid.completed+mid.queued+mid.active.length);
 const restored=roundTrip(s);assert.deepEqual(restored.finish(),s.finish());
 assert.equal(s.finish().completed,10000);assert.equal(s.inspect().active.length,0);
});
test('reducing memory drains the old larger batch before applying the smaller budget',()=>{
 const s=C.createSession(config).enqueue([row('a'),row('b'),row('c'),row('d')]);s.advanceTo(500);
 assert.ok(s.inspect().replicas[0].kvUsedGB>1.2);s.maintain(1,{...config,kvCapacityGB:1.2});
 assert.equal(s.inspect().replicas[0].config.kvCapacityGB,10);
 const end=1000/.75+1000/.75;s.advanceTo(end+1);
 assert.equal(s.inspect().replicas[0].maintenance,false);assert.equal(s.inspect().replicas[0].config.kvCapacityGB,1.2);
 assert.equal(s.inspect().active.length,1);assert.equal(s.inspect().queued,1);assert.equal(s.inspect().waitingReason,'memory');
 assert.deepEqual(roundTrip(s).finish(),s.finish());
});
