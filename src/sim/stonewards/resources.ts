/**
 * Gather nodes (base-stonewards-mapa): every obstacle of the map is a node, coco on palms and trees, pedra on rocks.
 * - Island: its 16 obstacles (ids `no-<kind>-<i>`, as in 046A).
 * - Endless world: the obstacles of each chunk, a pure function of (seed, cx, cy) (chunks.ts), with ids
 *   `no-<cx>_<cy>-<i>`: deterministic per seed and chunk, and free until somebody stands next to one.
 * A node's value (units per unit of work) grows with its distance from the base (rules.ts nodeValue). Only nodes
 * somebody worked this round live in the state; refilling at each intermission is clearing that list.
 */
import {obstacles as ISLAND_OBSTACLES,worldBase,type Obstacle,type Point} from '../../maps/index.ts';
import {CHUNK_SIZE,MAX_OBSTACLE_RADIUS} from '../../maps/index.ts';
import type {TerrainField} from '../../maps/index.ts';
import type {SimContext} from '../context.ts';
import {ticks} from '../../contract/index.ts';
import {isStanding} from '../revive.ts';
import {nodeValue} from '../../rules/index.ts';
import {bump,type ResourceKind,type ResourceNode,type StonewardsState} from './state.ts';

export {DEPLETED_LINES,NODE_NAMES,nodeValue} from '../../rules/index.ts';

/** Units of work per node per round. Rocks are slower but give more. */
export const NODE_CAPACITY:Readonly<Record<ResourceKind,number>>=Object.freeze({coco:4,pedra:6});
/** Gatherer-ticks for one unit. Two gatherers on one node finish twice as fast, never twice the units. */
export const WORK_PER_UNIT:Readonly<Record<ResourceKind,number>>=Object.freeze({coco:ticks(.8),pedra:ticks(1.2)});
/** Reach beyond the obstacle's own radius. */
export const GATHER_REACH=.9;
/** Farthest a node's centre can be from a gatherer (largest obstacle plus the reach). */
export const MAX_GATHER_DISTANCE=MAX_OBSTACLE_RADIUS+GATHER_REACH;
/** Endless world guard: chunk coordinates outside this never hold nodes (chunks.ts WORLD_LIMIT). */
const CHUNK_LIMIT=Math.floor(1_000_000/CHUNK_SIZE);

/** What a node is, without its round state. */
export interface NodeInfo extends Point {id:string;kind:ResourceKind;radius:number;value:number;capacity:number}

export function nodeKind(o:Pick<Obstacle,'kind'>):ResourceKind{return o.kind==='rock'?'pedra':'coco';}

function info(id:string,o:Obstacle|{x:number;y:number;radius:number;kind:Obstacle['kind']},base:Point):NodeInfo{
  const kind=nodeKind(o);
  return {id,kind,x:o.x,y:o.y,radius:o.radius,value:nodeValue(Math.hypot(o.x-base.x,o.y-base.y)),capacity:NODE_CAPACITY[kind]};
}

/**
 * Nodes whose centre is within `reach` of `p`, in a fixed order (island order; endless: chunk rows, then chunk
 * columns, then generation order). `source` replaces the island's obstacles (tests).
 */
export function nodesNear(terrain:TerrainField|undefined,p:Point,reach:number,source?:readonly Obstacle[]):NodeInfo[]{
  const out:NodeInfo[]=[];
  if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||!(reach>=0))return out;
  const base=worldBase(terrain),r2=reach*reach,chunks=terrain?.chunks;
  if(!chunks||source){
    const list=source??ISLAND_OBSTACLES;
    list.forEach((o,i)=>{const dx=o.x-p.x,dy=o.y-p.y;if(dx*dx+dy*dy<=r2)out.push(info(`no-${nodeKind(o)}-${i}`,o,base));});
    return out;
  }
  // The camp's own piles first (review onda 6): the endless clearing has no tree or rock for BASE_CLEAR units, so
  // without them nothing to gather is in sight from the camp.
  for(const n of campNodes(terrain!)){const dx=n.x-p.x,dy=n.y-p.y;if(dx*dx+dy*dy<=r2)out.push(n);}
  const cx0=Math.max(-CHUNK_LIMIT,Math.floor((p.x-reach)/CHUNK_SIZE)),cx1=Math.min(CHUNK_LIMIT,Math.floor((p.x+reach)/CHUNK_SIZE));
  const cy0=Math.max(-CHUNK_LIMIT,Math.floor((p.y-reach)/CHUNK_SIZE)),cy1=Math.min(CHUNK_LIMIT,Math.floor((p.y+reach)/CHUNK_SIZE));
  for(let cy=cy0;cy<=cy1;cy++)for(let cx=cx0;cx<=cx1;cx++){
    chunks.chunk(cx,cy).obstacles.forEach((o,i)=>{const dx=o.x-p.x,dy=o.y-p.y;if(dx*dx+dy*dy<=r2)out.push(info(`no-${cx}_${cy}-${i}`,o,base));});
  }
  return out;
}

/**
 * Id index of the touched nodes (review onda 6: no linear find per node per player per tick). A cache only: rebuilt
 * whenever the list is another array (checkpoint restore) or its length moved (refill, a push from elsewhere).
 */
const index=new WeakMap<ResourceNode[],{len:number;map:Map<string,ResourceNode>}>();
export function touchedNode(state:StonewardsState,id:string){
  const list=state.nodes;let c=index.get(list);
  if(!c||c.len!==list.length){c={len:list.length,map:new Map(list.map(n=>[n.id,n]))};index.set(list,c);}
  return c.map.get(id);
}
/**
 * Endless world: CAMP_PILES piles (coco and pedra alternating) on a ring CAMP_PILE_RING units from the base, a few
 * steps out of the camp, turned by the seed. The base clearing (chunks.ts BASE_CLEAR) keeps them on open ground.
 * Value 1: the quick run of the first intermission; the richer nodes are still out in the blocks.
 */
export const CAMP_PILES=6,CAMP_PILE_RING=8,CAMP_PILE_RADIUS=.35;
const pileCache=new WeakMap<TerrainField,NodeInfo[]>();
export function campNodes(terrain:TerrainField):NodeInfo[]{
  let list=pileCache.get(terrain);
  if(list)return list;
  const base=worldBase(terrain),turn=((terrain.seed>>>0)%360)*Math.PI/180;
  list=Array.from({length:CAMP_PILES},(_,i)=>{
    const a=turn+i*2*Math.PI/CAMP_PILES,kind:ResourceKind=i%2?'pedra':'coco';
    return {id:`no-base-${i}`,kind,x:Math.round((base.x+Math.cos(a)*CAMP_PILE_RING)*100)/100,y:Math.round((base.y+Math.sin(a)*CAMP_PILE_RING)*100)/100,
      radius:CAMP_PILE_RADIUS,value:1,capacity:NODE_CAPACITY[kind]};
  });
  pileCache.set(terrain,list);
  return list;
}

/** Units of work left on a node this round (full when nobody touched it). */
export function remainingOf(state:StonewardsState,node:NodeInfo){
  const touched=touchedNode(state,node.id);
  return touched?touched.remaining:node.capacity;
}
/** The node's round state, created on first touch. */
export function touch(state:StonewardsState,node:NodeInfo):ResourceNode{
  let n=touchedNode(state,node.id);
  if(!n){n={...node,remaining:node.capacity,work:0,workBy:{}};state.nodes.push(n);const c=index.get(state.nodes);if(c){c.map.set(n.id,n);c.len++;}}
  return n;
}

/** New round: every node is full again (nobody's work survives the wave). */
export function refillNodes(state:StonewardsState){state.nodes.length=0;}

/** A unit came out of a node: who gathered it, which node and whether that emptied it (for the depleted joke). */
export interface Gathered {player:string;node:ResourceNode;emptied:boolean}

/**
 * One tick of gathering. Only call during 'prepare'. Each standing player works the nearest non-empty node in reach;
 * each finished unit adds the node's value to the team balance, credited to the gatherers in proportion to their work.
 */
export function gatherStep(ctx:SimContext,state:StonewardsState,source?:readonly Obstacle[]):Gathered[]{
  const done:Gathered[]=[];
  const ids=[...ctx.players.keys()].sort();
  for(const id of ids){
    const p=ctx.players.get(id)!;
    if(!isStanding(p))continue;
    let best:NodeInfo|undefined,bestDist=Infinity;
    for(const n of nodesNear(ctx.terrain,p,MAX_GATHER_DISTANCE,source)){
      if(remainingOf(state,n)<=0)continue;
      const d=Math.hypot(p.x-n.x,p.y-n.y);
      if(d<=n.radius+GATHER_REACH&&d<bestDist){best=n;bestDist=d;}
    }
    if(!best)continue;
    const node=touch(state,best);
    node.work++;bump(node.workBy,id,1);
    if(node.work<WORK_PER_UNIT[node.kind])continue;
    for(const by of Object.keys(node.workBy).sort())bump(state.gathered,by,node.value*node.workBy[by]/node.work);
    node.work=0;node.workBy={};node.remaining--;
    state.balance[node.kind]+=node.value;
    done.push({player:id,node,emptied:node.remaining<=0});
  }
  return done;
}
