import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),C=require('../sim-core.js'),G=require('../playground/session.js'),U=require('../playground/startup.js');
const config={replicas:2,prefillTokensPerSecond:1333,decodeTokensPerSecond:77,hourlyUSDPerReplica:.3,concurrency:3,batchGain:.37,kvBytesPerToken:1000,kvCapacityGB:10};
const row=(i,t=0)=>({request_id:`r-${i}`,arrival_ms:t,input_tokens:111+i%7,output_tokens:1+i%13});
const copy=x=>JSON.parse(JSON.stringify(x));
const resumed=s=>C.restoreSession(copy(s.save()));
test('recent-history mode preserves all fractional events, maintenance and pending work across checkpoints',()=>{
 const a=C.createSession(config),b=C.createSession(config,{history:'recent'});
 for(const s of [a,b])s.enqueue(Array.from({length:90},(_,i)=>row(i,i*17)));
 for(const t of [13.5,87,501.75,1700,3500]){
  a.advanceTo(t);b.advanceTo(t);assert.deepEqual(b.inspect(),a.inspect());
  const r=resumed(b);assert.deepEqual(r.inspect(),b.inspect());
  r.advanceTo(t+1.125);b.advanceTo(t+1.125);a.advanceTo(t+1.125);assert.deepEqual(r.inspect(),a.inspect());
  assert.deepEqual(b.records(),a.records());
 }
 a.maintain(1,{...config,decodeTokensPerSecond:123});b.maintain(1,{...config,decodeTokensPerSecond:123});
 const r=resumed(b);for(const s of [a,b,r]){s.addReplica(config);s.advanceTo(1e5);}
 assert.deepEqual(b.inspect(),a.inspect());assert.deepEqual(r.inspect(),a.inspect());assert.deepEqual(b.records(),a.records());
});
test('completed history stays bounded after 100000 replies while lifetime totals keep growing',()=>{
 const cfg={...config,prefillTokensPerSecond:1e8,decodeTokensPerSecond:1e8,concurrency:8},s=C.createSession(cfg,{history:'recent'});
 let small;
 for(let n=0;n<100;n++){
  s.enqueue(Array.from({length:1000},(_,i)=>row(n*1000+i,n*1000)));s.advanceTo((n+1)*1000);
  if(n===9)small=JSON.stringify(s.save()).length;
 }
 assert.equal(s.inspect().completed,100000);assert.equal(s.inspect().arrived,100000);assert.equal(s.inspect().queued,0);
 assert.ok(s.records().length<1000);assert.ok(JSON.stringify(s.save()).length<small*2);
 assert.deepEqual(resumed(s).inspect(),s.inspect());
 assert.throws(()=>s.finish(),/full finite/);
});
test('more than 10000 waiting requests survive checkpoint without lost KV, FIFO or popularity',()=>{
 const settings={model:'flash',gpu:'H200',replicas:1,cards:8,prefill:4000,decode:100,price:3,reserve:10,concurrency:2,batchGain:25};
 const g=G.create({settings,popularity:1000,profile:{kind:'single',inputTokens:10000,outputTokens:1000},history:'recent'});
 g.advanceTo(660000);const before=g.inspect();assert.equal(before.requestsGenerated,11000);assert.equal(before.popularity,1000);assert.ok(before.queued>10000);
 assert.equal(before.arrived,before.completed+before.queued+before.active.length);
 const r=G.restore(copy(g.save()));assert.deepEqual(r.inspect(),before);
 for(const s of [g,r]){s.setPopularity(0);s.addCopy(settings);s.advanceTo(720000);}
 assert.deepEqual(r.inspect(),g.inspect());assert.deepEqual(r.records(),g.records());assert.ok(g.inspect().completed>before.completed);
});
test('recent mode migrates a legacy journal without restarting active work or future OpenClaw calls',()=>{
 const settings={model:'flash',gpu:'H200',replicas:1,cards:8,prefill:4000,decode:100,price:3,reserve:10,concurrency:2,batchGain:25};
 const old=G.create({settings,popularity:60,profile:{kind:'openclaw'}});old.advanceTo(1234);old.setPopularity(0);
 const fresh=G.restore(copy(old.save()),{history:'recent'});assert.deepEqual(fresh.inspect(),old.inspect());
 assert.equal(fresh.save().schema,'ai-startup-session/2');assert.equal(fresh.save().engine.schema,'sm-gpu-live-recent/1');
 old.advanceTo(80000);fresh.advanceTo(80000);assert.deepEqual(fresh.inspect(),old.inspect());assert.deepEqual(fresh.records(),old.records());
});
test('game days continue beyond the former live time bound and restore at the same clock',()=>{
 const g=U.create();g.install('H200',8);g.useModel('flash');g.open();g.setPopularity(0);g.advanceTo(1e9+12345);
 assert.equal(g.inspect().live.timeMs,1e9+12345);assert.deepEqual(U.restore(copy(g.save())).inspect(),g.inspect());
});
test('checkpoint corruption is rejected before it can fabricate operational work',()=>{
 const s=C.createSession(config,{history:'recent'}).enqueue([row(1),row(2),row(3)]);s.advanceTo(12.5);
 const mutations=[x=>x.state.finished++,x=>x.state.workers[0].active[0].remaining=-1,x=>x.state.workers[0].active[0].stage=9,
  x=>x.state.cursor=1e6,x=>x.state.requests[0].replica=99,x=>x.state.workers[0].config.kvCapacityGB=0,
  x=>x.state.costRate++,x=>x.state.perReplica[0]++,x=>x.state.requests.push(copy(x.state.requests[0]))];
 for(const mutate of mutations){const data=copy(s.save());mutate(data);assert.throws(()=>C.restoreSession(data));}
});

test('multiple game days and more than 100000 calls keep small saves and identical continuation',()=>{
 const settings={model:'flash',gpu:'H200',replicas:1,cards:8,prefill:1e8,decode:1e8,price:3,reserve:10,concurrency:8,batchGain:25};
 const opts={settings,popularity:20,profile:{kind:'single',inputTokens:10000,outputTokens:1000},history:'recent'},g=G.create(opts);
 g.advanceTo(G.DAY);const firstBytes=JSON.stringify(g.save()).length;
 const restored=G.restore(copy(g.save()));
 for(const s of [g,restored])s.advanceTo(2*G.DAY);
 assert.ok(g.inspect().completed>100000);assert.equal(g.inspect().calendar.day,3);assert.equal(g.inspect().popularity,20);
 assert.ok(JSON.stringify(g.save()).length<firstBytes*2);assert.deepEqual(restored.inspect(),g.inspect());assert.deepEqual(restored.records(),g.records());
});
test('compaction preserves actual short/long completion witnesses between observations',()=>{
 const s=C.createSession({...config,prefillTokensPerSecond:1e8,decodeTokensPerSecond:1e8},{history:'recent'});
 s.enqueue([{request_id:'long',arrival_ms:0,input_tokens:120000,output_tokens:8000}]);s.advanceTo(1000);
 for(let n=0;n<3;n++){s.enqueue(Array.from({length:1000},(_,i)=>({request_id:`short-${n}-${i}`,arrival_ms:1000+n*1000,input_tokens:10000,output_tokens:1000})));s.advanceTo(2000+n*1000);}
 const r=resumed(s);assert.ok(r.records().some(x=>x.request_id==='long'&&x.endMs!==null));
 assert.ok(r.records().some(x=>x.input_tokens===10000&&x.endMs!==null));assert.equal(r.inspect().completed,3001);
});

test('a million identical waiting requests use compact exact FIFO runs and fit local saves',()=>{
 const cfg={...config,replicas:1,concurrency:1,prefillTokensPerSecond:.01,decodeTokensPerSecond:.01},s=C.createSession(cfg,{history:'recent'});
 for(let n=0;n<100;n++){s.enqueue(Array.from({length:10000},(_,i)=>({request_id:`user-${n*10000+i+1}-call-1`,arrival_ms:n*10000+i,input_tokens:10000,output_tokens:1000})));s.advanceTo((n+1)*10000);}
 assert.equal(s.inspect().queued,999999);const saved=copy(s.save());assert.equal(saved.state.queue.runs.length,1);
 assert.ok(JSON.stringify(saved).length<10000);const r=C.restoreSession(saved);assert.deepEqual(r.inspect(),s.inspect());
 r.addReplica({...cfg,prefillTokensPerSecond:1e8,decodeTokensPerSecond:1e8});assert.equal(r.inspect().active[1].request_id,'user-2-call-1');
});
test('run packing never changes mixed FIFO arrival order or fractional service outcomes',()=>{
 const cfg={...config,replicas:1,concurrency:1},a=C.createSession(cfg),b=C.createSession(cfg,{history:'recent'});
 const rows=Array.from({length:180},(_,i)=>({request_id:`user-${i+1}-call-1`,arrival_ms:Math.ceil(i*60000/37),input_tokens:i<90?111:777,output_tokens:13}));
 for(const s of [a,b]){s.enqueue(rows);s.advanceTo(4500);s.maintain(1,{...cfg,decodeTokensPerSecond:81});}
 const r=resumed(b);for(const s of [a,b,r])s.advanceTo(1e6);
 assert.deepEqual(b.inspect(),a.inspect());assert.deepEqual(r.records(),a.records());
 const bad=copy(b.save());bad.state.queue={encoding:'fifo-runs/1',runs:[{prefix:'user-',first:1,suffix:'-call-1',id:null,count:2,arrival:0,step:-1,input:111,output:13}]};assert.throws(()=>C.restoreSession(bad));
});
