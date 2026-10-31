/**
 * Diagnóstico (card NEW-20261031-ORQ-itens-so-de-monstro-ultra-raro): uma partida real (Cidade Nevada, chaveiro, ninhos,
 * combate manual) jogada por N bots da sala (RoomBots), para acertar KILL_CRATE_CHANCE (crates-abate.ts). A cada minuto:
 * abates (comuns / elites / chefe), caixas que nasceram por fonte (perto = as do começo, abate = no lugar de um monstro
 * morto naquele tick, outras = chefe, ninho, mapa) e a 1ª arma de cada herói (segundo). No fim, a chance que dá uma caixa
 * de abate a cada ALVO_MIN minutos com os abates medidos.
 * Uso: node --experimental-strip-types scripts/diag-caixas-abate.ts [bots] [minutos] [seeds] [alvo_min]
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../src/maps/city/terrain.ts';
import {cityAsField} from '../src/maps/index.ts';
import {ticks} from '../src/contract/index.ts';
import type {EnemyState} from '../src/contract/index.ts';
import {Simulation} from '../multiplayer/simulation.ts';
import {RoomBots} from '../multiplayer/room-bots.ts';
import {ELITE_CRATE_CHANCE,KILL_CRATE_CHANCE,MAP_CRATES} from '../src/sim/crates-abate.ts';
import {PERSONAGEM_PADRAO} from '../src/rules/personagens-liberados.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../${path}`,import.meta.url));
const manifest=JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string};
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),manifest.hash);
if(!loaded.ok)throw new Error(loaded.error);
const field=cityAsField(loaded.terrain);

type Pickup={kind:string;id:string;x:number;y:number};
type World={pickups:Map<string,Pickup>;onKill(h:(e:EnemyState)=>void):()=>void};
const [bots=1,minutes=10,seeds=3,alvo=5]=process.argv.slice(2).map(Number);
console.log(`MAP_CRATES=${MAP_CRATES} KILL_CRATE_CHANCE=${KILL_CRATE_CHANCE} ELITE_CRATE_CHANCE=${ELITE_CRATE_CHANCE}; ${bots} bot(s), ${minutes} min`);
let allKills=0,allElites=0,allMinutes=0;
for(let seed=1;seed<=seeds;seed++){
  const s=new Simulation(seed,{world:'cidade',terrain:field,cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
  const rb=new RoomBots();
  for(let i=0;i<bots;i++){s.addBot(`b${i}`,`B${i}`,PERSONAGEM_PADRAO);rb.add(`b${i}`,i);}
  s.resetRun();
  (s as unknown as {botState:()=>unknown}).botState=()=>rb.state();
  const world=(s as unknown as {world:World}).world;
  let kills=0,elites=0,bosses=0,tickKills:EnemyState[]=[];
  world.onKill(e=>{tickKills.push({...e});if(e.boss)bosses++;else if(e.elite)elites++;else kills++;});
  const known=new Set<string>(),source={perto:0,abate:0,outras:0},first=new Map<string,string>();
  let now=1000,t=0;
  console.log(`seed ${seed}: min | abates | elites | chefe | caixas perto | abate | outras`);
  for(;t<ticks(minutes*60);t++){
    rb.think(s);tickKills=[];
    s.step(now+=50);
    for(const p of world.pickups.values()){
      if(p.kind!=='chest'||known.has(p.id))continue;
      known.add(p.id);
      if(t<ticks(2))source.perto++;
      else if(tickKills.some(e=>Math.hypot(e.x-p.x,e.y-p.y)<13))source.abate++;
      else source.outras++;
    }
    for(const p of s.players.values())if(!first.has(p.id)&&p.build.weapons.length)first.set(p.id,`${p.build.weapons[0].id} @${(t/ticks(1)).toFixed(0)} s`);
    if((t+1)%ticks(60)===0)console.log(`  ${(t+1)/ticks(60)} | ${kills} | ${elites} | ${bosses} | ${source.perto} | ${source.abate} | ${source.outras}`);
    if(s.run.snapshot?.().phase==='over'){console.log(`  acabou em ${(t/ticks(60)).toFixed(1)} min`);break;}
  }
  const mins=t/ticks(60);
  console.log(`  1ª arma: ${[...first].map(([id,w])=>`${id} ${w}`).join(', ')||'nenhuma'}; ${(kills/mins).toFixed(1)} abates/min, ${(elites/mins).toFixed(2)} elites/min`);
  allKills+=kills;allElites+=elites;allMinutes+=mins;
}
const perMin=allKills/allMinutes,elitePerMin=allElites/allMinutes;
const chance=Math.max(0,(1/alvo-elitePerMin*ELITE_CRATE_CHANCE)/perMin);
console.log(`média: ${perMin.toFixed(1)} abates/min, ${elitePerMin.toFixed(2)} elites/min; hoje dá 1 caixa a cada ${(1/(perMin*KILL_CRATE_CHANCE+elitePerMin*ELITE_CRATE_CHANCE)).toFixed(1)} min; para 1 a cada ${alvo} min: KILL_CRATE_CHANCE ≈ ${chance.toFixed(4)}`);
