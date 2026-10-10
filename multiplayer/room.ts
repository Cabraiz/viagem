import {DEFAULT_SEED} from '../src/game/terrain/field.ts';
import { Simulation, GRACE_MS, ROOM_PROTOCOL, ROOM_CLOSING_NOTICE, delta, type Snapshot } from '../src/game/net/shared.ts';
import {RunLifecycle,RUN_DURATION_TICKS} from '../src/game/net/run.ts';
import { classes } from '../src/classes.ts';

export type Peer={ send:(data:string)=>void; close:(code:number,reason:string)=>void };
/** offers: the pending-offer list (JSON) this peer last received, so each change is pushed once. */
type Connection={peer:Peer;playerId?:string;opened:number;window:number;count:number;seen:number;offers:string};
type Session={id:string;token:string;until:number};
export interface RoomOptions {
  /** Combat safety limit in server ticks (tests shorten it). */
  durationTicks?:number;
}
const classIds=new Set(classes.map(c=>c.id));
/** A room accepts connections for this long after creation (the Worker's alarm deletes it a minute later). */
export const ROOM_LIFETIME_MS=30*60_000;
/**
 * A new run only starts when the room still has this long to live: a full horde run takes ~13.7 min (plan §1).
 * Starting later would end with the room closing (4004) instead of a result. The 20 min tick cap stays a safety net.
 */
export const RUN_START_WINDOW_MS=15*60_000;
/** A run still going this close to the room's end is closed as a timeout, so the result always reaches the players. */
export const ROOM_CLOSING_MARGIN_MS=30_000;
/** Lives in shared.ts so the client can recognise it (VGM-043) without bundling the Room. */
export {ROOM_CLOSING_NOTICE};
/** Level ('lvl-<level>-<player>') or round ('rnd-<round>-<player>') offer id, optionally rerolled ('~<tick>'). */
export const OFFER_ID=/^(lvl|rnd)-\d+-[\w-]{1,40}(~\d+)?$/;
/** Offers carry at most four cards. */
const MAX_CHOICE_INDEX=3;
export class Room {
  sim:Simulation;
  readonly run:RunLifecycle;
  connections=new Map<Peer,Connection>();
  private sessions=new Map<string,Session>();
  private previous:Snapshot;
  readonly createdAt:number;
  constructor(createdAt=Date.now(),seed=DEFAULT_SEED,options:RoomOptions={}){
    this.createdAt=createdAt;this.sim=new Simulation(seed);
    this.run=new RunLifecycle(crypto.randomUUID(),options.durationTicks??RUN_DURATION_TICKS);
    this.previous=this.snapshot();
  }
  /** Last eventId broadcast to everyone: each event travels once (welcome may repeat a few; clients de-duplicate by eventId). */
  private sentEventId=-1;
  private snapshot():Snapshot{return {...this.sim.snapshot(this.sentEventId),run:this.run.snapshot()};}
  connect(peer:Peer,now=Date.now()){
    if(now-this.createdAt>ROOM_LIFETIME_MS){peer.close(4004,'Sala encerrada. Crie uma nova.');return;}
    if(this.connections.size>=12){peer.close(4008,'Muitas conexões.');return;}
    this.connections.set(peer,{peer,opened:now,window:now,count:0,seen:now,offers:'[]'});
  }
  receive(peer:Peer,raw:string,now=Date.now()){
    const c=this.connections.get(peer);if(!c)return;
    if(raw.length>1024){peer.close(1009,'Mensagem muito grande.');this.disconnect(peer,now);return;}
    if(now-c.window>=1000){c.window=now;c.count=0;}
    if(++c.count>45){peer.close(4008,'Limite de mensagens.');this.disconnect(peer,now);return;}
    let m:any;try{m=JSON.parse(raw);}catch{return;}
    if(!m||typeof m!=='object')return;
    c.seen=now;
    if(m.t==='join'&&!c.playerId){
      if(m.protocol!==ROOM_PROTOCOL){this.reject(peer,'Atualize a página para jogar nesta versão da partida.');return;}
      this.expire(now);
      let session:Session|undefined;
      if(m.token!==undefined){
        session=[...this.sessions.values()].find(s=>s.token===m.token);
        if(!session||session.until<now){this.reject(peer,'Sua sessão expirou. Entre novamente.');return;}
        if([...this.connections.values()].some(other=>other!==c&&other.playerId===session!.id)){this.reject(peer,'Personagem já conectado em outra aba.');return;}
        this.sim.setOnline(session.id,true);
      }else{
        if(typeof m.name!=='string'||m.name.trim().length<1||m.name.trim().length>20||/[\u0000-\u001f\u007f]/.test(m.name)||!classIds.has(m.classId)){this.reject(peer,'Nome ou classe inválidos.');return;}
        if(this.sim.players.size>=6){this.reject(peer,'Sala cheia. Máximo de seis jogadores.');return;}
        const id=crypto.randomUUID();session={id,token:crypto.randomUUID()+crypto.randomUUID(),until:Infinity};
        this.sim.add(id,m.name.trim(),m.classId);this.sessions.set(id,session);
      }
      session.until=Infinity;c.playerId=session.id;
      this.run.join(session.id);
      this.syncSpectators();
      peer.send(JSON.stringify({t:'welcome',id:session.id,token:session.token,state:this.snapshot()}));
      // A reconnecting player gets its pending offers right away instead of on the next broadcast tick.
      this.pushOffers(c);
      this.broadcast(true);return;
    }
    if(!c.playerId)return;
    if(m.t==='input'){const state=this.run.snapshot();if(state.phase==='combat'&&m.round===state.round)this.sim.input(c.playerId,m);}
    else if(m.t==='choose')this.choose(c,m);
    else if(m.t==='ready'&&typeof m.ready==='boolean'){
      if(m.ready&&!this.canStartRun(now)){this.notice(c,ROOM_CLOSING_NOTICE);return;}
      if(this.run.ready(c.playerId,m.round,m.ready)){this.syncSpectators();this.broadcast(true);}
    }
    else if(m.t==='rematch'){
      if(!this.canStartRun(now)){this.notice(c,ROOM_CLOSING_NOTICE);return;}
      if(this.run.rematch(c.playerId,m.round)){this.sim.resetRun();this.syncSpectators();this.broadcast(true);}
    }
    else if(m.t==='ping')peer.send(JSON.stringify({t:'pong',at:m.at}));
    else if(m.t==='leave'){this.sim.remove(c.playerId);this.run.leave(c.playerId);this.syncSpectators();this.sessions.delete(c.playerId);this.connections.delete(peer);peer.close(1000,'Saiu da sala.');this.broadcast(true);}
  }
  /**
   * Offer pick. Malformed, stale-round or out-of-combat commands are dropped silently; a command that reaches the
   * simulation (accepted, or refused there as forged, repeated or out of order) is answered with the peer's queue.
   */
  private choose(c:Connection,m:any){
    const state=this.run.snapshot();
    if(state.phase!=='combat'||m.round!==state.round)return;
    if(typeof m.offer!=='string'||!OFFER_ID.test(m.offer))return;
    if(!Number.isInteger(m.index)||m.index<0||m.index>MAX_CHOICE_INDEX)return;
    this.sim.choose(c.playerId!,m.offer,m.index);
    this.pushOffers(c,true);
  }
  /** Sends {t:'offers'} when this peer's pending offers changed since its last push (always, when forced). */
  private pushOffers(c:Connection,force=false){
    if(!c.playerId)return;
    const offers=this.sim.offers(c.playerId),json=JSON.stringify(offers);
    if(!force&&json===c.offers)return;
    c.offers=json;
    try{c.peer.send(JSON.stringify({t:'offers',offers}));}catch{this.disconnect(c.peer);}
  }
  /** True while the room has time left for a whole run (RUN_START_WINDOW_MS). */
  canStartRun(now=Date.now()){return this.createdAt+ROOM_LIFETIME_MS-now>=RUN_START_WINDOW_MS;}
  /** Non-fatal message for one peer (older clients ignore it; protocol 3 'error' would close the connection). */
  private notice(c:Connection,message:string){try{c.peer.send(JSON.stringify({t:'notice',message}));}catch{this.disconnect(c.peer);}}
  private reject(peer:Peer,message:string){peer.send(JSON.stringify({t:'error',message}));this.connections.delete(peer);peer.close(4003,message);}
  disconnect(peer:Peer,now=Date.now()){
    const c=this.connections.get(peer);this.connections.delete(peer);
    if(c?.playerId){this.sim.setOnline(c.playerId,false);this.run.setOnline(c.playerId,false);this.syncSpectators();const session=this.sessions.get(c.playerId);if(session)session.until=now+GRACE_MS;}
  }
  private syncSpectators(){for(const m of this.run.snapshot().members){const p=this.sim.players.get(m.id);if(p)p.spectator=m.spectator;}}
  expire(now:number){for(const s of this.sessions.values())if(s.until<now){this.sim.remove(s.id);this.run.leave(s.id);this.sessions.delete(s.id);}this.syncSpectators();}
  advance(now=Date.now()){
    for(const c of [...this.connections.values()]){
      if(now-this.createdAt>ROOM_LIFETIME_MS||(!c.playerId&&now-c.opened>5000)||now-c.seen>12000){this.disconnect(c.peer,now);c.peer.close(4004,'Conexão expirada.');}
    }
    this.expire(now);
    // Nobody left to play (the last participant's session expired; late arrivals are spectators): a defeat, not ~18 min of empty combat.
    if(this.run.snapshot().phase==='combat'&&!this.run.snapshot().members.some(m=>!m.spectator)){if(this.run.finish('defeat'))this.announce();}
    // The room is about to close: end the run now so the result is announced before the 4004.
    else if(this.run.snapshot().phase==='combat'&&now>=this.createdAt+ROOM_LIFETIME_MS-ROOM_CLOSING_MARGIN_MS){if(this.run.finish('timeout'))this.announce();}
    // The simulation steps before the lifecycle so a victory or defeat on this tick beats a same-tick timeout.
    if(this.run.snapshot().phase==='combat'){
      this.sim.step();
      const outcome=this.sim.outcome;
      if(outcome&&this.run.finish(outcome))this.announce();
      // A new horde round starts with a full snapshot so protocol-3 clients drop old enemy tombstones.
      else if(this.sim.world.round.index!==this.roundIndex){this.roundIndex=this.sim.world.round.index;this.broadcast(true);}
    }
    const transition=this.run.step();
    if(transition.started){this.sim.resetRun();this.roundIndex=this.sim.world.round.index;this.syncSpectators();this.broadcast(true);}
    if(transition.finished)this.announce();
    // Lobby/countdown/result also need snapshots even while simulation tick is frozen.
    if(++this.broadcastTick%2===0){
      this.broadcast(false);
      for(const c of [...this.connections.values()])this.pushOffers(c);
    }
  }
  private broadcastTick=0;
  /** Horde round (world.round.index) of the last full snapshot sent during combat. */
  private roundIndex=0;
  /** Runs once per run, right after RunLifecycle.finish accepted the outcome. */
  private announce(){
    const {outcome,resultId,round}=this.run.snapshot();
    this.broadcast(true);
    this.send({t:'result',outcome,resultId,round});
  }
  private send(message:object){
    const raw=JSON.stringify(message);
    for(const c of [...this.connections.values()])if(c.playerId){try{c.peer.send(raw);}catch{this.disconnect(c.peer);}}
  }
  private broadcast(full:boolean){
    const next=this.snapshot(),message=JSON.stringify(full?next:delta(this.previous,next));this.previous=next;
    const last=next.x?.events.at(-1);if(last)this.sentEventId=last.eventId;
    for(const c of [...this.connections.values()])if(c.playerId){try{c.peer.send(message);}catch{this.disconnect(c.peer);}}
  }
}
