/**
 * D-051 arsenal on screen (NEW-20261016-ORQ-armas-caixas-render, bloco 8 do PLANO): pure rules for the crates on the
 * ground (sim/crates.ts), the items dropped on the ground (PickupKind 'item'), the weapon in each hero's hand and the
 * shot of each arsenal weapon. render/arsenal-fx.ts draws them; nothing here touches Phaser, so node tests run it.
 *
 * Only imported art is used (no art = the old look stays): the crate is base `caixa-saque` (rows fechada, abrindo-1..6),
 * the items and the hand wear their `ui` sticker (hud/items.ts icon), the shots their `efeitos` strip (frames side by
 * side, square: frame size = strip height) and their `projeteis` piece (art/horde-art.ts aliases).
 */
import {CRATE_OPEN_RADIUS,KIT_IDS} from '../../rules/index.ts';
import {allItemDisplays} from '../hud/items.ts';
import {artPages,artPiece,artUrl,type ArtFile} from '../art/manifest.ts';
import {A2_FIRE_LOOK,A2_ITEMS,A2_PROJECTILE_ALIAS,A2_PROJECTILE_STICKER} from './arsenal-a2-look.ts';

export type Rarity=1|2|3|4|5;
export const rarityOf=(value:number):Rarity=>Math.min(5,Math.max(1,Math.round(Number.isFinite(value)?value:1))) as Rarity;
/** The crate colours (sim/weapons/arsenal.ts RARITY_NAME: verde, azul, roxa, dourada, lendária) as design tokens. */
export const RARITY_TOKEN:Readonly<Record<Rarity,string>>={1:'--arte-verde',2:'--arte-azul',3:'--arte-roxo',4:'--arte-dourado',5:'--c-amarelo'};
/** The same colours when the tokens are not there (node tests, a page without tokens.css). */
export const RARITY_COLOR:Readonly<Record<Rarity,number>>={1:0x3eaa4f,2:0x3f86d9,3:0x8e4fb8,4:0xe39a3b,5:0xffd23f};
export const RARITY_NAME:Readonly<Record<Rarity,string>>={1:'Verde',2:'Azul',3:'Roxa',4:'Dourada',5:'Lendária'};

/**
 * The sim's crate numbers, mirrored (the client never imports src/sim; tests/client/arsenal-render.test.ts checks them
 * against sim/crates.ts): reach to open and seconds to open by rarity.
 */
export const CRATE_OPEN_REACH=CRATE_OPEN_RADIUS;
export const CRATE_OPEN_SECONDS:readonly number[]=[1,1.5,2,2.5,3];
export const crateOpenSeconds=(rarity:number)=>CRATE_OPEN_SECONDS[rarityOf(rarity)-1];
/** The crate's art (art/base-art.ts BASE_ART.crate) and its opening rows. */
export const CRATE_ART='caixa-saque';
export const CRATE_OPEN_ROWS=6;
/** Row of the crate sheet for an opening `progress` (0..1): 'fechada' at 0, then abrindo-1..6. */
export function crateRow(progress:number):string{
  if(!(progress>0))return 'fechada';
  return `abrindo-${Math.min(CRATE_OPEN_ROWS,Math.max(1,Math.ceil(progress*CRATE_OPEN_ROWS)))}`;
}
/** Opening progress (0..1) of a hero standing still `stillMs` within reach of a crate of `rarity`. */
export const crateProgress=(stillMs:number,rarity:number)=>Math.max(0,Math.min(1,stillMs/1000/crateOpenSeconds(rarity)));
/** A hero moved this far (world units) between frames: not standing still (the sim's rule is "same position"). */
export const STILL_EPS=.02;

/**
 * The crates' opening as every client sees it: the sim's per-player opening (sim/crates.ts) predicted for each hero who
 * can open, the local one and the others alike, from the positions drawn (render/arsenal-fx.ts). Per hero: where it
 * stood, since when it stands still, the crate in reach (and since when) and the frame it was last at it. Moving, a hit
 * ('damage' on it) or leaving the crate starts over; a crate with several heroes shows the most advanced.
 */
export class CrateOpenings{
  private heroes=new Map<string,{x:number;y:number;stillSince:number;crate?:string;since:number;at:number}>();
  private now=0;private last=0;
  /** Start of a frame: the heroes who can open now and where each is drawn. */
  begin(now:number,ids:Iterable<string>,locate:(id:string)=>{x:number;y:number}|undefined){
    this.last=this.now;this.now=now;
    const live=new Set<string>();
    for(const id of ids){
      const p=locate(id);if(!p)continue;
      live.add(id);
      const o=this.heroes.get(id);
      if(!o){this.heroes.set(id,{x:p.x,y:p.y,stillSince:now,since:now,at:now});continue;}
      if(Math.hypot(p.x-o.x,p.y-o.y)>STILL_EPS){o.stillSince=now;o.x=p.x;o.y=p.y;}
      // Not at its crate last frame (walked off, the crate went): the next one starts over.
      if(o.at!==this.last)o.crate=undefined;
    }
    for(const id of this.heroes.keys())if(!live.has(id))this.heroes.delete(id);
  }
  /** A hit on a hero: its standing still starts over. */
  hurt(id:string,now:number){const o=this.heroes.get(id);if(o)o.stillSince=now;}
  /** Opening progress (0..1) of the crate `id` at world (x,y) of rarity `value` this frame (each hero opens one at a time). */
  progress(id:string,x:number,y:number,value:number){
    let best=0;
    for(const o of this.heroes.values()){
      if(Math.hypot(o.x-x,o.y-y)>CRATE_OPEN_REACH||o.crate!==undefined&&o.crate!==id&&o.at===this.now)continue;
      if(o.crate!==id){o.crate=id;o.since=this.now;}
      o.at=this.now;
      best=Math.max(best,crateProgress(this.now-Math.max(o.stillSince,o.since),value));
    }
    return best;
  }
}

/**
 * Pack 12 fatia A1 (arsenal-completo-no-bau, sim/weapons/pack12.ts A1_PLAYABLE): the weapons on the sim's own patterns.
 * Their shots wear their `projeteis` piece (PACK12_A1_ALIAS); the thrown ones (traque, tijolo) burst with an `efeitos`
 * strip (FIRE_LOOK); the straight shots and the rings show no flash.
 */
export const PACK12_A1_ITEMS:readonly string[]=['baladeira','espeto','sacole','tampa-voadora','pandeiro','buscape','traque','figa',
  'vela-esoterica','tijolo-baiano','taro-vencido'];
/** Every Pack 12 weapon the client shows (fatia A1 and A2). */
export const PACK12_ITEMS:readonly string[]=[...PACK12_A1_ITEMS,...A2_ITEMS];
/** Weapon id → its `projeteis` piece (the Pack's id; the two renamed beside their tomes wear the Pack's art). */
const PACK12_A1_ALIAS:readonly (readonly [string,string])[]=PACK12_A1_ITEMS.map(id=>[id,id==='baladeira'?'estilingue':id==='tampa-voadora'?'tampa-de-panela':id] as const);
/** The arsenal's items (sim/weapons/arsenal.ts, sim/inventory.ts): hud/items.ts entries the D-051 card added. */
export const ARSENAL_ITEMS:readonly string[]=['faca','pistola','escopeta','submetralhadora','rifle','macarico','rojao',
  'chinelo-lendario','boleto-lendario','cafe-lendario','guarda-chuva-lendario','pombo-lendario','audio-lendario',
  'coxinha','brigadeiro','pacoca','cocada','kit-torre','pente',
  // Kits de torre (torre-pela-caixa): the tower's sticker on the ground.
  ...KIT_IDS,
  // Pack 12 (arsenal-completo-no-bau): the weapons the sim runs (fatia A2: render/arsenal-a2-look.ts).
  ...PACK12_ITEMS];
/** hud/items.ts by id (an id the HUD does not know has no sticker here). */
const KNOWN=new Map(allItemDisplays().map(i=>[i.id,i]));
/** Texture key of a `ui` sticker loaded for the arsenal. */
export const iconKey=(icon:string)=>`arsenal:ui:${icon}`;
/** The sticker of an item id (its hud/items.ts icon), or undefined for an id the HUD does not know. */
export const itemIcon=(id:string|undefined):string|undefined=>id?KNOWN.get(id)?.icon:undefined;
/** Whether an item on the ground is a weapon (its `value` is then its rarity; a consumable's is its stack). */
export const isWeaponItem=(id:string|undefined)=>{const kind=id?KNOWN.get(id)?.kind:undefined;return kind==='weapon'||kind==='evolution';};
/**
 * D-052: a hero moving the car (ObjectiveView.car.movers) or on its rope has the hands on it and does not attack: no
 * weapon in the hand while so.
 */
export const handsOnCar=(car:{movers?:readonly string[];rope?:string}|undefined,id:string)=>!!car&&(car.rope===id||!!car.movers?.includes(id));

/**
 * What each arsenal weapon shows when it fires (the SimEvent 'fire': x/y the hero, dx/dy the aim; for 'zone' the
 * vector to the first target). `art` is an `efeitos` strip; `kind`:
 *  - muzzle: the flash at the barrel, along the aim (the bullets are the projectiles' art);
 *  - cone: the strip repeated along the aim, out to `reach` units (the blowtorch's flame, the shotgun's spread);
 *  - blast: at the target (the rojão's burst);
 *  - slash: no art, a Papel arc in front of the hero (the faca).
 * `size`: CSS px of one frame at the endless map's scale (times the actor scale), `ms`: how long the strip plays.
 */
export interface FireLook {art?:string;kind:'muzzle'|'cone'|'blast'|'slash';size:number;ms:number;reach?:number}
export const FIRE_LOOK:Readonly<Record<string,FireLook>>={
  // melee-alcance-2x: the faca reaches twice as far, so its arc is twice as big (and SLASH_AHEAD twice as far out).
  faca:{kind:'slash',size:140,ms:160},
  pistola:{art:'clarao-pistola',kind:'muzzle',size:80,ms:110},
  submetralhadora:{art:'clarao-metralhadora',kind:'muzzle',size:70,ms:80},
  rifle:{art:'clarao-fuzil',kind:'muzzle',size:96,ms:130},
  escopeta:{art:'clarao-espingarda',kind:'cone',size:70,ms:170,reach:1.6},
  macarico:{art:'fogo-pequeno',kind:'cone',size:62,ms:260,reach:2.2},
  rojao:{art:'explosao-m',kind:'blast',size:170,ms:620},
  // Pack 12 fatia A1: the festa-junina firecrackers pop in confetti sparks, the brick lands in a dust cloud.
  traque:{art:'fogos-estouro',kind:'blast',size:90,ms:420},
  'tijolo-baiano':{art:'impacto-poeira',kind:'blast',size:150,ms:520},
  ...A2_FIRE_LOOK,
};
/** How far ahead of the hero (u, along the aim) a slash's arc is centred (melee-alcance-2x: .5 doubled with the faca's reach). */
export const SLASH_AHEAD=1;
/** Texture key of an `efeitos` strip loaded for the arsenal. */
export const fxKey=(art:string)=>`arsenal:fx:${art}`;
/** Frame of a strip of `frames` frames `ageMs` into an effect of `ms` (the last one holds). */
export const fxFrame=(ageMs:number,ms:number,frames:number)=>frames<=1?0:Math.min(frames-1,Math.floor(Math.max(0,ageMs)/ms*frames));
/**
 * Frame of a shot's strip: a muzzle flash starts at its burst (the strip's first frame is the spark before it, and a
 * 110 ms flash at 60 fps would spend a third of its life on it); the others play the whole strip.
 */
export const shotFrame=(look:FireLook,ageMs:number,frames:number)=>look.kind==='muzzle'&&frames>2?1+fxFrame(ageMs,look.ms,frames-1):fxFrame(ageMs,look.ms,frames);
/** Copies of a cone's strip along the aim, from 0.5 u out to its reach (≈ one every 0.6 u). */
export const coneSteps=(reach:number)=>Math.max(1,Math.round((reach-.5)/.6)+1);

/**
 * The `projeteis` piece each arsenal weapon's shot wears (art/horde-art.ts PROJECTILE_ALIAS): the firearms their
 * bullets, the rojão its rocket, a legendary its old weapon's best art. The cones (faca, escopeta, maçarico) fire no
 * projectile; their look is FIRE_LOOK.
 */
export const ARSENAL_PROJECTILE_ALIAS:readonly (readonly [string,string])[]=[
  ['pistola','bala-revolver'],['submetralhadora','bala-metralhadora'],['rifle','bala-fuzil'],['rojao','rojao'],
  ['chinelo-lendario','chinelo-evo'],['boleto-lendario','boleto-evo'],['cafe-lendario','cafe-evo'],
  ['guarda-chuva-lendario','guarda-chuva'],['pombo-lendario','pombo'],['audio-lendario','audio'],
  ...PACK12_A1_ALIAS,...A2_PROJECTILE_ALIAS,
];
/**
 * Texture key of the `ui` sticker a projectile source wears instead of its `projeteis` piece (Pack 12 fatia A2: the
 * carro-de-som turret on the ground), or undefined. render/layers.ts uses it only once the sticker loaded.
 */
const STICKER_SOURCES:ReadonlyMap<string,string>=new Map(Object.entries(A2_PROJECTILE_STICKER).map(([source,icon])=>[source,iconKey(icon)]));
export const projectileSticker=(hostile:boolean,source:string):string|undefined=>hostile?undefined:STICKER_SOURCES.get(source);
/** `projeteis` pieces of the Pack 12 weapons (not in art/horde-art.ts WEAPON_PROJECTILE_IDS): loaded like those. */
export const PACK12_PROJECTILE_IDS:readonly string[]=[...new Set([...PACK12_A1_ALIAS,...A2_PROJECTILE_ALIAS].map(([,art])=>art))];

/**
 * Card melee-alcance-2x (usuário 22/10: "aumente tamanho do projétil default em 5x, eu quero ver ele visível"): the
 * heroes' default shot, the pistola's bullet (the first firearm a crate gives), is drawn this many times bigger.
 * Look only: at the old size (the 0.5 floor of a 64×8 sheet: 32×4 px) it was thinner than its hit circle (radius .22 u,
 * ~20 px across); ×5 its 20 px thickness is that circle, so the sim's hit area stays. Critters' shots never grow.
 */
export const DEFAULT_SHOT_DRAW_SCALE=5;
const DEFAULT_SHOT_SOURCES:ReadonlySet<string>=new Set(['pistola']);
/** Draw-scale factor of a projectile (layers.ts): DEFAULT_SHOT_DRAW_SCALE for a hero's default shot, else 1. */
export const shotDrawScale=(hostile:boolean,source:string)=>!hostile&&DEFAULT_SHOT_SOURCES.has(source)?DEFAULT_SHOT_DRAW_SCALE:1;

/** One arsenal texture to load: an image (sticker) or a strip cut in square frames. */
export interface ArsenalLoad {key:string;url:string;strip:boolean}
const firstPageUrl=(group:'ui'|'efeitos',file:ArtFile|undefined)=>{const page=file&&artPages(file)[0];return page?artUrl(group,page.file):undefined;};
const fileOf=(group:'ui'|'efeitos',id:string)=>{const piece=artPiece(group,id);if(!piece)return undefined;return piece.files.sheet??Object.values(piece.files)[0];};
/**
 * The arsenal's textures in the current manifest (an absent piece is skipped): every item sticker and every shot strip.
 * Queued once, the first time a view shows the manual combat (render/arsenal-fx.ts), never in the preload: a match with
 * the automatic weapons downloads none of it.
 */
export function arsenalLoads():ArsenalLoad[]{
  const out:ArsenalLoad[]=[],seen=new Set<string>();
  for(const id of ARSENAL_ITEMS){
    const icon=itemIcon(id);if(!icon||seen.has(icon))continue;seen.add(icon);
    const url=firstPageUrl('ui',fileOf('ui',icon));if(url)out.push({key:iconKey(icon),url,strip:false});
  }
  for(const look of Object.values(FIRE_LOOK)){
    if(!look.art||seen.has(look.art))continue;seen.add(look.art);
    const url=firstPageUrl('efeitos',fileOf('efeitos',look.art));if(url)out.push({key:fxKey(look.art),url,strip:true});
  }
  return out;
}
