/**
 * Pooled render layers for the horde run: enemies, pickups, projectiles, telegraphs and comic FX.
 * Steady state creates and destroys no GameObjects; pools grow only when demand exceeds their history.
 */
import Phaser from 'phaser';
import type {RunView,EnemyView,PickupView,ProjectileView,TelegraphView} from '../../contract/index.ts';
import type {SimEvent} from '../../contract/index.ts';
import {ENEMY_ART,ELITE_SCALE,FX,enemyKind,enemyTexture,pickupLook,projectileTexture,type EnemyKind} from './keys.ts';
import {ensureHordeTextures} from './textures.ts';
import {applyEnemyArt,resetEnemyArt} from '../art/horde-art.ts';
import {KeyedPool,Ring} from './pool.ts';
import {squash,gemBounce,hitFlash,poof,popText,damageFloat,telegraphPulse,telegraphBlink,hashPhase,
  POP_TEXT_MS,type Scale2,type PoofFrame,type TextFrame} from './motion.ts';
import {deathLine,kindStyle,damageLabel,sayTag,skillBubbleLine,SKILL_BUBBLE_GAP_MS} from './jokes.ts';
import type {Projector} from './projector.ts';
import {HATCH_MAX_LINES,OUTLINE_MAX_POINTS,hatchSegments,insetPolygon,telegraphOutline} from './telegraph-shape.ts';
import {DECOR_STRIDE,DecorBuffer,LAYER_AIR,LAYER_ZONE,OP_CIRCLE,OP_ELLIPSE,OP_LINE,OP_POLY,OP_RING,POLY_MAX,planDecor,telegraphLook,type DecorFrame} from './telegraph-look.ts';
import {token,tokenColor} from '../ui/tokens.ts';
import {EYES_DEPTH,LIFTED_DEPTH,eyesOpen} from './blackout-rules.ts';
import {FX_BUDGET,RecentHits,admitNumber,admitPop,barVisible,canMerge,evictionIndex,numberPriority,type EffectsProfile,type FxBudget} from './legibility.ts';

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
}

interface EnemyActor{
  image:Image;shadow:Image;barBg:Image;barFill:Image;barKey:string;id:string;kind:EnemyKind;elite:boolean;boss:boolean;hp:number;maxHp:number;hitAt:number;
  px:number;py:number;nx:number;ny:number;x:number;y:number;
  phase:number;flashAt:number;flashing:boolean;screenX:number;flip:boolean;moving:boolean;
}
/** look: texture key (an XP pickup of the boleto rain is a boleto, VGM-053B); fall: it drops from the sky when it appears. */
interface PickupActor{image:Image;shadow:Image;kind:string;look:string;fall:boolean;promo:boolean;value:number;born:number;phase:number;px:number;py:number;nx:number;ny:number;x:number;y:number;
  /** Event prizes: where the canopy test last ran (screen px) and its answer; undefined = run it on the next frame. */
  coverX?:number;coverY?:number;covered?:boolean;coverVersion?:number}
interface ProjectileActor{image:Image;shadow:Image;look:string;x:number;y:number;vx:number;vy:number;radius:number;hostile:boolean;angle:number}
/** width: undefined = server default (D-015: cone = full aperture in radians, line = thickness). */
interface TelegraphState{shape:TelegraphView['shape'];x:number;y:number;radius:number;dx:number;dy:number;width:number|undefined;fireTick:number;start:number;
  /** D-036 hazard kind (undefined = generic look) and a per-id phase so twin hazards do not flicker in sync. */
  kind:TelegraphView['kind'];phase:number}
interface NumberFx{text:Text;born:number;x:number;y:number;lift:number;jitter:number;live:boolean;target:string;total:number;crit:boolean;hostile:boolean;priority:boolean;self:boolean}
interface PopFx{text:Text;born:number;x:number;y:number;lift:number;rotation:number}
interface PoofFx{image:Image;born:number;x:number;y:number;lift:number;scale:number}
interface StarFx{image:Image;born:number;x:number;y:number;lift:number;vx:number;vy:number;spin:number}
/** enemy: the barking critter; player: the skill caster (E7-skill-hud-wiring), followed through options.locate. */
interface BubbleFx{text:Text;born:number;enemy:string;player:string;x:number;y:number;lift:number;
  /** A status tag (the agiota's "DEVENDO", D-033): red body, Papel text. */
  tag:boolean}
interface WarningFx{image:Image;born:number;x:number;y:number;atTick:number;size:number}

export const CAPS={damage:FX_BUDGET.full.numbers,pops:7,poofs:24,stars:120,bubbles:3,warnings:16} as const;
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
  const key=enemyKind(kind)===kind?kind:'generic';
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
/** Width of the telegraph's outer (light) stroke at UI scale 1, in world px; the red core is half of it. */
export const TELEGRAPH_STROKE=8;
/**
 * Telegraph edge bands in CSS px (onda 4: every band ≥ 1,5 px on screen at the follow camera's 0,583 zoom):
 * Breu 2 | Papel 2 | Cone 3 | Papel 2 | Breu 2, so the full edge is 11 px wide, inside the zone (D-015).
 */
export const TELEGRAPH_BANDS_CSS={breu:2,papel:2,cone:3} as const;
const TELEGRAPH_EDGE_CSS=2*TELEGRAPH_BANDS_CSS.breu+2*TELEGRAPH_BANDS_CSS.papel+TELEGRAPH_BANDS_CSS.cone;
/** Hatch of the zone: Breu diagonals, 1,5 px CSS wide every 9 px CSS, at 18%. */
const HATCH_CSS={width:1.5,spacing:9,alpha:.18} as const;
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
  private now=0;
  private ui=1;
  /** options.actorScale, read once per frame (1 on the island and the endless map). */
  private body=1;
  private numbersThisPush=0;
  private q:Pt={x:0,y:0};
  private pushAt=0;
  private viewTick=0;
  private frac=1;
  private nowTick=0;
  private lastEventId=-1;
  private lastBubbleAt=-Infinity;
  private targetId?:string;
  private snapNext=false;
  private at:Pt={x:0,y:0};
  private pts:Pt[]=Array.from({length:OUTLINE_MAX_POINTS},()=>({x:0,y:0}));
  private ptsIn:Pt[]=Array.from({length:OUTLINE_MAX_POINTS},()=>({x:0,y:0}));
  private scale2:Scale2={sx:1,sy:1};
  private poofFrame:PoofFrame={scale:0,alpha:0,done:false};
  private textFrame:TextFrame={y:0,scale:1,alpha:1,done:false};

  constructor(scene:Phaser.Scene,options:HordeRendererOptions){
    this.scene=scene;this.options=options;this.reduced=!!options.reduced;this.tickMs=options.tickMs??50;this.pushMs=Math.max(1,options.pushMs??this.tickMs);
    applyPalette();
    this.fx=FX_BUDGET[options.effects??'full'];this.recentHits=new RecentHits(this.fx.bars);
    ensureHordeTextures(scene);
    this.ground=this.track(scene.add.graphics().setDepth(-9970));
    this.overlay=this.track(scene.add.graphics().setDepth(95000));
    this.balloons=this.track(scene.add.graphics().setDepth(BALLOON_BODY_DEPTH));
    this.heroBalloons=this.track(scene.add.graphics().setDepth(HERO_BALLOON_DEPTH));
    this.top=this.track(scene.add.graphics().setDepth(TELEGRAPH_TOP_DEPTH));
    const image=(key:string)=>()=>this.track(scene.add.image(0,0,key).setVisible(false).setActive(false));
    const text=(style:TextStyle,depth:number)=>()=>this.track(scene.add.text(0,0,'',style).setOrigin(.5,1).setDepth(depth).setVisible(false).setActive(false));
    const showImage=(o:{image:Image},active:boolean)=>{
      o.image.setVisible(active).setActive(active);
      if(!active)o.image.clearTint().setAlpha(1).setScale(1).setRotation(0).setFlipX(false);
    };
    const shadow=()=>this.track(scene.add.image(0,0,FX.shadow).setDepth(-9980).setVisible(false).setActive(false));
    const bar=(key:string,depth:number)=>this.track(scene.add.image(0,0,key).setOrigin(0,0).setDepth(depth).setVisible(false).setActive(false));
    const showActor=(o:{image:Image;shadow:Image},active:boolean)=>{showImage(o,active);o.shadow.setVisible(active).setActive(active);};
    const showEnemy=(o:EnemyActor,active:boolean)=>{showActor(o,active);if(!active){o.barBg.setVisible(false);o.barFill.setVisible(false);}};
    const showText=(o:{text:Text},active:boolean)=>{o.text.setVisible(active).setActive(active);if(!active)o.text.setAlpha(1).setScale(1).setRotation(0);};
    this.enemies=new KeyedPool<EnemyActor>(()=>({image:image(enemyTexture('bebado'))(),shadow:shadow(),barBg:bar(FX.bar,95000),barFill:bar(FX.barFill,95001),barKey:FX.bar,id:'',kind:'bebado',elite:false,boss:false,hp:1,maxHp:1,hitAt:-1e9,
      px:0,py:0,nx:0,ny:0,x:0,y:0,phase:0,flashAt:-1e9,flashing:false,screenX:NaN,flip:false,moving:false}),showEnemy);
    this.pickups=new KeyedPool<PickupActor>(()=>({image:image(pickupLook('xp'))(),shadow:shadow(),kind:'xp',look:pickupLook('xp'),fall:false,promo:false,value:1,born:0,phase:0,px:0,py:0,nx:0,ny:0,x:0,y:0}),showActor);
    this.eyes=this.track(scene.add.graphics().setDepth(EYES_DEPTH));
    this.lifted=this.track(scene.add.graphics().setDepth(LIFTED_DEPTH));
    this.projectiles=new KeyedPool<ProjectileActor>(()=>({image:image(FX.projFriendly)(),shadow:shadow(),look:FX.projFriendly,x:0,y:0,vx:0,vy:0,radius:.2,hostile:false,angle:0}),showActor);
    this.telegraphs=new KeyedPool<TelegraphState>(()=>({shape:'circle' as TelegraphView['shape'],x:0,y:0,radius:1,dx:1,dy:0,width:undefined,fireTick:0,start:0,kind:undefined,phase:0}),()=>{});
    this.numbers=new Ring<NumberFx>(()=>({text:text(DAMAGE_STYLE,95500)(),born:0,x:0,y:0,lift:0,jitter:0,live:false,target:'',total:0,crit:false,hostile:false,priority:false,self:false}),showText,CAPS.damage);
    this.pops=new Ring(()=>({text:text(popStyle('bebado'),95800)(),born:0,x:0,y:0,lift:0,rotation:0}),showText,CAPS.pops);
    this.poofs=new Ring(()=>({image:image(FX.puff)(),born:0,x:0,y:0,lift:0,scale:1}),showImage,CAPS.poofs);
    this.stars=new Ring(()=>({image:image(FX.star)(),born:0,x:0,y:0,lift:0,vx:0,vy:0,spin:0}),showImage,CAPS.stars);
    this.bubbles=new Ring<BubbleFx>(()=>({text:text(BUBBLE_STYLE,96000)(),born:0,enemy:'',player:'',x:0,y:0,lift:0,tag:false}),showText,CAPS.bubbles);
    this.warnings=new Ring(()=>({image:image(FX.warning)(),born:0,x:0,y:0,atTick:0,size:1}),showImage,CAPS.warnings);
  }

  /** Feed a new authoritative view (≈20 Hz). Processes view.events once each by eventId. */
  push(view:RunView){
    if(view.tick<this.viewTick)this.lastEventId=-1; // new run or server restart
    this.viewTick=view.tick;this.pushAt=this.now;this.numbersThisPush=0;
    // Sync first and retire after the events, so damage on a just-spawned or just-killed enemy still finds its actor.
    this.enemies.begin();
    for(let i=0;i<view.enemies.length;i++)if(view.enemies[i].hp>0)this.syncEnemy(view.enemies[i]);
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
    this.frac=this.snapNext?1:Math.min(1,Math.max(0,timeMs-this.pushAt)/this.pushMs);
    this.nowTick=this.viewTick+Math.min(since,2);
    this.ui=Math.max(.5,Math.min(3,this.options.uiScale?.()??1));
    this.body=this.options.actorScale?.()??1;
    this.ground.clear();this.overlay.clear();this.balloons.clear();this.heroBalloons.clear();this.top.clear();this.eyes.clear();this.lifted.clear();
    this.telegraphs.forEach(this.drawTelegraph);
    this.enemies.forEach(this.drawEnemy);
    this.pickups.forEach(this.drawPickup);
    this.projectiles.forEach(this.drawProjectile);
    this.warnings.retain(this.drawWarning);
    this.poofs.retain(this.drawPoof);
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
      bubbles:this.count(this.bubbles),warnings:this.count(this.warnings),graphics:{created:4,active:4},
    };
    let created=0,active=0;
    for(const key in byLayer){created+=byLayer[key].created;active+=byLayer[key].active;}
    return {created,active,byLayer};
  }

  destroy(){
    this.enemies.clear();this.pickups.clear();this.projectiles.clear();this.telegraphs.clear();
    this.numberByTarget.clear();this.recentHits.clear();this.numbers.clear();this.pops.clear();this.poofs.clear();this.stars.clear();this.bubbles.clear();this.warnings.clear();
    for(const object of this.objects)object.destroy();
    this.objects.length=0;
  }

  // ---------- reconciliation ----------
  private syncEnemy(view:EnemyView){
    const used=this.enemies.use(view.id),a=used.item,kind=enemyKind(view.kind),elite=!!view.elite&&kind!=='chefe';
    if(used.fresh||a.kind!==kind||a.elite!==elite){
      a.image.setTexture(enemyTexture(kind,elite)).setOrigin(.5,ENEMY_ART[kind].originY);
      a.kind=kind;a.elite=elite;
    }
    if(used.fresh){
      a.id=view.id;a.phase=hashPhase(view.id);a.flashAt=-1e9;a.hitAt=-1e9;a.flashing=false;a.screenX=NaN;a.flip=a.phase<.5;resetEnemyArt(a.image);
      a.px=a.nx=a.x=view.x;a.py=a.ny=a.y=view.y;
    }else if(Math.abs(view.x-a.nx)+Math.abs(view.y-a.ny)>SNAP_UNITS){a.px=a.x=view.x;a.py=a.y=view.y;}
    else{a.px=a.x;a.py=a.y;}
    a.moving=Math.abs(view.x-a.nx)+Math.abs(view.y-a.ny)>.002;
    a.nx=view.x;a.ny=view.y;a.hp=view.hp;a.maxHp=view.maxHp;a.boss=!!view.boss||kind==='chefe';
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
    const used=this.projectiles.use(view.id),a=used.item,look=projectileTexture(view.hostile,view.source);
    if(used.fresh||a.look!==look||a.radius!==view.radius){
      a.look=look;a.image.setTexture(look).setOrigin(.5,.5);
      a.image.setScale(Math.max(.5,Math.min(3,view.radius*2*46/Math.max(1,a.image.width))));
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
    switch(event.type){
      case 'damage':{
        const enemy=this.enemies.get(event.target);
        if(enemy){
          enemy.flashAt=this.now;enemy.hitAt=this.now;if(!enemy.elite&&!enemy.boss)this.recentHits.hit(event.target);
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
      case 'say':{const tag=sayTag(event.key);if(tag)this.spawnSkillBubble(event.source,tag,true);else this.spawnSkillBubble(event.source,event.line);break;}
      case 'boss-phase':{const boss=this.enemies.get(event.enemy);if(boss)boss.flashAt=this.now;break;}
    }
  }
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
  private spawnDeath(kind:string,id:string,x:number,y:number){
    const k=enemyKind(kind),phase=hashPhase(id),body=this.body,lift=ENEMY_ART[k].height*.35*body;
    const puff=this.poofs.spawn();
    puff.born=this.now;puff.x=x;puff.y=y;puff.lift=lift;puff.scale=(k==='chefe'?2.4:1)*body;
    puff.image.setTint(kindStyle(kind).tint);
    const starCount=this.fx.starsPerKill;
    for(let i=0;i<starCount;i++){
      const star=this.stars.spawn(),angle=(i/starCount+phase)*TAU,speed=170+60*((i*7+phase*10)%3)/3;
      star.born=this.now;star.x=x;star.y=y;star.lift=lift;
      star.vx=Math.cos(angle)*speed*body;star.vy=(Math.sin(angle)*speed*.8-90)*body;star.spin=(i%2?1:-1)*(4+phase*4);
      star.image.setTint(i%2?0xfff1a8:kindStyle(kind).tint);
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
    b.born=this.now;b.enemy=enemy;b.player='';b.tag=false;b.x=actor?.x??NaN;b.y=actor?.y??NaN;b.lift=actor?this.barLift(actor)+16*this.body:110*this.body;
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
  private spawnSkillBubble(player:string,line:string,tag=false){
    // A status tag is game information (the mark makes the player take more damage): it never waits for the gap.
    const last=this.skillBubbleAt.get(player)??-Infinity;
    if(!tag&&this.now-last<SKILL_BUBBLE_GAP_MS)return;
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
    const f=this.frac,now=this.now,art=ENEMY_ART[a.kind],size=a.elite?ELITE_SCALE:1,body=this.body;
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
    if(flashing!==a.flashing){a.flashing=flashing;if(flashing)a.image.setTintFill(0xffffff);else a.image.clearTint();}
    // Imported art v2 (art/horde-art.ts), after the flash so the elite layer copies it; no art = the sprite above stays.
    applyEnemyArt(a.image,a,a.moving,a.nx-a.px,a.ny-a.py,now,this.options.projector.view,body);
    const shadow=art.width*size*(a.kind==='pombos'?.45:.66)*body;
    a.shadow.setPosition(q.x,q.y).setScale(shadow/SHADOW_W,shadow*.42/SHADOW_H);
    // Bars only where they matter: recently hit, elite, boss or the tapped target.
    if(barVisible(a,now,a.id===this.targetId,this.recentHits.has(a.id)))this.drawBar(q.x,q.y-this.barLift(a),a);
    else if(a.barBg.visible){a.barBg.setVisible(false);a.barFill.setVisible(false);}
    if(a.id===this.targetId)this.drawRing(q.x,q.y,art.width*size*.8*body);
    // Last: drawEyes projects the hero through the shared scratch point (q).
    if(this.dark>0)this.drawEyes(a,eyeX,eyeY,size);
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
    const art=ENEMY_ART[a.kind],c=this.css()*size*(a.boss?1.6:1),head=feetY-art.height*art.originY*(a.kind==='pombos'?.55:.62)*size*this.body;
    const gap=EYES_CSS.gap*c,w=EYES_CSS.width*c,h=EYES_CSS.height*c,edge=EYES_CSS.edge*c,alpha=Math.min(1,this.dark*1.6),g=this.eyes;
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
  private barLift(a:EnemyActor){return ENEMY_ART[a.kind].bar*(a.elite?ELITE_SCALE:1)*this.body;}
  /** Two pooled images per enemy (frame + cropped tinted fill): no Graphics triangulation per frame. */
  private drawBar(x:number,y:number,a:EnemyActor){
    // Bars stay proportional to the body, or they hide the horde (× the actor scale in the city; sqrt(ui) has it once).
    const ratio=Math.max(0,Math.min(1,a.hp/Math.max(1,a.maxHp))),u=(a.elite&&!a.boss?Math.sqrt(this.ui/this.body):1)*this.body;
    const w=(a.boss?170:a.elite?54:40)*u,h=(a.boss?13:7)*u,border=3*u;
    const fill=a.boss?0xb48cff:ratio>.5?0x8fe39a:ratio>.25?0xffd36e:0xff8080;
    const key=a.elite&&!a.boss?FX.barElite:FX.bar;
    if(a.barKey!==key){a.barKey=key;a.barBg.setTexture(key);}
    // The frame texture's 3px border stretches with it, so the fill is placed inside the stretched border.
    const sx=(w+2*border)/BAR_W,sy=(h+2*border)/BAR_H,left=x-w/2-border,top=y-border;
    a.barBg.setVisible(true).setPosition(left,top).setScale(sx,sy);
    a.barFill.setVisible(ratio>0).setPosition(left+3*sx,top+3*sy).setScale(sx,sy).setCrop(0,0,FILL_W*ratio,FILL_H).setTint(fill);
  }
  private drawRing(x:number,y:number,width:number){
    const pulse=this.reduced?1:1+.06*Math.sin(this.now*.008);
    const b=this.body;
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
    const shadow=(a.kind==='chest'?34:18)*scale*(1+y/60)*body;
    a.shadow.setPosition(q.x,q.y).setScale(shadow/SHADOW_W,shadow*.42/SHADOW_H);
  };
  private drawProjectile=(a:ProjectileActor)=>{
    const lead=Math.min(2,Math.max(0,(this.now-this.pushAt)/this.tickMs));
    this.at.x=a.x+a.vx*lead;this.at.y=a.y+a.vy*lead;
    const q=this.project(this.at),depth=this.depth(this.at);
    // In the blackout a critter's shot stays above the dark (danger is never hidden, VGM-053B).
    a.image.setPosition(q.x,q.y-PROJECTILE_LIFT*this.body).setDepth(a.hostile&&this.dark>0?LIFTED_DEPTH+1:depth+2).setRotation(a.angle);
    a.shadow.setPosition(q.x,q.y).setScale(a.radius*60/SHADOW_W,a.radius*24/SHADOW_H);
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
    const hatch=hatchSegments(this.pts,n,HATCH_CSS.spacing*css,this.hatch,this.hatchXs);
    if(hatch){top.lineStyle(HATCH_CSS.width*css,c.breu,HATCH_CSS.alpha);for(let i=0;i<hatch;i++){const o=i*4;top.lineBetween(this.hatch[o],this.hatch[o+1],this.hatch[o+2],this.hatch[o+3]);}}
    if(ops)this.replayDecor(top,LAYER_ZONE);
    // Bands in CSS px (never thinner on screen when the camera zooms in); never below the old UI-scaled width either.
    const want=Math.max(TELEGRAPH_EDGE_CSS*css,TELEGRAPH_STROKE*w)/2,half=insetPolygon(this.pts,n,want,this.ptsIn),k=2*half/TELEGRAPH_EDGE_CSS;
    top.lineStyle(2*half,c.breu,.95).strokePoints(this.ptsIn,true,true,n);
    top.lineStyle(k*(2*TELEGRAPH_BANDS_CSS.papel+TELEGRAPH_BANDS_CSS.cone),c.papel,.55+.45*blink).strokePoints(this.ptsIn,true,true,n);
    top.lineStyle(k*TELEGRAPH_BANDS_CSS.cone,c.cone,1).strokePoints(this.ptsIn,true,true,n);
    // What is in the air or sticks out of a small zone (bottle, flames, poop, stamp, charge arrow) goes over the edge.
    if(ops)this.replayDecor(top,LAYER_AIR);
  };
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
    const dark=this.dark>0,body=this.body;
    w.image.setPosition(q.x,q.y-26*body).setDepth(dark?LIFTED_DEPTH+1:this.depth(this.at)+2).setScale(w.size*pulse*this.ui)
      .setAlpha(this.reduced?.9:.65+.35*Math.abs(Math.sin((this.now-w.born)*.006)));
    // Breu 2 | Cone 3 | Breu 2 px CSS at any zoom.
    const css=this.css();
    (dark?this.lifted:this.ground).lineStyle(Math.max(7*body,7*css),PALETTE.breu,.9).strokeEllipse(q.x,q.y,64*w.size*pulse*body,28*w.size*pulse*body)
      .lineStyle(Math.max(3*body,3*css),PALETTE.cone,1).strokeEllipse(q.x,q.y,64*w.size*pulse*body,28*w.size*pulse*body);
    return true;
  };
  private drawPoof=(p:PoofFx)=>{
    const age=this.now-p.born,frame=poof(age,this.poofFrame);
    if(frame.done)return false;
    this.place(p.image,p.x,p.y,p.lift);
    this.at.x=p.x;this.at.y=p.y;
    p.image.setDepth(this.depth(this.at)+3).setScale((this.reduced?1.2:frame.scale)*p.scale).setAlpha(frame.alpha)
      .setRotation(this.reduced?0:age*.002);
    return true;
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
  /** D-036 decoration: one op buffer, one frame object and one scratch polygon, reused by every telegraph. */
  private decor=new DecorBuffer();
  private decorFrame:DecorFrame={u:0,ticksLeft:0,now:0,reduced:false,phase:0,css:1,bounds:{minX:0,minY:0,maxX:-1,maxY:-1}};
  private decorPts:Pt[]=Array.from({length:Math.max(DECOR_ELLIPSE_SEGMENTS,POLY_MAX)},()=>({x:0,y:0}));
  private projectTo=(x:number,y:number,out:Pt)=>this.options.projector.project(x,y,out);
  private hatchXs=new Float64Array(OUTLINE_MAX_POINTS);
  private project(p:Pt){return this.options.projector.project(p.x,p.y,this.q);}
  private depth(p:Pt){return this.options.projector.depth(p.x,p.y);}
  private count(pool:{created:number;active:number}){return {created:pool.created,active:pool.active};}
  private track<T extends Phaser.GameObjects.GameObject>(object:T):T{this.objects.push(object);return object;}
}
