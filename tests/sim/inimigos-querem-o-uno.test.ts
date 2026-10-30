// NEW-20261023-ORQ-inimigos-querem-o-uno (the user, 23/10: "todos os inimigos querem quebrar o Uno pelo barulho; somente
// uma parte vai pensar em nos atacar"; "se o Uno quebrar, fim de partida"). The wave bodies get a foco (enemies/foco.ts):
// most walk past the players to the car, the rest hunt the players and leave the car alone; a hit turns a Uno body on its
// hitter for a while, under a cap. The car's hit limit grows with the room, repair() gives a share back, and a car that
// takes its limit ends the run in defeat.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {walkable,type Point} from '../../src/maps/index.ts';
import {BASE_STATS,ticks,type EnemyState,type SimPlayer} from '../../src/contract/index.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems} from '../../src/sim/assemble.ts';
import {CAR_LIMIT,CAR_REPAIR_SHARE,carLimitFor} from '../../src/sim/chaveiro/system.ts';
import {AGGRO,AGGRO_PER_PLAYER,AGGRO_SECONDS,FOCO,FOCO_CACADOR,FOCO_UNO,UNO_FOCUS_SHARE,focoOf} from '../../src/sim/enemies/foco.ts';
import {WAVE_MEMORY} from '../../src/sim/ninhos/ninhos.ts';
import {SIEGE_FLAG} from '../../src/sim/stonewards/wall.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;

function addPlayer(world:SimWorld,id:string,p:Point){
  const player={id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x:p.x,y:p.y,ack:0,score:0} as SimPlayer;
  world.players.set(id,player);return player;
}
function addEnemy(world:SimWorld,id:string,p:Point,foco?:number){
  const e:EnemyState={id,kind:'bebado',x:p.x,y:p.y,hp:1e6,maxHp:1e6,speed:1,damage:0,radius:.4,xp:1,spawnTick:0,readyTick:0,
    memory:{[SIEGE_FLAG]:1,...(foco!==undefined?{[FOCO]:foco}:{})}};
  world.enemies.set(id,e);return e;
}
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);

/** The chaveiro in the city without the nests (no minuto de Minerva holding the bodies), stepped once. */
function rig(players=1,mode?:'ninhos'){
  const world=new SimWorld({terrain:city.fork(),seed:5,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const outcomes:string[]=[];
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:o=>outcomes.push(o),cityTutorial:false,objective:'chaveiro',...(mode?{mode}:{})});
  const ch=sys.chaveiro!;
  const car=ch.state.car;
  // A walkable spot ~9 u from the car, and one ~2 u further out (the player stands between the body and nothing else).
  let spot:Point|undefined,out:Point|undefined;
  for(let a=0;a<64&&!out;a++){
    // From the west (uno-estaciona-fora-da-boca: the car parks 1.5 u east of the plaza, and 9-11 u east of it the city's
    // flow field bends the hunter off the player): the long avenue.
    const t=Math.PI+a/64*Math.PI*2,c=Math.cos(t),s=Math.sin(t);
    const p={x:car.x+9*c,y:car.y+9*s},q={x:car.x+11*c,y:car.y+11*s};
    if(walkable(p,world.terrain)&&walkable(q,world.terrain)){spot=p;out=q;}
  }
  assert.ok(spot&&out,'a free spot near the car');
  const team=Array.from({length:players},(_,i)=>addPlayer(world,`p${i}`,{...out!}));
  world.step();
  return {world,sys,ch,car,spot:spot!,out:out!,team,outcomes};
}
/** Steps `n` ticks keeping the players where they stand and full of hp. */
function run(r:ReturnType<typeof rig>,n:number){
  for(let i=0;i<n;i++){r.team.forEach(p=>{p.x=r.out.x;p.y=r.out.y;p.hp=p.stats.maxHp;});r.world.step();}
}

test('the foco is a pure function of the id: ~75 % go for the Uno',()=>{
  let uno=0;const N=4000;
  for(let i=0;i<N;i++){const f=focoOf(`e${i}`);assert.ok(f===FOCO_UNO||f===FOCO_CACADOR);if(f===FOCO_UNO)uno++;}
  assert.ok(Math.abs(uno/N-UNO_FOCUS_SHARE)<.03,`share ${uno/N}`);
  assert.equal(focoOf('abc'),focoOf('abc'));
});

test('a Uno body walks past a nearer player to the car; a hunter goes for the player and leaves the car alone',()=>{
  const r=rig();
  const uno=addEnemy(r.world,'uno',r.spot,FOCO_UNO),hunter=addEnemy(r.world,'hunter',r.spot,FOCO_CACADOR);
  const old=addEnemy(r.world,'old',r.spot);
  const p=r.team[0];
  // The player is 2 u away, the car 9 u: the old rule (nearest) and the hunter go for the player.
  run(r,ticks(4));
  assert.ok(dist(uno,r.car)<9-2,`the Uno body closed on the car (${dist(uno,r.car).toFixed(2)})`);
  assert.ok(dist(hunter,p)<1.5,`the hunter is on the player (${dist(hunter,p).toFixed(2)})`);
  assert.ok(dist(old,p)<1.5,`no foco: the nearest, as before (${dist(old,p).toFixed(2)})`);
});

test('a hit turns a Uno body on its hitter for AGGRO_SECONDS, then it goes back to the car',()=>{
  const r=rig();
  const uno=addEnemy(r.world,'uno',r.spot,FOCO_UNO),p=r.team[0];
  r.world.damageEnemy('uno',1,p.id);
  run(r,ticks(2));
  assert.equal(uno.memory![AGGRO],1);
  assert.ok(dist(uno,p)<1.5,`provoked: on the player (${dist(uno,p).toFixed(2)})`);
  run(r,ticks(AGGRO_SECONDS));
  assert.equal(uno.memory![AGGRO],undefined,'the aggro wore off');
  const away=dist(uno,r.car);
  run(r,ticks(3));
  assert.ok(dist(uno,r.car)<away-1,`back to the car (${away.toFixed(2)} → ${dist(uno,r.car).toFixed(2)})`);
});

test('the aggro has a cap: AGGRO_PER_PLAYER × live players at once',()=>{
  const r=rig(1);
  const bodies=Array.from({length:AGGRO_PER_PLAYER+3},(_,i)=>addEnemy(r.world,`u${i}`,r.spot,FOCO_UNO));
  for(const e of bodies)r.world.damageEnemy(e.id,1,r.team[0].id);
  run(r,1);
  assert.equal(bodies.filter(e=>e.memory![AGGRO]===1).length,AGGRO_PER_PLAYER);
  // A tower's or a nameless hit (no player) provokes nobody.
  const calm=addEnemy(r.world,'calm',r.spot,FOCO_UNO);r.world.damageEnemy('calm',1);
  run(r,1);assert.equal(calm.memory![AGGRO],undefined);
});

test('the Uno\'s limit grows with the room; repair gives a share back; at the limit the run is lost',()=>{
  assert.equal(carLimitFor(1),CAR_LIMIT);
  for(const n of [1,3,6])assert.equal(rig(n).car.limit,carLimitFor(n),`${n} players`);
  assert.ok(carLimitFor(6)>carLimitFor(3)&&carLimitFor(3)>carLimitFor(1));
  const r=rig(1),hitter=addEnemy(r.world,'h',r.car);
  for(let i=0;i<40;i++)r.ch.hitCar(r.world,hitter);
  assert.equal(r.car.hits,40);
  r.ch.repair(r.world);
  assert.equal(r.car.hits,40-Math.round(CAR_REPAIR_SHARE*r.car.limit));
  r.ch.repair(r.world);r.ch.repair(r.world);assert.equal(r.car.hits,0,'never below 0');
  while(r.ch.state.ended===undefined)r.ch.hitCar(r.world,hitter);
  assert.equal(r.ch.state.ended,'defeat');assert.deepEqual(r.outcomes,['defeat']);
  assert.equal(r.ch.result(r.world.tick,{index:0,total:1})?.cause,'car');
});

test('every body of a nests wave gets a foco, ~75 % for the Uno',()=>{
  const r=rig(2,'ninhos');
  const seen=new Map<string,number>();
  for(let i=0;i<ticks(8*60)&&seen.size<40;i++){
    run(r,1);
    for(const e of r.world.enemies.values())if(e.memory?.[WAVE_MEMORY]!==undefined&&!e.boss)seen.set(e.id,e.memory[FOCO]!);
  }
  assert.ok(seen.size>=10,`waves came (${seen.size} bodies)`);
  for(const [id,f] of seen)assert.equal(f,focoOf(id),id);
});
