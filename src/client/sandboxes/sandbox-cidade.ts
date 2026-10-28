/**
 * `acao=1` (D-051 step 2): the game's own action button in the attack mode (hud/skill.ts + hud/attack-button.ts) over
 *   the stand-in enemies (`n`, with `parado=1` for prints); `arrasto=dx,dy` holds a drag that far from the button's
 *   centre (CSS px) so a print shows the thumb's knob (no yellow reticle nor line, 21/10); `segura=1` holds it with no drag.
 * Cidade Nevada render sandbox (cards cidade-03a, cidade-04, cidade-03, barricadas-cliente):
 * `?sandbox=cidade[&mapa=real][&n=300][&view=0..3][&hero=cx,cy][&class=id][&cells=N][&base=1[&fase=prepare|wave]]`.
 *
 * Query params:
 *  - `mapa=real`: the real asset instead of the stand-in city.
 *  - `n=N` (0..600): stand-in enemies wandering around the hero.
 *  - `view=0..3`: camera view (quarter turns); the round button turns it too.
 *  - `hero=cx,cy`: hero start in cells.
 *  - `class=id`: the hero's class sheet (default cidadao-comum).
 *  - `cells=N`: visible width in cells instead of the game's city zoom.
 *  - `zoom=k`: the player's zoom factor (camera-zoom.ts, ZOOM_MIN..1); default ZOOM_DEFAULT like the game, 1 = the old framing,
 *    `zoom=pc` the computer's fixed one (ZOOM_DESKTOP, zoom-fixo-pc).
 *  - `base=1`: mounts the game's StonewardsRenderer (render/stonewards.ts) with fake, fixed views around the plaza
 *    (asset point `praca`; else the hero start), in a compact layout that fits a 390×844 screen (not the real mouth
 *    positions): the wall at the centre (70% life), the 4 barricades at 2.2 u — N whole (inteira, 100%), L damaged
 *    (avariada, 50%), S about to fall (quase-caindo, 20%: low bar) and O broken (quebrada, 0 = down) —, a chinelo tower,
 *    2 gather nodes (coco ×2 being gathered, pedra) and 1 loot crate (`caixa-0`). Without `hero`, the hero stands just
 *    south of the wall. Deterministic: one view pushed once, no clock in it (no hit flash, no pops).
 *  - `fase=prepare|wave` (with base=1, default prepare): the intermission shows the camp ring and the nodes; the wave
 *    hides them (wall, barricades and tower stay).
 * The imported `base` art is used when /art/manifest.json has it (art/base-art.ts); otherwise the Graphics fallback.
 * Draws the stand-in city (render/city/sample.ts) or, with `mapa=real`, the real asset (public/maps/cidade-nevada.json,
 * decoded by the maps sector and converted by render/city/from-maps.ts) with the real city layer and the real hero
 * sheet at its actor depth, framed like the game in the city (D-030): framing.ts cityZoom (rules zoomFor with the 56 px
 * hero floor: ≈15.07 cells on 844×390, ≈6.96 on 390×844) and the sheet scaled by CITY_VIEW_SCALE, so the hero draws
 * ≈56 CSS px (≈1 cell). `cells` overrides the visible width (cells along screen x) for comparisons. Rotating re-fits.
 * `n` adds that many stand-in enemies wandering around the hero, drawn at the layer's actor depth every frame.
 * Tap the city to move the hero (any piece in front of it turns see-through); the round button turns the view.
 * `window.__cidade` holds the numbers to check against a screenshot (zoom, hero px, visible cells, view) and the FPS
 * meter (`fps()`, `worst()`, `samples()`) to compare with `?sandbox=horda`.
 * `tele=1` (with `mapa=real`; card cidade-contorno-breu): the game's own city-mode drawing around the hero, through the
 * same code as the scene: HordeRenderer (city on) with a circle, a line and a cone telegraph, two critters and an XP
 * gem on their Breu 38% shadows; the "você" ring (YouMarkers), a plain and a caído map ficha (MapLabel) and the
 * destination mark (city-edge-rules.ts). One static view is pushed: nothing animates but the dash drift (none with
 * prefers-reduced-motion) and the hero's idle sheet.
 * Imported art (card ligar-arte-v2): the city's buildings, rubble, props and fountain from `/art/manifest.json`
 * (render/city/art-plan.ts); `arte=0` draws without it, `altura=a|b` picks the building scale (a: 1 storey ≈ 2.4 u on
 * 2×2-cell lots, b: as delivered).
 * `torres=1|12` (card torres-render): the game's TowerRenderer (render/towers/towers.ts) with defenses around the hero:
 *   `1` a showcase (A3 atiradores, B3 morteiro and C2 holofote firing, C3 arame, B5 obuseiro danificada, a Vigia in
 *   obra-2, a ruined A4, the Gustavão on its 12 × 4 rail to the east (in a landscape print with the rest), whose shells shake the screen and leave a
 *   crater, and an A3 hidden behind the tallest building within 9 u when there is one (not at the plaza: try
 *   `hero=100,124`, in front of a 3.6 u block), whose shots that building covers),
 *   `lista&tipos=a,b` (torres-entregues): only those kinds, ready and silent, 2.4 u from the hero (north first) — the art check;
 *     `&tiro=1` (torres-animacao-idle-tiro) they fire at the stand-in horde (idle between volleys, the fire sheet on each);
 *     `&lento=K` the defenses run K× slower (their sim clock and effects), so a 5 fps recording shows every animation frame;
 *     `&foco=torre` the camera on the first one's weapon (its mount), not the hero, and no fade; `&contorno=0` without the gold outline;
 *   `anim=0` (with any torres=): the weapons stand on their idle's frame 0 and no fire sheet loads (main before
 *     torres-animacao-idle-tiro), for the FPS check against the animated ones;
 *   `12` a ring of 12 firing defenses (the FPS check: `n=300&torres=12` vs `&desenho=0`, the same with nothing drawn).
 *   `fio=1` (torre-contador-de-tiros): the stand-in defenses go through the wire's path instead (StructureView with
 *   phase, aim and the volley counter `shots`, then the game's TowerFeed), `parado=1` freezes the stand-in enemies (a
 *   still target: the aim never changes, only the counter does); `.volleys()` = {fired by the stand-in, drawn}.
 *   The client may not import the sim (tests/arquitetura.test.ts), so a stand-in stepper fires like the sim's
 *   defensesStep (ready, cooldown, nearest reachable enemy) with the test-checked table of render/towers/tower-rules.ts,
 *   at the wandering stand-in enemies (`n`, default 60 here; every 10th one flies). The game feeds the same
 *   renderer from the wire instead (scene.ts, TowerFeed). Debug hooks for the checks and prints (sandbox only, nothing in the game reads them): `window.__cidade`
 *   `.torres()` the live effects (shots in flight with their kind and age, flashes, blasts, craters), `.shake()` the
 *   current shake (CSS px), `.towerCount` and `.defenses()` the stand-in defenses, `.hidden` the building the hidden A3
 *   stands behind, `.at`/`.cell` the hero's spot and
 *   the map cell (u), `.freeze()` stops the game loop so a print catches a volley mid-flight.
 *   FPS lab (torres-polimento): `.towersHidden('all'|'bases'|'efeitos'|'crateras'|'')` hides what the renderer draws while it
 *   still runs (drawn vs hidden on one page, the same load), `.towersStats()` the images shown and their area per kind.
 *   The stand-in stepper records each volley's aim like the sim on the wire, so the renderer never scans the horde.
 * `objetivo=1` (D-047, card chaveiro-render): the chaveiro objective's renderer (render/chaveiro) with a fake objective at the
 *   plaza (sandbox-chaveiro.ts: `moto=`, `rota=`, `pecas=`, `cai=1`, `pancadas=`, `alarme=1`, `empurra=`, `fim=vitoria|derrota`);
 *   without `hero`, the hero stands next to the moto (or the car). `acucar=1` (with `tele=1`): both lab critters are açucarados.
 * `regua=1` (card cidade-escala-1-7): a ruler beside the hero, in hero heights (the hero's own drawn height, 1× to 5×), to
 *   measure a house, a sobrado or a lamp against him in a print.
 * `relevo=0` draws the flat ground (no relief shader); `relevo=morros` (with `mapa=real`) adds stand-in snow hills to the
 * real map (render/city/relevo/preview.ts) to judge the relief shader before the real height field lands.
 * Fake data only; nothing talks to the server.
 */
import Phaser from 'phaser';
import {ZOOM_DEFAULT,ZOOM_DESKTOP,clampZoom} from '../camera-zoom.ts';
import {previewHills} from '../render/city/relevo/preview.ts';
import {CITY_PALETTE,CityLayer,OUTSIDE_CITY,PINE_TEXTURE,buildCityArtPlan,cityArtOptions,cityRenderAsset,groundZ,liveSheets,makeSampleCity,parseCityAsset,project,queueCityArt,queueLiveArt,unproject,type CityArtPlan,type CityAsset} from '../render/city/index.ts';
import {artIndex,loadArtManifest} from '../art/manifest.ts';
import {CharacterSprites} from '../sprites/character-sprites.ts';
import {buildFacing} from '../sprites/build-facing.ts';
import {workFacing} from '../sprites/work-facing.ts';
import {hasWork16,hasDowned16} from '../sprites/movement128.ts';
import {spriteCatalog} from '../sprites/sprite-catalog.ts';
import {CITY_VIEW_SCALE,FollowCamera,cityZoom,hordeUiScale} from '../framing.ts';
import {CITY_HERO_SPEED,CityTerrain,HERO_SPEED_MULT,decodeCityAsset,type TerrainField} from '../../maps/index.ts';
import {TralhaHud} from '../hud/tralha/tralha.ts';
import {CAR_ROPE,HERO_WORLD_PX,SIM_HZ,TILE_X,VEHICLE_KINDS,type NodeView,type RunView,type StructureView} from '../../contract/index.ts';
import {BANCO,BARRICADA_CELLS,SCALE_PROFILES,TOWER_SECONDS,isPlayableClass,isTowerKit,kitPiece} from '../../rules/index.ts';
import {KitPlace} from '../hud/kit-place/model.ts';
import {HordeRenderer} from '../render/layers.ts';
import {Projector} from '../render/projector.ts';
import {unprojectView} from '../projection.ts';
import {StonewardsRenderer} from '../render/stonewards.ts';
import {ALLY_DEPTH,YouMarkers} from '../render/you.ts';
import {MapLabel,stackedLabelOffsetCss} from '../render/map-labels.ts';
import {ENEMY_NAME_H_CSS,fallenByText} from '../render/enemy-name-rules.ts';
import {destinationMark} from '../render/city-edge-rules.ts';
import {CityOutlines} from '../render/city-outline.ts';
import {cityGroundLuminance} from '../render/city-outline-rules.ts';
import {ENEMY_KINDS,PICKUP_KINDS} from '../render/keys.ts';
import {heldHand} from '../sprites/hand-points.ts';
import {ARSENAL_PUSH_MS,SANDBOX_ALLY,SANDBOX_SELF,allyAt,arsenalView} from './arsenal-view.ts';
import {tokenColor} from '../ui/tokens.ts';
import {queueBaseArt} from '../art/base-art.ts';
import {queueHordeArt} from '../art/horde-art.ts';
import type {LiveNest} from '../render/city/live/nests.ts';
import {TowerRenderer,queueTowerArt} from '../render/towers/towers.ts';
import {TOWER_LOOK,TowerFeed,aimIndex,towerFootprint,type TowerKind,type TowerView,type WireStructure} from '../render/towers/tower-rules.ts';
import {CITY_GROUND_DEPTH} from '../render/city/city-layer.ts';
import {ChaveiroRenderer} from '../render/chaveiro/renderer.ts';
import {FortifyRenderer} from '../render/fortify.ts';
import {buildHints,cellRect,cellUnder,footprintCells,ghostLook,ghostRefusal} from '../render/fortify-rules.ts';
import {CAR_HALF} from '../render/chaveiro/figures.ts';
import {PushShifts,pullDirection,pushContact,pushReach} from '../render/chaveiro/push-contact.ts';
import {CITY_BUILD_CELL} from '../../maps/index.ts';
import {BankRenderer} from '../render/bancos/renderer.ts';
import {fakeBanks,type FakeBanks} from './sandbox-bancos.ts';
import {fotoClock} from '../dev/foto.ts';
import {SkillButton} from '../hud/skill.ts';
import {workShop,workingIn} from '../hud/bicos.ts';
import {AttackButton} from '../hud/attack-button.ts';
import {SKILL_HTML} from '../controls-phase.ts';
import {HERO_GAIT,WALK_TUNE} from '../sprites/sprite-motion.ts';
import type {ChaveiroView} from '../render/chaveiro/view.ts';
import {fakeChaveiro,fakeTalkEvents,type FakeChaveiro} from './sandbox-chaveiro.ts';
import {ChaveiroTalk,type SaidLine} from '../render/chaveiro/talk.ts';
import {LINE_EVENTS,hash32,pickLine,talkSeed,type LineEvent} from '../render/chaveiro/lines.ts';
import {castSilhouette,silhouetteImage} from '../render/silhouette.ts';
import {UnoPip} from '../render/chaveiro/pip.ts';
import {PIP_KEEP_PX,pipWanted} from '../render/chaveiro/pip-rules.ts';
import {CAR_LOW,carLife} from '../render/chaveiro/rules.ts';

const params=new URLSearchParams(location.search);
const real=params.get('mapa')==='real';
const heroParam=params.get('hero');
const cellsOverride=Number(params.get('cells'))||undefined;
/** `zoom=k`: the player's zoom factor (camera-zoom.ts; default the game's ZOOM_DEFAULT, `zoom=1` the old framing). */
const zoomK=params.get('zoom')==='pc'?ZOOM_DESKTOP:clampZoom(params.has('zoom')?Number(params.get('zoom')):ZOOM_DEFAULT);
const wanted=params.get('class')??'cidadao-comum';
// Any playable class (the gato has only M16 sheets, no legacy catalog entry: parado-respiracao-herois) or a legacy one.
const classId=spriteCatalog[wanted]||isPlayableClass(wanted)?wanted:'cidadao-comum';
const towersParam=params.get('torres')==='12'?12:params.get('torres')==='1'?1:params.get('torres')==='lista'?2:0;
/** torres=lista: the kinds to stand next to the hero (`tipos=a,b`), pronta, on a ring of 2.4 u from the north. */
const towerList=(params.get('tipos')??'').split(',').filter(k=>k in TOWER_LOOK) as TowerKind[];
/**
 * `kit=<peça>` with torres=1 (card torre-pela-caixa): instead of the showcase, that kit's tower in obra by the hero (built
 * straight at its tier) and the "pôr torre" ghost of the next one beside it, with the room's footprint (hud/kit-place): green on free
 * ground, red over the obra with `fantasma=ocupado`.
 */
const kitParam=towersParam===1?kitPiece(`kit:${params.get('kit')??''}`):undefined;
const KIT_OBRA={dx:-1.4,dy:1.4},KIT_GHOST={dx:1.6,dy:1.4};
const towersDrawn=params.get('desenho')!=='0';
const viaWire=params.get('fio')==='1',stillHorde=params.get('parado')==='1';
/** torres=lista: `tiro=1` the listed defenses fire; `lento=K` (1..20) the defenses' clock K× slower (see the header). */
const listFires=params.get('tiro')==='1',slowMo=Math.max(1,Math.min(20,Number(params.get('lento'))||1));
const towerFocus=params.get('foco')==='torre',towerOutline=params.get('contorno')!=='0',towerAnim=params.get('anim')!=='0';
/** acao=1: the attack button (D-051 step 2) over the stand-in enemies. */
const acao=params.get('acao')==='1';
/** dano=<ms> (animacao-receber-dano): the hero loses 1 hp every <ms> (default 1500), so its flinch plays at rest. */
const danoMs=params.has('dano')?Math.max(200,Number(params.get('dano'))||1500):0;
/** torres=1: the stand-in horde keeps this far (u) from the hero, outside the ring of defenses, so the shots read. */
const HORDE_INNER=towersParam===1?4.5:0;
const enemies=Math.max(0,Math.min(600,params.has('n')||!towersParam?Number(params.get('n'))|0:60));
const base=params.get('base')==='1';
const basePhase:'prepare'|'wave'=params.get('fase')==='wave'?'wave':'prepare';
/** Distance (u) of the showcase barricades from the wall: compact, so all four fit a 390×844 screen. */
const BASE_R=2.2;
/** Where the hero stands without `hero`, from the wall (u): just south of it, in front of the camera. */
const BASE_HERO={x:.6,y:1.2};
const tele=real&&params.get('tele')==='1';
/** `limpo=1` (with tele=1; card inimigos-v5a-padrao): no telegraphs and no map labels, so a print of the horde reads clean. */
const limpo=tele&&params.get('limpo')==='1';
/**
 * Card contorno-breu: the city's screen-scale Breu outlines (render/city-outline.ts) on the hero and, with tele=1, on
 * the horde; `contorno=0` draws without them (before/after). `elenco=1` (with tele=1) adds one critter of every kind,
 * an elite and every pickup in a ring around the hero, to see them on the ground under the hero (`hero=cx,cy`).
 */
const outlinesOn=params.get('contorno')!=='0';
// elenco=1: every legacy kind; elenco=a,b,c: those roster ids (BUG sombra-longe: the shadow study's line-up).
const castIds=params.get('elenco')?.split(',').filter(id=>id&&id!=='1')??[];
const cast=tele&&params.has('elenco');
/**
 * nome-inimigo-rede-social, etapa 7: `elite=a,b` makes those cast ids elites and `chefao=id` a boss (the name ficha over
 * the bar, render/enemy-name-rules.ts); `caido=<kind>` hangs "Te derrubou: X" under the caído ficha, as the scene does.
 */
const eliteIds=params.get('elite')?.split(',')??[],bossId=params.get('chefao'),fallenBy=fallenByText(params.get('caido')??undefined);
/** veiculos=1 (bancos-e-veiculos, part 2): the three parked vehicles by the hero, and the hero riding the cart (its chip). */
const veiculos=tele&&params.get('veiculos')==='1';
/**
 * `arsenal=1` (with tele=1; card armas-caixas-render, D-051): the manual combat's crates by rarity, one opening under the
 * hero and one bursting open, items on the ground, the hero's hand and the arsenal's shots (sandboxes/arsenal-view.ts);
 * `arma=pistola|escopeta|…` fixes the weapon (default: all seven in turn).
 */
const arsenal=tele&&params.get('arsenal')==='1';
/**
 * `ninhos=1` (with tele=1; card carro-ninhos-acabamento, D-051): three nests around the hero on the live layer as
 * scene.pushNests draws them (asleep with its band sleeping, active with its band waking up, destroyed). The band wakes
 * every NEST_WAKE_MS; in the modo foto once, NEST_WAKE_AGO_MS before the fixed clock, so the print catches it waking.
 */
const ninhos=tele&&params.get('ninhos')==='1',NEST_WAKE_MS=3000,NEST_WAKE_AGO_MS=150;
/** `objetivo=1` (card chaveiro-render, D-047): the chaveiro objective's renderer with a fake objective (sandbox-chaveiro.ts). */
const objective=params.get('objetivo')==='1';
/**
 * `pip=1` (with objetivo=1&apanha=1; card inimigos-querem-o-uno, etapa 3): the hero `longe=dx,dy` units from the car
 * (default 18,10) and the Uno's live window (render/chaveiro/pip.ts) in a stand-in HUD root (`.rh`, data-hud from
 * `hud=fone|mesa`, else fone under 768 px wide), as the game shows it while the car takes hits out of view.
 */
const pipOn=objective&&params.get('pip')==='1';
/** `bancos=1` (card bancos-e-veiculos): the banks' renderer with three fake ATMs around the hero (sandbox-bancos.ts). */
const bancos=real&&params.get('bancos')==='1';
/**
 * `obra=1` with `objetivo=1` (D-052 slice 4, placeholder): the fortify layer around the fake car: a wall row by damage
 * stage, three free barricades (rot 0 and 1, one down), the hero on the rope at the bumper and the build ghost with its hints.
 * `fantasma=` muro|barricada|vigia-do-predio (default) picks the piece; `fantasma=carro` puts it on the car (red).
 */
const obra=objective&&params.get('obra')==='1';
/** `anda=<graus>` with obra=1 (D-052): the car swings back and forth (sandbox-chaveiro.ts carSwing), pulled by the hero's rope. */
const carMoves=obra&&params.has('anda');
/**
 * `empurrando=<graus>` with objetivo=1 (card empurrar-uno): the hero pushes the rolling car (sandbox-chaveiro.ts) from
 * its back, drawn as the game draws a pusher (scene.ts: pushContact, the push16 clip facing the car, palms on it).
 */
const pushing=objective&&params.has('empurrando');
/** `puxando=1` with empurrando= (puxar-uno-corda): the hero pulls the rolling car on its rope, ahead of the nose (pull16). */
const pulling=pushing&&params.get('puxando')==='1';
/**
 * `junto=<classe>` with empurrando= (puxar-uno-corda): a second hero on the other end of the car, drawn as the game draws
 * it: it pushes at the back while the hero pulls (puxando=1), or holds the rope and pulls while the hero pushes (a helper,
 * as a bot takes the free rope). sandbox-chaveiro.ts adds it (`junto`) to the movers.
 */
const mateClass=pushing&&spriteCatalog[params.get('junto')??'']?params.get('junto')!:undefined;
/** `corda=livre` with obra=1 (puxar-uno-corda): nobody on the rope, it lies on the ground ahead of the front bumper. */
const freeRope=params.get('corda')==='livre';
/** `tralha=1` with obra=1 (barricada-construir part 2): a tapped barricada de tralha (outline, circles, coleta bar). */
const tralhaShot=obra&&params.get('tralha')==='1';
/**
 * `muralha=1` with obra=1 (muralha-tralha-no-jogo): instead of the walls and b0..b2, the junk wall by the hero: a row of 5
 * whole squares behind him and a row of 5 damaged ones (avariada, quase-caindo in turn) in front; `muralha=2`: an L, a T
 * and a lone square (the joints: halves + pillars).
 */
const muralhaShot=obra?params.get('muralha'):null;
/** `fala=` in the modo foto: the lines are said this long before the photo's clock (speakFoto). */
const FOTO_TALK_AGO_MS=700;
/** Modo foto (dev/foto.ts): the chaveiro's clock is fixed (`t`, ms), so the scene prints the same every time. */
const fotoT=params.has('foto')?fotoClock(location.search):undefined;
/** `regua=1`: the ruler beside the hero (hero heights, 1× to RULER_STEPS×). */
const ruler=params.get('regua')==='1',RULER_STEPS=5;
/** `passo=k` (card passo-sem-deslizar): the share of the stride the walk cycle keeps up with (sprite-motion.ts WALK_TUNE). */
if(params.has('passo'))WALK_TUNE.lock=Number(params.get('passo'));
/** `corrida=0` (card passo-3x-mais-lento): the walk instead of the run for a class that has one (sprite-motion.ts HERO_GAIT). */
if(params.get('corrida')==='0')HERO_GAIT.run=false;
/** Walk proofs (passo-3x-mais-lento): after `__cidade.fixar()` the camera stays put, so the ground stands still on screen and a planted foot must too. */
let cameraFixed=false;
const reducedMotion=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;

const style=document.createElement('style');
style.textContent=`html,body{margin:0;height:100%;overflow:hidden;background:#2B2542}body>:not(#cidade){display:none!important}
#cidade{position:fixed;inset:0;z-index:5}
.cidade-turn{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:6;
width:56px;height:56px;border-radius:50%;border:2px solid #1E1530;background:#EEDDB8;color:#1E1530;font:700 26px system-ui;
box-shadow:0 3px 0 #1E153066}
.cidade-fps{position:fixed;left:max(8px,env(safe-area-inset-left));top:max(8px,env(safe-area-inset-top));z-index:6;
padding:2px 8px;border-radius:8px;background:#1E1530cc;color:#EEDDB8;font:700 13px system-ui}`;
document.head.append(style);
const host=document.createElement('div');host.id='cidade';document.body.append(host);

/** Deterministic small PRNG for the stand-in horde (no Math.random: same run every reload). */
function mulberry(seed:number){return ()=>{seed=(seed+0x6d2b79f5)|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}

/** Frame times of the last seconds, for the FPS meter and scripted measurements. */
const frames:number[]=[];
/** objetivo=1: ms spent per frame in the fake objective and the chaveiro renderer (push + update), the last 240 frames. */
const chaveiroMs:number[]=[];
const meter={chaveiroMs:()=>chaveiroMs.length?chaveiroMs.reduce((s,f)=>s+f,0)/chaveiroMs.length:0,chaveiroWorstMs:()=>chaveiroMs.length?Math.max(...chaveiroMs):0,fps:()=>frames.length?1000/(frames.reduce((s,f)=>s+f,0)/frames.length):0,
  worst:()=>frames.length?1000/Math.max(...frames):0,samples:()=>frames.length};

interface Wanderer {x:number;y:number;tx:number;ty:number;speed:number;image:Phaser.GameObjects.Image}

class CitySandbox extends Phaser.Scene {
  private layer?:CityLayer;
  private asset!:CityAsset;
  private hero!:Phaser.GameObjects.Sprite;
  private ally?:Phaser.GameObjects.Sprite;
  private mate?:Phaser.GameObjects.Sprite;
  private mateAt={x:0,y:0};
  private mateShift={x:0,y:0};
  /** The hero's cast silhouette, as in the game (render/silhouette.ts, card sombra-silhueta). */
  private shadow!:Phaser.GameObjects.Image;
  /** empurrando=: the hero's drawn shift onto the car (the game's PushShifts). */
  private pushShifts=new PushShifts();
  private pushShift={x:0,y:0};
  private outlines=new CityOutlines(this,{active:()=>outlinesOn,zoom:()=>this.cameras.main.zoom,
    groundLuminance:(x,y)=>this.asset?cityGroundLuminance(this.asset,x,y):undefined});
  private sprites=new CharacterSprites(this,this.outlines);
  /** window.__cidade.cair() (vendedor-aposentado-arte-8-direcoes, prova): the hero drawn as the game draws a caído
   * (scene.ts: hp 0, alive false, turned −90°, alpha .85), so the fall shows in the GIFs. */
  private fallen=false;
  /** window.__cidade.step's clock (ms). */
  private stepAt?:number;
  /** The hero's swings so far (window.__cidade.golpe(): one more plays the attack clip; card arma-na-mao-viciado proofs). */
  private swings=0;
  private camera=new FollowCamera();
  private view=Math.max(0,Math.min(3,Number(params.get('view'))|0));
  private at={x:0,y:0};
  private horde:Wanderer[]=[];
  /** acao=1: the game's attack button over the stand-ins. */
  private attack?:AttackButton;
  private rng=mulberry(7);
  private fpsLabel?:HTMLElement;
  private stone?:StonewardsRenderer;
  private projector?:Projector;
  private pip?:UnoPip;
  private chaveiro?:{renderer:ChaveiroRenderer;fake:FakeChaveiro;warmed?:boolean;
    /** `fala=` (card chaveiro-falas): the game's line timing, its balloons (the lab's horde with tele=1) and what it said. */
    talk?:{talk:ChaveiroTalk;horde?:HordeRenderer;said:(SaidLine&{at:number})[];last:number;start?:number}};
  /** bancos=1: the banks' renderer, the fake ATMs and the robbers' horde. */
  /** acao=1: the action button (bancos=1 turns it into Trabalhar in a shop's ring). */
  private skill?:SkillButton;
  private banks?:{renderer:BankRenderer;fake:FakeBanks;horde?:HordeRenderer;warmed:boolean};
  private fortify?:FortifyRenderer;
  /** obra=1: the fortify view pushed (anda= moves its car). */
  private obraView?:RunView;
  /** regua=1: the ruler (Graphics) and its labels. */
  private ruler?:{g:Phaser.GameObjects.Graphics;labels:Phaser.GameObjects.Text[]};
  /** tele=1: the game's city-mode renderers. */
  private lab?:{horde:HordeRenderer;projector:Projector;you:YouMarkers;labels:MapLabel[];destination:Phaser.GameObjects.Graphics;view:RunView;pushed:number;
    /** ninhos=1: the nests and the two views of the waking band (asleep, then awake). */
    nests?:{list:LiveNest[];asleep:RunView;awake:RunView}};
  private decoded?:CityTerrain;
  /** torres=…: the stand-in defenses, the renderer and the enemies' parallel arrays it aims at. */
  private defenses:TowerView[]=[];
  /** stepTowers' last tick: an obra (tick < readyTick) by the hero plays its build16 (animacao-construir-6). */
  private towerTick=0;
  /** bancos=1: the hero is on a shift (stepBanks, last frame): it plays its work16 facing the camera (animacao-trabalhar-6). */
  private working=false;
  /** fio=1: the game's wire path (TowerFeed) with each stand-in's volley counter and aim; volleys the stand-in fired. */
  private feed=new TowerFeed();private shots=new Map<string,number>();private aims=new Map<string,number>();private fired=0;
  private towers?:TowerRenderer;
  private ex=new Float32Array(0);private ey=new Float32Array(0);private air=new Uint8Array(0);
  private simStart=-1;
  /** torres=1: the building the hidden A3 stands behind (for the checks). */
  private hidden?:{x:number;y:number;w:number;h:number;height:number};
  constructor(){super('city-sandbox');}
  private art?:CityArtPlan;
  preload(){
    this.load.spritesheet(PINE_TEXTURE,'/art/lite/trees/arvore-nevada.webp',{frameWidth:256,frameHeight:384});
    // The real asset's cell (1.496 u, cidade-escala-1-7) is the profile's; the sample city keeps the art's 0.88 u.
    this.art=buildCityArtPlan(artIndex(),{...cityArtOptions(location.search),...(real?{cell:SCALE_PROFILES['cidade-nevada'].cell}:{})});
    queueCityArt(this,this.art);
    this.sprites.queue(classId);
    // As the game's hero (scene.ts): its walk, flinch and build sheets come with the preload (animacao-construir-6 proofs).
    if(kitParam||bancos)this.sprites.queueOwnWalk(classId);
    if(mateClass)this.sprites.queue(mateClass);
    if(real)this.load.text('cidade-real','/maps/cidade-nevada.json');
    if(towersParam)queueTowerArt(this,towerAnim);
    if(base)queueBaseArt(this); // the manifest is loaded before the game starts (see the bottom of this file)
    // arsenal=1: the game's horde and base art (scene.ts preload), so the bullets, the crate sheet and the rest are the match's.
    if(arsenal){queueHordeArt(this);if(!base)queueBaseArt(this);}
    // muralha=: the junk wall sheets (base-art BASE_ART.muralha / .pilar), like the match; objetivo=1: the chaveiro's
    // painted moto and the built muro's sheets (BASE_ART.moto / .muro, card trocar-procedurais-por-arte).
    // kit=barricada (barricada-tocar-no-mapa): its ghost is the junk wall's art too.
    if((muralhaShot||objective||kitParam==='barricada')&&!base&&!arsenal)queueBaseArt(this);
    // ninhos=1: the critters' art (sleep and wake are art actions).
    if(ninhos&&!arsenal)queueHordeArt(this);
  }
  create(){
    if(real){
      const decoded=decodeCityAsset(this.cache.text.get('cidade-real'));
      if(!decoded.ok)throw new Error(`city asset: ${decoded.error}`);
      this.asset=cityRenderAsset(decoded.asset);
      if(params.get('relevo')==='morros')this.asset=previewHills(this.asset);
      if(tele||bancos)this.decoded=new CityTerrain(decoded.asset,'sandbox');
    }else this.asset=parseCityAsset(makeSampleCity());
    const start=heroParam?heroParam.split(',').map(Number):undefined,inicio=this.asset.points.inicio;
    this.at=start?{x:start[0]*this.asset.cell,y:start[1]*this.asset.cell}:real&&inicio?{...inicio}:{x:6.5*this.asset.cell,y:3.3*this.asset.cell};
    const centre=base?this.asset.points.praca??{...this.at}:undefined;
    if(objective)this.chaveiro=this.mountObjective(!start);
    // `longe` alone (pip=0) puts the hero at the same spot without the window: the FPS before × after.
    if((pipOn||objective&&params.has('longe'))&&this.chaveiro){
      const car=this.chaveiro.fake.view(0).view.car,[dx,dy]=(params.get('longe')??'18,10').split(',').map(Number);
      this.at={x:car.x+(dx||0),y:car.y+(dy||0)};
    }
    if(pipOn&&this.chaveiro){
      const root=document.createElement('div');root.className='rh';root.dataset.hud=params.get('hud')??(innerWidth<768?'fone':'mesa');
      Object.assign(root.style,{position:'fixed',inset:'0',pointerEvents:'none',zIndex:'6'});host.append(root);
      void import('../hud/hud.css');
      this.pip=new UnoPip(this,{onTap:()=>{}});
    }
    if(centre&&!start&&!objective)this.at={x:centre.x+BASE_HERO.x,y:centre.y+BASE_HERO.y};
    else if(towersParam&&!start&&this.asset.points.praca)this.at={...this.asset.points.praca}; // torres: the open plaza
    this.cameras.main.setBackgroundColor(OUTSIDE_CITY);
    // The new scenery (cenario-no-mapa): its sheets are known once the asset is, then the chunks redraw with them.
    if(this.asset.decor?.length){
      this.art=buildCityArtPlan(artIndex(),{...cityArtOptions(location.search),...(real?{cell:SCALE_PROFILES['cidade-nevada'].cell}:{}),decor:this.asset.decor.map(d=>d.id)});
      if(queueCityArt(this,this.art)+queueLiveArt(this,liveSheets(artIndex()))){
        this.load.once(Phaser.Loader.Events.COMPLETE,()=>this.layer?.refresh());
        this.load.start();
      }
    }
    this.layer=new CityLayer(this,this.asset,{art:this.art});
    this.layer.setActorScale(CITY_VIEW_SCALE);
    // The game scene's city figures: the sheet and its cast silhouette scaled by CITY_VIEW_SCALE.
    this.sprites.viewScale=CITY_VIEW_SCALE;
    this.camera.world={scale:CITY_VIEW_SCALE,speed:CITY_HERO_SPEED*HERO_SPEED_MULT}; // the game's city walk (maps heroSpeed)
    this.shadow=silhouetteImage(this,'__DEFAULT',0);
    this.hero=this.add.sprite(0,0,'__DEFAULT');
    this.sprites.animate(this.hero,classId,this.at.x,this.at.y,0,true,this.view);
    // arsenal=1: the ally standing at its crate (sandboxes/arsenal-view.ts), so its opening shows.
    if(arsenal)this.ally=this.add.sprite(0,0,'__DEFAULT');
    if(mateClass)this.mate=this.add.sprite(0,0,'__DEFAULT');
    this.spawnHorde();
    if(acao)void this.mountAttack();
    if(centre)this.mountBase(centre);
    if(tele)this.buildLab();
    if(towersParam)this.mountTowers();
    if(kitParam)this.mountKit();
    if(bancos)this.mountBanks();
    if(obra&&this.chaveiro)this.mountObra();
    else if(pushing&&this.chaveiro)this.mountRope();
    this.fit();
    this.scale.on('resize',()=>{this.fit();});
    this.input.on('pointerdown',(p:Phaser.Input.Pointer)=>{
      const w=unproject(p.worldX,p.worldY,0,this.view);
      const max={x:this.asset.width*this.asset.cell,y:this.asset.height*this.asset.cell};
      this.at={x:Math.max(0,Math.min(max.x,w.x)),y:Math.max(0,Math.min(max.y,w.y))};
      this.place();
    });
    const turn=document.createElement('button');
    turn.className='cidade-turn';turn.type='button';turn.textContent='↻';turn.setAttribute('aria-label','Girar a câmera');
    turn.addEventListener('click',e=>{e.stopPropagation();this.view=(this.view+1)%4;this.place();if(this.projector){this.projector.view=this.view;this.stone?.refresh();this.chaveiro?.renderer.refresh();this.banks?.renderer.refresh();}this.towers?.refresh();});
    host.append(turn);// inside the sandbox root: everything else in body is hidden
    if(enemies){this.fpsLabel=document.createElement('div');this.fpsLabel.className='cidade-fps';host.append(this.fpsLabel);}
    // Warm the fade so a covering building is already translucent on the first screenshot.
    for(let i=0;i<12;i++)this.tick(16);
  }
  update(_t:number,dt:number){
    frames.push(dt);if(frames.length>240)frames.shift();
    if(this.fpsLabel&&frames.length%30===0)this.fpsLabel.textContent=`${meter.fps().toFixed(0)} fps · ${enemies} bichos`;
    let push:ReturnType<typeof pushContact>,pull:ReturnType<typeof pullDirection>;
    if(pushing&&this.chaveiro){
      // the hero walks with the car, just behind its back (inside the room's reach); the drawing puts its palms on it
      const car=this.chaveiro.fake.view(fotoT??_t).view.car,h=(Number(params.get('empurrando'))||0)*Math.PI/180,back=pulling?-(CAR_HALF.l+CAR_ROPE):CAR_HALF.l+.6;
      this.at={x:car.x-Math.cos(h)*back,y:car.y-Math.sin(h)*back};
      const pose=this.chaveiro.renderer.carPose();
      // puxando=1: the rope taut ahead of the nose, the hero facing away from the bumper (scene.ts: pullDirection)
      push=pose&&!pulling?pushContact(this.at,pose,{x:Math.cos(h),y:Math.sin(h)},d=>pushReach(d,this.view)):undefined;
      if(pulling&&pose)pull=pullDirection(this.at,pose);
      this.pushShift=this.pushShifts.step('voce',push?.shift,dt);
      if(this.mate&&mateClass){
        // junto=: the other end, the other role (pushing at the back while the hero pulls, on the rope while it pushes)
        const mb=pulling?CAR_HALF.l+.6:-(CAR_HALF.l+CAR_ROPE);this.mateAt={x:car.x-Math.cos(h)*mb,y:car.y-Math.sin(h)*mb};
        const mp=pose&&pulling?pushContact(this.mateAt,pose,{x:Math.cos(h),y:Math.sin(h)},d=>pushReach(d,this.view)):undefined;
        const ml=pose&&!pulling?pullDirection(this.mateAt,pose):undefined;
        this.mateShift=this.pushShifts.step('junto',mp?.shift,dt);
        this.sprites.animate(this.mate,mateClass,this.mateAt.x,this.mateAt.y,0,true,this.view,undefined,mp?.dir??ml);
      }
    }
    // anda= (puxar-uno-corda): the hero on the rope ahead of the car, drawn pulling (its pull16) along the swing's axis.
    const ha=Number(params.get('anda'))*Math.PI/180||0;if(carMoves)pull={x:Math.cos(ha),y:Math.sin(ha),pull:true};
    const fell=this.fallen;
    this.sprites.animate(this.hero,classId,this.at.x,this.at.y,this.swings,!fell,this.view,undefined,push?.dir??pull,fell?0:danoMs?1e6-Math.floor((fotoT??_t)/danoMs):undefined,undefined,
      this.working?workFacing(this.view):buildFacing(this.at,this.defenses.filter(d=>!d.ruined&&this.towerTick<d.readyTick)),fell);
    if(fell)this.hero.setAngle(hasDowned16(classId)?0:-90).setAlpha(.85);else if(this.hero.angle)this.hero.setAngle(0).setAlpha(1);
    if(pushing)this.place();
    if(this.ally){const a=allyAt(this.at.x,this.at.y);this.sprites.animate(this.ally,'merendeira',a.x,a.y,0,true,this.view);}
    if(!stillHorde)this.moveHorde(dt);
    this.attack?.frame();
    this.tick(dt);
    this.stone?.update(_t);
    if(this.chaveiro){
      const now=fotoT??_t,t0=performance.now();
      // anda= or empurrando= in the modo foto (a fixed clock): the second before, so the car has turned to its move.
      if((carMoves||pushing)&&fotoT!==undefined&&!this.chaveiro.warmed){for(let i=10;i>0;i--){const w=this.chaveiro.fake.view(now-i*100);this.chaveiro.renderer.push(w.view,w.tick);this.chaveiro.renderer.update(now-i*100);}}
      this.chaveiro.warmed=true;
      const {view,tick}=this.chaveiro.fake.view(now);this.chaveiro.renderer.push(view,tick);this.chaveiro.renderer.update(now);
      if(carMoves&&this.fortify)this.pullCar(view.car);
      else if(pushing&&this.fortify&&this.obraView)this.fortify.push({...this.obraView,objective:{...this.obraView.objective!,car:view.car}});
      if(this.pip){
        const hit=this.chaveiro.renderer.hitState(),cam=this.cameras.main,proj=this.cityProjector().project(view.car.x,view.car.y,{x:0,y:0});
        const wanted=!!hit&&pipWanted({live:!hit.ended,now,carOnScreen:cam.worldView.contains(proj.x,proj.y),distance:Math.hypot(view.car.x-this.at.x,view.car.y-this.at.y),
          ...(hit.lastHitAt!==undefined?{lastHitAt:hit.lastHitAt}:{})});
        const life=carLife(view.car);
        this.pip.update({wanted,car:proj,mainZoom:cam.zoom,time:now,life:{fraction:life,low:life<CAR_LOW}});
      }
      chaveiroMs.push(performance.now()-t0);if(chaveiroMs.length>240)chaveiroMs.shift();
      this.speak(_t,dt,view,tick);
    }
    this.stepBanks(_t);
    this.fortify?.update(fotoT??_t);
    this.drawLab(_t,dt);
    this.stepTowers(_t,dt);
  }
  /** The city layer's projection for the game's renderers: same pivot, the city's ground height in px, its actor depth. */
  private cityProjector(){
    if(this.projector)return this.projector;
    const asset=this.asset;
    // World px per unit of city height, from the city projection itself (no second constant).
    const heightPx=project(0,0,0,0).y-project(0,0,1,0).y;
    const ground={height:(x:number,y:number)=>groundZ(asset,x,y)*heightPx} as unknown as TerrainField;
    const projector=new Projector(this.view,ground);
    projector.depthOverride=(x,y)=>this.layer?this.layer.actorDepth(x,y,groundZ(asset,x,y)):0;
    return this.projector=projector;
  }
  /**
   * `bancos=1`: the banks' renderer on the city's projection with three fake ATMs around the hero, and the robbers
   * (Cliente Prime) on the game's horde renderer.
   */
  private mountBanks(){
    const fake=fakeBanks(params,this.at),projector=this.cityProjector();
    const renderer=new BankRenderer(this,{projector,reduced:reducedMotion,hero:()=>this.at,nameOf:id=>id==='voce'?'Você':id});
    let horde:HordeRenderer|undefined;
    if(this.decoded&&fake.enemies.length){
      const hp=new Projector(this.view,this.decoded);hp.depthOverride=(x,y)=>this.layer?this.layer.actorDepth(x,y):0;
      horde=new HordeRenderer(this,{projector:hp,uiScale:()=>hordeUiScale(this.cameras.main.zoom,CITY_VIEW_SCALE),actorScale:()=>CITY_VIEW_SCALE,
        reduced:reducedMotion,city:()=>true,cityOutlines:this.outlines});
      horde.push({tick:100,team:{xp:0,level:1,nextXp:5},structures:[],players:[],offers:[],events:[],projectiles:[],telegraphs:[],pickups:[],enemies:fake.enemies});
    }
    this.banks={renderer,fake,horde,warmed:false};
  }
  /**
   * bancos=1, every frame: the fake banks at the clock. In the modo foto (a fixed clock) the first frame starts from
   * the view a moment before, so a note is in the air and the beep shows on the print.
   */
  private stepBanks(time:number){
    const b=this.banks;if(!b)return;
    const now=fotoT??time;
    if(fotoT!==undefined&&!b.warmed){
      const before=now-450,prev=b.fake.view(now-Math.max(1,BANCO.saqueS)*1000);
      b.renderer.update(before);b.renderer.push(prev.banks,prev.tick);
    }
    b.warmed=true;
    const {banks,tick}=b.fake.view(now);
    b.renderer.push(banks,tick);b.renderer.update(now);
    b.horde?.update(now,16);
    // Bicos (etapa 4): in a shop's ring the action button says Trabalhar; on the shift the hero plays its work16 in the
    // ring (animacao-trabalhar-6), or without one is gone through the door.
    const inside=workingIn(banks,'voce'),shop=inside??workShop(banks,this.at);
    this.skill?.setWork(shop?{bico:shop.bico,inside:!!inside}:undefined);
    this.working=!!inside;
    if(inside&&!hasWork16(classId))this.hero.setAlpha(0);
  }
  /** `objetivo=1`: the chaveiro renderer with the fake objective at the plaza (sandbox-chaveiro.ts); moves the hero to it. */
  private mountObjective(placeHero:boolean){
    const p=this.asset.points,from=(params.get('rota')??'N').toUpperCase() as 'N'|'S'|'L'|'O';
    const car=p.praca??{x:this.at.x+2,y:this.at.y};
    const fake=fakeChaveiro(params,car,p[`spawn${from}`],p[`boca${from}`],{x:this.at.x-6,y:this.at.y+4});
    if(placeHero)this.at={...fake.heroAt};
    const renderer=new ChaveiroRenderer(this,{projector:this.cityProjector(),reduced:reducedMotion,hero:()=>this.at});
    if(!params.has('fala'))return {renderer,fake};
    const seed=params.has('seed')?Number(params.get('seed'))>>>0:talkSeed('sandbox',0);
    // Without tele=1 the balloons get a horde renderer of their own (the lab's one otherwise), on the city's projection.
    const horde=tele?undefined:new HordeRenderer(this,{projector:this.cityProjector(),uiScale:()=>hordeUiScale(this.cameras.main.zoom,CITY_VIEW_SCALE),
      actorScale:()=>CITY_VIEW_SCALE,reduced:reducedMotion,city:()=>true});
    horde?.push({tick:0,team:{xp:0,level:1,nextXp:5},structures:[],players:[],offers:[],events:[],projectiles:[],telegraphs:[],enemies:[],pickups:[]});
    return {renderer,fake,talk:{talk:new ChaveiroTalk(seed),horde,said:[],last:-1}};
  }
  /** `fala=`: the fake moments' events and the fake view into the game's line timing; the due line into a balloon. */
  private speak(time:number,dt:number,view:ChaveiroView,tick:number){
    const t=this.chaveiro?.talk;if(!t)return;
    if(fotoT!==undefined){this.speakFoto(t,dt);return;}
    t.start??=time;
    t.talk.push(view,fakeTalkEvents(params,t.last,time-t.start),tick,time);t.last=time-t.start;
    const horde=t.horde??this.lab?.horde;
    t.horde?.update(time,dt);
    const said=t.talk.take(time);
    if(!said||!horde)return;
    t.said.push({...said,at:time});
    const renderer=this.chaveiro!.renderer;
    horde.speak(`chaveiro:${said.speaker}`,said.text,()=>renderer.speechAnchor(said.speaker),said.priority);
  }
  /**
   * `fala=` in the modo foto (a fixed clock: the game's gap would show one balloon at a time): one line of each moment
   * named (`fala=volta,part,…`, the line moments' own names), each from a speaker not used yet (each has its own anchor), all at once; the
   * balloons' clock is the photo's, so they stay up for the print.
   */
  private speakFoto(t:NonNullable<NonNullable<typeof this.chaveiro>['talk']>,dt:number){
    const horde=t.horde??this.lab?.horde;if(!horde)return;
    if(t.start!==undefined){horde.update(fotoT!,dt);return;}
    // Said FOTO_TALK_AGO_MS before the photo's clock: the balloons have popped in by then (and live 2.2 s).
    t.start=fotoT!;horde.update(fotoT!-FOTO_TALK_AGO_MS,dt);
    const seed=params.has('seed')?Number(params.get('seed'))>>>0:talkSeed('sandbox',0),used=new Set<string>(),renderer=this.chaveiro!.renderer;
    for(const name of (params.get('fala')??'').split(',')){
      if(!(LINE_EVENTS as string[]).includes(name))continue;
      for(let k=0;k<16;k++){
        const line=pickLine(name as LineEvent,hash32(seed,k));
        if(used.has(line.speaker))continue;
        used.add(line.speaker);t.said.push({...line,priority:true,at:fotoT!});
        horde.speak(`chaveiro:${line.speaker}`,line.text,()=>renderer.speechAnchor(line.speaker),true);
        break;
      }
    }
    horde.update(fotoT!,dt);
  }
  /** anda=: the hero pulls the car by the rope from ahead of its move (the rope's slack in the swing). */
  private pullCar(car:{x:number;y:number}){
    const view=this.obraView;if(!view||!this.fortify)return;
    const h=Number(params.get('anda'))*Math.PI/180||0,ahead=CAR_HALF.l+2.4;
    this.at={x:car.x+Math.cos(h)*ahead,y:car.y+Math.sin(h)*ahead};
    this.fortify.push({...view,objective:{...view.objective!,car:{...view.objective!.car,x:car.x,y:car.y}}});
    // Only the hero moves: the camera stays on the car (fit placed it there).
    const feet=project(this.at.x,this.at.y,groundZ(this.asset,this.at.x,this.at.y),this.view);
    this.hero.setPosition(feet.x,feet.y);
  }
  /** empurrando= (puxar-uno-corda): only the fortify layer's rope, free on the ground ahead of the pushed car. */
  private mountRope(){
    const projector=this.cityProjector(),fake=this.chaveiro!.fake.view(0).view;
    this.fortify=new FortifyRenderer(this,{projector,reduced:reducedMotion,cell:CITY_BUILD_CELL,playerAt:id=>pulling&&id==='voce'?this.at:mateClass&&!pulling&&id==='junto'?this.mateAt:undefined,carHeading:()=>this.chaveiro?.renderer.carHeading??0});
    const view={tick:100,team:{xp:0,level:1,nextXp:5},structures:[],players:[],offers:[],events:[],projectiles:[],telegraphs:[],enemies:[],pickups:[],
      objective:fake} as unknown as RunView;
    this.fortify.push(view);this.obraView=view;
  }
  /** `obra=1`: the fortify layer (walls, rope, ghost, hints) and the free barricades in Stonewards around the fake car. */
  private mountObra(){
    const projector=this.cityProjector(),cell=CITY_BUILD_CELL,car=this.chaveiro!.fake.view(0).view.car;
    // The hero on the rope, ahead of the front bumper (anda=: the camera on the car, pullCar moves him).
    this.at=carMoves?{x:car.x+1,y:car.y-1}:{x:car.x+CAR_HALF.l+2.2,y:car.y+.3};
    this.fortify=new FortifyRenderer(this,{projector,reduced:reducedMotion,cell,playerAt:id=>id==='voce'?this.at:undefined,carHeading:()=>this.chaveiro?.renderer.carHeading??0});
    const c0=Math.round(car.x/cell)+1,r0=Math.round((car.y+2.6)/cell);
    const walls:StructureView[]=[0,1,2,3,4,5].map(i=>{
      const hp=[250,250,180,110,40,0][i];
      return {id:`m${i}`,kind:'muro',x:(c0+i+.5)*cell,y:(r0+.5)*cell,hp,maxHp:250,c:c0+i,r:r0};
    });
    const tick=100;
    // barricada-construir: b0 is under the car's alert (untilTick: the red glow), 3 s left.
    const bar=(id:string,c:number,r:number,rot:0|1,hp:number,alert=false):StructureView=>{
      const [w,h]=footprintCells('barricada',rot),rect=cellRect(c,r,w,h,cell);
      return {id,kind:'barricada',x:rect.cx,y:rect.cy,hp,maxHp:200,c,r,...(rot?{rot}:{}),...(alert?{untilTick:tick+3*SIM_HZ}:{})};
    };
    const structures=muralhaShot?this.muralhaSquares(bar):[...walls,bar('b0',c0+4,r0-2,0,200,true),bar('b1',c0-2,r0+2,1,110),bar('b2',c0+9,r0+3,0,0)];
    const objectiveView={...this.chaveiro!.fake.view(0).view,car:freeRope?{...car}:{...car,rope:'voce'}};
    const view={tick,team:{xp:0,level:1,nextXp:5},structures,players:[],offers:[],events:[],projectiles:[],telegraphs:[],enemies:[],pickups:[],
      objective:objectiveView} as unknown as RunView;
    this.fortify.push(view);this.obraView=view;
    this.stone??=new StonewardsRenderer(this,{projector,reduced:false,hero:()=>this.at,actorScale:()=>CITY_VIEW_SCALE,cell:()=>this.asset.cell});
    this.stone.push(view);
    if(tralhaShot){this.mountTralha(projector,structures.find(x=>x.id==='b1')!);return;}
    if(muralhaShot)return; // the junk wall alone, no ghost
    if(carMoves)return; // anda=: the car and its rope, no ghost over the hero
    // The ghost: a free spot to the car's left (green), or on the car itself (`fantasma=carro`, red).
    const wanted=params.get('fantasma')??'vigia-do-predio',piece=wanted==='carro'?'vigia-do-predio':wanted;
    const [w,h]=footprintCells(piece),spot=wanted==='carro'?{x:car.x+.4,y:car.y}:{x:car.x+CAR_HALF.l+3.6,y:car.y-2.4};
    const at=cellUnder(spot.x,spot.y,w,h,cell),ctx={cell,car,structures};
    const look=ghostLook(ghostRefusal(cellRect(at.c,at.r,w,h,cell),ctx));
    const sites=[-6,-3,3,6].flatMap(dx=>[-4,4].map(dy=>({x:car.x+dx,y:car.y+dy})));
    this.fortify.setGhost({piece,c:at.c,r:at.r,look});
    this.fortify.setHints(buildHints(piece,sites,ctx));
  }
  /**
   * `muralha=1|2`: the junk wall's squares around the hero, laid out in squares (barricada-2x: one square is
   * BARRICADA_CELLS × BARRICADA_CELLS cells of CITY_BUILD_CELL).
   */
  private muralhaSquares(square:(id:string,c:number,r:number,rot:0|1,hp:number)=>StructureView):StructureView[]{
    const cell=CITY_BUILD_CELL,n=BARRICADA_CELLS,hc=Math.round(this.at.x/cell),hr=Math.round(this.at.y/cell),row=[-2,-1,0,1,2];
    const bar=(id:string,c:number,r:number,rot:0|1,hp:number)=>square(id,hc+(c-hc)*n,hr+(r-hr)*n,rot,hp);
    if(muralhaShot==='2')return [
      ...[0,1,2,3].map(i=>bar(`l${i}`,hc-4+i,hr-3,0,200)),...[1,2].map(i=>bar(`m${i}`,hc-4,hr-3+i,1,200)),
      ...[0,1,2,3,4].map(i=>bar(`t${i}`,hc+1+i,hr+1,0,200)),...[1,2].map(i=>bar(`u${i}`,hc+3,hr+1-i,1,200)),
      bar('so',hc-3,hr+2,1,200)];
    return [...row.map((d,i)=>bar(`w${i}`,hc+d,hr-2,0,200)),...row.map((d,i)=>bar(`d${i}`,hc+d,hr+2,0,i%2?40:110))];
  }
  /**
   * `tralha=1` with obra=1 (barricada-construir part 2): barricada b1 tapped: its gold outline, the two circles COLETAR /
   * DESTRUIR over it and a coleta's bar half way over the hero (hud/tralha, the game's own HUD on a sandbox host).
   */
  private mountTralha(projector:{project(x:number,y:number,out:{x:number;y:number}):{x:number;y:number}},b1:StructureView){
    this.stone!.outline=b1.id;
    const host=document.createElement('div');host.className='rh';host.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:6';document.getElementById('cidade')!.append(host);
    const hud=new TralhaHud(host,{onTap:()=>false,onHover:()=>false,onAct:()=>{},canvas:()=>this.game.canvas,busy:()=>false});
    const screen=(wx:number,wy:number)=>{
      const cam=this.cameras.main,q=projector.project(wx,wy,{x:0,y:0}),r=this.game.canvas.getBoundingClientRect(),k=r.width/this.scale.width;
      return {x:r.left+(q.x-cam.worldView.x)*cam.zoom*k,y:r.top+(q.y-cam.worldView.y)*cam.zoom*k};
    };
    this.events.on('postupdate',()=>hud.update({available:true,at:screen(b1.x,b1.y),hero:screen(this.at.x,this.at.y),progress:.5}));
  }
  /**
   * `base=1`: the game's Stonewards renderer on a projector equal to the city layer's (same rotation pivot, the
   * city's ground height in px, the layer's actor depth), fed one fixed RunView around `c` (see the header).
   */
  private mountBase(c:{x:number;y:number}){
    const projector=this.cityProjector();
    this.stone=new StonewardsRenderer(this,{projector,reduced:false,hero:()=>this.at,actorScale:()=>CITY_VIEW_SCALE,cell:()=>this.asset.cell});
    const at=(dx:number,dy:number)=>({x:+(c.x+dx).toFixed(3),y:+(c.y+dy).toFixed(3)});
    const tick=1000,R=BASE_R;
    const structures:StructureView[]=[
      {id:'s1',kind:'muralha',...at(0,0),hp:420,maxHp:600},
      {id:'s2',kind:'barricada',...at(0,-R),hp:300,maxHp:300},
      {id:'s3',kind:'barricada',...at(R,0),hp:150,maxHp:300},
      {id:'s4',kind:'barricada',...at(0,R),hp:60,maxHp:300},
      {id:'s5',kind:'barricada',...at(-R,0),hp:0,maxHp:300},
      {id:'s6',kind:'torre-chinelo',...at(-1.5,1.1),hp:80,maxHp:80,untilTick:tick+Math.round(TOWER_SECONDS*SIM_HZ*.6)},
    ];
    const nodes:NodeView[]=[
      {id:'n1',kind:'coco',...at(1.4,-1.3),remaining:3,capacity:4,value:2,progress:.5},
      {id:'n2',kind:'pedra',...at(-1.5,-1.2),remaining:2,capacity:4,value:1,progress:0},
      {id:'caixa-0',kind:'pedra',...at(1.9,.9),remaining:1,capacity:1,value:6,progress:0},
    ];
    const view:RunView={tick,team:{xp:0,level:1,nextXp:10},round:{index:1,total:10,phase:basePhase,phaseEndsTick:tick+600,remaining:0},
      enemies:[],pickups:[],projectiles:[],telegraphs:[],structures,nodes:basePhase==='prepare'?nodes:[],camp:{units:76,grana:12},
      players:[],offers:[],events:[]};
    this.stone.push(view);
  }
  /** tele=1: renderers of the game in city mode, fed one static view around the hero (world units). */
  private buildLab(){
    if(!this.decoded)return;
    const projector=new Projector(this.view,this.decoded);
    projector.depthOverride=(x,y)=>this.layer?this.layer.actorDepth(x,y):0;
    const horde=new HordeRenderer(this,{projector,uiScale:()=>hordeUiScale(this.cameras.main.zoom,CITY_VIEW_SCALE),actorScale:()=>CITY_VIEW_SCALE,
      reduced:reducedMotion,city:()=>true,cityOutlines:this.outlines,
      ...(arsenal?{locate:(id:string)=>id===SANDBOX_SELF?this.at:id===SANDBOX_ALLY?allyAt(this.at.x,this.at.y):undefined,selfId:()=>SANDBOX_SELF,
        hand:(id:string)=>heldHand(this.sprites,id===SANDBOX_SELF?this.hero:id===SANDBOX_ALLY?this.ally:undefined),
        aim:()=>{const p=this.input.activePointer;return !p||p.wasTouch||!p.time?undefined:unprojectView(this.cameras.main.getWorldPoint(p.x,p.y),this.view,this.decoded);}}:{})});
    const {x,y}=this.at,tick=100,sugar=params.get('acucar')==='1'?{sugar:true as const}:{};
    const view:RunView={tick,team:{xp:0,level:1,nextXp:5},structures:[],players:[],offers:[],events:[],projectiles:[],
      telegraphs:limpo?[]:[
        {id:'t-circle',shape:'circle',x:x+2.2,y:y-1.6,radius:1.15,fireTick:tick+30},
        {id:'t-line',shape:'line',x:x-1.2,y:y+1.4,radius:3.2,dx:-1,dy:.35,width:.9,fireTick:tick+12},
        {id:'t-cone',shape:'cone',x:x+.9,y:y+1.1,radius:2.4,dx:.45,dy:1,width:1.1,fireTick:tick+3},
      ],
      // acucar=1 (D-047): both critters bought a sweet from Dona Cida (EnemyView.sugar, protocol 15).
      enemies:[{id:'e1',kind:'bebado',x:x-1.6,y:y-1.2,hp:5,maxHp:5,...sugar},{id:'e2',kind:'agiota',x:x+1.5,y:y-.2,hp:5,maxHp:5,...sugar}],
      pickups:[{id:'g1',kind:'xp',x:x-.7,y:y-2.1,value:5}]};
    const nests=ninhos?nestLab(view,x,y):undefined;
    if(veiculos)view.pickups.push(...VEHICLE_KINDS.map((kind,i)=>({id:`v${i}`,kind:'vehicle' as const,resource:kind,x:x-2.4+i*2.4,y:y+2.2,value:i})));
    horde.push(nests?nests.asleep:cast?withCast(view,x,y):view);
    const you=new YouMarkers(this,reducedMotion,this.outlines);you.setCity(true);you.showArrow(-1e9);
    const labels=limpo?[]:[new MapLabel(this,'Concursei').setCity(true),new MapLabel(this,'Tia, 18 s').setCity(true).setSos(true),...(fallenBy?[new MapLabel(this,fallenBy).setCity(true).setSolid(true).setInside(true)]:[])];
    const destination=this.add.graphics().setDepth(ALLY_DEPTH-1); // under the fichas, as the scene
    this.lab={horde,projector,you,labels,destination,view,pushed:-1,...(nests?{nests}:{})};
    this.markDestination();
  }
  /** torres=1|12: the defenses around the hero (see the header) and the renderer on the city's projection. */
  /** `kit=<peça>`: the kit's ghost (hud/kit-place KitPlace, the room's footprint) beside the kit's obra. */
  private mountKit(){
    const c=this.asset.cell,cell=CITY_BUILD_CELL,projector=this.cityProjector();
    // barricada-tocar-no-mapa: a kit de torre's ghost is the tower's own art (the sandbox's tower renderer).
    this.fortify??=new FortifyRenderer(this,{projector,reduced:reducedMotion,cell,playerAt:()=>undefined,
      towerGhost:g=>g?this.towers?.setGhost({...g,kind:g.kind as TowerKind})??false:(this.towers?.setGhost(null),false)});
    const obra={x:this.at.x+KIT_OBRA.dx*c,y:this.at.y+KIT_OBRA.dy*c};
    const structures=isTowerKit(kitParam!)?[{id:'kit-obra',kind:kitParam!,x:obra.x,y:obra.y,hp:100}]:[];
    const place=new KitPlace(()=>0);
    place.start(0,`kit:${kitParam}`);
    // barricada-tocar-no-mapa: `giro=1` shows the barricade turned (the drag's other axis).
    if(params.get('giro')==='1')place.turn();
    place.point(params.get('fantasma')==='ocupado'?obra:{x:this.at.x+KIT_GHOST.dx*c,y:this.at.y+KIT_GHOST.dy*c},cell);
    this.fortify.setGhost(place.ghost({cell,structures}));
  }
  private mountTowers(){
    const asset=this.asset,c=asset.cell,{x,y}=this.at,tick=0;
    let made=0;
    const make=(kind:TowerKind,dx:number,dy:number,extra:Partial<TowerView>={}):TowerView=>{
      const hp=100,foot=towerFootprint(kind,c,'x'); // the sim's footprint (the Gustavão: its rail along x)
      made++;
      return {id:`defesa-${made}`,kind,x:x+dx*c,y:y+dy*c,r:foot.r,...(foot.half?{half:foot.half}:{}),hp,maxHp:hp,startTick:tick-1,readyTick:tick,fireTick:tick+((made*7)%20),...extra};
    };
    if(towersParam===2){
      towerList.forEach((k,i)=>{const a=-Math.PI/2+i*Math.PI/3;this.defenses.push(make(k,Math.cos(a)*2.4,Math.sin(a)*2.4,listFires?{}:{fireTick:1e9}));});
    }else if(kitParam){
      // kit=: only the kit's tower, in obra (the showcase would hide it).
      if(isTowerKit(kitParam))this.defenses.push(make(kitParam,KIT_OBRA.dx,KIT_OBRA.dy,{id:'kit-obra',startTick:-1e6,readyTick:1e6}));
    }else if(towersParam===12){
      const kinds:TowerKind[]=['vigia-do-predio','vigias-armados','atiradores-do-telhado','ninho-de-metralhadora','guarnicao-do-predio','ninho-do-sniper',
        'equipe-antimaterial','rojao-de-festa','morteiro','lanca-foguetes','holofote','arame-e-sirene'];
      kinds.forEach((k,i)=>{const a=i/12*Math.PI*2;this.defenses.push(make(k,Math.cos(a)*4.6,Math.sin(a)*4.6));});
    }else{
      const far=1e6;
      this.defenses.push(make('atiradores-do-telhado',-2.4,-1.6),make('morteiro',2.6,-1.4),make('holofote',.2,-2.6),
        make('arame-e-sirene',-2.6,1.8),make('obuseiro',2.8,2.2,{hp:40}),make('vigia-do-predio',.3,3.2,{startTick:-far,readyTick:far}),
        make('ninho-de-metralhadora',-4.6,-.2,{ruined:true,hp:0}),make('gustavao',4,-4,{fireTick:tick+45}));

      // Behind the tallest building within 9 u: one cell past its back corner along the view's depth axis (screen x kept).
      let best:{x:number;y:number;w:number;h:number;height:number}|undefined;
      for(const b of asset.blocks){
        const bx=asset.origin.x+(b.x+b.w/2)*c,by=asset.origin.y+(b.y+b.h/2)*c;
        if(Math.hypot(bx-x,by-y)<9&&b.height>=2.5&&(!best||b.height>best.height))best={x:bx,y:by,w:b.w*c,h:b.h*c,height:b.height};
      }
      if(best){ // its footprint just past the building's back corner (smaller x and y: farther from the camera in view 0)
        const r=c,bx=best.x-best.w/2-r-.2,by=best.y-best.h/2-r-.2;
        this.defenses.push(make('atiradores-do-telhado',(bx-x)/c,(by-y)/c,{id:'escondida'}));this.hidden=best;
      }
    }
    const n=this.horde.length;this.ex=new Float32Array(n);this.ey=new Float32Array(n);this.air=new Uint8Array(n);
    for(let i=0;i<n;i++)this.air[i]=i%10===9?1:0;
    if(!towersDrawn)return;
    const view=()=>this.view;
    // The craters over everything the city lays on its ground (glints +2, the lamps' light pools +3), under every
    // actor, as the game's TOWER_GROUND_DEPTH (scene.ts) is. Not that number itself: the game re-bases its depths
    // around the hero, the sandbox does not, so its actors far into the city (or in a turned view) sort below -9985.
    this.towers=new TowerRenderer(this,{reduced:reducedMotion,groundDepth:CITY_GROUND_DEPTH+4,actorScale:CITY_VIEW_SCALE,camera:this.cameras.main,
      ...(real?{cell:SCALE_PROFILES['cidade-nevada'].cell}:{}),
      depthVersion:()=>this.layer?.columnsVersion??0,
      world:{view,project:(px,py,z,out)=>{const p=project(px,py,groundZ(asset,px,py)+z,this.view);out.x=p.x;out.y=p.y;return out;},
        depth:(px,py)=>this.layer?this.layer.actorDepth(px,py,groundZ(asset,px,py)):0,
        effectDepth:(px,py)=>this.layer?this.layer.effectDepth(px,py,groundZ(asset,px,py)):0}});
    this.towers.setEnemies(n,this.ex,this.ey,this.air);
    this.towers.outline=towerOutline;this.towers.animate=towerAnim;
  }
  /** Stand-in for the sim's defensesStep (ready, cooldown, nearest reachable enemy), then the renderer's frame. */
  private stepTowers(time:number,dt:number){
    if(!this.defenses.length)return;
    if(this.simStart<0)this.simStart=time;
    if(slowMo>1){time=this.simStart+(time-this.simStart)/slowMo;dt/=slowMo;}
    const tick=Math.floor((time-this.simStart)*SIM_HZ/1000),n=this.horde.length;this.towerTick=tick;
    for(let i=0;i<n;i++){const w=this.horde[i];this.ex[i]=w.x;this.ey[i]=w.y;}
    for(const d of this.defenses){
      const l=TOWER_LOOK[d.kind];
      if(d.ruined||tick<d.readyTick||tick<d.fireTick)continue;
      const i=aimIndex(l,d.x,d.y,n,this.ex,this.ey,this.air);
      if(i<0)continue;
      // Like the sim on the wire: the aim (turns from +x) of the volley, so the renderer turns to it and never scans
      // the horde itself ("mira só no tiro"), as in the game.
      // The sim records no aim for an aura (the wire's spark ring: src/sim/towers/system.ts), so neither does this.
      if(l.calibre!=='arame')d.aim=(Math.atan2(this.ey[i]-d.y,this.ex[i]-d.x)/(Math.PI*2)+1)%1;
      d.fireTick=tick+Math.max(1,Math.round(l.cooldown*SIM_HZ));
      if(viaWire){
        if(l.calibre!=='arame')this.aims.set(d.id,((Math.atan2(this.ey[i]-d.y,this.ex[i]-d.x)/(2*Math.PI))%1+1)%1); // no aim for the aura, like the sim
        this.shots.set(d.id,((this.shots.get(d.id)??0)+1)&255);this.fired++;
      }
    }
    const t=this.towers;if(!t)return;
    if(viaWire){
      const wire:WireStructure[]=this.defenses.map(d=>({id:d.id,kind:d.kind,x:d.x,y:d.y,hp:d.hp,maxHp:d.maxHp,phase:d.ruined?'ruina':tick<d.readyTick?'obra-2':'pronta',
        ...(this.aims.has(d.id)?{aim:Math.round(this.aims.get(d.id)!*255)/255}:{}),...(this.shots.has(d.id)?{shots:this.shots.get(d.id)}:{})}));
      t.push(tick,this.feed.views(wire,tick,this.asset.cell,{enemies:{n,xs:this.ex,ys:this.ey,air:this.air}}),time);
    }else t.push(tick,this.defenses,time);
    // foco=torre: no figure for the fade test (the defense under the camera stays opaque in the recording).
    t.update(time,dt,towerFocus?[]:[{x:this.at.x,y:this.at.y,z:groundZ(this.asset,this.at.x,this.at.y)}]);
    // foco=torre: every frame (place() runs only when the hero moves; the mount exists once the defense is drawn).
    const m=towerFocus&&!cameraFixed?t.mountOf(this.defenses[0].id):undefined;
    if(m)this.cameras.main.centerOn(m.x,m.y);
  }
  /** The destination mark of scene.ts goTo, a little ahead of the hero. */
  private markDestination(){
    const lab=this.lab;if(!lab)return;
    const p=lab.projector.project(this.at.x-2.6,this.at.y-.4,{x:0,y:0});
    const m=destinationMark(CITY_VIEW_SCALE,1/Math.max(.05,this.cameras.main.zoom),true),breu=tokenColor('--c-breu'),papel=tokenColor('--c-papel');
    lab.destination.clear().lineStyle(m.breu,breu,m.breuAlpha).strokeEllipse(p.x,p.y,m.width,m.height).lineStyle(m.papel,papel,1).strokeEllipse(p.x,p.y,m.width,m.height)
      .fillStyle(breu,m.breuAlpha).fillCircle(p.x,p.y,m.dotBreu).fillStyle(papel,1).fillCircle(p.x,p.y,m.dotPapel);
  }
  private drawLab(time:number,dt:number){
    const lab=this.lab;if(!lab)return;
    lab.projector.view=this.view;
    if(arsenal){const step=Math.floor(time/ARSENAL_PUSH_MS);if(step!==lab.pushed){lab.pushed=step;lab.horde.push(arsenalView(lab.view,this.at.x,this.at.y,time,params.get('arma'),Number(params.get('aura')??0)||0));}}
    if(lab.nests){
      // The band wakes (asleep → awake: layers.ts plays `wake`), again every NEST_WAKE_MS; the modo foto's clock is fixed.
      const now=fotoT??time,step=fotoT!==undefined?0:Math.floor(time/NEST_WAKE_MS);
      if(step!==lab.pushed){lab.pushed=step;lab.horde.push(lab.nests.asleep);lab.horde.update(now-NEST_WAKE_AGO_MS,dt);lab.horde.push(lab.nests.awake);}
      this.layer?.vivo?.setNests(lab.nests.list,this.view,(nx,ny)=>{const p=lab.projector.project(nx,ny,{x:0,y:0});return {x:p.x,y:p.y,depth:lab.projector.depth(nx,ny)};});
      time=now;
    }
    lab.horde.update(time,dt);
    const feet={x:this.hero.x,y:this.hero.y},zoom=this.cameras.main.zoom;
    lab.you.update(time,zoom,[{id:'self',sprite:this.hero,self:true,feet,covered:this.layer?.covers(this.at.x,this.at.y)??false,hp:1,maxHp:1,downed:false,facing:Math.PI/2,...(veiculos?{ride:{kind:'carrinho' as const,left:.6}}:{})}]);
    // Two fichas as the scene anchors an ally's (15 px under the feet × the actor scale), beside the hero.
    const q=lab.projector.project(this.at.x+3.5,this.at.y+.5,{x:0,y:0}),r=lab.projector.project(this.at.x-3.5,this.at.y-1,{x:0,y:0});
    lab.labels[0]?.anchor(q.x,q.y+15*CITY_VIEW_SCALE,96401).draw(zoom,true);
    lab.labels[1]?.anchor(r.x,r.y+15*CITY_VIEW_SCALE,96401).draw(zoom,true);
    lab.labels[2]?.anchor(r.x,r.y+15*CITY_VIEW_SCALE+stackedLabelOffsetCss(ENEMY_NAME_H_CSS,true,true)/Math.max(.05,zoom),96401).draw(zoom,true);
  }
  /** The game's city zoom for this viewport (or the `cells` override), then the camera onto the hero. */
  private fit(){
    const viewport={width:this.scale.width,height:this.scale.height};
    const zoom=cellsOverride?viewport.width/(cellsOverride*this.asset.cell*TILE_X*Math.SQRT2):cityZoom(viewport,zoomK);
    this.cameras.main.setSize(viewport.width,viewport.height).setZoom(zoom);
    this.place();
  }
  /** acao=1: the action slot in the attack mode, the stand-ins as its enemies, an optional held drag for prints. */
  private async mountAttack(){
    await Promise.all([import('../explore.css'),import('../coop.css')]);
    const slot=document.createElement('div');slot.className='cidade-acao';slot.innerHTML=SKILL_HTML;
    slot.style.cssText='position:fixed;right:max(24px,env(safe-area-inset-right));bottom:max(24px,env(safe-area-inset-bottom));z-index:9';
    host.append(slot);
    const button=slot.querySelector<HTMLButtonElement>('#coop-attack')!,skill=this.skill=new SkillButton(button,classId);skill.setCombat('manual');
    let chosen:string|undefined;
    const toScreen=(p:{x:number;y:number})=>{
      const w=project(p.x,p.y,groundZ(this.asset,p.x,p.y),this.view),cam=this.cameras.main,r=this.game.canvas.getBoundingClientRect();
      return {x:r.left+(w.x-cam.worldView.x)*cam.zoom,y:r.top+(w.y-cam.worldView.y)*cam.zoom};
    };
    this.attack=new AttackButton(button,host,{hero:()=>this.at,toScreen,
      enemies:()=>this.horde.map((w,i)=>({id:`b${i}`,kind:'bebado',x:w.x,y:w.y,hp:1,maxHp:1})),tick:()=>0,
      chosen:()=>chosen,choose:id=>{chosen=id;},wake:()=>undefined,setHeld:held=>skill.setHeld(held)});
    this.attack.setOn(true);
    const drag=params.get('arrasto')?.split(',').map(Number);
    if(drag||params.get('segura')==='1'){
      const r=button.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
      button.dispatchEvent(new PointerEvent('pointerdown',{pointerId:7,button:0,clientX:x,clientY:y,bubbles:true}));
      if(drag)button.dispatchEvent(new PointerEvent('pointermove',{pointerId:7,clientX:x+(drag[0]||0),clientY:y+(drag[1]||0),bubbles:true}));
    }
    (window as unknown as {__acao?:unknown}).__acao={held:()=>this.attack?.press.held,chosen:()=>chosen};
  }
  /** Stand-in enemies: one shared Breu-ringed disc texture, scaled like the city figures, wandering around the hero. */
  private spawnHorde(){
    if(!enemies)return;
    if(!this.textures.exists('cidade:bicho')){
      const t=this.make.graphics({x:0,y:0},false);
      t.fillStyle(CITY_PALETTE.breu,0.38).fillEllipse(24,44,30,10);
      t.fillStyle(0x7fae5a,1).fillCircle(24,26,15).lineStyle(2,CITY_PALETTE.breu,1).strokeCircle(24,26,15);
      t.generateTexture('cidade:bicho',48,52);t.destroy();
    }
    for(let i=0;i<enemies;i++){
      const a=this.rng()*Math.PI*2,r=(HORDE_INNER||2)+this.rng()*9;
      const x=this.at.x+Math.cos(a)*r,y=this.at.y+Math.sin(a)*r;
      this.horde.push({x,y,tx:x,ty:y,speed:1.6+this.rng()*0.6,image:this.add.image(0,0,'cidade:bicho').setOrigin(.5,.85).setScale(CITY_VIEW_SCALE)});
    }
  }
  private moveHorde(dt:number){
    const s=Math.min(0.05,dt/1000);
    for(const w of this.horde){
      const dx=w.tx-w.x,dy=w.ty-w.y,d=Math.hypot(dx,dy);
      if(d<0.2){const a=this.rng()*Math.PI*2,r=(HORDE_INNER||1.5)+this.rng()*8;w.tx=this.at.x+Math.cos(a)*r;w.ty=this.at.y+Math.sin(a)*r;continue;}
      w.x+=dx/d*w.speed*s;w.y+=dy/d*w.speed*s;
    }
  }
  /** Hero at the layer's actor depth (city mode: no fixed SELF_DEPTH), camera snapped like the game's follow camera. */
  private place(){
    const feet=project(this.at.x,this.at.y,groundZ(this.asset,this.at.x,this.at.y),this.view),cam=this.cameras.main,zoom=cam.zoom;
    // empurrando=: the figure drawn on the car (its shift), the camera on the real spot, as the game; the silhouette
    // follows the drawn hero (castSilhouette at hero.x/y)
    const s=this.pushShift,drawn=s.x||s.y?project(this.at.x+s.x,this.at.y+s.y,groundZ(this.asset,this.at.x,this.at.y),this.view):feet;
    this.hero.setPosition(drawn.x,drawn.y);
    const viewport={width:this.scale.width,height:this.scale.height};
    const c=this.camera.snap(feet,viewport,zoom);
    if(!cameraFixed)cam.centerOn(c.x,c.y);
    if(this.lab){this.lab.horde.refresh();this.markDestination();}
    if(ruler)this.drawRuler(feet,zoom);
    (window as unknown as {__cidade:unknown}).__cidade={...meter,ground:()=>(this.layer?.groundSettled()??true)&&!this.load.isLoading(),outlines:()=>this.outlines.stats(),relief:()=>this.layer?.reliefStats(),zoom,view:this.view,classId,scale:CITY_VIEW_SCALE,base:base?basePhase:false,
      heroPx:HERO_WORLD_PX*CITY_VIEW_SCALE*zoom,torres:()=>this.towers?.live(),towersStats:()=>this.towers?.labStats(),towersHidden:(what:string)=>{if(this.towers){this.towers.labHidden=what;if(!what)this.towers.labShow();}},shake:()=>this.towers?.shakeNow()??0,towerCount:this.defenses.length,defenses:()=>this.defenses,volleys:()=>({fired:this.fired,drawn:this.towers?.volleysDrawn??0}),
      // torres-animacao-idle-tiro (the FPS check): bytes of every texture source in the GPU (w × h × 4) and those of the towers.
      texBytes:()=>{let all=0,towers=0;for(const k of this.textures.getTextureKeys()){let b=0;for(const s of this.textures.get(k).source)b+=(s.width||0)*(s.height||0)*4;all+=b;if(k.startsWith('art:torres:'))towers+=b;}return {all,towers};},hidden:this.hidden,heroCovered:()=>this.layer?.covers(this.at.x,this.at.y)??false,freeze:()=>this.game.loop.sleep(),golpe:()=>++this.swings,cair:(on=true)=>{this.fallen=on;},at:this.at,
      /** Walk proofs (passo-sem-deslizar): moves the hero and its follow camera like a game frame. */
      move:(x:number,y:number)=>{this.at.x=x;this.at.y=y;this.place();},hero:this.hero,mate:this.mate,
      /** objetivo=1 (inimigos-querem-o-uno): the car, its hits and when it last took one (the renderer clock). */
      uno:()=>this.chaveiro?.renderer.hitState(),
      /** camera=fixa: from now on the camera stays put (the hero walks across a still ground). */
      fixar:(on=true)=>{cameraFixed=on;},
      /** With the loop asleep (freeze), one game frame of `dt` ms: frame-exact takes (the screenshot never runs a frame). */
      step:(dt:number)=>{this.stepAt=(this.stepAt??performance.now())+dt;this.game.step(this.stepAt,dt);},cell:this.asset.cell,visibleCells:viewport.width/zoom/(TILE_X*Math.SQRT2)/this.asset.cell,
      viewport,orientation:viewport.width>viewport.height?'landscape':'portrait',falas:()=>this.chaveiro?.talk?.said.map(s=>({...s}))??[],
      falaBubbles:()=>(this.chaveiro?.talk?.horde??this.lab?.horde)?.stats().byLayer.bubbles,falaClock:()=>this.time.now};
  }
  /**
   * regua=1: a Breu/Papel bar standing on the ground half a hero's width left of his feet, a tick at every hero height
   * (the sheet's drawn height: HERO_WORLD_PX × CITY_VIEW_SCALE world px) labelled 1×…5×, over everything.
   */
  private drawRuler(feet:{x:number;y:number},zoom:number){
    const r=this.ruler??=(()=>({g:this.add.graphics().setDepth(100002),labels:Array.from({length:RULER_STEPS},(_,i)=>this.add.text(0,0,`${i+1}×`,
      {fontFamily:'system-ui',fontSize:'13px',fontStyle:'bold',color:'#1E1530',backgroundColor:'#EEDDB8',padding:{x:3,y:1}}).setOrigin(1,.5).setDepth(100003))}))();
    const unit=HERO_WORLD_PX*CITY_VIEW_SCALE,k=1/zoom,x=feet.x-unit*.55,g=r.g;g.clear();
    g.fillStyle(0x1e1530,1).fillRect(x-3*k,feet.y-unit*RULER_STEPS,6*k,unit*RULER_STEPS);
    for(let i=0;i<RULER_STEPS;i++){
      const y0=feet.y-unit*(i+1),y1=feet.y-unit*i;
      g.fillStyle(i&1?0x1e1530:0xeeddb8,1).fillRect(x-2*k,y0,4*k,y1-y0);
      g.fillStyle(0x1e1530,1).fillRect(x-9*k,y0-1*k,18*k,2*k);
      r.labels[i].setPosition(x-11*k,y0).setScale(k);
    }
  }
  private tick(dt:number){
    const cam=this.cameras.main.worldView,layer=this.layer;
    if(!layer)return;
    const z=groundZ(this.asset,this.at.x,this.at.y);
    // pip=1: the chunks around the car stay built, as the game does (scene.ts updateCity, PIP_KEEP_PX).
    const car=this.pip&&this.chaveiro?this.cityProjector().project(this.chaveiro.fake.view(0).view.car.x,this.chaveiro.fake.view(0).view.car.y,{x:0,y:0}):undefined;
    const also=car&&{x:car.x-PIP_KEEP_PX,y:car.y-PIP_KEEP_PX,w:PIP_KEEP_PX*2,h:PIP_KEEP_PX*2};
    layer.update({camera:{x:cam.x,y:cam.y,w:cam.width,h:cam.height},view:this.view,dtMs:dt,hero:{...this.at,z},...(also?{also}:{})});
    const d=layer.actorDepth(this.at.x,this.at.y,z);this.hero.setDepth(d);castSilhouette(this.shadow,this.hero,this.hero.x,this.hero.y,true,d-1);
    if(this.ally){const at=allyAt(this.at.x,this.at.y),az=groundZ(this.asset,at.x,at.y),q=project(at.x,at.y,az,this.view);this.ally.setPosition(q.x,q.y).setDepth(layer.actorDepth(at.x,at.y,az));}
    if(this.mate){const at=this.mateAt,s=this.mateShift,az=groundZ(this.asset,at.x,at.y),q=project(at.x+s.x,at.y+s.y,az,this.view),md=layer.actorDepth(at.x,at.y,az);this.mate.setPosition(q.x,q.y).setDepth(md);}
    for(const w of this.horde){
      const wz=groundZ(this.asset,w.x,w.y),p=project(w.x,w.y,wz,this.view);
      w.image.setPosition(p.x,p.y).setDepth(layer.actorDepth(w.x,w.y,wz));
    }
  }
}

const start=()=>new Phaser.Game({type:Phaser.AUTO,parent:host,backgroundColor:'#2B2542',scene:[CitySandbox],
  scale:{mode:Phaser.Scale.RESIZE,width:innerWidth,height:innerHeight},render:{antialias:true}});
// The art manifest first (as the game does at boot): the city art (unless arte=0) and, with base=1, the base art;
// zoom=pc also takes the computer's enemy copies (manifest.ts pcCell), as the game on a fine pointer.
if(base||params.get('arte')!=='0')void loadArtManifest(undefined,params.get('zoom')==='pc').then(start);else start();

/** elenco=1: one critter of every kind (and an elite bêbado) and every pickup on a ring around (x, y), world units. */
function withCast(view:RunView,x:number,y:number):RunView{
  const kinds:string[]=castIds.length?castIds:[...ENEMY_KINDS.filter(k=>k!=='chefe'),'bebado'],n=kinds.length+PICKUP_KINDS.length;
  const at=(i:number,r:number)=>({x:x+Math.cos(i/n*Math.PI*2)*r,y:y+Math.sin(i/n*Math.PI*2)*r});
  return {...view,
    // ferido=1: the cast is hurt, so the health bars (efeitos/barra-vida-*) show.
    enemies:[...view.enemies,...kinds.map((kind,i)=>({id:`c${i}`,kind,elite:(!castIds.length&&i===kinds.length-1)||eliteIds.includes(kind),...(kind===bossId?{boss:true}:{}),...at(i,2.6),hp:params.has('ferido')?1+i%4:5,maxHp:5}))],
    pickups:[...view.pickups,...PICKUP_KINDS.map((kind,i)=>({id:`p${i}`,kind,...at(kinds.length+i,1.7),value:1}))]};
}

/**
 * ninhos=1: the nests in a column through (x, y) — asleep up the screen, active by the hero, destroyed down it — and the views of
 * its critters: four sleeping by the asleep nest, four by the active one that wake (asleep in the first view only).
 */
function nestLab(base:RunView,x:number,y:number):{list:LiveNest[];asleep:RunView;awake:RunView}{
  const asleepAt={x:x-5,y:y-5},activeAt={x:x+1.5,y:y+1.5},list:LiveNest[]=[
    {id:'ninho-a',...asleepAt,size:'G',hp:60,awake:false},{id:'ninho-b',...activeAt,size:'M',hp:40,awake:true},
    {id:'ninho-c',x:x+6.5,y:y+6.5,size:'M',hp:0,awake:true}];
  const kinds=ENEMY_KINDS.filter(k=>k!=='chefe').slice(0,4);
  const band=(at:{x:number;y:number},tag:string,asleep:boolean)=>kinds.map((kind,i)=>{
    const a=i/kinds.length*Math.PI*2+.4;
    return {id:`${tag}${i}`,kind,x:at.x+Math.cos(a)*1.9,y:at.y+Math.sin(a)*1.9,hp:5,maxHp:5,...(asleep?{asleep:true as const}:{})};
  });
  const view=(waking:boolean):RunView=>({...base,telegraphs:[],pickups:[],enemies:[...band(asleepAt,'z',true),...band(activeAt,'w',waking)]});
  return {list,asleep:view(true),awake:view(false)};
}
