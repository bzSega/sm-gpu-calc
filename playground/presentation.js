// Presentation-only geometry and saved object selection. No serving formulas.
'use strict';
const StartupPresentation=(()=>{
 const worlds=['server-room','workshop','orbital'];
 function selection(value,state){
  if(value===undefined)return {selected:1,detail:null};
  if(!value||!Number.isInteger(value.selected)||value.selected<1||value.selected>Math.max(1,state.copies.length))throw Error('Invalid selected copy');
  const detail=value.detail;
  if(detail!==null){
   if(!detail||!['rack','card','copies'].includes(detail.kind)||!state.live)throw Error('Invalid open object');
   if(detail.kind==='card'&&(!Number.isInteger(detail.card)||detail.card<1||detail.card>state.copies[value.selected-1].hardware.cards))throw Error('Invalid selected GPU');
  }
  return {selected:value.selected,detail:detail?{kind:detail.kind,...(detail.kind==='card'?{card:detail.card}:{})}:null};
 }
 function layout(count){
  if(!Number.isInteger(count)||count<1||count>64)throw Error('Invalid copy count');
  // Centers of the three floor pads, shared by all world backgrounds.
  // The cabinet's ground contact is (88, 290) after perspective correction.
  if(count<=3)return [[956,416],[1214,550],[1483,693]].slice(0,count).map(([floorX,floorY],i)=>({id:i+1,x:floorX-88,y:floorY-290,scale:1}));
  const cols=count<=16?4:8,scale=count<=16?.48:.28,step=count<=16?105:52;
  return Array.from({length:count},(_,i)=>{
   const col=i%cols,row=Math.floor(i/cols);
   return {id:i+1,x:1100+(col-row)*step-88*scale,y:380+(col+row)*step/2-290*scale,scale};
  });
 }
 return {worlds,selection,layout};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=StartupPresentation;
if(typeof window!=='undefined')window.StartupPresentation=StartupPresentation;
