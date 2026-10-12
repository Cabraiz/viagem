/**
 * Zueira events in the middle of a round (VGM-053B), decided by the server and deterministic for the run seed:
 * - boletos: a 4 s rain of boletos around every standing hero, each one an XP pickup (the whole rain ≈ 45% of the
 *   level the team is on, split among the heroes);
 * - promo ("Promoção relâmpago"): 3 coxinhas next to every standing hero, gone after 8 s;
 * - apagao: 3 s of blackout on the clients (eyes in the dark); nothing changes in the simulation.
 * Plus the kill-cam of a round's last critter: the run wires noteKill (onKill) and roundEnded (director onRoundEnd),
 * and this system emits `last-bicho` with where and by whom.
 *
 * Frequency (so it never gets tiresome, measured in done/VGM-053B.md): a run draws its plan once, from the seed:
 * the first event in round 2 or 3, then one every 2 or 3 rounds (never two rounds in a row), at most 4 per run, none in
 * round 1 (the tutorial) nor in the boss round. Each of the three kinds once, in a random order, and the 4th (if the
 * rounds leave room) a rain or a sale, never a second blackout. Inside its round the event comes 8–16 s after the
 * wave starts; a round that ends before that passes it on to the next eligible round.
 * State is JSON-safe (stateHash, checkpoints) with its own Rng, so a replay draws the same plan and the same drops.
 */
import {MAX_PICKUPS,hasRoom} from './budget.ts';
import {HEAL_AMOUNT} from './offers.ts';
import {Rng} from './rng.ts';
import {clearSegment,walkable} from '../world.ts';
import {ticks,type EnemyState,type HappeningKind,type PickupState,type SimContext,type SimPlayer,type SimSystem} from './types.ts';

export const HAPPENING_KINDS:readonly HappeningKind[]=['boletos','promo','apagao'];
/** How long each event lasts on screen, in seconds (the sale: how long its coxinhas stay on the ground). */
export const HAPPENING_SECONDS:Readonly<Record<HappeningKind,number>>={boletos:4,promo:8,apagao:3};
/** No event in round 1 (it teaches the fight) nor in the boss round. */
export const FIRST_EVENT_ROUND=2;
export const MAX_EVENTS_PER_RUN=4;
/** Rounds between two planned events: 2 or 3 (never back to back). */
export const EVENT_GAP:readonly [number,number]=[2,3];
/** Seconds after the wave starts. */
export const EVENT_DELAY:readonly [number,number]=[8,16];
/**
 * Rain: RAIN_FIRST boletos per standing hero fall with the banner, then one per hero every RAIN_EVERY ticks until each
 * got RAIN_PER_HERO. The whole rain is worth RAIN_SHARE of the level the team is on (round(0.45 × nextXp)), fixed when it
 * starts and split among the boletos planned for the heroes standing then: more heroes = more boletos worth less each,
 * and a hero rescued in the middle only gets what is left (the drops stop when the total is out).
 */
export const RAIN_EVERY=5,RAIN_SHARE=.45,RAIN_FIRST=3,RAIN_PER_HERO=16,RAIN_RADIUS:readonly [number,number]=[1.4,5.5],BOLETO_LIFETIME_SECONDS=12;
/** The blackout waits (inside its 8–16 s window) for critters to look at: at least this many within this distance of half the standing heroes. */
export const APAGAO_CROWD=3,APAGAO_REACH=9;
/** Kill-cam: never two rounds in a row, at most this many per run (VGM-053B design review D5). */
export const KILLCAM_MAX_PER_RUN=4;
/** Sale: coxinhas per standing hero, how far from them. */
export const PROMO_COXINHAS=3,PROMO_RADIUS:readonly [number,number]=[1.4,3];
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
/** Tries for a prize spot around its hero (then that prize is skipped, as before). */
export const PRIZE_TRIES=12;
/** Marks an XP pickup as a boleto of the rain (PickupState.resource; the client draws a boleto, D-002). */
export const BOLETO='boleto';
/** Marks a coxinha of the flash sale (the client draws it bigger, with its short life). */
export const PROMO='promo';

export interface PlannedHappening {round:number;kind:HappeningKind}
/** value: XP per boleto; left: XP of the rain not dropped yet (the rain never gives more than its total). */
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
  const kinds:HappeningKind[]=[...HAPPENING_KINDS];
  for(let i=kinds.length-1;i>0;i--){const j=rng.int(0,i);[kinds[i],kinds[j]]=[kinds[j],kinds[i]];}
  kinds.push(rng.chance(.5)?'boletos':'promo');
  const plan:PlannedHappening[]=[];
  for(let round=FIRST_EVENT_ROUND+rng.int(0,1);round<total&&plan.length<MAX_EVENTS_PER_RUN;round+=rng.int(EVENT_GAP[0],EVENT_GAP[1]))
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
/** LAB_ZUEIRA "apagao,boletos,promo": those kinds from round 2 on, one per round, in that order (lab prints and proofs). */
export function parseZueiraLab(value?:string):ZueiraLab|undefined{
  const kinds=(value??'').split(',').map(k=>k.trim()).filter((k):k is HappeningKind=>(HAPPENING_KINDS as readonly string[]).includes(k));
  return kinds.length?{plan:kinds.slice(0,8).map((kind,i)=>({round:FIRST_EVENT_ROUND+i,kind})),minGap:1}:undefined;
}

export function createZueira(seed:number,options:{lab?:ZueiraLab}={}):ZueiraSystem{
  const minGap=options.lab?.minGap??EVENT_GAP[0];
  const state=createZueiraState(seed);
  if(options.lab)state.plan=options.lab.plan.map(p=>({...p}));
  let rng:Rng|undefined;
  const rngOf=()=>rng??=new Rng(state.rng);
  const save=()=>{if(rng)state.rng=rng.state;};

  /** A spot around `p` the hero can walk straight to and that no thumb covers on any phone (a few tries, then none). */
  function around(ctx:SimContext,p:SimPlayer,[min,max]:readonly [number,number]){
    const r=rngOf();
    for(let i=0;i<PRIZE_TRIES;i++){
      const a=r.range(0,Math.PI*2),d=r.range(min,max),dx=Math.cos(a)*d,dy=Math.sin(a)*d,at={x:p.x+dx,y:p.y+dy};
      if(prizeSpotSafe(dx,dy)&&walkable(at,ctx.terrain)&&clearSegment(p,at,ctx.terrain))return at;
    }
    return undefined;
  }
  function drop(ctx:SimContext,kind:'xp'|'heal',value:number,at:{x:number;y:number},lifetime:number,resource?:string){
    // A boleto over the pickup cap still drops: the pickups step merges XP over the cap into gems (mergeXpGems keeps it).
    if(kind!=='xp'&&!hasRoom(ctx.pickups,MAX_PICKUPS))return;
    const pickup:PickupState={id:ctx.nextId(kind),kind,value,x:at.x,y:at.y,spawnTick:ctx.tick,expiresTick:ctx.tick+ticks(lifetime)};
    if(resource)pickup.resource=resource;
    ctx.pickups.set(pickup.id,pickup);
  }
  const heroes=(ctx:SimContext)=>[...ctx.players.values()].filter(standing).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);

  function fire(ctx:SimContext,index:number){
    const next=state.plan.shift()!;
    const endsTick=ctx.tick+ticks(HAPPENING_SECONDS[next.kind]);
    const active:ActiveHappening={kind:next.kind,round:index,startTick:ctx.tick,endsTick};
    const team=heroes(ctx);
    if(next.kind==='boletos'){
      const total=Math.round(RAIN_SHARE*ctx.team.nextXp),drops=RAIN_PER_HERO*Math.max(1,team.length);
      active.value=total/drops;active.left=total;
      // The first boletos fall with the banner (RAIN_FIRST per hero), then one per hero every RAIN_EVERY ticks.
      for(let i=0;i<RAIN_FIRST;i++)rain(ctx,active,team);
    }
    if(next.kind==='promo')for(const p of team)for(let i=0;i<PROMO_COXINHAS;i++){const at=around(ctx,p,PROMO_RADIUS);if(at)drop(ctx,'heal',HEAL_AMOUNT,at,HAPPENING_SECONDS.promo,PROMO);}
    state.active=active;state.fired.push({round:index,kind:next.kind,tick:ctx.tick});
    state.triggerTick=undefined;
    ctx.emit({type:'happening',kind:next.kind,endsTick});
  }

  /** One boleto per hero, never past the rain's total (a rescued hero joins with what is left). */
  function rain(ctx:SimContext,active:ActiveHappening,team:readonly SimPlayer[]){
    for(const p of team){
      if(!((active.left??0)>1e-9))return;
      const value=Math.min(active.value??0,active.left!),at=around(ctx,p,RAIN_RADIUS);
      if(!at)continue;
      active.left=active.left!-value;
      drop(ctx,'xp',value,at,BOLETO_LIFETIME_SECONDS,BOLETO);
    }
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
        else if(active.kind==='boletos'&&(ctx.tick-active.startTick)%RAIN_EVERY===0)rain(ctx,active,heroes(ctx));
      }
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
