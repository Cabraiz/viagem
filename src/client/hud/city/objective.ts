/**
 * The round-1 objective row of the city (card cidade-08, route.ts): a row of the announcement slot with the base's
 * Uno (icon 'base', icone-base-vira-uno), "Vai pra praça!", a short second line, the walking distance left ("72 m", tnum) and the arrow along the route
 * (the "voltar" sticker turned to the route's screen bearing, as the horn's arrow is turned to the base).
 *
 * Why the slot's quiet-row class and not the horn notice (camp.ts): the horn is an `.rh-alert`, the slot's danger class.
 * An alert hides the round banner (and its joke) and skips the next one, and blocks every coach hint and shell row. Walking to
 * the plaza is a lesson, not a danger: like the coach's hint it waits for the banner (1.8 s), the notices and the
 * kill-cam, and only a teammate down (the coach's rescue hint) goes ahead of it. Styles live in hud.css (always loaded),
 * next to the coach's row it mirrors.
 *
 * BUG-20261013-ORQ-oferta-e-dicas-menores: the row is one short line, and never a fixed line under the top band: after
 * OBJECTIVE_FULL_MS on screen (summed over its turns in the slot) it folds to the distance and the arrow only
 * (data-compact), and while there is no arrow to show it goes (hidden) until the arrow comes back.
 */
import {putHidden,turnMoved} from '../dom-put.ts';
import {icon} from './deps.ts';
import {OBJECTIVE_JOKE,OBJECTIVE_TEXT,objectiveMeters,type CityObjective} from './route.ts';

/** How long the whole line ("Vai pra praça!") shows before the row folds to the distance and the arrow (ms on screen). */
export const OBJECTIVE_FULL_MS=3000;

export interface ObjectivePart {
  readonly el:HTMLElement;
  /**
   * Draws `objective` (undefined hides the row). True when the row was shown or hidden now (the slot's layout changed).
   * The second line is always the joke: the one written walk hint is the waiting room's label (BUG-dica-tutorial-duplicada).
   */
  render(objective:CityObjective|undefined):boolean;
}

export function createObjectiveRow(doc:Document=document,now:()=>number=()=>performance.now()):ObjectivePart{
  const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
    const node=doc.createElement(tag);node.className=className;parent?.append(node);return node;
  };
  const row=el('div','rh-objetivo');row.hidden=true;row.setAttribute('role','status');row.lang='pt-BR';
  el('span','rh-objetivo-mark',row).insertAdjacentHTML('beforeend',icon('base',{size:32}));
  const body=el('span','rh-objetivo-body',row);
  el('span','rh-objetivo-text',body).textContent=OBJECTIVE_TEXT;
  el('span','rh-objetivo-sub',body).textContent=OBJECTIVE_JOKE;
  // The distance changes every step: kept out of the live region (a screen reader hears the line once).
  const meters=el('b','rh-objetivo-m',row);meters.setAttribute('aria-hidden','true');
  const arrow=el('span','rh-objetivo-arrow',row);arrow.insertAdjacentHTML('beforeend',icon('voltar',{size:32,label:'Caminho até a praça'}));
  let shown=false,lastM='',lastTurn:number|undefined,compact=false;
  /** Time the whole line has been on screen (ms), summed over its turns; since: when the current turn began. */
  let seenMs=0,since:number|undefined;
  const setShown=(next:boolean)=>{
    if(next===shown)return false;
    shown=next;row.hidden=!next;
    if(next)since=now();else if(since!==undefined){seenMs+=now()-since;since=undefined;}
    return true;
  };
  return {el:row,render(objective){
    if(!objective)return setShown(false);
    const m=objective.meters===undefined?'':objectiveMeters(objective.meters);
    if(m!==lastM){lastM=m;meters.textContent=m;}
    // The sticker points left (180°): turned by the route's bearing plus half a turn, whole degrees. Its own transform
    // (no custom property for the children to inherit), rewritten only for a turn the eye sees (dom-put turnMoved).
    const turn=objective.bearing===undefined?undefined:Math.round(objective.bearing)+180;
    putHidden(arrow,turn===undefined);
    if(turn!==undefined&&turnMoved(lastTurn,turn)){lastTurn=turn;arrow.style.transform=`rotate(${turn}deg)`;}
    let changed=false;
    if(!compact&&shown&&since!==undefined&&seenMs+now()-since>=OBJECTIVE_FULL_MS){
      compact=true;row.dataset.compact='true';row.classList.add('rh-objetivo-compact');changed=true;
    }
    // Folded, the row is only the arrow (and the distance): with no arrow there is nothing left to show.
    return setShown(!compact||turn!==undefined)||changed;
  }};
}
