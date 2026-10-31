import {perf} from './dev/perf-flag.ts';
import {createTerrain,type TerrainLayer} from './terrain/renderer.ts';
import {propChunks} from './terrain/tiles.ts';
import {CityTerrain,TerrainField,randomSeed} from '../maps/index.ts';
import Phaser from 'phaser';
import {bitmapsAvailable,fetchBitmap,installUploadQueue,queueUpload} from './preload/upload-queue.ts';
import {holdBackground} from './preload/background-hold.ts';
import {Vignette} from './render/vignette.ts';
import {Nevoa} from './render/nevoa.ts';
import {exposureGameConfig} from './render/exposure-pipeline.ts';
import {ArenaDark,LIGHT_CORE,type ArenaSpotPx} from './render/arena-dark.ts';
import {ARENA,ArenaClock,arenaBoss,spotScale} from './render/arena-rules.ts';
import {FearDark,type FearSpotPx} from './render/fear-dark.ts';
import {FEAR_BEAT_PULL,FearClock,safeSpots,type FearFrame} from './render/fear-rules.ts';
import {isAsleep} from './render/wake-rules.ts';
import {sunlit} from './render/light-actors.ts';
import { classes, infinitoPoiName } from '../rules/index.ts';
import {GHOST_ALPHA,GHOST_TINT,GhostCam,ghostBounds,ghostSpeed} from './ghost.ts';
import {FollowCamera,StepLerp,stepClock,chooseWatched,cycleWatched,framesBeside,hordeUiScale,isCityWorld,toScreen,edgeOf,type BesideWindow,type Rect,type Watchable} from './framing.ts';
import {SceneTerrain,worldCamera} from './world-swap.ts';
import {Pinch,ZOOM_DEFAULT,clampZoom,easeZoom,wheelZoom} from './camera-zoom.ts';
import {CITY_GROUND_DEPTH,CityLayer,OUTSIDE_CITY,VIADUCT_PROP_IDS,ViaductLayer,PINE_TEXTURE,buildCityArtPlan,cityArtOptions,cityRenderAsset,groundZ,liveSheets,nestsFromStructures,queueCityArt,type CityArtPlan} from './render/city/index.ts';
import {ART_BUDGET,CityArtStream,NEAR_ART_CAP_MS} from './render/city/art-stream.ts';
import {artIndex} from './art/manifest.ts';
import {projectView,unprojectView,viewDepth,screenDirection,rotateVector,normalizeView,rotationLocked} from './projection.ts';
import {treeCatalog,type TreeArt} from '../maps/index.ts';
import {Cheers,danceAllowed} from './sprites/hero-dance.ts';
import {CharacterSprites,type Gait} from './sprites/character-sprites.ts';
import {buildFacing,isObraPhase,type ObraSpot} from './sprites/build-facing.ts';
import {workFacing} from './sprites/work-facing.ts';
import {hasWork16,hasDowned16} from './sprites/movement128.ts';
import {CityOutlines} from './render/city-outline.ts';
import {cityGroundLuminance} from './render/city-outline-rules.ts';
import {treeUrl,thumbUrl,iconKey,originalUrl,STAND_IN_KEY} from './sprites/art-urls.ts';
import { CoopClient, STEP } from './net/client.ts';
import {SelfCorrection} from './net/smoothing.ts';
import {SPAWN,landmarks,obstacles,findPath,moveAlong,moveDirection,clearSegment,worldSpawn,type Point,type Obstacle} from '../maps/index.ts';
import {HordeRenderer} from './render/layers.ts';
import {arsenalLoads,isWeaponItem} from './render/arsenal-rules.ts';
import {heldHand} from './sprites/hand-points.ts';
import {artTargetHeight,liteOnly,queueEnemyArt,queueHordeArt,releaseEnemyArt} from './art/horde-art.ts';
import {ChefaoArtPlan,chefaoDeferred} from './art/chefao-art.ts';
import {queueBaseArt} from './art/base-art.ts';
import {SceneMarks} from './art/frames-art.ts';
import {ALLY_RING_SIZE,ALLY_RING_WIDTH,AllyRings,critterIconSource} from './art/hud-art.ts';
import {StonewardsRenderer} from './render/stonewards.ts';
import {ChaveiroRenderer} from './render/chaveiro/renderer.ts';
import {UnoPip} from './render/chaveiro/pip.ts';
import {PIP_KEEP_PX,peeking,pipWanted} from './render/chaveiro/pip-rules.ts';
import {CAR_LOW,carLife} from './render/chaveiro/rules.ts';
import {PushShifts,pullDirection,pushContact,pushReach} from './render/chaveiro/push-contact.ts';
import {FortifyRenderer,type GhostInput} from './render/fortify.ts';
import {needsFortify,type CellRect} from './render/fortify-rules.ts';
import {objectiveOf} from './render/chaveiro/view.ts';
import {carSortDepth} from './render/chaveiro/car-sort.ts';
import {BankRenderer} from './render/bancos/renderer.ts';
import {ChaveiroTalk,type LooseEvent} from './render/chaveiro/talk.ts';
import {talkSeed} from './render/chaveiro/lines.ts';
import {TowerRenderer,towerLoads} from './render/towers/towers.ts';
import {TowerFeed,hasTowers,type TowerKind} from './render/towers/tower-rules.ts';
import {HEIGHT_PX} from './render/city/projection.ts';
import {buildPlanFor,elevation,farPath,worldBase} from '../maps/index.ts';
import {Projector} from './render/projector.ts';
import {ENEMY_ART,ELITE_SCALE,drawnKind,enemyKind,enemyTexture} from './render/keys.ts';
import type {RunView} from '../contract/index.ts';
import {token,tokenColor} from './ui/tokens.ts';
import {YouMarkers,ALLY_DEPTH,SELF_DEPTH,type HeroMark} from './render/you.ts';
import {SafeClock,arrowTrigger,canopyCovers,effectOn,facingFrom,rideChip,safeAlpha} from './render/you-rules.ts';
import {MapLabel,allyLabelText,mapLabelVisible,placeYieldsToSos,stackedLabelOffsetCss} from './render/map-labels.ts';
import {ENEMY_NAME_H_CSS,fallenByText} from './render/enemy-name-rules.ts';
import {secondsLeft} from './hud/model.ts';
import {DownedLayer,type DownedMark} from './render/downed.ts';
import {ZueiraFx} from './render/zueira-fx.ts';
import {LIFTED_DEPTH,auditBlackout} from './render/blackout-rules.ts';
import {MARK_DEPTH} from './render/you.ts';
import {destinationArtRim,destinationMark} from './render/city-edge-rules.ts';
import {ENEMY_DRAW_SCALE,HERO_DRAW_SCALE} from './render/draw-scale.ts';
import {FpsWatch,frameGateMs} from './economy.ts';
import {QUALITY_WATCH,qualityProfile,type QualityLevel} from './quality.ts';
import {castSilhouette,silhouetteImage} from './render/silhouette.ts';
import {CatchUp,CATCH_UP_GATE_MS} from './net/backlog.ts';
import {HoldFollow,MARKER_MS,keyVector,mapButtonDown,markerVisible,rightAttackDown} from './desktop-input.ts';
import {effectivePhase} from './calm-phase.ts';
import type {CenaClock} from './render/chefao-cena.ts';
import {heldWeapon,heldCooldownMs} from './hud/weapon-reach.ts';
import {weaponSound} from './audio/events.ts';
import {getAudio} from './audio/engine.ts';
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
/** Share of the hero sprite's frame its body fills (the frame keeps room for the swing): the level-up ring's size. */
const HERO_BODY_SHARE=.6;
/** Endless world: the depth origin follows the hero in steps of this many units (projection.ts viewDepth). */
const DEPTH_REBASE_UNITS=24;
/** The visual hook (data-sprite-* on the canvas, for tests and scripts) runs at most this often (ms): F3. */
const VISUAL_HOOK_MS=250;
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
  /** The hero's animation for tests and scripts, at most every VISUAL_HOOK_MS (it lists every texture to count the sheets). */
  visual?:(animation:string,frame:string,sheets:number)=>void;
  net?:CoopClient;
  /** The chefão's arrival scene (render/chefao-cena.ts): the camera goes to him, holds and comes back. Absent: none. */
  cena?:CenaClock;
  /**
   * D-051 manual combat: one input step's attack (hud/attack-button.ts take(): held, or tapped since the last step),
   * sent as PlayerInput.attack. Absent or false: no attack (the automatic weapons fire on their own).
   */
  attacking?:()=>boolean;
  /** Whether the attack is held now, without spending a tap (attacking() latches it for the next input step). */
  attackHeld?:()=>boolean;
  /** The scene-clock time of hero `id`'s last "Dançar" (empty hands, own or relayed): it dances from it, like a cheer. */
  danceAt?:(id:string)=>number|undefined;
  /** The auto aim's pick (world), for the predicted shot's direction (tiro-delay-1s-predicao). */
  aimPick?:()=>Point|undefined;
  /** Bicos (hud/bicos.ts WorkLatch): one input step's Trabalhar, given that step's direction (moving lets it go). */
  working?:(direction:Point)=>boolean;
  /** D-051 manual combat: a click or tap on an enemy chose it; the button attacks it once. Absent: only the target. */
  enemyPicked?:(id:string)=>void;
  /** D-051: the right mouse button pressed (true) or let go (false) holds the attack like Space. Absent: no manual attack. */
  attackHold?:(down:boolean)=>void;
  /** The phone's aim stick over the attack button (tiro-na-direcao-mobile): its world direction while it aims, else undefined. */
  aimStick?:()=>Point|undefined;
  /** D-051: the room plays the manual combat (the target words say "ataque", not "a arma atira sozinha"). */
  manual?:()=>boolean;
  /** Each new authoritative RunView (coop only), right after the horde renderer got it: the HUD consumes it. */
  runView?:(view:RunView)=>void;
  /** The HUD's kill-cam picture (CSS px, viewport coordinates) while it shows, VGM-053B. */
  killcamRect?:()=>Rect|undefined;
  /** Quality level at start (Q3: Leve is the old economy mode plus a still scenery; default Normal); setQuality changes it live. */
  quality?:QualityLevel;
  /** The FPS watch saw the first 10 s of combat under 40 fps (coop, above Leve): the shell steps the level down and says so. */
  slow?:()=>void;
  /**
   * Fear (card fear-escuridao-sozinho): every frame of a run once the dark has shown, what it is now (seconds alone,
   * the notice, a heartbeat starting): the HUD writes the notice and dims the portraits, the sound plays the beat.
   */
  fear?:(frame:FearFrame,far:readonly string[])=>void;
  /** The player's zoom at start (camera-zoom.ts: a factor on the follow zoom; default ZOOM_DEFAULT). */
  zoom?:number;
  /** The wheel or a pinch changed the wanted zoom (the shell saves it). */
  zoomChanged?:(k:number)=>void;
  /** The computer's fixed zoom (zoom-fixo-pc): `zoom` as given (camera-zoom.ts ZOOM_DESKTOP), the wheel and pinch do nothing. */
  zoomLocked?:boolean;
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
  /** The HD chefões' sheets on demand (art/chefao-art.ts): not at the opening, freed once they fall. */
  private readonly chefaoArt=new ChefaoArtPlan();
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
  /** A point carrying `andar` 1 (a body on a viaduct's deck) is lifted by the deck's surface (render/city/viaduct.ts). */
  private project=(p:Point&{andar?:number})=>{
    const q=projectView(p,this.view,this.field);
    if(p.andar===1&&this.viaduct)q.y-=this.viaduct.bodyLift(p.x,p.y,1);
    return q;
  };
  /** Depth origin: none on the island; near the hero in the endless world, so depths stay in the island's range. */
  private depthOrigin?:Point;
  /** A body on a deck draws just above the deck strip it stands on (render/city/viaduct.ts bodyDepth). */
  private depth=(p:Point&{andar?:number})=>(p.andar===1?this.viaduct?.bodyDepth(p.x,p.y):undefined)
    ??(this.city?this.city.actorDepth(p.x,p.y):viewDepth(p,this.view,this.depthOrigin));
  /** The viaducts of the city (mapa-175-com-viaduto), with the city layer; undefined elsewhere or without any. */
  private viaduct?:ViaductLayer;
  /**
   * Cidade Nevada (card cidade-03): the city render replaces the island ground and props. Actors draw at the layer's
   * actor depth (exact against the buildings' unit columns), not at the island's fixed SELF_DEPTH/ALLY_DEPTH.
   */
  private city?:CityLayer;
  /** City layer depth keys are plain viewDepth keys; this shifts them by the current depth origin (same as viewDepth). */
  private cityDepthOf=(key:number)=>key+viewDepth({x:0,y:0},this.view,this.depthOrigin)-viewDepth({x:0,y:0},this.view);
  /** Follow camera (D-019): centre of the camera in world px, smoothed, with look-ahead (framing.ts). */
  private follow=new FollowCamera();
  /** The chefão whose arrival already shook the camera (once per scene). */
  private shookFor?:string;
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
  /** The teammates the spectator may watch (last frame's), for the ‹ › of hud/spectator.ts. */
  private watchList:Watchable[]=[];
  /**
   * Out of the run (morto-anda-pelo-mapa): 'free' while the ghost walks the map (the default after a fall, from where the
   * hero fell), 'follow' while the camera is pinned on a friend (‹ ›, a portrait tap, or joined mid-run as a spectator).
   * The stick, the keys or a click let go of the friend. Client only: nothing of it reaches the room.
   */
  private readonly ghost=new GhostCam();
  private ghostSteer:Point={x:0,y:0};
  private ghostFig?:Phaser.GameObjects.Sprite;
  private ghostRing?:Phaser.GameObjects.Ellipse;
  /** City see-through (cidade-borda-e-quadras): the allies' feet drawn this frame, so walls in front of them fade too. */
  private allyFeet:Point[]=[];
  /** Each hero's feet where this frame drew his sprite (world u): the Defumador's smoke is centred there (aura-descentralizada). */
  private drawnFeet=new Map<string,Point>();
  private position:Point&{andar?:1}={...SPAWN};

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
  /** The hero's frame laid on the ground, its only shadow (render/silhouette.ts; card sombra-silhueta), in every quality. */
  private heroSil?:Phaser.GameObjects.Image;
  /** Depth of the hero's ground layer (its silhouette): the melee cone draws there. */
  private heroGroundDepth=0;
  private ring!:Phaser.GameObjects.Ellipse;
  private destination!:Graphics;
  /** Imported destination marker and skill rings (art/frames-art.ts); without the art, today's Graphics. */
  private artMarks?:SceneMarks;
  /** Imported ally ground rings (art/hud-art.ts); without the art, each ally's Breu ellipse. */
  private allyRings?:AllyRings;
  private goal?:Point;
  /** Desktop (controles-desktop): the held mouse button follows the cursor (Warcraft 3), re-targeted on a throttle. */
  private hold=new HoldFollow();
  /** The right mouse button holds the attack (rightAttackDown); let go when it is up, on pause or focus lost. */
  private rightHeld=false;
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
  /** Quality level (Q3) and its economy look (VGM-048), and the FPS watch that may step it down (coop combat only). */
  private quality:QualityLevel='normal';
  private economy=false;
  /** create() ran: the frame gate and the horde exist (setQuality before that only keeps the choice). */
  private booted=false;
  private readonly fpsWatch=new FpsWatch(QUALITY_WATCH);
  /** rAF time of the last drawn frame: Phaser's own delta is smoothed and clamped at 200 ms, too kind to a slow phone. */
  private lastFrameAt?:number;
  /** rAF ms since the previous frame (0 on the first): the step clock's time (framing.ts stepClock). */
  private frameMs=0;
  private accumulator=0;
  /** Where the prediction was drawn last frame (before the correction): the frame's own motion for the fade. */
  private lastSmooth?:Point;
  private attackTarget?:string;
  private skillEffects?:Graphics;
  private displayed?:Point;
  private remoteActors=new Map<string,{image:Phaser.GameObjects.Sprite;label:MapLabel;ring:Phaser.GameObjects.Ellipse;
    /** The ally's cast silhouette (render/silhouette.ts), like the hero's; its only shadow, created on demand. */
    sil?:Phaser.GameObjects.Image}>();
  /** Horde layers (VGM-039) fed by net.feed; players stay sprites owned by this scene. */
  private horde?:HordeRenderer;
  /** Wall, camp ring, towers and gather nodes (VGM-046B), fed by the same RunView. */
  private stone?:StonewardsRenderer;
  /** D-047: the chaveiro objective in the world (the car, the moto, their effects); only while a run view has one. */
  private chaveiro?:ChaveiroRenderer;
  /** Card inimigos-querem-o-uno: the Uno's live window, and when a tap on it swung the camera to the car (loop clock). */
  private pip?:UnoPip;
  private peekSince?:number;
  /** Card empurrar-uno: the pushers' drawn shift onto the car (push-contact.ts); the own hero's this frame. */
  private pushShifts=new PushShifts();
  private selfShift={x:0,y:0};
  /** Bancos (card bancos-e-veiculos): the run's ATMs in the world; only while a run view has banks. */
  private banks?:BankRenderer;
  /** D-047 (card chaveiro-falas): when the chaveiro's cast speaks, in the horde's balloons; made with the renderer. */
  private talk?:ChaveiroTalk;
  /**
   * Tower defenses (torres-render): built on the first snapshot that has one (makeTowers; a world without defenses pays
   * nothing: no renderer, atlas, layers or enemy walk), then kept across world swaps (reset, not rebuilt), fed by
   * view.structures through TowerFeed on every new snapshot and drawn every frame; released with the scene.
   */
  private towers?:TowerRenderer;
  /**
   * D-052 slice 4: wall segments, the build ghost and its hints, the car's rope (placeholder). Built on the first
   * snapshot that needs it (needsFortify) or when the HUD first sets a ghost; released with the scene.
   */
  private fortify?:FortifyRenderer;
  private readonly towerFeed=new TowerFeed();
  /** The defenses going up now (card animacao-construir-6): a hero standing by one plays its build16, facing it. */
  private obras:ObraSpot[]=[];
  /** The live enemies the weapons aim at (parallel arrays, grown as needed) and the world's build plan (cell, rail). */
  private towerAim={n:0,xs:new Float32Array(64),ys:new Float32Array(64),air:new Uint8Array(64)};
  private buildPlan?:ReturnType<typeof buildPlanFor>;
  private readonly towerFigures:{x:number;y:number;z:number}[]=[];
  private readonly shakeAt={x:0,y:0};
  /** When the visual hook last ran (VISUAL_HOOK_MS). */
  private visualAt=-Infinity;
  private projector?:Projector;
  private stateVersion=-1;
  private offersVersion=-1;
  private reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Ring, contour, mini health bar and "Você" arrow of the local hero; see-through copies over canopies (UX-voce-e-dano). */
  private you?:YouMarkers;
  private marks:HeroMark[]=[];
  private selfCovered=false;
  private lastPhase?:string;
  private loadSaid=false;
  /** Wave or interval of the current round: map labels come back in the interval. */
  private roundPhase?:string;
  /** Tick of the last authoritative view (seconds left on a caído ficha). */
  private viewTick=0;
  private sosScreens:{x:number;y:number}[]=[];
  private lastFeet?:Point;
  private facing=Math.PI/2;
  /** Where the local hero means to walk (world units, last step): its sprite faces this, not the reconciled position (sprites-4-direcoes). */
  private intent:Point={x:0,y:0};
  /** The last way the hero walked (a predicted shot without any aim goes there). */
  private lastIntent:Point={x:1,y:0};
  /** Scene-clock time of the player's last input of any kind (card danca-no-jogo: it cuts the dance at once). */
  private inputAt=-Infinity;
  /** Who cheers now (danca-no-jogo etapa 2): fed by the run's events, read by the dance cues. */
  private cheers=new Cheers();
  /** Caídos in the world: rescue ring, progress and light column (UX-resgate-e-ping). */
  private downedLayer?:DownedLayer;
  private downedMarks:DownedMark[]=[];
  /** Blackout and kill-cam of the zueira events (VGM-053B). */
  private zueira?:ZueiraFx;
  /** The local caído's own ficha ("Você, 18 s") under its body: the counter left the top banner. */
  private selfLabel?:MapLabel;
  /** "Te derrubou: X" under the own caído ficha (render/enemy-name-rules.ts), and its ficha. */
  private fallenBy?:string;
  private fallenLabel?:MapLabel;
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
  constructor(hooks:SceneHooks){super('island');this.hooks=hooks;const k=hooks.zoom??ZOOM_DEFAULT;this.zoomWant=this.zoomNow=hooks.zoomLocked?k:clampZoom(k);this.quality=hooks.quality??'normal';this.economy=qualityProfile(this.quality).economy;this.terrainWatch=new SceneTerrain(hooks.net?.terrain??new TerrainField(randomSeed()));this.trees=this.chooseTrees();}
  /**
   * What the first frame needs, in the order it is fetched (N27): the ground, this hero's sheet, its walk in the 8 directions and its stand-in, the
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
      // Only the imported ground (render/city/art-plan.ts) before the first frame: buildings, decor and the cenário vivo
      // stream in by distance once the city exists (streamCityArt), the match opening with the ones around the camera.
      const plan=this.cityArt();
      queueCityArt(this,{...plan,sheets:plan.sheets.filter(s=>s.key.startsWith('city:ground:'))});
    }
    else{this.load.image('terrain-soil','/art/terrain/soil-grass.webp');this.load.image('terrain-bed','/art/terrain/riverbed.webp');}
    this.sprites.queue(this.hooks.classId);
    this.sprites.queueOwnWalk(this.hooks.classId); // the first step walks (preload-heroi-primeiro)
    this.load.image('hero',thumbUrl(this.hooks.classId));
    if(this.hooks.net)for(const id of new Set([this.hooks.classId,...[...this.hooks.net.players.values()].map(p=>p.classId)]))this.classIcon(id);
    for(const tree of new Set([...this.trees,...this.spawnTrees()]))if(tree)this.loadTree(tree.id);
    queueHordeArt(this); // imported art v2 (enemies, items, FX) when the manifest has it
    queueBaseArt(this); // imported Stonewards base art (wall, barricades, crates) when the manifest has it
    // The crates' floating items (caixa-aparece-tarde): the map opens with crates of any item, so in the manual combat every
    // item sticker (~750 KB, the waiting room already fetched them: match-assets P1) comes with the art around the hero,
    // not ~11 s later behind the city's stream. The shot strips stay with the first manual view (render/arsenal-fx.ts).
    if(this.hooks.net?.combat==='manual')for(const l of arsenalLoads())if(!l.strip)this.load.image(l.key,l.url);
    // The defenses' sheets are not preloaded (none stands at the opening): every kind's was ~8 MB of download and
    // ~134 MB of decoded textures on a phone (auditoria-desempenho-28-10). A kit's ghost or a defense asks for its own
    // kind's (needTowerArt), the defense hidden meanwhile (TOWER_ART_WAIT_MS).
  }
  private towerArtAsked=new Set<string>();
  /** A defense made before its sheets: those two now, at high priority, past Phaser's first-in first-out queue. */
  private needTowerArt(kind:TowerKind){
    for(const l of towerLoads(kind)){
      if(this.textures.exists(l.key)||this.towerArtAsked.has(l.key)||this.loaderTakes(l.key))continue;
      this.towerArtAsked.add(l.key);
      if(bitmapsAvailable()){
        void fetchBitmap(l.url,'high').then(bitmap=>queueUpload(bitmap.width*bitmap.height,()=>{
          if(this.textures.exists(l.key)){bitmap.close();return;}
          this.textures.addSpriteSheet(l.key,bitmap as unknown as HTMLImageElement,{frameWidth:l.frameWidth,frameHeight:l.frameHeight});
        }),()=>this.towerArtAsked.delete(l.key));
      }else{
        this.load.spritesheet(l.key,l.url,{frameWidth:l.frameWidth,frameHeight:l.frameHeight});
        if(!this.load.isLoading())this.load.start();
      }
    }
  }
  /**
   * The loader's own copy of a sheet: already fetched or being added → it lands soon (true); still
   * waiting its turn → taken out of the loader (false), fetched now instead. Both adding one key made Phaser log
   * 'Texture key already in use' (art:torres:vigia-do-predio:idle, the T1 built before the late queue reached it).
   */
  private loaderTakes(key:string){
    const load=this.load as unknown as {list:Phaser.Structs.Set<Phaser.Loader.File>;inflight:Phaser.Structs.Set<Phaser.Loader.File>;queue:Phaser.Structs.Set<Phaser.Loader.File>};
    if(load.inflight?.entries.some(f=>f.key===key)||load.queue?.entries.some(f=>f.key===key))return true;
    // Safe: the loader completes on its sets' sizes (LoaderPlugin.fileProcessComplete), only `progress` counts it.
    for(const f of [...load.list?.entries??[]])if(f.key===key)load.list.delete(f);
    return false;
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
    // A smaller enemy copy (liteOnly) keeps its procedural reserve instead: the approved file has other cells.
    const url=typeof file.url==='string'&&!liteOnly(file.url)?originalUrl(file.url):undefined;
    if(!url||this.fellBack.has(file.key))return;
    this.fellBack.add(file.key);
    if(file.type==='spritesheet')this.load.spritesheet(file.key,url,file.config as Phaser.Types.Loader.FileTypes.ImageFrameConfig);
    else if(file.type==='image')this.load.image(file.key,url);
    else return;
    if(!this.load.isLoading())this.load.start();
  }
  private iconsAsked=new Set<string>();
  /** False once the scene is stopped or destroyed (its cameras and sprites are gone): the DOM HUD's frames skip it. */
  live=false;
  create(){
    this.live=true;
    const gone=()=>{this.live=false;};this.events.once('shutdown',gone);this.events.once('destroy',gone);
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
    this.vignette=new Vignette(this);
    // jogo-mais-escuro: the fog over the world, faded around the hero (`?nevoa=0..3`).
    this.nevoa=new Nevoa(this,{reduced:this.reduced,hero:()=>this.actor&&{x:this.actor.x,y:this.actor.y-this.actor.displayHeight*.4}});
    this.applyGrade();
    // The hero's ring and stand-in follow its drawn size (HERO_DRAW_SCALE, render/draw-scale.ts).
    // The old cream ring stays only as an object (rotation/placement code moves it); the you-marker draws the real one.
    this.ring=this.add.ellipse(0,0,50,23).setStrokeStyle(2,0xfff8c8,.95).setVisible(false).setScale(HERO_DRAW_SCALE);
    this.actor=sunlit(this.add.sprite(0,0,'hero').setOrigin(.5,.88).setDisplaySize(112*HERO_DRAW_SCALE,112*HERO_DRAW_SCALE));
    this.you=new YouMarkers(this,this.reduced,this.outlines);this.you.showArrow(this.time.now);
    // Under the name fichas (auditoria-arte-mundo item 12): a tap on a caído's ficha put the mark over its name.
    this.destination=this.add.graphics().setDepth(ALLY_DEPTH-1).setName('destino');
    this.artMarks=new SceneMarks(this,p=>this.project(p));
    // Released with the scene (stop → 'shutdown', game.destroy → 'destroy'), with or without a server.
    const marks=this.artMarks,dropMarks=()=>{marks.destroy();if(this.artMarks===marks)this.artMarks=undefined;};
    this.events.once('shutdown',dropMarks);this.events.once('destroy',dropMarks);
    const rings=this.allyRings=new AllyRings(this,tokenColor('--c-breu')),dropRings=()=>{rings.destroy();if(this.allyRings===rings)this.allyRings=undefined;};
    this.events.once('shutdown',dropRings);this.events.once('destroy',dropRings);
    // Only the canvas's own presses land here (POINTER_DOWN needs the canvas as the down element): a press on the DOM HUD
    // never walks. A mouse press on the ground also starts the hold-to-follow (followHold); one on an enemy targets it.
    // The right button attacks where the hero stands (NEW-20261021-ORQ-direito-ataca-e-cone-no-ar): in the manual combat
    // it holds the attack toward the mouse (the melee cone shows), with the automatic weapons it only picks an enemy under
    // it; it never walks. The canvas keeps the browser's menu shut.
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown',(pointer:Phaser.Input.Pointer)=>{
      if(pointer.button===2){
        if(this.paused||!rightAttackDown(pointer))return;
        if(this.hooks.manual?.()){this.rightAttack(true);return;}
        const hit=this.enemyAt(this.cameras.main.getWorldPoint(pointer.x,pointer.y));
        if(hit){this.attackTarget=hit;this.horde?.setTarget(hit);this.hooks.message('Alvo priorizado. A arma atira sozinha quando ele chega perto.');}
        return;
      }
      if(this.paused||!mapButtonDown(pointer))return;
      const p=this.cameras.main.getWorldPoint(pointer.x,pointer.y);
      // Out: a tap or click sends the ghost there (no enemy to pick, no walk to hold).
      if(this.ghost.goTo(unprojectView(p,this.view,this.field)))return;
      const hit=this.enemyAt(p);
      this.hold.release();
      if(hit){this.attackTarget=hit;this.horde?.setTarget(hit);this.hooks.enemyPicked?.(hit);this.hooks.message(this.hooks.manual?.()?'Alvo escolhido. Segura o ataque pra bater nele.':'Alvo priorizado. A arma atira sozinha quando ele chega perto.');return;}
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
    // Any touch, click or key, on the map or on the HUD, cuts the hero's dance and restarts its wait (danca-no-jogo).
    const poke=()=>{this.inputAt=this.time.now;};
    globalThis.addEventListener?.('pointerdown',poke,true);globalThis.addEventListener?.('keydown',poke,true);
    const unpoke=()=>{globalThis.removeEventListener?.('pointerdown',poke,true);globalThis.removeEventListener?.('keydown',poke,true);};
    this.events.once('shutdown',unpoke);this.events.once('destroy',unpoke);
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
        alsoView:()=>this.pip?.viewRect(),carSort:()=>this.chaveiro?.carSort(),
        tickMs:STEP*1000,pushMs:PUSH_MS,selfId:()=>net.id||undefined,
        // The local hero's shots already drawn on the press are not drawn again (net/attack-predict.ts).
        ownFire:(event,eventId,tick)=>net.attackPredict.fire(eventId,event.weapon,tick,performance.now()),onKill:kind=>this.chefaoArt.killed(kind,performance.now()),
        locate:id=>id===net.id?net.predicted:net.players.get(id),
        // The melee aim cone follows the mouse (the ground under it); a finger leaves it on the swing's direction.
        aim:()=>this.mouseGround()??this.stickGround(),
        // …drawn by the scene right after the hero is placed: under his shadow, at his drawn depth (cone-por-cima).
        coneFromScene:true,
        // The weapon in the hand (card arma-na-mao-viciado): on the hand of the pose the hero's sprite shows.
        hand:id=>heldHand(this.sprites,id===net.id?this.actor:this.remoteActors.get(id)?.image),
        away:id=>{const s=id===net.id?this.actor:this.remoteActors.get(id)?.image;return !!s&&this.sprites.dancing(s);},
        // …drawn by the scene once every hero is placed and animated (end of updateCoop): on this frame's pose and spot.
        handsFromScene:true,
        // …and the Defumador's smoke on the feet as drawn (the smoothed hero, the buffered allies), not at locate().
        auraFromScene:true,
        // Boletos and the sale's coxinhas behind a tree go above the canopies (pacote-bugs-ux, VGM-053B review M3).
        canopyCovers:(q,depth)=>this.treeCovers(q,depth),canopyVersion:()=>this.propsVersion,
        // City: dashed Breu/Papel telegraph edge with a solid Cone ring, Breu 38% contact shadows (card cidade-contorno-breu).
        city:()=>this.cityMode,cityOutlines:this.outlines});
      // game.destroy(true) emits 'destroy' (not 'shutdown'); a scene stop emits 'shutdown'. Either releases the pools once.
      // Caídos' light columns follow the figures' scale (CITY_VIEW_SCALE in the city).
      this.downedLayer=new DownedLayer(this,p=>this.project(p),p=>this.depth(p),()=>this.actorScale);
      // The wall, the towers and the kill-cam's copy follow the figures' scale too (CITY_VIEW_SCALE in the city).
      this.stone=new StonewardsRenderer(this,{projector:this.projector,reduced:this.reduced,hero:()=>this.position,actorScale:()=>this.actorScale,
        cell:()=>this.field instanceof CityTerrain?this.field.asset.unitsPerCell:undefined});
      this.zueira=new ZueiraFx(this,{reduced:this.reduced,project:p=>this.project(p),depth:p=>this.depth(p),tickMs:STEP*1000,actorScale:()=>this.actorScale,
        heroAt:()=>this.actor.visible?{x:this.actor.x,y:this.actor.y}:undefined,heroHeight:()=>this.heroBodyPx(),localId:()=>this.hooks.net?.id,
        setBlackout:level=>this.horde?.setBlackout(level),
        killcamRect:()=>{const r=this.hooks.killcamRect?.();return r&&{x:Math.round(r.x-this.canvasOffset.x),y:Math.round(r.y-this.canvasOffset.y),width:Math.round(r.width),height:Math.round(r.height)};}});
      const release=()=>{this.chaveiro?.destroy();this.chaveiro=undefined;this.pip?.destroy();this.pip=undefined;this.peekSince=undefined;this.talk=undefined;this.fortify?.destroy();this.fortify=undefined;this.banks?.destroy();this.banks=undefined;this.zueira?.destroy();this.zueira=undefined;this.horde?.destroy();this.horde=undefined;this.stone?.destroy();this.stone=undefined;this.towers?.destroy();this.towers=undefined;this.you?.destroy();this.you=undefined;this.downedLayer?.destroy();this.downedLayer=undefined;this.selfLabel?.destroy();this.selfLabel=undefined;this.fallenLabel?.destroy();this.fallenLabel=undefined;this.fallenBy=undefined;};
      this.events.once('shutdown',release);this.events.once('destroy',release);
    }
    this.rebaseDepth(true);this.fit();this.place();
    this.booted=true;this.setQuality(this.quality);
    this.hooks.terrain?.(this.field.seed,this.field.signature);this.hooks.position(this.position);
    // The city's near art still on its way: the cover stays until it is in (updateCity calls ready then).
    if(this.cityHeld)this.readyHeld=true;else this.hooks.ready();
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
    this.buildWorld();this.applyGrade();
    this.rebaseDepth(true);this.reproject();this.fit();this.place();
    // hooks.terrain is not called again: explore.ts appends a settings line per call (it reports the first world only).
  }
  /** Cidade Nevada mode (the field says 'cidade'): the Breu edges and shadows of card cidade-contorno-breu. */
  private get cityMode(){return isCityWorld(this.field);}
  /** City mode: enemies, pickups and projectiles draw at the city layer's actor depth (Projector.depthOverride). */
  private cityDepths(){
    if(!this.projector)return;
    this.projector.depthOverride=this.city?(x,y)=>this.city?this.city.actorDepth(x,y):0:undefined;
    // The viaducts (mapa-175-com-viaduto): critters and shots on a deck are lifted onto it (Projector.projectOn).
    this.projector.deck=this.viaduct;
  }
  /** The heroes' drawn scale: the actor scale × HERO_DRAW_SCALE (their sheets, shadows, ally rings and fichas). */
  private get heroScale(){return this.actorScale*HERO_DRAW_SCALE;}
  /** Scales every figure drawn at the endless map's size; the sheets follow on their next animate(). */
  private setActorScale(k:number){
    // The city's depth and fade tests use the figure's real screen box.
    this.city?.setActorScale(k);
    const old=this.actorScale;if(k===old)return;
    this.actorScale=k;this.sprites.viewScale=k;
    const hero=this.heroScale;
    this.ring?.setScale(hero);
    const resize=(s:Phaser.GameObjects.Sprite,icon:number)=>{
      if(s.texture.key.startsWith('sprite:')||s.texture.key.startsWith('sprite128:'))s.setScale(s.scaleX/old*k,s.scaleY/old*k);else s.setDisplaySize(icon*hero,icon*hero);
    };
    if(this.actor)resize(this.actor,112);
    if(this.ghostFig)resize(this.ghostFig,112);
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
    const camera=this.cityCamera();
    // Held (streamCityArt): no chunk is built before the art around the camera is in, so none is built with mounds.
    if(this.cityHeld){
      // The relief's albedo too (groundSettled: no chunk is live yet), so the ground is final when the cover goes.
      if(!(this.cityStream?.nearReady()&&this.city.groundSettled())&&performance.now()-this.heldSince<NEAR_ART_CAP_MS)return;
      this.cityHeld=false;this.releaseBackground();
      if(this.readyHeld){this.readyHeld=false;this.hooks.ready();}
    }
    this.cityStream?.tick(performance.now());
    // The fade test needs the hero's real ground height (city relief reaches ~185 px).
    const asset=this.city.asset,hero=this.watchPoint?undefined:{x:this.position.x,y:this.position.y,z:groundZ(asset,this.position.x,this.position.y)};
    const allies=this.allyFeet.map(p=>({x:p.x,y:p.y,z:groundZ(asset,p.x,p.y)}));
    const car=this.chaveiro?.hitState(),carPx=car&&!car.ended?this.project(car.car):undefined;
    // Card inimigos-querem-o-uno: the chunks around the car stay built, so the Uno's live window never opens on a hole.
    const also=carPx&&{x:carPx.x-PIP_KEEP_PX,y:carPx.y-PIP_KEEP_PX,w:PIP_KEEP_PX*2,h:PIP_KEEP_PX*2};
    this.city.update({camera,view:this.view,dtMs:delta,hero,allies,...(also?{also}:{})});
    this.viaduct?.update(this.view,this.watchPoint?undefined:this.position);
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
    // Card inimigos-querem-o-uno: a tap on the Uno's live window looks at the car for a moment (PEEK_MS).
    const peek=this.peekCar();
    const b=this.heroWorldBox(),size=this.watchPoint||peek?undefined:{width:b.width*this.zoom,height:b.height*this.zoom};
    // The hero as drawn (the interpolated prediction plus the reconcile glide, coop), not the bare prediction: the camera
    // centres what the player sees, so a correction slides the world, not the hero off the centre (camera-centro-heroi).
    let focus=this.project(peek??this.watchPoint??this.position);
    // A copy: the follow camera keeps its own centre on the hero (the scene's pull never feeds its smoothing back).
    const c={...this.follow.step(focus,delta/1000,this.viewport(),this.zoom,this.framed(),size)};
    // The chefão's arrival (boss-fim-onda-1): the camera eases over to him and back; a light shake as it lands on him.
    const cena=this.hooks.cena?.frame(performance.now());
    if(cena&&cena.weight>0){
      // On his body's middle, not his feet (he stands several heroes tall).
      const at=this.project({x:cena.cena.x,y:cena.cena.y}),w=cena.weight;at.y-=artTargetHeight(cena.cena.who)*this.actorScale*ENEMY_DRAW_SCALE*.45;
      c.x+=(at.x-c.x)*w;c.y+=(at.y-c.y)*w;focus={x:focus.x+(at.x-focus.x)*w,y:focus.y+(at.y-focus.y)*w};
      if(cena.hold&&this.shookFor!==cena.cena.enemy){this.shookFor=cena.cena.enemy;if(!this.reduced)this.cameras.main.shake(320,.006);}
    }
    this.cameras.main.centerOn(c.x,c.y);
    // The ground under who the camera follows is always baked first (a jump to a far teammate spreads the rest).
    this.landscape?.follow(WATER_MARGIN,focus);this.syncProps();this.pumpTrees();this.updateCity(delta);
  }
  /** The chefão's throw (boss-fim-onda-1, the Tank's punch) the last frame: until when this hero was down. */
  private downSeen=-Infinity;private tilted=false;
  /**
   * Thrown by a chefão's pancada (net effects.downUntil): the screen shakes once as the punch lands, and the hero lies
   * tilted on the ground while down (both without the shake under reduced motion).
   */
  private thrown(){
    const net=this.hooks.net,until=net?.effects.downUntil;
    if(!net||!this.actor)return;
    if(until!==undefined&&until>this.downSeen){this.downSeen=until;if(!this.reduced)this.cameras.main.shake(280,.014);}
    const down=until!==undefined&&net.tick<until;
    if(down){this.actor.setRotation(this.actor.flipX?1.1:-1.1);this.tilted=true;}
    else if(this.tilted){this.actor.setRotation(0);this.tilted=false;}
  }
  /** Where the camera looks while a tap on the Uno's window holds (the car, world units), else undefined. */
  private peekCar():Point|undefined{
    if(!peeking(this.peekSince,this.game.loop.time))return undefined;
    const car=this.chaveiro?.hitState();
    return car&&!car.ended?{x:car.car.x,y:car.car.y}:undefined;
  }
  /**
   * Card inimigos-querem-o-uno, etapa 3: the Uno's live window (render/chaveiro/pip.ts) while the car takes hits out of
   * view or far from the hero; after the main camera moved.
   */
  private updatePip(time:number){
    const hit=this.chaveiro?.hitState();
    if(!hit&&!this.pip)return;
    const pip=this.pip??=new UnoPip(this,{onTap:()=>{this.peekSince=this.game.loop.time;},ignore:()=>{const v=this.vignette?.object;return [...v?[v]:[],...this.nevoa?.objects??[],...this.fearDark?.objects??[]];}});
    const live=!!hit&&!hit.ended,cam=this.cameras.main,carPx=hit?this.project(hit.car):undefined;
    const me=this.watchPoint??this.position,distance=hit?Math.hypot(hit.car.x-me.x,hit.car.y-me.y):Infinity;
    const carOnScreen=!!carPx&&cam.worldView.contains(carPx.x,carPx.y);
    const wanted=pipWanted({live,now:time,carOnScreen,distance,peeking:peeking(this.peekSince,this.game.loop.time),...(hit?.lastHitAt!==undefined?{lastHitAt:hit.lastHitAt}:{})});
    const life=hit?carLife(hit.car):0;
    pip.update({wanted,mainZoom:cam.zoom,time,...(carPx?{car:carPx}:{}),...(hit?{life:{fraction:life,low:life<CAR_LOW}}:{})});
  }
  /** Re-places everything drawn once in world px (props, signs, shadows) after a view turn or a depth re-base. */
  private reproject(){
    for(const prop of this.props){const p=this.project(prop.point);prop.object.setPosition(p.x,p.y).setDepth(this.depth(prop.point));if(prop.tree)(prop.object as Phaser.GameObjects.Image).setFrame(this.view);}
    this.drawTreeShadows();
    for(const sign of this.signs){const p=this.project(sign.point),depth=this.depth(sign.point);sign.graphic.setPosition(p.x,p.y).setDepth(depth-5);sign.label.anchor(p.x,p.y+28,LABEL_DEPTH);}
    this.city?.setDepthOf(this.cityDepthOf);
    if(this.projector){this.projector.view=this.view;this.projector.origin=this.depthOrigin;this.horde?.refresh();this.stone?.refresh();this.chaveiro?.refresh();this.banks?.refresh();}
    this.towers?.refresh();
  }
  /**
   * Endless world and city: moves the depth origin to the hero when it walked DEPTH_REBASE_UNITS away (screen
   * unchanged). The city spans ±34 000 in raw keys: without it, views 1–3 would sort under the ground layers.
   * Out and watching (UX-espectador): the origin follows the watched friend, else everything near him sorts under the ground.
   */
  private rebaseDepth(force=false){
    if(!this.field.chunks&&!this.city)return;
    // The chefão's arrival (boss-fim-onda-1): while the camera is mostly on him the origin goes to him (he would sort
    // under the ground far from the hero), and back with the camera.
    const cena=this.hooks.cena?.frame(performance.now()),near=cena&&cena.weight>=.5?{x:cena.cena.x,y:cena.cena.y}:undefined;
    const o=this.depthOrigin,at=near??this.watchPoint??this.position;
    if(!force&&o&&Math.max(Math.abs(o.x-at.x),Math.abs(o.y-at.y))<DEPTH_REBASE_UNITS)return;
    this.depthOrigin={x:Math.round(at.x),y:Math.round(at.y)};
    if(this.actor)this.reproject();
  }
  /** Whether the view may turn now (UX-camera-segue 4: never during a wave; the buttons go grey). */
  rotationLocked(){const net=this.hooks.net;return !!net&&rotationLocked(net.run?.phase,this.roundPhase);}
  /** The round phase the client acts on (calm-phase.ts): the room's, or calm in the nests mode. */
  get phase(){return this.roundPhase;}
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
  /** A hero's walk as this frame drew it (audio/footsteps.ts steps on its contacts); undefined standing or not drawn. */
  heroGait(id:string):Gait|undefined{
    const sprite=id===this.hooks.net?.id?this.actor:this.remoteActors.get(id)?.image;
    return sprite?this.sprites.gait(sprite):undefined;
  }
  /** Where a world point is across the camera: -1 its left edge, 0 the centre, 1 the right (a sound's pan). */
  screenSide(p:Point){
    const view=this.cameras?.main?.worldView;if(!view)return 0;
    const q=this.project(p);
    return view.width>0?Math.max(-1,Math.min(1,(q.x-view.centerX)/(view.width/2))):0;
  }
  /** What the camera follows (world units): the hero, or the teammate watched while out. Distances count from here. */
  focusPoint():Point{return this.watchPoint??this.position;}
  /** A line over a player's head (falls, rescues, "Segura aí"), through the horde's balloon budget. */
  say(id:string,line:string){this.horde?.say(id,line);}
  /** The kind behind the local hero's latest fall (hud/cause.ts): its name goes under the caído ficha as "Te derrubou: X". */
  fallenFrom(kind:string|undefined){this.fallenBy=fallenByText(kind);}
  /** D-051: the attack button's choice (a drag let go on an enemy), or undefined to go back to the auto aim. */
  /** The ground point (world u) under the mouse, or undefined for a finger or a mouse that never moved (the auto aim). */
  private mouseGround():Point|undefined{
    const p=this.input.activePointer;
    return !p||p.wasTouch||!p.time?undefined:unprojectView(this.cameras.main.getWorldPoint(p.x,p.y),this.view,this.field);
  }
  /** The ground point one unit from the hero along the phone's aim stick, or undefined while it does not aim. */
  private stickGround():Point|undefined{
    const d=this.hooks.aimStick?.();
    return d&&{x:this.position.x+d.x,y:this.position.y+d.y};
  }
  /**
   * BUG-20261027-ORQ-tiro-delay-1s-predicao: the attack button was pressed (hud/attack-button.ts `pressed`). When the
   * room would take that press (manual combat, a weapon in the hand, nothing holding the hands), the swing, the shot's
   * flash and its sound show now, aimed like the room aims: the mouse or the aim stick, the chosen target, the auto
   * aim's pick, else the way the hero last walked. The room's copy of it is skipped (net/attack-predict.ts).
   */
  predictAttack(){
    const net=this.hooks.net;
    if(!net||!this.horde||!this.hooks.manual?.()||this.paused||net.run?.phase!=='combat'||net.run.pause||net.run.cena||net.handsBusy||this.isOut())return;
    const me=net.feed.players.get(net.id),self=net.players.get(net.id);
    if(!me||!self?.hp||me.downed||me.eliminated)return;
    const held=heldWeapon(me),weapon=held?.id;
    if(!weapon||!net.attackPredict.press(performance.now(),weapon,heldCooldownMs(held)))return;
    const hero=net.predicted,mouse=this.mouseGround(),stick=this.hooks.aimStick?.();
    const chosen=this.attackTarget?net.feed.enemies.get(this.attackTarget):undefined;
    const at=mouse??(stick?{x:hero.x+stick.x,y:hero.y+stick.y}:undefined)??chosen??this.hooks.aimPick?.()??{x:hero.x+this.lastIntent.x,y:hero.y+this.lastIntent.y};
    this.horde.ownShot(weapon,hero.x,hero.y,at.x-hero.x,at.y-hero.y);
    const sound=weaponSound(weapon),audio=getAudio();
    if(sound&&audio.unlocked)audio.play(sound);
    // scripts/medir-tiro.mjs: the frame that draws the predicted swing (only when the measuring page set __tiro).
    const tiro=(window as {__tiro?:{local?:number[]}}).__tiro;
    if(tiro?.local)requestAnimationFrame(()=>tiro.local!.push(performance.now()));
  }
  chooseTarget(id:string|undefined){if(this.paused)return;this.attackTarget=id;this.horde?.setTarget(id);}
  /** The chosen target (PlayerInput.target), for the attack button's reticle. */
  get chosenTarget(){return this.attackTarget;}
  /** Where the local hero means to walk (world units; zero standing): the kit's ghost goes that way (construir-no-botao). */
  get heroIntent():Point{return this.intent;}
  setPaused(paused:boolean){this.paused=paused;if(paused){this.attackTarget=undefined;this.horde?.setTarget(undefined);}this.route=[];this.destination?.clear();this.hold.release();if(paused)this.rightAttack(false);this.input.keyboard?.resetKeys();}
  /**
   * Focus lost on the desktop (controles-desktop): no pause, but nothing stays held: the keys Phaser saw down, and the
   * mouse button's follow (a walk already ordered by a click goes on to its marker, like a tap's).
   */
  releaseInput(){this.hold.release();this.rightAttack(false);this.input.keyboard?.resetKeys();}
  /** The right mouse button's attack held or let go (once per change). */
  // The flag changes after the hook (cone-por-cima-e-clique-em-loop): the press wakes a "Controles pausados" pause
  // (setPaused(false)) inside the hook, and a let-go there would leave the attack held with nobody to release it.
  private rightAttack(down:boolean){if(this.rightHeld===down)return;this.hooks.attackHold?.(down);this.rightHeld=down;}
  /** The player's zoom factor (camera-zoom.ts), clamped; eased on screen and saved by the shell. */
  setZoom(k:number){
    const next=clampZoom(k);if(this.hooks.zoomLocked||next===this.zoomWant)return;
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
    // Out: the ghost flies there in a straight line (the minimap's click too); the dead body stays put.
    if(this.ghost.goTo(target))return;
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
    if(this.paused||!pointer||!mapButtonDown(pointer)){
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
    const pos=this.position as Point&{andar?:1};
    const at=this.selfShift.x||this.selfShift.y?{x:pos.x+this.selfShift.x,y:pos.y+this.selfShift.y,andar:pos.andar}:pos;
    // Card uno-bloqueio-corpo: near the Uno, on its side of the car's footprint (car-sort.ts); on a viaduct's deck the
    // hero is above the (ground) car.
    const p=this.project(at),own=this.depth(at),depth=at.andar===1?own:carSortDepth(at,own,this.chaveiro?.carSort());
    // Canopies soften only when they cover the hero; feet still define scene depth.
    let covered=false;
    for(const prop of this.props){const hides=this.propCovers(prop,p,depth);covered||=hides&&!!prop.tree;prop.object.setAlpha(hides?.55:1);}
    // Above the horde, numbers, pops and balloons (UX B7) unless a canopy is in front: then the sprite keeps its world
    // depth behind the tree and an 85% copy shows on top (UX-voce-e-dano: never hidden behind a canopy).
    // City: the same copy behind a building, wall or prop (the see-through's layers stack in a dense block).
    // Under a viaduct's deck (on the street) the hero gets the same see-through copy as behind a building.
    if(this.city)covered=this.city.covers(this.position.x,this.position.y)||this.position.andar!==1&&!!this.viaduct?.under(this.position.x,this.position.y);
    this.selfCovered=covered;
    // City: the hero stays at its actor depth (walls and buildings in front of it cover it, and turn translucent).
    this.actor.setPosition(p.x,p.y).setDepth(this.city?depth:covered?depth+1:SELF_DEPTH);
    this.heroGroundDepth=depth-2;
    this.heroSil??=silhouetteImage(this,'hero',depth-2);
    castSilhouette(this.heroSil,this.actor,p.x,p.y,true,depth-2);
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
    this.artMarks?.destination(marker?this.goal:undefined,this.actorScale,time,this.reduced,ALLY_DEPTH-1);
    const net=this.hooks.net,self=net?.players.get(net.id),state=net?.feed.players.get(net?.id??'');
    const p=this.project(this.position);
    // The ring's beak points where the hero last moved on screen.
    if(this.lastFeet)this.facing=facingFrom(p.x-this.lastFeet.x,p.y-this.lastFeet.y,this.facing);
    this.lastFeet=p;
    this.marks.unshift({id:'self',sprite:this.actor,self:true,feet:p,covered:this.selfCovered,facing:this.facing,
      hp:self?.hp??1,maxHp:state?.maxHp??(self?Math.max(self.hp,1):1),downed:!!state?.downed||(!!self&&self.hp<=0),
      slow:effectOn(state?.slowUntil,this.horde?.tick??0),slip:effectOn(state?.slipUntil,this.horde?.tick??0),
      ...(state?.ride&&effectOn(state.rideUntil,this.horde?.tick??0)?{ride:rideChip(state.ride,state.rideUntil!,this.horde?.tick??0)}:{})});
    this.you.setCity(this.cityMode);
    this.you.update(time,this.cameras.main.zoom,this.marks);
    this.marks.length=0;
  }
  /** Quality level (Q3): Leve is 30 fps, the reduced effects, the economy look (VGM-048) and a still scenery; Normal and Alta the full game. */
  setQuality(level:QualityLevel){
    this.quality=level;const profile=qualityProfile(level),on=profile.economy;this.economy=on;
    // A tap before the scene booted: create() applies it.
    if(!this.booted)return;
    this.horde?.setEffects(profile.effects);
    this.city?.setEconomy(on);this.city?.setStill(profile.still);
    this.applyGrade();
    if(this.stone)this.stone.economy=on;
    const towers=this.towers;if(towers)towers.economy=on; // their cast shadows (a renderer built later reads this.economy)
    // Phaser's frame gate (the game starts with fps.limit 60): changed live, the next frame already follows it.
    this.frameGate();
    this.fpsWatch.reset();
    this.horde?.setEnemyCap(profile.enemyCap); // Q3 fatia 4 (E2): teto de bichos desenhados por nível (150/300/3000)
  }
  /**
   * Phaser's frame gate (the game starts with fps.limit 60), changed live: the economy profile, or one frame every
   * CATCH_UP_GATE_MS while the page is far behind the room (N27, slow phone: drawing is what keeps it behind).
   */
  private frameGate(){
    const loop=this.game.loop as unknown as {fpsLimit:number;hasFpsLimit:boolean;_limitRate:number},fps=qualityProfile(this.quality).fps;
    loop.fpsLimit=fps;loop.hasFpsLimit=true;loop._limitRate=this.catchUp.on?CATCH_UP_GATE_MS:frameGateMs(fps);
  }
  private vignette?:Vignette;
  private nevoa?:Nevoa;
  /** The chefão's arena in the dark (boss-fim-onda-1, render/arena-rules.ts): built on the first chefão. */
  private readonly arenaClock=new ArenaClock();
  /** Who the server keeps untouchable (getting up, the start grace): their sprite blinks (you-rules.ts SafeClock). */
  private readonly safe=new SafeClock();
  private arenaDark?:ArenaDark;
  private readonly arenaSpots:ArenaSpotPx[]=[];
  /** A circle of `radius` u around `at` as drawn (world px ellipse). */
  private groundEllipse(at:Point,radius:number):ArenaSpotPx{
    const c=this.project(at),u=this.project({x:at.x+radius,y:at.y}),v=this.project({x:at.x,y:at.y+radius});
    return {x:c.x,y:c.y,rx:Math.hypot(u.x-c.x,v.x-c.x),ry:Math.hypot(u.y-c.y,v.y-c.y)};
  }
  /**
   * While the 1st wave's chefão stands the map goes dark: only his arena, the own hero, the allies on their feet and the
   * Uno stay lit (the user, 24/10: "fear avançada"). The fear's dark (alone) draws over it.
   */
  private drawArena(delta:number){
    const net=this.hooks.net!,combat=net.run?.phase==='combat';
    const boss=combat?arenaBoss(net.feed.enemies.values()):undefined;
    if(!combat)this.arenaClock.reset();
    if(!boss&&!this.arenaDark)return;
    const frame=this.arenaClock.step(boss,delta);
    if(frame.alpha<=0||!frame.at){this.arenaDark?.hide();return;}
    // Every radius is where its soft edge is half dark (the light texture is clear to LIGHT_CORE of its size).
    const out=this.arenaSpots,grow=spotScale(LIGHT_CORE);out.length=0;
    out.push(this.groundEllipse(frame.at,ARENA.radius*grow),this.groundEllipse(this.position,ARENA.heroLight*grow));
    if(boss){
      // His body: an upright ellipse over his drawing (he stands several heroes tall), as drawn, not eased.
      const feet=this.project(boss),h=artTargetHeight(boss.kind)*this.actorScale*ENEMY_DRAW_SCALE;
      out.push({x:feet.x,y:feet.y-h*.45,rx:h*ARENA.bodyLight*.6*grow,ry:h*ARENA.bodyLight*grow});
    }
    for(const p of net.feed.players.values()){
      if(p.id===net.id||p.spectator||p.downed||p.eliminated||!(p.hp>0))continue;
      const at=this.drawnFeet.get(p.id)??(p.x!==undefined&&p.y!==undefined?{x:p.x,y:p.y}:undefined);
      if(at)out.push(this.groundEllipse(at,ARENA.allyLight*grow));
    }
    const car=this.chaveiro?.carPose();
    if(car)out.push(this.groundEllipse(car,ARENA.unoLight*grow));
    (this.arenaDark??=this.makeArenaDark()).draw({alpha:frame.alpha,spots:out});
  }
  /** Released with the scene (stop → 'shutdown', game.destroy → 'destroy'): a rematch builds a new one. */
  private makeArenaDark(){
    const dark=new ArenaDark(this);
    const drop=()=>{dark.destroy();if(this.arenaDark===dark)this.arenaDark=undefined;this.arenaClock.reset();this.events.off('shutdown',drop);this.events.off('destroy',drop);};
    this.events.once('shutdown',drop);this.events.once('destroy',drop);
    return dark;
  }
  /** Fear (card fear-escuridao-sozinho, render/fear-rules.ts): the clock and the dark, built on the first fear. */
  private readonly fearClock=new FearClock();
  private fearDark?:FearDark;
  private fearOn=false;
  private fearAt?:number;
  private readonly fearSpots:FearSpotPx[]=[];
  /**
   * The dark around the own hero (the server's fear 0..1), the safe spots (allies on their feet, the Uno) lit in it
   * and the arrow to the nearest; the HUD gets the frame (notice, portraits, sound) through hooks.fear.
   */
  private drawFear(time:number,delta:number){
    const net=this.hooks.net!,me=net.feed.players.get(net.id),combat=net.run?.phase==='combat';
    const raw=combat&&me&&!me.downed&&!me.eliminated&&!me.spectator&&me.hp>0?me.fear??0:0;
    if(!combat&&this.fearOn)this.fearClock.reset();
    if(raw<=0&&!this.fearOn)return;
    // The wall clock between calls (Phaser's delta is smoothed and capped): a slow page still catches up.
    const dt=this.fearAt===undefined?delta:time-this.fearAt;this.fearAt=time;
    const frame=this.fearClock.step(raw,dt,time,this.reduced);
    // Card heroi-fala-cade-amigos: the hero's own line over the last stretch, the cast's balloon over the head; drawn
    // here only, so only this player sees it. A priority line: a recent "Segura aí" does not swallow it.
    if(frame.say)this.horde?.speak(net.id,frame.say,undefined,true);
    const lit=frame.look.alpha>0||frame.alone;
    this.fearOn=lit||frame.seconds>0;
    const car=this.chaveiro?.carPose(),uno=car?{x:car.x,y:car.y}:worldBase(net.terrain);
    const players=[...net.feed.players.values()].map(p=>{const at=this.drawnFeet.get(p.id);return at?{...p,x:at.x,y:at.y}:p;});
    const spots=lit?safeSpots(net.id,this.position,players,uno):[];
    this.hooks.fear?.(frame,frame.alone?spots.filter(s=>s.kind==='aliado').map(s=>s.id!):[]);
    if(!lit){this.fearDark?.hide();this.vignette?.cover(false);return;}
    const dark=this.fearDark??=new FearDark(this),out=this.fearSpots;out.length=0;
    for(const s of spots){
      const c=this.project(s),u=this.project({x:s.x+s.radius,y:s.y}),v=this.project({x:s.x,y:s.y+s.radius});
      out.push({x:c.x,y:c.y,rx:Math.hypot(u.x-c.x,v.x-c.x),ry:Math.hypot(u.y-c.y,v.y-c.y)});
    }
    const box=this.heroWorldBox(),hero={x:box.x+box.width/2,y:box.y+box.height/2};
    // While the hero's line is up the arrow waits: around the head it would cross the balloon's text.
    const near=frame.alone&&!frame.saying?spots[0]:undefined,to=near?this.project(near):undefined;
    dark.draw({alpha:frame.look.alpha,hole:frame.look.hole*(1-FEAR_BEAT_PULL*frame.beat),hero,spots:out,
      ...to?{arrow:{x:to.x,y:to.y}}:{},bob:this.reduced?0:(Math.sin(time/180)+1)/2});
    this.vignette?.cover(dark.covering);
  }
  /** The vignette strength of the world shown (city, endless, island); economy mode hides it. */
  private applyGrade(){const world=isCityWorld(this.field)?'cidade':this.field.chunks?'infinito':'ilha';this.vignette?.set(world,this.economy);this.nevoa?.set(world,this.economy);}
  private readonly catchUp=new CatchUp();
  /** Catching up with the room (slow phone): the lab probe and the tests read it. */
  get catchingUp(){return this.catchUp.on;}
  get economyOn(){return this.economy;}
  get qualityLevel(){return this.quality;}
  /** Frames per second of the last whole watch windows (lab report and DEV probe). */
  get fpsHistory():readonly number[]{return this.fpsWatch.history;}
  private watchFrames(time:number){
    const net=this.hooks.net,last=this.lastFrameAt;this.lastFrameAt=time;this.frameMs=last===undefined?0:time-last;
    if(net&&this.booted){
      const was=this.catchUp.on;
      if(this.catchUp.update(document.hidden?0:net.backlog.ms,time)!==was){this.frameGate();this.fpsWatch.taint();}
      if(this.catchUp.on){this.fpsWatch.taint();return;}
    }
    if(!net||this.quality==='leve'||this.fpsWatch.done||last===undefined)return;
    if(document.hidden){this.fpsWatch.taint();return;}
    if(this.paused||net.run?.phase!=='combat'){this.fpsWatch.reset();return;}
    if(this.fpsWatch.frame(time-last))this.hooks.slow?.();
  }
  private stepChefaoArt(){
    const net=this.hooks.net;if(!net||!this.elenco)return;
    const run=net.run,now=performance.now();
    const {load,release}=this.chefaoArt.step({elenco:this.elenco,combat:run?.phase==='combat',nowMs:now,tick:net.tick,
      ...(run?.minervaAteTick!==undefined?{minervaAteTick:run.minervaAteTick}:{}),...(run?.cena?{cenaWho:run.cena.who}:{})});
    for(const id of load)queueEnemyArt(this,id);
    for(const id of release){
      // Another of his kind still stands (a mini-chefe of the same art): later.
      if([...net.feed.enemies.values()].some(e=>e.kind===id&&e.hp>0))this.chefaoArt.killed(id,now);
      else releaseEnemyArt(this,id);
    }
  }
  update(_time:number,delta:number){
    this.watchFrames(_time);
    if(this.rightHeld){const pointer=this.input.mousePointer;if(this.paused||!pointer?.rightButtonDown())this.rightAttack(false);}
    // The room named the run's drawn enemies ({t:'elenco'}): their imported art loads now, before they show up; not
    // while the city's near art is held (~15 MB of enemies in Phaser's first-in first-out loader held the relief
    // albedo, and the bandwidth, behind them: partida-abre-com-P0). They come right after the cover goes, as before.
    const elenco=this.hooks.net?.elenco;
    // The HD chefões (~390 MB each) wait for their moment instead (art/chefao-art.ts, BUG-20261025-ORQ-celular-travando).
    if(elenco&&elenco!==this.elenco&&!this.cityHeld){this.elenco=elenco;for(const id of elenco)if(!chefaoDeferred(id))queueEnemyArt(this,id);}
    if(this.elenco)this.stepChefaoArt();
    this.vignette?.update();
    this.nevoa?.update(delta);
    this.landscape?.update(_time,this.reduced||this.paused||document.hidden);
    if(!this.actor)return;
    this.artMarks?.begin();
    // The net's terrain became another world (island/endless ↔ city): one field swap, new zoom, figure scale and camera.
    // A reconnect to the same map (a new but identical TerrainField) changes nothing.
    if(this.terrainWatch.sync(this.hooks.net?.terrain))this.swapWorld();
    this.drawLabels();
    const self=this.hooks.net?.players.get(this.hooks.net.id);
    // Pushing the Uno (empurrar-uno): faces it with the push clip, drawn with the palms on it (place() adds the shift).
    const pose=this.chaveiro?.carPose(),meId=this.hooks.net?.id,push=pose&&meId&&pose.pushers.includes(meId)?pushContact(this.position,pose,this.intent,d=>pushReach(d,this.view)):undefined;
    this.selfShift=this.pushShifts.step(meId??'',push?.shift,delta);
    // On the rope (puxar-uno-corda): faces away from the bumper with the pull clip.
    const pull=pose&&meId&&pose.puller===meId?pullDirection(this.position,pose):undefined;
    // While the aim stick aims, the body looks that way (twin-stick); the legs still walk where the left stick goes.
    // A held stick or attack button is input too, every frame it is held (the dance waits for the hands off).
    if(this.intent.x||this.intent.y||this.hooks.aimStick?.()||(this.hooks.attackHeld??this.hooks.attacking)?.())this.inputAt=this.time.now;
    this.sprites.danceCue(this.actor,{allowed:meId?danceAllowed(this.hooks.net?.feed.players.get(meId),this.horde?.tick??0,isWeaponItem):true,poke:this.inputAt,...(meId?{cheer:Math.max(this.cheers.of(meId)??-Infinity,this.hooks.danceAt?.(meId)??-Infinity)}:{})});
    // The local swing: the predicted one on the press, the room's only when it was not predicted (net/attack-predict.ts).
    const net=this.hooks.net,swing=net?net.attackPredict.swingTick(self?.attackTick??0,performance.now()):self?.attackTick??0;
    this.sprites.animate(this.actor,this.hooks.classId,this.position.x,this.position.y,swing,self?.hp!==0,this.view,this.intent,push?.dir??pull,self?.hp,this.hooks.aimStick?.(),meId&&this.shopWorkers.has(meId)?workFacing(this.view):buildFacing(this.position,this.obras),
      !!meId&&!!net?.feed.players.get(meId)?.downed&&!net.feed.players.get(meId)!.eliminated,meId?net?.feed.players.get(meId):undefined);
    this.thrown();
    if(this.hooks.visual&&(_time-this.visualAt>=VISUAL_HOOK_MS||_time<this.visualAt)){
      this.visualAt=_time;
      this.hooks.visual(this.actor.anims.currentAnim?.key??'fallback',String(this.actor.frame.name),this.textures.getTextureKeys().filter(k=>k.startsWith('sprite:')||k.startsWith('sprite128:')).length);
    }
    // City: re-base only before actors are placed (the origin may trail the hero by a frame, harmless), so nobody is
    // drawn for a frame with the old origin across the buildings. Elsewhere the order is unchanged.
    if(this.hooks.net){
      if(this.city){this.rebaseDepth();this.updateCoop(_time,delta);}else{this.updateCoop(_time,delta);this.rebaseDepth();}
      this.updateCamera(delta);this.shakeCamera();this.updatePip(_time);this.drawYou(_time);this.drawArena(delta);this.drawFear(_time,delta);return;
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
      needArt:kind=>this.needTowerArt(kind),
      cell:()=>this.field instanceof CityTerrain?this.field.asset.unitsPerCell:undefined,
      depthVersion:()=>this.city?.columnsVersion??0,
      world:{view:()=>this.view,depth:(x,y)=>this.depth({x,y}),effectDepth:(x,y)=>this.city?this.city.effectDepth(x,y):this.depth({x,y}),
        project:(x,y,z,out)=>{const p=this.project({x,y});out.x=p.x;out.y=p.y-z*HEIGHT_PX;return out;}}});
  }
  /** D-052 slice 4: the walls and the rope (the layer is made on the first snapshot that needs it). */
  private pushFortify(view:RunView){
    if(!this.fortify&&!needsFortify(view))return;
    this.makeFortify()?.push(view);
  }
  private makeFortify(){
    const net=this.hooks.net;
    if(!this.fortify&&this.projector&&net)this.fortify=new FortifyRenderer(this,{projector:this.projector,reduced:this.reduced,
      cell:(this.buildPlan??=buildPlanFor(this.field)).cell,
      playerAt:id=>id===net.id?this.position:net.players.get(id),carHeading:()=>this.chaveiro?.carHeading??0,
      // barricada-tocar-no-mapa: a kit de torre's ghost is the tower's art (the renderer is made for it if need be).
      towerGhost:g=>g?(this.towers??this.makeTowers()).setGhost({...g,kind:g.kind as TowerKind}):(this.towers?.setGhost(null),false)});
    return this.fortify;
  }
  /**
   * D-052 slice 4, for the build HUD (E4) and the sandbox: the ghost under the finger (null: not building) and the
   * faint hints near the car (fortify-rules buildHints).
   */
  setBuildGhost(ghost:GhostInput|null,hints:readonly CellRect[]=[]){
    if(!ghost&&!this.fortify)return;
    const f=this.makeFortify();f?.setGhost(ghost);f?.setHints(ghost?hints:[]);
  }
  /** barricada-construir part 2 (hud/tralha): the barricada square that wears the gold outline (undefined: none). */
  setTralhaOutline(id:string|undefined){if(this.stone)this.stone.outline=id;}
  /** D-052 slice 3 (the build HUD aims the ghost): the ground point (world u) under a client point (CSS px, viewport). */
  worldAt(clientX:number,clientY:number):Point|undefined{
    const canvas=this.game.canvas;
    if(!canvas)return undefined;
    const r=canvas.getBoundingClientRect();
    if(!r.width||!r.height)return undefined;
    const p=this.cameras.main.getWorldPoint((clientX-r.left)*this.scale.width/r.width,(clientY-r.top)*this.scale.height/r.height);
    return unprojectView(p,this.view,this.field);
  }

  /**
   * D-047: a new snapshot for the chaveiro objective (RunView.objective). The renderer is built on the first view that
   * has one, on the scene's projector (the city's actor depth), and fades a figure that covers the hero.
   */
  private pushChaveiro(view:RunView,time:number){
    const objective=objectiveOf(view);
    if(!objective&&!this.chaveiro)return;
    if(!this.chaveiro&&this.projector)this.chaveiro=new ChaveiroRenderer(this,{projector:this.projector,reduced:this.reduced,hero:()=>this.watchPoint??this.position});
    this.chaveiro?.push(objective,view.tick);
    this.talk??=new ChaveiroTalk(talkSeed(this.hooks.net?.code??'',this.field.seed));
    this.talk.push(objective,view.events as readonly LooseEvent[],view.tick,time);
  }
  /**
   * D-047 (card chaveiro-falas): the cast's line due now, if any (talk.ts), in the zueiras' balloon: the chaveiro and
   * Cida over the moto (or him where he stands), the Tio beside the car, the alarm over it. The end of the run
   * comes from the result too (RunState.objective, protocol 15, read loosely).
   */
  private speakChaveiro(time:number){
    const talk=this.talk,net=this.hooks.net;
    if(!talk||!this.chaveiro||!this.horde)return;
    talk.result((net?.run as {objective?:unknown}|undefined)?.objective,time);
    const said=talk.take(time);
    if(!said)return;
    const chaveiro=this.chaveiro;
    this.horde.speak(`chaveiro:${said.speaker}`,said.text,()=>chaveiro.speechAnchor(said.speaker),said.priority);
  }
  /**
   * D-051 (ninhos-arte-render): the snapshot's nests (structures of kind 'ninho') drawn on the city ground with their
   * art for the state (render/city/live/nests.ts); at the actors' point and depth, so heroes and enemies sort with them.
   */
  private pushNests(view:RunView){
    const vivo=this.city?.vivo;
    if(!vivo)return;
    vivo.setNests(nestsFromStructures(view.structures),this.view,(x,y)=>{const p=this.project({x,y});return {x:p.x,y:p.y,depth:this.depth({x,y})};});
  }
  /** Bancos (card bancos-e-veiculos): the run's ATMs (RunView.banks, the city in both modes); built on the first view that has them. */
  private pushBanks(view:RunView){
    if(!view.banks?.length&&!this.banks)return;
    if(!this.banks&&this.projector)this.banks=new BankRenderer(this,{projector:this.projector,reduced:this.reduced,hero:()=>this.watchPoint??this.position,
      nameOf:id=>{const net=this.hooks.net;return id===net?.id?'Você':net?.players.get(id)?.name??'Alguém';},playerAt:id=>{const net=this.hooks.net;return id===net?.id?this.position:net?.players.get(id);}});
    this.banks?.push(view.banks,view.tick,view.events);
    this.shopWorkers.clear();
    for(const b of view.banks??[])for(const id of b.workers??[])this.shopWorkers.add(id);
  }
  /**
   * Bicos: the players on a shift now (RunView.banks workers). A class with a work16 (card animacao-trabalhar-6) stays in
   * the ring playing it, facing the camera (workFacing); one without goes in through the door and nobody draws it.
   */
  private readonly shopWorkers=new Set<string>();
  /** A new snapshot for the defenses: their views (TowerFeed: inferred volleys) and the live enemies they aim at. */
  private pushTowers(view:RunView,time:number){
    if(!this.towers&&!hasTowers(view.structures))return; // no defense yet: nothing built, nothing walked
    const towers=this.towers??this.makeTowers();
    const plan=this.buildPlan??=buildPlanFor(this.field);
    const enemies=view.enemies;let a=this.towerAim;
    if(a.xs.length<enemies.length){const n=Math.max(enemies.length,a.xs.length*2);a=this.towerAim={n:0,xs:new Float32Array(n),ys:new Float32Array(n),air:new Uint8Array(n)};}
    let n=0;
    for(const e of enemies){
      if(e.hp<=0||isAsleep(e))continue; // the sim's towers only see ctx.enemies, never a nest's sleepers (D-051)
      a.xs[n]=e.x;a.ys[n]=e.y;a.air[n]=ENEMY_ART[enemyKind(e.kind)].hover>0?1:0;n++;
    }
    a.n=n;towers.setEnemies(n,a.xs,a.ys,a.air);
    const views=this.towerFeed.views(view.structures,view.tick,plan.cell,{railAxis:plan.rail?.axis,enemies:a});
    this.obras=views.filter(v=>isObraPhase(v.phase));
    towers.push(view.tick,views,time);
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
  /**
   * A heavy impact shakes the screen (none with reduced motion): added after the camera's own centring. The towers' shells
   * and a hit that hurts the local hero (zueira-fx.ts, card levelup-estouro-e-tremida) add up.
   */
  private shakeCamera(){
    const cam=this.cameras.main,o=this.shakeAt;
    for(const source of [this.towers,this.zueira]){
      if(!source)continue;
      source.shakeOffset(cam.zoom,o);
      if(o.x||o.y){cam.scrollX+=o.x;cam.scrollY+=o.y;}
    }
  }
  /** The hero's body height on screen (scene px), to size the level-up burst around it. */
  private heroBodyPx(){return this.actor.displayHeight*HERO_BODY_SHARE;}
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
  /** R$ of the cédulas the hero caught on screen that the room has not paid yet (render/cedula-catch.ts; the top bar shows them). */
  pendingGrana(){return this.horde?.pendingGrana()??0;}
  /** Cédulas the hero caught on screen so far: hud/rescue.ts clinks on each new one. */
  cedulasCaught(){return this.horde?.caughtCount??0;}
  /** The room's 'pickup' event of a cédula whose clink already played at the catch (it plays nothing). */
  cedulaHeard(event:{type:string;pickup?:string;kind?:string}){return !!this.horde?.cedulaHeard(event);}
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
  /**
   * What a floating HUD card must never cover (perfil-nao-cobre): the hero (or the one watched), the Uno and every ally
   * drawn, CSS px like heroScreenRect.
   */
  guardScreenRects(){
    const cam=this.cameras.main,out:{x:number;y:number;width:number;height:number}[]=[];
    const screen=(b:{x:number;y:number;width:number;height:number})=>({x:(b.x-cam.worldView.x)*cam.zoom,y:(b.y-cam.worldView.y)*cam.zoom,width:b.width*cam.zoom,height:b.height*cam.zoom});
    const hero=this.heroScreenRect();if(hero)out.push(hero);
    const uno=this.chaveiro?.unoWorldBox();if(uno)out.push(screen(uno));
    for(const [id,a] of this.remoteActors)if(a.image.visible)out.push(screen(this.figureWorldBox(a.image,this.hooks.net?.players.get(id)?.classId??this.hooks.classId)));
    return out;
  }
  /** The hero's drawn figure in world px (all its animation frames together); the whole frame until the sheet loads. */
  private heroWorldBox(){return this.figureWorldBox(this.actor,this.hooks.classId);}
  private figureWorldBox(a:Phaser.GameObjects.Sprite,classId:string){
    const f=a.texture.key.startsWith('sprite:')||a.texture.key.startsWith('sprite128:')?this.sprites.figureIn(a,classId):undefined;
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
    // exploracao-espera-carregar: the first combat frame with the island on screen (hooks.ready, past the city art's
    // hold) tells the room this phone is in; the Minerva waits for it.
    if(phase!=='combat')this.loadSaid=false;else if(!this.readyHeld&&!this.loadSaid){this.loadSaid=true;net.loaded();}
    this.lastPhase=phase;
    // D-050: a level-up pause holds the controls like the player's own pause (the room is not stepping).
    const frozen=this.paused||!!net.run?.pause;
    // The level-up burst plays when the pause opens too, if the levelup event did not come first (one per level).
    if(net.run?.pause)this.zueira?.levelUp(net.run.pause.level);
    const axis=frozen?{x:0,y:0}:this.hooks.direction(),keys=frozen?{sx:0,sy:0}:this.keyAxis();
    const sx=axis.x+keys.sx,sy=axis.y+keys.sy;
    const still=frozen||!net.connected||!net.players.get(net.id)?.hp||net.run?.phase!=='combat'||!!net.players.get(net.id)?.spectator;
    // Out: the thumbs steer the ghost (updateWatch); the room gets a standing hero, as before.
    const out=this.isOut();
    this.ghostSteer=out&&Math.hypot(sx,sy)>.05?screenDirection(sx,sy,this.view):{x:0,y:0};
    // No walk to follow while the hero cannot walk (no path search every 150 ms in the waiting room or while down).
    this.followHold(time,still||Math.hypot(sx,sy)>.05);
    if(still){this.attackTarget=undefined;this.route=[];}
    if(this.attackTarget&&!net.feed.enemies.has(this.attackTarget)){this.attackTarget=undefined;this.hooks.message(this.hooks.manual?.()?'Alvo derrotado. O ataque volta pra mira automática.':'Alvo derrotado. A arma segue atirando sozinha.');}
    this.horde?.setTarget(this.attackTarget);
    // Only a new tick moves the horde: an offers-only change (push from the room) refreshes the HUD alone,
    // or the renderer would restart its interpolation and stutter on every offer.
    if(net.feed.stateVersion!==this.stateVersion){
      this.stateVersion=net.feed.stateVersion;this.offersVersion=net.feed.offersVersion;
      const runView=net.feed.take();
      // D-051 nests: calm around this hero stands for the intermission (calm-phase.ts).
      this.roundPhase=effectivePhase(runView,net.predicted);this.viewTick=runView.tick;
      // The match is on (a round in the room's run view, drawn by this scene): the production smoke (scripts/smoke-prod.mjs)
      // waits for this flag, not for a HUD element that a HUD card may move or hide.
      if(runView.round&&runView.tick>0&&!matchSignalled){matchSignalled=true;(window as unknown as {__partidaPronta?:boolean}).__partidaPronta=true;}
      if(arrowTrigger(runView.events,net.id))this.you?.showArrow(time);
      this.safe.push(runView.tick,runView.events,!!runView.round);
      this.cheers.push(this.time.now,runView.events,runView.players.map(p=>{const at=net.players.get(p.id);return {id:p.id,x:at?.x??NaN,y:at?.y??NaN,bot:!!p.bot};}),runView.enemies);
      this.horde?.push(runView);this.stone?.push(runView);this.zueira?.push(runView);this.pushTowers(runView,time);this.pushChaveiro(runView,time);this.pushFortify(runView);this.pushBanks(runView);this.pushNests(runView);
      this.hooks.runView?.(runView);
    }else if(net.feed.offersVersion!==this.offersVersion){
      this.offersVersion=net.feed.offersVersion;
      const runView=net.feed.peek();this.roundPhase=effectivePhase(runView,net.predicted);
      this.hooks.runView?.(runView);
    }
    this.zueira?.update(time);this.horde?.update(time,delta);this.stone?.update(time);this.chaveiro?.update(time);this.speakChaveiro(time);this.fortify?.update(time);this.banks?.update(time);this.updateTowers(time,delta);
    this.accumulator=stepClock(this.accumulator,this.frameMs);
    this.steps.sync(net.predicted);
    // PC: the melee swing goes where the mouse points (the ground under it, from the hero; cone-ataque-melee).
    const mouse=this.mouseGround();
    while(this.accumulator>=STEP){
      let direction={x:0,y:0};
      if(!out&&Math.hypot(sx,sy)>.05){this.route=[];direction=screenDirection(sx,sy,this.view);}
      if(!frozen&&Math.hypot(sx,sy)<=.05&&this.route.length){
        while(this.route.length&&Math.hypot(this.route[0].x-net.predicted.x,this.route[0].y-net.predicted.y)<.18)this.route.shift();
        if(this.route.length)direction={x:this.route[0].x-net.predicted.x,y:this.route[0].y-net.predicted.y};
      }
      this.intent=net.players.get(net.id)?.hp&&net.run?.phase==='combat'?direction:{x:0,y:0};
      if(Math.hypot(this.intent.x,this.intent.y)>1e-6)this.lastIntent=this.intent;
      // The skill goes by its own tap message (net.cast); the D-051 attack rides the step (segment bit 1).
      const aim=mouse?{x:mouse.x-net.predicted.x,y:mouse.y-net.predicted.y}:this.hooks.aimStick?.();
      // Bicos: Trabalhar rides the step too (moving lets it go: hud/bicos.ts WorkLatch).
      const work=!frozen&&!out&&!!this.hooks.working?.(direction);
      net.input(direction,false,this.attackTarget,!work&&!frozen&&!out&&!!this.hooks.attacking?.(),aim,work);this.accumulator-=STEP;
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
    const unitPx=this.unitPx(smooth),last=this.lastSmooth;this.lastSmooth=smooth;
    this.correction.step(delta,unitPx,last&&{x:smooth.x-last.x,y:smooth.y-last.y});
    this.displayed={x:smooth.x+this.correction.x,y:smooth.y+this.correction.y};
    // The floor comes with the prediction (maps prediction.ts FloorPoint): the hero on a viaduct's deck is drawn on it.
    this.position={...this.displayed,...(net.predicted.andar===1?{andar:1 as const}:{})};this.distance+=Math.hypot(old.x-this.position.x,old.y-this.position.y);this.place();
    this.horde?.selfCone(this.position,this.heroGroundDepth);
    const mine=net.feed.players.get(net.id),selfDown=!!mine?.downed&&!mine.eliminated;
    // A caído lies down (UX-resgate-e-ping): its fall (downed16, queda-6-herois) or, without one, turned on its feet; still
    // opaque enough to be found; out/watching fades.
    this.actor.setAlpha(safeAlpha(selfDown?.85:!net.players.get(net.id)?.spectator&&(net.players.get(net.id)?.hp??100)>0?1:.4,this.safe.on(net.id,this.viewTick),time,this.reduced)).setAngle(selfDown&&!hasDowned16(this.hooks.classId)?-90:0);
    // Bicos: without a work16 the hero is gone through the shop's door (the silhouette follows the body's alpha).
    if(this.shopWorkers.has(net.id)&&!hasWork16(this.hooks.classId))this.actor.setAlpha(0);
    const marks=this.downedMarks;marks.length=0;
    if(selfDown)marks.push({id:net.id,at:this.position,progress:mine!.downed!.progress});
    const ids=new Set(view.players.filter(p=>p.id!==net.id).map(p=>p.id));
    for(const [id,objects] of this.remoteActors)if(!ids.has(id)){this.pushShifts.forget(id);objects.image.destroy();objects.label.destroy();objects.ring.destroy();objects.sil?.destroy();this.remoteActors.delete(id);this.you?.forget(id);this.allyRings?.forget(id);}
    // Waiting room (D-025, UX review): six standing on the spawn turn their name fichas into one blot; each ficha that
    // would land on an earlier one steps one row down, so the names read as a short list under the group.
    const stagger=this.labelPhase()!=='combat'&&this.labelPhase()!=='interval',placedLabels:Point[]=[],zoomNow=this.cameras.main.zoom,city=this.cityMode;
    const carPose=this.chaveiro?.carPose(),carSort=this.chaveiro?.carSort();
    this.allyFeet=[];
    const feet=this.drawnFeet;feet.clear();feet.set(net.id,{x:this.position.x+this.selfShift.x,y:this.position.y+this.selfShift.y});
    for(const player of view.players){
      if(player.id===net.id)continue;
      if(city&&player.online&&!player.spectator)this.allyFeet.push({x:player.x,y:player.y});
      // Ally ground ring in Breu: the old light cyan one vanished on sand and shallow water (D-022).
      let objects=this.remoteActors.get(player.id);
      const k=this.heroScale;
      if(!objects){objects={image:sunlit(this.add.sprite(0,0,this.classIcon(player.classId)).setOrigin(.5,.88).setDisplaySize(100*k,100*k)),label:new MapLabel(this,''),ring:this.add.ellipse(0,0,ALLY_RING_SIZE.width,ALLY_RING_SIZE.height).setStrokeStyle(2,tokenColor('--c-breu'),.8).setScale(k)};this.remoteActors.set(player.id,objects);}
      // Joined before its icon was here (N27: icons of the room's classes only): the icon replaces the silhouette once in.
      else if(objects.image.texture.key===STAND_IN_KEY&&this.textures.exists(`class:${player.classId}`))objects.image.setTexture(`class:${player.classId}`).setDisplaySize(100*k,100*k);
      const push=carPose?.pushers.includes(player.id)?pushContact(player,carPose,undefined,d=>pushReach(d,this.view)):undefined,shift=this.pushShifts.step(player.id,push?.shift,delta);
      // An ally dances too when it has stood still for a while (danca-no-jogo): its moves and swings show it. A room bot
      // dances only when it cheers (a round won, the team's level-up, a big enemy down near it).
      this.sprites.danceCue(objects.image,{allowed:danceAllowed(net.feed.players.get(player.id),this.horde?.tick??0,isWeaponItem),idle:!net.feed.players.get(player.id)?.bot,cheer:Math.max(this.cheers.of(player.id)??-Infinity,this.hooks.danceAt?.(player.id)??-Infinity)});
      const pull=carPose?.puller===player.id?pullDirection(player,carPose):undefined;
      const st=net.feed.players.get(player.id),down=!!st?.downed&&!st.eliminated;
      this.sprites.animate(objects.image,player.classId,player.x,player.y,player.attackTick??0,player.hp>0&&player.online,this.view,undefined,push?.dir??pull,player.hp,undefined,this.shopWorkers.has(player.id)?workFacing(this.view):buildFacing(player,this.obras),down,st);
      // The floor travels with the drawn point (a hero on a viaduct's deck is lifted onto it, above the ground car).
      const drawnAt=shift.x||shift.y?{x:player.x+shift.x,y:player.y+shift.y,andar:player.andar}:player;
      const own=this.depth(drawnAt),q=this.project(drawnAt),depth=player.andar===1?own:carSortDepth(drawnAt,own,carSort),covered=this.city?this.city.covers(player.x,player.y)||player.andar!==1&&!!this.viaduct?.under(player.x,player.y):this.treeCovers(q,depth);
      feet.set(player.id,{x:drawnAt.x,y:drawnAt.y});
      const inShop=this.shopWorkers.has(player.id)&&!hasWork16(player.classId);
      objects.image.setPosition(q.x,q.y).setDepth(this.city?depth:covered?depth+1:ALLY_DEPTH).setAlpha(safeAlpha(inShop?0:down?.85:!player.spectator&&player.online&&player.hp?1:.4,this.safe.on(player.id,this.viewTick),time,this.reduced)).setAngle(down&&!hasDowned16(player.classId)?-90:0);
      if(down)marks.push({id:player.id,at:{x:player.x,y:player.y},progress:st!.downed!.progress});
      objects.ring.setPosition(q.x,q.y).setDepth(depth-1);
      // Each ally casts its frame on the ground like the hero (card sombra-silhueta), in every world and quality.
      objects.sil??=silhouetteImage(this,'hero',depth-2);
      castSilhouette(objects.sil,objects.image,q.x,q.y,true,depth-2);
      // Imported ring (the "Você" ring tinted Breu) at today's outer width and depth: the ellipse hides while it draws.
      if(this.allyRings?.draw(player.id,q.x,q.y,ALLY_RING_WIDTH*k,depth-1,time,this.reduced))objects.ring.setVisible(false);
      else if(!objects.ring.visible)objects.ring.setVisible(true);
      if(covered)this.marks.push({id:player.id,sprite:objects.image,self:false,feet:q,covered,hp:player.hp,maxHp:player.hp,downed:false});
      const state=net.feed.players.get(player.id),downed=!!state?.downed&&!state.eliminated;
      // Ally fichas at 13 px CSS: names in the waiting room, and in a run only who is caído, as an SOS ficha (onda 4).
      objects.label.setSos(downed).setCity(city).setText(allyLabelText(player.name,{spectator:player.spectator,eliminated:state?.eliminated,downed,online:player.online},downed&&state?.downed?secondsLeft(state.downed.bleedOutTick,this.viewTick):undefined))
        .anchor(q.x,stagger?this.staggerLabel(placedLabels,q.x,q.y+15*k,zoomNow):q.y+15*k,covered&&!this.city?depth+2:ALLY_DEPTH+1).draw(this.cameras.main.zoom,mapLabelVisible('ally',this.labelPhase(),downed));
    }
    // In the blackout the caídos' rings and light columns go above the dark (VGM-053B).
    this.downedLayer?.update(marks,this.view,1/Math.max(.05,this.cameras.main.zoom),(this.zueira?.last.dark??0)>0?LIFTED_DEPTH:undefined);
    // Own caído ficha: same SOS ficha as an ally's, with "Você" and the seconds left.
    if(selfDown||this.selfLabel){
      const label=this.selfLabel??=new MapLabel(this,'');const q=this.project(this.position);
      label.setSos(selfDown).setCity(this.cityMode).setText(allyLabelText('Você',{downed:selfDown},selfDown?secondsLeft(mine!.downed!.bleedOutTick,this.viewTick):undefined))
        .anchor(q.x,q.y+15*this.heroScale,SELF_DEPTH+1).draw(this.cameras.main.zoom,selfDown);
      // Who got you (card nome-inimigo-rede-social, etapa 7): the profile's name in a second ficha right under it.
      if(this.fallenBy||this.fallenLabel){
        const by=this.fallenLabel??=new MapLabel(this,'');
        by.setCity(this.cityMode).setSolid(true).setInside(true).setText(this.fallenBy??'').anchor(q.x,q.y+15*this.heroScale+stackedLabelOffsetCss(ENEMY_NAME_H_CSS,true,this.cityMode)/Math.max(.05,this.cameras.main.zoom),SELF_DEPTH+1)
          .draw(this.cameras.main.zoom,selfDown&&!!this.fallenBy);
      }
    }
    // The weapons in the hands, now that the hero and the allies stand on this frame's spot and pose (arma-flutua).
    this.horde?.hands();
    this.horde?.auras(id=>feet.get(id));
    this.updateWatch(view.players,delta);
    if(!this.route.length)this.destination.clear();
    this.stamp+=delta;if(this.stamp>100){this.stamp=0;this.hooks.position(this.position);}
  }
  /** Out of the run (bled out) or watching mid-run, in a round. */
  private isOut(){
    const net=this.hooks.net;if(!net)return false;
    return net.run?.phase==='combat'&&(!!net.feed.players.get(net.id)?.eliminated||!!net.players.get(net.id)?.spectator);
  }
  /**
   * Out (eliminated) or watching mid-run: the ghost walks the map (morto-anda-pelo-mapa), or the camera follows a
   * teammate instead of one's own body (UX onda 4).
   */
  private updateWatch(players:readonly {id:string;x:number;y:number;hp:number;online:boolean;spectator?:boolean}[],delta:number){
    const net=this.hooks.net!,out=this.isOut();
    const at=this.ghost.update({out,fell:!!net.feed.players.get(net.id)?.eliminated,from:this.watchPoint??this.position,
      steer:this.ghostSteer,seconds:delta/1000,speed:ghostSpeed(this.field),bounds:ghostBounds(this.field)});
    if(!out){
      // Back in (revanche, a new round): the camera glides from the ghost to the hero (FollowCamera), no jump.
      this.watchId=undefined;this.watchPinned=false;this.watchPoint=undefined;this.watchList=[];this.hideGhost();return;
    }
    const list:Watchable[]=this.watchList=players.filter(p=>p.id!==net.id).map(p=>{const st=net.feed.players.get(p.id);
      return {id:p.id,x:p.x,y:p.y,standing:p.online&&!p.spectator&&!st?.eliminated&&!st?.downed&&p.hp>0,inRun:!p.spectator&&!st?.eliminated};});
    // Walking free (after a fall, or the thumbs let go of the friend): no one watched, the camera is the ghost.
    if(at){this.watchId=undefined;this.watchPinned=false;this.watchPoint=at;this.drawGhost(at);return;}
    this.hideGhost();
    // A teammate picked by a tap stays while still in the run (even downed: watching the rescue); else the nearest standing.
    const pinned=this.watchPinned?list.find(p=>p.id===this.watchId&&p.inRun):undefined;
    const id=pinned?.id??chooseWatched(list,this.watchPoint??this.position,this.watchId);
    if(id!==this.watchId)this.watchPinned=false;
    this.watchId=id;
    const w=list.find(p=>p.id===id);if(w)this.watchPoint={x:w.x,y:w.y};
    // Nobody left: the camera stays where it last was until the result.
    else this.watchPoint??={...this.position};
  }
  /**
   * The ghost at the camera's centre: the hero's own figure, see-through and cold, walking when it moves, on a Papel
   * ring (found on snow and asphalt alike), over the roofs it walks through.
   */
  private drawGhost(at:Point){
    const classId=this.hooks.classId,k=this.heroScale;
    const fig=this.ghostFig??=this.add.sprite(0,0,this.classIcon(classId)).setOrigin(.5,.88).setDisplaySize(112*k,112*k).setName('fantasma');
    const ring=this.ghostRing??=this.add.ellipse(0,0,ALLY_RING_SIZE.width,ALLY_RING_SIZE.height).setStrokeStyle(3,tokenColor('--c-papel-claro'),.9).setName('fantasma-anel');
    this.sprites.animate(fig,classId,at.x,at.y,0,true,this.view);
    const q=this.project(at);
    ring.setVisible(true).setScale(k).setPosition(q.x,q.y).setDepth(SELF_DEPTH+1);
    fig.setVisible(true).setPosition(q.x,q.y).setDepth(SELF_DEPTH+2).setAlpha(GHOST_ALPHA).setTint(GHOST_TINT);
  }
  private hideGhost(){this.ghostFig?.setVisible(false);this.ghostRing?.setVisible(false);}
  /** Tap on a team portrait while out: follow that teammate. False when not watching or not a teammate in the run. */
  watch(id:string){
    const net=this.hooks.net;if(!net||!this.watchPoint||id===net.id)return false;
    const p=net.players.get(id),st=net.feed.players.get(id);
    if(!p||p.spectator||st?.eliminated)return false;
    this.watchId=id;this.watchPinned=true;this.ghost.pin();return true;
  }
  /** Who the camera follows while out or watching (for the HUD's "Assistindo: Tia"). */
  /** The ghost walking free (spectator bar: ‹ › pick a friend; minimap: the ghost's dot). */
  ghosting(){return this.ghost.out&&this.ghost.mode==='free'&&this.watchPoint?{at:this.watchPoint,choices:this.watchList.filter(w=>w.inRun).length}:undefined;}
  watching(){if(this.ghost.out&&this.ghost.mode==='free')return undefined;const id=this.watchId,p=id?this.hooks.net?.players.get(id):undefined;return p?{id:p.id,name:p.name,classId:p.classId,choices:this.watchList.filter(w=>w.inRun).length}:undefined;}
  /** The spectator's ‹ › (UX-espectador): follow the next (1) or previous (-1) teammate still in the run. */
  watchStep(dir:1|-1){
    const id=cycleWatched(this.watchList,this.watchId,dir);
    if(!id||!this.watchPoint)return false;
    this.watchId=id;this.watchPinned=true;this.ghost.pin();return true;
  }
  /** Screen point (CSS px) of the watched teammate, where the torcida's chinelo lands (hud/spectator.ts). */
  watchedScreen(){const p=this.watchPoint;return p?this.locate(p).screen:undefined;}
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
      // No Uno on the deck (ORQ 24/10, with inicio-no-uno): the team spawns beside the real Uno, the chaveiro's car on the
      // plaza; the deck keeps its pile-up at the closed end and is a base on the second floor.
      const field=this.field,viaduct=this.viaduct=field.asset.viaducts.length?new ViaductLayer(this,field.asset.viaducts,field.asset.unitsPerCell,
        {depthOf:this.cityDepthOf,groundPx:(x,y)=>elevation(x,y,field),sheet:id=>art.decor[id],
          blocks:field.asset.blocks.flatMap(b=>b.rects)},CITY_GROUND_DEPTH+3):undefined;
      city.setActorScale(this.actorScale);
      city.setEconomy(this.economy);city.setStill(qualityProfile(this.quality).still);
      // A map switch into the city: its ground arrives after the first chunks, which are rebuilt with it.
      if(queueCityArt(this,{...art,sheets:art.sheets.filter(s=>s.key.startsWith('city:ground:'))})){
        this.load.once(Phaser.Loader.Events.COMPLETE,()=>{if(this.city===city)city.refresh();});
        if(!this.load.isLoading())this.load.start();
      }
      const stopStream=this.streamCityArt(city,art);
      const drop=()=>{stopStream();city.destroy();if(this.city===city)this.city=undefined;viaduct?.destroy();if(this.viaduct===viaduct)this.viaduct=undefined;
        this.events.off('shutdown',drop);this.events.off('destroy',drop);};
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
  /** The city's art download (streamCityArt) and its hold on the first chunks and on hooks.ready. */
  private cityStream?:CityArtStream;
  private cityHeld=false;
  private readyHeld=false;
  private heldSince=0;
  /** The camera's world view (world px), as the city layer reads it. */
  private cityCamera(){
    const cam=this.cameras.main,w=cam.width/cam.zoom,h=cam.height/cam.zoom;
    return {x:cam.midPoint.x-w/2,y:cam.midPoint.y-h/2,w,h};
  }
  /**
   * The city's buildings, props, decor and live sheets (NEW-20261020-ORQ-partida-abre-com-P0): the ones of the chunks
   * around the camera before the city draws (updateCity holds it, and hooks.ready, for at most NEAR_ART_CAP_MS), then
   * the rest nearest first; a chunk built before its art is rebuilt with it once off screen (CityLayer.artArrived). The
   * nests (placed by the room, no chunk) come right after the near art; live sheets of decor this map does not place
   * are not loaded. Returns the stop (map switch, shutdown).
   */
  private streamCityArt(city:CityLayer,plan:CityArtPlan){
    const sheets=new Map<string,{url:string;frameWidth:number;frameHeight:number}>();
    for(const s of plan.sheets)if(!s.key.startsWith('city:ground:'))sheets.set(s.key,s);
    const placed=new Set([...city.chunkArt().values()].flat()),nests:string[]=[];
    for(const s of liveSheets(artIndex())){
      if(placed.has(s.key))sheets.set(s.key,s);
      else if(s.key.startsWith('city:live:ninho-')){sheets.set(s.key,s);nests.push(s.key);}
    }
    // Q3 fatia 3 (art-stream.ts ART_BUDGET): what is over the quality level's budget leaves the GPU, never what a live
    // chunk draws, the viaduct's props (ViaductLayer keeps them) nor the nests (placed by the room, no chunk).
    const pinned=new Set(VIADUCT_PROP_IDS.map(id=>plan.decor[id]?.key).filter((k):k is string=>!!k));
    const stream=this.cityStream=new CityArtStream({
      missing:()=>[...city.missingArt(this.cityCamera(),this.view),...nests.filter(k=>!this.textures.exists(k)).map(key=>({key,px:1}))]
        .sort((a,b)=>a.px-b.px),
      load:(key,px)=>{
        const s=sheets.get(key);if(!s)return false;
        // Its own fetches, not Phaser's loader: that queue is first-in first-out, and the enemies of the run (~18 MB)
        // queued there when the countdown ends would hold the art around the hero behind them.
        if(bitmapsAvailable()){
          void fetchBitmap(s.url,px===0?'high':'low').then(bitmap=>queueUpload(bitmap.width*bitmap.height,()=>{
            if(this.city!==city||this.textures.exists(key)){bitmap.close();done(key,true);return;}
            this.textures.addSpriteSheet(key,bitmap as unknown as HTMLImageElement,{frameWidth:s.frameWidth,frameHeight:s.frameHeight});
            done(key,this.textures.exists(key));
          }),()=>done(key,false));
          return true;
        }
        this.load.spritesheet(key,s.url,{frameWidth:s.frameWidth,frameHeight:s.frameHeight});
        if(!this.load.isLoading())this.load.start();
        return true;
      },
      resident:()=>{
        const art=city.chunkArt(),inUse=new Set(city.liveChunks().flatMap(c=>art.get(c)??[]));
        return city.artDistance(this.cityCamera(),this.view)
          .filter(({key})=>sheets.has(key)&&!pinned.has(key)&&!key.startsWith('city:live:ninho-')&&this.textures.exists(key))
          .map(({key,px})=>{const src=this.textures.get(key).source[0];return {key,px,bytes:(src?.width??0)*(src?.height??0)*4,inUse:inUse.has(key)};});
      },
      evict:key=>{
        const img:unknown=this.textures.get(key).getSourceImage();this.textures.remove(key);
        if(typeof ImageBitmap!=='undefined'&&img instanceof ImageBitmap)img.close();
      },
      budget:()=>ART_BUDGET[this.quality],
    });
    const done=(key:string,ok:boolean)=>{if(this.city!==city||!sheets.has(key))return;if(ok)city.artArrived(key);stream.settled(key,ok);};
    const complete=(key:string)=>done(key,true),failed=(file:Phaser.Loader.File)=>done(file.key,false);
    this.load.on(Phaser.Loader.Events.FILE_COMPLETE,complete);this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR,failed);
    this.cityHeld=true;this.heldSince=performance.now();
    // The waiting room's background downloads (teammates, enemies, effects) wait for the art around the hero.
    this.releaseBackground();this.backgroundHold=holdBackground();
    stream.pump();
    return ()=>{
      this.load.off(Phaser.Loader.Events.FILE_COMPLETE,complete);this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR,failed);
      if(this.cityStream===stream){this.cityStream=undefined;this.cityHeld=false;this.releaseBackground();}
    };
  }
  /** The hold streamCityArt takes on the waiting room's P1/P2 downloads (background-hold.ts) until the near art is in. */
  private backgroundHold?:()=>void;
  private releaseBackground(){this.backgroundHold?.();this.backgroundHold=undefined;}
  /** The city's imported art plan (once: the manifest is loaded at boot); `?arte=0` / `?altura=a|b` for comparisons. */
  private cityArt():CityArtPlan{
    // Lots on the asset's cell (1.496 u on the 1.7× city, cidade-escala-1-7): the buildings grow with the map.
    const asset=this.field instanceof CityTerrain?this.field.asset:undefined,cell=asset?.unitsPerCell;
    // The new scenery's sheets (cenario-no-mapa): only the decor ids this map places, and its viaducts' pieces.
    const decor=asset&&[...asset.decor.map(d=>d.id),...(asset.viaducts.length?VIADUCT_PROP_IDS:[])];
    return this.cityArtPlan??=buildCityArtPlan(artIndex(),{...cityArtOptions(typeof location==='undefined'?'':location.search),...(cell?{cell}:{}),...(decor?{decor}:{})});
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
  installUploadQueue(Phaser); // decode off the main thread, at most one big sheet per frame (preload/upload-queue.ts)
  const scene=new IslandScene(hooks);
  const game=new Phaser.Game({type:Phaser.WEBGL,parent,backgroundColor:'#8dcecc',
    width:parent.clientWidth,height:parent.clientHeight,scale:{mode:Phaser.Scale.RESIZE},
    antialias:true,transparent:false,autoFocus:false,...exposureGameConfig(),
    audio:{noAudio:true},fps:{target:60,limit:60},banner:false,scene:[scene]});
  // Phone turned: Phaser 3.90 refreshes on screen.orientation 'change' with the old parent size, then reads the new one
  // inside that refresh, so its own size check never sees a change and the canvas stays stretched (22/10, espectador
  // 844×390). The parent's real size wins: a mismatch with the game's size refreshes again.
  const sizes=typeof ResizeObserver==='function'?new ResizeObserver(()=>{
    const s=game.scale,r=parent.getBoundingClientRect();
    if(r.width>0&&r.height>0&&(Math.round(r.width)!==Math.round(s.gameSize.width)||Math.round(r.height)!==Math.round(s.gameSize.height))){s.getParentBounds();s.refresh();}
  }):undefined;
  sizes?.observe(parent);game.events.once(Phaser.Core.Events.DESTROY,()=>sizes?.disconnect());
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
        zueira:scene.zueiraState(),blackout:scene.blackoutAudit(),economy:scene.economyOn,quality:scene.qualityLevel,fps:[...scene.fpsHistory],catchUp:scene.catchingUp,backlogMs:Math.round(net?.backlog.ms??0)};
    };
    (window as unknown as {__island?:unknown}).__island={game,scene,probe};
  }
  return {game,scene};
}
