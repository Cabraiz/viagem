/**
 * Pack 12 (NEW-20261022-ORQ-arsenal-completo-no-bau, viagem-board/design/enviar/12-ARSENAL-BRASILEIRO-E-MISTICO.md,
 * numbers: viagem-board/plans/arsenal-completo-proposta.md): the 34 Brazilian and mystical weapons as plain data.
 * sim/weapons/arsenal.ts builds them like the seven firearms (verde row × ARSENAL_DAMAGE × the rarity); only the
 * PLAYABLE ones (their type works in the sim) enter the catalog and the crates. Imports nothing at runtime, so
 * arsenal.ts can read it without a cycle.
 *
 * Four ids of the Pack were already the manual combat's tomes (rules/passives.ts MANUAL_PASSIVE_IDS: estilingue,
 * defumador, arruda, tampa-de-panela): those weapons take their own id (baladeira, nuvem-de-incenso, galho-de-arruda,
 * tampa-voadora) and keep the Pack's art (`icon`, the sticker and the projectile).
 */
import type {WeaponDef,WeaponPattern} from './catalog.ts';
import {A2_PLAYABLE} from './pack12-a2.ts';

/** The Pack's weapon types (§1: what the world art looks like). */
export type PackType='corpo-a-corpo'|'tiro'|'leque'|'orbita'|'aura'|'bumerangue'|'ricochete'|'corrente'|'teleguiado'
  |'feixe'|'lancado'|'mina'|'ceu'|'vortice'|'nuvem'|'onda'|'armadilha'|'mascote'|'torreta'|'investida';
/** dmg, cd, amt, area, spd, dur, pierce, kb, hit, range: the verde row of the table (arsenal.ts row()). */
export type Pack12Row=readonly [number,number,number,number,number,number,number,number,number,number];
export interface Pack12Weapon {
  id:string;name:string;
  /** The Pack's id: sticker `ui/<icon>` and world art `projeteis/<icon>` (differs from id only for the four above). */
  icon:string;
  type:PackType;
  /** How the sim runs it. A type of the fatia B not built yet keeps the nearest pattern until its card (not playable). */
  pattern:WeaponPattern;
  minRarity:1|2|3|4|5;
  noise:number;
  quip:string;intro:string;
  verde:Pack12Row;
  coneHalfAngle?:number;
  /** Behaviour switches (sim/weapons/catalog.ts WeaponDef). */
  evolved?:WeaponDef['evolved'];
  effect?:WeaponDef['effect'];
}

const INF=1e6,PI=Math.PI;

export const PACK12:readonly Pack12Weapon[]=[
  // ---- Verde ----
  {id:'baladeira',name:'Baladeira do Moleque',icon:'estilingue',type:'tiro',pattern:'pierce',minRarity:1,noise:4,
    quip:'Pedra com chiclete, a munição oficial.',intro:'Pedrada certeira de longe, quase sem barulho.',
    //    dmg  cd  amt area spd  dur pierce kb  hit range
    verde:[14,.55,1,.2,11,.75,0,.25,.5,8]},
  {id:'espeto',name:'Espeto de Churrasco',icon:'espeto',type:'tiro',pattern:'pierce',minRarity:1,noise:3,
    quip:'Linguiça e queijo coalho de brinde.',intro:'Espeto arremessado que atravessa uma fila de bichos.',
    verde:[20,1,1,.22,9,.8,3,.1,.5,7]},
  {id:'sacole',name:'Sacolé de Groselha',icon:'sacole',type:'tiro',pattern:'pierce',minRarity:1,noise:3,
    quip:'Congela o cérebro e o bicho.',intro:'Sacolé gelado: o bicho que leva fica lento.',effect:{slowSeconds:1.5},
    verde:[10,.6,1,.25,9,.75,0,0,.5,7]},
  {id:'tampa-voadora',name:'Tampa de Panela',icon:'tampa-de-panela',type:'bumerangue',pattern:'pierce',minRarity:1,noise:10,
    quip:'TEIN!',intro:'Tampa arremessada que vai e volta, acertando todo mundo no caminho.',evolved:{returns:true},
    verde:[12,1.1,1,.35,9,.6,INF,.5,.4,5.4]},
  {id:'pandeiro',name:'Pandeiro do Pagode',icon:'pandeiro',type:'orbita',pattern:'orbit',minRarity:1,noise:8,
    quip:'Ninguém fica parado no pagode.',intro:'Três pandeiros giram em volta de você.',
    verde:[8,2.5,3,1.6,3.4,3,INF,.25,.5,0]},
  {id:'colher-de-pau',name:'Colher de Pau da Vó',icon:'colher-de-pau',type:'corpo-a-corpo',pattern:'cone',coneHalfAngle:1,minRarity:1,noise:6,
    quip:'PÁ!',intro:'Colherada em arco de perto que joga o bicho longe.',
    verde:[18,.8,1,2.6,0,.15,INF,1.2,.2,2.6]},
  {id:'peixeira',name:'Peixeira do Nordeste',icon:'peixeira',type:'corpo-a-corpo',pattern:'cone',coneHalfAngle:.5,minRarity:1,noise:4,
    quip:'Corta peixe, corta bicho.',intro:'Estocada rápida e estreita bem na frente.',
    verde:[9,.35,1,2.6,0,.15,INF,.1,.2,2.6]},
  // ---- Azul ----
  {id:'bola-murcha',name:'Bola Murcha da Pelada',icon:'bola-murcha',type:'ricochete',pattern:'ricochet',minRarity:2,noise:6,
    quip:'Remendada, mas joga.',intro:'Bola que quica de cabeça em cabeça.',
    verde:[16,.9,1,.3,9,1.2,3,.3,.5,7]},
  {id:'traque',name:'Traque de São João',icon:'traque',type:'lancado',pattern:'zone',minRarity:2,noise:16,
    quip:'Pá-pá-pá-pá!',intro:'Punhado de traques que estouram em volta do bicho.',effect:{scatter:1},
    verde:[14,1.4,4,1,0,.3,INF,.3,1,6]},
  {id:'buscape',name:'Buscapé',icon:'buscape',type:'teleguiado',pattern:'homing',minRarity:2,noise:18,
    quip:'Ninguém sabe pra onde ele vai. Nem ele.',intro:'Fogo que corre atrás do bicho mais perto.',
    verde:[18,1,1,.25,6,2.5,0,.3,.5,9]},
  {id:'figa',name:'Figa de Madeira',icon:'figa',type:'orbita',pattern:'orbit',minRarity:2,noise:0,
    quip:'Isola!',intro:'Duas figas giram em volta de você e bloqueiam tiro de bicho.',effect:{blocksHostile:true},
    verde:[6,3,2,1.2,3,3.5,INF,.4,.5,0]},
  {id:'vela-esoterica',name:'Vela Aromática da Tia Esotérica',icon:'vela-esoterica',type:'orbita',pattern:'orbit',minRarity:2,noise:0,
    quip:'Lavanda pra acalmar. Não acalma.',intro:'Velas giram em volta de você, num anel largo.',
    verde:[10,2.5,3,2,2.6,3,INF,0,.4,0]},
  {id:'facao',name:'Facão de Roçar',icon:'facao',type:'corpo-a-corpo',pattern:'cone',coneHalfAngle:PI,minRarity:2,noise:8,
    quip:'Roça o mato e o bicho.',intro:'Golpe que gira em volta de você inteiro.',
    verde:[14,.9,1,2.4,0,.15,INF,.4,.2,2.4]},
  {id:'sal-grosso',name:'Sal Grosso da Vó',icon:'sal-grosso',type:'armadilha',pattern:'zone',minRarity:2,noise:0,
    quip:'Daqui não passa.',intro:'Círculo de sal no chão que empurra os bichos para fora.',
    verde:[4,4,1,2,0,4,INF,1,.3,0]},
  // ---- Roxa ----
  {id:'tijolo-baiano',name:'Tijolo Baiano',icon:'tijolo-baiano',type:'lancado',pattern:'zone',minRarity:3,noise:8,
    quip:'Oito furos de pura física.',intro:'Tijolo jogado longe que estoura em área onde cai.',
    verde:[45,1.6,1,1.6,0,.3,INF,.6,1,11]},
  {id:'taro-vencido',name:'Baralho de Tarô Vencido',icon:'taro-vencido',type:'leque',pattern:'pierce',minRarity:3,noise:2,
    quip:'A carta diz: corre.',intro:'Leque de cinco cartas de uma vez.',effect:{fanStep:.25},
    verde:[9,1,5,.2,10,.6,1,.1,.5,6]},
  {id:'nuvem-de-incenso',name:'Nuvem de Defumador',icon:'defumador',type:'nuvem',pattern:'zone',minRarity:3,noise:0,
    quip:'Cof, cof.',intro:'Nuvem de incenso jogada no bicho: tosse, perde vida e fica lento.',evolved:{slowSeconds:1},
    verde:[5,2,1,1.8,0,4,INF,0,.4,7]},
  {id:'corneta',name:'Corneta da Torcida',icon:'corneta',type:'onda',pattern:'cone',coneHalfAngle:PI,minRarity:3,noise:26,
    quip:'É campeão!',intro:'Buzinaço em volta de você que empurra todo mundo.',
    verde:[10,1.6,1,4,0,.25,INF,1.5,.3,4]},
  {id:'mangueira',name:'Mangueira do Vizinho',icon:'mangueira',type:'feixe',pattern:'cone',coneHalfAngle:.12,minRarity:3,noise:4,
    quip:'Molhou, congelou.',intro:'Jato comprido que empurra e deixa o bicho lento.',
    verde:[4,.2,1,6,0,.15,INF,.15,.2,6]},
  {id:'galho-de-arruda',name:'Galho de Arruda',icon:'arruda',type:'aura',pattern:'shield',minRarity:3,noise:0,
    quip:'Atrás da orelha, sempre.',intro:'Aura verde que machuca quem chega perto.',
    verde:[7,1,1,1.8,0,3,INF,.2,.4,0]},
  {id:'pes-do-curupira',name:'Pés Virados do Curupira',icon:'pes-do-curupira',type:'armadilha',pattern:'zone',minRarity:3,noise:0,
    quip:'Vai pra lá que é pra cá.',intro:'Pegadas ao contrário no chão: quem pisa anda para o lado errado.',
    verde:[4,3,2,1.4,0,5,INF,0,.5,6]},
  // ---- Dourada ----
  {id:'panela-de-pressao',name:'Panela de Pressão da Vó',icon:'panela-de-pressao',type:'mina',pattern:'mine',minRarity:4,noise:22,
    quip:'Chiou, correu.',intro:'Panela no chão que estoura em feijão quando um bicho encosta.',
    verde:[70,2.2,1,2.2,0,12,INF,.8,1,.8]},
  {id:'carro-de-som',name:'Carro de Som do Ovo',icon:'carro-de-som',type:'torreta',pattern:'turret',minRarity:4,noise:24,
    quip:'Olha o ovo!',intro:'Carrinho de som no chão que atira ondas sozinho.',
    verde:[12,10,1,.3,9,.8,2,.4,.4,8]},
  {id:'vira-lata',name:'Vira-Lata Caramelo',icon:'vira-lata',type:'mascote',pattern:'homing',minRarity:4,noise:10,
    quip:'Patrimônio nacional.',intro:'Um caramelo que corre e morde os bichos.',
    verde:[16,8,1,.5,4.5,8,INF,.3,.5,9]},
  {id:'ventilador',name:'Ventilador de Teto Arrancado',icon:'ventilador',type:'aura',pattern:'shield',minRarity:4,noise:8,
    quip:'Velocidade 3, a proibida.',intro:'Ventania em volta de você que empurra todo mundo longe.',
    verde:[4,1,1,2.4,0,4,INF,1.6,.3,0]},
  {id:'fogo-boitata',name:'Fogo do Boitatá',icon:'fogo-boitata',type:'corrente',pattern:'homing',minRarity:4,noise:10,
    quip:'Cobra de fogo não tem pressa.',intro:'Fogo que pula de bicho em bicho.',
    verde:[24,1.1,1,.3,6,1.5,4,0,.5,8]},
  {id:'olho-grego',name:'Olho Grego Gigante',icon:'olho-grego',type:'feixe',pattern:'cone',coneHalfAngle:.1,minRarity:4,noise:6,
    quip:'Mau-olhado aqui não.',intro:'Raio comprido e fino do olho que flutua sobre você.',
    verde:[7,.2,1,8,0,.15,INF,0,.2,8]},
  {id:'uivo-do-lobisomem',name:'Uivo do Lobisomem',icon:'uivo-do-lobisomem',type:'onda',pattern:'cone',coneHalfAngle:PI,minRarity:4,noise:26,
    quip:'Auuuuu!',intro:'Uivo em volta de você que espanta e deixa os bichos lentos.',
    verde:[14,2,1,5,0,.25,INF,2.2,.3,5]},
  // ---- Lendária (só linha 5) ----
  {id:'mula-sem-cabeca',name:'Mula sem Cabeça',icon:'mula-sem-cabeca',type:'investida',pattern:'pierce',minRarity:5,noise:18,
    quip:'Cabeça pra quê?',intro:'A mula atravessa a tela e atropela todo mundo.',
    verde:[60,3,1,1.2,14,1.4,INF,1.5,.5,14]},
  {id:'papagaio',name:'Papagaio Xingador',icon:'papagaio',type:'mascote',pattern:'homing',minRarity:5,noise:14,
    quip:'#@!',intro:'Papagaio que voa xingando: os bichos vão atrás dele.',
    verde:[10,10,1,.4,5,10,INF,0,.4,9]},
  {id:'gorro-do-saci',name:'Gorro do Saci',icon:'gorro-do-saci',type:'vortice',pattern:'zone',minRarity:5,noise:8,
    quip:'Cadê a outra perna?',intro:'Redemoinho que anda sozinho e puxa os bichos.',
    verde:[8,4,1,2.2,1.5,4,INF,-.6,.3,8]},
  {id:'canto-da-iara',name:'Canto da Iara',icon:'canto-da-iara',type:'aura',pattern:'shield',minRarity:5,noise:10,
    quip:'Ninguém resiste.',intro:'Música em volta de você: os bichos param, apaixonados.',
    verde:[6,1,1,2.6,0,4,INF,0,.5,0]},
  {id:'bola-de-cristal',name:'Bola de Cristal da Cartomante',icon:'bola-de-cristal',type:'ceu',pattern:'zone',minRarity:5,noise:20,
    quip:'Ela viu isso chegando.',intro:'Raios caem do céu em bichos aleatórios.',
    verde:[40,1.6,3,1.4,0,.3,INF,.5,1,12]},
  {id:'cristal-quantico',name:'Cristal Quântico do Coach',icon:'cristal-quantico',type:'corrente',pattern:'homing',minRarity:5,noise:6,
    quip:'Vibra na frequência do dano.',intro:'Faísca que pula de bicho em bicho, seis vezes.',
    verde:[18,.7,1,.3,6,1.5,6,0,.5,9]},
];

/**
 * Fatia A1 (E5): the Pack weapons with world art on the patterns the sim already has (the nuvem-de-incenso waits for
 * its cloud art, fatia B: the Pack's defumador art is the tome's aura).
 */
export const A1_PLAYABLE:readonly string[]=['baladeira','espeto','sacole','tampa-voadora','pandeiro','buscape','traque','figa',
  'vela-esoterica','tijolo-baiano','taro-vencido'];
/** The Pack weapons the sim runs: in the catalog, in the inventory and in the crates. */
export const PACK12_PLAYABLE:ReadonlySet<string>=new Set([...A1_PLAYABLE,...A2_PLAYABLE]);
