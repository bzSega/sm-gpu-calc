import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),G=require('../playground/session.js');
const settings={model:'flash',gpu:'H200',replicas:1,cards:8,prefill:4000,decode:100,price:3,reserve:10,concurrency:2,batchGain:25};
const create=(extra={})=>G.create({settings,history:'recent',popularity:30,profile:{kind:'single',inputTokens:10000,outputTokens:1000},...extra});
const saved=g=>JSON.parse(JSON.stringify(g.save()));
test('RPS counts actual arrivals over (t-60s,t], including queued requests, not hardware utilization',()=>{
 const g=create();g.advanceTo(60000);assert.equal(g.inspect().requestsGenerated,30);assert.ok(g.inspect().queued>0);
 assert.deepEqual(g.inspect().traffic,{windowMs:60000,ready:true,requests:30,inboundRps:.5});
 g.setPopularity(0);g.advanceTo(62000);assert.equal(g.inspect().traffic.requests,29);g.advanceTo(120000);
 assert.equal(g.inspect().traffic.inboundRps,0);assert.ok(g.inspect().queued>0);
});
test('a partial first minute uses the same sixty-second window with no pre-opening traffic',()=>{
 const g=create();g.advanceTo(2000);assert.equal(g.inspect().traffic.requests,1);assert.equal(g.inspect().traffic.inboundRps,1/60);
});
test('incoming RPS is independent of GPU replica count and render frequency',()=>{
 const a=create(),b=create({settings:{...settings,replicas:4}});a.advanceTo(175999);
 for(let t=0;t<175999;t+=137)b.advanceTo(t);b.advanceTo(175999);
 assert.deepEqual(a.inspect().traffic,b.inspect().traffic);assert.deepEqual(G.restore(saved(a)).inspect(),a.inspect());
});
test('future OpenClaw calls count on arrival, even after new visitors are stopped',()=>{
 const g=create({popularity:60,profile:{kind:'openclaw'}});g.advanceTo(1000);g.setPopularity(0);
 assert.equal(g.inspect().requestsGenerated,6);assert.equal(g.inspect().traffic.requests,g.inspect().arrived);assert.ok(g.inspect().traffic.requests<6);
 const r=G.restore(saved(g));g.advanceTo(60000);r.advanceTo(60000);assert.deepEqual(r.inspect(),g.inspect());
 assert.equal(g.inspect().traffic.requests,4);g.advanceTo(70000);assert.equal(g.inspect().traffic.requests,5);g.advanceTo(125170);assert.equal(g.inspect().traffic.requests,0);
});
test('old replay journals recover exact RPS; old compact saves warm up without inventing history',()=>{
 const old=create({history:'full'});old.advanceTo(60000);const journal=saved(old);delete journal.traffic;
 assert.deepEqual(G.restore(journal,{history:'recent'}).inspect().traffic,old.inspect().traffic);
 const compact=create();compact.advanceTo(60000);const data=saved(compact);delete data.traffic;const r=G.restore(data);
 assert.equal(r.inspect().traffic.ready,false);assert.equal(r.inspect().traffic.inboundRps,null);
 r.advanceTo(120000);assert.equal(r.inspect().traffic.ready,true);assert.equal(r.inspect().traffic.inboundRps,.5);
});
test('corrupt RPS history or pending arrival metadata cannot be restored',()=>{
 const g=create({popularity:60,profile:{kind:'openclaw'}});g.advanceTo(1000);
 for(const mutate of [d=>d.traffic.since=1001,d=>d.traffic.arrivals=[-1],d=>d.traffic.arrivals=[],d=>d.traffic.arrivals.reverse()]){
  const d=saved(g);mutate(d);assert.throws(()=>G.restore(d),/traffic|Traffic/);
 }
});
test('the minute around rush hour blends actual arrivals instead of instantly reporting the new rate',()=>{
 const g=create({popularity:1});g.advanceTo(10*G.HOUR+30000);
 assert.equal(g.inspect().usersPerMinute,10);assert.equal(g.inspect().traffic.requests,6);assert.equal(g.inspect().traffic.inboundRps,.1);
 assert.notEqual(g.inspect().traffic.inboundRps,g.inspect().usersPerMinute/60);
});
