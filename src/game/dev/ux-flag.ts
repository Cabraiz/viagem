/**
 * The playtest metrics' switch (NEW-20261009-UX-playtest-metricas), apart from the metrics themselves so the game loads
 * only this when they are off: `dev/ux-metrics.ts` is imported on demand, only with `?dev=1`.
 * Also the "medir a turma" choice of this tab (sessionStorage: it ends with the tab) and the group label: a random tag,
 * never the room code, that the invite carries (`&dev=1&g=…`) so the friends' files join the same group.
 */
/** The page address flag: exactly `dev=1` (not `dev`, `dev=true` or `dev=0`). */
export const UX_FLAG={name:'dev',value:'1'} as const;
const GROUP=/^[a-z0-9]{6}$/,GROUP_KEY='viagem:ux-grupo',TEAM_KEY='viagem:ux-turma';
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const session=():Store|undefined=>{try{return globalThis.sessionStorage;}catch{return undefined;}};
/** This page's memory when sessionStorage is off. */
const memory:{group?:string;team?:boolean}={};

/** Whether the metrics are on for this page address (`location.search`). Never throws. */
export function uxMetricsEnabled(search:string|undefined):boolean{
  try{return new URLSearchParams(search??'').get(UX_FLAG.name)===UX_FLAG.value;}catch{return false;}
}
/** The group label: the invite's `g`, else this tab's own random one (made once, kept for the tab). */
export function groupLabel(search:string|undefined,store:Store|undefined=session()):string{
  try{const g=new URLSearchParams(search??'').get('g');if(g&&GROUP.test(g))return g;}catch{/* bad address: own label */}
  try{const g=store?.getItem(GROUP_KEY);if(g&&GROUP.test(g))return g;}catch{/* storage off */}
  if(!memory.group){let g='';for(let i=0;i<6;i++)g+='abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random()*36)];memory.group=g;}
  try{store?.setItem(GROUP_KEY,memory.group);}catch{/* memory only */}
  return memory.group;
}
/** "Medir a turma" (only with the flag on): the invites of this tab carry the flag and the group label. */
export function measuringTeam(store:Store|undefined=session()):boolean{
  try{const v=store?.getItem(TEAM_KEY);if(v!==null&&v!==undefined)return v==='1';}catch{/* storage off */}
  return !!memory.team;
}
export function setMeasuringTeam(on:boolean,store:Store|undefined=session()){
  memory.team=on;
  try{if(on)store?.setItem(TEAM_KEY,'1');else store?.removeItem(TEAM_KEY);}catch{/* memory only */}
}
/** What the invite link adds: `&dev=1&g=<label>` when the metrics are on and this tab measures the team, else ''. */
export function inviteQuery(search:string|undefined,store:Store|undefined=session()):string{
  return uxMetricsEnabled(search)&&measuringTeam(store)?`&${UX_FLAG.name}=${UX_FLAG.value}&g=${groupLabel(search,store)}`:'';
}
/** Test hook: forgets this page's memory. */
export function resetUxFlagMemory(){delete memory.group;delete memory.team;}
