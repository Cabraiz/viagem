/**
 * The mission line (card NEW-20261023-ORQ-inicio-no-uno-caixas-120, the user 23/10: "começa o jogo, a pessoa não sabe
 * o que fazer"): one short sentence at a time, in a big band for MISSION_BIG_MS when it changes, then small and fixed
 * while it holds; both are rows of the announcement slot right under the clock (never over it, whatever the slot's top).
 *  - The minuto de Minerva: "Junte caixas e volte ao Uno.";
 *  - each time to explore after a wave: "Junte mais caixas, em dupla." (the Fear runs then too, the user 24/10: explore
 *    in pairs or come back to the Uno, card fear-escuridao-sozinho);
 *  Each line fits one row on a 393 px phone at the band's size (card topo-sem-icone-contagem-exploracao item 6): the top's
 *  clock counts the seconds (120, 119…), so the lines no longer say the time;
 *  - the last RETURN_SECONDS of either: "Volte ao Uno." (urgent; the Uno's edge arrow too, hud/rescue.ts);
 *  - after the Minerva, once a run, only while the player has not done it: "Ponha as torres perto do Uno." while a kit
 *    de torre is in the inventory (at most TOWERS_MAX_S), then "Eles vão atrás do Uno. Defenda." (big, DEFEND_MS, then gone).
 * Time comes from the sim tick (the clock's), so a phone and a PC agree. The tracker is pure (tests); createMission
 * paints the two elements.
 */
import {SIM_HZ} from '../../contract/index.ts';

export const MISSION_BIG_MS=4000;
/** "Volte ao Uno." shows (and the Uno gets its arrow) in the last seconds of a window. */
export const RETURN_SECONDS=20;
/** "Ponha as torres perto do Uno." holds at most this long. */
export const TOWERS_MAX_S=30;
/** "Eles vão atrás do Uno. Defenda." shows this long (big all the time). */
export const DEFEND_MS=4000;

export const MISSION_TEXT=Object.freeze({
  minerva:'Junte caixas e volte ao Uno.',
  explora:'Junte mais caixas, em dupla.',
  volta:'Volte ao Uno.',
  torres:'Ponha as torres perto do Uno.',
  defenda:'Eles vão atrás do Uno. Defenda.',
});

export type MissionKey='minerva'|'explora'|'volta'|'torres'|'defenda';
export interface MissionInput {
  tick:number;
  /** RunState.minervaAteTick (the Minerva's end tick) while it lasts. */
  minervaAte?:number;
  /** The time to explore while it lasts. */
  explora?:{from:number;until:number};
  /** A kit de torre in the local player's inventory. */
  towerKit:boolean;
  /** The local player is in the run (not spectating, not out). */
  playing:boolean;
}
export interface MissionLine {
  key:MissionKey;text:string;
  /** The big band in the middle (the first MISSION_BIG_MS of a line); else the small row at the top. */
  big:boolean;
  urgent:boolean;
}
export interface MissionOutput {
  line?:MissionLine;
  /** The Uno gets its edge arrow when off screen: the whole Minerva and the last RETURN_SECONDS of a time to explore. */
  pointUno:boolean;
}

const ms=(n:number)=>Math.round(n/1000*SIM_HZ);

export class MissionTracker {
  private key:MissionKey|undefined;private since=0;private windowEnd:number|undefined;
  private lastTick=-1;private sawMinerva=false;
  /** After the Minerva: 'torres' → 'defenda' → 'feito' (once a run). */
  private after:'antes'|'torres'|'defenda'|'feito'='antes';private afterSince=0;
  reset(){this.key=undefined;this.windowEnd=undefined;this.lastTick=-1;this.sawMinerva=false;this.after='antes';}
  step(input:MissionInput):MissionOutput{
    const {tick}=input;
    // A new run (rematch) starts the tick again.
    if(tick<this.lastTick)this.reset();
    this.lastTick=tick;
    if(!input.playing)return this.show(undefined,tick,false);
    const minerva=input.minervaAte!==undefined&&tick<input.minervaAte?input.minervaAte:undefined;
    const explora=input.explora&&tick>=input.explora.from&&tick<input.explora.until?input.explora:undefined;
    if(minerva!==undefined){
      this.sawMinerva=true;
      const back=(minerva-tick)/SIM_HZ<=RETURN_SECONDS;
      return this.show(back?'volta':'minerva',tick,true,minerva);
    }
    if(explora){
      const back=(explora.until-tick)/SIM_HZ<=RETURN_SECONDS;
      return this.show(back?'volta':'explora',tick,back,explora.until);
    }
    // After the Minerva, once: the towers (only with a kit in hand), then "Eles vão atrás do Uno. Defenda.".
    if(this.sawMinerva&&this.after==='antes'){this.after=input.towerKit?'torres':'defenda';this.afterSince=tick;}
    if(this.after==='torres'&&(!input.towerKit||tick-this.afterSince>=ms(TOWERS_MAX_S*1000))){this.after='defenda';this.afterSince=tick;}
    if(this.after==='defenda'&&tick-this.afterSince>=ms(DEFEND_MS))this.after='feito';
    if(this.after==='torres'||this.after==='defenda')return this.show(this.after,tick,false);
    return this.show(undefined,tick,false);
  }
  private show(key:MissionKey|undefined,tick:number,pointUno:boolean,windowEnd?:number,text?:string):MissionOutput{
    // A line starts over (big again) when it changes or a new window opens with the same line.
    if(key!==this.key||windowEnd!==this.windowEnd&&key!==undefined&&windowEnd!==undefined){this.key=key;this.since=tick;}
    this.windowEnd=windowEnd;
    if(!key)return {pointUno};
    const age=tick-this.since,big=key==='defenda'||age<ms(MISSION_BIG_MS);
    return {pointUno,line:{key,text:text??MISSION_TEXT[key as keyof typeof MISSION_TEXT],big,urgent:key==='volta'}};
  }
}

export interface MissionPart {
  /** The small row (in the announcement slot). */
  readonly row:HTMLElement;
  /** The big band (the same slot, right under the clock). */
  readonly band:HTMLElement;
  render(line:MissionLine|undefined):void;
}
export function createMission(doc:Document=document):MissionPart{
  const row=doc.createElement('div');row.className='rh-missao';row.hidden=true;row.setAttribute('role','status');row.lang='pt-BR';
  const band=doc.createElement('div');band.className='rh-missao-grande';band.hidden=true;band.setAttribute('aria-hidden','true');band.lang='pt-BR';
  let drawn='';
  return {row,band,render(line){
    const key=line?`${line.big?1:0}|${line.urgent?1:0}|${line.text}`:'';
    if(key===drawn)return;
    drawn=key;
    row.hidden=!line||line.big;band.hidden=!line||!line.big;
    if(!line)return;
    const target=line.big?band:row;
    target.textContent=line.text;
    row.classList.toggle('rh-missao-urgente',line.urgent);band.classList.toggle('rh-missao-urgente',line.urgent);
    // The screen reader hears the line once, from the row (the band is the same words, big).
    if(line.big)row.textContent=line.text;
  }};
}
