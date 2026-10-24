// BUG-20261022-ORQ-caixas-sumiram: in the real match (Cidade Nevada, the chaveiro objective, the nests, the manual
// combat) a hero who walks the first minute passes at least FIRST_MINUTE_CRATES crates (within PASS_DIST, about the PC
// camera's half view), whichever way he goes; the start crates sit around where the heroes spawn (they sat by the
// plaza, ~76 u of walk away and out of the frames' interest radius, so the phone got none), on open ground.
// Card inicio-no-uno-caixas-120: the team spawns beside the Uno (cityUnoStart) and the trail lasts the 120 s Minerva.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {FlowField} from '../../src/maps/flowfield.ts';
import {heroSpeed,walkable,type Point} from '../../src/maps/world.ts';
import {cityAsField} from '../../src/maps/index.ts';
import {Rng,SIM_HZ,ticks,INTEREST_RADIUS} from '../../src/contract/index.ts';
import {CRATE_BODY_RADIUS} from '../../src/rules/crate-size.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {Room,OWNER_GAP_MS} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {FrameDecoder} from '../../src/protocol/protocol4.ts';
import {clientCatalog} from '../../src/protocol/map-catalog.ts';
import {cityFlowGrid} from '../../src/sim/city/grid.ts';
import {cityUnoStart} from '../../src/sim/city/uno-start.ts';
import {cityLoot,AROUND_START} from '../../src/sim/stonewards/loot.ts';
import {FIRST_MINUTE_CRATES,FIRST_MINUTE_S,PASS_DIST,START_CRATES_PER_PLAYER} from '../../src/sim/crates.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const cityText=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const manifest=JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string;version:number};
const loaded=await cityTerrainFrom(cityText,manifest.hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,field=cityAsField(city),grid=cityFlowGrid(city),start=cityUnoStart(city),P=city.asset.points;
const step=heroSpeed(field)/SIM_HZ;
const fields=new Map<string,FlowField>();
const toward=(p:Point)=>{const k=`${Math.round(p.x)},${Math.round(p.y)}`;let f=fields.get(k);if(!f){f=new FlowField(grid,[p]);fields.set(k,f);}return f;};
const open=(p:Point)=>walkable(p,city);

/** Where a walker heads next (from where he is): the patterns of the card, "reto / em volta da praça" and a wanderer. */
type Pattern=(at:Point,rng:Rng)=>Point;
const around=(c:Point,r:number):Pattern=>at=>{
  if(Math.hypot(at.x-c.x,at.y-c.y)>r+4)return c;
  const a=Math.atan2(at.y-c.y,at.x-c.x)+.8;
  for(let k=0;k<8;k++){const p={x:c.x+Math.cos(a+k*.3)*r,y:c.y+Math.sin(a+k*.3)*r};if(open(p))return p;}
  return c;
};
/** Fresh walkers (a pattern may remember where it is in its plan). */
const PATTERNS:Record<string,()=>Pattern>={
  // Straight down the road to the plaza, then around it.
  praca:()=>around(P.praca,20),
  // Back to the wreck first, then to the plaza.
  destroco:()=>{let back=true;const plaza=around(P.praca,20);return (at,rng)=>{if(back&&Math.hypot(at.x-P.inicio.x,at.y-P.inicio.y)<3)back=false;return back?P.inicio:plaza(at,rng);};},
  // Around the spawn.
  volta:()=>around(start,22),
  // Anywhere: a random open spot 15..55 u off, again and again.
  vaga:()=>(at,rng)=>{for(;;){const a=rng.next()*2*Math.PI,r=15+rng.next()*40,p={x:at.x+Math.cos(a)*r,y:at.y+Math.sin(a)*r};if(open(p))return p;}},
};

function match(seed:number,players:number){
  const s=new Simulation(seed,{world:'cidade',terrain:field,cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
  for(let i=0;i<players;i++)s.add(`p${i}`,`P${i}`,'cidadao-comum');
  s.resetRun();
  let now=1000;
  return {s,step:()=>s.step(now+=50),chests:()=>s.view('p0').pickups.filter(k=>k.kind==='chest')};
}

/** One minute of walkers (one pattern each, p0.. in order): the crates each one passed. */
function walk(seed:number,patterns:readonly Pattern[]){
  const m=match(seed,patterns.length),rng=new Rng(seed),dir={x:0,y:0};
  m.step();
  const heroes=patterns.map((pattern,i)=>{const p=m.s.players.get(`p${i}`)!;return {p,pattern,goal:pattern(p,rng),passed:new Set<string>()};});
  for(let t=0;t<ticks(FIRST_MINUTE_S);t++){
    for(const h of heroes){
      if(Math.hypot(h.goal.x-h.p.x,h.goal.y-h.p.y)<2)h.goal=h.pattern(h.p,rng);
      toward(h.goal).directionAt(h.p.x,h.p.y,dir);
      const next={x:h.p.x+dir.x*step,y:h.p.y+dir.y*step};
      if((dir.x||dir.y)&&open(next)){h.p.x=next.x;h.p.y=next.y;}else h.goal=h.pattern(h.p,rng);
      h.p.hp=h.p.stats.maxHp;
    }
    m.step();
    for(const c of (m.s as unknown as {world:{pickups:Map<string,{kind:string;id:string;x:number;y:number}>}}).world.pickups.values()){
      if(c.kind!=='chest')continue;
      for(const h of heroes)if(Math.hypot(c.x-h.p.x,c.y-h.p.y)<=PASS_DIST)h.passed.add(c.id);
    }
  }
  return heroes.map(h=>h.passed);
}

test('the start crates sit around the spawn: in the frames from the first one, on open ground, not piled up',async()=>{
  const loot=cityLoot(field)!;
  // Asset v4 (mapa-175-com-viaduto): the streets are narrower, fewer cells hold the 3× crate's disc (was ≥ 50).
  assert.ok(loot.aroundUno.length>=30,`${loot.aroundUno.length} start spots`);
  assert.ok(loot.aroundUno.every(p=>p.walk>=AROUND_START[0]&&p.walk<=AROUND_START[1]&&city.clearDisc(p.x,p.y,CRATE_BODY_RADIUS)));
  for(const seed of [1,2,3]){
    const m=match(seed,1);m.step();
    const near=m.chests().filter(k=>Math.hypot(k.x-start.x,k.y-start.y)<=AROUND_START[1]);
    assert.ok(near.length>=START_CRATES_PER_PLAYER,`seed ${seed}: ${near.length} crates around the spawn`);
  }
  // The room's frames carry them (the phone got none: every crate was past INTEREST_RADIUS from the spawn).
  let n=0;
  const room=new Room(1000,4242,{cityText,cityRef:{id:'cidade-nevada',version:manifest.version,hash:manifest.hash},cityPlayable:true,map:'cidade-nevada',objective:'chaveiro',mode:'ninhos',combat:'manual',newId:()=>`pessoa-${++n}`});
  await room.ready();
  const frames:Uint8Array[]=[],a={send:(x:string|Uint8Array)=>{if(typeof x!=='string')frames.push(x);},close:()=>{}};
  let t=1000;
  room.connect(a,t);room.receive(a,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum',maps:clientCatalog({id:'cidade-nevada',version:manifest.version,hash:manifest.hash})}),t);
  room.receive(a,JSON.stringify({t:'ready',round:room.run.snapshot().round,ready:true}),t+=OWNER_GAP_MS);
  for(let i=0;i<2000&&room.run.snapshot().phase!=='combat';i++,t+=50)room.advance(t);
  for(let i=0;i<40;i++){t+=50;if(i%20===0)room.receive(a,JSON.stringify({t:'ack',seq:0}),t);room.advance(t);}
  const dec=new FrameDecoder();let most=0;
  for(const f of frames){const r=dec.decode(f);if(r.ok)most=Math.max(most,r.view.pickups.filter(k=>k.kind==='chest').length);}
  assert.ok(most>=START_CRATES_PER_PLAYER,`the frames carry ${most} crates (interest radius ${INTEREST_RADIUS} u)`);
});

test(`a hero who walks the first minute passes at least ${FIRST_MINUTE_CRATES} crates, whichever way he goes`,()=>{
  for(const [name,pattern] of Object.entries(PATTERNS))for(const seed of [1,2,3,4]){
    const [passed]=walk(seed,[pattern()]);
    assert.ok(passed.size>=FIRST_MINUTE_CRATES,`${name}, seed ${seed}: ${passed.size} crates`);
  }
});

// inicio-no-uno-caixas-120: in 120 s the wreck walker is back circling the plaza beside the plaza walker (one view, so
// they share the trail crates): the third one wanders off instead.
test('a team of three walking apart: each one passes his own',()=>{
  for(const seed of [5,6]){
    const passed=walk(seed,[PATTERNS.praca(),PATTERNS.vaga(),PATTERNS.vaga()]);
    passed.forEach((set,i)=>assert.ok(set.size>=FIRST_MINUTE_CRATES,`seed ${seed}, hero ${i}: ${set.size}`));
  }
});
