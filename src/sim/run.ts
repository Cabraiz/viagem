/** Pure server-side lifecycle. Only Room may translate trusted simulation outcomes. */
import type {ObjectiveResult,RunMember,RunOutcome,RunPhase,RunState,ShameMoment} from '../contract/index.ts';
export type {RunMember,RunOutcome,RunPhase,RunState} from '../contract/index.ts';
export const RUN_HZ=20;
/** Safety limit only: a full horde run (10 rounds, 30 s Stonewards intermissions and the boss) takes about 15 min. */
export const RUN_DURATION_TICKS=20*60*RUN_HZ;
/**
 * D-043: the city's combat cap. Its 10 rounds stretch for the walk and the crate intermissions: in the cidade-11 balance
 * the boss spawned at 15.6–21.9 sim minutes and runs ended by 22.2, so the endless map's 20 min cut them before the boss.
 * 30 min since cidade-escala-1-7 (D-043 amended): on the 1.7× city the runs that reach the boss end at 21.1–25.6 sim
 * minutes (bench 8 seeds, 1 and 6 players; 14.5–17.9 before), the longer walks and crate intermissions.
 */
export const CITY_RUN_DURATION_TICKS=30*60*RUN_HZ;
export const RUN_COUNTDOWN_TICKS=3*RUN_HZ;
/**
 * Before a run, a member offline this long stops holding the start (VGM-047): the seat lasts the whole mobile grace,
 * but the others do not wait two minutes for a phone that went quiet. A drop still cancels a countdown at once; the
 * one who missed the start watches that run and plays the rematch.
 * 45 s since sala-rede-ruim-e-convite (auditoria multijogador 7; 10 s before): the owner taps "Convidar" and goes to the
 * WhatsApp. Only a lost socket makes anyone offline (Room.disconnect), so a hidden tab whose socket lives is present
 * all along; but a phone freezes a page in the background, the room closes the silent socket after SILENT_MS (12 s)
 * and only then this count starts. 45 s covers ~1 min out of the app, with no new protocol; the others wait that much
 * for a phone that really dropped (a "ready" from them still starts nothing until it comes back or the count ends).
 */
export const LOBBY_AWAY_TICKS=45*RUN_HZ;
/**
 * The collective rematch (UX-resultado-revanche): it starts when every person online said "topa", or this long after the
 * first "topa" with a majority; who did not vote watches that run and plays the next.
 */
export const REMATCH_MAJORITY_TICKS=10*RUN_HZ;

export class RunLifecycle {
  private members=new Map<string,RunMember>();
  /** Ticks each member has been offline before a run (not on the wire). */
  private away=new Map<string,number>();
  private phase:RunPhase='lobby';
  private round=1;
  private elapsed=0;
  private countdown=RUN_COUNTDOWN_TICKS;
  private outcome?:RunOutcome;
  private resultId?:string;
  private shame?:ShameMoment;
  /** D-047: the chaveiro's bill of the run that just ended (RunState.objective, result only). */
  private objective?:ObjectiveResult;
  private owner?:string;
  /** Result only: who voted for the rematch, and ticks since the first vote. */
  private votes=new Set<string>();
  private voteTicks=0;
  private readonly roomId:string;
  private durationTicks:number;
  constructor(roomId:string,durationTicks=RUN_DURATION_TICKS){
    if(!roomId||!Number.isSafeInteger(durationTicks)||durationTicks<1)throw new Error('Invalid run configuration');
    this.roomId=roomId;this.durationTicks=durationTicks;
  }
  /**
   * A person joins (or comes back); `{bot:true}` seats a room bot (D-025): online and ready for good, and a player of
   * the coming run even during the countdown (the owner only adds bots out of combat).
   */
  join(id:string,options:{bot?:boolean}={}){
    const existing=this.members.get(id);
    if(existing){if(!existing.bot)this.setOnline(id,true);return;}
    if(!id||this.members.size>=6)throw new Error('Run has six slots');
    if(options.bot){this.members.set(id,{id,online:true,ready:true,spectator:this.phase==='combat',bot:true});this.refreshCountdown();return;}
    this.members.set(id,{id,online:true,ready:false,spectator:this.phase==='combat'||this.phase==='countdown'});
  }
  /** Who the room says owns it (Room decides; the lifecycle only carries it to the clients). */
  setOwner(id:string|undefined){this.owner=id;}
  setOnline(id:string,online:boolean){
    const member=this.members.get(id);if(!member||member.bot)return;
    member.online=online;
    if(online)this.away.delete(id);else this.away.set(id,0);
    if(!online&&this.phase!=='combat')member.ready=false;
    this.refreshCountdown();
  }
  leave(id:string){this.members.delete(id);this.away.delete(id);this.refreshCountdown();}
  ready(id:string,round:number,ready:boolean){
    const member=this.members.get(id);
    if(round!==this.round||!member?.online||member.spectator||member.bot||this.phase==='combat'||this.phase==='result')return false;
    member.ready=ready;this.refreshCountdown();return true;
  }
  /**
   * The room switched maps in the lobby (D-026/D-035): every person says ready again, so nobody starts on a map they
   * have not seen. Bots stay ready (they always are); a countdown that was going falls back to the lobby.
   */
  resetReady(){
    for(const member of this.members.values())if(!member.bot)member.ready=false;
    this.refreshCountdown();
  }
  /** Who the start waits for: in the run, and online or only briefly away (LOBBY_AWAY_TICKS). */
  private candidates(){return [...this.members.values()].filter(m=>!m.spectator&&(m.online||(this.away.get(m.id)??0)<LOBBY_AWAY_TICKS));}
  private refreshCountdown(){
    if(this.phase!=='lobby'&&this.phase!=='countdown')return;
    const players=this.candidates();
    // Bots are always ready: a start needs at least one person who said so.
    const allReady=players.some(p=>!p.bot)&&players.every(p=>p.online&&p.ready);
    if(allReady&&this.phase==='lobby'){this.phase='countdown';this.countdown=RUN_COUNTDOWN_TICKS;}
    else if(!allReady&&this.phase==='countdown'){
      this.phase='lobby';this.countdown=RUN_COUNTDOWN_TICKS;
      // A cancelled start admits late arrivals into the lobby's next ready check.
      for(const member of this.members.values())member.spectator=false;
    }
  }
  /** One call per server tick, independent of packet arrivals or rendering rate. `shame` goes with a timeout result. */
  step(shame?:ShameMoment):{started:boolean;finished:boolean;rematch?:true}{
    if(this.phase==='result'&&this.votes.size){
      this.voteTicks++;
      if(this.settleVotes())return {started:false,finished:false,rematch:true};
    }
    if(this.phase==='lobby'||this.phase==='countdown'){
      let crossed=false;
      for(const m of this.members.values())if(!m.online){const n=(this.away.get(m.id)??0)+1;this.away.set(m.id,n);crossed||=n===LOBBY_AWAY_TICKS;}
      if(crossed)this.refreshCountdown();
    }
    if(this.phase==='countdown'){
      if(--this.countdown===0){
        this.phase='combat';this.elapsed=0;
        // Away at the start: they watch this run (their seat stays) and play the rematch.
        for(const m of this.members.values())if(!m.online)m.spectator=true;
        return {started:true,finished:false};
      }
    }else if(this.phase==='combat'){
      this.elapsed++;
      if(this.elapsed>=this.durationTicks)return {started:false,finished:this.finish('timeout',shame)};
    }
    return {started:false,finished:false};
  }
  /**
   * A restarted room resumes a checkpointed run (E5-checkpoint-por-round): straight into combat, with the run's round
   * (the number clients echo) and elapsed ticks, from the lobby only, members already joined. Members listed in
   * `spectators`, and members the checkpoint never knew (`players` given and not in it), watch. False, unchanged, when
   * not in the lobby or the numbers are off (elapsed past the combat cap included).
   */
  resume(run:{round:number;elapsed:number;spectators:readonly string[]},players?:ReadonlySet<string>){
    if(this.phase!=='lobby'||!Number.isSafeInteger(run.round)||run.round<1||!Number.isSafeInteger(run.elapsed)||run.elapsed<0||run.elapsed>=this.durationTicks)return false;
    const watching=new Set(run.spectators);
    this.phase='combat';this.round=run.round;this.elapsed=run.elapsed;this.countdown=RUN_COUNTDOWN_TICKS;
    this.outcome=undefined;this.resultId=undefined;this.shame=undefined;this.objective=undefined;
    for(const m of this.members.values()){m.spectator=watching.has(m.id)||!!players&&!players.has(m.id);m.ready=!m.spectator;}
    return true;
  }
  /** The map's combat cap (D-043), set while the map changes in the lobby; never during a match. */
  setDurationTicks(ticks:number){
    if(this.phase==='combat'||!Number.isSafeInteger(ticks)||ticks<1)return false;
    this.durationTicks=ticks;return true;
  }
  /** This method accepts simulation output, never a client message. True exactly once per run (the first outcome wins). */
  finish(outcome:RunOutcome,shame?:ShameMoment){
    if(this.phase!=='combat')return false;
    this.phase='result';this.outcome=outcome;this.resultId=this.roomId+':'+this.round;this.shame=shame&&{...shame};this.objective=undefined;
    this.votes.clear();this.voteTicks=0;
    for(const member of this.members.values())member.ready=!!member.bot;
    return true;
  }
  /** D-047: the objective's bill for the result just decided (simulation output, never a client message); result phase only. */
  setObjective(result:ObjectiveResult|undefined){if(this.phase==='result')this.objective=result&&structuredClone(result);}
  /**
   * A "topa" for the rematch; the round from the request guards against a stale or repeated tap. True when it starts the
   * new run (every person online voted); otherwise the vote waits for the rest or for the majority (step).
   */
  rematch(id:string,round:number){
    const member=this.members.get(id);
    if(this.phase!=='result'||round!==this.round||!member?.online||member.bot||this.votes.has(id))return false;
    this.votes.add(id);
    return this.settleVotes();
  }
  /** People online in the result: the ones the rematch asks. */
  private voters(){return [...this.members.values()].filter(m=>m.online&&!m.bot);}
  private majority(){
    const voters=this.voters(),yes=voters.filter(m=>this.votes.has(m.id)).length;
    return {all:yes>0&&yes===voters.length,most:yes*2>voters.length};
  }
  /** Starts the rematch when everyone online voted, or the majority did and REMATCH_MAJORITY_TICKS went by. */
  private settleVotes(){
    const {all,most}=this.majority();
    if(!all&&!(most&&this.voteTicks>=REMATCH_MAJORITY_TICKS))return false;
    const voted=new Set(this.votes);
    this.round++;this.phase='lobby';this.elapsed=0;this.countdown=RUN_COUNTDOWN_TICKS;
    this.outcome=undefined;this.resultId=undefined;this.shame=undefined;this.objective=undefined;this.votes.clear();this.voteTicks=0;
    // Voters already said "topa": they are ready (the countdown starts at once); the rest watch that run, unless all voted.
    for(const member of this.members.values()){
      member.ready=!!member.bot||voted.has(member.id);
      member.spectator=!all&&!member.bot&&!voted.has(member.id);
    }
    this.refreshCountdown();
    return true;
  }
  snapshot():RunState{
    return {round:this.round,phase:this.phase,elapsed:this.elapsed,
      remaining:this.phase==='countdown'?this.countdown:Math.max(0,this.durationTicks-this.elapsed),
      members:[...this.members.values()].map(m=>({...m})),outcome:this.outcome,resultId:this.resultId,
      ...(this.phase==='result'&&this.shame?{shame:{...this.shame}}:{}),...(this.owner?{owner:this.owner}:{}),
      ...(this.phase==='result'&&this.objective?{objective:structuredClone(this.objective)}:{}),
      ...(this.phase==='result'?this.voteState():{})};
  }
  private voteState():Pick<RunState,'rematchVotes'|'rematchLeft'>{
    const votes=[...this.votes].filter(id=>this.members.get(id)?.online);
    return {rematchVotes:votes,...(this.votes.size&&this.majority().most?{rematchLeft:Math.max(0,REMATCH_MAJORITY_TICKS-this.voteTicks)}:{})};
  }
}
