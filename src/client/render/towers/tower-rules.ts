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
 * - The wire (torres-fio): `TowerFeed` turns the snapshot's structures (contract StructureView: kind, phase, aim in turns
 *   where it last fired) into TowerViews. The snapshot has no shot counter, so the volleys are inferred: an `aim` that
 *   changed since the previous snapshot is one, and a ready defense whose aim line has an enemy in reach fires again at
 *   its catalog cadence (else a tower shooting a standing or head-on enemy would fire once and never again); the two
 *   are deduplicated (`volleyNow`). `towerFootprint` is the sim's footprint (size × the plan's cell, the Gustavão on its
 *   12 × 4 rail along the plan's axis), which the snapshot does not carry either.
 */
import {artPiece,type ArtFile} from '../../art/manifest.ts';
import {ART_CELL} from '../city/art-plan.ts';
import {ART_SCALE} from '../city/materials.ts';
import {TILE_X} from '../city/projection.ts';
import {HERO_DRAW_SCALE} from '../draw-scale.ts';
import {CREW_PX} from './tower-crew.ts';
import {CITY_DISTANCE_SCALE,DEFENSES} from '../../../rules/index.ts';

export type TowerKind=
  | 'vigia-do-predio'
  | 'vigias-armados'|'atiradores-do-telhado'|'ninho-de-metralhadora'|'guarnicao-do-predio'|'ninho-do-sniper'|'equipe-antimaterial'
  | 'rojao-de-festa'|'morteiro'|'lanca-foguetes'|'obuseiro'|'gustavao'
  | 'holofote'|'arame-e-sirene'|'antiaerea-quadrupla'|'posto-de-radar';
export type TowerPhase='obra-1'|'obra-2'|'obra-3'|'pronta'|'danificada'|'ruina';
export const TOWER_PHASES:readonly TowerPhase[]=Object.freeze(['obra-1','obra-2','obra-3','pronta','danificada','ruina'] as TowerPhase[]);
/** Share of maxHp at or under which a defense is drawn `danificada` (sim catalog DAMAGED_AT). */
export const TOWER_DAMAGED_AT=.5;

/** What the client needs of a defense (the sim's DefenseState, or the wire's StructureView through TowerFeed). */
export interface TowerView {
  id:string;kind:TowerKind;x:number;y:number;
  /** Footprint radius (u): half the side of its square site. */
  r:number;
  /** Half extents (u) along world x and y when the footprint is not a square site (the Gustavão's rail). */
  half?:readonly [number,number];
  hp:number;maxHp:number;startTick:number;readyTick:number;fireTick:number;ruined?:boolean;
  /** Volleys this view stands for when more than one (the room's counter moved by 2-3 between snapshots). */
  volleys?:number;
  /** The server's phase (else derived from the ticks and hp, `towerPhase`). */
  phase?:TowerPhase;
  /** Where it last fired, in turns 0..1 of a circle from +x (the wire's `aim`): the weapon faces it, no horde scan. */
  aim?:number;
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
  'gustavao':look('B','gustavao',[12,4],60*CITY_DISTANCE_SCALE,20,.6,{minRange:6,hits:'ground',area:6}),
  'holofote':look('C','holofote',[1,1],6,.5,1.2,{area:2}),
  'arame-e-sirene':look('C','arame',[1,2],4,.5,.6,{hits:'ground'}),
  'antiaerea-quadrupla':look('C','antiaerea',[2,2],9,.3,.8,{hits:'air',shots:4}),
  'posto-de-radar':look('C','radar',[2,2],8,1.5,1.6,{area:1.6}),
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
/**
 * Frame index in a base sheet of `views` columns × its `rows` (row-major; the 6 phases when absent). A sheet without
 * the obra rows (the obstacles: pronta, danificada, ruina) shows its ready row while it is being built.
 */
export function baseFrame(phase:TowerPhase,view:number,views=4,rows?:readonly string[]){
  const row=rows?.length?Math.max(0,rows.indexOf(phase)>=0?rows.indexOf(phase):rows.indexOf('pronta')):phaseRow(phase);
  return row*views+Math.min(views-1,baseColumn(view));
}

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

/** Largest angle (rad) between the server's aim and the enemy a volley is drawn at; past it, a point along the aim. */
export const AIM_TOLERANCE=.35;
/** Share of the range at which a volley with no enemy along the aim lands. */
export const AIM_FALLBACK=.6;
/**
 * Index of the enemy a volley fired along `aim` (turns from +x) was at: reachable as in aimIndex and within
 * AIM_TOLERANCE of the aim, the closest in angle (nearer on a tie); -1 when none.
 */
export function aimedIndex(look:TowerLook,x:number,y:number,aim:number,n:number,xs:ArrayLike<number>,ys:ArrayLike<number>,air:ArrayLike<number|boolean>|undefined):number{
  const max=look.range,min=look.minRange,a=aim*Math.PI*2;
  let best=-1,ba=AIM_TOLERANCE,bd=Infinity;
  for(let i=0;i<n;i++){
    const flying=!!air?.[i];
    if(look.hits==='air'?!flying:look.hits==='ground'&&flying)continue;
    const dx=xs[i]-x,dy=ys[i]-y,d=Math.hypot(dx,dy);
    if(d>max||d<min)continue;
    const off=Math.abs(((Math.atan2(dy,dx)-a)%(Math.PI*2)+Math.PI*3)%(Math.PI*2)-Math.PI);
    if(off>ba||(off===ba&&d>=bd))continue;
    best=i;ba=off;bd=d;
  }
  return best;
}

/**
 * Footprint of a defense on a plan of `cell` u, as the sim lays it: a square site of its catalog size (`r` = size × cell
 * / 2), or for the Gustavão its rail, the catalog footprint (12 × 4 cells) with the long side along `railAxis`.
 */
export function towerFootprint(kind:TowerKind,cell:number,railAxis:'x'|'y'='x'):{r:number;half?:readonly [number,number]}{
  const def=DEFENSES[kind];
  if(def.size!==null)return {r:def.size*cell/2};
  const long=Math.max(def.footprint[0],def.footprint[1])*cell/2,short=Math.min(def.footprint[0],def.footprint[1])*cell/2;
  return {r:long,half:railAxis==='x'?[long,short]:[short,long]};
}
/** The wire's StructureView, as much of it as the towers read (structural: the client's contract type). */
export interface WireStructure {id:string;kind:string;x:number;y:number;hp:number;maxHp:number;phase?:string;aim?:number;
  /** The defense's volleys mod 256 (torre-contador-de-tiros, protocol 13): a change is a shot. Absent from older rooms. */
  shots?:number}
/** Volleys drawn for one snapshot at most (a counter that jumped further is a backlog, not a barrage). */
export const VOLLEYS_MAX=3;
/** Volleys between two snapshots (counter mod 256), 0 when it did not move. */
export const shotsBetween=(prev:number,now:number)=>((now-prev)%256+256)%256;
const PHASES=new Set<string>(TOWER_PHASES);
/** Two wire aims differ (1 byte on the wire: a change under half a step is the same aim). */
export const aimMoved=(a:number,b:number)=>{const d=Math.abs(a-b)%1;return Math.min(d,1-d)>.5/255;};
/** An aim change this soon after a drawn volley (share of the cooldown) is that same volley, not a second one. */
export const AIM_DEDUPE=.5;
/** Cooldown (sim ticks) of a defense, from the rules catalog. */
export const cooldownTicks=(kind:TowerKind)=>DEFENSES[kind].cooldown;
/** The enemies of a snapshot as parallel arrays (`air` 1 for flyers). */
export interface EnemyArrays {n:number;xs:ArrayLike<number>;ys:ArrayLike<number>;air?:ArrayLike<number>}
/**
 * Whether a volley is drawn at this snapshot (pure): `since` ticks after the last drawn one. The server's aim changed:
 * a volley, unless one was drawn under AIM_DEDUPE of a cooldown ago (that is the one it reports). Else, while it may
 * fire and has an aim, the cadence: a full cooldown since the last one and an enemy in reach along the aim. The arame's
 * aura never has an aim: a full cooldown and any enemy in reach. Only for a room that sends no `shots` (protocol 12 and older): with the counter, TowerFeed
 * reads the volleys from it (torre-contador-de-tiros).
 */
export function volleyNow(kind:TowerKind,phase:TowerPhase|undefined,aim:number|undefined,aimChanged:boolean,since:number,x:number,y:number,enemies?:EnemyArrays):boolean{
  const cd=cooldownTicks(kind),look=TOWER_LOOK[kind];
  const ready=!!phase&&canFire(phase)&&since>=cd&&!!enemies&&enemies.n>0;
  // An aura (the arame's spark ring) has no aim: the sim records none for it (src/sim/towers/system.ts), so it must
  // not wait for one — any enemy in reach at the cadence is a volley (BUG-20261013-E8-arame-nunca-dispara).
  if(look.calibre==='arame')return ready&&aimIndex(look,x,y,enemies!.n,enemies!.xs,enemies!.ys,enemies!.air)>=0;
  if(aimChanged)return since>=cd*AIM_DEDUPE;
  if(aim===undefined||!ready)return false;
  return aimedIndex(look,x,y,aim,enemies!.n,enemies!.xs,enemies!.ys,enemies!.air)>=0;
}
/**
 * Snapshot structures → TowerViews (torres-fio). Not towers are skipped. A drawn volley sets fireTick to tick + 1, which
 * `firedNow` reads as a volley. With the room's volley counter (`shots`, torre-contador-de-tiros) a change is that many
 * volleys (`volleys`, at most VOLLEYS_MAX; the renderer staggers them); without it (an older room) volleyNow guesses.
 * The first sight of a defense is never one (no burst on joining).
 */
export class TowerFeed {
  private last=new Map<string,{aim?:number;shots?:number;fire:number;at:number}>();
  private next=new Map<string,{aim?:number;shots?:number;fire:number;at:number}>();
  /** How many defenses the last snapshot had. */
  count=0;
  views(structures:readonly WireStructure[],tick:number,cell:number,options:{railAxis?:'x'|'y';enemies?:EnemyArrays}={}):TowerView[]{
    const out:TowerView[]=[],seen=this.next;seen.clear();
    for(const s of structures){
      if(!isTowerKind(s.kind))continue;
      const prev=this.last.get(s.id),phase=s.phase&&PHASES.has(s.phase)?s.phase as TowerPhase:undefined;
      let fire=prev?.fire??0,at=prev?.at??tick,volleys=0;
      if(prev&&s.shots!==undefined){
        // The room counts them: every change is a volley, even at a target that never moves (the aim alone stays put).
        // A defense seen before its first volley had no counter yet: count from 0, or that first volley is never drawn.
        volleys=Math.min(VOLLEYS_MAX,shotsBetween(prev.shots??0,s.shots));
      }else if(prev){
        const changed=s.aim!==undefined&&(prev.aim===undefined||aimMoved(prev.aim,s.aim));
        if(volleyNow(s.kind,phase,s.aim,changed,tick-prev.at,s.x,s.y,options.enemies))volleys=1;
      }
      if(volleys){fire=tick+1;at=tick;}
      seen.set(s.id,{aim:s.aim,shots:s.shots,fire,at});
      const foot=towerFootprint(s.kind,cell,options.railAxis);
      out.push({id:s.id,kind:s.kind,x:s.x,y:s.y,r:foot.r,...(foot.half?{half:foot.half}:{}),hp:s.hp,maxHp:s.maxHp,startTick:0,readyTick:0,fireTick:fire,
        ...(phase?{phase}:{}),...(phase==='ruina'?{ruined:true}:{}),...(s.aim!==undefined?{aim:s.aim}:{}),...(volleys>1?{volleys}:{})});
    }
    this.next=this.last;this.last=seen;this.count=out.length;
    return out;
  }
  /** Forgets every defense (a world swap). */
  reset(){this.last.clear();this.count=0;}
}
/** Any defense among a snapshot's structures (the scene builds its renderer on the first one). */
export const hasTowers=(structures:readonly {kind:string}[])=>structures.some(s=>isTowerKind(s.kind));

/** A volley happened between two views of the same defense (see the header). */
export function firedNow(prevFireTick:number|undefined,d:Pick<TowerView,'fireTick'|'readyTick'|'ruined'>,tick:number):boolean{
  return prevFireTick!==undefined&&!d.ruined&&d.fireTick!==prevFireTick&&d.fireTick>tick&&tick>=d.readyTick;
}

/** Shot drawing kinds: a fast streak, a lobbed shell, a rocket with smoke, a light beam, a spark ring, nothing. */
export type ShotStyle='tracer'|'shell'|'rocket'|'beam'|'aura'|'pulse'|'none';
export type CraterSize='p'|'m'|'g'|'gustavao';
export interface CalibreLook {
  /** Muzzle flash radius (CSS px at zoom 1 × actor scale) and life (ms); 0 = no flash. */
  flash:number;flashMs:number;
  shot:ShotStyle;
  /** Shot speed (u/s) and lob height at mid flight (u). */
  speed:number;arc:number;
  /** Trail length (u) behind the shot; 0 = none. */
  trail:number;
  /** A tracer's glowing core (torres-polimento): yellow by default, white-hot for the long guns, red for the flak. */
  core?:'branco'|'vermelho';
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
  pistola:cal({shot:'tracer',flash:5,flashMs:90,speed:34,trail:.9,barrel:.25}),
  fuzil:cal({shot:'tracer',flash:6,flashMs:90,speed:42,trail:1.3,barrel:.4}),
  metralhadora:cal({shot:'tracer',flash:8,flashMs:80,speed:46,trail:1.4,barrel:.5}),
  rotativa:cal({shot:'tracer',flash:10,flashMs:80,speed:50,trail:1.6,barrel:.55}),
  sniper:cal({shot:'tracer',flash:8,flashMs:90,speed:90,trail:2.6,core:'branco',barrel:.75}),
  antimaterial:cal({shot:'tracer',flash:12,flashMs:110,speed:80,trail:3,blast:.35,blastMs:220,core:'branco',barrel:.85}),
  rojao:cal({shot:'rocket',flash:7,flashMs:90,speed:9,arc:.9,trail:1.2,blast:1.2,blastMs:320,crater:'p',barrel:.3}),
  morteiro:cal({shot:'shell',flash:10,flashMs:120,speed:8,arc:3.2,blast:1.6,blastMs:380,crater:'m',barrel:.45}),
  foguete:cal({shot:'rocket',flash:10,flashMs:110,speed:13,arc:1.4,trail:1.8,blast:1.6,blastMs:360,crater:'m',barrel:.6}),
  obus:cal({shot:'shell',flash:16,flashMs:160,speed:14,arc:3.6,trail:.6,blast:2.4,blastMs:480,crater:'g',shake:3,shakeMs:220,barrel:.9}),
  gustavao:cal({shot:'shell',flash:40,flashMs:320,speed:18,arc:9,trail:2.2,blast:6,blastMs:900,crater:'gustavao',shake:12,shakeMs:1000,barrel:3.2}),
  holofote:cal({shot:'beam',flash:0,flashMs:0,speed:0,blastMs:260,barrel:.3}),
  arame:cal({shot:'aura',blastMs:300,barrel:0}),
  antiaerea:cal({shot:'tracer',flash:7,flashMs:80,speed:48,arc:0,trail:1,blast:.3,blastMs:160,core:'vermelho',barrel:.5}),
  // The radar's pulse (torres-animacao-idle-tiro): a blue ring of its area on the group it hit.
  radar:cal({shot:'pulse',flash:5,flashMs:120,blastMs:420,barrel:.3}),
});
/** Crater decal radius (u) and how long it stays on the snow (ms). */
export const CRATER:Readonly<Record<CraterSize,{radius:number;ms:number}>>=Object.freeze({
  p:{radius:.45,ms:6000},m:{radius:.75,ms:9000},g:{radius:1.2,ms:12000},gustavao:{radius:4.2,ms:30000}});

/** Shortest flight drawn (ms): a point-blank tracer still reads as a streak. */
export const MIN_FLIGHT_MS=110;
/** Flight time (ms) of a shot over `dist` u (beams and auras land at once). */
export function flightMs(c:CalibreLook,dist:number):number{
  if(c.shot==='beam'||c.shot==='aura'||c.shot==='none'||!(c.speed>0))return 0;
  return Math.max(MIN_FLIGHT_MS,dist/c.speed*1000);
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
/** The impact's first ms push the screen down (the slam) before the wobble takes over. */
export const SHAKE_SLAM_MS=80;
/**
 * Shake offset (px) at `ms`: the amplitude on a fixed wobble of two unrelated frequencies per axis (a fine tremor, not
 * a regular circle), the vertical one starting as a slam downward (deterministic, no random). |x| ≤ a, |y| ≤ 0.6 a.
 */
export function shakeOffset(amplitude:number,ms:number,out:{x:number;y:number}={x:0,y:0}){
  out.x=amplitude*(.72*Math.sin(ms*.083)+.28*Math.sin(ms*.231+.9));
  const wobble=.7*Math.sin(ms*.121+1.3)+.3*Math.sin(ms*.297+.4),slam=Math.max(0,1-ms/SHAKE_SLAM_MS);
  out.y=amplitude*.6*(wobble*(1-slam)+slam);
  return out;
}

/**
 * Scale of the delivered tower art: the city scenery's (materials.ts ART_SCALE, art-plan.ts footprint sheets), so a
 * tower stands as tall as the buildings next to it — ART_SCALE art px per projected px on a map of ART_CELL_U cells,
 * growing with the map's cell as the lots do (1.496 u on the 1.7× Cidade Nevada, cidade-escala-1-7). One constant for
 * every defense: a tower is as big as it was drawn, not stretched to its site (its feet on the anchor). World px per
 * art px for a projection whose 1 u square is `diamondPx` across (2·TILE_X in the city's).
 */
export const ART_CELL_U=ART_CELL;
export const towerArtScale=(diamondPx:number,cell:number=ART_CELL)=>diamondPx/(2*TILE_X)/ART_SCALE*cell/ART_CELL;
/**
 * Every crewed defense (the ramo A posts since 28/10, all of them since 31/10) draws base and crew at the hero's size
 * instead of the scenery's, so a soldier stands as tall as the hero drawn now (96 world px reference × actor scale ×
 * HERO_DRAW_SCALE) in fantasma, obra and pronta alike. Ruler: CREW_PX (tower-crew.ts), the ramo A's at 155.
 */
export const RAMO_A_POSTS:ReadonlySet<TowerKind>=new Set<TowerKind>(['vigia-do-predio','vigias-armados','atiradores-do-telhado',
  'ninho-de-metralhadora','guarnicao-do-predio','ninho-do-sniper','equipe-antimaterial']);
export const RAMO_A_CREW_PX=155;
/** World px per art px of a defense's delivered sheets: the hero's for a crewed kind, else the scenery's (`artScale`). */
export const towerKindScale=(kind:TowerKind,artScale:number,actorScale:number)=>
  CREW_PX[kind]?96*actorScale*HERO_DRAW_SCALE/CREW_PX[kind]!:artScale;
/** Texture px per art px of a sheet: its lite copy's cell (scripts/art-lite.mjs) over the delivered cell. */
export const textureRatio=(file:Pick<ArtFile,'cell'|'liteCell'>)=>file.liteCell?file.liteCell[0]/file.cell[0]:1;

/**
 * Imported art of a defense (manifest group `torres`): the base sheet, the weapon's idle and fire sheets (8 rows ×
 * frames) and the mount (px, view 0°).
 */
export interface TowerArt {base?:ArtFile;idle?:ArtFile;fire?:ArtFile;mount?:readonly [number,number];
  /** Where the shot leaves the weapon sheet per direction row (cell fractions; meta.muzzle, read on the idle's frame 0). */
  muzzle?:readonly (readonly [number,number])[]}
export function towerArt(kind:TowerKind):TowerArt|undefined{
  const piece=artPiece('torres',kind);
  if(!piece)return undefined;
  const m=piece.meta?.mount;
  const mount=Array.isArray(m)&&m.length===2&&m.every(n=>Number.isFinite(n))?[m[0] as number,m[1] as number] as const:undefined;
  const base=piece.files.base,idle=piece.files.idle,fire=piece.files.fire,mz=piece.meta?.muzzle;
  if(!base)return undefined;
  const muzzle=Array.isArray(mz)&&mz.length===8&&mz.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=1))
    ?(mz as [number,number][]).map(p=>[p[0],p[1]] as const):undefined;
  return {base,...(idle?{idle}:{}),...(idle&&fire?{fire}:{}),...(mount?{mount}:{}),...(idle&&muzzle?{muzzle}:{})};
}
/** Frames and pace of a weapon sheet (ArtFile frames/fps; idle 4 at 4 fps, fire at 12 when the manifest says nothing). */
export interface WeaponClip {frames:number;fps:number}
export const clipOf=(f:Pick<ArtFile,'frames'|'fps'>|undefined,fps:number):WeaponClip|undefined=>
  f?{frames:Math.max(1,f.frames??1),fps:typeof f.fps==='number'&&f.fps>0?f.fps:fps}:undefined;
/**
 * The weapon's pose now (card torres-animacao-idle-tiro): the fire sheet from its first frame at the volley (`fireAt`,
 * the sim's shot: the flash frame on the shot's tick, restarted by each volley) to its last, then the idle sheet in a loop,
 * offset by `seedMs` so a row of the same defense does not breathe in step. Reduced motion: the idle stands on frame 0.
 */
export function weaponPose(nowMs:number,fireAt:number,seedMs:number,idle:WeaponClip,fire?:WeaponClip,reduced=false):{fire:boolean;frame:number}{
  if(fire){
    const e=nowMs-fireAt;
    if(e>=0&&e<fire.frames*1000/fire.fps)return {fire:true,frame:Math.min(fire.frames-1,Math.floor(e*fire.fps/1000))};
  }
  if(reduced||idle.frames<2)return {fire:false,frame:0};
  return {fire:false,frame:Math.floor(Math.max(0,nowMs+seedMs)*idle.fps/1000)%idle.frames};
}
/** A defense's idle offset (ms, 0..999) from its id: stable across snapshots. */
export const weaponSeed=(id:string)=>{let h=0;for(let i=0;i<id.length;i++)h=(h*31+id.charCodeAt(i))|0;return ((h%1000)+1000)%1000;};
/** Weapon frame in an idle sheet of 8 rows × `frames` columns. */
export const weaponFrame=(dir:Dir8,frame:number,frames:number)=>dir*Math.max(1,frames)+(Math.max(1,frames)>1?((frame%frames)+frames)%frames:0);
