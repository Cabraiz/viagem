/** Pure server-side lifecycle. Only Room may translate trusted simulation outcomes. */
import type {RunMember,RunOutcome,RunPhase,RunState,ShameMoment} from '../contract/index.ts';
export type {RunMember,RunOutcome,RunPhase,RunState} from '../contract/index.ts';
export const RUN_HZ=20;
/** Safety limit only: a full horde run (10 rounds, 30 s Stonewards intermissions and the boss) takes about 15 min. */
export const RUN_DURATION_TICKS=20*60*RUN_HZ;
export const RUN_COUNTDOWN_TICKS=3*RUN_HZ;
/**
 * Before a run, a member offline this long stops holding the start (VGM-047): the seat lasts the whole mobile grace,
 * but the others do not wait two minutes for a phone that went quiet. A drop still cancels a countdown at once; the
 * one who missed the start watches that run and plays the rematch.
 */
export const LOBBY_AWAY_TICKS=10*RUN_HZ;

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
  private owner?:string;
  private readonly roomId:string;
  private readonly durationTicks:number;
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
  step(shame?:ShameMoment):{started:boolean;finished:boolean}{
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
  /** This method accepts simulation output, never a client message. True exactly once per run (the first outcome wins). */
  finish(outcome:RunOutcome,shame?:ShameMoment){
    if(this.phase!=='combat')return false;
    this.phase='result';this.outcome=outcome;this.resultId=this.roomId+':'+this.round;this.shame=shame&&{...shame};
    for(const member of this.members.values())member.ready=!!member.bot;
    return true;
  }
  /** Guard with the round from the request so duplicate clicks cannot reset twice. */
  rematch(id:string,round:number){
    if(this.phase!=='result'||round!==this.round||!this.members.get(id)?.online)return false;
    this.round++;this.phase='lobby';this.elapsed=0;this.countdown=RUN_COUNTDOWN_TICKS;
    this.outcome=undefined;this.resultId=undefined;this.shame=undefined;
    for(const member of this.members.values()){member.ready=!!member.bot;member.spectator=false;}
    return true;
  }
  snapshot():RunState{
    return {round:this.round,phase:this.phase,elapsed:this.elapsed,
      remaining:this.phase==='countdown'?this.countdown:Math.max(0,this.durationTicks-this.elapsed),
      members:[...this.members.values()].map(m=>({...m})),outcome:this.outcome,resultId:this.resultId,
      ...(this.phase==='result'&&this.shame?{shame:{...this.shame}}:{}),...(this.owner?{owner:this.owner}:{})};
  }
}
