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
  // Demo: anonymized trip-planning case (Moscow → Nizhny Novgorod), examples/trip-moscow-nizhny.
  // One agent task = 7 model calls (DAG trace); replayed as 3 users arriving 5 s apart.
  const TRIP_STEP = [ // [arrival_ms, input_tokens, output_tokens] from examples/trip-moscow-nizhny/requests.csv
    [0, 251, 142], [3056, 393, 103], [3056, 393, 93], [5230, 344, 103],
    [7584, 550, 160], [10964, 411, 141], [10964, 411, 94]
  ];
  const demo = () => [0, 5000, 10000].flatMap((offset, u) => TRIP_STEP.map(([a, i, o], k) => ({
    request_id: `trip-u${u + 1}-s${k + 1}`, arrival_ms: offset + a, input_tokens: i, output_tokens: o, token_count_source: 'proxy_estimate'
  })));
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
  function makeScenario(workload, settings) {
    if (!validateSettings(settings) || !core.validateWorkload(workload).ok) throw Error('scenario');
    return {schema_version:'sm-gpu-calc/2',core_version:'0.3.0',profile_version:'educational-2026-09-28',workload,settings:normalizeSettings(settings)};
  }
  function readScenario(text) {
    const s=JSON.parse(text);
    const legacy=s.schema_version==='sm-gpu-calc/1' && s.core_version==='0.2.0';
    if ((!legacy && !(s.schema_version==='sm-gpu-calc/2' && s.core_version==='0.3.0')) || s.profile_version!=='educational-2026-09-28') throw Error('version');
    if(legacy)s.settings={...s.settings,concurrency:1,batchGain:0};
    else if(s.settings?.concurrency===undefined || s.settings?.batchGain===undefined)throw Error('settings');
    return makeScenario(s.workload,s.settings);
  }
  return {models,gpus,normalizeSettings,demo,parseCSV,validateSettings,memory,config,makeScenario,readScenario};
})();
if (typeof module !== 'undefined' && module.exports) module.exports=ScenarioCore;
if (typeof window !== 'undefined') window.ScenarioCore=ScenarioCore;
