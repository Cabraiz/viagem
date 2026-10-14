/**
 * Menu music boot (NEW-20261014-ORQ-musica-do-menu): tiny and free of audio code, so the menu imports it statically
 * (menu-perf). After the page's load event, idle time and MENU_BOOT_DELAY_MS (the menu's own files and first frames go
 * first) it loads the audio chunk, which arms the music (client/audio/menu-music.ts: its priority:'low' download and the
 * first-gesture unlock). 2g/slow-2g or Save-Data: nothing at all, no chunk and no music file.
 */
export const MENU_BOOT_DELAY_MS=1500;
/** requestIdleCallback's timeout: a page that is never idle still gets the music. */
export const MENU_IDLE_TIMEOUT_MS=4000;
export interface Connection {effectiveType?:string;saveData?:boolean}
export const skipMenuMusic=(connection:Connection|undefined)=>
  !!connection&&(connection.saveData===true||connection.effectiveType==='2g'||connection.effectiveType==='slow-2g');

export interface MenuBootDeps {
  connection?:Connection;
  /** The load event already fired. */
  loaded:boolean;
  onLoad(fn:()=>void):void;
  idle(fn:()=>void):void;
  setTimer(fn:()=>void,ms:number):void;
  start():void;
}
/** Schedules start() (load -> idle -> delay); false when the connection skips it. */
export function scheduleMenuMusic(deps:MenuBootDeps):boolean{
  if(skipMenuMusic(deps.connection))return false;
  const later=()=>deps.idle(()=>deps.setTimer(()=>deps.start(),MENU_BOOT_DELAY_MS));
  if(deps.loaded)later();else deps.onLoad(later);
  return true;
}

export function startMenuMusic(win:Window=window){
  const idle=(fn:()=>void)=>typeof win.requestIdleCallback==='function'?win.requestIdleCallback(fn,{timeout:MENU_IDLE_TIMEOUT_MS}):win.setTimeout(fn,0);
  scheduleMenuMusic({
    connection:(win.navigator as {connection?:Connection}).connection,
    loaded:win.document.readyState==='complete',
    onLoad:fn=>win.addEventListener('load',fn,{once:true}),
    idle,
    setTimer:(fn,ms)=>win.setTimeout(fn,ms),
    start:()=>void import('../audio/menu-music.ts').then(m=>m.bootMenuMusic(win.document)).catch(()=>undefined),
  });
}
