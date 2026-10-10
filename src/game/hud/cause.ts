/**
 * "What got you" (UX-voce-e-dano f): the critter kind behind each fall, read from the `downed` event's `source`
 * (the sim names the kind) or, when a wire drops it, from the hitter's id (`by`) looked up in the live enemies or
 * among the latest kills. Pure (no DOM): the HUD banner and the result screen read it.
 */
import type {RunView} from '../sim/view.ts';

export const CAUSE_KINDS=['gosma','pernilongo','tio-pave','fiscal','chefe'] as const;
export type CauseKind=typeof CAUSE_KINDS[number];

/** One word (or name) for combat, and the joke that goes on the optional second line. */
export const CAUSE_COPY:Record<CauseKind|'bichos',{name:string;line:string}>={
  gosma:{name:'Gosma',line:'A gosma te abraçou forte demais'},
  pernilongo:{name:'Pernilongo',line:'O pernilongo picou até você deitar'},
  'tio-pave':{name:'Tio do Pavê',line:'O Tio do Pavê te venceu no trocadilho'},
  fiscal:{name:'Fiscal',line:'O fiscal te multou até o chão'},
  chefe:{name:'Síndico Supremo',line:'O Síndico Supremo te deu advertência'},
  bichos:{name:'Bichos',line:'Os bichos te pegaram de jeito'},
};
export const causeKind=(kind:string|undefined):CauseKind|undefined=>(CAUSE_KINDS as readonly string[]).includes(kind??'')?kind as CauseKind:undefined;
export const causeCopy=(kind:string|undefined)=>CAUSE_COPY[causeKind(kind)??'bichos'];

/**
 * Kinds of the latest enemy ids seen (live in a view or in a kill), to name a hitter that is already gone: one that died
 * on the tick it downed someone, or a fiscal whose shot lands after it died (the sim cannot name it then).
 */
export const KILL_MEMORY=1024;

export interface CauseLog {
  /** Kind of each player's latest fall ('bichos' when unknown). */
  last:Map<string,string>;
  /** Falls per player and kind. */
  counts:Map<string,Map<string,number>>;
  /** Recently seen enemies (views and kills): id → kind, oldest first, at most KILL_MEMORY. */
  kills:Map<string,string>;
}
export const emptyCauses=():CauseLog=>({last:new Map(),counts:new Map(),kills:new Map()});
export function resetCauses(log:CauseLog){log.last.clear();log.counts.clear();log.kills.clear();return log;}

/** Kind for a `downed` event: its `source`, else the hitter id in the view's enemies or among the recent kills. */
export function resolveCause(event:{source?:string;by?:string},view:Pick<RunView,'enemies'>,log:CauseLog):string{
  if(event.source)return event.source;
  if(event.by){
    const live=view.enemies.find(e=>e.id===event.by);
    if(live)return live.kind;
    const dead=log.kills.get(event.by);
    if(dead)return dead;
  }
  return 'bichos';
}

export function rememberKill(log:CauseLog,enemy:string,kind:string){
  log.kills.delete(enemy);log.kills.set(enemy,kind);
  while(log.kills.size>KILL_MEMORY)log.kills.delete(log.kills.keys().next().value as string);
}

/** Remembers the kind of enemies not seen before (the common case, an id already known, is one Map lookup). */
export function rememberEnemies(log:CauseLog,enemies:readonly {id:string;kind:string}[]){
  for(const e of enemies)if(!log.kills.has(e.id))rememberKill(log,e.id,e.kind);
}

export function recordFall(log:CauseLog,player:string,kind:string){
  log.last.set(player,kind);
  let counts=log.counts.get(player);
  if(!counts){counts=new Map();log.counts.set(player,counts);}
  counts.set(kind,(counts.get(kind)??0)+1);
}

/** Most frequent cause (ties: the latest fall wins) for one player, or for everyone when `player` is omitted. */
export function topCause(log:CauseLog,player?:string){
  const total=new Map<string,number>();
  for(const [id,counts] of log.counts)if(player===undefined||id===player)for(const [kind,n] of counts)total.set(kind,(total.get(kind)??0)+n);
  let best:string|undefined,count=0;
  const latest=player!==undefined?log.last.get(player):undefined;
  for(const [kind,n] of total)if(n>count||(n===count&&kind===latest)){best=kind;count=n;}
  return best?{kind:best,count}:undefined;
}

/** Result line: "Te derrubou: Gosma 2×" for the local player, or the team's top cause if they never fell. */
export function resultCause(log:CauseLog,localId:string){
  const own=topCause(log,localId);
  if(own)return {kind:own.kind,text:`Te derrubou: ${causeCopy(own.kind).name}${own.count>1?` ${own.count}×`:''}`};
  const team=topCause(log);
  if(team)return {kind:team.kind,text:`Derrubou a turma: ${causeCopy(team.kind).name}${team.count>1?` ${team.count}×`:''}`};
  return undefined;
}
