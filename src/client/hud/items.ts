/**
 * Client-side display catalog for offer cards and builds (VGM-040). Names and blurbs only:
 * the server (VGM-034/035/036) owns the real numbers. Names mirror the server catalogs (a test keeps them in sync,
 * without bundling the server modules); blurbs stay short so three lines fit a portrait card. Unknown ids fall back to a readable label.
 */
import {isStickerName,type StickerName} from '../ui/sticker.ts';

/** snack: one-shot choices that never enter the build (the coxinha offered when the build is full). */
export type ItemDisplayKind='weapon'|'passive'|'evolution'|'snack';
/** `icon`: the illustrated sticker (src/client/ui/stickers.svg, DSG-adesivos-itens); draw it with sticker(). */
export interface ItemDisplay {id:string;kind:ItemDisplayKind;name:string;icon:StickerName;blurb:string;joke:string}

const items:ItemDisplay[]=[
  {id:'chinelo',kind:'weapon',name:'Chinelo da Mãe',icon:'chinelo',blurb:'Gira em volta e acerta quem chega.',joke:'Mãe aprovou.'},
  {id:'boleto',kind:'weapon',name:'Boleto Vencido',icon:'boleto',blurb:'Atravessa uma fila de bichos.',joke:'Vence hoje. Neles.'},
  {id:'cafe',kind:'weapon',name:'Café Derramado',icon:'cafe',blurb:'Poça quente que queima quem pisa.',joke:'Sem açúcar, sem dó.'},
  {id:'guarda-chuva',kind:'weapon',name:'Guarda-chuva da Vó',icon:'guarda-chuva',blurb:'Empurra bichos e bloqueia tiros.',joke:'Abriu dentro de casa.'},
  {id:'pombo',kind:'weapon',name:'Pombo da Praça',icon:'pombo',blurb:'Persegue o bicho mais perto.',joke:'Veio do nada.'},
  {id:'audio',kind:'weapon',name:'Áudio de 5 Minutos',icon:'audio',blurb:'Onda que acha o bicho e empurra.',joke:'"Oi, sumida…"'},
  {id:'chinelo-evo',kind:'evolution',name:'Havaianas do Caos',icon:'chinelo-evo',blurb:'Chinelos em dobro, sem parar.',joke:'Todo mundo usa.'},
  {id:'boleto-evo',kind:'evolution',name:'Carnê Infinito',icon:'boleto-evo',blurb:'Boletos que nunca acabam.',joke:'Parcela 1 de 999.'},
  {id:'cafe-evo',kind:'evolution',name:'Cafeteira Industrial',icon:'cafe-evo',blurb:'Poças enormes e constantes.',joke:'Expediente eterno.'},
  {id:'cafe-forte',kind:'passive',name:'Café Coado na Meia',icon:'cafe-forte',blurb:'Armas recarregam mais rápido.',joke:'Meia limpa. Juramos.'},
  {id:'marmita',kind:'passive',name:'Marmita da Vó',icon:'marmita',blurb:'Mais vida máxima.',joke:'Tem farofa.'},
  {id:'tenis',kind:'passive',name:'Tênis de Feira',icon:'tenis',blurb:'Anda mais rápido.',joke:'Nike? Naique.'},
  {id:'megafone',kind:'passive',name:'Megafone do Carro do Ovo',icon:'megafone',blurb:'Ataques em área maior.',joke:'Olha o ovo!'},
  {id:'bone',kind:'passive',name:'Boné do Pai',icon:'bone',blurb:'Mais sorte nos drops e ofertas.',joke:'Aba reta, sorte torta.'},
  {id:'ima',kind:'passive',name:'Ímã de Geladeira',icon:'ima',blurb:'Puxa gemas de mais longe.',joke:'Brinde da pizzaria.'},
  {id:'oculos',kind:'passive',name:'Óculos Juliet',icon:'oculos',blurb:'Mais dano em tudo.',joke:'Estilo é dano.'},
  {id:'cartao',kind:'passive',name:'Cartão Fidelidade',icon:'cartao',blurb:'Ganha mais XP.',joke:'Faltam 9 carimbos.'},
  // HEAL_CHOICE (sim/offers.ts): offered when every slot is maxed; heals HEAL_AMOUNT on the spot.
  {id:'heal',kind:'snack',name:'Coxinha da Cantina',icon:'coxinha',blurb:'+30 de vida na hora.',joke:'Catupiry cura tudo.'},
  // D-051 arsenal (sim/weapons/arsenal.ts, manual combat): the new weapons wait for their stickers (the user's art), the
  // legendaries wear the old weapons' ones; the consumables and the hand's passives.
  {id:'faca',kind:'weapon',name:'Faca de Pão',icon:'faca',blurb:'Golpe em arco, bem de perto.',joke:'Corta pão e bicho.'},
  {id:'pistola',kind:'weapon',name:'Trinta-e-Oitão do Vô',icon:'pistola',blurb:'Tiro certeiro no mais perto.',joke:'Guardada desde 87.'},
  {id:'escopeta',kind:'weapon',name:'Espalha-Chumbo',icon:'escopeta',blurb:'Leque de chumbo de perto.',joke:'Mira? Pra quê?'},
  {id:'submetralhadora',kind:'weapon',name:'Metralhadora de Feira',icon:'submetralhadora',blurb:'Rajada rápida e fraquinha.',joke:'Três por dez!'},
  {id:'rifle',kind:'weapon',name:'Cano Longo',icon:'rifle',blurb:'De longe, atravessa a fila.',joke:'E o vizinho dele.'},
  {id:'macarico',kind:'weapon',name:'Maçarico do Tio',icon:'macarico',blurb:'Fogo na frente: derrete enxame.',joke:'Era pro portão.'},
  {id:'rojao',kind:'weapon',name:'Rojão de Réveillon',icon:'rojao',blurb:'Explode em área onde cair.',joke:'Feliz ano novo!'},
  {id:'chinelo-lendario',kind:'weapon',name:'Chinelo da Mãe',icon:'chinelo-evo',blurb:'Lendária: chinelos voando longe.',joke:'Mãe em fúria.'},
  {id:'boleto-lendario',kind:'weapon',name:'Boleto Vencido',icon:'boleto-evo',blurb:'Lendária: carnês que voltam.',joke:'Parcela eterna.'},
  {id:'cafe-lendario',kind:'weapon',name:'Café Derramado',icon:'cafe-evo',blurb:'Lendária: poça gigante te segue.',joke:'Expresso na cara.'},
  {id:'guarda-chuva-lendario',kind:'weapon',name:'Guarda-chuva da Vó',icon:'guarda-chuva',blurb:'Lendária: bloqueia e empurra.',joke:'A vó tá certa.'},
  {id:'pombo-lendario',kind:'weapon',name:'Pombo da Praça',icon:'pombo',blurb:'Lendária: revoada que persegue.',joke:'O bando inteiro.'},
  {id:'audio-lendario',kind:'weapon',name:'Áudio de 5 Minutos',icon:'audio',blurb:'Lendária: áudio que ninguém aguenta.',joke:'Parte 3 de 7.'},
  {id:'coxinha',kind:'snack',name:'Coxinha',icon:'coxinha',blurb:'Cura 30 de vida.',joke:'Com catupiry.'},
  {id:'brigadeiro',kind:'snack',name:'Brigadeiro',icon:'brigadeiro',blurb:'Mais rápido por 30 s.',joke:'De panela.'},
  {id:'pacoca',kind:'snack',name:'Paçoca',icon:'pacoca',blurb:'Mais dano por 30 s.',joke:'Prensada.'},
  {id:'cocada',kind:'snack',name:'Cocada',icon:'cocada',blurb:'Toma menos dano por 30 s.',joke:'Dura que dói.'},
  {id:'kit-torre',kind:'snack',name:'Kit de Torre',icon:'kit-torre',blurb:'Vira 1 ficha de torre do time.',joke:'Monte você mesmo.'},
  {id:'pente',kind:'passive',name:'Pente Estendido',icon:'pente',blurb:'+1 projétil por disparo.',joke:'Sempre cabe mais um.'},
  {id:'silenciador',kind:'passive',name:'Silenciador de Garagem',icon:'silenciador',blurb:'Armas fazem menos barulho.',joke:'Garrafa PET.'},
];
const byId=new Map(items.map(item=>[item.id,item]));

/** Sticker of an id the client catalog does not know (the "who even picked that?" box). */
export const UNKNOWN_ITEM_STICKER:StickerName='misterio';

export function itemDisplay(id:string):ItemDisplay{
  const known=byId.get(id);
  if(known)return known;
  const name=id.replace(/[-_]+/g,' ').replace(/^\w/,letter=>letter.toUpperCase())||'Item misterioso';
  // An id the catalog does not list yet but whose art came (arte v2): its own sticker, never the box.
  return {id,kind:'weapon',name,icon:isStickerName(id)?id:UNKNOWN_ITEM_STICKER,blurb:'Ninguém sabe o que faz. Bora testar.',joke:'Sem bula.'};
}

/** Price of an offer card (DSG-oferta-etiqueta): "Novo!" on the encarte star, the level as a price, or a word. */
export type PriceTag={kind:'new';label:'Novo!'}|{kind:'level';label:string;level:number}|{kind:'evo';label:'Evolução'}|{kind:'snack';label:'Lanche'};

export function priceTag(id:string,level:number):PriceTag{
  const kind=itemDisplay(id).kind;
  if(kind==='evolution')return {kind:'evo',label:'Evolução'};
  if(kind==='snack')return {kind:'snack',label:'Lanche'};
  return level<=1?{kind:'new',label:'Novo!'}:{kind:'level',label:`Nv ${level}`,level};
}

/** Sentence-case seal text: "Novo!" for a first pick, "Nv N" otherwise, "Evolução", "Lanche" for the coxinha. */
export const levelTag=(id:string,level:number)=>priceTag(id,level).label;

export const allItemDisplays=():readonly ItemDisplay[]=>items;
