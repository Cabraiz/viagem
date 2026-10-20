/**
 * D-051 mode 'ninhos' without rounds (NEW-20261014-ORQ-ninhos-rounds-fora): the living map never has an intermission, so
 * on the client what waited for one (the camera turn, the follow camera's freedom, the obra menu, the forge) waits for
 * calm: no critter awake within CALMA.forgeR of this hero, the room's own rule (src/rules/calma.ts). Pure.
 * The other modes keep the room's round phase as it is.
 */
import {CALMA,calmAround,type CalmEnemy} from '../rules/index.ts';

interface PhaseView {round?:{phase:string};structures:readonly {kind:string}[];enemies:readonly CalmEnemy[]}
/** The run is in mode 'ninhos': the room sends its nests (a fallen one stays). */
export const nestsRun=(view:Pick<PhaseView,'structures'>)=>view.structures.some(s=>s.kind==='ninho');
/**
 * The round phase the client acts on: in the nests mode 'prepare' while this hero is calm, else 'wave'; elsewhere the
 * room's (undefined without a round). Without the hero's spot the nests mode is 'wave' (nothing opens blind).
 */
export function effectivePhase(view:PhaseView,hero:{x:number;y:number}|undefined):string|undefined{
  if(!nestsRun(view))return view.round?.phase;
  return hero&&calmAround(view.enemies,hero,CALMA.forgeR)?'prepare':'wave';
}
