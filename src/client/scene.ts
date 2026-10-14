import {perf} from './dev/perf-flag.ts';
import {createTerrain,type TerrainLayer} from './terrain/renderer.ts';
import {propChunks} from './terrain/tiles.ts';
import {CityTerrain,TerrainField,randomSeed} from '../maps/index.ts';
import Phaser from 'phaser';
import {Vignette} from './render/vignette.ts';
import {sunlit} from './render/light-actors.ts';
import { classes, infinitoPoiName } from '../rules/index.ts';
import {FollowCamera,StepLerp,chooseWatched,framesBeside,hordeUiScale,isCityWorld,toScreen,edgeOf,type BesideWindow,type Rect,type Watchable} from './framing.ts';
import {SceneTerrain,worldCamera} from './world-swap.ts';
import {Pinch,ZOOM_DEFAULT,clampZoom,easeZoom,wheelZoom} from './camera-zoom.ts';
import {CityLayer,OUTSIDE_CITY,PINE_TEXTURE,buildCityArtPlan,cityArtOptions,cityRenderAsset,groundZ,queueCityArt,type CityArtPlan} from './render/city/index.ts';
import {artIndex} from './art/manifest.ts';
import {projectView,unprojectView,viewDepth,screenDirection,rotateVector,normalizeView,rotationLocked} from './projection.ts';
import {treeCatalog,type TreeArt} from '../maps/index.ts';
import {CharacterSprites} from './sprites/character-sprites.ts';
import {CityOutlines} from './render/city-outline.ts';
import {cityGroundLuminance} from './render/city-outline-rules.ts';
import {treeUrl,thumbUrl,iconKey,originalUrl,STAND_IN_KEY} from './sprites/art-urls.ts';
import { CoopClient, STEP } from './net/client.ts';
import {SelfCorrection} from './net/smoothing.ts';
import {SPAWN,landmarks,obstacles,findPath,moveAlong,moveDirection,clearSegment,worldSpawn,type Point,type Obstacle} from '../maps/index.ts';
import {HordeRenderer} from './render/layers.ts';
import {queueEnemyArt,queueHordeArt} from './art/horde-art.ts';
import {queueBaseArt} from './art/base-art.ts';
import {SceneMarks} from './art/frames-art.ts';
import {ALLY_RING_SIZE,ALLY_RING_WIDTH,AllyRings,critterIconSource} from './art/hud-art.ts';
import {StonewardsRenderer} from './render/stonewards.ts';
import {ChaveiroRenderer} from './render/chaveiro/renderer.ts';
import {objectiveOf} from './render/chaveiro/view.ts';
import {TowerRenderer,queueTowerArt} from './render/towers/towers.ts';
import {TowerFeed,hasTowers} from './render/towers/tower-rules.ts';
import {HEIGHT_PX} from './render/city/projection.ts';
import {buildPlanFor,elevation,farPath} from '../maps/index.ts';
import {Projector} from './render/projector.ts';
import {ENEMY_ART,ELITE_SCALE,drawnKind,enemyKind,enemyTexture} from './render/keys.ts';
import type {RunView} from '../contract/index.ts';
import {token,tokenColor} from './ui/tokens.ts';
import {YouMarkers,ALLY_DEPTH,SELF_DEPTH,type HeroMark} from './render/you.ts';
import {arrowTrigger,canopyCovers,effectOn,facingFrom} from './render/you-rules.ts';
import {MapLabel,allyLabelText,mapLabelVisible,placeYieldsToSos} from './render/map-labels.ts';
import {secondsLeft} from './hud/model.ts';
import {DownedLayer,type DownedMark} from './render/downed.ts';
import {ZueiraFx} from './render/zueira-fx.ts';
import {LIFTED_DEPTH,auditBlackout} from './render/blackout-rules.ts';
import {MARK_DEPTH} from './render/you.ts';
import {HERO_SHADOW_SIZE,destinationArtRim,destinationMark,heroShadow} from './render/city-edge-rules.ts';
import {ENEMY_DRAW_SCALE,HERO_DRAW_SCALE} from './render/draw-scale.ts';
import {FpsWatch,frameGateMs,renderProfile} from './economy.ts';
import {CatchUp,CATCH_UP_GATE_MS} from './net/backlog.ts';
import {HoldFollow,MARKER_MS,keyVector,markerVisible} from './desktop-input.ts';
/** Client-side range for the prototype skill ring (scene.ts). */
export const SKILL_RANGE=2.8;

/** Tower defenses (torres-render): crater decals just over the ground's shadows (the effects sort with the actors). */
const TOWER_GROUND_DEPTH=-9985;
/** The room broadcasts every other tick (Room.advance), so authoritative views arrive every 2 steps. */
const PUSH_MS=2*STEP*1000;
/**
 * Smallest tap radius on an enemy, in CSS px (D-009: ≥ 44 px targets); a bêbado is ~36 px tall at the follow zoom (in
 * the city too: its art is scaled by CITY_VIEW_SCALE under a zoom 1/CITY_VIEW_SCALE times larger).
 */
const ENEMY_TAP_RADIUS_PX=26;
/** Endless world: the depth origin follows the hero in steps of this many units (projection.ts viewDepth). */
const DEPTH_REBASE_UNITS=24;
/** The water bake covers the view plus this share of it on each side, and is redone only when the view leaves it. */
const WATER_MARGIN=.2;
/** Place fichas: above canopies and the horde's numbers and balloons, below allies (96400) and telegraphs. */
const LABEL_DEPTH=96300;

export interface SceneHooks {
  classId:string;
  direction:()=>Point;
  position:(point:Point)=>void;
  discovered:(index:number)=>void;
  ready:()=>void;
  terrain?:(seed:number,signature:string)=>void;
  message:(text:string)=>void;
  visual?:(animation:string,frame:string,sheets:number)=>void;
  net?:CoopClient;
  attacking?:()=>boolean;
  /** Each new authoritative RunView (coop only), right after the horde renderer got it: the HUD consumes it. */
  runView?:(view:RunView)=>void;
  /** The HUD's kill-cam picture (CSS px, viewport coordinates) while it shows, VGM-053B. */
  killcamRect?:()=>Rect|undefined;
  /** Economy mode at start (VGM-048: 30 fps, fewer effects); setEconomy changes it live. */
  economy?:boolean;
  /** The FPS watch saw the combat stay under 40 fps (coop, economy off): the shell turns economy on and says so. */
  slow?:()=>void;
  /** The player's zoom at start (camera-zoom.ts: a factor on the follow zoom; default ZOOM_DEFAULT). */
  zoom?:number;
  /** The wheel or a pinch changed the wanted zoom (the shell saves it). */
  zoomChanged?:(k:number)=>void;
}
type Graphics=Phaser.GameObjects.Graphics;
const polygon=(g:Graphics,points:Point[],color:number,alpha=1)=>{
  g.fillStyle(color,alpha).fillPoints(points,true);
};
const random=(x:number,y:number)=>{const n=Math.sin(x*127.1+y*311.7)*43758.5453;return n-Math.floor(n);};
type Prop={point:Point;object:Graphics|Phaser.GameObjects.Image;tree?:TreeArt;art?:string};
type Sign={point:Point;graphic:Graphics;label:MapLabel};
const TREES=new Map(treeCatalog.map(t=>[t.id,t]));
/** Endless world: tree sheets kept in memory with no tree of theirs around (each ~1.5 MB of texture); older ones go. */
const TREE_TEXTURES_IDLE=12;
/** Endless world: tree sheets loaded before the first frame, for the obstacles this close to the spawn. */
const TREE_PRELOAD_UNITS=24;
/** Endless world: a tree whose sheet arrives on screen fades in over this long (instant with reduced motion). */
const TREE_FADE_MS=220;

/**
 * window.__partidaPronta, set once per page: the scene drew a run view with a round at tick > 0 (the room only steps
 * in combat). The production smoke's "entered the match" in a fresh solo room. Not a general "in combat now": a room
 * that already played keeps its tick in the lobby or the result, and the offline island (?ilha=1) never sets it.
 */
let matchSignalled=false;
export class IslandScene extends Phaser.Scene {
  private hooks:SceneHooks;
  /** The last {t:'elenco'} list whose art was queued (horde-art.ts queueEnemyArt). */
  private elenco?:readonly string[];
  private view=0;
  private landscape?:TerrainLayer;
  /** Tears the ground down (its own shutdown teardown, run early): a world swap builds the new world's ground. */
  private dropGround?:()=>void;
  /**
   * The scene's ONE terrain (cidade-04 review #4): camera, projection, ground, props, tap paths and the local walk all
   * read it. It follows the net's terrain when that becomes another world (kind or signature; world-swap.ts).
   */
  private terrainWatch!:SceneTerrain<TerrainField>;
  private get field():TerrainField{return this.terrainWatch.field;}
  private signs:Sign[]=[];
  private project=(p:Point)=>projectView(p,this.view,this.field);
  /** Depth origin: none on the island; near the hero in the endless world, so depths stay in the island's range. */
  private depthOrigin?:Point;
  private depth=(p:Point)=>this.city?this.city.actorDepth(p.x,p.y):viewDepth(p,this.view,this.depthOrigin);
  /**
   * Cidade Nevada (card cidade-03): the city render replaces the island ground and props. Actors draw at the layer's
   * actor depth (exact against the buildings' unit columns), not at the island's fixed SELF_DEPTH/ALLY_DEPTH.
   */
  private city?:CityLayer;
  /** City layer depth keys are plain viewDepth keys; this shifts them by the current depth origin (same as viewDepth). */
  private cityDepthOf=(key:number)=>key+viewDepth({x:0,y:0},this.view,this.depthOrigin)-viewDepth({x:0,y:0},this.view);
  /** Follow camera (D-019): centre of the camera in world px, smoothed, with look-ahead (framing.ts). */
  private follow=new FollowCamera();
  private zoom=1;
  /**
   * World px multiplier of everything drawn at the endless map's size (hero, allies, enemies, rings, shadows):
   * framing.ts CITY_VIEW_SCALE in the city, 1 elsewhere. Set by fit() from the scene's terrain.
   */
  private actorScale=1;
  private canvasOffset={x:0,y:0};
  /** The 20 Hz prediction drawn between its last two steps (camera without steps, code review onda 4). */
  private steps=new StepLerp();
  /** The local hero's reconcile error, faded on screen (3g-rede-sem-teleporte, smoothing.ts). */
  private correction=new SelfCorrection();
  /** Out or watching (UX onda 4): the teammate the camera follows, and where it last was. */
  private watchId?:string;
  private watchPinned=false;
  private watchPoint?:Point;
  /** City see-through (cidade-borda-e-quadras): the allies' feet drawn this frame, so walls in front of them fade too. */
  private allyFeet:Point[]=[];
  private position:Point={...SPAWN};
  private route:Point[]=[];
  /** The player's zoom factor (camera-zoom.ts): wanted (wheel, pinch), on screen (eased toward it). */
  private zoomWant=ZOOM_DEFAULT;
  private zoomNow=ZOOM_DEFAULT;
  /** The camera zoom the last time the eased zoom settled: what caches made for a zoom follow (city outline copies). */
  private settledZoom=1;
  private readonly pinch=new Pinch();
  private actor!:Phaser.GameObjects.Sprite;
  /** City mode (contorno-breu): screen-scale Breu outlines of every figure; built once, kept across world swaps. */
  private outlines=new CityOutlines(this,{active:()=>isCityWorld(this.field),zoom:()=>this.settledZoom,
    groundLuminance:(x,y)=>this.city?cityGroundLuminance(this.city.asset,x,y):undefined});
  private sprites=new CharacterSprites(this,this.outlines);
  private shadow!:Phaser.GameObjects.Ellipse;
  private ring!:Phaser.GameObjects.Ellipse;
  private destination!:Graphics;
  /** Imported destination marker and skill rings (art/frames-art.ts); without the art, today's Graphics. */
  private artMarks?:SceneMarks;
  /** Imported ally ground rings (art/hud-art.ts); without the art, each ally's Breu ellipse. */
  private allyRings?:AllyRings;
  private goal?:Point;
  /** Desktop (controles-desktop): the held mouse button follows the cursor (Warcraft 3), re-targeted on a throttle. */
  private hold=new HoldFollow();
  /** A mouse walk's marker shows until this time (MARKER_MS after the click or the release); undefined: to the end. */
  private markerUntil?:number;
  private discovered=new Set<number>();
  private cursors?:Phaser.Types.Input.Keyboard.CursorKeys;
  private keys?:Record<string,Phaser.Input.Keyboard.Key>;
  private props:Prop[]=[];
  /** Bumped whenever the props change (a chunk in or out, a tree's art arriving): prize canopy tests run again. */
  private propsVersion=0;
  private trees:(TreeArt|undefined)[]=[];
  private treeShadows?:Graphics;
  /** Endless world (terreno-em-blocos): props and place fichas of the chunks around the camera, by chunk. */
  private chunkProps=new Map<string,{cx:number;cy:number;props:Prop[];signs:Sign[]}>();
  /** Endless world: live props per tree sheet, and sheets loaded but unused (oldest first). */
  private treeUse=new Map<string,number>();
  private treeIdle=new Set<string>();
  /** Endless world: sheets of the ring beyond the screen, fetched one by one in the background (pumpTrees). */
  private treeLater=new Set<string>();
  /** Island only: the art of its 12 trees (the endless world's come with its chunks; the city has none of the island's). */
  private chooseTrees(){if(this.field.chunks||isCityWorld(this.field))return [];return obstacles.filter(o=>o.kind!=='rock').map((_o,i)=>{
    const seed=[...(this.hooks?.net?.code??'ilha')].reduce((n,c)=>n+c.charCodeAt(0),0);
    return treeCatalog.length?treeCatalog[(seed+i*3)%treeCatalog.length]:undefined;
  });}
  private stamp=0;
  private distance=0;
  private paused=false;
  /** Economy mode (VGM-048) and the FPS watch that may ask for it (coop combat only). */
  private economy=false;
  /** create() ran: the frame gate and the horde exist (setEconomy before that only keeps the choice). */
  private booted=false;
  private readonly fpsWatch=new FpsWatch();
  /** rAF time of the last drawn frame: Phaser's own delta is smoothed and clamped at 200 ms, too kind to a slow phone. */
  private lastFrameAt?:number;
  private accumulator=0;
  private attackTarget?:string;
  private skillEffects?:Graphics;
  private displayed?:Point;
  private remoteActors=new Map<string,{image:Phaser.GameObjects.Sprite;label:MapLabel;ring:Phaser.GameObjects.Ellipse;
    /** City only: the ally's contact shadow, Breu 38% like the hero's (created on demand, dropped off the city). */
    shadow?:Phaser.GameObjects.Ellipse}>();
  /** Horde layers (VGM-039) fed by net.feed; players stay sprites owned by this scene. */
  private horde?:HordeRenderer;
  /** Wall, camp ring, towers and gather nodes (VGM-046B), fed by the same RunView. */
  private stone?:StonewardsRenderer;
  /** D-047: the chaveiro objective in the world (the car, the moto, their effects); only while a run view has one. */
  private chaveiro?:ChaveiroRenderer;
  /**
   * Tower defenses (torres-render): built on the first snapshot that has one (makeTowers; a world without defenses pays
   * nothing: no renderer, atlas, layers or enemy walk), then kept across world swaps (reset, not rebuilt), fed by
   * view.structures through TowerFeed on every new snapshot and drawn every frame; released with the scene.
   */
  private towers?:TowerRenderer;
  private readonly towerFeed=new TowerFeed();
  /** The live enemies the weapons aim at (parallel arrays, grown as needed) and the world's build plan (cell, rail). */
  private towerAim={n:0,xs:new Float32Array(64),ys:new Float32Array(64),air:new Uint8Array(64)};
  private buildPlan?:ReturnType<typeof buildPlanFor>;
  private readonly towerFigures:{x:number;y:number;z:number}[]=[];
  private readonly shakeAt={x:0,y:0};
  private projector?:Projector;
  private stateVersion=-1;
  private offersVersion=-1;
  private reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Ring, contour, mini health bar and "Você" arrow of the local hero; see-through copies over canopies (UX-voce-e-dano). */
  private you?:YouMarkers;
  private marks:HeroMark[]=[];
  private selfCovered=false;
  private lastPhase?:string;
  /** Wave or interval of the current round: map labels come back in the interval. */
  private roundPhase?:string;
  /** Tick of the last authoritative view (seconds left on a caído ficha). */
  private viewTick=0;
  private sosScreens:{x:number;y:number}[]=[];
  private lastFeet?:Point;
  private facing=Math.PI/2;
  /** Where the local hero means to walk (world units, last step): its sprite faces this, not the reconciled position (sprites-4-direcoes). */
  private intent:Point={x:0,y:0};
  /** Caídos in the world: rescue ring, progress and light column (UX-resgate-e-ping). */
  private downedLayer?:DownedLayer;
  private downedMarks:DownedMark[]=[];
  /** Blackout and kill-cam of the zueira events (VGM-053B). */
  private zueira?:ZueiraFx;
  /** The local caído's own ficha ("Você, 18 s") under its body: the counter left the top banner. */
  private selfLabel?:MapLabel;
  /**
   * Screen area left for play once the HUD zones are out (UX-zonas-tela), CSS px in viewport coordinates: the edge arrows
   * ride its rim; the follow camera centres the hero on it only beside a panel (framing.ts framesBeside).
   */
  usefulArea?:Rect;
  /**
   * The open window the camera may frame the hero beside (framing.ts besideFrom, framesBeside): the obra window in the
   * intermission, the forge or Dona Cida's tray when it would cover the centred hero (portrait). explore.ts sets it with
   * the useful area, at the position hook's rate (~10 Hz), not every frame.
   */
  besideWindow?:BesideWindow;
  /** Where the camera frames the hero beside that window (zones.ts besideArea), CSS px; the useful area without it. */
  frameArea?:Rect;
  constructor(hooks:SceneHooks){super('island');this.hooks=hooks;this.zoomWant=this.zoomNow=clampZoom(hooks.zoom??ZOOM_DEFAULT);this.economy=!!hooks.economy;this.terrainWatch=new SceneTerrain(hooks.net?.terrain??new TerrainField(randomSeed()));this.trees=this.chooseTrees();}
  /**
   * What the first frame needs, in the order it is fetched (N27): the ground, this hero's sheet and its stand-in, the
   * room's class icons (only the classes in the room; one joining later is fetched then, classIcon) and the trees by
   * the spawn. Teammates' sheets come right after the first frame (CharacterSprites.animate), the trees around as the
   * camera needs them, and the ring beyond in the background (pumpTrees).
   */
  preload(){
    // A copy that does not load (missing from a deploy, a broken cache) comes from the approved file instead.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR,(file:Phaser.Loader.File)=>this.artFallback(file));
    // City: no island ground textures; its pines use the approved snowy tree sheet (city layer PINE_TEXTURE).
    if(this.field instanceof CityTerrain){
      this.load.spritesheet(PINE_TEXTURE,treeUrl('arvore-nevada'),{frameWidth:256,frameHeight:384});
      queueCityArt(this,this.cityArt()); // imported city art v2 (render/city/art-plan.ts) when the manifest has it
    }
    else{this.load.image('terrain-soil','/art/terrain/soil-grass.webp');this.load.image('terrain-bed','/art/terrain/riverbed.webp');}
    this.sprites.queue(this.hooks.classId);
    this.load.image('hero',thumbUrl(this.hooks.classId));
    if(this.hooks.net)for(const id of new Set([this.hooks.classId,...[...this.hooks.net.players.values()].map(p=>p.classId)]))this.classIcon(id);
    for(const tree of new Set([...this.trees,...this.spawnTrees()]))if(tree)this.loadTree(tree.id);
    queueHordeArt(this); // imported art v2 (enemies, items, FX) when the manifest has it
    queueBaseArt(this); // imported Stonewards base art (wall, barricades, crates) when the manifest has it
    queueTowerArt(this); // imported defense sheets (torres) when the manifest has them; else procedural
  }
  /**
   * Texture key of a class's icon (a teammate's stand-in until its sheet is in), fetched at once the first time it is
   * asked (the trees beyond the screen wait for an idle loader, pumpTrees); until it is in, a silhouette.
   */
  private classIcon(classId:string){
    const key=iconKey(classId,k=>this.textures.exists(k));
    if(key!==STAND_IN_KEY||!classes.some(c=>c.id===classId))return key;
    const wanted=`class:${classId}`;
    if(!this.iconsAsked.has(wanted)){this.iconsAsked.add(wanted);this.load.image(wanted,thumbUrl(classId));if(this.booted&&!this.load.isLoading())this.load.start();}
    return key;
  }
  /** The silhouette a teammate shows before its class icon arrives: Breu, 55%, head and shoulders. */
  private standIn(){
    if(this.textures.exists(STAND_IN_KEY))return;
    const g=this.make.graphics({x:0,y:0},false),breu=tokenColor('--c-breu');
    g.fillStyle(breu,.55).fillCircle(32,20,13).fillRoundedRect(12,34,40,30,{tl:16,tr:16,bl:4,br:4});
    g.generateTexture(STAND_IN_KEY,64,64);g.destroy();
  }
  private fellBack=new Set<string>();
  private artFallback(file:Phaser.Loader.File){
    const url=typeof file.url==='string'?originalUrl(file.url):undefined;
    if(!url||this.fellBack.has(file.key))return;
    this.fellBack.add(file.key);
    if(file.type==='spritesheet')this.load.spritesheet(file.key,url,file.config as Phaser.Types.Loader.FileTypes.ImageFrameConfig);
    else if(file.type==='image')this.load.image(file.key,url);
    else return;
    if(!this.load.isLoading())this.load.start();
  }
  private iconsAsked=new Set<string>();
  create(){
    // ?perf=1 (BUG-20261014-ORQ-engasgo-andando-celular): Phaser's logic step and its render, charged to each frame.
    if(perf.on){
      const ev=Phaser.Core.Events,game=this.game.events;let t=0;
      const step=()=>{t=performance.now();},logic=()=>{const now=performance.now();perf.mark('logica',now-t);t=now;},render=()=>{perf.mark('render',performance.now()-t);};
      game.on(ev.PRE_STEP,step);game.on(ev.PRE_RENDER,logic);game.on(ev.POST_RENDER,render);
      // The display list for window.__perf.inventario() (dev/perf-overlay.ts): what the render draws.
      (window as unknown as {__perfScene?:Phaser.Scene}).__perfScene=this;
      this.events.once(Phaser.Scenes.Events.SHUTDOWN,()=>{game.off(ev.PRE_STEP,step);game.off(ev.PRE_RENDER,logic);game.off(ev.POST_RENDER,render);});
    }
    this.standIn();
    // Reduced motion: the camera still follows, without the sway of the look-ahead.
    this.follow.lookAhead=!this.reduced;
    // Tree sheets come in as the hero walks (endless world) or after a map switch (island): a sketch turns into its sheet.
    this.load.on(Phaser.Loader.Events.FILE_COMPLETE,(key:string)=>{if(key.startsWith('tree:'))this.treeLoaded(key.slice(5));});
    this.buildWorld();
    // Lighting card: the vignette over the world (the grade itself is baked into the ground shaders; `?luz=0` skips both).
    this.vignette=new Vignette(this);this.applyGrade();
    // The hero's shadow, ring and stand-in follow its drawn size (HERO_DRAW_SCALE, render/draw-scale.ts).
    this.shadow=this.add.ellipse(0,0,42,17,0x3d756a,.2).setScale(HERO_DRAW_SCALE);
    this.shadowLook();
    // The old cream ring stays only as an object (rotation/placement code moves it); the you-marker draws the real one.
    this.ring=this.add.ellipse(0,0,50,23).setStrokeStyle(2,0xfff8c8,.95).setVisible(false).setScale(HERO_DRAW_SCALE);
    this.actor=sunlit(this.add.sprite(0,0,'hero').setOrigin(.5,.88).setDisplaySize(112*HERO_DRAW_SCALE,112*HERO_DRAW_SCALE));
    this.you=new YouMarkers(this,this.reduced,this.outlines);this.you.showArrow(this.time.now);
    this.destination=this.add.graphics().setDepth(100000).setName('destino');
    this.artMarks=new SceneMarks(this,p=>this.project(p));
    // Released with the scene (stop → 'shutdown', game.destroy → 'destroy'), with or without a server.
    const marks=this.artMarks,dropMarks=()=>{marks.destroy();if(this.artMarks===marks)this.artMarks=undefined;};
    this.events.once('shutdown',dropMarks);this.events.once('destroy',dropMarks);
    const rings=this.allyRings=new AllyRings(this,tokenColor('--c-breu')),dropRings=()=>{rings.destroy();if(this.allyRings===rings)this.allyRings=undefined;};
    this.events.once('shutdown',dropRings);this.events.once('destroy',dropRings);
    // Only the canvas's own presses land here (POINTER_DOWN needs the canvas as the down element): a press on the DOM HUD
    // never walks. A mouse press on the ground also starts the hold-to-follow (followHold); one on an enemy targets it.
    this.input.on('pointerdown',(pointer:Phaser.Input.Pointer)=>{
      if(this.paused||!pointer.primaryDown)return;
      const p=this.cameras.main.getWorldPoint(pointer.x,pointer.y);
      const hit=this.enemyAt(p);
      this.hold.release();
      if(hit){this.attackTarget=hit;this.horde?.setTarget(hit);this.hooks.message('Alvo priorizado. A arma atira sozinha quando ele chega perto.');return;}
      const target=unprojectView(p,this.view,this.field),mouse=!pointer.wasTouch;
      this.goTo(target,mouse?{markerMs:MARKER_MS}:undefined);
      // Held from a spot with no way there (water) too: dragging out of it starts the walk.
      if(mouse)this.hold.press(target,this.time.now);
    });
    // Zoom (camera-zoom-out-e-roda): the mouse wheel over the map, and a two-finger pinch on it (touch pointers on the
    // canvas only: the stick captures its own finger). Phaser tracks one touch pointer, so the pinch reads the DOM.
    this.input.on('wheel',(pointer:Phaser.Input.Pointer,_over:unknown,_dx:number,dy:number)=>{
      const e=pointer.event as WheelEvent|undefined;
      if(!this.paused)this.setZoom(wheelZoom(this.zoomWant,dy,e?.deltaMode??0,!!e?.ctrlKey));
    });
    const canvas=this.game.canvas;
    if(canvas){
      const touch=(e:PointerEvent)=>e.pointerType==='touch';
      const down=(e:PointerEvent)=>{if(touch(e)&&this.pinch.down(e.pointerId,e.clientX,e.clientY))this.cancelWalk();};
      const move=(e:PointerEvent)=>{if(!touch(e))return;const r=this.pinch.move(e.pointerId,e.clientX,e.clientY);if(r!==undefined&&r!==1&&!this.paused)this.setZoom(this.zoomWant*r);};
      const up=(e:PointerEvent)=>{if(touch(e))this.pinch.up(e.pointerId);};
      canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);
      canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);
      // A finger whose pointerup never reached the canvas would turn the next one-finger drag into a pinch.
      const forget=()=>this.pinch.reset();
      globalThis.addEventListener?.('blur',forget);document.addEventListener?.('visibilitychange',forget);
      const off=()=>{canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);
        globalThis.removeEventListener?.('blur',forget);document.removeEventListener?.('visibilitychange',forget);this.pinch.reset();};
      this.events.once('shutdown',off);this.events.once('destroy',off);
    }
    this.cursors=this.input.keyboard?.createCursorKeys();
    this.keys=this.input.keyboard?.addKeys('W,A,S,D') as typeof this.keys;
    this.scale.on('resize',this.fit,this);
    // The city copies (contorno-breu) are freed on shutdown or game destroy, with or without a net session: an offline
    // scene's heroes draw copies too.
    const dropOutlines=()=>this.outlines.destroy();
    this.events.once('shutdown',dropOutlines);this.events.once('destroy',dropOutlines);
    if(this.hooks.net){
      this.position={...this.hooks.net.predicted};
      const net=this.hooks.net;
      // A frame moved the prediction: the drawing stays put and the error fades; a big one snaps behind a puff.
      net.onReconcile=(from,to,skill)=>{
        // The own skill moved the hero (a dash): a real move, drawn like one (the step glides it, a long one jumps).
        if(skill){this.steps.sync(to);return;}
        const drawn={x:from.x+this.correction.x,y:from.y+this.correction.y};
        if(this.correction.absorb(from,to)==='hide'){this.steps.sync(to,0);this.horde?.poofAt(drawn.x,drawn.y);this.horde?.poofAt(to.x,to.y);}
        else this.steps.shift(to.x-from.x,to.y-from.y);
      };
      this.events.once('shutdown',()=>{if(net.onReconcile)net.onReconcile=undefined;});
      this.projector=new Projector(this.view,this.field);
      this.cityDepths();
      // Text, bars and markers keep a readable size if the zoom ever goes under ~0.55 (the follow zoom is ≥ 0.58: scale 1);
      // in the city they and the critters are scaled by CITY_VIEW_SCALE, so they keep their CSS size under the city zoom.
      this.horde=new HordeRenderer(this,{projector:this.projector,uiScale:()=>hordeUiScale(this.cameras.main.zoom,this.actorScale),actorScale:()=>this.actorScale,reduced:this.reduced,
        tickMs:STEP*1000,pushMs:PUSH_MS,selfId:()=>net.id||undefined,
        locate:id=>id===net.id?net.predicted:net.players.get(id),
        // Boletos and the sale's coxinhas behind a tree go above the canopies (pacote-bugs-ux, VGM-053B review M3).
        canopyCovers:(q,depth)=>this.treeCovers(q,depth),canopyVersion:()=>this.propsVersion,
        // City: dashed Breu/Papel telegraph edge with a solid Cone ring, Breu 38% contact shadows (card cidade-contorno-breu).
        city:()=>this.cityMode,cityOutlines:this.outlines});
      // game.destroy(true) emits 'destroy' (not 'shutdown'); a scene stop emits 'shutdown'. Either releases the pools once.
      // Caídos' light columns follow the figures' scale (CITY_VIEW_SCALE in the city).
      this.downedLayer=new DownedLayer(this,p=>this.project(p),p=>this.depth(p),()=>this.actorScale);
      // The wall, the towers and the kill-cam's copy follow the figures' scale too (CITY_VIEW_SCALE in the city).
      this.stone=new StonewardsRenderer(this,{projector:this.projector,reduced:this.reduced,hero:()=>this.position,actorScale:()=>this.actorScale});
      this.zueira=new ZueiraFx(this,{reduced:this.reduced,project:p=>this.project(p),depth:p=>this.depth(p),tickMs:STEP*1000,actorScale:()=>this.actorScale,
        setBlackout:level=>this.horde?.setBlackout(level),
        killcamRect:()=>{const r=this.hooks.killcamRect?.();return r&&{x:Math.round(r.x-this.canvasOffset.x),y:Math.round(r.y-this.canvasOffset.y),width:Math.round(r.width),height:Math.round(r.height)};}});
      const release=()=>{this.chaveiro?.destroy();this.chaveiro=undefined;this.zueira?.destroy();this.zueira=undefined;this.horde?.destroy();this.horde=undefined;this.stone?.destroy();this.stone=undefined;this.towers?.destroy();this.towers=undefined;this.you?.destroy();this.you=undefined;this.downedLayer?.destroy();this.downedLayer=undefined;this.selfLabel?.destroy();this.selfLabel=undefined;};
      this.events.once('shutdown',release);this.events.once('destroy',release);
    }
    this.rebaseDepth(true);this.fit();this.place();
    this.booted=true;this.setEconomy(this.economy);
    this.hooks.terrain?.(this.field.seed,this.field.signature);this.hooks.position(this.position);this.hooks.ready();
  }
  /** Viewport size in CSS px (the canvas fills the stage; Phaser RESIZE mode, 1 game px = 1 CSS px). */
  private viewport(){return {width:this.scale.width,height:this.scale.height};}
  /** Useful area in canvas coordinates (the HUD measures it in viewport coordinates). */
  private useful():Rect|undefined{
    const u=this.usefulArea;if(!u)return undefined;
    return {x:u.x-this.canvasOffset.x,y:u.y-this.canvasOffset.y,width:u.width,height:u.height};
  }
  /** Where the follow camera frames the hero beside a panel, in canvas coordinates: frameArea, else the useful area. */
  private framed():Rect|undefined{
    const u=this.frameArea;if(!u)return this.useful();
    return {x:u.x-this.canvasOffset.x,y:u.y-this.canvasOffset.y,width:u.width,height:u.height};
  }
  /**
   * What depends on the field and is drawn once per world: background, ground, and the island's trees, rocks and
   * landmarks (the endless world's come chunk by chunk, syncProps). Run by create() and by a world swap.
   *
   * City gap (until cidade-03 wires render/city CityLayer into this scene): no ground layer and none of the island's
   * props or landmarks, only the snow background under the figures; the island renderer never draws a city field.
   */
  private buildWorld(){
    const city=isCityWorld(this.field);
    // Endless map: a tile not baked yet (a jump of the camera spreads the bakes over a few frames) shows plain grass, not sea.
    if(city)this.cameras.main.setBackgroundColor(OUTSIDE_CITY);
    else this.cameras.main.setBackgroundColor(token(this.field.chunks?'--cena-grama':'--cena-mar'));
    this.drawGround();
    this.cityDepths();
    if(city||this.field.chunks)return;
    let treeIndex=0;
    for(const o of obstacles)this.props.push(this.makeProp(o,o.kind==='rock'?undefined:this.trees[treeIndex++]));
    this.propsVersion++;
    this.drawTreeShadows();
    landmarks.forEach((l,i)=>this.signs.push(this.drawLandmark(l,i,l.name)));
  }
  /** Drops everything buildWorld and syncProps drew for the old world (ground, props, place fichas, tree shadows). */
  private clearWorld(){
    this.dropGround?.();this.dropGround=undefined;this.landscape=undefined;
    for(const entry of this.chunkProps.values())for(const prop of entry.props)if(prop.art)this.useTree(prop.art,-1);
    this.chunkProps.clear();this.treeLater.clear();this.dropIdleTrees();
    for(const prop of this.props)prop.object.destroy();
    for(const sign of this.signs){sign.graphic.destroy();sign.label.destroy();}
    this.props=[];this.signs=[];this.propsVersion++;
    this.treeShadows?.clear();
    this.depthOrigin=undefined;
  }
  /**
   * The net's terrain became another world (lobby map switch, or a reconnect into a room that switched): the scene
   * adopts it whole, the way create() builds it, then re-fits (zoom, figure scale, camera snapped onto the hero).
   */
  private swapWorld(){
    this.clearWorld();
    this.trees=this.chooseTrees();
    let loads=false;
    for(const tree of this.trees)if(tree&&!this.textures.exists(`tree:${tree.id}`)){this.loadTree(tree.id);loads=true;}
    if(loads&&!this.load.isLoading())this.load.start();
    if(this.projector)this.projector.terrain=this.field;
    this.route=[];this.destination.clear();
    // The old world's spot means nothing here: the camera snaps to the prediction, the next frame brings the new spawn.
    if(this.hooks.net){this.position={...this.hooks.net.predicted};this.displayed=undefined;this.correction.clear();}
    // The old world's defenses and their craters go; the next snapshot brings this world's (no volley on first sight).
    this.towers?.reset();this.towerFeed.reset();this.buildPlan=undefined;
    this.buildWorld();this.shadowLook();this.applyGrade();
    this.rebaseDepth(true);this.reproject();this.fit();this.place();
    // hooks.terrain is not called again: explore.ts appends a settings line per call (it reports the first world only).
  }
  /** Cidade Nevada mode (the field says 'cidade'): the Breu edges and shadows of card cidade-contorno-breu. */
  private get cityMode(){return isCityWorld(this.field);}
  /** The hero's contact shadow for this world: Breu 38% in the city, main's teal 20% elsewhere. */
  private shadowLook(){const look=heroShadow(this.cityMode);this.shadow?.setFillStyle(look.color,look.alpha);}
  /** City mode: enemies, pickups and projectiles draw at the city layer's actor depth (Projector.depthOverride). */
  private cityDepths(){if(this.projector)this.projector.depthOverride=this.city?(x,y)=>this.city?this.city.actorDepth(x,y):0:undefined;}
  /** The heroes' drawn scale: the actor scale × HERO_DRAW_SCALE (their sheets, shadows, ally rings and fichas). */
  private get heroScale(){return this.actorScale*HERO_DRAW_SCALE;}
  /** Scales every figure drawn at the endless map's size; the sheets follow on their next animate(). */
  private setActorScale(k:number){
    // The city's depth and fade tests use the figure's real screen box.
    this.city?.setActorScale(k);
    const old=this.actorScale;if(k===old)return;
    this.actorScale=k;this.sprites.viewScale=k;
    const hero=this.heroScale;
    this.shadow?.setScale(hero);this.ring?.setScale(hero);
    const resize=(s:Phaser.GameObjects.Sprite,icon:number)=>{
      if(s.texture.key.startsWith('sprite:'))s.setScale(s.scaleX/old*k,s.scaleY/old*k);else s.setDisplaySize(icon*hero,icon*hero);
    };
    if(this.actor)resize(this.actor,112);
    for(const a of this.remoteActors.values()){resize(a.image,100);a.ring.setScale(hero);}
  }
  /** Fixed zoom for this orientation and a camera snapped onto the hero (first frame, resize, rotation, map switch). */
  private fit(){
    const viewport=this.viewport(),camera=worldCamera(viewport,this.field,this.zoomNow);
    this.zoom=camera.zoom;this.settledZoom=this.zoom;
    this.follow.world=camera.follow;this.setActorScale(camera.follow.scale);
    const at=this.watchPoint??this.position;
    const rect=this.game.canvas?.getBoundingClientRect();this.canvasOffset={x:rect?.left??0,y:rect?.top??0};
    const b=this.actor?this.heroWorldBox():undefined;
    const c=this.follow.snap(this.project(at),viewport,this.zoom,this.framed(),b&&!this.watchPoint?{width:b.width*this.zoom,height:b.height*this.zoom}:undefined);
    this.cameras.main.setSize(viewport.width,viewport.height).setZoom(this.zoom).centerOn(c.x,c.y);
    this.landscape?.fit(WATER_MARGIN);this.syncProps();this.updateCity(0);
  }
  /** City mode: chunks around the camera, fades over the hero; after every camera move (worldView in world px). */
  private updateCity(delta:number){
    if(!this.city)return;
    const cam=this.cameras.main,w=cam.width/cam.zoom,h=cam.height/cam.zoom;
    const camera={x:cam.midPoint.x-w/2,y:cam.midPoint.y-h/2,w,h};
    // The fade test needs the hero's real ground height (city relief reaches ~185 px).
    const asset=this.city.asset,hero=this.watchPoint?undefined:{x:this.position.x,y:this.position.y,z:groundZ(asset,this.position.x,this.position.y)};
    const allies=this.allyFeet.map(p=>({x:p.x,y:p.y,z:groundZ(asset,p.x,p.y)}));
    this.city.update({camera,view:this.view,dtMs:delta,hero,allies});
  }
  /** Follows the hero every frame: smooth, body at the viewport centre in the round, lag ≤ 1 u; the water is re-baked only when the view leaves it. */
  private updateCamera(delta:number){
    if(!this.actor)return;
    // The player's zoom eases toward the wanted one (wheel, pinch); the follow below centres at the new zoom.
    if(this.zoomNow!==this.zoomWant){
      this.zoomNow=easeZoom(this.zoomNow,this.zoomWant,delta);
      this.zoom=worldCamera(this.viewport(),this.field,this.zoomNow).zoom;this.cameras.main.setZoom(this.zoom);
      // Settled: the island's water re-fits once (not every frame of the ease), outline copies follow.
      if(this.zoomNow===this.zoomWant){this.settledZoom=this.zoom;this.landscape?.fit(WATER_MARGIN);}
    }
    // Out of the round, in the intermission and while following a teammate, nothing spawns against this screen: no budget.
    // The intermission has no spawns either (the budget is lifted, though the hero now stays at the centre there too).
    // In a wave the budget holds beside a window too (Dona Cida's tray may stay open there): it is the off-screen contract
    // (contract/offscreen.ts sizes MAX_OFFSCREEN_DISTANCE and INTEREST_RADIUS with it), so the camera goes as far as it lets.
    const run=this.hooks.net?.run?.phase;this.follow.free=!!this.hooks.net&&(run!=='combat'||!!this.watchPoint||this.roundPhase==='prepare');
    // In the round (wave, intermission, watching) the body is at the viewport centre (BUG-20261013-ORQ-camera-centro-heroi);
    // only the lobby/countdown (waiting panel), an open obra window and, in portrait, the forge or Dona Cida's tray frame
    // it beside the panel (framing.ts framesBeside).
    this.follow.beside=framesBeside(run,this.roundPhase,this.besideWindow);
    const b=this.heroWorldBox(),size=this.watchPoint?undefined:{width:b.width*this.zoom,height:b.height*this.zoom};
    // The hero as drawn (the interpolated prediction plus the reconcile glide, coop), not the bare prediction: the camera
    // centres what the player sees, so a correction slides the world, not the hero off the centre (camera-centro-heroi).
    const focus=this.project(this.watchPoint??this.position);
    const c=this.follow.step(focus,delta/1000,this.viewport(),this.zoom,this.framed(),size);
    this.cameras.main.centerOn(c.x,c.y);
    // The ground under who the camera follows is always baked first (a jump to a far teammate spreads the rest).
    this.landscape?.follow(WATER_MARGIN,focus);this.syncProps();this.pumpTrees();this.updateCity(delta);
  }
  /** Re-places everything drawn once in world px (props, signs, shadows) after a view turn or a depth re-base. */
  private reproject(){
    for(const prop of this.props){const p=this.project(prop.point);prop.object.setPosition(p.x,p.y).setDepth(this.depth(prop.point));if(prop.tree)(prop.object as Phaser.GameObjects.Image).setFrame(this.view);}
    this.drawTreeShadows();
    for(const sign of this.signs){const p=this.project(sign.point),depth=this.depth(sign.point);sign.graphic.setPosition(p.x,p.y).setDepth(depth-5);sign.label.anchor(p.x,p.y+28,LABEL_DEPTH);}
    this.city?.setDepthOf(this.cityDepthOf);
    if(this.projector){this.projector.view=this.view;this.projector.origin=this.depthOrigin;this.horde?.refresh();this.stone?.refresh();this.chaveiro?.refresh();}
    this.towers?.refresh();
  }
  /**
   * Endless world and city: moves the depth origin to the hero when it walked DEPTH_REBASE_UNITS away (screen
   * unchanged). The city spans ±34 000 in raw keys: without it, views 1–3 would sort under the ground layers.
   */
  private rebaseDepth(force=false){
    if(!this.field.chunks&&!this.city)return;
    const o=this.depthOrigin;
    if(!force&&o&&Math.max(Math.abs(o.x-this.position.x),Math.abs(o.y-this.position.y))<DEPTH_REBASE_UNITS)return;
    this.depthOrigin={x:Math.round(this.position.x),y:Math.round(this.position.y)};
    if(this.actor)this.reproject();
  }
  /** Whether the view may turn now (UX-camera-segue 4: never during a wave; the buttons go grey). */
  rotationLocked(){const net=this.hooks.net;return !!net&&rotationLocked(net.run?.phase,this.roundPhase);}
  /** Turns the view by 90° steps around the hero: the world turns, the camera snaps back onto the hero. Refused during a wave. */
  rotateCamera(turn:number){
    if(!this.actor||this.rotationLocked())return this.view;
    this.view=normalizeView(this.view+turn);this.landscape?.view(this.view);
    this.reproject();
    this.destination.clear();this.fit();this.place();
    return this.view;
  }
  /**
   * Off-screen API (UX-bordas-fora-da-tela, ORQ-minimapa build on it): screen point (CSS px, viewport coordinates)
   * of a world point, whether it is inside the useful area, and where its arrow would sit on the area's edge.
   */
  locate(p:Point,inset=0){
    const viewport=this.viewport();
    const s=toScreen(this.project(p),this.follow.center,viewport,this.zoom);
    const screen={x:s.x+this.canvasOffset.x,y:s.y+this.canvasOffset.y};
    const area=this.usefulArea??{x:this.canvasOffset.x,y:this.canvasOffset.y,width:viewport.width,height:viewport.height};
    return {screen,...edgeOf(screen,area,inset)};
  }
  /** The current view (0..3), for the minimap and the edge arrows. */
  get cameraView(){return this.view;}
  /** What the camera follows (world units): the hero, or the teammate watched while out. Distances count from here. */
  focusPoint():Point{return this.watchPoint??this.position;}
  /** A line over a player's head (falls, rescues, "Segura aí"), through the horde's balloon budget. */
  say(id:string,line:string){this.horde?.say(id,line);}
  setPaused(paused:boolean){this.paused=paused;if(paused){this.attackTarget=undefined;this.horde?.setTarget(undefined);}this.route=[];this.destination?.clear();this.hold.release();this.input.keyboard?.resetKeys();}
  /**
   * Focus lost on the desktop (controles-desktop): no pause, but nothing stays held: the keys Phaser saw down, and the
   * mouse button's follow (a walk already ordered by a click goes on to its marker, like a tap's).
   */
  releaseInput(){this.hold.release();this.input.keyboard?.resetKeys();}
  /** The player's zoom factor (camera-zoom.ts), clamped; eased on screen and saved by the shell. */
  setZoom(k:number){
    const next=clampZoom(k);if(next===this.zoomWant)return;
    this.zoomWant=next;this.hooks.zoomChanged?.(next);
  }
  get zoomFactor(){return this.zoomWant;}
  /** A pinch began over a tap: the walk the first finger started is dropped (the map was only being zoomed). */
  private cancelWalk(){
    this.route=[];this.destination?.clear();this.hold.release();this.markerUntil=undefined;
    // A first finger on an enemy targeted it; on the ground it said "Seguindo a trilha…": neither stands for a pinch.
    if(this.attackTarget){this.attackTarget=undefined;this.horde?.setTarget(undefined);}
    this.hooks.message('');
  }
  /** A walk to `target` (tap, click, "Seguir trilha"). markerMs: the marker shows that long (mouse), else to the end. */
  /** `far`: an order from the minimap (minimapa-wc3): past findPath's box, a far route (maps far-path.ts). */
  goTo(target:Point,options:{markerMs?:number;far?:boolean}={}){
    if(this.paused||!this.actor)return;
    this.attackTarget=undefined;
    this.route=findPath(this.position,target,this.field);
    if(!this.route.length&&options.far)this.route=farPath(this.position,target,this.field);
    this.destination.clear();
    if(!this.route.length){this.hooks.message('Por aqui não dá. Tente a trilha ou um trecho livre.');return;}
    this.hooks.message('Seguindo a trilha…');
    this.markerUntil=options.markerMs!==undefined?this.time.now+options.markerMs:undefined;
    this.drawDestination(target);
  }
  /**
   * Hold-to-follow, every frame while the mouse button that pressed the ground stays down: the ground point under the
   * cursor (it moves with the follow camera too) becomes the new walk at most every HOLD_RETARGET_MS, silently (no
   * "Seguindo a trilha…", no marker). Keys and the stick win over it, as over any route. Letting go shows the marker
   * at the last target for MARKER_MS.
   */
  private followHold(time:number,steering:boolean){
    if(!this.hold.held)return;
    const pointer=this.input.mousePointer??this.input.activePointer;
    if(this.paused||!pointer?.primaryDown){
      const last=this.hold.release();
      if(last&&!this.paused&&this.route.length){this.markerUntil=time+MARKER_MS;this.destination.clear();this.drawDestination(last);}
      return;
    }
    if(steering)return;
    const world=this.cameras.main.getWorldPoint(pointer.x,pointer.y);
    const next=this.hold.move(unprojectView(world,this.view,this.field),time);
    if(!next)return;
    // A point with no way there (water, a wall) keeps the walk already under way.
    const route=findPath(this.position,next,this.field);
    if(route.length){this.route=route;this.attackTarget=undefined;}
  }
  /** Keys held this frame (cursor keys and W,A,S,D) as the stick's screen vector (desktop-input.ts keyVector). */
  private keyAxis(){
    const c=this.cursors,k=this.keys;
    return keyVector({up:!!(c?.up.isDown||k?.W.isDown),down:!!(c?.down.isDown||k?.S.isDown),left:!!(c?.left.isDown||k?.A.isDown),right:!!(c?.right.isDown||k?.D.isDown)});
  }
  /** The destination marker at `target` (the imported art is drawn every frame by drawYou while it shows). */
  private drawDestination(target:Point){
    const p=this.project(target);
    this.goal=target;
    const breu=tokenColor('--c-breu'),papel=tokenColor('--c-papel'),css=1/Math.max(.05,this.cameras.main.zoom);
    if(this.artMarks?.destinationArt){
      // Drawn every frame by drawYou. City (contorno-breu): a Breu ring of 2 CSS px right outside the imported mark.
      if(this.cityMode){const r=destinationArtRim(this.actorScale,css);this.destination.lineStyle(r.breu,breu,1).strokeEllipse(p.x,p.y,r.width,r.height);}
      return;
    }
    // Papel mark with a Breu edge: readable on sand and on grass alike (double-edge rule, D-022); in the city the Breu
    // edges are 2 CSS px at any zoom (city-edge-rules.ts destinationMark).
    const m=destinationMark(this.actorScale,css,this.cityMode);
    this.destination.lineStyle(m.breu,breu,m.breuAlpha).strokeEllipse(p.x,p.y,m.width,m.height).lineStyle(m.papel,papel,1).strokeEllipse(p.x,p.y,m.width,m.height);
    this.destination.fillStyle(breu,m.breuAlpha).fillCircle(p.x,p.y,m.dotBreu).fillStyle(papel,1).fillCircle(p.x,p.y,m.dotPapel);
  }
  private place(){
    const p=this.project(this.position),depth=this.depth(this.position);
    // Canopies soften only when they cover the hero; feet still define scene depth.
    let covered=false;
    for(const prop of this.props){const hides=this.propCovers(prop,p,depth);covered||=hides&&!!prop.tree;prop.object.setAlpha(hides?.55:1);}
    // Above the horde, numbers, pops and balloons (UX B7) unless a canopy is in front: then the sprite keeps its world
    // depth behind the tree and an 85% copy shows on top (UX-voce-e-dano: never hidden behind a canopy).
    this.selfCovered=covered;
    // City: the hero stays at its actor depth (walls and buildings in front of it cover it, and turn translucent).
    this.actor.setPosition(p.x,p.y).setDepth(this.city?depth:covered?depth+1:SELF_DEPTH);
    this.shadow.setPosition(p.x,p.y).setDepth(depth-2);
    this.ring.setPosition(p.x,p.y).setDepth(depth-1);
  }
  /** Whether a prop drawn in front of the point `p` (screen) at `depth` covers a sprite standing there. */
  private propCovers(prop:{point:Point;tree?:TreeArt},p:Point,depth:number){
    const q=this.project(prop.point);
    return canopyCovers(p,{x:q.x,y:q.y,front:this.depth(prop.point)>depth,halfWidth:prop.tree?128*prop.tree.height/prop.tree.pixelHeight:58,height:prop.tree?.height??105});
  }
  private treeCovers(p:Point,depth:number){
    for(const prop of this.props)if(prop.tree&&this.propCovers(prop,p,depth))return true;
    return false;
  }
  /** Ring, bar, arrow and canopy copies, every frame (the arrow bobs). Allies' marks are pushed by updateCoop. */
  private drawYou(time:number){
    if(!this.you||!this.actor)return;
    const marker=this.route.length>0&&markerVisible(this.markerUntil,time);
    if(!marker&&this.markerUntil!==undefined)this.destination.clear();
    this.artMarks?.destination(marker?this.goal:undefined,this.actorScale,time,this.reduced,100000);
    const net=this.hooks.net,self=net?.players.get(net.id),state=net?.feed.players.get(net?.id??'');
    const p=this.project(this.position);
    // The ring's beak points where the hero last moved on screen.
    if(this.lastFeet)this.facing=facingFrom(p.x-this.lastFeet.x,p.y-this.lastFeet.y,this.facing);
    this.lastFeet=p;
    this.marks.unshift({id:'self',sprite:this.actor,self:true,feet:p,covered:this.selfCovered,facing:this.facing,
      hp:self?.hp??1,maxHp:state?.maxHp??(self?Math.max(self.hp,1):1),downed:!!state?.downed||(!!self&&self.hp<=0),
      slow:effectOn(state?.slowUntil,this.horde?.tick??0),slip:effectOn(state?.slipUntil,this.horde?.tick??0)});
    this.you.setCity(this.cityMode);
    this.you.update(time,this.cameras.main.zoom,this.marks);
    this.marks.length=0;
  }
  /** Economy mode (VGM-048): 30 fps and the reduced effects budget, or back to 60 and the full one. */
  setEconomy(on:boolean){
    this.economy=on;const profile=renderProfile(on);
    // A tap before the scene booted: create() applies it.
    if(!this.booted)return;
    this.horde?.setEffects(profile.effects);
    this.city?.setEconomy(on);
    this.applyGrade();
    if(this.stone)this.stone.economy=on;
    const towers=this.towers;if(towers)towers.economy=on; // their cast shadows (a renderer built later reads this.economy)
    // Phaser's frame gate (the game starts with fps.limit 60): changed live, the next frame already follows it.
    this.frameGate();
    this.fpsWatch.reset();
  }
  /**
   * Phaser's frame gate (the game starts with fps.limit 60), changed live: the economy profile, or one frame every
   * CATCH_UP_GATE_MS while the page is far behind the room (N27, slow phone: drawing is what keeps it behind).
   */
  private frameGate(){
    const loop=this.game.loop as unknown as {fpsLimit:number;hasFpsLimit:boolean;_limitRate:number},fps=renderProfile(this.economy).fps;
    loop.fpsLimit=fps;loop.hasFpsLimit=true;loop._limitRate=this.catchUp.on?CATCH_UP_GATE_MS:frameGateMs(fps);
  }
  private vignette?:Vignette;
  /** The vignette strength of the world shown (city, endless, island); economy mode hides it. */
  private applyGrade(){this.vignette?.set(isCityWorld(this.field)?'cidade':this.field.chunks?'infinito':'ilha',this.economy);}
  private readonly catchUp=new CatchUp();
  /** Catching up with the room (slow phone): the lab probe and the tests read it. */
  get catchingUp(){return this.catchUp.on;}
  get economyOn(){return this.economy;}
  /** Frames per second of the last whole watch windows (lab report and DEV probe). */
  get fpsHistory():readonly number[]{return this.fpsWatch.history;}
  private watchFrames(time:number){
    const net=this.hooks.net,last=this.lastFrameAt;this.lastFrameAt=time;
    if(net&&this.booted){
      const was=this.catchUp.on;
      if(this.catchUp.update(document.hidden?0:net.backlog.ms,time)!==was){this.frameGate();this.fpsWatch.taint();}
      if(this.catchUp.on){this.fpsWatch.taint();return;}
    }
    if(!net||this.economy||this.fpsWatch.done||last===undefined)return;
    if(document.hidden){this.fpsWatch.taint();return;}
    if(this.paused||net.run?.phase!=='combat'){this.fpsWatch.reset();return;}
    if(this.fpsWatch.frame(time-last))this.hooks.slow?.();
  }
  update(_time:number,delta:number){
    this.watchFrames(_time);
    // The room named the run's drawn enemies ({t:'elenco'}): their imported art loads now, before they show up.
    const elenco=this.hooks.net?.elenco;
    if(elenco&&elenco!==this.elenco){this.elenco=elenco;for(const id of elenco)queueEnemyArt(this,id);}
    this.vignette?.update();
    this.landscape?.update(_time,this.reduced||this.paused||document.hidden);
    if(!this.actor)return;
    this.artMarks?.begin();
    // The net's terrain became another world (island/endless ↔ city): one field swap, new zoom, figure scale and camera.
    // A reconnect to the same map (a new but identical TerrainField) changes nothing.
    if(this.terrainWatch.sync(this.hooks.net?.terrain))this.swapWorld();
    this.drawLabels();
    const self=this.hooks.net?.players.get(this.hooks.net.id);
    this.sprites.animate(this.actor,this.hooks.classId,this.position.x,this.position.y,self?.attackTick??0,self?.hp!==0,this.view,this.intent);
    this.hooks.visual?.(this.actor.anims.currentAnim?.key??'fallback',String(this.actor.frame.name),this.textures.getTextureKeys().filter(k=>k.startsWith('sprite:')).length);
    // City: re-base only before actors are placed (the origin may trail the hero by a frame, harmless), so nobody is
    // drawn for a frame with the old origin across the buildings. Elsewhere the order is unchanged.
    if(this.hooks.net){
      if(this.city){this.rebaseDepth();this.updateCoop(_time,delta);}else{this.updateCoop(_time,delta);this.rebaseDepth();}
      this.updateCamera(delta);this.shakeCamera();this.drawYou(_time);return;
    }
    if(this.paused){this.followHold(_time,false);this.updateCamera(delta);this.drawYou(_time);return;}
    const axis=this.hooks.direction(),keys=this.keyAxis();
    const sx=axis.x+keys.sx,sy=axis.y+keys.sy;
    this.followHold(_time,Math.hypot(sx,sy)>.05);
    const old=this.position,seconds=Math.min(delta/1000,.1);
    if(Math.hypot(sx,sy)>.05){this.route=[];this.destination.clear();this.intent=screenDirection(sx,sy,this.view);this.position=moveDirection(old,this.intent,seconds,this.field);}
    else{this.position=moveAlong(old,this.route,seconds,this.field);this.intent={x:this.position.x-old.x,y:this.position.y-old.y};}
    const moved=Math.hypot(this.position.x-old.x,this.position.y-old.y);
    this.distance+=moved;
    if(moved>0)this.place();
    if(!this.route.length)this.destination.clear();
    for(let i=0;i<landmarks.length;i++)if(!this.discovered.has(i)&&Math.hypot(this.position.x-landmarks[i].x,this.position.y-landmarks[i].y)<1.15){this.discovered.add(i);this.hooks.discovered(i);}
    this.stamp+=delta;
    if(this.stamp>100){this.stamp=0;this.hooks.position(this.position);}
    // After the move, so the ring and the camera are never a frame behind the hero.
    this.rebaseDepth();this.updateCamera(delta);
    this.drawYou(_time);
  }
  /** True while the scene draws defenses: the renderer exists and the latest snapshot had at least one (HUD hint). */
  towersInWorld():boolean{return !!this.towers&&this.towerFeed.count>0;}
  /**
   * The defenses' renderer, built on the first snapshot with a defense: crater decals just over the ground's shadows,
   * every effect at its own point's actor depth (under the blackout like the actors), re-sorted when the city's chunks
   * change (columnsVersion).
   */
  private makeTowers(){
    return this.towers=new TowerRenderer(this,{reduced:this.reduced,groundDepth:TOWER_GROUND_DEPTH,actorScale:()=>this.actorScale,economy:this.economy,
      depthVersion:()=>this.city?.columnsVersion??0,
      world:{view:()=>this.view,depth:(x,y)=>this.depth({x,y}),effectDepth:(x,y)=>this.city?this.city.effectDepth(x,y):this.depth({x,y}),
        project:(x,y,z,out)=>{const p=this.project({x,y});out.x=p.x;out.y=p.y-z*HEIGHT_PX;return out;}}});
  }
  /**
   * D-047: a new snapshot for the chaveiro objective (RunView.objective). The renderer is built on the first view that
   * has one, on the scene's projector (the city's actor depth), and fades a figure that covers the hero.
   */
  private pushChaveiro(view:RunView){
    const objective=objectiveOf(view);
    if(!objective&&!this.chaveiro)return;
    if(!this.chaveiro&&this.projector)this.chaveiro=new ChaveiroRenderer(this,{projector:this.projector,reduced:this.reduced,hero:()=>this.watchPoint??this.position});
    this.chaveiro?.push(objective,view.tick);
  }
  /** A new snapshot for the defenses: their views (TowerFeed: inferred volleys) and the live enemies they aim at. */
  private pushTowers(view:RunView,time:number){
    if(!this.towers&&!hasTowers(view.structures))return; // no defense yet: nothing built, nothing walked
    const towers=this.towers??this.makeTowers();
    const plan=this.buildPlan??=buildPlanFor(this.field);
    const enemies=view.enemies;let a=this.towerAim;
    if(a.xs.length<enemies.length){const n=Math.max(enemies.length,a.xs.length*2);a=this.towerAim={n:0,xs:new Float32Array(n),ys:new Float32Array(n),air:new Uint8Array(n)};}
    let n=0;
    for(const e of enemies){
      if(e.hp<=0)continue;
      a.xs[n]=e.x;a.ys[n]=e.y;a.air[n]=ENEMY_ART[enemyKind(e.kind)].hover>0?1:0;n++;
    }
    a.n=n;towers.setEnemies(n,a.xs,a.ys,a.air);
    towers.push(view.tick,this.towerFeed.views(view.structures,view.tick,plan.cell,{railAxis:plan.rail?.axis,enemies:a}),time);
  }
  /**
   * Every frame: the defenses turn, fire and fade over the figures, like the city layer: the hero, or while spectating
   * the watched figure, and the allies (their feet at the ground's height). Reuses its figure objects.
   */
  private updateTowers(time:number,delta:number){
    const towers=this.towers;if(!towers)return;
    const figures=this.towerFigures,allies=this.allyFeet,n=1+allies.length;
    while(figures.length<n)figures.push({x:0,y:0,z:0});
    figures.length=n;
    const set=(f:{x:number;y:number;z:number},p:Point)=>{f.x=p.x;f.y=p.y;f.z=elevation(p.x,p.y,this.field)/HEIGHT_PX;};
    set(figures[0],this.watchPoint??this.position);
    for(let i=0;i<allies.length;i++)set(figures[i+1],allies[i]);
    towers.update(time,delta,figures);
  }
  /** A heavy impact shakes the screen (none with reduced motion): added after the camera's own centring. */
  private shakeCamera(){
    const towers=this.towers;if(!towers)return;
    const cam=this.cameras.main,o=towers.shakeOffset(cam.zoom,this.shakeAt);
    if(o.x||o.y){cam.scrollX+=o.x;cam.scrollY+=o.y;}
  }
  /** Live enemy under a tap (world point), nearest first; the radius never drops below ENEMY_TAP_RADIUS_PX on screen. */
  private enemyAt(p:Point){
    const feed=this.hooks.net?.feed;if(!feed)return undefined;
    const floor=ENEMY_TAP_RADIUS_PX/Math.max(.05,this.cameras.main.zoom);
    let best:string|undefined,bestDistance=Infinity;
    for(const enemy of feed.enemies.values()){
      if(enemy.hp<=0)continue;
      const kind=enemyKind(enemy.kind),art=ENEMY_ART[kind],size=(enemy.elite&&kind!=='chefe'?ELITE_SCALE:1)*this.actorScale*ENEMY_DRAW_SCALE,q=this.project(enemy);
      const cy=q.y-(art.hover+art.height*art.originY*.5)*size,distance=Math.hypot(p.x-q.x,p.y-cy);
      if(distance<=Math.max(floor,art.width*size*.6)&&distance<bestDistance){best=enemy.id;bestDistance=distance;}
    }
    return best;
  }
  private icons=new Map<string,string>();
  /**
   * Sticker of the critter `id` (a legacy kind or any roster id) for the HUD ("what got you", the kill-cam portrait), as
   * a URL or a data URL, cached per id: its own imported art (art/hud-art.ts: the ui icon, else its sheet's still frame,
   * by its own id: a roster id never borrows its base kind's art), else the procedural texture the horde draws for it.
   */
  critterIcon(id:string){
    // "bichos" (unknown hitter) has no sticker: enemyTexture would fall back to the bêbado and name the wrong critter.
    const kind=drawnKind(id);
    if(!kind)return undefined;
    let url=this.icons.get(id);
    if(url===undefined){
      const art=critterIconSource(id),loaded=art&&!('url' in art)&&this.textures.exists(art.key)?art:undefined,key=enemyTexture(id);
      url=art&&'url' in art?art.url:loaded?this.textures.getBase64(loaded.key,loaded.frame):this.textures.exists(key)?this.textures.getBase64(key):'';
      // Its own sheet still loading (queued per match): today's texture for now, the art once it is in.
      if(url&&(!art||'url' in art||loaded))this.icons.set(id,url);
    }
    return url||undefined;
  }
  /**
   * Blackout audit (VGM-053B): every layer that must stay visible in the dark against the dark's depth. Empty
   * `failures` = nothing dangerous and no hero hidden. Read by the acceptance script during a real blackout.
   */
  blackoutAudit(){
    if(!this.actor)return {dark:0,darkDepth:0,layers:[],failures:['scene not ready']};
    const dark=this.zueira?.blackoutDepth()??0,layers:{name:string;depth:number;visible?:boolean}[]=[...(this.horde?.blackoutLayers()??[])];
    const self=this.selfCovered?(this.you as unknown as {ghosts:Map<string,Phaser.GameObjects.Sprite>}|undefined)?.ghosts.get('self'):this.actor;
    layers.push({name:'hero',depth:this.selfCovered?SELF_DEPTH:this.actor.depth,visible:self?.visible??true},{name:'hero marks',depth:MARK_DEPTH});
    // An ally behind a canopy keeps its world depth; what shows is its 85% copy over the canopy (YouMarkers), at ALLY_DEPTH.
    const ghosts=(this.you as unknown as {ghosts:Map<string,Phaser.GameObjects.Sprite>}|undefined)?.ghosts;
    for(const [id,a] of this.remoteActors){
      const st=this.hooks.net?.feed.players.get(id);if(!st?.downed||st.eliminated)continue;
      const ghost=ghosts?.get(id),shown=ghost?.visible&&ghost.depth>a.image.depth?ghost:a.image;
      layers.push({name:`caído ${id}${shown===ghost?' (cópia sobre a copa)':''}`,depth:shown.depth},{name:`ficha ${id}`,depth:ALLY_DEPTH+1});
    }
    if(this.downedMarks.length&&this.downedLayer){const d=this.downedLayer.depths();layers.push({name:'resgate (anel)',depth:d.ring},{name:'resgate (coluna)',depth:d.column});}
    return {dark:this.zueira?.last.dark??0,darkDepth:dark,layers,failures:(this.zueira?.last.dark??0)>0?auditBlackout(layers,dark):[]};
  }
  /** Zueira FX state (dev probe). */
  zueiraState(){return this.zueira?{...this.zueira.last}:undefined;}
  /** The hero's sprite on screen (CSS px), so HUD banners can stay out of its way. */
  heroScreenRect(){
    if(!this.actor)return undefined;
    // Out or watching: the HUD keeps clear of the teammate the camera follows, not of one's own body far away.
    const watched=this.watchPoint&&this.watchId?this.remoteActors.get(this.watchId):undefined;
    const classId=watched?this.hooks.net?.players.get(this.watchId!)?.classId:this.hooks.classId;
    const cam=this.cameras.main,b=this.figureWorldBox(watched?.image??this.actor,classId??this.hooks.classId);
    return {x:(b.x-cam.worldView.x)*cam.zoom,y:(b.y-cam.worldView.y)*cam.zoom,width:b.width*cam.zoom,height:b.height*cam.zoom};
  }
  /** The hero's drawn figure in world px (all its animation frames together); the whole frame until the sheet loads. */
  private heroWorldBox(){return this.figureWorldBox(this.actor,this.hooks.classId);}
  private figureWorldBox(a:Phaser.GameObjects.Sprite,classId:string){
    const f=a.texture.key.startsWith('sprite:')?this.sprites.figureIn(a,classId):undefined;
    if(!f)return a.getBounds();
    const sx=Math.abs(a.scaleX),sy=Math.abs(a.scaleY),w=a.frame.width,h=a.frame.height,ox=a.originX*w,oy=a.originY*h;
    const left=a.flipX?w-f.right:f.left,right=a.flipX?w-f.left:f.right;
    return {x:a.x+(left-ox)*sx,y:a.y+(f.top-oy)*sy,width:(right-left)*sx,height:(f.bottom-f.top)*sy};
  }
  /** Screen px of one world unit around `at` (the larger of the two axes), for the correction's per-frame cap. */
  private unitPx(at:Point){
    const o=this.project(at),ex=this.project({x:at.x+1,y:at.y}),ey=this.project({x:at.x,y:at.y+1}),zoom=this.cameras.main.zoom;
    return Math.max(Math.hypot(ex.x-o.x,ex.y-o.y),Math.hypot(ey.x-o.x,ey.y-o.y))*zoom;
  }
  private updateCoop(time:number,delta:number){
    const net=this.hooks.net!;
    const phase=net.run?.phase;
    if(phase==='combat'&&this.lastPhase!=='combat')this.you?.showArrow(time);
    this.lastPhase=phase;
    const axis=this.paused?{x:0,y:0}:this.hooks.direction(),keys=this.paused?{sx:0,sy:0}:this.keyAxis();
    const sx=axis.x+keys.sx,sy=axis.y+keys.sy;
    const still=this.paused||!net.connected||!net.players.get(net.id)?.hp||net.run?.phase!=='combat'||!!net.players.get(net.id)?.spectator;
    // No walk to follow while the hero cannot walk (no path search every 150 ms in the waiting room or while down).
    this.followHold(time,still||Math.hypot(sx,sy)>.05);
    if(still){this.attackTarget=undefined;this.route=[];}
    if(this.attackTarget&&!net.feed.enemies.has(this.attackTarget)){this.attackTarget=undefined;this.hooks.message('Alvo derrotado. A arma segue atirando sozinha.');}
    this.horde?.setTarget(this.attackTarget);
    // Only a new tick moves the horde: an offers-only change (push from the room) refreshes the HUD alone,
    // or the renderer would restart its interpolation and stutter on every offer.
    if(net.feed.stateVersion!==this.stateVersion){
      this.stateVersion=net.feed.stateVersion;this.offersVersion=net.feed.offersVersion;
      const runView=net.feed.take();
      this.roundPhase=runView.round?.phase;this.viewTick=runView.tick;
      // The match is on (a round in the room's run view, drawn by this scene): the production smoke (scripts/smoke-prod.mjs)
      // waits for this flag, not for a HUD element that a HUD card may move or hide.
      if(runView.round&&runView.tick>0&&!matchSignalled){matchSignalled=true;(window as unknown as {__partidaPronta?:boolean}).__partidaPronta=true;}
      if(arrowTrigger(runView.events,net.id))this.you?.showArrow(time);
      this.horde?.push(runView);this.stone?.push(runView);this.zueira?.push(runView);this.pushTowers(runView,time);this.pushChaveiro(runView);
      this.hooks.runView?.(runView);
    }else if(net.feed.offersVersion!==this.offersVersion){
      this.offersVersion=net.feed.offersVersion;
      const runView=net.feed.peek();this.roundPhase=runView.round?.phase;
      this.hooks.runView?.(runView);
    }
    this.zueira?.update(time);this.horde?.update(time,delta);this.stone?.update(time);this.chaveiro?.update(time);this.updateTowers(time,delta);
    this.accumulator=Math.min(this.accumulator+delta/1000,.2);
    this.steps.sync(net.predicted);
    while(this.accumulator>=STEP){
      let direction={x:0,y:0};
      if(Math.hypot(sx,sy)>.05){this.route=[];direction=screenDirection(sx,sy,this.view);}
      if(!this.paused&&Math.hypot(sx,sy)<=.05&&this.route.length){
        while(this.route.length&&Math.hypot(this.route[0].x-net.predicted.x,this.route[0].y-net.predicted.y)<.18)this.route.shift();
        if(this.route.length)direction={x:this.route[0].x-net.predicted.x,y:this.route[0].y-net.predicted.y};
      }
      this.intent=net.players.get(net.id)?.hp&&net.run?.phase==='combat'?direction:{x:0,y:0};
      net.input(direction,!this.paused&&!!this.hooks.attacking?.(),this.attackTarget);this.accumulator-=STEP;
      this.steps.push(net.predicted);
    }
    // Between the last two predicted steps at the accumulator's fraction: moves every frame, never in 50 ms stairs.
    const smooth=this.steps.at(this.accumulator/STEP);
    const view=net.view(),old=this.position;
    const effects=this.skillEffects??=this.add.graphics().setDepth(90000).setName('efeitos');effects.clear();
    for(const player of view.players){
      const age=net.tick-(player.skillTick??0);
      if(!player.skillTick||age<0||age>=10||net.run?.phase!=='combat')continue;
      const radius=SKILL_RANGE*(this.reduced?1:.3+.7*age/10);
      if(this.artMarks?.skillRing(player.id,player.x,player.y,radius,3*this.actorScale,1-age/10,time,this.reduced,90000))continue;
      const points=Array.from({length:25},(_,i)=>this.project({x:player.x+Math.cos(i*Math.PI/12)*radius,y:player.y+Math.sin(i*Math.PI/12)*radius}));
      effects.lineStyle(3*this.actorScale,0xffde88,1-age/10).strokePoints(points,true);
    }
    // The reconcile error fades at most CORRECTION_MAX_PX per frame on screen (one world unit's px at this zoom).
    const unitPx=this.unitPx(smooth);this.correction.step(delta,unitPx);
    this.displayed={x:smooth.x+this.correction.x,y:smooth.y+this.correction.y};
    this.position={...this.displayed};this.distance+=Math.hypot(old.x-this.position.x,old.y-this.position.y);this.place();
    const mine=net.feed.players.get(net.id),selfDown=!!mine?.downed&&!mine.eliminated;
    // A caído lies down (UX-resgate-e-ping): turned on its feet, still opaque enough to be found; out/watching fades.
    this.actor.setAlpha(selfDown?.85:!net.players.get(net.id)?.spectator&&(net.players.get(net.id)?.hp??100)>0?1:.4).setAngle(selfDown?-90:0);
    const marks=this.downedMarks;marks.length=0;
    if(selfDown)marks.push({id:net.id,at:this.position,progress:mine!.downed!.progress});
    const ids=new Set(view.players.filter(p=>p.id!==net.id).map(p=>p.id));
    for(const [id,objects] of this.remoteActors)if(!ids.has(id)){objects.image.destroy();objects.label.destroy();objects.ring.destroy();objects.shadow?.destroy();this.remoteActors.delete(id);this.you?.forget(id);this.allyRings?.forget(id);}
    // Waiting room (D-025, UX review): six standing on the spawn turn their name fichas into one blot; each ficha that
    // would land on an earlier one steps one row down, so the names read as a short list under the group.
    const stagger=this.labelPhase()!=='combat'&&this.labelPhase()!=='interval',placedLabels:Point[]=[],zoomNow=this.cameras.main.zoom,city=this.cityMode;
    this.allyFeet=[];
    for(const player of view.players){
      if(player.id===net.id)continue;
      if(city&&player.online&&!player.spectator)this.allyFeet.push({x:player.x,y:player.y});
      // Ally ground ring in Breu: the old light cyan one vanished on sand and shallow water (D-022).
      let objects=this.remoteActors.get(player.id);
      const k=this.heroScale;
      if(!objects){objects={image:sunlit(this.add.sprite(0,0,this.classIcon(player.classId)).setOrigin(.5,.88).setDisplaySize(100*k,100*k)),label:new MapLabel(this,''),ring:this.add.ellipse(0,0,ALLY_RING_SIZE.width,ALLY_RING_SIZE.height).setStrokeStyle(2,tokenColor('--c-breu'),.8).setScale(k)};this.remoteActors.set(player.id,objects);}
      // Joined before its icon was here (N27: icons of the room's classes only): the icon replaces the silhouette once in.
      else if(objects.image.texture.key===STAND_IN_KEY&&this.textures.exists(`class:${player.classId}`))objects.image.setTexture(`class:${player.classId}`).setDisplaySize(100*k,100*k);
      this.sprites.animate(objects.image,player.classId,player.x,player.y,player.attackTick??0,player.hp>0&&player.online,this.view);
      const q=this.project(player),depth=this.depth(player),covered=this.treeCovers(q,depth);
      const st=net.feed.players.get(player.id),down=!!st?.downed&&!st.eliminated;
      objects.image.setPosition(q.x,q.y).setDepth(this.city?depth:covered?depth+1:ALLY_DEPTH).setAlpha(down?.85:!player.spectator&&player.online&&player.hp?1:.4).setAngle(down?-90:0);
      if(down)marks.push({id:player.id,at:{x:player.x,y:player.y},progress:st!.downed!.progress});
      objects.ring.setPosition(q.x,q.y).setDepth(depth-1);
      // City: a contact shadow under each ally too, the same as the hero's (Breu 38%); none elsewhere (main).
      if(city){
        const look=heroShadow(true);
        objects.shadow??=this.add.ellipse(0,0,HERO_SHADOW_SIZE.width,HERO_SHADOW_SIZE.height,look.color,look.alpha);
        objects.shadow.setScale(k).setPosition(q.x,q.y).setDepth(depth-2);
      }else if(objects.shadow){objects.shadow.destroy();objects.shadow=undefined;}
      // Imported ring (the "Você" ring tinted Breu) at today's outer width and depth: the ellipse hides while it draws.
      if(this.allyRings?.draw(player.id,q.x,q.y,ALLY_RING_WIDTH*k,depth-1,time,this.reduced))objects.ring.setVisible(false);
      else if(!objects.ring.visible)objects.ring.setVisible(true);
      if(covered)this.marks.push({id:player.id,sprite:objects.image,self:false,feet:q,covered,hp:player.hp,maxHp:player.hp,downed:false});
      const state=net.feed.players.get(player.id),downed=!!state?.downed&&!state.eliminated;
      // Ally fichas at 13 px CSS: names in the waiting room, and in a run only who is caído, as an SOS ficha (onda 4).
      objects.label.setSos(downed).setCity(city).setText(allyLabelText(player.name,{spectator:player.spectator,eliminated:state?.eliminated,downed,online:player.online},downed&&state?.downed?secondsLeft(state.downed.bleedOutTick,this.viewTick):undefined))
        .anchor(q.x,stagger?this.staggerLabel(placedLabels,q.x,q.y+15*k,zoomNow):q.y+15*k,covered?depth+2:ALLY_DEPTH+1).draw(this.cameras.main.zoom,mapLabelVisible('ally',this.labelPhase(),downed));
    }
    // In the blackout the caídos' rings and light columns go above the dark (VGM-053B).
    this.downedLayer?.update(marks,this.view,1/Math.max(.05,this.cameras.main.zoom),(this.zueira?.last.dark??0)>0?LIFTED_DEPTH:undefined);
    // Own caído ficha: same SOS ficha as an ally's, with "Você" and the seconds left.
    if(selfDown||this.selfLabel){
      const label=this.selfLabel??=new MapLabel(this,'');const q=this.project(this.position);
      label.setSos(selfDown).setCity(this.cityMode).setText(allyLabelText('Você',{downed:selfDown},selfDown?secondsLeft(mine!.downed!.bleedOutTick,this.viewTick):undefined))
        .anchor(q.x,q.y+15*this.heroScale,SELF_DEPTH+1).draw(this.cameras.main.zoom,selfDown);
    }
    this.updateWatch(view.players);
    if(!this.route.length)this.destination.clear();
    this.stamp+=delta;if(this.stamp>100){this.stamp=0;this.hooks.position(this.position);}
  }
  /** Out (eliminated) or watching mid-run: follow a teammate instead of one's own body (UX onda 4). */
  private updateWatch(players:readonly {id:string;x:number;y:number;hp:number;online:boolean;spectator?:boolean}[]){
    const net=this.hooks.net!,me=net.players.get(net.id),mine=net.feed.players.get(net.id);
    const out=net.run?.phase==='combat'&&(!!mine?.eliminated||!!me?.spectator);
    if(!out){this.watchId=undefined;this.watchPinned=false;this.watchPoint=undefined;return;}
    const list:Watchable[]=players.filter(p=>p.id!==net.id).map(p=>{const st=net.feed.players.get(p.id);
      return {id:p.id,x:p.x,y:p.y,standing:p.online&&!p.spectator&&!st?.eliminated&&!st?.downed&&p.hp>0,inRun:!p.spectator&&!st?.eliminated};});
    // A teammate picked by a tap stays while still in the run (even downed: watching the rescue); else the nearest standing.
    const pinned=this.watchPinned?list.find(p=>p.id===this.watchId&&p.inRun):undefined;
    const id=pinned?.id??chooseWatched(list,this.watchPoint??this.position,this.watchId);
    if(id!==this.watchId)this.watchPinned=false;
    this.watchId=id;
    const w=list.find(p=>p.id===id);if(w)this.watchPoint={x:w.x,y:w.y};
    // Nobody left: the camera stays where it last was until the result.
    else this.watchPoint??={...this.position};
  }
  /** Tap on a team portrait while out: follow that teammate. False when not watching or not a teammate in the run. */
  watch(id:string){
    const net=this.hooks.net;if(!net||!this.watchPoint||id===net.id)return false;
    const p=net.players.get(id),st=net.feed.players.get(id);
    if(!p||p.spectator||st?.eliminated)return false;
    this.watchId=id;this.watchPinned=true;return true;
  }
  /** Who the camera follows while out or watching (for the HUD's "Assistindo: Tia"). */
  watching(){const id=this.watchId,p=id?this.hooks.net?.players.get(id):undefined;return p?{id:p.id,name:p.name}:undefined;}
  /** Map labels as fichas at 13 px CSS; place names leave the screen during a round (DSG-cenario-coerencia). */
  private drawLabels(){
    const zoom=this.cameras.main.zoom,phase=this.labelPhase(),sos=this.sosScreens;
    // Place fichas near a caído ficha step aside (last frame's positions), so who fell stands out.
    sos.length=0;for(const a of this.remoteActors.values())if(a.label.screen.sos)sos.push(a.label.screen);
    for(const sign of this.signs){const show=mapLabelVisible('place',phase);sign.label.draw(zoom,show&&!(sos.length&&placeYieldsToSos(sign.label.screen,sos)));}
  }
  /** 'combat' only while a wave runs: the interval between waves counts as a pause for the labels. */
  /** The first free row for a name ficha at (x, y) (world px): 110 × 17 CSS px per ficha, one row down per clash. */
  private staggerLabel(placed:Point[],x:number,y:number,zoom:number){
    const w=110/zoom,h=17/zoom;let at=y;
    for(let i=0;i<6&&placed.some(p=>Math.abs(p.x-x)<w&&Math.abs(p.y-at)<h);i++)at+=h;
    placed.push({x,y:at});return at;
  }
  private labelPhase(){const phase=this.hooks.net?.run?.phase;return phase==='combat'&&this.roundPhase==='prepare'?'interval':phase;}
  private drawTreeShadows(){
    const g=this.treeShadows??=this.add.graphics().setDepth(-9990).setName('sombras-arvores');g.clear();
    for(const prop of this.props){
      if(!prop.tree)continue;
      const radius=Math.max(.16,Math.min(.48,prop.tree.height/500));
      // Project each point onto actual terrain, including slopes and camera rotation.
      for(const [size,alpha] of [[1,.12],[.62,.2]]){
        const points=Array.from({length:16},(_,i)=>{
          const angle=i*Math.PI/8;
          return this.project({x:prop.point.x+Math.cos(angle)*radius*size,y:prop.point.y+Math.sin(angle)*radius*size});
        });
        polygon(g,points,0x213d26,alpha);
      }
    }
  }
  /**
   * The island or endless ground for this.field; none in the city yet (buildWorld). The renderers free themselves on
   * the scene's shutdown: those handlers are kept so a world swap can run them early (and not again at shutdown).
   */
  private drawGround(){
    if(isCityWorld(this.field)){
      // The city render (cidade-03): torn down by clearWorld (a map switch) or with the scene.
      if(!(this.field instanceof CityTerrain))return;
      const art=this.cityArt();
      const city=this.city=new CityLayer(this,cityRenderAsset(this.field.asset),{depthOf:this.cityDepthOf,art});
      city.setActorScale(this.actorScale);
      city.setEconomy(this.economy);
      // A map switch into the city: its sheets arrive after the first chunks, which are rebuilt with them.
      if(queueCityArt(this,art)){
        this.load.once(Phaser.Loader.Events.COMPLETE,()=>{if(this.city===city)city.refresh();});
        if(!this.load.isLoading())this.load.start();
      }
      const drop=()=>{city.destroy();if(this.city===city)this.city=undefined;this.events.off('shutdown',drop);this.events.off('destroy',drop);};
      this.events.once('shutdown',drop);this.events.once('destroy',drop);
      this.dropGround=drop;
      return;
    }
    const events=this.events,before=new Set(events.listeners('shutdown'));
    this.landscape=createTerrain(this,this.field);this.landscape.view(this.view);
    const teardown=events.listeners('shutdown').filter(fn=>!before.has(fn)) as (()=>void)[];
    this.dropGround=()=>{for(const fn of teardown){events.off('shutdown',fn);fn();}};
  }
  /**
   * A tree as its sheet (one frame per view) when loaded. Island: else the vector sketch. Endless world: else only its
   * shadow on the ground until the sheet arrives (design onda 6 D1: a sketch read as "failed to load"), then the tree
   * fades in. Rocks are always drawn as vectors.
   */
  private makeProp(o:Obstacle,tree?:TreeArt,fade=false):Prop{
    const p=this.project(o);
    if(tree&&this.textures.exists(`tree:${tree.id}`)){
      const image=this.add.image(p.x,p.y,`tree:${tree.id}`,this.view).setOrigin(.5,353/384).setScale(tree.height/tree.pixelHeight).setDepth(this.depth(o));
      image.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
      if(fade&&!this.reduced){image.setAlpha(0);this.tweens.add({targets:image,alpha:1,duration:TREE_FADE_MS});}
      return {point:o,object:image,tree,art:tree.id};
    }
    const g=this.add.graphics({x:p.x,y:p.y});g.setDepth(this.depth(o));
    if(tree&&this.field.chunks)g.fillStyle(tokenColor('--c-breu'),.22).fillEllipse(4,2,Math.min(120,tree.height*.55),Math.min(44,tree.height*.2));
    else this.drawProp(g,o);
    return {point:o,object:g,art:tree?.id};
  }
  private cityArtPlan?:CityArtPlan;
  /** The city's imported art plan (once: the manifest is loaded at boot); `?arte=0` / `?altura=a|b` for comparisons. */
  private cityArt():CityArtPlan{
    // Lots on the asset's cell (1.496 u on the 1.7× city, cidade-escala-1-7): the buildings grow with the map.
    const cell=this.field instanceof CityTerrain?this.field.asset.unitsPerCell:undefined;
    return this.cityArtPlan??=buildCityArtPlan(artIndex(),{...cityArtOptions(typeof location==='undefined'?'':location.search),...(cell?{cell}:{})});
  }
  private loadTree(id:string){
    if(this.textures.exists(`tree:${id}`))return;
    this.treeLater.delete(id);
    this.load.spritesheet(`tree:${id}`,treeUrl(id),{frameWidth:256,frameHeight:384});
  }
  /** Endless world: the sheets of the trees around the spawn, loaded with the scene (no sketch on the first frame). */
  private spawnTrees(){
    const chunks=this.field.chunks;if(!chunks)return [];
    const spawn=worldSpawn(this.field);
    return chunks.obstaclesNear(spawn.x,spawn.y,TREE_PRELOAD_UNITS).map(o=>o.art?TREES.get(o.art):undefined);
  }
  /**
   * Endless world: builds the props and place fichas of the chunks that may show on screen (tiles.ts propChunks) and
   * drops the ones a chunk beyond them (no churn at a border). Cheap when nothing changes: a few comparisons.
   */
  private syncProps(){
    const chunks=this.field.chunks;if(!chunks)return;
    const cam=this.cameras.main,w=cam.width/cam.zoom,h=cam.height/cam.zoom;
    const v={x:cam.scrollX+(cam.width-w)/2,y:cam.scrollY+(cam.height-h)/2,w,h};
    const want=propChunks(v,this.view),keep=propChunks(v,this.view,1),ahead=propChunks(v,this.view,2);
    let changed=false;
    for(const [key,entry] of this.chunkProps){
      if(entry.cx>=keep.ix0&&entry.cx<=keep.ix1&&entry.cy>=keep.iy0&&entry.cy<=keep.iy1)continue;
      for(const prop of entry.props){prop.object.destroy();if(prop.art)this.useTree(prop.art,-1);}
      for(const sign of entry.signs){sign.graphic.destroy();sign.label.destroy();}
      this.chunkProps.delete(key);changed=true;
    }
    let loads=false;
    for(let cy=want.iy0;cy<=want.iy1;cy++)for(let cx=want.ix0;cx<=want.ix1;cx++){
      const key=`${cx},${cy}`;if(this.chunkProps.has(key))continue;
      const c=chunks.chunk(cx,cy),props:Prop[]=[],signs:Sign[]=[];
      for(const o of c.obstacles){
        const tree=o.art?TREES.get(o.art):undefined;
        if(tree){this.useTree(tree.id,1);if(!this.textures.exists(`tree:${tree.id}`)){this.loadTree(tree.id);loads=true;}}
        props.push(this.makeProp(o,tree));
      }
      for(const p of c.pois){const index=Math.max(0,landmarks.findIndex(l=>l.name===p.name));signs.push(this.drawLandmark(p,index,infinitoPoiName(index,cx,cy,this.field.seed)));}
      this.chunkProps.set(key,{cx,cy,props,signs});changed=true;
    }
    // Sheets of the next ring of chunks load before their trees can show (fewer shadows waiting on screen), but in the
    // background (N27): one at a time when nothing else loads, in combat (pumpTrees). On 4G the whole ring is ~30
    // sheets; they used to go with the visible trees and the teammates' sheets, and those waited ~15 s behind them.
    if(changed){
      this.treeLater.clear();
      for(let cy=ahead.iy0;cy<=ahead.iy1;cy++)for(let cx=ahead.ix0;cx<=ahead.ix1;cx++){
        if(cx>=want.ix0&&cx<=want.ix1&&cy>=want.iy0&&cy<=want.iy1)continue;
        for(const o of chunks.chunk(cx,cy).obstacles)if(o.art&&!this.textures.exists(`tree:${o.art}`)&&TREES.has(o.art))this.treeLater.add(o.art);
      }
    }
    if(loads&&!this.load.isLoading())this.load.start();
    if(!changed)return;
    this.props=[...this.chunkProps.values()].flatMap(e=>e.props);this.propsVersion++;
    this.signs=[...this.chunkProps.values()].flatMap(e=>e.signs);
    this.drawTreeShadows();this.dropIdleTrees();
  }
  /**
   * Endless world, in combat (or solo): one sheet of the ring beyond the screen when the loader is idle, while the unused sheets
   * kept fit TREE_TEXTURES_IDLE (more would be dropped at once and fetched again: the old churn). In the lobby the
   * team stands at the spawn: nothing beyond the screen, so the first entry in combat stays light.
   */
  private pumpTrees(){
    if(!this.treeLater.size||this.load.isLoading()||(this.hooks.net&&this.hooks.net.run?.phase!=='combat')||this.treeIdle.size>=TREE_TEXTURES_IDLE)return;
    for(const id of this.treeLater){
      this.treeLater.delete(id);
      if(this.textures.exists(`tree:${id}`))continue;
      this.loadTree(id);this.load.start();return;
    }
  }
  private useTree(id:string,delta:number){
    const n=(this.treeUse.get(id)??0)+delta;
    if(n>0){this.treeUse.set(id,n);this.treeIdle.delete(id);}
    else{this.treeUse.delete(id);if(this.textures.exists(`tree:${id}`)){this.treeIdle.delete(id);this.treeIdle.add(id);}}
  }
  /** Keeps at most TREE_TEXTURES_IDLE unused tree sheets (least recently used go): memory stays flat on a long walk. */
  private dropIdleTrees(){
    for(const id of this.treeIdle){
      if(this.treeIdle.size<=TREE_TEXTURES_IDLE)break;
      this.treeIdle.delete(id);if(!this.treeUse.has(id))this.textures.remove(`tree:${id}`);
    }
  }
  /** A tree sheet arrived: the sketches of that tree around turn into it. */
  private treeLoaded(id:string){
    const tree=TREES.get(id);if(!tree)return;
    // Island (create() preloads its sheets; after a map switch they arrive later): its sketches of this art turn into it.
    if(!this.field.chunks){
      let changed=false;
      this.props.forEach((prop,i)=>{
        if(prop.tree||prop.art!==id)return;
        prop.object.destroy();this.props[i]=this.makeProp(prop.point as Obstacle,tree,true);changed=true;
      });
      if(changed){this.propsVersion++;this.drawTreeShadows();this.place();}
      return;
    }
    if(!this.treeUse.has(id)){this.treeIdle.add(id);this.dropIdleTrees();return;}
    let changed=false;
    for(const entry of this.chunkProps.values())entry.props.forEach((prop,i)=>{
      if(prop.art!==id||prop.tree)return;
      prop.object.destroy();const next=this.makeProp(prop.point as Obstacle,tree,true);
      entry.props[i]=next;changed=true;
    });
    if(!changed)return;
    this.props=[...this.chunkProps.values()].flatMap(e=>e.props);this.propsVersion++;
    this.drawTreeShadows();this.place();
  }
  private drawProp(g:Graphics,o:Obstacle){
    g.fillStyle(0x558973,.15).fillEllipse(8,4,70,26);
    if(o.kind==='rock'){
      polygon(g,[{x:-27,y:0},{x:-30,y:-15},{x:-12,y:-34},{x:12,y:-32},{x:30,y:-13},{x:25,y:5}],0x839697);
      polygon(g,[{x:-30,y:-15},{x:-12,y:-34},{x:12,y:-32},{x:20,y:-18},{x:-1,y:-13}],0xc0c7ae);
      polygon(g,[{x:0,y:-13},{x:20,y:-18},{x:30,y:-13},{x:25,y:5},{x:-2,y:2}],0x9fac9f);
      g.lineStyle(2,0x668a72,.6).lineBetween(-15,-3,-8,-6);return;
    }
    if(o.kind==='palm'){
      polygon(g,[{x:-8,y:0},{x:3,y:-83},{x:13,y:-86},{x:7,y:0}],0xb29461);
      g.lineStyle(2,0x806e51,.5);for(let y=-6;y>-72;y-=10)g.lineBetween(-4,y,8,y-3);
      for(let i=0;i<7;i++){const angle=i/7*Math.PI*2;const x=Math.cos(angle)*67,y=-85+Math.sin(angle)*34;
        polygon(g,[{x:7,y:-84},{x:x*.55,y:y-17},{x,y},{x:x*.45,y:y+10}],i%2?0x529b70:0x72b97c);
        g.lineStyle(1.2,0xc4d991,.6).lineBetween(7,-84,x,y);
      }
      g.fillStyle(0xb1915c).fillCircle(0,-79,6).fillCircle(12,-77,5);return;
    }
    polygon(g,[{x:-10,y:2},{x:-7,y:-72},{x:8,y:-72},{x:12,y:1}],0x9a8060);
    g.lineStyle(3,0x755f50,.5).lineBetween(1,-3,0,-56);
    g.fillStyle(0x50866a).fillEllipse(1,-61,93,54);
    g.fillStyle(0x6ba775).fillCircle(-23,-78,31).fillCircle(23,-82,33).fillCircle(0,-98,34);
    g.fillStyle(0x91bf81).fillEllipse(-13,-107,50,25).fillEllipse(25,-88,33,19);
    g.fillStyle(0xc5d88f,.75).fillCircle(-22,-112,5).fillCircle(-5,-116,3).fillCircle(30,-94,4);
    g.fillStyle(0xe9b783).fillCircle(-31,-76,4).fillCircle(16,-105,4);
  }
  private drawLandmark(l:Point,index:number,name:string):Sign{
    const p=this.project(l),g=this.add.graphics({x:p.x,y:p.y}).setDepth(this.depth(l)-5);
    g.fillStyle(0xd5bf8f).fillEllipse(0,6,84,34);
    g.lineStyle(2,0xfff0c4,.8).strokeEllipse(0,6,87,36);
    if(index===0){
      g.fillStyle(0x826f62).fillRect(-32,-63,5,62).fillRect(27,-63,5,62);
      polygon(g,[{x:-46,y:-57},{x:-32,y:-86},{x:30,y:-86},{x:47,y:-57}],0xd88d98);
      for(let i=0;i<4;i++)polygon(g,[{x:-32+i*16,y:-86},{x:-24+i*16,y:-86},{x:-32+i*20,y:-57},{x:-44+i*20,y:-57}],0xf5dfbc);
      g.fillStyle(0xb5926e).fillRoundedRect(-32,-23,65,21,3);
      g.fillStyle(0xf0c171).fillCircle(-16,-27,7).fillCircle(0,-26,6);
      g.fillStyle(0x91b879).fillEllipse(18,-27,12,16);
    }else if(index===1){
      g.fillStyle(0xa2a9a8).fillEllipse(0,-1,71,34).fillRect(-35,-10,70,11);
      g.fillStyle(0xd8d9bd).fillEllipse(0,-11,74,36);
      g.fillStyle(0x84cfd0).fillEllipse(0,-12,55,24);
      g.fillStyle(0xb9c5b7).fillRect(-6,-48,12,38).fillEllipse(0,-46,27,12);
      g.lineStyle(2,0xe8ffff,.8).lineBetween(-5,-45,-18,-21).lineBetween(5,-45,18,-21);
      g.fillStyle(0xf7edc4).fillCircle(0,-54,7);
    }else{
      g.fillStyle(0xa99176).fillRoundedRect(-25,-22,52,15,3).fillRect(-19,-8,5,16).fillRect(17,-8,5,16);
      g.fillStyle(0x786978).fillRect(-2,-88,4,70);
      polygon(g,[{x:2,y:-88},{x:42,y:-80},{x:31,y:-67},{x:2,y:-70}],0xa28dc5);
      g.fillStyle(0xf7eac0).fillCircle(0,-91,5);
    }
    // Above trees and critters (a canopy used to cut the name), under the heroes and the danger layers.
    const label=new MapLabel(this,name,true).anchor(p.x,p.y+28,LABEL_DEPTH);
    return {point:l,graphic:g,label};
  }
}

export function createIsland(parent:HTMLElement,hooks:SceneHooks){
  const scene=new IslandScene(hooks);
  const game=new Phaser.Game({type:Phaser.WEBGL,parent,backgroundColor:'#8dcecc',
    width:parent.clientWidth,height:parent.clientHeight,scale:{mode:Phaser.Scale.RESIZE},
    antialias:true,transparent:false,autoFocus:false,
    audio:{noAudio:true},fps:{target:60,limit:60},banner:false,scene:[scene]});
  // Dev server only: Vite folds import.meta.env.DEV to false in builds and drops this whole block (probe included).
  // The local acceptance scripts read critters, players and the hero on screen through window.__island.probe().
  if(import.meta.env.DEV){
    const s=scene as unknown as {cameras:Phaser.Cameras.Scene2D.CameraManager;hooks:SceneHooks;attackTarget?:string;view:number;position:Point;actor:Phaser.GameObjects.Sprite;horde?:HordeRenderer;project(p:Point):Point;follow:FollowCamera;depthOrigin?:Point;useful():Rect|undefined;actorScale:number};
    const probe=()=>{
      const cam=s.cameras.main,net=s.hooks.net;
      const screen=(q:Point)=>({x:(q.x-cam.worldView.x)*cam.zoom,y:(q.y-cam.worldView.y)*cam.zoom});
      const enemies=[...(net?.feed.enemies.values()??[])].filter(e=>e.hp>0).map(e=>{
        const kind=enemyKind(e.kind),art=ENEMY_ART[kind],size=(e.elite&&kind!=='chefe'?ELITE_SCALE:1)*s.actorScale*ENEMY_DRAW_SCALE,q=s.project(e);
        return {id:e.id,...screen({x:q.x,y:q.y-(art.hover+art.height*art.originY*.5)*size})};
      });
      const players=net?[...net.players.values()].map(p=>{const at=p.id===net.id?net.predicted:p,state=net.feed.players.get(p.id);return {id:p.id,wx:at.x,wy:at.y,...screen(s.project(at)),downed:!!state?.downed,eliminated:!!state?.eliminated};}):[];
      const you=(scene as unknown as {you?:YouMarkers}).you;
      const camera={center:{...s.follow.center},look:{...s.follow.look},useful:s.useful(),depthOrigin:s.depthOrigin,locked:scene.rotationLocked(),
        heroPx:Math.round(96*s.actorScale*cam.zoom),actorScale:s.actorScale,scroll:{x:cam.scrollX,y:cam.scrollY}};
      const terrain=(s as unknown as {landscape?:{stats?:unknown}}).landscape?.stats;
      const props=(s as unknown as {props:unknown[];signs:unknown[]});
      return {terrain,props:props.props.length,signs:props.signs.length,textures:scene.textures.getTextureKeys().length,view:s.view,zoom:cam.zoom,camera,target:s.attackTarget,hero:screen(s.project(s.position)),heroRect:scene.heroScreenRect(),center:screen(s.project({x:12,y:12})),enemies,players,horde:s.horde?.stats(),you:you?{...you.last,covered:[...you.last.covered]}:undefined,
        zueira:scene.zueiraState(),blackout:scene.blackoutAudit(),economy:scene.economyOn,fps:[...scene.fpsHistory],catchUp:scene.catchingUp,backlogMs:Math.round(net?.backlog.ms??0)};
    };
    (window as unknown as {__island?:unknown}).__island={game,scene,probe};
  }
  return {game,scene};
}
