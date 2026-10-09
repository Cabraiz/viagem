/** The wall/shelter at the island center: placement, siege contact damage and repairs. */
import type {TerrainField} from '../../terrain/field.ts';
import {obstacles as worldObstacles,walkable,type Obstacle,type Point} from '../../world.ts';
import type {EnemyState,SimContext} from '../types.ts';
import {ticks} from '../types.ts';
import type {StonewardsState,WallState} from './state.ts';

export const WALL_MAX_HP=600;
export const WALL_RADIUS=.8;
export const ISLAND_CENTER:Readonly<Point>=Object.freeze({x:12,y:12});
/** Enemy memory flag (D-002) set by the director/AI for enemies that besiege the wall. */
export const SIEGE_FLAG='siege';
export const SIEGE_HIT_COOLDOWN=ticks(1);

export const WALL_DOWN_LINES=[
  'A muralha caiu. Foi feita de isopor, admitimos.',
  'Abrigo derrubado. O síndico vai cobrar a obra.',
  'Caiu a muralha e a dignidade junto.',
] as const;

/** Retreating enemies (D-010, memory.retreat===1) never hit the wall. */
export const isSiege=(e:EnemyState)=>e.memory?.[SIEGE_FLAG]===1&&e.memory.retreat!==1;

/** Nearest spot to the island center where the wall fits: walkable and clear of obstacles. Deterministic spiral. */
export function placeWall(terrain?:TerrainField,source:readonly Obstacle[]=worldObstacles):Point{
  const fits=(p:Point)=>walkable(p,terrain)&&source.every(o=>Math.hypot(p.x-o.x,p.y-o.y)>o.radius+WALL_RADIUS);
  for(let r=0;r<=6;r+=.25){
    const steps=r?Math.max(8,Math.round(r*16)):1;
    for(let i=0;i<steps;i++){
      const a=i/steps*Math.PI*2,p={x:ISLAND_CENTER.x+Math.cos(a)*r,y:ISLAND_CENTER.y+Math.sin(a)*r};
      if(fits(p))return {x:Math.round(p.x*100)/100,y:Math.round(p.y*100)/100};
    }
  }
  return {...ISLAND_CENTER};
}

export function createWall(at:Point,maxHp=WALL_MAX_HP):WallState{
  return {id:'muralha',x:at.x,y:at.y,hp:maxHp,maxHp,radius:WALL_RADIUS,hitReady:{}};
}

/** Returns true if this hit brought the wall down (only once). */
export function damageWall(ctx:SimContext,state:StonewardsState,amount:number):boolean{
  const w=state.wall;
  if(state.wallDown||!(amount>0))return false;
  w.hp=Math.max(0,w.hp-amount);
  ctx.emit({type:'structure',id:w.id,hp:w.hp,maxHp:w.maxHp});
  if(w.hp>0)return false;
  state.wallDown=true;
  return true;
}

/** Siege enemies touching the wall hit it on a per-enemy cooldown. Returns true if it fell this tick. */
export function siegeStep(ctx:SimContext,state:StonewardsState):boolean{
  const w=state.wall;
  if(state.wallDown)return false;
  const ids=[...ctx.enemies.keys()].sort();
  for(const id of Object.keys(w.hitReady))if(!ctx.enemies.has(id))delete w.hitReady[id];
  for(const id of ids){
    const e=ctx.enemies.get(id)!;
    if(e.hp<=0||!isSiege(e)||ctx.tick<e.readyTick)continue;
    if(e.frozenUntil!==undefined&&ctx.tick<e.frozenUntil)continue;
    // Negated so NaN positions or radii never count as touching.
    if(!(Math.hypot(e.x-w.x,e.y-w.y)<=w.radius+e.radius))continue;
    if(ctx.tick<(w.hitReady[id]??0))continue;
    w.hitReady[id]=ctx.tick+SIEGE_HIT_COOLDOWN;
    if(damageWall(ctx,state,e.damage))return true;
  }
  return false;
}
