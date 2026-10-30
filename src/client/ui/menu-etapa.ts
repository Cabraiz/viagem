/**
 * The stadium menu's two steps (NEW-20261021-ORQ-nome-depois-de-selecionar, the user, 21/10): "escolher" shows the
 * letreiro, the plaque, the row and SELECIONAR, no name field; SELECIONAR locks the hero and switches to "nome", where
 * the row gives its place to [‹ trocar] [the chosen tile] [the name field] and the button confirms the entry.
 * Pure over a few element-like parts (node tests, no DOM); main.ts wires the clicks and keys.
 */

export type MenuEtapa='escolher'|'nome';

/** The confirm button's text on each step (caps written in the text, design lint). */
export const CONFIRM_TEXT:Readonly<Record<MenuEtapa,string>>=Object.freeze({escolher:'SELECIONAR',nome:'BORA!'});
/** With an invite (?sala=, menu-diz-o-jogo-e-convite #11) the button says where it goes on both steps. */
export const INVITE_TEXT='ENTRAR';
export const confirmText=(etapa:MenuEtapa,convite=false)=>convite?INVITE_TEXT:CONFIRM_TEXT[etapa];

/** What the game is, in one line under the hero's name (menu-diz-o-jogo-e-convite #2): the first visit knows what it
 *  is choosing for. "até 5 amigos" is a room's MAX_PLAYERS less the player (tests/client/menu-diz-o-jogo.test.ts). */
export const MENU_OQUE='Protege o Uno dos bichos da cidade, rodada a rodada. Sozinho ou com até 5 amigos.';

// HTMLElement.hidden is boolean | 'until-found'; this module only writes booleans.
type Hideable={hidden:boolean|string};
export interface EtapaParts {
  section:{dataset:Record<string,string|undefined>};
  /** The row of heroes between ‹ › (step 1). */
  row:Hideable;
  /** [‹ trocar] [chosen tile] [name field] (step 2). */
  nameRow:Hideable;
  input:{value:string;focus(options?:{preventScroll?:boolean}):void;select?():void};
  label:{textContent:string|null};
  /** An invite is waiting: the button says ENTRAR (confirmText). */
  convite?:boolean;
}

/**
 * Shows a step. On "nome" the field gets the focus when `focusName` (a mouse, or a touch with an empty field: an
 * already saved name does not pop the phone's keyboard for nothing); a saved name comes selected, so typing replaces it.
 */
export function showEtapa(parts:EtapaParts,etapa:MenuEtapa,{focusName=true}:{focusName?:boolean}={}):void{
  parts.section.dataset.etapa=etapa;
  parts.row.hidden=etapa==='nome';
  parts.nameRow.hidden=etapa!=='nome';
  parts.label.textContent=confirmText(etapa,parts.convite);
  if(etapa==='nome'&&focusName){parts.input.focus({preventScroll:true});if(parts.input.value)parts.input.select?.();}
}

export const etapaOf=(parts:Pick<EtapaParts,'section'>):MenuEtapa=>parts.section.dataset.etapa==='nome'?'nome':'escolher';

/** The field's keys: Enter enters (not while an IME is composing), Escape goes back to choosing. */
export function nameKey(event:{key:string;isComposing?:boolean}):'entrar'|'voltar'|undefined{
  if(event.isComposing)return undefined;
  if(event.key==='Enter')return 'entrar';
  if(event.key==='Escape')return 'voltar';
  return undefined;
}
