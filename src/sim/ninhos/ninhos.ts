/**
 * Nests and waves of the city (D-051, NEW-20261014-ORQ-ninhos-sim, the E1 half; claims/NEW-20261014-ORQ-mapa-vivo-ninhos/
 * proposta.md §4-5): only in `mode:'ninhos'` (the chaveiro in Cidade Nevada, assemble.ts), where they replace the
 * director's waves.
 * Card NEW-20261022-ORQ-monstros-espalhados (the user, 22/10: "PESSOAS PARADAS + CRIADAS NOS NINHOS + PESSOAS VINDO POR
 * FORA DO MAPA — vão tentar atacar o Uno, e a gente se estivermos no caminho"): one timer for the whole map. Each wave:
 *  - the map's share: a quota of NEST_PACE.mapShare (by room size) × the plan's bodies, less the plan bodies killed since the last wave
 *    (kill 120 of a quota of 100 and none come); the sleepers nearest the wave's way in (its entrance's route to the
 *    car) wake and go (options.recruit);
 *  - the nests' share: NEST_PACE.perNest (1–3) bodies born in each live nest; a fallen nest gives none, and a nest sends
 *    nothing outside a wave;
 *  - the outside group: OUTSIDE_GROUP by f × playerScale(n).count × NEST_PACE.size, walking in from an avenue end (the
 *    entrances in turn); the kills past the quota cut it, never below NEST_PACE.floor of it.
 *  Every one of them besieges the car (SIEGE_FLAG: the enemy-ai goes for the car, or a player closer on the way). The
 *  first wave comes FIRST_EXIT seconds after the start, the next NEST_PACE.period × (1 − NEST_SPEEDUP·f) later,
 *  f = time since the start ÷ NEST_PACE.ramp (0..1); with NEST_PACE.alive enemies up, or no room under the cap, it waits
 *  RETRY_SECONDS. The last waves are logged (state.log: quota, kills, map, nests, outside, total).
 *  - A nest is a structure: NEST_HP[size] × (1 + 0.3(n − 1)). Its first hit wakes its sleepers (options.wake, the E2 half);
 *    at 0 it falls: it drops a crate (purple P/M, golden G) and NEST_GRANA. Hits come through `hit` (the E2 damage path
 *    routes nest ids here).
 *  - The boss still comes by the chaveiro's ETA; it leaves from the biggest live nest (`bossSpot`), else where it did.
 * n is the room size fixed on the first step (the plan is drawn for it; later joiners change nothing). Every draw uses
 * the run's stream forked 'ninhos', kept in the state (JSON), so a checkpoint resumes the same waves.
 */
import type {NestPlan,NestSize,Point} from '../../maps/index.ts';
import {Rng,ticks,type EnemyState} from '../../contract/index.ts';
import {ROUNDS,playerScale,type EnemyRole,type RoundRoster} from '../../rules/index.ts';
import type {SimContext,SimSystem} from '../context.ts';
import {SIEGE_FLAG} from '../stonewards/wall.ts';

export const NEST_RUN_SECONDS=540;
export const NEST_SPEEDUP=.4;
export const NEST_HP:Readonly<Record<NestSize,number>>=Object.freeze({P:600,M:1000,G:1600});
export const NEST_GRANA:Readonly<Record<NestSize,number>>=Object.freeze({P:30,M:50,G:80});
export const NEST_CRATE:Readonly<Record<NestSize,'roxa'|'dourada'>>=Object.freeze({P:'roxa',M:'roxa',G:'dourada'});
export const RETRY_SECONDS=1;
/**
 * The "minuto de Minerva" (the user, 22/10): for NEST_PACE.minerva seconds from the start no critter walks nor chases
 * (the map's, the waves', the nests'): no noise wakes anyone, a hero wakes only the sleepers in its reach (sono
 * MINERVA_REACH), which hit him standing (the enemy-ai's hold), and the first wave is NEST_PACE.first after its end.
 * NestsState.minervaUntil; the room shows it (RunState.minervaAteTick, the HUD's clock).
 */
export const MINERVA_S=60;
/** The outside group by f: [min, max] below .3, from .3 to .7, above .7 (the old M nest's group). */
export const OUTSIDE_GROUP:readonly (readonly [number,number])[]=Object.freeze([[5,6],[6,8],[8,10]]);
/**
 * The waves' pace. Pairs are for 1 player → 6 players (linear in between):
 *  - period: seconds between two waves at the start (× (1 − NEST_SPEEDUP·f));
 *  - alive: no wave while this many enemies are alive (it waits RETRY_SECONDS);
 *  - minerva: the minuto de Minerva (s, MINERVA_S);
 *  - first: [min, max] seconds from the end of the minuto de Minerva to the first wave;
 *  - warm: for the first `warm` seconds the outside group is × warmScale and the waves play the round row `warmRow`
 *    (the light round 1: time to level and gather); nestRound (2..9 by f) after it;
 *  - size: × the outside group (over playerScale's count);
 *  - mapShare: the quota, a share of the plan's bodies (the user: 1000 on the map → 100 a wave; fixed by the user,
 *    22/10: "calibra, mas sem diminuir número de inimigos": the quota, the population and the waves never shrink to
 *    balance a run, the pace and the bodies' strength do);
 *  - trickle: map recruits leaving per second (the rest of the wave's share follows, a batch a second, not all at once);
 *  - march: × the speed of a wave's bodies (recruits, nest-born, outside);
 *  - hp, damage: × the hp and the hit of a wave's bodies;
 *  - perNest: [min, max] bodies born in each live nest per wave;
 *  - floor: the outside group never shrinks below this share of itself, whatever the kills past the quota;
 *  - ramp: the seconds f takes from 0 to 1 (period, outside group, the round row).
 * Mutable only for the bench's grid (bench-city-run --nest-pace); the game never writes it.
 */
// Bench (seeds 1-16, evidence/NEW-20261022-ORQ-monstros-espalhados): see the card's status.md.
export const NEST_PACE={period:[60,45] as [number,number],minerva:MINERVA_S,first:[45,90] as [number,number],alive:[8,60] as [number,number],
  warm:180,warmScale:.4,warmRow:1,ramp:NEST_RUN_SECONDS,size:[1,1.85] as [number,number],mapShare:[.1,.1] as [number,number],
  trickle:[2,6] as [number,number],march:1,hp:1,damage:1,perNest:[1,3] as [number,number],floor:.5};
/** The first wave's window (s): NEST_PACE.first. */
export const FIRST_EXIT:readonly [number,number]=NEST_PACE.first;
export const pace=(pair:readonly [number,number],players:number)=>pair[0]+(pair[1]-pair[0])*(clampPlayers(players)-1)/5;
const SIZE_RANK:Readonly<Record<NestSize,number>>={P:0,M:1,G:2};
/** How often a role shows up in a wave (the rotation's roles; mini-chefes and the boss never come in one). */
export const ROLE_WEIGHT:Readonly<Partial<Record<EnemyRole,number>>>=Object.freeze({
  corredor:4,enxame:3,palhaco:.5,arremessador:1.5,atirador:1.5,suporte:.7,voador:.7,kamikaze:.7,refletor:.7,invocador:.4,brutamontes:.6,
});
/** Id prefix of a nest as a hit target (sono's index): `ninho:<nest id>`. */
export const NEST_TARGET='ninho:';
/** Enemy memory key: the nest a body was born in (JSON-safe: its index in the plan). */
export const NEST_MEMORY='nest';
/** Enemy memory key: the wave a body came with (its index, 0-based). */
export const WAVE_MEMORY='wave';

export interface NestRun {
  id:string;size:NestSize;x:number;y:number;radius:number;
  hp:number;maxHp:number;
  /** Legacy (before monstros-espalhados: the nest's own group timer); never set now. */
  next?:number;
  /** Waves this nest gave bodies to. */
  groups:number;
  hit?:true;
  /** Legacy (the half-hp group, before monstros-espalhados); never set now. */
  emergency?:true;
  down?:true;
}
/** One wave as it left (the debug log): the quota, the map kills since the last wave, and each share. */
export interface WaveLog {tick:number;entrance:string;quota:number;kills:number;map:number;nests:number;outside:number;total:number}
/** JSON-safe (RunSystemsState.ninhos). */
export interface NestsState {
  /** Tick of the first step; null before it. */
  startTick:number|null;
  /** Room size the plan and the hp were made for (1..6), fixed on the first step. */
  players:number;
  rng?:number;
  nests:NestRun[];
  /** Waves sent so far: the entrances' turn. */
  sent:number;
  /** Bodies spawned by the waves (born in a nest or outside; the map's recruits are not new bodies). */
  spawned:number;
  /** Tick of the next wave (absent before the first step, or in a checkpoint from before the waves). */
  nextWave?:number;
  /** The quota: NEST_PACE.mapShare (by room size) × the plan's bodies, fixed on the first step. */
  quota?:number;
  /** Plan bodies dead at the last wave (options.mapDead). */
  deadAt?:number;
  /** The last LOG_WAVES waves. */
  log?:WaveLog[];
  /** The end tick of the minuto de Minerva (start + NEST_PACE.minerva); absent in a checkpoint from before it. */
  minervaUntil?:number;
  /** The map share still to leave (NEST_PACE.trickle a second): the route's entrance index, how many, the wave's log tick. */
  drip?:{door:number;left:number;tick:number};
}
export const LOG_WAVES=20;
export type NestCause='hit'|'fell';
/** An avenue end the outside groups walk in from, with its route to the car (the map's recruits stand nearest it). */
export interface WaveEntrance {readonly id:string;readonly x:number;readonly y:number;readonly route:readonly Point[]}
export interface NestsOptions {
  /** The plan for a room of `players` (assemble: cityNestPlan with the chaveiro's routes and the run start). */
  plan(players:number):NestPlan;
  /** Players counted on the first step (default: online, non-spectator players, 1..6). */
  players?(ctx:SimContext):number;
  maxEnemies:number;
  /** Creates (and adds) one body at the city's speeds; undefined for an unknown kind or no room. */
  createEnemy(ctx:SimContext,kind:string,point:Point,hpScale:number):EnemyState|undefined;
  /** The run's roster for a round (D-040 rotation); undefined plays the round table's kinds. */
  roster?(round:number):RoundRoster|undefined;
  /** E2 (ninhos-sono): wakes every sleeper of the nest. */
  wake?(ctx:SimContext,nestId:string,cause:NestCause):void;
  /** E6 (armas-caixas): drops a crate of that rarity there. */
  dropCrate?(ctx:SimContext,at:Point,rarity:'roxa'|'dourada'):void;
  /** The team's Grana (stonewards state, D-048). */
  pay?(amount:number):void;
  /** A nest fell (zueira line, checkpoint of calm: the rounds-out card). */
  onFall?(ctx:SimContext,nest:Readonly<NestRun>):void;
  /** The avenue ends, taken in turn by the waves; none: the outside group comes out of the live nests' yards. */
  entrances?:readonly WaveEntrance[];
  /** Plan bodies dead so far (the sono). */
  mapDead?():number;
  /**
   * Wakes up to `count` sleeping plan bodies nearest `route`, besieging the car, each passed to `tune` (NEST_PACE's
   * march, hp, damage); returns how many woke (the sono).
   */
  recruit?(ctx:SimContext,route:readonly Point[],count:number,tune:(e:EnemyState)=>void):number;
  /** A body of radius r fits at (x, y) (the outside group spreads around its entrance); default: anywhere. */
  clear?(x:number,y:number,r:number):boolean;
}
export interface NestsSystem extends SimSystem {
  readonly state:NestsState;
  /** Damage to a nest (already scaled by the source's might). True when this hit brought it down. */
  hit(ctx:SimContext,nestId:string,amount:number):boolean;
  /** Where the boss leaves from: the biggest live nest (a spot of its yard), undefined when none stands. */
  bossSpot():Point|undefined;
  /** Nests standing. */
  alive():number;
  /** Whether the minuto de Minerva still holds at `tick` (true before the first step: nothing moves before the run). */
  minerva(tick:number):boolean;
  /** The plan the run plays (drawn on the first step); undefined before it. */
  plan():NestPlan|undefined;
}

export const nestHp=(size:NestSize,players:number)=>Math.round(NEST_HP[size]*(1+.3*(clampPlayers(players)-1)));
/** Seconds to the next wave at f, for `players`. */
export const wavePeriod=(f:number,players:number)=>pace(NEST_PACE.period,players)*(1-NEST_SPEEDUP*Math.max(0,Math.min(1,f)));
export const outsideRange=(f:number)=>OUTSIDE_GROUP[f<.3?0:f<=.7?1:2];
/** The round table row whose numbers (hp, kinds) a wave at f plays: 2..9 (no tutorial, no boss round). */
export const nestRound=(f:number)=>Math.max(2,Math.min(9,1+Math.floor(Math.max(0,Math.min(1,f))*9)));
/**
 * The shares of a wave (pure): the map's recruits wanted (quota − kills, ≥ 0) and the outside group after the kills past
 * the quota (base − excess, never under ceil(base × floor)).
 */
export function waveShares(quota:number,kills:number,outsideBase:number,floor:number=NEST_PACE.floor):{map:number;outside:number}{
  const excess=Math.max(0,kills-quota);
  return {map:Math.max(0,quota-kills),outside:Math.max(Math.ceil(outsideBase*floor),outsideBase-excess)};
}
const clampPlayers=(n:number)=>Math.max(1,Math.min(6,Math.round(n)||1));
const bodiesOf=(plan:NestPlan)=>plan.nests.reduce((n,x)=>n+x.sleepers.length,0)+plan.loose.reduce((n,b)=>n+b.members.length,0);

export function createNests(options:NestsOptions,restore?:NestsState):NestsSystem{
  const state:NestsState=restore?structuredClone(restore):{startTick:null,players:1,nests:[],sent:0,spawned:0};
  let plan:NestPlan|undefined=state.startTick!==null?options.plan(state.players):undefined;
  let rng:Rng|undefined;
  /** The stream as the state left it (a restore, or a hit before this tick's step). */
  const random=()=>rng??=Object.assign(new Rng(0),{state:state.rng??0});
  const save=()=>{if(rng)state.rng=rng.state;};
  const elapsedF=(tick:number)=>state.startTick===null?0:(tick-state.startTick)/ticks(NEST_PACE.ramp);
  const warming=(tick:number)=>state.startTick!==null&&tick-state.startTick<ticks(NEST_PACE.warm);

  function begin(ctx:SimContext){
    const counted=options.players?.(ctx)??[...ctx.players.values()].filter(p=>p.online&&!p.spectator).length;
    state.players=clampPlayers(counted);state.startTick=ctx.tick;
    plan=options.plan(state.players);
    rng=ctx.rng.fork('ninhos');
    state.nests=plan.nests.map(n=>{const hp=nestHp(n.size,state.players);return {id:n.id,size:n.size,x:n.x,y:n.y,radius:n.radius,hp,maxHp:hp,groups:0};});
    state.quota=Math.round(pace(NEST_PACE.mapShare,state.players)*bodiesOf(plan));
    state.deadAt=0;
    state.minervaUntil=ctx.tick+ticks(NEST_PACE.minerva);
    state.nextWave=state.minervaUntil+ticks(random().range(NEST_PACE.first[0],NEST_PACE.first[1]));
    save();
  }

  function pickKinds(count:number,round:number):string[]{
    const roster=options.roster?.(round);
    const weighted:[string,number][]=[];
    if(roster){
      for(const [role,w] of Object.entries(ROLE_WEIGHT) as [EnemyRole,number][]){
        const ids=roster.roles[role];if(ids?.length)for(const id of ids)weighted.push([id,w/ids.length]);
      }
    }
    if(!weighted.length)for(const [kind,w] of Object.entries(ROUNDS[round-1].weights))if(w>0)weighted.push([kind,w]);
    const total=weighted.reduce((s,[,w])=>s+w,0),out:string[]=[];
    for(let i=0;i<count;i++){
      let r=random().next()*total,kind=weighted[weighted.length-1][0];
      for(const [k,w] of weighted){if((r-=w)<0){kind=k;break;}}
      out.push(kind);
    }
    return out;
  }

  /** Spawns up to `count` wave bodies at `spots` (in turn), as many as fit under the cap; returns how many. */
  function spawn(ctx:SimContext,spots:readonly Point[],count:number,f:number,memory:Record<string,number>){
    const room=Math.max(0,options.maxEnemies-ctx.enemies.size),n=Math.min(count,room);
    if(n<=0||!spots.length)return 0;
    // NEST_PACE.warmRow: during the warm start the waves play that round row (1: the tutorial's light bodies).
    const row=warming(ctx.tick)?NEST_PACE.warmRow:nestRound(f);
    const hp=ROUNDS[row-1].hpScale*playerScale(state.players).hp;
    let out=0;
    for(const kind of pickKinds(n,row)){
      const at=spots[(state.sent*7+out)%spots.length];
      const e=options.createEnemy(ctx,kind,{x:at.x,y:at.y},hp);
      if(!e)continue;
      tune(e);
      e.memory={...e.memory,...memory,[WAVE_MEMORY]:state.sent,[SIEGE_FLAG]:1};
      out++;state.spawned++;
    }
    return out;
  }
  /** Up to `count` spots on clear ground around an entrance (a sunflower spiral, 0.9 u apart), the entrance first. */
  function around(p:Point,count:number):Point[]{
    const out:Point[]=[];
    for(let i=0;out.length<count&&i<count*4;i++){
      const r=.9*Math.sqrt(i),a=i*2.39996;
      const q={x:Math.round((p.x+r*Math.cos(a))*100)/100,y:Math.round((p.y+r*Math.sin(a))*100)/100};
      if(!options.clear||options.clear(q.x,q.y,.5))out.push(q);
    }
    return out.length?out:[{x:p.x,y:p.y}];
  }
  /** NEST_PACE's march, hp and damage on a wave's body. */
  function tune(e:EnemyState){
    // Once per body (a recruit that slept again and comes back keeps its tune).
    if(e.memory?.tuned===1)return;
    (e.memory??={}).tuned=1;
    if(NEST_PACE.march!==1)e.speed*=NEST_PACE.march;
    if(NEST_PACE.hp!==1){e.maxHp=Math.max(1,Math.round(e.maxHp*NEST_PACE.hp));e.hp=Math.min(e.maxHp,Math.max(1,Math.round(e.hp*NEST_PACE.hp)));}
    if(NEST_PACE.damage!==1)e.damage*=NEST_PACE.damage;
  }
  /** Lets the next batch of a wave's map share out (NEST_PACE.trickle a second, from its entrance's route). */
  function drip(ctx:SimContext){
    const d=state.drip,door=d?options.entrances?.[d.door]:undefined;
    if(!d||!door||!options.recruit){delete state.drip;return;}
    const room=Math.max(0,options.maxEnemies-ctx.enemies.size);
    const got=options.recruit(ctx,door.route,Math.min(d.left,Math.max(1,Math.round(pace(NEST_PACE.trickle,state.players))),room),tune);
    d.left-=Math.max(got,0);
    const entry=state.log?.find(l=>l.tick===d.tick);
    if(entry){entry.map+=got;entry.total+=got;}
    // Nobody left asleep to send, or the share is out: done.
    if(d.left<=0||got<=0)delete state.drip;
  }
  /** A nest's spots: its yard's sleeper spots (clear ground by construction, maps/nests.ts), else its centre. */
  const yardOf=(nest:NestRun)=>{const s=plan!.nests.find(p=>p.id===nest.id)?.sleepers;return s?.length?s:[{x:nest.x,y:nest.y}];};

  function sendWave(ctx:SimContext){
    const retry=()=>{state.nextWave=ctx.tick+ticks(RETRY_SECONDS);};
    if(ctx.enemies.size>=pace(NEST_PACE.alive,state.players)||ctx.enemies.size>=options.maxEnemies)return retry();
    const f=elapsedF(ctx.tick),warm=warming(ctx.tick)?NEST_PACE.warmScale:1;
    const entrances=options.entrances??[],door=entrances.length?entrances[state.sent%entrances.length]:undefined;
    const dead=options.mapDead?.()??0,kills=Math.max(0,dead-(state.deadAt??0)),quota=state.quota??0;
    const [lo,hi]=outsideRange(f);
    const base=Math.max(1,Math.round(random().int(lo,hi)*playerScale(state.players).count*warm*pace(NEST_PACE.size,state.players)));
    const want=waveShares(quota,kills,base);
    const born=state.nests.map(n=>n.down?0:random().int(NEST_PACE.perNest[0],NEST_PACE.perNest[1]));
    let nests=0;
    state.nests.forEach((nest,i)=>{
      if(!born[i])return;
      const got=spawn(ctx,yardOf(nest),born[i],f,{[NEST_MEMORY]:i});
      if(got){nests+=got;nest.groups++;}
    });
    const live=state.nests.find(n=>!n.down);
    const outside=door?spawn(ctx,around(door,want.outside),want.outside,f,{}):live?spawn(ctx,yardOf(live),want.outside,f,{}):0;
    if(!nests&&!outside&&!(want.map>0&&door&&options.recruit))return retry();
    (state.log??=[]).push({tick:ctx.tick,entrance:door?.id??'-',quota,kills,map:0,nests,outside,total:nests+outside});
    if(state.log.length>LOG_WAVES)state.log.splice(0,state.log.length-LOG_WAVES);
    // The map share leaves a batch a second (NEST_PACE.trickle), the first batch with the wave; a drip still running
    // from the last wave is dropped (its bodies stay asleep: the new share replaces it).
    if(want.map>0&&door&&options.recruit){state.drip={door:entrances.indexOf(door),left:want.map,tick:ctx.tick};drip(ctx);}
    else delete state.drip;
    state.sent++;state.deadAt=dead;
    state.nextWave=ctx.tick+ticks(wavePeriod(f,state.players));
  }

  function fall(ctx:SimContext,nest:NestRun){
    nest.down=true;nest.hp=0;
    options.wake?.(ctx,nest.id,'fell');
    options.pay?.(NEST_GRANA[nest.size]);
    options.dropCrate?.(ctx,{x:nest.x,y:nest.y},NEST_CRATE[nest.size]);
    options.onFall?.(ctx,nest);
  }

  return {
    id:'ninhos',state,
    plan:()=>plan,
    alive:()=>state.nests.filter(n=>!n.down).length,
    minerva:tick=>state.startTick===null||tick<(state.minervaUntil??0),
    bossSpot(){
      let best:NestRun|undefined;
      for(const n of state.nests)if(!n.down&&(!best||SIZE_RANK[n.size]>SIZE_RANK[best.size]))best=n;
      if(!best)return undefined;
      const spot=plan?.nests.find(p=>p.id===best!.id)?.sleepers[0];
      return spot?{x:spot.x,y:spot.y}:{x:best.x,y:best.y};
    },
    hit(ctx,nestId,amount){
      const nest=state.nests.find(n=>n.id===nestId);
      if(!nest||nest.down||!(amount>0))return false;
      if(!nest.hit){nest.hit=true;options.wake?.(ctx,nest.id,'hit');}
      nest.hp=Math.max(0,nest.hp-amount);
      if(nest.hp<=0){fall(ctx,nest);save();return true;}
      save();
      return false;
    },
    step(ctx){
      if(state.startTick===null)begin(ctx);
      // A checkpoint from before the waves (nests on their own timers): the first wave now, the quota from the plan.
      if(state.nextWave===undefined){state.nextWave=ctx.tick;state.quota??=plan?Math.round(pace(NEST_PACE.mapShare,state.players)*bodiesOf(plan)):0;state.deadAt??=options.mapDead?.()??0;}
      if(ctx.tick>=state.nextWave)sendWave(ctx);
      else if(state.drip&&(ctx.tick-state.drip.tick)%ticks(1)===0)drip(ctx);
      save();
    },
  };
}
