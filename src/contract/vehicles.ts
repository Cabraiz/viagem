/**
 * Veículos (card NEW-20261014-ORQ-bancos-e-veiculos, part 2, slice 1; proposal viagem-board/claims/
 * NEW-20261014-ORQ-bancos-e-veiculos/proposta-veiculos.md): what the bankrupt rental app "Vrum" left on the city's
 * streets. A parked vehicle is a 'vehicle' pickup (PickupState.resource = its VehicleKind); a hero riding one carries
 * SimPlayer.ride / rideUntil. The numbers the phone's prediction needs live here (maps/prediction.ts); the rest (spawn,
 * lines) in rules/veiculos.ts.
 */
export const VEHICLE_KINDS=['patinete','carrinho','crossfiteiro'] as const;
export type VehicleKind=typeof VEHICLE_KINDS[number];
export const isVehicleKind=(s:unknown):s is VehicleKind=>typeof s==='string'&&(VEHICLE_KINDS as readonly string[]).includes(s);

/**
 * Walking × RIDE_MULT[kind] while tick < rideUntil (instead of the brigadeiro, never on top of it: the larger one; a
 * burp still slows it, a slide still overrides it).
 */
export const RIDE_MULT:Readonly<Record<VehicleKind,number>>=Object.freeze({patinete:1.8,carrinho:1.5,crossfiteiro:1.7});
/** The cart's wheel, bent since 1998: the stick's direction turns this much (radians, counter-clockwise in world x/y). */
export const CART_TURN=15*Math.PI/180;
/**
 * The crossfiteiro's last BURPEE_TICKS of a ride are the burpee he makes you do: standing still (walking × 0). They are
 * part of the ride (rideUntil counts them), so the phone predicts the stop without a new frame.
 */
export const BURPEE_TICKS=16;
