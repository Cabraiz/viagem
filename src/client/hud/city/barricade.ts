/**
 * City barricades in the HUD (card NEW-20261012-E5-cidade-barricadas-cliente): which plaza mouth a 'barricada'
 * structure closes, the forge target the room expects for it ('barricada-N|S|L|O', rules FORGE_TARGET) and the
 * barricade the hero stands at. A structure's wire id is a frame label (s<n>), not the server's 'barricada-N', so the
 * mouth comes from the decoded city: the nearest of its 4 `bocas` (the server raises each barricade on its boca).
 * Without the city asset there is no mouth, so no target: the HUD then never offers a barricade repair. Pure.
 */
import type {MouthId} from './map-info.ts';
import {MOUTH_IDS,type CityAssetLike} from './wiring.ts';

/** The structure kind of a city barricade on the wire (multiplayer/simulation.ts structureViews). */
export const BARRICADE_KIND='barricada';
/** The mouth's name in the player's words (the minimap's N/S/L/O compass). */
export const MOUTH_NAMES:Readonly<Record<MouthId,string>>=Object.freeze({N:'Norte',S:'Sul',L:'Leste',O:'Oeste'});

export type CityBocas=CityAssetLike['points']['bocas'];
interface P {readonly x:number;readonly y:number}
interface StructureLike extends P {readonly id:string;readonly kind:string;readonly hp:number;readonly maxHp:number}

/** The mouth a point belongs to: the nearest boca (ties keep N, S, L, O order); undefined without the asset. */
export function mouthOf(at:P,bocas:CityBocas|undefined):MouthId|undefined{
  if(!bocas)return undefined;
  let best:MouthId|undefined,bestD=Infinity;
  for(const id of MOUTH_IDS){const b=bocas[id],d=Math.hypot(b.x-at.x,b.y-at.y);if(d<bestD){bestD=d;best=id;}}
  return best;
}
/** The forge target of a mouth's barricade (sim/stonewards/barricades.ts barricadeId). */
export const barricadeTarget=(mouth:MouthId)=>`barricada-${mouth}`;

export interface BarricadeSpot<S extends StructureLike=StructureLike> {
  readonly structure:S;
  readonly mouth:MouthId;
  /** What the forge tap names as `target`. */
  readonly target:string;
  /** "Norte", "Sul", "Leste", "Oeste". */
  readonly name:string;
  /** Fallen (hp 0 on the wire): the repair raises it again. */
  readonly down:boolean;
}
/**
 * The barricade the hero can repair from where he stands: the nearest 'barricada' structure within `radius` (the
 * server's CAMP_RADIUS around THAT barricade, forge.ts), or undefined (no hero, no asset, none near).
 */
export function barricadeAt<S extends StructureLike>(hero:P|undefined,structures:readonly S[],bocas:CityBocas|undefined,radius:number):BarricadeSpot<S>|undefined{
  if(!hero||!bocas)return undefined;
  let best:S|undefined,bestD=Infinity;
  for(const s of structures){
    if(s.kind!==BARRICADE_KIND)continue;
    const d=Math.hypot(s.x-hero.x,s.y-hero.y);
    if(d<=radius&&d<bestD){bestD=d;best=s;}
  }
  const mouth=best&&mouthOf(best,bocas);
  if(!best||!mouth)return undefined;
  return {structure:best,mouth,target:barricadeTarget(mouth),name:MOUTH_NAMES[mouth],down:!(best.hp>0)};
}
