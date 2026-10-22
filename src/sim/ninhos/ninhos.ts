/**
 * Nests of the city (D-051, NEW-20261014-ORQ-ninhos-sim, the E1 half; claims/NEW-20261014-ORQ-mapa-vivo-ninhos/proposta.md
 * §4-5): only in `mode:'ninhos'` (the chaveiro in Cidade Nevada, assemble.ts), where they replace the director's waves.
 *  - Each live nest sends a group out on its own timer: the first between FIRST_EXIT seconds after the start, then every
 *    NEST_PERIOD[size] × (1 − 0.4·f) seconds, f = time since the start ÷ NEST_RUN_SECONDS (0..1). The group's size comes
 *    from NEST_GROUP by f and is × playerScale(n).count. With no room under the enemy cap the timer waits RETRY_SECONDS.
 *  - Groups go out in a fixed pattern: SIEGE_SHARE of them besiege the car (SIEGE_FLAG, like the director's cerco), the
 *    rest hunt the team (the enemy-ai's chase). No rng there, so the split is exact.
 *  - A nest is a structure: NEST_HP[size] × (1 + 0.3(n − 1)). Its first hit wakes its sleepers (options.wake, the E2 half);
 *    at half hp it lets out one emergency group (half the current size, hunters); at 0 it falls: its timer stops, it drops
 *    a crate (purple P/M, golden G) and NEST_GRANA. Hits come through `hit` (the E2 damage path routes nest ids here).
 *  - The boss still comes by the chaveiro's ETA; it leaves from the biggest live nest (`bossSpot`), else where it did.
 * n is the room size fixed on the first step (the plan is drawn for it; later joiners change nothing). Every draw uses
 * the run's stream forked 'ninhos', kept in the state (JSON), so a checkpoint resumes the same groups.
 */
import type {NestPlan,NestSize,Point} from '../../maps/index.ts';
import {Rng,ticks,type EnemyState} from '../../contract/index.ts';
import {ROUNDS,playerScale,type EnemyRole,type RoundRoster} from '../../rules/index.ts';
import type {SimContext,SimSystem} from '../context.ts';
import {SIEGE_FLAG} from '../stonewards/wall.ts';

export const NEST_RUN_SECONDS=540;
export const NEST_PERIOD:Readonly<Record<NestSize,number>>=Object.freeze({G:55,M:70,P:90});
export const NEST_SPEEDUP=.4;
export const FIRST_EXIT:readonly [number,number]=[45,90];
/** Group size per nest by f: [min, max] below .3, from .3 to .7, above .7. */
export const NEST_GROUP:Readonly<Record<NestSize,readonly (readonly [number,number])[]>>=Object.freeze({
  P:[[3,4],[4,5],[5,6]],M:[[5,6],[6,8],[8,10]],G:[[8,9],[9,12],[12,15]],
});
export const NEST_HP:Readonly<Record<NestSize,number>>=Object.freeze({P:600,M:1000,G:1600});
export const NEST_GRANA:Readonly<Record<NestSize,number>>=Object.freeze({P:30,M:50,G:80});
export const NEST_CRATE:Readonly<Record<NestSize,'roxa'|'dourada'>>=Object.freeze({P:'roxa',M:'roxa',G:'dourada'});
export const SIEGE_SHARE=.6;
export const RETRY_SECONDS=1;
/**
 * balanco-ninhos: the whole map's pace, over the nests' own timers (8 nests on their own clocks let 14-64 bodies a minute
 * out on 1 player, the waves 0-15). Values for 1 player → 6 players (linear in between):
 *  - gap: at least this many seconds between two groups, from any nest (the "pause between groups");
 *  - alive: no group while this many enemies are alive (the timer waits RETRY_SECONDS);
 *  - warm: for the first `warm` seconds the groups are × warmScale (the light round 1: time to level and gather);
 *  - warmRow: the round row (hp, kinds) of the groups during `warm` (nestRound: 2..9 by f after it);
 *  - size: × the group size (over playerScale's count);
 *  - siege: the share of the groups that besiege the car (was SIEGE_SHARE for every size);
 *  - ramp: the seconds f takes from 0 to 1 (period, group size, the round row of hp and kinds; NEST_RUN_SECONDS was 540).
 * Mutable only for the bench's grid (bench-city-run --nest-pace); the game never writes it.
 */
// Bench (manual, seeds 1-16, evidence/NEW-20261017-ORQ-balanco-ninhos/full-final): see the card's status.md.
export const NEST_PACE={gap:[45,5] as [number,number],alive:[8,60] as [number,number],warm:180,warmScale:.4,warmRow:1,ramp:NEST_RUN_SECONDS,
  siege:[SIEGE_SHARE,.75] as [number,number],size:[1,1.85] as [number,number]};
export const pace=(pair:readonly [number,number],players:number)=>pair[0]+(pair[1]-pair[0])*(clampPlayers(players)-1)/5;
const SIZE_RANK:Readonly<Record<NestSize,number>>={P:0,M:1,G:2};
/** How often a role shows up in a nest group (the rotation's roles; mini-chefes and the boss never come from a nest). */
export const ROLE_WEIGHT:Readonly<Partial<Record<EnemyRole,number>>>=Object.freeze({
  corredor:4,enxame:3,palhaco:.5,arremessador:1.5,atirador:1.5,suporte:.7,voador:.7,kamikaze:.7,refletor:.7,invocador:.4,brutamontes:.6,
});
/** Id prefix of a nest as a hit target (sono's index): `ninho:<nest id>`. */
export const NEST_TARGET='ninho:';
/** Enemy memory key: the nest a body came out of (JSON-safe: its index in the plan). */
export const NEST_MEMORY='nest';

export interface NestRun {
  id:string;size:NestSize;x:number;y:number;radius:number;
  hp:number;maxHp:number;
  /** Tick of its next group (absent once it fell). */
  next?:number;
  groups:number;
  hit?:true;emergency?:true;down?:true;
}
/** JSON-safe (RunSystemsState.ninhos). */
export interface NestsState {
  /** Tick of the first step; null before it. */
  startTick:number|null;
  /** Room size the plan and the hp were made for (1..6), fixed on the first step. */
  players:number;
  rng?:number;
  nests:NestRun[];
  /** Groups sent so far (all nests): the siege pattern's index. */
  sent:number;
  spawned:number;
  /** NEST_PACE.gap: no group before this tick (absent before the first group). */
  quietUntil?:number;
}
export type NestCause='hit'|'fell';
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
}
export interface NestsSystem extends SimSystem {
  readonly state:NestsState;
  /** Damage to a nest (already scaled by the source's might). True when this hit brought it down. */
  hit(ctx:SimContext,nestId:string,amount:number):boolean;
  /** Where the boss leaves from: the biggest live nest (a spot of its yard), undefined when none stands. */
  bossSpot():Point|undefined;
  /** Nests standing. */
  alive():number;
  /** The plan the run plays (drawn on the first step); undefined before it. */
  plan():NestPlan|undefined;
}

export const nestHp=(size:NestSize,players:number)=>Math.round(NEST_HP[size]*(1+.3*(clampPlayers(players)-1)));
export const nestPeriod=(size:NestSize,f:number)=>NEST_PERIOD[size]*(1-NEST_SPEEDUP*Math.max(0,Math.min(1,f)));
export const groupRange=(size:NestSize,f:number)=>NEST_GROUP[size][f<.3?0:f<=.7?1:2];
/** The round table row whose numbers (hp, kinds) a group at f plays: 2..9 (no tutorial, no boss round). */
export const nestRound=(f:number)=>Math.max(2,Math.min(9,1+Math.floor(Math.max(0,Math.min(1,f))*9)));
/** Group i besieges the car: exactly SIEGE_SHARE of the groups, spread evenly (like the director's siegeShare). */
export const isSiegeGroup=(i:number,share:number=SIEGE_SHARE)=>Math.floor((i+1)*share)>Math.floor(i*share);
const clampPlayers=(n:number)=>Math.max(1,Math.min(6,Math.round(n)||1));

export function createNests(options:NestsOptions,restore?:NestsState):NestsSystem{
  const state:NestsState=restore?structuredClone(restore):{startTick:null,players:1,nests:[],sent:0,spawned:0};
  let plan:NestPlan|undefined=state.startTick!==null?options.plan(state.players):undefined;
  let rng:Rng|undefined;
  /** The stream as the state left it (a restore, or a hit before this tick's step). */
  const random=()=>rng??=Object.assign(new Rng(0),{state:state.rng??0});
  const save=()=>{if(rng)state.rng=rng.state;};
  const elapsedF=(tick:number)=>state.startTick===null?0:(tick-state.startTick)/ticks(NEST_PACE.ramp);

  function begin(ctx:SimContext){
    const counted=options.players?.(ctx)??[...ctx.players.values()].filter(p=>p.online&&!p.spectator).length;
    state.players=clampPlayers(counted);state.startTick=ctx.tick;
    plan=options.plan(state.players);
    rng=ctx.rng.fork('ninhos');
    state.nests=plan.nests.map(n=>{
      const hp=nestHp(n.size,state.players);
      return {id:n.id,size:n.size,x:n.x,y:n.y,radius:n.radius,hp,maxHp:hp,next:ctx.tick+ticks(random().range(FIRST_EXIT[0],FIRST_EXIT[1])),groups:0};
    });
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

  /** Lets `count` bodies out of `nest` (as many as fit under the cap); returns how many came out. */
  function release(ctx:SimContext,nest:NestRun,count:number,siege:boolean,f:number){
    const room=Math.max(0,options.maxEnemies-ctx.enemies.size),n=Math.min(count,room);
    if(n<=0)return 0;
    const spots=plan!.nests.find(p=>p.id===nest.id)?.sleepers??[],index=state.nests.indexOf(nest);
    // NEST_PACE.warmRow: during the warm start the groups play that round row (1: the tutorial's light bodies).
    const row=ctx.tick-state.startTick!<ticks(NEST_PACE.warm)?NEST_PACE.warmRow:nestRound(f);
    const hp=(ROUNDS[row-1].hpNinhos??ROUNDS[row-1].hpScale)*playerScale(state.players).hp;
    let out=0;
    for(const kind of pickKinds(n,row)){
      // The yard's sleeper spots are clear ground by construction (maps/nests.ts); a building nest's centre is not.
      const at=spots.length?spots[(nest.groups*7+out)%spots.length]:{x:nest.x,y:nest.y};
      const e=options.createEnemy(ctx,kind,{x:at.x,y:at.y},hp);
      if(!e)continue;
      e.memory={...e.memory,[NEST_MEMORY]:index,...(siege?{[SIEGE_FLAG]:1}:{})};
      out++;state.spawned++;
    }
    return out;
  }

  function sendGroup(ctx:SimContext,nest:NestRun){
    const f=elapsedF(ctx.tick),[lo,hi]=groupRange(nest.size,f);
    if(ctx.tick<(state.quietUntil??0)||ctx.enemies.size>=pace(NEST_PACE.alive,state.players)){nest.next=ctx.tick+ticks(RETRY_SECONDS);return;}
    const warm=ctx.tick-state.startTick!<ticks(NEST_PACE.warm)?NEST_PACE.warmScale:1;
    const count=Math.max(1,Math.round(random().int(lo,hi)*playerScale(state.players).count*warm*pace(NEST_PACE.size,state.players)));
    const siege=isSiegeGroup(state.sent,pace(NEST_PACE.siege,state.players));
    if(!release(ctx,nest,count,siege,f)){nest.next=ctx.tick+ticks(RETRY_SECONDS);return;}
    state.sent++;nest.groups++;state.quietUntil=ctx.tick+ticks(pace(NEST_PACE.gap,state.players));
    nest.next=ctx.tick+ticks(nestPeriod(nest.size,f));
  }

  function fall(ctx:SimContext,nest:NestRun){
    nest.down=true;nest.hp=0;delete nest.next;
    options.wake?.(ctx,nest.id,'fell');
    options.pay?.(NEST_GRANA[nest.size]);
    options.dropCrate?.(ctx,{x:nest.x,y:nest.y},NEST_CRATE[nest.size]);
    options.onFall?.(ctx,nest);
  }

  return {
    id:'ninhos',state,
    plan:()=>plan,
    alive:()=>state.nests.filter(n=>!n.down).length,
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
      if(!nest.emergency&&nest.hp<=nest.maxHp/2){
        nest.emergency=true;
        const f=elapsedF(ctx.tick),[lo,hi]=groupRange(nest.size,f);
        release(ctx,nest,Math.max(1,Math.round((lo+hi)/4*playerScale(state.players).count)),false,f);
      }
      save();
      return false;
    },
    step(ctx){
      if(state.startTick===null)begin(ctx);
      for(const nest of state.nests)if(!nest.down&&nest.next!==undefined&&ctx.tick>=nest.next)sendGroup(ctx,nest);
      save();
    },
  };
}
