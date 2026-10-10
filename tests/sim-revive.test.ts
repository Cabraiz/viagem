import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../src/game/sim/rng.ts';
import {BASE_STATS,ticks} from '../src/game/sim/types.ts';
import type {SimContext,SimEvent,SimPlayer,RoundPhase} from '../src/game/sim/types.ts';
import {
  BLEED_OUT_TICKS,REVIVE_TICKS,RECONNECT_GRACE_TICKS,REVIVE_INVULNERABLE_TICKS,REVIVE_RADIUS,
  DOWNED_LINES,REVIVED_LINES,ELIMINATED_LINES,
  createReviveSystem,downPlayer,teamDefeated,reviveQuip,
} from '../src/game/sim/revive.ts';

type FakeCtx=SimContext&{tick:number;events:SimEvent[];round:{phase:RoundPhase}};

function player(id:string,x:number,y:number,extra:Partial<SimPlayer>={}):SimPlayer{
  return {id,x,y,classId:'test',hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...extra};
}

/** Minimal SimContext: only what revive touches is real, the rest throws if used. */
function fakeCtx(players:SimPlayer[],phase:RoundPhase='wave'):FakeCtx{
  const events:SimEvent[]=[];
  const unused=()=>{throw new Error('not used by revive');};
  let id=0;
  return {
    tick:0,events,
    terrain:undefined as never,rng:new Rng(1),
    players:new Map(players.map(p=>[p.id,p])),
    enemies:new Map(),pickups:new Map(),projectiles:new Map(),telegraphs:new Map(),offers:new Map(),
    team:{xp:0,level:1,nextXp:5},
    round:{index:1,total:10,phase,phaseEndsTick:9999,remaining:0},
    enemyIndex:{rebuild:unused,query:unused,nearest:unused},
    nextId:prefix=>`${prefix}${++id}`,
    emit:e=>{events.push(e);},
    damageEnemy:unused,damagePlayer:unused,
  };
}

function run(ctx:FakeCtx,sys:{step(c:SimContext):void},n:number,each?:()=>void){
  for(let i=0;i<n;i++){ctx.tick++;each?.();sys.step(ctx);}
}
const of=(ctx:FakeCtx,type:SimEvent['type'])=>ctx.events.filter(e=>e.type===type);

test('downPlayer replaces respawn, is idempotent and skips spectators',()=>{
  const a=player('a',5,5),s=player('s',5,5,{spectator:true});
  const ctx=fakeCtx([a,s]);ctx.tick=7;a.target='e1';a.invulnerableUntil=99;
  assert.equal(downPlayer(ctx,a,'e1'),true);
  assert.deepEqual(a.downed,{sinceTick:7,bleedOutTick:7+ticks(30),progress:0});
  assert.equal(a.hp,0);assert.equal(a.target,undefined);assert.equal(a.invulnerableUntil,undefined);
  assert.equal(downPlayer(ctx,a),false);
  assert.equal(downPlayer(ctx,s),false);
  assert.deepEqual(ctx.events,[{type:'downed',player:'a',by:'e1'}]);
});

test('an ally within 1.2 for 3 s revives with 40% hp and 2 s of invulnerability',()=>{
  const a=player('a',5,5),b=player('b',5+REVIVE_RADIUS,5);
  const ctx=fakeCtx([a,b]),sys=createReviveSystem();
  downPlayer(ctx,a);
  run(ctx,sys,REVIVE_TICKS-1);
  assert.ok(a.downed);assert.ok(a.downed.progress>.9&&a.downed.progress<1);
  run(ctx,sys,1);
  assert.equal(a.downed,undefined);
  assert.equal(a.hp,40);
  assert.equal(a.invulnerableUntil,ctx.tick+REVIVE_INVULNERABLE_TICKS);
  assert.deepEqual(of(ctx,'revived'),[{type:'revived',player:'a',by:'b'}]);
  assert.equal(sys.revives.get('b'),1);
});

test('revive speed scales with stats.revive and extra allies, with diminishing returns',()=>{
  const timeToRevive=(rescuers:SimPlayer[])=>{
    const a=player('a',5,5),ctx=fakeCtx([a,...rescuers]),sys=createReviveSystem();
    downPlayer(ctx,a);let n=0;
    while(a.downed){run(ctx,sys,1);n++;}
    return n;
  };
  const solo=timeToRevive([player('b',5,6)]);
  assert.equal(solo,REVIVE_TICKS);
  assert.equal(timeToRevive([player('b',5,6,{stats:{...BASE_STATS,revive:2}})]),Math.ceil(REVIVE_TICKS/2));
  const duo=timeToRevive([player('b',5,6),player('c',6,5)]);
  const trio=timeToRevive([player('b',5,6),player('c',6,5),player('d',4,5)]);
  assert.ok(duo<solo&&trio<duo&&duo>solo/2,`solo ${solo} duo ${duo} trio ${trio}`);
});

test('one rescuer picks up two downed players at once; an ally out of range gets no credit',()=>{
  const a=player('a',3,3),b=player('b',3.5,3),c=player('c',3.2,3.5),d=player('d',12,12);
  const ctx=fakeCtx([a,b,c,d]),sys=createReviveSystem();
  downPlayer(ctx,a);downPlayer(ctx,b);
  run(ctx,sys,REVIVE_TICKS);
  assert.equal(a.downed,undefined);assert.equal(b.downed,undefined);
  assert.equal(of(ctx,'revived').length,2);
  assert.equal(sys.revives.get('c'),2);assert.equal(sys.revives.get('d'),undefined);
  run(ctx,sys,40);
  assert.equal(of(ctx,'revived').length,2);
});

test('a downed player cannot revive another downed player',()=>{
  const a=player('a',3,3),b=player('b',3.5,3),c=player('c',15,15);
  const ctx=fakeCtx([a,b,c]),sys=createReviveSystem();
  downPlayer(ctx,a);downPlayer(ctx,b);
  run(ctx,sys,REVIVE_TICKS*2);
  assert.equal(a.downed?.progress,0);assert.equal(b.downed?.progress,0);
});

test('walking away interrupts the rescue and progress decays back',()=>{
  const a=player('a',5,5),b=player('b',5,6);
  const ctx=fakeCtx([a,b]),sys=createReviveSystem();
  downPlayer(ctx,a);
  run(ctx,sys,REVIVE_TICKS/2);
  const half=a.downed!.progress;assert.ok(half>.45&&half<.55);
  b.x=5+REVIVE_RADIUS+.01;b.y=5;
  run(ctx,sys,5);
  assert.ok(a.downed!.progress<half);
  run(ctx,sys,REVIVE_TICKS);
  assert.equal(a.downed!.progress,0);
  assert.equal(of(ctx,'revived').length,0);
});

test('bleeding out for 30 s eliminates exactly once',()=>{
  const a=player('a',5,5),b=player('b',15,15);
  const ctx=fakeCtx([a,b]),sys=createReviveSystem();
  downPlayer(ctx,a);
  run(ctx,sys,BLEED_OUT_TICKS-1);
  assert.ok(a.downed);assert.equal(a.eliminated,undefined);
  run(ctx,sys,1);
  assert.equal(a.downed,undefined);assert.equal(a.eliminated,true);assert.equal(a.hp,0);
  b.x=5;b.y=5;
  run(ctx,sys,REVIVE_TICKS*3);
  assert.deepEqual(of(ctx,'eliminated'),[{type:'eliminated',player:'a'}]);
  assert.equal(of(ctx,'revived').length,0);
  assert.equal(downPlayer(ctx,a),false);
});

test('bleed-out freezes during the intermission so the fallen can be picked up',()=>{
  const a=player('a',5,5),b=player('b',15,15);
  const ctx=fakeCtx([a,b]),sys=createReviveSystem();
  downPlayer(ctx,a);
  run(ctx,sys,BLEED_OUT_TICKS-10);
  ctx.round.phase='prepare';
  run(ctx,sys,ticks(20));
  assert.ok(a.downed);
  b.x=5;b.y=6;
  run(ctx,sys,REVIVE_TICKS);
  assert.equal(a.downed,undefined);assert.equal(a.eliminated,undefined);
  // The timer resumes, not resets, when the next round starts.
  const e=player('e',5,5),ctx3=fakeCtx([e,player('f',15,15)]),sys3=createReviveSystem();
  downPlayer(ctx3,e);
  run(ctx3,sys3,BLEED_OUT_TICKS-10);
  ctx3.round.phase='prepare';run(ctx3,sys3,ticks(20));
  ctx3.round.phase='wave';run(ctx3,sys3,9);
  assert.ok(e.downed);
  run(ctx3,sys3,1);
  assert.equal(e.eliminated,true);
  assert.equal(of(ctx3,'eliminated').length,1);
  const noPause=createReviveSystem({pauseBleedInPrepare:false}),c=player('c',5,5),ctx2=fakeCtx([c,player('d',15,15)],'prepare');
  downPlayer(ctx2,c);run(ctx2,noPause,BLEED_OUT_TICKS);
  assert.equal(c.eliminated,true);
});

test('connection drop during a rescue neither revives nor duplicates',()=>{
  // Downed player drops: no progress while offline, bleed-out keeps running.
  const a=player('a',5,5),b=player('b',5,6),c=player('c',15,15);
  const ctx=fakeCtx([a,b,c]),sys=createReviveSystem();
  downPlayer(ctx,a);
  run(ctx,sys,REVIVE_TICKS-2);
  a.online=false;
  run(ctx,sys,REVIVE_TICKS);
  assert.ok(a.downed);assert.equal(a.downed.progress,0);
  a.online=true;
  run(ctx,sys,REVIVE_TICKS);
  assert.equal(a.downed,undefined);
  assert.equal(of(ctx,'revived').length,1);
  // Rescuer drops: they stop counting and are not credited.
  downPlayer(ctx,c);c.x=8;c.y=8;b.x=8;b.y=8.5;
  run(ctx,sys,REVIVE_TICKS-1);
  b.online=false;
  run(ctx,sys,1);
  assert.ok(c.downed);
  b.online=true;run(ctx,sys,5);
  assert.equal(c.downed,undefined);
  assert.equal(of(ctx,'revived').length,2);
  assert.equal(sys.revives.get('b'),2);
});

test('teamDefeated: nobody active standing, offline counts as out, spectators ignored',()=>{
  const a=player('a',1,1),b=player('b',2,2),s=player('s',3,3,{spectator:true});
  const ctx=fakeCtx([a,b,s]);
  assert.equal(teamDefeated(ctx),false);
  downPlayer(ctx,a);assert.equal(teamDefeated(ctx),false);
  b.online=false;assert.equal(teamDefeated(ctx),true);
  b.online=true;b.eliminated=true;assert.equal(teamDefeated(ctx),true);
  assert.equal(teamDefeated(fakeCtx([])),false);
  assert.equal(teamDefeated(fakeCtx([player('x',1,1,{spectator:true})])),false);
});

test('whole team down is a defeat reported once',()=>{
  const a=player('a',1,1),b=player('b',9,9);let calls=0;
  const ctx=fakeCtx([a,b]),sys=createReviveSystem({onTeamDefeated:()=>{calls++;}});
  run(ctx,sys,3);
  downPlayer(ctx,a);run(ctx,sys,3);
  assert.equal(calls,0);assert.equal(sys.defeated,false);
  ctx.tick++;downPlayer(ctx,b);sys.step(ctx);
  assert.equal(calls,1);assert.equal(sys.defeated,true);
  run(ctx,sys,BLEED_OUT_TICKS+5);
  assert.equal(calls,1);
  assert.equal(of(ctx,'eliminated').length,0);
  // Empty or spectator-only rooms are not a defeat.
  const empty=createReviveSystem({onTeamDefeated:()=>{calls++;}});
  run(fakeCtx([player('s',1,1,{spectator:true})]),empty,3);
  assert.equal(calls,1);
});

test('two players: a 1-tick drop of the only rescuer does not lose the run',()=>{
  const a=player('a',5,5),b=player('b',5,6);let calls=0;
  const ctx=fakeCtx([a,b]),sys=createReviveSystem({onTeamDefeated:()=>{calls++;}});
  downPlayer(ctx,a);
  run(ctx,sys,REVIVE_TICKS/2);
  b.online=false;run(ctx,sys,1);b.online=true;
  run(ctx,sys,REVIVE_TICKS);
  assert.equal(calls,0);assert.equal(a.downed,undefined);
  assert.equal(of(ctx,'revived').length,1);
  // A drop longer than the grace is a defeat, once.
  downPlayer(ctx,a);b.online=false;
  run(ctx,sys,RECONNECT_GRACE_TICKS-1);
  assert.equal(calls,0);
  run(ctx,sys,1);
  assert.equal(calls,1);
  b.online=true;run(ctx,sys,REVIVE_TICKS*2);
  assert.equal(calls,1);assert.ok(a.downed);
});

test('odd stats: Infinity revive is instant, invalid maxHp still revives with 1 hp',()=>{
  const a=player('a',5,5,{stats:{...BASE_STATS,maxHp:Number.NaN}}),b=player('b',5,6,{stats:{...BASE_STATS,revive:Infinity}});
  const n=player('n',9,9),z=player('z',9,9.5,{stats:{...BASE_STATS,revive:Number.NaN}});
  const ctx=fakeCtx([a,b,n,z]),sys=createReviveSystem();
  downPlayer(ctx,a);downPlayer(ctx,n);
  run(ctx,sys,1);
  assert.equal(a.downed,undefined);assert.equal(a.hp,1);
  assert.equal(n.downed?.progress,0);
});

test('same inputs replay the same events',()=>{
  const replay=()=>{
    const ps=['d','a','c','b'].map((id,i)=>player(id,3+i*.5,3));
    const ctx=fakeCtx(ps),sys=createReviveSystem();
    downPlayer(ctx,ps[0]);downPlayer(ctx,ps[2]);
    run(ctx,sys,REVIVE_TICKS*2,()=>{if(ctx.tick===20)ps[1].x=20;});
    return JSON.stringify([ctx.events,[...sys.revives]]);
  };
  assert.equal(replay(),replay());
});

test('endgame: injectable grace, no defeat after the run ended, spectators leave the downed state',()=>{
  // Grace is injectable and exact: defeat on the Nth consecutive tick out.
  const a=player('a',1,1),b=player('b',9,9);let calls=0;
  const ctx=fakeCtx([a,b]),sys=createReviveSystem({reconnectGraceTicks:ticks(20),onTeamDefeated:()=>{calls++;}});
  downPlayer(ctx,a);b.online=false;
  run(ctx,sys,ticks(20)-1);assert.equal(calls,0);
  run(ctx,sys,1);assert.equal(calls,1);
  // Victory earlier in the same tick: the team going down afterwards is not a defeat.
  let ended=false;const c=player('c',1,1),d=player('d',9,9);let defeats=0;
  const ctx2=fakeCtx([c,d]),sys2=createReviveSystem({runEnded:()=>ended,onTeamDefeated:()=>{defeats++;}});
  run(ctx2,sys2,2);
  ctx2.tick++;ended=true;downPlayer(ctx2,c);downPlayer(ctx2,d);sys2.step(ctx2);
  run(ctx2,sys2,BLEED_OUT_TICKS+5);
  assert.equal(defeats,0);assert.equal(sys2.defeated,false);
  assert.equal(of(ctx2,'eliminated').length,0);
  // A downed player who turns spectator drops the downed state and is not eliminated on return.
  const e=player('e',1,1),f=player('f',9,9);
  const ctx3=fakeCtx([e,f]),sys3=createReviveSystem();
  downPlayer(ctx3,e);run(ctx3,sys3,5);
  e.spectator=true;run(ctx3,sys3,1);
  assert.equal(e.downed,undefined);
  run(ctx3,sys3,BLEED_OUT_TICKS+5);
  e.spectator=false;e.hp=100;run(ctx3,sys3,5);
  assert.equal(e.eliminated,undefined);assert.equal(of(ctx3,'eliminated').length,0);
});

test('replay is independent of player insertion order',()=>{
  const replay=(order:string[])=>{
    // a is rescued by b and d by e on the same tick, so event order depends on iteration order.
    const at:Record<string,[number,number]>={a:[3,3],b:[3.5,3],c:[6,6],d:[12,12],e:[12.5,12]};
    const ps=order.map(id=>player(id,...at[id]));
    const ctx=fakeCtx(ps),sys=createReviveSystem(),byId=new Map(ps.map(p=>[p.id,p]));
    downPlayer(ctx,byId.get('a')!);downPlayer(ctx,byId.get('d')!);
    run(ctx,sys,REVIVE_TICKS*2,()=>{if(ctx.tick===10)byId.get('c')!.x=7;});
    const state=[...byId.values()].sort((x,y)=>x.id<y.id?-1:1).map(p=>[p.id,p.hp,p.downed,p.eliminated]);
    return JSON.stringify([ctx.events,[...sys.revives].sort(),state]);
  };
  const base=replay(['a','b','c','d','e']);
  assert.equal(JSON.parse(base)[0].filter((e:{type:string})=>e.type==='revived').length,2);
  for(const order of [['e','d','c','b','a'],['c','a','e','b','d'],['d','b','a','e','c']])assert.equal(replay(order),base);
});

test('zueira quips are deterministic pt-BR lines from the event alone',()=>{
  assert.equal(reviveQuip('downed','a',10),reviveQuip('downed','a',10));
  assert.ok((DOWNED_LINES as readonly string[]).includes(reviveQuip('downed','a',10)));
  assert.ok((REVIVED_LINES as readonly string[]).includes(reviveQuip('revived','b',3)));
  assert.ok((ELIMINATED_LINES as readonly string[]).includes(reviveQuip('eliminated','c',0)));
  const seen=new Set(Array.from({length:60},(_,t)=>reviveQuip('downed','a',t)));
  assert.ok(seen.size>=4,`only ${seen.size} distinct lines`);
});

test('downed names the kind of the enemy that dealt the last hit (UX-voce-e-dano f); unknown hitters keep only by',()=>{
  const a=player('a',0,0),b=player('b',1,0),c=player('c',2,0),ctx=fakeCtx([a,b,c]);
  ctx.enemies.set('e7',{id:'e7',kind:'pernilongo',x:0,y:0,hp:5,maxHp:5} as never);
  downPlayer(ctx,a,'e7');downPlayer(ctx,b,'gone');downPlayer(ctx,c);
  assert.deepEqual(ctx.events,[{type:'downed',player:'a',by:'e7',source:'pernilongo'},{type:'downed',player:'b',by:'gone'},{type:'downed',player:'c'}]);
});

test('a 6-bot run: every downed names a known critter kind (UX-voce-e-dano aceite: 100% of downed)',async()=>{
  const {Simulation}=await import('../src/game/net/shared.ts');
  const {CAUSE_KINDS}=await import('../src/game/hud/cause.ts');
  for(const seed of [7,12345,0x042a5eed]){
    const sim=new Simulation(seed);
    const ids=Array.from({length:6},(_,i)=>`bot${i}`);
    ids.forEach((id,i)=>sim.add(id,`Bot ${i}`,['cidadao-comum','sensei','pedreiro','roqueira','feirante','goleira'][i]));
    sim.resetRun();
    // Unarmed and standing still: the horde downs everyone, through contact, telegraphs and projectiles.
    const disarm=()=>{for(const id of ids){const p=sim.players.get(id)!;p.build.weapons=[];p.weaponReady={};}};
    const downs:{source?:string}[]=[];
    for(let t=0;t<ticks(240)&&downs.length<6;t++){disarm();for(const e of sim.step())if(e.type==='downed')downs.push(e);}
    assert.ok(downs.length>=3,`seed ${seed}: only ${downs.length} downed`);
    for(const d of downs)assert.ok((CAUSE_KINDS as readonly string[]).includes(d.source??''),`seed ${seed}: downed without a kind: ${JSON.stringify(d)}`);
  }
});
