/**
 * Card NEW-20261025-ORQ-heroi-empurra-inimigos (user, 25/10: "deveria ter hitbox e não eu simplesmente passando por
 * dentro deles, nem que seja empurrando eles"): heroes and awake enemies are solid (maps/bodies.ts, sim/bodies.ts).
 *  - a hero walking into a common body pushes it and keeps almost all the walk; an elite about half, the boss almost
 *    nothing (but something); the hero never ends a step inside a body;
 *  - the phone's replay (maps reconcile with clock.bodies) takes the very same steps as the room;
 *  - in a real run (enemy AI, crowd push, the end-of-tick pass) no solid body stands inside a hero after any tick, a
 *    ring of 8 does not hold the hero (out in ≤ 1 s), and the flying ones are walked under.
 * On the REAL Cidade Nevada (the plaza), D-031: no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {RADIUS,heroSpeed,type Point} from '../../src/maps/world.ts';
import {reconcile} from '../../src/maps/prediction.ts';
import {HERO_SHARE_MAX,bodyMass,heroShare,type Body} from '../../src/maps/bodies.ts';
import {BASE_STATS,type EnemyState,type PlayerInput,type SimPlayer} from '../../src/contract/index.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER,playersSystem} from '../../src/sim/systems/players.ts';
import {createRunSystems} from '../../src/sim/assemble.ts';
import {createEnemy,isFlying} from '../../src/sim/enemies/catalog.ts';
import {solidEnemy} from '../../src/sim/bodies.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(TEXT,HASH);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;
const STEP_U=heroSpeed(city)/20;

function addPlayer(world:SimWorld,id:string,p:Point,hp=100){
  const player={id,classId:'x',hp,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:hp},weaponReady:{},x:p.x,y:p.y,ack:0,score:0} as SimPlayer;
  world.players.set(id,player);return player;
}
/** Only the players system (with the bodies) over still enemies: the push itself, no AI. */
function walkRig(input:(id:string)=>PlayerInput|undefined){
  const world=new SimWorld({terrain:city,seed:1,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  world.register(playersSystem(input,undefined,undefined,undefined,undefined,true));
  return world;
}
/** An open spot of the plaza (the run's base) with room around it. */
function plaza(){
  const world=new SimWorld({terrain:city,seed:1,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false});
  return sys.avenues!.plazaCenter;
}
const BASE=plaza();
const gap=(p:Point,e:EnemyState)=>Math.hypot(p.x-e.x,p.y-e.y)-RADIUS-e.radius;

test('masses: a common gives way, an elite less, the boss almost nothing; never all of it',()=>{
  const common:Body={x:0,y:0,radius:.37},big:Body={x:0,y:0,radius:.6},elite:Body={x:0,y:0,radius:.5,elite:true},boss:Body={x:0,y:0,radius:1.04,boss:true};
  assert.ok(heroShare(common)<.12,`common ${heroShare(common)}`);
  assert.ok(heroShare(big)>heroShare(common),'a bigger common is heavier');
  assert.ok(heroShare(elite)>.3&&heroShare(elite)<.6,`elite ${heroShare(elite)}`);
  assert.equal(heroShare(boss),HERO_SHARE_MAX,'the boss: the cap');
  assert.ok(bodyMass(boss)>bodyMass(elite)&&bodyMass(elite)>bodyMass(common));
});

for(const [name,setup,min,max] of [
  ['common',(e:EnemyState)=>e,.85,.97],
  ['elite',(e:EnemyState)=>{e.elite=true;e.radius*=1.35;return e;},.4,.7],
  ['boss',(e:EnemyState)=>{e.boss=true;e.radius=1.04;return e;},.05,.15],
] as const){
  test(`room: walking into a still ${name}, the hero pushes it, never stands inside it, and keeps ${min}..${max} of the walk; the phone replays the same`,()=>{
    const world=walkRig(()=>({seq:1,x:1,y:0} as PlayerInput));
    const start={x:BASE.x-2,y:BASE.y};
    const p=addPlayer(world,'a',start);
    const e=setup(createEnemy(world,'bebado',{x:BASE.x,y:BASE.y}));
    const copy:Body={x:e.x,y:e.y,radius:e.radius,...(e.elite?{elite:true}:{}),...(e.boss?{boss:true}:{})};
    const ticks=40;
    const inputs:PlayerInput[]=[];
    for(let t=0;t<ticks;t++){world.step();inputs.push({seq:t+1,x:1,y:0} as PlayerInput);assert.ok(gap(p,e)>=-1e-9,`tick ${t}: inside by ${-gap(p,e)}`);}
    // The free walk to contact, then the push: compare the walk past contact with what a free hero walks then.
    const toContact=BASE.x-start.x-RADIUS-e.radius,walked=p.x-start.x;
    const kept=(walked-toContact)/(ticks*STEP_U-toContact);
    assert.ok(kept>=min&&kept<=max,`${name}: kept ${kept.toFixed(3)} of the walk`);
    assert.ok(e.x>BASE.x,'the body was pushed ahead');
    // The phone: the same steps from the start against a copy of the body.
    const phone=reconcile({...start},inputs,city,{tick:0,bodies:[copy]});
    assert.ok(Math.abs(phone.x-p.x)<1e-9&&Math.abs(phone.y-p.y)<1e-9,`phone (${phone.x},${phone.y}) room (${p.x},${p.y})`);
    assert.ok(Math.abs(copy.x-e.x)<1e-9&&Math.abs(copy.y-e.y)<1e-9,'the copy went where the body went');
  });
}

/** A real run on the plaza (enemy AI, crowd push, the end-of-tick pass), the hero holding `dir`. */
function runRig(dir:Point|undefined|(()=>Point|undefined),seed=7){
  const players=new Map<string,SimPlayer>();
  const world=new SimWorld({terrain:city,seed,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  let seq=0;
  const take=()=>{const d=typeof dir==='function'?dir():dir;return d?{seq:++seq,x:d.x,y:d.y} as PlayerInput:undefined;};
  const sys=createRunSystems(world,{takeInput:take,onOutcome:()=>{},cityTutorial:false});
  const p=addPlayer(world,'a',{...BASE},1e9);
  return {world,sys,p};
}
const ring=(world:SimWorld,at:Point,n:number,kind='bebado')=>Array.from({length:n},(_,i)=>{
  const a=i/n*Math.PI*2,probe=createEnemy(world,kind,{x:at.x,y:at.y});
  const r=RADIUS+probe.radius+.02;probe.x=at.x+Math.cos(a)*r;probe.y=at.y+Math.sin(a)*r;
  return probe;
});

test('run: a ring of 8 commons does not hold the hero: out of it in ≤ 1 s, pushing',()=>{
  for(const [dx,dy] of [[1,0],[0,1],[-.7,.7]]){
    const {world,p}=runRig({x:dx,y:dy});
    for(let i=0;i<200&&world.round.phase!=='wave';i++){p.x=BASE.x;p.y=BASE.y;world.step();}
    for(const e of [...world.enemies.values()])world.enemies.delete(e.id);
    p.x=BASE.x;p.y=BASE.y;
    const bodies=ring(world,BASE,8);
    const reach=RADIUS+2*bodies[0]!.radius+RADIUS;
    let out=-1;
    for(let t=1;t<=20&&out<0;t++){
      world.step();
      if(Math.hypot(p.x-BASE.x,p.y-BASE.y)>=reach)out=t;
    }
    assert.ok(out>0,`(${dx},${dy}): still in the ring after 1 s, at ${Math.hypot(p.x-BASE.x,p.y-BASE.y).toFixed(2)} u of ${reach.toFixed(2)}`);
  }
});

test('run: with a crowd chasing a walking hero, no solid body stands inside the hero after any tick',()=>{
  const dirs=[{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:0,y:-1}];
  let walking=false,t=0;
  const {world,p}=runRig(()=>walking?dirs[Math.floor(t/30)%4]:undefined);
  for(let i=0;i<200&&world.round.phase!=='wave';i++){p.x=BASE.x;p.y=BASE.y;world.step();}
  p.x=BASE.x;p.y=BASE.y;
  ring(world,BASE,24);walking=true;
  let worst=0,checked=0;
  for(t=0;t<400;t++){
    world.step();
    for(const e of world.enemies.values())if(solidEnemy(e)&&!e.boss){worst=Math.max(worst,-gap(p,e));checked++;}
  }
  assert.ok(checked>400,`bodies checked ${checked}`);
  assert.ok(worst<=1e-6,`a body stood ${worst.toFixed(4)} u inside the hero`);
});

test('flying bodies are not solid (pombos: a hero walks under them)',()=>{
  const world=walkRig(()=>({seq:1,x:1,y:0} as PlayerInput));
  const p=addPlayer(world,'a',{x:BASE.x-1,y:BASE.y});
  const bird=createEnemy(world,'pombos',{x:BASE.x,y:BASE.y});
  assert.ok(isFlying(bird)&&!solidEnemy(bird));
  for(let t=0;t<30;t++)world.step();
  assert.ok(p.x>BASE.x+.5,'walked through');
  assert.equal(bird.x,BASE.x,'not pushed');
});
