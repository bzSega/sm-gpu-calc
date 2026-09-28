// sim-core.js — discrete-event FIFO queue core for SM GPU Calc simulation page.
// Framework-free, DOM-free, deterministic (no randomness). Works in browser
// (window.SimCore) and Node (module.exports).
//
// Model (educational scenario mode, NOT an emulator of continuous batching):
//   - open-loop workload: each request has arrival_ms, input_tokens, output_tokens
//   - N identical replicas, strict FIFO, bounded concurrency and KV admission
//   - solo service work = prefill(input/pps) + decode(output/dps)
//   - request is assigned to the replica that becomes free first (ties: lowest index)
// KV is reserved for the full context at admission and freed at completion.
// Educational throughput curve, not an emulator or hardware benchmark.
// No prefix caching, interconnect, preemption, chunked prefill or failures.
'use strict';

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

function simulate(workload, config) {
  const v = validateWorkload(workload);
  if (!v.ok) throw new Error('invalid workload: ' + v.errors[0]);
  const { replicas, prefillTokensPerSecond, decodeTokensPerSecond, hourlyUSDPerReplica } = config;
  if (!Number.isInteger(replicas) || replicas < 1 || replicas > 8 ||
      ![prefillTokensPerSecond, decodeTokensPerSecond].every(x => Number.isFinite(x) && x >= 0.01 && x <= 1e9) ||
      !Number.isFinite(hourlyUSDPerReplica) || hourlyUSDPerReplica < 0) {
    throw new Error('Invalid config');
  }

  const prefillSec = r => r.input_tokens / prefillTokensPerSecond;

  // Fluid sharing model. G(n)=1+(n-1)*gain is total throughput relative
  // to one request; every active request receives G(n)/n of its solo speed.
  // Prefill and decode share this same normalized budget, including mixed phases.
  const concurrency = config.concurrency === undefined ? 1 : config.concurrency;
  const gain = config.batchGain === undefined ? 0 : config.batchGain;
  const kvBytesPerToken = config.kvBytesPerToken === undefined ? 0 : config.kvBytesPerToken;
  const kvCapacityGB = config.kvCapacityGB === undefined ? Infinity : config.kvCapacityGB;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 256 ||
      !Number.isFinite(gain) || gain < 0 || gain > 1 ||
      !Number.isFinite(kvBytesPerToken) || kvBytesPerToken < 0 ||
      (config.kvCapacityGB !== undefined && (!Number.isFinite(kvCapacityGB) || kvCapacityGB < 0))) {
    throw Error('Invalid concurrency or memory config');
  }
  const sorted = [...workload].sort((a,b) => a.arrival_ms-b.arrival_ms || String(a.request_id).localeCompare(String(b.request_id)));
  const memoryToleranceGB=1e-9; // One byte: absorb floating-point roundoff only.
  const kvSize = r => (r.input_tokens+r.output_tokens)*kvBytesPerToken/1e9;
  if (sorted.some(r => kvSize(r)>kvCapacityGB+memoryToleranceGB)) throw Error('Request exceeds KV capacity');
  const workers = Array.from({length:replicas},()=>[]);
  const perReplica = new Array(replicas).fill(0), queueEvents = [], requests = [];
  let now = 0, arrived = 0, head = 0, finished = 0, peakActive = 0;
  while (finished < sorted.length) {
    while (arrived < sorted.length && sorted[arrived].arrival_ms <= now) arrived++;
    // Strict global FIFO: never skip a large head request for a smaller one.
    while (head < arrived) {
      const r = sorted[head], kv = kvSize(r);
      let pick = -1;
      for (let i=0;i<replicas;i++) {
        const active=workers[i], used=active.reduce((sum,j)=>sum+j.record.kvGB,0);
        if (active.length<concurrency && used+kv<=kvCapacityGB+memoryToleranceGB &&
            (pick<0 || active.length<workers[pick].length)) pick=i;
      }
      if (pick<0) break;
      const record={request_id:r.request_id,replica:pick+1,arrival_ms:r.arrival_ms,
        startMs:now,prefillEndMs:r.input_tokens===0?now:null,firstTokenMs:null,endMs:null,
        input_tokens:r.input_tokens,output_tokens:r.output_tokens,kvGB:kv};
      workers[pick].push({record,stage:r.input_tokens===0?1:0,
        remaining:r.input_tokens===0?1000/decodeTokensPerSecond:prefillSec(r)*1000});
      requests.push(record);perReplica[pick]++;head++;
      if(now>r.arrival_ms)queueEvents.push([r.arrival_ms,1],[now,-1]);
    }
    peakActive=Math.max(peakActive,workers.reduce((sum,w)=>sum+w.length,0));
    let dt=arrived<sorted.length?sorted[arrived].arrival_ms-now:Infinity;
    const steps=[];
    for(const active of workers){
      const speed=active.length?(1+(active.length-1)*gain)/active.length:0;
      for(const job of active){const until=job.remaining/speed;steps.push({job,speed,until});dt=Math.min(dt,until)}
    }
    if(!Number.isFinite(dt))throw Error('Scheduler cannot make progress');
    now+=dt;
    for(const {job,speed,until} of steps){
      if(until<=dt){
        const r=job.record;
        if(job.stage===0){r.prefillEndMs=now;job.stage=1;job.remaining=1000/decodeTokensPerSecond}
        else if(job.stage===1){
          r.firstTokenMs=now;r.ttftMs=now-r.arrival_ms;
          if(r.output_tokens===1){r.endMs=now;finished++}
          else{job.stage=2;job.remaining=(r.output_tokens-1)/decodeTokensPerSecond*1000}
        }else{r.endMs=now;finished++}
      }else job.remaining=Math.max(Number.MIN_VALUE,job.remaining-dt*speed);
    }
    for(let i=0;i<replicas;i++)workers[i]=workers[i].filter(j=>j.record.endMs===null);
  }

  let waiting = 0, peakQueued = 0;
  queueEvents.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .forEach(([, d]) => { waiting += d; peakQueued = Math.max(peakQueued, waiting); });
  const durationMs = Math.max(...requests.map(r=>r.endMs));
  const ttfts = requests.map(q => q.ttftMs).sort((a, b) => a - b);
  const pct = p => ttfts.length ? (ttfts[Math.max(0, Math.ceil(p * ttfts.length) - 1)] || 0) : 0;
  const totalCostUSD = replicas * hourlyUSDPerReplica * (durationMs / 3600000);

  return {
    coreVersion: '0.3.0',
    mode: 'educational_shared_capacity',
    totalCostUSD,
    completed: requests.length,
    queued: 0,                 // run is drained: queue is empty at the end
    peakQueued,
    durationMs,
    ttftP50Ms: pct(0.50),
    ttftP95Ms: pct(0.95),
    costPerRequestUSD: requests.length ? totalCostUSD / requests.length : 0,
    perReplica,
    peakActive,
    requests,
  };
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

const SimCore = { validateWorkload, simulate, snapshot };
if (typeof module !== 'undefined' && module.exports) module.exports = SimCore;
if (typeof window !== 'undefined') window.SimCore = SimCore;
