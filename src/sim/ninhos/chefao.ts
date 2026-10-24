/**
 * The chefão at the end of the 1st wave (card NEW-20261023-ORQ-boss-fim-onda-1; rules/chefao-onda.ts says who, when and
 * the scene's clock). Mode 'ninhos' only (assemble.ts). One per run:
 *  - who: pickWaveBoss(seed), or options.who (labs, tests);
 *  - when: the first step where wave WAVE_BOSS.waveIndex has left and its map share dripped out (NestsState.sent past it,
 *    no drip running): the moment its last body leaves;
 *  - where: along that wave's way in (its entrance's route to the car), WAVE_BOSS.fromCar from the car, then outward
 *    until WAVE_BOSS.clear from every body (sim/boss.ts never spawns on anyone); the entrance itself when nothing fits;
 *  - the fight: a second boss controller (sim/boss.ts createBoss, the final boss's own fight: telegraphed slam and
 *    charge, the assembly at half hp, the enrage), with his kind (the roster chefe: its art), his lines, WAVE_BOSS's hp
 *    and × WAVE_BOSS.damage on every hit; he besieges the car like the final boss; his crate is a WAVE_BOSS.crate;
 *  - the scene: `arrival(tick)` on the tick he appears, for the room (multiplayer/boss-scene.ts) to hold the sim.
 * The final boss (the chaveiro's ETA, assemble.ts `boss`) is untouched: another controller, another state.
 * A checkpoint keeps no live enemy: one taken while he stands (the calm checkpoint never is, Simulation.calmCheckpointDue)
 * brings him back on the next step, scene and all.
 */
import {enemyTerrain,walkable,type Point} from '../../maps/index.ts';
import {WAVE_BOSS,pickWaveBoss,waveBossById,type WaveBoss} from '../../rules/index.ts';
import {BOSS_TUNING,createBoss,type BossController,type BossLineKey,type BossOptions,type BossState,type BossTuning} from '../boss.ts';
import type {SimContext,SimSystem} from '../context.ts';
import type {NestsState,WaveEntrance} from './ninhos.ts';

/** JSON-safe (RunSystemsState.chefao). */
export interface ChefaoState {
  /** Roster id of the run's chefão. */
  who:string;
  /** Tick he appeared on (absent before). */
  called?:number;
  /** His enemy id and where he appeared (the scene's camera). */
  enemy?:string;x?:number;y?:number;
  boss:BossState;
}
export interface ChefaoArrival {enemy:string;who:string;x:number;y:number}
export interface ChefaoOptions extends Omit<BossOptions,'kind'|'lines'|'tuning'|'onDefeated'|'hpScale'> {
  seed:number;
  /** Forces who comes (a roster id of WAVE_BOSSES); absent or unknown: pickWaveBoss(seed). */
  who?:string;
  nests:()=>NestsState|undefined;
  entrances:readonly WaveEntrance[];
  car:Point;
  /** Over BOSS_TUNING before WAVE_BOSS's numbers (the city's speeds are the final boss's: none today). */
  tuning?:Partial<BossTuning>;
}
export interface ChefaoSystem extends SimSystem {
  readonly state:ChefaoState;
  readonly who:WaveBoss;
  readonly boss:BossController;
  /** He stands (appeared, not beaten). */
  up():boolean;
  /** The arrival, on the very tick he appeared (the room opens the scene); undefined on any other tick. */
  arrival(tick:number):ChefaoArrival|undefined;
  /** Dev labs (the room's {t:'lab',chefao:true}): he comes on the next step, wherever the wave stands. False when he already came. */
  summon():boolean;
}

/**
 * WAVE_BOSS's numbers over a tuning: its hp, × damage on every hit, and his size (drawScale): the body and the charge's
 * width × it, the areas on the ground (slam, stamp, sweep) × (1 + it) / 2, so a golpe reaches past his bigger body.
 */
export function waveBossTuning(base:Readonly<BossTuning>=BOSS_TUNING,drawScale:number=WAVE_BOSS.drawScale):BossTuning{
  const d=WAVE_BOSS.damage,t={...base},s=drawScale,area=(1+s)/2;
  t.baseHp=WAVE_BOSS.baseHp;t.hpPerExtraPlayer=WAVE_BOSS.hpPerExtraPlayer;
  for(const k of ['slamDamage','fineDamage','chargeDamage','coneDamage'] as const)t[k]=Math.round(base[k]*d);
  t.radius=base.radius*s;t.chargeWidth=base.chargeWidth*s;
  t.slamRadius=base.slamRadius*area;t.fineRadius=base.fineRadius*area;t.coneRange=base.coneRange*area;
  t.soloDamage=WAVE_BOSS.soloDamage;t.slamPush=WAVE_BOSS.slamPush;t.chargePush=WAVE_BOSS.chargePush;
  return t;
}
/** His lines for the boss controller's keys: the barks in the fight, the death lines at the end. */
export function waveBossLines(b:WaveBoss):Record<BossLineKey,readonly string[]>{
  const fight=b.barks;
  return {spawn:fight,slam:fight,fine:fight,charge:fight,sweep:fight,summon:fight,phase2:fight,enrage:fight,defeat:b.deathLines};
}

const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
/**
 * Where he appears: on `route` (entrance → car), the first point at `fromCar` (along the route, from the car's end) or
 * farther out that is walkable for an enemy and `clear` from every body; the route's start when none is.
 */
export function waveBossSpot(route:readonly Point[],bodies:readonly Point[],ok:(p:Point)=>boolean,fromCar:number=WAVE_BOSS.fromCar,clear:number=WAVE_BOSS.clear):Point|undefined{
  if(!route.length)return undefined;
  const fits=(p:Point)=>ok(p)&&bodies.every(b=>dist(b,p)>=clear);
  // Walk from the car's end outward, in 1 u steps, past fromCar.
  let walked=0;
  for(let i=route.length-1;i>0;i--){
    const a=route[i],b=route[i-1],l=dist(a,b);
    for(let s=0;s<l;s+=1){
      const p={x:a.x+(b.x-a.x)*s/l,y:a.y+(b.y-a.y)*s/l};
      if(walked+s>=fromCar&&fits(p))return p;
    }
    walked+=l;
  }
  const start=route[0];
  return fits(start)||ok(start)?{x:start.x,y:start.y}:undefined;
}

export function createChefao(options:ChefaoOptions,restore?:ChefaoState):ChefaoSystem{
  const who=waveBossById(options.who)??waveBossById(restore?.who)??pickWaveBoss(options.seed);
  const {seed:_seed,who:_who,nests,entrances,car,tuning:base,...bossOptions}=options;
  const state:ChefaoState=restore?structuredClone(restore):{who:who.id,boss:{defeated:false,lastX:0,lastY:0,minions:[],pending:[]}};
  state.who=who.id;
  // A checkpoint keeps no live enemy: one taken while he stood brings him back (called again on the next step).
  if(state.called!==undefined&&!state.boss.defeated&&state.boss.bossId!==undefined){
    delete state.called;delete state.enemy;delete state.x;delete state.y;
    state.boss={defeated:false,lastX:0,lastY:0,minions:[],pending:[],...(state.boss.rng!==undefined?{rng:state.boss.rng}:{})};
  }
  const boss=createBoss({...bossOptions,kind:who.id,lines:waveBossLines(who),tuning:waveBossTuning({...BOSS_TUNING,...base})});
  boss.restore(state.boss);
  // The controller's state object is the one the checkpoint stores.
  state.boss=boss.state;

  /** A lab's summon (not kept by a checkpoint). */
  let forced=false;
  function call(ctx:SimContext,now=false){
    const n=nests();
    if(!now&&(!n||n.startTick===null||n.sent<=WAVE_BOSS.waveIndex||n.drip))return;
    // His wave's entry in the log (the last LOG_WAVES; the newest last), its entrance's route.
    const log=n?.log??[],entry=n?log[log.length-(n.sent-WAVE_BOSS.waveIndex)]:undefined;
    const door=entrances.find(e=>e.id===entry?.entrance)??entrances[WAVE_BOSS.waveIndex%Math.max(1,entrances.length)];
    const bodies=[...ctx.players.values()].filter(p=>!p.spectator&&!p.eliminated);
    const terrain=enemyTerrain(ctx.terrain);
    const route=door?(door.route.length?door.route:[{x:door.x,y:door.y},car]):[];
    const spot=waveBossSpot(route,bodies,p=>walkable(p,terrain));
    const e=boss.spawnBoss(ctx,spot);
    if(!e)return;
    state.called=ctx.tick;state.enemy=e.id;state.x=e.x;state.y=e.y;
  }

  return {
    id:'chefao',state,who,boss,
    step(ctx){
      if(state.called===undefined)call(ctx,forced);
      boss.step(ctx);
    },
    up:()=>state.called!==undefined&&!state.boss.defeated,
    summon(){if(state.called!==undefined)return false;forced=true;return true;},
    arrival(tick){
      return state.called===tick&&state.enemy!==undefined?{enemy:state.enemy,who:state.who,x:state.x??0,y:state.y??0}:undefined;
    },
  };
}
