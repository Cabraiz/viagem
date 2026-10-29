/**
 * Which edge arrows the game shows (card NEW-20261018-ORQ-setas-e-construir, user 18/10): only TWO pointers on screen,
 * the downed ally to lift ('caido') and the orange arrow at the top to the car (hud/city/objective.ts, not an edge
 * arrow). The others (nests' obra sites, banks, the chaveiro's moto, the boss, the groups, the mouths, the base) are
 * off; to bring one back, add its kind here. Card inimigos-querem-o-uno brings 'uno': the car taking hits off screen. The obra's site arrows read 'obra'.
 */
import type {EdgeKind,EdgeTarget} from './edges.ts';
import type {MissionArrow} from './missao.ts';

export const EDGE_KINDS_SHOWN:ReadonlySet<EdgeKind>=new Set<EdgeKind>(['caido','uno']);
/**
 * Keys shown whatever their kind: the Uno while the mission points at it (card inicio-no-uno-caixas-120, the user: a
 * mark on the screen's edge pointing at the Uno when it leaves the screen; hud/city/edges.ts `uno`).
 */
export const EDGE_KEYS_SHOWN:ReadonlySet<string>=new Set(['uno']);
/** The targets whose kind the game still points at (the others never reach the layout); `extra`: keys shown now too. */
export const shownTargets=<T extends Pick<EdgeTarget,'kind'|'key'>>(targets:readonly T[],extra?:ReadonlySet<string>):T[]=>
  targets.filter(t=>EDGE_KINDS_SHOWN.has(t.kind)||EDGE_KEYS_SHOWN.has(t.key)||!!extra?.has(t.key));
/** A nest's arrow key (the city ranks a 'boca:' key as a mouth: a nest is where a band comes from). */
export const nestKey=(id:string)=>`boca:ninho:${id}`;
/**
 * Card objetivo-com-verbo: the keys the mission line points at besides the Uno (hud/missao.ts MissionArrow): the moto
 * while it waits for the team, the nearest standing nest in the nests mode.
 */
export function missionKeys(aim:MissionArrow|undefined):ReadonlySet<string>|undefined{
  return aim?.kind==='moto'?new Set(['moto']):aim?.kind==='ninho'?new Set([nestKey(aim.id)]):undefined;
}
/** The nest's edge target (kind 'spawn', the band icon; Cone like the moto that needs the team). */
export function nestTarget(nest:{id:string;x:number;y:number},hero:{x:number;y:number},locate:(p:{x:number;y:number})=>{x:number;y:number}){
  return {key:nestKey(nest.id),kind:'spawn' as const,screen:locate(nest),world:{x:nest.x,y:nest.y},distance:Math.hypot(nest.x-hero.x,nest.y-hero.y),name:'Ninho',danger:true};
}

/**
 * The fortify "Construir" button and its wall counter (D-052) are off the HUD (same card): the user is thinking of a
 * new job for that button. The room still takes free builds; true brings the button (and its tray) back.
 */
export const FORT_BUILD_BUTTON=false;
/**
 * The forge window ("Forja · Sai da sua grana", camp.ts) and the obra menu with its site markers and arrows
 * (towers/obra.ts) are off the player's game too (user, 18/10: they are part of the "construir" that went): no window,
 * no marker, no "junta material" hint. The room still runs them; true brings each one back.
 */
export const HUD_SWITCH:{forge:boolean;obra:boolean}={forge:false,obra:false};
