/**
 * Sanfoneiro Arrasta-Pé (card NEW-20261029-ORQ-sanfoneiro-regra-arrastar): the São João accordion player, a brutamontes
 * kept out of the wave draw (rules/enemy-roster.ts HELD_ROSTER) until his art and the user's go land. enemy-ai hands
 * him stepSanfoneiro instead of the brute's stomp; every number is in SANFONA and FOLE below.
 * - Tocar (arrastar): SANFONA.warn standing still ('sanfona' aviso), then SANFONA.play playing ('toca'): every live
 *   hero on his floor within SANFONA.radius is dragged toward him at SANFONA.pullFactor × the hero speed, slower than
 *   a hero, who escapes by running against it. The drag is moveSafely (walls and floors hold, no teleport) and stops
 *   SANFONA.gap short of his body. SANFONA.cooldown between plays. Frozen (scared), knocked silly or fleeing, the
 *   sanfona stops (hushSanfoneiro, 'para').
 * - Pancada do fole: a warned circle (FOLE, telegraph kind 'pancada') for moderate damage; when it lands it shoves the
 *   heroes inside FOLE.shove away from him, so nobody sticks to him after a play. He has no plain contact hit.
 */
import {RADIUS as PLAYER_RADIUS,floorOf,onFloor,settleFloor} from '../../maps/index.ts';
import {SIM_HZ,TILE_X,ticks,type EnemyState,type SimPlayer} from '../../contract/index.ts';
import type {SimContext} from '../context.ts';
import {SLAM_STATE,coachMult} from './catalog.ts';
import {addTelegraph,cancelTelegraphs} from '../telegraphs.ts';
import {moveSafely} from './ai.ts';

export const SANFONEIRO_ID='sanfoneiro';
/** The play. radius: 220 world px (one unit along the screen's x axis is TILE_X·√2 px), ≈ 3.7 u. */
export const SANFONA=Object.freeze({
  radius:220/(TILE_X*Math.SQRT2),
  /** He starts the warning with a hero this close (inside the drag). */
  trigger:.85*220/(TILE_X*Math.SQRT2),
  /** Drag speed as a fraction of the hero speed (< 1: running against it escapes). */
  pullFactor:.55,
  /** The drag stops this far from his body (hero edge to his edge), short of contact. */
  gap:.35,
  warn:ticks(1),play:ticks(2),cooldown:ticks(7),
});
/** The bellows hit: warned circle (radius + his body), moderate damage, then a short shove away from him. */
export const FOLE=Object.freeze({trigger:1.5,radius:1,damage:9,delay:ticks(1),recover:ticks(.4),cooldown:ticks(2.5),shove:1});
/** memory.state while warning / playing (enemy-ai STATE goes up to 8; the fole reuses its slam, 8). */
export const SANFONA_STATE=Object.freeze({warn:9,play:10});
/** What enemy-ai does with his body this tick: walk to the target, stand, or stand and bark (an action started). */
export type SanfonaMove='walk'|'stand'|'start';

const live=(p:SimPlayer)=>p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0;
/** Heroes already announced as dragged in the current play ('arrastado' once per hero per play). */
const dragged=new WeakMap<EnemyState,Set<string>>();

export const isSanfoneiro=(e:Pick<EnemyState,'kind'>)=>e.kind===SANFONEIRO_ID;
/** True while warning or playing (enemy-ai marks him acting then). */
export const isPlaying=(state:number|undefined)=>state===SANFONA_STATE.warn||state===SANFONA_STATE.play;

/**
 * One tick of his act. `player` is his target (undefined: none) at `best` u; `heroSpeed` the world's base hero speed;
 * `room` whether a telegraph fits now. memory.actReady gates the play, memory.foleReady the fole.
 */
export function stepSanfoneiro(ctx:SimContext,e:EnemyState,memory:Record<string,number>,player:SimPlayer|undefined,best:number,
  heroSpeed:number,room:boolean):SanfonaMove{
  const t=ctx.tick;
  switch(memory.state){
    case SANFONA_STATE.warn:
      if(t<memory.until)return 'stand';
      memory.state=SANFONA_STATE.play;memory.until=t+SANFONA.play;dragged.set(e,new Set());
      ctx.emit({type:'sanfona',enemy:e.id,what:'toca'});
      drag(ctx,e,heroSpeed);
      return 'stand';
    case SANFONA_STATE.play:
      if(t>=memory.until){stopPlay(ctx,e,memory);return 'stand';}
      drag(ctx,e,heroSpeed);
      return 'stand';
    case SLAM_STATE:
      // The tick after it lands: the telegraph system (after enemy-ai) has dealt its damage by then.
      if(memory.foleLand!==undefined&&t>memory.foleLand){shove(ctx,e);delete memory.foleLand;}
      if(t>=memory.until){memory.state=0;memory.foleReady=t+FOLE.cooldown;}
      return 'stand';
  }
  if(!player)return 'walk';
  if(best<=FOLE.trigger&&t>=(memory.foleReady??0)&&room){
    const tg=addTelegraph(ctx,{shape:'circle',x:e.x,y:e.y,radius:FOLE.radius+e.radius,damage:FOLE.damage*coachMult(e,t),owner:e.id,kind:'pancada'},FOLE.delay);
    memory.state=SLAM_STATE;memory.foleLand=tg.fireTick;memory.until=tg.fireTick+FOLE.recover;
    return 'start';
  }
  if(best<=SANFONA.trigger&&t>=memory.actReady){
    memory.state=SANFONA_STATE.warn;memory.until=t+SANFONA.warn;
    ctx.emit({type:'sanfona',enemy:e.id,what:'aviso'});
    return 'start';
  }
  return 'walk';
}

/**
 * Frozen (scared), knocked silly or fleeing: a warning or a play stops ('para', the play's cooldown starts) and a
 * pending fole is called off (its cooldown starts). enemy-ai calls this every tick he is `silenced`.
 */
export function hushSanfoneiro(ctx:SimContext,e:EnemyState){
  const m=e.memory;if(!m)return;
  if(isPlaying(m.state)){
    m.state=0;m.actReady=ctx.tick+SANFONA.cooldown;dragged.delete(e);
    ctx.emit({type:'sanfona',enemy:e.id,what:'para'});
  }else if(m.state===SLAM_STATE){
    cancelTelegraphs(ctx,e.id);delete m.foleLand;
    m.state=0;m.foleReady=ctx.tick+FOLE.cooldown;
  }
}

function stopPlay(ctx:SimContext,e:EnemyState,memory:Record<string,number>){
  memory.state=0;memory.actReady=ctx.tick+SANFONA.cooldown;dragged.delete(e);
  ctx.emit({type:'sanfona',enemy:e.id,what:'para'});
}

/** Drags every live hero on his floor within SANFONA.radius one step toward him (never past the gap). */
function drag(ctx:SimContext,e:EnemyState,heroSpeed:number){
  const step=heroSpeed*SANFONA.pullFactor/SIM_HZ,stop=e.radius+PLAYER_RADIUS+SANFONA.gap,floor=floorOf(e);
  const seen=dragged.get(e);
  for(const p of ctx.players.values()){
    if(!live(p)||floorOf(p)!==floor)continue;
    const dx=e.x-p.x,dy=e.y-p.y,d=Math.hypot(dx,dy);
    if(d>SANFONA.radius||d<=stop)continue;
    const s=Math.min(step,d-stop);
    moveSafely(p,dx/d*s,dy/d*s,onFloor(ctx.terrain,p.andar));settleFloor(ctx.terrain,p);
    if(seen&&!seen.has(p.id)){seen.add(p.id);ctx.emit({type:'arrastado',enemy:e.id,player:p.id});}
  }
}

/** The fole lands: every live hero on his floor inside its circle is pushed FOLE.shove away from him. */
function shove(ctx:SimContext,e:EnemyState){
  const reach=FOLE.radius+e.radius+PLAYER_RADIUS,floor=floorOf(e);
  for(const p of ctx.players.values()){
    if(!live(p)||floorOf(p)!==floor)continue;
    const dx=p.x-e.x,dy=p.y-e.y,d=Math.hypot(dx,dy);
    if(d>reach)continue;
    const ux=d>1e-6?dx/d:1,uy=d>1e-6?dy/d:0;
    moveSafely(p,ux*FOLE.shove,uy*FOLE.shove,onFloor(ctx.terrain,p.andar));settleFloor(ctx.terrain,p);
  }
}
