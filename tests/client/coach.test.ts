// VGM-056: the first-run coach. Pure state under node: one hint at a time, gone when the player does it, once per phone,
// never stacked with another row of the announcement slot, and a storage that throws never breaks the HUD.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Coach,COACH_KEY,DONE_MS,LEARNED_BY_SIGHT_MS,GAP_MS,LEGACY_KEYS,LESSONS,LESSON_ORDER,SNAP_DISTANCE,WALK_DISTANCE,WALK_LIGHT_MS,XP_NEAR,loadDone,resetSessionMemory,saveDone,wants,type CoachInput,type Lesson,type RowLesson} from '../../src/client/hud/coach.ts';
import {fakeView} from '../../src/client/hud/fixtures.ts';
import type {RunView} from '../../src/contract/view.ts';

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
  for(const lesson of Object.keys(LESSONS) as RowLesson[]){
    const copy=LESSONS[lesson];
    for(const line of [copy.text,copy.sub].filter(Boolean) as string[]){
      assert.ok(line.length<=46,`${lesson}: "${line}" fits one line of the slot`);
      // One written walk hint only: the waiting room's label (controls-phase.ts) says it, no row repeats it.
      assert.doesNotMatch(line,/andar|atira sozinha/i,`${lesson}: "${line}" does not repeat the lobby's walk label`);
      assert.doesNotMatch(line.replace(/\bXP\b/,''),/[A-ZÁÉÍÓÚÂÊÔÃÕ]{2}|·|→|—|\p{Extended_Pictographic}/u,`${lesson}: "${line}"`);
      assert.match(line,/^[A-ZÁÉÍÓÚ3]/,`${lesson}: sentence case`);
    }
  }
  assert.ok(!('walk' in LESSONS),'"andar" has no row in combat');
  assert.match(LESSONS.rescue.text,/caiu/);assert.match(LESSONS.rescue.sub!,/resgatar/);
  assert.match(LESSONS.chip.text,/\+\{n\}/,'the chip hint names the chip as it looks (+1, +2)');assert.match(LESSONS.xp.sub!,/turma/,'XP is the team\'s');
});

test('walk emits no toast: round 1 only lights the joystick, and the light goes at the first steps',()=>{
  resetSessionMemory();
  const coach=new Coach(memory());let now=0;
  const view=round1();
  assert.equal(coach.step(input(view),now),undefined,'no row for "andar"');
  assert.equal(coach.stick,true,'the joystick is lit from the first second');
  for(now=100;now<=3000;now+=100){
    assert.equal(coach.step(input(view,{hero:{x:.2,y:.1}}),now),undefined,`${now} ms: still no row`);
    assert.equal(coach.stick,true);
  }
  coach.step(input(view,{hero:{x:WALK_DISTANCE+.1,y:0}}),now+=100);
  assert.equal(coach.stick,false,'walked: the light goes at once');
  assert.ok(coach.done.has('walk'),'and it is learned');
  for(now+=100;now<=9000;now+=100){assert.equal(coach.step(input(view),now),undefined);assert.equal(coach.stick,false,'it never comes back');}
});

test('walk light ends at WALK_LIGHT_MS (6 s) even if the novice never walks; walking later still teaches it',()=>{
  resetSessionMemory();
  assert.equal(WALK_LIGHT_MS,6000);
  const coach=new Coach(memory());
  for(let now=0;now<WALK_LIGHT_MS;now+=100){coach.step(input(round1()),now);assert.equal(coach.stick,true,`${now} ms: lit`);}
  for(let now=WALK_LIGHT_MS;now<=20000;now+=100){
    assert.equal(coach.step(input(round1()),now),undefined);
    assert.equal(coach.stick,false,`${now} ms: gone after 6 s`);
  }
  assert.equal(coach.done.has('walk'),false,'not walked');
  coach.step(input(round1(),{hero:{x:WALK_DISTANCE+.1,y:0}}),20100);
  assert.ok(coach.done.has('walk'),'the first steps after the light still count');
  assert.equal(coach.stick,false);
});

test('walk never lights in round 2 or later, nor after a reconnection into a later round; it still learns there',()=>{
  for(const index of [2,3,6]){
    resetSessionMemory();
    const coach=new Coach(memory());
    const late:RunView={...round1(),round:{...round1().round!,index}};
    for(let now=0;now<=10000;now+=100){
      assert.equal(coach.step(input(late),now),undefined,`round ${index}: no row`);
      assert.equal(coach.stick,false,`round ${index}: no light`);
    }
    coach.step(input(late,{hero:{x:WALK_DISTANCE+.1,y:0}}),10100);
    assert.ok(coach.done.has('walk'),`round ${index}: walking still teaches it (the XP hint can follow)`);
  }
  // Round 1 lit for 2 s, then round 2 comes: the light goes with round 1.
  resetSessionMemory();
  const coach=new Coach(memory());
  coach.step(input(round1()),0);coach.step(input(round1()),2000);
  assert.equal(coach.stick,true);
  coach.step(input({...round1(),round:{...round1().round!,index:2}}),2100);
  assert.equal(coach.stick,false,'round 2: off');
});

test('the walk light holds no row and no row holds it: rescue and the chip show while it is lit',()=>{
  resetSessionMemory();
  const coach=new Coach(memory());
  const down=round1();down.players=[...down.players,{...down.players[0]!,id:'p2',hp:0,online:true,downed:{progress:0,bleedOutTick:2000}}];
  assert.deepEqual(coach.step(input(down,{banner:true}),0),undefined,'the banner holds the rescue row');
  assert.equal(coach.stick,true,'but not the light');
  assert.deepEqual(coach.step(input(down),100),{lesson:'rescue',done:false});
  assert.equal(coach.stick,true,'lit beside the rescue row');
  resetSessionMemory();
  const chip=new Coach(memory({[COACH_KEY]:JSON.stringify(['rescue'])}));
  assert.deepEqual(chip.step(input(round1(),{chip:true,blocked:false}),0),{lesson:'chip',done:false});
  assert.equal(chip.stick,true);
  chip.step(input(round1(),{blocked:true}),100);
  assert.equal(chip.stick,true,'a notice in the slot does not put the light out');
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
  const coach=new Coach(memory({[COACH_KEY]:JSON.stringify(['walk'])}));
  const drops=round1({pickups:[xpDrop]});
  assert.equal(coach.step(input(drops,{blocked:true}),0),undefined,'round banner up: wait');
  assert.equal(coach.step(input(drops),100)?.lesson,'xp');
  assert.equal(coach.step(input(drops,{blocked:true}),200),undefined,'a notice comes: the hint gives way at once');
  assert.equal(coach.step(input(drops),300),undefined,'and waits a beat before coming back');
  assert.equal(coach.step(input(drops),300+GAP_MS+10)?.lesson,'xp');
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
  assert.ok(coach.done.has('xp'),`the first run is over: seen ${LESSONS.xp.maxMs} ms (≥ ${LEARNED_BY_SIGHT_MS}) counts as learned`);
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
  coach.step(input(round1()),0);
  assert.equal(coach.stick,true,'private tab: the joystick still lights');
});

test('the coach sends nothing to the room and pauses nobody: no net, sim or timer imports',()=>{
  const src=readFileSync(new URL('../../src/client/hud/coach.ts',import.meta.url),'utf8');
  assert.doesNotMatch(src,/from '\.\.\/net\/|from '\.\.\/\.\.\/(sim|protocol|maps)\/|^import (?!type )[^;]*from '\.\.\/\.\.\/contract\/|setTimeout|setInterval|send\(/m);
});

test('"andar" lights from the first second (round 1 prepare too), banner or not; the rows wait for the banner',()=>{
  resetSessionMemory();
  const coach=new Coach(memory());
  const prep=fakeView('prepare',1);
  const start:RunView={...prep,round:{...prep.round!,index:1},offers:[],pickups:[],events:[]};
  assert.equal(coach.step(input(start,{banner:true}),0),undefined,'no row over the banner');
  assert.equal(coach.stick,true,'the joystick is lit under the "Intervalo!" banner');
  // XP waits for the banner to go, and asks only for drops near the hero.
  resetSessionMemory();
  const walked=new Coach(memory({[COACH_KEY]:JSON.stringify(['walk'])}));
  const drops=round1({pickups:[xpDrop]});
  assert.equal(walked.step(input(drops,{banner:true}),0),undefined,'the round name first');
  assert.equal(walked.step(input(drops),100)?.lesson,'xp');
  assert.equal(wants('xp',input(round1({pickups:[{...xpDrop,x:XP_NEAR+5}]})),true),false,'a drop off screen does not call the hint');
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

test('in and out in 3 s: a glimpse is not learning (the light comes back next run); its whole 6 s is',()=>{
  resetSessionMemory();
  const store=memory();
  const coach=new Coach(store);
  for(let now=0;now<=3000;now+=100){coach.step(input(round1()),now);assert.equal(coach.stick,true);}
  coach.endRun();
  assert.equal(coach.stick,false,'the run is over: off');
  assert.equal(coach.done.has('walk'),false,'3 s lit, never walked: still to learn');
  assert.equal(store.store.get(COACH_KEY),undefined,'nothing stored');
  resetSessionMemory();
  const again=new Coach(store);again.step(input(round1()),0);
  assert.equal(again.stick,true,'the next run lights it again');
  // The novice who stood through the whole light and then left: it counts (stored, the next run is quiet).
  resetSessionMemory();
  const stood=new Coach(store);
  for(let now=0;now<=WALK_LIGHT_MS+500;now+=100)stood.step(input(round1()),now);
  stood.endRun();
  assert.ok(stood.done.has('walk'));
  assert.deepEqual(JSON.parse(store.store.get(COACH_KEY)!),['walk']);
  resetSessionMemory();
  const quiet=new Coach(store);quiet.step(input(round1()),0);
  assert.equal(quiet.stick,false,'learned on this phone: no light');
});

test('two tabs of the same phone: saving joins what the other tab stored meanwhile',()=>{
  resetSessionMemory();
  const store=memory();
  const a=new Coach(store),b=new Coach(store);
  a.did('chip');a.step(input(round1()),0);
  resetSessionMemory();
  b.did('xp');b.step(input(round1()),0);
  assert.deepEqual(JSON.parse(store.store.get(COACH_KEY)!),['chip','xp'],'tab b did not erase tab a\'s chip');
});

test('the intermission window folded with "Depois" leaves the chip: its hint comes before gathering, and the tap teaches it',()=>{
  resetSessionMemory();
  const coach=new Coach(memory({[COACH_KEY]:JSON.stringify(['walk','xp','rescue'])}));
  const prep=fakeView('prepare',1);
  const view:RunView={...prep,round:{...prep.round!,index:2},offers:[],nodes:[{id:'n1',kind:'coco',x:4,y:4,remaining:4,capacity:4,value:1,progress:0}]};
  assert.equal(coach.step(input(view,{blocked:true}),0),undefined,'window open: nothing');
  assert.equal(coach.step(input(view,{chip:true}),100)?.lesson,'chip','folded into the chip: "Toca no +N pra escolher"');
  coach.did('chip');
  assert.deepEqual(coach.step(input(view,{chip:true}),200),{lesson:'chip',done:true});
});
