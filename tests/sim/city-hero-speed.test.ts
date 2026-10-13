/**
 * cidade-04 (after D-036 landed on main) + velocidade-heroi-e-projetil: the room's movement (sim/systems/players.ts
 * movePlayer) walks a city hero at heroSpeed = HERO_SPEED_MULT × CITY_HERO_SPEED (≈3.9875 u/s), slowed at
 * × PLAYER_SLOW_MULT and slipping at PLAYER_SLIP_SPEED × heroSpeed / SPEED, on the REAL Cidade Nevada; the island and
 * the endless map walk 2 × SPEED (6.2) and slip at 2 × PLAYER_SLIP_SPEED. The phone's prediction
 * (maps/prediction.ts reconcile with the frame's tick and effects) lands on the room's position after every step.
 * Results only, no wall clock (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CityTerrain,cityAsField} from '../../src/maps/city/terrain.ts';
import {decodeCityAsset} from '../../src/maps/city-asset.ts';
import {DEFAULT_SEED,TerrainField,defaultTerrain} from '../../src/maps/terrain/field.ts';
import {CITY_HERO_SPEED,HERO_SPEED_MULT,SPAWN,SPEED,clearSegment,heroSpeed,walkable,type Point} from '../../src/maps/world.ts';
import {STEP,reconcile} from '../../src/maps/prediction.ts';
import {BASE_STATS,PLAYER_SLIP_SPEED,PLAYER_SLOW_MULT,type PlayerInput,type SimPlayer} from '../../src/contract/index.ts';
import {movePlayer} from '../../src/sim/systems/players.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const decoded=decodeCityAsset(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'));
if(!decoded.ok)throw new Error(decoded.error);
const city=new CityTerrain(decoded.asset,'city-hero-speed-test'),CITY=cityAsField(city);
const ENDLESS=new TerrainField(DEFAULT_SEED,{world:'infinito'});
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const near=(actual:number,expected:number,tol:number,what:string)=>
  assert.ok(Math.abs(actual-expected)<=tol,`${what}: ${actual} not within ${tol} of ${expected}`);
const input=(seq:number,d:Point):PlayerInput=>({seq,x:d.x,y:d.y,attack:false});
function player(at:Point,extra:Partial<SimPlayer>={}):SimPlayer{
  return {id:'p',classId:'test',x:at.x,y:at.y,hp:100,online:true,spectator:false,facing:{x:0,y:1},
    build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...extra};
}
function openDirection(from:Point,length:number,terrain:TerrainField):Point{
  for(let k=0;k<16;k++){
    const a=k*Math.PI/8,d={x:Math.cos(a),y:Math.sin(a)};
    if(clearSegment(from,{x:from.x+d.x*length,y:from.y+d.y*length},terrain))return d;
  }
  throw new Error('no open direction');
}
function endlessSpot(length:number):Point{
  for(let x=-40;x<=40;x+=2)for(let y=-40;y<=40;y+=2){
    const at={x,y};if(!walkable(at,ENDLESS))continue;
    try{openDirection(at,length,ENDLESS);return at;}catch{/* next spot */}
  }
  throw new Error('no open endless spot');
}
/** The city hero's walk: 2 × the faithful CITY_HERO_SPEED. */
const CITY_WALK=CITY_HERO_SPEED*HERO_SPEED_MULT;
const WORLDS=[
  {name:'city',terrain:CITY,at:{x:city.asset.points.praca.x,y:city.asset.points.praca.y},walk:CITY_WALK,slip:PLAYER_SLIP_SPEED*CITY_WALK/SPEED},
  {name:'island',terrain:defaultTerrain,at:{...SPAWN},walk:SPEED*HERO_SPEED_MULT,slip:PLAYER_SLIP_SPEED*HERO_SPEED_MULT},
  {name:'endless',terrain:ENDLESS,at:endlessSpot(1),walk:SPEED*HERO_SPEED_MULT,slip:PLAYER_SLIP_SPEED*HERO_SPEED_MULT},
];

test('room movePlayer: free, slowed and slipping steps per world (city 3.9875 u/s; island and endless 6.2, slip 8.4)',()=>{
  for(const w of WORLDS){
    assert.equal(heroSpeed(w.terrain),w.walk,`${w.name}: 2 × the base walk`);
    const d=openDirection(w.at,1,w.terrain),back={x:-d.x,y:-d.y},tick=200;
    const free=player(w.at);movePlayer(free,input(1,d),w.terrain,tick);
    near(dist(w.at,free),w.walk*STEP,1e-12,`${w.name}: free step`);
    const tickless=player(w.at);movePlayer(tickless,input(1,d),w.terrain);
    near(dist(w.at,tickless),w.walk*STEP,1e-12,`${w.name}: step without a tick`);
    const slow=player(w.at,{slowUntil:tick+1});movePlayer(slow,input(1,d),w.terrain,tick);
    near(dist(w.at,slow),w.walk*PLAYER_SLOW_MULT*STEP,1e-12,`${w.name}: slowed step`);
    const over=player(w.at,{slowUntil:tick});movePlayer(over,input(1,d),w.terrain,tick);
    near(dist(w.at,over),w.walk*STEP,1e-12,`${w.name}: slow over at slowUntil`);
    // Slipping along `slip` with the stick the other way: the stick and the facing are ignored.
    const slip=player(w.at,{slipUntil:tick+1,slip:d,slowUntil:tick+9});movePlayer(slip,input(1,back),w.terrain,tick);
    near(dist(w.at,slip),w.slip*STEP,1e-12,`${w.name}: slip step`);
    near((slip.x-w.at.x)*d.x+(slip.y-w.at.y)*d.y,w.slip*STEP,1e-12,`${w.name}: along slip`);
    assert.deepEqual(slip.facing,{x:0,y:1},`${w.name}: facing kept while slipping`);
  }
  near(WORLDS[0].slip/WORLDS[0].walk,PLAYER_SLIP_SPEED/SPEED,1e-12,'the city keeps the slip/walk ratio');
});

test('real city: the phone\'s prediction equals the room\'s movement step by step, through slip, slow, stand-stills and walls',t=>{
  const {praca}=city.asset.points,from={x:praca.x,y:praca.y};
  const d=openDirection(from,2,CITY),turn={x:-d.y,y:d.x};
  // A frame of tick 300 confirmed `from`; the next inputs land on ticks 301, 302, … (prediction.ts tick mapping).
  const frameTick=300,effects={slipUntil:304,slip:turn,slowUntil:315};
  // Long enough to reach walls (≈ 12 u per leg): the stick turns every 120 inputs, with stand-stills in between.
  const dirs=[d,turn,{x:-d.x,y:-d.y},{x:-turn.x,y:-turn.y}];
  const inputs=Array.from({length:480},(_,k)=>input(k+1,k%9===8?{x:0,y:0}:dirs[Math.floor(k/120)]));
  const room=player(from,effects),stepsSeen=new Set<string>();let blocked=0;
  for(let k=0;k<inputs.length;k++){
    const before={x:room.x,y:room.y},tick=frameTick+1+k;
    movePlayer(room,inputs[k],CITY,tick);
    const step=dist(before,room),kind=tick<304?'slip':inputs[k].x===0&&inputs[k].y===0?'stand':tick<315?'slow':'free';
    stepsSeen.add(kind);if(kind==='free'&&step<CITY_WALK*STEP-1e-9)blocked++;
    const predicted=reconcile(from,inputs.slice(0,k+1),CITY,{tick:frameTick,effects});
    assert.deepEqual(predicted,{x:room.x,y:room.y},`input ${k+1} (tick ${tick})`);
    assert.ok(walkable(predicted,CITY),'never inside a building');
    // A step is never longer than the world's speed for that tick.
    const cap=(tick<304?PLAYER_SLIP_SPEED*CITY_WALK/SPEED:tick<315?CITY_WALK*PLAYER_SLOW_MULT:CITY_WALK)*STEP;
    assert.ok(step<=cap+1e-12,`tick ${tick}: step ${step} over ${cap}`);
  }
  assert.deepEqual([...stepsSeen].sort(),['free','slip','slow','stand']);
  t.diagnostic(`${blocked} free steps shortened or stopped by a wall`);
  assert.ok(blocked>0,'the walk met walls (slides along them on both sides alike)');
  // Without effects (a frame after they ended), the replay is the plain city walk on both sides too.
  const plain=player(from),k=12;
  for(let i=0;i<k;i++)movePlayer(plain,inputs[i],CITY,frameTick+400+i);
  assert.deepEqual(reconcile(from,inputs.slice(0,k),CITY,{tick:frameTick+399}),{x:plain.x,y:plain.y});
});
