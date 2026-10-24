import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../../multiplayer/simulation.ts';
import {RunLifecycle} from '../../src/sim/run.ts';
import type {StampedEvent} from '../../src/sim/core.ts';
import {Rng} from '../../src/contract/rng.ts';
import {ticks,type SimEvent} from '../../src/contract/types.ts';
import {
  EVENT_DELAY,EVENT_GAP,FIRST_EVENT_ROUND,HAPPENING_SECONDS,MAX_EVENTS_PER_RUN,PLANNED_KINDS,PROMO_COXINHAS,
  createZueiraState,parseZueiraLab,planHappenings,
} from '../../src/sim/zueira.ts';
import {ShameTracker,SHAME_SCORE,worse,type ShameMoment} from '../../src/sim/shame.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';

test('plan: events from round 2, never in round 1 or the boss round, never back to back, at most 4, one blackout, no rain', ()=>{
  const counts={boletos:0,promo:0,apagao:0},sizes=new Map<number,number>();
  for(let seed=1;seed<=500;seed++){
    const plan=planHappenings(new Rng(seed).fork('zueira'));
    sizes.set(plan.length,(sizes.get(plan.length)??0)+1);
    assert.ok(plan.length===3&&plan.length<=MAX_EVENTS_PER_RUN,`seed ${seed}: ${plan.length}`);
    assert.ok(plan[0].round>=FIRST_EVENT_ROUND&&plan[0].round<=FIRST_EVENT_ROUND+1);
    for(const [i,p] of plan.entries()){
      assert.ok(p.round>=2&&p.round<=9,`round ${p.round}`);
      if(i)assert.ok(p.round-plan[i-1].round>=EVENT_GAP[0]&&p.round-plan[i-1].round<=EVENT_GAP[1]);
      counts[p.kind]++;
    }
    // The two kinds come first (each once), then another sale (NEW-20261024-ORQ-tirar-drops-cedula-girando: no boleto rain).
    assert.deepEqual(new Set(plan.slice(0,2).map(p=>p.kind)),new Set(PLANNED_KINDS));
    assert.equal(plan[2].kind,'promo');
    assert.equal(plan.filter(p=>p.kind==='apagao').length,1);
    assert.deepEqual(createZueiraState(seed).plan,createZueiraState(seed).plan,'same seed, same plan');
  }
  assert.equal(counts.apagao,500);
  assert.deepEqual([counts.boletos,counts.promo],[0,1000]);
});

test('lab plan: LAB_ZUEIRA "apagao,promo" plays them from round 2, one per round (the retired rain is ignored)', ()=>{
  assert.deepEqual(parseZueiraLab('apagao, boletos,promo,xyz'),{plan:[{round:2,kind:'apagao'},{round:3,kind:'promo'}],minGap:1});
  assert.equal(parseZueiraLab('boletos'),undefined);
  assert.equal(parseZueiraLab(''),undefined);assert.equal(parseZueiraLab(undefined),undefined);
});

test('run order: zueira right after the director, before the pickups', ()=>{
  const order=[...RUN_ORDER];
  assert.equal(order.indexOf('zueira'),order.indexOf('director')+1);
  assert.ok(order.indexOf('zueira')<order.indexOf('pickups'));
});

/** Invulnerable standing bots, every critter dies 3 s after it shows up (a round lasts long enough for its event). */
function labRun(seed:number,plan='apagao,promo',bots=3,untilRound=5){
  const sim=new Simulation(seed);
  sim.zueiraLab=parseZueiraLab(plan);
  const ids=Array.from({length:bots},(_,i)=>`bot${i}`);
  ids.forEach((id,i)=>sim.add(id,`Bot ${i}`,'cidadao-comum'));
  sim.resetRun();
  const boss=sim.run.boss,original=boss.step.bind(boss);
  (boss as {step:typeof boss.step}).step=ctx=>{
    original(ctx);
    for(const e of [...ctx.enemies.values()])if(ctx.tick-e.spawnTick>60&&ctx.tick%7===0)ctx.damageEnemy(e.id,1e6,ids[ctx.tick%ids.length]);
  };
  const events:StampedEvent[]=[],xpByTick:number[]=[],waveTicks=new Map<number,number>();
  for(let t=0;t<20*60*20;t++){
    for(const p of sim.players.values())p.invulnerableUntil=sim.tick+40;
    for(const e of sim.step()){events.push({...e});if(e.type==='round'&&e.phase==='wave')waveTicks.set(e.index,sim.tick);}
    xpByTick.push(sim.world.team.xp);
    for(const id of ids){const o=sim.offers(id)[0];if(o)sim.choose(id,o.id,o.defaultIndex);}
    if(sim.world.round.index>untilRound||sim.outcome)break;
  }
  return {sim,ids,events,xpByTick,waveTicks};
}

test('lab run: each event fires in its round, in the middle of the wave, with what it promises', ()=>{
  const {sim,events,waveTicks}=labRun(7);
  const happenings=events.filter((e):e is StampedEvent&Extract<SimEvent,{type:'happening'}>=>e.type==='happening');
  assert.deepEqual(happenings.map(e=>e.kind),['apagao','promo']);
  const fired=sim.run.zueira.state.fired;
  assert.deepEqual(fired.map(f=>f.round),[2,3]);
  for(const f of fired){
    // Between 8 and 16 s after its wave started (the round event is stamped with the tick through the order of events).
    const h=happenings.find(e=>e.kind===f.kind)!;
    assert.equal(h.endsTick-f.tick,ticks(HAPPENING_SECONDS[f.kind]));
    const waveAt=waveTicks.get(f.round)!;
    assert.ok(f.tick-waveAt>=ticks(EVENT_DELAY[0])&&f.tick-waveAt<=ticks(EVENT_DELAY[1])+1,`round ${f.round}: ${f.tick-waveAt} ticks`);
  }
  // The sale's coxinhas and the kills' cédulas are picked up; nothing is XP on the ground any more.
  const pickups=events.filter(e=>e.type==='pickup');
  assert.ok(pickups.length>0);
  assert.ok(!pickups.some(e=>e.type==='pickup'&&e.kind==='xp'),'no XP pickup');
  assert.equal(sim.run.zueira.state.plan.length,0,'nothing left to happen');
});

test('the sale drops what it says: coxinhas heal and go away after 8 s; nothing falls as XP', ()=>{
  const seed=11,sim=new Simulation(seed);
  sim.zueiraLab=parseZueiraLab('promo');
  for(let i=0;i<2;i++)sim.add(`b${i}`,`B${i}`,'cidadao-comum');
  sim.resetRun();
  let xp=0,coxinhas=0,coxinhaLife=0,promoStart=-1;
  for(let t=0;t<20*60*6&&sim.world.round.index<=3;t++){
    for(const p of sim.players.values())p.invulnerableUntil=sim.tick+40;
    for(const e of sim.step()){
      if(e.type==='happening'&&e.kind==='promo'){
        promoStart=sim.tick;
        const fresh=[...sim.world.pickups.values()].filter(p=>p.kind==='heal'&&p.spawnTick===sim.tick);
        coxinhas=fresh.length;coxinhaLife=Math.max(...fresh.map(p=>p.expiresTick!-p.spawnTick));
      }
    }
    for(const p of sim.world.pickups.values())if(p.kind==='xp')xp++;
    for(const id of ['b0','b1']){const o=sim.offers(id)[0];if(o)sim.choose(id,o.id,o.defaultIndex);}
    for(const e of [...sim.world.enemies.values()])if(sim.tick-e.spawnTick>60)sim.world.enemies.delete(e.id);
  }
  assert.ok(promoStart>0,`sale ${promoStart}`);
  assert.equal(xp,0,'no XP on the ground');
  assert.ok(coxinhas>=PROMO_COXINHAS&&coxinhas<=2*PROMO_COXINHAS,`coxinhas ${coxinhas}`);
  assert.equal(coxinhaLife,ticks(HAPPENING_SECONDS.promo));
});

test('seed plan in a real run: each planned event fires in its round (no lab)', ()=>{
  // The round table's nine kinds: with this seed their crowd is around the hero when the blackout is due (with the D-040
  // rotation's layout it may pass behind the next kind, as designed, which this order check does not model).
  const sim=new Simulation(5,{rotation:false});
  sim.add('a','A','cidadao-comum');sim.resetRun();
  const plan=sim.run.zueira.state.plan.map(p=>({...p}));
  const fired:{round:number;kind:string}[]=[];
  for(let t=0;t<20*60*20&&!sim.outcome&&sim.world.round.index<10;t++){
    sim.players.get('a')!.invulnerableUntil=sim.tick+40;
    for(const e of sim.step())if(e.type==='happening')fired.push({round:sim.world.round.index,kind:e.kind});
    for(const e of [...sim.world.enemies.values()])if(!e.boss&&sim.tick-e.spawnTick>40)sim.world.damageEnemy(e.id,1e6,'a');
    const o=sim.offers('a')[0];if(o)sim.choose('a',o.id,o.defaultIndex);
  }
  // Same kinds in the same order; each one in its planned round or later (the blackout waits for critters around).
  assert.deepEqual(fired.map(f=>f.kind),plan.slice(0,fired.length).map(p=>p.kind));
  assert.ok(fired.length>=plan.length-1,`${fired.length} of ${plan.length}`);
  fired.forEach((f,i)=>{assert.ok(f.round>=plan[i].round);if(i)assert.ok(f.round-fired[i-1].round>=2);});
});

import {defaultTerrain} from '../../src/maps/terrain/field.ts';
import {createZueira} from '../../src/sim/zueira.ts';
import {BASE_STATS} from '../../src/contract/types.ts';
/** A bare context for the zueira system alone: one hero on the island, a round we drive by hand. */
function fakeCtx(heroes=1,nextXp=25){
  const emitted:SimEvent[]=[];let n=0;
  const players=new Map(Array.from({length:heroes},(_,i)=>[`h${i}`,{id:`h${i}`,x:12+(i%3)*.8,y:12+Math.floor(i/3)*.8,hp:100,online:true,spectator:false,stats:{...BASE_STATS}} as Record<string,unknown>]));
  const ctx={tick:0,terrain:defaultTerrain,round:{index:0,total:10,phase:'prepare' as 'prepare'|'wave',phaseEndsTick:0,remaining:0},
    team:{xp:0,level:2,nextXp},players,enemies:new Map(),
    pickups:new Map<string,{kind:string;value:number;resource?:string}>(),nextId:(p:string)=>`${p}-${++n}`,emit:(e:SimEvent)=>{emitted.push(e);}};
  return {ctx:ctx as never as Parameters<ReturnType<typeof createZueira>['step']>[0]&typeof ctx,emitted};
}
function play(z:ReturnType<typeof createZueira>,c:ReturnType<typeof fakeCtx>,index:number,waveTicks:number){
  const {ctx}=c;
  Object.assign(ctx.round,{index,phase:'wave',remaining:5});
  for(let i=0;i<waveTicks;i++){ctx.tick++;z.step(ctx);}
  Object.assign(ctx.round,{phase:'prepare',remaining:0});z.roundEnded(ctx,{index,total:10,timedOut:false},0);
  for(let i=0;i<20;i++){ctx.tick++;z.step(ctx);}
}

test('a round that ends before its event passes it on; never two rounds in a row', ()=>{
  const z=createZueira(1,{lab:{plan:[{round:2,kind:'promo'},{round:3,kind:'promo'}],minGap:EVENT_GAP[0]}}),c=fakeCtx();
  play(z,c,2,ticks(EVENT_DELAY[0])-1);
  assert.deepEqual(c.emitted.filter(e=>e.type==='happening'),[],'round 2 ended before 8 s');
  play(z,c,3,ticks(EVENT_DELAY[1])+1);
  assert.deepEqual(c.emitted.filter(e=>e.type==='happening').map(e=>e.type==='happening'&&e.kind),['promo'],'carried to round 3');
  play(z,c,4,ticks(EVENT_DELAY[1])+1);
  assert.equal(c.emitted.filter(e=>e.type==='happening').length,1,'round 4 is right after: the next sale waits');
  play(z,c,5,ticks(EVENT_DELAY[1])+1);
  assert.deepEqual(z.state.fired.map(f=>[f.round,f.kind]),[[3,'promo'],[5,'promo']]);
  // The boss round never gets one.
  const b=createZueira(1,{lab:{plan:[{round:10,kind:'promo'}],minGap:1}}),d=fakeCtx();
  play(b,d,10,ticks(30));
  assert.equal(b.state.fired.length,0);
});

test('the retired rain (a checkpoint planned before it was retired) is skipped: no banner, nothing falls, the next event still comes', ()=>{
  const z=createZueira(3,{lab:{plan:[{round:2,kind:'boletos'},{round:3,kind:'promo'}],minGap:1}}),c=fakeCtx(),{ctx}=c;
  play(z,c,2,ticks(EVENT_DELAY[1])+2);
  assert.deepEqual(c.emitted.filter(e=>e.type==='happening'),[]);
  assert.equal(ctx.pickups.size,0);assert.equal(z.state.active,undefined);
  assert.deepEqual(z.state.plan.map(p=>p.kind),['promo']);
  play(z,c,3,ticks(EVENT_DELAY[1])+2);
  assert.deepEqual(z.state.fired.map(f=>[f.round,f.kind]),[[3,'promo']]);
});

test('the blackout waits for critters around (eyes to see), and never blocks the next event when none come', ()=>{
  const z=createZueira(4,{lab:{plan:[{round:2,kind:'apagao'},{round:3,kind:'promo'}],minGap:1}}),c=fakeCtx(),{ctx}=c;
  play(z,c,2,ticks(EVENT_DELAY[1])+40);
  assert.equal(z.state.fired.length,0,'no critter near the hero: no blackout in round 2');
  assert.deepEqual(z.state.plan.map(p=>p.kind),['promo','apagao'],'the blackout goes behind the next kind');
  play(z,c,3,ticks(EVENT_DELAY[1])+2);
  assert.deepEqual(z.state.fired.map(f=>[f.round,f.kind]),[[3,'promo']]);
  Object.assign(ctx.round,{index:4,phase:'wave',remaining:5});
  for(let i=0;i<3;i++)(ctx.enemies as Map<string,unknown>).set(`e${i}`,{id:`e${i}`,kind:'bebado',x:13+i*.3,y:12,hp:5});
  for(let i=0;i<ticks(EVENT_DELAY[1])+2;i++){ctx.tick++;z.step(ctx);}
  assert.deepEqual(z.state.fired.map(f=>[f.round,f.kind]),[[3,'promo'],[4,'apagao']]);
});

test('the sale stops when the wave ends early', ()=>{
  const z=createZueira(2,{lab:{plan:[{round:2,kind:'promo'}],minGap:1}}),c=fakeCtx();
  const {ctx}=c;
  Object.assign(ctx.round,{index:2,phase:'wave',remaining:5});
  while(!z.state.active){ctx.tick++;z.step(ctx);}
  const at=ctx.tick;
  for(let i=0;i<10;i++){ctx.tick++;z.step(ctx);}
  const dropped=ctx.pickups.size;assert.ok(dropped>=2);
  Object.assign(ctx.round,{phase:'prepare',remaining:0});z.roundEnded(ctx,{index:2,total:10,timedOut:true},0);
  for(let i=0;i<40;i++){ctx.tick++;z.step(ctx);}
  assert.equal(z.state.active,undefined);assert.equal(ctx.pickups.size,dropped,'nothing more in the intermission');
  assert.equal(z.activeAt(at+20),undefined);
  assert.ok(!c.emitted.some(e=>e.type==='last-bicho'),'a timed-out round has no kill-cam');
});

test('kill-cam: the round\'s last critter goes out to everyone, where it fell and who closed the bill', ()=>{
  const {events}=labRun(9,'',2,3);
  const ends=events.filter(e=>e.type==='round'&&e.phase==='end');
  const cams=events.filter((e):e is StampedEvent&Extract<SimEvent,{type:'last-bicho'}>=>e.type==='last-bicho');
  assert.ok(ends.length>=3);
  const ended=ends.map(e=>e.type==='round'?e.index:0);
  assert.ok(cams.length>=1&&cams.length<=4,`${cams.length} kill-cams`);
  for(const [i,c] of cams.entries()){assert.ok(ended.includes(c.round)&&c.round<10);if(i)assert.ok(c.round-cams[i-1].round>=2,'never two rounds in a row');}
  for(const cam of cams){
    const kill=events.findLast(e=>e.type==='kill'&&e.eventId<cam.eventId);
    assert.ok(kill&&kill.type==='kill');
    assert.equal(cam.kind,kill.kind);assert.equal(cam.x,kill.x);assert.equal(cam.y,kill.y);assert.equal(cam.by,kill.by);
  }
});

test('determinism: same seed, same events and the same stateHash with the zueira on', ()=>{
  const a=labRun(13,'apagao,promo',2,4),b=labRun(13,'apagao,promo',2,4);
  const pick=(r:typeof a)=>r.events.filter(e=>e.type==='happening'||e.type==='last-bicho'||(e.type==='pickup'));
  assert.deepEqual(pick(a),pick(b));
  assert.equal(a.sim.stateHash(),b.sim.stateHash());
});

// ---------- Momento mais vergonhoso ----------
const world=(tick:number,round:number)=>({tick,round:{index:round,total:10,phase:'wave' as const,phaseEndsTick:0,remaining:5},
  players:new Map([['p1',{id:'p1',x:0,y:0,hp:50,online:true,spectator:false,stats:{maxHp:100}}],['p2',{id:'p2',x:5,y:5,hp:100,online:true,spectator:false,stats:{maxHp:100}}]]) as never,
  pickups:new Map() as never});

test('shame: the most embarrassing moment wins, ties go to the earliest', ()=>{
  const s=new ShameTracker();
  s.observe(world(10,3),[{type:'downed',player:'p2',source:'bebado'}]);
  assert.equal(s.moment?.key,'caiu');
  s.observe(world(20,3),[{type:'downed',player:'p1',source:'pombos'}]);
  assert.deepEqual(s.moment,{player:'p1',key:'pombos',round:3,tick:20,source:'pombos'});
  // Rescued, and down again 3 s later: worse.
  s.observe(world(30,3),[{type:'revived',player:'p1',by:'p2'}]);
  s.observe(world(90,3),[{type:'downed',player:'p1',source:'bebado'}]);
  assert.equal(s.moment?.key,'recaida');assert.equal(s.moment?.seconds,3);
  // A later blackout fall scores below a recaída: it stays.
  s.observe(world(200,4),[{type:'downed',player:'p2',source:'agiota'}],{kind:'apagao',round:4,startTick:190,endsTick:250});
  assert.equal(s.moment?.key,'recaida');
  s.reset();assert.equal(s.moment,undefined);
  const a:ShameMoment={player:'b',key:'cedo',round:1,tick:5},b:ShameMoment={player:'a',key:'cedo',round:1,tick:5};
  assert.ok(worse(b,a)&&!worse(a,b),'same score and tick: smaller id');
  assert.ok(SHAME_SCORE.recaida>SHAME_SCORE.apagao&&SHAME_SCORE.apagao>SHAME_SCORE.caiu);
});

test('shame: blackout falls, coxinha at full life and a coxinha on the floor', ()=>{
  const s=new ShameTracker();
  // Full life, then a coxinha.
  s.observe(world(1,2),[]);
  const full=world(2,2);(full.players as unknown as Map<string,{hp:number}>).get('p2')!.hp=100;
  s.observe(full,[{type:'pickup',player:'p2',pickup:'heal-1',kind:'heal',value:30}]);
  assert.equal(s.moment?.key,'coxinha-cheia');
  // Down in the dark beats it.
  s.observe(world(3,5),[{type:'downed',player:'p1',source:'bebado'}],{kind:'apagao',round:5,startTick:1,endsTick:60});
  assert.equal(s.moment?.key,'apagao');
  // A coxinha 1 unit away when you fall beats nothing above 50... but a blackout (55) still wins.
  const w=world(4,5);(w.pickups as unknown as Map<string,unknown>).set('heal-2',{id:'heal-2',kind:'heal',x:1,y:0,value:30});
  s.observe(w,[{type:'downed',player:'p2',source:'bebado'}]);
  assert.equal(s.moment?.key,'apagao');
  const t=new ShameTracker();t.observe(w,[{type:'downed',player:'p1',source:'bebado'}]);assert.equal(t.moment?.key,'coxinha');
});

test('result: the room hands the moment with the result, and a rematch clears it', ()=>{
  const run=new RunLifecycle('sala',100);
  run.join('a');run.ready('a',1,true);
  for(let i=0;i<70;i++)run.step();
  assert.equal(run.snapshot().phase,'combat');
  assert.equal(run.snapshot().shame,undefined);
  run.finish('defeat',{player:'a',key:'cedo',round:1,tick:40});
  assert.deepEqual(run.snapshot().shame,{player:'a',key:'cedo',round:1,tick:40});
  run.rematch('a',1);assert.equal(run.snapshot().shame,undefined);
  // A timeout carries the moment too.
  const t=new RunLifecycle('sala',5);t.join('a');t.ready('a',1,true);
  for(let i=0;i<70;i++)t.step({player:'a',key:'caiu',round:1,tick:3});
  assert.equal(t.snapshot().outcome,'timeout');assert.equal(t.snapshot().shame?.key,'caiu');
});

test('simulation: a fall in round 1 is the run\'s moment, sent with every view of the result', ()=>{
  const sim=new Simulation(3);sim.add('a','A','cidadao-comum');sim.add('b','B','cidadao-comum');sim.resetRun();
  for(let t=0;t<2000&&!sim.shameMoment();t++){
    sim.players.get('b')!.invulnerableUntil=sim.tick+40;
    sim.step();
    if(sim.world.round.phase==='wave'&&sim.tick%20===0)sim.world.damagePlayer('a',1000,'bebado');
  }
  const m=sim.shameMoment();
  assert.ok(m);assert.equal(m.player,'a');assert.equal(m.key,'cedo');assert.equal(m.round,1);
});
