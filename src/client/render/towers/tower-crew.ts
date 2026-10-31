/**
 * Crew ruler of each defense's delivered sheets (card kits-so-torres-boas, part 3, P0, 31/10: the obuseiro and the
 * other B/C towers stood ~3× the hero in fantasma, obra and pronta). Art px a standing soldier measures in the sheets
 * (head to feet, idle frame; the antiaérea's are seated). towerKindScale draws every kind listed here at the hero's
 * size; a kind with no crew (the gustavão's rail parts) keeps the scenery scale.
 */
import type {TowerKind} from './tower-rules.ts';

export const CREW_PX:Readonly<Partial<Record<TowerKind,number>>>=Object.freeze({
  // The 7 ramo A posts share one ruler (the Andaime's).
  'vigia-do-predio':155,'vigias-armados':155,'atiradores-do-telhado':155,'ninho-de-metralhadora':155,
  'guarnicao-do-predio':155,'ninho-do-sniper':155,'equipe-antimaterial':155,
  // Ramo B and C, measured on their idle frames.
  'obuseiro':142,'lanca-foguetes':98,'morteiro':112,'rojao-de-festa':97,
  'holofote':73,'arame-e-sirene':95,'posto-de-radar':106,'antiaerea-quadrupla':160,
});
