/**
 * cidade-04: the hero walks at the city's faithful speed (world.ts CITY_HERO_SPEED ≈ 1.99375 u/s, rules/scale.ts
 * 'cidade-nevada') on the real city terrain, and at SPEED (3.1) on the island and the endless map. moveDirection and
 * prediction.ts moveStep are what both the room (sim/systems/players.ts movePlayer) and the phone's prediction
 * (simulate/reconcile) call, so one step here is one step on both sides (tests/sim/city-hero-speed.test.ts checks the
 * room's side). D-036 effects scale with the world: slowed = heroSpeed × PLAYER_SLOW_MULT, slip =
 * PLAYER_SLIP_SPEED × heroSpeed / SPEED (island and endless: exactly PLAYER_SLIP_SPEED). Results only, no wall clock (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CityTerrain,cityAsField} from '../../src/maps/city/terrain.ts';
import {decodeCityAsset} from '../../src/maps/city-asset.ts';
import {defaultTerrain,type TerrainField} from '../../src/maps/terrain/field.ts';
import {DEFAULT_SEED,TerrainField} from '../../src/maps/terrain/field.ts';
import {CITY_HERO_SPEED,RADIUS,SPAWN,SPEED,clearSegment,heroSpeed,moveAlong,moveDirection,walkable,type Point} from '../../src/maps/world.ts';
import {STEP,moveStep,reconcile,simulate,type MoveEffects} from '../../src/maps/prediction.ts';
import {PLAYER_SLIP_SPEED,PLAYER_SLOW_MULT,type PlayerInput} from '../../src/contract/index.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const decoded=decodeCityAsset(TEXT);
if(!decoded.ok)throw new Error(decoded.error);
const city=new CityTerrain(decoded.asset,'city-speed-test');
const field:TerrainField=cityAsField(city);
const {praca,inicio}=city.asset.points;
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const near=(actual:number,expected:number,tol:number,what:string)=>
  assert.ok(Math.abs(actual-expected)<=tol,`${what}: ${actual} not within ${tol} of ${expected}`);
const input=(seq:number,d:Point):PlayerInput=>({seq,x:d.x,y:d.y,attack:false});
const ENDLESS=new TerrainField(DEFAULT_SEED,{world:'infinito'});

/** A direction out of the plaza with at least `length` units of free, swept ground ahead. */
function openDirection(from:Point,length:number,terrain:TerrainField=field):Point{
  for(let k=0;k<16;k++){
    const a=k*Math.PI/8,d={x:Math.cos(a),y:Math.sin(a)};
    if(clearSegment(from,{x:from.x+d.x*length,y:from.y+d.y*length},terrain))return d;
  }
  throw new Error('no open direction out of the plaza');
}
/** A walkable spot of the endless map with `length` units of free ground in some direction. */
function endlessSpot(length:number):{at:Point;d:Point}{
  for(let x=-40;x<=40;x+=2)for(let y=-40;y<=40;y+=2){
    const at={x,y};if(!walkable(at,ENDLESS))continue;
    try{return {at,d:openDirection(at,length,ENDLESS)};}catch{/* next spot */}
  }
  throw new Error('no open endless spot');
}

test('heroSpeed: the city walks at CITY_HERO_SPEED (≈1.99375), every other world at SPEED',()=>{
  near(CITY_HERO_SPEED,1.99375,1e-12,'290 WC3 u/s × 0.006875');
  assert.equal(heroSpeed(field),CITY_HERO_SPEED);assert.equal(heroSpeed(defaultTerrain),SPEED);assert.equal(heroSpeed(),SPEED);
  assert.ok(CITY_HERO_SPEED<SPEED,'the city hero is slower: faithful proportions, not the endless map speed');
});

test('real city: a free step is exactly heroSpeed × STEP (moveDirection, simulate, reconcile); the island keeps SPEED × STEP',()=>{
  const d=openDirection(praca,CITY_HERO_SPEED+1);
  const from={x:praca.x,y:praca.y};
  const q=moveDirection(from,d,STEP,field);
  near(dist(from,q),heroSpeed(field)*STEP,1e-12,'moveDirection city step');
  // A joystick at any magnitude moves the same distance (direction only).
  near(dist(from,simulate(from,{seq:0,x:d.x*.3,y:d.y*.3,attack:false},field)),CITY_HERO_SPEED*STEP,1e-12,'simulate city step');
  // One second of free walking (20 ticks) covers CITY_HERO_SPEED units, on the room's replay as on the phone.
  const inputs=Array.from({length:Math.round(1/STEP)},(_,seq)=>({seq,x:d.x,y:d.y,attack:false}));
  near(dist(from,reconcile(from,inputs,field)),CITY_HERO_SPEED,1e-9,'1 s of walking in the city');
  // Island, same code path: the old speed is untouched.
  near(dist(SPAWN,moveDirection(SPAWN,{x:1,y:0},STEP,defaultTerrain)),SPEED*STEP,1e-12,'island step');
});

test('real city: moveAlong (tap-to-walk) advances heroSpeed × seconds along a free route',()=>{
  const d=openDirection(praca,CITY_HERO_SPEED+1),from={x:praca.x,y:praca.y};
  const route=[{x:from.x+d.x*(CITY_HERO_SPEED+.5),y:from.y+d.y*(CITY_HERO_SPEED+.5)}];
  let p=from;
  for(let i=0;i<10;i++)p=moveAlong(p,route,.1,field);
  assert.equal(route.length,1,'not arrived yet');
  near(dist(from,p),CITY_HERO_SPEED,1e-9,'1 s of tap-to-walk in the city');
});

/**
 * D-036 effects through the real step (moveStep, simulate with tick/effects) in every world: free walk = heroSpeed × STEP,
 * slowed = × PLAYER_SLOW_MULT, slip = PLAYER_SLIP_SPEED × heroSpeed / SPEED along the slide with the stick ignored.
 */
test('every world: free, slowed and slipping steps scale with the world\'s hero speed (city 1.99375, island and endless 3.1)',()=>{
  const worlds=[
    {name:'city',terrain:field,at:{x:praca.x,y:praca.y},d:openDirection(praca,1),walk:CITY_HERO_SPEED,slip:PLAYER_SLIP_SPEED*CITY_HERO_SPEED/SPEED},
    {name:'island',terrain:defaultTerrain,at:SPAWN,d:openDirection(SPAWN,1,defaultTerrain),walk:SPEED,slip:PLAYER_SLIP_SPEED},
    {name:'endless',terrain:ENDLESS,...(()=>{const e=endlessSpot(1);return {at:e.at,d:e.d};})(),walk:SPEED,slip:PLAYER_SLIP_SPEED},
  ];
  for(const w of worlds){
    assert.equal(heroSpeed(w.terrain),w.walk,`${w.name}: hero speed`);
    const tick=100,back={x:-w.d.x,y:-w.d.y};
    const free=moveStep(w.at,w.d,tick,undefined,w.terrain),none=moveStep(w.at,w.d,tick,{},w.terrain);
    near(dist(w.at,free),w.walk*STEP,1e-12,`${w.name}: free step`);
    assert.deepEqual(none,free,`${w.name}: no effects = plain walk`);
    assert.deepEqual(simulate(w.at,input(1,w.d),w.terrain,tick,{}),free);
    assert.deepEqual(simulate(w.at,input(1,w.d),w.terrain),moveDirection(w.at,w.d,STEP,w.terrain),`${w.name}: tickless simulate = moveDirection`);
    // Slowed while tick < slowUntil, plain from slowUntil on.
    const slowFx:MoveEffects={slowUntil:tick+1};
    near(dist(w.at,moveStep(w.at,w.d,tick,slowFx,w.terrain)),w.walk*PLAYER_SLOW_MULT*STEP,1e-12,`${w.name}: slowed step`);
    near(dist(w.at,simulate(w.at,input(1,w.d),w.terrain,tick,slowFx)),w.walk*PLAYER_SLOW_MULT*STEP,1e-12,`${w.name}: slowed simulate`);
    near(dist(w.at,moveStep(w.at,w.d,tick+1,slowFx,w.terrain)),w.walk*STEP,1e-12,`${w.name}: slow over`);
    // Slipping along `slip` whatever the stick (here the opposite way), at the world's slip speed; wins over a slow.
    const slipFx:MoveEffects={slipUntil:tick+1,slip:w.d,slowUntil:tick+5};
    const slid=moveStep(w.at,back,tick,slipFx,w.terrain);
    near(dist(w.at,slid),w.slip*STEP,1e-12,`${w.name}: slip step`);
    near((slid.x-w.at.x)*w.d.x+(slid.y-w.at.y)*w.d.y,w.slip*STEP,1e-12,`${w.name}: slides along slip, not the stick`);
    near(dist(w.at,moveStep(w.at,back,tick+1,slipFx,w.terrain)),w.walk*PLAYER_SLOW_MULT*STEP,1e-12,`${w.name}: slip over, still slowed`);
  }
  // The city's slip keeps the endless ratio to walking (PLAYER_SLIP_SPEED / SPEED), so the city stays in proportion.
  near(worlds[0].slip/worlds[0].walk,PLAYER_SLIP_SPEED/SPEED,1e-12,'city slip / walk');
});

test('real city: the phone\'s replay (reconcile with tick and effects) lands where stepping the room\'s moveStep tick by tick does',()=>{
  const d=openDirection(praca,3),from={x:praca.x,y:praca.y};
  const turn={x:-d.y,y:d.x},frameTick=40;
  // Slipping on ticks 41..43 along `turn` (the stick says d), slowed 44..48, then walking free.
  const effects:MoveEffects={slipUntil:44,slip:turn,slowUntil:49};
  const inputs=Array.from({length:20},(_,k)=>input(k+1,k%7===6?{x:0,y:0}:d));
  let room={...from};const steps:number[]=[];
  for(let k=0;k<inputs.length;k++){
    const before=room;room=moveStep(room,{x:inputs[k].x,y:inputs[k].y},frameTick+1+k,effects,field);steps.push(dist(before,room));
    // Every prefix too: the replay of k+1 pending inputs is the room after k+1 steps.
    assert.deepEqual(reconcile(from,inputs.slice(0,k+1),field,{tick:frameTick,effects}),room,`prefix ${k+1}`);
  }
  // Ticks 41..43 slip, 44..48 slowed (47 is a stand-still input), then free (54 stands still).
  const expected=inputs.map((i,k)=>{
    const t=frameTick+1+k;
    if(t<44)return PLAYER_SLIP_SPEED*CITY_HERO_SPEED/SPEED*STEP;
    if(i.x===0&&i.y===0)return 0;
    return (t<49?CITY_HERO_SPEED*PLAYER_SLOW_MULT:CITY_HERO_SPEED)*STEP;
  });
  assert.ok(expected.some(e=>e===0)&&new Set(expected).size===4,'slip, slowed, free and standing all covered');
  steps.forEach((s,k)=>near(s,expected[k],1e-9,`tick ${frameTick+1+k}`));
});

/**
 * Shortest street path from inicio to praca over the 0.22 u samples where the hero disc (RADIUS) fits: 8-neighbour
 * Dijkstra (diagonals only when both orthogonal neighbours fit). Returns the sample centres from start to plaza.
 */
function streetPath(from:Point,to:Point):Point[]{
  const {w,h,step}=city.asset.samples,n=w*h;
  const fits=new Uint8Array(n);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)fits[y*w+x]=city.clearDisc((x+.5)*step,(y+.5)*step,RADIUS)?1:0;
  const at=(p:Point)=>Math.floor(p.y/step)*w+Math.floor(p.x/step);
  const s=at(from),t=at(to);
  assert.ok(fits[s]&&fits[t],'start and plaza samples fit the hero');
  const cost=new Float64Array(n).fill(Infinity),done=new Uint8Array(n),came=new Int32Array(n).fill(-1);
  // Binary min-heap of (cost, index).
  const heapC:number[]=[],heapI:number[]=[];
  const push=(c:number,i:number)=>{
    let k=heapC.length;heapC.push(c);heapI.push(i);
    while(k>0){const p=(k-1)>>1;if(heapC[p]<=c)break;heapC[k]=heapC[p];heapI[k]=heapI[p];k=p;}
    heapC[k]=c;heapI[k]=i;
  };
  const pop=():number=>{
    const top=heapI[0],lastC=heapC.pop()!,lastI=heapI.pop()!;
    if(heapC.length){
      let k=0;const len=heapC.length;
      for(;;){let c=2*k+1;if(c>=len)break;if(c+1<len&&heapC[c+1]<heapC[c])c++;if(heapC[c]>=lastC)break;heapC[k]=heapC[c];heapI[k]=heapI[c];k=c;}
      heapC[k]=lastC;heapI[k]=lastI;
    }
    return top;
  };
  cost[s]=0;push(0,s);
  while(heapC.length){
    const i=pop();if(done[i])continue;done[i]=1;
    if(i===t)break;
    const x=i%w,y=(i/w)|0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;
      const j=ny*w+nx;if(!fits[j]||done[j])continue;
      if(dx&&dy&&!(fits[y*w+nx]&&fits[ny*w+x]))continue;
      const c=cost[i]+(dx&&dy?Math.SQRT2:1);
      if(c<cost[j]){cost[j]=c;came[j]=i;push(c,j);}
    }
  }
  assert.ok(done[t],'the plaza is reachable from the start');
  const ids=[t];while(ids[0]!==s)ids.unshift(came[ids[0]]);
  return ids.map(i=>({x:(i%w+.5)*step,y:(((i/w)|0)+.5)*step}));
}
/** The street path pulled taut like world.ts findPath does (farthest point in swept sight), ending on the plaza point. */
function tautRoute(from:Point,samples:Point[],to:Point):Point[]{
  const rough=[from,...samples,to],route:Point[]=[];
  let at=0;
  while(at<rough.length-1){
    let next=rough.length-1;
    while(next>at+1&&!clearSegment(rough[at],rough[next],field))next--;
    assert.ok(clearSegment(rough[at],rough[next],field),`leg ${at}→${next} of the street path is walkable`);
    route.push(rough[next]);at=next;
  }
  return route;
}

test('real city: walking start → plaza along the streets takes 33–40 s at the city speed',t=>{
  const samples=streetPath(inicio,praca),route=tautRoute(inicio,samples,praca);
  const routeLength=route.reduce((sum,p,i)=>sum+dist(i?route[i-1]:inicio,p),0),straight=dist(inicio,praca);
  // Walk it: the tap-to-walk step (moveAlong at heroSpeed(field)), one 20 Hz tick at a time, until the plaza.
  const path=route.map(p=>({...p}));let p={x:inicio.x,y:inicio.y},ticks=0;
  while(path.length&&ticks<10*60*20){const q=moveAlong(p,path,STEP,field);if(dist(p,q)===0)break;p=q;ticks++;}
  assert.equal(path.length,0,'the walk reached the end of the route (never blocked by a wall)');
  near(dist(p,praca),0,1e-6,'standing on the plaza point');
  const seconds=ticks*STEP;
  t.diagnostic(`start → plaza: walked ${routeLength.toFixed(1)} u in ${ticks} ticks = ${seconds.toFixed(1)} s (street samples ${samples.length}, taut route ${route.length} legs, ${straight.toFixed(1)} u straight)`);
  assert.ok(routeLength>=straight-1e-9,'the streets are never shorter than the straight line');
  // Each tick covered the city speed × STEP of route (the last one the remainder): the time is the city speed's.
  assert.equal(ticks,Math.ceil(routeLength/(CITY_HERO_SPEED*STEP)-1e-9));
  assert.ok(seconds>=33&&seconds<=40,`start → plaza ${seconds.toFixed(1)} s (${routeLength.toFixed(1)} u at ${CITY_HERO_SPEED} u/s)`);
  // At the endless map's speed the same street would be a noticeably shorter walk: the change is real.
  assert.ok(routeLength/SPEED<seconds*.7);
});
