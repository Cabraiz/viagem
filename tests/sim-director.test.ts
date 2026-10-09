import test from 'node:test';
import assert from 'node:assert/strict';
import {TerrainField} from '../src/game/terrain/field.ts';
import {SPAWN,findPath,walkable,type Point} from '../src/game/world.ts';
import {Rng} from '../src/game/sim/rng.ts';
import {BASE_STATS,SIM_HZ,ticks,type EnemyState,type RoundState,type SimContext,type SimEvent,type SimPlayer} from '../src/game/sim/types.ts';
import {coastalSpawnPoints,createDirector,type DirectorOptions,type RoundSummary} from '../src/game/sim/director.ts';
import {BOSS_ROUND_NAMES,ELITE_ROUND_NAMES,MAX_ROUND_ENEMIES,MODIFIERS,RETREAT_LINES,ROUNDS,ROUND_COUNT,ROUND_NAMES,THREAT,drawTheme,modifierLabel,planRound,playerScale,type RegularKind,type RoundPlan} from '../src/game/sim/waves.ts';

type FakeCtx=SimContext&{tick:number;ids:number;events:SimEvent[];sentAt:number[];round:RoundState;players:Map<string,SimPlayer>};

function fakeCtx(seed:number,terrain=new TerrainField(seed)):FakeCtx{
  const round:RoundState={index:0,total:0,phase:'prepare',phaseEndsTick:0,remaining:0};
  const ctx:FakeCtx={
    tick:0,ids:0,terrain,rng:new Rng(seed),events:[],sentAt:[],
    players:new Map(),enemies:new Map(),pickups:new Map(),projectiles:new Map(),telegraphs:new Map(),
    team:{xp:0,level:1,nextXp:5},offers:new Map(),round,
    enemyIndex:{rebuild(){},query:()=>[],nearest:()=>undefined},
    nextId:prefix=>`${prefix}-${++ctx.ids}`,
    emit(event){ctx.events.push(event);ctx.sentAt.push(ctx.tick);},
    damageEnemy(id,amount){
      const e=ctx.enemies.get(id);if(!e)return false;
      e.hp-=amount;if(e.hp>0)return false;
      ctx.enemies.delete(id);ctx.emit({type:'kill',enemy:id,kind:e.kind,x:e.x,y:e.y});return true;
    },
    damagePlayer(){},
  };
  return ctx;
}

function addPlayer(ctx:FakeCtx,id:string,p:Point,extra:Partial<SimPlayer>={}){
  ctx.players.set(id,{id,classId:'x',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS},weaponReady:{},...p,...extra});
}

interface Log {created:{tick:number;round:number;kind:string;x:number;y:number;scale:number}[];ends:RoundSummary[];intermissions:number[];bosses:number}
function options(log:Log,extra:Partial<DirectorOptions>={}):DirectorOptions{
  return {
    createEnemy(ctx,kind,point,scale){
      const e:EnemyState={id:ctx.nextId('e'),kind,x:point.x,y:point.y,hp:10*scale,maxHp:10*scale,speed:1,damage:5,radius:.3,xp:1,spawnTick:ctx.tick,readyTick:ctx.tick};
      ctx.enemies.set(e.id,e);log.created.push({tick:ctx.tick,round:ctx.round.index,kind,x:point.x,y:point.y,scale});return e;
    },
    spawnBoss(ctx,point){
      log.bosses++;
      const e:EnemyState={id:ctx.nextId('boss'),kind:'chefe',boss:true,x:point.x,y:point.y,hp:500,maxHp:500,speed:1,damage:10,radius:.8,xp:50,spawnTick:ctx.tick,readyTick:ctx.tick};
      ctx.enemies.set(e.id,e);return e;
    },
    onRoundEnd:(_ctx,r)=>{log.ends.push(r);},
    onIntermission:(_ctx,next)=>{log.intermissions.push(next.index);},
    ...extra,
  };
}
const newLog=():Log=>({created:[],ends:[],intermissions:[],bosses:0});

/** Runs the director; `kill(ctx)` plays the players' role after each director step. */
function run(ctx:FakeCtx,director:{step(ctx:SimContext):void},maxTicks:number,kill?:(ctx:FakeCtx)=>void,stop?:()=>boolean){
  for(let i=0;i<maxTicks;i++){
    ctx.tick++;director.step(ctx);kill?.(ctx);
    if(stop?.())break;
  }
}
/** Kills every enemy that has been alive for `after` ticks, one hit per tick. */
const killAfter=(after:number)=>(ctx:FakeCtx)=>{
  for(const e of [...ctx.enemies.values()])if(ctx.tick-e.spawnTick>=after)ctx.damageEnemy(e.id,1e9);
};

test('the round table covers 10 rounds with elite on 5 and the boss on 10',()=>{
  assert.equal(ROUND_COUNT,10);assert.equal(ROUNDS.length,10);
  assert.ok(ROUNDS[4].elite);assert.ok(ROUNDS[9].boss);
  assert.ok(MODIFIERS.length>=8);
  assert.equal(new Set(MODIFIERS.map(m=>m.id)).size,MODIFIERS.length);
  assert.ok(ROUND_NAMES.length>=20);
  for(const m of MODIFIERS)assert.ok(m.name.length&&m.description.length,m.id);
});

test('themes: absurd names never repeat in a run and modifiers start at round 3',()=>{
  for(let seed=1;seed<=30;seed++){
    const rng=new Rng(seed),used:string[]=[];
    for(let i=1;i<=ROUND_COUNT;i++){
      const theme=drawTheme(i,rng,used);used.push(theme.name);
      if(i<3||i===ROUND_COUNT)assert.equal(theme.modifierId,undefined,`round ${i}`);
      else assert.ok(theme.modifierId&&theme.modifierLabel,`round ${i} seed ${seed}`);
      if(theme.modifierId)assert.ok(!MODIFIERS.find(m=>m.id===theme.modifierId)!.banRounds.includes(i));
    }
    assert.equal(new Set(used).size,used.length);
  }
});

test('modifiers keep the round threat (count x hp) within 20% of the base plan',()=>{
  for(let index=3;index<ROUND_COUNT;index++)for(const m of MODIFIERS){
    if(m.banRounds.includes(index))continue;
    const base=planRound(index,1,{name:'x'},new Rng(index)),mod=planRound(index,1,{name:'x',modifierId:m.id},new Rng(index));
    const threat=(p:RoundPlan)=>p.hp*p.groups.filter(g=>!g.elite&&!g.boss).flatMap(g=>g.members).reduce((n,k)=>n+THREAT[k as RegularKind],0);
    const ratio=threat(mod)/threat(base);
    assert.ok(ratio>.85&&ratio<1.2,`${m.id} round ${index}: ${ratio.toFixed(2)}`);
  }
});

test('player scaling grows budget and hp, and 6 players fit under the enemy cap',()=>{
  let prev=playerScale(1);
  for(let n=2;n<=6;n++){const s=playerScale(n);assert.ok(s.count>prev.count&&s.hp>=prev.hp);prev=s;}
  for(let index=1;index<=ROUND_COUNT;index++){
    const one=planRound(index,1,{name:'x'},new Rng(1)),six=planRound(index,6,{name:'x'},new Rng(1));
    assert.ok(six.total>one.total*2,`round ${index}`);
    assert.ok(six.total<=MAX_ROUND_ENEMIES+1,`round ${index}: ${six.total}`);
    assert.ok(one.groups.every(g=>g.at<one.durationTicks*.75));
    assert.equal(one.groups.reduce((n,g)=>n+g.members.length,0),one.total);
  }
});

test('coastal spawn points: walkable land in the coastal band with a path inland, on 20 seeds',()=>{
  for(let seed=0;seed<20;seed++){
    const field=new TerrainField(seed*7919+3);
    const points=coastalSpawnPoints(field);
    assert.ok(points.length>=60,`seed ${seed}: ${points.length}`);
    for(const p of points){
      assert.ok(walkable(p,field),`seed ${seed} walkable`);
      assert.ok(field.land(p.x,p.y)&&field.bed(p.x,p.y)>0,`seed ${seed} not in the sea`);
      assert.ok(field.coast(p.x,p.y)<=2.2,`seed ${seed} near the coast`);
    }
    // Every 12th point checked against the real pathfinder (expensive).
    for(let i=0;i<points.length;i+=12)assert.ok(findPath(points[i],SPAWN,field).length,`seed ${seed} path inland from ${points[i].x},${points[i].y}`);
    assert.equal(coastalSpawnPoints(field),points,'cached');
  }
});

test('a full run on 20 seeds never spawns in the sea or near a player',()=>{
  for(let seed=0;seed<20;seed++){
    const field=new TerrainField(seed*7919+3),ctx=fakeCtx(seed,field),log=newLog();
    // Players stand at coastal points too, so spawns must avoid them.
    const coast=coastalSpawnPoints(field),r=new Rng(seed+99);
    for(let i=0;i<3;i++)addPlayer(ctx,`p${i}`,r.pick(coast));
    addPlayer(ctx,'p3',SPAWN);
    const director=createDirector(options(log,{rounds:4}));
    run(ctx,director,ticks(600),c=>{
      for(const e of c.enemies.values())if(e.spawnTick===c.tick){
        assert.ok(walkable(e,field),`seed ${seed}: walkable spawn`);
        assert.ok(field.coast(e.x,e.y)>0,`seed ${seed}: not in the sea`);
        for(const p of c.players.values())assert.ok(Math.hypot(p.x-e.x,p.y-e.y)>=4,`seed ${seed}: ${e.id} too close to ${p.id}`);
      }
      // A player jumps to another coastal point every few seconds (after the check: the director sees it next tick).
      if(c.tick%ticks(4)===0){const q=r.pick(coast);Object.assign(c.players.get('p0')!,{x:q.x,y:q.y});}
      killAfter(ticks(2))(c);
    },()=>director.state.stage==='done');
    assert.equal(director.state.stage,'done',`seed ${seed} finished`);
    for(const ev of ctx.events)if(ev.type==='spawn-warning'){
      assert.ok(walkable(ev,field));
      assert.ok(ev.atTick-ticks(1.5)>=0);
    }
  }
});

test('spawn warnings come 1.5 s before the enemies',()=>{
  const ctx=fakeCtx(5),log=newLog();addPlayer(ctx,'a',SPAWN);
  const director=createDirector(options(log,{rounds:1}));
  run(ctx,director,ticks(30),killAfter(ticks(1)));
  const warnings=ctx.events.filter(e=>e.type==='spawn-warning');
  assert.ok(warnings.length);
  for(const w of warnings){
    const at=log.created.filter(c=>c.tick===w.atTick&&Math.hypot(c.x-w.x,c.y-w.y)<2);
    assert.ok(at.length,`enemies at warned tick ${w.atTick}`);
  }
  // Every enemy was announced at least 1.5 s earlier, near its spawn point.
  for(const c of log.created){
    const warned=ctx.events.some((w,i)=>w.type==='spawn-warning'&&w.atTick<=c.tick&&c.tick-ctx.sentAt[i]>=ticks(1.5)&&Math.hypot(w.x-c.x,w.y-c.y)<2);
    assert.ok(warned,`enemy at tick ${c.tick} was warned 1.5 s before`);
  }
  ctx.events.forEach((w,i)=>{if(w.type==='spawn-warning')assert.equal(w.atTick-ctx.sentAt[i],ticks(1.5));});
  assert.ok(Math.min(...log.created.map(c=>c.tick))>=ticks(3)+ticks(1.5),'first enemy after opening + warning');
});

test('the same seed replays the same rounds; another seed differs',()=>{
  const once=(seed:number)=>{
    const ctx=fakeCtx(seed,new TerrainField(1)),log=newLog();addPlayer(ctx,'a',SPAWN);addPlayer(ctx,'b',{x:12,y:10});
    const director=createDirector(options(log));
    run(ctx,director,ticks(900),killAfter(ticks(3)),()=>director.state.stage==='done');
    return JSON.stringify({events:ctx.events,created:log.created,ends:log.ends,state:director.state});
  };
  assert.equal(once(11),once(11));
  assert.notEqual(once(11),once(12));
});

test('a complete run: 10 rounds, one end per round, intermissions without spawns, boss on round 10',()=>{
  const ctx=fakeCtx(21),log=newLog();addPlayer(ctx,'a',SPAWN);
  const director=createDirector(options(log));
  const prepareTicks:number[]=[],elites:EnemyState[]=[];
  run(ctx,director,ticks(1200),c=>{
    if(c.round.phase==='prepare')prepareTicks.push(c.tick);
    for(const e of c.enemies.values())if(e.elite&&!elites.includes(e))elites.push(e);
    killAfter(ticks(2))(c);
  },()=>director.state.stage==='done');
  assert.equal(director.state.stage,'done');
  assert.deepEqual(log.ends.map(r=>r.index),[1,2,3,4,5,6,7,8,9,10]);
  assert.deepEqual(log.intermissions,[2,3,4,5,6,7,8,9,10]);
  assert.equal(log.bosses,1);
  const prepare=new Set(prepareTicks);
  assert.ok(prepare.size>ticks(20)*9);
  assert.ok(log.created.every(c=>!prepare.has(c.tick)),'no enemy created during the intermission');
  assert.ok(ctx.events.every(e=>e.type!=='spawn-warning'||!prepare.has(e.atTick)));
  const rounds=ctx.events.filter(e=>e.type==='round') as Extract<SimEvent,{type:'round'}>[];
  assert.equal(rounds.filter(e=>e.phase==='end').length,10);
  assert.equal(rounds.filter(e=>e.phase==='wave').length,10);
  assert.ok(rounds.every(e=>e.name));
  assert.ok(rounds.filter(e=>e.phase==='wave'&&e.index>=3&&e.index<10).every(e=>e.modifier));
  assert.ok(log.ends.every(r=>!r.timedOut));
  // Round 5 has exactly one elite, sized up and with much more hp than its round mates.
  assert.equal(elites.length,1);
  const [elite]=elites;
  assert.equal(elite.memory?.round,5);
  const mates=log.created.filter(c=>c.round===5&&10*c.scale<elite.maxHp).map(c=>10*c.scale);
  assert.ok(mates.length>20);
  assert.ok(elite.maxHp>=4*Math.max(...mates));
  assert.ok(elite.radius>.3);
});

test('round-end fires once when two players kill the last enemy in the same tick',()=>{
  const ctx=fakeCtx(8),log=newLog();addPlayer(ctx,'a',SPAWN);addPlayer(ctx,'b',{x:12.5,y:17});
  const director=createDirector(options(log,{rounds:2}));
  run(ctx,director,ticks(400),c=>{
    // The last enemies of a round die together: both players hit every one of them in this tick.
    for(const e of [...c.enemies.values()])if(c.tick-e.spawnTick>=ticks(1)){c.damageEnemy(e.id,1e9,'a');c.damageEnemy(e.id,1e9,'b');}
    director.step(c);director.step(c); // extra steps in the same tick must not end the round again
  },()=>director.state.stage==='done');
  assert.deepEqual(log.ends.map(r=>r.index),[1,2]);
  const endTicks=ctx.events.flatMap((e,i)=>e.type==='round'&&e.phase==='end'?[ctx.sentAt[i]]:[]);
  assert.equal(endTicks.length,2);
  assert.equal(new Set(endTicks).size,2,'one end per tick');
});

test('when time runs out the rest of the horde retreats to the sea and the round ends once',()=>{
  const ctx=fakeCtx(3),log=newLog();addPlayer(ctx,'a',SPAWN);
  const director=createDirector(options(log,{rounds:1}));
  run(ctx,director,ticks(200),undefined,()=>log.ends.length>0);
  assert.equal(log.ends.length,1);
  const [end]=log.ends;
  assert.ok(end.timedOut);assert.equal(end.retreated,end.spawned);
  assert.equal(ctx.enemies.size,0);
  assert.ok(ctx.tick<=ticks(3+ROUNDS[0].maxDuration+3)+2,`retreat is short: ${ctx.tick}`);
  assert.ok(ctx.events.some(e=>e.type==='bark'),'a retreat line for laughs');
  assert.equal(ctx.round.remaining,0);
});

test('respects the enemy cap and still finishes the round',()=>{
  const ctx=fakeCtx(4),log=newLog();for(let i=0;i<6;i++)addPlayer(ctx,`p${i}`,{x:12+(i%3-1)*.7,y:17});
  const planned:number[]=[];
  const director=createDirector(options(log,{rounds:3,maxEnemies:12,onRoundEnd:(_c,r)=>{log.ends.push(r);planned.push(director.state.plan!.total);}}));
  let peak=0;
  run(ctx,director,ticks(600),c=>{peak=Math.max(peak,c.enemies.size);killAfter(ticks(1.5))(c);},()=>director.state.stage==='done');
  assert.ok(peak<=12,`peak ${peak}`);
  assert.deepEqual(log.ends.map(r=>r.index),[1,2,3]);
  assert.ok(log.ends.every(r=>!r.timedOut),'no timeout');
  assert.deepEqual(log.ends.map(r=>r.spawned),planned,'the whole horde spawned despite the cap');
});

test('scales by the highest active player count of the last minute',()=>{
  const ctx=fakeCtx(6),log=newLog();
  for(let i=0;i<6;i++)addPlayer(ctx,`p${i}`,{x:12,y:17});
  const director=createDirector(options(log));
  run(ctx,director,ticks(2));
  assert.equal(director.scalePlayers(ctx),6);
  // Five leave: the budget stays at six for a minute, then drops.
  for(let i=1;i<6;i++)ctx.players.get(`p${i}`)!.online=false;
  run(ctx,director,ticks(30));
  assert.equal(director.scalePlayers(ctx),6);
  run(ctx,director,ticks(61));
  assert.equal(director.scalePlayers(ctx),1);
  // Spectators and eliminated players never count.
  addPlayer(ctx,'s',SPAWN,{spectator:true});addPlayer(ctx,'x',SPAWN,{eliminated:true});
  assert.equal(director.scalePlayers(ctx),1);
});

test('state survives a JSON checkpoint into a fresh context, in the intermission and in the wave',()=>{
  const build=()=>{const ctx=fakeCtx(31,new TerrainField(2)),log=newLog();addPlayer(ctx,'a',SPAWN);return {ctx,log};};
  for(const at of [ticks(10),ticks(70)]){
    const a=build(),da=createDirector(options(a.log));
    run(a.ctx,da,at,killAfter(ticks(3)));
    // A fresh room: same world entities and ids, default ctx.round and a different root rng.
    const b=build();
    b.ctx.tick=a.ctx.tick;b.ctx.ids=a.ctx.ids;(b.ctx as {rng:Rng}).rng=new Rng(999);
    for(const e of a.ctx.enemies.values())b.ctx.enemies.set(e.id,structuredClone(e));
    const restored=createDirector(options(b.log),JSON.parse(JSON.stringify(da.state)));
    const from=a.ctx.events.length;
    run(a.ctx,da,ticks(400),killAfter(ticks(3)));
    run(b.ctx,restored,ticks(400),killAfter(ticks(3)));
    assert.ok(a.log.ends.length>=2,'rounds kept going');
    assert.deepEqual(b.ctx.events,a.ctx.events.slice(from));
    assert.deepEqual(b.ctx.round,a.ctx.round);
    assert.deepEqual(JSON.parse(JSON.stringify(restored.state)),JSON.parse(JSON.stringify(da.state)));
  }
});

test('round-end offers see the intermission deadline',()=>{
  const ctx=fakeCtx(12),log=newLog();addPlayer(ctx,'a',SPAWN);
  const seen:{phase:string;ends:number;summary?:number;tick:number}[]=[];
  const director=createDirector(options(log,{rounds:3,onRoundEnd:(c,r)=>{seen.push({phase:c.round.phase,ends:c.round.phaseEndsTick,summary:r.intermissionEndsTick,tick:c.tick});}}));
  run(ctx,director,ticks(400),killAfter(ticks(2)),()=>director.state.stage==='done');
  assert.equal(seen.length,3);
  for(const s of seen.slice(0,2)){
    assert.equal(s.phase,'prepare');assert.equal(s.summary,s.ends);assert.equal(s.ends-s.tick,ticks(20));
  }
  assert.equal(seen[2].summary,undefined,'no intermission after the final round');
});

test('boss round: the boss is tracked even without the boss flag, escorts retreat when it falls',()=>{
  const ctx=fakeCtx(14),log=newLog();addPlayer(ctx,'a',SPAWN);
  let bossId='';
  const director=createDirector(options(log,{spawnBoss:(c,point)=>{
    log.bosses++;
    const e:EnemyState={id:c.nextId('boss'),kind:'chefe',x:point.x,y:point.y,hp:500,maxHp:500,speed:1,damage:10,radius:.8,xp:50,spawnTick:c.tick,readyTick:c.tick};
    c.enemies.set(e.id,e);bossId=e.id;return e;
  }}));
  // Players clear rounds 1-9 quickly; on round 10 they ignore escorts and only kill the boss two minutes in.
  let slay=Infinity;
  run(ctx,director,ticks(1500),c=>{
    if(c.round.index===10&&c.round.phase==='wave'&&bossId&&slay===Infinity)slay=c.tick+ticks(120);
    for(const e of [...c.enemies.values()]){
      if(e.id===bossId){if(c.tick>=slay)c.damageEnemy(e.id,1e9);continue;}
      if(c.round.index<10&&c.tick-e.spawnTick>=ticks(2))c.damageEnemy(e.id,1e9);
    }
  },()=>director.state.stage==='done');
  assert.equal(log.bosses,1);
  const end10=log.ends.find(r=>r.index===10);
  assert.ok(end10,'final round ended');
  assert.ok(ctx.tick>=slay,'not before the boss fell, even past the round time');
  assert.ok(end10.retreated>0,'escorts left after the boss');
  assert.ok(!end10.timedOut);
});

test('without spawnBoss the catalog chefe stands in as the boss',()=>{
  const ctx=fakeCtx(15),log=newLog();addPlayer(ctx,'a',SPAWN);
  const director=createDirector(options(log,{spawnBoss:undefined}));
  let boss:EnemyState|undefined;
  run(ctx,director,ticks(1500),c=>{
    for(const e of c.enemies.values())if(e.boss)boss=e;
    killAfter(ticks(2))(c);
  },()=>director.state.stage==='done');
  assert.ok(boss&&boss.kind==='chefe');
  assert.equal(log.ends.length,10);
});

/** Runs whole runs on several seeds and returns the warnings (and planned side) of each wave whose modifier matches. */
function wavesWith(modifierId:string,seeds=60){
  const mod=MODIFIERS.find(m=>m.id===modifierId)!;
  const label=`${mod.name}: ${mod.description}`;
  const found:{side?:number;groupAt:number[];warnings:{tick:number;x:number;y:number;count:number}[]}[]=[];
  for(let seed=1;seed<=seeds&&found.length<3;seed++){
    const ctx=fakeCtx(seed,new TerrainField(seed)),log=newLog();addPlayer(ctx,'a',SPAWN);
    const director=createDirector(options(log,{rounds:9}));
    const plans=new Map<number,{side?:number;groupAt:number[]}>();
    run(ctx,director,ticks(900),c=>{
      const plan=director.state.plan;
      if(c.round.phase==='wave'&&plan&&!plans.has(c.round.index))plans.set(c.round.index,{side:plan.side,groupAt:plan.groups.map(g=>director.state.roundStart+g.at)});
      killAfter(ticks(2))(c);
    },()=>director.state.stage==='done');
    let current:typeof found[number]|undefined;
    ctx.events.forEach((e,i)=>{
      if(e.type==='round'&&e.phase==='wave')current=e.modifier===label?{...plans.get(e.index)!,warnings:[]}:undefined;
      else if(e.type==='round'&&e.phase==='end'&&current){found.push(current);current=undefined;}
      else if(e.type==='spawn-warning'&&current)current.warnings.push({tick:ctx.sentAt[i],x:e.x,y:e.y,count:e.count});
    });
  }
  return found;
}
const angleOf=(p:{x:number;y:number})=>Math.atan2(p.y-12,p.x-12);
const angleGap=(a:number,b:number)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));

test('pack 2: surround groups arrive split across several sides at once',()=>{
  const mod=MODIFIERS.find(m=>m.formation==='surround');
  assert.ok(mod,'a surround modifier exists');
  const waves=wavesWith(mod.id);
  assert.ok(waves.length,'the modifier was drawn in some run');
  for(const {warnings} of waves){
    const byTick=new Map<number,typeof warnings>();
    for(const w of warnings)byTick.set(w.tick,[...(byTick.get(w.tick)??[]),w]);
    const bursts=[...byTick.values()].filter(ws=>ws.length>=3);
    assert.ok(bursts.length>=2,'groups split into 3+ simultaneous warnings');
    for(const ws of bursts){
      const angles=ws.map(angleOf);
      // At least two of the simultaneous warnings come from clearly different sides.
      assert.ok(angles.some(a=>angles.some(b=>angleGap(a,b)>Math.PI/2)),'spread around the island');
    }
  }
});

test('pack 2: alternating groups switch to the opposite side',()=>{
  const mod=MODIFIERS.find(m=>m.alternateSide);
  assert.ok(mod,'an alternating modifier exists');
  const waves=wavesWith(mod.id);
  assert.ok(waves.length,'the modifier was drawn in some run');
  for(const {side,groupAt,warnings} of waves){
    assert.ok(side!==undefined,'the plan picked a side');
    // Group n is dispatched at groupAt[n] and comes from the planned side, flipped by half a turn on odd n
    // (the spawn sector is +-60 degrees). Ticks where groups of both parities start together are skipped.
    let checked=0,onSide=0;
    for(const w of warnings){
      const parities=new Set(groupAt.flatMap((at,n)=>at===w.tick?[n%2]:[]));
      if(parities.size!==1)continue;
      checked++;
      if(angleGap(angleOf(w),side+([...parities][0]?Math.PI:0))<Math.PI/3+.01)onSide++;
    }
    assert.ok(checked>=3);
    assert.ok(onSide>=checked*.9,`${onSide}/${checked} warnings on the expected side`);
  }
});

test('pack 2: elite and boss rounds draw from their own names; new labels fit the phone banner',()=>{
  const seen5=new Set<string>(),seen10=new Set<string>();
  for(let seed=1;seed<=60;seed++){
    seen5.add(drawTheme(5,new Rng(seed),[]).name);seen10.add(drawTheme(10,new Rng(seed),[]).name);
  }
  assert.ok(seen5.size>=3&&[...seen5].every(n=>ELITE_ROUND_NAMES.includes(n)));
  assert.ok(seen10.size>=3&&[...seen10].every(n=>BOSS_ROUND_NAMES.includes(n)));
  assert.ok(MODIFIERS.length>=18);
  for(const m of MODIFIERS)assert.ok(modifierLabel(m).length<=46,`${m.id}: ${modifierLabel(m).length}`);
  assert.equal(new Set(ROUND_NAMES).size,ROUND_NAMES.length,'no repeated names');
  assert.ok(ROUND_NAMES.length>=60);
  assert.ok(RETREAT_LINES.length>=12);
});
