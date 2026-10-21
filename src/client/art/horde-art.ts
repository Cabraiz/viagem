/**
 * Imported art v2 for the horde renderer (NEW-20261012-ORQ-importar-arte-b-ligacao): enemies drawn from the importer's
 * 8-direction sheets when the manifest has them, today's procedural art (render/textures.ts) otherwise. With an empty
 * manifest nothing is queued and applyEnemyArt always answers false, so the game looks exactly as before.
 *
 * Pure helpers (ENEMY_ART_ID, STATIC_ART, enemyArtKey, facingRow, chooseAnim, enemyFrame, enemyDrawScale, artLoads)
 * run in node tests; the Phaser side (queueHordeArt, applyEnemyArt, resetEnemyArt) only touches the scene it is given
 * and imports Phaser as a type, so this module loads without Phaser.
 */
import type Phaser from 'phaser';
import {artIndex,artPages,artPiece,artUrl,type ArtFile,type ArtGroupId,type ArtPage,type ArtPiece} from './manifest.ts';
import {ELITE_SCALE,ENEMY_ART,ENEMY_KINDS,FX,PICKUP_SIZE,enemyTexture,pickupTexture,type EnemyKind} from '../render/keys.ts';
import {BOSS_PHASE2,actionDuration,deathAlpha,onceColumn} from './horde-actions.ts';
import {queueFramesArt} from './frames-art.ts';
import {POOF_MS} from '../render/motion.ts';
import {CIDADE_MODIFIERS,cidadeModifierLabel,roleOf,type EnemyRole} from '../../rules/index.ts';
import {queueTelegraphArt} from '../render/telegraph-art.ts';
import {allItemDisplays} from '../hud/items.ts';
import {ARSENAL_PROJECTILE_ALIAS} from '../render/arsenal-rules.ts';
import {backgroundHeld,onBackgroundFree} from '../preload/background-hold.ts';
import type {CityOutlines,CityVariant} from '../render/city-outline.ts';

/**
 * Today's enemy kind → art id in the `inimigos` group (scripts/art-v2/spec.mjs). D-033/D-036 already renamed the
 * client kinds (gosma → bebado, pernilongo → pombos, fiscal → agiota; tio-pave, anao-molotov and chefe kept theirs),
 * so the map is the identity today; it stays a table so a later rename on either side is one line.
 * Elenco P1 (coach, motoboy, influencer): no piece in the importer yet, so they stay procedural (render/textures.ts,
 * with their acting pose) until the manifest lists them under these ids; nothing else changes when it does.
 */
export const ENEMY_ART_ID:Readonly<Record<EnemyKind,string>>={
  bebado:'bebado','anao-molotov':'anao-molotov',pombos:'pombos','tio-pave':'tio-pave',agiota:'agiota',chefe:'chefe',
  coach:'coach',motoboy:'motoboy',influencer:'influencer',
};
const LEGACY=new Set<string>(ENEMY_KINDS);
/**
 * Art id of an enemy (arte-do-roster-no-render): a legacy kind keeps ENEMY_ART_ID; any roster id (D-040) is its own
 * art id in the `inimigos` group. A roster id never borrows its base kind's art: without its own piece it keeps the
 * role's procedural reserve (render/textures.ts with the roster accent).
 */
export const enemyArtId=(viewKind:string,kind:EnemyKind)=>LEGACY.has(viewKind)?ENEMY_ART_ID[kind]:viewKind;
/** The importer's file key of an animation's elite layer (validate.mjs: `elite/<anim>`). */
export const eliteFile=(anim:string)=>`elite/${anim}`;
/**
 * Zueira round costumes (pedido 11 §7, "Round variants"): while round modifier `id` is on, every enemy of art `art`
 * wears the importer's file `elite/<variant>-<anim>` (delivered as `elite/<art>-<variant>-<anim>.png`) over its base;
 * an elite wears it under its own elite layer. It never picks the animation: a missing costume sheet just hides it.
 */
export interface RoundCostume {art:string;variant:string}
export const ROUND_COSTUMES:Readonly<Record<string,RoundCostume>>={
  'uncle-popsicle':{art:'tio-pave',variant:'picole'},'beanie-mosquito':{art:'pombos',variant:'gorro'},
};
/** The importer's file key of an animation's round costume layer. */
export const costumeFile=(variant:string,anim:string)=>`elite/${variant}-${anim}`;
const COSTUME_BY_LABEL:ReadonlyMap<string,RoundCostume>=new Map(CIDADE_MODIFIERS.filter(m=>ROUND_COSTUMES[m.id]).map(m=>[cidadeModifierLabel(m),ROUND_COSTUMES[m.id]]));
/** The costume of the round whose banner reads `modifier` (the round event's label), or undefined. */
export const roundCostume=(modifier:string|undefined):RoundCostume|undefined=>modifier===undefined?undefined:COSTUME_BY_LABEL.get(modifier);
/** Texture key of one page of an enemy sheet: `art:enemy:<id>:<file>` plus `:p<n>` (1-based) when the sheet is paged. */
export const enemyArtKey=(id:string,file:string,page=0,pages=1)=>`art:enemy:${id}:${file}${pages>1?`:p${page+1}`:''}`;

/**
 * Static textures of today's renderer that an imported piece replaces (design/inventario-sprites.md §7–8). The first
 * id of `ids` present in `group` wins; only frame 0 is used (today's renderers draw these still).
 * - 'sheet': loaded as a spritesheet under today's key (projectiles: layers.ts scales them by the texture width, so
 *   the imported resolution is kept and the on-screen size does not change).
 * - 'bake': loaded under `art:<group>:<id>` and frame 0 drawn (contain-fit and centred, or stretched with fit 'fill')
 *   into a canvas under today's key at today's size: pickups and FX are drawn at their texture size, and the
 *   shadow/bars scale by fixed constants.
 * Either way textures.ts's `exists(key)` check then skips the procedural drawing.
 * Not mapped: the hostile star (its look is the per-source 'tiro-inimigo', HOSTILE_SHOT_ART), the life bars (9-slice;
 * today they stretch by scale) and per-resource pickups (today one generic 'resource' texture: only the generic
 * 'recurso' may replace it, never a coconut or a stone). Per-source projectiles (each weapon, the agiota's boleto)
 * load under their own key (projectileArtKey, see projectileLook); 'tiro-aliado' stays here as the look of a friendly shot without its own art.
 */
export interface StaticArt {key:string;group:ArtGroupId;ids:readonly string[];mode:'sheet'|'bake';size?:readonly [number,number];fit?:'contain'|'fill'}
const pickup=(kind:keyof typeof PICKUP_SIZE,ids:string[]):StaticArt=>({key:pickupTexture(kind),group:'itens',ids,mode:'bake',size:[PICKUP_SIZE[kind].width,PICKUP_SIZE[kind].height]});
export const STATIC_ART:readonly StaticArt[]=[
  pickup('heal',['coxinha']),
  pickup('chest',['bau','bau-fechado']),
  pickup('resource',['recurso']),
  // Size of render/textures.ts BOLETO_SIZE (that module imports Phaser at runtime).
  {key:FX.boleto,group:'itens',ids:['boleto-chuva','boleto'],mode:'bake',size:[46,34]},
  {key:FX.projFriendly,group:'projeteis',ids:['tiro-aliado'],mode:'sheet'},
  // Sizes of render/textures.ts drawFx (layers.ts scales the shadow by SHADOW_W/H = 46×16 of the 48×18 texture).
  // Stretched (not contained): the contact shadow keeps today's 48×18 footprint whatever its cell's aspect.
  {key:FX.shadow,group:'efeitos',ids:['sombra','sombra-contato'],mode:'bake',size:[48,18],fit:'fill'},
  {key:FX.puff,group:'efeitos',ids:['poof','morte-poof'],mode:'bake',size:[64,64]},
  {key:FX.warning,group:'efeitos',ids:['aviso-spawn'],mode:'bake',size:[40,40]},
];
/**
 * The death poof without a `death` sheet (art-d item 6). The 'bake' above keeps frame 0 under FX.puff (the kill-cam and
 * any other FX.puff user); the in-game poof plays the whole strip, already loaded as a sheet under `art:efeitos:<id>`
 * (artLoads), one frame after the other over today's POOF_MS, at today's 64×64 size (`fit`, contain) and tint.
 */
export interface PoofArt {key:string;frames:number;fit:number}
const POOF_ART=STATIC_ART.find(s=>s.key===FX.puff) as StaticArt;
const poofCache=new WeakMap<ArtPiece,PoofArt|null>();
/** The imported poof strip, or undefined (today's FX.puff; always with an empty manifest). */
export function poofArt():PoofArt|undefined{
  let id:string|undefined,piece:ArtPiece|undefined;
  for(let i=0;i<POOF_ART.ids.length&&!piece;i++){id=POOF_ART.ids[i];piece=artPiece('efeitos',id);}
  if(!piece||!id)return undefined;
  let art=poofCache.get(piece);
  if(art===undefined){
    const file=piece.files.sheet??Object.values(piece.files)[0],page=file&&artPages(file)[0],[w,h]=POOF_ART.size as readonly [number,number];
    art=file&&page&&validCell(file)?{key:`art:efeitos:${id}`,frames:Math.max(1,page.frameCount),fit:Math.min(w/file.cell[0],h/file.cell[1])}:null;
    poofCache.set(piece,art);
  }
  return art??undefined;
}
/** Frame of a poof strip of `frames` frames `ageMs` after the kill: once over POOF_MS, the last frame holds. */
export const poofSheetFrame=(ageMs:number,frames:number)=>frames<=1?0:Math.min(frames-1,Math.floor(Math.max(0,ageMs)/POOF_MS*frames));
/**
 * Per-source projectiles (item 2 of NEW-20261012-ORQ-importar-arte-c-completa). The `projeteis` ids of the weapons are
 * the weapon ids (ProjectileView.source, evolutions included); the hostile ones are the agiota's 'boleto-juros' (a real
 * projectile) and the anão's bottle and the pigeon's poop, which today are telegraphs, not projectiles (aliases below,
 * in case a source ever carries them). Each one present in the manifest loads under its own key `art:proj:<id>`;
 * absent, the shot keeps today's key (keys.ts projectileTexture), so no art = the same textures as before.
 * The sim fires no other hostile shot today (src/sim/enemies/ai.ts: only AGIOTA_SHOT); any other hostile source (a newer
 * server, the sandboxes) is today's star (FX.projHostile), whose look is HOSTILE_SHOT_ART under `art:proj:tiro-inimigo`.
 */
// D-051 arsenal: the bullets and the rojão's rocket (render/arsenal-rules.ts ARSENAL_PROJECTILE_ALIAS names the weapons).
export const WEAPON_PROJECTILE_IDS=['chinelo','boleto','cafe','guarda-chuva','pombo','audio','chinelo-evo','boleto-evo','cafe-evo','garrafa-molotov',
  'bala-revolver','bala-metralhadora','bala-fuzil','rojao'] as const;
export type WeaponProjectileId=typeof WEAPON_PROJECTILE_IDS[number];
/** The shared look of a hostile shot without its own art (the friendly one is 'tiro-aliado'). */
export const HOSTILE_SHOT_ART='tiro-inimigo';
export const HOSTILE_PROJECTILE_IDS=['boleto-juros','coco-pombo',HOSTILE_SHOT_ART] as const;
/** Every `projeteis` id with its own key ('tiro-aliado' is not one: it is the shared friendly look, STATIC_ART). */
export const PROJECTILE_ART_IDS:readonly string[]=[...WEAPON_PROJECTILE_IDS,...HOSTILE_PROJECTILE_IDS];
const PROJECTILE_ART_SET=new Set(PROJECTILE_ART_IDS);
/** Built once: the per-frame path never concatenates a key. */
const PROJECTILE_KEYS=new Map<string,string>();
/** Sources whose art id differs from the source (a Map: a source string never reaches Object.prototype); the D-051 arsenal's too. */
export const PROJECTILE_ALIAS:ReadonlyMap<string,string>=new Map([['molotov','garrafa-molotov'],['coco','coco-pombo'],['poop','coco-pombo'],...ARSENAL_PROJECTILE_ALIAS]);
/** Texture key of a projectile's own art. */
export const projectileArtKey=(id:string)=>`art:proj:${id}`;
for(const id of PROJECTILE_ART_IDS)PROJECTILE_KEYS.set(id,projectileArtKey(id));
/** `projeteis` art id of a projectile source, or undefined (then only the shared looks apply). */
export const projectileArtId=(source:string):string|undefined=>PROJECTILE_ALIAS.get(source)??(PROJECTILE_ART_SET.has(source)?source:undefined);
/** The key each weapon's shot uses when its art exists. */
export const WEAPON_PROJECTILE_KEY:Readonly<Record<WeaponProjectileId,string>>=
  Object.fromEntries(WEAPON_PROJECTILE_IDS.map(id=>[id,PROJECTILE_KEYS.get(id) as string])) as Record<WeaponProjectileId,string>;
/** The sheet of a `projeteis` piece ('sheet', else its first file). */
function projectileFile(id:string):ArtFile|undefined{
  const piece=artPiece('projeteis',id);if(!piece)return undefined;
  if(piece.files.sheet)return piece.files.sheet;
  for(const name in piece.files)return piece.files[name];
  return undefined;
}
/** A projectile's imported look: texture key, frame count (first page only) and fps; cached per file. */
export interface ProjectileLook {key:string;frames:number;fps:number}
const lookCache=new WeakMap<ArtFile,ProjectileLook>();
function lookOf(file:ArtFile,key:string):ProjectileLook{
  let l=lookCache.get(file);
  if(!l||l.key!==key){
    const page=artPages(file)[0];
    l={key,frames:Math.max(1,Math.min(file.frames??1,page?.frameCount??1)),fps:fileFps(file,'sheet')};
    lookCache.set(file,l);
  }
  return l;
}
/** Ids of the players' weapons and evolutions (hud/items.ts mirrors the server catalog): the sources of friendly shots. */
const PLAYER_WEAPON_SOURCES:ReadonlySet<string>=new Set(allItemDisplays().filter(i=>i.kind==='weapon'||i.kind==='evolution').map(i=>i.id));
/**
 * Look of a projectile from the manifest: its own art (`art:proj:<id>`), else for a friendly shot the shared
 * 'tiro-aliado' (loaded under FX.projFriendly), else undefined: the caller keeps keys.ts projectileTexture. A hostile
 * shot whose source is a player's weapon (a shot the influencer reflected back, sim/projectiles.ts reflectShot) never
 * wears that weapon's art: it reads as hostile (undefined → the hostile star). The renderer still checks that the key's
 * texture loaded. Allocation-free after the first call per file.
 */
export function projectileLook(hostile:boolean,source:string):ProjectileLook|undefined{
  if(hostile&&PLAYER_WEAPON_SOURCES.has(source))return undefined;
  const id=projectileArtId(source),own=id!==undefined?projectileFile(id):undefined;
  if(own)return lookOf(own,PROJECTILE_KEYS.get(id as string) as string);
  if(!hostile){const shared=projectileFile('tiro-aliado');if(shared)return lookOf(shared,FX.projFriendly);}
  // Hostile without its own art: the shared critter shot under its own key (a failed load keeps today's star).
  else{const shared=projectileFile(HOSTILE_SHOT_ART);if(shared)return lookOf(shared,PROJECTILE_KEYS.get(HOSTILE_SHOT_ART) as string);}
  return undefined;
}
/**
 * Frames a projectile may play with `look`: the look's frames, but never more than the texture under its key really has
 * (Phaser's frameTotal counts the __BASE frame too). A sheet that failed to load leaves today's procedural texture under
 * a shared key (FX.projFriendly) with no frames to step through: 1, so the renderer never calls setFrame on it.
 */
export function projectileFrames(textures:{exists(key:string):boolean;get(key:string):{frameTotal:number}},look:ProjectileLook):number{
  if(look.frames<=1||!textures.exists(look.key))return 1;
  return Math.max(1,Math.min(look.frames,textures.get(look.key).frameTotal-1));
}
/** Frame of an animated projectile `elapsedMs` after it appeared (loops at the sheet's fps). */
export const projectileFrame=(look:{frames:number;fps:number},elapsedMs:number)=>look.frames>1?Math.floor(Math.max(0,elapsedMs)/1000*look.fps)%look.frames:0;

/**
 * The enemy sheets load their lossy copy (scripts/art-lite.mjs, public/art/lite/enemies/<id>/<file>), like the hero
 * sheets; a copy that fails to load falls back to the approved file (scene artFallback, originalUrl).
 */
export const liteEnemyUrl=(url:string)=>url.replace('/art/enemies/','/art/lite/enemies/');

export interface ArtLoad {key:string;url:string;cell:[number,number];bake?:{key:string;size:readonly [number,number];fit:'contain'|'fill'}}
/**
 * Every texture the horde art needs up front, from the current manifest (empty manifest → []): per-source projectiles,
 * their first page; statics, frame 0 sheet of the first present id. No enemy: every enemy's art (the nine legacy kinds'
 * too, ~21 MB of lite base sheets and ~30 MB of elite layers since importar-todos-inimigos; the boss alone 11 + 19 MB)
 * loads per match the first time one of them shows up (queueEnemyArt), the procedural look standing in meanwhile.
 */
export function artLoads():ArtLoad[]{
  const out:ArtLoad[]=[];
  // Per-source projectiles: the first page of each sheet (projectileLook only plays the frames of that page).
  for(const id of PROJECTILE_ART_IDS){
    const file=projectileFile(id),page=file&&artPages(file)[0],url=page&&artUrl('projeteis',page.file);
    if(file&&url&&validCell(file))out.push({key:PROJECTILE_KEYS.get(id) as string,url,cell:file.cell});
  }
  for(const s of STATIC_ART){
    const id=s.ids.find(i=>artPiece(s.group,i));if(!id)continue;
    const piece=artPiece(s.group,id) as ArtPiece,file=piece.files.sheet??Object.values(piece.files)[0];
    const page=file&&artPages(file)[0],url=page&&artUrl(s.group,page.file);
    if(!file||!url||!validCell(file))continue;
    out.push(s.mode==='sheet'?{key:s.key,url,cell:file.cell}:{key:`art:${s.group}:${id}`,url,cell:file.cell,bake:{key:s.key,size:s.size as [number,number],fit:s.fit??'contain'}});
  }
  return out;
}
/**
 * Imported files no renderer draws yet, so no match downloads them: the rest rows `sleep`/`wake` and their elite and
 * costume layers (the nests' card draws them).
 */
export const unusedEnemyFile=(name:string)=>/^(elite\/([a-z0-9]+-)?)?(sleep|wake)$/.test(name);
/** Every page of every drawn file of enemy art `id` (a legacy kind's or a roster id's); [] without its piece. */
export function enemyPieceLoads(id:string):ArtLoad[]{
  const out:ArtLoad[]=[],piece=artPiece('inimigos',id);if(!piece)return out;
  for(const [name,file] of Object.entries(piece.files)){
    if(unusedEnemyFile(name))continue;
    const pages=artPages(file);
    pages.forEach((page,i)=>{
      const url=artUrl('inimigos',page.file);if(!url||!validCell(file))return;
      const lite=liteEnemyUrl(url);if(file.liteCell)LITE_ONLY.add(lite);
      out.push({key:enemyArtKey(id,name,i,pages.length),url:lite,cell:file.cell});
    });
  }
  return out;
}
/**
 * Lite copies smaller than their approved file (manifest.ts liteCell): the cells differ, so no fallback to it. The
 * city's (render/city/art-plan.ts cityTexture) count as smaller, except the base's: cityLiteScale keeps their cell
 * (the fountain, the wall and the barricades of art/base-art.ts), so the approved file can stand in.
 */
const LITE_ONLY=new Set<string>();
export const liteOnly=(url:string)=>LITE_ONLY.has(url)||url.startsWith('/art/lite/city/')&&!url.startsWith('/art/lite/city/base/');
const validCell=(f:ArtFile)=>Array.isArray(f.cell)&&f.cell[0]>0&&f.cell[1]>0;

/** Preload: queues every imported horde texture (nothing with an empty manifest). Failures keep the procedural art. */
export function queueHordeArt(scene:Phaser.Scene){
  for(const l of artLoads()){
    if(scene.textures.exists(l.bake?.key??l.key))continue;
    scene.load.spritesheet(l.key,l.url,{frameWidth:l.cell[0],frameHeight:l.cell[1]});
    const bake=l.bake;
    if(bake)scene.load.once(`filecomplete-spritesheet-${l.key}`,()=>bakeFrame(scene,l.key,l.cell,bake.key,bake.size,bake.fit));
  }
  queueFramesArt(scene); // 9-slice frames and ground marks (art/frames-art.ts)
  queueTelegraphArt(scene,false); // telegraph hatch + dashed border (render/telegraph-art.ts), ready on the first frame
}
/**
 * Per match (arte-do-roster-no-render): the roster's sheets are not in the preload (173 ids, 12-18 drawn per run);
 * the renderer asks for art `id` when the room names the run's rotation ({t:'elenco'}, scene.ts) or when an enemy of it shows up and its pages load
 * in the background. Until they do, the enemy keeps its reserve; applyEnemyArt switches by itself once they exist.
 * Each id is asked once per scene; true when something was queued. A failed page keeps the reserve.
 */
const asked=new WeakMap<object,Set<string>>();
/** Critters first seen while the background was held (queueEnemyArt): asked when it lets go. */
const deferred=new WeakMap<object,Set<string>>();
export function queueEnemyArt(scene:Phaser.Scene,id:string):boolean{
  // The opening's near art holds the link (background-hold.ts, cena-nasce-rapido): the critters seen under the cover
  // ask once it lets go (the procedural look stands in meanwhile, as for any sheet still on its way).
  if(backgroundHeld()){
    let wait=deferred.get(scene);
    if(!wait){
      const ids=wait=new Set<string>();deferred.set(scene,ids);
      const off=onBackgroundFree(()=>{
        off();if(deferred.get(scene)===ids)deferred.delete(scene);
        if(!scene.sys.isActive())return;
        for(const later of ids)queueEnemyArt(scene,later);
      });
    }
    wait.add(id);return false;
  }
  let seen=asked.get(scene);if(!seen){seen=new Set();asked.set(scene,seen);}
  if(seen.has(id))return false;
  seen.add(id);
  let queued=false;
  for(const l of enemyPieceLoads(id)){
    if(scene.textures.exists(l.key))continue;
    scene.load.spritesheet(l.key,l.url,{frameWidth:l.cell[0],frameHeight:l.cell[1]});queued=true;
  }
  if(queued&&!scene.load.isLoading())scene.load.start();
  return queued;
}
/** Frame 0 of `from` drawn into a new canvas texture `key` of `size`: contain-fit and centred, or stretched ('fill'). */
function bakeFrame(scene:Phaser.Scene,from:string,cell:[number,number],key:string,[w,h]:readonly [number,number],fit:'contain'|'fill'){
  if(scene.textures.exists(key)||!scene.textures.exists(from))return;
  const tex=scene.textures.createCanvas(key,w,h);if(!tex)return;
  const k=Math.min(w/cell[0],h/cell[1]),dw=fit==='fill'?w:cell[0]*k,dh=fit==='fill'?h:cell[1]*k,c=tex.getContext();
  c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';
  c.drawImage(scene.textures.get(from).getSourceImage() as CanvasImageSource,0,0,cell[0],cell[1],(w-dw)/2,(h-dh)/2,dw,dh);
  tex.refresh();
}

// ---------- pure: facing, animation and frame ----------
const TAU=Math.PI*2,SECTOR=TAU/8;
/** Extra angle (rad) past a sector's edge before the facing changes: no flicker on a diagonal. */
export const FACING_HYSTERESIS=.14;
/**
 * Sheet row (0..7 = S,SW,W,NW,N,NE,E,SE) for a motion in the camera's ground plane: gx to the right of the screen,
 * gy towards the viewer (S = coming at the camera). `prev` (a row, or -1) keeps the current row until the motion
 * leaves its sector by FACING_HYSTERESIS; no motion keeps `prev` (0 = facing the camera when there is none).
 */
export function groundFacingRow(gx:number,gy:number,prev=-1):number{
  if(gx*gx+gy*gy<1e-12)return prev>=0?prev:0;
  let a=Math.atan2(-gx,gy);if(a<0)a+=TAU; // 0 = S, growing through SW, W… (clockwise on screen)
  if(prev>=0){let d=Math.abs(a-prev*SECTOR)%TAU;if(d>Math.PI)d=TAU-d;if(d<=SECTOR/2+FACING_HYSTERESIS)return prev;}
  return Math.round(a/SECTOR)%8;
}
/** Row from a SCREEN-space motion (y down): the 2:1 isometric flattening is undone first. */
export const screenFacingRow=(sx:number,sy:number,prev=-1)=>groundFacingRow(sx,sy*2,prev);
/**
 * Row from a WORLD motion (dx,dy) seen through camera view `view` (0..3 quarter turns, render/projector.ts): the same
 * rotation as the projector, then its isometric axes (screen x ∝ rx−ry, screen y ∝ (rx+ry)/2).
 */
export function facingRow(dx:number,dy:number,view=0,prev=-1):number{
  const v=((Math.round(view)%4)+4)%4;
  const rx=v===1?-dy:v===2?-dx:v===3?dy:dx,ry=v===1?dx:v===2?-dy:v===3?-dx:dy;
  return groundFacingRow(rx-ry,rx+ry,prev);
}

const MOVING=['walk','fly','idle'],STILL=['idle','fly','walk'];
/**
 * Animation to play: moving → walk (else fly, as the pombos; else idle); still → idle (else fly, else the first base
 * animation). For an elite only animations with an elite layer count; none → undefined (the procedural elite stays).
 */
export function chooseAnim(piece:ArtPiece,moving:boolean,elite=false):string|undefined{
  const ok=(a:string)=>!!piece.files[a]&&(!elite||!!piece.files[eliteFile(a)]);
  for(const a of moving?MOVING:STILL)if(ok(a))return a;
  for(const a of Object.keys(piece.files))if(!a.startsWith('elite/')&&ok(a))return a;
  return undefined;
}

/** chooseAnim per piece for the 4 (moving, elite) cases: a new manifest brings new pieces, so it never goes stale. */
const animCache=new WeakMap<ArtPiece,(string|null|undefined)[]>();
export function cachedAnim(piece:ArtPiece,moving:boolean,elite:boolean):string|undefined{
  let c=animCache.get(piece);if(!c){c=[undefined,undefined,undefined,undefined];animCache.set(piece,c);}
  const i=(moving?2:0)+(elite?1:0);let a=c[i];
  if(a===undefined){a=chooseAnim(piece,moving,elite)??null;c[i]=a;}
  return a??undefined;
}

/** Frames per second of a file for `anim` (a number, or a map by animation); 8 when absent. */
export function fileFps(file:ArtFile,anim:string):number{
  const f=typeof file.fps==='number'?file.fps:file.fps?.[anim.replace(/^elite\//,'')];
  return typeof f==='number'&&f>0?f:8;
}
/**
 * Enemy animations play 30% slower than drawn (inimigos-sem-frases-anim-lenta, like the hero's HERO_ANIM_RATE): only the
 * frames, never the walking speed or the sim's attack and damage timing. Projectiles keep the file's rate.
 */
export const ENEMY_ANIM_RATE=.7;
const enemyFps=(file:ArtFile,anim:string)=>fileFps(file,anim)*ENEMY_ANIM_RATE;
/** What enemyFrame needs of a file, computed once per file (pages, texture keys, fps): nothing is built per frame. */
export interface FileInfo {id:string;anim:string;pages:readonly ArtPage[];keys:readonly string[];fps:number;frames:number;dirs:number}
const fileCache=new WeakMap<ArtFile,FileInfo>();
/** The cached FileInfo of art `id`'s file `anim` (the same object on every call for the same file). */
export function fileInfo(id:string,anim:string,file:ArtFile):FileInfo{
  let f=fileCache.get(file);
  if(!f||f.id!==id||f.anim!==anim){
    const pages=artPages(file);
    f={id,anim,pages,keys:pages.map((_,i)=>enemyArtKey(id,anim,i,pages.length)),fps:enemyFps(file,anim),
      frames:Math.max(1,file.frames??1),dirs:Math.max(1,file.directions??1)};
    fileCache.set(file,f);
  }
  return f;
}
export interface FrameRef {key:string;frame:number}
/**
 * Texture key and frame index of art `id`'s file `anim` at `row` and `timeMs`: frames loop at the file's fps (`once`:
 * `timeMs` is the time since the action started and the last frame holds); the frame is found in its page (pages
 * hold the frames in reading order, direction-major). Undefined when the file is missing. `out` avoids an allocation
 * per call.
 */
export function enemyFrame(id:string,piece:ArtPiece,anim:string,row:number,timeMs:number,out:FrameRef={key:'',frame:0},once=false):FrameRef|undefined{
  const file=piece.files[anim];if(!file)return undefined;
  const info=fileInfo(id,anim,file),frames=info.frames;
  return frameAt(info,row,once?onceColumn(timeMs,frames,info.fps):Math.floor(Math.max(0,timeMs)/1000*info.fps)%frames,out);
}
/** Column (0-based, within one direction) that enemyFrame shows for the same arguments, or -1 without the file. */
export function enemyColumn(id:string,piece:ArtPiece,anim:string,timeMs:number,once=false):number{
  const file=piece.files[anim];if(!file)return -1;
  const info=fileInfo(id,anim,file);
  return once?onceColumn(timeMs,info.frames,info.fps):Math.floor(Math.max(0,timeMs)/1000*info.fps)%info.frames;
}
/**
 * Texture key and frame of art `id`'s file `anim` at `row` and column `col` (a column past the file's last frame
 * shows its first): the elite layer of the loop under an action that has no elite layer of its own.
 */
export function enemyFrameAt(id:string,piece:ArtPiece,anim:string,row:number,col:number,out:FrameRef={key:'',frame:0}):FrameRef|undefined{
  const file=piece.files[anim];if(!file)return undefined;
  const info=fileInfo(id,anim,file);
  return frameAt(info,row,col>=0&&col<info.frames?col|0:0,out);
}
function frameAt(info:FileInfo,row:number,col:number,out:FrameRef):FrameRef|undefined{
  const frames=info.frames,pages=info.pages,r=Math.min(info.dirs-1,Math.max(0,row|0));
  const global=r*frames+col;
  for(let i=0;i<pages.length;i++){
    const p=pages[i];
    if(global>=p.firstFrame&&global<p.firstFrame+p.frameCount){out.key=info.keys[i];out.frame=global-p.firstFrame;return out;}
  }
  return undefined;
}
/** The imported elite draws this much bigger: today's ELITE_SCALE (keys.ts), so it matches the procedural elite. */
export const ELITE_ART_SCALE=ELITE_SCALE;
/**
 * Scale that puts an imported cell at today's size: the feet-to-top height of the procedural texture
 * (height × originY, render/keys.ts ENEMY_ART) equals the cell's (cell height × anchor y).
 */
export function enemyDrawScale(kind:EnemyKind,file:ArtFile,elite=false):number{
  const art=ENEMY_ART[kind],ay=file.anchor?.[1]??.88;
  return art.height*art.originY/(file.cell[1]*ay)*(elite?ELITE_ART_SCALE:1);
}

// ---------- drawn height (arte-do-roster-no-render, D-037): the figure, not the cell, sets the size ----------
/** The hero's standing figure in world px (D-030: sprites/character-sprites.ts scales every hero to 96). */
export const HERO_FIGURE_PX=96;
/**
 * Target feet-to-top height of an imported enemy, × the hero's (Orquestrador, 13/10/2026, on D-037's 0.9×): the
 * default 0.9; an enxame 0.5 (0.4-0.6); a voador 0.6 (a giant cockroach still reads huge); a brutamontes 1.3
 * (1.2-1.4); a mini-chefe 2; the chefe 3.
 */
export const ROLE_HEIGHT:Readonly<Partial<Record<EnemyRole,number>>>={enxame:.5,voador:.6,brutamontes:1.3,'mini-chefe':2,chefe:3};
export const DEFAULT_HEIGHT=.9;
/** Target figure height (world px) of enemy art `id` (a roster id or a legacy kind, by its role). */
export const artTargetHeight=(id:string)=>HERO_FIGURE_PX*(ROLE_HEIGHT[roleOf(id) as EnemyRole]??DEFAULT_HEIGHT);
/** Alpha of the figure's mass (≥ 0.5): the rim's soft edge and stray specks do not count. */
export const MASS_ALPHA=128;
/**
 * Topmost row (0-based) of an RGBA cell with a pixel at alpha ≥ `threshold`, or -1 when the cell is empty. Pure: the
 * Phaser side feeds it the first idle frame of each direction.
 */
export function topRow(data:ArrayLike<number>,width:number,height:number,threshold=MASS_ALPHA):number{
  for(let y=0;y<height;y++){const row=y*width*4;for(let x=0;x<width;x++)if(data[row+x*4+3]>=threshold)return y;}
  return -1;
}
/**
 * Scale of an imported sheet whose figure stands `drawn` cell px above the anchor (feet): the role's target height,
 * bigger for an elite like today's. Undefined (the caller keeps enemyDrawScale) when nothing was measured.
 */
export function drawnScale(id:string,drawn:number|undefined,elite=false):number|undefined{
  if(drawn===undefined||!(drawn>=4))return undefined;
  return artTargetHeight(id)/drawn*(elite?ELITE_ART_SCALE:1);
}
/** Measured feet-to-top height (cell px) per art id; null: not measurable (no canvas, empty frames). */
const drawnHeights=new Map<string,number|null>();
/** Forget the measures (tests; a new manifest brings new sheets under the same ids). */
export function resetDrawnHeights(){drawnHeights.clear();}
let probe:{canvas:HTMLCanvasElement;ctx:CanvasRenderingContext2D}|undefined;
/**
 * Figure height of art `id` in cell px: the tallest of the 8 directions' first frame of its still loop (idle, else
 * fly or walk), from the feet (the file's anchor) to the topmost pixel of alpha ≥ 0.5. Measured once, the first time
 * all those pages are loaded (undefined until then, so the caller keeps today's scale meanwhile).
 */
export function drawnHeight(textures:Phaser.Textures.TextureManager,id:string,piece:ArtPiece):number|undefined{
  const known=drawnHeights.get(id);if(known!==undefined)return known??undefined;
  const anim=cachedAnim(piece,false,false),file=anim?piece.files[anim]:undefined;
  if(!anim||!file){drawnHeights.set(id,null);return undefined;}
  const info=fileInfo(id,anim,file),ref:FrameRef={key:'',frame:0};
  for(let r=0;r<info.dirs;r++)if(!frameAt(info,r,0,ref)||!textures.exists(ref.key))return undefined; // not loaded yet
  let best:number|null=null;
  try{
    if(typeof document==='undefined')throw new Error('no canvas');
    const [w,h]=file.cell,feet=h*(file.anchor?.[1]??.88);
    if(!probe){const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('no 2d');probe={canvas,ctx};}
    const {canvas,ctx}=probe;canvas.width=w;canvas.height=h;
    for(let r=0;r<info.dirs;r++){
      frameAt(info,r,0,ref);
      const tex=textures.get(ref.key),fr=tex.get(ref.frame);
      ctx.clearRect(0,0,w,h);
      ctx.drawImage(tex.getSourceImage() as CanvasImageSource,fr.cutX,fr.cutY,fr.cutWidth,fr.cutHeight,0,0,fr.cutWidth,fr.cutHeight);
      const top=topRow(ctx.getImageData(0,0,w,h).data,w,h);
      if(top>=0&&top<feet)best=Math.max(best??0,feet-top);
    }
  }catch{best=null;}
  drawnHeights.set(id,best);
  return best??undefined;
}

/**
 * The looping animation of an enemy that is not acting: chooseAnim (cached), except the chefe from boss phase 2
 * (BOSS_PHASE2) standing still, who idles with 'phase2-idle' when the piece has it.
 */
export function loopAnim(piece:ArtPiece,moving:boolean,elite:boolean,bossPhase=1,act?:string):string|undefined{
  // The acting pose of the server phase (render/phase-look.ts actAnim: lecture, aim, pose, summon) loops while it lasts;
  // a kamikaze acting is aiming while still and charging while it dashes (sim ai.ts keeps it acting through the dash).
  if(act==='aim'&&moving&&piece.files.charge&&(!elite||piece.files[eliteFile('charge')]))return 'charge';
  if(act&&piece.files[act]&&(!elite||piece.files[eliteFile(act)]))return act;
  if(!moving&&!elite&&bossPhase>=BOSS_PHASE2&&piece.files['phase2-idle'])return 'phase2-idle';
  return cachedAnim(piece,moving,elite);
}
/**
 * One-shot action of an enemy (ArtState fields): `action` plays from `at` to `end` (ms, the renderer's clock), then
 * the loop comes back. A 'hit' never interrupts another action nor restarts itself; any other action replaces a hit
 * or a different action, and the same action already playing is not restarted. Pure, for tests and playEnemyAction.
 */
export interface ActionState {action?:string;at:number;end:number;hitAt?:number}
/**
 * A hit starts at most once per hitGap(its duration): at least HIT_GAP_HITS × the hit animation and never under
 * HIT_GAP_MIN_MS. An enemy inside an aura is damaged every tick: it plays its hit now and then and walks in between,
 * instead of spending most of its time in 'hit'.
 */
export const HIT_GAP_MIN_MS=1500,HIT_GAP_HITS=3;
export const hitGap=(hitMs:number)=>Math.max(HIT_GAP_MIN_MS,HIT_GAP_HITS*hitMs);
/**
 * Cues come from the base kind's events (horde-actions.ts: the pombos poop, the anão throws, the Tio jokes...). A
 * roster piece has its role's animations (scripts/art-v2/enemies-table.mjs): an action it lacks plays the first of
 * these it has (an enxame's poop is its attack, a brutamontes' joke is its shove); none → the loop goes on.
 */
export const ACTION_ALIASES:Readonly<Record<string,readonly string[]>>={
  poop:['attack'],throw:['attack'],joke:['shove','attack'],shove:['attack'],slam:['shove','attack'],charge:['crash','attack'],
};
const NO_ALIAS:readonly string[]=Object.freeze([]);
export function pieceAction(piece:ArtPiece,action:string):string|undefined{
  if(piece.files[action])return action;
  for(const a of ACTION_ALIASES[action]??NO_ALIAS)if(piece.files[a])return a;
  return undefined;
}
export function startAction(s:ActionState,piece:ArtPiece,action:string,now:number):boolean{
  const file=piece.files[action];if(!file)return false; // missing animation: the walk/idle loop goes on
  // A hit never starts while another action plays, and the same action already playing is not restarted.
  if(s.action!==undefined&&now<s.end&&(action==='hit'||action===s.action))return false;
  const duration=actionDuration(Math.max(1,file.frames??1),enemyFps(file,action));
  if(action==='hit'){if(s.hitAt!==undefined&&now-s.hitAt<hitGap(duration))return false;s.hitAt=now;}
  s.action=action;s.at=now;s.end=now+duration;
  return true;
}
/** The action still playing at `now` (clears a finished one), or undefined. */
export function currentAction(s:ActionState,now:number):string|undefined{
  if(s.action!==undefined&&now>=s.end)s.action=undefined;
  return s.action;
}

// ---------- Phaser side: per-enemy state, kept off the actor so layers.ts changes stay tiny ----------
interface ArtState extends ActionState {on:boolean;row:number;overlay?:Phaser.GameObjects.Image;eliteOn:boolean;
  /** The round costume layer (ROUND_COSTUMES), between the base and the elite layer. */
  costume?:Phaser.GameObjects.Image;costumeOn:boolean;
  /** On-screen figure height over the procedural reserve's (1 = today's size): bars, shadow and ring follow it. */
  ratio:number}
const states=new WeakMap<object,ArtState>();
const stateOf=(image:object)=>{let s=states.get(image);if(!s){s={on:false,row:-1,eliteOn:false,costumeOn:false,at:0,end:0,ratio:1};states.set(image,s);}return s;};
/** Size of an enemy's imported figure over its procedural reserve (1 when the art is off): see ArtState.ratio. */
export const enemyArtRatio=(image:object)=>{const s=states.get(image);return s&&s.on?s.ratio:1;};
/**
 * Scale of art `id`'s file `file` for an enemy of `kind`: the drawn height (drawnHeight) to the role's target once
 * measured; until then (or unmeasurable) today's cell rule (enemyDrawScale).
 */
function pieceScale(textures:Phaser.Textures.TextureManager,id:string,piece:ArtPiece,kind:EnemyKind,file:ArtFile,elite:boolean){
  const drawn=drawnHeight(textures,id,piece);
  return drawnScale(id,drawn===undefined?undefined:drawn*file.cell[1]/(cachedFile(piece)?.cell[1]??file.cell[1]),elite)??enemyDrawScale(kind,file,elite);
}
/** The file drawnHeight measures (the still loop's), for a piece whose animations have different cells. */
const cachedFile=(piece:ArtPiece)=>{const a=cachedAnim(piece,false,false);return a?piece.files[a]:undefined;};
const base:FrameRef={key:'',frame:0},top:FrameRef={key:'',frame:0},mid:FrameRef={key:'',frame:0};
/**
 * Frame of layer `layer(anim)` (elite or costume) over the base: the action's own layer when it has one (and it
 * loaded), else the loop's layer on the action's column (so it never blinks off during an attack or a hit).
 */
function layerFrame(textures:Phaser.Textures.TextureManager,id:string,piece:ArtPiece,layer:(anim:string)=>string,anim:string,loop:string|undefined,action:string|undefined,row:number,t:number,out:FrameRef):FrameRef|undefined{
  let f=enemyFrame(id,piece,layer(anim),row,t,out,!!action);
  if(action&&loop&&(!f||!textures.exists(f.key)))f=enemyFrameAt(id,piece,layer(loop),row,enemyColumn(id,piece,action,t,true),out);
  return f&&textures.exists(f.key)?f:undefined;
}

/** A pooled enemy image now shows a new enemy: forget its facing and action (and hide its elite layer until drawn). */
export function resetEnemyArt(image:object){const s=states.get(image);if(s){s.row=-1;s.eliteOn=s.costumeOn=false;s.action=s.hitAt=undefined;}}
/** Whether any enemy kind has imported art (false with an empty manifest: the renderer skips the action cues). */
export function enemyArtActive(){const g=artIndex().groups.inimigos;if(g)for(const _ in g.pieces)return true;return false;}
/** Whether a pooled enemy image showed imported art on its last frame (the renderer then drops the roster accent tint). */
export const enemyArtOn=(image:object)=>!!states.get(image)?.on;
/**
 * Starts action `action` (horde-actions.ts cue) on a pooled enemy image of `kind` at `now`: false (nothing changes)
 * when the kind has no art or its piece lacks that animation (fallback: the walk/idle loop). applyEnemyArt plays it.
 */
export function playEnemyAction(image:object,art:string,action:string,now:number):boolean{
  const piece=artPiece('inimigos',artOf(art)),played=piece&&pieceAction(piece,action);
  return !!piece&&!!played&&startAction(stateOf(image),piece,played,now);
}
/** A legacy kind → its ENEMY_ART_ID; anything else (a roster id) is already an art id. */
const artOf=(id:string)=>LEGACY.has(id)?ENEMY_ART_ID[id as EnemyKind]:id;
/** Last facing row of a pooled enemy image (0 = facing the camera when it never had art): the death plays on it. */
export function enemyArtRow(image:object){const s=states.get(image);return s&&s.row>=0?s.row:0;}

/**
 * Per frame, after layers.ts placed the procedural sprite: when `actor.kind` has imported art (and, for an elite, an
 * elite layer), shows the right frame for the motion (world dx,dy through camera `view`) with the piece's anchor and no
 * procedural squash/flip/sway, and returns true. Otherwise returns false and the procedural sprite stays as layers.ts
 * set it (restoring its texture if the art had been on). Call it after layers.ts set the hit flash: the elite layer
 * copies the base image's tint. The contact shadow keeps today's size (ENEMY_ART width), art or not.
 * `city` (city mode only, card contorno-breu): where the ground is darker than the rim switch, the Breu-ring copy of the
 * frame's sheet is shown instead (CityOutlines.show maps origin and scale); elsewhere, and always outside the city, the
 * imported sheet with its baked umber rim.
 */
/**
 * Whether an enemy's imported art flies (it has a `fly` animation): true or false, undefined without art for the id.
 * BUG sombra-longe: the enxame role draws as 'pombos', so walkers (rato-de-boteco, cachorro-de-madame, dominó…) took
 * the pigeons' hover and zig-zag and floated far above their shadows.
 */
export function enemyArtFlies(id:string|undefined):boolean|undefined{
  const piece=id?artPiece('inimigos',id):undefined;
  return piece?Object.hasOwn(piece.files,'fly'):undefined;
}
export function applyEnemyArt(image:Phaser.GameObjects.Image,actor:{kind:EnemyKind;art?:string;act?:string;tex?:string;elite:boolean;phase:number;bossPhase?:number;x?:number;y?:number;costume?:string},moving:boolean,dx:number,dy:number,now:number,view=0,body=1,city?:CityOutlines):boolean{
  // art: the roster id (enemyArtId) when the renderer knows it; the legacy kind's art otherwise.
  const id=actor.art??ENEMY_ART_ID[actor.kind],piece=artPiece('inimigos',id);
  // No art for this kind (always, with an empty manifest): nothing to do unless the art was on before.
  if(!piece){const s=states.get(image);return s?off(image,actor,s):false;}
  const s=stateOf(image),loop=loopAnim(piece,moving,actor.elite,actor.bossPhase,actor.act);
  if(moving||s.row<0)s.row=facingRow(dx,dy,view,s.row);
  // An action (attack, throw, hit...) plays once over the loop; only while the art is on (the loop has a sheet).
  // A sheet that did not load drops the action and keeps the loop.
  const textures=image.scene.textures;
  let action=loop?currentAction(s,now):undefined,frame=action?enemyFrame(id,piece,action,s.row,now-s.at,base,true):undefined;
  if(action&&(!frame||!textures.exists(frame.key))){action=s.action=undefined;frame=undefined;}
  let anim=action??loop;const t=action?now-s.at:now+actor.phase*1000;
  if(!action&&anim)frame=enemyFrame(id,piece,anim,s.row,t,base);
  // That loop's sheet is not there (still loading, or it failed): another loop of the piece that is, before the reserve.
  if(!action&&anim&&(!frame||!textures.exists(frame.key)))for(const alt of moving?MOVING:STILL){
    if(alt===anim||!piece.files[alt]||(actor.elite&&!piece.files[eliteFile(alt)]))continue;
    const f=enemyFrame(id,piece,alt,s.row,t,base);
    if(f&&textures.exists(f.key)){anim=alt;frame=f;break;}
  }
  if(!anim||!frame||!textures.exists(frame.key))return off(image,actor,s);
  // body: the scene's actor scale (cidade-04 actorScale), like every procedural actor.
  const file=piece.files[anim],scale=pieceScale(textures,id,piece,actor.kind,file,actor.elite)*body,ox=file.anchor?.[0]??.5,oy=file.anchor?.[1]??.88;
  // The elite layer and the round costume (layerFrame: the action's own, else the loop's on the action's column).
  const variant=actor.costume;
  const eliteFrame=actor.elite?layerFrame(textures,id,piece,eliteFile,anim,loop,action,s.row,t,top):undefined;
  const costumeFrame=variant?layerFrame(textures,id,piece,a=>costumeFile(variant,a),anim,loop,action,s.row,t,mid):undefined;
  s.eliteOn=!!eliteFrame;s.costumeOn=!!costumeFrame;
  // City mode (contorno-breu): the Breu-ring copy where the ground under the feet is too dark for the imported umber
  // rim (render/city-outline-rules.ts rimForGround); base and elite layer switch together so their geometry matches.
  let copy:CityVariant|undefined,copyTop:CityVariant|undefined,copyMid:CityVariant|undefined;
  if(city&&city.active()&&city.rimAt(actor.x??0,actor.y??0)==='breu'){
    copy=city.variant(frame.key,scale);
    const same=(v:CityVariant|undefined)=>!!v&&!!copy&&v.geom.slotW===copy.geom.slotW&&v.geom.slotH===copy.geom.slotH;
    if(copy&&eliteFrame){copyTop=city.variant(eliteFrame.key,scale);if(!same(copyTop))copy=copyTop=undefined;}
    if(copy&&costumeFrame){copyMid=city.variant(costumeFrame.key,scale);if(!same(copyMid))copy=copyTop=copyMid=undefined;}
  }
  if(copy&&city)city.show(image,copy,frame.key,frame.frame,ox,oy,scale,scale);
  else{
    if(image.texture.key!==frame.key)image.setTexture(frame.key,frame.frame);else image.setFrame(frame.frame);
    image.setOrigin(ox,oy).setScale(scale);
  }
  image.setFlipX(false).setRotation(0);
  s.on=true;
  const art=ENEMY_ART[actor.kind];
  s.ratio=scale/body*file.cell[1]*(file.anchor?.[1]??.88)/(art.height*art.originY*(actor.elite?ELITE_ART_SCALE:1));
  if(eliteFrame)follow(image,overlayOf(image,s,'overlay'),copyTop?copyTop.key:eliteFrame.key,eliteFrame.frame,ELITE_LAYER_DEPTH);
  if(costumeFrame)follow(image,overlayOf(image,s,'costume'),copyMid?copyMid.key:costumeFrame.key,costumeFrame.frame,COSTUME_LAYER_DEPTH);
  return true;
}
/** A layer just above its own base (never over a nearer enemy), with the base's geometry and hit flash/tint. */
function follow(image:Phaser.GameObjects.Image,o:Phaser.GameObjects.Image,key:string,frame:number,depth:number){
  if(o.texture.key!==key)o.setTexture(key,frame);else o.setFrame(frame);
  o.setPosition(image.x,image.y).setOrigin(image.originX,image.originY).setScale(image.scaleX,image.scaleY).setDepth(image.depth+depth).setAlpha(image.alpha);
  o.tintFill=image.tintFill;o.tintTopLeft=image.tintTopLeft;o.tintTopRight=image.tintTopRight;
  o.tintBottomLeft=image.tintBottomLeft;o.tintBottomRight=image.tintBottomRight;
}
/** Depth of the elite layer over its base image: far below the gap between two enemies' depths. */
export const ELITE_LAYER_DEPTH=.001;
/** Depth of the round costume over its base: under the elite layer (the badge and crown go over the costume). */
export const COSTUME_LAYER_DEPTH=ELITE_LAYER_DEPTH/2;
function off(image:Phaser.GameObjects.Image,actor:{kind:EnemyKind;elite:boolean;tex?:string},s:ArtState):false{
  // The renderer's current procedural texture (its acting one while acting), else the kind's.
  if(s.on){s.on=false;image.setTexture(actor.tex??enemyTexture(actor.kind,actor.elite)).setOrigin(.5,ENEMY_ART[actor.kind].originY);}
  s.eliteOn=s.costumeOn=false;
  return false;
}
/**
 * The elite layer: one Image per pooled enemy image, created on first use and kept (never per frame). Its visibility
 * follows the base image after every update (a released actor hides it), and it is destroyed with the base image.
 * It is a scene display-list child like the base, so the killcam camera (render/zueira-fx.ts), which ignores every
 * scene child but its own copy, ignores it too.
 */
function overlayOf(image:Phaser.GameObjects.Image,s:ArtState,which:'overlay'|'costume'){
  const had=s[which];if(had)return had;
  const scene=image.scene,o=scene.add.image(0,0,'__DEFAULT').setVisible(false);
  const sync=()=>{o.setVisible(image.visible&&(which==='overlay'?s.eliteOn:s.costumeOn));};
  scene.events.on('postupdate',sync);
  image.once('destroy',()=>{scene.events.off('postupdate',sync);o.destroy();s[which]=undefined;});
  s[which]=o;return o;
}

// ---------- death actor: the death animation on a pooled image of the renderer, at the enemy's last spot ----------
/**
 * Whether a kill of `kind` plays the imported death: the piece has 'death', its pages loaded, and the dying actor (its
 * pooled image, when the renderer still had it) was showing the art (an elite drawn procedurally keeps today's puff).
 */
/** The death animation of a piece: 'death', else a kamikaze's 'crash' (it has no death sheet: it dies exploding). */
export const deathAnim=(piece:ArtPiece|undefined)=>piece?.files.death?'death':piece?.files.crash?'crash':undefined;
export function hasDeathArt(textures:{exists(key:string):boolean},art:string,image?:object):boolean{
  const id=artOf(art),piece=artPiece('inimigos',id),anim=deathAnim(piece);if(!piece||!anim)return false;
  if(image){const s=states.get(image);if(!s||!s.on)return false;}
  const keys=fileInfo(id,anim,piece.files[anim]).keys;
  for(let i=0;i<keys.length;i++)if(!textures.exists(keys[i]))return false;
  return true;
}
/** Duration (ms) of the imported death of art `art` (a legacy kind or a roster id; 0 without one). */
export function deathDuration(art:string){
  const id=artOf(art),piece=artPiece('inimigos',id),anim=deathAnim(piece);
  if(!piece||!anim)return 0;
  const info=fileInfo(id,anim,piece.files[anim]);return actionDuration(info.frames,info.fps);
}
/**
 * Per frame, after the renderer placed `image` (position and depth): the death frame `elapsedMs` after the kill on
 * facing `row` (it plays once, holds its last frame and fades, horde-actions.ts deathAlpha), with the piece's anchor
 * and today's size; the elite layer `elite/death` over it for an elite (hidden when absent). False when it is over:
 * the renderer then releases the death actor.
 */
export function drawDeathArt(image:Phaser.GameObjects.Image,overlay:Phaser.GameObjects.Image,kind:EnemyKind,elite:boolean,row:number,elapsedMs:number,body=1,art?:string,costume?:{image:Phaser.GameObjects.Image;variant?:string}):boolean{
  // `kind` sizes it (enemyDrawScale); `art` (the roster id) picks the sheet, the kind's own art without it.
  const id=art===undefined?ENEMY_ART_ID[kind]:artOf(art),piece=artPiece('inimigos',id),anim=deathAnim(piece),file=anim?piece?.files[anim]:undefined;
  if(!piece||!anim||!file){overlay.setVisible(false);costume?.image.setVisible(false);return false;}
  const info=fileInfo(id,anim,file),alpha=deathAlpha(elapsedMs,actionDuration(info.frames,info.fps));
  const frame=alpha>0?enemyFrame(id,piece,anim,row,elapsedMs,base,true):undefined;
  const textures=image.scene.textures;
  if(!frame||!textures.exists(frame.key)){overlay.setVisible(false);costume?.image.setVisible(false);return false;}
  if(image.texture.key!==frame.key)image.setTexture(frame.key,frame.frame);else image.setFrame(frame.frame);
  const scale=pieceScale(textures,id,piece,kind,file,elite)*body;
  image.setOrigin(file.anchor?.[0]??.5,file.anchor?.[1]??.88).setScale(scale).setFlipX(false).setRotation(0).setAlpha(alpha).setVisible(true);
  deathLayer(image,overlay,elite?enemyFrame(id,piece,eliteFile(anim),row,elapsedMs,top,true):undefined,textures,ELITE_LAYER_DEPTH);
  if(costume){const v=costume.variant;deathLayer(image,costume.image,v?enemyFrame(id,piece,costumeFile(v,anim),row,elapsedMs,mid,true):undefined,textures,COSTUME_LAYER_DEPTH);}
  return true;
}
/** A death layer (elite or costume) over the dying base, or hidden when it has no sheet for this frame. */
function deathLayer(image:Phaser.GameObjects.Image,o:Phaser.GameObjects.Image,layer:FrameRef|undefined,textures:{exists(key:string):boolean},depth:number){
  if(!layer||!textures.exists(layer.key)){o.setVisible(false);return;}
  if(o.texture.key!==layer.key)o.setTexture(layer.key,layer.frame);else o.setFrame(layer.frame);
  o.setPosition(image.x,image.y).setOrigin(image.originX,image.originY).setScale(image.scaleX,image.scaleY).setDepth(image.depth+depth).setAlpha(image.alpha).setVisible(true);
}
