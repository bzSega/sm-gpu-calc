// Small data-driven isometric scene. Never advances or changes the simulation.
'use strict';
const StartupScene=(()=>{
 const NS='http://www.w3.org/2000/svg',XHTML='http://www.w3.org/1999/xhtml';
 function create(svg,onAction){
  function el(tag,attrs={},parent=svg,text){const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;parent.append(e);return e;}
  el('image',{href:'assets/server-room.png',width:1586,height:992});
  const shade=el('rect',{width:1586,height:992,fill:'#182a4c',opacity:0,'pointer-events':'none'});
  const paths=el('g',{'aria-hidden':'true'}),actors=el('g',{'aria-hidden':'true'}),rackLayer=el('g'),flightLayer=el('g',{'aria-hidden':'true'});
  const inbound=el('path',{d:'M 290 430 L 510 570 L 720 490 L 880 410',fill:'none',stroke:'#cc9c4d','stroke-width':5,'stroke-dasharray':'10 12',opacity:.8},paths);
  const outbound=el('path',{d:'M 910 450 L 710 550 L 480 640 L 260 480',fill:'none',stroke:'#92cfaf','stroke-width':5,'stroke-dasharray':'10 12',opacity:.7},paths);
  const queueGroup=el('g',{},paths);el('rect',{x:510,y:515,width:168,height:67,rx:6,fill:'#433e2c',stroke:'#c3a66b','stroke-width':3},queueGroup);
  const queueLabel=el('text',{x:594,y:540,'text-anchor':'middle',fill:'#fff4d6','font-size':18,'font-family':'system-ui'},queueGroup);
  const queueValue=el('text',{x:594,y:569,'text-anchor':'middle',fill:'#ffcf76','font-size':26,'font-family':'system-ui','font-weight':800},queueGroup);
  let key='',rackRefs=[],lastArrived=0,lastCompleted=0,flights=[];
  function button(x,y,width,label,action,parent=rackLayer){const f=el('foreignObject',{x,y,width,height:60},parent),b=document.createElementNS(XHTML,'button');b.setAttribute('class','world-button');b.textContent=label;b.onclick=action;f.append(b);return b;}
  function person(x,y,shirt){const g=el('g',{transform:`translate(${x} ${y})`},actors);el('ellipse',{cx:8,cy:47,rx:22,ry:8,fill:'#344c4440'},g);el('rect',{x:-4,y:5,width:26,height:23,fill:'#e6b98b'},g);el('path',{d:'M -6 12 V 0 H 23 V 12 H 15 V 7 H 4 V 12 Z',fill:'#3e322b'},g);el('path',{d:'M -6 28 H 25 V 48 H 17 V 60 H 6 V 48 H -6 Z',fill:shirt},g);el('rect',{x:13,y:16,width:3,height:3,fill:'#243a32'},g);}
  function envelope(parent,x=0,y=0,color='#efbd65'){const g=el('g',{transform:`translate(${x} ${y})`},parent);el('rect',{x:-13,y:-9,width:26,height:18,fill:color,stroke:'#624e31','stroke-width':2},g);el('path',{d:'M -12 -8 L 0 1 L 12 -8',fill:'none',stroke:'#624e31','stroke-width':2},g);return g;}
  function rack(x,y,id,state,label,selected){
   const g=el('g',{'data-copy':id},rackLayer),hardware=state.hardware,front='#384c40',side='#243a31';
   el('polygon',{points:`${x},${y} ${x+48},${y-28} ${x+186},${y-28} ${x+138},${y}`,fill:'#b3bba4',stroke:'#52644e','stroke-width':3},g);
   el('polygon',{points:`${x+138},${y} ${x+186},${y-28} ${x+186},${y+240} ${x+138},${y+268}`,fill:side,stroke:'#52644e','stroke-width':3},g);
   el('rect',{x,y,width:138,height:268,rx:5,fill:front,stroke:selected?'#ffe19a':'#9da88c','stroke-width':selected?5:3},g);
   el('rect',{x:x+10,y:y+12,width:118,height:22,fill:'#1b3028'},g);el('text',{x:x+18,y:y+28,fill:'#f8f1dc','font-size':14,'font-family':'system-ui','font-weight':800},g,hardware?hardware.gpu:'GPU');
   const cards=hardware?.cards||0,cols=cards>8?2:1;
   for(let i=0;i<Math.max(8,cards);i++){
    const gx=x+12+(i%cols)*(106/cols),gy=y+45+Math.floor(i/cols)*24,w=cols===1?90:43;
    el('rect',{x:gx,y:gy,width:w,height:18,fill:i<cards?'#62785b':'#20342b',stroke:i<cards?'#9da98a':'#667460','stroke-width':1},g);
    if(i<cards){el('circle',{cx:gx+w*.3,cy:gy+9,r:6,fill:'#273e32',stroke:'#aeb99e'},g);if(cols===1)el('circle',{cx:gx+w*.7,cy:gy+9,r:6,fill:'#273e32',stroke:'#aeb99e'},g);}
   }
   const strip=el('g',{},g),bx=x+113,by=y+44,bh=190;el('rect',{x:bx,y:by,width:10,height:bh,fill:'#dce4ce'},strip);
   const weight=el('rect',{x:bx,width:10,fill:'#fa9578'},strip),reserve=el('rect',{x:bx,width:10,fill:'#92997a'},strip),kv=el('rect',{x:bx,width:10,fill:'#88d3b6'},strip);
   const lamp=el('rect',{x:x+13,y:y+243,width:11,height:8,fill:'#adb39a'},g);
   const info=el('text',{x:x+31,y:y+251,fill:'#f6efda','font-size':13,'font-family':'system-ui'},g);
   button(x-16,y+285,205,label,()=>onAction('rack',id));
   rackRefs.push({id,weight,reserve,kv,lamp,info,by,bh});
  }
  function render(state,{lang='ru',selected=1,reduced=false}={}){
   const open=!!state.live,copies=state.live?.replicas.length||1;
   const signature=[state.stage,state.hardware?.gpu,state.hardware?.cards,state.model,copies,selected,lang].join('|');
   if(key!==signature){
    key=signature;rackLayer.replaceChildren();actors.replaceChildren();rackRefs=[];if(state.stage==='empty'){flights.forEach(f=>f.node.remove());flights=[];}
    const ids=copies<=3?Array.from({length:copies},(_,i)=>i+1):[1,2,Math.max(3,selected)];
    ids.forEach((id,i)=>rack([840,1100,1350][i],[205,345,480][i],id,state,!state.hardware?(lang==='ru'?'Установить GPU':'Install GPUs'):`${lang==='ru'?'Копия':'Copy'} ${id} · ${state.hardware.cards} GPU`,selected===id));
    if(state.hardware&&!open)button(270,350,260,state.model?(lang==='ru'?'Открыть сервис':'Open service'):(lang==='ru'?'Выбрать модель':'Choose model'),()=>onAction(state.model?'open':'models'));
    if(open){button(175,520,230,lang==='ru'?'Поток людей':'Visitors',()=>onAction('visitors'));button(800,660,260,lang==='ru'?`Все копии · ${copies}`:`All copies · ${copies}`,()=>onAction('copies'));
     person(172,400,'#718c99');person(260,450,'#a69166');person(350,485,'#648775');}
   }
   const phase=state.live?.calendar.phase||'morning';shade.setAttribute('opacity',phase==='night'?.36:phase==='peak'?.08:0);
   paths.style.display=open?'':'none';queueLabel.textContent=lang==='ru'?'Очередь':'Queue';queueValue.textContent=state.live?.queued||0;
   for(const r of rackRefs){
    const worker=state.live?.replicas.find(w=>w.id===r.id),memory=state.memory,total=memory?.total||1;
    let bottom=r.by+r.bh;
    for(const [node,amount] of [[r.weight,memory?.weightsGB||0],[r.reserve,memory?.reservedGB||0],[r.kv,worker?.kvUsedGB||0]]){
     const height=Math.max(0,r.bh*amount/total);bottom-=height;node.setAttribute('y',bottom);node.setAttribute('height',height);
    }
    r.info.textContent=open?`${worker?.active||0}/${worker?.config.concurrency||2} ${lang==='ru'?'запросов':'requests'}`:state.model?(lang==='ru'?'Модель размещена':'Model loaded'):(lang==='ru'?'Пока без модели':'No model yet');
    r.lamp.setAttribute('fill',worker?.active?'#9ee2b5':state.model?'#e6bf75':'#adb39a');
   }
   const arrived=state.live?.arrived||0,completed=state.live?.completed||0;
   if(!reduced){if(arrived>lastArrived)flights.push({node:envelope(flightLayer),path:inbound,start:performance.now()});if(completed>lastCompleted)flights.push({node:envelope(flightLayer,0,0,'#93d8b9'),path:outbound,start:performance.now()});}
   lastArrived=arrived;lastCompleted=completed;
   while(flights.length>14)flights.shift().node.remove();
   if(reduced){flights.forEach(f=>f.node.remove());flights=[];}
  }
  return {render,animate(wall){flights=flights.filter(f=>{const p=(wall-f.start)/900;if(p>=1){f.node.remove();return false;}const point=f.path.getPointAtLength(Math.max(0,p)*f.path.getTotalLength());f.node.setAttribute('transform',`translate(${point.x} ${point.y})`);return true;});}};
 }
 return {create};
})();
