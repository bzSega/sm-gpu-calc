// sim-core tests — run: node --test tests/
// Semantic checks per proposal §13: request balance, zero demand, overload,
// determinism, config/workload validation, cost sanity, trip-trace smoke.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { simulate, validateWorkload } = require('../sim-core.js');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const CFG = { replicas: 2, prefillTokensPerSecond: 4000, decodeTokensPerSecond: 100, hourlyUSDPerReplica: 24 };
const row = (id, arr, i, o) => ({ request_id: id, arrival_ms: arr, input_tokens: i, output_tokens: o });

test('zero demand: single request, no queueing', () => {
  const r = simulate([row('a', 0, 400, 100)], CFG);
  assert.equal(r.completed, 1);
  assert.equal(r.peakQueued, 0);
  assert.equal(r.perReplica.reduce((s, x) => s + x, 0), 1);
});

test('overload: peak queue grows and requests wait', () => {
  const wl = Array.from({ length: 10 }, (_, i) => row(`r${i}`, 0, 1000, 500));
  const r = simulate(wl, { ...CFG, replicas: 1 });
  assert.equal(r.completed, 10);
  assert.ok(r.peakQueued > 0, 'requests must wait when arrival outpaces service');
  assert.ok(r.requests.every(q => q.startMs >= 0));
});

test('request balance: completed = total (drained run)', () => {
  const wl = Array.from({ length: 50 }, (_, i) => row(`r${i}`, i * 137, 800, 200));
  const r = simulate(wl, CFG);
  assert.equal(r.completed, wl.length);
  assert.equal(r.requests.length, wl.length);
});

test('two replicas finish no later than one', () => {
  const wl = Array.from({ length: 20 }, (_, i) => row(`r${i}`, i * 50, 2000, 800));
  const one = simulate(wl, { ...CFG, replicas: 1 });
  const two = simulate(wl, { ...CFG, replicas: 2 });
  assert.ok(two.durationMs <= one.durationMs);
});

test('determinism: same input -> identical output', () => {
  const wl = Array.from({ length: 15 }, (_, i) => row(`r${i}`, (i * 7) % 500, 500, 300));
  const a = simulate(wl, CFG), b = simulate(wl, CFG);
  assert.deepEqual(a, b);
});

test('per-replica counts sum to completed', () => {
  const wl = Array.from({ length: 33 }, (_, i) => row(`r${i}`, i * 90, 300, 90));
  const r = simulate(wl, { ...CFG, replicas: 3 });
  assert.equal(r.perReplica.reduce((s, x) => s + x, 0), 33);
});

test('cost: rental covers full run including idle', () => {
  const r = simulate([row('a', 0, 100, 50)], { ...CFG, replicas: 2 });
  const expected = 2 * 24 * (r.durationMs / 3600000);
  assert.ok(Math.abs(r.costPerRequestUSD - expected) < 1e-12);
});

test('validation: rejects negative/missing fields, empty workload', () => {
  assert.equal(validateWorkload([]).ok, false);
  assert.equal(validateWorkload([row('x', -1, 5, 1)]).ok, false);
  assert.equal(validateWorkload([row('x', 0, 'many', 1)]).ok, false);
  assert.equal(validateWorkload([row('x', 0, 5, 1)]).ok, true);
});

test('invalid config throws', () => {
  assert.throws(() => simulate([row('a', 0, 1, 1)], { ...CFG, replicas: 0 }));
  assert.throws(() => simulate([row('a', 0, 1, 1)], { ...CFG, decodeTokensPerSecond: -5 }));
});

test('trip-trace smoke: 7 calls, drained, plausible TTFT', () => {
  const csv = fs.readFileSync(path.join(ROOT, 'examples/trip-moscow-nizhny/requests.csv'), 'utf8')
    .trim().split(/\r?\n/);
  const hdr = csv.shift().split(',');
  const wl = csv.map(line => {
    const c = line.split(','), o = {};
    hdr.forEach((h, i) => {
      if (['request_id', 'arrival_ms', 'input_tokens', 'output_tokens'].includes(h))
        o[h] = h === 'request_id' ? c[i] : Number(c[i]);
    });
    return o;
  });
  const r = simulate(wl, CFG);
  assert.equal(r.completed, 7);
  assert.ok(r.ttftP50Ms > 0 && r.ttftP95Ms >= r.ttftP50Ms);
  assert.ok(r.costPerRequestUSD > 0);
});

test('canonical validation rejects null, duplicate IDs, zero output and fractions', () => {
  for (const wl of [[null],[row('a',0,1,0)],[row('a',0,1.5,1)],[row('a',0,1,1),row('a',1,1,1)]]) assert.equal(validateWorkload(wl).ok,false);
});

test('snapshot conserves requests and changes phases exactly at boundaries', () => {
  const {snapshot}=require('../sim-core.js');
  const r=simulate([row('a',0,100,100),row('b',500,100,100)],{replicas:1,prefillTokensPerSecond:100,decodeTokensPerSecond:100,hourlyUSDPerReplica:1});
  assert.equal(r.requests[0].prefillEndMs,1000);
  assert.equal(r.requests[0].endMs,2000);
  for(const time of [0,499,500,999,1000,1999,2000,4000]){
    const s=snapshot(r,time);
    assert.equal(s.arrived,s.queued+s.active.length+s.completed);
    assert.ok(s.active.length<=1);
  }
  assert.equal(snapshot(r,999).active[0].phase,'prefill');
  assert.equal(snapshot(r,1000).active[0].phase,'decode');
  assert.equal(snapshot(r,500).queued,1);
  assert.equal(snapshot(r,2000).active[0].request_id,'b');
  assert.equal(snapshot(r,4000).completed,2);
});

test('CSV and scenario round trip preserve workload metadata and reproduce results',()=>{
  const S=require('../scenario-core.js');
  const wl=S.parseCSV('request_id,arrival_ms,input_tokens,output_tokens,depends_on\na,0,100,50,\nb,200,200,80,a');
  const settings={model:'flash',gpu:'H200',replicas:2,cards:8,prefill:4000,decode:100,price:3,reserve:10};
  const saved=S.readScenario(JSON.stringify(S.makeScenario(wl,settings)));
  assert.equal(saved.workload[1].depends_on,'a');
  assert.deepEqual(simulate(wl,S.config(settings)),simulate(saved.workload,S.config(saved.settings)));
  for(const text of ['request_id,arrival_ms,input_tokens,output_tokens\nx,,1,1','request_id,arrival_ms,input_tokens,output_tokens,input_tokens\nx,0,1,1,1']) assert.throws(()=>S.parseCSV(text));
  assert.throws(()=>S.readScenario('{"schema_version":"future"}'));
});

test('memory preflight uses one concurrent request per replica and context limit',()=>{
  const S=require('../scenario-core.js');
  const settings={model:'flash',gpu:'H200',replicas:2,cards:8,prefill:4000,decode:100,price:3,reserve:10};
  const wl=[row('a',0,1000,1000)];
  const mem=S.memory(wl,settings);
  assert.equal(mem.total,1128);
  assert.equal(mem.weightsGB,320);
  assert.ok(Math.abs(mem.kvGB-.49152)<1e-12);
  assert.ok(Math.abs(mem.freeGB-694.70848)<1e-8);
  assert.equal(S.memory(wl,{...settings,cards:1}).fits,false);
  assert.equal(S.memory([row('long',0,128000,1)],settings).fits,false);
  assert.deepEqual(S.memory(wl,{...settings,replicas:8}),mem);
});

test('rates below supported range cannot yield infinite results',()=>{
  const S=require('../scenario-core.js');
  const s={model:'flash',gpu:'H200',replicas:2,cards:8,prefill:4000,decode:1e-320,price:3,reserve:10};
  assert.equal(S.validateSettings(s),false);
  assert.throws(()=>simulate([row('a',0,10,10)],{...CFG,decodeTokensPerSecond:1e-320}));
});

const concurrentCfg={replicas:1,prefillTokensPerSecond:100,decodeTokensPerSecond:100,hourlyUSDPerReplica:1,concurrency:2,batchGain:0};
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);
test('concurrent requests share fixed throughput; batching gain is explicit',()=>{
  const wl=[row('a',0,0,100),row('b',0,0,100)];
  const fixed=simulate(wl,concurrentCfg);
  near(fixed.durationMs,2000);near(fixed.requests[0].ttftMs,20);assert.equal(fixed.peakActive,2);
  const partial=simulate(wl,{...concurrentCfg,batchGain:.5});
  near(partial.durationMs,4000/3);near(partial.requests[0].ttftMs,40/3);
  near(simulate(wl,{...concurrentCfg,batchGain:1}).durationMs,1000);
});
test('arrival and completion change the shared rate, including time to first token',()=>{
  const r=simulate([row('a',0,0,100),row('b',500,0,100)],concurrentCfg);
  near(r.requests[0].endMs,1500);near(r.requests[1].endMs,2000);
  near(r.requests[0].ttftMs,10);near(r.requests[1].ttftMs,20);
});
test('mixed prefill and decode share one budget and preserve phase boundaries',()=>{
  const r=simulate([row('a',0,100,100),row('b',0,0,100)],concurrentCfg);
  near(r.requests[0].prefillEndMs,2000);near(r.requests[0].ttftMs,2010);
  near(r.requests[0].endMs,3000);near(r.requests[1].endMs,2000);
});
test('KV admission blocks until memory is released; an oversized request fails',()=>{
  const cfg={...concurrentCfg,batchGain:1,kvBytesPerToken:1e7,kvCapacityGB:1.5};
  const r=simulate([row('a',0,0,100),row('b',0,0,100)],cfg);
  assert.equal(r.peakActive,1);near(r.requests[1].startMs,1000);near(r.durationMs,2000);
  assert.throws(()=>simulate([row('big',0,0,151)],cfg));
});
test('strict FIFO does not bypass a waiting large request with a small request',()=>{
  const cfg={...concurrentCfg,concurrency:3,batchGain:1,kvBytesPerToken:1e7,kvCapacityGB:1.5};
  const r=simulate([row('a',0,0,100),row('b',10,0,100),row('c',20,0,10)],cfg);
  assert.equal(r.requests[1].startMs,1000);assert.equal(r.requests[2].startMs,1000);
});
test('parallel snapshots conserve counts and respect per-replica memory and slots',()=>{
  const {snapshot}=require('../sim-core.js');
  const wl=Array.from({length:80},(_,i)=>row(`r${i}`,i*17,i%3*100,20+i%7*10));
  const original=JSON.stringify(wl);
  const cfg={...concurrentCfg,replicas:3,concurrency:4,batchGain:.4,kvBytesPerToken:1e7,kvCapacityGB:4};
  const r=simulate(wl,cfg);assert.equal(JSON.stringify(wl),original);
  for(const q of r.requests)for(const t of [q.startMs,q.prefillEndMs,q.firstTokenMs,q.endMs]){
    const s=snapshot(r,t);assert.equal(s.arrived,s.queued+s.active.length+s.completed);
    for(let rep=1;rep<=3;rep++){
      const active=s.active.filter(j=>j.replica===rep);assert.ok(active.length<=4);
      assert.ok(active.reduce((sum,j)=>sum+j.kvGB,0)<=4+1e-9);
    }
    assert.ok(q.startMs<=q.prefillEndMs && q.prefillEndMs<=q.firstTokenMs && q.firstTokenMs<=q.endMs);
  }
  assert.deepEqual(simulate(wl,cfg),r);
});
test('new settings round trip; legacy scenarios retain sequential semantics',()=>{
  const S=require('../scenario-core.js');
  const settings={model:'glm53',gpu:'B200',replicas:2,cards:8,prefill:2800,decode:84,price:5,reserve:10,concurrency:8,batchGain:50};
  const wl=Array.from({length:24},(_,i)=>row(`r${i}`,i*200,10000,1000));
  const saved=S.readScenario(JSON.stringify(S.makeScenario(wl,settings)));
  assert.deepEqual(saved.settings,settings);
  assert.deepEqual(simulate(wl,S.config(saved.settings)),simulate(wl,S.config(settings)));
  const legacy=S.readScenario(JSON.stringify({...saved,schema_version:'sm-gpu-calc/1',core_version:'0.2.0'}));
  assert.equal(legacy.settings.concurrency,1);assert.equal(legacy.settings.batchGain,0);
  near(simulate(wl,S.config(legacy.settings)).durationMs,185914.2857142857);
  const mem=S.memory(wl,settings);assert.equal(mem.memorySlots,155);assert.equal(mem.effectiveSlots,8);
  assert.equal(S.memory(wl,{...settings,concurrency:256}).effectiveSlots,155);
});
test('concurrency and gain validation rejects null, fractions, and out-of-range values',()=>{
  for(const cfg of [{concurrency:null},{concurrency:0},{concurrency:1.5},{concurrency:257},{batchGain:null},{batchGain:-.1},{batchGain:1.1},{kvCapacityGB:NaN}])assert.throws(()=>simulate([row('x',0,0,1)],{...concurrentCfg,...cfg}));
});

test('preflight and scheduler agree at the floating-point memory boundary',()=>{
 const S=require('../scenario-core.js');
 const s={model:'glm53',gpu:'H200',replicas:1,cards:10,prefill:2800,decode:84,price:5,reserve:46.547063829787234,concurrency:2,batchGain:50};
 const wl=[row('a',0,9000,1000),row('b',0,9000,1000)];
 assert.equal(S.memory(wl,s).fits,true);assert.equal(S.memory(wl,s).memorySlots,1);
 const r=simulate(wl,S.config(s));assert.equal(r.peakActive,1);assert.equal(r.requests[1].startMs,r.requests[0].endMs);
});


test('demo replays the live OpenClaw trace for three independent users', () => {
  const S = require('../scenario-core.js');
  const live = S.parseCSV(fs.readFileSync(path.join(ROOT, 'examples/trip-moscow-nizhny/requests-live.csv'), 'utf8'));
  const demo = S.demo();
  assert.equal(demo.length, 18);
  assert.ok(validateWorkload(demo).ok);
  for (let u = 1; u <= 3; u++) {
    const calls = demo.filter(r => r.job_id === `trip-u${u}`);
    assert.equal(calls.length, 6);
    assert.equal(calls.reduce((sum, r) => sum + r.input_tokens, 0), 28200);
    assert.equal(calls.reduce((sum, r) => sum + r.output_tokens, 0), 2400);
    calls.forEach((r, k) => {
      assert.equal(r.request_id, `trip-u${u}-${live[k].request_id}`);
      assert.equal(r.arrival_ms, live[k].arrival_ms + (u - 1) * 5000);
      assert.equal(r.input_tokens, live[k].input_tokens);
      assert.equal(r.output_tokens, live[k].output_tokens);
      assert.equal(r.token_count_source, 'live_run_reconstructed');
      assert.equal(r.model_profile_id, live[k].model_profile_id);
      assert.equal(r.depends_on, live[k].depends_on.split(';').filter(Boolean).map(id => `trip-u${u}-${id}`).join(';'));
    });
  }
  const settings = {model:'flash', gpu:'H200', replicas:2, cards:8, prefill:4000, decode:100, price:3, reserve:10, concurrency:8, batchGain:50};
  const restored = S.readScenario(JSON.stringify(S.makeScenario(demo, settings)));
  assert.deepEqual(restored.workload, demo);
  assert.equal(simulate(restored.workload, S.config(settings)).completed, 18);
});

test('user controls scale whole live traces and validate workload limits', () => {
  const S=require('../scenario-core.js');
  const one=S.demo({users:1,usersPerSecond:2});
  const many=S.demo({users:10,usersPerSecond:2});
  assert.equal(one.length,6);
  assert.equal(many.length,60);
  assert.equal(many.filter(r=>r.job_id==='trip-u10')[0].arrival_ms,4500);
  assert.equal(many.reduce((sum,r)=>sum+r.input_tokens,0),282000);
  assert.equal(many.reduce((sum,r)=>sum+r.output_tokens,0),24000);
  for(const usersPerSecond of [.01,1000])assert.ok(validateWorkload(S.demo({users:1666,usersPerSecond})).ok);
  for(const users of [0,1667,1.5,null,NaN,Infinity,'3'])assert.throws(()=>S.demo({users,usersPerSecond:1}));
  for(const usersPerSecond of [0,.001,1001,null,NaN,Infinity,'1'])assert.throws(()=>S.demo({users:1,usersPerSecond}));
});

test('arrival peak uses a sliding half-open second, without mutating the workload', () => {
  const S=require('../scenario-core.js');
  const wl=[row('c',1000,1,1),row('a',0,1,1),row('b',999,1,1),row('d',1000,1,1)];
  const copy=JSON.stringify(wl);
  assert.equal(S.arrivalStats(wl).peakRps,3); // [999,1999): 999,1000,1000
  assert.equal(S.arrivalStats([row('a',0,1,1),row('b',1000,1,1)]).peakRps,1);
  assert.equal(S.arrivalStats([row('a',0,1,1),row('b',0,1,1)]).peakRps,2);
  assert.equal(S.arrivalStats([row('a',5000,1,1)]).peakRps,1);
  assert.equal(JSON.stringify(wl),copy);
  assert.throws(()=>S.arrivalStats([]));
});

test('capacity is per replica and pool, not multiplied by shard count', () => {
  const S=require('../scenario-core.js');
  const wl=[row('a',0,100,100)];
  const settings={model:'flash',gpu:'H200',replicas:2,cards:8,prefill:100,decode:100,price:3,reserve:10,concurrency:4,batchGain:50};
  // 2 seconds solo service, G(4)=2.5: 1.25 calls/s per replica.
  const cap=S.capacity(wl,settings);
  near(cap.replicaRps,1.25);near(cap.poolRps,2.5);
  near(S.capacity(wl,{...settings,cards:16}).poolRps,2.5);
  near(S.capacity(wl,{...settings,replicas:4}).poolRps,5);
  near(S.capacity(wl,{...settings,batchGain:0}).poolRps,1);
  assert.equal(S.capacity(wl,{...settings,cards:1}).poolRps,0);
});

test('demo parameters survive JSON round trip only with the matching trace', () => {
  const S=require('../scenario-core.js');
  const source={type:'openclaw-live/1',users:10,usersPerSecond:2};
  const settings={model:'flash',gpu:'H200',replicas:2,cards:8,prefill:4000,decode:100,price:3,reserve:10,concurrency:8,batchGain:50};
  const wl=S.demo(source);wl[0].custom='preserve me';const saved=S.makeScenario(wl,settings,source);
  assert.equal(S.readScenario(JSON.stringify(saved)).workload[0].custom,'preserve me');
  assert.deepEqual(S.readScenario(JSON.stringify(saved)).workload_source,source);
  assert.deepEqual(S.readScenario(JSON.stringify({...saved,workload:[...wl].reverse()})).workload_source,source);
  assert.equal(S.readScenario(JSON.stringify(S.makeScenario(wl,settings))).workload_source,undefined);
  for(const changed of [{...source,users:11},{...source,usersPerSecond:3},{...source,type:'future'},null]){
    assert.throws(()=>S.readScenario(JSON.stringify({...saved,workload_source:changed})));
  }
  const changed=structuredClone(saved);changed.workload[0].input_tokens++;
  assert.throws(()=>S.readScenario(JSON.stringify(changed)));
});

test('large pools serve FIFO waves on 40 and 64 replicas and preserve scenario settings', () => {
  const { snapshot } = require('../sim-core.js');
  const S = require('../scenario-core.js');
  for (const replicas of [40, 64]) {
    const wl=Array.from({length:replicas*2+1},(_,i)=>row(String(i).padStart(3,'0'),0,100,100));
    const settings={model:'flash',gpu:'B200',replicas,cards:4,prefill:100,decode:100,price:1,reserve:10,concurrency:1,batchGain:0};
    const restored=S.readScenario(JSON.stringify(S.makeScenario(wl,settings)));
    assert.equal(restored.settings.replicas,replicas);
    const r=simulate(restored.workload,S.config(restored.settings));
    near(r.durationMs,6000);
    assert.equal(r.completed,replicas*2+1);
    assert.equal(r.peakActive,replicas);
    assert.equal(r.peakQueued,replicas+1);
    assert.equal(r.perReplica.length,replicas);
    assert.equal(r.perReplica[0],3);
    assert.ok(r.perReplica.slice(1).every(n=>n===2));
    assert.equal(snapshot(r,1999).active.length,replicas);
    assert.equal(snapshot(r,4000).active.length,1);
    near(r.totalCostUSD,replicas*4*6/3600);
    assert.deepEqual(simulate(wl,S.config(settings)),r);
  }
});

test('replica bounds agree in core and scenario validation', () => {
  const S = require('../scenario-core.js');
  const settings={model:'flash',gpu:'H200',replicas:64,cards:8,prefill:4000,decode:100,price:3,reserve:10,concurrency:8,batchGain:50};
  assert.ok(S.validateSettings(settings));
  for(const replicas of [0,65,1.5,NaN,Infinity,null]) {
    assert.equal(S.validateSettings({...settings,replicas}),false);
    assert.throws(()=>simulate([row('a',0,100,100)],{...CFG,replicas}));
  }
});

test('100k daily users keep full-period totals separate from a bounded replay',()=>{
 const S=require('../scenario-core.js'),s={...S.periodDefaults};
 const p=S.demandPlan(s),wl=S.periodDemo(s);
 assert.equal(p.totalTasks,100000);assert.equal(p.totalCalls,600000);
 assert.equal(p.inputTokens,2820000000);assert.equal(p.outputTokens,240000000);
 near(p.usersPerSecond,100000/86400);near(p.meanRps,600000/86400);
 assert.equal(p.sampleTasks,1042);assert.equal(wl.length,6252);
 assert.equal(p.windowDurationMs,900000);assert.equal(p.complete,false);assert.equal(p.truncated,false);
 assert.equal(wl[6].arrival_ms,864);assert.equal(wl[0].arrival_ms,0);
 assert.ok(validateWorkload(wl).ok);
 const two=S.demandPlan({...s,tasksPerUser:2});near(two.meanRps,p.meanRps*2);
 assert.equal(two.sampleTasks,1666);assert.equal(two.truncated,true);
 near(two.windowDurationMs,719712); // 1666 starts at one start per 432 ms.
 const heavy=S.periodDemo({...s,tasksPerUser:100,users:10000000});assert.equal(heavy.length,9996);assert.ok(validateWorkload(heavy).ok);
});

test('hourly weights choose the busiest hour and normalize demand, including zero hours',()=>{
 const S=require('../scenario-core.js');
 const weights=Array(24).fill(0);weights[10]=1;weights[18]=3;
 const s={...S.periodDefaults,users:400,profile:'hourly',hourWeights:weights};
 const p=S.demandPlan(s),wl=S.periodDemo(s);
 assert.equal(p.totalTasks,400);assert.equal(p.peakHour,18);assert.equal(p.windowStartMs,64800000);
 near(p.meanRps,1/36);near(p.peakRps,.5);
 assert.equal(p.sampleTasks,75);assert.equal(p.firstTask,100);assert.equal(wl[0].request_id,'trip-job101-s1');
 assert.equal(wl[0].arrival_ms,0);assert.equal(wl[6].arrival_ms,12000);
 assert.equal(wl.at(-6).arrival_ms,888000);assert.equal(wl.at(-1).arrival_ms,952170);
 assert.deepEqual(S.demandPlan({...s,hourWeights:weights.map(v=>v*2)}),p);
 const boundary={...s,users:3,hourWeights:Array.from({length:24},(_,h)=>h===0?1:h===1?2:0)};
 const b=S.periodDemo(boundary);assert.equal(b[0].request_id,'trip-job2-s1');assert.equal(b[0].arrival_ms,0);
});

test('period scenario round trip preserves profile and metadata and rejects mismatched replay',()=>{
 const S=require('../scenario-core.js'),options={...S.periodDefaults};
 const settings={model:'flash',gpu:'B200',replicas:40,cards:8,prefill:5600,decode:140,price:5,reserve:10,concurrency:8,batchGain:50};
 const wl=S.periodDemo(options);wl[0].custom='keep';const src=S.periodSource(options);
 const saved=S.makeScenario(wl,settings,src),restored=S.readScenario(JSON.stringify(saved));
 assert.deepEqual(restored.workload_source,src);assert.deepEqual(restored.workload,wl);
 assert.throws(()=>S.readScenario(JSON.stringify({...saved,workload_source:{...src,tasksPerUser:2}})));
 const changed=structuredClone(saved);changed.workload[0].arrival_ms++;
 assert.throws(()=>S.readScenario(JSON.stringify(changed)));
 assert.deepEqual(S.readScenario(JSON.stringify({...saved,workload:[...wl].reverse()})).workload_source,src);
});

test('period inputs reject unsupported periods, empty profiles and invalid task counts',()=>{
 const S=require('../scenario-core.js'),s=S.periodDefaults;
 for(const patch of [{users:0},{users:10000001},{tasksPerUser:0},{tasksPerUser:1.2},{tasksPerUser:101},{periodHours:0},{periodHours:169},{periodHours:NaN},{profile:'bad'},{profile:'hourly',periodHours:12},{windowMinutes:0},{windowMinutes:61},{hourWeights:[]},{hourWeights:Array(24).fill(0)},{hourWeights:Array(24).fill(-1)},{hourWeights:Array(24).fill(Infinity)}])assert.throws(()=>S.demandPlan({...s,...patch}));
 const single={...s,users:1,periodHours:1/3600000};assert.equal(S.periodDemo(single).length,6);
});

test('a valid sparse hourly window may contain no tasks and must stay empty',()=>{
 const S=require('../scenario-core.js');
 const s={...S.periodDefaults,users:1,profile:'hourly',hourWeights:[1,2,...Array(22).fill(0)]};
 assert.ok(S.validatePeriodSettings(s));
 const p=S.demandPlan(s);assert.equal(p.peakHour,1);assert.equal(p.sampleTasks,0);assert.equal(p.totalCalls,6);
 assert.deepEqual(S.periodDemo(s),[]);
});
