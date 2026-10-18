/**
 * Card NEW-20261018-ORQ-bichos-travados, a probe: one city run in mode 'ninhos' (chaveiro, manual combat), `--bots`
 * room bots, until `--min` minutes; every 5 s the awake non-boss bodies that moved < 1 u in 60 s (the E6 bench's
 * 'stuck', scripts/bench-city-run.ts trackNests) are counted, and at the end each one is printed with its state: the
 * sleepers' mode (sono 1 alerta, 2 caçando, 3 perdeu), the siege flag, the nearest hero, its AI state and whether
 * it stands on walkable ground. D-031: local tool, not in npm test.
 *   node --experimental-strip-types scripts/diag-travados.ts [--seed 1] [--bots 1] [--min 8]
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../src/maps/city/terrain.ts';
import {walkable} from '../src/maps/index.ts';
import {Simulation} from '../multiplayer/simulation.ts';
import {RoomBots} from '../multiplayer/room-bots.ts';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=(name:string,def:string)=>{const i=process.argv.indexOf(`--${name}`);return i>0&&process.argv[i+1]?process.argv[i+1]:def;};
const SEED=Number(arg('seed','1')),BOTS=Number(arg('bots','1')),MIN=Number(arg('min','8')),HZ=20;
const text=fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.json'),'utf8');
const hash=(JSON.parse(fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(text,hash);if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;
const sim=new Simulation(SEED,{world:'cidade',terrain:city,objective:'chaveiro',mode:'ninhos',combat:'manual'}),room=new RoomBots();
for(let i=0;i<BOTS;i++){sim.addBot(`bot${i+1}`,`bot${i+1}`,'cidadao-comum');room.add(`bot${i+1}`,i);}
sim.botState=()=>room.state();sim.resetRun();room.reset();
const samples=new Map<string,{x:number;y:number;tick:number}>(),stuck=new Map<string,number>(),moved=new Map<string,number>();
const r2=(v:number)=>Math.round(v*100)/100;
while(!sim.outcome&&sim.tick<MIN*60*HZ){
  room.think(sim);sim.step(sim.tick*50);
  const w=sim.world;
  if(w.tick%(5*HZ))continue;
  for(const e of w.enemies.values()){
    if(e.boss)continue;
    const s=samples.get(e.id);
    if(!s||Math.hypot(e.x-s.x,e.y-s.y)>=1)samples.set(e.id,{x:e.x,y:e.y,tick:w.tick});
    else if(w.tick-s.tick>=60*HZ&&!stuck.has(e.id))stuck.set(e.id,w.tick);
  }
  for(const id of samples.keys())if(!w.enemies.has(id))samples.delete(id);
}
const w=sim.world,heroes=[...sim.players.values()];
const car=sim.run.chaveiro?.state.car;
console.log(JSON.stringify({seed:SEED,tick:w.tick,alive:w.enemies.size,stuck:stuck.size,car:car&&{x:r2(car.x),y:r2(car.y)},heroes:heroes.map(h=>({id:h.id,x:r2(h.x),y:r2(h.y),hp:Math.round(h.hp)}))}));
for(const [id,since] of stuck){
  const e=w.enemies.get(id);if(!e){console.log(id,'gone');continue;}
  const m=e.memory??{},near=Math.min(...heroes.map(h=>Math.hypot(h.x-e.x,h.y-e.y)));
  void moved;
  console.log(JSON.stringify({id,kind:e.kind,x:r2(e.x),y:r2(e.y),since:since/HZ,hp:Math.round(e.hp),speed:r2(e.speed),hero:r2(near),car:car?r2(Math.hypot(car.x-e.x,car.y-e.y)):null,
    walk:walkable(e,city),mem:Object.fromEntries(Object.entries(m).filter(([k])=>!['seed'].includes(k)).map(([k,v])=>[k,typeof v==='number'?r2(v):v])),
    ready:e.readyTick-w.tick,slow:(e.slowUntil??0)>w.tick,knock:e.knock??null}));
}
