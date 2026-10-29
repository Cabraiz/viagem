// Card NEW-20261023-ORQ-fear-escuridao-sozinho (user 24/10): alone, the dark closes in, at its darkest in 60 s; since
// card escuridao-justa (user 28/10, "a escuridão não mata") it never takes the hero. Company: an ally on their feet
// within 8, or the Uno within 6; bots count as company and never fear; every phase counts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS} from '../../src/contract/types.ts';
import type {SimEvent,SimPlayer,RoundPhase} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {createFearSystem,fearOf,type FearOptions} from '../../src/sim/fear.ts';
import {FEAR_ALLY_RADIUS,FEAR_BASE_RADIUS,FEAR_CALM_RATE,FEAR_TICKS} from '../../src/rules/index.ts';

type FakeCtx=SimContext&{tick:number;events:SimEvent[]};
function player(id:string,x:number,y:number,extra:Partial<SimPlayer>={}):SimPlayer{
  return {id,x,y,classId:'test',hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...extra};
}
function fakeCtx(players:SimPlayer[],phase:RoundPhase='wave'):FakeCtx{
  const events:SimEvent[]=[];
  const unused=()=>{throw new Error('not used by fear');};
  return {
    tick:0,runStartTick:0,events,terrain:undefined as never,rng:new Rng(1),
    players:new Map(players.map(p=>[p.id,p])),
    enemies:new Map(),pickups:new Map(),projectiles:new Map(),telegraphs:new Map(),offers:new Map(),
    team:{xp:0,level:1,nextXp:5},
    round:{index:1,total:10,phase,phaseEndsTick:9999,remaining:0},
    enemyIndex:{rebuild:unused,query:unused,nearest:unused} as never,
    nextId:prefix=>`${prefix}1`,
    emit:e=>{events.push(e);},
    damageEnemy:unused,damagePlayer:unused,
  } as FakeCtx;
}
function run(ctx:FakeCtx,options:FearOptions,n:number){
  const sys=createFearSystem(options);
  for(let i=0;i<n;i++){ctx.tick++;sys.step(ctx);}
  return sys;
}
const downs=(ctx:FakeCtx)=>ctx.events.filter(e=>e.type==='downed');

test('alone: one tick of dark per tick up to 60 s, then it stays at its darkest and never takes the hero',()=>{
  const a=player('a',0,0),ctx=fakeCtx([a]);
  run(ctx,{},FEAR_TICKS-1);
  assert.equal(a.fear,FEAR_TICKS-1);
  assert.ok(Math.abs(fearOf(a)!-(FEAR_TICKS-1)/FEAR_TICKS)<1e-12);
  assert.equal(FEAR_TICKS,1200,'60 s at 20 Hz');
  run(ctx,{},FEAR_TICKS*5);
  assert.equal(a.fear,FEAR_TICKS);assert.equal(fearOf(a),1);
  assert.equal(a.downed,undefined);assert.equal(a.hp,100);assert.equal(downs(ctx).length,0,'the dark does not kill');
  // Company still backs it off from the darkest.
  const b=player('b',1,0);ctx.players.set('b',b);run(ctx,{},FEAR_TICKS/FEAR_CALM_RATE);
  assert.equal(a.fear,undefined);
});

test('company: an ally on their feet within 8 (boundary counts) holds the dark back, 30× faster than it grows',()=>{
  const a=player('a',0,0,{fear:600}),b=player('b',FEAR_ALLY_RADIUS,0),ctx=fakeCtx([a,b]);
  run(ctx,{},1);
  assert.equal(a.fear,600-FEAR_CALM_RATE);assert.equal(b.fear,undefined);
  run(ctx,{},40);
  assert.equal(a.fear,undefined,'60 s of dark gone in 2 s');assert.equal(fearOf(a),undefined);
  b.x=FEAR_ALLY_RADIUS+.01;run(ctx,{},10);
  assert.equal(a.fear,10);assert.equal(b.fear,10);
});

test('a fallen, eliminated, offline or spectating ally is no company; the room autopilot keeps a dropped one as company',()=>{
  for(const extra of [{downed:{sinceTick:0,bleedOutTick:600,progress:0}},{eliminated:true,hp:0},{online:false},{spectator:true}] as Partial<SimPlayer>[]){
    const a=player('a',0,0),b=player('b',1,0,extra),ctx=fakeCtx([a,b]);
    run(ctx,{},5);assert.equal(a.fear,5,JSON.stringify(extra));
  }
  const a=player('a',0,0),b=player('b',1,0,{online:false}),ctx=fakeCtx([a,b]);
  run(ctx,{autopilot:id=>id==='b'},5);assert.equal(a.fear,undefined);
  assert.equal(b.fear,undefined,'offline: frozen, not afraid');
});

test('an offline hero keeps (freezes) the fear they had; a downed one loses it',()=>{
  const a=player('a',0,0,{online:false,fear:300}),c=player('c',50,50,{downed:{sinceTick:0,bleedOutTick:600,progress:0},hp:0,fear:200}),ctx=fakeCtx([a,c]);
  run(ctx,{},20);
  assert.equal(a.fear,300);assert.equal(c.fear,undefined);assert.equal(downs(ctx).length,0);
});

test('the Uno within 6 (boundary counts) is company; just past it is not',()=>{
  const a=player('a',FEAR_BASE_RADIUS,0,{fear:100}),ctx=fakeCtx([a]);
  run(ctx,{base:()=>({x:0,y:0})},2);assert.equal(a.fear,100-2*FEAR_CALM_RATE);
  a.x=FEAR_BASE_RADIUS+.01;run(ctx,{base:()=>({x:0,y:0})},2);assert.equal(a.fear,100-2*FEAR_CALM_RATE+2);
});

test('bots are company and never fear (the solo with bots stays playable)',()=>{
  const a=player('a',0,0),bot=player('bot',100,100,{fear:50}),ctx=fakeCtx([a,bot]);
  run(ctx,{bot:id=>id==='bot'},FEAR_TICKS+5);
  assert.equal(bot.fear,undefined);assert.equal(bot.downed,undefined);
  assert.equal(a.fear,FEAR_TICKS,'a far bot is no company');assert.equal(a.downed,undefined);
  const p=player('p',0,0,{fear:500}),b2=player('b2',3,0),ctx2=fakeCtx([p,b2]);
  run(ctx2,{bot:id=>id==='b2'},1);assert.equal(p.fear,500-FEAR_CALM_RATE);
});

test('every phase counts (the intermission too); the dark stops once the run is over',()=>{
  const a=player('a',0,0),ctx=fakeCtx([a],'prepare');
  run(ctx,{},10);assert.equal(a.fear,10);
  run(ctx,{runEnded:()=>true},FEAR_TICKS);assert.equal(a.fear,10);assert.equal(a.downed,undefined);
});

test('a whole team alone at its darkest for minutes: nobody falls, nobody loses hp',()=>{
  const heroes=['a','b','c'].map((id,i)=>player(id,i*30,0,{fear:FEAR_TICKS-1})),ctx=fakeCtx(heroes);
  run(ctx,{},FEAR_TICKS*3);
  for(const h of heroes){assert.equal(h.fear,FEAR_TICKS,h.id);assert.equal(h.downed,undefined,h.id);assert.equal(h.hp,100,h.id);}
  assert.equal(downs(ctx).length,0);
});
