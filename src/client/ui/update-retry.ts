/**
 * "Saiu versão nova" without the player stuck (BUG-20261024-ORQ-arrastar-atualiza-versao-nova). The rooms' Worker is
 * deployed before the site (worker-antes-do-site), so for a minute or two the rooms already refuse the old page while
 * the site still serves it: reloading then only brings the same old page back. Instead, the page asks /version.json
 * (no-store) every RETRY_S seconds, with a countdown on screen, and reloads by itself the moment the site's build is not
 * this page's. "Atualizar agora" reloads at once whatever the answer.
 * Pure: the clock, the fetch and the reload are injected (tests/client/update-retry.test.ts).
 */
// update-toast.ts lives in the entry chunk (main.ts imports it), so this adds no chunk edge.
import {UPDATE_NEWS} from './update-toast.ts';

/** Seconds between two asks while the site still serves this build. */
export const RETRY_S=10;
/** The window's lines (pt-BR): short, no "espera 1 minuto". */
export const UPDATE_TEXT={
  title:UPDATE_NEWS,
  checking:'Procurando a versão nova…',
  waiting:(s:number)=>`A versão nova ainda está saindo do forno. Tento de novo em ${s} s.`,
  reloading:'Achei! Atualizando…',
  button:'Atualizar agora',
} as const;

export type RetryState={kind:'checking'}|{kind:'waiting';seconds:number}|{kind:'reloading'};

export interface RetryDeps {
  /** This page's build (__BUILD_ID__). */
  current:string;
  /** The site's build now, undefined on any failure (version-watch.ts fetchBuildId). */
  fetchVersion():Promise<string|undefined>;
  /** The reload into the new build (update-toast.ts updateNow: resume saved, then reload). */
  reload():void;
  show(state:RetryState):void;
  setTimeout(handler:()=>void,ms:number):unknown;
  clearTimeout(id:unknown):void;
}

export interface UpdateRetry {
  /** Stops the asks (the panel went away or shows another message). */
  stop():void;
  readonly stopped:boolean;
}

/** The site serves another build: time to reload (a failed ask is not one). */
export const isNewBuild=(build:string|undefined,current:string)=>typeof build==='string'&&build!==''&&build!==current;

export function startUpdateRetry(deps:RetryDeps):UpdateRetry{
  let stopped=false,timer:unknown;
  const later=(ms:number,run:()=>void)=>{timer=deps.setTimeout(()=>{timer=undefined;if(!stopped)run();},ms);};
  const count=(seconds:number)=>{
    if(seconds<=0){void ask();return;}
    deps.show({kind:'waiting',seconds});
    later(1000,()=>count(seconds-1));
  };
  const ask=async()=>{
    deps.show({kind:'checking'});
    let build:string|undefined;
    try{build=await deps.fetchVersion();}catch{build=undefined;}
    if(stopped)return;
    if(isNewBuild(build,deps.current)){stopped=true;deps.show({kind:'reloading'});deps.reload();return;}
    count(RETRY_S);
  };
  void ask();
  return {
    stop(){stopped=true;if(timer!==undefined)deps.clearTimeout(timer);timer=undefined;},
    get stopped(){return stopped;},
  };
}

/** The line under the title for a state. */
export function retryLine(state:RetryState):string{
  return state.kind==='waiting'?UPDATE_TEXT.waiting(state.seconds):state.kind==='reloading'?UPDATE_TEXT.reloading:UPDATE_TEXT.checking;
}
