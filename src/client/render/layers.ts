/**
 * Pooled render layers for the horde run: enemies, pickups, projectiles, telegraphs and comic FX.
 * Steady state creates and destroys no GameObjects; pools grow only when demand exceeds their history.
 */
import Phaser from 'phaser';
import type {RunView,EnemyView,PickupView,ProjectileView,TelegraphView} from '../../contract/index.ts';
import type {SimEvent} from '../../contract/index.ts';
import {ENEMY_ART,ENEMY_TEXTURES,ELITE_SCALE,FX,enemyKind,enemyTexture,fallbackTint,pickupLook,projectileTexture,type EnemyKind} from './keys.ts';
import {ENEMY_DRAW_SCALE} from './draw-scale.ts';
import {ensureHordeTextures} from './textures.ts';
import {FramesPool,barArt,barFillWidth,markArt,markFrame,placeMark,sliceArt} from '../art/frames-art.ts';
import {applyEnemyArt,drawDeathArt,enemyArtActive,enemyArtId,enemyArtRatio,enemyArtRow,hasDeathArt,playEnemyAction,queueEnemyArt,poofArt,poofSheetFrame,projectileFrame,projectileFrames,projectileLook,resetEnemyArt} from '../art/horde-art.ts';
import {eventAction,projectileAction,type ActionCue,type ActionWorld} from '../art/horde-actions.ts';
import type {CityOutlines} from './city-outline.ts';
import {KeyedPool,Ring} from './pool.ts';
import {squash,gemBounce,hitFlash,flashStartOnHit,poof,popText,damageFloat,telegraphPulse,telegraphBlink,telegraphDashPhase,hashPhase,
  POP_TEXT_MS,projectileLeadSeconds,type Scale2,type PoofFrame,type TextFrame} from './motion.ts';
import {LOOK_NONE,PALESTRA_RADIUS,SPARKLES,actAnim,auraPulse,groundEllipse,headlightGlow,reflectGlint,sparkleFrame,viewPhaseLook,type PhaseLook,type SparkleFrame} from './phase-look.ts';
import {bubbleAllowed,deathLine,kindStyle,damageLabel,sayPriority,sayTag,skillBubbleLine,styleKey} from './jokes.ts';
import type {Projector} from './projector.ts';
import {HATCH_MAX_LINES,OUTLINE_MAX_POINTS,hatchSegments,insetPolygon,telegraphOutline} from './telegraph-shape.ts';
import {TELEGRAPH_EDGE_CSS,TELEGRAPH_STROKE,TelegraphEdge,type EdgeFrame} from './telegraph-edge.ts';
import {CITY_CONTACT_SHADOW,CITY_SHADOW_KEY,CITY_SHADOW_TEXTURE,hordeShadowKey} from './city-edge-rules.ts';
import {DECOR_ART_IDS,DECOR_STRIDE,DecorBuffer,LAYER_AIR,LAYER_ZONE,OP_CIRCLE,OP_ELLIPSE,OP_LINE,OP_POLY,OP_RING,OP_SPRITE,POLY_MAX,planDecor,telegraphLook,type DecorFrame} from './telegraph-look.ts';
import {FILL_TEXEL_CSS,TELEGRAPH_BORDER_KEY,TELEGRAPH_FILL_KEY,TELEGRAPH_STRIP_POINTS,borderStrip,decorArtInfo,fillStrip,queueTelegraphArt,repeatable} from './telegraph-art.ts';
import {token,tokenColor} from '../ui/tokens.ts';
import {EYES_DEPTH,LIFTED_DEPTH,eyesFrame,eyesOpen} from './blackout-rules.ts';
import {ArrivalJitter,glideCeiling} from '../net/smoothing.ts';
import {FX_BUDGET,RecentHits,admitNumber,admitPop,barVisible,canMerge,evictionIndex,numberPriority,type EffectsProfile,type FxBudget} from './legibility.ts';
import {sunlit} from './light-actors.ts';

type Pt={x:number;y:number};
type Image=Phaser.GameObjects.Image;
type Text=Phaser.GameObjects.Text;
type TextStyle=Phaser.Types.GameObjects.Text.TextStyle;

export interface HordeRendererOptions{
  /** Allocation-free camera projection; the host updates projector.view on rotation, then calls refresh(). */
  projector:Projector;
  /** Screen-legibility multiplier for text, bars and markers (e.g. clamp(0.55/zoom,1,2.5) on a phone). Default 1. */
  uiScale?:()=>number;
  /**
   * World px multiplier for what is authored at the endless map's size (enemy art and its shadow, bar, ring and lifts,
   * pickups, death puffs, warnings): framing.ts CITY_VIEW_SCALE in the city, so they keep their CSS size under the
   * city zoom (D-030). Sizes that come from world units (projectiles, telegraphs) need nothing. Default 1.
   */
  actorScale?:()=>number;
  reduced?:boolean;
  /** 'reduced' trims numbers, pops, stars and bubbles (settings, VGM-057). Default 'full'. */
  effects?:EffectsProfile;
  /** ms per sim tick, default 50 */
  tickMs?:number;
  /** ms between authoritative pushes (the room broadcasts every 2 ticks); enemies and pickups glide over it. Default tickMs. */
  pushMs?:number;
  /**
   * Whether a tree canopy drawn in front covers a sprite at this screen point and depth (the scene's own test for the
   * hero). Event prizes (boletos, the sale's coxinhas) covered by one are drawn above the canopies (PRIZE_LIFT_DEPTH).
   */
  canopyCovers?:(screen:Pt,depth:number)=>boolean;
  /** Changes whenever the trees change (a chunk in or out, a tree's art loaded on demand): cached canopy answers expire. */
  canopyVersion?:()=>number;
  /** World position of a player, so hostile damage numbers can appear over them. */
  locate?:(id:string)=>Pt|undefined;
  /** Id of the local player: only damage on them is a priority number (allies' hits are plain). Omitted = every player hit is. */
  selfId?:()=>string|undefined;
  /**
   * Cidade Nevada mode (framing.ts isCityWorld), read every frame (the renderer survives a world swap): the city
   * telegraph edge (Breu dashed, Cone solid, Papel dashed) and Breu 38% contact shadows. Omitted = never the city.
   */
  city?:()=>boolean;
  /**
   * Screen-scale Breu outlines of enemies and pickups (card contorno-breu, render/city-outline.ts): built once by the
   * scene and kept across world swaps; it shows the city copies only while its host says the city is on.
   */
  cityOutlines?:CityOutlines;
}

interface EnemyActor{
  image:Image;shadow:Image;barBg:Image;barFill:Image;barKey:string;id:string;kind:EnemyKind;elite:boolean;boss:boolean;hp:number;maxHp:number;hitAt:number;
  /** Imported art id (art/horde-art.ts enemyArtId: the roster id, or the legacy kind's) and the acting loop (phase-look.ts actAnim). */
  art:string;act:string|undefined;
  /** The roster accent of the reserve (keys.ts fallbackTint); `tint` is it while the reserve shows, undefined over art. */
  accent:number|undefined;
  /** Imported figure size over the reserve's (horde-art.ts enemyArtRatio; 1 without art): shadow, bar, ring and cues follow it. */
  fit:number;
  px:number;py:number;nx:number;ny:number;x:number;y:number;
  phase:number;flashAt:number;flashing:boolean;
  /** The sun tint (render/light.ts ACTOR_TINT) is on: set once per spawn and after each hit flash. */
  lit:boolean;
  /** The flip the sun tint was set for (a flipped sprite needs its corners swapped). */
  litFlip:boolean;screenX:number;flip:boolean;moving:boolean;
  /** EnemyView.phase of the chefe (his boss phase; 1 for everyone else): the imported chefe idles with 'phase2-idle' from phase 2. */
  bossPhase:number;
  /** What EnemyView.phase shows on a regular critter (phase-look.ts: acting pose, lecture ring, buff, reflect, headlight). */
  look:PhaseLook;
  /** D-047: the critter bought a sweet from Dona Cida ("açucarado", EnemyView.sugar): a pink glow and pink sparkles. */
  sugar:boolean;
  /** Bancos: it robbed an ATM and became a Cliente Prime (EnemyView.prime): a gold crown over its head. */
  prime:boolean;
  /** Procedural texture key in use (the acting pose swaps it). */
  tex:string;
  /** D-040: a roster entry drawn with its role's fallback texture wears its accent (keys.ts fallbackTint); undefined = none. */
  tint:number|undefined;
}
/** look: texture key (an XP pickup of the boleto rain is a boleto, VGM-053B); fall: it drops from the sky when it appears. */
interface PickupActor{image:Image;shadow:Image;kind:string;look:string;fall:boolean;promo:boolean;value:number;born:number;phase:number;px:number;py:number;nx:number;ny:number;x:number;y:number;
  /** Event prizes: where the canopy test last ran (screen px) and its answer; undefined = run it on the next frame. */
  coverX?:number;coverY?:number;covered?:boolean;coverVersion?:number}
interface ProjectileActor{image:Image;shadow:Image;look:string;x:number;y:number;vx:number;vy:number;radius:number;hostile:boolean;angle:number;
  /** Imported sheet (horde-art.ts projectileLook): frames > 1 loop at fps from `born`; `frame` is the one shown. */
  born:number;frames:number;fps:number;frame:number}
/** width: undefined = server default (D-015: cone = full aperture in radians, line = thickness). */
interface TelegraphState{shape:TelegraphView['shape'];x:number;y:number;radius:number;dx:number;dy:number;width:number|undefined;fireTick:number;start:number;
  /** D-036 hazard kind (undefined = generic look) and a per-id phase so twin hazards do not flicker in sync. */
  kind:TelegraphView['kind'];phase:number;
  /** Imported art (telegraph-art.ts): textured strips made the first time the piece is drawn, hidden when the telegraph retires. */
  fillArt?:Phaser.GameObjects.Rope;borderArt?:Phaser.GameObjects.Rope}
interface NumberFx{text:Text;born:number;x:number;y:number;lift:number;jitter:number;live:boolean;target:string;total:number;crit:boolean;hostile:boolean;priority:boolean;self:boolean}
interface PopFx{text:Text;born:number;x:number;y:number;lift:number;rotation:number}
/** frames/fit: the imported poof strip on `image` (art-d item 6; 0 frames = today's FX.puff) and its scale to today's size. */
interface PoofFx{image:Image;born:number;x:number;y:number;lift:number;scale:number;frames:number;fit:number}
interface StarFx{image:Image;born:number;x:number;y:number;lift:number;vx:number;vy:number;spin:number}
/** enemy: the barking critter; player: the skill caster (E7-skill-hud-wiring), followed through options.locate. */
interface BubbleFx{text:Text;born:number;enemy:string;player:string;x:number;y:number;lift:number;
  /** A status tag (the agiota's "DEVENDO", D-033): red body, Papel text. */
  tag:boolean}
interface WarningFx{image:Image;born:number;x:number;y:number;atTick:number;size:number}
/** Imported death animation (art v2) at the enemy's last spot and facing; `top` is its elite layer. Only with death art. */
interface DeathFx{image:Image;top:Image;born:number;kind:EnemyKind;art:string;elite:boolean;row:number;x:number;y:number;lift:number}

export const CAPS={damage:FX_BUDGET.full.numbers,pops:7,poofs:24,stars:120,bubbles:3,warnings:16,deaths:24} as const;
const TAU=Math.PI*2;
const FONT='system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SNAP_UNITS=3;
const BUBBLE_MS=2200,BUBBLE_GAP_MS=1950;
/** Lift of a player's balloon over their feet, in world px at ui scale 1: above the head of the 100 px hero sprite. */
const PLAYER_BUBBLE_LIFT=116;
const STAR_MS=640;
const PROJECTILE_LIFT=18;
/** Eyes in the dark, CSS px at the follow zoom: 9×12 Papel with a 2 px Breu edge, 4 px pupils looking at the hero. */
export const EYES_CSS={width:9,height:12,gap:7,edge:2,pupil:2.2,look:1.8} as const;
/** A boleto of the rain falls from this high (world px) in BOLETO_FALL_MS, swaying (VGM-053B); reduced motion: it is just there. */
export const BOLETO_FALL_PX=220,BOLETO_FALL_MS=420;
/** The flash sale's coxinhas are drawn this much bigger: the event reads at a glance (VGM-053B). */
export const PROMO_SCALE=1.6;
/**
 * A boleto or a sale's coxinha behind a tree is drawn above the canopies, just under the blackout (VGM-053B review M3,
 * pacote-bugs-ux): a prize of an event is never hidden by the scenery. Under critters' bars, balloons, heroes and danger.
 */
export const PRIZE_LIFT_DEPTH=93900;

const DAMAGE_STYLE:TextStyle={fontFamily:FONT,fontSize:'24px',fontStyle:'900',color:'#ffffff',stroke:'#2b2233',strokeThickness:5};
const CRIT_STYLE:TextStyle={fontFamily:FONT,fontSize:'32px',fontStyle:'900',color:'#ffd84a',stroke:'#3a2440',strokeThickness:6};
const HURT_STYLE:TextStyle={fontFamily:FONT,fontSize:'26px',fontStyle:'900',color:'#ff6b6b',stroke:'#2b1620',strokeThickness:5};
const BUBBLE_STYLE:TextStyle={fontFamily:FONT,fontSize:'20px',fontStyle:'700',color:'#51425e',backgroundColor:'#fff8ec',padding:{x:10,y:6},align:'center',wordWrap:{width:280}};
/**
 * Palette of the comic layer on the light tropical scene (D-022, DSG-contraste-mapa): every number and balloon is a
 * light body with a Breu edge (double-edge rule). Read from src/client/ui/tokens.css once the first renderer exists, since
 * Phaser cannot read CSS variables; the hex in PALETTE are the same token values, kept for a page without the stylesheet.
 */
/** The red tag over a player marked by the agiota's boleto (say key 'devendo', D-033): Papel letters on a red body. */
const TAG_STYLE:TextStyle={fontFamily:FONT,fontSize:'20px',fontStyle:'900',color:'#fff8ec',padding:{x:10,y:5},align:'center'};
const TAG_RED=0xd2392f;
const PALETTE={breu:0x1e1530,papel:0xeeddb8,cone:0xff7a1f};
let paletteReady=false;
function applyPalette(){
  if(paletteReady||typeof document==='undefined')return;
  paletteReady=true;
  const breu=token('--c-breu');
  DAMAGE_STYLE.color=token('--c-papel');DAMAGE_STYLE.stroke=breu;
  CRIT_STYLE.color=token('--c-amarelo');CRIT_STYLE.stroke=breu;
  HURT_STYLE.color=token('--c-cone');HURT_STYLE.stroke=breu;
  BUBBLE_STYLE.color=breu;BUBBLE_STYLE.backgroundColor='rgba(0,0,0,0)'; // body drawn on the overlay, with its edge
  TAG_STYLE.color=token('--c-papel');
  PALETTE.breu=tokenColor('--c-breu');PALETTE.papel=tokenColor('--c-papel');PALETTE.cone=tokenColor('--c-cone');
}
const popStyles=new Map<string,TextStyle>();
const popStyle=(kind:string)=>{
  const key=styleKey(kind);
  let style=popStyles.get(key);
  if(!style){const k=kindStyle(kind);style={fontFamily:FONT,fontSize:'34px',fontStyle:'900',color:k.fill,stroke:k.stroke,strokeThickness:9};popStyles.set(key,style);}
  return style;
};
/** One texture upload per change, even when the label repeats. */
const painted=new WeakMap<Text,TextStyle>();
const paint=(text:Text,style:TextStyle,label:string)=>{
  if(painted.get(text)!==style){
    painted.set(text,style);
    // Measure each style once (pixel read-back), then reuse its metrics: a 24px number reused as a 32px crit is not clipped.
    if(style.metrics)text.style.setStyle(style,false);
    else{text.setStyle(style);const m=text.style.getTextMetrics();style.metrics={ascent:m.ascent,descent:m.descent,fontSize:m.fontSize};}
    if(text.text===label){text.updateText();return;}
  }
  if(text.text!==label)text.setText(label);
};
const SHADOW_W=46,SHADOW_H=16,BAR_W=46,BAR_H=13,FILL_W=40,FILL_H=7;
/** Owner key of the target ring's imported image (one target at a time). */
const TARGET_RING={};
/** New low-priority damage numbers per authoritative frame; the rest are dropped to keep text uploads bounded. */
export const NUMBERS_PER_PUSH=FX_BUDGET.full.numbersPerPush;
/** Hit numbers on a player sit above balloons (96000) and the heroes (96500): damage on you is never under a joke. */
export const PLAYER_HIT_DEPTH=96600;
/** Telegraph outlines sit above every enemy, bar, number and bubble: danger is never hidden. */
export const TELEGRAPH_TOP_DEPTH=99000;
/** Balloon bodies: one step under the balloon text, so nothing falls between a balloon's body and its words. */
export const BALLOON_BODY_DEPTH=95990;
/**
 * A hero's skill balloon (E7-skill-hud-wiring) sits above the allies (96400) and the local hero (96500), so a teammate
 * walking by never hides the line; still under the hit number on a player (96600) and the telegraphs (99000).
 * It floats over the head (PLAYER_BUBBLE_LIFT), not over the body.
 */
export const HERO_BALLOON_DEPTH=96550;
/** Telegraph edge widths (island: Breu | Papel | Cone | Papel | Breu bands; city: dashed variant): render/telegraph-edge.ts. */
export {TELEGRAPH_STROKE,TELEGRAPH_BANDS_CSS} from './telegraph-edge.ts';
/** Hatch of the zone: Breu diagonals, 1,5 px CSS wide every 9 px CSS, at 18%. */
const HATCH_CSS={width:1.5,spacing:9,alpha:.18} as const;
/** Elenco P1 state cues (drawPhase): ring smoothness, the buff gold and the motoboy's lamp on his texture (feet origin). */
const PHASE_RING_POINTS=32,PHASE_GOLD=0xf6c84a;
/** D-047 açucarado: Dona Cida's sweets glow pink on a critter. */
const SUGAR_PINK=0xff8fc8;
/** Bancos: the Cliente Prime's crown, and its outline (x, up) in its half width and height: three points. */
const PRIME_GOLD=0xf2c14e,CROWN_SHAPE=[-1,0,-1,.55,-.5,.15,0,1,.5,.15,1,.55,1,0] as const;
const MOTOBOY_LAMP={x:29,y:38} as const;
/** Points of a decoration ellipse (gas, splat, rims): smooth enough at phone size, cheap to triangulate. */
const DECOR_ELLIPSE_SEGMENTS=20;

export class HordeRenderer{
  private scene:Phaser.Scene;
  private options:HordeRendererOptions;
  private reduced:boolean;
  private tickMs:number;
  private pushMs:number;
  private objects:Phaser.GameObjects.GameObject[]=[];
  private ground:Phaser.GameObjects.Graphics;
  private overlay:Phaser.GameObjects.Graphics;
  /** Balloon bodies, right under their text (96000) and above numbers (95500), pops (95800) and bars. */
  private balloons:Phaser.GameObjects.Graphics;
  private heroBalloons:Phaser.GameObjects.Graphics;
  private top:Phaser.GameObjects.Graphics;
  /** Blackout (VGM-053B): the critters' eyes over the dark, and the spawn warnings lifted above it. */
  private eyes!:Phaser.GameObjects.Graphics;
  private lifted!:Phaser.GameObjects.Graphics;
  /** How dark the blackout is now (0 = no blackout); set by the scene every frame. */
  private dark=0;
  private fx:FxBudget;
  /** Latest number per target, for merging hits inside DAMAGE_MERGE_MS. */
  private numberByTarget=new Map<string,NumberFx>();
  /** The most recently hit enemies: the only plain ones that keep a health bar. */
  private recentHits:RecentHits;
  private enemies:KeyedPool<EnemyActor>;
  private pickups:KeyedPool<PickupActor>;
  private projectiles:KeyedPool<ProjectileActor>;
  private telegraphs:KeyedPool<TelegraphState>;
  private numbers:Ring<NumberFx>;
  private pops:Ring<PopFx>;
  private poofs:Ring<PoofFx>;
  private stars:Ring<StarFx>;
  private bubbles:Ring<BubbleFx>;
  private warnings:Ring<WarningFx>;
  /** Imported 9-slice frames (balloons, tags, bars) and the target ring (art/frames-art.ts); nothing made without the art. */
  private art:FramesPool;
  private deaths:Ring<DeathFx>;
  private now=0;
  private ui=1;
  /** options.actorScale, read once per frame (1 on the island and the endless map). */
  private body=1;
  /** The enemies' drawn scale: the actor scale × ENEMY_DRAW_SCALE (render/draw-scale.ts); what hangs on them follows it. */
  private enemyBody=ENEMY_DRAW_SCALE;
  /** options.city, read once per frame; the shadows' texture follows it. */
  private cityOn=false;
  private numbersThisPush=0;
  private q:Pt={x:0,y:0};
  private pushAt=0;
  private viewTick=0;
  private frac=1;
  /**
   * 3g-rede-sem-teleporte: the enemies' glide lasts as long as the link's frames need (ArrivalJitter, never under
   * pushMs) and a late frame lets them go on along their motion (`lead` > 1, capped by glideCeiling) instead of freezing.
   */
  private arrivals:ArrivalJitter;
  private glide:number;
  private lead=1;
  private nowTick=0;
  private lastEventId=-1;
  private lastBubbleAt=-Infinity;
  private targetId?:string;
  private snapNext=false;
  private at:Pt={x:0,y:0};
  private pts:Pt[]=Array.from({length:OUTLINE_MAX_POINTS},()=>({x:0,y:0}));
  /** Inset centre line of the imported border strip (drawBorderArt). */
  private ptsIn:Pt[]=Array.from({length:OUTLINE_MAX_POINTS},()=>({x:0,y:0}));
  /** The danger edge painter (render/telegraph-edge.ts) and its per-frame input. */
  private edge=new TelegraphEdge();
  private edgeFrame:EdgeFrame={css:1,ui:1,blink:1,city:false,dashPhase:0,colors:PALETTE};
  private scale2:Scale2={sx:1,sy:1};
  private poofFrame:PoofFrame={scale:0,alpha:0,done:false};
  private textFrame:TextFrame={y:0,scale:1,alpha:1,done:false};

  constructor(scene:Phaser.Scene,options:HordeRendererOptions){
    this.scene=scene;this.options=options;this.reduced=!!options.reduced;this.tickMs=options.tickMs??50;this.pushMs=Math.max(1,options.pushMs??this.tickMs);
    this.arrivals=new ArrivalJitter(this.pushMs);this.glide=this.pushMs;
    applyPalette();
    this.fx=FX_BUDGET[options.effects??'full'];this.recentHits=new RecentHits(this.fx.bars);
    ensureHordeTextures(scene);
    this.art=new FramesPool(scene);
    this.ground=this.track(scene.add.graphics().setDepth(-9970).setName('horda-chao'));
    this.overlay=this.track(scene.add.graphics().setDepth(95000).setName('horda-overlay'));
    this.balloons=this.track(scene.add.graphics().setDepth(BALLOON_BODY_DEPTH).setName('horda-baloes'));
    this.heroBalloons=this.track(scene.add.graphics().setDepth(HERO_BALLOON_DEPTH).setName('horda-baloes-heroi'));
    this.top=this.track(scene.add.graphics().setDepth(TELEGRAPH_TOP_DEPTH).setName('horda-topo'));
    const image=(key:string)=>()=>this.track(scene.add.image(0,0,key).setVisible(false).setActive(false));
    const text=(style:TextStyle,depth:number)=>()=>this.track(scene.add.text(0,0,'',style).setOrigin(.5,1).setDepth(depth).setVisible(false).setActive(false));
    const showImage=(o:{image:Image},active:boolean)=>{
      o.image.setVisible(active).setActive(active);
      if(!active)o.image.clearTint().setAlpha(1).setScale(1).setRotation(0).setFlipX(false);
    };
    ensureCityShadow(scene);
    const shadow=()=>this.track(scene.add.image(0,0,hordeShadowKey(this.cityOn,FX.shadow)).setDepth(-9980).setVisible(false).setActive(false));
    const bar=(key:string,depth:number)=>this.track(scene.add.image(0,0,key).setOrigin(0,0).setDepth(depth).setVisible(false).setActive(false));
    const showActor=(o:{image:Image;shadow:Image},active:boolean)=>{
      showImage(o,active);o.shadow.setVisible(active).setActive(active);
      if(active)this.shadowLook(o.shadow); // an idle one may come back after a world swap
    };
    const showEnemy=(o:EnemyActor,active:boolean)=>{showActor(o,active);if(!active){o.barBg.setVisible(false);o.barFill.setVisible(false);o.lit=false;}};
    const showText=(o:{text:Text},active:boolean)=>{o.text.setVisible(active).setActive(active);if(!active)o.text.setAlpha(1).setScale(1).setRotation(0);};
    this.enemies=new KeyedPool<EnemyActor>(()=>({image:image(enemyTexture('bebado'))(),shadow:shadow(),barBg:bar(FX.bar,95000),barFill:bar(FX.barFill,95001),barKey:FX.bar,id:'',kind:'bebado',elite:false,boss:false,hp:1,maxHp:1,hitAt:-1e9,
      px:0,py:0,nx:0,ny:0,x:0,y:0,phase:0,flashAt:-1e9,flashing:false,lit:false,litFlip:false,screenX:NaN,flip:false,moving:false,bossPhase:1,look:LOOK_NONE,sugar:false,prime:false,tex:enemyTexture('bebado'),tint:undefined,art:'bebado',act:undefined,fit:1,accent:undefined}),showEnemy);
    this.pickups=new KeyedPool<PickupActor>(()=>({image:image(pickupLook('xp'))(),shadow:shadow(),kind:'xp',look:pickupLook('xp'),fall:false,promo:false,value:1,born:0,phase:0,px:0,py:0,nx:0,ny:0,x:0,y:0}),showActor);
    this.eyes=this.track(scene.add.graphics().setDepth(EYES_DEPTH).setName('horda-olhos'));
    this.lifted=this.track(scene.add.graphics().setDepth(LIFTED_DEPTH).setName('horda-erguidos'));
    this.projectiles=new KeyedPool<ProjectileActor>(()=>({image:image(FX.projFriendly)(),shadow:shadow(),look:FX.projFriendly,x:0,y:0,vx:0,vy:0,radius:.2,hostile:false,angle:0,
      born:0,frames:1,fps:8,frame:0}),showActor);
    this.telegraphs=new KeyedPool<TelegraphState>(()=>({shape:'circle' as TelegraphView['shape'],x:0,y:0,radius:1,dx:1,dy:0,width:undefined,fireTick:0,start:0,kind:undefined,phase:0}),
      (t,active)=>{if(!active){t.fillArt?.setVisible(false);t.borderArt?.setVisible(false);}});
    queueTelegraphArt(scene); // imported hatch fill and dashed border when the manifest has them (nothing otherwise)
    this.numbers=new Ring<NumberFx>(()=>({text:text(DAMAGE_STYLE,95500)(),born:0,x:0,y:0,lift:0,jitter:0,live:false,target:'',total:0,crit:false,hostile:false,priority:false,self:false}),showText,CAPS.damage);
    this.pops=new Ring(()=>({text:text(popStyle('bebado'),95800)(),born:0,x:0,y:0,lift:0,rotation:0}),showText,CAPS.pops);
    this.poofs=new Ring<PoofFx>(()=>({image:image(FX.puff)(),born:0,x:0,y:0,lift:0,scale:1,frames:0,fit:1}),showImage,CAPS.poofs);
    this.stars=new Ring(()=>({image:image(FX.star)(),born:0,x:0,y:0,lift:0,vx:0,vy:0,spin:0}),showImage,CAPS.stars);
    this.bubbles=new Ring<BubbleFx>(()=>({text:text(BUBBLE_STYLE,96000)(),born:0,enemy:'',player:'',x:0,y:0,lift:0,tag:false}),showText,CAPS.bubbles);
    this.warnings=new Ring(()=>({image:image(FX.warning)(),born:0,x:0,y:0,atTick:0,size:1}),showImage,CAPS.warnings);
    // Made on the first kill with imported death art only (empty manifest: never), then reused.
    this.deaths=new Ring<DeathFx>(()=>({image:image(FX.puff)(),top:image(FX.puff)(),born:0,kind:'bebado',art:'bebado',elite:false,row:0,x:0,y:0,lift:0}),
      (o,active)=>{showImage(o,active);if(!active)o.top.setVisible(false).setAlpha(1);},CAPS.deaths);
  }

  /** Feed a new authoritative view (≈20 Hz). Processes view.events once each by eventId. */
  push(view:RunView){
    if(view.tick<this.viewTick)this.lastEventId=-1; // new run or server restart
    this.viewTick=view.tick;this.pushAt=this.now;this.numbersThisPush=0;
    this.arrivals.push(this.now);this.glide=Math.max(this.pushMs,this.arrivals.delay());
    // Sync first and retire after the events, so damage on a just-spawned or just-killed enemy still finds its actor.
    this.enemies.begin();
    for(let i=0;i<view.enemies.length;i++)if(view.enemies[i].hp>0)this.syncEnemy(view.enemies[i]);
    this.viewTelegraphs=view.telegraphs; // a 'telegraph' event's zone, for the action cue (art v2)
    for(let i=0;i<view.events.length;i++){
      const event=view.events[i];
      if(event.eventId<=this.lastEventId)continue;
      this.lastEventId=event.eventId;this.handle(event,event.eventId);
    }
    this.enemies.end();
    this.pickups.begin();
    for(let i=0;i<view.pickups.length;i++)this.syncPickup(view.pickups[i]);
    this.pickups.end();
    this.projectiles.begin();
    for(let i=0;i<view.projectiles.length;i++)this.syncProjectile(view.projectiles[i]);
    this.projectiles.end();
    this.telegraphs.begin();
    for(let i=0;i<view.telegraphs.length;i++)this.syncTelegraph(view.telegraphs[i]);
    this.telegraphs.end();
  }

  /** Every frame: interpolate and animate. */
  update(timeMs:number,_deltaMs:number){
    this.now=timeMs;
    const since=Math.max(0,timeMs-this.pushAt)/this.tickMs;
    const glided=Math.max(0,timeMs-this.pushAt)/this.glide;
    this.frac=this.snapNext?1:Math.min(1,glided);
    this.lead=this.snapNext?1:Math.min(glideCeiling(this.glide),glided);
    this.nowTick=this.viewTick+Math.min(since,2);
    this.ui=Math.max(.5,Math.min(3,this.options.uiScale?.()??1));
    this.body=this.options.actorScale?.()??1;this.enemyBody=this.body*ENEMY_DRAW_SCALE;
    const city=!!this.options.city?.();
    if(city!==this.cityOn){this.cityOn=city;this.swapShadows();}
    this.ground.clear();this.overlay.clear();this.balloons.clear();this.heroBalloons.clear();this.top.clear();this.eyes.clear();this.lifted.clear();this.art.begin();
    this.drawTelegraphs();
    this.enemies.forEach(this.drawEnemy);
    this.pickups.forEach(this.drawPickup);
    this.projectiles.forEach(this.drawProjectile);
    this.warnings.retain(this.drawWarning);
    this.poofs.retain(this.drawPoof);
    this.deaths.retain(this.drawDeath);
    this.stars.retain(this.drawStar);
    this.numbers.retain(this.drawNumber);
    this.pops.retain(this.drawPop);
    this.bubbles.retain(this.drawBubble);
    this.snapNext=false;
  }

  /** Camera rotated: options.projector now has the new view; snap everything. */
  refresh(){
    this.enemies.forEach(a=>{a.px=a.nx;a.py=a.ny;a.screenX=NaN;});
    this.pickups.forEach(a=>{a.px=a.nx;a.py=a.ny;});
    this.projectiles.forEach(this.aim);
    this.snapNext=true;this.update(this.now,0);
  }

  /** City on/off: every live shadow takes the city's Breu 38% texture, or FX.shadow back (idle ones on reuse). */
  private swapShadows(){
    const swap=(a:{shadow:Image})=>this.shadowLook(a.shadow);
    this.enemies.forEach(swap);this.pickups.forEach(swap);this.projectiles.forEach(swap);
  }
  private shadowLook(shadow:Image){const key=hordeShadowKey(this.cityOn,FX.shadow);if(shadow.texture.key!==key)shadow.setTexture(key);}
  setTarget(enemyId?:string){this.targetId=enemyId;}
  /** Sim tick shown now (the last push plus the time since, ≤ 2 ticks ahead): timed player states (slowUntil) compare to it. */
  get tick(){return this.nowTick;}
  /** Follows prefers-reduced-motion changes at runtime. */
  setReduced(reduced:boolean){this.reduced=reduced;}
  /**
   * Blackout level now (0..1, VGM-053B): above 0 the critters show their eyes over the dark, and spawn warnings and
   * hostile projectiles are drawn above it (render/blackout-rules.ts; telegraphs are always on the top layer).
   */
  setBlackout(level:number){this.dark=Math.max(0,Math.min(1,level));}
  /** Depths of what must stay visible in the dark, for the blackout audit (dev probe and tests). */
  blackoutLayers(){
    const out:{name:string;depth:number;visible?:boolean;count?:number}[]=[{name:'telegraphs',depth:this.top.depth,visible:this.telegraphs.size>0,count:this.telegraphs.size},{name:'eyes',depth:this.eyes.depth},{name:'warnings',depth:this.lifted.depth}];
    this.projectiles.forEach(p=>{if(p.hostile)out.push({name:'hostile projectile',depth:p.image.depth,visible:p.image.visible});});
    this.warnings.forEach(w=>{out.push({name:'warning',depth:w.image.depth,visible:w.image.visible});});
    return out;
  }
  /** Effects profile at runtime (settings). Live effects above the new budget fade out on their own. */
  setEffects(profile:EffectsProfile){this.fx=FX_BUDGET[profile];this.recentHits.setCap(this.fx.bars);}
  /** New run or reconnection to a fresh server: accept event ids from the start again. */
  resetEvents(){this.lastEventId=-1;}

  stats(){
    const byLayer:Record<string,{created:number;active:number}>={
      enemies:this.count(this.enemies),pickups:this.count(this.pickups),projectiles:this.count(this.projectiles),
      damage:this.count(this.numbers),pops:this.count(this.pops),poofs:this.count(this.poofs),stars:this.count(this.stars),
      bubbles:this.count(this.bubbles),warnings:this.count(this.warnings),deaths:this.count(this.deaths),graphics:{created:4,active:4},
    };
    let created=0,active=0;
    for(const key in byLayer){created+=byLayer[key].created;active+=byLayer[key].active;}
    return {created,active,byLayer};
  }

  destroy(){
    this.enemies.clear();this.pickups.clear();this.projectiles.clear();this.telegraphs.clear();
    this.numberByTarget.clear();this.recentHits.clear();this.numbers.clear();this.pops.clear();this.poofs.clear();this.stars.clear();this.bubbles.clear();this.warnings.clear();this.deaths.clear();
    this.art.destroy();
    for(const object of this.objects)object.destroy();
    this.objects.length=0;
  }

  // ---------- reconciliation ----------
  private syncEnemy(view:EnemyView){
    const used=this.enemies.use(view.id),a=used.item,kind=enemyKind(view.kind),elite=!!view.elite&&kind!=='chefe';
    const look=viewPhaseLook(view.kind,kind,view.phase),tex=ENEMY_TEXTURES[kind][(elite?1:0)+(look.acting?2:0)];
    if(used.fresh||a.kind!==kind||a.elite!==elite||a.tex!==tex){
      a.image.setTexture(tex).setOrigin(.5,ENEMY_ART[kind].originY);
      a.kind=kind;a.elite=elite;a.tex=tex;
    }
    a.look=look;a.act=actAnim(view.kind,kind,view.phase);
    // D-047 (protocol 15): EnemyView.sugar, the critter bought a sweet from Dona Cida.
    a.sugar=view.sugar===true;
    a.prime=view.prime===true;
    // The roster's art loads per match, the first time one of its enemies shows up (horde-art.ts queueEnemyArt).
    const art=enemyArtId(view.kind,kind);
    if(a.art!==art){a.art=art;queueEnemyArt(this.scene,art);}
    if(used.fresh){
      a.id=view.id;a.phase=hashPhase(view.id);a.flashAt=-1e9;a.hitAt=-1e9;a.flashing=false;a.screenX=NaN;a.flip=a.phase<.5;resetEnemyArt(a.image);
      a.px=a.nx=a.x=view.x;a.py=a.ny=a.y=view.y;
    }else if(Math.abs(view.x-a.nx)+Math.abs(view.y-a.ny)>SNAP_UNITS){a.px=a.x=view.x;a.py=a.y=view.y;}
    else{a.px=a.x;a.py=a.y;}
    // A pooled actor may come back as another kind: its accent tint follows (the hit flash owns the tint while it lasts).
    // A new accent re-lights the actor on its next frame (sunlit multiplies the light by the roster accent); imported
    // art has its own colours, so drawEnemy drops the accent the frame the art shows (and back when it goes).
    const accent=fallbackTint(view.kind);
    if(used.fresh||a.accent!==accent){a.accent=accent;a.tint=accent;a.lit=false;}
    a.moving=Math.abs(view.x-a.nx)+Math.abs(view.y-a.ny)>.002;
    a.nx=view.x;a.ny=view.y;a.hp=view.hp;a.maxHp=view.maxHp;a.boss=!!view.boss||kind==='chefe';a.bossPhase=kind==='chefe'?view.phase??1:1;
  }
  private syncPickup(view:PickupView){
    const used=this.pickups.use(view.id),a=used.item,look=pickupLook(view.kind,view.resource);
    if(used.fresh||a.look!==look){a.image.setTexture(look).setOrigin(.5,.92);a.kind=view.kind;a.look=look;}
    if(used.fresh){a.born=this.now;a.phase=hashPhase(view.id);a.px=a.nx=a.x=view.x;a.py=a.ny=a.y=view.y;a.fall=look===FX.boleto&&!this.reduced;a.coverX=undefined;}
    else if(Math.abs(view.x-a.nx)+Math.abs(view.y-a.ny)>SNAP_UNITS){a.px=a.x=view.x;a.py=a.y=view.y;}
    else{a.px=a.x;a.py=a.y;}
    a.nx=view.x;a.ny=view.y;a.value=view.value;a.promo=view.kind==='heal'&&view.resource==='promo';
  }
  private syncProjectile(view:ProjectileView){
    // Art v2: the source's own sheet (art:proj:<id>) or the shared friendly one when loaded; else today's key.
    const art=projectileLook(view.hostile,view.source),own=!!art&&this.scene.textures.exists(art.key);
    const used=this.projectiles.use(view.id),a=used.item,look=own?(art as {key:string}).key:projectileTexture(view.hostile,view.source);
    if(used.fresh||a.look!==look||a.radius!==view.radius){
      a.look=look;a.image.setTexture(look).setOrigin(.5,.5);
      a.image.setScale(Math.max(.5,Math.min(3,view.radius*2*46/Math.max(1,a.image.width))));
      // Frames only when the texture in use is the art's and really has them (a failed load: today's texture, still).
      a.frames=own?projectileFrames(this.scene.textures,art!):1;a.fps=own?art!.fps:8;a.frame=0;
    }
    if(used.fresh){
      a.born=this.now;
      // Who threw a hostile shot plays its throw (the agiota's boleto): nearest enemy of that kind, art v2 only.
      if(view.hostile&&enemyArtActive()){const cue=projectileAction(view.source,true,view.x,view.y,this.actionWorld,this.actionCue);if(cue)this.playCue(cue);}
    }
    a.x=view.x;a.y=view.y;a.vx=view.vx;a.vy=view.vy;a.radius=view.radius;a.hostile=view.hostile;
    this.aim(a);
  }
  /** Screen-space heading, recomputed only on push and camera rotation. */
  private aim=(a:ProjectileActor)=>{
    this.at.x=a.x;this.at.y=a.y;const base=this.project(this.at),bx=base.x,by=base.y;
    this.at.x=a.x+a.vx;this.at.y=a.y+a.vy;const ahead=this.project(this.at);
    a.angle=Math.atan2(ahead.y-by,ahead.x-bx);
  };
  private syncTelegraph(view:TelegraphView){
    const used=this.telegraphs.use(view.id),t=used.item;
    if(used.fresh){t.start=Math.min(this.viewTick,view.fireTick-1);t.phase=hashPhase(view.id);}
    t.kind=view.kind;
    t.shape=view.shape;t.x=view.x;t.y=view.y;t.radius=view.radius;t.fireTick=view.fireTick;
    const length=Math.hypot(view.dx??0,view.dy??0);
    t.dx=length>1e-6?(view.dx as number)/length:1;t.dy=length>1e-6?(view.dy as number)/length:0;
    t.width=view.width;
  }

  // ---------- events ----------
  private handle(event:SimEvent,eventId:number){
    // Art v2: the enemy this event makes act (hit, attack, throw, joke…); nothing without imported enemy art.
    if(enemyArtActive()){const cue=eventAction(event,this.actionWorld,this.actionCue);if(cue)this.playCue(cue);}
    switch(event.type){
      case 'damage':{
        const enemy=this.enemies.get(event.target);
        if(enemy){
          enemy.flashAt=flashStartOnHit(this.now,enemy.flashAt);enemy.hitAt=this.now;if(!enemy.elite&&!enemy.boss)this.recentHits.hit(event.target);
          const crit=!!event.crit;
          this.spawnNumber(event.target,enemy.x,enemy.y,this.barLift(enemy)*.72,event.amount,crit,false,false,numberPriority(crit,false,enemy.elite,enemy.boss),eventId);
        }else{
          const p=this.options.locate?.(event.target);
          if(p){
            const self=!this.options.selfId||this.options.selfId()===event.target;
            this.spawnNumber(event.target,p.x,p.y,92*this.body,event.amount,false,true,self,numberPriority(false,self,false,false),eventId);
          }
        }
        break;
      }
      case 'kill':this.recentHits.delete(event.enemy);this.spawnDeath(event.kind,event.enemy,event.x,event.y);break;
      case 'spawn-warning':{
        const w=this.warnings.spawn();
        w.born=this.now;w.x=event.x;w.y=event.y;w.atTick=event.atTick;w.size=1+Math.min(.5,event.count*.04);
        w.image.clearTint();break; // the texture carries the palette (Cone, Breu, Papel)
      }
      case 'bark':this.spawnBubble(event.enemy,event.line);break;
      case 'skill':this.spawnSkillBubble(event.player,skillBubbleLine(event));break;
      // D-013 (VGM-046B): the forge's line and a node running dry, over the player who did it.
      // D-033: the agiota's boleto marks a player as owing money: a short red tag over them instead of the line.
      case 'say':{const tag=sayTag(event.key);if(tag)this.spawnSkillBubble(event.source,tag,true);else this.spawnSkillBubble(event.source,event.line,false,sayPriority(event.key));break;}
      case 'boss-phase':{const boss=this.enemies.get(event.enemy);if(boss){boss.flashAt=this.now;boss.bossPhase=event.phase;}break;}
    }
  }
  // ---------- art v2 actions (art/horde-actions.ts): what the event mapping sees of this renderer ----------
  private viewTelegraphs:readonly TelegraphView[]=[];
  private actionCue:ActionCue={enemy:'',action:'hit'};
  private nearKind:EnemyKind='bebado';private nearX=0;private nearY=0;private nearBest=0;private nearFound:EnemyActor|undefined;
  private nearVisit=(a:EnemyActor)=>{
    if(a.kind!==this.nearKind)return;
    const d=Math.hypot(a.nx-this.nearX,a.ny-this.nearY);if(d<=this.nearBest){this.nearBest=d;this.nearFound=a;}
  };
  private actionWorld:ActionWorld={
    enemy:id=>this.enemies.get(id),
    nearest:(kind,x,y,max)=>{
      this.nearKind=kind;this.nearX=x;this.nearY=y;this.nearBest=max;this.nearFound=undefined;
      this.enemies.forEach(this.nearVisit);return this.nearFound;
    },
    telegraph:id=>{const t=this.viewTelegraphs;for(let i=0;i<t.length;i++)if(t[i].id===id)return t[i];return undefined;},
  };
  private playCue(cue:ActionCue){const a=this.enemies.get(cue.enemy);if(a)playEnemyAction(a.image,a.art,cue.action,this.now);}
  private spawnNumber(target:string,x:number,y:number,lift:number,amount:number,crit:boolean,hostile:boolean,self:boolean,priority:boolean,eventId:number){
    // Hits on the same target within DAMAGE_MERGE_MS add up into the number already flying.
    const merged=this.numberByTarget.get(target);
    if(canMerge(merged,target,this.now)){
      const fx=merged as NumberFx;
      fx.total+=amount;fx.crit||=crit;fx.priority||=priority;fx.x=x;fx.y=y;
      this.paintNumber(fx);return;
    }
    const admission=admitNumber(this.numbers.active,this.fx.numbers,this.numbersThisPush,this.fx.numbersPerPush,priority);
    if(admission==='drop')return;
    if(!priority)this.numbersThisPush++;
    // Full screen: a priority number replaces the oldest plain one first, and damage on the local player goes last.
    if(admission==='recycle'){const victim=this.numbers.at(evictionIndex(this.numbers.active,this.numberAt));if(victim)this.retireNumber(victim,true);}
    const fx=this.numbers.spawn();
    if(fx.live)this.retireNumber(fx,false);
    fx.live=true;fx.target=target;fx.total=amount;fx.crit=crit;fx.hostile=hostile;fx.self=self;fx.priority=priority;
    fx.text.setDepth(hostile?PLAYER_HIT_DEPTH:95500);
    fx.born=this.now;fx.x=x;fx.y=y;fx.lift=lift;fx.jitter=(eventId*37%29)-14;
    this.numberByTarget.set(target,fx);
    this.paintNumber(fx);
  }
  private numberAt=(i:number)=>this.numbers.at(i);
  /** Drops a number from the merge map (and from the ring when `release`). */
  private retireNumber(fx:NumberFx,release:boolean){
    fx.live=false;
    if(this.numberByTarget.get(fx.target)===fx)this.numberByTarget.delete(fx.target);
    if(release)this.numbers.release(fx);
  }
  private paintNumber(fx:NumberFx){
    paint(fx.text,fx.hostile?HURT_STYLE:fx.crit?CRIT_STYLE:DAMAGE_STYLE,fx.hostile?`-${damageLabel(fx.total)}`:damageLabel(fx.total,fx.crit));
  }
  /** A puff of smoke at a world point (the local hero's big correction hides behind it, 3g-rede-sem-teleporte). */
  poofAt(x:number,y:number){
    const puff=this.poofs.spawn();
    puff.born=this.now;puff.x=x;puff.y=y;puff.lift=ENEMY_ART.bebado.height*.35*this.body;puff.scale=1.3*this.body;
    this.poofLook(puff);puff.image.clearTint();
  }
  private spawnDeath(kind:string,id:string,x:number,y:number){
    const k=enemyKind(kind),phase=hashPhase(id),body=this.enemyBody,lift=ENEMY_ART[k].height*.35*body;
    // Art v2: the imported death plays on a pooled death actor where (and facing where) the enemy was last drawn,
    // instead of today's puff and stars; the death joke below stays.
    const dying=this.enemies.get(id);
    const art=enemyArtId(kind,k);
    if(hasDeathArt(this.scene.textures,art,dying?.image)){
      const d=this.deaths.spawn(),elite=!!dying?.elite;
      d.born=this.now;d.kind=k;d.art=art;d.elite=elite;d.row=dying?enemyArtRow(dying.image):0;d.x=dying?.x??x;d.y=dying?.y??y;
      d.lift=ENEMY_ART[k].hover*(elite?ELITE_SCALE:1)*body;
      d.image.clearTint();
    }else{
      const puff=this.poofs.spawn();
      puff.born=this.now;puff.x=x;puff.y=y;puff.lift=lift;puff.scale=(k==='chefe'?2.4:1)*body;this.poofLook(puff);
      puff.image.setTint(kindStyle(kind).tint);
      const starCount=this.fx.starsPerKill;
      for(let i=0;i<starCount;i++){
        const star=this.stars.spawn(),angle=(i/starCount+phase)*TAU,speed=170+60*((i*7+phase*10)%3)/3;
        star.born=this.now;star.x=x;star.y=y;star.lift=lift;
        star.vx=Math.cos(angle)*speed*this.body;star.vy=(Math.sin(angle)*speed*.8-90)*this.body;star.spin=(i%2?1:-1)*(4+phase*4);
        star.image.setTint(i%2?0xfff1a8:kindStyle(kind).tint);
      }
    }
    // The death joke of a boss or an elite always shows (recycling the oldest pop); plain kills respect the budget.
    if(!admitPop(this.pops.active,this.fx.pops,k==='chefe'||!!this.enemies.get(id)?.elite))return;
    const pop=this.pops.spawn();
    pop.born=this.now;pop.x=x;pop.y=y;pop.lift=lift+ENEMY_ART[k].height*.45*body;pop.rotation=(phase-.5)*.36;
    paint(pop.text,popStyle(kind),deathLine(kind,id));
  }
  private spawnBubble(enemy:string,line:string){
    if(this.now-this.lastBubbleAt<BUBBLE_GAP_MS)return;
    while(this.bubbles.active>=this.fx.bubbles){const oldest=this.bubbles.at(0);if(!oldest)break;this.bubbles.release(oldest);}
    const actor=this.enemies.get(enemy);
    const b=this.bubbles.spawn();
    this.lastBubbleAt=this.now;
    b.text.setDepth(96000);
    b.born=this.now;b.enemy=enemy;b.player='';b.tag=false;b.x=actor?.x??NaN;b.y=actor?.y??NaN;b.lift=actor?this.barLift(actor)+16*this.body:110*this.enemyBody;
    paint(b.text,BUBBLE_STYLE,line);
  }
  /**
   * The caster's line over their head (E7-skill-hud-wiring). It is the answer to a tap, so it does not wait for the
   * critters' bark gap; when the budget is full it takes a critter's balloon first (then the oldest one).
   * One per caster every SKILL_BUBBLE_GAP_MS (D-013); a newer line from the same caster replaces theirs.
   */
  private skillBubbleAt=new Map<string,number>();
  /** A player's own line over the head (falls, rescues, "Segura aí", UX-resgate-e-ping): same rules as a skill line. */
  say(player:string,line:string){this.spawnSkillBubble(player,line);}
  private spawnSkillBubble(player:string,line:string,tag=false,priority=false){
    // A status tag is game information (the mark makes the player take more damage) and a priority line must be seen
    // (sayPriority): neither waits for the gap.
    if(!bubbleAllowed(this.now,this.skillBubbleAt.get(player)??-Infinity,{tag,priority}))return;
    const p=this.options.locate?.(player);if(!p)return;
    this.skillBubbleAt.set(player,this.now);
    let own:BubbleFx|undefined;this.bubbles.forEach(b=>{if(b.player===player)own=b;});
    if(own)this.bubbles.release(own);
    while(this.bubbles.active>=this.fx.bubbles){
      let victim:BubbleFx|undefined;this.bubbles.forEach(b=>{if(!victim&&!b.player)victim=b;});
      victim??=this.bubbles.at(0);if(!victim)break;this.bubbles.release(victim);
    }
    const b=this.bubbles.spawn();
    this.lastBubbleAt=this.now;
    b.text.setDepth(HERO_BALLOON_DEPTH+1);
    b.born=this.now;b.enemy='';b.player=player;b.tag=tag;b.x=p.x;b.y=p.y;b.lift=PLAYER_BUBBLE_LIFT;
    paint(b.text,tag?TAG_STYLE:BUBBLE_STYLE,line);
  }

  // ---------- per-frame drawing (pre-bound, allocation-light) ----------
  private drawEnemy=(a:EnemyActor)=>{
    const f=this.lead,now=this.now,art=ENEMY_ART[a.kind],size=a.elite?ELITE_SCALE:1,body=this.enemyBody;
    a.x=a.px+(a.nx-a.px)*f;a.y=a.py+(a.ny-a.py)*f;
    this.at.x=a.x;this.at.y=a.y;
    const q=this.project(this.at),depth=this.depth(this.at);
    let lift=art.hover*size*body,dx=0;
    let sway=0;
    if(a.kind==='pombos'&&!this.reduced){
      lift+=Math.sin(now*.011+a.phase*TAU)*6*body;
      dx=(Math.abs(((now*.004+a.phase*4)%2+2)%2-1)-.5)*10*body; // zig-zag flap
    }else if(a.kind==='bebado'&&!this.reduced)sway=Math.sin(now*.004+a.phase*TAU)*.09; // staggering (cambaleando)
    if(!Number.isNaN(a.screenX)&&Math.abs(q.x-a.screenX)>.2)a.flip=q.x<a.screenX;
    a.screenX=q.x;
    const s=squash(now,a.phase,a.moving,this.reduced,this.scale2);
    let sx=s.sx,sy=s.sy,rotation=sway;
    if(a.boss&&!this.reduced){const w=Math.sin(now*.0032+a.phase*TAU);sx*=1+.035*w;sy*=1-.03*w;rotation=w*.035;}
    a.image.setPosition(q.x+dx,q.y-lift).setDepth(depth+1).setScale(sx*body,sy*body).setRotation(rotation).setFlipX(a.flip);
    const eyeX=q.x+dx,eyeY=q.y-lift;
    const flashing=hitFlash(now-a.flashAt);
    if(flashing!==a.flashing||!a.lit||(!flashing&&a.litFlip!==a.flip)){a.flashing=flashing;a.lit=true;a.litFlip=a.flip;if(flashing)a.image.setTintFill(0xffffff);else sunlit(a.image,a.tint);}
    // Imported art v2 (art/horde-art.ts), after the flash so the elite layer copies it; no art = the sprite above stays.
    const outlines=this.options.cityOutlines;
    const shown=applyEnemyArt(a.image,a,a.moving,a.nx-a.px,a.ny-a.py,now,this.options.projector.view,body,outlines);
    const tint=shown?undefined:a.accent;
    if(tint!==a.tint){a.tint=tint;if(!flashing){a.litFlip=a.flip;sunlit(a.image,tint);}}
    if(!shown&&outlines){
      // City mode (contorno-breu): the procedural texture's Breu-ring copy at screen scale; the base outside the city.
      const base=ENEMY_TEXTURES[a.kind][a.elite?1:0];
      outlines.show(a.image,outlines.variant(base,body),base,undefined,.5,art.originY,sx*body,sy*body);
    }
    // The imported figure is sized by its drawn height (horde-art.ts): what hangs on the body follows it.
    const fit=a.fit=enemyArtRatio(a.image);
    const shadow=art.width*size*fit*(a.kind==='pombos'?.45:.66)*body;
    a.shadow.setPosition(q.x,q.y).setScale(shadow/SHADOW_W,shadow*.42/SHADOW_H);
    // Bars only where they matter: recently hit, elite, boss or the tapped target.
    if(barVisible(a,now,a.id===this.targetId,this.recentHits.has(a.id)))this.drawBar(q.x,q.y-this.barLift(a),a);
    else if(a.barBg.visible){a.barBg.setVisible(false);a.barFill.setVisible(false);}
    if(a.id===this.targetId)this.drawRing(q.x,q.y,art.width*size*fit*.8*body);
    if(a.look!==LOOK_NONE||a.sugar||a.prime)this.drawPhase(a,q.x,q.y,eyeX,eyeY,size*fit);
    // Last: drawEyes projects the hero through the shared scratch point (q).
    if(this.dark>0)this.drawEyes(a,eyeX,eyeY,size*fit);
  };
  /**
   * Eyes in the dark (VGM-053B): two Papel eyes with a Breu edge and pupils that look at the local hero, at the
   * critter's head; they blink now and then (never with reduced motion). The body goes dark, where it is does not.
   */
  private drawEyes(a:EnemyActor,x:number,feetY:number,size:number){
    // Only the critters on screen (the pool keeps the whole area of interest): at most a few dozen pairs per frame.
    const v=this.scene.cameras.main.worldView;
    if(x<v.x-40||x>v.right+40||feetY<v.y-40||feetY>v.bottom+160)return;
    // Sizes in CSS px (EYES_CSS), so the eyes read on a phone at the follow zoom; bigger for the elite and the boss.
    const art=ENEMY_ART[a.kind],c=this.css()*size*(a.boss?1.6:1),head=feetY-art.height*art.originY*(a.kind==='pombos'?.55:.62)*size*this.enemyBody;
    const gap=EYES_CSS.gap*c,w=EYES_CSS.width*c,h=EYES_CSS.height*c,edge=EYES_CSS.edge*c,alpha=Math.min(1,this.dark*1.6),g=this.eyes;
    // Imported eyes (efeitos `olhos-escuro`, art-d item 5): the pair as wide as today's, blinking on today's clock.
    const eyes=markArt('eyes');
    if(eyes&&this.art.ready(eyes)){this.art.mark(a,eyes,EYES_DEPTH,eyesFrame(this.now,a.phase,this.reduced,eyes.frames),x,head,2*gap+w+2*edge)?.setAlpha(alpha);return;}
    const open=eyesOpen(this.now,a.phase,this.reduced);
    const me=this.options.selfId?.(),hero=me?this.options.locate?.(me):undefined;
    let lx=0,ly=0;
    if(hero){this.at.x=hero.x;this.at.y=hero.y;const q=this.project(this.at),d=Math.hypot(q.x-x,q.y-head)||1;lx=(q.x-x)/d*EYES_CSS.look*c;ly=(q.y-head)/d*EYES_CSS.look*c;}
    for(const side of [-1,1]){
      const ex=x+side*gap;
      if(!open){g.fillStyle(PALETTE.breu,alpha).fillRect(ex-w/2-edge,head-edge*1.5,w+2*edge,edge*3);g.fillStyle(PALETTE.papel,alpha).fillRect(ex-w/2,head-edge*.5,w,edge);continue;}
      g.fillStyle(PALETTE.breu,alpha).fillEllipse(ex,head,w+2*edge,h+2*edge);
      g.fillStyle(PALETTE.papel,alpha).fillEllipse(ex,head,w,h);
      g.fillStyle(PALETTE.breu,alpha).fillCircle(ex+lx,head+ly,EYES_CSS.pupil*c);
    }
  }
  /** Bancos: the Cliente Prime's crown (7 points, reused every frame). */
  private crownPts:Pt[]=Array.from({length:7},()=>({x:0,y:0}));
  /**
   * Elenco P1 state cues (phase-look.ts), drawn with Graphics calls on scratch points only (no allocation): the coach's
   * lecture ring on the ground (PALESTRA_RADIUS world units, gold: a buff zone, never the orange of danger), the golden
   * sparkle of a buffed critter, the influencer's shiny reflect ring and the motoboy's headlight glow.
   * (x,y): feet on the ground; (bx,by): where the body is drawn (lifted for flyers).
   */
  private drawPhase(a:EnemyActor,x:number,y:number,bx:number,by:number,size:number){
    const look=a.look,art=ENEMY_ART[a.kind],body=this.enemyBody,css=this.css(),now=this.now,reduced=this.reduced;
    const height=art.height*art.originY*size*body;
    if(look.aura){
      const e=groundEllipse(PALESTRA_RADIUS,this.ellipseAxes),k=auraPulse(now,reduced);
      this.ellipse(x,y,e.rx*k,e.ry*k);
      const g=this.ground,n=PHASE_RING_POINTS;
      g.fillStyle(PHASE_GOLD,.1).fillPoints(this.ringPts,true,true,n);
      g.lineStyle(5*css,PALETTE.breu,.35).strokePoints(this.ringPts,true,true,n);
      g.lineStyle(3*css,PHASE_GOLD,.95).strokePoints(this.ringPts,true,true,n);
      this.ellipse(x,y,e.rx*k*.94,e.ry*k*.94);
      g.lineStyle(1.5*css,0xfff3c0,.7).strokePoints(this.ringPts,true,true,n);
    }
    if(look.sparkle){
      const g=this.overlay,top=by-height,s=body*size,f=this.sparkle;
      for(let i=0;i<SPARKLES;i++){
        sparkleFrame(i,now,a.phase,reduced,f);
        this.star4(g,bx+f.dx*s*1.4,top+f.dy*s*1.4,Math.max(f.r*s,2.2*css),PHASE_GOLD,f.alpha);
      }
    }
    if(look.reflect){
      const g=this.overlay,cy=by-height*.5,rx=art.width*.56*size*body,ry=height*.6;
      this.ellipse(bx,cy,rx,ry);
      g.lineStyle(4*css,0xffffff,.35).strokePoints(this.ringPts,true,true,PHASE_RING_POINTS);
      g.lineStyle(2*css,0x9be8f0,.9).strokePoints(this.ringPts,true,true,PHASE_RING_POINTS);
      const t=reflectGlint(now,reduced);
      this.star4(g,bx+Math.cos(t)*rx,cy+Math.sin(t)*ry,6*body,0xffffff,.95);
      this.star4(g,bx+Math.cos(t+Math.PI)*rx,cy+Math.sin(t+Math.PI)*ry,4*body,0xffffff,.7);
    }
    if(a.sugar){
      // Açucarado (D-047): a pink halo around the body and pink sparkles (the gold ones are the coach's buff).
      const g=this.overlay,cy=by-height*.5,rx=art.width*.5*size*body,ry=height*.58,k=reduced?1:1+Math.sin(now*.008+a.phase*TAU)*.06;
      this.ellipse(bx,cy,rx*k,ry*k);
      g.lineStyle(7*css,SUGAR_PINK,.22).strokePoints(this.ringPts,true,true,PHASE_RING_POINTS);
      g.lineStyle(2.2*css,SUGAR_PINK,.85).strokePoints(this.ringPts,true,true,PHASE_RING_POINTS);
      const top=by-height,s=body*size,f=this.sparkle;
      for(let i=0;i<SPARKLES;i++){
        sparkleFrame(i,now,a.phase+.5,reduced,f);
        this.star4(g,bx-f.dx*s*1.5,top+f.dy*s*1.2,Math.max(f.r*s,2.2*css),SUGAR_PINK,f.alpha);
      }
    }
    if(a.prime){
      // Cliente Prime (bancos): a gold crown with three points over the head, and a Breu edge.
      const g=this.overlay,s=body*size,cx=bx,top=by-height-5*s,w=19*s,h=14*s,bob=reduced?0:Math.sin(now*.006+a.phase*TAU)*1.5*s;
      const crown=this.crownPts,shape=CROWN_SHAPE;
      for(let i=0;i<7;i++){crown[i].x=cx+shape[i*2]*w;crown[i].y=top+bob-shape[i*2+1]*h;}
      g.fillStyle(PRIME_GOLD,1).fillPoints(crown,true);
      g.lineStyle(1.6*css,PALETTE.breu,1).strokePoints(crown,true);
      g.fillStyle(PALETTE.breu,1).fillCircle(cx,top-h*.3+bob,2.6*s);
    }
    if(look.headlight){
      const g=this.overlay,k=headlightGlow(now,a.phase,reduced),m=size>1?1.2:1;
      const lx=bx+(a.flip?-1:1)*MOTOBOY_LAMP.x*m*body*this.scale2.sx,ly=by-MOTOBOY_LAMP.y*m*body*this.scale2.sy;
      g.fillStyle(0xfff2a8,.18*k).fillCircle(lx,ly,16*body*k);
      g.fillStyle(0xfff6c8,.35*k).fillCircle(lx,ly,9*body);
      g.fillStyle(0xffffff,.9).fillCircle(lx,ly,3.2*body);
    }
  }
  /** Four-point star from four triangles (no point arrays). */
  private star4(g:Phaser.GameObjects.Graphics,x:number,y:number,r:number,color:number,alpha:number){
    const w=r*.28;
    g.fillStyle(color,alpha).fillTriangle(x-w,y,x+w,y,x,y-r).fillTriangle(x-w,y,x+w,y,x,y+r)
      .fillTriangle(x,y-w,x,y+w,x-r,y).fillTriangle(x,y-w,x,y+w,x+r,y);
  }
  /** Writes an ellipse into the phase ring's scratch points. */
  private ellipse(cx:number,cy:number,rx:number,ry:number){
    for(let i=0;i<PHASE_RING_POINTS;i++){const an=i/PHASE_RING_POINTS*TAU,p=this.ringPts[i];p.x=cx+Math.cos(an)*rx;p.y=cy+Math.sin(an)*ry;}
  }
  private ringPts:Pt[]=Array.from({length:PHASE_RING_POINTS},()=>({x:0,y:0}));
  private ellipseAxes={rx:0,ry:0};
  private sparkle:SparkleFrame={dx:0,dy:0,r:0,alpha:0};
  private barLift(a:EnemyActor){return ENEMY_ART[a.kind].bar*(a.elite?ELITE_SCALE:1)*a.fit*this.enemyBody;}
  /** Two pooled images per enemy (frame + cropped tinted fill): no Graphics triangulation per frame. */
  private drawBar(x:number,y:number,a:EnemyActor){
    // Bars stay proportional to the body, or they hide the horde (× the actor scale in the city; sqrt(ui) has it once).
    const ratio=Math.max(0,Math.min(1,a.hp/Math.max(1,a.maxHp))),u=(a.elite&&!a.boss?Math.sqrt(this.ui/this.enemyBody):1)*this.enemyBody;
    const w=(a.boss?170:a.elite?54:40)*u,h=(a.boss?13:7)*u,border=3*u;
    const fill=a.boss?0xb48cff:ratio>.5?0x8fe39a:ratio>.25?0xffd36e:0xff8080;
    // Imported frame + fill (9-slice) when the variant's pair is in: the fill stretches to the hp share, tinted as today.
    const art=barArt(a.elite&&!a.boss);
    if(art&&this.art.ready(art.frame)&&this.art.ready(art.fill)){
      if(a.barBg.visible){a.barBg.setVisible(false);a.barFill.setVisible(false);}
      const left=x-w/2-border,top=y-border,fw=barFillWidth(w,ratio,(art.fill.left+art.fill.right)*u);
      this.art.slice(a.barBg,art.frame,95000,left,top,w+2*border,h+2*border,u);
      if(fw>0)this.art.slice(a.barFill,art.fill,95001,left+border,top+border,fw,h,u)?.setTint(fill);
      return;
    }
    const key=a.elite&&!a.boss?FX.barElite:FX.bar;
    if(a.barKey!==key){a.barKey=key;a.barBg.setTexture(key);}
    // The frame texture's 3px border stretches with it, so the fill is placed inside the stretched border.
    const sx=(w+2*border)/BAR_W,sy=(h+2*border)/BAR_H,left=x-w/2-border,top=y-border;
    a.barBg.setVisible(true).setPosition(left,top).setScale(sx,sy);
    a.barFill.setVisible(ratio>0).setPosition(left+3*sx,top+3*sy).setScale(sx,sy).setCrop(0,0,FILL_W*ratio,FILL_H).setTint(fill);
  }
  private drawRing(x:number,y:number,width:number){
    const pulse=this.reduced?1:1+.06*Math.sin(this.now*.008);
    const b=this.body,art=markArt('target');
    // Imported ring (frames at its fps, no code pulse), today's outer width and ground depth.
    if(art&&this.art.mark(TARGET_RING,art,this.ground.depth,markFrame(art,this.now,this.reduced),x,y,width+4*b))return;
    this.ground.lineStyle(5*b,0x2b2233,.45).strokeEllipse(x,y,width*pulse+4*b,width*.46*pulse+2*b);
    this.ground.lineStyle(3*b,0xffef94,.95).strokeEllipse(x,y,width*pulse,width*.46*pulse);
  }
  private drawPickup=(a:PickupActor)=>{
    const f=this.frac,now=this.now,reduced=this.reduced;
    a.x=a.px+(a.nx-a.px)*f;a.y=a.py+(a.ny-a.py)*f;
    this.at.x=a.x;this.at.y=a.y;
    const q=this.project(this.at),depth=this.depth(this.at);
    let y=0,scale=1,rotation=0;
    if(a.look===FX.boleto){
      // The rain: falls from the sky, swaying like paper, then lies on the ground slightly turned.
      const k=a.fall?Math.min(1,(now-a.born)/BOLETO_FALL_MS):1;
      y=-BOLETO_FALL_PX*(1-k)*(1-k);rotation=(a.phase-.5)*.5+(1-k)*Math.sin(now*.02+a.phase*TAU)*.6;
      if(k>=1)a.fall=false;
    }else if(a.kind==='xp'){y=gemBounce(now-a.born,reduced);scale=1+Math.min(.7,Math.log2(Math.max(1,a.value))*.14);}
    if(a.promo)scale*=PROMO_SCALE;
    else if(!reduced){
      if(a.kind==='chest'){scale=1+.07*Math.sin(now*.007+a.phase*TAU);rotation=Math.sin(now*.013+a.phase)*.04;}
      else if(a.kind==='heal')rotation=Math.sin(now*.005+a.phase*TAU)*.2;
      else y=-2.5*(1-Math.cos(now*.004+a.phase*TAU));
    }
    // Event prizes behind a canopy: lifted above the trees. The test runs again only when the prize moved 4 px on
    // screen (the magnet, a camera turn) or the trees changed (canopyVersion), not every frame for every boleto.
    let lifted=false;
    if((a.look===FX.boleto||a.promo)&&this.options.canopyCovers){
      const version=this.options.canopyVersion?.()??0;
      if(a.coverX===undefined||a.coverVersion!==version||Math.abs(q.x-a.coverX)>4||Math.abs(q.y-(a.coverY??q.y))>4){a.coverX=q.x;a.coverY=q.y;a.coverVersion=version;a.covered=this.options.canopyCovers(q,depth);}
      lifted=!!a.covered;
    }
    const body=this.body;
    a.image.setPosition(q.x,q.y+y*body).setDepth(lifted?PRIZE_LIFT_DEPTH:depth+1).setScale(scale*body).setRotation(rotation);
    // City mode (contorno-breu): the pickup's Breu-ring copy at screen scale, made for the scale it is drawn at (a big
    // gem or a promo prize gets its own copy, so its ring stays 2 px); the base outside the city.
    const outlines=this.options.cityOutlines;
    if(outlines)outlines.show(a.image,outlines.variant(a.look,scale*body),a.look,undefined,.5,.92,scale*body,scale*body);
    const shadow=(a.kind==='chest'?34:18)*scale*(1+y/60)*body;
    a.shadow.setPosition(q.x,q.y).setScale(shadow/SHADOW_W,shadow*.42/SHADOW_H);
  };
  private drawProjectile=(a:ProjectileActor)=>{
    // vx/vy are units per second: lead in seconds (it used to be in ticks, drawing shots up to 20× too far ahead).
    const lead=projectileLeadSeconds(this.now,this.pushAt,this.tickMs);
    this.at.x=a.x+a.vx*lead;this.at.y=a.y+a.vy*lead;
    const q=this.project(this.at),depth=this.depth(this.at);
    // In the blackout a critter's shot stays above the dark (danger is never hidden, VGM-053B).
    a.image.setPosition(q.x,q.y-PROJECTILE_LIFT*this.body).setDepth(a.hostile&&this.dark>0?LIFTED_DEPTH+1:depth+2).setRotation(a.angle);
    a.shadow.setPosition(q.x,q.y).setScale(a.radius*60/SHADOW_W,a.radius*24/SHADOW_H);
    // An imported sheet with several frames loops at its fps (art v2); one frame (today) never touches the frame.
    if(a.frames>1){const f=projectileFrame(a,this.now-a.born);if(f!==a.frame){a.frame=f;a.image.setFrame(f);}}
  };
  private drawTelegraph=(t:TelegraphState)=>{
    const g=this.ground,u=telegraphPulse(this.nowTick,t.fireTick,this.reduced,t.start),blink=telegraphBlink(this.now,u,this.reduced);
    let n=this.outline(t,1);
    const b=this.decorFrame.bounds;b.minX=b.minY=Infinity;b.maxX=b.maxY=-Infinity;
    for(let i=0;i<n;i++){const p=this.pts[i];if(p.x<b.minX)b.minX=p.x;if(p.x>b.maxX)b.maxX=p.x;if(p.y<b.minY)b.minY=p.y;if(p.y>b.maxY)b.maxY=p.y;}
    const c=PALETTE,look=telegraphLook(t.kind),fill=look.fill??c.cone,fa=look.fillAlpha;
    g.fillStyle(fill,Math.min(1,(.14+.14*u)*fa)).fillPoints(this.pts,true,true,n);
    n=this.outline(t,Math.max(.06,u));
    g.fillStyle(fill,Math.min(1,(.24+.3*u)*fa)).fillPoints(this.pts,true,true,n);
    // D-036: plan the hazard's own drawing (gas, bottle, flames, splat, burst, stamp, charge arrow); it goes on the top
    // layer (never under a critter), the zone part under the danger edge and what is in the air over it.
    const css=this.css(),f=this.decorFrame;
    f.u=u;f.ticksLeft=t.fireTick-this.nowTick;f.now=this.now;f.reduced=this.reduced;f.phase=t.phase;f.css=css;
    const ops=planDecor(t,f,this.projectTo,this.decor);
    // Outline and a light wash go on the top layer so the zone stays readable through the horde, numbers and pops.
    // Line widths follow the UI scale (≥ 1): under ~0.55 zoom (the old whole-island view) a fixed 8px world line got ~2px.
    // The stroke is drawn inset by half its width so its outer edge sits on the real zone, never outside it (D-015).
    n=this.outline(t,1);
    const top=this.top,w=this.ui;
    top.fillStyle(fill,.08+.1*u).fillPoints(this.pts,true,true,n);
    // Three hard bands on the zone's edge (Laranja Cone = danger only): Breu outside, Papel, Cone core. Breu holds on
    // sand, grass and water; Papel holds on the dark trees and the horde; the blink stays on the Papel band only.
    // Hatch over the fill, so the zone reads by shape too (Cone on the grass is close in luminance; deuteranopia).
    // Imported hatch (telegraph-enchimento): the same outline, textured, right under this layer (the wash tints it).
    if(this.fillTex)this.drawFillArt(t,n,css,u);
    else{
      const hatch=hatchSegments(this.pts,n,HATCH_CSS.spacing*css,this.hatch,this.hatchXs);
      if(hatch){top.lineStyle(HATCH_CSS.width*css,c.breu,HATCH_CSS.alpha);for(let i=0;i<hatch;i++){const o=i*4;top.lineBetween(this.hatch[o],this.hatch[o+1],this.hatch[o+2],this.hatch[o+3]);}}
    }
    if(ops)this.replayDecor(top,LAYER_ZONE);
    // Bands in CSS px (never thinner on screen when the camera zooms in); island: never below the old UI-scaled width.
    // City (§7): Breu dashed, Cone solid, Papel dashed in the same phase; the dashes drift slowly (still when reduced).
    const e=this.edgeFrame;
    e.css=css;e.ui=w;e.blink=blink;e.city=this.cityOn;e.colors=c;
    e.dashPhase=this.cityOn?telegraphDashPhase(this.now,this.reduced):0;
    if(this.borderTex){
      // Imported dashed border (telegraph-borda): the band the island's strokes cover, outer edge on the zone (above
      // this layer). In the city its Breu dashed rim (contorno-breu) goes over it, under what is in the air.
      const want=Math.max(TELEGRAPH_EDGE_CSS*css,TELEGRAPH_STROKE*w)/2,half=insetPolygon(this.pts,n,want,this.ptsIn);
      this.drawBorderArt(t,n,half,blink);
      if(this.cityOn)this.edge.drawCityRim(this.airLayer(),this.pts,n,e);
    }else this.edge.draw(top,this.pts,n,e);
    // What is in the air or sticks out of a small zone (bottle, flames, poop, stamp, charge arrow) goes over the edge.
    // With the imported border (a strip above `top`), what is in the air goes on a layer above it.
    if(ops)this.replayDecor(this.borderTex?this.airLayer():top,LAYER_AIR);
  };
  /**
   * Every telegraph, once per frame. Imported art is used when its texture is in and can tile (power of two, WebGL);
   * otherwise (and always with an empty manifest) the drawing is exactly today's Graphics calls.
   */
  private drawTelegraphs(){
    this.fillTex??=this.telegraphTexture(TELEGRAPH_FILL_KEY);
    this.borderTex??=this.telegraphTexture(TELEGRAPH_BORDER_KEY);
    this.topAir?.clear();
    // Imported decorations (art-d item 4): which strips are in this frame; their images are reused in draw order.
    const art=this.decorArt;
    for(let i=0;i<DECOR_ART_IDS.length;i++){const info=decorArtInfo(DECOR_ART_IDS[i]);// Never more frames than the loaded texture has (a short or failed sheet would log "Frame missing").
      art.frames[i]=info&&this.scene.textures.exists(info.key)?Math.min(info.frames,Math.max(1,this.scene.textures.get(info.key).frameTotal-1)):0;art.aspect[i]=info?info.cell[1]/info.cell[0]:1;}
    this.decorUsed=0;
    this.telegraphs.forEach(this.drawTelegraph);
    for(let i=this.decorUsed;i<this.decorShown;i++)this.decorSprites[i].setVisible(false);
    this.decorShown=this.decorUsed;
  }
  /** Size of an imported telegraph texture once it is loaded and tileable; undefined (asked again next frame) before. */
  private telegraphTexture(key:string):{w:number;h:number}|undefined{
    const textures=this.scene.textures;
    if(!textures?.exists(key)||this.scene.renderer?.type!==Phaser.WEBGL)return undefined;
    const source=textures.get(key).source[0];
    return source&&repeatable(source.width,source.height)?{w:source.width,h:source.height}:undefined;
  }
  /** Textured strip on the scene (no transform: its vertices are scene coordinates, written by telegraph-art.ts). */
  private telegraphStrip(key:string,depth:number){
    const rope=this.track(this.scene.add.rope(0,0,key,undefined,Array.from({length:TELEGRAPH_STRIP_POINTS},(_,i)=>({x:i,y:0}))));
    rope.setDepth(depth);rope.dirty=false;return rope;
  }
  /** Hatch texture on the exact outline in this.pts, anchored to the ground; today's urgency ramp drives its alpha. */
  private drawFillArt(t:TelegraphState,n:number,css:number,u:number){
    const tex=this.fillTex as {w:number;h:number},rope=t.fillArt??=this.telegraphStrip(TELEGRAPH_FILL_KEY,TELEGRAPH_TOP_DEPTH-.5);
    fillStrip(this.pts,n,tex.w*FILL_TEXEL_CSS*css,tex.h*FILL_TEXEL_CSS*css,rope.vertices,rope.uv);
    rope.dirty=false;rope.setAlpha(Math.min(1,.7+.3*u)).setVisible(true);
  }
  /** Dashed strip along this.pts (outer edge) and this.ptsIn (centre line, inset by half): today's band, textured. */
  private drawBorderArt(t:TelegraphState,n:number,half:number,blink:number){
    const tex=this.borderTex as {w:number;h:number},rope=t.borderArt??=this.telegraphStrip(TELEGRAPH_BORDER_KEY,TELEGRAPH_TOP_DEPTH+.5);
    borderStrip(this.pts,this.ptsIn,n,2*half,tex.w/tex.h,rope.vertices,rope.uv);
    rope.dirty=false;rope.setAlpha(.85+.15*blink).setVisible(true);
  }
  /**
   * One imported decoration frame (OP_SPRITE): zone frames right under the top layer (its wash and edge go over them),
   * frames in the air above the air layer. Images are made the first time a strip is drawn, then reused.
   */
  private decorSprite(layer:number,alpha:number,d:Float64Array,a:number){
    const info=decorArtInfo(DECOR_ART_IDS[d[a]]);if(!info)return;
    let image=this.decorSprites[this.decorUsed];
    if(!image){image=this.track(this.scene.add.image(0,0,info.key,0));this.decorSprites.push(image);}
    this.decorUsed++;
    if(image.texture.key!==info.key)image.setTexture(info.key,d[a+6]);else image.setFrame(d[a+6]);
    image.setPosition(d[a+1],d[a+2]).setRotation(d[a+3]).setDisplaySize(d[a+4],d[a+5]).setAlpha(alpha)
      .setDepth(layer===LAYER_AIR?TELEGRAPH_TOP_DEPTH+1.5:TELEGRAPH_TOP_DEPTH-.25).setVisible(true);
  }
  /** Layer above the imported border for the decoration in the air (made the first time it is needed). */
  private airLayer(){return this.topAir??=this.track(this.scene.add.graphics().setDepth(TELEGRAPH_TOP_DEPTH+1).setName('horda-ar'));}
  /** Replays one layer of the planned decoration on its Graphics (allocation-free: scratch points only). */
  private replayDecor(g:Phaser.GameObjects.Graphics,layer:number){
    const d=this.decor.data,pts=this.decorPts;
    for(let i=0;i<this.decor.count;i++){
      const o=i*DECOR_STRIDE;if(d[o+1]!==layer)continue;
      const color=d[o+2],alpha=d[o+3],a=o+4;
      switch(d[o]){
        case OP_CIRCLE:g.fillStyle(color,alpha).fillCircle(d[a],d[a+1],d[a+2]);break;
        case OP_LINE:g.lineStyle(d[a+4],color,alpha).lineBetween(d[a],d[a+1],d[a+2],d[a+3]);break;
        case OP_ELLIPSE:case OP_RING:{
          for(let k=0;k<DECOR_ELLIPSE_SEGMENTS;k++){const an=k/DECOR_ELLIPSE_SEGMENTS*TAU,p=pts[k];p.x=d[a]+Math.cos(an)*d[a+2];p.y=d[a+1]+Math.sin(an)*d[a+3];}
          if(d[o]===OP_ELLIPSE)g.fillStyle(color,alpha).fillPoints(pts,true,true,DECOR_ELLIPSE_SEGMENTS);
          else g.lineStyle(d[a+4],color,alpha).strokePoints(pts,true,true,DECOR_ELLIPSE_SEGMENTS);
          break;
        }
        case OP_POLY:{
          const n=d[a];if(n<3)break;
          for(let k=0;k<n;k++){const p=pts[k];p.x=d[a+1+k*2];p.y=d[a+2+k*2];}
          g.fillStyle(color,alpha).fillPoints(pts,true,true,n);break;
        }
        case OP_SPRITE:this.decorSprite(layer,alpha,d,a);break;
      }
    }
  }
  /** Projects the telegraph outline (grown by k) into the scratch points; returns the point count. Same zone the server damages. */
  private outline(t:TelegraphState,k:number){return telegraphOutline(t,k,this.putWorld);}
  private putWorld=(i:number,x:number,y:number)=>{const q=this.options.projector.project(x,y,this.q),p=this.pts[i];p.x=q.x;p.y=q.y;};
  private place(object:Image|Text,x:number,y:number,lift:number,ox=0){
    this.at.x=x;this.at.y=y;const q=this.project(this.at);
    object.setPosition(q.x+ox,q.y-lift);return q;
  }
  private drawWarning=(w:WarningFx)=>{
    if(this.nowTick>=w.atTick||this.now-w.born>8000)return false;
    this.at.x=w.x;this.at.y=w.y;
    const q=this.project(this.at),pulse=this.reduced?1:1+.16*Math.sin((this.now-w.born)*.012);
    const dark=this.dark>0,body=this.body,art=markArt('spawn');
    // Imported mark: the warning's own image on the ground, at today's ellipse width (edge included), playing its frames.
    if(art&&this.scene.textures.exists(art.key)){
      placeMark(w.image,art,markFrame(art,this.now-w.born,this.reduced),q.x,q.y,64*w.size*body+Math.max(7*body,7*this.css()))
        .setDepth(dark?LIFTED_DEPTH+1:this.ground.depth).setAlpha(1);
      return true;
    }
    w.image.setPosition(q.x,q.y-26*body).setDepth(dark?LIFTED_DEPTH+1:this.depth(this.at)+2).setScale(w.size*pulse*this.ui)
      .setAlpha(this.reduced?.9:.65+.35*Math.abs(Math.sin((this.now-w.born)*.006)));
    // Breu 2 | Cone 3 | Breu 2 px CSS at any zoom.
    const css=this.css();
    (dark?this.lifted:this.ground).lineStyle(Math.max(7*body,7*css),PALETTE.breu,.9).strokeEllipse(q.x,q.y,64*w.size*pulse*body,28*w.size*pulse*body)
      .lineStyle(Math.max(3*body,3*css),PALETTE.cone,1).strokeEllipse(q.x,q.y,64*w.size*pulse*body,28*w.size*pulse*body);
    return true;
  };
  /**
   * A poof just spawned: the imported strip (efeitos `morte-poof`, art-d item 6) when it is in, played by age over
   * today's lifetime at today's size; else (always with an empty manifest) today's FX.puff, untouched.
   */
  private poofLook(p:PoofFx){
    const art=poofArt();
    if(art&&this.scene.textures.exists(art.key)){if(p.image.texture.key!==art.key)p.image.setTexture(art.key,0);p.frames=Math.min(art.frames,Math.max(1,this.scene.textures.get(art.key).frameTotal-1));p.fit=art.fit;}
    else if(p.frames){p.image.setTexture(FX.puff);p.frames=0;p.fit=1;}
  }
  private drawPoof=(p:PoofFx)=>{
    const age=this.now-p.born,frame=poof(age,this.poofFrame);
    if(frame.done)return false;
    this.place(p.image,p.x,p.y,p.lift);
    this.at.x=p.x;this.at.y=p.y;
    if(p.frames>1)p.image.setFrame(poofSheetFrame(age,p.frames));
    p.image.setDepth(this.depth(this.at)+3).setScale((this.reduced?1.2:frame.scale)*p.scale*p.fit).setAlpha(frame.alpha)
      .setRotation(this.reduced?0:age*.002);
    return true;
  };
  /** Imported death (art v2): placed like the enemy was (feet, hover lift, depth); horde-art.ts plays and fades it. */
  private drawDeath=(d:DeathFx)=>{
    this.place(d.image,d.x,d.y,d.lift);
    this.at.x=d.x;this.at.y=d.y;d.image.setDepth(this.depth(this.at)+1);
    return drawDeathArt(d.image,d.top,d.kind,d.elite,d.row,this.now-d.born,this.enemyBody,d.art);
  };
  private drawStar=(s:StarFx)=>{
    const age=this.now-s.born;if(age>=STAR_MS)return false;
    const t=age/1000,k=age/STAR_MS;
    let ox:number,oy:number;
    if(this.reduced){ox=s.vx*.12;oy=s.vy*.12;}
    else{ox=s.vx*t;oy=s.vy*t+420*this.body*t*t;}
    this.place(s.image,s.x,s.y,s.lift-oy,ox);
    this.at.x=s.x;this.at.y=s.y;
    s.image.setDepth(this.depth(this.at)+4).setScale((.95-.5*k)*this.body).setAlpha(1-k*k).setRotation(this.reduced?0:s.spin*t);
    return true;
  };
  private drawNumber=(n:NumberFx)=>{
    const frame=damageFloat(this.now-n.born,this.textFrame);
    if(frame.done){this.retireNumber(n,false);return false;}
    this.place(n.text,n.x,n.y,n.lift-frame.y*this.body,n.jitter*this.body);
    n.text.setScale((this.reduced?1:frame.scale)*this.ui).setAlpha(frame.alpha);
    return true;
  };
  private drawPop=(p:PopFx)=>{
    const age=this.now-p.born;if(age>=POP_TEXT_MS)return false;
    const frame=popText(age,this.reduced,this.textFrame);
    this.place(p.text,p.x,p.y,p.lift-frame.y*this.body);
    p.text.setScale(frame.scale*(1+(this.ui-1)*.6)).setAlpha(frame.alpha).setRotation(p.rotation);
    return true;
  };
  private drawBubble=(b:BubbleFx)=>{
    const age=this.now-b.born;if(age>=BUBBLE_MS)return false;
    if(b.player){const p=this.options.locate?.(b.player);if(p){b.x=p.x;b.y=p.y;}b.lift=PLAYER_BUBBLE_LIFT*this.ui;}
    else{const enemy=this.enemies.get(b.enemy);if(enemy){b.x=enemy.x;b.y=enemy.y;b.lift=this.barLift(enemy)+18*this.body;}}
    if(Number.isNaN(b.x)){b.text.setVisible(false);return true;}
    const q=this.place(b.text,b.x,b.y,b.lift);
    const alpha=age<120?age/120:age>BUBBLE_MS-250?(BUBBLE_MS-age)/250:1;
    b.text.setVisible(true).setAlpha(alpha).setScale((this.reduced||age>=160?1:.7+.3*age/160)*this.ui);
    const t=8*this.ui,e=2*this.css(),o=b.player?this.heroBalloons:this.balloons,tx=b.text,bw=tx.displayWidth,bh=tx.displayHeight,by=q.y-b.lift;
    // Imported frame (balloon or "DEVENDO" tag) over today's body box, just above the code tail; the text stays on top.
    const frame=this.art.slice(b.text,sliceArt(b.tag?'tag':'balloon'),o.depth+.5,tx.x-bw/2-e,by-bh-e,bw+2*e,bh+2*e,this.ui);
    if(frame){
      frame.setAlpha(alpha);
      o.fillStyle(PALETTE.breu,alpha).fillTriangle(q.x-t-e,by-1,q.x+t+e,by-1,q.x,by+t*1.25+e*1.6);
      o.fillStyle(b.tag?TAG_RED:PALETTE.papel,alpha).fillTriangle(q.x-t,by-1,q.x+t,by-1,q.x,by+t*1.25);
      return true;
    }
    // Balloon: Papel body with a 2 px Breu edge (it vanished on the light sand), then the Papel tail over it.
    o.fillStyle(PALETTE.breu,alpha).fillRoundedRect(tx.x-bw/2-e,by-bh-e,bw+2*e,bh+2*e,10*this.ui)
      .fillTriangle(q.x-t-e,by-1,q.x+t+e,by-1,q.x,by+t*1.25+e*1.6);
    o.fillStyle(b.tag?TAG_RED:PALETTE.papel,alpha).fillRoundedRect(tx.x-bw/2,by-bh,bw,bh,8*this.ui)
      .fillTriangle(q.x-t,by-1,q.x+t,by-1,q.x,by+t*1.25);
    return true;
  };

  /** World px per CSS px at the current camera zoom: hard edges keep a minimum width on screen (onda 4: ≥ 1,5 px CSS). */
  private css(){return 1/Math.max(.05,this.scene.cameras.main.zoom);}
  private hatch=new Float64Array(HATCH_MAX_LINES*4);
  /** Imported telegraph textures (telegraph-art.ts), set once loaded and tileable; undefined = today's drawing. */
  private fillTex?:{w:number;h:number};
  private borderTex?:{w:number;h:number};
  private topAir?:Phaser.GameObjects.Graphics;
  /** D-036 decoration: one op buffer, one frame object and one scratch polygon, reused by every telegraph. */
  private decor=new DecorBuffer();
  private decorArt={frames:DECOR_ART_IDS.map(()=>0),aspect:DECOR_ART_IDS.map(()=>1)};
  private decorFrame:DecorFrame={u:0,ticksLeft:0,now:0,reduced:false,phase:0,css:1,bounds:{minX:0,minY:0,maxX:-1,maxY:-1},art:this.decorArt};
  /** Imported decoration images (made on first use only), how many are drawn this frame and were last frame. */
  private decorSprites:Image[]=[];
  private decorUsed=0;
  private decorShown=0;
  private decorPts:Pt[]=Array.from({length:Math.max(DECOR_ELLIPSE_SEGMENTS,POLY_MAX)},()=>({x:0,y:0}));
  private projectTo=(x:number,y:number,out:Pt)=>this.options.projector.project(x,y,out);
  private hatchXs=new Float64Array(OUTLINE_MAX_POINTS);
  private project(p:Pt){return this.options.projector.project(p.x,p.y,this.q);}
  private depth(p:Pt){return this.options.projector.depth(p.x,p.y);}
  private count(pool:{created:number;active:number}){return {created:pool.created,active:pool.active};}
  private track<T extends Phaser.GameObjects.GameObject>(object:T):T{this.objects.push(object);return object;}
}

/** The city's contact shadow texture (city-edge-rules.ts): flat Breu 38% in FX.shadow's frame, generated once. */
function ensureCityShadow(scene:Phaser.Scene){
  if(scene.textures.exists(CITY_SHADOW_KEY))return;
  const t=CITY_SHADOW_TEXTURE,e=t.ellipse,g=scene.make.graphics({x:0,y:0},false);
  g.fillStyle(CITY_CONTACT_SHADOW.color,CITY_CONTACT_SHADOW.alpha).fillEllipse(e.x,e.y,e.width,e.height,32);
  g.generateTexture(CITY_SHADOW_KEY,t.width,t.height);g.destroy();
}
