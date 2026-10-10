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

// ---------- Endless world (NEW-20261009-ORQ-spawn-em-volta) ----------
import {INTEREST_RADIUS,MAX_OFFSCREEN_DISTANCE,RECYCLE_DISTANCE,RING_OUTER,offscreenDistance,visibleFrom,visibleOffset} from '../src/game/sim/offscreen.ts';
import {RECYCLE_EVERY} from '../src/game/sim/director.ts';
import {worldSpawn} from '../src/game/world.ts';

const endlessField=(seed:number)=>new TerrainField(seed,{world:'infinito'});
const bodiesOf=(ctx:FakeCtx)=>[...ctx.players.values()].filter(p=>!p.spectator&&!p.eliminated);
const seenBy=(ctx:FakeCtx,p:Point)=>bodiesOf(ctx).filter(b=>visibleFrom(b,p)).map(b=>b.id);
/** Moves a player like a hero with a joystick: SPEED-ish units per second, turning every few seconds. */
function walker(seed:number){
  const r=new Rng(seed);let a=r.range(0,Math.PI*2);
  return (ctx:FakeCtx,p:SimPlayer)=>{
    if(ctx.tick%ticks(3)===0)a=r.range(0,Math.PI*2);
    const next={x:p.x+Math.cos(a)*3.1/SIM_HZ,y:p.y+Math.sin(a)*3.1/SIM_HZ};
    if(walkable(next,ctx.terrain))Object.assign(p,next);else a+=Math.PI/2;
  };
}

test('endless: the off-screen ring follows the camera floor (56 px hero) and every orientation and view',t=>{
  let lo=Infinity,hi=0;
  for(let i=0;i<720;i++){
    const a=i/720*Math.PI*2,ux=Math.cos(a),uy=Math.sin(a),d=offscreenDistance(ux,uy);
    lo=Math.min(lo,d);hi=Math.max(hi,d);
    assert.ok(visibleOffset(ux*(d-.05),uy*(d-.05)),`just inside at ${i}`);
    for(const k of [0,.5,3,20])assert.ok(!visibleOffset(ux*(d+k),uy*(d+k)),`outside at ${i}+${k}`);
  }
  t.diagnostic(`off-screen distance ${lo.toFixed(1)}..${hi.toFixed(1)} u, interest ${INTEREST_RADIUS} u, recycle ${RECYCLE_DISTANCE} u`);
  assert.ok(lo>20&&hi<37,`${lo} ${hi}`);
  assert.ok(MAX_OFFSCREEN_DISTANCE>=hi);
  assert.ok(INTEREST_RADIUS>=MAX_OFFSCREEN_DISTANCE+RING_OUTER,'the client has every enemy before it can walk on screen');
  assert.ok(RECYCLE_DISTANCE>INTEREST_RADIUS,'recycling only takes what no client is drawing');
  // The 4 views are 90° turns around the player: the region is symmetric under them.
  for(const [x,y] of [[3,30],[25,2],[-17,-17],[30,-6]])assert.equal(visibleOffset(x,y),visibleOffset(-y,x));
  // A camera hint (portrait, view 0) shows much less to the side.
  assert.ok(offscreenDistance(Math.SQRT1_2,-Math.SQRT1_2,{landscape:false,view:0})<12);
});

test('endless: 20 seeds, walking players, no spawn on anyone\'s screen, in water or in an obstacle',t=>{
  let spawns=0,warnings=0,rewarns=0;
  for(let seed=0;seed<20;seed++){
    const field=endlessField(seed*7919+3),ctx=fakeCtx(seed,field),log=newLog();
    const start=worldSpawn(field);
    for(let i=0;i<4;i++)addPlayer(ctx,`p${i}`,{x:start.x+i*.7,y:start.y});
    const walks=[...ctx.players.values()].map((_,i)=>walker(seed*10+i));
    const director=createDirector(options(log,{rounds:3}));
    run(ctx,director,ticks(400),c=>{
      for(const e of c.enemies.values())if(e.spawnTick===c.tick){
        spawns++;
        assert.ok(walkable(e,field),`seed ${seed}: walkable spawn`);
        assert.ok(field.land(e.x,e.y)&&field.bed(e.x,e.y)>0,`seed ${seed}: not in a lake`);
        assert.ok(field.chunks!.clear(e.x,e.y,e.radius*.99),`seed ${seed}: not inside a tree or rock`);
        assert.deepEqual(seenBy(c,e),[],`seed ${seed}: ${e.id} spawned on screen`);
      }
      [...c.players.values()].forEach((p,i)=>walks[i](c,p));
      killAfter(ticks(4))(c);
    },()=>director.state.stage==='done');
    assert.equal(director.state.stage,'done',`seed ${seed} finished`);
    assert.deepEqual(log.ends.map(r=>r.index),[1,2,3]);
    // A warning nobody spawned at was abandoned for a re-warn (a player walked towards the spot).
    for(const e of ctx.events)if(e.type==='spawn-warning'){
      warnings++;
      if(!log.created.some(c=>c.tick>=e.atTick&&c.tick<=e.atTick+ticks(2)&&Math.hypot(c.x-e.x,c.y-e.y)<3))rewarns++;
    }
  }
  t.diagnostic(`endless, 4 walking players, 20 seeds x 3 rounds: ${spawns} spawns, ${warnings} warnings, ${rewarns} abandoned for a re-warn`);
  assert.ok(rewarns<warnings*.25,`${rewarns} re-warns of ${warnings}`);
  assert.ok(spawns>20*40);
});

test('endless: 6 players 200 units apart each get their own horde; one round-end per round',()=>{
  const field=endlessField(77),ctx=fakeCtx(77,field),log=newLog();
  const spots:Point[]=[];
  for(let i=0;i<6;i++){
    const a=i/6*Math.PI*2;let p={x:Math.round(Math.cos(a)*200),y:Math.round(Math.sin(a)*200)};
    for(let k=0;!walkable(p,field);k++)p={x:p.x+.5,y:p.y+(k%2?.5:0)};
    spots.push(p);addPlayer(ctx,`p${i}`,p);
  }
  for(let i=0;i<6;i++)for(let j=0;j<i;j++)assert.ok(Math.hypot(spots[i].x-spots[j].x,spots[i].y-spots[j].y)>=199);
  const director=createDirector(options(log,{rounds:4}));
  const near=new Map(spots.map((_,i)=>[`p${i}`,0]));
  run(ctx,director,ticks(600),c=>{
    for(const e of c.enemies.values())if(e.spawnTick===c.tick){
      const owner=[...c.players.values()].find(p=>Math.hypot(p.x-e.x,p.y-e.y)<=INTEREST_RADIUS);
      assert.ok(owner,`${e.id} spawned near a player`);near.set(owner.id,near.get(owner.id)!+1);
    }
    killAfter(ticks(3))(c);
  },()=>director.state.stage==='done');
  assert.deepEqual(log.ends.map(r=>r.index),[1,2,3,4]);
  const counts=[...near.values()],total=counts.reduce((a,b)=>a+b,0);
  assert.equal(total,log.created.length);
  for(const [id,n] of near)assert.ok(n>=total/6*.5,`${id} got ${n} of ${total}`);
  const ends=ctx.events.filter(e=>e.type==='round'&&e.phase==='end').length;
  assert.equal(ends,4);
});

test('endless: the same seed replays the same spawns; another seed differs',()=>{
  const once=(seed:number)=>{
    const ctx=fakeCtx(seed,endlessField(5)),log=newLog();addPlayer(ctx,'a',{x:0,y:5});addPlayer(ctx,'b',{x:60,y:-20});
    const walk=walker(seed);
    const director=createDirector(options(log,{rounds:4}));
    run(ctx,director,ticks(500),c=>{walk(c,c.players.get('a')!);killAfter(ticks(3))(c);},()=>director.state.stage==='done');
    return JSON.stringify({events:ctx.events,created:log.created,ends:log.ends,state:director.state});
  };
  assert.equal(once(11),once(11));
  assert.notEqual(once(11),once(12));
});

test('endless: enemies left far behind are recycled next to the players, with no kill and no xp',()=>{
  const ctx=fakeCtx(9,endlessField(9)),log=newLog();addPlayer(ctx,'a',{x:0,y:5});
  const director=createDirector(options(log,{rounds:1}));
  // Let round 1 spawn part of its horde, then the player dashes 150 units away.
  run(ctx,director,ticks(25));
  const before=new Map([...ctx.enemies.values()].map(e=>[e.id,{hp:e.hp,x:e.x,y:e.y}]));
  assert.ok(before.size>=2,`${before.size} enemies`);
  const p=ctx.players.get('a')!;
  let to={x:150,y:5};while(!walkable(to,ctx.terrain))to={x:to.x+.5,y:to.y};
  Object.assign(p,to);
  const kills=ctx.events.filter(e=>e.type==='kill').length;
  run(ctx,director,RECYCLE_EVERY*2);
  for(const [id,old] of before){
    const e=ctx.enemies.get(id);assert.ok(e,`${id} still alive (recycled, not removed)`);
    assert.equal(e.hp,old.hp);
    assert.ok(Math.hypot(e.x-p.x,e.y-p.y)<=MAX_OFFSCREEN_DISTANCE+RING_OUTER+12,`${id} back near the player`);
    assert.deepEqual(seenBy(ctx,e),[],'recycled off screen');
  }
  assert.equal(ctx.events.filter(e=>e.type==='kill').length,kills,'no kill event');
  assert.ok((director.state.recycled??0)>=before.size);
  run(ctx,director,ticks(120),killAfter(ticks(1)),()=>log.ends.length>0);
  assert.equal(log.ends.length,1);
  assert.ok((log.ends[0].recycled??0)>=before.size);
});

test('endless: on timeout the horde flees off screen; round-end once',()=>{
  const ctx=fakeCtx(3,endlessField(3)),log=newLog();addPlayer(ctx,'a',{x:0,y:5});
  const director=createDirector(options(log,{rounds:1}));
  // Nobody fights; enemies are pulled next to the player so some are on screen when the time runs out.
  let fleeing=0;
  run(ctx,director,ticks(200),c=>{
    const p=c.players.get('a')!;
    if(c.round.phase==='wave'&&c.tick<c.round.phaseEndsTick)for(const e of c.enemies.values()){e.x+=(p.x-e.x)*.05;e.y+=(p.y-e.y)*.05;}
    fleeing=Math.max(fleeing,director.state.retreating.length);
    for(const r of director.state.retreating){
      const e=c.enemies.get(r.id);
      // Fleeing enemies always move away from the player.
      if(e)assert.ok(Math.hypot(e.x-p.x,e.y-p.y)>0);
    }
  },()=>log.ends.length>0);
  assert.equal(log.ends.length,1);
  const [end]=log.ends;
  assert.ok(end.timedOut);assert.equal(end.retreated,end.spawned);assert.ok(fleeing>0);
  assert.equal(ctx.enemies.size,0);
  assert.equal(ctx.events.filter(e=>e.type==='kill').length,0,'fleeing is not dying');
  assert.ok(ctx.events.some(e=>e.type==='bark'));
});

test('endless: fleeing enemies leave the screen before they are removed',()=>{
  const ctx=fakeCtx(4,endlessField(4)),log=newLog();addPlayer(ctx,'a',{x:0,y:5});
  const director=createDirector(options(log,{rounds:1}));
  const vanished:string[]=[];
  // References, not copies: a removed enemy keeps the position it was removed at.
  let last=new Map<string,EnemyState>();
  run(ctx,director,ticks(200),c=>{
    const p=c.players.get('a')!;
    if(c.round.phase==='wave'&&c.tick<c.round.phaseEndsTick)for(const e of c.enemies.values()){e.x+=(p.x-e.x)*.05;e.y+=(p.y-e.y)*.05;}
    for(const [id,e] of last)if(!c.enemies.has(id)&&visibleFrom(p,e))vanished.push(id);
    last=new Map(c.enemies);
  },()=>log.ends.length>0);
  assert.ok(log.ends[0].retreated>=5,`${log.ends[0].retreated} fled`);
  assert.deepEqual(vanished,[],'nobody vanished on screen');
});

test('endless: siege groups spawn off screen around the base, flagged memory.siege',()=>{
  const ctx=fakeCtx(6,endlessField(6)),log=newLog();
  let far={x:120,y:0};while(!walkable(far,ctx.terrain))far={x:far.x+.5,y:far.y};
  addPlayer(ctx,'a',far);addPlayer(ctx,'b',{x:0,y:5});
  const director=createDirector(options(log,{rounds:2,siegeShare:.5}));
  let siege=0,regular=0;
  run(ctx,director,ticks(300),c=>{
    for(const e of c.enemies.values())if(e.spawnTick===c.tick){
      assert.deepEqual(seenBy(c,e),[]);
      if(e.memory?.siege===1){siege++;assert.ok(Math.hypot(e.x,e.y)<=MAX_OFFSCREEN_DISTANCE+RING_OUTER+12,'siege by the base');}
      else regular++;
    }
    killAfter(ticks(3))(c);
  },()=>director.state.stage==='done');
  assert.ok(siege>0&&regular>0,`${siege} siege, ${regular} regular`);
  // Default share is 0: nothing besieges.
  const plain=fakeCtx(6,endlessField(6)),plog=newLog();addPlayer(plain,'b',{x:0,y:5});
  const d2=createDirector(options(plog,{rounds:1}));
  run(plain,d2,ticks(80),killAfter(ticks(3)));
  assert.ok([...plain.enemies.values()].every(e=>e.memory?.siege===undefined));
});

test('endless: the round-10 boss appears just off screen near the team, not at the base',()=>{
  const ctx=fakeCtx(14,endlessField(14)),log=newLog();
  const team:Point[]=[];
  for(let i=0;i<3;i++){let p={x:300+i*3,y:-80};while(!walkable(p,ctx.terrain))p={x:p.x+.5,y:p.y};team.push(p);addPlayer(ctx,`p${i}`,p);}
  let bossAt:Point|undefined;
  const director=createDirector(options(log,{spawnBoss:(c,point)=>{
    bossAt=point;assert.deepEqual(seenBy(c as FakeCtx,point),[],'boss spawn off screen');
    const e:EnemyState={id:c.nextId('boss'),kind:'chefe',boss:true,x:point.x,y:point.y,hp:500,maxHp:500,speed:1,damage:10,radius:.8,xp:50,spawnTick:c.tick,readyTick:c.tick};
    c.enemies.set(e.id,e);return e;
  }}));
  run(ctx,director,ticks(1500),killAfter(ticks(2)),()=>director.state.stage==='done');
  assert.ok(bossAt);
  const cx=team.reduce((a,p)=>a+p.x,0)/3,cy=team.reduce((a,p)=>a+p.y,0)/3;
  assert.ok(Math.hypot(bossAt.x-cx,bossAt.y-cy)<=MAX_OFFSCREEN_DISTANCE+RING_OUTER+12,`boss ${bossAt.x},${bossAt.y}`);
  assert.equal(log.ends.length,10);
});

test('endless: a whole 10-round run with 6 players keeps the VGM-033 shape',()=>{
  const ctx=fakeCtx(21,endlessField(21)),log=newLog();
  for(let i=0;i<6;i++)addPlayer(ctx,`p${i}`,{x:i*.7-2,y:5});
  const director=createDirector(options(log));
  const elites:EnemyState[]=[];
  run(ctx,director,ticks(1500),c=>{
    for(const e of c.enemies.values())if(e.elite&&!elites.includes(e))elites.push(e);
    killAfter(ticks(2))(c);
  },()=>director.state.stage==='done');
  assert.deepEqual(log.ends.map(r=>r.index),[1,2,3,4,5,6,7,8,9,10]);
  assert.equal(log.bosses,1);assert.equal(elites.length,1);assert.equal(elites[0].memory?.round,5);
  assert.equal(director.scalePlayers(ctx),6);
  const six=log.created.filter(c=>c.round===2).length;
  assert.ok(six>=planRound(2,6,{name:'x'},new Rng(1)).total*.9,`round 2 with 6 players: ${six}`);
});

test('endless: spawn cost stays small (laboratory numbers)',t=>{
  const ctx=fakeCtx(31,endlessField(31)),log=newLog();
  for(let i=0;i<6;i++)addPlayer(ctx,`p${i}`,{x:i*40,y:5+(i%2)*30});
  const director=createDirector(options(log,{rounds:6}));
  const costs:number[]=[];
  run(ctx,director,ticks(900),c=>{killAfter(ticks(3))(c);},()=>{return director.state.stage==='done';});
  // Time director steps of a fresh run on the busiest round, per tick.
  const ctx2=fakeCtx(32,endlessField(32)),log2=newLog();
  for(let i=0;i<6;i++)addPlayer(ctx2,`p${i}`,{x:i*40,y:5+(i%2)*30});
  const d2=createDirector(options(log2,{rounds:6}));
  for(let i=0;i<ticks(500)&&d2.state.stage!=='done';i++){
    ctx2.tick++;const t0=performance.now();d2.step(ctx2);costs.push(performance.now()-t0);killAfter(ticks(6))(ctx2);
  }
  costs.sort((a,b)=>a-b);
  const q=(f:number)=>costs[Math.min(costs.length-1,Math.floor(costs.length*f))].toFixed(3);
  t.diagnostic(`director step, endless, 6 spread players: median ${q(.5)} ms, p99 ${q(.99)} ms, max ${costs[costs.length-1].toFixed(2)} ms over ${costs.length} ticks; ${log2.created.length} spawns, ${d2.state.recycled??0} recycled`);
  assert.ok(Number(q(.99))<5,'p99 under 5 ms');
  assert.ok(log.ends.length===6);
});

test('endless: a camera hint brings the ring in to that one screen',()=>{
  const ctx=fakeCtx(41,endlessField(41)),log=newLog();addPlayer(ctx,'a',{x:0,y:5});
  const hint={landscape:false,view:0};
  const director=createDirector(options(log,{rounds:2,cameraOf:()=>hint}));
  const dist:number[]=[];
  run(ctx,director,ticks(200),c=>{
    const p=c.players.get('a')!;
    for(const e of c.enemies.values())if(e.spawnTick===c.tick){assert.ok(!visibleFrom(p,e,hint));dist.push(Math.hypot(e.x-p.x,e.y-p.y));}
    killAfter(ticks(2))(c);
  },()=>director.state.stage==='done');
  assert.ok(Math.min(...dist)<16,`closest ${Math.min(...dist).toFixed(1)}`);
  assert.ok(dist.some(d=>d<21.6),'closer than the no-hint minimum');
});
