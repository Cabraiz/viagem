/**
 * Thrown weapons (BUG-20261023-ORQ-armas-sem-projetil, usuário 23/10: "a shotgun e outras armas são explosivos, nem
 * aparece o projétil indo"): the zone weapons a hero throws (the Rojão de Réveillon, the Tijolo Baiano, the Traque de
 * São João; sim/weapons/catalog.ts effect.thrown) no longer burst on the target the tick they fire. The zone flies from
 * the hero to its spot in THROW_TICKS, hitting nothing, and only there does its burst start (its damage, area and
 * duration unchanged). The client draws the flight and plays the burst when it lands (render/arsenal-rules.ts).
 */
import {SIM_HZ} from '../contract/index.ts';

/** Ticks a thrown zone flies before it lands, whatever the distance (a far throw flies faster). */
export const THROW_TICKS=8;
/** The same flight in milliseconds (the client's clock). */
export const THROW_MS=THROW_TICKS*1000/SIM_HZ;
