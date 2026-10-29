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
import {allItemDisplays,itemDisplay} from '../hud/items.ts';
import {artPages,artPiece,artUrl,type ArtFile} from '../art/manifest.ts';
import {GOLD_LEVEL} from '../ui/sticker.ts';
import {A2_FIRE_LOOK,A2_ITEMS,A2_PROJECTILE_ALIAS,A2_PROJECTILE_STICKER} from './arsenal-a2-look.ts';
import {CONE_ART_ID,CONE_ART_KEY} from './melee-cone.ts';

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
/**
 * Card caixa-icone-torre-arma (the user, 23/10: "vamos pôr o item flutuando e girando"): a crate whose view names its
 * item (PickupView.resource, sim/crates.ts rolls it when the crate appears) is drawn as that item's own sticker instead
 * of the crate sheet, floating over the spot and turning like a coin (its width is the cosine of the turn: no new art),
 * with no rarity colour (the rarity shows only when it opens). FLOAT_PX: the sticker's size at body 1 (CSS px, about
 * half the crate's width, so it reads on a phone); FLOAT_LIFT ± FLOAT_BOB: its centre over the ground; one bob in
 * FLOAT_BOB_MS, one turn in FLOAT_TURN_MS, FLOAT_TURN_OPEN× faster when a hero has it all but open.
 */
export const FLOAT_PX=120,FLOAT_LIFT=50,FLOAT_BOB=8,FLOAT_BOB_MS=2400,FLOAT_TURN_MS=2800,FLOAT_TURN_OPEN=3;
/**
 * On a phone (the user, 23/10: "aumentar o item flutuando no celular até ficar legível") the floating item grows with the
 * square of the horde's legibility multiplier over the body scale (framing.ts hordeUiScale: 1 on the PC, ~1.25 at a
 * phone's zoom, so ~1.55×: the plain multiplier read too small), capped at FLOAT_PHONE_MAX; its lift and shadow grow with it.
 */
export const FLOAT_PHONE_MAX=1.8;
export const floatLegible=(ui:number,body:number)=>Math.max(1,Math.min(FLOAT_PHONE_MAX,(ui/Math.max(1e-6,body))**2));
/** The thinnest the coin gets (edge on): a sliver, never gone (its glow and its shadow stay). */
export const FLOAT_EDGE=.08;
/** The turn after `dt` ms at opening `progress` (0..1): the angle advances, faster as the opening fills. */
export const floatSpin=(angle:number,dt:number,progress:number)=>
  (angle+Math.max(0,dt)*Math.PI*2/FLOAT_TURN_MS*(1+FLOAT_TURN_OPEN*Math.max(0,Math.min(1,progress))))%(Math.PI*2);
/**
 * The floating item's pose: `lift` (CSS px over the ground at body 1), `turn` (its horizontal scale: the coin's width,
 * negative when its back faces us) and `shadow` (the ground shadow's scale: narrower as the coin turns edge on and as
 * the item rises). Reduced motion: still, facing us, at FLOAT_LIFT.
 */
export function floatPose(now:number,phase:number,angle:number,reduced=false):{lift:number;turn:number;shadow:number}{
  if(reduced)return {lift:FLOAT_LIFT,turn:1,shadow:1};
  const bob=Math.sin(now*Math.PI*2/FLOAT_BOB_MS+phase*Math.PI*2),c=Math.cos(angle);
  const turn=(c<0?-1:1)*Math.max(FLOAT_EDGE,Math.abs(c));
  return {lift:FLOAT_LIFT+FLOAT_BOB*bob,turn,shadow:(.55+.45*Math.abs(c))*(1-.12*bob)};
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
 * bau-mostra-o-premio: what a crate gave, from the views alone (the 'pickup' chest event carries only the rarity). The sim
 * (sim/crates.ts open) puts the prize in the opener's inventory in the same tick it emits the event, or, full, drops it
 * on the ground at the crate (inventory.ts dropItem). So per view: each hero's gains (a new slot, or a stack that grew)
 * and the new items on the ground; the event then claims its hero's latest gain, or the item that fell at its crate.
 */
export const PRIZE_CLAIM_MS=1500;
/** A dropped prize lies exactly at the crate; the crate as drawn may have drifted a little. */
export const PRIZE_DROP_REACH=.75;
type Owned={readonly id:string;readonly level:number};
/** The ids `after` gained over `before`: a slot more of an id (a weapon, a kit), else a stack that grew (a consumable). */
export function inventoryGains(before:readonly Owned[]|undefined,after:readonly Owned[]):string[]{
  if(!before)return [];
  const count=(list:readonly Owned[])=>{const m=new Map<string,{slots:number;sum:number}>();for(const o of list){const c=m.get(o.id)??{slots:0,sum:0};c.slots++;c.sum+=o.level;m.set(o.id,c);}return m;};
  const was=count(before),slots:string[]=[],stacks:string[]=[];
  for(const [id,now] of count(after)){
    const old=was.get(id);
    if(!old||now.slots>old.slots)slots.push(id);
    else if(now.sum>old.sum&&!isWeaponItem(id))stacks.push(id);
  }
  return [...slots,...stacks];
}
export class ChestPrizes{
  private inv=new Map<string,Owned[]>();
  private gains=new Map<string,{id:string;at:number}[]>();
  private ground=new Set<string>();
  private drops:{id:string;item:string;x:number;y:number;at:number}[]=[];
  /** Per authoritative view: every hero's inventory and the items on the ground. */
  observe(players:readonly {id:string;weapons:readonly Owned[]}[],pickups:readonly {id:string;kind:string;resource?:string;x:number;y:number}[],now:number){
    for(const p of players){
      for(const id of inventoryGains(this.inv.get(p.id),p.weapons)){const list=this.gains.get(p.id)??[];list.push({id,at:now});this.gains.set(p.id,list);}
      this.inv.set(p.id,p.weapons.map(o=>({id:o.id,level:o.level})));
    }
    const ground=new Set<string>();
    for(const k of pickups){
      if(k.kind!=='item'||!k.resource)continue;
      ground.add(k.id);
      if(!this.ground.has(k.id))this.drops.push({id:k.id,item:k.resource,x:k.x,y:k.y,at:now});
    }
    this.ground=ground;
    for(const [id,list] of this.gains){const fresh=list.filter(g=>now-g.at<=PRIZE_CLAIM_MS);if(fresh.length)this.gains.set(id,fresh);else this.gains.delete(id);}
    this.drops=this.drops.filter(d=>now-d.at<=PRIZE_CLAIM_MS);
  }
  /** The prize `player` took from the crate at world `at` (claimed once), or undefined while no view showed it yet. */
  claim(player:string,at:{x:number;y:number}|undefined,now:number):string|undefined{
    // The newest gain: the crate's prize comes in the event's own view, an older one was something else.
    const list=this.gains.get(player);
    if(list)for(let g=list.length-1;g>=0;g--)if(now-list[g].at<=PRIZE_CLAIM_MS)return list.splice(g,1)[0].id;
    if(!at)return undefined;
    let best=-1,bestD=PRIZE_DROP_REACH;
    for(let i=0;i<this.drops.length;i++){const d=Math.hypot(this.drops[i].x-at.x,this.drops[i].y-at.y);if(d<=bestD){best=i;bestD=d;}}
    return best>=0?this.drops.splice(best,1)[0].item:undefined;
  }
}
export interface PrizeLook {id:string;icon?:string;name:string;color:number;glow:number}
/** Glow behind the sticker per rarity (stronger on the gold and the legendary ones). */
export const PRIZE_GLOW:Readonly<Record<Rarity,number>>={1:.35,2:.45,3:.6,4:.9,5:1};
/** The prize as the crate shows it: its inventory sticker, its name in the crate's rarity colour, the glow behind. */
export function prizeLook(id:string,rarity:Rarity,colors:Readonly<Record<Rarity,number>>=RARITY_COLOR):PrizeLook{
  const item=itemDisplay(id);
  return {id,icon:goldIcon(item.icon,rarity),name:item.name,color:colors[rarity],glow:PRIZE_GLOW[rarity]};
}
/** The prize's life (ms): it rises out of the crate fading in, with a hop; stays; fades out drifting up. */
export const PRIZE_RISE_MS=600,PRIZE_HOLD_MS=1200,PRIZE_FADE_MS=350,PRIZE_MS=PRIZE_RISE_MS+PRIZE_HOLD_MS+PRIZE_FADE_MS;
/** Sticker width (CSS px at body 1): the opener's own prize, and a smaller one for a crate another hero opened. */
export const PRIZE_PX={own:110,other:60} as const;
/**
 * The prize at `age` ms: alpha, lift (0 inside the crate, 1 up in the air; past 1 the hop) and scale, or undefined once
 * gone. Reduced motion: no hop, no drift.
 */
export function prizeMotion(age:number,reduced=false):{alpha:number;lift:number;scale:number}|undefined{
  if(age<0||age>=PRIZE_MS)return undefined;
  if(age<PRIZE_RISE_MS){
    const u=age/PRIZE_RISE_MS,c=1.9,back=1+(c+1)*(u-1)**3+c*(u-1)**2; // easeOutBack: over the top, then down to rest
    return {alpha:Math.min(1,u/.55),lift:reduced?1-(1-u)**3:back,scale:.6+.4*Math.min(1,u/.7)};
  }
  if(age<PRIZE_RISE_MS+PRIZE_HOLD_MS)return {alpha:1,lift:1,scale:1};
  const v=(age-PRIZE_RISE_MS-PRIZE_HOLD_MS)/PRIZE_FADE_MS;
  return {alpha:1-v,lift:reduced?1:1+.12*v,scale:1};
}
/**
 * Where the prize may sit on screen, as fractions of the camera's view: off the HUD's corners and bottom (the Atacar
 * button and the inventory bar on the phone, the inventory on the PC), under the top bar.
 */
export const PRIZE_SAFE={left:.1,right:.9,top:.12,bottom:.64} as const;
/**
 * A prize centre `(x,y)` (camera space) kept inside PRIZE_SAFE of the view `{x,y,width,height}`, and `half` wide on each
 * side (its name) inside the view's edges.
 */
export function prizeSpot(x:number,y:number,view:{x:number;y:number;width:number;height:number},out:{x:number;y:number},half=0){
  const lo=Math.max(view.x+view.width*PRIZE_SAFE.left,view.x+half),hi=Math.min(view.x+view.width*PRIZE_SAFE.right,view.x+view.width-half);
  out.x=lo>hi?view.x+view.width/2:Math.min(hi,Math.max(lo,x));
  out.y=Math.min(view.y+view.height*PRIZE_SAFE.bottom,Math.max(view.y+view.height*PRIZE_SAFE.top,y));
  return out;
}

/**
 * Pack 12 fatia A1 (arsenal-completo-no-bau, sim/weapons/pack12.ts A1_PLAYABLE): the weapons on the sim's own patterns.
 * Their shots wear their `projeteis` piece (PACK12_A1_ALIAS); the thrown ones (traque, tijolo) burst with an `efeitos`
 * strip (FIRE_LOOK); the straight shots show no flash (the rings left the game: sem-arma-girando-no-chao).
 */
export const PACK12_A1_ITEMS:readonly string[]=['baladeira','espeto','sacole','tampa-voadora','buscape','traque',
  'tijolo-baiano','taro-vencido'];
/** Every Pack 12 weapon the client shows (fatia A1 and A2). */
export const PACK12_ITEMS:readonly string[]=[...PACK12_A1_ITEMS,...A2_ITEMS];
/** Weapon id → its `projeteis` piece (the Pack's id; the two renamed beside their tomes wear the Pack's art). */
const PACK12_A1_ALIAS:readonly (readonly [string,string])[]=PACK12_A1_ITEMS.map(id=>[id,id==='baladeira'?'estilingue':id==='tampa-voadora'?'tampa-de-panela':id] as const);
/** The arsenal's items (sim/weapons/arsenal.ts, sim/inventory.ts): hud/items.ts entries the D-051 card added. */
export const ARSENAL_ITEMS:readonly string[]=['faca','pistola','escopeta','submetralhadora','rifle','macarico','rojao',
  'boleto-lendario','cafe-lendario','guarda-chuva-lendario','pombo-lendario','audio-lendario',
  'coxinha','brigadeiro','pacoca','cocada','kit-torre','pente',
  // Kits de torre (torre-pela-caixa): the tower's sticker on the ground.
  ...KIT_IDS,
  // Pack 12 (arsenal-completo-no-bau): the weapons the sim runs (fatia A2: render/arsenal-a2-look.ts).
  ...PACK12_ITEMS];
/** hud/items.ts by id (an id the HUD does not know has no sticker here). */
const KNOWN=new Map(allItemDisplays().map(i=>[i.id,i]));
/** Texture key of a `ui` sticker loaded for the arsenal. */
export const iconKey=(icon:string)=>`arsenal:ui:${icon}`;
/**
 * The sticker of an item id (its hud/items.ts icon), or undefined for an id the HUD does not know. A weapon at the
 * dourada level (4) wears its `<icon>-dourada` edition when that ui piece is in (caixa-gamble-raridade).
 */
export const itemIcon=(id:string|undefined,level=1):string|undefined=>{
  const icon=id?KNOWN.get(id)?.icon:undefined;
  return icon?goldIcon(icon,level):undefined;
};
/** An icon at a level: its dourada edition at level 4 when the art index has `ui/<icon>-dourada`, else itself. */
export const goldIcon=(icon:string,level:number)=>level===GOLD_LEVEL&&fileOf('ui',`${icon}-dourada`)?`${icon}-dourada`:icon;
/** The plain weapon icon of a sticker that may be its dourada edition (the hand's grip table is by the plain one). */
export const plainIcon=(icon:string)=>icon.endsWith('-dourada')?icon.slice(0,-'-dourada'.length):icon;
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
 *  - slash: the painted crescent `corte-faca` swung in front of the hero (the faca); without it, today's Papel arc.
 * `size`: CSS px of one frame at the endless map's scale (times the actor scale), `ms`: how long the strip plays.
 */
export interface FireLook {art?:string;kind:'muzzle'|'cone'|'blast'|'slash';size:number;ms:number;reach?:number}
export const FIRE_LOOK:Readonly<Record<string,FireLook>>={
  // melee-alcance-2x: the faca reaches twice as far, so its arc is twice as big (and SLASH_AHEAD twice as far out).
  faca:{kind:'slash',art:'corte-faca',size:140,ms:160},
  pistola:{art:'clarao-pistola',kind:'muzzle',size:80,ms:110},
  submetralhadora:{art:'clarao-metralhadora',kind:'muzzle',size:70,ms:80},
  rifle:{art:'clarao-fuzil',kind:'muzzle',size:96,ms:130},
  // BUG-20261023-ORQ-armas-sem-projetil: the shotgun's flash stays at the barrel; its pellets fly (render/shot-flight.ts).
  escopeta:{art:'clarao3-escopeta',kind:'muzzle',size:150,ms:420},
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
/** tiros-realistas-chatgpt: the shotgun pellet's painted streak, and the dust puff where each pellet ends. */
export const PELLET_ART='risco3';
export const PELLET_HIT:FireLook={art:'impacto3-neve',kind:'blast',size:72,ms:750};
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
  ['boleto-lendario','boleto-evo'],['cafe-lendario','cafe-evo'],
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
/**
 * BUG-20261023-ORQ-armas-sem-projetil (usuário 23/10: "nem aparece o projétil indo"): the other firearms' bullets were
 * as thin as the pistol's before ×5. The rifle ×4 and the metralhadora ×3 (a burst of many, smaller); look only.
 */
const DEFAULT_SHOT_SOURCES:ReadonlyMap<string,number>=new Map([['pistola',DEFAULT_SHOT_DRAW_SCALE],['rifle',4],['submetralhadora',3]]);
/**
 * Pack 12 fatia A1: the lobbed ones (traque, tijolo) land as a zone as wide as their burst, and the zone wears the thrown
 * object's piece: drawn at the burst's size it was a giant brick. This factor brings the object back to its size (the
 * layer scales a piece by the zone's radius, up to 3×); the burst itself is FIRE_LOOK's blast.
 */
const LOBBED_DRAW_SCALE:ReadonlyMap<string,number>=new Map([['traque',.4],['tijolo-baiano',.35],
  // BUG-20261023-ORQ-armas-sem-projetil: the rocket now flies (render/shot-flight.ts), at about a firework's size.
  ['rojao',.35]]);
/** Draw-scale factor of a projectile (layers.ts): a hero's firearm bullet's (DEFAULT_SHOT_SOURCES), a lobbed object's, else 1. */
export const shotDrawScale=(hostile:boolean,source:string)=>hostile?1:DEFAULT_SHOT_SOURCES.get(source)??LOBBED_DRAW_SCALE.get(source)??1;

/** The crate's ground ring (efeitos `anel-caixa`, white, tinted by arsenal-fx.ts in the rarity colour). */
export const CRATE_RING_ID='anel-caixa',CRATE_RING_KEY='arsenal:fx:anel-caixa';
/** One arsenal texture to load: an image (sticker) or a strip cut in square frames. */
export interface ArsenalLoad {key:string;url:string;strip:boolean}
const firstPageUrl=(group:'ui'|'efeitos',file:ArtFile|undefined)=>{const page=file&&artPages(file)[0];return page?artUrl(group,page.file):undefined;};
const fileOf=(group:'ui'|'efeitos',id:string)=>{const piece=artPiece(group,id);if(!piece)return undefined;return piece.files.sheet??Object.values(piece.files)[0];};
/**
 * The arsenal's textures in the current manifest (an absent piece is skipped): every item sticker and every shot strip.
 * The stickers come with the scene's preload of a manual room (scene.ts: the map opens with crates showing their item;
 * the waiting room fetches them first, preload/match-assets.ts); the rest is queued once, the first time a view shows
 * the manual combat (render/arsenal-fx.ts). A match with the automatic weapons downloads none of it.
 */
export function arsenalLoads():ArsenalLoad[]{
  const out:ArsenalLoad[]=[],seen=new Set<string>();
  for(const id of ARSENAL_ITEMS){
    const plain=itemIcon(id);if(!plain||seen.has(plain))continue;
    // The weapon's sticker and, where it is in, its dourada edition (goldIcon).
    for(const icon of [plain,goldIcon(plain,GOLD_LEVEL)]){
      if(seen.has(icon))continue;seen.add(icon);
      const url=firstPageUrl('ui',fileOf('ui',icon));if(url)out.push({key:iconKey(icon),url,strip:false});
    }
  }
  const ring=firstPageUrl('efeitos',fileOf('efeitos',CRATE_RING_ID));if(ring)out.push({key:CRATE_RING_KEY,url:ring,strip:false});
  // The melee aim cone's piece (melee-cone.ts), one image laid on the sector.
  const cone=firstPageUrl('efeitos',fileOf('efeitos',CONE_ART_ID));if(cone)out.push({key:CONE_ART_KEY,url:cone,strip:false});
  // tiros-realistas-chatgpt: the painted pellet streak and its puff where it lands.
  for(const id of [PELLET_ART,PELLET_HIT.art!]){const url=firstPageUrl('efeitos',fileOf('efeitos',id));if(url)out.push({key:fxKey(id),url,strip:id!==PELLET_ART});seen.add(id);}
  for(const look of Object.values(FIRE_LOOK)){
    if(!look.art||seen.has(look.art))continue;seen.add(look.art);
    const url=firstPageUrl('efeitos',fileOf('efeitos',look.art));if(url)out.push({key:fxKey(look.art),url,strip:true});
  }
  return out;
}
