/**
 * Card NEW-20261030-ORQ-corte-C0-sim-digest (estudo-arquivos-400-linhas §5, onda 0): the sim's replay digest. A cut card
 * that touches sim/, rules/ or maps/ must give the SAME output here as the main (§6 item 4).
 * The room's own drive (room.ts advance: bots.think, then sim.step), four room bots of the active cast, a fixed seed,
 * 3600 ticks (3 min) on the island and on Cidade Nevada as the Worker opens it (chaveiro, ninhos, manual, structures).
 * Every 60 ticks it prints Simulation.stateHash() (FNV-1a of the canonical state, src/sim/core.ts); the last line folds
 * every line into one digest. Timing goes to stderr, so stdout of two checkouts compares with a plain diff:
 *   npm run sim:digest [-- --seed 4242 --ticks 3600 --every 60 --map ilha|cidade]
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {Simulation} from '../multiplayer/simulation.ts';
import {RoomBots} from '../multiplayer/room-bots.ts';
import {cityTerrainFrom} from '../src/maps/city/terrain.ts';
import {stateHash} from '../src/sim/core.ts';
import {herois} from './elenco-ativo.ts';

export const DIGEST_SEED=4242,DIGEST_TICKS=3600,DIGEST_EVERY=60,DIGEST_BOTS=4;
export const DIGEST_MAPS=['ilha','cidade'] as const;
export type DigestMap=typeof DIGEST_MAPS[number];

export interface DigestOptions {
  map:DigestMap;seed?:number;ticks?:number;every?:number;
  /** Tests only: called after each step, to plant a change in the state and see the digest move. */
  afterStep?:(sim:Simulation)=>void;
}
export interface DigestRun {map:DigestMap;lines:string[];digest:string;outcome:string;round:number;decidedAt?:number;ms:number}

let cityText:{text:string;hash:string}|undefined;
async function cityTerrain(){
  cityText??={text:readFileSync(new URL('../public/maps/cidade-nevada.json',import.meta.url),'utf8'),
    hash:(JSON.parse(readFileSync(new URL('../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8')) as {hash:string}).hash};
  // A fresh decode per run, as each Worker room gets its own fork (tests/rooms/seed-repete.test.ts).
  const loaded=await cityTerrainFrom(cityText.text,cityText.hash);
  if(!loaded.ok)throw new Error(loaded.error);
  return loaded.terrain;
}

/** The Worker's options (multiplayer/worker.ts: mode 'ninhos', combat 'manual'; room.ts: the chaveiro, the structures). */
async function simulation(map:DigestMap,seed:number){
  if(map==='ilha')return new Simulation(seed,{world:'ilha',combat:'manual'});
  return new Simulation(seed,{world:'cidade',terrain:await cityTerrain(),cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
}

export async function simDigest({map,seed=DIGEST_SEED,ticks=DIGEST_TICKS,every=DIGEST_EVERY,afterStep}:DigestOptions):Promise<DigestRun>{
  const sim=await simulation(map,seed),bots=new RoomBots();
  herois(DIGEST_BOTS).forEach((classId,i)=>{const id=`bot-${i+1}`;sim.addBot(id,`Bot ${i+1}`,classId);bots.add(id,i);});
  sim.botState=()=>bots.state();sim.resetRun();bots.reset();
  const lines:string[]=[],started=performance.now();
  let decidedAt:number|undefined;
  for(let t=1;t<=ticks;t++){
    bots.think(sim);sim.step();afterStep?.(sim);
    if(decidedAt===undefined&&sim.outcome)decidedAt=t;
    if(t%every===0||t===ticks)lines.push(`${map} ${String(t).padStart(5)} ${sim.stateHash()}`);
  }
  const ms=performance.now()-started,outcome=sim.outcome??'-',round=sim.world.round.index;
  lines.push(`${map} fim round=${round} outcome=${outcome} decidido=${decidedAt??'-'} level=${sim.world.team.level} inimigos=${sim.world.enemies.size}`);
  return {map,lines,digest:stateHash(lines),outcome,round,decidedAt,ms};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const a=process.argv.slice(2),val=(k:string)=>{const i=a.indexOf(k);return i>=0?a[i+1]:undefined;};
  const num=(k:string,d:number)=>{const v=Number(val(k)??d);if(!Number.isInteger(v)||v<1)throw new Error(`${k}: ${val(k)}`);return v;};
  const seed=num('--seed',DIGEST_SEED),ticks=num('--ticks',DIGEST_TICKS),every=num('--every',DIGEST_EVERY);
  const only=val('--map');
  if(only&&!(DIGEST_MAPS as readonly string[]).includes(only))throw new Error(`--map: ${only} (ilha|cidade)`);
  const maps=only?[only as DigestMap]:[...DIGEST_MAPS];
  console.log(`sim-digest seed=${seed} ticks=${ticks} every=${every} bots=${DIGEST_BOTS} maps=${maps.join(',')}`);
  const digests:string[]=[];
  for(const map of maps){
    const run=await simDigest({map,seed,ticks,every});
    for(const line of run.lines)console.log(line);
    console.log(`${map} digest ${run.digest}`);digests.push(run.digest);
    console.error(`[sim-digest] ${map}: ${ticks} ticks em ${(run.ms/1000).toFixed(1)} s (${(run.ms/ticks).toFixed(2)} ms/tick)`);
  }
  console.log(`digest ${stateHash(digests)}`);
}
