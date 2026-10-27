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
  function unfinished(engine){const done=new Set(engine.records().filter(r=>r.endMs!==null).map(r=>r.request_id));return engine.save().actions.filter(a=>a.type==='enqueue').flatMap(a=>a.rows).filter(r=>!done.has(r.request_id));}
  function create({settings,popularity=2,world='server-room',profile={kind:'single',inputTokens:1000,outputTokens:100}}){
    checkPopularity(popularity);checkProfile(profile);validatePlacement(settings,profile);
    if(!WORLDS.includes(world))throw Error('Unknown world');
    let engine=C.createSession(S.config(settings)),source={anchor:0,credit:0,users:0,requests:0};
    let base=popularity,theme=world,p=clone(profile);const initialSettings=clone(settings),initialProfile=clone(profile);
    let profileChanges=[{afterUsers:0,atMs:0,profile:clone(profile)}];
    const settingsByReplica=Array.from({length:settings.replicas},()=>clone(settings));
    const appliedSettingsByReplica=Array.from({length:settings.replicas},()=>clone(settings));
    function matches(s,config){const c=S.config(s);return Object.keys(c).filter(k=>k!=='replicas').every(k=>c[k]===config[k]);}
    function syncApplied(){for(const w of engine.inspect().replicas)if(!w.maintenance)appliedSettingsByReplica[w.id-1]=settingsByReplica[w.id-1];}
    function validateServing(s){validatePlacement(s,p);const pending=unfinished(engine);if(pending.length&&!S.memory(pending,s).fits)throw Error('Outstanding requests do not fit');}
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
      previewPlacement(s){return S.memory([...task(p),...unfinished(engine)],s);},
      setProfile(value){
        checkProfile(value);for(const s of [...settingsByReplica,...appliedSettingsByReplica])validatePlacement(s,value);
        if(JSON.stringify(value)===JSON.stringify(p))return api.inspect();
        if(profileChanges.length>=1000)throw Error('Profile change limit reached');
        p=clone(value);const change={afterUsers:source.users,atMs:now(),profile:clone(p)};
        if(profileChanges.at(-1).afterUsers===source.users)profileChanges[profileChanges.length-1]=change;else profileChanges.push(change);
        return api.inspect();
      },
      setWorld(value){if(!WORLDS.includes(value))throw Error('Unknown world');theme=value;return api.inspect();},
      maintain(replicaId,newSettings){
        validateServing(newSettings);engine.maintain(replicaId,S.config(newSettings));
        settingsByReplica[replicaId-1]=clone(newSettings);syncApplied();return api.inspect();
      },
      addCopy(newSettings=initialSettings){
        validateServing(newSettings);engine.addReplica(S.config(newSettings));settingsByReplica.push(clone(newSettings));appliedSettingsByReplica.push(clone(newSettings));return api.inspect();
      },
      inspect(){syncApplied();const state=engine.inspect();return {...state,calendar:calendar(state.timeMs),world:theme,
        users:source.users,requestsGenerated:source.requests,popularity:base,usersPerMinute:intensity(state.timeMs),
        profile:clone(p),settingsByReplica:clone(settingsByReplica),appliedSettingsByReplica:clone(appliedSettingsByReplica)};},
      records(){return engine.records();},
      save(){syncApplied();return {schema:'ai-startup-session/1',settings:clone(initialSettings),initialProfile:clone(initialProfile),profile:clone(p),profileChanges:clone(profileChanges),popularity:base,world:theme,
        source:{...source},settingsByReplica:clone(settingsByReplica),appliedSettingsByReplica:clone(appliedSettingsByReplica),engine:engine.save()};},
      // Used only by restore after validating and replaying the serving journal.
      _restore(saved){
        const restored=C.restoreSession(saved.engine),t=restored.inspect().timeMs,x=saved.source;
        if(!x||!Number.isFinite(x.anchor)||x.anchor<0||x.anchor>t||!Number.isFinite(x.credit)||x.credit<0||x.credit>=1||
          !Number.isSafeInteger(x.users)||x.users<0||x.users>10000||!Number.isSafeInteger(x.requests)||x.requests<0||x.requests>10000||
          !Array.isArray(saved.settingsByReplica)||saved.settingsByReplica.length!==restored.inspect().replicas.length)throw Error('Invalid game source state');
        checkProfile(saved.profile);
        const changes=saved.profileChanges||[{afterUsers:0,atMs:0,profile:clone(saved.profile)}];
        if(!Array.isArray(changes)||changes.length<1||changes.length>1000||changes[0].afterUsers!==0)throw Error('Invalid profile history');
        for(const [i,c] of changes.entries()){
          checkProfile(c.profile);
          if(!Number.isSafeInteger(c.afterUsers)||c.afterUsers<0||c.afterUsers>x.users||!Number.isFinite(c.atMs)||c.atMs<0||c.atMs>t||
            (i>0&&(c.afterUsers<=changes[i-1].afterUsers||c.atMs<changes[i-1].atMs)))throw Error('Invalid profile history');
        }
        const sameProfile=(a,b)=>a.kind===b.kind&&(a.kind==='openclaw'||a.inputTokens===b.inputTokens&&a.outputTokens===b.outputTokens);
        if(!sameProfile(changes.at(-1).profile,saved.profile))throw Error('Current profile does not match history');
        const rows=saved.engine.actions.filter(a=>a.type==='enqueue').flatMap(a=>a.rows);
        if(rows.length!==x.requests)throw Error('Game source does not match serving journal');
        let cursor=0,index=0;
        for(let user=1;user<=x.users;user++){
          while(index+1<changes.length&&changes[index+1].afterUsers<user)index++;
          const change=changes[index],template=task(change.profile),batch=rows.slice(cursor,cursor+template.length);cursor+=template.length;
          if(batch.length!==template.length)throw Error('Game source user count mismatch');
          const start=batch[0].arrival_ms;
          if(start<change.atMs||index+1<changes.length&&start>changes[index+1].atMs)throw Error('Profile change time does not match arrivals');
          for(const [i,r] of batch.entries())if(r.request_id!==`user-${user}-call-${i+1}`||r.arrival_ms!==start+template[i].arrival_ms||
            r.input_tokens!==template[i].input_tokens||r.output_tokens!==template[i].output_tokens)throw Error('Game task does not match source profile');
        }
        if(cursor!==rows.length)throw Error('Game source user count mismatch');
        p=clone(saved.profile);profileChanges=clone(changes);
        for(const [i,s] of saved.settingsByReplica.entries()){
          validatePlacement(s,p);const pending=unfinished(restored);if(pending.length&&!S.memory(pending,s).fits)throw Error('Outstanding requests do not fit');const actual=restored.inspect().replicas[i],expected=S.config(s),target=actual.pendingConfig||actual.config;
          if(Object.keys(expected).filter(k=>k!=='replicas').some(k=>expected[k]!==target[k]))throw Error('Model metadata does not match serving config');
        }
        const actualWorkers=restored.inspect().replicas;
        const applied=saved.appliedSettingsByReplica||actualWorkers.map((w,i)=>!w.maintenance?saved.settingsByReplica[i]:matches(initialSettings,w.config)?initialSettings:null);
        if(!Array.isArray(applied)||applied.length!==actualWorkers.length)throw Error('Invalid applied model metadata');
        for(const [i,s] of applied.entries()){if(!s)throw Error('Legacy maintenance metadata unavailable');validatePlacement(s,p);if(!matches(s,actualWorkers[i].config))throw Error('Applied model metadata does not match serving config');}
        appliedSettingsByReplica.splice(0,appliedSettingsByReplica.length,...clone(applied));
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
    const session=create({settings:saved.settings,popularity:saved.popularity,world:saved.world,profile:saved.initialProfile||saved.profile});
    session._restore(saved);return session;
  }
  return {create,restore,calendar,HOUR,DAY,MULTIPLIERS:{...MULTIPLIERS},WORLDS:[...WORLDS]};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=GameSession;
if(typeof window!=='undefined')window.GameSession=GameSession;
