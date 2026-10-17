/**
 * `arsenal=1` of the city sandbox (with tele=1; NEW-20261016-ORQ-armas-caixas-render): a fake manual-combat view around
 * the hero (world units), pushed every ARSENAL_PUSH_MS: one crate of each rarity in an arc in front (toward the camera), a roxa one under the
 * hero (it opens while the hero stands there), a dourada one that opens every BURST_EVERY_MS, items on the ground, the
 * hero holding `arma` and firing it at the agiota every FIRE_EVERY_MS (`arma=ciclo`, the default, goes through all
 * seven). Pure: the same time gives the same view; event ids grow with the push (the renderer drops older ones).
 */
import type {PickupView,PlayerRunView,ProjectileView,RunView,SimEvent} from '../../contract/index.ts';
import {FIRE_LOOK} from '../render/arsenal-rules.ts';

export const ARSENAL_PUSH_MS=250;
const FIRE_EVERY_MS=250,BURST_EVERY_MS=3000,BURST_GONE_MS=1000;
export const SANDBOX_SELF='voce';
const CYCLE=Object.keys(FIRE_LOOK);
/** The weapon shown at `timeMs`: `arma` when it is one of the arsenal's shots, else the cycle. */
export const sandboxWeapon=(arma:string|null,timeMs:number)=>arma&&FIRE_LOOK[arma]?arma:CYCLE[Math.floor(timeMs/(FIRE_EVERY_MS*3))%CYCLE.length];

export function arsenalView(base:RunView,x:number,y:number,timeMs:number,arma:string|null):RunView{
  const tick=100+Math.floor(timeMs/50),step=Math.floor(timeMs/ARSENAL_PUSH_MS),weapon=sandboxWeapon(arma,timeMs);
  const target={x:x+1.5,y:y-.2}; // the agiota of the lab's view
  const crates:PickupView[]=[1,2,3,4,5].map((rarity,i)=>({id:`bau-${rarity}`,kind:'chest',value:rarity,x:x-2.4+i*1.2,y:y+2.6-Math.abs(i-2)*.35}));
  crates.push({id:'bau-aqui',kind:'chest',value:3,x:x+.75,y:y+.45});
  const cycle=Math.floor(timeMs/BURST_EVERY_MS),burstAt=(cycle+1)*BURST_EVERY_MS-BURST_GONE_MS;
  const events:(SimEvent&{eventId:number})[]=[];
  if(timeMs<burstAt)crates.push({id:`bau-abre-${cycle}`,kind:'chest',value:4,x:x-1.9,y:y+.9});
  else if(timeMs-burstAt<ARSENAL_PUSH_MS)events.push({type:'pickup',player:SANDBOX_SELF,pickup:`bau-abre-${cycle}`,kind:'chest',value:4,eventId:step*4+1});
  const items:PickupView[]=[
    {id:'it-pistola',kind:'item',resource:'pistola',value:2,x:x-2.6,y:y+.6},
    {id:'it-rifle',kind:'item',resource:'rifle',value:4,x:x-2.9,y:y-.6},
    {id:'it-coxinha',kind:'item',resource:'coxinha',value:2,x:x+1.8,y:y+1.7},
    {id:'it-cafe',kind:'item',resource:'cafe-lendario',value:5,x:x+2.9,y:y+1},
  ];
  const fired=Math.floor(timeMs/FIRE_EVERY_MS);
  if(timeMs-fired*FIRE_EVERY_MS<ARSENAL_PUSH_MS){
    const look=FIRE_LOOK[weapon],dx=target.x-x,dy=target.y-y,len=Math.hypot(dx,dy);
    events.push({type:'fire',player:SANDBOX_SELF,weapon,x,y,...(look.kind==='blast'?{dx,dy}:{dx:dx/len,dy:dy/len}),eventId:step*4+2});
  }
  // A shot in flight for the weapons with a projectile (the bullet halfway to the agiota; the rojão on it).
  const projectiles:ProjectileView[]=[];
  const t=(timeMs%FIRE_EVERY_MS)/FIRE_EVERY_MS;
  if(weapon==='rojao')projectiles.push({id:`p-${fired}`,source:'rojao',x:target.x,y:target.y,vx:0,vy:0,radius:.6,hostile:false});
  else if(FIRE_LOOK[weapon].kind==='muzzle')projectiles.push({id:`p-${fired}`,source:weapon,x:x+(target.x-x)*t,y:y+(target.y-y)*t,vx:(target.x-x)*2,vy:(target.y-y)*2,radius:.22,hostile:false});
  const self:PlayerRunView={id:SANDBOX_SELF,name:'Você',classId:'concursado',hp:80,maxHp:100,online:true,spectator:false,
    weapons:[{id:'faca',level:1},{id:weapon,level:3},{id:'coxinha',level:2}],passives:[],hand:1};
  return {...base,tick,players:[self],pickups:[...base.pickups,...crates,...items],projectiles,events};
}
