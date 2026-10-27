// Technical game-session controller. DOM-free; all serving work is in SimCore.
'use strict';
const GameSession=(()=>{
  const C=typeof module!=='undefined'&&module.exports?require('../sim-core.js'):window.SimCore;
  const S=typeof module!=='undefined'&&module.exports?require('../scenario-core.js'):window.ScenarioCore;
  const HOUR=3600000,DAY=24*HOUR,START=8*HOUR;
  const WORLDS=['server-room','workshop','orbital'];
  // Explicit teaching assumptions, to tune in the playable prototype.
  const MULTIPLIERS={morning:1,peak:10,night:.5};
  const clone=x=>JSON.parse(JSON.stringify(x));
  function calendar(timeMs){
    const absolute=START+timeMs,within=absolute%DAY,hour=Math.floor(within/HOUR),minute=Math.floor((within%HOUR)/60000);
    return {day:1+Math.floor(absolute/DAY),hour,minute,phase:hour>=8&&hour<18?'morning':hour>=18&&hour<23?'peak':'night',
      clock:`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`};
  }
  function nextBoundary(t){
    const absolute=t+START,start=Math.floor(absolute/DAY)*DAY;
    for(const hour of [8,18,23,32]){const next=start+hour*HOUR-START;if(next>t)return next;}
    throw Error('Invalid day boundary');
  }
  function checkPopularity(n){if(!Number.isFinite(n)||n<0||n>1000)throw Error('Popularity must be 0–1000 new users/minute');}
  function checkProfile(p){
    if(!p||!['single','openclaw'].includes(p.kind))throw Error('Unknown task profile');
    if(p.kind==='single'&&(!Number.isSafeInteger(p.inputTokens)||p.inputTokens<0||p.inputTokens>1e9||!Number.isSafeInteger(p.outputTokens)||p.outputTokens<1||p.outputTokens>1e9))throw Error('Invalid task token counts');
  }
  function task(p){
    return p.kind==='openclaw'?S.demo({users:1,usersPerSecond:1}):[{request_id:'template',arrival_ms:0,input_tokens:p.inputTokens,output_tokens:p.outputTokens}];
  }
  function validatePlacement(settings,p){
    if(!S.validateSettings(settings))throw Error('Invalid model settings');
    const memory=S.memory(task(p),settings);if(!memory.fits)throw Error('Task or model does not fit');
  }
  function create({settings,popularity=2,world='server-room',profile={kind:'single',inputTokens:1000,outputTokens:100}}){
    checkPopularity(popularity);checkProfile(profile);validatePlacement(settings,profile);
    if(!WORLDS.includes(world))throw Error('Unknown world');
    let engine=C.createSession(S.config(settings)),source={anchor:0,credit:0,users:0,requests:0};
    let base=popularity,theme=world;const initialSettings=clone(settings),p=clone(profile);
    const settingsByReplica=Array.from({length:settings.replicas},()=>clone(settings));
    const intensity=t=>base*MULTIPLIERS[calendar(t).phase];
    const now=()=>engine.inspect().timeMs;
    const api={
      advanceTo(target){
        if(!Number.isFinite(target)||target<now()||target>1e9)throw Error('Invalid game time');
        // Generate tentatively, then enqueue atomically. A limit never drops a
        // queue or silently discards a user; caller can lower future demand.
        const next={...source},rows=[];
        for(;;){
          const rate=intensity(next.anchor),boundary=nextBoundary(next.anchor);
          const spawn=rate>0?next.anchor+(1-next.credit)*60000/rate:Infinity;
          const arrival=Math.ceil(spawn);
          if(spawn<=boundary&&arrival<=target){
            next.anchor=spawn;next.credit=0;next.users++;
            for(const [i,r] of task(p).entries())rows.push({request_id:`user-${next.users}-call-${i+1}`,arrival_ms:arrival+r.arrival_ms,input_tokens:r.input_tokens,output_tokens:r.output_tokens});
            if(source.requests+rows.length>10000)throw Error('Game session request limit (10000) reached; reduce demand or start a new session');
          }else if(boundary<=target){
            next.credit+=(boundary-next.anchor)*rate/60000;next.anchor=boundary;
          }else break;
        }
        if(rows.length)engine.enqueue(rows);
        engine.advanceTo(target);next.requests+=rows.length;source=next;return api.inspect();
      },
      setPopularity(value){
        checkPopularity(value);if(value===base)return api.inspect();const time=now();
        source.credit+=(time-source.anchor)*intensity(source.anchor)/60000;source.anchor=time;base=value;
        return api.inspect();
      },
      setWorld(value){if(!WORLDS.includes(value))throw Error('Unknown world');theme=value;return api.inspect();},
      maintain(replicaId,newSettings){
        validatePlacement(newSettings,p);engine.maintain(replicaId,S.config(newSettings));
        settingsByReplica[replicaId-1]=clone(newSettings);return api.inspect();
      },
      addCopy(newSettings=initialSettings){
        validatePlacement(newSettings,p);engine.addReplica(S.config(newSettings));settingsByReplica.push(clone(newSettings));return api.inspect();
      },
      inspect(){const state=engine.inspect();return {...state,calendar:calendar(state.timeMs),world:theme,
        users:source.users,requestsGenerated:source.requests,popularity:base,usersPerMinute:intensity(state.timeMs),
        profile:clone(p),settingsByReplica:clone(settingsByReplica)};},
      records(){return engine.records();},
      save(){return {schema:'ai-startup-session/1',settings:clone(initialSettings),profile:clone(p),popularity:base,world:theme,
        source:{...source},settingsByReplica:clone(settingsByReplica),engine:engine.save()};},
      // Used only by restore after validating and replaying the serving journal.
      _restore(saved){
        const restored=C.restoreSession(saved.engine),t=restored.inspect().timeMs,x=saved.source;
        if(!x||!Number.isFinite(x.anchor)||x.anchor<0||x.anchor>t||!Number.isFinite(x.credit)||x.credit<0||x.credit>=1||
          !Number.isSafeInteger(x.users)||x.users<0||x.users>10000||!Number.isSafeInteger(x.requests)||x.requests<0||x.requests>10000||
          !Array.isArray(saved.settingsByReplica)||saved.settingsByReplica.length!==restored.inspect().replicas.length)throw Error('Invalid game source state');
        const count=saved.engine.actions.filter(a=>a.type==='enqueue').reduce((n,a)=>n+a.rows.length,0);
        if(count!==x.requests||x.requests!==x.users*task(p).length)throw Error('Game source does not match serving journal');
        const rows=saved.engine.actions.filter(a=>a.type==='enqueue').flatMap(a=>a.rows),template=task(p);
        for(let user=1;user<=x.users;user++){
          const batch=rows.slice((user-1)*template.length,user*template.length),start=batch[0].arrival_ms;
          for(const [i,r] of batch.entries())if(r.request_id!==`user-${user}-call-${i+1}`||r.arrival_ms!==start+template[i].arrival_ms||
            r.input_tokens!==template[i].input_tokens||r.output_tokens!==template[i].output_tokens)throw Error('Game task does not match source profile');
        }
        for(const [i,s] of saved.settingsByReplica.entries()){
          validatePlacement(s,p);const actual=restored.inspect().replicas[i],expected=S.config(s),target=actual.pendingConfig||actual.config;
          if(Object.keys(expected).filter(k=>k!=='replicas').some(k=>expected[k]!==target[k]))throw Error('Model metadata does not match serving config');
        }
        // Source anchor is the latest generation boundary/action. It cannot
        // precede a phase boundary already observed by the session.
        if(nextBoundary(x.anchor)<=t)throw Error('Invalid source phase');
        engine=restored;source={...x};settingsByReplica.splice(0,settingsByReplica.length,...clone(saved.settingsByReplica));
      }
    };
    return api;
  }
  function restore(saved){
    if(!saved||saved.schema!=='ai-startup-session/1')throw Error('Invalid game save');
    const session=create({settings:saved.settings,popularity:saved.popularity,world:saved.world,profile:saved.profile});
    session._restore(saved);return session;
  }
  return {create,restore,calendar,HOUR,DAY,MULTIPLIERS:{...MULTIPLIERS},WORLDS:[...WORLDS]};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=GameSession;
if(typeof window!=='undefined')window.GameSession=GameSession;
