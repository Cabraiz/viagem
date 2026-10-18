import {artIndexVersion,artPiece,artUrl} from '../art/manifest.ts';
import {HERO_ANIM_RATE,HERO_DIRECTIONS,type HeroDirection} from './sprite-motion.ts';
import type {FigureBox} from './sprite-catalog.ts';

export type DetailedMotion='walk'|'attack';
export const MOVEMENT128_FRAMES=128;
export const MOVEMENT128_DURATION={walk:600,attack:1000} as const;
export interface Movement128Plan {
  key:string;url:string;original:string;motion:DetailedMotion|'idle';direction?:HeroDirection;
  columns:number;rows:number;frameCount:number;
  durationMs:number;loop:boolean;anchor:[number,number];height:number;figure:FigureBox;
}
let version=-1;
const plans=new Map<string,Movement128Plan|null>(),figures=new Map<string,FigureBox|undefined>();
function current(){if(version!==artIndexVersion){version=artIndexVersion;plans.clear();figures.clear();}}
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
/** Figure union in the legacy 192px coordinate system; metadata only, including every detailed clip. */
export function movement128Figure(id:string):FigureBox|undefined{
  current();if(figures.has(id))return figures.get(id);
  let result:FigureBox|undefined;
  const all=[movementIdle8Plan(id),...(['walk','attack'] as const).flatMap(motion=>HERO_DIRECTIONS.map(direction=>movement128Plan(id,motion,direction)))];
  for(const p of all){
    if(!p)continue;
    const f=p.figure,b={left:f.left*2,top:f.top*2,right:f.right*2,bottom:f.bottom*2};
    result=result?{left:Math.min(result.left,b.left),top:Math.min(result.top,b.top),right:Math.max(result.right,b.right),bottom:Math.max(result.bottom,b.bottom)}:b;
  }
  figures.set(id,result);return result;
}
/**
 * All source poses stay available; the display samples the cycle at the actual render cadence, played at
 * HERO_ANIM_RATE of the drawn duration (the manifest keeps 600/1000 ms, the art's own timing).
 */
export function movement128Frame(plan:Pick<Movement128Plan,'durationMs'|'loop'>,elapsedMs:number):number{
  if(!(plan.durationMs>0))return 0;
  const phase=Math.max(0,elapsedMs)*HERO_ANIM_RATE/plan.durationMs,frame=Math.floor(phase*128);
  return plan.loop?frame%128:Math.min(127,frame);
}
