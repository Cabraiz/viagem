// The production smoke's verdict on "did it enter the match" (scripts/smoke-prod.mjs), pure so it is tested.
// Lots 061117 and 064511 failed a good build on a PC with 9 headless browsers ("não entrou em 120 s"): entering is
// judged by progress, not by a wall-clock deadline, and a failure is the MACHINE's (exit 2, retried once by CI; the
// queue holds the lot) only with both a starved page AND evidence from outside the page; everything else is the GAME's
// (exit 1), which always wins.

/** Hard cap of one entry; a stall is this long with nothing moving (the page nor the room). */
export const ENTER_CAP_MS=240000,STALL_MS=90000;
/** A page poll unanswered this long counts as no answer (a frozen page never hangs the smoke). */
export const EVAL_TIMEOUT_MS=10000;
/** The page's 200 ms probe timer: a page is starved when it fired under this share of its due fires over the window. */
export const PROBE_MS=200,FIRE_RATIO_MIN=.5;
/** Outside evidence: the smoke's own node event loop this late (p90), the local room this slow, more browsers than the PC's 2 slots. */
export const NODE_LAG_MS=100,ROOM_SLOW_MS=3000,BROWSERS_MAX=2;

/**
 * What the player sees and what the room does, as one string: when it changes, the entry is progressing. Only stable
 * texts: the round's label, never its clock (topbar's ETA ticks every second even in a stuck match).
 */
export const progressSignature=s=>JSON.stringify([s.stage,s.loading,s.ready,s.p0,s.bytes,s.count,s.roundLabel,s.roomPhase,s.roomTick]);

/**
 * Samples {wallMs, answered, fires?, dueFires?} of the last STALL_MS: the page is starved when most polls went unanswered
 * (timed out, not rejected: a reload's destroyed context is not starvation) or its probe timer fired under
 * FIRE_RATIO_MIN of the time. '' when it was not.
 */
export function pageStarved(trace,now){
  const tail=trace.filter(t=>t.wallMs>=now-STALL_MS);
  if(!tail.length)return '';
  const unanswered=tail.filter(t=>t.answered===false).length;
  if(unanswered*2>=tail.length)return `a página não respondeu (${unanswered} de ${tail.length} leituras)`;
  const fires=tail.reduce((s,t)=>s+(t.fires??0),0),due=tail.reduce((s,t)=>s+(t.dueFires??0),0);
  return due>0&&fires/due<FIRE_RATIO_MIN?`a página rodou ${Math.round(fires/due*100)} % do tempo`:'';
}

/** Evidence from outside the page that the machine was starved: '' when there is none. */
export function machineEvidence({nodeLagP90=0,roomMs,roomOk=true,browsers=0}){
  const out=[];
  if(nodeLagP90>NODE_LAG_MS)out.push(`o node do smoke atrasou ${Math.round(nodeLagP90)} ms`);
  if(roomMs!==undefined&&(!roomOk||roomMs>ROOM_SLOW_MS))out.push(`a sala local respondeu em ${roomMs} ms${roomOk?'':' (erro)'}`);
  if(browsers>BROWSERS_MAX)out.push(`${browsers} navegadores headless no PC (vagas: ${BROWSERS_MAX})`);
  return out.join('; ');
}

/**
 * One entry's result {why, errors, starved}: `starved` set only when the page was starved AND the machine shows it; then a
 * failure with no page error and no rejected chunk, only "não entrou", is the machine's.
 */
export const isMachine=r=>!!r.why&&!!r.starved&&!r.errors.length&&r.why.split(' | ').every(w=>w.startsWith('não entrou'));
/** The run's exit: 0 all passed; 1 as soon as one failure is the game's; 2 when every failure is the machine's. */
export function smokeExit(results){
  let code=0;
  for(const r of results){if(!r.why)continue;code=!isMachine(r)?1:code===0?2:code;}
  return code;
}
