/**
 * Imported art v2 for the critters' HUD icon and the allies' marks (NEW-20261012-ORQ-importar-arte-d-restos).
 * - Critter icon ("what got you": the revive banner's cause line, team.ts, and the result's "Te derrubou", result.ts):
 *   the `ui/inimigo-<id>` icon (128×128, scripts/art-v2/spec.mjs UI, P1: the board's inventory has no row for it yet);
 *   else frame 0 of the imported enemy's still animation, facing the camera (S); else today's procedural texture.
 * - Ally ground ring: the inventory has no ally variant, so it reuses the "Você" ring (`efeitos/heroi-voce`, the same
 *   MarkArt as render/you.ts) tinted Breu at today's 0.8 alpha, in place of today's Breu ellipse. The ally name ficha
 *   reuses the place plaque (`props/plaquinha`), see render/map-labels.ts.
 * With an empty manifest every helper answers undefined/false and nothing is created: today's drawing, byte for byte.
 * Pure helpers (CRITTER_ICON_IDS, critterIconSource, allyRingArt, ALLY_RING_*, labelPlaque) run in node; AllyRings imports Phaser
 * as a type only.
 */
import type Phaser from 'phaser';
import {artPiece} from './manifest.ts';
import {ENEMY_ART_ID,chooseAnim,enemyFrameAt} from './horde-art.ts';
import {markArt,markFrame,placeMark,sliceArt,type MarkArt,type SliceArt} from './frames-art.ts';
import {uiArtUrl} from '../ui/icon.ts';
import {ENEMY_KINDS,isEnemyKind,type EnemyKind} from '../render/keys.ts';
import {RING_SCALE} from '../render/you-rules.ts';

/** `ui` id of each critter's HUD icon: `inimigo-<inimigos id>`, built once. */
export const CRITTER_ICON_IDS:Readonly<Record<EnemyKind,string>>=Object.fromEntries(ENEMY_KINDS.map(k=>[k,`inimigo-${ENEMY_ART_ID[k]}`])) as Record<EnemyKind,string>;

/** Where a critter's icon comes from: an imported UI file (`url`), or a frame of a loaded enemy texture (`key`, `frame`). */
export type CritterIconSource={url:string}|{key:string;frame:number};
/**
 * Imported source of `kind`'s HUD icon, or undefined (today's procedural texture). Unknown kinds ('bichos') have none.
 * The enemy-sheet fallback is frame 0, row 0 (S: facing the camera) of the still animation chooseAnim picks.
 */
export function critterIconSource(kind:string):CritterIconSource|undefined{
  if(!isEnemyKind(kind))return undefined;
  const url=uiArtUrl(CRITTER_ICON_IDS[kind]);
  if(url)return {url};
  const id=ENEMY_ART_ID[kind],piece=artPiece('inimigos',id);
  const anim=piece&&chooseAnim(piece,false);
  const ref=piece&&anim?enemyFrameAt(id,piece,anim,0,0):undefined;
  return ref?{key:ref.key,frame:ref.frame}:undefined;
}

/**
 * The ally ring: an ellipse with a 2 px Breu edge at 0.8 alpha, × the figures' scale; RING_SCALE of the old 46×20, like
 * the hero's (BUG-20261013-ORQ-anel-voce-atras). It already sits under its figure (depth − 1).
 */
export const ALLY_RING_SIZE={width:46*RING_SCALE,height:20*RING_SCALE} as const;
export const ALLY_RING_WIDTH=ALLY_RING_SIZE.width+2,ALLY_RING_ALPHA=.8;
/** The ally ring's imported art: the "Você" ring (no ally variant in the inventory), always tinted. */
export const allyRingArt=():MarkArt|undefined=>markArt('you');

/**
 * The 9-slice behind a map label (render/map-labels.ts): place and ally names both use the place plaque (no ally variant
 * in the inventory); the caído's SOS ficha never does (its boia and Cone ring are drawn by code). Undefined: today's ficha.
 */
export const labelPlaque=(_kind:'place'|'ally',sos:boolean):SliceArt|undefined=>sos?undefined:sliceArt('plaque');

type Image=Phaser.GameObjects.Image;
/**
 * The allies' imported ground rings, one Image per ally id, made the first time that ally is drawn with the art loaded.
 * `draw` answers whether the art drew (then the scene hides today's ellipse); nothing is made without the art.
 */
export class AllyRings {
  private readonly images=new Map<string,Image>();
  // Plain fields (no parameter properties): npm test strips types only (node --experimental-strip-types).
  private readonly scene:Phaser.Scene;
  private readonly tint:number;
  constructor(scene:Phaser.Scene,tint:number){this.scene=scene;this.tint=tint;}
  /** Ring of ally `id` with its centre on (x, y), `width` world px wide (today's outer width), at `depth`. */
  draw(id:string,x:number,y:number,width:number,depth:number,now:number,reduced:boolean):boolean{
    const art=allyRingArt();
    if(!art||!this.scene.textures.exists(art.key)){this.images.get(id)?.setVisible(false);return false;}
    let image=this.images.get(id);
    if(!image){image=this.scene.add.image(0,0,art.key,0).setTint(this.tint);this.images.set(id,image);}
    placeMark(image,art,markFrame(art,now,reduced),x,y,width).setDepth(depth).setAlpha(ALLY_RING_ALPHA);
    return true;
  }
  /** Game Objects made so far (tests of the empty manifest). */
  get created(){return this.images.size;}
  /** An ally left: its ring goes too. */
  forget(id:string){this.images.get(id)?.destroy();this.images.delete(id);}
  destroy(){for(const image of this.images.values())image.destroy();this.images.clear();}
}
