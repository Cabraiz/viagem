/**
 * Card NEW-20261025-ORQ-heroi-empurra-inimigos: a hero and an awake enemy are solid to each other. A hero walking into
 * a body pushes it: the overlap is split by mass, the light ones give way (the hero keeps most of the walk), an elite
 * gives little and a chefão almost nothing; the hero never ends a step inside a body. Pure geometry, shared by the
 * room's players system and the phone's replay (prediction.ts simulate), so both decide every step the same way: the
 * phone replays its pending steps against copies of the bodies its frame carries (EnemyView.radius), moving them too.
 *
 * - The hero always takes at least 1 - HERO_SHARE_MAX of the walk into any body, so a crowd (a ring of 8) never holds
 *   a hero in place: every step pushes through.
 * - A body only moves where the enemies may stand (the room: moveSafely on the enemy view; the phone: the whole push if
 *   the spot is walkable there, else none). What the body could not take, the hero takes (back out of it).
 * - Bodies on another floor (the viaduct's deck) and bodies without a radius (asleep, flying, or an older frame) are
 *   not solid.
 */
import {defaultTerrain,type TerrainField} from './terrain/field.ts';
import {RADIUS,walkable} from './world.ts';
import {floorOf,floorOn,onFloor} from './city/viaduct.ts';
import {enemyTerrain} from './city/terrain.ts';
import type {Point} from '../contract/index.ts';

/** A solid enemy body as the room and the phone see it (EnemyState, EnemyView with its radius). */
export interface Body extends Point {radius?:number;elite?:boolean;boss?:boolean;andar?:1}
/** A position with its floor (prediction.ts FloorPoint). */
type FloorPoint=Point&{andar?:1};

/**
 * Masses (a hero is 1): a common body of BODY_REF_RADIUS is BODY_MASS.common, bigger or smaller ones by their area
 * (clamped to BODY_AREA_MIN..MAX), an elite BODY_MASS.elite and the boss BODY_MASS.boss, by the same area.
 */
export const BODY_MASS=Object.freeze({common:.35,elite:1.6,boss:9});
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
    if(walkable(q,onFloor(view,floorOf(b)))){b.x=q.x;b.y=q.y;}
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
