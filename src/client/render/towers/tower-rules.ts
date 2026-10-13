/**
 * Tower drawing rules (card torres-render; D-041, design/proximos/08-TORRES.md). Pure: no Phaser, no DOM.
 * - The defense kinds as the client draws them (TOWER_LOOK): branch, calibre, footprint, and the range/cadence the
 *   client uses to aim the weapon and the sandbox uses to fire. The sim's catalog (src/sim/towers/catalog.ts) is the
 *   source of truth; the client may not import the sim (tests/arquitetura.test.ts), so tests/client/tower-rules.test.ts
 *   checks this table against it.
 * - Base art: 4 camera views × 6 rows (obra-1, obra-2, obra-3, pronta, danificada, ruina) → `baseFrame`.
 * - Weapon art: 8 directions in the row order S, SW, W, NW, N, NE, E, SE → `dir8` (screen vector) and `turnToward`
 *   (one 45° step per TURN_MS, so the weapon is seen turning).
 * - Calibre → effect parameters (muzzle flash, shot, trail, explosion, crater, shake): `CALIBRE`.
 * - Screen shake envelope (`shakeAt`), none under prefers-reduced-motion.
 * - Shot detection from consecutive views (`firedNow`): the sim sets fireTick = tick + cooldown when a ready defense
 *   fires, and fireTick = readyTick on a new obra, so a changed fireTick at or after readyTick is a volley.
 */
import {artPiece,type ArtFile} from '../../art/manifest.ts';

export type TowerKind=
  | 'vigia-do-predio'
  | 'vigias-armados'|'atiradores-do-telhado'|'ninho-de-metralhadora'|'guarnicao-do-predio'|'ninho-do-sniper'|'equipe-antimaterial'
  | 'rojao-de-festa'|'morteiro'|'lanca-foguetes'|'obuseiro'|'gustavao'
  | 'holofote'|'arame-e-sirene'|'antiaerea-quadrupla'|'posto-de-radar';
export type TowerPhase='obra-1'|'obra-2'|'obra-3'|'pronta'|'danificada'|'ruina';
export const TOWER_PHASES:readonly TowerPhase[]=Object.freeze(['obra-1','obra-2','obra-3','pronta','danificada','ruina'] as TowerPhase[]);
/** Share of maxHp at or under which a defense is drawn `danificada` (sim catalog DAMAGED_AT). */
export const TOWER_DAMAGED_AT=.5;

/** What the client needs of a defense (the sim's DefenseState; torres-fio puts it on the wire). */
export interface TowerView {
  id:string;kind:TowerKind;x:number;y:number;
  /** Footprint radius (u). */
  r:number;hp:number;maxHp:number;startTick:number;readyTick:number;fireTick:number;ruined?:boolean;
}

export type Calibre='pistola'|'fuzil'|'metralhadora'|'rotativa'|'sniper'|'antimaterial'|'rojao'|'morteiro'|'foguete'|'obus'|'gustavao'|'holofote'|'arame'|'antiaerea'|'radar';
export type Branch='T'|'A'|'B'|'C';
export interface TowerLook {
  branch:Branch;calibre:Calibre;footprint:readonly [number,number];
  /** Sim range (u) and cooldown (s); `minRange` for the artillery; `hits` which enemies it aims at. */
  range:number;minRange:number;cooldown:number;hits:'ground'|'air'|'all';shots:number;area:number;
  /** Drawn height of the finished base (u). */
  height:number;
}
const look=(branch:Branch,calibre:Calibre,footprint:[number,number],range:number,cooldown:number,height:number,
  extra:Partial<Pick<TowerLook,'minRange'|'hits'|'shots'|'area'>>={}):TowerLook=>
  Object.freeze({branch,calibre,footprint:Object.freeze(footprint) as readonly [number,number],range,cooldown,height,minRange:0,hits:'all',shots:1,area:0,...extra});
export const TOWER_LOOK:Readonly<Record<TowerKind,TowerLook>>=Object.freeze({
  'vigia-do-predio':look('T','pistola',[2,2],6,1,1.1),
  'vigias-armados':look('A','fuzil',[2,2],6.5,.9,1.3,{shots:2}),
  'atiradores-do-telhado':look('A','fuzil',[2,2],7,.8,1.6,{shots:3}),
  'ninho-de-metralhadora':look('A','metralhadora',[3,3],7.5,.5,1.4,{shots:4}),
  'guarnicao-do-predio':look('A','rotativa',[3,3],8.5,.45,2,{shots:6}),
  'ninho-do-sniper':look('A','sniper',[2,2],13,1.6,2.2),
  'equipe-antimaterial':look('A','antimaterial',[2,2],15,2.2,1.4),
  'rojao-de-festa':look('B','rojao',[1,1],7,1.6,.7,{hits:'ground',area:1.2}),
  'morteiro':look('B','morteiro',[2,2],9,2.2,.7,{minRange:2,hits:'ground',area:1.6}),
  'lanca-foguetes':look('B','foguete',[3,2],10,3,.9,{minRange:2,hits:'ground',shots:4,area:1.6}),
  'obuseiro':look('B','obus',[3,3],12,3.5,1,{minRange:3,hits:'ground',area:2.4}),
  'gustavao':look('B','gustavao',[12,4],60,20,1.8,{minRange:6,hits:'ground',area:6}),
  'holofote':look('C','holofote',[1,1],6,.5,1.2,{area:2}),
  'arame-e-sirene':look('C','arame',[1,2],4,.5,.6,{hits:'ground'}),
  'antiaerea-quadrupla':look('C','antiaerea',[2,2],9,.3,.8,{hits:'air',shots:4}),
  'posto-de-radar':look('C','radar',[2,2],0,1,1.6),
});
export const TOWER_KINDS=Object.freeze(Object.keys(TOWER_LOOK) as TowerKind[]);
export const isTowerKind=(k:string):k is TowerKind=>Object.prototype.hasOwnProperty.call(TOWER_LOOK,k);

/** The sim's phaseOf (catalog.ts), mirrored: obra thirds while building, then pronta/danificada, ruina at 0. */
export function towerPhase(d:Pick<TowerView,'hp'|'maxHp'|'startTick'|'readyTick'|'ruined'>,tick:number):TowerPhase{
  if(d.ruined)return 'ruina';
  if(tick<d.readyTick){
    const span=Math.max(1,d.readyTick-d.startTick),done=(tick-d.startTick)/span;
    return done<1/3?'obra-1':done<2/3?'obra-2':'obra-3';
  }
  return d.hp<=d.maxHp*TOWER_DAMAGED_AT?'danificada':'pronta';
}
/** Rows of base.png. */
export const phaseRow=(p:TowerPhase)=>TOWER_PHASES.indexOf(p);
/** Fires (and turns) only when ready and standing. */
export const canFire=(p:TowerPhase)=>p==='pronta'||p==='danificada';
/** Drawn height of the base by phase (share of the finished height): the obra grows in thirds, the ruin is rubble. */
export const PHASE_HEIGHT:Readonly<Record<TowerPhase,number>>=Object.freeze({'obra-1':.15,'obra-2':.5,'obra-3':.85,pronta:1,danificada:.92,ruina:.22});

/** Base column for the camera view (quarter turns, the sheet's 0°, 90°, 180°, 270°). */
export const baseColumn=(view:number)=>(((Math.round(view)%4)+4)%4);
/** Frame index in a base sheet of `views` columns × 6 rows (row-major). */
export const baseFrame=(phase:TowerPhase,view:number,views=4)=>phaseRow(phase)*views+Math.min(views-1,baseColumn(view));

/** Weapon rows: S, SW, W, NW, N, NE, E, SE (08-TORRES.md §1). */
export const DIRS8=Object.freeze(['S','SW','W','NW','N','NE','E','SE'] as const);
export type Dir8=0|1|2|3|4|5|6|7;
/**
 * Direction row for a screen vector (y down): S is screen-down, then clockwise as seen on screen (SW down-left, W left,
 * NW up-left, N up, NE up-right, E right, SE down-right). A zero vector keeps `fallback`.
 */
export function dir8(dx:number,dy:number,fallback:Dir8=0):Dir8{
  if(!(dx*dx+dy*dy>1e-12))return fallback;
  const a=Math.atan2(dy,dx)-Math.PI/2; // 0 = screen down
  return (((Math.round(a/(Math.PI/4))%8)+8)%8) as Dir8;
}
/** Unit screen vector of a direction row (the inverse of dir8), written into `out`. */
export function dirVector(d:number,out:{x:number;y:number}={x:0,y:0}){
  const a=d*Math.PI/4+Math.PI/2;out.x=Math.cos(a);out.y=Math.sin(a);
  if(Math.abs(out.x)<1e-9)out.x=0;
  if(Math.abs(out.y)<1e-9)out.y=0;
  return out;
}
/** One 45° step from `current` toward `target` by the shorter way (ties clockwise); equal stays. */
export function turnToward(current:Dir8,target:Dir8):Dir8{
  const diff=((target-current)%8+8)%8;
  if(diff===0)return current;
  return ((current+(diff<=4?1:7))%8) as Dir8;
}
/** The weapon turns one step per TURN_MS (a full half turn reads in under a quarter second). */
export const TURN_MS=55;

/**
 * Index of the defense's aim: the nearest enemy it can reach (in range, beyond minRange, ground/air as its kind hits),
 * or -1. Allocation-free; `xs`, `ys`, `air` are parallel arrays of `n` enemies.
 */
export function aimIndex(look:TowerLook,x:number,y:number,n:number,xs:ArrayLike<number>,ys:ArrayLike<number>,air:ArrayLike<number|boolean>|undefined,rangeScale=1):number{
  const max=look.range*rangeScale,min=look.minRange;
  let best=-1,bd=Infinity;
  for(let i=0;i<n;i++){
    const flying=!!air?.[i];
    if(look.hits==='air'?!flying:look.hits==='ground'&&flying)continue;
    const d=Math.hypot(xs[i]-x,ys[i]-y);
    if(d>max||d<min||d>=bd)continue;
    best=i;bd=d;
  }
  return best;
}

/** A volley happened between two views of the same defense (see the header). */
export function firedNow(prevFireTick:number|undefined,d:Pick<TowerView,'fireTick'|'readyTick'|'ruined'>,tick:number):boolean{
  return prevFireTick!==undefined&&!d.ruined&&d.fireTick!==prevFireTick&&d.fireTick>tick&&tick>=d.readyTick;
}

/** Shot drawing kinds: a fast streak, a lobbed shell, a rocket with smoke, a light beam, a spark ring, nothing. */
export type ShotStyle='tracer'|'shell'|'rocket'|'beam'|'aura'|'none';
export type CraterSize='p'|'m'|'g'|'gustavao';
export interface CalibreLook {
  /** Muzzle flash radius (CSS px at zoom 1 × actor scale) and life (ms); 0 = no flash. */
  flash:number;flashMs:number;
  shot:ShotStyle;
  /** Shot speed (u/s) and lob height at mid flight (u). */
  speed:number;arc:number;
  /** Trail length (u) behind the shot; 0 = none. */
  trail:number;
  /** Explosion radius (u) and life (ms) at the impact; 0 = a small spark only. */
  blast:number;blastMs:number;
  crater?:CraterSize;
  /** Screen shake peak (CSS px) and length (ms) on impact; 0 = none. */
  shake:number;shakeMs:number;
  /** Barrel length (u) from the mount. */
  barrel:number;
}
const cal=(c:Partial<CalibreLook>&Pick<CalibreLook,'shot'>):CalibreLook=>Object.freeze({flash:0,flashMs:0,speed:30,arc:0,trail:0,blast:0,blastMs:0,shake:0,shakeMs:0,barrel:.35,...c});
export const CALIBRE:Readonly<Record<Calibre,CalibreLook>>=Object.freeze({
  pistola:cal({shot:'tracer',flash:5,flashMs:70,speed:34,trail:.5,barrel:.25}),
  fuzil:cal({shot:'tracer',flash:6,flashMs:70,speed:42,trail:.8,barrel:.4}),
  metralhadora:cal({shot:'tracer',flash:8,flashMs:60,speed:46,trail:.9,barrel:.5}),
  rotativa:cal({shot:'tracer',flash:10,flashMs:60,speed:50,trail:1.1,barrel:.55}),
  sniper:cal({shot:'tracer',flash:8,flashMs:90,speed:90,trail:2.6,barrel:.75}),
  antimaterial:cal({shot:'tracer',flash:12,flashMs:110,speed:80,trail:3,blast:.35,blastMs:220,barrel:.85}),
  rojao:cal({shot:'rocket',flash:7,flashMs:90,speed:9,arc:.9,trail:1.2,blast:1.2,blastMs:320,crater:'p',barrel:.3}),
  morteiro:cal({shot:'shell',flash:10,flashMs:120,speed:8,arc:3.2,blast:1.6,blastMs:380,crater:'m',barrel:.45}),
  foguete:cal({shot:'rocket',flash:10,flashMs:110,speed:13,arc:1.4,trail:1.8,blast:1.6,blastMs:360,crater:'m',barrel:.6}),
  obus:cal({shot:'shell',flash:16,flashMs:160,speed:14,arc:3.6,trail:.6,blast:2.4,blastMs:480,crater:'g',shake:3,shakeMs:220,barrel:.9}),
  gustavao:cal({shot:'shell',flash:40,flashMs:320,speed:18,arc:9,trail:2.2,blast:6,blastMs:900,crater:'gustavao',shake:14,shakeMs:900,barrel:3.2}),
  holofote:cal({shot:'beam',flash:0,flashMs:0,speed:0,blastMs:260,barrel:.3}),
  arame:cal({shot:'aura',blastMs:300,barrel:0}),
  antiaerea:cal({shot:'tracer',flash:7,flashMs:60,speed:48,arc:0,trail:1,blast:.3,blastMs:160,barrel:.5}),
  radar:cal({shot:'none',barrel:.3}),
});
/** Crater decal radius (u) and how long it stays on the snow (ms). */
export const CRATER:Readonly<Record<CraterSize,{radius:number;ms:number}>>=Object.freeze({
  p:{radius:.45,ms:6000},m:{radius:.75,ms:9000},g:{radius:1.2,ms:12000},gustavao:{radius:4.2,ms:30000}});

/** Flight time (ms) of a shot over `dist` u (beams and auras land at once). */
export function flightMs(c:CalibreLook,dist:number):number{
  if(c.shot==='beam'||c.shot==='aura'||c.shot==='none'||!(c.speed>0))return 0;
  return Math.max(30,dist/c.speed*1000);
}
/** Height (u) of a lobbed shot at progress t∈[0,1] (a parabola peaking at `arc`, longer flights lob higher). */
export const lobHeight=(c:CalibreLook,t:number)=>c.arc*4*t*(1-t);

/**
 * Screen shake amplitude (CSS px) `ms` after an impact of a calibre: a sharp peak decaying quadratically to 0 at
 * shakeMs. Under prefers-reduced-motion there is no shake at all.
 */
export function shakeAt(c:Pick<CalibreLook,'shake'|'shakeMs'>,ms:number,reduced:boolean):number{
  if(reduced||!(c.shake>0)||!(c.shakeMs>0)||!(ms>=0)||ms>=c.shakeMs)return 0;
  const k=1-ms/c.shakeMs;
  return c.shake*k*k;
}
/** Shake offset (px) at `ms`: the amplitude on a fixed two-frequency wobble (deterministic, no random). */
export function shakeOffset(amplitude:number,ms:number,out:{x:number;y:number}={x:0,y:0}){
  out.x=amplitude*Math.sin(ms*.09);out.y=amplitude*.6*Math.sin(ms*.13+1.3);
  return out;
}

/** Imported art of a defense (manifest group `torres`): the base sheet, the weapon idle sheet and the mount (px, view 0°). */
export interface TowerArt {base?:ArtFile;idle?:ArtFile;mount?:readonly [number,number]}
export function towerArt(kind:TowerKind):TowerArt|undefined{
  const piece=artPiece('torres',kind);
  if(!piece)return undefined;
  const m=piece.meta?.mount;
  const mount=Array.isArray(m)&&m.length===2&&m.every(n=>Number.isFinite(n))?[m[0] as number,m[1] as number] as const:undefined;
  const base=piece.files.base,idle=piece.files.idle;
  if(!base)return undefined;
  return {base,...(idle?{idle}:{}),...(mount?{mount}:{})};
}
/** Weapon frame in an idle sheet of 8 rows × `frames` columns. */
export const weaponFrame=(dir:Dir8,frame:number,frames:number)=>dir*Math.max(1,frames)+(Math.max(1,frames)>1?((frame%frames)+frames)%frames:0);
