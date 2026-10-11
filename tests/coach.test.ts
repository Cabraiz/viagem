// VGM-056: the first-run coach. Pure state under node: one hint at a time, gone when the player does it, once per phone,
// never stacked with another row of the announcement slot, and a storage that throws never breaks the HUD.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Coach,COACH_KEY,DONE_MS,GAP_MS,LEGACY_KEYS,LESSONS,LESSON_ORDER,SNAP_DISTANCE,WALK_DISTANCE,XP_NEAR,loadDone,resetSessionMemory,saveDone,wants,type CoachInput,type Lesson} from '../src/game/hud/coach.ts';
import {fakeView} from '../src/game/hud/fixtures.ts';
import type {RunView} from '../src/game/sim/view.ts';

const memory=(seed:Record<string,string>={})=>{
  const store=new Map(Object.entries(seed));
  return {store,getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);}};
};
const broken={getItem:()=>{throw new Error('private');},setItem:()=>{throw new Error('quota');}};

/** Round 1 just started: one player (p1), no pickups, no offers. */
function round1(over:Partial<RunView>={}):RunView{
  const view=fakeView('wave',1);
  return {...view,round:{...view.round!,index:1},offers:[],pickups:[],events:[],...over};
}
const input=(view:RunView,extra:Partial<CoachInput>={}):CoachInput=>({view,localId:'p1',hero:{x:0,y:0},chip:false,blocked:false,...extra});
const xpDrop={id:'x1',kind:'xp' as const,x:3,y:0,value:1};

test('copy: house voice, short, sentence case, no "A · B", no emoji, one sticker each',()=>{
  for(const lesson of LESSON_ORDER){
    const copy=LESSONS[lesson];
    for(const line of [copy.text,copy.sub].filter(Boolean) as string[]){
      assert.ok(line.length<=46,`${lesson}: "${line}" fits one line of the slot`);
      assert.doesNotMatch(line.replace(/\bXP\b/,''),/[A-ZÁÉÍÓÚÂÊÔÃÕ]{2}|·|→|—|\p{Extended_Pictographic}/u,`${lesson}: "${line}"`);
      assert.match(line,/^[A-ZÁÉÍÓÚ3]/,`${lesson}: sentence case`);
    }
  }
  assert.match(LESSONS.walk.sub!,/atira sozinha/,'the walk hint says the weapons fire by themselves');
  assert.match(LESSONS.rescue.text,/caído/);assert.match(LESSONS.rescue.sub!,/resgatar/);
});

test('round 1: walk first; it stays while the novice stands 15 s and goes (with a check) once the hero walks',()=>{
  resetSessionMemory();
  const coach=new Coach(memory());let now=0;
  const view=round1();
  assert.deepEqual(coach.step(input(view),now),{lesson:'walk',done:false});
  for(now=100;now<=15000;now+=100)assert.equal(coach.step(input(view,{hero:{x:.2,y:.1}}),now)?.lesson,'walk','no time cap on walking');
  const walked=coach.step(input(view,{hero:{x:WALK_DISTANCE+.1,y:0}}),now+=100);
  assert.deepEqual(walked,{lesson:'walk',done:true},'the check shows at once (≤ 100 ms feedback)');
  assert.ok(coach.done.has('walk'));
  assert.deepEqual(coach.step(input(view),now+DONE_MS-50),{lesson:'walk',done:true});
  assert.equal(coach.step(input(view),now+DONE_MS+10),undefined,'then it goes');
});

test('then XP while drops lie on the map, gone at the first pickup; then the chip, gone at the tap',()=>{
  resetSessionMemory();
  const coach=new Coach(memory());let now=0;
  coach.step(input(round1()),now);coach.step(input(round1(),{hero:{x:2,y:0}}),now+=100);
  now+=DONE_MS+GAP_MS+10;coach.step(input(round1()),now);
  const drops=round1({pickups:[xpDrop]});
  assert.equal(coach.step(input(drops),now+=100)?.lesson,'xp');
  const picked=round1({pickups:[],events:[{type:'pickup',player:'p1',pickup:'x1',kind:'xp',value:1,eventId:9}]});
  assert.deepEqual(coach.step(input(picked),now+=100),{lesson:'xp',done:true});
  // Someone else's pickup does not count for this phone.
  resetSessionMemory();
  const other=new Coach(memory({[COACH_KEY]:JSON.stringify(['walk'])}));
  other.step(input(drops),0);
  assert.equal(other.step(input(round1({pickups:[xpDrop],events:[{type:'pickup',player:'p2',pickup:'x1',kind:'xp',value:1,eventId:3}]})),100)?.lesson,'xp');
  // The chip outranks XP; the tap (RunHud → did) ends it.
  now+=DONE_MS+GAP_MS+10;
  assert.equal(coach.step(input(round1(),{chip:true}),now)?.lesson,'chip');
  coach.did('chip');
  assert.deepEqual(coach.step(input(round1(),{chip:true}),now+=50),{lesson:'chip',done:true});
});

test('one row at a time: any other row of the slot (round banner, notice) holds the hint back, and danger wins',()=>{
  resetSessionMemory();
  const coach=new Coach(memory());
  assert.equal(coach.step(input(round1(),{blocked:true}),0),undefined,'round banner up: wait');
  assert.equal(coach.step(input(round1()),100)?.lesson,'walk');
  assert.equal(coach.step(input(round1(),{blocked:true}),200),undefined,'a notice comes: the hint gives way at once');
  assert.equal(coach.step(input(round1()),300),undefined,'and waits a beat before coming back');
  assert.equal(coach.step(input(round1()),300+GAP_MS+10)?.lesson,'walk');
});

test('rescue: a caído ally outranks the rest, ends when this phone rescues; downed or out, no lessons',()=>{
  resetSessionMemory();
  const coach=new Coach(memory({[COACH_KEY]:JSON.stringify(['walk'])}));
  const base=fakeView('wave',3);
  const view:RunView={...base,offers:[],pickups:[xpDrop],events:[],players:base.players.map(p=>p.id==='p3'?{...p,hp:0,online:true,downed:{progress:0,bleedOutTick:base.tick+200}}:p)};
  assert.equal(coach.step(input(view,{chip:true}),0)?.lesson,'rescue');
  const rescued={...view,events:[{type:'revived' as const,player:'p3',by:'p1',eventId:4}]};
  assert.deepEqual(coach.step(input(rescued),100),{lesson:'rescue',done:true});
  const me={...view,players:view.players.map(p=>p.id==='p1'?{...p,hp:0,downed:{progress:0,bleedOutTick:9e9}}:p)};
  for(const lesson of LESSON_ORDER)assert.equal(wants(lesson,input(me,{chip:true}),true),false,`${lesson}: not while this hero is caído`);
});

test('gathering (first intermission): the old tip, now in the coach; gone once the hero works a node',()=>{
  resetSessionMemory();
  const coach=new Coach(memory({[COACH_KEY]:JSON.stringify(['walk','xp','chip','rescue'])}));
  const prep=fakeView('prepare',1);
  const view:RunView={...prep,round:{...prep.round!,index:2},offers:[],nodes:[{id:'n1',kind:'coco',x:4,y:4,remaining:4,capacity:4,value:1,progress:0}]};
  assert.equal(coach.step(input(view),0)?.lesson,'gather');
  assert.equal(wants('gather',input({...view,camp:{...view.camp!,hornEndsTick:view.tick+100}}),true),false,'the horn takes the slot');
  const working={...view,nodes:[{...view.nodes![0],progress:.3}]};
  assert.deepEqual(coach.step(input(working,{hero:{x:4.5,y:4}}),100),{lesson:'gather',done:true});
});

test('timed hints stop after their time in a run; the result marks what was shown; the next run is quiet',()=>{
  resetSessionMemory();
  const store=memory({[COACH_KEY]:JSON.stringify(['walk'])});
  const coach=new Coach(store);
  const drops=round1({pickups:[xpDrop]});
  let now=0;let last;
  for(;now<=LESSONS.xp.maxMs!+1000;now+=100)last=coach.step(input(drops),now);
  assert.equal(last,undefined,'xp hint gone after its time');
  assert.equal(coach.done.has('xp'),false,'not learned yet: only shown');
  coach.endRun();
  assert.ok(coach.done.has('xp'),'the first run is over: shown counts as learned');
  assert.deepEqual(JSON.parse(store.store.get(COACH_KEY)!),['walk','xp']);
  assert.equal(coach.done.has('rescue'),false,'never shown (solo): waits for a group run');
  const next=new Coach(store);
  assert.equal(next.step(input(drops),0),undefined,'second run of the phone: nothing to say');
});

test('storage: once per phone, legacy hints count, and a storage that throws only keeps it in memory',()=>{
  resetSessionMemory();
  assert.deepEqual([...loadDone(memory({[LEGACY_KEYS.chip!]:'1',[LEGACY_KEYS.gather!]:'1'}))].sort(),['chip','gather']);
  assert.deepEqual([...loadDone(memory({[COACH_KEY]:'{oops'}))],[],'broken value: start over, no throw');
  assert.doesNotThrow(()=>loadDone(broken));
  assert.doesNotThrow(()=>saveDone(new Set<Lesson>(['walk']),broken));
  assert.ok(loadDone(broken).has('walk'),'private tab: remembered for this page');
  resetSessionMemory();
  const coach=new Coach(broken);
  assert.equal(coach.step(input(round1()),0)?.lesson,'walk','private tab: the hints still show');
});

test('the coach sends nothing to the room and pauses nobody: no net, sim or timer imports',()=>{
  const src=readFileSync(new URL('../src/game/hud/coach.ts',import.meta.url),'utf8');
  assert.doesNotMatch(src,/from '\.\.\/net\/|from '\.\.\/sim\/(?!view)|setTimeout|setInterval|send\(/);
});

test('"andar" from the first second (round 1 prepare too) and over the street banner; the others wait for the banner',()=>{
  resetSessionMemory();
  const coach=new Coach(memory());
  const prep=fakeView('prepare',1);
  const start:RunView={...prep,round:{...prep.round!,index:1},offers:[],pickups:[],events:[]};
  assert.deepEqual(coach.step(input(start,{banner:true}),0),{lesson:'walk',done:false},'the "Intervalo!" banner does not hold "andar"');
  assert.equal(LESSONS.walk.overBanner,true);
  for(const lesson of LESSON_ORDER.filter(l=>l!=='walk'))assert.ok(!LESSONS[lesson].overBanner,`${lesson} waits for the banner`);
  // XP waits for the banner to go, and asks only for drops near the hero.
  resetSessionMemory();
  const walked=new Coach(memory({[COACH_KEY]:JSON.stringify(['walk'])}));
  const drops=round1({pickups:[xpDrop]});
  assert.equal(walked.step(input(drops,{banner:true}),0),undefined,'the round name first');
  assert.equal(walked.step(input(drops),100)?.lesson,'xp');
  assert.equal(wants('xp',input(round1({pickups:[{...xpDrop,x:XP_NEAR+5}]})),true),false,'a drop off screen does not call the hint');
  // From round 2 on the banner may be a zueira event or the boss: even "andar" waits for it.
  resetSessionMemory();
  const late=new Coach(memory());
  const wave2:RunView={...round1(),round:{...round1().round!,index:2}};
  assert.equal(late.step(input(wave2,{banner:true}),0),undefined,'round 2: the zueira banner keeps its turn');
  assert.equal(late.step(input(wave2),100)?.lesson,'walk');
});

test('a snap of the predicted hero (spawn, reconnection) is not a step: the walk is measured from where it landed',()=>{
  resetSessionMemory();
  const coach=new Coach(memory());
  coach.step(input(round1(),{hero:{x:0,y:0}}),0);
  coach.step(input(round1(),{hero:{x:SNAP_DISTANCE+3,y:0}}),50);
  assert.equal(coach.done.has('walk'),false,'teleported, not walked');
  coach.step(input(round1(),{hero:{x:SNAP_DISTANCE+3+WALK_DISTANCE/2,y:0}}),100);
  assert.equal(coach.done.has('walk'),false);
  coach.step(input(round1(),{hero:{x:SNAP_DISTANCE+3+WALK_DISTANCE+.1,y:0}}),150);
  assert.ok(coach.done.has('walk'),'then a real step counts');
});
