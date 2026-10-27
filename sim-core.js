// sim-core.js — discrete-event FIFO queue core for SM GPU Calc simulation page.
// Framework-free, DOM-free, deterministic (no randomness). Works in browser
// (window.SimCore) and Node (module.exports).
//
// Model (educational scenario mode, NOT an emulator of continuous batching):
//   - open-loop workload: each request has arrival_ms, input_tokens, output_tokens
//   - N identical replicas, strict FIFO, bounded concurrency and KV admission
//   - solo service work = prefill(input/pps) + decode(output/dps)
//   - request goes to the least-active eligible replica (ties: lowest index)
// KV is reserved for the full context at admission and freed at completion.
// Educational throughput curve, not an emulator or hardware benchmark.
// No prefix caching, interconnect, preemption, chunked prefill or failures.
'use strict';

const MAX_REPLICAS = 64;

function validateWorkload(workload) {
  const errors = [], ids = new Set();
  if (!Array.isArray(workload) || !workload.length || workload.length > 10000) {
    return { ok: false, errors: ['Expected 1–10000 requests'] };
  }
  workload.forEach((r, i) => {
    if (!r || typeof r !== 'object') { errors.push(`Row ${i + 1}: expected object`); return; }
    const id = r.request_id;
    if (typeof id !== 'string' || !id.trim() || ids.has(id)) errors.push(`Row ${i + 1}: invalid or duplicate ID`);
    ids.add(id);
    for (const k of ['arrival_ms', 'input_tokens', 'output_tokens']) {
      const v = r[k];
      if (!Number.isSafeInteger(v) || v < (k === 'output_tokens' ? 1 : 0) || v > 1e9) {
        errors.push(`Row ${i + 1}: invalid ${k}`);
      }
    }
  });
  return { ok: errors.length === 0, errors };
}

// One event engine serves finite runs and live sessions. Observation does not
// split integration steps: frame frequency therefore cannot alter event times.
function normalizeConfig(config) {
  if (!config || typeof config !== 'object') throw Error('Invalid config');
  const c = { replicas:config.replicas, prefillTokensPerSecond:config.prefillTokensPerSecond,
    decodeTokensPerSecond:config.decodeTokensPerSecond, hourlyUSDPerReplica:config.hourlyUSDPerReplica,
    concurrency:config.concurrency === undefined ? 1 : config.concurrency,
    batchGain:config.batchGain === undefined ? 0 : config.batchGain,
    kvBytesPerToken:config.kvBytesPerToken === undefined ? 0 : config.kvBytesPerToken };
  if (config.kvCapacityGB !== undefined) c.kvCapacityGB=config.kvCapacityGB;
  if (!Number.isInteger(c.replicas) || c.replicas<1 || c.replicas>MAX_REPLICAS ||
      ![c.prefillTokensPerSecond,c.decodeTokensPerSecond].every(x=>Number.isFinite(x)&&x>=.01&&x<=1e9) ||
      !Number.isFinite(c.hourlyUSDPerReplica) || c.hourlyUSDPerReplica<0) throw Error('Invalid config');
  if (!Number.isInteger(c.concurrency)||c.concurrency<1||c.concurrency>256 ||
      !Number.isFinite(c.batchGain)||c.batchGain<0||c.batchGain>1 ||
      !Number.isFinite(c.kvBytesPerToken)||c.kvBytesPerToken<0 ||
      (c.kvCapacityGB!==undefined&&(!Number.isFinite(c.kvCapacityGB)||c.kvCapacityGB<0)))
    throw Error('Invalid concurrency or memory config');
  return c;
}
const liveClone = value => JSON.parse(JSON.stringify(value));
const requestOrder = (a,b)=>a.arrival_ms-b.arrival_ms || String(a.request_id).localeCompare(String(b.request_id));
const liveKV = (r,c)=>(r.input_tokens+r.output_tokens)*c.kvBytesPerToken/1e9;
const liveFits = (r,c)=>liveKV(r,c)<=(c.kvCapacityGB===undefined?Infinity:c.kvCapacityGB)+1e-9;

function createSession(config) {
  const initial=normalizeConfig(config), ids=new Set(), actions=[];
  const workers=Array.from({length:initial.replicas},(_,i)=>({id:i+1,config:{...initial},active:[],pendingConfig:null}));
  const pending=[],queue=[],requests=[],perReplica=new Array(initial.replicas).fill(0);
  let anchor=0,cursor=0,finished=0,peakQueued=0,peakActive=0,arrived=0;
  let costEpoch=0,costAccrued=0;
  const rate=()=>workers.every(w=>w.config.hourlyUSDPerReplica===workers[0].config.hourlyUSDPerReplica)
    ?workers.length*workers[0].config.hourlyUSDPerReplica:workers.reduce((sum,w)=>sum+w.config.hourlyUSDPerReplica,0);
  let costRate=rate();
  function costBoundary(){costAccrued+=costRate*((anchor-costEpoch)/3600000);costEpoch=anchor;costRate=rate();}
  function atAnchor(){
    let changed=false;
    for(const w of workers)if(w.pendingConfig&&!w.active.length){w.config=w.pendingConfig;w.pendingConfig=null;changed=true;}
    if(changed)costBoundary();
    while(pending.length&&pending[0].arrival_ms<=anchor){queue.push(pending.shift());arrived++;}
    while(queue.length){
      const r=queue[0];let pick=null;
      for(const w of workers){
        const c=w.config,used=w.active.reduce((sum,j)=>sum+j.record.kvGB,0);
        if(!w.pendingConfig&&w.active.length<c.concurrency&&used+liveKV(r,c)<=(c.kvCapacityGB===undefined?Infinity:c.kvCapacityGB)+1e-9&&
            (!pick||w.active.length<pick.active.length))pick=w;
      }
      if(!pick)break;
      const c=pick.config,record={request_id:r.request_id,replica:pick.id,arrival_ms:r.arrival_ms,
        startMs:anchor,prefillEndMs:r.input_tokens===0?anchor:null,firstTokenMs:null,endMs:null,
        input_tokens:r.input_tokens,output_tokens:r.output_tokens,kvGB:liveKV(r,c)};
      pick.active.push({record,stage:r.input_tokens===0?1:0,
        remaining:r.input_tokens===0?1000/c.decodeTokensPerSecond:(r.input_tokens/c.prefillTokensPerSecond)*1000});
      requests.push(record);perReplica[pick.id-1]++;queue.shift();
    }
    peakQueued=Math.max(peakQueued,queue.length);
    peakActive=Math.max(peakActive,workers.reduce((sum,w)=>sum+w.active.length,0));
  }
  function plan(){
    let dt=pending.length?pending[0].arrival_ms-anchor:Infinity;const steps=[];
    for(const w of workers){
      const n=w.active.length,speed=n?(1+(n-1)*w.config.batchGain)/n:0;
      for(const job of w.active){const until=job.remaining/speed;steps.push({job,speed,until,config:w.config});dt=Math.min(dt,until);}
    }
    return {dt,steps};
  }
  function move(dt,steps,events){
    anchor+=dt;
    for(const {job,speed,until,config:c} of steps){
      if(events&&until<=dt){
        const r=job.record;
        if(job.stage===0){r.prefillEndMs=anchor;job.stage=1;job.remaining=1000/c.decodeTokensPerSecond;}
        else if(job.stage===1){
          r.firstTokenMs=anchor;r.ttftMs=anchor-r.arrival_ms;
          if(r.output_tokens===1){r.endMs=anchor;finished++;}
          else{job.stage=2;job.remaining=(r.output_tokens-1)/c.decodeTokensPerSecond*1000;}
        }else{r.endMs=anchor;finished++;}
      }else job.remaining=Math.max(Number.MIN_VALUE,job.remaining-dt*speed);
    }
    for(const w of workers)w.active=w.active.filter(j=>j.record.endMs===null);
  }
  function run(target){
    for(;;){
      atAnchor();const {dt,steps}=plan();
      if(!Number.isFinite(dt)){
        if(queue.length)throw Error('Scheduler cannot make progress');
        break;
      }
      if(anchor+dt>target)break;
      move(dt,steps,true);
    }
    cursor=target===Infinity?Math.max(cursor,anchor):target;
  }
  function settle(){
    // An action, unlike observation, is a real event boundary.
    if(cursor>anchor){const {steps}=plan();move(cursor-anchor,steps,false);}
  }
  function checkFutureConfigs(candidate){
    if([...queue,...pending].some(r=>!candidate.some(c=>liveFits(r,c))))throw Error('Request exceeds future KV capacity');
  }
  function actionAvailable(){if(actions.length>=30000)throw Error('Live session action limit reached');}
  const api={
    enqueue(workload){
      actionAvailable();
      const v=validateWorkload(workload);if(!v.ok)throw Error('invalid workload: '+v.errors[0]);
      if(ids.size+workload.length>10000)throw Error('Live session request limit (10000) reached');
      for(const r of workload){
        if(ids.has(r.request_id))throw Error('Duplicate request ID');
        if(r.arrival_ms<cursor)throw Error('Arrival is in the past');
        if(!workers.some(w=>liveFits(r,w.pendingConfig||w.config)))throw Error('Request exceeds KV capacity');
      }
      const rows=workload.map(r=>({request_id:r.request_id,arrival_ms:r.arrival_ms,input_tokens:r.input_tokens,output_tokens:r.output_tokens}));
      rows.forEach(r=>ids.add(r.request_id));pending.push(...rows);pending.sort(requestOrder);
      actions.push({atMs:cursor,type:'enqueue',rows:liveClone(rows)});
      run(cursor);return api;
    },
    advanceTo(timeMs){
      if(!Number.isFinite(timeMs)||timeMs<cursor||timeMs>1e9)throw Error('Invalid session time');
      run(timeMs);return api.inspect();
    },
    maintain(replicaId,newConfig){
      actionAvailable();const w=workers.find(w=>w.id===replicaId);if(!w)throw Error('Unknown replica');
      if(w.pendingConfig)throw Error('Replica is already in maintenance');
      const c=normalizeConfig({...newConfig,replicas:1});
      checkFutureConfigs(workers.map(x=>x===w?c:(x.pendingConfig||x.config)));
      settle();w.pendingConfig=c;actions.push({atMs:cursor,type:'maintain',replicaId,config:liveClone(c)});
      atAnchor();return api.inspect();
    },
    addReplica(newConfig=initial){
      actionAvailable();if(workers.length>=MAX_REPLICAS)throw Error('Replica limit reached');
      const c=normalizeConfig({...newConfig,replicas:1});settle();
      workers.push({id:workers.length+1,config:c,active:[],pendingConfig:null});perReplica.push(0);
      costBoundary();actions.push({atMs:cursor,type:'addReplica',config:liveClone(c)});atAnchor();return api.inspect();
    },
    inspect(){
      const active=workers.flatMap(w=>w.active.map(j=>({...j.record,phase:j.stage===0?'prefill':'decode'})));
      const online=workers.filter(w=>!w.pendingConfig);
      const reason=!queue.length?'none':!online.length?'maintenance':online.every(w=>w.active.length>=w.config.concurrency)?'slots':'memory';
      return {timeMs:cursor,arrived,queued:queue.length,pending:pending.length,completed:finished,active,
        peakQueued,peakActive,waitingReason:reason,totalCostUSD:costAccrued+costRate*((cursor-costEpoch)/3600000),
        replicas:workers.map(w=>({id:w.id,maintenance:!!w.pendingConfig,active:w.active.length,
          config:{...w.config},pendingConfig:w.pendingConfig?{...w.pendingConfig}:null,kvUsedGB:w.active.reduce((sum,j)=>sum+j.record.kvGB,0)}))};
    },
    records(){return requests.map(r=>({...r}));},
    save(){return {schema:'sm-gpu-live/1',config:liveClone(initial),timeMs:cursor,actions:liveClone(actions)};},
    finish(){
      run(Infinity);
      const durationMs=requests.length?Math.max(...requests.map(r=>r.endMs)):0;
      const ttfts=requests.map(q=>q.ttftMs).sort((a,b)=>a-b);
      const pct=p=>ttfts.length?(ttfts[Math.max(0,Math.ceil(p*ttfts.length)-1)]||0):0;
      const totalCostUSD=costAccrued+costRate*((cursor-costEpoch)/3600000);
      return {coreVersion:'0.3.0',mode:'educational_shared_capacity',totalCostUSD,completed:finished,queued:queue.length,
        peakQueued,durationMs,ttftP50Ms:pct(.5),ttftP95Ms:pct(.95),costPerRequestUSD:requests.length?totalCostUSD/requests.length:0,
        perReplica:[...perReplica],peakActive,requests:api.records()};
    }
  };
  return api;
}

function restoreSession(saved){
  if(!saved||saved.schema!=='sm-gpu-live/1'||!Array.isArray(saved.actions)||saved.actions.length>30000||
      !Number.isFinite(saved.timeMs)||saved.timeMs<0||saved.timeMs>1e9)throw Error('Invalid live save');
  const session=createSession(saved.config);let time=0;
  for(const action of saved.actions){
    if(!action||!Number.isFinite(action.atMs)||action.atMs<time||action.atMs>saved.timeMs)throw Error('Invalid live action time');
    session.advanceTo(action.atMs);time=action.atMs;
    if(action.type==='enqueue')session.enqueue(action.rows);
    else if(action.type==='maintain')session.maintain(action.replicaId,action.config);
    else if(action.type==='addReplica')session.addReplica(action.config);
    else throw Error('Unknown live action');
  }
  session.advanceTo(saved.timeMs);return session;
}

function simulate(workload,config){
  const v=validateWorkload(workload);if(!v.ok)throw Error('invalid workload: '+v.errors[0]);
  return createSession(config).enqueue(workload).finish();
}

// Half-open intervals: arrival <= t < start (queue), start <= t < end (busy).
// Rendering reads the completed schedule; playback never changes the simulation.
function snapshot(result, timeMs) {
  const time = Math.max(0, Math.min(result.durationMs, timeMs));
  const state = { timeMs: time, arrived: 0, queued: 0, completed: 0, active: [] };
  for (const r of result.requests) {
    if (r.arrival_ms > time) continue;
    state.arrived++;
    if (r.endMs <= time) state.completed++;
    else if (r.startMs > time) state.queued++;
    else state.active.push({ ...r, phase: time < r.prefillEndMs ? 'prefill' : 'decode' });
  }
  return state;
}

const SimCore = { MAX_REPLICAS, validateWorkload, simulate, snapshot, createSession, restoreSession };
if (typeof module !== 'undefined' && module.exports) module.exports = SimCore;
if (typeof window !== 'undefined') window.SimCore = SimCore;
