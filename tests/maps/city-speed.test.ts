/**
 * cidade-04: the hero walks at the city's faithful speed (world.ts CITY_HERO_SPEED ≈ 1.99375 u/s, rules/scale.ts
 * 'cidade-nevada') on the real city terrain, and at SPEED (3.1) on the island. moveDirection is what both the room
 * (sim/systems/players.ts) and the phone's prediction (prediction.ts simulate) call, so one step here is one step on
 * both sides. Results only, no wall clock (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CityTerrain,cityAsField} from '../../src/maps/city/terrain.ts';
import {decodeCityAsset} from '../../src/maps/city-asset.ts';
import {defaultTerrain,type TerrainField} from '../../src/maps/terrain/field.ts';
import {CITY_HERO_SPEED,RADIUS,SPAWN,SPEED,clearSegment,heroSpeed,moveAlong,moveDirection,type Point} from '../../src/maps/world.ts';
import {STEP,reconcile,simulate} from '../../src/maps/prediction.ts';

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

/** A direction out of the plaza with at least `length` units of free, swept ground ahead. */
function openDirection(from:Point,length:number):Point{
  for(let k=0;k<16;k++){
    const a=k*Math.PI/8,d={x:Math.cos(a),y:Math.sin(a)};
    if(clearSegment(from,{x:from.x+d.x*length,y:from.y+d.y*length},field))return d;
  }
  throw new Error('no open direction out of the plaza');
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
 * Shortest street length from inicio to praca over the 0.22 u samples where the hero disc (RADIUS) fits: 8-neighbour
 * Dijkstra (diagonals only when both orthogonal neighbours fit), so the length is close to what a walking hero covers.
 */
function streetLength(from:Point,to:Point):number{
  const {w,h,step}=city.asset.samples,n=w*h;
  const fits=new Uint8Array(n);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)fits[y*w+x]=city.clearDisc((x+.5)*step,(y+.5)*step,RADIUS)?1:0;
  const at=(p:Point)=>Math.floor(p.y/step)*w+Math.floor(p.x/step);
  const s=at(from),t=at(to);
  assert.ok(fits[s]&&fits[t],'start and plaza samples fit the hero');
  const cost=new Float64Array(n).fill(Infinity),done=new Uint8Array(n);
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
    if(i===t)return cost[t]*step;
    const x=i%w,y=(i/w)|0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;
      const j=ny*w+nx;if(!fits[j]||done[j])continue;
      if(dx&&dy&&!(fits[y*w+nx]&&fits[ny*w+x]))continue;
      const c=cost[i]+(dx&&dy?Math.SQRT2:1);
      if(c<cost[j]){cost[j]=c;push(c,j);}
    }
  }
  return Infinity;
}

test('real city: start → plaza along the streets takes 25–60 s at the city speed',t=>{
  const length=streetLength(inicio,praca),straight=dist(inicio,praca);
  assert.ok(Number.isFinite(length),'the plaza is reachable from the start');
  assert.ok(length>=straight-1,`street ${length.toFixed(1)} u ≥ straight ${straight.toFixed(1)} u`);
  const seconds=length/CITY_HERO_SPEED;
  t.diagnostic(`start → plaza: ${length.toFixed(1)} u of street (${straight.toFixed(1)} u straight) = ${seconds.toFixed(1)} s`);
  assert.ok(seconds>=25&&seconds<=60,`start → plaza ${seconds.toFixed(1)} s (${length.toFixed(1)} u at ${CITY_HERO_SPEED} u/s)`);
  // At the endless map's speed the same street would be a noticeably shorter walk: the change is real.
  assert.ok(length/SPEED<seconds*.7);
});
