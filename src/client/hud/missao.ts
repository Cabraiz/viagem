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
 * Card objetivo-com-verbo (auditoria-jogabilidade item 8, "Chaveiro chega em 9:55. 5 de 5 ninhos de pé" said nothing
 * to do): one sentence with a verb at a time, from the run's view (missionFacts), each with its edge arrow (arrow):
 *  - the dark pressing on the hero (fear >= DARK_PRESS): "Volte ao Uno!" (urgent, over everything, the Uno's arrow);
 *  - the crates the team opened this window in the Minerva's and the explore's lines: "Junte caixas (2)";
 *  - the moto stopped for the team (morta, tombo): "Moto morta: vá empurrar" / "A moto tombou: tire os bichos" (urgent,
 *    the moto's arrow; hud/chaveiro.ts MotoReason leaves these two to the line). A dead moto with fewer than
 *    MOTO_PUSHERS standing (solo, bots count) cannot be pushed, it starts by itself (sim MORTA_ALONE_SECONDS): "Moto morta:
 *    proteja o Uno", calm, the Uno's arrow (the ORQ 29/10, E4's finding);
 *  - the objective (the user 29/10: the nests are NOT needed to win; protect the Uno until the chaveiro arrives):
 *    "Proteja o Uno até o chaveiro" (the Uno's arrow), and with nests standing it takes turns every ROTATE_S with
 *    "Opcional: derrube ninhos (5)" (the nearest nest's arrow). Both small, never the big band: no line may sound like
 *    an obligation to knock the nests down.
 * Time comes from the sim tick (the clock's), so a phone and a PC agree. The tracker is pure (tests); createMission
 * paints the two elements.
 */
import {SIM_HZ,type MotoMode,type RunView} from '../../contract/index.ts';
import {MOTO_ACTIONS,MOTO_PUSHERS} from './chaveiro.ts';

export const MISSION_BIG_MS=4000;
/** "Volte ao Uno." shows (and the Uno gets its arrow) in the last seconds of a window. */
export const RETURN_SECONDS=20;
/** "Ponha as torres perto do Uno." holds at most this long. */
export const TOWERS_MAX_S=30;
/** "Eles vão atrás do Uno. Defenda." shows this long (big all the time). */
export const DEFEND_MS=4000;
/** The dark presses (rules/fear.ts: 0 alone in light, 1 consumed): from half of it the line says come back to the Uno. */
export const DARK_PRESS=.5;
/** The objective's line and the optional nests' take turns this long each. */
export const ROTATE_S=8;

export const MISSION_TEXT=Object.freeze({
  minerva:'Junte caixas e volte ao Uno.',
  explora:'Junte mais caixas, em dupla.',
  volta:'Volte ao Uno.',
  torres:'Ponha as torres perto do Uno.',
  defenda:'Eles vão atrás do Uno. Defenda.',
  escuro:'Volte ao Uno!',
  sozinho:'Moto morta: proteja o Uno',
  proteja:'Proteja o Uno até o chaveiro',
});
/** The lines that carry a count: the crates the team opened this window, the nests standing (optional). */
export const missionCount={
  minerva:(n:number)=>n>0?`Junte caixas (${n})`:MISSION_TEXT.minerva,
  explora:(n:number)=>n>0?`Junte caixas em dupla (${n})`:MISSION_TEXT.explora,
  ninhos:(n:number)=>`Opcional: derrube ninhos (${n})`,
};

export type MissionKey='minerva'|'explora'|'volta'|'torres'|'defenda'|'escuro'|'moto'|'sozinho'|'proteja'|'ninhos';
/** The calm lines: always the small row (never the big band), so they never read as an order. */
const CALM:ReadonlySet<MissionKey>=new Set(['proteja','ninhos']);
/** What the line's edge arrow points at (rescue.ts; the arrow shows only while the target is off screen). */
export type MissionArrow={kind:'uno';urgent:boolean}|{kind:'moto'}|{kind:'ninho';id:string;x:number;y:number};
/** The run's view as the line reads it (missionFacts); every field optional, absent = not in this run. */
export interface MissionFacts {
  /** The team's crates opened in the run so far (PlayerStatsView.chests). */
  crates?:number;
  /** The nests mode: how many stand, and the standing one nearest the hero. */
  nests?:{alive:number;nearest?:{id:string;x:number;y:number}};
  /** The chaveiro's moto while the objective runs. */
  moto?:MotoMode;
  /** While the objective runs: the players standing (bots too), who could push a dead moto (MOTO_PUSHERS). */
  pushers?:number;
  /** The local hero's dark (PlayerView.fear, 0..1). */
  dark?:number;
}
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
  /** Card objetivo-com-verbo: what the view says (missionFacts); absent = the lines above only. */
  facts?:MissionFacts;
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
  /** The line's target: the Uno (as pointUno says), the moto, the nearest nest. */
  arrow?:MissionArrow;
}

/** The facts of a view for the local hero (pure): crates, nests, the moto, the dark; `hero`: where it stands (world u). */
export function missionFacts(view:Pick<RunView,'players'|'structures'|'objective'>,localId:string,hero?:{x:number;y:number}):MissionFacts{
  const me=view.players.find(p=>p.id===localId),out:MissionFacts={};
  let crates=0,stats=false;
  for(const p of view.players)if(p.stats?.chests!==undefined){crates+=p.stats.chests;stats=true;}
  if(stats)out.crates=crates;
  const nests=view.structures.filter(s=>s.kind==='ninho');
  if(nests.length){
    const up=nests.filter(s=>s.hp>0&&s.phase!=='destruido');
    const d=(s:{x:number;y:number})=>hero?Math.hypot(s.x-hero.x,s.y-hero.y):0;
    const near=up.reduce<typeof up[number]|undefined>((a,b)=>!a||d(b)<d(a)?b:a,undefined);
    out.nests={alive:up.length,...(near?{nearest:{id:near.id,x:near.x,y:near.y}}:{})};
  }
  const o=view.objective;
  if(o&&!o.ended){
    out.moto=o.moto.mode;
    // The sim's crew (chaveiro/system.ts countCrew, revive.ts isStanding): online, seated, not down, alive.
    out.pushers=view.players.filter(p=>p.online!==false&&!p.spectator&&!p.downed&&!p.eliminated&&!(p.hp<=0)).length;
  }
  if(me?.fear!==undefined)out.dark=me.fear;
  return out;
}

const ms=(n:number)=>Math.round(n/1000*SIM_HZ);

export class MissionTracker {
  private key:MissionKey|undefined;private since=0;private windowEnd:number|undefined;
  private lastTick=-1;private sawMinerva=false;
  /** The team's crates when the current window opened (its count starts at 0). */
  private cratesFrom:number|undefined;private cratesWindow:number|undefined;
  /** After the Minerva: 'torres' → 'defenda' → 'feito' (once a run). */
  private after:'antes'|'torres'|'defenda'|'feito'='antes';private afterSince=0;
  reset(){this.key=undefined;this.windowEnd=undefined;this.lastTick=-1;this.sawMinerva=false;this.after='antes';this.cratesFrom=this.cratesWindow=undefined;}
  /** The crates opened since the window that ends at `end` opened. */
  private crates(end:number,now:number|undefined){
    if(now===undefined)return 0;
    if(this.cratesWindow!==end){this.cratesWindow=end;this.cratesFrom=now;}
    return Math.max(0,now-(this.cratesFrom??now));
  }
  step(input:MissionInput):MissionOutput{
    const {tick}=input;
    // A new run (rematch) starts the tick again.
    if(tick<this.lastTick)this.reset();
    this.lastTick=tick;
    if(!input.playing)return this.show(undefined,tick,false);
    const facts=input.facts??{};
    const minerva=input.minervaAte!==undefined&&tick<input.minervaAte?input.minervaAte:undefined;
    const explora=input.explora&&tick>=input.explora.from&&tick<input.explora.until?input.explora:undefined;
    if(minerva!==undefined)this.sawMinerva=true;
    // The dark pressing: come back to the Uno, over every other line.
    if((facts.dark??0)>=DARK_PRESS)return this.show('escuro',tick,true,undefined,undefined,{kind:'uno',urgent:true});
    if(minerva!==undefined){
      const back=(minerva-tick)/SIM_HZ<=RETURN_SECONDS;
      return back?this.show('volta',tick,true,minerva,undefined,{kind:'uno',urgent:true})
        :this.show('minerva',tick,true,minerva,missionCount.minerva(this.crates(minerva,facts.crates)),{kind:'uno',urgent:false});
    }
    if(explora){
      const back=(explora.until-tick)/SIM_HZ<=RETURN_SECONDS;
      return back?this.show('volta',tick,true,explora.until,undefined,{kind:'uno',urgent:true})
        :this.show('explora',tick,false,explora.until,missionCount.explora(this.crates(explora.until,facts.crates)));
    }
    // A dead moto nobody can push (solo): it starts by itself, so the Uno is the job meanwhile.
    if(facts.moto==='morta'&&facts.pushers!==undefined&&facts.pushers<MOTO_PUSHERS)return this.show('sozinho',tick,true,undefined,undefined,{kind:'uno',urgent:false});
    // The moto stopped for the team: go there.
    const action=facts.moto?MOTO_ACTIONS[facts.moto]:undefined;
    if(action)return this.show('moto',tick,false,undefined,action,{kind:'moto'});
    // After the Minerva, once: the towers (only with a kit in hand), then "Eles vão atrás do Uno. Defenda.".
    if(this.sawMinerva&&this.after==='antes'){this.after=input.towerKit?'torres':'defenda';this.afterSince=tick;}
    if(this.after==='torres'&&(!input.towerKit||tick-this.afterSince>=ms(TOWERS_MAX_S*1000))){this.after='defenda';this.afterSince=tick;}
    if(this.after==='defenda'&&tick-this.afterSince>=ms(DEFEND_MS))this.after='feito';
    if(this.after==='torres'||this.after==='defenda')return this.show(this.after,tick,false);
    // The objective: protect the Uno; the nests standing are optional, in turns with it (alone without the objective).
    const nests=facts.nests,objective=facts.moto!==undefined;
    const nestTurn=!objective||Math.floor(tick/ms(ROTATE_S*1000))%2===1;
    if(nests&&nests.alive>0&&nestTurn)return this.show('ninhos',tick,false,undefined,missionCount.ninhos(nests.alive),nests.nearest?{kind:'ninho',...nests.nearest}:undefined);
    if(objective)return this.show('proteja',tick,true,undefined,undefined,{kind:'uno',urgent:false});
    return this.show(undefined,tick,false);
  }
  private show(key:MissionKey|undefined,tick:number,pointUno:boolean,windowEnd?:number,text?:string,arrow?:MissionArrow):MissionOutput{
    // A line starts over (big again) when it changes or a new window opens with the same line.
    if(key!==this.key||windowEnd!==this.windowEnd&&key!==undefined&&windowEnd!==undefined){this.key=key;this.since=tick;}
    this.windowEnd=windowEnd;
    if(!key)return {pointUno};
    const age=tick-this.since,big=key==='defenda'||!CALM.has(key)&&age<ms(MISSION_BIG_MS);
    return {pointUno,...(arrow?{arrow}:{}),line:{key,text:text??MISSION_TEXT[key as keyof typeof MISSION_TEXT],big,urgent:key==='volta'||key==='escuro'||key==='moto'}};
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
