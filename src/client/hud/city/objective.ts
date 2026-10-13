/**
 * The round-1 objective row of the city (card cidade-08, route.ts): a row of the announcement slot with the base's
 * tent, "Vai pra praça!", a short second line, the walking distance left ("72 m", tnum) and the arrow along the route
 * (the "voltar" sticker turned to the route's screen bearing, as the horn's arrow is turned to the base).
 *
 * Why the slot's quiet-row class and not the horn notice (camp.ts): the horn is an `.rh-alert`, the slot's danger class.
 * An alert hides the round banner (and its joke) and skips the next one, reads as 'corneta' to the big city minimap (a
 * danger notice: the tap is blocked and an open big map closes), and blocks every coach hint and shell row. Walking to
 * the plaza is a lesson, not a danger: like the coach's hint it waits for the banner (1.8 s), the notices and the
 * kill-cam, and only a teammate down (the coach's rescue hint) goes ahead of it. Styles live in hud.css (always loaded),
 * next to the coach's row it mirrors.
 */
import {icon} from './deps.ts';
import {OBJECTIVE_JOKE,OBJECTIVE_TEXT,OBJECTIVE_WALK,objectiveMeters,type CityObjective} from './route.ts';

export interface ObjectivePart {
  readonly el:HTMLElement;
  /**
   * Draws `objective` (undefined hides the row); `walk`: the joystick is still to learn, so the second line says how to
   * walk. True when the row was shown or hidden now (the slot's layout changed).
   */
  render(objective:CityObjective|undefined,walk:boolean):boolean;
}

export function createObjectiveRow(doc:Document=document):ObjectivePart{
  const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
    const node=doc.createElement(tag);node.className=className;parent?.append(node);return node;
  };
  const row=el('div','rh-objetivo');row.hidden=true;row.setAttribute('role','status');row.lang='pt-BR';
  el('span','rh-objetivo-mark',row).insertAdjacentHTML('beforeend',icon('base',{size:32}));
  const body=el('span','rh-objetivo-body',row);
  el('span','rh-objetivo-text',body).textContent=OBJECTIVE_TEXT;
  const sub=el('span','rh-objetivo-sub',body);
  // The distance changes every step: kept out of the live region (a screen reader hears the line once).
  const meters=el('b','rh-objetivo-m',row);meters.setAttribute('aria-hidden','true');
  const arrow=el('span','rh-objetivo-arrow',row);arrow.insertAdjacentHTML('beforeend',icon('voltar',{size:32,label:'Caminho até a praça'}));
  let shown=false,lastSub='',lastM='',lastTurn='';
  return {el:row,render(objective,walk){
    const next=!!objective,changed=next!==shown;
    if(changed){shown=next;row.hidden=!next;}
    if(!objective)return changed;
    const line=walk?OBJECTIVE_WALK:OBJECTIVE_JOKE;
    if(line!==lastSub){lastSub=line;sub.textContent=line;}
    const m=objective.meters===undefined?'':objectiveMeters(objective.meters);
    if(m!==lastM){lastM=m;meters.textContent=m;}
    // The sticker points left (180°): turned by the route's bearing plus half a turn, whole degrees.
    const turn=objective.bearing===undefined?'':`${Math.round(objective.bearing)+180}deg`;
    if(turn!==lastTurn){lastTurn=turn;arrow.hidden=!turn;if(turn)arrow.style.setProperty('--rumo',turn);}
    return changed;
  }};
}
