/**
 * What the edge arrows and the minimap show (UX-bordas-fora-da-tela, ORQ-minimapa), from what the client already has:
 * players (interpolated positions + run state), the base of the world, the last RunView (boss, telegraphs, chests),
 * the spawn warnings still pending and the lit "Me salva" pings. Pure: the scene's `locate` is passed in.
 */
import type {EnemyView,PickupView,PlayerRunView,TelegraphView} from '../sim/view.ts';
import type {EdgeTarget} from './edges.ts';
import type {MinimapItem} from './minimap.ts';
import {secondsLeft} from './model.ts';
import {SIM_HZ} from '../sim/types.ts';
import {railName} from '../render/map-label-rules.ts';
import {REVIVE_RADIUS} from '../sim/revive.ts';
import {SOS_COOLDOWN_MS} from '../fun/sos.ts';

export interface Point {x:number;y:number}
export interface RadarPlayer {id:string;name:string;classId:string;x:number;y:number;online:boolean;spectator?:boolean}
export interface SpawnWarning {x:number;y:number;atTick:number}
export interface RadarInput {
  selfId:string;
  /** What the camera follows (world units): distances count from here. */
  focus:Point;
  /** The local player's own body (minimap "você"). */
  self:Point;
  tick:number;
  players:readonly RadarPlayer[];
  states:ReadonlyMap<string,PlayerRunView>;
  base?:Point;
  enemies?:readonly EnemyView[];
  telegraphs?:readonly TelegraphView[];
  pickups?:readonly PickupView[];
  warnings?:readonly SpawnWarning[];
  /** A "Me salva" ping of this player is lit. */
  pinged?:(id:string)=>boolean;
  /** Screen point (CSS px, viewport) of a world point. */
  locate:(p:Point)=>Point;
  portrait?:(classId:string)=>string;
}
/** A spawn warning keeps its arrow until this long after the critters arrive. */
export const SPAWN_TAIL_TICKS=SIM_HZ;
/** A telegraph this close to the boss and this close to firing marks the boss arrow as danger. */
export const BOSS_TELEGRAPH={units:8,ticks:SIM_HZ*1.5};

export function radar(input:RadarInput):{targets:EdgeTarget[];items:MinimapItem[]}{
  const targets:EdgeTarget[]=[],items:MinimapItem[]=[];
  const far=(p:Point)=>Math.hypot(p.x-input.focus.x,p.y-input.focus.y);
  const add=(t:Omit<EdgeTarget,'screen'|'distance'>,at:Point)=>targets.push({...t,screen:input.locate(at),distance:far(at)});
  items.push({key:'self',kind:'voce',x:input.self.x,y:input.self.y});
  for(const p of input.players){
    if(p.id===input.selfId||p.spectator)continue;
    const st=input.states.get(p.id);
    if(st?.eliminated)continue;
    const caido=!!st?.downed;
    // Someone away (offline) is no target to walk to unless caído: their body still bleeds out where it fell.
    if(!caido&&!p.online)continue;
    const ping=caido&&!!input.pinged?.(p.id);
    items.push({key:p.id,kind:caido?'caido':'aliado',x:p.x,y:p.y,ping});
    add({key:p.id,kind:caido?'caido':'aliado',name:p.name,portrait:input.portrait?.(p.classId),
      ...(caido?{seconds:secondsLeft(st!.downed!.bleedOutTick,input.tick),ping}:{})},p);
  }
  if(input.base){items.push({key:'base',kind:'base',x:input.base.x,y:input.base.y});add({key:'base',kind:'base',name:'Base'},input.base);}
  for(const e of input.enemies??[]){
    if(!e.boss||e.hp<=0)continue;
    const danger=(input.telegraphs??[]).some(t=>t.fireTick>=input.tick&&t.fireTick-input.tick<=BOSS_TELEGRAPH.ticks&&Math.hypot(t.x-e.x,t.y-e.y)<=BOSS_TELEGRAPH.units);
    items.push({key:e.id,kind:'chefe',x:e.x,y:e.y});add({key:e.id,kind:'chefe',name:'Chefe',danger},e);
  }
  (input.warnings??[]).forEach((w,i)=>{
    if(input.tick>w.atTick+SPAWN_TAIL_TICKS)return;
    const key=`spawn:${w.atTick}:${i}`;items.push({key,kind:'spawn',x:w.x,y:w.y});add({key,kind:'spawn',name:'Bichos chegando'},w);
  });
  for(const p of input.pickups??[]){
    if(p.kind!=='chest')continue;
    items.push({key:p.id,kind:'bau',x:p.x,y:p.y});add({key:p.id,kind:'bau',name:'Baú'},p);
  }
  return {targets,items};
}

/** Keeps the spawn warnings of the run's events until they are stale (pure list update, for the client). */
export function keepWarnings(list:SpawnWarning[],events:readonly {type:string;x?:number;y?:number;atTick?:number}[],tick:number,max=12){
  for(const e of events)if(e.type==='spawn-warning'&&Number.isFinite(e.x)&&Number.isFinite(e.y)&&Number.isFinite(e.atTick))list.push({x:e.x!,y:e.y!,atTick:e.atTick!});
  for(let i=list.length-1;i>=0;i--)if(tick>list[i].atTick+SPAWN_TAIL_TICKS)list.splice(i,1);
  if(list.length>max)list.splice(0,list.length-max);
  return list;
}

/** "Segura aí, Zé!" over the rescuer while it holds someone's rescue (once per fall), or undefined. */
export function holdLine(self:{x:number;y:number}|undefined,selfState:PlayerRunView|undefined,players:readonly {id:string;name:string;x:number;y:number}[],states:ReadonlyMap<string,PlayerRunView>,said:Set<string>){
  if(!self||!selfState||selfState.downed||selfState.eliminated||selfState.spectator||selfState.hp<=0)return undefined;
  for(const p of players){
    const st=states.get(p.id);
    if(p.id===selfState.id||!st?.downed||st.eliminated||st.downed.progress<=0)continue;
    if(Math.hypot(p.x-self.x,p.y-self.y)>REVIVE_RADIUS+.15)continue;
    const key=`${p.id}:${st.downed.bleedOutTick}`;
    if(said.has(key))continue;
    said.add(key);
    return {key,line:`Segura aí, ${railName(p.name)}!`};
  }
  return undefined;
}
/** What the "Me salva" button shows: hidden unless the local player is caído in a wave; greyed while cooling. */
export function sosButton(state:PlayerRunView|undefined,combat:boolean,coolingMs:number){
  const show=combat&&!!state?.downed&&!state.eliminated&&!state.spectator;
  return {show,cooling:show&&coolingMs>0,left:Math.max(0,Math.min(1,coolingMs/SOS_COOLDOWN_MS))};
}

