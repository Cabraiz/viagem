/**
 * The match menu (card NEW-20261009-UX-menu-e-conexao): in a room the gear opens a menu, not the settings straight away.
 * "Continuar", "Configurações" (today's settings: camera, economy, sound, map), "Copiar convite" and "Sair da partida",
 * which asks first ("Seus amigos vão ficar com um a menos, certeza?"). The room never pauses: only this phone's thumbs
 * rest while the window is open (explore.ts pause), and the menu says so.
 * The menu lives inside explore.ts's `.explore-settings` dialog as a second view: `data-view` on the dialog picks the
 * menu, the settings or the exit confirmation (menu.css). Solo keeps the settings alone (no room to leave or invite to).
 * Its look is menu.css (explore.ts imports it; this module stays loadable by the node tests).
 * Also the connection's words for the HUD: "Voltou! O round tá no 4" after a drop (backOnline).
 */
import {icon} from '../ui/icon.ts';

/** The three views of the dialog in a room. */
export type MenuView='menu'|'settings'|'confirm';

export const MENU_TEXTS=Object.freeze({
  title:'Menu',
  settingsTitle:'Configurações',
  confirmTitle:'Sair da partida?',
  resume:'Continuar',
  settings:'Configurações',
  leave:'Sair da partida',
  /** Under the buttons: the room does not stop for this window. */
  live:'A turma segue no pau enquanto você tá aqui.',
  confirm:'Seus amigos vão ficar com um a menos, certeza?',
  stay:'Ficar',
  confirmLeave:'Sair',
  back:'Voltar ao menu',
  close:'Voltar ao jogo',
});

/** The dialog's heading for a view. */
export const menuTitle=(view:MenuView)=>view==='menu'?MENU_TEXTS.title:view==='settings'?MENU_TEXTS.settingsTitle:MENU_TEXTS.confirmTitle;

/**
 * Esc (the dialog's cancel) and the heading's back arrow: from the settings or the confirmation back to the menu; from
 * the menu out of the window (undefined).
 */
export const menuBack=(view:MenuView):MenuView|undefined=>view==='menu'?undefined:'menu';

/** A drop at least this long (the center banner's RECONNECT_BANNER_MS) earns the "Voltou!" row when the link is back. */
export const BACK_ONLINE_MIN_MS=1500;
/** How long the "Voltou!" row stays in the HUD's announcement slot. */
export const BACK_ONLINE_ROW_MS=3500;

/**
 * The row once the connection is back after a drop (card: "Voltou! O round tá no 4"). Only in combat, and only for a drop
 * the player could notice: one that lasted BACK_ONLINE_MIN_MS, or any drop around the app coming back from the background
 * (the frames stop while hidden, so that drop looks short from here). Undefined: nothing to say.
 */
export function backOnline(input:{downMs:number;cameBack:boolean;phase?:string;round?:number}):string|undefined{
  if(input.phase!=='combat')return undefined;
  if(input.downMs<BACK_ONLINE_MIN_MS&&!input.cameBack)return undefined;
  const round=Math.max(1,Math.floor(input.round??1));
  return `Voltou! O round tá no ${round}`;
}

/** The app came back from the background this recently (ms): a drop ending now counts as noticed (BackOnlineWatch). */
export const WAKE_WINDOW_MS=10_000;

/**
 * Follows the link frame by frame (explore.ts) and says when the "Voltou!" row is due: `frame` with the link's state, and
 * `wake` when the page becomes visible again (a drop ending within WAKE_WINDOW_MS of it counts whatever its length: the
 * frames stop while hidden, and the stale socket is often dropped only after the first visible frames).
 */
export class BackOnlineWatch {
  private downAt:number|undefined;private wokeAt:number|undefined;
  wake(now:number){this.wokeAt=now;}
  /** The row's text on the frame the link comes back, else undefined. */
  frame(connected:boolean,now:number,run?:{phase?:string;round?:number}):string|undefined{
    if(!connected){this.downAt??=now;return undefined;}
    if(this.downAt===undefined)return undefined;
    const cameBack=this.wokeAt!==undefined&&now-this.wokeAt<=WAKE_WINDOW_MS;
    const text=backOnline({downMs:now-this.downAt,cameBack,phase:run?.phase,round:run?.round});
    this.downAt=undefined;if(cameBack)this.wokeAt=undefined;
    return text;
  }
}

export interface GameMenuOptions {
  /** "Continuar": close the window, back to the game. */
  onResume():void;
  /** "Sair da partida" confirmed: leave the room (once; the menu locks itself after). */
  onLeave():void;
  /** The view changed (the caller moves the focus, the dialog's heading follows). */
  onView?(view:MenuView):void;
}

export interface GameMenu {
  /** The menu's own view (status line, buttons, the live line). */
  el:HTMLElement;
  /** The exit confirmation's view. */
  confirm:HTMLElement;
  /** Where the caller puts its status line (the room code and the connection) and its invite button. */
  status:HTMLElement;
  /** The slot right after "Configurações", for the invite button. */
  invite:HTMLElement;
  readonly view:MenuView;
  show(view:MenuView):void;
  /** The left button of the heading (back to the menu), shown out of the menu view. */
  back:HTMLButtonElement;
}

/**
 * Builds the menu inside `dialog` (explore.ts's `.explore-settings`): the heading's back arrow, the menu and the
 * confirmation before `content` (today's settings, shown in the 'settings' view). `heading` is the dialog's h2.
 */
export function createGameMenu(dialog:HTMLElement,heading:HTMLElement,content:HTMLElement,options:GameMenuOptions):GameMenu{
  const doc=dialog.ownerDocument;
  dialog.classList.add('game-menu-host');
  const back=doc.createElement('button');back.type='button';back.className='game-menu-back';back.setAttribute('aria-label',MENU_TEXTS.back);
  back.innerHTML=icon('voltar',{size:32});
  heading.before(back);
  const el=doc.createElement('div');el.className='game-menu';
  el.innerHTML=`<div class="game-menu-status"></div>`
    +`<button type="button" class="game-menu-item game-menu-resume">${MENU_TEXTS.resume}</button>`
    +`<button type="button" class="game-menu-item game-menu-settings">${MENU_TEXTS.settings}</button>`
    +`<div class="game-menu-invite"></div>`
    +`<button type="button" class="game-menu-item game-menu-leave">${MENU_TEXTS.leave}</button>`
    +`<p class="game-menu-live">${MENU_TEXTS.live}</p>`;
  const confirm=doc.createElement('div');confirm.className='game-menu-confirm';confirm.setAttribute('role','group');confirm.setAttribute('aria-labelledby','game-menu-confirm-text');
  confirm.innerHTML=`<p id="game-menu-confirm-text" class="game-menu-confirm-text">${MENU_TEXTS.confirm}</p>`
    +`<div class="game-menu-confirm-actions"><button type="button" class="game-menu-item game-menu-stay">${MENU_TEXTS.stay}</button>`
    +`<button type="button" class="game-menu-item game-menu-confirm-leave">${MENU_TEXTS.confirmLeave}</button></div>`;
  content.before(el,confirm);
  let view:MenuView='menu',left=false;
  const show=(next:MenuView)=>{
    view=next;dialog.dataset.view=next;
    heading.textContent=menuTitle(next);
    options.onView?.(next);
  };
  const q=<T extends HTMLElement>(root:HTMLElement,selector:string)=>root.querySelector<T>(selector)!;
  q(el,'.game-menu-resume').addEventListener('click',()=>options.onResume());
  q(el,'.game-menu-settings').addEventListener('click',()=>show('settings'));
  q(el,'.game-menu-leave').addEventListener('click',()=>show('confirm'));
  q(confirm,'.game-menu-stay').addEventListener('click',()=>show('menu'));
  // One leave per match: a second tap (or a tap during the window's close) does nothing.
  const leave=q<HTMLButtonElement>(confirm,'.game-menu-confirm-leave');
  leave.addEventListener('click',()=>{if(left)return;left=true;leave.disabled=true;options.onLeave();});
  back.addEventListener('click',()=>show(menuBack(view)??'menu'));
  show('menu');
  return {el,confirm,back,status:q(el,'.game-menu-status'),invite:q(el,'.game-menu-invite'),get view(){return view;},show};
}

/** Where the focus goes when a view opens: its first button (the settings: the heading's back arrow). */
export function menuFocus(menu:GameMenu):HTMLElement{
  if(menu.view==='menu')return menu.el.querySelector<HTMLElement>('.game-menu-resume')!;
  if(menu.view==='confirm')return menu.confirm.querySelector<HTMLElement>('.game-menu-stay')!;
  return menu.back;
}
