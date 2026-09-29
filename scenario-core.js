// Shared scenario contract for the browser UI and Node tests. No DOM or network.
'use strict';
const ScenarioCore = (() => {
  const core = typeof module !== 'undefined' && module.exports ? require('./sim-core.js') : window.SimCore;
  // Educational assumptions inherited from the original calculators, not benchmarks.
  const models = {
    glm53: { name: 'GLM-5.3', weightsGB: 750, layers: 90, kvHeads: 8, headDim: 128, context: 200000, prefill: 2000, decode: 60 },
    flash: { name: 'GLM-5.3-Flash', weightsGB: 320, layers: 60, kvHeads: 8, headDim: 128, context: 128000, prefill: 4000, decode: 100 },
    qwenflash: { name: 'Qwen3.8-Flash-Next', weightsGB: 125, layers: 48, kvHeads: 8, headDim: 128, context: 256000, prefill: 4000, decode: 100 }
  };
  const gpus = { H200: { memoryGB: 141, price: 3, speed: 1 }, B200: { memoryGB: 192, price: 5, speed: 1.4 } };
  // Live OpenClaw trip run: requests-live.csv, six calls per user.
  // Provider totals: 28,200 input / 2,400 output; per-call allocation is reconstructed.
  // Fixed arrival replay, NOT dependency-driven execution; user count and arrival rate are configurable.
  const TRIP_STEP = [ // [arrival_ms, input_tokens, output_tokens, depends_on]
    [0, 1500, 100, ''], [12171, 3500, 100, 's1'], [20492, 6000, 100, 's1'],
    [28554, 5500, 300, 's2;s3'], [62352, 6000, 1000, 's4'], [64170, 5700, 800, 's5']
  ];
  const demoDefaults = {users:3, usersPerSecond:0.2};
  function validateDemoSettings(s) {
    return !!s && Number.isInteger(s.users) && s.users >= 1 && s.users <= 1666 &&
      Number.isFinite(s.usersPerSecond) && s.usersPerSecond >= 0.01 && s.usersPerSecond <= 1000;
  }
  function demo(options = demoDefaults) {
    if (!validateDemoSettings(options)) throw Error('demoSettings');
    return Array.from({length:options.users}, (_,u) => {
      const offset = Math.round(u * 1000 / options.usersPerSecond);
      return TRIP_STEP.map(([a, i, o, deps], k) => ({
        request_id: `trip-u${u + 1}-s${k + 1}`, arrival_ms: offset + a, input_tokens: i, output_tokens: o,
        token_count_source: 'live_run_reconstructed', model_profile_id: 'glm53-flash', job_id: `trip-u${u + 1}`,
        depends_on: deps ? deps.split(';').map(id => `trip-u${u + 1}-${id}`).join(';') : ''
      }));
    }).flat();
  }
  // Maximum arrivals in any half-open 1-second window, including simultaneous calls.
  // This is a finite-trace peak, not an average and not a hardware utilization metric.
  function arrivalStats(workload) {
    if (!core.validateWorkload(workload).ok) throw Error('workload');
    const arrivals = workload.map(r=>r.arrival_ms).sort((a,b)=>a-b);
    let left=0, peakRps=0;
    for(let right=0;right<arrivals.length;right++) {
      while(arrivals[right]-arrivals[left]>=1000)left++;
      peakRps=Math.max(peakRps,right-left+1);
    }
    return {peakRps};
  }
  function parseCSV(text) {
    const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(l => l.trim());
    const headers = lines.shift().split(',').map(v => v.trim());
    const required = ['request_id', 'arrival_ms', 'input_tokens', 'output_tokens'];
    if (new Set(headers).size !== headers.length || !required.every(k => headers.includes(k))) throw Error('header');
    const workload = lines.map(line => {
      const cells = line.split(',').map(v => v.trim());
      if (cells.length !== headers.length || cells.some(v => v.includes('"'))) throw Error('row');
      const row = Object.fromEntries(headers.map((h,i) => [h,cells[i]]));
      for (const key of required.slice(1)) {
        if (!/^\d+$/.test(row[key])) throw Error('number');
        row[key] = Number(row[key]);
      }
      return row;
    });
    if (!core.validateWorkload(workload).ok) throw Error('workload');
    return workload;
  }
  const normalizeSettings = s => ({...s,concurrency:s.concurrency===undefined?1:s.concurrency,batchGain:s.batchGain===undefined?0:s.batchGain});
  function validateSettings(s) {
    return !!s && Object.hasOwn(models,s.model) && Object.hasOwn(gpus,s.gpu) &&
      Number.isInteger(s.replicas) && s.replicas>=1 && s.replicas<=8 &&
      Number.isInteger(s.cards) && s.cards>=1 && s.cards<=16 &&
      ['prefill','decode'].every(k => Number.isFinite(s[k]) && s[k]>=0.01 && s[k]<=1e9) &&
      Number.isFinite(s.price) && s.price>=0 && s.price<=1e6 &&
      Number.isFinite(s.reserve) && s.reserve>=0 && s.reserve<=50 &&
      Number.isInteger(normalizeSettings(s).concurrency) && normalizeSettings(s).concurrency>=1 && normalizeSettings(s).concurrency<=256 &&
      Number.isFinite(normalizeSettings(s).batchGain) && normalizeSettings(s).batchGain>=0 && normalizeSettings(s).batchGain<=100;
  }
  function memory(workload, s) {
    if (!validateSettings(s) || !core.validateWorkload(workload).ok) throw Error('invalid');
    const m=models[s.model], total=s.cards*gpus[s.gpu].memoryGB;
    const kvBytesPerToken=2*m.layers*m.kvHeads*m.headDim*2;
    const context=Math.max(...workload.map(r=>r.input_tokens+r.output_tokens));
    const kvGB=context*kvBytesPerToken/1e9, reservedGB=total*s.reserve/100;
    const freeGB=total-m.weightsGB-reservedGB-kvGB;
    const kvCapacityGB=Math.max(0,total-m.weightsGB-reservedGB),memorySlots=Math.max(0,Math.floor((kvCapacityGB+1e-9)/kvGB));
    const effectiveSlots=Math.min(normalizeSettings(s).concurrency,memorySlots);
    return {kvCapacityGB,memorySlots,effectiveSlots,total,weightsGB:m.weightsGB,kvGB,kvBytesPerToken,reservedGB,freeGB,context,contextLimit:m.context,fits:freeGB>=-1e-9 && context<=m.context};
  }
  function config(s) {
    if (!validateSettings(s)) throw Error('settings');
    return {replicas:s.replicas,prefillTokensPerSecond:s.prefill,decodeTokensPerSecond:s.decode,hourlyUSDPerReplica:s.cards*s.price,concurrency:normalizeSettings(s).concurrency,batchGain:normalizeSettings(s).batchGain/100,kvBytesPerToken:2*models[s.model].layers*models[s.model].kvHeads*models[s.model].headDim*2,kvCapacityGB:Math.max(0,s.cards*gpus[s.gpu].memoryGB-models[s.model].weightsGB-s.cards*gpus[s.gpu].memoryGB*s.reserve/100)};
  }
  function capacity(workload, s) {
    const mem=memory(workload,s),n=mem.effectiveSlots;
    const gain=n?1+(n-1)*normalizeSettings(s).batchGain/100:0;
    const soloSeconds=workload.reduce((sum,r)=>sum+r.input_tokens/s.prefill+r.output_tokens/s.decode,0)/workload.length;
    const replicaRps=mem.fits?gain/soloSeconds:0;
    return {replicaRps,poolRps:replicaRps*s.replicas,gain,slots:n};
  }
  function makeScenario(workload, settings, workloadSource) {
    if (!validateSettings(settings) || !core.validateWorkload(workload).ok) throw Error('scenario');
    const result={schema_version:'sm-gpu-calc/2',core_version:'0.3.0',profile_version:'educational-2026-09-28',workload,settings:normalizeSettings(settings)};
    if(workloadSource!==undefined) {
      if(workloadSource?.type!=='openclaw-live/1' || !validateDemoSettings(workloadSource))throw Error('workloadSource');
      const generated=demo(workloadSource),byId=new Map(workload.map(r=>[r.request_id,r]));
      if(generated.length!==workload.length || generated.some(r=>Object.keys(r).some(k=>r[k]!==byId.get(r.request_id)?.[k])))throw Error('workloadSource');
      result.workload_source={type:'openclaw-live/1',users:workloadSource.users,usersPerSecond:workloadSource.usersPerSecond};
    }
    return result;
  }
  function readScenario(text) {
    const s=JSON.parse(text);
    const legacy=s.schema_version==='sm-gpu-calc/1' && s.core_version==='0.2.0';
    if ((!legacy && !(s.schema_version==='sm-gpu-calc/2' && s.core_version==='0.3.0')) || s.profile_version!=='educational-2026-09-28') throw Error('version');
    if(legacy)s.settings={...s.settings,concurrency:1,batchGain:0};
    else if(s.settings?.concurrency===undefined || s.settings?.batchGain===undefined)throw Error('settings');
    return makeScenario(s.workload,s.settings,s.workload_source);
  }
  return {models,gpus,normalizeSettings,demoDefaults,validateDemoSettings,demo,arrivalStats,capacity,parseCSV,validateSettings,memory,config,makeScenario,readScenario};
})();
if (typeof module !== 'undefined' && module.exports) module.exports=ScenarioCore;
if (typeof window !== 'undefined') window.ScenarioCore=ScenarioCore;
