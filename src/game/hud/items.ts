/**
 * Client-side display catalog for offer cards and builds (VGM-040). Names and blurbs only:
 * the server (VGM-034/035/036) owns the real numbers. Unknown ids fall back to a readable label.
 */
export type ItemDisplayKind='weapon'|'passive'|'evolution';
export interface ItemDisplay {id:string;kind:ItemDisplayKind;name:string;icon:string;blurb:string;joke:string}

const items:ItemDisplay[]=[
  {id:'chinelo',kind:'weapon',name:'Chinelo Orbital',icon:'🩴',blurb:'Gira em volta de você e acerta quem chegar perto.',joke:'Mãe aprovou.'},
  {id:'boleto',kind:'weapon',name:'Boleto Perfurante',icon:'🧾',blurb:'Atravessa uma fila de bichos.',joke:'Vence hoje. Neles.'},
  {id:'cafe',kind:'weapon',name:'Café Derramado',icon:'☕',blurb:'Poça quente no chão que machuca quem pisa.',joke:'Sem açúcar, sem piedade.'},
  {id:'guarda-chuva',kind:'weapon',name:'Guarda-chuva',icon:'☂️',blurb:'Escudo que empurra bichos e bloqueia tiros.',joke:'Abriu dentro de casa. Azar deles.'},
  {id:'pombo',kind:'weapon',name:'Pombo Teleguiado',icon:'🐦',blurb:'Persegue o bicho mais próximo.',joke:'Ninguém sabe de onde veio.'},
  {id:'audio',kind:'weapon',name:'Áudio de 4 min',icon:'🔊',blurb:'Onda em cone que empurra e machuca.',joke:'"Oi, sumida…"'},
  {id:'chinelo-evo',kind:'evolution',name:'Havaianas do Caos',icon:'🌪️',blurb:'Chinelos em dobro, girando sem parar.',joke:'Todo mundo usa.'},
  {id:'boleto-evo',kind:'evolution',name:'Carnê Infinito',icon:'📚',blurb:'Boletos que nunca acabam.',joke:'Parcela 1 de 999.'},
  {id:'cafe-evo',kind:'evolution',name:'Cafeteira Industrial',icon:'🏭',blurb:'Poças enormes e constantes.',joke:'Expediente eterno.'},
  {id:'cafe-forte',kind:'passive',name:'Café Forte',icon:'🫖',blurb:'Armas recarregam mais rápido.',joke:'Coração a 180 bpm.'},
  {id:'marmita',kind:'passive',name:'Marmita da Vó',icon:'🍱',blurb:'Mais vida máxima.',joke:'Tem farofa.'},
  {id:'tenis',kind:'passive',name:'Tênis de Feira',icon:'👟',blurb:'Anda mais rápido.',joke:'Nike? Naique.'},
  {id:'megafone',kind:'passive',name:'Megafone',icon:'📣',blurb:'Ataques em área maior.',joke:'Atenção, moradores…'},
  {id:'bone',kind:'passive',name:'Boné da Sorte',icon:'🧢',blurb:'Mais sorte nos drops e ofertas.',joke:'Virado pra trás dá +2.'},
  {id:'ima',kind:'passive',name:'Ímã de Geladeira',icon:'🧲',blurb:'Puxa gemas de mais longe.',joke:'Lembrança de Aparecida.'},
  {id:'oculos',kind:'passive',name:'Óculos Escuros',icon:'🕶️',blurb:'Mais dano em tudo.',joke:'Estilo é dano.'},
  {id:'cartao',kind:'passive',name:'Cartão Fidelidade',icon:'💳',blurb:'Ganha mais XP.',joke:'Faltam 9 carimbos.'},
];
const byId=new Map(items.map(item=>[item.id,item]));

export function itemDisplay(id:string):ItemDisplay{
  const known=byId.get(id);
  if(known)return known;
  const name=id.replace(/[-_]+/g,' ').replace(/^\w/,letter=>letter.toUpperCase())||'Item misterioso';
  return {id,kind:'weapon',name,icon:'❔',blurb:'Ninguém sabe o que faz. Bora testar.',joke:'Sem bula.'};
}

/** "NOVO!" for a first pick, "Nv N" otherwise, "EVOLUÇÃO" for evolved weapons. */
export function levelTag(id:string,level:number){
  if(itemDisplay(id).kind==='evolution')return 'EVOLUÇÃO';
  return level<=1?'NOVO!':`Nv ${level}`;
}

export const allItemDisplays=():readonly ItemDisplay[]=>items;
