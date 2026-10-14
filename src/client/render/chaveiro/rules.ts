/**
 * Pure rules of the chaveiro objective's render (card NEW-20261013-ORQ-chaveiro-render): what pose, motion and effect
 * each state shows. No Phaser; the renderer (renderer.ts) calls these every frame. Times in ms of the renderer's clock.
 */
import {M} from './iso.ts';
import type {MotoPose} from './figures.ts';
import type {ChaveiroView,MotoMode} from './view.ts';
import {CAR_PARTS} from './view.ts';

/** The chaveiro takes this long to open the car once he arrives (sim: 15 s in 'abrindo'). */
export const OPEN_SECONDS=15;
/** The hazard lights blink at 2 Hz while the alarm sounds. */
export const HAZARD_MS=250;
/** A sound wave leaves the car every ALARM_WAVE_MS while the alarm sounds, and grows for ALARM_WAVE_LIFE_MS. */
export const ALARM_WAVE_MS=420,ALARM_WAVE_LIFE_MS=1100;
/** A fallen part takes this long from the car to the ground. */
export const PART_FALL_MS=520;
/** The end scene: the trunk opens in TRUNK_MS after TRUNK_DELAY_MS; the charger's label shows after LABEL_MS. */
export const TRUNK_DELAY_MS=400,TRUNK_MS=700,LABEL_MS=1300;
/** 'volta': he rides around the block where he stands: a circle this wide (units), one lap per VOLTA_LAP_MS. */
export const VOLTA_RADIUS=1.6,VOLTA_LAP_MS=3600;

/** The alarm sounds at this server tick. */
export const alarmOn=(view:Pick<ChaveiroView,'alarmUntil'>,tick:number)=>tick<view.alarmUntil;
/** The hazard lights are lit at `now` (2 Hz blink while the alarm sounds). */
export const hazardLit=(alarm:boolean,now:number)=>alarm&&Math.floor(now/HAZARD_MS)%2===0;
/** Parts that fell between two views (bits of CAR_PARTS), each once. */
export function newlyFallen(before:number,after:number):number[]{
  const out:number[]=[];
  for(let i=0;i<CAR_PARTS.length;i++){const bit=1<<i;if(after&bit&&!(before&bit))out.push(i);}
  return out;
}
/** How the moto is drawn in each mode: with both riders, with Cida alone (he is away), or on its side. */
export function motoPose(mode:MotoMode):MotoPose{
  return mode==='tombo'?'fallen':mode==='entrega'||mode==='abrindo'?'parked':'sitting';
}
/** The moto's bounce (units): it shakes riding, rocks slowly over the speed bump; still when stopped or dead. */
export function motoLift(mode:MotoMode,now:number,reduced:boolean):number{
  if(reduced)return 0;
  if(mode==='anda'||mode==='volta')return Math.abs(Math.sin(now*.025))*.025*M;
  if(mode==='lombada')return Math.max(0,Math.sin(now*.004))*.12*M;
  return 0;
}
/** 'volta': where he is on his lap around the block (offset in units) and his heading (radians). */
export function voltaLap(now:number):{dx:number;dy:number;heading:number}{
  const a=(now%VOLTA_LAP_MS)/VOLTA_LAP_MS*Math.PI*2;
  return {dx:Math.cos(a)*VOLTA_RADIUS,dy:Math.sin(a)*VOLTA_RADIUS,heading:a+Math.PI/2};
}
/** The heading of a figure that moved from `a` to `b` (radians), or `old` when it barely moved. */
export function headingOf(a:{x:number;y:number},b:{x:number;y:number},old:number):number{
  const dx=b.x-a.x,dy=b.y-a.y;
  return Math.hypot(dx,dy)<.01?old:Math.atan2(dy,dx);
}
/** The engine runs (it never stops: the key is inside with it on): the car trembles, a px offset on screen. */
export function engineShake(now:number,reduced:boolean,alarm:boolean):{x:number;y:number}{
  if(reduced)return {x:0,y:0};
  const a=alarm?1.4:.7;
  return {x:Math.sin(now*.09)*a,y:Math.sin(now*.13+1)*a*.5};
}
/** How far the chaveiro is opening the car (0..1), from the ETA left in 'abrindo'. */
export const openProgress=(etaS:number)=>Math.max(0,Math.min(1,1-etaS/OPEN_SECONDS));
/** The trunk lid at `ms` after the victory (0 closed .. 1 open). */
export const trunkOpen=(ms:number)=>Math.max(0,Math.min(1,(ms-TRUNK_DELAY_MS)/TRUNK_MS));
/** The charger's label ("conector errado") shows from LABEL_MS after the victory. */
export const chargerLabel=(ms:number)=>ms>=TRUNK_DELAY_MS+LABEL_MS;
/** The alarm's sound waves alive at `now` (0..1 of their life each), the newest last; none when silent. */
export function alarmWaves(alarmSince:number|undefined,now:number,reduced:boolean):number[]{
  if(alarmSince===undefined||reduced)return [];
  const out:number[]=[],since=now-alarmSince;
  if(since<0)return out;
  for(let k=Math.max(0,Math.ceil((since-ALARM_WAVE_LIFE_MS)/ALARM_WAVE_MS));k<=Math.floor(since/ALARM_WAVE_MS);k++){
    const t=(since-k*ALARM_WAVE_MS)/ALARM_WAVE_LIFE_MS;
    if(t<1)out.push(t);
  }
  return out;
}
/**
 * The route still ahead of the moto (for the minimap): from the route's point closest to the moto to the car.
 * The moto's own position starts it.
 */
export function routeAhead(route:readonly {x:number;y:number}[],moto:{x:number;y:number}):{x:number;y:number}[]{
  if(route.length<2)return route.slice();
  let best=0,bestD=Infinity,bestP={x:route[0].x,y:route[0].y};
  for(let i=0;i<route.length-1;i++){
    const a=route[i],b=route[i+1],dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy||1;
    const t=Math.max(0,Math.min(1,((moto.x-a.x)*dx+(moto.y-a.y)*dy)/len2));
    const p={x:a.x+dx*t,y:a.y+dy*t},d=Math.hypot(p.x-moto.x,p.y-moto.y);
    if(d<bestD){bestD=d;best=i;bestP=p;}
  }
  return [{x:moto.x,y:moto.y},bestP,...route.slice(best+1)];
}
/** The route's direction (radians) at its segment nearest to `p` (a speed bump lies across it); 0 without a route. */
export function routeHeadingAt(route:readonly {x:number;y:number}[]|undefined,p:{x:number;y:number}):number{
  if(!route||route.length<2)return 0;
  let best=0,bestD=Infinity;
  for(let i=0;i<route.length-1;i++){
    const a=route[i],b=route[i+1],dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy||1;
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len2)),d=Math.hypot(a.x+dx*t-p.x,a.y+dy*t-p.y);
    if(d<bestD){bestD=d;best=i;}
  }
  return Math.atan2(route[best+1].y-route[best].y,route[best+1].x-route[best].x);
}
