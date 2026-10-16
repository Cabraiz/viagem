/**
 * D-051 arsenal (NEW-20261014-ORQ-armas-caixas-inventario, plans/armas-caixas-inventario-proposta.md): the weapons of the
 * manual combat, from the Faca de Pão to the Rojão de Réveillon, by rarity, plus the legendaries (the six weapons of
 * the automatic game, at their best, with their art) and the consumables of the inventory. Pure data and lookups.
 *
 * An inventory item is an OwnedItem whose `level` is its RARITY for a weapon (1 verde, 2 azul, 3 roxa, 4 dourada,
 * 5 lendária) and its STACK for a consumable. A new weapon's table has one row per rarity it comes in (index = rarity
 * - 1; its `minRarity` is the lowest a crate rolls); a legendary has rarity 5 only. The weapons system resolves a row
 * with resolveWeapon like any weapon. `noise` (world units) is how far a shot is heard (the D-051 nests read it).
 */
import type {ItemDef} from '../../contract/index.ts';
import type {WeaponDef,WeaponLevel} from './catalog.ts';
import {SILENCER_PER_LEVEL} from '../../rules/index.ts';

export type Rarity=1|2|3|4|5;
export const RARITIES:readonly Rarity[]=[1,2,3,4,5];
/** pt-BR rarity names (the crate colours). */
export const RARITY_NAME:Readonly<Record<Rarity,string>>={1:'verde',2:'azul',3:'roxa',4:'dourada',5:'lendária'};
/** Rarity multipliers over a weapon's verde row: damage up, cooldown down (proposal table; the CI bench tunes them). */
export const RARITY_DAMAGE:Readonly<Record<Rarity,number>>={1:1,2:1.15,3:1.3,4:1.5,5:1.75};
export const RARITY_COOLDOWN:Readonly<Record<Rarity,number>>={1:1,2:.95,3:.9,4:.85,5:.8};
export const isRarity=(n:unknown):n is Rarity=>n===1||n===2||n===3||n===4||n===5;

/**
 * D-051 noise radii (world units; the ninhos proposal's §3 table, at the ~49 u camera and the 1.7× city), the scale the
 * nests' sleep reads (E2: imports these, never duplicates them). The submachine gun and the blowtorch sit between their
 * neighbours; the legendaries and any weapon the arsenal does not list, DEFAULT_NOISE.
 */
export const NOISE={faca:6,pistola:12,submetralhadora:15,escopeta:18,rifle:22,macarico:12,rojao:28} as const;
export interface ArsenalWeapon extends WeaponDef {
  /** Lowest rarity a crate gives it in (the faca is the starting one, verde). */
  minRarity:Rarity;
  /** How far one shot is heard, world units (0: silent). */
  noise:number;
}

const row=(damage:number,cooldown:number,amount:number,area:number,speed:number,duration:number,pierce:number,knockback:number,hitInterval:number,range:number):WeaponLevel=>
  ({damage,cooldown,amount,area,speed,duration,pierce,knockback,hitInterval,range});
/**
 * Every arsenal weapon's damage over its table row (the 16/10 bench: with the faca to start and the firearms from the
 * crates, ×1 loses the team in round 3-4; ×1.6 gave 6p 2/16 against 5/16 at ×2: the team-size gap is the manual
 * city balance's, MANUAL_CITY_BALANCE).
 */
export const ARSENAL_DAMAGE=2;
/** Rows for rarities 1..4 from the verde row (rarity < minRarity keeps the verde numbers: never rolled anyway). */
const byRarity=(base:WeaponLevel):WeaponLevel[]=>([1,2,3,4] as const).map(r=>({...base,damage:Math.round(base.damage*ARSENAL_DAMAGE*RARITY_DAMAGE[r]*10)/10,cooldown:Math.round(base.cooldown*RARITY_COOLDOWN[r]*1000)/1000}));
const describe=(intro:string)=>(level:number)=>`${intro} (${RARITY_NAME[(isRarity(level)?level:1) as Rarity]})`;
const weapon=(def:Omit<ArsenalWeapon,'kind'|'maxLevel'|'levels'|'describe'>&{verde:WeaponLevel;intro:string}):ArsenalWeapon=>{
  const {verde,intro,...rest}=def;
  return {...rest,kind:'weapon',maxLevel:4,levels:byRarity(verde),describe:describe(intro)};
};

/**
 * The seven weapons (proposal §1). Every verde row deals about 25 a second to one target (the crowd patterns to each one
 * in their cone or blast): reach, pierce and the crowd make the difference, and the rarity scales it (a weapon that only
 * comes azul or better starts there). The CI bench tunes them. Speeds and durations are the tuned table values (travelling patterns fly
 * PROJECTILE_SPEED_MULT × faster for 1 / it the time: the same reach, speed × duration).
 */
/** Noise of a legendary and of a weapon the arsenal does not list (the automatic game's): a pistol's. */
export const DEFAULT_NOISE=NOISE.pistola;
export const NEW_WEAPONS:readonly ArsenalWeapon[]=[
  weapon({id:'faca',name:'Faca de Pão',icon:'faca',pattern:'cone',coneHalfAngle:1,minRarity:1,noise:NOISE.faca,
    quip:'Corta pão, corta bicho.',intro:'Golpe em arco bem de perto. Não faz barulho nenhum.',
    //           dmg  cd  amt area spd dur pierce kb  hit  range
    verde:row(12,.5,1,1.3,0,.15,1e6,.3,.2,1.3)}),
  weapon({id:'pistola',name:'Trinta-e-Oitão do Vô',icon:'pistola',pattern:'pierce',minRarity:1,noise:NOISE.pistola,
    quip:'Tava guardada no armário desde 1987.',intro:'Um tiro certeiro no bicho mais perto.',
    verde:row(15,.6,1,.22,10,.7,0,.2,.5,7)}),
  weapon({id:'escopeta',name:'Espalha-Chumbo',icon:'escopeta',pattern:'cone',coneHalfAngle:.45,minRarity:2,noise:NOISE.escopeta,
    quip:'Mira? Pra quê?',intro:'Leque de chumbo de perto: estrago em quem estiver na frente.',
    verde:row(28,1.1,1,4,0,.15,1e6,.6,.2,4)}),
  weapon({id:'submetralhadora',name:'Metralhadora de Feira',icon:'submetralhadora',pattern:'pierce',minRarity:2,noise:NOISE.submetralhadora,
    quip:'Três por dez, freguesa!',intro:'Rajada rápida de tiro fraquinho.',
    verde:row(6,.2,1,.18,11,.55,0,.05,.5,6)}),
  weapon({id:'rifle',name:'Cano Longo',icon:'rifle',pattern:'pierce',minRarity:3,noise:NOISE.rifle,
    quip:'Acerta o bicho e o vizinho dele.',intro:'Tiro de longe que atravessa a fila de bichos.',
    verde:row(36,1.1,1,.25,16,.7,3,.4,.5,11)}),
  weapon({id:'macarico',name:'Maçarico do Tio',icon:'macarico',pattern:'cone',coneHalfAngle:.5,minRarity:3,noise:NOISE.macarico,
    quip:'Era pra soldar o portão.',intro:'Fogo contínuo bem na frente: derrete enxame.',
    verde:row(5,.2,1,3.5,0,.15,1e6,0,.2,3.5)}),
  weapon({id:'rojao',name:'Rojão de Réveillon',icon:'rojao',pattern:'zone',minRarity:4,noise:NOISE.rojao,
    quip:'Feliz ano novo, bicharada!',intro:'Explode em área onde cair. Demora pra recarregar e todo mundo escuta.',
    verde:row(80,2.8,1,2,0,.3,1e6,1,1,9)}),
];

/** The legendaries' extra damage over the weapon (or its evolution) they come from. */
export const LEGENDARY_DAMAGE=1.6;
/** Legendary item id of an automatic-game weapon. */
export const legendaryId=(base:string)=>`${base}-lendario`;

/**
 * The six legendaries (proposal §1, answer 2: the old weapons, only from nests and the chefe): a weapon that has an
 * evolution is its evolution (Havaianas do Caos, Carnê Infinito, Cafeteira Industrial), the others their level-8 row;
 * damage × LEGENDARY_DAMAGE, rarity 5 only. Same icon (the art stays).
 */
export function legendaryWeapons(catalog:{get(id:string):WeaponDef|undefined},bases:readonly string[]):ArsenalWeapon[]{
  const out:ArsenalWeapon[]=[];
  for(const base of bases){
    const def=catalog.get(base),evo=catalog.get(`${base}-evo`);
    if(!def)continue;
    const from=evo??def,top=from.levels[from.levels.length-1];
    const legend={...top,damage:Math.round(top.damage*LEGENDARY_DAMAGE*10)/10};
    out.push({...from,id:legendaryId(base),kind:'weapon',name:def.name,icon:from.icon,maxLevel:5,levels:Array(5).fill(legend),
      minRarity:5,noise:DEFAULT_NOISE,base:undefined,passive:undefined,describe:()=>`Lendária! ${from.describe(1)}`});
  }
  return out;
}

/** D-051 consumables (proposal §2-3): stack up to CONSUMABLE_STACK in one slot. */
export const CONSUMABLE_STACK=3;
export type ConsumableId='coxinha'|'brigadeiro'|'pacoca'|'cocada'|'kit-torre';
export const CONSUMABLE_IDS:readonly ConsumableId[]=['coxinha','brigadeiro','pacoca','cocada','kit-torre'];
export interface ConsumableDef extends ItemDef {kind:'consumable';id:ConsumableId}
const consumable=(id:ConsumableId,name:string,text:string):ConsumableDef=>({id,kind:'consumable',name,icon:id,maxLevel:CONSUMABLE_STACK,describe:()=>text});
export const CONSUMABLES:Readonly<Record<ConsumableId,ConsumableDef>>={
  coxinha:consumable('coxinha','Coxinha','Cura 30 de vida.'),
  brigadeiro:consumable('brigadeiro','Brigadeiro','Mais rápido por 30 s.'),
  pacoca:consumable('pacoca','Paçoca','Mais dano por 30 s.'),
  cocada:consumable('cocada','Cocada','Toma menos dano por 30 s.'),
  'kit-torre':consumable('kit-torre','Kit de Torre','Vira 1 ficha de torre do time.'),
};
export const isConsumableId=(id:string):id is ConsumableId=>(CONSUMABLE_IDS as readonly string[]).includes(id);


/**
 * D-051: how far a shot of `weaponId` is heard (world units), after the Silenciador de Garagem (SILENCER_PER_LEVEL a
 * level, never below 0). The D-051 nests (E1) read it on the 'fire' event's weapon.
 */
export function weaponNoise(weaponId:string,passives:readonly {id:string;level:number}[]=[]){
  const base=(ARSENAL_BY_ID.get(weaponId)?.noise)??DEFAULT_NOISE;
  const silencer=passives.find(p=>p.id==='silenciador')?.level??0;
  return Math.max(0,base*(1-SILENCER_PER_LEVEL*silencer));
}
const ARSENAL_BY_ID:ReadonlyMap<string,ArsenalWeapon>=new Map(NEW_WEAPONS.map(w=>[w.id,w]));
