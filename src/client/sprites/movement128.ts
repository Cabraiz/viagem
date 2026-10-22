import {artIndexVersion,artPiece,artUrl} from '../art/manifest.ts';
import {HERO_ANIM_RATE,HERO_DIRECTIONS,HERO_GAIT,type HeroDirection} from './sprite-motion.ts';
import type {FigureBox} from './sprite-catalog.ts';

export type DetailedMotion='walk'|'attack';
export const MOVEMENT128_FRAMES=128;
export const MOVEMENT128_DURATION={walk:600,attack:1000} as const;
export interface Movement128Plan {
  key:string;url:string;original:string;motion:DetailedMotion|'idle'|'run';direction?:HeroDirection;
  columns:number;rows:number;frameCount:number;
  durationMs:number;loop:boolean;anchor:[number,number];height:number;figure:FigureBox;
  /** M16: the sheet is the drawn direction's mirror (E/NE/SE show W/NW/SW with flipX; `key` is the drawn sheet's). */
  flip?:boolean;
  /** M16: the column (96 px cell) the body stands on; the origin x, mirrored with the sheet (movement16OriginX). */
  pivotX?:number;
  /** M16 run: the pose by the ground walked and the planted foot's travel (runPhase). */
  phase?:RunPhase;
}
/**
 * A run's phase table (card passo-3x-mais-lento): per pose, `d` the ground it covers in figure heights (the stance poses
 * the planted foot's measured travel, the flight poses the rest of the stride) and `v` that foot's travel in 96 px cell
 * px ([0,0] in flight). The stride is the sum of `d`.
 */
export interface RunPhase {d:readonly number[];v:readonly (readonly [number,number])[]}
const validPhase=(p:unknown,frames:number):p is RunPhase=>{
  const q=p as RunPhase;
  return !!q&&Array.isArray(q.d)&&Array.isArray(q.v)&&q.d.length===frames&&q.v.length===frames&&
    q.d.every(x=>Number.isFinite(x)&&x>0)&&q.v.every(v=>Array.isArray(v)&&v.length===2&&v.every(Number.isFinite));
};
export const phaseStride=(p:RunPhase)=>p.d.reduce((s,x)=>s+x,0);
/**
 * The pose after `cycles` cycles and the sprite's shift (cell px, unmirrored) that keeps the planted foot where the ground
 * carried it: the part of the pose's foot travel already walked.
 */
export function runPhase(p:RunPhase,cycles:number):{frame:number;shift:[number,number]}{
  let x=(cycles-Math.floor(cycles))*phaseStride(p);
  for(let i=0;i<p.d.length;i++){
    if(x<p.d[i]){const f=x/p.d[i];return {frame:i,shift:[p.v[i][0]*f,p.v[i][1]*f]};}
    x-=p.d[i];
  }
  return {frame:p.d.length-1,shift:[0,0]};
}
let version=-1;
const plans=new Map<string,Movement128Plan|null>(),figures=new Map<string,FigureBox|undefined>(),m16=new Map<string,boolean>(),run16=new Map<string,boolean>();
function current(){if(version!==artIndexVersion){version=artIndexVersion;plans.clear();figures.clear();m16.clear();run16.clear();}}
const box=(v:unknown):v is FigureBox=>{
  if(!v||typeof v!=='object')return false;
  const b=v as FigureBox;
  return [b.left,b.top,b.right,b.bottom].every(n=>Number.isInteger(n)&&n>=0&&n<=96)&&b.right>b.left&&b.bottom>b.top;
};
/** A manifest plan only; asking for a plan never downloads an atlas. */
export function movement128Plan(id:string,motion:DetailedMotion,direction:HeroDirection):Movement128Plan|undefined{
  current();const name=`${motion}128-${direction}`,key=`sprite128:${id}:${motion}:${direction}`;
  if(plans.has(key))return plans.get(key)??undefined;
  const f=artPiece('personagens',id)?.files[name],p=f?.pages?.[0],durationMs=MOVEMENT128_DURATION[motion];
  const original=f?.file&&artUrl('personagens',f.file);
  if(!f||!original||f.revision!==6||f.movementHands!=='empty'||f.cell[0]!==96||f.cell[1]!==96||f.frames!==128||
    f.pages?.length!==1||!p||p.file!==f.file||p.columns!==16||p.rows!==8||p.firstFrame!==0||p.frameCount!==128||
    f.durationMs!==durationMs||f.loop!==(motion==='walk')||f.anchor?.[0]!==.5||f.anchor[1]!==.875||
    typeof f.height!=='number'||!Number.isFinite(f.height)||f.height<4||f.height>96||!box(f.figure)){
    plans.set(key,null);return;
  }
  const plan:Movement128Plan={key,original,url:original.replace('/art/sprites/','/art/lite/sprites/'),motion,direction,
    columns:16,rows:8,frameCount:128,durationMs,loop:motion==='walk',anchor:[.5,.875],height:f.height,figure:f.figure};
  plans.set(key,plan);return plan;
}
/** One resting pose per direction, in the same oblique camera and coordinate system as the detailed motions. */
export function movementIdle8Plan(id:string):Movement128Plan|undefined{
  current();const key=`sprite128:${id}:idle8`;
  if(plans.has(key))return plans.get(key)??undefined;
  const f=artPiece('personagens',id)?.files.idle8,p=f?.pages?.[0],original=f?.file&&artUrl('personagens',f.file);
  if(!f||!original||f.revision!==6||f.movementHands!=='empty'||f.cell[0]!==96||f.cell[1]!==96||f.frames!==1||f.directions!==8||
    f.pages?.length!==1||!p||p.file!==f.file||p.columns!==8||p.rows!==1||p.firstFrame!==0||p.frameCount!==8||f.loop!==false||
    f.anchor?.[0]!==.5||f.anchor[1]!==.875||typeof f.height!=='number'||!Number.isFinite(f.height)||f.height<4||f.height>96||!box(f.figure)){
    plans.set(key,null);return;
  }
  const plan:Movement128Plan={key,original,url:original.replace('/art/sprites/','/art/lite/sprites/'),motion:'idle',columns:8,rows:1,frameCount:8,
    durationMs:0,loop:false,anchor:[.5,.875],height:f.height,figure:f.figure};
  plans.set(key,plan);return plan;
}
export const movementIdle8Frame=(direction:HeroDirection)=>HERO_DIRECTIONS.indexOf(direction);

/**
 * M16 (card movimento16-espelho, 21/10): 16 poses for walk and attack, 8 for the rest, drawn in 5 directions: S, N and
 * one side of each mirror pair (W×E, NW×NE, SW×SE); the other side shows it mirrored. The drawn side is chosen per class
 * and per pair (plano B 21/10: viciado draws W, NW and SE, the better side of each pair in the estudo-espelho table) and
 * read from the manifest: the side whose three sheets (walk, attack, idle) are there. A class uses M16 only when all 8
 * directions resolve to valid sheets, else R06 (or legacy).
 */
export type Movement16Motion=DetailedMotion|'idle'|'run';
/** The default drawn directions (the importer's and the doc's; a class may draw E, NE or SE instead). */
export const MOVEMENT16_DIRECTIONS=['S','SW','W','NW','N'] as const;
export type Movement16Direction=HeroDirection;
/** Mirror pairs, the default drawn side first. */
export const MOVEMENT16_PAIRS=[['W','E'],['NW','NE'],['SW','SE']] as const satisfies readonly (readonly [HeroDirection,HeroDirection])[];
const PARTNER=Object.fromEntries(MOVEMENT16_PAIRS.flatMap(([a,b])=>[[a,b],[b,a]])) as Partial<Record<HeroDirection,HeroDirection>>;
export const MOVEMENT16_DURATION={walk:600,attack:1000,idle:2000,run:600} as const;
export const MOVEMENT16_GRID={walk:[4,4],attack:[4,4],idle:[4,2],run:[4,4]} as const;
const M16_MOTIONS=['walk','attack','idle'] as const;
/**
 * Which drawn sheet `direction` shows for class `id`, and whether mirrored: its own when its three sheets are in the
 * manifest (S and N always), else its pair's other side mirrored. Both sides drawn: each shows its own.
 */
export function movement16Source(id:string,direction:HeroDirection,motion?:Movement16Motion):{source:HeroDirection;flip:boolean}{
  const partner=PARTNER[direction],files=artPiece('personagens',id)?.files;
  // An R06 class with a run only (corrida-clt): its run sheets alone say which side of each pair is drawn.
  const only=motion==='run'&&!!files&&!M16_MOTIONS.some(m=>Object.keys(files).some(k=>k.startsWith(`${m}16-`)));
  const drawn=(d:HeroDirection)=>!!files&&(only?!!files[`run16-${d}`]:M16_MOTIONS.every(m=>files[`${m}16-${d}`]));
  if(!partner||drawn(direction)||!drawn(partner))return {source:direction,flip:false};
  return {source:partner,flip:true};
}
const m16Loop=(motion:Movement16Motion)=>motion!=='attack';
/** A manifest plan only (never downloads). Mirrored directions share the drawn sheet's key, texture and cache entry. */
export function movement16Plan(id:string,motion:Movement16Motion,direction:HeroDirection):Movement128Plan|undefined{
  current();const {source,flip}=movement16Source(id,direction,motion),lookup=`m16:${id}:${motion}:${direction}`;
  if(plans.has(lookup))return plans.get(lookup)??undefined;
  const f=artPiece('personagens',id)?.files[`${motion}16-${source}`],p=f?.pages?.[0],original=f?.file&&artUrl('personagens',f.file);
  const [columns,rows]=MOVEMENT16_GRID[motion],frameCount=columns*rows,durationMs=MOVEMENT16_DURATION[motion],loop=m16Loop(motion);
  if(!f||!original||f.revision!==16||f.movementHands!=='empty'||f.cell[0]!==96||f.cell[1]!==96||f.frames!==frameCount||
    f.pages?.length!==1||!p||p.file!==f.file||p.columns!==columns||p.rows!==rows||p.firstFrame!==0||p.frameCount!==frameCount||
    f.durationMs!==durationMs||f.loop!==loop||f.anchor?.[0]!==.5||f.anchor[1]!==.875||
    typeof f.height!=='number'||!Number.isFinite(f.height)||f.height<4||f.height>96||!box(f.figure)||
    typeof f.pivotX!=='number'||!Number.isFinite(f.pivotX)||f.pivotX<=0||f.pivotX>=96){
    plans.set(lookup,null);return;
  }
  const plan:Movement128Plan={key:`sprite16:${id}:${motion}:${source}`,original,url:original.replace('/art/sprites/','/art/lite/sprites/'),motion,direction,
    columns,rows,frameCount,durationMs,loop,anchor:[.5,.875],height:f.height,figure:f.figure,flip,pivotX:f.pivotX,
    ...(motion==='run'&&validPhase(f.phase,frameCount)?{phase:f.phase}:{})};
  plans.set(lookup,plan);return plan;
}
/** True when every direction of walk, attack and idle resolves to a valid M16 sheet (its own or its pair's, mirrored). */
export function hasMovement16(id:string){
  current();let complete=m16.get(id);
  if(complete===undefined)m16.set(id,complete=M16_MOTIONS.every(m=>HERO_DIRECTIONS.every(d=>movement16Plan(id,m,d))));
  return complete;
}
/**
 * True when a class has a valid run (run16) in every direction (optional, card passo-3x-mais-lento): an M16 class, or an
 * R06 one (corrida-clt: the CLT runs on M16 run sheets while its rest and attack stay R06).
 */
export function hasRun16(id:string){
  current();let complete=run16.get(id);
  if(complete===undefined)run16.set(id,complete=(hasMovement16(id)||!!movementIdle8Plan(id))&&HERO_DIRECTIONS.every(d=>movement16Plan(id,'run',d)));
  return complete;
}
/** The class moves at a run (HERO_GAIT) when it has one: its 'walk' clips are the run's. */
export const heroRuns=(id:string)=>HERO_GAIT.run&&hasRun16(id);
/** The clip a class shows: M16 when complete, else R06 (walk128/attack128 and idle8; its run16 when it runs); undefined = legacy. */
export function movementPlan(id:string,motion:DetailedMotion|'idle',direction:HeroDirection):Movement128Plan|undefined{
  if(motion==='walk'&&heroRuns(id))return movement16Plan(id,'run',direction);
  if(hasMovement16(id))return movement16Plan(id,motion,direction);
  return motion==='idle'?movementIdle8Plan(id):movement128Plan(id,motion,direction);
}
/** Every distinct sheet (by texture key) of one motion, the drawn directions only for M16. */
export function movementSheets(id:string,motion:DetailedMotion|'idle'):Movement128Plan[]{
  if(!hasMovement16(id)&&!(motion==='walk'&&heroRuns(id))){
    if(motion==='idle'){const idle=movementIdle8Plan(id);return idle?[idle]:[];}
    return HERO_DIRECTIONS.flatMap(d=>{const p=movement128Plan(id,motion,d);return p?[p]:[];});
  }
  const seen=new Set<string>(),shown=motion==='walk'&&heroRuns(id)?'run':motion;
  return HERO_DIRECTIONS.flatMap(d=>{const p=movement16Plan(id,shown,d);if(!p||seen.has(p.key))return [];seen.add(p.key);return [p];});
}
/** The frame of a swing `progress` (0..1) of the way through: its frames spread over the swing's time (ataque-1s). */
export function swingFrame(plan:Pick<Movement128Plan,'frameCount'>,progress:number):number{
  const n=plan.frameCount??MOVEMENT128_FRAMES;
  return Math.max(0,Math.min(n-1,Math.floor(progress*n)));
}
/** The frame a clip shows now: idle8 picks its direction's column; every other clip follows the clock. */
export function movementFrame(plan:Movement128Plan,direction:HeroDirection,elapsedMs:number){
  return plan.motion==='idle'&&!(plan.durationMs>0)?movementIdle8Frame(direction):movement128Frame(plan,elapsedMs);
}
/**
 * Origin x (0..1 of the cell) under the body when drawn unmirrored: M16's measured pivot, R06's anchor. Phaser 3.90 mirrors
 * a flipped frame inside its own box (around the cell's centre, not the origin), so a mirrored clip uses 1 − this.
 */
export const movementPivotX=(plan:Pick<Movement128Plan,'anchor'|'pivotX'>)=>plan.pivotX!==undefined?plan.pivotX/96:plan.anchor[0];
/** Figure union in the legacy 192px coordinate system; metadata only, including every detailed clip. */
export function movement128Figure(id:string):FigureBox|undefined{
  current();if(figures.has(id))return figures.get(id);
  let result:FigureBox|undefined;
  const run=hasRun16(id)?HERO_DIRECTIONS.map(direction=>movement16Plan(id,'run',direction)):[];
  const all=hasMovement16(id)?[...(['walk','attack','idle'] as const).flatMap(motion=>HERO_DIRECTIONS.map(direction=>movement16Plan(id,motion,direction))),...run]:
    [movementIdle8Plan(id),...(['walk','attack'] as const).flatMap(motion=>HERO_DIRECTIONS.map(direction=>movement128Plan(id,motion,direction))),...run];
  for(const p of all){
    if(!p)continue;
    // A mirrored clip's box is the drawn one mirrored inside the cell.
    const f=p.flip?{...p.figure,left:96-p.figure.right,right:96-p.figure.left}:p.figure,b={left:f.left*2,top:f.top*2,right:f.right*2,bottom:f.bottom*2};
    result=result?{left:Math.min(result.left,b.left),top:Math.min(result.top,b.top),right:Math.max(result.right,b.right),bottom:Math.max(result.bottom,b.bottom)}:b;
  }
  figures.set(id,result);return result;
}
/**
 * All source poses stay available; the display samples the cycle at the actual render cadence, played at
 * HERO_ANIM_RATE of the drawn duration (the manifest keeps 600/1000 ms, the art's own timing). The hero's attack plays by
 * swingFrame instead (ATTACK_MS).
 */
export function movement128Frame(plan:Pick<Movement128Plan,'durationMs'|'loop'>&{frameCount?:number},elapsedMs:number):number{
  if(!(plan.durationMs>0))return 0;
  const n=plan.frameCount??MOVEMENT128_FRAMES,phase=Math.max(0,elapsedMs)*HERO_ANIM_RATE/plan.durationMs,frame=Math.floor(phase*n);
  return plan.loop?frame%n:Math.min(n-1,frame);
}
