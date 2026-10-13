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
import {artPages,artPiece,artUrl,type ArtFile,type ArtGroupId,type ArtPage,type ArtPiece} from './manifest.ts';
import {ELITE_SCALE,ENEMY_ART,ENEMY_KINDS,FX,PICKUP_SIZE,enemyTexture,pickupTexture,type EnemyKind} from '../render/keys.ts';
import {BOSS_PHASE2,actionDuration,deathAlpha,onceColumn} from './horde-actions.ts';
import {queueFramesArt} from './frames-art.ts';
import {queueTelegraphArt} from '../render/telegraph-art.ts';

/**
 * Today's enemy kind → art id in the `inimigos` group (scripts/art-v2/spec.mjs). D-033/D-036 already renamed the
 * client kinds (gosma → bebado, pernilongo → pombos, fiscal → agiota; tio-pave, anao-molotov and chefe kept theirs),
 * so the map is the identity today; it stays a table so a later rename on either side is one line.
 */
export const ENEMY_ART_ID:Readonly<Record<EnemyKind,string>>={
  bebado:'bebado','anao-molotov':'anao-molotov',pombos:'pombos','tio-pave':'tio-pave',agiota:'agiota',chefe:'chefe',
};
/** The importer's file key of an animation's elite layer (validate.mjs: `elite/<anim>`). */
export const eliteFile=(anim:string)=>`elite/${anim}`;
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
 * Not mapped: the hostile star (no piece in the inventory), the life bars (9-slice; today they stretch by scale) and
 * per-resource pickups (today one generic 'resource' texture: only the generic 'recurso' may replace it, never a
 * coconut or a stone). Per-source projectiles (each weapon, the agiota's boleto) load under their own key
 * (projectileArtKey, see projectileLook); 'tiro-aliado' stays here as the look of a friendly shot without its own art.
 */
export interface StaticArt {key:string;group:ArtGroupId;ids:readonly string[];mode:'sheet'|'bake';size?:readonly [number,number];fit?:'contain'|'fill'}
const pickup=(kind:keyof typeof PICKUP_SIZE,ids:string[]):StaticArt=>({key:pickupTexture(kind),group:'itens',ids,mode:'bake',size:[PICKUP_SIZE[kind].width,PICKUP_SIZE[kind].height]});
export const STATIC_ART:readonly StaticArt[]=[
  pickup('xp',['gema-pequena','gema']),
  pickup('heal',['coxinha']),
  pickup('magnet',['ima']),
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
 * Per-source projectiles (item 2 of NEW-20261012-ORQ-importar-arte-c-completa). The `projeteis` ids of the weapons are
 * the weapon ids (ProjectileView.source, evolutions included); the hostile ones are the agiota's 'boleto-juros' (a real
 * projectile) and the anão's bottle and the pigeon's poop, which today are telegraphs, not projectiles (aliases below,
 * in case a source ever carries them). Each one present in the manifest loads under its own key `art:proj:<id>`;
 * absent, the shot keeps today's key (keys.ts projectileTexture), so no art = the same textures as before.
 */
export const WEAPON_PROJECTILE_IDS=['chinelo','boleto','cafe','guarda-chuva','pombo','audio','chinelo-evo','boleto-evo','cafe-evo','garrafa-molotov'] as const;
export type WeaponProjectileId=typeof WEAPON_PROJECTILE_IDS[number];
export const HOSTILE_PROJECTILE_IDS=['boleto-juros','coco-pombo'] as const;
/** Every `projeteis` id with its own key ('tiro-aliado' is not one: it is the shared friendly look, STATIC_ART). */
export const PROJECTILE_ART_IDS:readonly string[]=[...WEAPON_PROJECTILE_IDS,...HOSTILE_PROJECTILE_IDS];
const PROJECTILE_ART_SET=new Set(PROJECTILE_ART_IDS);
/** Built once: the per-frame path never concatenates a key. */
const PROJECTILE_KEYS=new Map<string,string>();
/** Sources whose art id differs from the source (a Map: a source string never reaches Object.prototype). */
export const PROJECTILE_ALIAS:ReadonlyMap<string,string>=new Map([['molotov','garrafa-molotov'],['coco','coco-pombo'],['poop','coco-pombo']]);
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
/**
 * Look of a projectile from the manifest: its own art (`art:proj:<id>`), else for a friendly shot the shared
 * 'tiro-aliado' (loaded under FX.projFriendly), else undefined: the caller keeps keys.ts projectileTexture. The renderer
 * still checks that the key's texture loaded. Allocation-free after the first call per file.
 */
export function projectileLook(hostile:boolean,source:string):ProjectileLook|undefined{
  const id=projectileArtId(source),own=id!==undefined?projectileFile(id):undefined;
  if(own)return lookOf(own,PROJECTILE_KEYS.get(id as string) as string);
  if(!hostile){const shared=projectileFile('tiro-aliado');if(shared)return lookOf(shared,FX.projFriendly);}
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

export interface ArtLoad {key:string;url:string;cell:[number,number];bake?:{key:string;size:readonly [number,number];fit:'contain'|'fill'}}
/**
 * Every texture the horde art needs, from the current manifest (empty manifest → []). Enemies: each page of each file
 * (animations, actions, death and elite layers); per-source projectiles: their first page; statics: frame 0 sheet of
 * the first present id.
 */
export function artLoads():ArtLoad[]{
  const out:ArtLoad[]=[];
  for(const kind of ENEMY_KINDS){
    const id=ENEMY_ART_ID[kind],piece=artPiece('inimigos',id);if(!piece)continue;
    for(const [name,file] of Object.entries(piece.files)){
      const pages=artPages(file);
      pages.forEach((page,i)=>{const url=artUrl('inimigos',page.file);if(url&&validCell(file))out.push({key:enemyArtKey(id,name,i,pages.length),url,cell:file.cell});});
    }
  }
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
/** What enemyFrame needs of a file, computed once per file (pages, texture keys, fps): nothing is built per frame. */
export interface FileInfo {id:string;anim:string;pages:readonly ArtPage[];keys:readonly string[];fps:number;frames:number;dirs:number}
const fileCache=new WeakMap<ArtFile,FileInfo>();
/** The cached FileInfo of art `id`'s file `anim` (the same object on every call for the same file). */
export function fileInfo(id:string,anim:string,file:ArtFile):FileInfo{
  let f=fileCache.get(file);
  if(!f||f.id!==id||f.anim!==anim){
    const pages=artPages(file);
    f={id,anim,pages,keys:pages.map((_,i)=>enemyArtKey(id,anim,i,pages.length)),fps:fileFps(file,anim),
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

/**
 * The looping animation of an enemy that is not acting: chooseAnim (cached), except the chefe from boss phase 2
 * (BOSS_PHASE2) standing still, who idles with 'phase2-idle' when the piece has it.
 */
export function loopAnim(piece:ArtPiece,moving:boolean,elite:boolean,bossPhase=1):string|undefined{
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
export function startAction(s:ActionState,piece:ArtPiece,action:string,now:number):boolean{
  const file=piece.files[action];if(!file)return false; // missing animation: the walk/idle loop goes on
  // A hit never starts while another action plays, and the same action already playing is not restarted.
  if(s.action!==undefined&&now<s.end&&(action==='hit'||action===s.action))return false;
  const duration=actionDuration(Math.max(1,file.frames??1),fileFps(file,action));
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
interface ArtState extends ActionState {on:boolean;row:number;overlay?:Phaser.GameObjects.Image;eliteOn:boolean}
const states=new WeakMap<object,ArtState>();
const stateOf=(image:object)=>{let s=states.get(image);if(!s){s={on:false,row:-1,eliteOn:false,at:0,end:0};states.set(image,s);}return s;};
const base:FrameRef={key:'',frame:0},top:FrameRef={key:'',frame:0};

/** A pooled enemy image now shows a new enemy: forget its facing and action (and hide its elite layer until drawn). */
export function resetEnemyArt(image:object){const s=states.get(image);if(s){s.row=-1;s.eliteOn=false;s.action=s.hitAt=undefined;}}
/** Whether any enemy kind has imported art (false with an empty manifest: the renderer skips the action cues). */
export function enemyArtActive(){for(const kind of ENEMY_KINDS)if(artPiece('inimigos',ENEMY_ART_ID[kind]))return true;return false;}
/**
 * Starts action `action` (horde-actions.ts cue) on a pooled enemy image of `kind` at `now`: false (nothing changes)
 * when the kind has no art or its piece lacks that animation (fallback: the walk/idle loop). applyEnemyArt plays it.
 */
export function playEnemyAction(image:object,kind:EnemyKind,action:string,now:number):boolean{
  const piece=artPiece('inimigos',ENEMY_ART_ID[kind]);
  return !!piece&&startAction(stateOf(image),piece,action,now);
}
/** Last facing row of a pooled enemy image (0 = facing the camera when it never had art): the death plays on it. */
export function enemyArtRow(image:object){const s=states.get(image);return s&&s.row>=0?s.row:0;}

/**
 * Per frame, after layers.ts placed the procedural sprite: when `actor.kind` has imported art (and, for an elite, an
 * elite layer), shows the right frame for the motion (world dx,dy through camera `view`) with the piece's anchor and no
 * procedural squash/flip/sway, and returns true. Otherwise returns false and the procedural sprite stays as layers.ts
 * set it (restoring its texture if the art had been on). Call it after layers.ts set the hit flash: the elite layer
 * copies the base image's tint. The contact shadow keeps today's size (ENEMY_ART width), art or not.
 */
export function applyEnemyArt(image:Phaser.GameObjects.Image,actor:{kind:EnemyKind;elite:boolean;phase:number;bossPhase?:number},moving:boolean,dx:number,dy:number,now:number,view=0,body=1):boolean{
  const id=ENEMY_ART_ID[actor.kind],piece=artPiece('inimigos',id);
  // No art for this kind (always, with an empty manifest): nothing to do unless the art was on before.
  if(!piece){const s=states.get(image);return s?off(image,actor,s):false;}
  const s=stateOf(image),loop=loopAnim(piece,moving,actor.elite,actor.bossPhase);
  if(moving||s.row<0)s.row=facingRow(dx,dy,view,s.row);
  // An action (attack, throw, hit...) plays once over the loop; only while the art is on (the loop has a sheet).
  // A sheet that did not load drops the action and keeps the loop.
  const textures=image.scene.textures;
  let action=loop?currentAction(s,now):undefined,frame=action?enemyFrame(id,piece,action,s.row,now-s.at,base,true):undefined;
  if(action&&(!frame||!textures.exists(frame.key))){action=s.action=undefined;frame=undefined;}
  const anim=action??loop,t=action?now-s.at:now+actor.phase*1000;
  if(!action&&anim)frame=enemyFrame(id,piece,anim,s.row,t,base);
  if(!anim||!frame||!textures.exists(frame.key))return off(image,actor,s);
  // body: the scene's actor scale (cidade-04 actorScale), like every procedural actor.
  const file=piece.files[anim],scale=enemyDrawScale(actor.kind,file,actor.elite)*body;
  if(image.texture.key!==frame.key)image.setTexture(frame.key,frame.frame);else image.setFrame(frame.frame);
  image.setOrigin(file.anchor?.[0]??.5,file.anchor?.[1]??.88).setScale(scale).setFlipX(false).setRotation(0);
  s.on=true;
  // The elite layer of the action when it has one (and it loaded); otherwise the loop's elite layer (the elite marker
  // never blinks off during an attack or a hit), on the action's column when the loop has it, else its first frame.
  let eliteFrame=actor.elite?enemyFrame(id,piece,eliteFile(anim),s.row,t,top,!!action):undefined;
  if(actor.elite&&action&&loop&&(!eliteFrame||!textures.exists(eliteFrame.key)))
    eliteFrame=enemyFrameAt(id,piece,eliteFile(loop),s.row,enemyColumn(id,piece,action,t,true),top);
  s.eliteOn=!!eliteFrame&&textures.exists(eliteFrame.key);
  if(eliteFrame&&s.eliteOn){
    const o=overlayOf(image,s);
    if(o.texture.key!==eliteFrame.key)o.setTexture(eliteFrame.key,eliteFrame.frame);else o.setFrame(eliteFrame.frame);
    // Just above its own base (never over a nearer enemy), with the base's hit flash/tint.
    o.setPosition(image.x,image.y).setOrigin(image.originX,image.originY).setScale(scale).setDepth(image.depth+ELITE_LAYER_DEPTH).setAlpha(image.alpha);
    o.tintFill=image.tintFill;o.tintTopLeft=image.tintTopLeft;o.tintTopRight=image.tintTopRight;
    o.tintBottomLeft=image.tintBottomLeft;o.tintBottomRight=image.tintBottomRight;
  }
  return true;
}
/** Depth of the elite layer over its base image: far below the gap between two enemies' depths. */
export const ELITE_LAYER_DEPTH=.001;
function off(image:Phaser.GameObjects.Image,actor:{kind:EnemyKind;elite:boolean},s:ArtState):false{
  if(s.on){s.on=false;image.setTexture(enemyTexture(actor.kind,actor.elite)).setOrigin(.5,ENEMY_ART[actor.kind].originY);}
  s.eliteOn=false;
  return false;
}
/**
 * The elite layer: one Image per pooled enemy image, created on first use and kept (never per frame). Its visibility
 * follows the base image after every update (a released actor hides it), and it is destroyed with the base image.
 * It is a scene display-list child like the base, so the killcam camera (render/zueira-fx.ts), which ignores every
 * scene child but its own copy, ignores it too.
 */
function overlayOf(image:Phaser.GameObjects.Image,s:ArtState){
  if(s.overlay)return s.overlay;
  const scene=image.scene,o=scene.add.image(0,0,'__DEFAULT').setVisible(false);
  const sync=()=>{o.setVisible(image.visible&&s.eliteOn);};
  scene.events.on('postupdate',sync);
  image.once('destroy',()=>{scene.events.off('postupdate',sync);o.destroy();s.overlay=undefined;});
  s.overlay=o;return o;
}

// ---------- death actor: the death animation on a pooled image of the renderer, at the enemy's last spot ----------
/**
 * Whether a kill of `kind` plays the imported death: the piece has 'death', its pages loaded, and the dying actor (its
 * pooled image, when the renderer still had it) was showing the art (an elite drawn procedurally keeps today's puff).
 */
export function hasDeathArt(textures:{exists(key:string):boolean},kind:EnemyKind,image?:object):boolean{
  const id=ENEMY_ART_ID[kind],file=artPiece('inimigos',id)?.files.death;if(!file)return false;
  if(image){const s=states.get(image);if(!s||!s.on)return false;}
  const keys=fileInfo(id,'death',file).keys;
  for(let i=0;i<keys.length;i++)if(!textures.exists(keys[i]))return false;
  return true;
}
/** Duration (ms) of the imported death of `kind` (0 without one). */
export function deathDuration(kind:EnemyKind){
  const id=ENEMY_ART_ID[kind],file=artPiece('inimigos',id)?.files.death;
  if(!file)return 0;
  const info=fileInfo(id,'death',file);return actionDuration(info.frames,info.fps);
}
/**
 * Per frame, after the renderer placed `image` (position and depth): the death frame `elapsedMs` after the kill on
 * facing `row` (it plays once, holds its last frame and fades, horde-actions.ts deathAlpha), with the piece's anchor
 * and today's size; the elite layer `elite/death` over it for an elite (hidden when absent). False when it is over:
 * the renderer then releases the death actor.
 */
export function drawDeathArt(image:Phaser.GameObjects.Image,overlay:Phaser.GameObjects.Image,kind:EnemyKind,elite:boolean,row:number,elapsedMs:number,body=1):boolean{
  const id=ENEMY_ART_ID[kind],piece=artPiece('inimigos',id),file=piece?.files.death;
  if(!piece||!file){overlay.setVisible(false);return false;}
  const info=fileInfo(id,'death',file),alpha=deathAlpha(elapsedMs,actionDuration(info.frames,info.fps));
  const frame=alpha>0?enemyFrame(id,piece,'death',row,elapsedMs,base,true):undefined;
  const textures=image.scene.textures;
  if(!frame||!textures.exists(frame.key)){overlay.setVisible(false);return false;}
  if(image.texture.key!==frame.key)image.setTexture(frame.key,frame.frame);else image.setFrame(frame.frame);
  const scale=enemyDrawScale(kind,file,elite)*body;
  image.setOrigin(file.anchor?.[0]??.5,file.anchor?.[1]??.88).setScale(scale).setFlipX(false).setRotation(0).setAlpha(alpha).setVisible(true);
  const layer=elite?enemyFrame(id,piece,eliteFile('death'),row,elapsedMs,top,true):undefined;
  if(layer&&textures.exists(layer.key)){
    if(overlay.texture.key!==layer.key)overlay.setTexture(layer.key,layer.frame);else overlay.setFrame(layer.frame);
    overlay.setPosition(image.x,image.y).setOrigin(image.originX,image.originY).setScale(scale).setDepth(image.depth+ELITE_LAYER_DEPTH).setAlpha(alpha).setVisible(true);
  }else overlay.setVisible(false);
  return true;
}
