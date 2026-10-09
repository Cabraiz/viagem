/** Pure server-side lifecycle. Only Room may translate trusted simulation outcomes. */
export const RUN_HZ=20;
export const RUN_DURATION_TICKS=10*60*RUN_HZ;
export const RUN_COUNTDOWN_TICKS=3*RUN_HZ;
export type RunPhase='lobby'|'countdown'|'combat'|'result';
export type RunOutcome='victory'|'defeat'|'timeout';
export interface RunMember {id:string;online:boolean;ready:boolean;spectator:boolean}
export interface RunState {
  round:number;phase:RunPhase;elapsed:number;remaining:number;
  members:RunMember[];outcome?:RunOutcome;resultId?:string;
}

export class RunLifecycle {
  private members=new Map<string,RunMember>();
  private phase:RunPhase='lobby';
  private round=1;
  private elapsed=0;
  private countdown=RUN_COUNTDOWN_TICKS;
  private outcome?:RunOutcome;
  private resultId?:string;
  private readonly roomId:string;
  private readonly durationTicks:number;
  constructor(roomId:string,durationTicks=RUN_DURATION_TICKS){
    if(!roomId||!Number.isSafeInteger(durationTicks)||durationTicks<1)throw new Error('Invalid run configuration');
    this.roomId=roomId;this.durationTicks=durationTicks;
  }
  join(id:string){
    const existing=this.members.get(id);
    if(existing){this.setOnline(id,true);return;}
    if(!id||this.members.size>=6)throw new Error('Run has six slots');
    this.members.set(id,{id,online:true,ready:false,spectator:this.phase==='combat'||this.phase==='countdown'});
  }
  setOnline(id:string,online:boolean){
    const member=this.members.get(id);if(!member)return;
    member.online=online;
    if(!online&&this.phase!=='combat')member.ready=false;
    this.refreshCountdown();
  }
  leave(id:string){this.members.delete(id);this.refreshCountdown();}
  ready(id:string,round:number,ready:boolean){
    const member=this.members.get(id);
    if(round!==this.round||!member?.online||member.spectator||this.phase==='combat'||this.phase==='result')return false;
    member.ready=ready;this.refreshCountdown();return true;
  }
  private candidates(){return [...this.members.values()].filter(m=>!m.spectator);}
  private refreshCountdown(){
    if(this.phase!=='lobby'&&this.phase!=='countdown')return;
    const players=this.candidates();
    const allReady=players.length>0&&players.every(p=>p.online&&p.ready);
    if(allReady&&this.phase==='lobby'){this.phase='countdown';this.countdown=RUN_COUNTDOWN_TICKS;}
    else if(!allReady&&this.phase==='countdown'){
      this.phase='lobby';this.countdown=RUN_COUNTDOWN_TICKS;
      // A cancelled start admits late arrivals into the lobby's next ready check.
      for(const member of this.members.values())member.spectator=false;
    }
  }
  /** One call per server tick, independent of packet arrivals or rendering rate. */
  step():{started:boolean;finished:boolean}{
    if(this.phase==='countdown'){
      if(--this.countdown===0){this.phase='combat';this.elapsed=0;return {started:true,finished:false};}
    }else if(this.phase==='combat'){
      this.elapsed++;
      if(this.elapsed>=this.durationTicks)return {started:false,finished:this.finish('timeout')};
    }
    return {started:false,finished:false};
  }
  /** This method accepts simulation output, never a client message. */
  finish(outcome:RunOutcome){
    if(this.phase!=='combat')return false;
    this.phase='result';this.outcome=outcome;this.resultId=this.roomId+':'+this.round;
    for(const member of this.members.values())member.ready=false;
    return true;
  }
  /** Guard with the round from the request so duplicate clicks cannot reset twice. */
  rematch(id:string,round:number){
    if(this.phase!=='result'||round!==this.round||!this.members.get(id)?.online)return false;
    this.round++;this.phase='lobby';this.elapsed=0;this.countdown=RUN_COUNTDOWN_TICKS;
    this.outcome=undefined;this.resultId=undefined;
    for(const member of this.members.values()){member.ready=false;member.spectator=false;}
    return true;
  }
  snapshot():RunState{
    return {round:this.round,phase:this.phase,elapsed:this.elapsed,
      remaining:this.phase==='countdown'?this.countdown:Math.max(0,this.durationTicks-this.elapsed),
      members:[...this.members.values()].map(m=>({...m})),outcome:this.outcome,resultId:this.resultId};
  }
}
