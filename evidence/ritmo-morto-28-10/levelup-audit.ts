/**
 * Ritmo do começo (NEW-20261028-ORQ-ritmo-morto-e-viaduto): headless matches as the room plays them (city, chaveiro +
 * ninhos + manual combat, cityStructures, RoomBots.think → sim.step, the D-050 level-up pause), no navigation wrapper.
 * Seat 0 walks at a person's pace (it stands for the person). Evidence only (no game code).
 *   node --experimental-strip-types evidence/ritmo-morto-28-10/levelup-audit.ts --players 3 [--seeds 1-16] [--cap-s 240] [--out f]
 * Per run: the first team level-up (s), the round phase then, whether a pause opened for it (the screen) or seat 0's
 * offer was settled without one, kills by 30/60/90/120 s, seat 0's downs and lowest hp before the first level, the
 * minuto de Minerva's end, the visitors (memory.visita) that came, and xpAt[k]: the first second the team bar held k XP
 * before the first level (with --first-xp 999 the bar never fills in the cap: the curve to calibrate FIRST_LEVEL_XP).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom,cityAsField} from '../../src/maps/index.ts';
import {isStanding} from '../../src/sim/revive.ts';
import {BOT_CLASS_IDS} from '../../src/rules/index.ts';
import type {SimEvent} from '../../src/contract/index.ts';
import {STEP_MS} from '../../src/protocol/index.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {RoomBots,botIdentity} from '../../multiplayer/room-bots.ts';
import {LevelupPause} from '../../multiplayer/levelup-pause.ts';
import {FIRST_LEVEL_XP} from '../../src/sim/progression.ts';

const HZ=20,ROOT=process.env.AUDIT_ROOT??path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const r1=(v:number)=>Math.round(v*10)/10,s=(tick:number)=>r1(tick/HZ);

function args(argv:string[]){
  const get=(n:string)=>{const i=argv.indexOf(n);return i>=0?argv[i+1]:undefined;};
  const seeds:number[]=[];
  for(const part of (get('--seeds')??'1-16').split(',')){const [a,b]=part.split('-').map(Number);for(let x=a;x<=(b??a);x++)seeds.push(x);}
  return {seeds,players:Number(get('--players')??'3'),capS:Number(get('--cap-s')??'240'),out:get('--out'),firstXp:get('--first-xp')};
}

function play(seed:number,players:number,capTicks:number,city:Awaited<ReturnType<typeof cityTerrainFrom>>&{ok:true}){
  const sim=new Simulation(seed,{world:'cidade',terrain:cityAsField(city.terrain),cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'} as ConstructorParameters<typeof Simulation>[1]);
  const room=new RoomBots();
  for(let i=0;i<players;i++){
    const id=`bot${i+1}`,{name,classId}=botIdentity(seed,i,[...BOT_CLASS_IDS],new Set([...sim.players.values()].map(p=>p.name)));
    sim.addBot(id,name,classId);room.add(id,i);
    if(i===0)sim.personPace.add(id);
  }
  sim.botState=()=>room.state();
  sim.resetRun();room.reset();
  const levelup=new LevelupPause();let clock=0;
  let firstLevelS:number|null=null,levelPhase:string|null=null,pauseS:number|null=null,offerSeenS:number|null=null,offerGoneS:number|null=null,offerPaused=false;
  let kills=0,downs0=0,minHp0=Infinity,armedS:number|null=null,minervaEndS:number|null=null,visitors=new Set<string>(),visitorHits=0;
  const killsAt:Record<string,number>={};
  const marks=[30,60,90,120,180];
  const levels:number[]=[],xpAt:number[]=[];
  while(!sim.outcome&&sim.tick<capTicks){
    clock+=STEP_MS;
    const was=levelup.paused,paused=levelup.update(sim,clock);
    if(paused&&!was&&firstLevelS!==null&&pauseS===null)pauseS=s(sim.tick);
    const pending=sim.pendingOffers().has('bot1');
    if(pending&&offerSeenS===null)offerSeenS=s(sim.tick);
    if(pending&&paused)offerPaused=true;
    if(!pending&&offerSeenS!==null&&offerGoneS===null)offerGoneS=s(sim.tick);
    if(paused)continue;
    room.think(sim);
    const events=sim.step() as readonly SimEvent[],tick=sim.world.tick;
    for(const e of events){
      if(e.type==='kill')kills++;
      else if(e.type==='levelup'){levels.push(s(tick));if(firstLevelS===null){firstLevelS=s(tick);levelPhase=sim.world.round?.phase??null;}}
      else if(e.type==='downed'&&e.player==='bot1'&&firstLevelS===null)downs0++;
      else if(e.type==='damage'&&(e as {target?:string}).target==='bot1'&&visitors.has((e as {source?:string}).source??''))visitorHits++;
    }
    for(const m of marks)if(tick===m*HZ)killsAt[m]=kills;
    if(firstLevelS===null)for(let k=xpAt.length+1;k<=sim.world.team.xp;k++)xpAt.push(s(tick));
    const p0=sim.players.get('bot1')!;
    if(firstLevelS===null&&isStanding(p0))minHp0=Math.min(minHp0,p0.hp);
    if(armedS===null&&p0.build.weapons.length)armedS=s(tick);
    const nests=(sim.run as unknown as {nests?:{minerva(t:number):boolean}}).nests;
    if(minervaEndS===null&&nests&&!nests.minerva(tick))minervaEndS=s(tick);
    for(const e of sim.world.enemies.values())if(e.memory?.visita===1)visitors.add(e.id);
  }
  return {seed,players,outcome:sim.outcome??'timeout',endS:s(sim.world.tick),firstLevelS,levelPhase,pauseS,offerSeenS,offerGoneS,offerPaused,
    levels,kills,killsAt,downs0,minHp0:Number.isFinite(minHp0)?r1(minHp0):null,armedS,minervaEndS,visitors:visitors.size,visitorHits,xpAt};
}

async function main(){
  const a=args(process.argv.slice(2));
  if(a.firstXp)FIRST_LEVEL_XP.fill(Number(a.firstXp));
  try{os.setPriority(0,os.constants.priority.PRIORITY_LOW);}catch{}
  const text=fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.json'),'utf8');
  const hash=(JSON.parse(fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
  const city=await cityTerrainFrom(text,hash);
  if(!city.ok)throw new Error(city.error);
  const file=path.resolve(a.out??path.join(ROOT,'evidence/ritmo-morto-28-10',`levelup-${a.players}p.json`));
  fs.mkdirSync(path.dirname(file),{recursive:true});
  let runs:unknown[]=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
  for(const seed of a.seeds){
    if(runs.some(r=>(r as {seed:number}).seed===seed))continue;
    const r=play(seed,a.players,Math.round(a.capS*HZ),city);
    runs=[...runs,r];
    fs.writeFileSync(file+'.tmp',JSON.stringify(runs));fs.renameSync(file+'.tmp',file);
    console.log(`seed ${seed} ${a.players}p: lvl2 ${r.firstLevelS}s (${r.levelPhase}) pause ${r.pauseS} offer ${r.offerSeenS}→${r.offerGoneS} paused ${r.offerPaused} | levels ${r.levels.join(',')} | kills ${JSON.stringify(r.killsAt)} | armed ${r.armedS}s minHp ${r.minHp0} downs ${r.downs0} | visitors ${r.visitors} hits ${r.visitorHits} | ${r.outcome} ${r.endS}s`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
