/**
 * Which edge arrows the game shows (card NEW-20261018-ORQ-setas-e-construir, user 18/10): only TWO pointers on screen,
 * the downed ally to lift ('caido') and the orange arrow at the top to the car (hud/city/objective.ts, not an edge
 * arrow). The others (nests' obra sites, banks, the chaveiro's moto, the boss, the groups, the mouths, the base) are
 * off; to bring one back, add its kind here. Card inimigos-querem-o-uno brings 'uno': the car taking hits off screen. The obra's site arrows read 'obra'.
 */
import type {EdgeKind,EdgeTarget} from './edges.ts';

export const EDGE_KINDS_SHOWN:ReadonlySet<EdgeKind>=new Set<EdgeKind>(['caido','uno']);
/** The targets whose kind the game still points at (the others never reach the layout). */
export const shownTargets=<T extends Pick<EdgeTarget,'kind'>>(targets:readonly T[]):T[]=>targets.filter(t=>EDGE_KINDS_SHOWN.has(t.kind));

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
