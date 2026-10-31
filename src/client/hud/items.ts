/**
 * Client-side display catalog for offer cards and builds (VGM-040). Names and blurbs only:
 * the server (VGM-034/035/036) owns the real numbers. Names mirror the server catalogs (a test keeps them in sync,
 * without bundling the server modules); blurbs stay short so three lines fit a portrait card. Unknown ids fall back to a readable label.
 */
import {goldSticker,isStickerName,type StickerName} from '../ui/sticker.ts';
import {DEFENSES,KIT_CHARGES,KIT_IDS,kitPiece,towerArtKind} from '../../rules/index.ts';

/** snack: one-shot choices that never enter the build (the coxinha offered when the build is full). */
export type ItemDisplayKind='weapon'|'passive'|'evolution'|'snack';
/** `icon`: the illustrated sticker (src/client/ui/stickers.svg, DSG-adesivos-itens); draw it with sticker(). */
export interface ItemDisplay {id:string;kind:ItemDisplayKind;name:string;icon:StickerName;blurb:string;joke:string}

const items:ItemDisplay[]=[
  {id:'boleto',kind:'weapon',name:'Boleto Vencido',icon:'boleto',blurb:'Atravessa uma fila de bichos.',joke:'Vence hoje. Neles.'},
  {id:'cafe',kind:'weapon',name:'Café Derramado',icon:'cafe',blurb:'Poça quente que queima quem pisa.',joke:'Sem açúcar, sem dó.'},
  {id:'guarda-chuva',kind:'weapon',name:'Guarda-chuva da Vó',icon:'guarda-chuva',blurb:'Empurra bichos e bloqueia tiros.',joke:'Abriu dentro de casa.'},
  {id:'pombo',kind:'weapon',name:'Pombo da Praça',icon:'pombo',blurb:'Persegue o bicho mais perto.',joke:'Veio do nada.'},
  {id:'audio',kind:'weapon',name:'Áudio de 5 Minutos',icon:'audio',blurb:'Onda que acha o bicho e empurra.',joke:'"Oi, sumida…"'},
  {id:'boleto-evo',kind:'evolution',name:'Carnê Infinito',icon:'boleto-evo',blurb:'Boletos que nunca acabam.',joke:'Parcela 1 de 999.'},
  {id:'cafe-evo',kind:'evolution',name:'Cafeteira Industrial',icon:'cafe-evo',blurb:'Poças enormes e constantes.',joke:'Expediente eterno.'},
  {id:'cafe-forte',kind:'passive',name:'Café Coado na Meia',icon:'cafe-forte',blurb:'Armas recarregam mais rápido.',joke:'Meia limpa. Juramos.'},
  {id:'marmita',kind:'passive',name:'Marmita da Vó',icon:'marmita',blurb:'Mais vida máxima.',joke:'Tem farofa.'},
  {id:'tenis',kind:'passive',name:'Tênis de Feira',icon:'tenis',blurb:'Anda mais rápido.',joke:'Nike? Naique.'},
  {id:'megafone',kind:'passive',name:'Megafone do Carro do Ovo',icon:'megafone',blurb:'Ataques em área maior.',joke:'Olha o ovo!'},
  {id:'bone',kind:'passive',name:'Boné do Pai',icon:'bone',blurb:'Mais sorte no que cai e nas cartas.',joke:'Aba reta, sorte torta.'},
  {id:'oculos',kind:'passive',name:'Óculos Juliet',icon:'oculos',blurb:'Mais dano em tudo.',joke:'Estilo é dano.'},
  {id:'cartao',kind:'passive',name:'Cartão Fidelidade',icon:'cartao',blurb:'Cada caixa aberta dá grana.',joke:'Faltam 9 carimbos.'},
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
  // Card upgrades-megabonk: the tomes (rules/passives.ts), global, no equipping; 'pente' is the +1 projétil now.
  {id:'pente',kind:'passive',name:'Bombinha de São João',icon:'traque',blurb:'+1 projétil em cada ataque.',joke:'Uma vira duas.'},
  {id:'estilingue',kind:'passive',name:'Estilingue do Moleque',icon:'estilingue',blurb:'Tiros voam mais rápido.',joke:'Zuniu no ouvido.'},
  {id:'defumador',kind:'passive',name:'Defumador da Tia',icon:'defumador',blurb:'Aura de fumaça que machuca.',joke:'Espanta bicho.'},
  {id:'arruda',kind:'passive',name:'Arruda atrás da Orelha',icon:'arruda',blurb:'Recupera vida sozinho.',joke:'A vó jurou.'},
  {id:'tampa-de-panela',kind:'passive',name:'Tampa de Panela',icon:'tampa-de-panela',blurb:'Toma menos dano por golpe.',joke:'Faz "plim".'},  // Pack 12 (arsenal-completo-no-bau, sim/weapons/pack12.ts): the 34 Brazilian and mystical weapons, the Pack's
  // stickers; four take their own id beside the tomes above (baladeira, tampa-voadora, nuvem-de-incenso, galho-de-arruda).
  // The corneta's sticker (ui/corneta) shares its name with the HUD's horn icon (ui/icon.ts): the mystery box until the
  // art comes under another name (fatia B).
  {id:'baladeira',kind:'weapon',name:'Baladeira do Moleque',icon:'estilingue',blurb:'Pedrada de longe, sem barulho.',joke:'Pedra com chiclete.'},
  {id:'espeto',kind:'weapon',name:'Espeto de Churrasco',icon:'espeto',blurb:'Atravessa uma fila de bichos.',joke:'Com queijo coalho.'},
  {id:'sacole',kind:'weapon',name:'Sacolé de Groselha',icon:'sacole',blurb:'Deixa o bicho lento.',joke:'Congela o cérebro.'},
  {id:'tampa-voadora',kind:'weapon',name:'Tampa de Panela',icon:'tampa-de-panela',blurb:'Vai e volta acertando todos.',joke:'TEIN!'},
  {id:'colher-de-pau',kind:'weapon',name:'Colher de Pau da Vó',icon:'colher-de-pau',blurb:'Arco de perto que joga longe.',joke:'PÁ!'},
  {id:'peixeira',kind:'weapon',name:'Peixeira do Nordeste',icon:'peixeira',blurb:'Estocada rápida na frente.',joke:'Corta peixe e bicho.'},
  {id:'bola-murcha',kind:'weapon',name:'Bola Murcha da Pelada',icon:'bola-murcha',blurb:'Quica de cabeça em cabeça.',joke:'Remendada, mas joga.'},
  {id:'traque',kind:'weapon',name:'Traque de São João',icon:'traque',blurb:'Estouros em volta do bicho.',joke:'Pá-pá-pá-pá!'},
  {id:'buscape',kind:'weapon',name:'Buscapé',icon:'buscape',blurb:'Corre atrás do mais perto.',joke:'Nem ele sabe pra onde.'},
  {id:'facao',kind:'weapon',name:'Facão de Roçar',icon:'facao',blurb:'Golpe em volta inteira.',joke:'Roça mato e bicho.'},
  {id:'sal-grosso',kind:'weapon',name:'Sal Grosso da Vó',icon:'sal-grosso',blurb:'Círculo que empurra pra fora.',joke:'Daqui não passa.'},
  {id:'tijolo-baiano',kind:'weapon',name:'Tijolo Baiano',icon:'tijolo-baiano',blurb:'Jogado longe, estoura em área.',joke:'Oito furos de física.'},
  {id:'taro-vencido',kind:'weapon',name:'Baralho de Tarô Vencido',icon:'taro-vencido',blurb:'Leque de cinco cartas.',joke:'A carta diz: corre.'},
  {id:'nuvem-de-incenso',kind:'weapon',name:'Nuvem de Defumador',icon:'defumador',blurb:'Nuvem que machuca e deixa lento.',joke:'Cof, cof.'},
  {id:'corneta',kind:'weapon',name:'Corneta da Torcida',icon:'misterio',blurb:'Buzinaço que empurra todos.',joke:'É campeão!'},
  {id:'mangueira',kind:'weapon',name:'Mangueira do Vizinho',icon:'mangueira',blurb:'Jato que empurra e deixa lento.',joke:'Molhou, congelou.'},
  {id:'galho-de-arruda',kind:'weapon',name:'Galho de Arruda',icon:'arruda',blurb:'Aura que machuca quem chega.',joke:'Atrás da orelha.'},
  {id:'pes-do-curupira',kind:'weapon',name:'Pés Virados do Curupira',icon:'pes-do-curupira',blurb:'Quem pisa anda ao contrário.',joke:'Vai pra lá, é pra cá.'},
  {id:'panela-de-pressao',kind:'weapon',name:'Panela de Pressão da Vó',icon:'panela-de-pressao',blurb:'Estoura quando um bicho encosta.',joke:'Chiou, correu.'},
  {id:'carro-de-som',kind:'weapon',name:'Carro de Som do Ovo',icon:'carro-de-som',blurb:'Fica no chão e atira sozinho.',joke:'Olha o ovo!'},
  {id:'vira-lata',kind:'weapon',name:'Vira-Lata Caramelo',icon:'vira-lata',blurb:'Cachorro que morde os bichos.',joke:'Patrimônio nacional.'},
  {id:'ventilador',kind:'weapon',name:'Ventilador de Teto Arrancado',icon:'ventilador',blurb:'Ventania que empurra longe.',joke:'Velocidade 3.'},
  {id:'fogo-boitata',kind:'weapon',name:'Fogo do Boitatá',icon:'fogo-boitata',blurb:'Fogo que pula de bicho em bicho.',joke:'Cobra de fogo.'},
  {id:'olho-grego',kind:'weapon',name:'Olho Grego Gigante',icon:'olho-grego',blurb:'Raio comprido e fino.',joke:'Mau-olhado aqui não.'},
  {id:'uivo-do-lobisomem',kind:'weapon',name:'Uivo do Lobisomem',icon:'uivo-do-lobisomem',blurb:'Espanta e deixa lento.',joke:'Auuuuu!'},
  {id:'mula-sem-cabeca',kind:'weapon',name:'Mula sem Cabeça',icon:'mula-sem-cabeca',blurb:'Lendária: atropela todo mundo.',joke:'Cabeça pra quê?'},
  {id:'papagaio',kind:'weapon',name:'Papagaio Xingador',icon:'papagaio',blurb:'Lendária: os bichos vão atrás dele.',joke:'#@!'},
  {id:'gorro-do-saci',kind:'weapon',name:'Gorro do Saci',icon:'gorro-do-saci',blurb:'Lendária: redemoinho que puxa.',joke:'Cadê a outra perna?'},
  {id:'canto-da-iara',kind:'weapon',name:'Canto da Iara',icon:'canto-da-iara',blurb:'Lendária: os bichos param.',joke:'Ninguém resiste.'},
  {id:'bola-de-cristal',kind:'weapon',name:'Bola de Cristal da Cartomante',icon:'bola-de-cristal',blurb:'Lendária: raios caem do céu.',joke:'Ela viu chegando.'},
  {id:'cristal-quantico',kind:'weapon',name:'Cristal Quântico do Coach',icon:'cristal-quantico',blurb:'Lendária: pula seis vezes.',joke:'Vibra no dano.'},
];
// Kits de torre (torre-pela-caixa, rules/tower-kits.ts): a tap selects it, a tap on the map places it (hud/kit-place).
for(const id of KIT_IDS){
  const piece=kitPiece(id)!,wall=piece==='muro'||piece==='barricada';
  const name=wall?(piece==='muro'?'Muro':'Barricada'):DEFENSES[piece].name;
  items.push({id,kind:'snack',name:`Kit ${name}`,icon:wall?'kit-torre':`torre-${towerArtKind(piece)}` as StickerName,
    blurb:wall?`Toca e põe ${KIT_CHARGES[piece]} no chão.`:'Toca e põe a torre no chão.',joke:'Torre na caixa.'});
}
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
  return level<=1?{kind:'new',label:'Novo!'}:{kind:'level',label:`Nív. ${level}`,level};
}

/** Sentence-case seal text: "Novo!" for a first pick, "Nv N" otherwise, "Evolução", "Lanche" for the coxinha. */
/** An item's sticker at its level: a weapon at the dourada level wears its dourada edition (ui/sticker.ts goldSticker). */
export const itemSticker=(id:string,level=1):StickerName=>goldSticker(itemDisplay(id).icon,level);
export const levelTag=(id:string,level:number)=>priceTag(id,level).label;

export const allItemDisplays=():readonly ItemDisplay[]=>items;
