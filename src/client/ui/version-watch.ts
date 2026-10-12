/**
 * Notices a new deploy while the page is open. GitHub Pages replaces the whole site on every deploy, so an old tab
 * either fetches a different /version.json or gets a 404 on a hashed chunk. Outside a match the page reloads by
 * itself; inside a match it only shows the tap-to-update UI (never reloads mid-match without the tap).
 * Pure: no DOM at import time, everything injected (tests/client/version-watch.test.ts).
 */

export const VERSION_URL='/version.json';
/** Poll while visible; also checked on visibilitychange→visible and on focus. */
export const POLL_MS=60_000;
/** sessionStorage {target:string,at:number}: the last automatic reload, so a stale cache cannot loop. */
export const RELOAD_GUARD_KEY='viagem:version-reload';
/** Never reload twice automatically for the same target within this window. */
/** Automatic reloads a tab may do within RELOAD_GUARD_MS, whatever the targets (anti-loop for a flipping version). */
export const MAX_AUTO_RELOADS=2;
/** Window focus checks at most this often (polling and visibilitychange are not throttled). */
export const FOCUS_CHECK_MS=10_000;
export const RELOAD_GUARD_MS=5*60_000;
/** Storage key (sessionStorage or localStorage) with a poll interval in ms: turns the watch on in dev builds (e2e). */
export const POLL_OVERRIDE_KEY='viagem:version-poll-ms';

export type UpdateReason='version'|'chunk';
type Storage={getItem(k:string):string|null;setItem(k:string,v:string):void;removeItem(k:string):void};

export interface VersionWatchDeps {
  /** __BUILD_ID__ */
  current:string;
  /** GET VERSION_URL?t=<now> no-store → build, or undefined on any failure (offline/404/garbage). See fetchBuildId. */
  fetchVersion:()=>Promise<string|undefined>;
  /** True in countdown/combat or the solo island; false in menu, lobby dialog, waiting room, result. */
  inMatch:()=>boolean;
  reload:()=>void;
  storage?:Storage;
  /** False when the browser knows it is offline: a failed chunk is then the network, not a deploy (no reload into an error page). */
  online?:()=>boolean;
  now?:()=>number;
  /** Show the tap-to-update UI (in a match, or when the guard forbids another automatic reload). Called once. */
  onAvailable:(reason:UpdateReason)=>void;
  /** Save where to come back after the reload (resume). */
  beforeReload?:()=>void;
}

export interface VersionWatch {
  /** True when a different build was seen (then handles it). */
  check():Promise<boolean>;
  /** True when e is a chunk error (then handles it); callers fall back to their own message otherwise. */
  chunkFailed(e:unknown):boolean;
  /** The phase left the match: if an update is pending and allowed, reload now (with beforeReload). */
  matchEnded():void;
  /** The tap: beforeReload + reload (the guard is recorded, but a tap always reloads). */
  update():void;
  /** True once a reload is underway: callers may skip cleanup that would lose the room seat. */
  readonly reloading:boolean;
  readonly pending:UpdateReason|undefined;
}

// Chrome, Firefox, Safari messages of a failed dynamic import, Chrome's MIME complaint when the 404 page is HTML,
// and Vite's own CSS preload error (the vite:preloadError payload).
const CHUNK_ERROR=[
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /expected a javascript(-or-wasm)? module script/i,
  /unable to preload css/i,
];

export function isChunkLoadError(e:unknown):boolean{
  let message:unknown;
  if(typeof e==='string')message=e;
  else if(e!==null&&typeof e==='object'){
    try{message=(e as {message?:unknown}).message;}catch{return false;}
  }
  return typeof message==='string'&&CHUNK_ERROR.some(re=>re.test(message as string));
}

/** The default fetchVersion: cache:'no-store' plus a ?t= buster (Pages serves everything with max-age=600). */
export async function fetchBuildId(fetchImpl:(url:string,init:RequestInit)=>Promise<Response>=(u,i)=>fetch(u,i),now:()=>number=Date.now,url:string=VERSION_URL):Promise<string|undefined>{
  try{
    const response=await fetchImpl(`${url}?t=${now()}`,{cache:'no-store'});
    if(!response.ok)return undefined;
    const body:unknown=await response.json();
    const build=body!==null&&typeof body==='object'?(body as {build?:unknown}).build:undefined;
    return typeof build==='string'&&build.length>0&&build.length<=100?build:undefined;
  }catch{return undefined;}
}

export function createVersionWatch(deps:VersionWatchDeps):VersionWatch{
  const now=deps.now??Date.now;
  let pending:UpdateReason|undefined;
  let pendingTarget:string|undefined;
  let reloading=false;
  let inflight:Promise<boolean>|undefined;

  /**
   * Automatic reloads of this tab within RELOAD_GUARD_MS, by target: {targets:{[target]:at}}. A version that flips
   * back and forth (rollback, CDN edges disagreeing) must not loop: each target reloads once per window, and the
   * whole tab at most MAX_AUTO_RELOADS times; past that the toast asks for the tap. Reads the older {target,at} too.
   */
  const readGuard=():Record<string,number>=>{
    const out:Record<string,number>=Object.create(null);
    try{
      const raw=deps.storage?.getItem(RELOAD_GUARD_KEY);
      if(!raw)return out;
      const value=JSON.parse(raw) as {target?:unknown;at?:unknown;targets?:unknown};
      if(typeof value?.target==='string'&&typeof value.at==='number')out[value.target]=value.at;
      const targets=value?.targets;
      if(targets&&typeof targets==='object')for(const [key,at] of Object.entries(targets as Record<string,unknown>))
        if(typeof at==='number'&&Number.isFinite(at))out[key]=at;
    }catch{/* unreadable guard: start over */}
    const t=now();
    for(const key of Object.keys(out)){const age=t-out[key];if(!(age>=0&&age<RELOAD_GUARD_MS))delete out[key];}
    return out;
  };
  const blocked=(target:string)=>{
    const guard=readGuard();
    return target in guard||Object.keys(guard).length>=MAX_AUTO_RELOADS;
  };
  const doReload=(target:string|undefined)=>{
    reloading=true;
    if(target!==undefined){
      const guard=readGuard();guard[target]=now();
      try{deps.storage?.setItem(RELOAD_GUARD_KEY,JSON.stringify({targets:guard}));}catch{/* storage off: no guard */}
    }
    try{deps.beforeReload?.();}catch{/* resume is best effort; the reload still happens */}
    deps.reload();
  };
  const handle=(reason:UpdateReason,target:string)=>{
    if(reloading)return;
    pendingTarget=target;
    if(!deps.inMatch()&&!blocked(target)){doReload(target);return;}
    if(pending===undefined){pending=reason;deps.onAvailable(reason);}
  };

  return {
    check(){
      if(reloading||pending!==undefined)return Promise.resolve(true);
      inflight??=(async()=>{
        try{
          let build:string|undefined;
          try{build=await deps.fetchVersion();}catch{build=undefined;}
          if(typeof build!=='string'||build===''||build===deps.current)return false;
          handle('version',build);
          return true;
        }finally{inflight=undefined;}
      })();
      return inflight;
    },
    chunkFailed(e){
      if(!isChunkLoadError(e))return false;
      // Offline, a failed import is the network: the caller shows its own message; the 'online' event re-checks.
      if(deps.online?.()===false)return false;
      handle('chunk',`chunk:${deps.current}`);
      return true;
    },
    matchEnded(){
      if(reloading||pending===undefined||pendingTarget===undefined||blocked(pendingTarget))return;
      doReload(pendingTarget);
    },
    update(){
      doReload(pendingTarget??`chunk:${deps.current}`);
    },
    get pending(){return pending;},
    get reloading(){return reloading;},
  };
}

type Listener=(event:Event)=>void;
/** The slice of window the watch uses (the real window fits). */
export interface WatchWindow {
  addEventListener(type:string,listener:Listener):void;
  removeEventListener(type:string,listener:Listener):void;
  setInterval(handler:()=>void,timeout:number):number;
  clearInterval(id:number|undefined):void;
  readonly document:{readonly visibilityState:string;addEventListener(type:string,listener:Listener):void;removeEventListener(type:string,listener:Listener):void};
  readonly localStorage?:Storage;
  readonly sessionStorage?:Storage;
  readonly navigator?:{readonly onLine?:boolean};
}

const pollOverride=(stores:(Storage|undefined)[]):number|undefined=>{
  for(const store of stores){
    let raw:string|null|undefined;
    try{raw=store?.getItem(POLL_OVERRIDE_KEY);}catch{raw=undefined;}
    const ms=raw?Number(raw):NaN;
    if(Number.isFinite(ms)&&ms>0)return Math.max(100,ms);
  }
  return undefined;
};

/**
 * Wires the watch to the page: a poll every POLL_MS while visible, a check on visibilitychange→visible and on focus,
 * and Vite's 'vite:preloadError'. The guard defaults to win.sessionStorage. Off (inert watch) for dev builds ('dev-' ids) unless POLL_OVERRIDE_KEY is set.
 * The preload event is NOT preventDefault-ed: Vite would then resolve the import to undefined and the caller would
 * crash on a non-chunk TypeError; letting it reject means the caller's catch sees the chunk error and asks
 * chunkFailed again, which is idempotent (true, no second reload/toast).
 */
export function startVersionWatch(input:VersionWatchDeps&{win:WatchWindow}):VersionWatch&{stop():void}{
  const {win}=input;
  // Storage accessors throw when site data is blocked.
  const read=(key:'localStorage'|'sessionStorage'):Storage|undefined=>{try{return win[key];}catch{return undefined;}};
  // The guard falls back to localStorage when sessionStorage is blocked, so a broken session store cannot loop reloads.
  const deps:VersionWatchDeps={online:()=>{try{return win.navigator?.onLine!==false;}catch{return true;}},...input,storage:input.storage??read('sessionStorage')??read('localStorage')};
  const override=pollOverride([deps.storage,read('localStorage')]);
  if(deps.current.startsWith('dev-')&&override===undefined){
    return {
      check:()=>Promise.resolve(false),
      chunkFailed:()=>false,
      matchEnded:()=>{},
      update:()=>{try{deps.beforeReload?.();}catch{/* best effort */}deps.reload();},
      pending:undefined,
      reloading:false,
      stop:()=>{},
    };
  }
  const watch=createVersionWatch(deps);
  const visible=()=>win.document.visibilityState==='visible';
  const checkNow=()=>{lastCheck=(deps.now??Date.now)();void watch.check();};
  let lastCheck=-Infinity;
  // A tab switch fires focus again and again: one check per FOCUS_CHECK_MS is plenty.
  const onFocus:Listener=()=>{if((deps.now??Date.now)()-lastCheck>=FOCUS_CHECK_MS)checkNow();};
  const onVisibility:Listener=()=>{if(visible())checkNow();};
  const onPreloadError:Listener=event=>{watch.chunkFailed((event as Event&{payload?:unknown}).payload);};
  const timer=win.setInterval(()=>{if(visible())checkNow();},override??POLL_MS);
  win.document.addEventListener('visibilitychange',onVisibility);
  win.addEventListener('focus',onFocus);
  win.addEventListener('online',checkNow);
  win.addEventListener('vite:preloadError',onPreloadError);
  return {
    check:()=>watch.check(),
    chunkFailed:e=>watch.chunkFailed(e),
    matchEnded:()=>watch.matchEnded(),
    update:()=>watch.update(),
    get pending(){return watch.pending;},
    get reloading(){return watch.reloading;},
    stop(){
      win.clearInterval(timer);
      win.document.removeEventListener('visibilitychange',onVisibility);
      win.removeEventListener('focus',onFocus);
      win.removeEventListener('online',checkNow);
      win.removeEventListener('vite:preloadError',onPreloadError);
    },
  };
}
