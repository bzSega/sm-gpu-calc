import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),B=require('../playground/startup.js'),L=require('../playground/lessons.js');
test('six lessons require observed service outcomes and an explanation, with no simulation side effects',()=>{
 const game=B.create(),guide=L.create();const observe=event=>{const before=game.save();guide.observe(game.inspect(),game.records(),event);assert.deepEqual(game.save(),before);};
 const pass=answer=>{assert.equal(guide.inspect().ready,true);assert.equal(guide.answer(answer).correct,true);guide.next();};
 observe();assert.equal(guide.inspect().ready,false);assert.throws(()=>guide.answer(0));
 game.install('H200',3);game.useModel('flash');observe();assert.equal(guide.answer(1).correct,false);assert.equal(guide.inspect().index,0);pass(0);
 game.open();game.advanceTo(60000);observe();assert.equal(guide.inspect().ready,false);observe({type:'gpu'});pass(1);
 game.setPopularity(60);game.advanceTo(150000);observe();assert.equal(guide.inspect().flags.slotsSeen,true);assert.equal(guide.inspect().ready,false);
 game.setPopularity(0);game.advanceTo(2000000);observe();pass(0);
 game.setTaskProfile('document');observe();assert.equal(guide.inspect().ready,false);game.setPopularity(60);game.advanceTo(2001000);game.setPopularity(0);game.advanceTo(2201000);observe();
 assert.ok(guide.inspect().longKV>guide.inspect().shortKV);pass(1);
 game.setPopularity(60);game.advanceTo(2206000);observe();assert.equal(game.inspect().live.waitingReason,'memory');assert.equal(guide.inspect().flags.memorySeen,true);assert.equal(guide.inspect().ready,false);
 game.setPopularity(0);game.maintain(1,'H200',4);game.advanceTo(3206000);observe();pass(1);
 game.setTaskProfile('short');const before=game.inspect().copies[0].settings.concurrency;game.setConcurrency(1,4);observe({type:'launch',copy:1,before,limit:4});assert.equal(guide.inspect().ready,false);
 game.setPopularity(60);game.advanceTo(3266000);observe();pass(0);assert.equal(guide.inspect().done,true);
 assert.deepEqual(L.create(JSON.parse(JSON.stringify(guide.save()))).inspect(),guide.inspect());
});
test('sandbox toggle preserves evidence and cannot change the running service',()=>{
 const guide=L.create(),g=B.create();g.install('H200',8);g.useModel('flash');g.open();g.advanceTo(60000);guide.observe(g.inspect(),g.records());const before=g.save(),facts=guide.inspect().flags;
 guide.setEnabled(false);guide.observe(g.inspect(),g.records());guide.setEnabled(true);assert.deepEqual(guide.inspect().flags,facts);assert.deepEqual(g.save(),before);
});
test('malformed learning imports are rejected and language copies remain complete',()=>{
 const guide=L.create(),saved=guide.save();for(const bad of [{...saved,index:7},{...saved,enabled:'yes'},{...saved,shortKV:NaN},{...saved,launch:{copy:65,limit:4,time:0}},{...saved,flags:{}}])assert.throws(()=>L.create(bad));
 for(const lang of ['ru','en']){const lesson=guide.lesson(lang);assert.equal(lesson.answers.length,2);assert.ok(lesson.task);assert.ok(lesson.explanation);}
});
test('answer feedback distinguishes wrong attempts from accepted answers and survives restore',()=>{
 const game=B.create(),guide=L.create();game.install('H200',8);game.useModel('flash');guide.observe(game.inspect());
 const wrong=guide.answer(1);assert.equal(wrong.correct,false);assert.ok(wrong.explanation);assert.equal(guide.inspect().answered,false);assert.deepEqual(guide.inspect().feedback,{answer:1,correct:false});assert.throws(()=>guide.next());
 guide.answer(1);assert.deepEqual(guide.inspect().attempts,[1]);assert.deepEqual(L.create(JSON.parse(JSON.stringify(guide.save()))).inspect(),guide.inspect());
 const correct=guide.answer(0);assert.equal(correct.correct,true);assert.equal(correct.explanation,wrong.explanation);assert.deepEqual(guide.inspect().attempts,[1,0]);assert.deepEqual(guide.inspect().feedback,{answer:0,correct:true});assert.throws(()=>guide.answer(1),/already accepted/);
 const restored=L.create(JSON.parse(JSON.stringify(guide.save())));assert.deepEqual(restored.inspect(),guide.inspect());restored.next();assert.deepEqual(restored.inspect().attempts,[]);assert.equal(restored.inspect().feedback,null);
});
test('older accepted-answer saves migrate to a marked correct answer without replaying an attempt',()=>{
 const game=B.create(),guide=L.create();game.install('H200',8);game.useModel('flash');guide.observe(game.inspect());guide.answer(0);
 const legacy=guide.save();delete legacy.attempts;delete legacy.lastAnswer;const restored=L.create(legacy);assert.equal(restored.inspect().answered,true);assert.deepEqual(restored.inspect().feedback,{answer:0,correct:true});assert.deepEqual(restored.inspect().attempts,[0]);
});
test('contradictory answer-feedback data is rejected when loading a save',()=>{
 const saved=L.create().save();for(const bad of [{...saved,attempts:[8],lastAnswer:8},{...saved,attempts:[1,1],lastAnswer:1},{...saved,attempts:[0],lastAnswer:0},{...saved,answered:true,attempts:[1],lastAnswer:1}])assert.throws(()=>L.create(bad));
});
test('already accepted legacy questions stay advanceable when a later evidence flag was absent',()=>{
 const saved=L.create().save();saved.index=1;saved.answered=true;delete saved.attempts;delete saved.lastAnswer;delete saved.flags.gpuSeen;saved.flags.reply=true;
 const guide=L.create(saved);assert.equal(guide.inspect().ready,true);assert.deepEqual(guide.inspect().feedback,{answer:1,correct:true});guide.next();assert.equal(guide.inspect().index,2);
});
