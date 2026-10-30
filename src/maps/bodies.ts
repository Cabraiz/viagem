/**
 * Card NEW-20261025-ORQ-heroi-empurra-inimigos: a hero and an awake enemy are solid to each other. A hero walking into
 * a body pushes it: the overlap is split by mass, the light ones give way (the hero keeps most of the walk), an elite
 * gives little and a chefão almost nothing; the hero never ends a step inside a body. Pure geometry, shared by the
 * room's players system and the phone's replay (prediction.ts simulate), so both decide every step the same way: the
 * phone replays its pending steps against copies of the bodies its frame carries (EnemyView.radius), moving them too.
 *
 * - The hero always takes at least 1 - HERO_SHARE_MAX of the walk into any body, so a crowd (a ring of 8) never holds
 *   a hero in place: every step pushes through. Nor does a body ever carry the hero past its own step (bodyBlock's cut).
 * - A body only moves where the enemies may stand (the room: moveSafely on the enemy view; the phone: the whole push if
 *   the spot is walkable there, else none). What the body could not take, the hero takes (back out of it).
 * - Bodies on another floor (the viaduct's deck) and bodies without a radius (asleep, flying, or an older frame) are
 *   not solid.
 * - Card colisao-entre-herois: only the mendigo gives way (rules shovedEnemy); a `fixed` body (the saci, the sanfoneiro,
 *   the chefões) takes none of it: the hero stops at its edge, as at the Uno.
 */
import {defaultTerrain,type TerrainField} from './terrain/field.ts';
import {RADIUS,walkable} from './world.ts';
import {floorOf,floorOn,onFloor,setFloor} from './city/viaduct.ts';
import {enemyTerrain} from './city/terrain.ts';
import {carPushOut,type Point} from '../contract/index.ts';

/** A solid enemy body as the room and the phone see it (EnemyState, EnemyView with its radius). */
export interface Body extends Point {radius?:number;elite?:boolean;boss?:boolean;andar?:1;
  /** Card colisao-entre-herois: a body the hero's walk never pushes (rules shovedEnemy false): the hero takes it all. */
  fixed?:boolean}
/** A position with its floor (prediction.ts FloorPoint). */
type FloorPoint=Point&{andar?:1};

/**
 * Masses (a hero is 1): a common body of BODY_REF_RADIUS is BODY_MASS.common, bigger or smaller ones by their area
 * (clamped to BODY_AREA_MIN..MAX), an elite BODY_MASS.elite and the boss BODY_MASS.boss, by the same area.
 * Bench (CI, chaveiro/manual/ninhos, 16 seeds; main 8072e25 1p 1/16, 3p 5/16, 6p 8/16): common .35 / elite 1.6 gave
 * 1/4/5 (the team caught in the crowd), .15 / .8 gave 0/6/5, these .08 / .4 give 1/6/7: a common barely slows the
 * hero (still never walked through), an elite about halves the walk, the chefão holds it.
 */
export const BODY_MASS=Object.freeze({common:.08,elite:.4,boss:9});
/** A common enemy's radius (the bêbado's .32 × ENEMY_RADIUS_SCALE 1.15). */
export const BODY_REF_RADIUS=.37;
export const BODY_AREA_MIN=.5,BODY_AREA_MAX=3;
/** The most of an overlap a hero ever takes: a chefão still gives way a little, so a hero is never held for good. */
export const HERO_SHARE_MAX=.92;
/** Query reach past the hero's radius: the largest body (the wave's chefão, ~2.6 u) plus a tick's moves. */
export const BODY_REACH=3.5;

export const solid=(b:Body)=>(b.radius??0)>0;

/** The body's mass against a hero of mass 1. */
export function bodyMass(b:Body):number{
  const area=Math.min(BODY_AREA_MAX,Math.max(BODY_AREA_MIN,((b.radius??BODY_REF_RADIUS)/BODY_REF_RADIUS)**2));
  return (b.boss?BODY_MASS.boss:b.elite?BODY_MASS.elite:BODY_MASS.common)*area;
}
/** The part of an overlap the hero takes (backs out), the rest the body takes (is pushed). */
export function heroShare(b:Body):number{
  if(b.fixed)return 1;
  const m=bodyMass(b);
  return Math.min(HERO_SHARE_MAX,m/(1+m));
}

/** Moves a body by (dx, dy) as far as it may go (the room: moveSafely on the enemy view). */
export type Shove=(body:Body,dx:number,dy:number)=>void;
/** The phone's shove: the whole push when the spot is walkable on the enemies' view of its floor, else none. */
export function shoveWhereWalkable(terrain:TerrainField=defaultTerrain):Shove{
  const view=enemyTerrain(terrain);
  return (b,dx,dy)=>{
    const q={x:b.x+dx,y:b.y+dy};
    if(!b.fixed&&walkable(q,onFloor(view,floorOf(b)))){b.x=q.x;b.y=q.y;}
  };
}

/**
 * A hero who walked from `from` to `to` against `bodies`: every solid body on the hero's floor that `to` overlaps is
 * pushed off by its part of the overlap (`share`, default heroShare) and the hero backs out by the rest, along the
 * line between the centres (coincident centres: back along the step, else +x). A spot the hero cannot stand on keeps
 * the hero at `to`. The bodies are moved in place (`shove`), in the order given.
 */
export function bodyBlock(from:FloorPoint,to:FloorPoint,bodies:readonly Body[],terrain:TerrainField,shove:Shove,
  share:(b:Body)=>number=heroShare):FloorPoint{
  let at=to;
  // Backing out of one body can put the hero into another (wedged between two): a few passes settle it.
  for(let pass=0;pass<BLOCK_PASSES;pass++){
    const before=at;
    at=blockPass(from,at,bodies,terrain,shove,share);
    if(at===before)break;
  }
  // Never farther than the step itself (a body met sideways backs the hero out across the walk): one tick moves a hero
  // at most one step (the room's input rule, protocol/input-track.ts), so the cut keeps the line from `from` to there.
  const walk=Math.hypot(to.x-from.x,to.y-from.y),moved=Math.hypot(at.x-from.x,at.y-from.y);
  if(at!==to&&moved>walk){
    const k=walk/moved,q={x:from.x+(at.x-from.x)*k,y:from.y+(at.y-from.y)*k},floor=floorOf(to);
    at=walkable(q,onFloor(terrain,floor))?(floorOn(terrain,q.x,q.y,floor)===1?{x:q.x,y:q.y,andar:1}:{x:q.x,y:q.y}):from;
    // The cut may leave the hero a little inside a body: the bodies take that part (where they can go; a body that
    // takes none of the walk, none of this: the next step backs out).
    for(const b of bodies){
      if(!solid(b)||floorOf(b)!==floorOf(at)||share(b)>=1)continue;
      const dx=at.x-b.x,dy=at.y-b.y,d=Math.hypot(dx,dy),overlap=RADIUS+b.radius!-d;
      if(overlap>1e-9&&d>1e-6)shove(b,-dx/d*overlap,-dy/d*overlap);
    }
  }
  return at;
}
/** Passes of bodyBlock at most (the room and the phone take the same). */
export const BLOCK_PASSES=3;
function blockPass(from:FloorPoint,to:FloorPoint,bodies:readonly Body[],terrain:TerrainField,shove:Shove,share:(b:Body)=>number):FloorPoint{
  let at=to;
  const floor=floorOf(to);
  for(const b of bodies){
    if(!solid(b)||floorOf(b)!==floor)continue;
    const dx=at.x-b.x,dy=at.y-b.y,d=Math.hypot(dx,dy),overlap=RADIUS+b.radius!-d;
    if(!(overlap>1e-9))continue;
    let nx:number,ny:number;
    if(d>1e-6){nx=dx/d;ny=dy/d;}
    else{
      const bx=from.x-to.x,by=from.y-to.y,l=Math.hypot(bx,by);
      if(l>1e-6){nx=bx/l;ny=by/l;}else{nx=1;ny=0;}
    }
    const want=overlap*(1-share(b));
    if(want>1e-9){
      const x0=b.x,y0=b.y;
      shove(b,-nx*want,-ny*want);
      // What the body really took along the line (walls stop it; it never counts past the push).
      const took=Math.min(want,Math.max(0,-((b.x-x0)*nx+(b.y-y0)*ny)));
      const rest=overlap-took;
      if(!(rest>1e-9))continue;
      at=backOut(at,nx,ny,rest,terrain,floor);
    }else at=backOut(at,nx,ny,overlap,terrain,floor);
  }
  return at;
}
function backOut(at:FloorPoint,nx:number,ny:number,by:number,terrain:TerrainField,floor:0|1):FloorPoint{
  const q={x:at.x+nx*by,y:at.y+ny*by};
  if(!walkable(q,onFloor(terrain,floor)))return at;
  return floorOn(terrain,q.x,q.y,floor)===1?{x:q.x,y:q.y,andar:1}:{x:q.x,y:q.y};
}

/**
 * Card NEW-20261030-ORQ-colisao-entre-herois (user, 30/10: "Consegue criar colisão entre as pessoas?"): the heroes on
 * their feet (people and the room's bots) are soft to each other, by the same functions in the room's players system
 * and the phone's replay (prediction.ts simulate, the others' copies from the frame):
 * - heroBlock, on every step: a step never ends deeper inside another hero than it started, or than HERO_SOFT if that
 *   is more: walking into a teammate leans on them (the pass below pushes them along, slowly), never through, and two
 *   heroes walking into each other stand at the edge. It backs the step out along the centres' line (a step met
 *   sideways slides around), never farther than the step itself; a spot the hero cannot stand on keeps `from`.
 * - heroesApart, once per tick after every step: two heroes that overlap are pushed apart HERO_APART_SHARE of it, at
 *   most HERO_APART_MAX per tick, half each, all from the places they stood (a crowd, 6 on the spawn, comes loose in a
 *   few ticks without jitter: the part is under 1). Each one only moves to a spot it can stand on on its own floor and
 *   off the Uno's body (carPushOut); what one cannot take is not passed to the other, so nobody is pushed into a wall,
 *   the car or a closed mouth.
 * The steps lean on where the others stood when the tick began (the room's order does not matter, and the phone's
 * copies are the frame's places); two walking into each other each lean up to HERO_SOFT and the pass halves it.
 * Heroes on another floor (the viaduct's deck) do not touch. Who is solid is the callers' rule (sim/bodies.ts
 * standingHero, the phone's nearHeroes): the downed are not, so the rescuer walks up to them.
 */
/** Another hero as a body: the room's SimPlayer, the phone's copy of the frame's player (vx, vy: its walk per tick there). */
export interface HeroBody extends Point {andar?:1;vx?:number;vy?:number}
/** Centre to centre of two heroes touching. */
export const HERO_GAP=2*RADIUS;
/** How deep a step may lean into another hero (u, of HERO_GAP .44). */
export const HERO_SOFT=.06;
/** The part of an overlap the pass takes per tick, and the most it moves the pair per tick (u, both together). */
export const HERO_APART_SHARE=.5,HERO_APART_MAX=.08;
/** Passes of heroBlock at most (wedged between two heroes). */
export const HERO_PASSES=3;

const overlapAt=(p:Point,h:Point)=>HERO_GAP-Math.hypot(p.x-h.x,p.y-h.y);

/** The step from `from` to `to` against the other heroes where they stood (see the header). `others` are never moved. */
export function heroBlock(from:FloorPoint,to:FloorPoint,others:readonly HeroBody[],terrain:TerrainField):FloorPoint{
  if(!others.length)return to;
  const floor=floorOf(to),ground=onFloor(terrain,floor);
  let at=to;
  for(let pass=0;pass<HERO_PASSES;pass++){
    let moved=false;
    for(const h of others){
      if(floorOf(h)!==floor)continue;
      const dx=at.x-h.x,dy=at.y-h.y,d=Math.hypot(dx,dy),over=HERO_GAP-d;
      if(!(over>1e-9))continue;
      const allowed=Math.max(HERO_SOFT,overlapAt(from,h)),by=over-allowed;
      if(!(by>1e-9))continue;
      let nx:number,ny:number;
      if(d>1e-6){nx=dx/d;ny=dy/d;}
      else{
        const bx=from.x-to.x,by2=from.y-to.y,l=Math.hypot(bx,by2);
        if(l>1e-6){nx=bx/l;ny=by2/l;}else{nx=1;ny=0;}
      }
      const q={x:at.x+nx*by,y:at.y+ny*by};
      if(!walkable(q,ground))return onto(from);
      at=floorOn(terrain,q.x,q.y,floor)===1?{x:q.x,y:q.y,andar:1}:{x:q.x,y:q.y};
      moved=true;
    }
    if(!moved)break;
  }
  if(at===to)return to;
  // Never farther than the step itself (one tick moves a hero at most one step, protocol/input-track.ts).
  const walk=Math.hypot(to.x-from.x,to.y-from.y),moved=Math.hypot(at.x-from.x,at.y-from.y);
  if(moved>walk){
    const k=walk/moved,q={x:from.x+(at.x-from.x)*k,y:from.y+(at.y-from.y)*k};
    if(!walkable(q,ground))return onto(from);
    at=floorOn(terrain,q.x,q.y,floor)===1?{x:q.x,y:q.y,andar:1}:{x:q.x,y:q.y};
  }
  // Still deeper than allowed (wedged, or the cut): the step is not taken.
  for(const h of others)if(floorOf(h)===floorOf(at)&&overlapAt(at,h)>Math.max(HERO_SOFT,overlapAt(from,h))+1e-9)return onto(from);
  return at;
}
const onto=(p:FloorPoint):FloorPoint=>p.andar===1?{x:p.x,y:p.y,andar:1}:{x:p.x,y:p.y};

/** Where a hero pushed may stand: walkable on its floor and off the car's body (the car is on the ground). */
export type HeroSpot=(x:number,y:number,floor:0|1)=>boolean;
export function heroSpot(terrain:TerrainField,car?:{x:number;y:number;heading?:number}):HeroSpot{
  return (x,y,floor)=>{
    const q={x,y};
    if(!walkable(q,onFloor(terrain,floor)))return false;
    return floor===1||!car||carPushOut(car,q,RADIUS)===q;
  };
}

/**
 * The pass (see the header), in place over `heroes`: every overlapping pair on one floor gives each of the two half of
 * its push, all from where they stood (the order does not matter), each hero's sum at most HERO_APART_MAX; a hero whose
 * spot is refused stays. `moved` hears the index of each one that moved. Coincident centres split along an angle fixed
 * by the pair's places in the list. With `stood` (where each stood when the tick began, same order), a pair that both
 * walked deeper than HERO_SOFT (or than they began) is first pushed back to that depth in full, so two heroes walking
 * into each other end the tick at the edge as one walking into a standing one does.
 */
export function heroesApart(heroes:readonly HeroBody[],terrain:TerrainField,spot:HeroSpot,moved?:(index:number)=>void,stood?:readonly Point[]){
  const n=heroes.length;
  if(n<2)return;
  pushX.length=n;pushY.length=n;hardOf.length=n;pushX.fill(0);pushY.fill(0);hardOf.fill(0);
  let any=false;
  for(let i=0;i<n;i++){
    const a=heroes[i]!,floor=floorOf(a);
    for(let j=i+1;j<n;j++){
      const b=heroes[j]!;
      if(Math.abs(a.x-b.x)>=HERO_GAP||Math.abs(a.y-b.y)>=HERO_GAP||floorOf(b)!==floor)continue;
      const dx=a.x-b.x,dy=a.y-b.y,d=Math.hypot(dx,dy),over=HERO_GAP-d;
      if(!(over>1e-9))continue;
      const sa=stood?.[i],sb=stood?.[j],hard=sa&&sb?Math.max(0,over-Math.max(HERO_SOFT,overlapAt(sa,sb))):0;
      const half=(hard+Math.min((over-hard)*HERO_APART_SHARE,HERO_APART_MAX))/2,turn=(i*7+j*3)*2.399963;
      hardOf[i]+=hard/2;hardOf[j]+=hard/2;
      const nx=d>1e-6?dx/d:Math.cos(turn),ny=d>1e-6?dy/d:Math.sin(turn);
      pushX[i]+=nx*half;pushY[i]+=ny*half;pushX[j]-=nx*half;pushY[j]-=ny*half;any=true;
    }
  }
  if(!any)return;
  for(let i=0;i<n;i++){
    let dx=pushX[i]!,dy=pushY[i]!;
    const l=Math.hypot(dx,dy);
    if(!(l>1e-12))continue;
    const cap=HERO_APART_MAX+hardOf[i]!;
    if(l>cap){dx*=cap/l;dy*=cap/l;}
    const h=heroes[i]!,floor=floorOf(h),x=h.x+dx,y=h.y+dy;
    if(!spot(x,y,floor))continue;
    h.x=x;h.y=y;setFloor(h,floorOn(terrain,x,y,floor));
    moved?.(i);
  }
}
const pushX:number[]=[],pushY:number[]=[],hardOf:number[]=[];
