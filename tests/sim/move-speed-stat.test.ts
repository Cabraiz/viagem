/**
 * BUG-20261023-ORQ-oferta-velocidade-nao-faz-nada: stats.moveSpeed (class, weapon, the tênis, the "+velocidade" offer)
 * scales the walk of maps/prediction.ts moveStep, the one step of the room's players system (person and bot alike) and
 * of the phone's replay (the wire's moveSpeed, PlayerRunView.moveSpeed, protocol 4).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {moveStep,reconcile,statMoveSpeed,STEP,type MoveEffects} from '../../src/maps/prediction.ts';
import {heroSpeed,SPAWN,walkable,type Point} from '../../src/maps/world.ts';
import {defaultTerrain} from '../../src/maps/terrain/field.ts';
import {BOT_WALK_MULT,CIDA_FAST_MULT,PLAYER_SLIP_SPEED,PLAYER_SLOW_MULT} from '../../src/contract/index.ts';
import {SPEED} from '../../src/maps/world.ts';
import {computeStats} from '../../src/rules/stats.ts';
import {Simulation,moveSpeedOf} from '../../multiplayer/simulation.ts';

const T=defaultTerrain,WALK=heroSpeed(T);
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const close=(a:number,b:number,what:string)=>assert.ok(Math.abs(a-b)<1e-9,`${what}: ${a} vs ${b}`);
const fx=(moveSpeed:number,more:MoveEffects={}):MoveEffects=>({...more,stats:{moveSpeed}});

test('+X % of moveSpeed walks X % more, on top of the burp and the brigadeiro; the slide is not the legs',()=>{
  for(const m of [1,1.1,1.25,.9,2])close(dist(SPAWN,moveStep(SPAWN,{x:1,y:0},10,fx(m),T)),WALK*m*STEP,`× ${m}`);
  close(dist(SPAWN,moveStep(SPAWN,{x:1,y:0},10,fx(1.2,{slowUntil:99}),T)),WALK*PLAYER_SLOW_MULT*1.2*STEP,'burp × stat');
  close(dist(SPAWN,moveStep(SPAWN,{x:1,y:0},10,fx(1.2,{fastUntil:99}),T)),WALK*CIDA_FAST_MULT*1.2*STEP,'brigadeiro × stat');
  close(dist(SPAWN,moveStep(SPAWN,{x:1,y:0},10,fx(1.5,{slipUntil:99,slip:{x:0,y:1}}),T)),PLAYER_SLIP_SPEED*WALK/SPEED*STEP,'slide unchanged');
  // No stats: the old walk, exactly.
  assert.deepEqual(moveStep(SPAWN,{x:1,y:0},10,{},T),moveStep(SPAWN,{x:1,y:0},10,fx(1),T));
});

test('statMoveSpeed: thousandths within 0.5..2, a broken or absent stat walks at 1 (a forged frame cannot fly the phone)',()=>{
  assert.equal(statMoveSpeed(undefined),1);assert.equal(statMoveSpeed({}),1);assert.equal(statMoveSpeed(fx(NaN)),1);
  assert.equal(statMoveSpeed(fx(9)),2);assert.equal(statMoveSpeed(fx(.1)),.5);assert.equal(statMoveSpeed(fx(1.10000004)),1.1);
});

test('the stat comes from the build: the tênis (+0.1 a level) and a class bonus reach the walk',()=>{
  const plain=computeStats({weapons:[],passives:[]}),tenis=computeStats({weapons:[],passives:[{id:'tenis',level:3}]});
  close(tenis.moveSpeed-plain.moveSpeed,.3,'tênis 3');
  const fast=computeStats({weapons:[],passives:[{id:'tenis',level:3}]},{moveSpeed:.2});
  close(dist(SPAWN,moveStep(SPAWN,{x:1,y:0},10,{stats:fast},T)),WALK*1.5*STEP,'tênis 3 + class 0.2');
});

test('the room: a person and a bot with the same moveSpeed walk the same share, X % more than at 1 (the bot at BOT_WALK_MULT); the wire carries it to the phone',()=>{
  const sim=new Simulation();
  const person=sim.add('p','Ana','cidadao-comum'),bot=sim.addBot('b','Robô','cidadao-comum');
  sim.resetRun();
  // Both from the same clear spot, one after the other; the other seat waits off the line (card colisao-entre-herois:
  // the heroes are solid to each other).
  const walk=(id:string,moveSpeed:number)=>{
    const other=sim.players.get(id==='p'?'b':'p')!;other.x=SPAWN.x;other.y=SPAWN.y-6;
    assert.ok(walkable(other,T),'the other seat waits on the ground');
    const p=sim.players.get(id)!;p.stats={...p.stats,moveSpeed};p.x=SPAWN.x;p.y=SPAWN.y;
    const from={x:p.x,y:p.y};
    for(let i=0;i<10;i++){
      if(id==='b')sim.setBotInput('b',{x:1,y:0});else assert.ok(sim.input('p',{seq:p.ack+1,x:1,y:0,attack:false}),'input taken');
      sim.step();
    }
    const q=sim.players.get(id)!;return dist(from,q);
  };
  assert.ok(person&&bot);
  const base=walk('p',1),fast=walk('p',1.2),botFast=walk('b',1.2);
  assert.ok(base>0,'the person walked');
  close(fast/base,1.2,'person: +20 % walks 20 % more');
  // bots-20-mais-lentos: the bot walks BOT_WALK_MULT of the person, the stat on top of it all the same.
  close(botFast,fast*BOT_WALK_MULT,'bot = 0.8 × person with the same stat');
  // What the phone gets (PlayerRunView.moveSpeed) is what the room walked with; at 1 nothing travels.
  assert.deepEqual(moveSpeedOf(sim.players.get('p')!),{moveSpeed:1.2});
  const p=sim.players.get('p')!;p.stats={...p.stats,moveSpeed:1};assert.deepEqual(moveSpeedOf(p),{});
});

test('the phone replays its pending steps at the wire\'s moveSpeed: the same spot as the room',()=>{
  const steps=Array.from({length:8},(_,i)=>({seq:i+1,x:.6,y:-.8,attack:false}));
  const room=steps.reduce((at,s,k)=>moveStep(at,s,101+k,{stats:{moveSpeed:1.35}},T),SPAWN);
  assert.deepEqual(reconcile(SPAWN,steps,T,{tick:100,effects:{stats:{moveSpeed:1.35}}}),room);
});
