// Browser-neutral wall-to-model driver. No pause/speed control in the game UI.
'use strict';
const GameClock=(()=>{
  // One fixed scale for clock, arrivals and processing: 24 model hours / 6 minutes.
  const SCALE=240;
  function create({timeMs=0,advance,scale=SCALE}){
    if(!Number.isFinite(timeMs)||timeMs<0||typeof advance!=='function'||!Number.isFinite(scale)||scale<=0)throw Error('Invalid clock');
    let model=timeMs,last=null,visible=true;
    return {
      tick(wallMs){
        if(!Number.isFinite(wallMs)||wallMs<0)throw Error('Invalid wall time');
        if(!visible){last=null;return model;}
        if(last===null){last=wallMs;return model;}
        if(wallMs<last)throw Error('Wall clock must be monotonic');
        const target=model+(wallMs-last)*scale;
        advance(target);model=target;last=wallMs;return model;
      },
      visibility(value){if(typeof value!=='boolean')throw Error('Invalid visibility');visible=value;last=null;},
      time(){return model;}
    };
  }
  return {create,SCALE};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=GameClock;
if(typeof window!=='undefined')window.GameClock=GameClock;
