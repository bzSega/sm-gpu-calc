// Small data-driven isometric scene. Never advances or changes the simulation.
'use strict';
const StartupScene=(()=>{
 const NS='http://www.w3.org/2000/svg';
 function create(svg,onAction){
  // The camera crops the artwork, not the controls. Pointer motion is in CSS
  // pixels; convert to scene units, with a modest speed boost for touch.
  const bounds={width:1586,height:992},worldButtons=[];
  let cx=bounds.width/2,cy=bounds.height/2,viewWidth=bounds.width,viewHeight=bounds.height,gesture=null,suppressClick=false,queueGroup=null;
  function camera(){
   const rect=svg.getBoundingClientRect();if(!rect.width||!rect.height)return;
   const scale=Math.max(rect.width/bounds.width,rect.height/bounds.height);
   viewWidth=Math.min(bounds.width,rect.width/scale);viewHeight=Math.min(bounds.height,rect.height/scale);
   cx=Math.max(viewWidth/2,Math.min(bounds.width-viewWidth/2,cx));cy=Math.max(viewHeight/2,Math.min(bounds.height-viewHeight/2,cy));
   svg.setAttribute('viewBox',`${cx-viewWidth/2} ${cy-viewHeight/2} ${viewWidth} ${viewHeight}`);
   // Keep scene actions legible even when the artwork is scaled down.
   const ui=Math.max(1,1/scale);
   if(queueGroup)queueGroup.setAttribute('transform',`translate(594 548) scale(${ui}) translate(-594 -548)`);
   for(const item of worldButtons){const size=Math.max(1,1/(scale*item.parentScale));item.g.setAttribute('transform',`translate(${item.x-(item.width*size-item.width)/2} ${item.y}) scale(${size})`);}

  }
  svg.addEventListener('pointerdown',event=>{
   if(!event.isPrimary||event.button!==0)return;
   suppressClick=false;const rect=svg.getBoundingClientRect();
   gesture={id:event.pointerId,x:event.clientX,y:event.clientY,cx,cy,sx:viewWidth/rect.width,sy:viewHeight/rect.height,gain:event.pointerType==='touch'?1.4:1,dragged:false};
  });
  svg.addEventListener('pointermove',event=>{
   if(!gesture||gesture.id!==event.pointerId)return;
   const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
   if(!gesture.dragged&&Math.hypot(dx,dy)<8)return;
   if(!gesture.dragged){gesture.dragged=true;svg.setPointerCapture(event.pointerId);svg.classList.toggle('panning',true);}
   cx=gesture.cx-dx*gesture.sx*gesture.gain;cy=gesture.cy-dy*gesture.sy*gesture.gain;camera();event.preventDefault();
  });
  function endPan(event){
   if(!gesture||gesture.id!==event.pointerId)return;
   suppressClick=gesture.dragged;gesture=null;svg.classList.toggle('panning',false);
   if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);
  }
  for(const name of ['pointerup','pointercancel','lostpointercapture'])svg.addEventListener(name,endPan);
  svg.addEventListener('click',event=>{if(suppressClick&&event.detail!==0){suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}},true);
  new ResizeObserver(()=>{gesture=null;svg.classList.toggle('panning',false);camera();}).observe(svg);
  camera();
  function el(tag,attrs={},parent=svg,text){const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;parent.append(e);return e;}
  const defs=el('defs'),deskClip=el('clipPath',{id:'startup-desk-occlusion',clipPathUnits:'userSpaceOnUse'},defs);
  // The desk is baked into the background. Hide seated legs behind its near edge.
  el('polygon',{points:'0,0 600,0 600,270 0,510'},deskClip);
  const backdrop=el('image',{href:'assets/server-room.png?v=floor-2',width:1586,height:992});
  const shade=el('rect',{width:1586,height:992,fill:'#182a4c',opacity:0,'pointer-events':'none'});
  const paths=el('g',{'aria-hidden':'true'}),actors=el('g',{'aria-hidden':'true','clip-path':'url(#startup-desk-occlusion)'}),rackLayer=el('g'),flightLayer=el('g',{'aria-hidden':'true','data-flow-effects':''});
  const inbound=el('path',{d:'M 290 430 L 510 570 L 720 490 L 880 410',fill:'none',stroke:'#cc9c4d','stroke-width':5,'stroke-dasharray':'10 12',opacity:.8},paths);
  const outbound=el('path',{d:'M 910 450 L 710 550 L 480 640 L 260 480',fill:'none',stroke:'#92cfaf','stroke-width':5,'stroke-dasharray':'10 12',opacity:.7},paths);
  queueGroup=el('g',{class:'scene-queue',role:'button',tabindex:0,'aria-haspopup':'dialog'});const queueTitle=el('title',{},queueGroup);queueGroup.onclick=()=>onAction('queue');queueGroup.onkeydown=event=>{if(!event.repeat&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onAction('queue');}};el('rect',{x:510,y:515,width:168,height:67,rx:6,fill:'#433e2c',stroke:'#c3a66b','stroke-width':3},queueGroup);
  const queueLabel=el('text',{x:594,y:540,'text-anchor':'middle',fill:'#fff4d6','font-size':18,'font-family':'system-ui','data-queue-label':''},queueGroup);
  const queueValue=el('text',{x:594,y:569,'text-anchor':'middle',fill:'#ffcf76','font-size':26,'font-family':'system-ui','font-weight':800,'data-queue-value':''},queueGroup);
  let key='',rackRefs=[],lastArrived=0,lastCompleted=0,flights=[];
  function button(x,y,width,label,action,parent=rackLayer,kind='scene'){
   // Native SVG controls avoid WebKit's transformed foreignObject hit-testing.
   const g=el('g',{class:'scene-action',role:'button',tabindex:0,'aria-label':label,'data-scene-action':kind},parent);
   el('rect',{width,height:48,rx:7,fill:'#fffae9',stroke:'#42674e','stroke-width':2},g);
   el('text',{x:width/2,y:30,'text-anchor':'middle',fill:'#2b4034','font-size':19,'font-weight':700,'font-family':'system-ui','pointer-events':'none'},g,label);
   g.onclick=action;g.onkeydown=event=>{if(!event.repeat&&(event.key==='Enter'||event.key===' ')){event.preventDefault();action();}};
   worldButtons.push({g,x,y,width,parentScale:1});return g;
  }

  function person(x,y,variant){
   const g=el('g',{'data-visitor':variant},actors);
   el('image',{href:'assets/visitor.png',x,y,width:145,height:145,style:variant===1?'filter:hue-rotate(25deg)':variant===2?'filter:hue-rotate(-25deg)':''},g);
  }


  function envelope(parent,x=0,y=0,color='#efbd65'){const g=el('g',{transform:`translate(${x} ${y})`},parent);el('rect',{x:-13,y:-9,width:26,height:18,fill:color,stroke:'#624e31','stroke-width':2},g);el('path',{d:'M -12 -8 L 0 1 L 12 -8',fill:'none',stroke:'#624e31','stroke-width':2},g);return g;}
  function rack(x,y,id,state,label,selected,compact=false){
   const g=el('g',{'data-copy':id},rackLayer),hardware=state.copies?.find(c=>c.id===id)?.hardware||state.hardware;
   // Shear artwork and its GPU overlays together to follow the floor axes.
   // Keep the action outside this group so its text and touch target stay level.
   const cabinet=el('g',{transform:'matrix(1 .28 0 1 0 0)'},g);
   // Ground footprint follows the same projection, position and scale as the cabinet.
   el('polygon',{points:'-7,259 133,290 195,231 55,200',fill:'#78816a','fill-opacity':.32,stroke:selected?'#e9d28b':'#a5ad87','stroke-width':2,'stroke-dasharray':'7 5','pointer-events':'none','data-rack-footprint':''},cabinet);
   const frame=el('g',{},cabinet);el('image',{href:'assets/rack-shell.png',x:x-8,y:y-35,width:200,height:330},frame);
   const face=el('g',{transform:`translate(${x} ${y}) matrix(1 .22 0 1 0 0)`},cabinet);
   if(selected)el('rect',{x:6,y:12,width:122,height:224,fill:'none',stroke:'#ffe19a','stroke-width':3},face);
   el('rect',{x:12,y:16,width:107,height:20,fill:'#1b3028'},face);el('text',{x:18,y:31,fill:'#f8f1dc','font-size':13,'font-family':'system-ui','font-weight':800},face,hardware?hardware.gpu:'GPU');
   const cards=hardware?.cards||0,cols=cards>8?2:1;
   for(let i=0;i<Math.max(8,cards);i++){
    const gx=13+(i%cols)*(86/cols),gy=43+Math.floor(i/cols)*21,w=cols===1?82:38;
    el('rect',{x:gx,y:gy,width:w,height:17,fill:i<cards?'#71845f':'#20342b',stroke:i<cards?'#a9b496':'#50614c','stroke-width':1},face);
    if(i<cards){
     for(const cx of (cols===1?[gx+23,gx+59]:[gx+19])){el('circle',{cx,cy:gy+8,r:6,fill:'#213b2d',stroke:'#b1bea1'},face);el('path',{d:`M ${cx-4} ${gy+5} L ${cx+4} ${gy+11} M ${cx+4} ${gy+5} L ${cx-4} ${gy+11}`,stroke:'#8a9e78','stroke-width':2},face);el('circle',{cx,cy:gy+8,r:2,fill:'#c5ceb3'},face);}
     el('rect',{x:gx+2,y:gy+4,width:3,height:8,fill:'#e8c46d'},face);
    }
   }

   const strip=el('g',{},face),bx=104,by=43,bh=166;el('rect',{x:bx,y:by,width:10,height:bh,fill:'#dce4ce'},strip);
   const weight=el('rect',{x:bx,width:10,fill:'#fa9578'},strip),reserve=el('rect',{x:bx,width:10,fill:'#92997a'},strip),kv=el('rect',{x:bx,width:10,fill:'#88d3b6'},strip);
   const lamp=el('rect',{x:14,y:218,width:8,height:7,fill:'#adb39a'},face);
   const info=el('text',{x:27,y:225,fill:'#f6efda','font-size':11,'font-family':'system-ui'},face);
   if(compact){
    cabinet.setAttribute('role','button');cabinet.setAttribute('tabindex','0');cabinet.setAttribute('aria-label',label);cabinet.setAttribute('data-scene-action','rack');
    el('title',{},cabinet,label);
    cabinet.onclick=()=>onAction('rack',id);
    cabinet.onkeydown=event=>{if(!event.repeat&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onAction('rack',id);}};
   }else button(x-16,y+325,205,label,()=>onAction('rack',id),g,'rack');
   rackRefs.push({id,weight,reserve,kv,lamp,info,by,bh});return g;
  }
  function render(state,{lang='ru',selected=1,reduced=false}={}){
   const open=!!state.live,copies=state.live?.replicas.length||1;
   backdrop.setAttribute('href',`assets/${state.world||'server-room'}.png?v=floor-2`);
   const signature=[state.world,JSON.stringify(state.copies?.map(c=>c.hardware)),state.stage,state.hardware?.gpu,state.hardware?.cards,state.model,copies,selected,lang].join('|');
   if(key!==signature){
    key=signature;worldButtons.length=0;rackLayer.replaceChildren();actors.replaceChildren();rackRefs=[];if(state.stage==='empty'){flights.forEach(f=>f.node.remove());flights=[];}
    for(const item of StartupPresentation.layout(copies).sort((a,b)=>(a.y+290*a.scale)-(b.y+290*b.scale)||a.x-b.x)){const hw=state.copies?.find(c=>c.id===item.id)?.hardware||state.hardware,g=rack(0,0,item.id,state,!hw?(lang==='ru'?'Установить GPU':'Install GPUs'):`${lang==='ru'?'Копия':'Copy'} ${item.id} · ${hw.cards} GPU`,selected===item.id,copies>3);g.setAttribute('transform',`translate(${item.x} ${item.y}) scale(${item.scale})`);if(copies<=3)worldButtons[worldButtons.length-1].parentScale=item.scale;}

    if(state.hardware&&!open)button(270,350,260,state.model?(lang==='ru'?'Открыть сервис':'Open service'):(lang==='ru'?'Выбрать модель':'Choose model'),()=>onAction(state.model?'open':'models'));
    if(open){button(175,520,290,lang==='ru'?'Поток пользователей':'User traffic',()=>onAction('visitors'));button(copies>3?500:800,copies>3?650:660,260,lang==='ru'?`Все копии · ${copies}`:`All copies · ${copies}`,()=>onAction('copies'));
     person(75,375,0);person(175,332,1);person(270,287,2);}
    camera();
   }
   const phase=state.live?.calendar.phase||'morning';shade.setAttribute('opacity',phase==='night'?.36:phase==='peak'?.08:0);
   paths.style.display=open?'':'none';queueGroup.style.display=open?'':'none';queueLabel.textContent=lang==='ru'?'Очередь ↗':'Queue ↗';const queued=state.live?.queued||0;queueValue.textContent=queued;queueTitle.textContent=lang==='ru'?'Узнать причину ожидания':'Explain waiting requests';queueGroup.setAttribute('aria-label',lang==='ru'?`Очередь: ${queued}. Узнать причину ожидания`:`Queue: ${queued}. Explain waiting requests`);
   for(const r of rackRefs){
    const worker=state.live?.replicas.find(w=>w.id===r.id),memory=state.copies?.find(c=>c.id===r.id)?.memory||state.memory,total=memory?.total||1;
    let bottom=r.by+r.bh;
    for(const [node,amount] of [[r.weight,memory?.weightsGB||0],[r.reserve,memory?.reservedGB||0],[r.kv,worker?.kvUsedGB||0]]){
     const height=Math.max(0,r.bh*amount/total);bottom-=height;node.setAttribute('y',bottom);node.setAttribute('height',height);
    }
    r.info.textContent=open?`${worker?.maintenance?'⚒ ':''}${worker?.active||0}/${worker?.config.concurrency||2} ${lang==='ru'?'запросов':'requests'}`:state.model?(lang==='ru'?'Модель размещена':'Model loaded'):(lang==='ru'?'Пока без модели':'No model yet');
    r.lamp.setAttribute('fill',worker?.maintenance?'#f2bb5b':worker?.active?'#9ee2b5':state.model?'#e6bf75':'#adb39a');
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
