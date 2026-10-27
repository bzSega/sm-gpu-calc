// Construction and save boundaries for the game. Serving stays in GameSession.
'use strict';
const StartupGame=(()=>{
  const S=typeof module!=='undefined'&&module.exports?require('../scenario-core.js'):window.ScenarioCore;
  const G=typeof module!=='undefined'&&module.exports?require('./session.js'):window.GameSession;
  const clone=x=>JSON.parse(JSON.stringify(x));
  const PROFILE={kind:'single',inputTokens:10000,outputTokens:1000};
  const SAMPLE=[{request_id:'preview',arrival_ms:0,input_tokens:PROFILE.inputTokens,output_tokens:PROFILE.outputTokens}];
  function create({world='server-room'}={}){
    if(!G.WORLDS.includes(world))throw Error('Unknown world');
    let hardware=null,model=null,live=null,theme=world;
    function settings(id=model){
      if(!hardware||!Object.hasOwn(S.models,id))throw Error('Choose GPU and model first');
      // This explicit teaching launch profile is not a hardware benchmark.
      return {model:id,gpu:hardware.gpu,cards:hardware.cards,replicas:1,prefill:S.models[id].prefill,
        decode:S.models[id].decode,price:S.gpus[hardware.gpu].price,reserve:10,concurrency:2,batchGain:25};
    }
    const api={
      install(gpu,cards){
        if(live)throw Error('Service is already open');
        if(!Object.hasOwn(S.gpus,gpu)||!Number.isInteger(cards)||cards<1||cards>16)throw Error('Invalid GPU installation');
        hardware={gpu,cards};if(model&&!api.preview(model).fits)model=null;return api.inspect();
      },
      preview(id){if(!hardware)throw Error('Install GPU first');return S.memory(SAMPLE,settings(id));},
      useModel(id){
        if(live)throw Error('Service is already open');
        const memory=api.preview(id);if(!memory.fits)throw Error('Model and request do not fit');
        model=id;return api.inspect();
      },
      open(){
        if(live)throw Error('Service is already open');
        if(!model||!api.preview(model).fits)throw Error('Model is not ready');
        live=G.create({settings:settings(),popularity:2,world:theme,profile:PROFILE});return api.inspect();
      },
      advanceTo(t){if(!live)throw Error('Service is closed');live.advanceTo(t);return api.inspect();},
      setPopularity(value){if(!live)throw Error('Service is closed');live.setPopularity(value);return api.inspect();},
      addCopy(copyId=1){if(!live)throw Error('Service is closed');const from=api.inspect().copies.find(c=>c.id===copyId);if(!from)throw Error('Unknown copy');live.addCopy(from.settings);return api.inspect();},
      previewCopy(copyId,gpu,cards){const c=api.inspect().copies.find(c=>c.id===copyId);if(!c||!Object.hasOwn(S.gpus,gpu)||!Number.isInteger(cards)||cards<1||cards>16)throw Error('Invalid copy placement');return S.memory(SAMPLE,{...c.settings,gpu,cards,price:S.gpus[gpu].price});},
      maintain(copyId,gpu,cards){if(!live)throw Error('Service is closed');const c=api.inspect().copies.find(c=>c.id===copyId);const memory=api.previewCopy(copyId,gpu,cards);if(!memory.fits)throw Error('Model and request do not fit');live.maintain(copyId,{...c.settings,gpu,cards,price:S.gpus[gpu].price});return api.inspect();},
      setWorld(value){if(!G.WORLDS.includes(value))throw Error('Unknown world');theme=value;if(live)live.setWorld(value);return api.inspect();},
      inspect(){const state=live?live.inspect():null;
        const copies=state?state.replicas.map((worker,i)=>{const current=state.appliedSettingsByReplica[i];return {id:worker.id,settings:clone(current),hardware:{gpu:current.gpu,cards:current.cards},model:current.model,memory:S.memory(SAMPLE,current),worker,pendingSettings:worker.maintenance?clone(state.settingsByReplica[i]):null};}):[];
        return {stage:live?'open':model?'ready':hardware?'hardware':'empty',world:theme,hardware:hardware?{...hardware}:null,
        model,settings:model?settings():null,memory:model?api.preview(model):null,live:state,copies};},
      save(){return {schema:'ai-startup-game/1',world:theme,hardware:hardware?{...hardware}:null,model,live:live?live.save():null};},
      _restoreLive(saved){
        if(!model||!hardware)throw Error('Invalid open service');
        const candidate=G.restore(saved),expected=settings();
        const actual=candidate.save().settings,profile=candidate.inspect().profile;
        if(Object.keys(expected).some(k=>actual[k]!==expected[k])||Object.keys(PROFILE).some(k=>profile[k]!==PROFILE[k])||candidate.inspect().world!==theme)throw Error('Game construction does not match session');
        live=candidate;
      }
    };
    return api;
  }
  function restore(saved){
    if(!saved||saved.schema!=='ai-startup-game/1')throw Error('Invalid game save');
    const game=create({world:saved.world});
    if(saved.hardware)game.install(saved.hardware.gpu,saved.hardware.cards);
    if(saved.model!==null)game.useModel(saved.model);
    if(saved.live)game._restoreLive(saved.live);
    return game;
  }
  return {create,restore,PROFILE:clone(PROFILE)};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=StartupGame;
if(typeof window!=='undefined')window.StartupGame=StartupGame;
