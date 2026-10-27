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
  if(count<=3)return Array.from({length:count},(_,i)=>({id:i+1,x:[840,1100,1350][i],y:[205,345,480][i],scale:1}));
  const cols=count<=16?4:8,scale=count<=16?.43:.27;
  return Array.from({length:count},(_,i)=>({id:i+1,x:760+(i%cols)*(cols===4?170:92),y:160+Math.floor(i/cols)*(cols===4?155:80),scale}));
 }
 return {worlds,selection,layout};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=StartupPresentation;
if(typeof window!=='undefined')window.StartupPresentation=StartupPresentation;
