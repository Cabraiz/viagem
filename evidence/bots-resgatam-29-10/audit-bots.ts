/**
 * Auditoria de bots (NEW-20261028-ORQ-auditoria-bots-sim): headless matches as the room plays them today (city,
 * chaveiro + ninhos + manual combat, cityStructures), the room's own bot loop (RoomBots.think → sim.step, the D-050
 * level-up pause) and NO navigation wrapper (scripts/bench-city-run.ts re-aims the sticks with flow fields; the rooms
 * do not, so the bench hides exactly what this audit looks for). Seat 0 walks at a person's pace like the bench.
 *
 * Evidence only (no game code): per run it logs the episodes below and writes one JSON per team size.
 *   node --experimental-strip-types evidence/auditoria-bots-sim-28-10/audit-bots.ts --players 3 [--seeds 1-16] [--cap-min 30]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {cityTerrainFrom,cityAsField} from '../../src/maps/index.ts';
import {isStanding} from '../../src/sim/revive.ts';
import {BOT_CLASS_IDS} from '../../src/rules/index.ts';
import type {SimEvent} from '../../src/contract/index.ts';
import {STEP_MS} from '../../src/protocol/index.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {RoomBots,botIdentity} from '../../multiplayer/room-bots.ts';
import {LevelupPause} from '../../multiplayer/levelup-pause.ts';

const HZ=20,ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const IDLE_S=5,IDLE_MOVE=.5,STUCK_S=2,STUCK_MOVE=.3,FAR_U=25,FAR_S=60,ENEMY_STUCK_S=60,ENEMY_STUCK_MOVE=1,REVIVE_NEAR=6,CRATE_NEAR_CAR=20;
const r1=(v:number)=>Math.round(v*10)/10,s=(tick:number)=>r1(tick/HZ);
const dist=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);

interface Episode {bot:string;cls:string;startS:number;durS:number;mode:string;modes:Record<string,number>;x:number;y:number;carU:number|null;enemiesNear:number;attack:number;stick:number;near?:string}
interface BotTrack {id:string;cls:string;anchor:{x:number;y:number};anchorTick:number;stickSum:number;attackSum:number;samples:number;modes:Record<string,number>;
  idle?:Episode;stuckAnchor:{x:number;y:number};stuckTick:number;stuck?:Episode;farSince:number|null;farModes:Record<string,number>;far?:Episode;
  modeTicks:Record<string,number>;downs:number;revives:number;lastStick:{x:number;y:number;attack:boolean}}

function args(argv:string[]){
  const get=(n:string)=>{const i=argv.indexOf(n);return i>=0?argv[i+1]:undefined;};
  const seeds:number[]=[];
  for(const part of (get('--seeds')??'1-16').split(',')){const [a,b]=part.split('-').map(Number);for(let x=a;x<=(b??a);x++)seeds.push(x);}
  return {seeds,players:Number(get('--players')??'3'),capMin:Number(get('--cap-min')??'30'),out:get('--out')};
}

function structuresOf(sim:Simulation):{id:string;kind:string;x:number;y:number}[]{
  const st=(sim.world as unknown as {structures?:unknown}).structures;
  if(!st)return [];
  const list=st instanceof Map?[...st.values()]:Array.isArray(st)?st:Object.values(st as object);
  return list.filter((x):x is {id:string;kind:string;x:number;y:number}=>!!x&&typeof (x as {x?:unknown}).x==='number');
}

function play(seed:number,players:number,capTicks:number,city:Awaited<ReturnType<typeof cityTerrainFrom>>&{ok:true}){
  const sim=new Simulation(seed,{world:'cidade',terrain:cityAsField(city.terrain),cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'} as ConstructorParameters<typeof Simulation>[1]);
  const room=new RoomBots(),tracks=new Map<string,BotTrack>();
  for(let i=0;i<players;i++){
    const id=`bot${i+1}`,{name,classId}=botIdentity(seed,i,[...BOT_CLASS_IDS],new Set([...sim.players.values()].map(p=>p.name)));
    sim.addBot(id,name,classId);room.add(id,i);
    if(i===0)sim.personPace.add(id);
  }
  sim.botState=()=>room.state();
  sim.resetRun();room.reset();
  const setStick=sim.setBotInput.bind(sim);
  sim.setBotInput=(id,d,skill=false,attack=false,work=false,target)=>{const t=tracks.get(id);if(t)t.lastStick={x:d.x,y:d.y,attack};return setStick(id,d,skill,attack,work,target);};
  for(const p of sim.players.values())tracks.set(p.id,{id:p.id,cls:p.classId,anchor:{x:p.x,y:p.y},anchorTick:0,stickSum:0,attackSum:0,samples:0,modes:{},
    stuckAnchor:{x:p.x,y:p.y},stuckTick:0,farSince:null,farModes:{},modeTicks:{},downs:0,revives:0,lastStick:{x:0,y:0,attack:false}});

  const idle:Episode[]=[],stuck:Episode[]=[],far:Episode[]=[];
  const downs:{bot:string;cls:string;atS:number;by?:string;source?:string;endS:number|null;end:'revived'|'eliminated'|'open';by2?:string;minMateU:number|null;mateNearS:number;mateNearModes:Record<string,number>;carU:number|null}[]=[];
  const openDown=new Map<string,typeof downs[number]>();
  const enemySamples=new Map<string,{x:number;y:number;tick:number}>(),enemyStuck=new Map<string,{id:string;kind:string;x:number;y:number;atS:number;carU:number|null}>();
  const crateSeen=new Map<string,{id:string;rarity:number;x:number;y:number;bornS:number;carU:number|null;openedS:number|null;by?:string}>();
  const phase:Record<string,number>={};let lastPhase='',phaseLog:{mode:string;atS:number}[]=[];
  let firstDownS:number|null=null,bossS:number|null=null,firstLevelS:number|null=null,kills=0,botKills=0;
  const lastMinute:{atS:number;snap:string}[]=[];
  const levelup=new LevelupPause();let clock=0,pauses=0,pausedLoops=0;
  const started=performance.now();

  const carOf=()=>sim.run.chaveiro?.state.car;
  const close=(t:BotTrack,key:'idle'|'stuck'|'far',tick:number,into:Episode[])=>{const e=t[key];if(!e)return;e.durS=s(tick)-e.startS;into.push(e);t[key]=undefined;};

  while(!sim.outcome&&sim.tick<capTicks){
    clock+=STEP_MS;
    const was=levelup.paused,paused=levelup.update(sim,clock);
    if(paused){if(!was)pauses++;pausedLoops++;continue;}
    room.think(sim);
    const events=sim.step() as readonly SimEvent[],tick=sim.world.tick,car=carOf();
    const enemies=[...sim.world.enemies.values()];
    for(const e of events){
      if(e.type==='downed'){const t=tracks.get(e.player);if(!t)continue;t.downs++;firstDownS??=s(tick);const p=sim.players.get(e.player)!;
        const d={bot:e.player,cls:t.cls,atS:s(tick),by:e.by,source:e.source,endS:null,end:'open' as const,minMateU:null,mateNearS:0,mateNearModes:{},carU:car?r1(dist(p,car)):null};downs.push(d);openDown.set(e.player,d);}
      else if(e.type==='revived'||e.type==='eliminated'){const d=openDown.get(e.player);if(d){d.endS=s(tick);d.end=e.type;d.by2=e.by;openDown.delete(e.player);}if(e.type==='revived'&&e.by)tracks.get(e.by)&&tracks.get(e.by)!.revives++;}
      else if(e.type==='kill'){kills++;if(e.by&&tracks.has(e.by))botKills++;}
      else if(e.type==='levelup')firstLevelS??=s(tick);
    }
    // Phases: the moto's mode (what the chaveiro is doing).
    const ch=sim.run.chaveiro?.state;
    if(ch){const m=String(ch.moto.mode);phase[m]=(phase[m]??0)+1;if(m!==lastPhase){phaseLog.push({mode:m,atS:s(tick)});lastPhase=m;}if(ch.bossCalled&&bossS===null)bossS=s(tick);}
    // Bots.
    for(const t of tracks.values()){
      const p=sim.players.get(t.id)!,mode=room.modes.get(t.id)??'-';
      t.modeTicks[mode]=(t.modeTicks[mode]??0)+1;
      if(!isStanding(p)){close(t,'idle',tick,idle);close(t,'stuck',tick,stuck);close(t,'far',tick,far);t.anchor={x:p.x,y:p.y};t.anchorTick=tick;t.stuckAnchor={x:p.x,y:p.y};t.stuckTick=tick;t.farSince=null;t.stickSum=t.attackSum=t.samples=0;t.modes={};continue;}
      const stick=Math.hypot(t.lastStick.x,t.lastStick.y);
      t.stickSum+=stick;t.attackSum+=t.lastStick.attack?1:0;t.samples++;t.modes[mode]=(t.modes[mode]??0)+1;
      const near=enemies.filter(e=>dist(e,p)<8).length,carU=car?r1(dist(p,car)):null;
      const ep=(startTick:number):Episode=>({bot:t.id,cls:t.cls,startS:s(startTick),durS:0,mode,modes:{...t.modes},x:r1(p.x),y:r1(p.y),carU,enemiesNear:near,
        attack:t.samples?r1(t.attackSum/t.samples):0,stick:t.samples?r1(t.stickSum/t.samples):0});
      // Idle: moved < IDLE_MOVE over IDLE_S (whatever the stick).
      if(dist(p,t.anchor)>IDLE_MOVE){close(t,'idle',tick,idle);t.anchor={x:p.x,y:p.y};t.anchorTick=tick;t.stickSum=t.attackSum=t.samples=0;t.modes={};}
      else if(!t.idle&&tick-t.anchorTick>=IDLE_S*HZ)t.idle=ep(t.anchorTick);
      // Stuck: pushing (stick > .5) and moved < STUCK_MOVE over STUCK_S.
      if(stick<.5||dist(p,t.stuckAnchor)>STUCK_MOVE){close(t,'stuck',tick,stuck);t.stuckAnchor={x:p.x,y:p.y};t.stuckTick=tick;}
      else if(!t.stuck&&tick-t.stuckTick>=STUCK_S*HZ){
        const e=ep(t.stuckTick),st=structuresOf(sim).map(x=>({k:x.kind,d:dist(x,p)})).sort((a,b)=>a.d-b.d)[0];
        e.near=car&&dist(p,car)<3.5?'carro':st&&st.d<2.5?st.k:'parede/mapa';t.stuck=e;
      }
      // Far from the car.
      if(car&&dist(p,car)>FAR_U){t.farSince??=tick;t.farModes[mode]=(t.farModes[mode]??0)+1;if(!t.far&&tick-t.farSince>=FAR_S*HZ){t.far=ep(t.farSince);}if(t.far){t.far.modes={...t.farModes};t.far.carU=Math.max(t.far.carU??0,r1(dist(p,car)));}}
      else{close(t,'far',tick,far);t.farSince=null;t.farModes={};}
    }
    // Downed: is a standing mate near and not rescuing?
    for(const d of openDown.values()){
      const p=sim.players.get(d.bot)!;let best=Infinity,bestMode='';
      for(const q of sim.players.values()){if(q.id===d.bot||!isStanding(q))continue;const x=dist(p,q);if(x<best){best=x;bestMode=room.modes.get(q.id)??'-';}}
      if(best<Infinity)d.minMateU=d.minMateU===null?r1(best):Math.min(d.minMateU,r1(best));
      if(best<=REVIVE_NEAR){d.mateNearS+=1/HZ;d.mateNearModes[bestMode]=(d.mateNearModes[bestMode]??0)+1;}
    }
    // Arsenal crates near the car: opened or ignored.
    const crates=sim.run.crates?.state.crates;
    if(crates&&tick%HZ===0){
      for(const [id,c] of Object.entries(crates)){if(crateSeen.has(id))continue;const k=sim.world.pickups.get(id);if(!k)continue;
        crateSeen.set(id,{id,rarity:(c as {rarity:number}).rarity,x:r1(k.x),y:r1(k.y),bornS:s(tick),carU:car?r1(dist(k,car)):null,openedS:null});}
      for(const c of crateSeen.values())if(c.openedS===null&&!crates[c.id])c.openedS=s(tick);
    }
    // Enemies that never move while awake.
    if(tick%(5*HZ)===0){
      for(const e of enemies){
        if(e.boss||enemyStuck.has(e.id))continue;
        const x=enemySamples.get(e.id);
        if(!x||dist(e,x)>=ENEMY_STUCK_MOVE)enemySamples.set(e.id,{x:e.x,y:e.y,tick});
        else if(tick-x.tick>=ENEMY_STUCK_S*HZ)enemyStuck.set(e.id,{id:e.id,kind:e.kind,x:r1(e.x),y:r1(e.y),atS:s(x.tick),carU:car?r1(dist(e,car)):null});
      }
      for(const id of enemySamples.keys())if(!sim.world.enemies.has(id))enemySamples.delete(id);
    }
    // The last minute before the end, every 5 s (for the team wipes).
    if(tick%(5*HZ)===0){
      lastMinute.push({atS:s(tick),snap:[...sim.players.values()].map(p=>`${p.id}:${isStanding(p)?'up':p.downed?'down':'out'} ${room.modes.get(p.id)??'-'} car${car?Math.round(dist(p,car)):'?'}u hp${Math.round(p.hp)} near${enemies.filter(e=>dist(e,p)<8).length}`).join(' | ')+` | car ${car?`${car.hits}/${car.limit}`:'-'} moto ${ch?.moto.mode??'-'} alive ${enemies.length}`});
      if(lastMinute.length>12)lastMinute.shift();
    }
  }
  const tick=sim.world.tick;
  for(const t of tracks.values()){close(t,'idle',tick,idle);close(t,'stuck',tick,stuck);close(t,'far',tick,far);}
  const objective=sim.objectiveResult(sim.outcome==='victory'?'victory':sim.outcome==='defeat'?'defeat':'timeout');
  const out={seed,players,outcome:sim.outcome??'timeout',cause:objective?.cause??null,endS:s(tick),
    objective:objective?{eta:objective.eta,hits:objective.hits,limit:objective.limit,debt:objective.debt,paid:objective.paid,budget:objective.budget}:null,
    phases:Object.fromEntries(Object.entries(phase).map(([k,v])=>[k,s(v)])),phaseLog,firstDownS,firstLevelS,bossS,kills,botKills,pauses,pausedS:r1(pausedLoops*STEP_MS/1000),
    bots:[...tracks.values()].map(t=>({id:t.id,cls:t.cls,downs:t.downs,revives:t.revives,modeS:Object.fromEntries(Object.entries(t.modeTicks).map(([k,v])=>[k,s(v)]))})),
    idle,stuck,far,downs,enemyStuck:[...enemyStuck.values()],crates:[...crateSeen.values()],
    lastMinute:sim.outcome==='defeat'?lastMinute:[],wallS:r1((performance.now()-started)/1000),msPerTick:r1((performance.now()-started)/Math.max(1,tick)*10)/10};
  return out;
}

async function main(){
  const a=args(process.argv.slice(2));
  try{os.setPriority(0,os.constants.priority.PRIORITY_LOW);}catch{}
  const text=fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.json'),'utf8');
  const hash=(JSON.parse(fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
  const city=await cityTerrainFrom(text,hash);
  if(!city.ok)throw new Error(city.error);
  const file=path.resolve(a.out??path.join(ROOT,'evidence/auditoria-bots-sim-28-10',`runs-${a.players}p.json`));
  let runs:unknown[]=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
  for(const seed of a.seeds){
    if(runs.some(r=>(r as {seed:number}).seed===seed))continue;
    const r=play(seed,a.players,Math.round(a.capMin*60*HZ),city);
    runs=[...runs,r];
    fs.writeFileSync(file+'.tmp',JSON.stringify(runs));fs.renameSync(file+'.tmp',file);
    console.log(`seed ${seed} ${a.players}p: ${r.outcome}/${r.cause} ${r.endS}s | idle ${r.idle.length} stuck ${r.stuck.length} far ${r.far.length} downs ${r.downs.length} enemyStuck ${r.enemyStuck.length} | ${r.wallS}s wall ${r.msPerTick} ms/tick`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
