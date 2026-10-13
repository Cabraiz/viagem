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
import {ELITE_SCALE,ENEMY_ART,ENEMY_KINDS,FX,PICKUP_SIZE,enemyTexture,pickupTexture,projectileTexture,type EnemyKind} from '../render/keys.ts';

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
 * Not mapped: the hostile star (no piece in the inventory), the life bars (9-slice; today they stretch by scale),
 * per-resource pickups (today one generic 'resource' texture: only the generic 'recurso' may replace it, never a
 * coconut or a stone) and per-weapon projectiles (see WEAPON_PROJECTILE_KEY).
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
  {key:FX.projBoleto,group:'projeteis',ids:['boleto-juros'],mode:'sheet'},
  // Sizes of render/textures.ts drawFx (layers.ts scales the shadow by SHADOW_W/H = 46×16 of the 48×18 texture).
  // Stretched (not contained): the contact shadow keeps today's 48×18 footprint whatever its cell's aspect.
  {key:FX.shadow,group:'efeitos',ids:['sombra','sombra-contato'],mode:'bake',size:[48,18],fit:'fill'},
  {key:FX.puff,group:'efeitos',ids:['poof','morte-poof'],mode:'bake',size:[64,64]},
  {key:FX.warning,group:'efeitos',ids:['aviso-spawn'],mode:'bake',size:[40,40]},
];
/**
 * Weapon projectiles (`projeteis` ids = the weapon ids, ProjectileView.source) → today's texture key. Today every
 * friendly shot shares FX.projFriendly (keys.ts projectileTexture), so ten looks cannot ride one key: they stay out of
 * STATIC_ART (the shared key keeps 'tiro-aliado') until keys.ts gives each weapon its own key; then each one is a
 * 'sheet' entry like tiro-aliado.
 */
export const WEAPON_PROJECTILE_IDS=['chinelo','boleto','cafe','guarda-chuva','pombo','audio','chinelo-evo','boleto-evo','cafe-evo','garrafa-molotov'] as const;
export type WeaponProjectileId=typeof WEAPON_PROJECTILE_IDS[number];
export const WEAPON_PROJECTILE_KEY:Readonly<Record<WeaponProjectileId,string>>=
  Object.fromEntries(WEAPON_PROJECTILE_IDS.map(id=>[id,projectileTexture(false,id)])) as Record<WeaponProjectileId,string>;

export interface ArtLoad {key:string;url:string;cell:[number,number];bake?:{key:string;size:readonly [number,number];fit:'contain'|'fill'}}
/**
 * Every texture the horde art needs, from the current manifest (empty manifest → []). Enemies: each page of each file
 * (animations and elite layers); statics: frame 0 sheet of the first present id.
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
 * Texture key and frame index of art `id`'s file `anim` at `row` and `timeMs`: frames loop at the file's fps; the
 * frame is found in its page (pages hold the frames in reading order, direction-major). Undefined when the file is
 * missing. `out` avoids an allocation per call.
 */
export function enemyFrame(id:string,piece:ArtPiece,anim:string,row:number,timeMs:number,out:FrameRef={key:'',frame:0}):FrameRef|undefined{
  const file=piece.files[anim];if(!file)return undefined;
  const info=fileInfo(id,anim,file),frames=info.frames,pages=info.pages;
  const r=Math.min(info.dirs-1,Math.max(0,row|0)),col=Math.floor(Math.max(0,timeMs)/1000*info.fps)%frames;
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

// ---------- Phaser side: per-enemy state, kept off the actor so layers.ts changes stay tiny ----------
interface ArtState {on:boolean;row:number;overlay?:Phaser.GameObjects.Image;eliteOn:boolean}
const states=new WeakMap<object,ArtState>();
const stateOf=(image:object)=>{let s=states.get(image);if(!s){s={on:false,row:-1,eliteOn:false};states.set(image,s);}return s;};
const base:FrameRef={key:'',frame:0},top:FrameRef={key:'',frame:0};

/** A pooled enemy image now shows a new enemy: forget its facing (and hide its elite layer until drawn). */
export function resetEnemyArt(image:object){const s=states.get(image);if(s){s.row=-1;s.eliteOn=false;}}

/**
 * Per frame, after layers.ts placed the procedural sprite: when `actor.kind` has imported art (and, for an elite, an
 * elite layer), shows the right frame for the motion (world dx,dy through camera `view`) with the piece's anchor and no
 * procedural squash/flip/sway, and returns true. Otherwise returns false and the procedural sprite stays as layers.ts
 * set it (restoring its texture if the art had been on). Call it after layers.ts set the hit flash: the elite layer
 * copies the base image's tint. The contact shadow keeps today's size (ENEMY_ART width), art or not.
 */
export function applyEnemyArt(image:Phaser.GameObjects.Image,actor:{kind:EnemyKind;elite:boolean;phase:number},moving:boolean,dx:number,dy:number,now:number,view=0):boolean{
  const id=ENEMY_ART_ID[actor.kind],piece=artPiece('inimigos',id);
  // No art for this kind (always, with an empty manifest): nothing to do unless the art was on before.
  if(!piece){const s=states.get(image);return s?off(image,actor,s):false;}
  const s=stateOf(image),anim=cachedAnim(piece,moving,actor.elite);
  if(moving||s.row<0)s.row=facingRow(dx,dy,view,s.row);
  const t=now+actor.phase*1000;
  const frame=anim?enemyFrame(id,piece,anim,s.row,t,base):undefined;
  const textures=image.scene.textures;
  if(!anim||!frame||!textures.exists(frame.key))return off(image,actor,s);
  const file=piece.files[anim],scale=enemyDrawScale(actor.kind,file,actor.elite);
  if(image.texture.key!==frame.key)image.setTexture(frame.key,frame.frame);else image.setFrame(frame.frame);
  image.setOrigin(file.anchor?.[0]??.5,file.anchor?.[1]??.88).setScale(scale).setFlipX(false).setRotation(0);
  s.on=true;
  const eliteFrame=actor.elite?enemyFrame(id,piece,eliteFile(anim),s.row,t,top):undefined;
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
