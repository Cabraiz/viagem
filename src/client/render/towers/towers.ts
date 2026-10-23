/**
 * Defenses on the map (card torres-render; D-041, art pack design/proximos/08-TORRES.md): the base by phase (obra-1..3,
 * pronta, danificada, ruina) in the camera's view, the weapon turning toward its target in 8 directions at the `mount`,
 * and per calibre the muzzle flash, the shot (tracer, lobbed shell, rocket, light beam, wire spark ring), its trail,
 * the explosion and the crater left on the snow; the Gustavão's impact shakes the screen (none with reduced motion).
 * Imported art (manifest group `torres`, art/manifest.ts) when delivered; otherwise the procedural drawing below:
 * iso boxes in the city's materials with the Breu contour (D-022 double edge), scaffold poles while in obra.
 * Depth: a defense sorts at its footprint's front corner (like the city's blocks), so a figure behind any part of it is
 * drawn behind it; every effect sorts at the actor depth of its own point (a shot behind a building is covered by it).
 * Occlusion: a hero or ally behind a defense keeps visible, the defense fades like the city's props (render/city/
 * occlusion.ts propCovers + CoverFader, the same rule, pivot, figure box and timings as the buildings).
 * Every procedural texture (bases, weapons, craters, effects) is a frame of one shared atlas (tower-atlas.ts), so the
 * defenses never break the sprite batch with textures of their own.
 * Lighting card (render/light.ts): each defense casts a soft shadow away from the sun (tower-shadow.ts), baked per kind
 * × phase × view × size in a layer of its own over the ground decals and under everything standing; off with `?luz=0`
 * and in economy mode (`economy`, set by the scene).
 * Effects come from fixed pools of Images of frames baked once (craters and the wire's ring in a Layer on the ground):
 * nothing is tessellated per frame, a crater is placed once, an effect's depth is set when it spawns or crosses a
 * half-unit cell, the weapons re-scan the horde only when they fire or every RESCAN_MS (with the server's aim, never),
 * and a defense's depth and cover test run only when it, the figures or the city's columns (`depthVersion`) changed. Pure rules in tower-rules.ts. Pure drawing: the caller pushes the defenses (`push`) and the enemies
 * (`setEnemies`) and calls `update` every frame.
 */
import Phaser from 'phaser';
import {artIndex,groupFileUrl} from '../../art/manifest.ts';
import {CoverFader,HERO_SCREEN,propCovers,type Figure} from '../city/occlusion.ts';
import {MATERIALS} from '../city/palette.ts';
import {VIEW_PIVOT,depth as groundDepthKey,type Pt,type Rect} from '../city/projection.ts';
import {tokenColor} from '../../ui/tokens.ts';
import {TowerAtlas,type AtlasFrame} from './tower-atlas.ts';
import {SHADOW_SOFT_PX,castHeight,softShadow,towerShadowLook} from './tower-shadow.ts';
import {lightEnabled} from '../light.ts';
import {getAudio} from '../../audio/engine.ts';
import {UsableGlow} from '../usable-glow.ts';
import {AIM_FALLBACK,CALIBRE,CRATER,PHASE_HEIGHT,TOWER_KINDS,TOWER_LOOK,TURN_MS,aimIndex,aimedIndex,baseFrame,canFire,dir8,dirVector,firedNow,flightMs,lobHeight,shakeAt,shakeOffset,
  towerArt,towerArtScale,towerPhase,textureRatio,turnToward,weaponFrame,type CalibreLook,type Dir8,type TowerKind,type TowerLook,type TowerPhase,type TowerView} from './tower-rules.ts';

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

interface Tower {
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
  rect:Rect;prop:{x:number;y:number;rect:Rect};mount:Pt;height:number;seen:number;target:number;
  /** Draw depth (its footprint's front corner) and the server aim the cached `want` was turned from. */
  depth:number;aimFor:number;
}
/** Pooled effect images are made on first use and only hidden afterwards. */
type Img=Phaser.GameObjects.Image|undefined;
/**
 * A shot: world path from (x0, y0, z0) to the ground at (x1, y1); (ox, oy) the screen offset from that path's start to
 * the barrel tip, faded out along the flight; `cell` the half-unit cell its depth was taken in; `d0` the defense's depth.
 */
interface Shot {on:boolean;cal:CalibreLook;x0:number;y0:number;z0:number;x1:number;y1:number;born:number;ms:number;mx:number;my:number;ox:number;oy:number;
  cell:number;d0:number;dz:number;trail:Img;head:Img;puff:Img}
interface Flash {on:boolean;x:number;y:number;r:number;born:number;ms:number;depth:number;img:Img}
interface Blast {on:boolean;x:number;y:number;r:number;born:number;ms:number;ring:boolean;depth:number;img:Img}
interface Crater {on:boolean;x:number;y:number;r:number;born:number;ms:number}

export const SHOT_POOL=192,FLASH_POOL=48,BLAST_POOL=64,CRATER_POOL=40;
/** Shots per volley drawn at most (a 6-shot volley reads as a burst, not 6 parallel lines). */
const BURST_MAX=4,BURST_GAP_MS=45;
const RECOIL_MS=90;
/** Two or three volleys of one snapshot (the room's counter jumped) are drawn this far apart, not at once. */
const VOLLEY_STAGGER_MS=70;
/** Crater decals: a small frame, and a large one for the big shells and the Gustavão (no blur when scaled up). */
const CRATER_FRAME='cratera',CRATER_TEX=128,CRATER_BIG='cratera-g',CRATER_BIG_TEX=512,CRATER_BIG_FROM=1;
/** Effects sort just above the actors standing at their point (a pickup is +1, a projectile +2 in layers.ts). */
const FX_DEPTH={shot:2,blast:3,flash:.002,beam:.0015} as const;
/** A weapon with a target re-scans the horde for a nearer one this often (ms); it re-scans at once when it loses it. */
export const RESCAN_MS=250;
/** Baked effect textures: drawn once (bakeEffects), then placed, scaled, turned and faded per frame. */
const FX={flash:'fx:flash',blast:'fx:blast',ring:'fx:anel',tracer:'fx:tracante',smoke:'fx:fumaca',
  headPapel:'fx:ponta-papel',headShell:'fx:ponta-granada',headRocket:'fx:ponta-foguete',puff:'fx:baforada',
  cone:'fx:cone',spot:'fx:foco'} as const;
const FLASH_TEX=64,BLAST_R=48,BLAST_W=104,BLAST_H=60,BLAST_GROUND=44,RING_W=256,RING_H=132,STREAK_W=64,STREAK_H=12,STREAK_LINE=8,HEAD_TEX=32,CONE_W=128,CONE_H=64,SPOT_W=64,SPOT_H=32;
/** The weapon's pivot stands this high over the roof (CSS px × actor scale), on a drum. */
const POST_PX=10;

const pool=<T>(n:number,make:()=>T):T[]=>Array.from({length:n},make);
const BRANCH_MATERIAL={T:MATERIALS.pedra,A:MATERIALS.pedra,B:MATERIALS['metal-ferrugem'],C:MATERIALS['metal-pintado']} as const;

export class TowerRenderer {
  private readonly scene:Phaser.Scene;
  private readonly o:TowerRendererOptions;
  private readonly towers=new Map<string,Tower>();
  /** Scratch Graphics the procedural textures are drawn into (never on screen). */
  private readonly bake:Phaser.GameObjects.Graphics;
  private readonly atlas:TowerAtlas;
  /** Crater decals: baked frames, a fixed pool of Images in a layer on the ground, placed once. */
  private readonly craterImages:Phaser.GameObjects.Image[];
  private readonly craterFrames:{small:AtlasFrame;big:AtlasFrame};
  private readonly ground:Phaser.GameObjects.Layer;
  /** The defenses' cast shadows: at the ground layer's depth, added after it (over craters and rails, under the rest). */
  private readonly shade:Phaser.GameObjects.Layer;
  private readonly light:boolean;
  private economyOn:boolean;
  /** Shots, explosions and flashes: pooled Images in the scene's display list, each at its own point's actor depth. */
  private readonly fxImages:Phaser.GameObjects.Image[]=[];
  private readonly shots=pool<Shot>(SHOT_POOL,()=>({on:false,cal:CALIBRE.pistola,x0:0,y0:0,z0:0,x1:0,y1:0,born:0,ms:0,mx:0,my:0,ox:0,oy:0,cell:-1,d0:0,dz:0,trail:undefined,head:undefined,puff:undefined}));
  private readonly flashes=pool<Flash>(FLASH_POOL,()=>({on:false,x:0,y:0,r:0,born:0,ms:0,depth:0,img:undefined}));
  private readonly blasts=pool<Blast>(BLAST_POOL,()=>({on:false,x:0,y:0,r:0,born:0,ms:0,ring:false,depth:0,img:undefined}));
  private readonly craters=pool<Crater>(CRATER_POOL,()=>({on:false,x:0,y:0,r:0,born:0,ms:0}));
  private cursor={shot:0,flash:0,blast:0,crater:0};
  private readonly fader=new CoverFader();
  private readonly covered=new Set<string>();
  /** The figures of the last cover test (x, y, z each) and whether a defense changed since: else the test is skipped. */
  private readonly lastFigures:number[]=[];
  private coverDirty=true;
  /** The city's figure box at the current actor scale (the fade test's, as for the buildings). */
  private figureBox={w:HERO_SCREEN.w,h:HERO_SCREEN.h,scale:-1};
  private depthSeen=-1;
  private enemies={n:0,xs:new Float32Array(0) as ArrayLike<number>,ys:new Float32Array(0) as ArrayLike<number>,air:undefined as ArrayLike<number>|undefined};
  private shake={born:-1e9,cal:CALIBRE.pistola as CalibreLook};
  private applied={x:0,y:0};
  private readonly p:Pt={x:0,y:0};
  private readonly q:Pt={x:0,y:0};
  private readonly v:Pt={x:0,y:0};
  private readonly corners:Pt[]=pool<Pt>(8,()=>({x:0,y:0}));
  private stamp=0;
  private now=0;
  private unitPx=1;
  /** World px across the diamond of a 1 u ground square (the delivered art's scale, towerArtScale). */
  private diamondPx=1;
  private readonly breu=tokenColor('--c-breu');
  private readonly papel=tokenColor('--c-papel');
  private readonly amarelo=tokenColor('--c-amarelo');
  private readonly cone=tokenColor('--c-cone');
  constructor(scene:Phaser.Scene,options:TowerRendererOptions){
    this.scene=scene;this.o=options;
    this.bake=scene.make.graphics({x:0,y:0},false);
    this.atlas=new TowerAtlas(scene.textures);
    const crater=(name:string,w:number)=>this.atlas.frame(name,w,w/2,this.bake,g=>{
      const h=w/2,k=w/CRATER_TEX;
      g.fillStyle(this.breu,.42).fillEllipse(w/2,h/2,w-4*k,h-2*k).fillStyle(MATERIALS.pedra.escura,.55).fillEllipse(w/2,h/2+h*.05,(w-4*k)*.7,(h-2*k)*.65)
        .lineStyle(3*k,this.breu,.7).strokeEllipse(w/2,h/2,w-4*k,h-2*k);
    });
    this.craterFrames={small:crater(CRATER_FRAME,CRATER_TEX),big:crater(CRATER_BIG,CRATER_BIG_TEX)};
    this.ground=scene.add.layer().setDepth(options.groundDepth);
    this.shade=scene.add.layer().setDepth(options.groundDepth);
    this.light=options.light??lightEnabled();this.economyOn=!!options.economy;
    const small=this.craterFrames.small;
    this.craterImages=this.craters.map(()=>{const img=scene.make.image({x:0,y:0,key:small.key,frame:small.frame},false).setVisible(false);this.ground.add(img);return img;});
    this.bakeEffects();
    this.atlas.flush();
    this.measure();
  }
  /** Economy mode (scene.setEconomy): the cast shadows hide (and come back baked as they were). */
  get economy(){return this.economyOn;}
  set economy(on:boolean){
    if(on===this.economyOn)return;
    this.economyOn=on;
    const view=this.o.world.view();
    for(const t of this.towers.values())this.placeShadow(t,view);
    this.atlas.flush();
  }
  private get s(){const k=this.o.actorScale;return typeof k==='function'?k():k??1;}
  /** Size unit of the weapons and effects: world px of 1/24 u, so they keep their size against the boxes at any scale. */
  private get f(){return this.unitPx/24;}
  /** World px per art px of the delivered sheets (towerArtScale: the city scenery's). */
  private get artScale(){const c=this.o.cell,cell=typeof c==='function'?c():c;return towerArtScale(this.diamondPx,cell&&cell>0?cell:undefined);}
  /** World px of 1 u along the ground (screen length of a unit step), for barrel lengths and blast ellipses. */
  private measure(){
    const w=this.o.world,a=w.project(0,0,0,{x:0,y:0}),b=w.project(1,0,0,{x:0,y:0}),c=w.project(0,1,0,{x:0,y:0});
    this.unitPx=Math.max(1,Math.hypot(b.x-a.x,b.y-a.y));
    this.diamondPx=Math.max(1,Math.abs(b.x-a.x)+Math.abs(c.x-a.x));
  }
  /** The enemies the weapons aim at (parallel arrays; `air` 1 for flyers). Kept by reference, read every frame. */
  setEnemies(n:number,xs:ArrayLike<number>,ys:ArrayLike<number>,air?:ArrayLike<number>){
    this.enemies.n=n;this.enemies.xs=xs;this.enemies.ys=ys;this.enemies.air=air;
  }
  /** A new view of the defenses at sim `tick`, received at `nowMs`: new ones appear, gone ones leave, volleys fire. */
  push(tick:number,list:readonly TowerView[],nowMs:number){
    const stamp=++this.stamp;
    for(const view of list){
      let t=this.towers.get(view.id);
      if(!t||t.view.kind!==view.kind){if(t)this.drop(t);t=this.make(view);this.towers.set(view.id,t);this.coverDirty=true;}
      t.view=view;t.seen=stamp;
      t.phase=view.phase??towerPhase(view,tick);
      if(view.aim!==undefined&&view.aim!==t.aimFor)this.aimAt(t,view.aim);
      if(firedNow(t.prevFire,view,tick)){
        this.fire(t,nowMs);
        for(let k=1;k<(view.volleys??1);k++)(t.queued??=[]).push(nowMs+k*VOLLEY_STAGGER_MS);
      }
      t.prevFire=view.fireTick;
    }
    for(const t of this.towers.values())if(t.seen!==stamp){this.drop(t);this.towers.delete(t.view.id);this.coverDirty=true;}
  }
  /** Another world (a map switch): no defense and no effect of the old one stays. */
  reset(){
    for(const t of this.towers.values())this.drop(t);
    this.towers.clear();this.coverDirty=true;this.fader.reset();
    for(const sh of this.shots){sh.on=false;this.hideShot(sh);}
    for(const f of this.flashes){f.on=false;f.img?.setVisible(false);}
    for(const b of this.blasts){b.on=false;b.img?.setVisible(false);}
    for(let i=0;i<this.craters.length;i++){this.craters[i].on=false;this.craterImages[i].setVisible(false);}
    this.shake.born=-1e9;
  }
  /**
   * After a camera turn or a depth re-base: the defenses are re-placed and re-sorted now (not on their next frame), the
   * server aims re-turned, the craters re-placed, the effects re-sorted.
   */
  refresh(){
    this.measure();
    const view=this.o.world.view();
    for(const t of this.towers.values()){t.drawnPhase='';t.aimFor=NaN;if(t.view.aim!==undefined)this.aimAt(t,t.view.aim);this.drawTower(t,view);}
    for(let i=0;i<this.craters.length;i++)if(this.craters[i].on)this.placeCrater(this.craters[i],this.craterImages[i]);
    this.redepth();
  }
  /** The world's depths moved (chunks loaded or dropped, a re-base): every defense and live effect is sorted again. */
  redepth(){
    for(const t of this.towers.values())this.sortTower(t);
    const w=this.o.world;
    for(const b of this.blasts)if(b.on&&!b.ring){b.depth=this.fxDepth(b.x,b.y)+FX_DEPTH.blast;b.img?.setDepth(b.depth);}
    for(const sh of this.shots)if(sh.on)sh.cell=-1;
    this.coverDirty=true;
  }
  get count(){return this.towers.size;}
  /** Live effects (for checks): shots, flashes, blasts, craters. */
  live(){
    const n=(a:{on:boolean}[])=>{let c=0;for(const x of a)if(x.on)c++;return c;};
    return {shots:n(this.shots),flashes:n(this.flashes),blasts:n(this.blasts),rings:this.blasts.filter(b=>b.on&&b.ring).length,craters:n(this.craters),inFlight:this.shots.filter(s=>s.on).map(s=>({k:s.cal.shot,age:this.now-s.born,ms:s.ms,x0:s.x0,y0:s.y0,x1:s.x1,y1:s.y1,z:s.z0}))};
  }
  /** Every frame: aim and turn, fade covering defenses, move the effects, shake. `figures`: the hero and the allies. */
  update(nowMs:number,dtMs:number,figures:readonly Figure[]){
    this.now=nowMs;
    const glow=this.glow??=new UsableGlow(this.scene,this.o.reduced),k=1/Math.max(.05,this.o.camera?.zoom||this.scene.cameras.main.zoom||1);
    glow.begin(nowMs);
    const version=this.o.depthVersion?.()??0;
    if(version!==this.depthSeen){this.depthSeen=version;this.redepth();}
    const view=this.o.world.view(),covered=this.covered;
    for(const t of this.towers.values()){
      while(t.queued?.length&&t.queued[0]<=nowMs){t.queued.shift();this.fire(t,nowMs);}
      this.aim(t,dtMs);
      this.drawTower(t,view);
    }
    const s=this.s,box=this.figureBox;
    if(box.scale!==s){box.scale=s;box.w=HERO_SCREEN.w*s;box.h=HERO_SCREEN.h*s;this.coverDirty=true;}
    if(this.figuresMoved(figures)||this.coverDirty){
      this.coverDirty=false;
      for(const t of this.towers.values()){
        t.covers=false;
        for(let i=0;i<figures.length;i++)if(propCovers(t.prop,figures[i],view,VIEW_PIVOT,box)){t.covers=true;break;}
      }
    }
    covered.clear();
    for(const t of this.towers.values())if(t.covers)covered.add(t.view.id);
    const alpha=this.fader.update(covered,dtMs);
    for(const t of this.towers.values()){
      const a=alpha.get(t.view.id)??1;
      if(a!==t.alpha){t.alpha=a;t.base.setAlpha(a);t.weapon.setAlpha(a);}
      // contorno-usavel-wc3: a defense (and its obra) can be built on and upgraded: the Warcraft 3 gold outline.
      glow.mark(t.view.id,t.base,k);
    }
    glow.end();
    this.drawEffects(nowMs);
    this.atlas.flush();
    this.applyShake(nowMs);
    if(this.labHidden)this.hideAll(this.labHidden);
  }
  /**
   * Lab only (the sandbox's FPS bench): draw nothing while everything still runs, so drawn and hidden frames can be
   * compared on one page under the same load.
   */
  labHidden='';
  /** contorno-usavel-wc3: the gold outline of the defenses (render/usable-glow.ts), made on the first update. */
  private glow?:UsableGlow;
  private hideAll(what:string){
    const all=what==='all';
    if(all||what.includes('crateras'))this.ground.setVisible(false);
    if(all||what.includes('efeitos'))for(const i of this.fxImages)i.setVisible(false);
    if(all||what.includes('bases'))for(const t of this.towers.values()){t.base.setVisible(false);t.weapon.setVisible(false);t.rail?.setVisible(false);}
  }
  /** Lab only: what is drawn now, per kind — images shown and their area in world px² (× zoom² for screen px). */
  labStats(){
    const out:Record<string,{n:number;area:number}>={};
    const add=(k:string,i:Phaser.GameObjects.Image|undefined)=>{if(!i||!i.visible||i.alpha<=0)return;const o=out[k]??={n:0,area:0};o.n++;o.area+=Math.abs(i.displayWidth*i.displayHeight);};
    for(const t of this.towers.values()){add('bases',t.base);add('armas',t.weapon);add('trilho',t.rail);}
    for(const i of this.craterImages)add('crateras',i);
    for(const i of this.fxImages)add('efeitos',i);
    return out;
  }
  /** Lab only: shows again what hideAll hid (effects come back as they are drawn, a defense is redrawn whole). */
  labShow(){
    this.ground.setVisible(true);
    for(const t of this.towers.values()){t.base.setVisible(true);t.drawnPhase='';t.drawnView=-1;t.drawnDir=-1;}
  }
  /** The figures moved since the last cover test (and remembers where they are). */
  private figuresMoved(figures:readonly Figure[]):boolean{
    const last=this.lastFigures;let moved=last.length!==figures.length*3;
    if(moved)last.length=figures.length*3;
    for(let i=0;i<figures.length;i++){
      const f=figures[i],j=i*3;
      if(last[j]!==f.x||last[j+1]!==f.y||last[j+2]!==f.z){moved=true;last[j]=f.x;last[j+1]=f.y;last[j+2]=f.z;}
    }
    return moved;
  }
  destroy(){
    for(const t of this.towers.values())this.drop(t);
    this.towers.clear();this.glow?.destroy();this.bake.destroy();this.ground.destroy();this.shade.destroy();
    for(const img of this.fxImages)img.destroy();this.fxImages.length=0;
    const cam=this.o.camera;if(cam){cam.scrollX-=this.applied.x;cam.scrollY-=this.applied.y;}
  }

  private make(view:TowerView):Tower{
    const look=TOWER_LOOK[view.kind];
    const t:Tower={view,look,cal:CALIBRE[look.calibre],phase:'obra-1',
      base:this.scene.add.image(0,0,'__DEFAULT'),weapon:this.scene.add.image(0,0,'__DEFAULT'),art:false,artWait:false,hideUntil:0,scanAt:0,alpha:1,covers:false,
      dir:0,want:0,turnMs:0,recoilUntil:0,drawnDir:-1,drawnRecoil:false,drawnPhase:'',drawnView:-1,
      rect:{x:0,y:0,w:0,h:0},prop:{x:0,y:0,rect:{x:0,y:0,w:0,h:0}},mount:{x:0,y:0},height:0,seen:0,target:-1,depth:0,aimFor:NaN};
    t.prop.rect=t.rect;
    const art=towerArt(view.kind);
    t.art=!!art?.base&&this.scene.textures.exists(towerBaseKey(view.kind));
    t.artWait=!!art?.base&&!t.art;
    if(t.artWait){t.hideUntil=this.now+TOWER_ART_WAIT_MS;this.o.needArt?.(view.kind);}
    return t;
  }
  private drop(t:Tower){t.base.destroy();t.weapon.destroy();t.rail?.destroy();t.shadow?.destroy();}

  private aim(t:Tower,dtMs:number){
    if(t.look.calibre==='radar'){ // the dish sweeps on its own
      if(canFire(t.phase)){t.turnMs+=dtMs;while(t.turnMs>=TURN_MS*6){t.turnMs-=TURN_MS*6;t.dir=((t.dir+1)%8) as Dir8;}}
      return;
    }
    const e=this.enemies;
    if(t.view.aim!==undefined){ // the server's aim (where it last fired): turned once per snapshot (aimAt), no scan
      if(!canFire(t.phase))return;
    }else if(!canFire(t.phase))t.target=-1;
    else if(this.now>=t.scanAt||!this.reaches(t,t.target)){
      t.target=aimIndex(t.look,t.view.x,t.view.y,e.n,e.xs,e.ys,e.air);
      t.scanAt=this.now+RESCAN_MS;
    }
    if(t.view.aim===undefined&&t.target>=0){
      const w=this.o.world,a=w.project(t.view.x,t.view.y,0,this.p),b=w.project(e.xs[t.target],e.ys[t.target],0,this.q);
      t.want=dir8(b.x-a.x,b.y-a.y,t.want);
    }
    if(t.dir===t.want){t.turnMs=0;return;}
    t.turnMs+=dtMs;
    while(t.turnMs>=TURN_MS&&t.dir!==t.want){t.turnMs-=TURN_MS;t.dir=turnToward(t.dir,t.want);}
  }

  /** The weapon's wanted row for a server aim (turns from +x), on the screen of the current view. */
  private aimAt(t:Tower,aim:number){
    t.aimFor=aim;
    const w=this.o.world,a=w.project(t.view.x,t.view.y,0,this.p),turn=aim*Math.PI*2;
    const b=w.project(t.view.x+Math.cos(turn),t.view.y+Math.sin(turn),0,this.q);
    t.want=dir8(b.x-a.x,b.y-a.y,t.want);
  }
  /** Enemy `i` is still there and in reach of the defense (the cheap check between re-scans). */
  private reaches(t:Tower,i:number):boolean{
    const e=this.enemies;
    if(i<0||i>=e.n)return false;
    const flying=!!e.air?.[i],hits=t.look.hits;
    if(hits==='air'?!flying:hits==='ground'&&flying)return false;
    const d=Math.hypot(e.xs[i]-t.view.x,e.ys[i]-t.view.y);
    return d<=t.look.range&&d>=t.look.minRange;
  }
  /**
   * A volley: muzzle flash, recoil, and the shots toward its aim: with the server's `aim`, the reachable enemy along it
   * (or a point along it at AIM_FALLBACK of the range); without, the nearest reachable enemy.
   */
  /** Volleys drawn so far (sandbox checks: torre-contador-de-tiros). */
  volleysDrawn=0;
  private fire(t:Tower,nowMs:number){
    this.volleysDrawn++;
    // Each calibre's shot (audio/sfx.ts torre-*), throttled per calibre so a battery does not stack up.
    const audio=getAudio();if(audio.unlocked)audio.play(`torre-${t.look.calibre}`);
    const cal=t.cal,e=this.enemies,v=t.view;
    t.recoilUntil=nowMs+RECOIL_MS;
    let tx=NaN,ty=NaN;
    if(v.aim!==undefined){
      const i=aimedIndex(t.look,v.x,v.y,v.aim,e.n,e.xs,e.ys,e.air),turn=v.aim*Math.PI*2,reach=t.look.range*AIM_FALLBACK;
      if(i>=0){tx=e.xs[i];ty=e.ys[i];}else{tx=v.x+Math.cos(turn)*reach;ty=v.y+Math.sin(turn)*reach;}
    }else{
      const i=aimIndex(t.look,v.x,v.y,e.n,e.xs,e.ys,e.air);
      t.target=i;t.scanAt=nowMs+RESCAN_MS;
      if(i>=0){tx=e.xs[i];ty=e.ys[i];}
    }
    const has=Number.isFinite(tx);
    if(has&&cal.shot!=='aura'){ // snap the weapon to what it fired at
      const w=this.o.world,a=w.project(v.x,v.y,0,this.p),b=w.project(tx,ty,0,this.q);
      t.dir=t.want=dir8(b.x-a.x,b.y-a.y,t.dir);
    }
    this.muzzle(t);
    const mx=this.v.x,my=this.v.y;
    if(cal.flash>0)this.addFlash(mx,my,cal.flash*this.f,cal.flashMs,nowMs,t.depth+FX_DEPTH.flash);
    if(cal.shot==='aura'){this.addBlast(v.x,v.y,t.look.range,cal.blastMs,nowMs,true);return;}
    if(!has||cal.shot==='none')return;
    if(cal.shot==='beam'){this.addBeam(t,tx,ty,nowMs,mx,my);return;}
    const n=Math.min(BURST_MAX,t.look.shots),h=t.height*PHASE_HEIGHT[t.phase];
    // The path starts over the defense's centre at its roof; the drawn shot leaves the barrel tip (the offset fades out).
    const start=this.o.world.project(v.x,v.y,h,this.p),ox=mx-start.x,oy=my-start.y;
    for(let i=0;i<n;i++){
      // Deterministic spread of a burst around the aim point (golden angle), staggered in time.
      const a=i*2.39996,r=i?.35+.15*i:0;
      const x1=tx+Math.cos(a)*r,y1=ty+Math.sin(a)*r,dist=Math.hypot(x1-v.x,y1-v.y);
      this.addShot(cal,v.x,v.y,h,x1,y1,nowMs+i*BURST_GAP_MS,flightMs(cal,dist),ox,oy,t.depth);
    }
  }
  /** World px of the muzzle tip into this.v (mount + barrel along the weapon's direction). */
  private muzzle(t:Tower){
    const d=dirVector(t.dir,this.v),len=t.cal.barrel*this.unitPx;
    this.v.x=t.mount.x+d.x*len;this.v.y=t.mount.y+d.y*len*.5;
  }

  private next<T extends {on:boolean}>(list:T[],key:'shot'|'flash'|'blast'|'crater'):T{
    const c=this.cursor;
    for(let k=0;k<list.length;k++){const i=(c[key]+k)%list.length;if(!list[i].on){c[key]=(i+1)%list.length;return list[i];}}
    const i=c[key];c[key]=(i+1)%list.length;return list[i]; // full: the oldest slot in ring order is reused
  }
  /** A pooled shot slot: whatever the slot drew before (a rocket's smoke, a beam's cone) is hidden first. */
  private slot():Shot{const s=this.next(this.shots,'shot');this.hideShot(s);s.cell=-1;return s;}
  private addShot(cal:CalibreLook,x0:number,y0:number,z0:number,x1:number,y1:number,born:number,ms:number,ox:number,oy:number,d0:number){
    const s=this.slot();
    s.on=true;s.cal=cal;s.x0=x0;s.y0=y0;s.z0=z0;s.x1=x1;s.y1=y1;s.born=born;s.ms=ms;s.ox=ox;s.oy=oy;s.d0=d0;
  }
  private addBeam(t:Tower,x1:number,y1:number,born:number,mx:number,my:number){
    const s=this.slot();
    s.on=true;s.cal=t.cal;s.x0=t.view.x;s.y0=t.view.y;s.z0=t.height;s.x1=x1;s.y1=y1;s.born=born;s.ms=t.cal.blastMs;s.mx=mx;s.my=my;s.ox=0;s.oy=0;s.d0=t.depth;
  }
  private addFlash(x:number,y:number,r:number,ms:number,born:number,depth:number){
    const f=this.next(this.flashes,'flash');f.on=true;f.x=x;f.y=y;f.r=r;f.ms=ms;f.born=born;f.depth=depth;
    if(f.img)f.img.setDepth(depth);
  }
  private addBlast(x:number,y:number,r:number,ms:number,born:number,ring=false){
    const b=this.next(this.blasts,'blast');b.on=true;b.x=x;b.y=y;b.r=r;b.ms=ms;b.born=born;
    if(b.img&&b.ring!==ring){b.img.destroy();this.fxImages.splice(this.fxImages.indexOf(b.img),1);b.img=undefined;} // the ring lives on the ground
    b.ring=ring;b.depth=ring?0:this.fxDepth(x,y)+FX_DEPTH.blast;
    if(b.img&&!ring)b.img.setDepth(b.depth);
  }
  private addCrater(x:number,y:number,r:number,ms:number,born:number){
    const c=this.next(this.craters,'crater');c.on=true;c.x=x;c.y=y;c.r=r;c.ms=ms;c.born=born;
    this.placeCrater(c,this.craterImages[this.craters.indexOf(c)]);
  }
  /** A crater decal is placed once (and again after a camera turn); only its last fifth fades. */
  private placeCrater(c:Crater,img:Phaser.GameObjects.Image){
    const p=this.o.world.project(c.x,c.y,0,this.p),big=c.r>=CRATER_BIG_FROM,f=big?this.craterFrames.big:this.craterFrames.small;
    this.setFrame(img,f).setVisible(true).setPosition(p.x,p.y).setScale(c.r*this.unitPx*2/(big?CRATER_BIG_TEX:CRATER_TEX)).setAlpha(1);
  }
  private impact(s:Shot,now:number){
    const c=s.cal;
    if(c.blast>0)this.addBlast(s.x1,s.y1,c.blast,c.blastMs,now);
    else this.addBlast(s.x1,s.y1,.18,110,now);
    if(c.crater){const k=CRATER[c.crater];this.addCrater(s.x1,s.y1,k.radius,k.ms,now);}
    if(c.shake>0&&(now-this.shake.born>=this.shake.cal.shakeMs||c.shake>=this.shake.cal.shake)){this.shake.born=now;this.shake.cal=c;}
  }

  private drawEffects(now:number){
    const w=this.o.world,u=this.unitPx,s=this.f;
    for(let i=0;i<this.craters.length;i++){
      const c=this.craters[i];if(!c.on)continue;
      const k=(now-c.born)/c.ms,img=this.craterImages[i];
      if(k>=1){c.on=false;img.setVisible(false);continue;}
      if(k>=.8)img.setAlpha(1-(k-.8)/.2);
    }
    for(const sh of this.shots){
      if(!sh.on)continue;
      if(now<sh.born){this.hideShot(sh);continue;}
      const c=sh.cal,t=sh.ms>0?(now-sh.born)/sh.ms:1;
      if(c.shot==='beam'){
        if(t>=1){sh.on=false;this.hideShot(sh);continue;}
        const p=w.project(sh.x1,sh.y1,0,this.p),a=(1-t)*.6,half=c.barrel*u*.9;
        // Light cone with the Breu double edge (a pale beam alone vanishes on the snow), and its spot.
        const dx=p.x-sh.mx,dy=p.y-sh.my;
        // The cone sorts with its lamp, the spot at the lit ground: both set once per beam.
        const fresh=sh.cell<0;if(fresh){sh.cell=0;sh.dz=this.fxDepth(sh.x1,sh.y1)+FX_DEPTH.shot;}
        sh.trail=this.fxImage(sh.trail,FX.cone,sh.d0+FX_DEPTH.beam,fresh,0,.5).setPosition(sh.mx,sh.my).setRotation(Math.atan2(dy,dx))
          .setScale(Math.max(1,Math.hypot(dx,dy))/CONE_W,half*2/CONE_H).setAlpha(a);
        sh.head=this.fxImage(sh.head,FX.spot,sh.dz,fresh).setPosition(p.x,p.y).setScale(half*2.4/SPOT_W,half*1.2/SPOT_H).setAlpha(Math.min(1,a*1.4));
        continue;
      }
      if(t>=1){sh.on=false;this.hideShot(sh);this.impact(sh,now);continue;}
      const dist=Math.hypot(sh.x1-sh.x0,sh.y1-sh.y0)||1,back=Math.min(t,c.trail/dist);
      const head=this.at(sh,t,this.p),tail=this.at(sh,t-back,this.q);
      const dx=head.x-tail.x,dy=head.y-tail.y,len=Math.hypot(dx,dy),rot=Math.atan2(dy,dx),thick=Math.max(1,4*s)/STREAK_LINE;
      // Depth at the head's ground point, taken again only when it crosses a half-unit cell (the first moments at the
      // barrel keep the defense's own depth, so a shot never pops in front of the tower that fires it).
      const k=Math.max(0,t),gx=sh.x0+(sh.x1-sh.x0)*k,gy=sh.y0+(sh.y1-sh.y0)*k,cell=((gx*2)|0)*65536+((gy*2)|0)+1e9;
      const moved=cell!==sh.cell;
      if(moved){sh.cell=cell;sh.dz=Math.max(this.fxDepth(gx,gy),k<.2?sh.d0:-Infinity)+FX_DEPTH.shot;}
      const d=sh.dz;
      if(c.shot==='tracer'){
        sh.trail=this.fxImage(sh.trail,FX.tracer,d,moved,0,.5).setPosition(tail.x,tail.y).setRotation(rot).setScale(Math.max(1,len)/STREAK_W,thick).setAlpha(1);
        sh.head=this.fxImage(sh.head,FX.headPapel,d,moved).setPosition(head.x,head.y).setScale(3.2*s/HEAD_TEX).setAlpha(1);
        continue;
      }
      if(c.trail>0&&len>.5){
        sh.trail=this.fxImage(sh.trail,FX.smoke,d,moved,0,.5).setPosition(tail.x,tail.y).setRotation(rot).setScale(len/STREAK_W,thick).setAlpha(.5);
        if(c.shot==='rocket')sh.puff=this.fxImage(sh.puff,FX.puff,d,moved).setPosition(tail.x,tail.y).setScale(8*s/HEAD_TEX).setAlpha(.45);
      }else{sh.trail?.setVisible(false);sh.puff?.setVisible(false);}
      const r=(c.shot==='rocket'?3:c.crater==='gustavao'?9:4.5)*s;
      sh.head=this.fxImage(sh.head,c.shot==='rocket'?FX.headRocket:FX.headShell,d,moved).setPosition(head.x,head.y).setScale((r+1.5*s)*2/HEAD_TEX).setAlpha(1);
    }
    for(const b of this.blasts){
      if(!b.on)continue;
      const k=(now-b.born)/b.ms;if(k>=1){b.on=false;b.img?.setVisible(false);continue;}
      const p=w.project(b.x,b.y,0,this.p),rw=b.r*u*(.35+.65*Math.sqrt(k));
      if(b.ring){ // the wire's spark ring lies on the snow: in the ground layer
        if(!b.img){const fr=this.atlas.get(FX.ring)!;b.img=this.scene.make.image({x:0,y:0,key:fr.key,frame:fr.frame},false);this.ground.add(b.img);}
        b.img.setVisible(true).setPosition(p.x,p.y).setScale(rw*2/(RING_W-8)).setAlpha(1-k);
        continue;
      }
      // The fireball rises as it fades (the baked one is drawn at half its rise).
      b.img=this.fxImage(b.img,FX.blast,b.depth,false,.5,BLAST_GROUND/BLAST_H).setPosition(p.x,p.y-rw*.3*(k-.5))
        .setScale(rw/BLAST_R).setAlpha(1-k);
    }
    for(const f of this.flashes){
      if(!f.on)continue;
      const k=(now-f.born)/f.ms;if(k>=1){f.on=false;f.img?.setVisible(false);continue;}
      f.img=this.fxImage(f.img,FX.flash,f.depth,false).setPosition(f.x,f.y).setScale(f.r*(1-.4*k)*2.5/FLASH_TEX).setAlpha(1-k);
    }
  }
  /** An effect's depth at its ground point (the world's effectDepth, else the actor depth). */
  private fxDepth(x:number,y:number){const w=this.o.world;return w.effectDepth?w.effectDepth(x,y):w.depth(x,y);}
  private hideShot(sh:Shot){sh.trail?.setVisible(false);sh.head?.setVisible(false);sh.puff?.setVisible(false);}
  /**
   * A pooled effect image showing `name`, visible, in the scene's display list (made on first use). `depth` is set when
   * `set` (spawned, or moved to another cell) or the image is new; else it keeps the one it has (no re-sort per frame).
   */
  private fxImage(img:Img,name:string,depth:number,set:boolean,ox=.5,oy=.5):Phaser.GameObjects.Image{
    const f=this.atlas.get(name)!;
    if(!img){img=this.scene.add.image(0,0,f.key,f.frame);this.fxImages.push(img);set=true;}
    if(set)img.setDepth(depth);
    if(img.frame.name!==f.frame||img.texture.key!==f.key)img.setTexture(f.key,f.frame);
    if(img.originX!==ox||img.originY!==oy)img.setOrigin(ox,oy);
    if(img.rotation!==0&&ox!==0)img.setRotation(0);
    return img.visible?img:img.setVisible(true);
  }
  /** The effect textures, drawn once into the scratch Graphics (kept by the texture manager for every renderer). */
  private bakeEffects(){
    const g=this.bake,make=(name:string,w:number,h:number,draw:()=>void)=>{this.atlas.frame(name,w,h,g,draw);};
    const c=FLASH_TEX/2;
    make(FX.flash,FLASH_TEX,FLASH_TEX,()=>g.fillStyle(this.cone,.7).fillCircle(c,c,c).fillStyle(this.amarelo,1).fillCircle(c,c,c/1.25)
      .fillStyle(this.papel,1).fillCircle(c,c,c/1.25*.45));
    {
      const R=BLAST_R,rh=R*.5,lift=rh*1.2*.5,cx=BLAST_W/2,cy=BLAST_GROUND;
      make(FX.blast,BLAST_W,BLAST_H,()=>g.fillStyle(this.breu,.35).fillEllipse(cx,cy-lift,R*2.1,rh*2.4)
        .fillStyle(this.cone,.85).fillEllipse(cx,cy-lift*.6,R*1.6,rh*1.9).fillStyle(this.amarelo,1).fillEllipse(cx,cy-lift*.4,R*.9,rh*1.1));
    }
    make(FX.ring,RING_W,RING_H,()=>g.lineStyle(6,this.breu,.5).strokeEllipse(RING_W/2,RING_H/2,RING_W-8,RING_H-8)
      .lineStyle(3,this.papel,.9).strokeEllipse(RING_W/2,RING_H/2,RING_W-8,RING_H-8));
    const m=STREAK_H/2;
    make(FX.tracer,STREAK_W,STREAK_H,()=>g.lineStyle(STREAK_LINE,this.breu,.6).lineBetween(0,m,STREAK_W,m)
      .lineStyle(STREAK_LINE*.55,this.amarelo,1).lineBetween(0,m,STREAK_W,m));
    make(FX.smoke,STREAK_W,STREAK_H,()=>g.lineStyle(STREAK_LINE,this.papel,1).lineBetween(0,m,STREAK_W,m));
    const h=HEAD_TEX/2,rim=h*.25;
    make(FX.headPapel,HEAD_TEX,HEAD_TEX,()=>g.fillStyle(this.papel,1).fillCircle(h,h,h));
    make(FX.puff,HEAD_TEX,HEAD_TEX,()=>g.fillStyle(this.papel,1).fillCircle(h,h,h));
    make(FX.headShell,HEAD_TEX,HEAD_TEX,()=>g.fillStyle(this.breu,1).fillCircle(h,h,h).fillStyle(MATERIALS.pedra.clara,1).fillCircle(h,h,h-rim));
    make(FX.headRocket,HEAD_TEX,HEAD_TEX,()=>g.fillStyle(this.breu,1).fillCircle(h,h,h).fillStyle(this.cone,1).fillCircle(h,h,h-rim*1.4));
    make(FX.cone,CONE_W,CONE_H,()=>g.fillStyle(this.amarelo,1).fillTriangle(2,CONE_H/2,CONE_W-2,2,CONE_W-2,CONE_H-2)
      .lineStyle(2.5,this.breu,1).strokeTriangle(2,CONE_H/2,CONE_W-2,2,CONE_W-2,CONE_H-2));
    make(FX.spot,SPOT_W,SPOT_H,()=>g.fillStyle(this.amarelo,1).fillEllipse(SPOT_W/2,SPOT_H/2,SPOT_W-4,SPOT_H-4)
      .lineStyle(2.5,this.breu,1).strokeEllipse(SPOT_W/2,SPOT_H/2,SPOT_W-4,SPOT_H-4));
  }
  /** World px of a shot at progress t (the line from the roof down to the ground plus the lob, from the barrel tip). */
  private at(s:Shot,t:number,out:Pt):Pt{
    const k=Math.max(0,t);
    this.o.world.project(s.x0+(s.x1-s.x0)*k,s.y0+(s.y1-s.y0)*k,s.z0*(1-k)+lobHeight(s.cal,k),out);
    out.x+=s.ox*(1-k);out.y+=s.oy*(1-k);
    return out;
  }

  private applyShake(now:number){
    const cam=this.o.camera;if(!cam)return;
    const amp=shakeAt(this.shake.cal,now-this.shake.born,this.o.reduced),zoom=cam.zoom||1;
    const off=shakeOffset(amp/zoom,now-this.shake.born,this.q);
    cam.scrollX+=off.x-this.applied.x;cam.scrollY+=off.y-this.applied.y;
    this.applied.x=off.x;this.applied.y=off.y;
  }
  /** The shake's camera offset now (world px at camera `zoom`), for a scene that centres its camera itself. */
  shakeOffset(zoom:number,out:Pt):Pt{
    const ms=this.now-this.shake.born,amp=shakeAt(this.shake.cal,ms,this.o.reduced);
    return shakeOffset(amp/(zoom||1),ms,out);
  }
  /** Current shake amplitude (CSS px), for checks. */
  shakeNow(){return shakeAt(this.shake.cal,this.now-this.shake.born,this.o.reduced);}

  // ---- the defense itself ----
  /**
   * Base and weapon are Images of baked textures (one per kind × phase × view, and per kind × direction × recoil),
   * drawn once into a scratch Graphics and kept: a Graphics would re-tessellate every frame.
   */
  private drawTower(t:Tower,view:number){
    const w=this.o.world,v=t.view;
    // The sheet arrived after the defense was made (cena-nasce-rapido: tower art streams in after the opening); until
    // then nothing is drawn (no procedural box swapped under the player's eyes), for at most TOWER_ART_WAIT_MS.
    if(t.artWait){
      if(this.scene.textures.exists(towerBaseKey(v.kind))){t.artWait=false;t.art=true;t.drawnPhase='';}
      else if(this.now<t.hideUntil){if(t.base.visible){t.base.setVisible(false);t.weapon.setVisible(false);}return;}
      if(!t.base.visible){t.base.setVisible(true);t.weapon.setVisible(true);t.drawnPhase='';}
    }
    if(t.drawnPhase!==t.phase||t.drawnView!==view){ // a defense stands still: its drawing changes only with its phase or the camera
      t.drawnPhase=t.phase;t.drawnView=view;t.drawnDir=-1;t.height=t.look.height;this.coverDirty=true;
      this.sortTower(t);
      const top=w.project(v.x,v.y,t.look.height*PHASE_HEIGHT[t.phase],this.p);t.mount.x=top.x;t.mount.y=top.y-POST_PX*this.f;
      if(t.art)this.placeArt(t,view);
      else this.placeBase(t,view);
      this.placeRail(t,view);
      this.placeShadow(t,view);
    }
    const recoil=this.now<t.recoilUntil;
    if(t.drawnDir!==t.dir||t.drawnRecoil!==recoil){t.drawnDir=t.dir;t.drawnRecoil=recoil;this.placeWeapon(t,recoil);}
  }
  /**
   * Draw depth at the footprint's front corner (the one nearest the viewer), like a city block: a figure behind any
   * part of the defense sorts behind it, and the fade test compares the figure against that same corner.
   */
  private sortTower(t:Tower){
    const w=this.o.world,v=t.view,{hx,hy}=this.extents(t),view=w.view();
    let best=-Infinity,fx=v.x,fy=v.y;
    for(const sx of [-1,1])for(const sy of [-1,1]){
      const x=v.x+sx*hx,y=v.y+sy*hy,k=groundDepthKey(x,y,view);
      if(k>best){best=k;fx=x;fy=y;}
    }
    t.prop.x=fx;t.prop.y=fy;t.depth=w.depth(fx,fy);
    t.base.setDepth(t.depth);t.weapon.setDepth(t.depth+.001);
  }
  private placeArt(t:Tower,view:number){
    const art=towerArt(t.view.kind)!,file=art.base!,img=t.base,w=this.o.world,p=w.project(t.view.x,t.view.y,0,this.p);
    const scale=this.artScale,anchor=file.anchor??[.5,.85];
    img.setTexture(towerBaseKey(t.view.kind)).setOrigin(anchor[0],anchor[1]).setPosition(p.x,p.y).setScale(scale/textureRatio(file))
      .setFrame(baseFrame(t.phase,view,Math.max(1,Math.min(4,file.views??4)),Array.isArray(file.rows)?file.rows:undefined));
    const b=img.getBounds();t.rect.x=b.x;t.rect.y=b.y;t.rect.w=b.width;t.rect.h=b.height;
    if(art.mount){t.mount.x=p.x+(art.mount[0]-anchor[0]*file.cell[0])*scale;t.mount.y=p.y+(art.mount[1]-anchor[1]*file.cell[1])*scale;}
  }
  /**
   * Half extents (u) of the base box and of what is drawn around it (wire coils), along world x and y. A site defense
   * fills its square site at the art footprint's proportions; the Gustavão's carriage stands on its rail (`half`, the
   * sim's 12 × 4 cells), whose track (placeRail) runs the rail's whole length (`rail`: half length, along x when
   * `railX`; `gauge`: half the rail's width).
   */
  private extents(t:Tower):{hx:number;hy:number;ex:number;ey:number;rail:number;railX:boolean;gauge:number}{
    const v=t.view,look=t.look;
    if(v.half){
      const [ax,ay]=v.half,railX=ax>=ay;
      const hx=railX?ax*.42:ax*.72,hy=railX?ay*.72:ay*.42;
      return {hx,hy,ex:hx*1.05,ey:hy*1.05,rail:railX?ax:ay,railX,gauge:railX?ay:ax};
    }
    const big=Math.max(look.footprint[0],look.footprint[1]);
    const hx=v.r*.85*look.footprint[0]/big,hy=v.r*.85*look.footprint[1]/big,wire=look.calibre==='arame'?v.r*1.45:0;
    return {hx,hy,ex:Math.max(hx*1.3,wire),ey:Math.max(hy*1.05,wire),rail:0,railX:true,gauge:0};
  }
  /** The Gustavão's track as a ground decal (baked once per view and size), under the carriage. */
  private placeRail(t:Tower,view:number){
    const {rail,railX,gauge}=this.extents(t);
    if(!(rail>0)){t.rail?.setVisible(false);return;}
    const v=t.view,w=this.o.world,pad=Math.ceil(4*this.s)+2,at=(along:number,across:number,out:Pt)=>railX?w.project(v.x+along,v.y+across,0,out):w.project(v.x+across,v.y+along,0,out);
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const a of [-rail,rail])for(const b of [-gauge,gauge]){const p=at(a,b,this.p);minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
    const ox=Math.floor(minX)-pad,oy=Math.floor(minY)-pad,wpx=Math.ceil(maxX-ox)+pad,hpx=Math.ceil(maxY-oy)+pad,s=this.s;
    const name=`trilho:${view}:${rail.toFixed(3)}:${gauge.toFixed(3)}:${railX?1:0}:${Math.round(this.unitPx)}:${s.toFixed(3)}`;
    const f=this.atlas.frame(name,wpx,hpx,this.bake,g=>{
      g.translateCanvas(-ox,-oy);
      for(let i=-12;i<=12;i++){ // sleepers across the gauge, then the two rails (Breu edge, a steel highlight)
        const a=at(rail*i/12.5,-gauge*.8,this.p),b=at(rail*i/12.5,gauge*.8,this.q);
        g.lineStyle(Math.max(2,5*s),this.breu,.9).lineBetween(a.x,a.y,b.x,b.y).lineStyle(Math.max(1,3*s),MATERIALS.madeira.escura,1).lineBetween(a.x,a.y,b.x,b.y);
      }
      for(const off of [-.5,.5]){
        const a=at(-rail,off*gauge,this.p),b=at(rail,off*gauge,this.q);
        g.lineStyle(Math.max(2,5*s),this.breu,1).lineBetween(a.x,a.y,b.x,b.y).lineStyle(Math.max(1,2*s),MATERIALS['metal-pintado'].luz,1).lineBetween(a.x,a.y,b.x,b.y);
      }
    });
    if(!t.rail){t.rail=this.scene.make.image({x:0,y:0,key:f.key,frame:f.frame},false);this.ground.add(t.rail);t.rail.setDepth(-1);}
    this.setFrame(t.rail,f).setOrigin(0,0).setPosition(ox,oy).setVisible(true);
  }
  /**
   * The cast shadow (tower-shadow.ts): the footprint stretched away from the sun by the drawn height (obra and ruin by
   * phase), baked once per kind × phase × view × size like the base and placed at its screen bounds. None with the
   * light off or in economy mode.
   */
  private placeShadow(t:Tower,view:number){
    const look=towerShadowLook(this.light,this.economyOn);
    if(!look){t.shadow?.setVisible(false);return;}
    const v=t.view,w=this.o.world,{hx,hy}=this.extents(t),H=castHeight(t.look.calibre,t.look.height*PHASE_HEIGHT[t.phase]);
    const foot=[[-hx,-hy],[hx,-hy],[hx,hy],[-hx,hy]].map(([dx,dy])=>{const p=w.project(v.x+dx,v.y+dy,0,this.p);return {x:p.x,y:p.y};});
    const soft=softShadow(foot,H,this.unitPx,look,SHADOW_SOFT_PX*this.s);
    if(!soft.polys.length){t.shadow?.setVisible(false);return;}
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const p of soft.polys[0]){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
    const ox=Math.floor(minX)-2,oy=Math.floor(minY)-2,wpx=Math.ceil(maxX-ox)+2,hpx=Math.ceil(maxY-oy)+2;
    const name=`sombra:${v.kind}:${t.phase}:${view}:${v.r.toFixed(3)}:${v.half?`${v.half[0].toFixed(3)}x${v.half[1].toFixed(3)}`:''}:${Math.round(this.unitPx)}:${this.s.toFixed(3)}`;
    const f=this.atlas.frame(name,wpx,hpx,this.bake,g=>{
      g.translateCanvas(-ox,-oy);
      for(const poly of soft.polys)g.fillStyle(look.color,soft.alpha).fillPoints(poly,true);
    });
    if(!t.shadow){t.shadow=this.scene.make.image({x:0,y:0,key:f.key,frame:f.frame},false);this.shade.add(t.shadow);}
    // Like the base: the bake is at this defense's world position, another of the same kind and size reuses it shifted.
    this.setFrame(t.shadow,f).setOrigin(0,0).setPosition(ox,oy).setVisible(true);
  }
  /** The procedural base, baked once per kind × phase × view × size, placed over its screen bounds. */
  private placeBase(t:Tower,view:number){
    const v=t.view,w=this.o.world,{ex,ey}=this.extents(t),pad=Math.ceil(3*this.s)+2;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const sx of [-1,1])for(const sy of [-1,1])for(const z of [0,t.look.height]){
      const p=w.project(v.x+sx*ex,v.y+sy*ey,z,this.p);
      minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);
    }
    // Occlusion rect: the box itself up to its drum (not the rails, wire or barrel reach), like a building's silhouette.
    {
      const {hx,hy}=this.extents(t),H=t.look.height*PHASE_HEIGHT[t.phase];
      let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
      for(const sx of [-1,1])for(const sy of [-1,1])for(const z of [0,H]){
        const p=w.project(v.x+sx*hx,v.y+sy*hy,z,this.p);
        x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);y0=Math.min(y0,p.y);y1=Math.max(y1,p.y);
      }
      if(canFire(t.phase))y0-=POST_PX*this.f*1.5;
      t.rect.x=x0;t.rect.y=y0;t.rect.w=x1-x0;t.rect.h=y1-y0;
    }
    const ox=Math.floor(minX)-pad,oy=Math.floor(minY)-pad,wpx=Math.ceil(maxX-ox)+pad,hpx=Math.ceil(maxY-oy)+pad;
    const name=`base:${v.kind}:${t.phase}:${view}:${v.r.toFixed(3)}:${v.half?`${v.half[0].toFixed(3)}x${v.half[1].toFixed(3)}`:''}:${Math.round(this.unitPx)}:${this.s.toFixed(3)}`;
    const f=this.atlas.frame(name,wpx,hpx,this.bake,g=>{
      g.translateCanvas(-ox,-oy);
      this.drawBase(g,t,t.look.height*PHASE_HEIGHT[t.phase]);
      if(t.look.calibre==='arame'&&canFire(t.phase))this.drawWire(g,t);
    });
    // The bake is at the defense's own world position: another one of the same kind and size reuses it shifted.
    this.setFrame(t.base,f).setOrigin(0,0).setPosition(ox,oy).setScale(1);
  }
  /** Procedural base: an iso box of the footprint in the branch's material, by phase (absolute world px into g). */
  private drawBase(g:Phaser.GameObjects.Graphics,t:Tower,H:number){
    const v=t.view,look=t.look,phase=t.phase,s=this.s,w=this.o.world,c=this.corners,{hx,hy}=this.extents(t);
    const ruin=phase==='ruina',hurt=phase==='danificada'||ruin,obra=phase.startsWith('obra');
    const m=ruin?MATERIALS.pedra:obra?MATERIALS.madeira:BRANCH_MATERIAL[look.branch];
    const xs=[-hx,hx,hx,-hx],ys=[-hy,-hy,hy,hy];
    for(let i=0;i<4;i++){w.project(v.x+xs[i],v.y+ys[i],0,c[i]);w.project(v.x+xs[i],v.y+ys[i],H,c[i+4]);}
    const centre=w.project(v.x,v.y,H*.5,this.q);
    const line=Math.max(1,2*s);
    // Side faces facing the camera (their bottom middle below the centre on screen), then the top.
    for(let i=0;i<4;i++){
      const j=(i+1)%4,a=c[i],b=c[j],midY=(a.y+b.y)/2,midX=(a.x+b.x)/2;
      if(midY<centre.y)continue;
      const fill=hurt||midX>centre.x?m.escura:m.clara;
      g.fillStyle(fill,1).lineStyle(line,this.breu,1);
      g.beginPath().moveTo(a.x,a.y).lineTo(b.x,b.y).lineTo(c[j+4].x,c[j+4].y).lineTo(c[i+4].x,c[i+4].y).closePath().fillPath().strokePath();
      if(phase==='danificada'){ // cracks
        const x0=a.x*.6+b.x*.4,y0=a.y*.6+b.y*.4-(a.y-c[i+4].y)*.2;
        g.lineStyle(Math.max(1,1.5*s),this.breu,1).beginPath().moveTo(x0,y0).lineTo(x0+4*s,y0-6*s).lineTo(x0-1*s,y0-11*s).lineTo(x0+5*s,y0-16*s).strokePath();
      }
    }
    g.fillStyle(ruin?MATERIALS.pedra.luz:hurt?m.clara:m.luz,1).lineStyle(line,this.breu,1);
    g.beginPath().moveTo(c[4].x,c[4].y).lineTo(c[5].x,c[5].y).lineTo(c[6].x,c[6].y).lineTo(c[7].x,c[7].y).closePath().fillPath().strokePath();
    if(ruin){ // rubble chunks
      for(let i=0;i<3;i++){const p=w.project(v.x+xs[i]*.7,v.y+ys[(i+1)%4]*.5,H,this.p);g.fillStyle(MATERIALS.pedra.clara,1).lineStyle(line,this.breu,1).fillCircle(p.x,p.y,4*s).strokeCircle(p.x,p.y,4*s);}
    }else if(!obra&&look.calibre!=='gustavao'){ // sandbag rim on the roof
      const p=w.project(v.x,v.y,H,this.p),rw=Math.min(hx,hy)*this.unitPx*.9;
      g.lineStyle(Math.max(1,5*s),this.breu,1).strokeEllipse(p.x,p.y,rw*2,rw).lineStyle(Math.max(1,3*s),this.papel,1).strokeEllipse(p.x,p.y,rw*2,rw);
    }
    if(obra){ // scaffold poles up to the finished height
      const top=look.height;
      for(let i=0;i<4;i++){
        const a=c[i],b=w.project(v.x+xs[i],v.y+ys[i],top,this.p);
        g.lineStyle(Math.max(1,3*s),this.breu,1).lineBetween(a.x,a.y,b.x,b.y).lineStyle(Math.max(1,1.5*s),MATERIALS.madeira.luz,1).lineBetween(a.x,a.y,b.x,b.y);
      }
      const a=w.project(v.x+xs[0],v.y+ys[0],top,this.p),b=w.project(v.x+xs[2],v.y+ys[2],top,this.v);
      g.lineStyle(Math.max(1,3*s),this.breu,1).lineBetween(a.x,a.y,b.x,b.y).lineStyle(Math.max(1,1.5*s),MATERIALS.madeira.luz,1).lineBetween(a.x,a.y,b.x,b.y);
    }
  }
  /** The weapon: the delivered idle sheet's frame, or a baked procedural texture per kind × direction × recoil. */
  private placeWeapon(t:Tower,recoil:boolean){
    const show=(canFire(t.phase)||t.phase==='obra-3')&&t.look.calibre!=='arame';
    t.weapon.setVisible(show);
    if(!show)return;
    const art=t.art?towerArt(t.view.kind):undefined;
    if(art?.idle&&this.scene.textures.exists(towerGunKey(t.view.kind))){
      const frames=Math.max(1,art.idle.frames??1),anchor=art.idle.anchor??[.5,.5];
      t.weapon.setTexture(towerGunKey(t.view.kind)).setOrigin(anchor[0],anchor[1]).setPosition(t.mount.x,t.mount.y).setScale(this.artScale/textureRatio(art.idle)).setFrame(weaponFrame(t.dir,0,frames));
      return;
    }
    const name=(d:number,r:boolean)=>`arma:${t.view.kind}:${d}:${r?1:0}:${Math.round(this.unitPx)}`;
    if(!this.atlas.get(name(t.dir,recoil))){ // all 16 poses at once: one upload, no bake while it turns
      for(let d=0;d<8;d++)for(const r of [false,true]){
        const b=this.weaponBounds(t,r,d as Dir8);
        this.atlas.frame(name(d,r),b.x1-b.x0,b.y1-b.y0,this.bake,g=>this.drawWeapon(g,t,r,d as Dir8,-b.x0,-b.y0));
      }
    }
    // Each pose is cropped to what it draws (fill rate: a padded square per weapon tripled the defenses' pixels).
    const b=this.weaponBounds(t,recoil,t.dir),f=this.atlas.get(name(t.dir,recoil))!;
    this.setFrame(t.weapon,f).setOrigin(-b.x0/f.w,-b.y0/f.h).setPosition(t.mount.x,t.mount.y).setScale(1);
  }
  /** The weapon's drawing, relative to its pivot (the mount), for a pose. */
  private weaponGeom(t:Tower,recoil:boolean,dir:Dir8){
    const s=this.f,cal=t.cal,d=dirVector(dir,this.v),k=recoil?-.12:0,len=cal.barrel*this.unitPx;
    const gus=t.look.calibre==='gustavao';
    return {d,x0:d.x*len*k,y0:d.y*len*k*.5,x1:d.x*len*(1+k),y1:d.y*len*.5*(1+k),
      disc:(gus?16:9)*s,thick:(gus?12:cal.blast>1?9:6)*s,post:POST_PX*s,line:Math.max(1,2*s),s};
  }
  /** Bounds (px, relative to the mount, rounded out) of a pose's drawing. */
  private weaponBounds(t:Tower,recoil:boolean,dir:Dir8){
    const g=this.weaponGeom(t,recoil,dir),shot=t.cal.shot;
    let x0=-g.disc-g.line,x1=g.disc+g.line,y0=-g.disc/2-g.line,y1=g.post+g.disc/2+g.line;
    const add=(x:number,y:number,rx:number,ry:number)=>{x0=Math.min(x0,x-rx);x1=Math.max(x1,x+rx);y0=Math.min(y0,y-ry);y1=Math.max(y1,y+ry);};
    if(shot==='beam')add(g.x1,g.y1-g.disc*.6,g.disc*1.1,g.disc*1.1);
    else if(shot==='none')add(g.x1,g.y1-g.disc*1.4,g.disc*1.4+g.line,g.disc*.9+g.line);
    else{const r=(g.thick+3*g.s)/2;add(g.x0,g.y0,r,r);add(g.x1,g.y1,Math.max(r,g.thick*.75),Math.max(r,g.thick*.75));}
    return {x0:Math.floor(x0)-2,y0:Math.floor(y0)-2,x1:Math.ceil(x1)+2,y1:Math.ceil(y1)+2};
  }
  private setFrame(img:Phaser.GameObjects.Image,f:AtlasFrame){
    return img.texture.key===f.key&&img.frame.name===f.frame?img:img.setTexture(f.key,f.frame);
  }
  /** Procedural weapon with its pivot at (mx, my): a drum, then a barrel toward the direction row (a lamp, a dish). */
  private drawWeapon(g:Phaser.GameObjects.Graphics,t:Tower,recoil:boolean,dir:Dir8,mx:number,my:number){
    const cal=t.cal,w=this.weaponGeom(t,recoil,dir),{d,disc,thick,post,line,s}=w;
    const x0=mx+w.x0,y0=my+w.y0,x1=mx+w.x1,y1=my+w.y1;
    const metal=MATERIALS['metal-pintado'];
    // The mount: a short drum from the roof up to the weapon's pivot (Breu contour, light top).
    g.fillStyle(metal.escura,1).lineStyle(line,this.breu,1).fillRect(mx-disc,my,disc*2,post).strokeRect(mx-disc,my,disc*2,post)
      .fillEllipse(mx,my+post,disc*2,disc).strokeEllipse(mx,my+post,disc*2,disc)
      .fillStyle(metal.luz,1).fillEllipse(mx,my,disc*2,disc).strokeEllipse(mx,my,disc*2,disc);
    if(cal.shot==='beam'){ // the lamp: a light disc facing the target
      g.fillStyle(this.breu,1).fillCircle(x1,y1-disc*.6,disc*1.1).fillStyle(this.papel,1).fillCircle(x1,y1-disc*.6,disc*.8)
        .fillStyle(this.amarelo,1).fillCircle(x1+d.x*disc*.2,y1-disc*.6+d.y*disc*.1,disc*.45);
      return;
    }
    if(cal.shot==='none'){ // radar dish
      g.lineStyle(thick*.6+2*s,this.breu,1).lineBetween(mx,my,x1,y1-disc*1.4).fillStyle(this.breu,1).fillEllipse(x1,y1-disc*1.4,disc*2.8,disc*1.8)
        .fillStyle(this.papel,1).fillEllipse(x1,y1-disc*1.4,disc*2.3,disc*1.4);
      return;
    }
    // Barrel: Breu contour, dark metal, a light highlight, and the muzzle ring.
    g.lineStyle(thick+3*s,this.breu,1).lineBetween(x0,y0,x1,y1).lineStyle(thick,metal.escura,1).lineBetween(x0,y0,x1,y1)
      .lineStyle(Math.max(1,thick*.3),metal.luz,1).lineBetween(x0,y0-thick*.2,x1,y1-thick*.2)
      .fillStyle(this.breu,1).fillCircle(x1,y1,thick*.75);
  }
  /** C3: coils of wire around the post (no turning weapon), baked with the base. */
  private drawWire(g:Phaser.GameObjects.Graphics,t:Tower){
    const s=this.s,w=this.o.world,r=t.view.r*1.3;
    for(let i=0;i<8;i++){
      const a=i/8*Math.PI*2,p=w.project(t.view.x+Math.cos(a)*r,t.view.y+Math.sin(a)*r,.12,this.p);
      g.lineStyle(Math.max(1,2.5*s),this.breu,1).strokeCircle(p.x,p.y,4*s).lineStyle(Math.max(1,1.2*s),MATERIALS['metal-pintado'].luz,1).strokeCircle(p.x,p.y,4*s);
    }
  }
}

/** How long a defense made before its sheet waits unseen for it (fetched first: ~1 s on a 9 Mbps phone), then procedural. */
export const TOWER_ART_WAIT_MS=5000;
/** Texture keys of a defense's imported sheets. */
export const towerBaseKey=(kind:string)=>`art:torres:${kind}:base`;
export const towerGunKey=(kind:string)=>`art:torres:${kind}:idle`;
/**
 * Public URL of the lite copy of a defense's sheet (scripts/art-lite.mjs, family towers): one sheet per file, its
 * pages joined, frames in order at `liteCell`.
 */
export const towerLiteUrl=(kind:string,name:string)=>`/art/lite/towers/${kind}/${name}.webp`;
/** A delivered tower sheet to load: texture key, URL and frame size. */
export interface TowerLoad {key:string;url:string;frameWidth:number;frameHeight:number}
/**
 * The delivered sheets of `kind` (every kind without it): the lite copy when the manifest has one (`liteCell`, a single
 * page even when the delivered sheet is paged), else a single-page delivered file; the rest stays procedural.
 */
export function towerLoads(kind?:TowerKind):TowerLoad[]{
  const group=artIndex().groups.torres;if(!group)return [];
  const out:TowerLoad[]=[];
  for(const k of kind?[kind]:TOWER_KINDS as readonly TowerKind[]){
    const art=towerArt(k);if(!art)continue;
    for(const [key,name,file] of [[towerBaseKey(k),'base',art.base],[towerGunKey(k),'idle',art.idle]] as const){
      if(!file)continue;
      if(file.liteCell)out.push({key,url:towerLiteUrl(k,name),frameWidth:file.liteCell[0],frameHeight:file.liteCell[1]});
      else if(file.file&&(file.pages?.length??1)<=1)out.push({key,url:groupFileUrl(group,file.file),frameWidth:file.cell[0],frameHeight:file.cell[1]});
    }
  }
  return out;
}
/** Queues the delivered tower sheets not loaded yet (towerLoads) on the scene's loader. */
export function queueTowerArt(scene:Phaser.Scene){
  for(const l of towerLoads())if(!scene.textures.exists(l.key))scene.load.spritesheet(l.key,l.url,{frameWidth:l.frameWidth,frameHeight:l.frameHeight});
}
