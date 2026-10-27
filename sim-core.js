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

function validateWorkload(workload, maxArrivalMs=1e9) {
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
      if (!Number.isSafeInteger(v) || v < (k === 'output_tokens' ? 1 : 0) || v > (k==='arrival_ms'?maxArrivalMs:1e9)) {
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

// Lossless FIFO runs: consecutive numeric IDs, equal token counts and an exact
// integer arrival progression. Nonmatching rows remain independent runs.
class LiveRequestQueue {
  constructor(){this.runs=[];this.head=0;this.length=0;}
  static parts(id){const m=/^(.*?)([0-9]+)([^0-9].*)?$/.exec(id);return m&&String(Number(m[2]))===m[2]&&Number.isSafeInteger(Number(m[2]))?[m[1],Number(m[2]),m[3]||'']:null;}
  static row(r,index=0){return {request_id:r.prefix===null?r.id:r.prefix+String(r.first+index)+r.suffix,arrival_ms:r.arrival+index*(r.step||0),input_tokens:r.input,output_tokens:r.output};}
  push(row){
    const parts=LiveRequestQueue.parts(row.request_id),r=this.runs.at(-1);
    if(parts&&r&&r.prefix===parts[0]&&r.suffix===parts[2]&&r.first+r.count===parts[1]&&r.input===row.input_tokens&&r.output===row.output_tokens&&
      (r.count===1||row.arrival_ms===r.arrival+r.count*r.step)){
      if(r.count===1)r.step=row.arrival_ms-r.arrival;r.count++;
    }else this.runs.push({prefix:parts?parts[0]:null,first:parts?parts[1]:0,suffix:parts?parts[2]:'',id:parts?null:row.request_id,count:1,arrival:row.arrival_ms,step:null,input:row.input_tokens,output:row.output_tokens});
    this.length++;
  }
  peek(){return this.length?LiveRequestQueue.row(this.runs[this.head]):undefined;}
  shift(){
    const row=this.peek();if(!row)return;
    const r=this.runs[this.head];this.length--;
    if(--r.count){r.first++;r.arrival+=r.step;}else this.head++;
    if(this.head>256&&this.head*2>this.runs.length){this.runs=this.runs.slice(this.head);this.head=0;}
    return row;
  }
  hasID(id){const parts=LiveRequestQueue.parts(id);return this.runs.slice(this.head).some(r=>parts&&r.prefix===parts[0]&&r.suffix===parts[2]?parts[1]>=r.first&&parts[1]<r.first+r.count:r.prefix===null&&r.id===id);}
  samples(){return this.runs.slice(this.head).flatMap(r=>r.count===1?[LiveRequestQueue.row(r)]:[LiveRequestQueue.row(r),LiveRequestQueue.row(r,r.count-1)]);}
  *[Symbol.iterator](){for(let i=this.head;i<this.runs.length;i++)for(let n=0;n<this.runs[i].count;n++)yield LiveRequestQueue.row(this.runs[i],n);}
  toJSON(){return {encoding:'fifo-runs/1',runs:this.runs.slice(this.head)};}
}

function createSession(config, options={}) {
  const recent=options.history==='recent';
  if(options.history!==undefined&&!recent)throw Error('Unknown history mode');
  const witnesses=new Map();let retainedCompleted=0;
  const initial=normalizeConfig(config), ids=new Set(), actions=[];
  const workers=Array.from({length:initial.replicas},(_,i)=>({id:i+1,config:{...initial},active:[],pendingConfig:null}));
  const pending=[],queue=recent?new LiveRequestQueue():[],requests=[],perReplica=new Array(initial.replicas).fill(0);
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
    while(pending.length&&pending[0].arrival_ms<=anchor){const row=pending.shift();queue.push(row);if(recent)ids.delete(row.request_id);arrived++;}
    while(queue.length){
      const r=recent?queue.peek():queue[0];let pick=null;
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
      requests.push(record);if(recent)ids.add(record.request_id);perReplica[pick.id-1]++;queue.shift();
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
    for(const w of workers){
      if(recent)for(const j of w.active)if(j.record.endMs!==null){
        retainedCompleted++;const r=j.record,key=`${r.replica}:${r.input_tokens}:${r.output_tokens}`,old=witnesses.get(key);
        if(!old||r.endMs>old.endMs)witnesses.set(key,r);
        while(witnesses.size>256)witnesses.delete(witnesses.keys().next().value);
      }
      w.active=w.active.filter(j=>j.record.endMs===null);
    }
  }
  function retainRecent(){
    if(!recent||retainedCompleted<=512)return;
    const completed=requests.filter(r=>r.endMs!==null),keep=new Set(completed.sort((a,b)=>b.endMs-a.endMs).slice(0,256));
    for(let i=requests.length-1;i>=0;i--)if(requests[i].endMs!==null&&!keep.has(requests[i])){ids.delete(requests[i].request_id);requests.splice(i,1);}
    retainedCompleted=256;
  }
  function recordAction(action){if(!recent)actions.push(action);}
  function run(target){
    for(;;){
      atAnchor();const {dt,steps}=plan();
      if(!Number.isFinite(dt)){
        if(queue.length)throw Error('Scheduler cannot make progress');
        break;
      }
      if(anchor+dt>target)break;
      move(dt,steps,true);retainRecent();
    }
    cursor=target===Infinity?Math.max(cursor,anchor):target;
  }
  function settle(){
    // An action, unlike observation, is a real event boundary.
    if(cursor>anchor){const {steps}=plan();move(cursor-anchor,steps,false);}
  }
  function checkFutureConfigs(candidate){
    if([...(recent?queue.samples():queue),...pending].some(r=>!candidate.some(c=>liveFits(r,c))))throw Error('Request exceeds future KV capacity');
  }
  function actionAvailable(){if(!recent&&actions.length>=30000)throw Error('Live session action limit reached');}
  const api={
    enqueue(workload){
      actionAvailable();
      const v=validateWorkload(workload,recent?Number.MAX_SAFE_INTEGER:1e9);if(!v.ok)throw Error('invalid workload: '+v.errors[0]);
      if(!recent&&ids.size+workload.length>10000)throw Error('Live session request limit (10000) reached');
      for(const r of workload){
        if(ids.has(r.request_id)||recent&&queue.hasID(r.request_id))throw Error('Duplicate request ID');
        if(r.arrival_ms<cursor)throw Error('Arrival is in the past');
        if(!workers.some(w=>liveFits(r,w.pendingConfig||w.config)))throw Error('Request exceeds KV capacity');
      }
      const rows=workload.map(r=>({request_id:r.request_id,arrival_ms:r.arrival_ms,input_tokens:r.input_tokens,output_tokens:r.output_tokens}));
      rows.forEach(r=>ids.add(r.request_id));pending.push(...rows);pending.sort(requestOrder);
      recordAction({atMs:cursor,type:'enqueue',rows:liveClone(rows)});
      run(cursor);return api;
    },
    advanceTo(timeMs){
      if(!Number.isFinite(timeMs)||timeMs<cursor||timeMs>(recent?Number.MAX_SAFE_INTEGER:1e9))throw Error('Invalid session time');
      run(timeMs);return api.inspect();
    },
    maintain(replicaId,newConfig){
      actionAvailable();const w=workers.find(w=>w.id===replicaId);if(!w)throw Error('Unknown replica');
      if(w.pendingConfig)throw Error('Replica is already in maintenance');
      const c=normalizeConfig({...newConfig,replicas:1});
      checkFutureConfigs(workers.map(x=>x===w?c:(x.pendingConfig||x.config)));
      settle();w.pendingConfig=c;recordAction({atMs:cursor,type:'maintain',replicaId,config:liveClone(c)});
      atAnchor();return api.inspect();
    },
    addReplica(newConfig=initial){
      actionAvailable();if(workers.length>=MAX_REPLICAS)throw Error('Replica limit reached');
      const c=normalizeConfig({...newConfig,replicas:1});settle();
      workers.push({id:workers.length+1,config:c,active:[],pendingConfig:null});perReplica.push(0);
      costBoundary();recordAction({atMs:cursor,type:'addReplica',config:liveClone(c)});atAnchor();return api.inspect();
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
    records(){const rows=recent?[...new Map([...requests,...witnesses.values()].map(r=>[r.request_id,r])).values()]:requests;return rows.map(r=>({...r}));},
    unfinished(){return liveClone([...queue,...pending,...workers.flatMap(w=>w.active.map(j=>j.record))]);},
    outstandingSamples(){return liveClone([...(recent?queue.samples():queue),...pending,...workers.flatMap(w=>w.active.map(j=>j.record))]);},
    save(){return recent?{schema:'sm-gpu-live-recent/1',config:liveClone(initial),state:liveClone({anchor,cursor,finished,peakQueued,peakActive,arrived,costEpoch,costAccrued,costRate,workers,pending,queue,requests,perReplica,witnesses:[...witnesses.values()]})}:{schema:'sm-gpu-live/1',config:liveClone(initial),timeMs:cursor,actions:liveClone(actions)};},
    finish(){
      if(recent)throw Error('Recent-history sessions do not provide full finite results');
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
  if(options.checkpoint){
    if(!recent)throw Error('Checkpoint requires recent history');
    const x=validateRecentCheckpoint(options.checkpoint,initial);
    ({anchor,cursor,finished,peakQueued,peakActive,arrived,costEpoch,costAccrued,costRate}=x);
    for(const r of x.pending)pending.push(r);queue.runs=x.queue.runs;queue.head=0;queue.length=x.queue.length;for(const r of x.requests)requests.push(r);retainedCompleted=requests.filter(r=>r.endMs!==null).length;
    perReplica.splice(0,perReplica.length,...x.perReplica);
    const records=new Map(requests.map(r=>[r.request_id,r]));
    workers.splice(0,workers.length,...x.workers.map(w=>({...w,active:w.active.map(j=>({...j,record:records.get(j.record.request_id)}))})));
    for(const r of [...pending,...requests])ids.add(r.request_id);
    for(const r of x.witnesses)witnesses.set(`${r.replica}:${r.input_tokens}:${r.output_tokens}`,r);
  }
  return api;
}

// Checkpoints validate operational state, not replay already archived history.
// Aggregate historical counters are saved game data, never benchmark evidence.
function validateRecentCheckpoint(value,initial){
  const fail=()=>{throw Error('Invalid recent-history checkpoint');};
  if(!value||typeof value!=='object')fail();
  const x=liveClone(value),number=(v,min=0,max=1e9)=>Number.isFinite(v)&&v>=min&&v<=max,
    count=v=>Number.isSafeInteger(v)&&v>=0;
  for(const key of ['anchor','cursor','costEpoch'])if(!number(x[key],0,Number.MAX_SAFE_INTEGER))fail();
  if(x.anchor>x.cursor||x.costEpoch>x.anchor||!number(x.costAccrued,0,Number.MAX_VALUE)||!number(x.costRate,0,Number.MAX_VALUE))fail();
  for(const key of ['finished','peakQueued','peakActive','arrived'])if(!count(x[key]))fail();
  if(!Array.isArray(x.workers)||x.workers.length<initial.replicas||x.workers.length>MAX_REPLICAS||
    !Array.isArray(x.perReplica)||x.perReplica.length!==x.workers.length||x.perReplica.some(n=>!count(n)))fail();
  for(const key of ['pending','requests','witnesses'])if(!Array.isArray(x[key])||x[key].length>(key==='witnesses'?256:1000000))fail();
  const row=r=>r&&typeof r.request_id==='string'&&r.request_id.trim()&&Number.isSafeInteger(r.arrival_ms)&&number(r.arrival_ms,0,Number.MAX_SAFE_INTEGER)&&
    Number.isSafeInteger(r.input_tokens)&&number(r.input_tokens)&&Number.isSafeInteger(r.output_tokens)&&number(r.output_tokens,1);
  const record=r=>{
    if(!row(r)||!Number.isInteger(r.replica)||r.replica<1||r.replica>x.workers.length||!number(r.startMs,r.arrival_ms,x.anchor)||!number(r.kvGB,0,Number.MAX_VALUE))return false;
    if(r.prefillEndMs!==null&&!number(r.prefillEndMs,r.startMs,x.anchor))return false;
    if(r.firstTokenMs!==null&&(r.prefillEndMs===null||!number(r.firstTokenMs,r.prefillEndMs,x.anchor)||r.ttftMs!==r.firstTokenMs-r.arrival_ms))return false;
    if(r.endMs!==null&&(r.firstTokenMs===null||!number(r.endMs,r.firstTokenMs,x.anchor)))return false;
    if(r.input_tokens===0&&r.prefillEndMs!==r.startMs)return false;
    return true;
  };
  const packed=x.queue;
  if(packed?.encoding!=='fifo-runs/1'||!Array.isArray(packed.runs)||packed.runs.length>1000000)fail();
  const fifo=new LiveRequestQueue(),intervals=new Map(),plain=new Set();
  for(const r of packed.runs){
    if(!r||!Number.isSafeInteger(r.count)||r.count<1||!number(r.arrival,0,x.anchor)||!Number.isSafeInteger(r.arrival)||
      (r.count===1?r.step!==null&&!Number.isSafeInteger(r.step):!Number.isSafeInteger(r.step)||r.step<0))fail();
    if(r.prefix===null){if(r.count!==1||typeof r.id!=='string'||LiveRequestQueue.parts(r.id)||plain.has(r.id))fail();plain.add(r.id);}
    else{
      if(typeof r.prefix!=='string'||typeof r.suffix!=='string'||!Number.isSafeInteger(r.first)||r.first<0||!Number.isSafeInteger(r.first+r.count-1)||r.id!==null)fail();
      const first=LiveRequestQueue.row(r),parts=LiveRequestQueue.parts(first.request_id);
      if(!parts||parts[0]!==r.prefix||parts[1]!==r.first||parts[2]!==r.suffix)fail();
      const key=JSON.stringify([r.prefix,r.suffix]);if(!intervals.has(key))intervals.set(key,[]);intervals.get(key).push([r.first,r.first+r.count-1]);
    }
    for(const sample of [LiveRequestQueue.row(r),LiveRequestQueue.row(r,r.count-1)])if(!row(sample)||sample.arrival_ms>x.anchor)fail();
    fifo.runs.push(r);fifo.length+=r.count;if(!Number.isSafeInteger(fifo.length))fail();
  }
  for(const list of intervals.values()){list.sort((a,b)=>a[0]-b[0]);for(let i=1;i<list.length;i++)if(list[i][0]<=list[i-1][1])fail();}
  x.queue=fifo;
  const seen=new Set();
  for(const key of ['pending','requests'])for(const r of x[key]){
    if(!(key==='requests'?record(r):row(r))||seen.has(r.request_id)||fifo.hasID(r.request_id))fail();seen.add(r.request_id);
    if(key==='queue'&&r.arrival_ms>x.anchor||key==='pending'&&r.arrival_ms<=x.cursor)fail();
  }
  for(let i=1;i<x.pending.length;i++)if(requestOrder(x.pending[i-1],x.pending[i])>0)fail();
  const records=new Map(x.requests.map(r=>[r.request_id,r])),active=new Set();
  for(const [i,w] of x.workers.entries()){
    if(!w||w.id!==i+1||!Array.isArray(w.active))fail();
    w.config=normalizeConfig(w.config);if(w.pendingConfig!==null)w.pendingConfig=normalizeConfig(w.pendingConfig);
    if(w.active.length>w.config.concurrency||w.pendingConfig&&!w.active.length)fail();
    const speed=w.active.length?(1+(w.active.length-1)*w.config.batchGain)/w.active.length:0;
    for(const j of w.active){
      const r=records.get(j?.record?.request_id);
      if(!r||['request_id','replica','arrival_ms','startMs','prefillEndMs','firstTokenMs','endMs','input_tokens','output_tokens','kvGB','ttftMs'].some(k=>r[k]!==j.record[k])||r.replica!==w.id||r.endMs!==null||active.has(r.request_id)||
        !Number.isInteger(j.stage)||j.stage<0||j.stage>2||!number(j.remaining,Number.MIN_VALUE,Number.MAX_VALUE)||
        r.kvGB!==liveKV(r,w.config))fail();
      if(j.stage===0&&(r.prefillEndMs!==null||r.firstTokenMs!==null)||j.stage===1&&(r.prefillEndMs===null||r.firstTokenMs!==null)||
        j.stage===2&&(r.firstTokenMs===null||r.output_tokens===1))fail();
      const maximum=j.stage===0?r.input_tokens/w.config.prefillTokensPerSecond*1000:j.stage===1?1000/w.config.decodeTokensPerSecond:(r.output_tokens-1)/w.config.decodeTokensPerSecond*1000;
      if(j.remaining>maximum+1e-7||x.anchor+j.remaining/speed<x.cursor-1e-7)fail();active.add(r.request_id);
    }
    if(w.active.reduce((sum,j)=>sum+j.record.kvGB,0)>(w.config.kvCapacityGB??Infinity)+1e-9||x.perReplica[i]<w.active.length)fail();
  }
  if(x.requests.some(r=>r.endMs===null&&!active.has(r.request_id))||x.requests.filter(r=>r.endMs!==null).length>x.finished||
    x.arrived!==x.finished+x.queue.length+active.size||x.perReplica.reduce((a,b)=>a+b,0)!==x.finished+active.size||
    x.peakQueued<x.queue.length||x.peakQueued>x.arrived||x.peakActive<active.size||x.peakActive>x.arrived)fail();
  const rates=x.workers.map(w=>w.config.hourlyUSDPerReplica),expectedRate=rates.every(r=>r===rates[0])?rates.length*rates[0]:rates.reduce((a,b)=>a+b,0);
  if(x.costRate!==expectedRate)fail();
  if([...x.queue.samples(),...x.pending].some(r=>!x.workers.some(w=>liveFits(r,w.pendingConfig||w.config))))fail();
  const witnessKeys=new Set();
  for(const r of x.witnesses){const key=`${r.replica}:${r.input_tokens}:${r.output_tokens}`;if(!record(r)||r.endMs===null||witnessKeys.has(key))fail();witnessKeys.add(key);}
  return x;
}

function restoreSession(saved, options={}){
  if(saved?.schema==='sm-gpu-live-recent/1')return createSession(saved.config,{history:'recent',checkpoint:saved.state});
  if(!saved||saved.schema!=='sm-gpu-live/1'||!Array.isArray(saved.actions)||saved.actions.length>30000||
      !Number.isFinite(saved.timeMs)||saved.timeMs<0||saved.timeMs>1e9)throw Error('Invalid live save');
  const session=createSession(saved.config,options);let time=0;
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
