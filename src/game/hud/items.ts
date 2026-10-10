/**
 * Client-side display catalog for offer cards and builds (VGM-040). Names and blurbs only:
 * the server (VGM-034/035/036) owns the real numbers. Names mirror the server catalogs (a test keeps them in sync,
 * without bundling the server modules); blurbs stay short so three lines fit a portrait card. Unknown ids fall back to a readable label.
 */
/** snack: one-shot choices that never enter the build (the coxinha offered when the build is full). */
export type ItemDisplayKind='weapon'|'passive'|'evolution'|'snack';
export interface ItemDisplay {id:string;kind:ItemDisplayKind;name:string;icon:string;blurb:string;joke:string}

const items:ItemDisplay[]=[
  {id:'chinelo',kind:'weapon',name:'Chinelo da Mãe',icon:'🩴',blurb:'Gira em volta e acerta quem chega.',joke:'Mãe aprovou.'},
  {id:'boleto',kind:'weapon',name:'Boleto Vencido',icon:'🧾',blurb:'Atravessa uma fila de bichos.',joke:'Vence hoje. Neles.'},
  {id:'cafe',kind:'weapon',name:'Café Derramado',icon:'☕',blurb:'Poça quente que queima quem pisa.',joke:'Sem açúcar, sem dó.'},
  {id:'guarda-chuva',kind:'weapon',name:'Guarda-chuva da Vó',icon:'☂️',blurb:'Empurra bichos e bloqueia tiros.',joke:'Abriu dentro de casa.'},
  {id:'pombo',kind:'weapon',name:'Pombo da Praça',icon:'🐦',blurb:'Persegue o bicho mais perto.',joke:'Veio do nada.'},
  {id:'audio',kind:'weapon',name:'Áudio de 5 Minutos',icon:'🔊',blurb:'Onda que acha o bicho e empurra.',joke:'"Oi, sumida…"'},
  {id:'chinelo-evo',kind:'evolution',name:'Havaianas do Caos',icon:'🌪️',blurb:'Chinelos em dobro, sem parar.',joke:'Todo mundo usa.'},
  {id:'boleto-evo',kind:'evolution',name:'Carnê Infinito',icon:'📚',blurb:'Boletos que nunca acabam.',joke:'Parcela 1 de 999.'},
  {id:'cafe-evo',kind:'evolution',name:'Cafeteira Industrial',icon:'🏭',blurb:'Poças enormes e constantes.',joke:'Expediente eterno.'},
  {id:'cafe-forte',kind:'passive',name:'Café Coado na Meia',icon:'🫖',blurb:'Armas recarregam mais rápido.',joke:'Meia limpa. Juramos.'},
  {id:'marmita',kind:'passive',name:'Marmita da Vó',icon:'🍱',blurb:'Mais vida máxima.',joke:'Tem farofa.'},
  {id:'tenis',kind:'passive',name:'Tênis de Feira',icon:'👟',blurb:'Anda mais rápido.',joke:'Nike? Naique.'},
  {id:'megafone',kind:'passive',name:'Megafone do Carro do Ovo',icon:'📣',blurb:'Ataques em área maior.',joke:'Olha o ovo!'},
  {id:'bone',kind:'passive',name:'Boné do Pai',icon:'🧢',blurb:'Mais sorte nos drops e ofertas.',joke:'Aba reta, sorte torta.'},
  {id:'ima',kind:'passive',name:'Ímã de Geladeira',icon:'🧲',blurb:'Puxa gemas de mais longe.',joke:'Brinde da pizzaria.'},
  {id:'oculos',kind:'passive',name:'Óculos Juliet',icon:'🕶️',blurb:'Mais dano em tudo.',joke:'Estilo é dano.'},
  {id:'cartao',kind:'passive',name:'Cartão Fidelidade',icon:'💳',blurb:'Ganha mais XP.',joke:'Faltam 9 carimbos.'},
  // HEAL_CHOICE (sim/offers.ts): offered when every slot is maxed; heals HEAL_AMOUNT on the spot.
  {id:'heal',kind:'snack',name:'Coxinha da Cantina',icon:'🥟',blurb:'+30 de vida na hora.',joke:'Catupiry cura tudo.'},
];
const byId=new Map(items.map(item=>[item.id,item]));

export function itemDisplay(id:string):ItemDisplay{
  const known=byId.get(id);
  if(known)return known;
  const name=id.replace(/[-_]+/g,' ').replace(/^\w/,letter=>letter.toUpperCase())||'Item misterioso';
  return {id,kind:'weapon',name,icon:'❔',blurb:'Ninguém sabe o que faz. Bora testar.',joke:'Sem bula.'};
}

/** "NOVO!" for a first pick, "Nv N" otherwise, "EVOLUÇÃO" for evolved weapons, "LANCHE" for the coxinha. */
export function levelTag(id:string,level:number){
  const kind=itemDisplay(id).kind;
  if(kind==='evolution')return 'EVOLUÇÃO';
  if(kind==='snack')return 'LANCHE';
  return level<=1?'NOVO!':`Nv ${level}`;
}

export const allItemDisplays=():readonly ItemDisplay[]=>items;
