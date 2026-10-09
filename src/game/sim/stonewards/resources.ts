/** Gather nodes from the island's obstacles and proximity gathering during the intermission. */
import type {Obstacle} from '../../world.ts';
import type {SimContext} from '../types.ts';
import {ticks} from '../types.ts';
import {isStanding} from '../revive.ts';
import {bump,type ResourceKind,type ResourceNode,type StonewardsState} from './state.ts';

/** Units per node per round. Rocks are slower but give more. */
export const NODE_CAPACITY:Readonly<Record<ResourceKind,number>>=Object.freeze({coco:4,pedra:6});
/** Gatherer-ticks for one unit. Two gatherers on one node finish twice as fast, never twice the units. */
export const WORK_PER_UNIT:Readonly<Record<ResourceKind,number>>=Object.freeze({coco:ticks(.8),pedra:ticks(1.2)});
/** Reach beyond the obstacle's own radius. */
export const GATHER_REACH=.9;

export const NODE_NAMES:Readonly<Record<ResourceKind,string>>=Object.freeze({coco:'Coco',pedra:'Pedra'});
/** pt-BR jokes the HUD may show when a node runs dry. */
export const DEPLETED_LINES:Readonly<Record<ResourceKind,readonly string[]>>=Object.freeze({
  coco:['Coqueiro pelado. Respeita o coqueiro.','Acabou o coco, só sobrou a água de memória.','Esse coqueiro entrou de férias.'],
  pedra:['Pedra zerada. Agora é só pedregulho emocional.','Minerou até a alma da rocha.','Essa pedra virou areia de tanto apanhar.'],
});

export function nodeKind(o:Obstacle):ResourceKind{return o.kind==='rock'?'pedra':'coco';}

/** Deterministic node list in obstacle order: coco on palms/trees, pedra on rocks. */
export function createNodes(source:readonly Obstacle[]):ResourceNode[]{
  return source.map((o,i)=>{
    const kind=nodeKind(o),capacity=NODE_CAPACITY[kind];
    return {id:`no-${kind}-${i}`,kind,x:o.x,y:o.y,radius:o.radius,remaining:capacity,capacity,work:0,workBy:{}};
  });
}

export function refillNodes(state:StonewardsState){
  for(const n of state.nodes){n.remaining=n.capacity;n.work=0;n.workBy={};}
}

/**
 * One tick of gathering. Only call during 'prepare'. Each standing player works the nearest
 * non-empty node in reach; units go to the team balance and are credited in proportion to the work
 * each gatherer put into them.
 */
export function gatherStep(ctx:SimContext,state:StonewardsState){
  const ids=[...ctx.players.keys()].sort();
  for(const id of ids){
    const p=ctx.players.get(id)!;
    if(!isStanding(p))continue;
    let best:ResourceNode|undefined,bestDist=Infinity;
    for(const n of state.nodes){
      if(n.remaining<=0)continue;
      const d=Math.hypot(p.x-n.x,p.y-n.y);
      if(d<=n.radius+GATHER_REACH&&d<bestDist){best=n;bestDist=d;}
    }
    if(!best)continue;
    best.work++;bump(best.workBy,id,1);
    if(best.work<WORK_PER_UNIT[best.kind])continue;
    for(const by of Object.keys(best.workBy).sort())bump(state.gathered,by,best.workBy[by]/best.work);
    best.work=0;best.workBy={};best.remaining--;
    state.balance[best.kind]++;
  }
}
