/**
 * Diagnóstico (card NEW-20261025-ORQ-uno-caminho-caixas-vender, item 2; o usuário rodou o mapa todo e achou só 3 caixas):
 * uma partida real (Cidade Nevada, chaveiro, ninhos, combate manual) com uma pessoa (p0) que anda o mapa todo e ABRE
 * as caixas que encontra, mais N bots da sala (RoomBots). A cada minuto: caixas vivas no mundo, quantas p0 enxerga
 * (o hiddenFor do caixa-gamble tira as cores que ele já abriu), quantas ele passou perto (PASS_DIST) e quantas abriu,
 * e quantas os bots abriram. Uso: node --experimental-strip-types scripts/diag-caixas-visiveis.ts [bots] [minutos] [seeds]
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../src/maps/city/terrain.ts';
import {FlowField} from '../src/maps/flowfield.ts';
import {heroSpeed,walkable,type Point} from '../src/maps/world.ts';
import {cityAsField,UNREACHABLE} from '../src/maps/index.ts';
import {Rng,SIM_HZ,ticks} from '../src/contract/index.ts';
import {Simulation} from '../multiplayer/simulation.ts';
import {RoomBots} from '../multiplayer/room-bots.ts';
import {cityFlowGrid} from '../src/sim/city/grid.ts';
import {cityUnoStart} from '../src/sim/city/uno-start.ts';
import {placeWall} from '../src/sim/stonewards/wall.ts';
import {PASS_DIST} from '../src/sim/crates.ts';
import {PERSONAGEM_PADRAO} from '../src/rules/personagens-liberados.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../${path}`,import.meta.url));
const cityText=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const manifest=JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string};
const loaded=await cityTerrainFrom(cityText,manifest.hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,field=cityAsField(city),start=cityUnoStart(city),cs=city.asset.unitsPerCell;
// As in caixas-primeiro-minuto: the walker keeps clear of the Uno's body (the room puts a hero walking into it back).
const car=placeWall(city),CAR_CLEAR=1.6,grid0=cityFlowGrid(city);
const grid={...grid0,walkable:(cx:number,cy:number)=>grid0.walkable(cx,cy)&&Math.hypot((cx+.5)*grid0.cellSize-car.x,(cy+.5)*grid0.cellSize-car.y)>CAR_CLEAR};
const open=(p:Point)=>walkable(p,city)&&Math.hypot(p.x-car.x,p.y-car.y)>CAR_CLEAR-.5;
const step=heroSpeed(field)/SIM_HZ,fromStart=new FlowField(grid0,[start]);
const reachable=(p:Point)=>open(p)&&fromStart.cellCost(Math.floor(p.x/cs),Math.floor(p.y/cs))!==UNREACHABLE;
const fields=new Map<string,FlowField>();
const toward=(p:Point)=>{const k=`${Math.round(p.x)},${Math.round(p.y)}`;let f=fields.get(k);if(!f){f=new FlowField(grid,[p]);fields.set(k,f);}return f;};
const pl=city.asset.playable;
const anySpot=(rng:Rng)=>{for(;;){const p={x:pl.x+rng.next()*pl.w,y:pl.y+rng.next()*pl.h};if(reachable(p))return p;}};

const [bots=3,minutes=12,seeds=3]=process.argv.slice(2).map(Number);
for(let seed=1;seed<=seeds;seed++){
  const s=new Simulation(seed,{world:'cidade',terrain:field,cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
  s.add('p0','P0',PERSONAGEM_PADRAO);
  const rb=new RoomBots();
  for(let i=0;i<bots;i++){s.addBot(`b${i}`,`B${i}`,PERSONAGEM_PADRAO);rb.add(`b${i}`,i);}
  s.resetRun();
  (s as unknown as {botState:()=>unknown}).botState=()=>rb.state();
  let now=1000;const rng=new Rng(seed*7);
  const pickups=()=>(s as unknown as {world:{pickups:Map<string,{kind:string;id:string;x:number;y:number;hiddenFor?:string[]}>}}).world.pickups;
  const p0=s.players.get('p0')!,dir={x:0,y:0},passed=new Set<string>(),seen=new Set<string>();
  let walked=0,lx=p0.x,ly=p0.y;let goal=anySpot(rng),opening:string|undefined,openTicks=0,opened=0,botOpened=0;
  const before=new Set<string>();
  console.log(`seed ${seed}, ${bots} bots: min | vivas | p0 vê | p0 passou (acum) | p0 abriu | bots abriram | p0 já viu (acum)`);
  for(let t=0;t<ticks(minutes*60);t++){
    rb.think(s);
    const live=[...pickups().values()].filter(k=>k.kind==='chest');
    const mine=live.filter(k=>!k.hiddenFor?.includes('p0'));
    // p0: a crate he sees within 10 u → walk to it and stand until it opens; else roam the whole map.
    const near=mine.map(k=>({k,d:Math.hypot(k.x-p0.x,k.y-p0.y)})).filter(o=>o.d<10).sort((a,b)=>a.d-b.d)[0];
    if(near&&near.d<1.2){opening=near.k.id;openTicks++;dir.x=dir.y=0;}
    else{
      opening=undefined;
      const target=near?near.k:goal;
      if(!near&&Math.hypot(goal.x-p0.x,goal.y-p0.y)<2)goal=anySpot(rng);
      toward(target).directionAt(p0.x,p0.y,dir);
      const next={x:p0.x+dir.x*step,y:p0.y+dir.y*step};
      if((dir.x||dir.y)&&open(next)){p0.x=next.x;p0.y=next.y;}else goal=anySpot(rng);
    }
    p0.hp=p0.stats.maxHp;delete (p0 as {fear?:unknown}).fear;if((p0 as {downed?:boolean}).downed)(p0 as {downed?:boolean}).downed=false;
    s.step(now+=50);
    walked+=Math.hypot(p0.x-lx,p0.y-ly);lx=p0.x;ly=p0.y;
    const after=new Set([...pickups().values()].filter(k=>k.kind==='chest').map(k=>k.id));
    for(const id of before)if(!after.has(id)){if(id===opening)opened++;else botOpened++;}
    before.clear();for(const id of after)before.add(id);
    for(const k of mine){seen.add(k.id);if(Math.hypot(k.x-p0.x,k.y-p0.y)<=PASS_DIST)passed.add(k.id);}
    if((t+1)%ticks(60)===0)console.log(`  ${(t+1)/ticks(60)} | ${live.length} | ${mine.length} | ${passed.size} | ${opened} | ${botOpened} | ${seen.size} | andou ${walked.toFixed(0)} u em (${p0.x.toFixed(0)},${p0.y.toFixed(0)})`);
    if(s.run.snapshot?.().phase==='over')break;
  }
}
