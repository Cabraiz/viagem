/**
 * NEW-20261031-ORQ-construir-andando-ate-a-obra (the user: "Tocar em Construir manda o herói até a obra… Só ao chegar a
 * ordem é dada e a obra começa"): the kit's release (model.ts KitPlace) no longer sends from afar. The room takes a
 * piece only BUILD_REACH from the hero (rules KIT_PLACE_REACH), and the hero only plays build16 standing by an obra.
 * - In reach already: the order goes at once ('now').
 * - Else the order is frozen (cell, rot, its green ghost) and the hero walks (scene.goTo) to the footprint's nearest
 *   side, STAND_GAP off its edge; the ghost stays drawn there while it walks (the mouse hovering does not move it).
 * - The route ending by that side: arrived, the frozen order goes (tick → the order). The route ending anywhere else
 *   (the stick or the keys drop it, scene.ts) or the kit mode ending: cancelled, nothing sent, nothing paid.
 * - A new release replaces the order; no route at all (goTo found none): 'blocked', nothing sent.
 */
import type {BuildRot} from '../../../contract/index.ts';
import {RADIUS,walkable,type TerrainField} from '../../../maps/index.ts';
import {KIT_PLACE_REACH as KIT_REACH} from '../../../rules/index.ts';
import {distToRect,type CellRect} from '../../render/fortify-rules.ts';
import type {GhostInput} from '../../render/fortify.ts';

type Point={x:number;y:number};
/** Where the hero stops: this far (u) off the footprint's edge, on its nearest side (well inside KIT_REACH). */
export const STAND_GAP=RADIUS+.3;
/** The route ended this close (u) to the stand: arrived. */
export const ARRIVE_SLACK=.5;
/** The order goes at once when the hero is this much inside the reach (the room checks the same edge distance). */
export const REACH_SLACK=.25;
export const WALK_WORDS=Object.freeze({blocked:'Não dá pra chegar lá',cancelled:'Ida cancelada: nada foi construído'});

export interface BuildOrder {cell:{c:number;r:number};rot:BuildRot;rect:CellRect;ghost:GhostInput}
export interface WalkScene {goTo(target:Point):void;readonly walking:boolean}
/** The stands a hero can take on this map's ground (standPoint's `ok`); undefined: any. */
export const standGround=(terrain:TerrainField|undefined)=>terrain?(p:Point)=>walkable(p,terrain):undefined;

/**
 * The stand by `rect` for a hero at `hero`: the nearest point of the footprint grown by STAND_GAP, else the middle of a
 * side or a corner, nearest first; `ok` (the city's ground) skips the ones nobody can stand on. Undefined: none.
 */
export function standPoint(rect:CellRect,hero:Point,ok:(p:Point)=>boolean=()=>true):Point|undefined{
  const g=STAND_GAP,x0=rect.x0-g,y0=rect.y0-g,x1=rect.x1+g,y1=rect.y1+g;
  let nx=Math.min(x1,Math.max(x0,hero.x)),ny=Math.min(y1,Math.max(y0,hero.y));
  // Inside the grown box: out through the nearest side.
  if(nx>x0&&nx<x1&&ny>y0&&ny<y1){
    const d=[nx-x0,x1-nx,ny-y0,y1-ny],m=Math.min(...d);
    if(m===d[0])nx=x0;else if(m===d[1])nx=x1;else if(m===d[2])ny=y0;else ny=y1;
  }
  const cands=[{x:nx,y:ny},{x:x0,y:rect.cy},{x:x1,y:rect.cy},{x:rect.cx,y:y0},{x:rect.cx,y:y1},{x:x0,y:y0},{x:x1,y:y0},{x:x0,y:y1},{x:x1,y:y1}];
  const dist=(p:Point)=>Math.hypot(p.x-hero.x,p.y-hero.y);
  return [cands[0],...cands.slice(1).sort((a,b)=>dist(a)-dist(b))].find(p=>ok(p));
}

export class BuildWalk {
  /** The order the hero is walking to, undefined when none. */
  order:BuildOrder|undefined;
  private stand:Point|undefined;
  get pending(){return !!this.order;}
  /** A release with a green ghost: 'now' (send it), 'walk' (the hero goes, tick sends it) or 'blocked' (no way there). */
  begin(order:BuildOrder,hero:Point,scene:WalkScene,ok?:(p:Point)=>boolean):'now'|'walk'|'blocked'{
    this.cancel();
    if(distToRect(hero.x,hero.y,order.rect)<=KIT_REACH-REACH_SLACK)return 'now';
    const stand=standPoint(order.rect,hero,ok);
    if(!stand)return 'blocked';
    scene.goTo(stand);
    if(!scene.walking)return 'blocked';
    this.order=order;this.stand=stand;
    return 'walk';
  }
  /**
   * Every frame of the kit mode: the order when the hero got there, 'cancelled' when the walk was dropped (the host
   * calls cancel() when the mode ends: nothing is sent either).
   */
  tick(hero:Point,scene:WalkScene):BuildOrder|'cancelled'|undefined{
    const order=this.order,stand=this.stand;
    if(!order||!stand||scene.walking)return undefined;
    this.cancel();
    const there=Math.hypot(hero.x-stand.x,hero.y-stand.y)<=ARRIVE_SLACK&&distToRect(hero.x,hero.y,order.rect)<=KIT_REACH-REACH_SLACK;
    return there?order:'cancelled';
  }
  cancel(){this.order=undefined;this.stand=undefined;}
}
