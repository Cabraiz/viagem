/**
 * The "Minuto de Minerva" clock (card NEW-20261022-ORQ-relogio-minerva): at the start of a run the monsters stand still
 * for a while (the sim's `minervaAteTick`, card monstros-espalhados) so the players can walk the map. Card
 * inicio-no-uno-caixas-120 (the user, 23/10: "apareça somente o relógio, com o ponteiro decrescendo"): 120 s, and the HUD
 * shows ONLY an analog clock (missao-proteger-uno-tempo: 30 s), no title, no seconds written (the aria-label still says them): the hand walks back from the
 * full turn to 12 and the coloured sector it closes (the time left) shrinks with it; the last MINERVA_URGENT_SECONDS
 * pulse in the danger colour and, at zero, the face flashes for WAKE_MS and the clock goes away. The same clock shows
 * the time to explore after each wave (RunState.exploraDesdeTick/exploraAteTick), its full turn that window's length.
 * Time comes from the sim (view.tick against minervaAteTick), never the local clock, so it matches the server and a
 * player who joins late sees the same hand. It sits in the announcement slot of the top band (a phone lying down: under
 * the minimap, minerva.css): never over the hero nor the phone's controls, and it pauses nothing.
 */
import {SIM_HZ, type RunView} from '../../contract/index.ts';
import type {HudContext,HudPart} from './model.ts';

/** One full sweep of the hand (sim ninhos.ts MINERVA_S). */
export const MINERVA_SECONDS=30;
/** The last seconds pulse in the danger colour. */
export const MINERVA_URGENT_SECONDS=10;
/** How long the wake flash stays (ms of sim time). */
export const WAKE_MS=1600;
const WAKE_TICKS=Math.round(WAKE_MS/1000*SIM_HZ);

export type MinervaPhase='clock'|'wake';
export interface MinervaView {
  phase:MinervaPhase;
  /** Whole seconds left, rounded up (120 … 1; 0 on the wake notice). */
  seconds:number;
  /** Hand angle in degrees, clockwise from 12: 360 at the start, 0 at zero (the time left; follows the exact sim time). */
  angle:number;
  urgent:boolean;
}

/** The room's end tick for the minute (RunState.minervaAteTick), if usable: absent, 0 or garbage → no minute. */
export function minervaOf(run:{phase:string;minervaAteTick?:unknown}){
  const end=run.minervaAteTick;
  return typeof end==='number'&&Number.isFinite(end)&&end>0?end:undefined;
}
/** The time to explore (RunState.exploraDesdeTick/exploraAteTick), if usable: [first tick, end tick], else undefined. */
export function exploraOf(run:{exploraDesdeTick?:unknown;exploraAteTick?:unknown}):{from:number;until:number}|undefined{
  const from=run.exploraDesdeTick,until=run.exploraAteTick;
  return typeof from==='number'&&typeof until==='number'&&Number.isFinite(from)&&Number.isFinite(until)&&from>=0&&until>from?{from,until}:undefined;
}

/**
 * What to draw at `tick`: the clock while tick < end, the wake notice for WAKE_TICKS after it, nothing otherwise.
 * `sawClock`: the clock was on screen this run (a player who joins after the minute never gets the notice).
 */
export function minervaView(tick:number,end:number|undefined,sawClock=true,total=MINERVA_SECONDS):MinervaView|undefined{
  if(end===undefined||!Number.isFinite(tick))return undefined;
  const left=(end-tick)/SIM_HZ,full=total>0?total:MINERVA_SECONDS;
  if(left>0){
    const clamped=Math.min(full,left);
    const seconds=Math.ceil(clamped);
    return {phase:'clock',seconds,angle:clamped/full*360,urgent:seconds<=MINERVA_URGENT_SECONDS};
  }
  if(sawClock&&tick-end<WAKE_TICKS)return {phase:'wake',seconds:0,angle:0,urgent:true};
  return undefined;
}

const SVG='http://www.w3.org/2000/svg';
const svg=<K extends keyof SVGElementTagNameMap>(tag:K,attrs:Record<string,string|number>,parent:Element)=>{
  const node=document.createElementNS(SVG,tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));parent.append(node);return node;
};

export interface MinervaPart extends HudPart {readonly shown:boolean}

export function createMinerva():MinervaPart{
  const root=document.createElement('div');root.className='rh-minerva';root.hidden=true;root.setAttribute('role','timer');
  const face=document.createElementNS(SVG,'svg');face.setAttribute('class','rh-minerva-face');face.setAttribute('viewBox','-50 -50 100 100');face.setAttribute('aria-hidden','true');
  svg('circle',{class:'rh-minerva-rim',r:46},face);
  // The time left: a pie from 12 to the hand, shrinking as the hand walks back.
  const slice=svg('path',{class:'rh-minerva-slice',d:''},face);
  for(let i=0;i<12;i++){
    const a=i*Math.PI/6,inner=i%3===0?32:36;
    svg('line',{class:i%3===0?'rh-minerva-tick rh-minerva-tick-big':'rh-minerva-tick',x1:Math.sin(a)*inner,y1:-Math.cos(a)*inner,x2:Math.sin(a)*41,y2:-Math.cos(a)*41},face);
  }
  const hand=svg('g',{class:'rh-minerva-hand'},face);
  svg('line',{x1:0,y1:8,x2:0,y2:-38},hand);
  svg('circle',{class:'rh-minerva-pin',r:5},face);
  root.append(face);
  let end:number|undefined,total=MINERVA_SECONDS,sawClock=false,lastTick=-1,drawn='';
  return {
    el:root,
    get shown(){return !root.hidden;},
    update(view:RunView,ctx:HudContext){
      // A new run (rematch) starts the tick again: forget the previous minute.
      if(view.tick<lastTick){sawClock=false;end=undefined;}
      lastTick=view.tick;
      // Kept once seen: the wake notice still shows if the room drops the field right after the minute. The Minerva
      // first, else the time to explore (a new window starts its clock over).
      const w=ctx.minervaAteTick!==undefined?{until:ctx.minervaAteTick,full:MINERVA_SECONDS}:ctx.explora?{until:ctx.explora.until,full:(ctx.explora.until-ctx.explora.from)/SIM_HZ}:undefined;
      if(w&&w.until!==end){end=w.until;total=w.full;sawClock=false;}
      const v=minervaView(view.tick,end,sawClock,total);
      if(v?.phase==='clock')sawClock=true;
      if(!v){if(!root.hidden){root.hidden=true;drawn='';}return;}
      root.hidden=false;
      root.dataset.phase=v.phase;
      root.classList.toggle('rh-minerva-urgente',v.urgent&&v.phase==='clock');
      hand.setAttribute('transform',`rotate(${v.angle.toFixed(1)})`);
      const r=46,a=v.angle*Math.PI/180;
      slice.setAttribute('d',v.angle<=0?'':v.angle>=359.9?`M0 ${-r}A${r} ${r} 0 1 1 0 ${r}A${r} ${r} 0 1 1 0 ${-r}Z`:`M0 0L0 ${-r}A${r} ${r} 0 ${v.angle>180?1:0} 1 ${(Math.sin(a)*r).toFixed(2)} ${(-Math.cos(a)*r).toFixed(2)}Z`);
      const key=`${v.phase}:${v.seconds}`;
      if(key===drawn)return;
      drawn=key;
      // Nothing written on screen: the label is for screen readers only.
      root.setAttribute('aria-label',v.phase==='clock'?`${v.seconds} segundos até os monstros acordarem`:'Os monstros acordaram');
    },
  };
}
