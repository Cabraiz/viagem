/**
 * Nest art (card NEW-20261016-ORQ-ninhos-arte-render, D-051), pure: which `ninho-<tema>-<estado>` piece (E8's
 * `cenario` group, 4 views, 3×3 cells) each nest of the snapshot shows. CityLive.setNests (layer.ts) draws them.
 *
 * - Theme: seeded by the nest id (the same in every client), among the 4 delivered themes.
 * - State: `destruido` at hp 0, `dormindo` while its sleepers sleep (phase 'dormindo'), `ativo` otherwise.
 * - Missing art (E8 rejected every `ninho-boteco-*` and `ninho-escritorio-destruido` on 16/10; a slow load): the same
 *   state of the next theme that has it, so a nest is never drawn in the wrong state and comes back by itself
 *   when the piece arrives.
 * - Snapshot: the nests come as structures of kind 'ninho' (the minimap reads the same ones): {id, x, y, hp, maxHp,
 *   size P|M|G, phase, seen}. `seen` is the minimap's fog; on the ground a nest on camera is simply drawn.
 */
import {hashId} from '../chunks.ts';

export const NEST_THEMES=['bichos','boteco','escritorio','festa'] as const;
export type NestTheme=typeof NEST_THEMES[number];
export type NestState='ativo'|'dormindo'|'destruido';
export type NestSize='P'|'M'|'G';
export const nestTheme=(nestId:string):NestTheme=>NEST_THEMES[hashId(nestId)%NEST_THEMES.length];
/** State of a nest: fallen at hp 0, asleep while its sleepers are (`awake` false), active otherwise. */
export const nestState=(n:{hp:number;awake?:boolean}):NestState=>n.hp<=0?'destruido':n.awake===false?'dormindo':'ativo';
export const nestPieceId=(theme:NestTheme,state:NestState)=>`ninho-${theme}-${state}`;
/**
 * Art id of a nest: its own theme in its state, or (when `has` says that piece is missing) the same state of the next
 * theme in NEST_THEMES order that has it; undefined when no theme has that state.
 */
export function nestArtId(n:{id:string;hp:number;awake?:boolean},has:(id:string)=>boolean=()=>true):string|undefined{
  const state=nestState(n),first=NEST_THEMES.indexOf(nestTheme(n.id));
  for(let i=0;i<NEST_THEMES.length;i++){
    const id=nestPieceId(NEST_THEMES[(first+i)%NEST_THEMES.length],state);
    if(has(id))return id;
  }
  return undefined;
}
/** Nest art drawn over its 3×3 cells; the size letter scales it (P 0.85, M 1, G 1.25) like the radius of D-051. */
export const NEST_SCALE:Readonly<Record<NestSize,number>>=Object.freeze({P:.85,M:1,G:1.25});

/** A nest as the scene hands it to the live layer. */
export interface LiveNest {id:string;x:number;y:number;size:NestSize;hp:number;awake?:boolean}
/** The fields of a snapshot structure a nest uses (contract StructureView plus the D-051 ones the minimap reads). */
export interface NestStructure {id:string;kind:string;x:number;y:number;hp:number;size?:string;phase?:string}
/** The snapshot's nests (structures of kind 'ninho'), in snapshot order; an unknown size draws as M. */
export function nestsFromStructures(list:readonly NestStructure[]):LiveNest[]{
  const out:LiveNest[]=[];
  for(const s of list){
    if(s.kind!=='ninho')continue;
    const size:NestSize=s.size==='P'||s.size==='G'?s.size:'M';
    out.push({id:s.id,x:s.x,y:s.y,size,hp:s.hp,awake:s.phase!=='dormindo'});
  }
  return out;
}
