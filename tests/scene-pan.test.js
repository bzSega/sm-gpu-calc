'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function scene(){
 class Element{
  constructor(){this.attrs={};this.children=[];this.listeners={};this.style={};this.classList={toggle(){}};}
  setAttribute(k,v){this.attrs[k]=String(v);} getAttribute(k){return this.attrs[k];}
  append(n){this.children.push(n);} addEventListener(t,fn){(this.listeners[t]??=[]).push(fn);}
  getBoundingClientRect(){return {width:390,height:844};}
  setPointerCapture(){} releasePointerCapture(){} hasPointerCapture(){return true;}
  fire(t,values={}){const e={pointerId:1,isPrimary:true,button:0,clientX:150,clientY:450,detail:1,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...values};for(const f of this.listeners[t]||[])f(e);return e;}
 }
 const svg=new Element();svg.setAttribute('viewBox','0 0 1586 992');
 const context=vm.createContext({document:{createElementNS:()=>new Element()},ResizeObserver:class{observe(){}},performance:{now:()=>100},window:{addEventListener(){}},Math});
 vm.runInContext(fs.readFileSync(require.resolve('../playground/scene.js'),'utf8')+';StartupScene.create(svg,()=>{});',Object.assign(context,{svg}));return svg;
}
test('Dragging a narrow scene reveals off-screen objects without activating them',()=>{
 const svg=scene(),before=svg.getAttribute('viewBox');
 svg.fire('pointerdown');svg.fire('pointermove',{clientX:350});svg.fire('pointerup',{clientX:350});
 assert.notEqual(svg.getAttribute('viewBox'),before,'The visible scene must move with a swipe');
 const [x,y,w,h]=svg.getAttribute('viewBox').split(' ').map(Number);assert(x>=0&&x+w<=1586&&y>=0&&y+h<=992);
 assert.equal(svg.fire('click').stopped,true,'A drag must not click the object below it');
 svg.fire('pointerdown');svg.fire('pointerup');assert.equal(svg.fire('click').stopped,undefined,'A fresh tap still opens objects');
});
test('Small finger jitter stays a tap; cancelled drags stop moving',()=>{
 const svg=scene(),before=svg.getAttribute('viewBox');svg.fire('pointerdown');svg.fire('pointermove',{clientX:153});svg.fire('pointerup',{clientX:153});assert.equal(svg.getAttribute('viewBox'),before);
 svg.fire('pointerdown');svg.fire('pointermove',{clientX:300});svg.fire('pointercancel');const cancelled=svg.getAttribute('viewBox');svg.fire('pointermove',{clientX:100});assert.equal(svg.getAttribute('viewBox'),cancelled);
});

test('Touch drags stop at scene edges and ignore secondary pointers',()=>{
 const svg=scene();svg.fire('pointerdown',{pointerType:'touch'});svg.fire('pointermove',{pointerType:'touch',clientX:5000,clientY:5000});svg.fire('pointerup');
 const [x,y,w,h]=svg.getAttribute('viewBox').split(' ').map(Number);assert.equal(x,0);assert.equal(y,0);assert(w<=1586&&h<=992);
 const before=svg.getAttribute('viewBox');svg.fire('pointerdown',{isPrimary:false,pointerId:2});svg.fire('pointermove',{pointerId:2,clientX:-5000});assert.equal(svg.getAttribute('viewBox'),before);
});

test('Touch pans forty percent faster than mouse without changing tap threshold',()=>{
 const mouse=scene(),touch=scene();const initial=Number(mouse.getAttribute('viewBox').split(' ')[0]);
 mouse.fire('pointerdown',{pointerType:'mouse'});mouse.fire('pointermove',{clientX:200});
 touch.fire('pointerdown',{pointerType:'touch'});touch.fire('pointermove',{clientX:200});
 const md=initial-Number(mouse.getAttribute('viewBox').split(' ')[0]),td=initial-Number(touch.getAttribute('viewBox').split(' ')[0]);assert(Math.abs(td/md-1.4)<1e-10);
});
