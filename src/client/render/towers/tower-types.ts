/** The defenses renderer's shapes (moved from towers.ts, corte C2): its world and options, a defense, the pooled effects. */
import type Phaser from 'phaser';
import type {Pt,Rect} from '../city/projection.ts';
import type {CalibreLook,Dir8,TowerKind,TowerLook,TowerPhase,TowerView} from './tower-rules.ts';

/** Where the defenses sit: the city's projection and depth (the sandbox and, after torres-fio, the scene). */
export interface TowerWorld {
  /** World px of a point at height z (u) over the ground at (x, y). */
  project(x:number,y:number,z:number,out:Pt):Pt;
  /** Draw depth of a point actor standing at (x, y). */
  depth(x:number,y:number):number;
  /** Draw depth of an effect in the air over (x, y) (the city: covered by a building over whose footprint it is). Default `depth`. */
  effectDepth?(x:number,y:number):number;
  view():number;
}
export interface TowerRendererOptions {
  world:TowerWorld;
  /** prefers-reduced-motion: no screen shake. */
  reduced:boolean;
  /**
   * A defense whose sheet is not loaded yet was made (the scene streams the tower art after the opening): fetch that
   * kind's sheets now, ahead of the rest. It draws procedural until they arrive.
   */
  needArt?:(kind:TowerKind)=>void;
  /** Depth of the ground layer (crater decals, the wire's spark ring), just over the ground. */
  groundDepth:number;
  /** A counter that moves when the world's depths change (the city's chunks load or drop): depths are recomputed. */
  depthVersion?:()=>number;
  /** World px per CSS px of drawn sizes (the city's CITY_VIEW_SCALE; a getter when it changes with the world). Default 1. */
  actorScale?:number|(()=>number);
  /**
   * The camera this renderer shakes by itself (the sandbox). A scene that re-centres its camera every frame passes none
   * and adds `shakeOffset` after its own centring instead.
   */
  camera?:Phaser.Cameras.Scene2D.Camera;
  /** Economy mode when built (the scene's current choice; `economy` changes it live): no cast shadows. Default false. */
  economy?:boolean;
  /** The lighting is on (render/light.ts). Default lightEnabled() (`?luz=0` turns it off). */
  light?:boolean;
  /** The map's cell (u) the city art is drawn on (art-plan.ts CityArtOptions.cell), for the delivered art's scale. Default 0.88. */
  cell?:number|(()=>number|undefined);
}

export interface Tower {
  view:TowerView;look:TowerLook;cal:CalibreLook;phase:TowerPhase;prevFire?:number;
  /** Extra volleys of one snapshot still to draw (ms when each goes), staggered by VOLLEY_STAGGER_MS. */
  queued?:number[];
  /** Next re-scan of the horde for the nearest target (ms); the alpha last set; the cover test's last answer. */
  scanAt:number;alpha:number;covers:boolean;
  base:Phaser.GameObjects.Image;weapon:Phaser.GameObjects.Image;
  /**
   * Its imported sheet is in the manifest but not loaded yet (streamed after the match opens; cena-nasce-rapido): the
   * defense is not drawn until it arrives or `hideUntil` (ms) passes, then procedural until it does.
   */
  artWait:boolean;hideUntil:number;
  /** The Gustavão's rails and sleepers: a decal in the ground layer, under the carriage and everything standing. */
  rail?:Phaser.GameObjects.Image;
  /** Its cast shadow (lighting card): a baked decal in the shadow layer, over the ground decals, under the defenses. */
  shadow?:Phaser.GameObjects.Image;
  /** The delivered base sheet is in use (else the baked procedural texture). */
  art:boolean;
  dir:Dir8;want:Dir8;turnMs:number;recoilUntil:number;drawnDir:number;drawnRecoil:boolean;drawnPhase:TowerPhase|'';drawnView:number;
  /**
   * The delivered weapon's animation (card torres-animacao-idle-tiro): when the last volley started its fire sheet (ms),
   * its idle offset (weaponSeed) and the pose last set (fire × 1000 + frame; -1 none).
   */
  fireAt:number;seedMs:number;drawnPose:number;
  rect:Rect;prop:{x:number;y:number;rect:Rect};mount:Pt;height:number;seen:number;target:number;
  /** Draw depth (its footprint's front corner) and the server aim the cached `want` was turned from. */
  depth:number;aimFor:number;
}
/** Pooled effect images are made on first use and only hidden afterwards. */
export type Img=Phaser.GameObjects.Image|undefined;
/**
 * A shot: world path from (x0, y0, z0) to the ground at (x1, y1); (ox, oy) the screen offset from that path's start to
 * the barrel tip, faded out along the flight; `cell` the half-unit cell its depth was taken in; `d0` the depth of `src`,
 * the defense that fired it (taken again when the world's depths move).
 */
export interface Shot {on:boolean;cal:CalibreLook;x0:number;y0:number;z0:number;x1:number;y1:number;born:number;ms:number;mx:number;my:number;ox:number;oy:number;
  cell:number;d0:number;src:Tower|undefined;dz:number;trail:Img;head:Img;puff:Img}
/**
 * A muzzle flash, or (`smoke`) the grey puff the heavy calibres leave at the muzzle (torres-animacao-idle-tiro), of the
 * defense `src`; `depth` is its image's: `src`'s + `lift`.
 */
export interface Flash {on:boolean;x:number;y:number;r:number;born:number;ms:number;depth:number;lift:number;src:Tower|undefined;img:Img;smoke:boolean;
  /** A straight-shooting calibre's flash is a long star along the barrel, turned `rot` on screen. */
  long:boolean;rot:number}
/**
 * An explosion (`look`: a fireball, a bullet's spark, the big shells' fireball under a smoke cap) and, for `smokeMs`, the
 * smoke rising where it was; or (`ring`) a ring on the ground: the wire's sparks, the radar's pulse, a big shell's shock.
 */
export interface Blast {on:boolean;x:number;y:number;r:number;born:number;ms:number;ring:boolean;depth:number;img:Img;tint:number;look:BlastLook;smokeMs:number;smoke:Img}
export type BlastLook='fogo'|'faisca'|'fogo-g';
export interface Crater {on:boolean;x:number;y:number;r:number;born:number;ms:number}
