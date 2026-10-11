import {DEFAULT_SEED,type WorldKind} from '../src/game/terrain/field.ts';
import { Simulation, DEFAULT_WORLD, GRACE_MS, ROOM_PROTOCOL, ROOM_CLOSING_NOTICE, restartedNotice, REPLACED_MESSAGE, UPDATE_NEEDED, worldDescriptor } from '../src/game/net/shared.ts';
import {FrameEncoder,WireIds,SEND_EVERY,type FrameInput} from '../src/game/net/protocol4.ts';
import {RunLifecycle,RUN_DURATION_TICKS,RUN_HZ} from '../src/game/net/run.ts';
import { classes } from '../src/classes.ts';
import {createEnemy} from '../src/game/sim/enemies/catalog.ts';
import {walkable} from '../src/game/world.ts';
import {sha256Hex} from '../src/game/net/sha256.ts';
import {isRecipeId} from '../src/game/sim/stonewards/rules.ts';

/** Text frames are JSON control messages; binary frames are protocol 4 run frames (server -> client only). */
export type Peer={ send:(data:string|Uint8Array)=>void; close:(code:number,reason:string)=>void };
/**
 * offers: the pending-offer list (JSON) this peer last received, so each change is pushed once.
 * encoder: this client's protocol 4 encoder (VGM-042b), created on join; a reconnect gets a fresh one.
 */
type Connection={peer:Peer;playerId?:string;opened:number;window:number;count:number;seen:number;offers:string;encoder?:FrameEncoder;bytes:number;frames:number;received:number};
/** `hash` is sha256(token): storage only ever sees hashes; `token` is known in memory once issued or presented. */
type Session={id:string;hash:string;token?:string;until:number};
export interface RoomOptions {
  /** Combat safety limit in server ticks (tests shorten it). */
  durationTicks?:number;
  /** World of the room: DEFAULT_WORLD (the endless map) unless a test or the lab (LAB_WORLD=ilha) asks for the island. */
  world?:WorldKind;
  /**
   * Lab only (wrangler dev with ALLOW_LOCAL and LAB_HORDE): keeps this many critters chasing the players and keeps the
   * players standing, to measure a full horde (bytes/s, tick and encode cost) without playing ten rounds.
   */
  labHorde?:number;
  /**
   * Lab only (wrangler dev with ALLOW_LOCAL and LAB_OFFSET "x,y"): each run starts this far from the base, to look at
   * the map 100 or 3 000 units out (terreno-em-blocos prints) without walking there.
   */
  labOffset?:{x:number;y:number};
  /** Lab only (wrangler dev with ALLOW_LOCAL): keep per-tick and per-frame time samples for the /lab percentiles. */
  lab?:boolean;
  /**
   * VGM-047: called (at most once per receive/advance) when the roster changed, so the Durable Object can keep it in
   * storage (one row) and a restarted object can seat everyone again. See RoomRoster.
   */
  onRoster?:(roster:RoomRoster)=>void;
}
/**
 * What survives a restart of the Durable Object (deploy, eviction, crash), VGM-047. Not the run: the policy is to
 * end it honestly (D-024, proposed), so only who sits in the room and where the room was.
 */
export interface RoomRoster {
  v:2;
  /** A run was in combat (its loss is announced after a restart), and how far it got. */
  running:boolean;lost?:{round:number;level:number};
  /** tokenHash = sha256(token); until = seat expiry of an offline player (null: connected when saved). */
  players:{id:string;name:string;classId:string;tokenHash:string;until:number|null}[];
}
const classIds=new Set(classes.map(c=>c.id));
/** A room accepts connections for this long after creation (the Worker's alarm deletes it a minute later). */
export const ROOM_LIFETIME_MS=30*60_000;
/**
 * A new run only starts when the room still has this long to live: a full horde run took ~13.7 min (plan §1); the
 * Stonewards intermissions of 30 s (VGM-046B) add ~1.5 min and the horn may stretch them by 90 s in all
 * (MAX_STRETCH_PER_RUN). The worst case on paper (every round to its timeout, every stretch, boss at its nominal 90 s)
 * is 16.6 min, so 18 (tests/sim-stonewards.test.ts). Starting later would end with the room closing (4004) instead of a
 * result. The 20 min tick cap stays a safety net.
 */
export const RUN_START_WINDOW_MS=18*60_000;
/** A run still going this close to the room's end is closed as a timeout, so the result always reaches the players. */
export const ROOM_CLOSING_MARGIN_MS=30_000;
/** Lives in shared.ts so the client can recognise it (VGM-043) without bundling the Room. */
export {ROOM_CLOSING_NOTICE};
/** Answer to a join with another room protocol (an old tab after a release): readable, and the old client stops retrying. */
export const VERSION_REFUSED=UPDATE_NEEDED;
/** Level ('lvl-<level>-<player>') or round ('rnd-<round>-<player>') offer id, optionally rerolled ('~<tick>'). */
export const OFFER_ID=/^(lvl|rnd)-\d+-[\w-]{1,40}(~\d+)?$/;
/** Offers carry at most four cards. */
const MAX_CHOICE_INDEX=3;
/** Room ticks between WireIds.prune calls (ids of entities gone for good). */
const PRUNE_EVERY=RUN_HZ;
/** Tick durations kept for the lab report (one minute at 20 Hz). */
const PERF_SAMPLES=1200;
/** Server-side cost of the room, for the lab (wrangler dev): tick and encode times, frames and bytes sent. */
export interface RoomPerf {ticks:number;tickMs:number;maxTickMs:number;encodeMs:number;frames:number;bytes:number;jsonBytes:number;rosterWrites:number;samples:number[];encodeSamples:number[]}
export class Room {
  sim:Simulation;
  readonly run:RunLifecycle;
  connections=new Map<Peer,Connection>();
  private sessions=new Map<string,Session>();
  /** One per room (D-018): every encoder maps server ids to the same wire ids; reset with each new run. */
  readonly ids=new WireIds();
  readonly createdAt:number;
  readonly perf:RoomPerf={ticks:0,tickMs:0,maxTickMs:0,encodeMs:0,frames:0,bytes:0,jsonBytes:0,rosterWrites:0,samples:[],encodeSamples:[]};
  /** Room ticks (advance calls), also while the simulation is frozen in the lobby: the broadcast slots follow it. */
  private ticks=0;
  private readonly labHorde:number;
  private readonly labOffset?:{x:number;y:number};
  /** Time samples (lab only): the deployed room keeps the running totals, never the arrays. */
  private readonly sampling:boolean;
  /** RunState last pushed as {t:'run'}, without the per-tick counters (clients count elapsed from frame ticks). */
  private runKey='';
  private readonly onRoster?:(roster:RoomRoster)=>void;
  /** Roster as last handed to onRoster (JSON), so only real changes are written. */
  private rosterKey='';
  /** Restored after a restart that cut a run: these players still have to hear why they are back in the lobby. */
  private lostRun=new Map<string,{round:number;level:number}>();
  constructor(createdAt=Date.now(),seed=DEFAULT_SEED,options:RoomOptions={}){
    this.createdAt=createdAt;this.sim=new Simulation(seed,{world:options.world??DEFAULT_WORLD});
    this.labHorde=Math.max(0,Math.min(600,Math.floor(options.labHorde??0)));
    const o=options.labOffset;if(o&&Number.isFinite(o.x)&&Number.isFinite(o.y)&&(o.x||o.y))this.labOffset={x:o.x,y:o.y};this.sampling=!!options.lab||this.labHorde>0;
    this.run=new RunLifecycle(crypto.randomUUID(),options.durationTicks??RUN_DURATION_TICKS);
    this.onRoster=options.onRoster;
  }
  /** Who sits in the room, whether a run is going and how far it got, for storage (token hashes only). */
  roster():RoomRoster{
    const running=this.run.snapshot().phase==='combat',w=this.sim.world;
    return {v:2,running,...(running?{lost:{round:w.round.index,level:w.team.level}}:{}),players:[...this.sim.players.values()].flatMap(p=>{
      const s=this.sessions.get(p.id);return s?[{id:p.id,name:p.name,classId:p.classId,tokenHash:s.hash,until:Number.isFinite(s.until)?s.until:null}]:[];
    })};
  }
  /**
   * A restarted Durable Object seats the stored roster again (VGM-047): same ids, token hashes and seat expiries
   * (a player already away keeps the grace it had; the ones connected at the restart get a fresh one), the room in
   * the lobby. A run that was going is lost, and each player is told what was lost when back (D-024).
   */
  restore(roster:RoomRoster,now=Date.now()){
    if(roster?.v!==2||!Array.isArray(roster.players))return;
    const lost=roster.running===true?{round:Number(roster.lost?.round)||0,level:Number(roster.lost?.level)||0}:undefined;
    for(const r of roster.players.slice(0,6)){
      if(typeof r?.id!=='string'||typeof r.tokenHash!=='string'||!/^[0-9a-f]{64}$/.test(r.tokenHash)||typeof r.name!=='string'||!classIds.has(r.classId)||this.sim.players.has(r.id))continue;
      const until=typeof r.until==='number'&&Number.isFinite(r.until)?r.until:now+GRACE_MS;
      if(until<now)continue;
      this.sim.add(r.id,r.name,r.classId);this.sessions.set(r.id,{id:r.id,hash:r.tokenHash,until});
      this.run.join(r.id);this.run.setOnline(r.id,false);this.sim.setOnline(r.id,false);
      if(lost)this.lostRun.set(r.id,lost);
    }
    this.syncSpectators();this.rosterKey=JSON.stringify(this.roster());this.rosterDirty=false;
  }
  /** Something stored in the roster changed (seat, expiry, combat start/end, round): flush at the end of this call. */
  private rosterDirty=false;
  private rosterRound=-1;
  /** Hands the roster to storage when it changed: one row each time. */
  private flushRoster(){
    if(!this.onRoster||!this.rosterDirty)return;
    this.rosterDirty=false;
    const roster=this.roster(),key=JSON.stringify(roster);
    if(key===this.rosterKey)return;
    this.rosterKey=key;this.perf.rosterWrites++;
    try{this.onRoster(roster);}catch{}
  }
  connect(peer:Peer,now=Date.now()){
    if(now-this.createdAt>ROOM_LIFETIME_MS){peer.close(4004,'Sala encerrada. Crie uma nova.');return;}
    if(this.connections.size>=12){peer.close(4008,'Muitas conexões.');return;}
    this.connections.set(peer,{peer,opened:now,window:now,count:0,seen:now,offers:'[]',bytes:0,frames:0,received:0});
  }
  receive(peer:Peer,raw:string,now=Date.now()){
    this.handle(peer,raw,now);this.flushRoster();
  }
  private handle(peer:Peer,raw:string,now:number){
    const c=this.connections.get(peer);if(!c)return;
    c.received++;
    if(raw.length>1024){peer.close(1009,'Mensagem muito grande.');this.disconnect(peer,now);return;}
    if(now-c.window>=1000){c.window=now;c.count=0;}
    if(++c.count>45){peer.close(4008,'Limite de mensagens.');this.disconnect(peer,now);return;}
    let m:any;try{m=JSON.parse(raw);}catch{return;}
    if(!m||typeof m!=='object')return;
    c.seen=now;
    if(m.t==='join'&&!c.playerId){
      if(m.protocol!==ROOM_PROTOCOL){this.reject(peer,VERSION_REFUSED);return;}
      this.expire(now);
      let session:Session|undefined;
      if(m.token!==undefined){
        const hash=typeof m.token==='string'&&m.token.length<=200?sha256Hex(m.token):'';
        session=[...this.sessions.values()].find(s=>s.hash===hash);
        if(!session||session.until<now){this.reject(peer,'Sua sessão expirou. Entre novamente.');return;}
        // The newest connection takes the character (BUG-20261009-N1-reconexao-socket-velho): a phone back from another
        // network while the room still holds its dead socket, or a second tab. The old one hears why and is closed with
        // 4009, which the client never retries, so two real tabs cannot keep knocking each other out.
        for(const other of [...this.connections.values()])if(other!==c&&other.playerId===session.id){
          this.connections.delete(other.peer);
          try{other.peer.send(JSON.stringify({t:'replaced',message:REPLACED_MESSAGE}));}catch{}
          try{other.peer.close(4009,'Personagem entrou por outra conexão.');}catch{}
        }
        this.sim.setOnline(session.id,true);session.token=m.token;
      }else{
        if(typeof m.name!=='string'||m.name.trim().length<1||m.name.trim().length>20||/[\u0000-\u001f\u007f]/.test(m.name)||!classIds.has(m.classId)){this.reject(peer,'Nome ou classe inválidos.');return;}
        if(this.sim.players.size>=6){this.reject(peer,'Sala cheia. Máximo de seis jogadores.');return;}
        const id=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID();session={id,hash:sha256Hex(token),token,until:Infinity};
        this.sim.add(id,m.name.trim(),m.classId);this.sessions.set(id,session);
      }
      session.until=Infinity;c.playerId=session.id;this.rosterDirty=true;
      this.run.join(session.id);
      this.syncSpectators();
      // A fresh encoder per connection (the client's decoder.reset() on welcome matches it), in the emptier slot.
      c.encoder=new FrameEncoder(this.ids,{viewer:session.id,slot:this.freeSlot(c)});
      const player=this.sim.players.get(session.id)!;
      this.sendJson(c,{t:'welcome',protocol:ROOM_PROTOCOL,id:session.id,token:session.token,ack:player.ack,tick:this.sim.tick,
        run:this.run.snapshot(),world:worldDescriptor(this.sim.terrain)});
      // The joiner sees the room at once (a full frame), not on its next broadcast slot.
      this.sendFrame(c,this.sim.frame());
      // A reconnecting player gets its pending offers right away instead of on the next broadcast tick.
      this.pushOffers(c);
      // Back after the room restarted in the middle of a run (VGM-047): say what happened, once.
      const lost=this.lostRun.get(session.id);
      if(lost){this.lostRun.delete(session.id);this.sendJson(c,{t:'notice',kind:'restarted',...restartedNotice(lost)});}
      this.pushRun();return;
    }
    if(!c.playerId)return;
    if(m.t==='input'){
      // Inputs carry the ack of the last frame (one message instead of two at 20 Hz).
      if(m.ack!==undefined)c.encoder?.ack(m.ack);
      const state=this.run.snapshot();
      if(state.phase==='combat'&&m.round===state.round){
        // Tap targets are client ids (e12); the simulation knows server ids. Unknown ones only drop the target.
        const target=(label:unknown)=>typeof label==='string'?this.ids.resolve(label):undefined;
        // input-10hz: change segments [from,x,y,flags,target?]; a legacy single step still works.
        if(Array.isArray(m.steps))this.sim.input(c.playerId,{seq:m.seq,steps:m.steps.map((w:unknown)=>Array.isArray(w)&&w.length===5?[...w.slice(0,4),...(target(w[4])!==undefined?[target(w[4])]:[])]:w)},now);
        else this.sim.input(c.playerId,{...m,target:target(m.target)},now);
      }
    }
    else if(m.t==='ack')c.encoder?.ack(m.seq);
    // Skill tap (input-10hz/E7): one-shot, answered with {t:'cast'} after the step that carries it.
    else if(m.t==='cast'){const state=this.run.snapshot();if(state.phase==='combat'&&m.round===state.round)this.sim.tap(c.playerId,m.id);}
    // The client lost its baselines (a frame failed to decode): next frame is full, unacked events go again.
    else if(m.t==='resync')c.encoder?.resync();
    else if(m.t==='choose')this.choose(c,m);
    else if(m.t==='forge')this.forge(c,m);
    else if(m.t==='ready'&&typeof m.ready==='boolean'){
      if(m.ready&&!this.canStartRun(now)){this.notice(c,ROOM_CLOSING_NOTICE);return;}
      if(this.run.ready(c.playerId,m.round,m.ready)){this.syncSpectators();this.pushRun();}
    }
    else if(m.t==='rematch'){
      if(!this.canStartRun(now)){this.notice(c,ROOM_CLOSING_NOTICE);return;}
      if(this.run.rematch(c.playerId,m.round)){this.resetRun();this.syncSpectators();this.pushRun();}
    }
    else if(m.t==='ping')this.sendJson(c,{t:'pong',at:m.at});
    else if(m.t==='leave'){this.rosterDirty=true;this.sim.remove(c.playerId);this.run.leave(c.playerId);this.syncSpectators();this.sessions.delete(c.playerId);this.connections.delete(peer);peer.close(1000,'Saiu da sala.');this.pushRun();}
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
  /**
   * Forge tap (VGM-046B): {t:'forge',round,recipe,req}. The simulation validates everything (phase, standing, in the
   * camp, team balance; `req` makes a resend apply once); the buyer hears {t:'forged',req,ok,reason?} at once, everyone
   * sees the balance in the next frame and the recipe's line as a `say` event.
   */
  private forge(c:Connection,m:any){
    const state=this.run.snapshot();
    if(state.phase!=='combat'||m.round!==state.round)return;
    if(!isRecipeId(m.recipe)||!Number.isSafeInteger(m.req)||m.req<1)return;
    const result=this.sim.forge(c.playerId!,m.recipe,String(m.req));
    this.sendJson(c,{t:'forged',req:m.req,recipe:m.recipe,ok:result.ok,...(result.ok?{}:{reason:result.reason})});
  }
  /** Sends {t:'offers'} when this peer's pending offers changed since its last push (always, when forced). */
  private pushOffers(c:Connection,force=false){
    if(!c.playerId)return;
    const offers=this.sim.offers(c.playerId),json=JSON.stringify(offers);
    if(!force&&json===c.offers)return;
    c.offers=json;
    this.sendJson(c,{t:'offers',offers});
  }
  /**
   * Run state as {t:'run',run,tick} to everyone, when anything but the per-tick counters changed (the countdown
   * once per second). In combat `elapsed`/`remaining` move one per simulation tick, so the client derives them
   * from the frame tick against `tick` here.
   */
  private pushRun(force=false){
    const run=this.run.snapshot();
    const key=JSON.stringify({...run,elapsed:0,remaining:run.phase==='countdown'?Math.ceil(run.remaining/RUN_HZ):0});
    if(!force&&key===this.runKey)return;
    this.runKey=key;
    this.send({t:'run',run,tick:this.sim.tick});
  }
  /** Broadcast slot with the fewest clients, so each tick encodes about half of them (sendSlot, rede-mapa-grande). */
  private freeSlot(except:Connection){
    const used=new Array<number>(SEND_EVERY).fill(0);
    for(const other of this.connections.values())if(other!==except&&other.encoder)used[other.encoder.slot]++;
    return used.indexOf(Math.min(...used));
  }
  /** True while the room has time left for a whole run (RUN_START_WINDOW_MS). */
  canStartRun(now=Date.now()){return this.createdAt+ROOM_LIFETIME_MS-now>=RUN_START_WINDOW_MS;}
  /** Non-fatal message for one peer (a client stops on 'error'; 'notice' only shows). */
  private notice(c:Connection,message:string){this.sendJson(c,{t:'notice',message});}
  /** Tells the peer why and closes it (4003: the client stops and forgets the token). */
  private reject(peer:Peer,message:string){peer.send(JSON.stringify({t:'error',message}));this.connections.delete(peer);peer.close(4003,message);}
  disconnect(peer:Peer,now=Date.now()){
    const c=this.connections.get(peer);this.connections.delete(peer);
    if(c?.playerId){this.rosterDirty=true;this.sim.setOnline(c.playerId,false);this.run.setOnline(c.playerId,false);this.syncSpectators();const session=this.sessions.get(c.playerId);if(session)session.until=now+GRACE_MS;}
  }
  private syncSpectators(){for(const m of this.run.snapshot().members){const p=this.sim.players.get(m.id);if(p)p.spectator=m.spectator;}}
  expire(now:number){for(const s of this.sessions.values())if(s.until<now){this.rosterDirty=true;this.sim.remove(s.id);this.run.leave(s.id);this.sessions.delete(s.id);}this.syncSpectators();}
  /** New run (start or rematch): fresh simulation run and fresh wire ids (server ids start over, D-018). */
  private resetRun(){
    this.sim.resetRun();this.ids.reset();
    const o=this.labOffset;if(!o)return;
    // Lab: the whole team moves out together, each onto the nearest walkable spot.
    for(const p of this.sim.players.values()){
      const at={x:p.x+o.x,y:p.y+o.y};
      for(let r=0;r<20&&!walkable(at,this.sim.terrain);r++){at.x+=.7;at.y+=.3;}
      p.x=at.x;p.y=at.y;
    }
  }
  advance(now=Date.now()){
    const started=performance.now();
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
      if(this.labHorde)this.fillHorde();
      const events=this.sim.step(now);
      // Skill taps: the owner hears at once whether its tap went off (the button never guesses, E7/N16).
      for(const cast of this.sim.casts)for(const c of this.connections.values())if(c.playerId===cast.id)this.sendJson(c,{t:'cast',seq:cast.seq,ok:cast.ok,readyTick:cast.readyTick});
      // Every encoder gets every tick's events while their ids are still known (D-018), sent or not this tick.
      for(const c of this.connections.values())c.encoder?.pushEvents(events);
      const outcome=this.sim.outcome;
      if(outcome&&this.run.finish(outcome))this.announce();
    }
    const transition=this.run.step();
    if(transition.started){this.resetRun();this.syncSpectators();}
    if(transition.finished)this.announce();
    if(++this.ticks%PRUNE_EVERY===0)this.prune();
    this.pushRun();
    // Lobby, countdown and result keep their frames too (the waiting room lists players from them).
    let input:FrameInput|undefined;
    for(const c of [...this.connections.values()]){
      if(!c.encoder||!c.encoder.due(this.ticks))continue;
      this.sendFrame(c,input??=this.sim.frame());
      this.pushOffers(c);
    }
    // Combat start/end and each new round go to storage (what a restart reports as lost).
    const round=this.run.snapshot().phase==='combat'?this.sim.world.round.index:-1;
    if(round!==this.rosterRound){this.rosterRound=round;this.rosterDirty=true;}
    this.flushRoster();
    this.measure(performance.now()-started);
  }
  /** Lab stress (labHorde): critters spawn 8–30 u around a random standing player, up to 25 per tick (and stragglers come back); nobody falls. */
  private fillHorde(){
    const w=this.sim.world,players=[...this.sim.players.values()].filter(p=>!p.spectator);
    if(!players.length)return;
    for(const p of players){p.invulnerableUntil=w.tick+40;if(p.downed){delete p.downed;p.hp=p.stats.maxHp;}}
    const kinds=['gosma','pernilongo','fiscal','tio-pave'];
    // A team that runs away (the 2-minute straight walk of terreno-em-blocos) keeps its 300: critters left over 40 u
    // behind every player come back 8–30 u around one, so the measure always has the whole horde near the screen.
    let moved=0;
    for(const e of w.enemies.values()){
      if(moved>=25)break;
      if(players.some(p=>(p.x-e.x)**2+(p.y-e.y)**2<1600))continue;
      const p=players[Math.floor(Math.random()*players.length)],a=Math.random()*Math.PI*2,d=8+Math.random()*22;
      const at={x:p.x+Math.cos(a)*d,y:p.y+Math.sin(a)*d};
      if(walkable(at,this.sim.terrain)){e.x=at.x;e.y=at.y;moved++;}
    }
    for(let n=0,tries=0;n<25&&tries<100&&w.enemies.size<this.labHorde;tries++){
      const p=players[Math.floor(Math.random()*players.length)],a=Math.random()*Math.PI*2,d=8+Math.random()*22;
      const at={x:p.x+Math.cos(a)*d,y:p.y+Math.sin(a)*d};
      if(!walkable(at,this.sim.terrain))continue;
      createEnemy(w,kinds[(w.tick+n)%kinds.length],at);n++;
    }
  }
  /** Lab report: tick and encode cost (p50/p95/max over the last minute) and bytes per connection. */
  lab(){
    const pct=(list:number[],q:number)=>{if(!list.length)return 0;const sorted=[...list].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(q*sorted.length))];};
    const {samples,encodeSamples,...totals}=this.perf;
    return {...totals,tick:this.sim.tick,phase:this.run.snapshot().phase,enemies:this.sim.world.enemies.size,
      tickP50:pct(samples,.5),tickP95:pct(samples,.95),encodeP50:pct(encodeSamples,.5),encodeP95:pct(encodeSamples,.95),
      connections:[...this.connections.values()].map(c=>({player:c.playerId,slot:c.encoder?.slot,frames:c.frames,bytes:c.bytes,received:c.received,
        pending:c.encoder?.pendingEvents,stats:c.encoder?.stats}))};
  }
  private measure(ms:number){
    const p=this.perf;p.ticks++;p.tickMs+=ms;p.maxTickMs=Math.max(p.maxTickMs,ms);
    if(this.sampling){p.samples.push(ms);if(p.samples.length>PERF_SAMPLES)p.samples.shift();}
  }
  /** Ids of entities gone for good leave the shared map (encoders keep their own baselines). */
  private prune(){
    const w=this.sim.world,ids=(m:Map<string,unknown>)=>m.keys();
    const st=this.sim.run.stonewards.state;
    this.ids.prune({enemies:ids(w.enemies),pickups:ids(w.pickups),projectiles:ids(w.projectiles),telegraphs:ids(w.telegraphs),
      structures:[st.wall.id,...st.towers.map(t=>t.id)],nodes:this.sim.nodeIds});
  }
  /** Runs once per run, right after RunLifecycle.finish accepted the outcome: the result state, then the result. */
  private announce(){
    const {outcome,resultId,round}=this.run.snapshot();
    this.pushRun(true);
    this.send({t:'result',outcome,resultId,round});
  }
  private sendFrame(c:Connection,input:FrameInput){
    // The owner sees itself at the last step it reported (input-10hz): its prediction replays only its own steps.
    const own=c.playerId?this.sim.confirmed(c.playerId):undefined;
    const view=own?{...input,players:input.players.map(p=>p.id===c.playerId?{...p,...own}:p)}:input;
    const started=performance.now(),bytes=c.encoder!.encode(view),ms=performance.now()-started;
    this.perf.encodeMs+=ms;
    if(this.sampling){this.perf.encodeSamples.push(ms);if(this.perf.encodeSamples.length>PERF_SAMPLES)this.perf.encodeSamples.shift();}
    this.perf.frames++;this.perf.bytes+=bytes.length;c.frames++;c.bytes+=bytes.length;
    try{c.peer.send(bytes);}catch{this.disconnect(c.peer);}
  }
  private sendJson(c:Connection,message:object){
    const raw=JSON.stringify(message);this.perf.jsonBytes+=raw.length;c.bytes+=raw.length;
    try{c.peer.send(raw);}catch{this.disconnect(c.peer);}
  }
  private send(message:object){
    for(const c of [...this.connections.values()])if(c.playerId)this.sendJson(c,message);
  }
}
