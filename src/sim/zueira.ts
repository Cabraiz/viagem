/**
 * Zueira events in the middle of a round (VGM-053B), decided by the server and deterministic for the run seed:
 * - boletos: retired (NEW-20261024-ORQ-tirar-drops-cedula-girando, the user: "remova esses bichos que caem do chão"):
 *   the rain of XP boletos is never planned any more; the kind stays in the contract (wire, old replays) and does nothing;
 * - promo ("Promoção relâmpago"): retired too (NEW-20261025-ORQ-sem-coxinha-no-chao, the user: "Faltou a remoção das
 *   coxinhas ou outros drops parecidos"): never planned, no coxinha falls; the kind stays in the contract and does nothing;
 * - apagao: 3 s of blackout on the clients (eyes in the dark); nothing changes in the simulation.
 * Plus the kill-cam of a round's last critter: the run wires noteKill (onKill) and roundEnded (director onRoundEnd),
 * and this system emits `last-bicho` with where and by whom.
 *
 * Frequency (so it never gets tiresome, measured in done/VGM-053B.md): a run draws its plan once, from the seed:
 * the first event in round 2 or 3, then one every 2 or 3 rounds (never two rounds in a row), at most 4 per run, none in
 * round 1 (the tutorial) nor in the boss round. With the rain and the sale retired, a run plans one blackout. Inside its round the event comes 8–16 s after the
 * wave starts; a round that ends before that passes it on to the next eligible round.
 * State is JSON-safe (stateHash, checkpoints) with its own Rng, so a replay draws the same plan and the same drops.
 */
import {CALMA} from '../rules/index.ts';
import {Rng} from '../contract/index.ts';
import {ticks,type EnemyState,type HappeningKind,type SimPlayer} from '../contract/index.ts';
import type {SimContext,SimSystem} from './context.ts';

export const HAPPENING_KINDS:readonly HappeningKind[]=['boletos','promo','apagao'];
/** The kinds a run plans (and LAB_ZUEIRA accepts): the boleto rain and the flash sale are retired. */
export const PLANNED_KINDS:readonly HappeningKind[]=['apagao'];
/** How long each event lasts on screen, in seconds (the sale: how long its coxinhas stay on the ground). */
export const HAPPENING_SECONDS:Readonly<Record<HappeningKind,number>>={boletos:4,promo:8,apagao:3};
/** No event in round 1 (it teaches the fight) nor in the boss round. */
export const FIRST_EVENT_ROUND=2;
export const MAX_EVENTS_PER_RUN=4;
/** Rounds between two planned events: 2 or 3 (never back to back). */
export const EVENT_GAP:readonly [number,number]=[2,3];
/** Seconds after the wave starts. */
export const EVENT_DELAY:readonly [number,number]=[8,16];
/** The blackout waits (inside its 8–16 s window) for critters to look at: at least this many within this distance of half the standing heroes. */
export const APAGAO_CROWD=3,APAGAO_REACH=9;
/** Kill-cam: never two rounds in a row, at most this many per run (VGM-053B design review D5). */
export const KILLCAM_MAX_PER_RUN=4;
/**
 * Where a prize may fall around its hero (VGM-053B review M3, pacote-bugs-ux): never where a thumb sits, and never where
 * the hero cannot walk straight to it. The server knows neither the phone's orientation nor its view (D-019), so the rule
 * holds for all of them: under view k a world offset (dx, dy) lands 42·zoom·(±(dx−dy) or ±(dx+dy)) CSS px sideways on
 * screen (projection.ts) and 21·zoom·(the other one) px down. Measured on the real scene (evidence
 * NEW-20261012-pacote-bugs-ux, logs/zonas-polegar.json): portrait thumbs start 193 px under the hero's feet, out of reach
 * (21·0.583·7.8 = 95 px at most); landscape thumbs sit beside the hero, the right one from 191 px (199 at 125%), the left
 * from 285 px. With the look-ahead (≤ 36 px) and half a coxinha of the sale (23 px), sideways must stay under 132 px:
 * |dx−dy| and |dx+dy| ≤ PRIZE_SCREEN_SPAN (5 u = 122 px at the 0.583 zoom of a 390 px short side; bigger phones put the
 * thumbs farther in proportion).
 */
export const PRIZE_SCREEN_SPAN=5;
export const prizeSpotSafe=(dx:number,dy:number)=>Math.abs(dx-dy)<=PRIZE_SCREEN_SPAN&&Math.abs(dx+dy)<=PRIZE_SCREEN_SPAN;
/**
 * The thumb zones of a phone, CSS px from its hero's feet (x right, y down), measured on the real scene (portrait and
 * landscape, 100% and 125%, camera settled; evidence logs/zonas-polegar.json), each grown by THUMB_MARGIN_PX: the
 * look-ahead (≤ 36 px) and half a sale's coxinha (23 px). At the follow zoom of a 390 px short side (0.583).
 */
export const THUMB_ZONES:readonly {x:number;y:number;width:number;height:number}[]=[
  {x:-228,y:193,width:193,height:202},{x:-56,y:211,width:251,height:184},// portrait (union of 100% and 125%)
  {x:-429,y:-8,width:154,height:145},{x:191,y:-26,width:246,height:183},// landscape (union of 100% and 125%)
];
export const THUMB_MARGIN_PX=59,THUMB_ZOOM=.583;
/**
 * Whether a world offset from a hero can sit under one of that hero's phone's thumbs, in any of the 4 views and either
 * orientation (projection.ts without relief: x = 42·(qx−qy), y = 21·(qx+qy) after the view's rotation). The test checks
 * that prizeSpotSafe never needs it for the prize's own hero (see `around` for the teammates).
 */
export function underThumb(dx:number,dy:number){
  for(let view=0;view<4;view++){
    // A quarter turn per view (projection.ts viewPoint); all four are checked, so the turning direction does not matter.
    const qx=view===0?dx:view===1?-dy:view===2?-dx:dy,qy=view===0?dy:view===1?dx:view===2?-dy:-dx;
    const sx=42*(qx-qy)*THUMB_ZOOM,sy=21*(qx+qy)*THUMB_ZOOM;
    for(const z of THUMB_ZONES)if(sx>z.x-THUMB_MARGIN_PX&&sx<z.x+z.width+THUMB_MARGIN_PX&&sy>z.y-THUMB_MARGIN_PX&&sy<z.y+z.height+THUMB_MARGIN_PX)return true;
  }
  return false;
}
/** A structure a prize must not fall on (the wall's ring and tent, the forge's towers): centre and clearance, units. */
export interface PrizeBlock {x:number;y:number;radius:number}
/** Tries for a prize spot around its hero (then that prize is skipped, as before). */
export const PRIZE_TRIES=12;
/** Marked a coxinha of the retired flash sale (the client still draws one bigger, for old replays). */
export const PROMO='promo';

export interface PlannedHappening {round:number;kind:HappeningKind}
/** value/left: the retired boleto rain's XP (kept optional so an old checkpoint still loads). */
export interface ActiveHappening {kind:HappeningKind;round:number;startTick:number;endsTick:number;value?:number;left?:number}
export interface ZueiraState {
  rng:number;
  /** Still to happen, oldest first. */
  plan:PlannedHappening[];
  /** Already happened this run: the round it really happened in (a carried event moves) and the tick. */
  fired:(PlannedHappening&{tick:number})[];
  active?:ActiveHappening;
  /** Wave being watched (round index) and the tick its pending event goes off, if any. */
  wave?:number;triggerTick?:number;
  /** Last kill of the run (kill-cam). */
  lastKill?:{kind:string;x:number;y:number;by?:string;tick:number};
  /** Rounds that got a kill-cam (spacing and cap). */
  killcams?:number[];
  /** Tick the watched wave started (the blackout's window). */
  waveTick?:number;
}

/** The run's plan, from its seed: rounds and kinds (pure, tested). `total` is the round count (the last one is the boss). */
export function planHappenings(rng:Rng,total=10):PlannedHappening[]{
  const kinds:HappeningKind[]=[...PLANNED_KINDS];
  for(let i=kinds.length-1;i>0;i--){const j=rng.int(0,i);[kinds[i],kinds[j]]=[kinds[j],kinds[i]];}
  const plan:PlannedHappening[]=[];
  for(let round=FIRST_EVENT_ROUND+rng.int(0,1);round<total&&plan.length<Math.min(MAX_EVENTS_PER_RUN,kinds.length);round+=rng.int(EVENT_GAP[0],EVENT_GAP[1]))
    plan.push({round,kind:kinds[plan.length]});
  return plan;
}

export const createZueiraState=(seed:number):ZueiraState=>{
  const rng=new Rng(seed).fork('zueira');
  const plan=planHappenings(rng);
  return {rng:rng.state,plan,fired:[]};
};

const standing=(p:SimPlayer)=>p.online&&!p.spectator&&!p.eliminated&&!p.downed&&p.hp>0;

export interface ZueiraSystem extends SimSystem {
  readonly state:ZueiraState;
  /** onKill hook: remembers the last critter down (kill-cam). */
  noteKill(enemy:EnemyState,by:string|undefined,tick:number):void;
  /** Director onRoundEnd: the round's horde is gone. Emits the kill-cam when its last critter was killed (not timed out). */
  roundEnded(ctx:SimContext,round:{index:number;total:number;timedOut:boolean},roundStartTick:number):void;
  /** Whether an event of this kind is on now (the blackout, for the shame tracker). */
  activeAt(tick:number):ActiveHappening|undefined;
}

/** Lab override (LAB_ZUEIRA): a fixed plan and the smallest gap in rounds between two events (1 = back to back). */
export interface ZueiraLab {plan:PlannedHappening[];minGap?:number}
/** LAB_ZUEIRA "apagao,promo": those kinds from round 2 on, one per round, in that order (lab prints and proofs; 'boletos' is ignored). */
export function parseZueiraLab(value?:string):ZueiraLab|undefined{
  const kinds=(value??'').split(',').map(k=>k.trim()).filter((k):k is HappeningKind=>(PLANNED_KINDS as readonly string[]).includes(k));
  return kinds.length?{plan:kinds.slice(0,8).map((kind,i)=>({round:FIRST_EVENT_ROUND+i,kind})),minGap:1}:undefined;
}

/**
 * `clock` (D-051 mode 'ninhos', card ninhos-rounds-fora: no rounds): the same plan's kinds on the clock instead
 * (rules/calma.ts CALMA): the first CALMA.zueiraFirstS..zueiraEveryS[0] seconds into the run, then one every
 * zueiraEveryS[0]..[1] seconds, at most zueiraMax, never while `bossUp` (it waits); the blackout still waits for
 * critters around, and past EVENT_DELAY[1] goes behind the next kind.
 */
export function createZueira(seed:number,options:{lab?:ZueiraLab;clock?:{bossUp:(ctx:SimContext)=>boolean}}={}):ZueiraSystem{
  const minGap=options.lab?.minGap??EVENT_GAP[0];
  const state=createZueiraState(seed);
  if(options.lab)state.plan=options.lab.plan.map(p=>({...p}));
  let rng:Rng|undefined;
  const rngOf=()=>rng??=new Rng(state.rng);
  const save=()=>{if(rng)state.rng=rng.state;};

  const heroes=(ctx:SimContext)=>[...ctx.players.values()].filter(standing).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);

  /** Mode 'ninhos': the next event on the clock (state.triggerTick; waveTick: when it fell due, for the blackout). */
  function clockStep(ctx:SimContext,bossUp:(ctx:SimContext)=>boolean){
    if(state.fired.length>=CALMA.zueiraMax||!state.plan.length){state.triggerTick=undefined;return;}
    if(state.triggerTick===undefined){state.triggerTick=ctx.tick+ticks(rngOf().range(CALMA.zueiraFirstS,CALMA.zueiraEveryS[0]));return;}
    if(ctx.tick<state.triggerTick||state.active||bossUp(ctx)||!heroes(ctx).length)return;
    state.waveTick??=ctx.tick;
    if(state.plan[0].kind!=='apagao'||crowded(ctx)){
      fire(ctx,1);delete state.waveTick;
      state.triggerTick=ctx.tick+ticks(rngOf().range(CALMA.zueiraEveryS[0],CALMA.zueiraEveryS[1]));
    }else if(ctx.tick>state.waveTick+ticks(EVENT_DELAY[1])){delete state.waveTick;if(state.plan.length>1)state.plan.push(state.plan.shift()!);}
  }
  function fire(ctx:SimContext,index:number){
    const next=state.plan.shift()!;
    // The retired boleto rain and flash sale (a checkpoint planned before they were retired): skipped, nothing falls.
    if(next.kind==='boletos'||next.kind==='promo'){state.triggerTick=undefined;return;}
    const endsTick=ctx.tick+ticks(HAPPENING_SECONDS[next.kind]);
    const active:ActiveHappening={kind:next.kind,round:index,startTick:ctx.tick,endsTick};
    state.active=active;state.fired.push({round:index,kind:next.kind,tick:ctx.tick});
    state.triggerTick=undefined;
    ctx.emit({type:'happening',kind:next.kind,endsTick});
  }

  /** Half the standing heroes have APAGAO_CROWD critters within APAGAO_REACH: there are eyes to see in the dark. */
  function crowded(ctx:SimContext){
    const team=heroes(ctx);if(!team.length)return false;
    let ok=0;
    for(const p of team){let n=0;for(const e of ctx.enemies.values())if((e.x-p.x)**2+(e.y-p.y)**2<=APAGAO_REACH**2&&++n>=APAGAO_CROWD)break;if(n>=APAGAO_CROWD)ok++;}
    return ok*2>=team.length;
  }

  return {
    id:'zueira',state,
    noteKill(enemy,by,tick){state.lastKill={kind:enemy.kind,x:enemy.x,y:enemy.y,...(by?{by}:{}),tick};},
    roundEnded(ctx,round,roundStartTick){
      // A wave cut short by its own end never keeps raining (or dark) into the intermission.
      if(state.active)state.active=undefined;
      const kill=state.lastKill,cams=state.killcams??=[];
      if(round.timedOut||round.index>=round.total||!kill||kill.tick<roundStartTick)return;
      // Not every round (design review D5): never right after another kill-cam, at most KILLCAM_MAX_PER_RUN a run.
      if(cams.length>=KILLCAM_MAX_PER_RUN||cams.includes(round.index-1))return;
      cams.push(round.index);
      ctx.emit({type:'last-bicho',kind:kill.kind,x:kill.x,y:kill.y,round:round.index,...(kill.by?{by:kill.by}:{})});
    },
    activeAt(tick){const a=state.active;return a&&tick>=a.startTick&&tick<a.endsTick?a:undefined;},
    step(ctx){
      const round=ctx.round,active=state.active;
      if(active){
        if(ctx.tick>=active.endsTick||round.phase!=='wave'){state.active=undefined;}
      }
      if(options.clock){clockStep(ctx,options.clock.bossUp);save();return;}
      if(round.phase!=='wave'){state.wave=undefined;state.triggerTick=undefined;save();return;}
      // A new wave: does the next planned event belong here (its round, or carried over), and when?
      if(state.wave!==round.index){
        state.wave=round.index;state.triggerTick=undefined;state.waveTick=ctx.tick;
        const next=state.plan[0],last=state.fired[state.fired.length-1];
        const eligible=next&&next.round<=round.index&&round.index<round.total&&(!last||round.index-last.round>=minGap);
        if(eligible)state.triggerTick=ctx.tick+ticks(rngOf().range(EVENT_DELAY[0],EVENT_DELAY[1]));
      }
      if(state.triggerTick!==undefined&&ctx.tick>=state.triggerTick&&!state.active&&round.remaining>0&&heroes(ctx).length){
        // The blackout waits for critters around (eyes to see); past the window it passes to the next eligible round.
        if(state.plan[0]?.kind!=='apagao'||crowded(ctx))fire(ctx,round.index);
        // No critters came: this round has no event, and the blackout goes behind the next planned kind (it never blocks the others).
        else if(ctx.tick>(state.waveTick??ctx.tick)+ticks(EVENT_DELAY[1])){state.triggerTick=undefined;if(state.plan.length>1)state.plan.push(state.plan.shift()!);}
      }
      save();
    },
  };
}
