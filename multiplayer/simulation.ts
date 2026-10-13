import {TerrainField,DEFAULT_SEED,TERRAIN_VERSION,CityTerrain,type WorldKind} from '../src/maps/index.ts';
import {CHUNK_VERSION} from '../src/maps/index.ts';
import type {FrameInput,WorldDescriptor} from '../src/protocol/index.ts';
import {GRACE_MS,MAX_PLAYERS,emptyStats,packEnemy,packPlayer,packStats,wireHp,wireRound as round,type EnemyWire,type Player,type PlayerExtraWire,type RunStats,type Snapshot} from '../src/protocol/index.ts';
import { worldSpawn, type Point } from '../src/maps/index.ts';
import {SimWorld,stateHash,type StampedEvent} from '../src/sim/index.ts';
import {SpatialHash} from '../src/sim/index.ts';
import {coastalSpawnPoints} from '../src/sim/index.ts';
import {createRunSystems,type RunOutcomeKind,type RunSystems} from '../src/sim/index.ts';
import {RUN_ORDER,DEFAULT_FACING,type PlayerInput,type RunPlayer} from '../src/sim/index.ts';
import {classBonusOf,startingBuild} from '../src/rules/index.ts';
import {resetSkill,skillReadyTick,clearMoveEffects,activeMoveEffects} from '../src/sim/index.ts';
import {refreshStats} from '../src/rules/index.ts';
import type {ChooseResult} from '../src/sim/index.ts';
import {BASE_STATS} from '../src/contract/index.ts';
import type {EnemyState,LevelOffer,RoundState,SimEvent,Telegraph} from '../src/contract/index.ts';
import type {CampView,NodeView,RunView,StructureView,TelegraphView} from '../src/contract/index.ts';
import {INTEREST_HYSTERESIS,INTEREST_RADIUS} from '../src/contract/index.ts';
import {nodesNear,remainingOf,touchedNode,WORK_PER_UNIT} from '../src/sim/index.ts';
import type {BuyResult} from '../src/sim/index.ts';
import type {RunState} from '../src/sim/index.ts';
import {InputTrack,STEP_MS} from '../src/protocol/index.ts';
import {ShameTracker} from '../src/sim/index.ts';
import type {ZueiraLab} from '../src/sim/index.ts';
/**
 * The room's simulation (was src/game/net/shared.ts): seats, input tracks, bots and the run systems, plus the frames it
 * hands the encoders (protocol 3 snapshots, protocol 4 FrameInput). It speaks the wire, so it lives with the room and
 * not in src/sim/ (sim never imports protocol). Room texts and the protocol 3 format are src/protocol/room.ts;
 * movement prediction is src/maps/prediction.ts.
 */
/**
 * The world every room plays on (D-019: rounds on a giant map). The endless world shipped once the room spoke protocol
 * 4+ with areas of interest (VGM-042b), the camera followed the hero (camera-segue) and the ground was drawn in tiles
 * around the camera (terreno-em-blocos). The island stays as an internal test world (Simulation default, LAB_WORLD=ilha).
 */
export const DEFAULT_WORLD:WorldKind='infinito';
/** What protocol 4 frames say about the terrain (FrameInput.world); the client rebuilds the same TerrainField from it. */
export function worldDescriptor(terrain:TerrainField):WorldDescriptor{
  const kind=terrain.world==='cidade'?'cidade':terrain.chunks?'infinito':'ilha';
  return {kind,terrainVersion:TERRAIN_VERSION,generatorVersion:terrain.chunks?CHUNK_VERSION:0,seed:terrain.seed,signature:terrain.signature};
}
/** Revive progress moves every tick while someone helps; two decimals are plenty for a ring and keep deltas small. */
const progress=(n:number)=>Math.round(Math.max(0,Math.min(1,n))*100)/100;
export const packPlayerExtra=(p:ServerPlayer,stats?:RunStats):PlayerExtraWire=>{
  const wire:PlayerExtraWire=[p.id,wireHp(p.stats.maxHp),(p.downed?1:0)|(p.eliminated?2:0),p.downed?progress(p.downed.progress):0,p.downed?.bleedOutTick??0,
    p.build.weapons.map(i=>[i.id,i.level]),p.build.passives.map(i=>[i.id,i.level])];
  if(stats)wire.push(packStats(stats));
  return wire;
};

/** Server player: protocol 3 wire fields plus the contract's combat state (build, stats, facing, weaponReady). */
export type ServerPlayer = Player & RunPlayer & { spectator:boolean };
export type SimOutcome=RunOutcomeKind;
const runSeed=(seed:number,run:number)=>(seed^Math.imul(run+1,0x9e3779b9))>>>0;
/** Ticks a dead enemy keeps being sent as a tombstone, and the event window of RunExtras. */
const TOMBSTONE_TICKS=10;
/** Events kept for snapshots; the Room's cursor sends each once, this only bounds memory between broadcasts. */
const EVENT_BUFFER_TICKS=40;
/** Client view of a telegraph (VGM-039, D-036 kind): the shape, its timing and what it is; owner and damage stay on the server. */
export function telegraphView(t:Telegraph):TelegraphView{
  return {id:t.id,shape:t.shape,x:t.x,y:t.y,radius:t.radius,dx:t.dx,dy:t.dy,width:t.width,fireTick:t.fireTick,...(t.kind?{kind:t.kind}:{})};
}
/** Shallow copy of an event with its non-integer numbers rounded like the rest of the wire (15.600000000000001 → 15.6). */
export function wireEvent(event:StampedEvent):StampedEvent{
  const out:Record<string,unknown>={};
  for(const [k,v] of Object.entries(event))out[k]=typeof v==='number'&&!Number.isInteger(v)?round(v):v;
  return out as StampedEvent;
}
/** Client steps whose tick the room remembers (D-036 confirmed check): past InputTrack's history (1.5 s + 16 steps). */
const STEP_TICKS_KEPT=64;
/** Player attack animation is refreshed at most this often by automatic weapon fire. */
const ATTACK_ANIMATION_TICKS=12;
const spawnSlot=(slot:number,at:Point)=>({x:at.x+(slot%3-1)*.7,y:at.y+Math.floor(slot/3)*.7});
/** A city barricade as the stonewards state keeps it (cidade-06); read structurally so rooms do not pin its whole type. */
interface BarricadeRow {id:string;x:number;y:number;hp:number;maxHp:number;down?:boolean}

export class Simulation {
  readonly terrain:TerrainField;
  readonly seed:number;
  readonly players=new Map<string,ServerPlayer>();
  /** Authoritative SimContext with every horde system registered (VGM-042). */
  readonly world:SimWorld;
  private systems:RunSystems;
  private runs=0;
  private result?:SimOutcome;
  private pending?:{victory:boolean;defeat:boolean};
  /** Per player: the client's change segments and the held state, one step per tick (input-10hz). */
  private tracks=new Map<string,InputTrack>();
  /** Enemies after the last step plus any added since (references; a removed one keeps its final position). */
  private alive=new Map<string,EnemyState>();
  private tombs=new Map<string,{wire:EnemyWire;tick:number}>();
  private recent:{tick:number;event:StampedEvent}[]=[];
  /** Per-run counters for the prizes; outside stateHash on purpose (they never decide a future tick). */
  private counters=new Map<string,RunStats>();
  /** "Momento mais vergonhoso" of the run (VGM-053B); outside stateHash too (it never decides a future tick). */
  private shame=new ShameTracker();
  /** Lab only (LAB_ZUEIRA): the zueira plan every run of this simulation uses instead of the seed's. */
  zueiraLab?:ZueiraLab;
  /** This room's own fork of the decoded city (cidade-06): its blockers (barricades) never leak into other rooms. */
  private readonly city?:CityTerrain;
  /**
   * cidade-06 (E5): the city barricades go into the frames' structures as kind 'barricada' only when true. Off until the
   * client draws them (render/stonewards.ts and hud/camp.ts count any non-'muralha' structure as a tower).
   */
  cityStructures:boolean;
  /**
   * `world` defaults to the island here (the deterministic lab most sim tests were written on); rooms pass
   * DEFAULT_WORLD, the endless world (D-019): spawn around the players (spawn-em-volta), wide positions and areas of
   * interest in the frames (rede-mapa-grande), base at the origin.
   */
  /**
   * `terrain` injects a prebuilt surface (the decoded city, D-034); otherwise the seed builds the island or endless world.
   * A CityTerrain is forked (cidade-06): the decoded city is shared by the process, the barricade blockers are this room's.
   */
  constructor(seed=DEFAULT_SEED,options:{world?:WorldKind;terrain?:TerrainField;cityStructures?:boolean}={}){
    if(options.world==='cidade'&&options.terrain?.world!=='cidade')throw new Error("world 'cidade' needs the decoded city terrain");
    const generated=options.world==='cidade'?undefined:options.world;
    this.city=options.terrain instanceof CityTerrain?options.terrain.fork():undefined;
    this.cityStructures=options.cityStructures??false;
    this.seed=seed;this.terrain=this.city??options.terrain??new TerrainField(seed,{world:generated});
    this.world=new SimWorld({terrain:this.terrain,seed:runSeed(seed,0),players:this.players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
    this.systems=this.assemble();
  }
  get tick(){return this.world.tick;}
  /** Events of the last step, with monotonic eventId. */
  get events(){return this.world.lastEvents;}
  get enemies():EnemyState[]{return [...this.world.enemies.values()];}
  /** Decided once per run; a victory beats a defeat decided in the same tick. */
  get outcome():SimOutcome|undefined{return this.result;}
  get victory(){return this.result==='victory';}
  /** Systems of the current run (director, progression, boss, enemyAi, revive). */
  get run():RunSystems{return this.systems;}
  /** Room bots (D-025): played by the room, no socket; their stick goes through setBotInput, one step per tick. */
  readonly bots=new Set<string>();
  private botInputs=new Map<string,PlayerInput>();
  private botSeq=0;
  private assemble(){
    return createRunSystems(this.world,{
      takeInput:id=>{
        const bot=this.botInputs.get(id);
        if(bot){const step={...bot,seq:++this.botSeq};if(bot.skill)bot.skill=false;return step;}
        const p=this.players.get(id),step=p?this.tracks.get(id)?.next(p,this.clock):undefined;
        if(step)this.recordStep(id,step.seq);
        return step;
      },
      // Inside a step the tick decides (victory beats a same-tick defeat); between ticks (commands) the first outcome stands.
      onOutcome:outcome=>{if(this.result)return;if(this.pending)this.pending[outcome]=true;else this.result=outcome;},
      // The run waits for its last player standing who dropped exactly as long as the room keeps the seat (VGM-047);
      // after that the session expires and the Room ends an empty run (042a R1).
      reconnectGraceTicks:Math.round(GRACE_MS/STEP_MS),
      zueiraLab:this.zueiraLab,
    });
  }
  resetRun(){
    this.systems.dispose();
    // The old run's barricades go with it; the new run's stonewards raises its own.
    if(this.city)for(const b of this.city.blockers())this.city.setBlocker(b.id,undefined);
    this.world.reset(runSeed(this.seed,++this.runs));
    this.world.runStartTick=this.world.tick;
    this.systems=this.assemble();
    this.result=undefined;this.alive.clear();this.tombs.clear();this.recent=[];this.counters.clear();this.shame.reset();this.botInputs.clear();
    // D-036: the new run's clock starts over; an old effect end would hold the owner's frames live.
    this.effectEnd.clear();
    // Spawn points are cached per terrain; computing them now avoids a 60–120 ms hitch at round 1 (D-010).
    coastalSpawnPoints(this.terrain); // [] at once in the endless world
    let slot=0;
    for(const p of this.players.values()){
      this.equip(p);Object.assign(p,spawnSlot(slot++,worldSpawn(this.terrain)),{score:0,ack:0,attackTick:0,skillTick:0,skillReadyTick:0});
      this.track(p.id).reset(0);this.trackReset(p.id);
    }
  }
  /** Fresh run kit: class bonus and starting weapon (VGM-044A), stats, full hp, cleared fall/skill state. */
  private equip(p:ServerPlayer){
    p.classBonus=classBonusOf(p.classId);p.build=startingBuild(p.classId);p.weaponReady={};p.facing={...DEFAULT_FACING};
    delete p.target;delete p.downed;delete p.eliminated;delete p.invulnerableUntil;resetSkill(p);
    // The agiota's devendo mark holds an absolute tick (D-002 extra field); a rematch restarts the clock at 0.
    delete (p as {devendoUntil?:number}).devendoUntil;delete (p as {devendoSay?:number}).devendoSay;
    // D-036 slow and slip hold absolute ticks too.
    clearMoveEffects(p);
    refreshStats(p);p.hp=p.stats.maxHp;
  }
  add(id:string,name:string,classId:string){
    if(this.players.size>=MAX_PLAYERS)throw new Error('Sala cheia. Máximo de seis jogadores.');
    const slots=Array.from({length:6},(_,i)=>spawnSlot(i,worldSpawn(this.terrain)));
    const spawn=slots.find(s=>[...this.players.values()].every(p=>Math.hypot(p.x-s.x,p.y-s.y)>.3))??worldSpawn(this.terrain);
    const p={...spawn,id,name,classId,hp:0,ack:0,online:true,score:0,spectator:false,stats:{...BASE_STATS}} as ServerPlayer;
    this.equip(p);
    this.players.set(id,p);this.track(id).reset(0);this.trackReset(id);return p;
  }
  /**
   * Out of the room for good. The opt-out goes too (a later seat is a new id), and so do their moments: someone who
   * said no and left mid-run must not become the "momento mais vergonhoso" once the opt-out is gone.
   */
  remove(id:string){this.players.delete(id);this.tracks.delete(id);this.trackReset(id);this.effectEnd.delete(id);this.bots.delete(id);this.botInputs.delete(id);this.shameOptOut.delete(id);this.shame.forget(id);}
  /**
   * A room bot (D-025): a player like the others (counts toward the six, takes hits, falls, gets rescued), always
   * online, and out of the "momento mais vergonhoso" (a person's consent thing).
   */
  addBot(id:string,name:string,classId:string){
    const p=this.add(id,name,classId);this.bots.add(id);this.shameOptOut.add(id);return p;
  }
  /** The bot's stick for the next steps (held until changed) and a one-shot skill tap. */
  setBotInput(id:string,direction:Point,skill=false){
    if(!this.bots.has(id))return;
    const held=this.botInputs.get(id);
    this.botInputs.set(id,{seq:0,x:direction.x,y:direction.y,attack:false,skill:skill||!!held?.skill});
  }
  private track(id:string){let t=this.tracks.get(id);if(!t){t=new InputTrack();this.tracks.set(id,t);}return t;}
  /** Going offline or coming back: nothing held or queued survives, and the client restarts its steps at the ack. */
  setOnline(id:string,online:boolean){const p=this.players.get(id);if(p){p.online=online;this.track(id).reset(p.ack);this.trackReset(id);delete p.target;}}
  /**
   * A batch of change segments `{seq,steps}` (input-10hz) or one legacy step `{seq,x,y,attack,skill?,target?}`.
   * Refused (false) for offline or spectating players and for anything malformed or out of order; see InputTrack.
   */
  input(id:string,value:unknown,now=this.tick*STEP_MS){
    const p=this.players.get(id),t=this.tracks.get(id);
    if(!p?.online||p.spectator||!t)return false;
    return t.accept(value,now);
  }
  /** Skill tap from the client (see InputTrack.tap); false when refused (offline, spectator, stale or repeated id). */
  tap(id:string,tapId:unknown){const p=this.players.get(id),t=this.tracks.get(id);return !!p?.online&&!p.spectator&&!!t&&t.tap(tapId);}
  /**
   * Owner's own position and ack for its frames (InputTrack.confirmed), or undefined for the live ones.
   * D-036: the phone replays its pending steps on ticks frameTick+1+k (maps/prediction.ts). The confirmed position
   * sits before steps the room already took on earlier ticks, so while a slow or a slip touches those steps (the
   * latest effect end, effectEnd, is after the first of them) the replay would put the effect on the wrong steps: the
   * frame goes live instead (ack = the step taken this tick), where the mapping is exact.
   * The owner's ack never goes back (review B1): after a live frame, confirmed stays live until the client's report
   * passes that ack (liveAck), or the phone, which already dropped its pending steps up to it, would replay from an
   * older position without them and snap back.
   */
  confirmed(id:string){
    const own=this.tracks.get(id)?.confirmed();
    if(!own)return undefined;
    const p=this.players.get(id);
    if(!p)return own;
    const from=this.stepTicks.get(id)?.find(s=>s.seq===own.ack+1)?.tick;
    const end=Math.max(this.effectEnd.get(id)??-Infinity,p.slowUntil??-Infinity,p.slipUntil??-Infinity);
    const touched=end>-Infinity&&(from===undefined||end>from);
    const liveAck=this.liveAck.get(id);
    if(touched||liveAck!==undefined&&own.ack<liveAck){this.liveAck.set(id,Math.max(liveAck??0,p.ack));return undefined;}
    this.liveAck.delete(id);
    return own;
  }
  /** Per player: the highest ack a live frame carried while confirmed was held back (D-036, review B1). */
  private liveAck=new Map<string,number>();
  /** Per player: the latest tick a slow or slip of this run ran until (kept after the players system drops it). */
  private effectEnd=new Map<string,number>();
  /** The input track starts over (join, reconnect, rematch): acks restart, so does the monotone guard. */
  private trackReset(id:string){this.liveAck.delete(id);this.stepTicks.delete(id);}
  /** Per player: the tick each recent client step was taken on (D-036 confirmed check); a seq going back starts it over. */
  private stepTicks=new Map<string,{seq:number;tick:number}[]>();
  private recordStep(id:string,seq:number){
    let list=this.stepTicks.get(id);
    const last=list?.[list.length-1]?.seq;
    // A press cast in place repeats the last seq (InputTrack.next): same step, nothing to add.
    if(last===seq)return;
    if(!list||last!==undefined&&last>seq)this.stepTicks.set(id,list=[]);
    list.push({seq,tick:this.world.tick});
    if(list.length>STEP_TICKS_KEPT)list.shift();
  }
  /** Skill taps answered by the last step: seq is the client's, ok whether it was cast, readyTick the next ready tick. */
  casts:{id:string;seq:number;ok:boolean;readyTick:number}[]=[];
  /** Clock of the step being taken (ms): the Room's wall clock, or tick × STEP_MS (tests, replays). */
  private clock=0;
  /** Upgrade pick from the offer panel; forged, repeated and out-of-order picks are refused by progression. */
  choose(id:string,offerId:string,index:number):ChooseResult{
    if(this.result)return {ok:false,reason:'no-offer'};
    return this.systems.progression.choose(this.world,id,offerId,index);
  }
  offers(id:string):LevelOffer[]{return this.world.offers.get(id)??[];}
  /**
   * Forge purchase (VGM-046B): the recipe for the team balance, validated on the server (phase, standing, in the camp,
   * balance). `requestId` makes a resent tap apply once. `targetId` (cidade-06): what 'reparo' repairs, the wall when
   * omitted or a city barricade id (the room checks its shape, stonewards whether it exists). Refused once the run is decided.
   */
  forge(id:string,recipeId:string,requestId?:string,targetId?:string):BuyResult{
    const p=this.players.get(id);
    if(this.result||!p?.online||p.spectator)return {ok:false,reason:'player'};
    return this.systems.stonewards.buy(this.world,id,recipeId,requestId,targetId);
  }
  /** Node ids of the last frame (the Room prunes the wire ids of the rest). */
  nodeIds:string[]=[];
  /** The wall and the towers as the client sees them, plus the city barricades (hp 0 once down) behind `cityStructures`. */
  private structureViews():StructureView[]{
    const st=this.systems.stonewards.state,w=st.wall;
    const out:StructureView[]=[{id:w.id,kind:'muralha',x:w.x,y:w.y,hp:w.hp,maxHp:w.maxHp},...st.towers.map(t=>({id:t.id,kind:t.kind,x:t.x,y:t.y,hp:t.hp,maxHp:t.maxHp,untilTick:t.untilTick}))];
    if(this.cityStructures&&this.city){
      const rows=(st as {barricades?:readonly BarricadeRow[]}).barricades??[];
      for(const b of rows)out.push({id:b.id,kind:'barricada',x:b.x,y:b.y,hp:b.down?0:b.hp,maxHp:b.maxHp});
    }
    return out;
  }
  /**
   * Gather nodes near any player with a body, only in a real intermission (round 1+): the union of every client's area
   * of interest (each encoder keeps its own part). Untouched nodes are full.
   */
  private nodeViews(record=true):NodeView[]{
    const w=this.world,st=this.systems.stonewards.state;
    if(w.round.phase!=='prepare'||w.round.index<1||st.wallDown){if(record)this.nodeIds=[];return [];}
    const out=new Map<string,NodeView>(),reach=INTEREST_RADIUS+INTEREST_HYSTERESIS;
    for(const p of this.players.values()){
      if(p.spectator||p.eliminated)continue;
      for(const n of nodesNear(this.terrain,p,reach)){
        if(out.has(n.id))continue;
        const touched=touchedNode(st,n.id);
        out.set(n.id,{id:n.id,kind:n.kind,x:n.x,y:n.y,remaining:remainingOf(st,n),capacity:n.capacity,value:n.value,
          progress:touched?Math.min(1,touched.work/WORK_PER_UNIT[n.kind]):0});
      }
    }
    if(record)this.nodeIds=[...out.keys()];
    return [...out.values()];
  }
  private campView():CampView{
    const st=this.systems.stonewards.state;
    return {coco:st.balance.coco,pedra:st.balance.pedra,...(st.hornEndsTick>=0&&this.world.round.phase==='prepare'?{hornEndsTick:st.hornEndsTick}:{}),...(st.wallDown?{wallDown:true}:{})};
  }
  /** One server tick; returns its events. */
  step(now=this.tick*STEP_MS){
    this.clock=now;
    this.pending={victory:false,defeat:false};
    // Enemies added between ticks (tests, future checkpoints) join the set too, so they also get a tombstone.
    for(const e of this.world.enemies.values())if(!this.alive.has(e.id))this.alive.set(e.id,e);
    const castBefore=new Map([...this.players.values()].map(p=>[p.id,p.skillTick]));
    const events=this.world.step();
    // D-036: remember how far each slow or slip ran (the players system drops it once it is over; confirmed needs it).
    for(const p of this.players.values()){
      const end=Math.max(p.slowUntil??-Infinity,p.slipUntil??-Infinity);
      if(end>(this.effectEnd.get(p.id)??-Infinity))this.effectEnd.set(p.id,end);
    }
    // Skill taps carried by this step (input-10hz `cast`): the room tells each client whether it went off.
    this.casts=[];
    for(const [id,t] of this.tracks)if(t.tapped!==undefined){const p=this.players.get(id);if(p)this.casts.push({id,seq:t.tapped,ok:p.skillTick!==castBefore.get(id),readyTick:skillReadyTick(p)});}
    if(!this.result)this.result=this.pending.victory?'victory':this.pending.defeat?'defeat':undefined;
    this.pending=undefined;
    // Refunds (pagodeiro, caça-promoção) move the cooldown after the cast; the wire follows the skill state.
    for(const p of this.players.values())p.skillReadyTick=skillReadyTick(p);
    for(const e of events)if(e.type==='fire'&&!e.weapon.startsWith('skill:')){
      const p=this.players.get(e.player);
      if(p&&this.tick-(p.attackTick??0)>=ATTACK_ANIMATION_TICKS)p.attackTick=this.tick;
    }
    this.countStats(events);
    this.shame.observe(this.world,events,this.systems.zueira.activeAt(this.tick));
    this.trackRemovals();
    this.recent=this.recent.filter(r=>r.tick>this.tick-EVENT_BUFFER_TICKS);
    for(const event of events)this.recent.push({tick:this.tick,event});
    return events;
  }
  /** The run's most embarrassing moment so far (VGM-053B), for the result; undefined when nobody did anything silly. */
  shameMoment(){return this.shame.momentWithout(this.shameOptOut);}
  /** Players who turned "my embarrassing moment" off (a preference: it survives rematches). */
  readonly shameOptOut=new Set<string>();
  /** The player's choice from the settings ({t:'pref',shame}); false = never pick their moment. */
  setShamePref(id:string,allow:boolean){if(allow)this.shameOptOut.delete(id);else this.shameOptOut.add(id);}
  /** Run counters of a player (award-stats-server); zeros before anything happened. */
  statsOf(id:string):RunStats{
    let s=this.counters.get(id);
    if(!s){s=emptyStats();this.counters.set(id,s);}
    return s;
  }
  /** Same rules the HUD tally used on events (hud/model.ts applyEvents, DamageTally), now once, on the server. */
  private countStats(events:readonly SimEvent[]){
    const mine=(id:string|undefined)=>id!==undefined&&this.players.has(id)?this.statsOf(id):undefined;
    for(const e of events){
      switch(e.type){
        case 'damage':{const s=mine(e.source);if(s&&!this.players.has(e.target)&&Number.isFinite(e.amount))s.damage+=e.amount;break;}
        case 'kill':{const s=mine(e.by);if(s)s.kills++;break;}
        case 'revived':{const s=mine(e.by);if(s)s.revives++;break;}
        case 'downed':{const s=mine(e.player);if(s)s.downs++;break;}
        case 'evolve':{const s=mine(e.player);if(s)s.evolves++;break;}
        case 'pickup':{
          const s=mine(e.player);if(!s)break;
          s.pickups++;
          if(e.kind==='heal')s.heals++;else if(e.kind==='magnet')s.magnets++;else if(e.kind==='chest')s.chests++;
          break;
        }
      }
    }
  }
  /** Enemies gone since the last step become tombstones (hp 0, kind kept for the death poof) for a few ticks, so protocol 3 clients hide them. */
  private trackRemovals(){
    for(const [id,e] of this.alive)if(!this.world.enemies.has(id))this.tombs.set(id,{wire:packEnemy({...e,hp:0}),tick:this.tick});
    this.alive.clear();
    for(const e of this.world.enemies.values())this.alive.set(e.id,e);
    for(const [id,tomb] of this.tombs)if(tomb.tick<=this.tick-TOMBSTONE_TICKS)this.tombs.delete(id);
  }
  /** Hash of everything that decides future ticks (world, run systems, pending inputs, the bots' sticks, counter and minds, outcome). */
  stateHash(){return stateHash({world:this.world.state(),systems:this.systems.state(),inputs:[...this.tracks].map(([id,t])=>[id,t.state()]),
    bots:{sticks:[...this.botInputs].map(([id,b])=>[id,b.x,b.y,!!b.skill]),seq:this.botSeq,minds:this.botState?.()??null},outcome:this.result??null});}
  /** The room bots' minds (RoomBots.state: memories and forge requests), which decide their next sticks (set by the room). */
  botState?:()=>unknown;
  /**
   * What a room bot sees (D-025): the same RunView shape the protocol bots read (bot-brain.ts), built from the live
   * world without copying the horde (read-only for the brain). Players carry x/y, like the frames. `offers` per bot.
   */
  botView():RunView{
    const w=this.world;
    return {
      tick:w.tick,team:w.team,round:w.round,
      enemies:[...w.enemies.values()],pickups:[...w.pickups.values()],projectiles:[...w.projectiles.values()],telegraphs:[...w.telegraphs.values()],
      structures:this.structureViews(),nodes:this.nodeViews(false),camp:this.campView(),
      players:[...this.players.values()].map(p=>({id:p.id,name:p.name,classId:p.classId,hp:p.hp,maxHp:p.stats.maxHp,online:p.online,spectator:p.spectator,
        downed:p.downed,eliminated:p.eliminated,weapons:p.build.weapons,passives:p.build.passives,skillReadyTick:p.skillReadyTick,x:p.x,y:p.y})),
      offers:[],events:[],
    } as unknown as RunView;
  }
  /** Pure client view for one player (protocol 4 encodes this in VGM-042b). */
  view(playerId:string):RunView{
    const w=this.world;
    return {
      tick:w.tick,team:{...w.team},round:{...w.round},
      enemies:[...w.enemies.values()].map(e=>({id:e.id,kind:e.kind,x:e.x,y:e.y,hp:e.hp,maxHp:e.maxHp,elite:e.elite,boss:e.boss,phase:e.phase})),
      pickups:[...w.pickups.values()].map(p=>({id:p.id,kind:p.kind,x:p.x,y:p.y,value:p.value,resource:p.resource})),
      projectiles:[...w.projectiles.values()].map(p=>({id:p.id,source:p.source,x:p.x,y:p.y,vx:p.vx,vy:p.vy,radius:p.radius,hostile:p.hostile})),
      telegraphs:[...w.telegraphs.values()].map(telegraphView),
      structures:this.structureViews(),nodes:this.nodeViews(),camp:this.campView(),
      players:[...this.players.values()].map(p=>({
        id:p.id,name:p.name,classId:p.classId,hp:p.hp,maxHp:p.stats.maxHp,online:p.online,spectator:p.spectator,
        downed:p.downed?{progress:p.downed.progress,bleedOutTick:p.downed.bleedOutTick}:undefined,eliminated:p.eliminated,
        weapons:p.build.weapons.map(i=>({...i})),passives:p.build.passives.map(i=>({...i})),
        skillTick:p.skillTick||undefined,skillReadyTick:p.skillReadyTick||undefined,
        stats:{...this.statsOf(p.id),damage:Math.round(this.statsOf(p.id).damage)},
        ...activeMoveEffects(p,w.tick),
      })),
      offers:this.offers(playerId).map(o=>({id:o.id,source:o.source,level:o.level,choices:o.choices.map(c=>({...c})),deadlineTick:o.deadlineTick,defaultIndex:o.defaultIndex})),
      events:[...w.lastEvents],
    };
  }
  private descriptor?:WorldDescriptor;
  /**
   * What every protocol 4 encoder of the room gets this tick (VGM-042b): build it once per tick and hand the same
   * object to each encoder that is due (their live-id cache is shared through it). Server ids; offers go as JSON.
   */
  frame():FrameInput{
    const w=this.world;
    this.descriptor??=worldDescriptor(this.terrain);
    return {
      tick:w.tick,team:{...w.team},round:{...w.round},world:this.descriptor,
      enemies:[...w.enemies.values()].map(e=>({id:e.id,kind:e.kind,x:e.x,y:e.y,hp:e.hp,maxHp:e.maxHp,elite:e.elite,boss:e.boss,phase:e.phase})),
      pickups:[...w.pickups.values()].map(p=>({id:p.id,kind:p.kind,x:p.x,y:p.y,value:p.value,resource:p.resource})),
      projectiles:[...w.projectiles.values()].map(p=>({id:p.id,source:p.source,x:p.x,y:p.y,vx:p.vx,vy:p.vy,radius:p.radius,hostile:p.hostile})),
      telegraphs:[...w.telegraphs.values()].map(telegraphView),
      structures:this.structureViews(),nodes:this.nodeViews(),camp:this.campView(),
      players:[...this.players.values()].map(p=>{
        const stats=this.statsOf(p.id);
        return {
          id:p.id,name:p.name,classId:p.classId,hp:p.hp,maxHp:p.stats.maxHp,online:p.online,spectator:p.spectator,
          downed:p.downed?{progress:p.downed.progress,bleedOutTick:p.downed.bleedOutTick}:undefined,eliminated:p.eliminated||undefined,
          weapons:p.build.weapons,passives:p.build.passives,stats:{...stats,damage:Math.round(stats.damage)},
          x:p.x,y:p.y,ack:p.ack,attackTick:p.attackTick||undefined,skillTick:p.skillTick||undefined,skillReadyTick:p.skillReadyTick||undefined,
          ...activeMoveEffects(p,w.tick),
        };
      }),
    };
  }
  /** sinceEventId: only events after it (the Room's broadcast cursor); omitted, the whole buffer. */
  snapshot(sinceEventId=-1):Snapshot{
    const w=this.world;
    const enemies:EnemyWire[]=[...w.enemies.values()].map(packEnemy);
    for(const tomb of this.tombs.values())if(!w.enemies.has(tomb.wire[0]))enemies.push(tomb.wire);
    return {terrain:{seed:this.terrain.seed,version:TERRAIN_VERSION,signature:this.terrain.signature,
      ...(this.terrain.chunks?{world:'infinito' as const,generator:CHUNK_VERSION}:this.terrain.world==='cidade'?{world:'cidade' as const}:{})},t:'state',tick:this.tick,full:true,
      players:[...this.players.values()].map(packPlayer),enemies,removed:[],victory:this.victory,
      x:{round:{...w.round},team:{...w.team},players:[...this.players.values()].map(p=>packPlayerExtra(p,this.statsOf(p.id))),
        pickups:[...w.pickups.values()].map(p=>[p.id,p.kind,round(p.x),round(p.y),p.value]),
        projectiles:[...w.projectiles.values()].map(p=>[p.id,p.source,round(p.x),round(p.y),round(p.vx),round(p.vy),p.radius,p.hostile]),
        telegraphs:[...w.telegraphs.values()].map(telegraphView),
        events:this.recent.filter(r=>r.event.eventId>sinceEventId).map(r=>wireEvent(r.event))}};
  }
}

export type {SimEvent};
