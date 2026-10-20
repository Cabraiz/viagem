/**
 * Veículos (card NEW-20261014-ORQ-bancos-e-veiculos, part 2, slice 1; proposal viagem-board/claims/
 * NEW-20261014-ORQ-bancos-e-veiculos/proposta-veiculos.md): the rental app "Vrum" went bankrupt (the owner spent the
 * cash on a jet) and left its whole fleet in the snow. Each thing has one specific flaw, and the flaw is the rule that
 * weighs against the speed. Every name, line and number lives here (the speeds the prediction needs: contract
 * vehicles.ts) so the user can veto one by changing one line.
 */
import type {VehicleKind} from '../contract/index.ts';

export const VEHICLE_NAMES:Readonly<Record<VehicleKind,string>>=Object.freeze({
  patinete:'Patinete Vrum',
  carrinho:'Carrinho de mercado',
  crossfiteiro:'Crossfiteiro de folga',
});
/** What the vehicle says when taken (one at random) and when the ride runs out. */
export const VEHICLE_LINES:Readonly<Record<VehicleKind,{pegou:readonly string[];acabou:string}>>=Object.freeze({
  patinete:Object.freeze({pegou:Object.freeze(['Avalie sua viagem: uma estrela.','Corrida iniciada. Bateria: 3 quadras.']),
    acabou:'Saldo insuficiente. Sua corrida custou R$ 0,00 e sua honra.'}),
  carrinho:Object.freeze({pegou:Object.freeze(['Ele não anda reto. Ninguém anda reto.','Tem uma alface aqui de 2019.']),
    acabou:'A roda caiu. A alface ficou.'}),
  crossfiteiro:Object.freeze({pegou:Object.freeze(['MAIS UMA!','Isso aqui é treino de pegada.']),
    acabou:'Agora 1 burpee. Posta e me marca.'}),
});

/**
 * The numbers (world units, seconds). The sim reads them; the bench tunes them.
 * - firstS: the first vehicle this long into the run; everyS: then one every everyS.
 * - cap: parked at once, 1 + ⌈players/2⌉ up to capMax (vehicleCap). lifeS: a parked one nobody takes goes away.
 * - near/far: it parks this far from a standing hero drawn by the seed, and at least clearHero from every hero
 *   (nobody sees it pop in at their feet); tries points per attempt, else the next attempt retryS later.
 * - takeR: a standing hero not riding this close takes it (walking over it, no button).
 * - seconds[kind]: the ride; the scooter's battery dies at a moment drawn in batteryS (its whole ride).
 * - healEvery, healHp: the crossfiteiro heals this much every healEvery seconds of the ride ("é cardio").
 */
export const VEICULO=Object.freeze({
  firstS:60,everyS:45,lifeS:60,capBase:1,capMax:4,
  near:15,far:40,clearHero:8,tries:24,retryS:1,
  takeR:1.2,
  seconds:Object.freeze({patinete:10,carrinho:12,crossfiteiro:12} as Readonly<Record<VehicleKind,number>>),
  batteryS:Object.freeze([6,10] as const),
  healEvery:3,healHp:5,
});
export const vehicleCap=(players:number)=>Math.min(VEICULO.capMax,VEICULO.capBase+Math.ceil(Math.max(1,players)/2));
/**
 * The line over the rider's head for a vehicle event (pegou: one of the vehicle's, picked by `seed`, the event id;
 * acabou: the vehicle's ending), or undefined ('largou': the hero let go, nobody says anything).
 */
export function vehicleLine(kind:VehicleKind,what:'pegou'|'acabou'|'largou',seed:number):string|undefined{
  const lines=VEHICLE_LINES[kind];
  if(!lines||what==='largou')return undefined;
  if(what==='acabou')return lines.acabou;
  return lines.pegou[Math.abs(Math.trunc(seed))%lines.pegou.length];
}
