import {TerrainField,defaultTerrain,DEFAULT_SEED,TERRAIN_VERSION,type WorldKind} from '../terrain/field.ts';
import {CHUNK_VERSION} from '../terrain/chunks.ts';
import {PROTOCOL_VERSION,type FrameInput,type WorldDescriptor} from './protocol4.ts';
import { moveDirection, worldSpawn, type Point } from '../world.ts';
import {SimWorld,stateHash,type StampedEvent} from '../sim/core.ts';
import {SpatialHash} from '../sim/spatial.ts';
import {coastalSpawnPoints} from '../sim/director.ts';
import {createRunSystems,type RunOutcomeKind,type RunSystems} from '../sim/assemble.ts';
import {RUN_ORDER,DEFAULT_FACING,type PlayerInput,type RunPlayer} from '../sim/systems/players.ts';
import {classBonusOf,startingBuild} from '../sim/kits.ts';
import {resetSkill,skillReadyTick} from '../sim/skills.ts';
import {refreshStats} from '../sim/stats.ts';
import type {ChooseResult} from '../sim/progression.ts';
import {BASE_STATS} from '../sim/types.ts';
import type {EnemyState,LevelOffer,RoundState,SimEvent} from '../sim/types.ts';
import type {CampView,NodeView,RunView,StructureView,TelegraphView} from '../sim/view.ts';
import {INTEREST_HYSTERESIS,INTEREST_RADIUS} from '../sim/offscreen.ts';
import {nodesNear,remainingOf,touchedNode,WORK_PER_UNIT} from '../sim/stonewards/resources.ts';
import type {BuyResult} from '../sim/stonewards/forge.ts';
import type {RunState} from './run.ts';
import {InputTrack,STEP_MS} from './input-track.ts';
/**
 * Room protocol (join handshake). 6 since VGM-046B (5 was E7-skill-hud-wiring, 4 VGM-042b): binary run frames
 * (protocol4.ts: camp block and gather nodes) plus JSON control messages (`forge` asks the forge for a recipe).
 * The site and the rooms Worker publish together (pages.yml, Worker first); a client with another version is
 * refused at join with a readable message, never fed frames it cannot parse.
 */
export const ROOM_PROTOCOL=PROTOCOL_VERSION;
/** The Room speaks protocol 4 (VGM-042b); the endless world still waits for the camera that follows (camera-segue). */
export const ENDLESS_WORLD_READY=false;
/** What protocol 4 frames say about the terrain (FrameInput.world); the client rebuilds the same TerrainField from it. */
export function worldDescriptor(terrain:TerrainField):WorldDescriptor{
  return {kind:terrain.chunks?'infinito':'ilha',terrainVersion:TERRAIN_VERSION,generatorVersion:terrain.chunks?CHUNK_VERSION:0,seed:terrain.seed,signature:terrain.signature};
}
/**
 * The one text for "this page and the room do not match" (UX onda 4, B15): version refused, terrain or generator
 * differs, frames that never decode. In the house voice, with what to do and what to do if it comes back (the
 * site may lag the Worker for a minute during a release, pages.yml).
 */
export const UPDATE_NEEDED='Saiu versão nova do jogo. Atualiza a página pra entrar. Se voltar esta mensagem, espera 1 minuto.';
/** Whether a terminal message asks for a reload (also older rooms' wording, "Atualize a página"). */
export const needsUpdate=(message:string)=>message===UPDATE_NEEDED||/Atualiz[ae] a página/.test(message);
/** Client side of the welcome (VGM-042b): the room's exact terrain (kind, versions, seed, signature), or the text why not. */
export function terrainFor(world:WorldDescriptor|undefined):TerrainField|string{
  if(!world||world.terrainVersion!==TERRAIN_VERSION||!Number.isInteger(world.seed))return UPDATE_NEEDED;
  // An endless room says so (spawn-em-volta/rede-mapa-grande); a different generator is refused, never misdrawn.
  if(world.kind==='infinito'&&world.generatorVersion!==CHUNK_VERSION)return UPDATE_NEEDED;
  const terrain=new TerrainField(world.seed,{world:world.kind==='infinito'?'infinito':'ilha'});
  return terrain.signature===world.signature?terrain:UPDATE_NEEDED;
}
/** Room notice when a new run would not fit in the room's lifetime (042a R2); the client turns the rematch button into advice. */
export const ROOM_CLOSING_NOTICE='O síndico vai fechar a sala antes de dar tempo de outra run inteira. Criem uma sala nova, que a gosma espera.';

/**
 * The room's Durable Object restarted (deploy, eviction) in the middle of a run (VGM-047, D-024): honest end, as news
 * on top of the waiting room (UX onda 5): what happened and what was lost, that nobody in the group caused it, and
 * what to do. `message` is both lines for the status text.
 */
export function restartedNotice(lost?:{round:number;level:number}){
  const title=lost&&lost.round>0
    ?`A sala caiu e voltou. A partida do Round ${lost.round} se perdeu${lost.level>0?`: vocês estavam no Nv ${lost.level}`:''}.`
    :'A sala caiu e voltou, e a partida se perdeu.';
  const body='Não foi ninguém da turma. Toca em Tô pronto pra começar outra.';
  return {title,body,message:`${title} ${body}`};
}
/** This connection lost the character to a newer one (another tab, or the same phone back on another network). */
export const REPLACED_MESSAGE='Seu personagem entrou por outra aba ou outro aparelho. Pra jogar aqui, toca em Atualizar.';

/** Client-side ranges for the prototype skill ring (scene.ts). */
export const ATTACK_RANGE=1.8,BASIC_COOLDOWN_TICKS=12,SKILL_RANGE=2.8,SKILL_COOLDOWN_TICKS=160;
export const STEP = 1 / 20;
export const MAX_PLAYERS = 6;
/**
 * A dropped player keeps the seat this long (VGM-047, definitive for phones, D-009/D-016): switching apps, answering a
 * message or changing networks is normal. Costs nothing on the free plan (an offline player sends nothing); the
 * standing character can still be hit, so a long absence ends in a fall like any other.
 */
export const GRACE_MS = 120_000;
export type Input = PlayerInput;
export type Player = Point & { id:string; name:string; classId:string; hp:number; ack:number; online:boolean; score:number; attackTick?:number; spectator?:boolean; skillTick?:number; skillReadyTick?:number };
export type Enemy = Point & { id:string; hp:number };
// Fixed tuple fields avoid repeated property names in frequent patches.
export type PlayerWire = [string,number,number,number,number,boolean,number,string,string,number?,boolean?,number?,number?];
/**
 * id,x,y,hp, then kind, maxHp and flags (1 elite, 2 boss); protocol 3 clients read only the first four. A dead enemy is sent once with hp 0.
 * In a delta the last three are left out while they did not change (a missing tail means "same as before").
 */
export type EnemyWire = [string,number,number,number,string?,number?,number?];
/** Horde extras on top of protocol 3 (ignored by older clients); protocol 4 (VGM-042b) replaces this JSON. */
export interface RunExtras {
  round:RoundState;team:{xp:number;level:number;nextXp:number};
  /** id,kind,x,y,value */
  pickups:[string,string,number,number,number][];
  /** id,source,x,y,vx,vy,radius,hostile */
  projectiles:[string,string,number,number,number,number,number,boolean][];
  telegraphs:TelegraphView[];
  /** Events since the previous broadcast (Room passes its last sent eventId), numbers rounded; each event goes out once. */
  events:StampedEvent[];
  /** Deltas only: pickups and projectiles carry just the changed ones, and these ids left since the previous message. */
  gone?:{pickups:string[];projectiles:string[]};
  /**
   * HUD state per player (VGM-043), the fields protocol 4 carries in PlayerWireView: maxHp, fall and build.
   * Diffed by id like pickups; a player that left goes in the top-level `removed`. Optional: older rooms omit it.
   */
  players?:PlayerExtraWire[];
}
/** id, maxHp, flags (1 downed, 2 eliminated), revive progress 0..1, bleedOutTick, weapons [id,level][], passives [id,level][]. */
/** [id, maxHp, flags, revive progress, bleedOutTick, weapons, passives, stats?]; stats is StatsWire (award-stats-server). */
export type PlayerExtraWire=[string,number,number,number,number,[string,number][],[string,number][],StatsWire?];
/** [damage, kills, revives, pickups, downs, heals, chests, magnets, evolves], integers. */
export type StatsWire=[number,number,number,number,number,number,number,number,number];
export interface RunStats {damage:number;kills:number;revives:number;pickups:number;downs:number;heals:number;chests:number;magnets:number;evolves:number}
export const emptyStats=():RunStats=>({damage:0,kills:0,revives:0,pickups:0,downs:0,heals:0,chests:0,magnets:0,evolves:0});
export const packStats=(s:RunStats):StatsWire=>[Math.round(s.damage),s.kills,s.revives,s.pickups,s.downs,s.heals,s.chests,s.magnets,s.evolves];
export const unpackStats=(w:StatsWire)=>({damage:w[0],kills:w[1],revives:w[2],pickups:w[3],downs:w[4],heals:w[5],chests:w[6],magnets:w[7],evolves:w[8]});
export type Snapshot = { t:'state'; tick:number; full:boolean; players:PlayerWire[]; enemies:EnemyWire[]; removed:string[]; victory:boolean; run?:RunState; terrain?:{seed:number;version:number;signature:string;world?:WorldKind;generator?:number}; x?:RunExtras };
// hp goes up rounded (regen and might make fractions): a player or enemy still standing never shows 0.
export const packPlayer = (p:Player):PlayerWire => [p.id,round(p.x),round(p.y),wireHp(p.hp),p.ack,p.online,p.score,p.name,p.classId,p.attackTick??0,p.spectator??false,p.skillTick??0,p.skillReadyTick??0];
export const packEnemy = (e:Enemy&Partial<EnemyState>):EnemyWire => e.kind===undefined?[e.id,round(e.x),round(e.y),wireHp(e.hp)]:
  [e.id,round(e.x),round(e.y),wireHp(e.hp),e.kind,wireHp(e.maxHp??e.hp),(e.elite?1:0)|(e.boss?2:0)];
export const unpackPlayer = (p:PlayerWire):Player => ({id:p[0],x:p[1],y:p[2],hp:p[3],ack:p[4],online:p[5],score:p[6],name:p[7],classId:p[8],attackTick:p[9]??0,spectator:p[10]??false,skillTick:p[11]??0,skillReadyTick:p[12]??0});
export const unpackEnemy = (e:EnemyWire):Enemy => ({id:e[0],x:e[1],y:e[2],hp:e[3]});
const round=(n:number)=>Math.round(n*1000)/1000;
/** Revive progress moves every tick while someone helps; two decimals are plenty for a ring and keep deltas small. */
const progress=(n:number)=>Math.round(Math.max(0,Math.min(1,n))*100)/100;
export const packPlayerExtra=(p:ServerPlayer,stats?:RunStats):PlayerExtraWire=>{
  const wire:PlayerExtraWire=[p.id,wireHp(p.stats.maxHp),(p.downed?1:0)|(p.eliminated?2:0),p.downed?progress(p.downed.progress):0,p.downed?.bleedOutTick??0,
    p.build.weapons.map(i=>[i.id,i.level]),p.build.passives.map(i=>[i.id,i.level])];
  if(stats)wire.push(packStats(stats));
  return wire;
};
const wireHp=(hp:number)=>Number.isFinite(hp)&&hp>0?Math.ceil(hp-1e-9):0;
export function validInput(value:unknown):value is Input {
  if(!value||typeof value!=='object')return false;
  const v=value as Input;
  return Number.isSafeInteger(v.seq)&&v.seq>0&&v.seq<2**31&&Number.isFinite(v.x)&&Number.isFinite(v.y)&&Math.abs(v.x)<=1&&Math.abs(v.y)<=1&&typeof v.attack==='boolean'&&(v.skill===undefined||typeof v.skill==='boolean')&&(v.target===undefined||(typeof v.target==='string'&&/^[a-zA-Z0-9-]{1,40}$/.test(v.target)));
}
export function simulate(p:Point,input:Input,terrain:TerrainField=defaultTerrain):Point { return moveDirection(p,{x:input.x,y:input.y},STEP,terrain); }
export function reconcile(authoritative:Point,pending:Input[],terrain:TerrainField=defaultTerrain):Point { return pending.reduce((p,i)=>simulate(p,i,terrain),{...authoritative}); }
export function interpolate(a:Point,b:Point,t:number):Point { const n=Math.max(0,Math.min(1,t));return {x:a.x+(b.x-a.x)*n,y:a.y+(b.y-a.y)*n}; }

/** Server player: protocol 3 wire fields plus the contract's combat state (build, stats, facing, weaponReady). */
export type ServerPlayer = Player & RunPlayer & { spectator:boolean };
export type SimOutcome=RunOutcomeKind;
const runSeed=(seed:number,run:number)=>(seed^Math.imul(run+1,0x9e3779b9))>>>0;
/** Ticks a dead enemy keeps being sent as a tombstone, and the event window of RunExtras. */
const TOMBSTONE_TICKS=10;
/** Events kept for snapshots; the Room's cursor sends each once, this only bounds memory between broadcasts. */
const EVENT_BUFFER_TICKS=40;
/** Shallow copy of an event with its non-integer numbers rounded like the rest of the wire (15.600000000000001 → 15.6). */
export function wireEvent(event:StampedEvent):StampedEvent{
  const out:Record<string,unknown>={};
  for(const [k,v] of Object.entries(event))out[k]=typeof v==='number'&&!Number.isInteger(v)?round(v):v;
  return out as StampedEvent;
}
/** Player attack animation is refreshed at most this often by automatic weapon fire. */
const ATTACK_ANIMATION_TICKS=12;
const spawnSlot=(slot:number,at:Point)=>({x:at.x+(slot%3-1)*.7,y:at.y+Math.floor(slot/3)*.7});

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
  /**
   * `world` defaults to the island. 'infinito' (D-019) spawns around the players (spawn-em-volta) and protocol 4
   * has wide positions and areas of interest (rede-mapa-grande), but it is NOT playable yet: the Room still speaks
   * protocol 3 (VGM-042b) and the client still frames the island (camera-segue). It needs `experimental: true`
   * (tests, benchmarks) until ENDLESS_WORLD_READY.
   */
  constructor(seed=DEFAULT_SEED,options:{world?:WorldKind;experimental?:boolean}={}){
    if(options.world==='infinito'&&!ENDLESS_WORLD_READY&&!options.experimental)
      throw new Error("Mapa infinito ainda não é jogável (sala no protocolo 4 e câmera que segue pendentes): use experimental:true só em teste.");
    this.seed=seed;this.terrain=new TerrainField(seed,{world:options.world});
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
  private assemble(){
    return createRunSystems(this.world,{
      takeInput:id=>{const p=this.players.get(id);return p?this.tracks.get(id)?.next(p,this.clock):undefined;},
      // Inside a step the tick decides (victory beats a same-tick defeat); between ticks (commands) the first outcome stands.
      onOutcome:outcome=>{if(this.result)return;if(this.pending)this.pending[outcome]=true;else this.result=outcome;},
      // The run waits for its last player standing who dropped exactly as long as the room keeps the seat (VGM-047);
      // after that the session expires and the Room ends an empty run (042a R1).
      reconnectGraceTicks:Math.round(GRACE_MS/STEP_MS),
    });
  }
  resetRun(){
    this.systems.dispose();
    this.world.reset(runSeed(this.seed,++this.runs));
    this.world.runStartTick=this.world.tick;
    this.systems=this.assemble();
    this.result=undefined;this.alive.clear();this.tombs.clear();this.recent=[];this.counters.clear();
    // Spawn points are cached per terrain; computing them now avoids a 60–120 ms hitch at round 1 (D-010).
    coastalSpawnPoints(this.terrain); // [] at once in the endless world
    let slot=0;
    for(const p of this.players.values()){
      this.equip(p);Object.assign(p,spawnSlot(slot++,worldSpawn(this.terrain)),{score:0,ack:0,attackTick:0,skillTick:0,skillReadyTick:0});
      this.track(p.id).reset(0);
    }
  }
  /** Fresh run kit: class bonus and starting weapon (VGM-044A), stats, full hp, cleared fall/skill state. */
  private equip(p:ServerPlayer){
    p.classBonus=classBonusOf(p.classId);p.build=startingBuild(p.classId);p.weaponReady={};p.facing={...DEFAULT_FACING};
    delete p.target;delete p.downed;delete p.eliminated;delete p.invulnerableUntil;resetSkill(p);
    refreshStats(p);p.hp=p.stats.maxHp;
  }
  add(id:string,name:string,classId:string){
    if(this.players.size>=MAX_PLAYERS)throw new Error('Sala cheia. Máximo de seis jogadores.');
    const slots=Array.from({length:6},(_,i)=>spawnSlot(i,worldSpawn(this.terrain)));
    const spawn=slots.find(s=>[...this.players.values()].every(p=>Math.hypot(p.x-s.x,p.y-s.y)>.3))??worldSpawn(this.terrain);
    const p={...spawn,id,name,classId,hp:0,ack:0,online:true,score:0,spectator:false,stats:{...BASE_STATS}} as ServerPlayer;
    this.equip(p);
    this.players.set(id,p);this.track(id).reset(0);return p;
  }
  remove(id:string){this.players.delete(id);this.tracks.delete(id);}
  private track(id:string){let t=this.tracks.get(id);if(!t){t=new InputTrack();this.tracks.set(id,t);}return t;}
  /** Going offline or coming back: nothing held or queued survives, and the client restarts its steps at the ack. */
  setOnline(id:string,online:boolean){const p=this.players.get(id);if(p){p.online=online;this.track(id).reset(p.ack);delete p.target;}}
  /**
   * A batch of change segments `{seq,steps}` (input-10hz) or one legacy step `{seq,x,y,attack,skill?,target?}`.
   * Refused (false) for offline or spectating players and for anything malformed or out of order; see InputTrack.
   */
  input(id:string,value:unknown,now=this.tick*STEP_MS){
    const p=this.players.get(id),t=this.tracks.get(id);
    if(!p?.online||p.spectator||!t)return false;
    return t.accept(value,p,this.terrain,now);
  }
  /** Skill tap from the client (see InputTrack.tap); false when refused (offline, spectator, stale or repeated id). */
  tap(id:string,tapId:unknown){const p=this.players.get(id),t=this.tracks.get(id);return !!p?.online&&!p.spectator&&!!t&&t.tap(tapId);}
  /** Owner's own position and ack for its frames (InputTrack.confirmed), or undefined for the live ones. */
  confirmed(id:string){return this.tracks.get(id)?.confirmed();}
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
   * balance). `requestId` makes a resent tap apply once. Refused once the run is decided.
   */
  forge(id:string,recipeId:string,requestId?:string):BuyResult{
    const p=this.players.get(id);
    if(this.result||!p?.online||p.spectator)return {ok:false,reason:'player'};
    return this.systems.stonewards.buy(this.world,id,recipeId,requestId);
  }
  /** Node ids of the last frame (the Room prunes the wire ids of the rest). */
  nodeIds:string[]=[];
  /** The wall and the towers as the client sees them. */
  private structureViews():StructureView[]{
    const st=this.systems.stonewards.state,w=st.wall;
    return [{id:w.id,kind:'muralha',x:w.x,y:w.y,hp:w.hp,maxHp:w.maxHp},...st.towers.map(t=>({id:t.id,kind:t.kind,x:t.x,y:t.y,hp:t.hp,maxHp:t.maxHp,untilTick:t.untilTick}))];
  }
  /**
   * Gather nodes near any player with a body, only in a real intermission (round 1+): the union of every client's area
   * of interest (each encoder keeps its own part). Untouched nodes are full.
   */
  private nodeViews():NodeView[]{
    const w=this.world,st=this.systems.stonewards.state;
    if(w.round.phase!=='prepare'||w.round.index<1||st.wallDown){this.nodeIds=[];return [];}
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
    this.nodeIds=[...out.keys()];
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
    this.trackRemovals();
    this.recent=this.recent.filter(r=>r.tick>this.tick-EVENT_BUFFER_TICKS);
    for(const event of events)this.recent.push({tick:this.tick,event});
    return events;
  }
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
  /** Hash of everything that decides future ticks (world, run systems, pending inputs, outcome). */
  stateHash(){return stateHash({world:this.world.state(),systems:this.systems.state(),inputs:[...this.tracks].map(([id,t])=>[id,t.state()]),outcome:this.result??null});}
  /** Pure client view for one player (protocol 4 encodes this in VGM-042b). */
  view(playerId:string):RunView{
    const w=this.world;
    return {
      tick:w.tick,team:{...w.team},round:{...w.round},
      enemies:[...w.enemies.values()].map(e=>({id:e.id,kind:e.kind,x:e.x,y:e.y,hp:e.hp,maxHp:e.maxHp,elite:e.elite,boss:e.boss,phase:e.phase})),
      pickups:[...w.pickups.values()].map(p=>({id:p.id,kind:p.kind,x:p.x,y:p.y,value:p.value,resource:p.resource})),
      projectiles:[...w.projectiles.values()].map(p=>({id:p.id,source:p.source,x:p.x,y:p.y,vx:p.vx,vy:p.vy,radius:p.radius,hostile:p.hostile})),
      telegraphs:[...w.telegraphs.values()].map(t=>({id:t.id,shape:t.shape,x:t.x,y:t.y,radius:t.radius,dx:t.dx,dy:t.dy,width:t.width,fireTick:t.fireTick})),
      structures:this.structureViews(),nodes:this.nodeViews(),camp:this.campView(),
      players:[...this.players.values()].map(p=>({
        id:p.id,name:p.name,classId:p.classId,hp:p.hp,maxHp:p.stats.maxHp,online:p.online,spectator:p.spectator,
        downed:p.downed?{progress:p.downed.progress,bleedOutTick:p.downed.bleedOutTick}:undefined,eliminated:p.eliminated,
        weapons:p.build.weapons.map(i=>({...i})),passives:p.build.passives.map(i=>({...i})),
        skillTick:p.skillTick||undefined,skillReadyTick:p.skillReadyTick||undefined,
        stats:{...this.statsOf(p.id),damage:Math.round(this.statsOf(p.id).damage)},
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
      telegraphs:[...w.telegraphs.values()].map(t=>({id:t.id,shape:t.shape,x:t.x,y:t.y,radius:t.radius,dx:t.dx,dy:t.dy,width:t.width,fireTick:t.fireTick})),
      structures:this.structureViews(),nodes:this.nodeViews(),camp:this.campView(),
      players:[...this.players.values()].map(p=>{
        const stats=this.statsOf(p.id);
        return {
          id:p.id,name:p.name,classId:p.classId,hp:p.hp,maxHp:p.stats.maxHp,online:p.online,spectator:p.spectator,
          downed:p.downed?{progress:p.downed.progress,bleedOutTick:p.downed.bleedOutTick}:undefined,eliminated:p.eliminated||undefined,
          weapons:p.build.weapons,passives:p.build.passives,stats:{...stats,damage:Math.round(stats.damage)},
          x:p.x,y:p.y,ack:p.ack,attackTick:p.attackTick||undefined,skillTick:p.skillTick||undefined,skillReadyTick:p.skillReadyTick||undefined,
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
      ...(this.terrain.chunks?{world:'infinito' as const,generator:CHUNK_VERSION}:{})},t:'state',tick:this.tick,full:true,
      players:[...this.players.values()].map(packPlayer),enemies,removed:[],victory:this.victory,
      x:{round:{...w.round},team:{...w.team},players:[...this.players.values()].map(p=>packPlayerExtra(p,this.statsOf(p.id))),
        pickups:[...w.pickups.values()].map(p=>[p.id,p.kind,round(p.x),round(p.y),p.value]),
        projectiles:[...w.projectiles.values()].map(p=>[p.id,p.source,round(p.x),round(p.y),round(p.vx),round(p.vy),p.radius,p.hostile]),
        telegraphs:[...w.telegraphs.values()].map(t=>({id:t.id,shape:t.shape,x:t.x,y:t.y,radius:t.radius,dx:t.dx,dy:t.dy,width:t.width,fireTick:t.fireTick})),
        events:this.recent.filter(r=>r.event.eventId>sinceEventId).map(r=>wireEvent(r.event))}};
  }
}

type Keyed=[string,...unknown[]];
/** Entries of `after` that are new or differ (by id) from `before`. */
function changed<T extends Keyed>(before:readonly T[],after:readonly T[]):T[]{
  const old=new Map(before.map(b=>[b[0],JSON.stringify(b)]));
  return after.filter(a=>JSON.stringify(a)!==old.get(a[0]));
}
const goneIds=(before:readonly Keyed[],after:readonly Keyed[])=>{const now=new Set(after.map(a=>a[0]));return before.filter(b=>!now.has(b[0])).map(b=>b[0]);};
/** Changed enemies; kind/maxHp/flags are dropped when they match the previous message (protocol 3 reads only id,x,y,hp). */
function changedEnemies(before:readonly EnemyWire[],after:readonly EnemyWire[]):EnemyWire[]{
  const old=new Map(before.map(b=>[b[0],b]));
  const tail=(w:EnemyWire|undefined)=>w&&w.length>4?`${w[4]}|${w[5]}|${w[6]}`:'';
  const out:EnemyWire[]=[];
  for(const a of after){
    const b=old.get(a[0]);
    if(b&&JSON.stringify(a)===JSON.stringify(b))continue;
    out.push(b&&a.length>4&&tail(a)===tail(b)?[a[0],a[1],a[2],a[3]]:a);
  }
  return out;
}

/**
 * Only changed players/enemies (by id) since the previous snapshot; linear in the number of entities.
 * Horde extras: pickups and projectiles are diffed the same way (removed ids in x.gone); terrain is only in full snapshots
 * (the client checks it on welcome). Protocol 4 (VGM-042b) replaces this JSON.
 */
export function delta(previous:Snapshot,next:Snapshot):Snapshot {
  const alive=new Set(next.players.map(n=>n[0]));
  const {terrain:_terrain,...rest}=next;
  const patch:Snapshot={...rest,full:false,players:changed(previous.players,next.players),enemies:changedEnemies(previous.enemies,next.enemies),removed:previous.players.filter(p=>!alive.has(p[0])).map(p=>p[0])};
  if(next.x){
    const before:Partial<RunExtras>&Pick<RunExtras,'pickups'|'projectiles'>=previous.x??{pickups:[],projectiles:[]};
    patch.x={...next.x,pickups:changed(before.pickups,next.x.pickups),projectiles:changed(before.projectiles,next.x.projectiles),
      gone:{pickups:goneIds(before.pickups,next.x.pickups),projectiles:goneIds(before.projectiles,next.x.projectiles)}};
    if(next.x.players)patch.x.players=changed(before.players??[],next.x.players);
  }
  return patch;
}

/** Applies a delta to the last full state (reference merge for horde clients and tests). */
export function applyDelta(state:Snapshot,patch:Snapshot):Snapshot{
  if(patch.full)return patch;
  const players=new Map(state.players.map(p=>[p[0],p]));
  for(const p of patch.players)players.set(p[0],p);
  for(const id of patch.removed)players.delete(id);
  const enemies=new Map(state.enemies.map(e=>[e[0],e]));
  for(const e of patch.enemies){const old=enemies.get(e[0]);enemies.set(e[0],e.length===4&&old&&old.length>4?[e[0],e[1],e[2],e[3],old[4],old[5],old[6]]:e);}
  const merge=<T extends Keyed>(list:readonly T[],update:readonly T[],gone:readonly string[]=[])=>{
    const byId=new Map(list.map(i=>[i[0],i]));for(const i of update)byId.set(i[0],i);for(const id of gone)byId.delete(id);return [...byId.values()];
  };
  const x=patch.x&&state.x?{...patch.x,pickups:merge(state.x.pickups,patch.x.pickups,patch.x.gone?.pickups),projectiles:merge(state.x.projectiles,patch.x.projectiles,patch.x.gone?.projectiles),
    ...(patch.x.players?{players:merge(state.x.players??[],patch.x.players,patch.removed)}:{})}:patch.x;
  if(x)delete x.gone;
  return {...patch,full:true,terrain:state.terrain,players:[...players.values()],enemies:[...enemies.values()],removed:[],...(x?{x}:{})};
}
export type {SimEvent};
