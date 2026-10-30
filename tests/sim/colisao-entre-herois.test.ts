/**
 * Card NEW-20261030-ORQ-colisao-entre-herois (user, 30/10: "Consegue criar colisão entre as pessoas?"): the heroes on
 * their feet are soft bodies to each other (maps/bodies.ts heroBlock + heroApart, sim players system, the phone's replay).
 *  - 2 heroes walking into each other stop at the edge; 2 standing inside each other come apart until they just touch;
 *    nobody leaves the walkable ground (a hero pushed against a wall stays on the street);
 *  - the phone's replay (maps reconcile with clock.heroes) takes the very same steps as the room;
 *  - 6 heroes piled on the spawn come loose in a few ticks, each always moving out (no shaking);
 *  - a downed hero is not solid: the rescuer walks right up to (and over) them.
 * On the REAL Cidade Nevada (the plaza), D-031: no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {heroSpeed,walkable,type Point} from '../../src/maps/world.ts';
import {reconcile} from '../../src/maps/prediction.ts';
import {HERO_GAP,HERO_SOFT,type HeroBody} from '../../src/maps/bodies.ts';
import {BASE_STATS,type EnemyState,type PlayerInput,type SimPlayer} from '../../src/contract/index.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER,playersSystem} from '../../src/sim/systems/players.ts';
import {createRunSystems} from '../../src/sim/assemble.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(TEXT,HASH);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;
const STEP_U=heroSpeed(city)/20;

function addPlayer(world:SimWorld,id:string,p:Point){
  const player={id,classId:'x',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:100},weaponReady:{},x:p.x,y:p.y,ack:0,score:0} as SimPlayer;
  world.players.set(id,player);return player;
}
/** Only the players system with the bodies: each hero holds the direction `dirs` gives it (none: stands). */
function walkRig(dirs:Record<string,Point|undefined>){
  const world=new SimWorld({terrain:city,seed:1,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const seq:Record<string,number>={};
  world.register(playersSystem(id=>{const d=dirs[id];if(!d)return undefined;seq[id]=(seq[id]??0)+1;return {seq:seq[id],x:d.x,y:d.y} as PlayerInput;},
    undefined,undefined,undefined,undefined,true));
  return world;
}
function plaza(){
  const world=new SimWorld({terrain:city,seed:1,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false});
  return sys.avenues!.plazaCenter;
}
const BASE=plaza();
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const EPS=1e-9;

test('2 heroes walking into each other stop at the edge (never deeper than HERO_SOFT) and stay on the street',()=>{
  const world=walkRig({a:{x:1,y:0},b:{x:-1,y:0}});
  const a=addPlayer(world,'a',{x:BASE.x-1.5,y:BASE.y}),b=addPlayer(world,'b',{x:BASE.x+1.5,y:BASE.y});
  for(let t=0;t<80;t++){
    world.step();
    assert.ok(dist(a,b)>=HERO_GAP-HERO_SOFT-EPS,`tick ${t}: ${dist(a,b).toFixed(4)} u apart`);
    assert.ok(walkable(a,city)&&walkable(b,city),`tick ${t}: off the street`);
  }
  assert.ok(dist(a,b)<=HERO_GAP+EPS,`they stopped ${dist(a,b).toFixed(3)} u apart, not touching`);
  assert.ok(Math.abs((a.x+b.x)/2-BASE.x)<.01,'met in the middle');
  assert.ok(a.x<b.x,'nobody walked through');
});

test('2 standing heroes inside each other come apart until they just touch, never past it',()=>{
  const world=walkRig({});
  const a=addPlayer(world,'a',{x:BASE.x,y:BASE.y}),b=addPlayer(world,'b',{x:BASE.x+.1,y:BASE.y+.03});
  let last=dist(a,b);
  for(let t=0;t<40;t++){
    world.step();
    const d=dist(a,b);
    assert.ok(d>=last-EPS,`tick ${t}: closer again (${last.toFixed(4)} → ${d.toFixed(4)})`);
    assert.ok(d<=HERO_GAP+EPS,`tick ${t}: pushed past touching (${d.toFixed(4)})`);
    last=d;
  }
  assert.ok(HERO_GAP-last<1e-3,`still ${(HERO_GAP-last).toFixed(4)} u inside each other`);
});

test('a hero pushed against a wall stays on the street; the pusher stops',()=>{
  // East from the plaza to the first wall: b stands right at it, a walks into b from the west.
  let x=BASE.x;
  while(walkable({x:x+.05,y:BASE.y},city)&&x-BASE.x<80)x+=.05;
  assert.ok(x-BASE.x>1.5&&x-BASE.x<80,`a wall ${(x-BASE.x).toFixed(1)} u east of the plaza`);
  const world=walkRig({a:{x:1,y:0}});
  const b=addPlayer(world,'b',{x,y:BASE.y}),a=addPlayer(world,'a',{x:x-1.2,y:BASE.y});
  for(let t=0;t<80;t++){
    world.step();
    assert.ok(walkable(a,city)&&walkable(b,city),`tick ${t}: off the street`);
    assert.ok(dist(a,b)>=HERO_GAP-HERO_SOFT-EPS,`tick ${t}: ${dist(a,b).toFixed(4)} u apart`);
  }
  assert.ok(Math.abs(b.y-BASE.y)<.3,'b was not shoved along the wall far away');
});

test('the phone replays the room: walking into a standing teammate (and past a walking one) lands on the same spot',()=>{
  for(const [dir,other] of [[{x:1,y:0},{x:BASE.x,y:BASE.y}],[{x:1,y:.3},{x:BASE.x,y:BASE.y+.15}],[{x:0,y:1},{x:BASE.x+.05,y:BASE.y+1.5}]] as const){
    const world=walkRig({a:dir});
    const start=dir.y===1?{x:BASE.x,y:BASE.y}:{x:BASE.x-1.5,y:BASE.y};
    const a=addPlayer(world,'a',start),b=addPlayer(world,'b',other);
    const inputs:PlayerInput[]=[];
    for(let t=0;t<40;t++){world.step();inputs.push({seq:t+1,x:dir.x,y:dir.y} as PlayerInput);}
    assert.ok(dist(b,other)>1e-3,'the teammate was nudged (the case is not empty)');
    const copy:HeroBody={x:other.x,y:other.y};
    const phone=reconcile({...start},inputs,city,{tick:0,heroes:[copy]});
    assert.ok(Math.abs(phone.x-a.x)<EPS&&Math.abs(phone.y-a.y)<EPS,`phone (${phone.x},${phone.y}) room (${a.x},${a.y})`);
    assert.ok(Math.abs(copy.x-b.x)<EPS&&Math.abs(copy.y-b.y)<EPS,'the copy went where the teammate went');
  }
  // A teammate walking across: the copy walks on with the frame's velocity, as the room's teammate does.
  const world=walkRig({a:{x:1,y:0},b:{x:0,y:1}});
  const start={x:BASE.x-1.2,y:BASE.y},bStart={x:BASE.x,y:BASE.y-1.2};
  const a=addPlayer(world,'a',start),b=addPlayer(world,'b',bStart);
  world.step();
  const vy=b.y-bStart.y;
  assert.ok(Math.abs(vy-STEP_U)<1e-6,`b walks ${vy} per tick`);
  const from={x:a.x,y:a.y},copy:HeroBody={x:b.x,y:b.y,vx:0,vy};
  const inputs:PlayerInput[]=[];
  let met=false;
  for(let t=0;t<30;t++){world.step();inputs.push({seq:t+2,x:1,y:0} as PlayerInput);met||=dist(a,b)<HERO_GAP;}
  assert.ok(met,'they met on the way');
  const phone=reconcile(from,inputs,city,{tick:1,heroes:[copy]});
  assert.ok(dist(phone,a)<.05,`crossing: phone (${phone.x},${phone.y}) room (${a.x},${a.y})`);
});

test('6 heroes piled on the spawn come loose in a few ticks, each always moving out (no shaking), on the street',()=>{
  const world=walkRig({});
  const ids=['a','b','c','d','e','f'];
  const ps=ids.map((id,i)=>addPlayer(world,id,{x:BASE.x+(i%3)*.03,y:BASE.y+Math.floor(i/3)*.03}));
  const prev=ps.map(p=>({x:p.x,y:p.y})),move=ps.map(()=>({x:0,y:0}));
  let loose=-1;
  for(let t=1;t<=60;t++){
    world.step();
    ps.forEach((p,i)=>{
      const dx=p.x-prev[i]!.x,dy=p.y-prev[i]!.y,m=move[i]!;
      // Each hero's moves keep a heading out: never back against the last one.
      if(Math.hypot(dx,dy)>1e-6&&Math.hypot(m.x,m.y)>1e-6)assert.ok(dx*m.x+dy*m.y>-1e-9,`tick ${t}: ${p.id} shook back`);
      if(Math.hypot(dx,dy)>1e-6){m.x=dx;m.y=dy;}
      prev[i]={x:p.x,y:p.y};
      assert.ok(walkable(p,city),`tick ${t}: ${p.id} off the street`);
    });
    let worst=0;
    for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++)worst=Math.max(worst,HERO_GAP-dist(ps[i]!,ps[j]!));
    if(loose<0&&worst<=HERO_SOFT)loose=t;
  }
  assert.ok(loose>0&&loose<=30,`still piled after ${loose<0?'60':loose} ticks`);
});

test('a downed hero is not solid: the rescuer walks right up to them, and they are not pushed',()=>{
  const world=walkRig({a:{x:1,y:0}});
  const a=addPlayer(world,'a',{x:BASE.x-1.5,y:BASE.y}),down=addPlayer(world,'down',{x:BASE.x,y:BASE.y});
  down.downed={sinceTick:0,bleedOutTick:1e9,progress:0};
  for(let t=0;t<15;t++)world.step();
  assert.ok(a.x>BASE.x-.1,`the rescuer stopped ${(BASE.x-a.x).toFixed(2)} u short`);
  assert.equal(down.x,BASE.x,'the downed hero was not pushed');
});
