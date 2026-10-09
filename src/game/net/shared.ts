import {TerrainField,defaultTerrain,DEFAULT_SEED,TERRAIN_VERSION} from '../terrain/field.ts';
import { moveDirection, SPAWN, type Point } from '../world.ts';
import {SimWorld,stateHash,type StampedEvent} from '../sim/core.ts';
import {SpatialHash} from '../sim/spatial.ts';
import {coastalSpawnPoints} from '../sim/director.ts';
import {createRunSystems,type RunOutcomeKind,type RunSystems} from '../sim/assemble.ts';
import {RUN_ORDER,DEFAULT_FACING,type PlayerInput,type RunPlayer} from '../sim/systems/players.ts';
import {classBonusOf,startingBuild} from '../sim/kits.ts';
import {resetSkill} from '../sim/skills.ts';
import {refreshStats} from '../sim/stats.ts';
import type {ChooseResult} from '../sim/progression.ts';
import {BASE_STATS} from '../sim/types.ts';
import type {EnemyState,LevelOffer,RoundState,SimEvent} from '../sim/types.ts';
import type {RunView,TelegraphView} from '../sim/view.ts';
import type {RunState} from './run.ts';
export const ROOM_PROTOCOL=3;

/** Client-side ranges for the prototype skill ring (scene.ts). */
export const ATTACK_RANGE=1.8,BASIC_COOLDOWN_TICKS=12,SKILL_RANGE=2.8,SKILL_COOLDOWN_TICKS=160;
export const STEP = 1 / 20;
export const MAX_PLAYERS = 6;
export const GRACE_MS = 30_000;
export type Input = PlayerInput;
export type Player = Point & { id:string; name:string; classId:string; hp:number; ack:number; online:boolean; score:number; attackTick?:number; spectator?:boolean; skillTick?:number; skillReadyTick?:number };
export type Enemy = Point & { id:string; hp:number };
// Fixed tuple fields avoid repeated property names in frequent patches.
export type PlayerWire = [string,number,number,number,number,boolean,number,string,string,number?,boolean?,number?,number?];
/** id,x,y,hp, then kind, maxHp and flags (1 elite, 2 boss); protocol 3 clients read only the first four. A dead enemy is sent once with hp 0. */
export type EnemyWire = [string,number,number,number,string?,number?,number?];
/** Horde extras on top of protocol 3 (ignored by older clients); protocol 4 (VGM-042b) replaces this JSON. */
export interface RunExtras {
  round:RoundState;team:{xp:number;level:number;nextXp:number};
  /** id,kind,x,y,value */
  pickups:[string,string,number,number,number][];
  /** id,source,x,y,vx,vy,radius,hostile */
  projectiles:[string,string,number,number,number,number,number,boolean][];
  telegraphs:TelegraphView[];
  /** Events of the last EVENT_WINDOW ticks; clients de-duplicate by eventId. */
  events:StampedEvent[];
}
export type Snapshot = { t:'state'; tick:number; full:boolean; players:PlayerWire[]; enemies:EnemyWire[]; removed:string[]; victory:boolean; run?:RunState; terrain?:{seed:number;version:number;signature:string}; x?:RunExtras };
export const packPlayer = (p:Player):PlayerWire => [p.id,round(p.x),round(p.y),round(p.hp),p.ack,p.online,p.score,p.name,p.classId,p.attackTick??0,p.spectator??false,p.skillTick??0,p.skillReadyTick??0];
export const packEnemy = (e:Enemy&Partial<EnemyState>):EnemyWire => e.kind===undefined?[e.id,round(e.x),round(e.y),round(e.hp)]:
  [e.id,round(e.x),round(e.y),round(e.hp),e.kind,round(e.maxHp??e.hp),(e.elite?1:0)|(e.boss?2:0)];
export const unpackPlayer = (p:PlayerWire):Player => ({id:p[0],x:p[1],y:p[2],hp:p[3],ack:p[4],online:p[5],score:p[6],name:p[7],classId:p[8],attackTick:p[9]??0,spectator:p[10]??false,skillTick:p[11]??0,skillReadyTick:p[12]??0});
export const unpackEnemy = (e:EnemyWire):Enemy => ({id:e[0],x:e[1],y:e[2],hp:e[3]});
const round=(n:number)=>Math.round(n*1000)/1000;
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
const TOMBSTONE_TICKS=10,EVENT_WINDOW=4;
/** Player attack animation is refreshed at most this often by automatic weapon fire. */
const ATTACK_ANIMATION_TICKS=12;
const spawnSlot=(slot:number)=>({x:SPAWN.x+(slot%3-1)*.7,y:SPAWN.y+Math.floor(slot/3)*.7});

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
  private queues=new Map<string,Input[]>();
  private lastReceived=new Map<string,number>();
  private alive=new Map<string,{x:number;y:number}>();
  private tombs=new Map<string,{wire:EnemyWire;tick:number}>();
  private recent:{tick:number;event:StampedEvent}[]=[];
  constructor(seed=DEFAULT_SEED){
    this.seed=seed;this.terrain=new TerrainField(seed);
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
      takeInput:id=>this.queues.get(id)?.shift(),
      // Inside a step the tick decides (victory beats a same-tick defeat); between ticks (commands) the first outcome stands.
      onOutcome:outcome=>{if(this.result)return;if(this.pending)this.pending[outcome]=true;else this.result=outcome;},
    });
  }
  resetRun(){
    this.systems.dispose();
    this.world.reset(runSeed(this.seed,++this.runs));
    this.world.runStartTick=this.world.tick;
    this.systems=this.assemble();
    this.result=undefined;this.alive.clear();this.tombs.clear();this.recent=[];
    // Spawn points are cached per terrain; computing them now avoids a 60–120 ms hitch at round 1 (D-010).
    coastalSpawnPoints(this.terrain);
    let slot=0;
    for(const p of this.players.values()){
      this.equip(p);Object.assign(p,spawnSlot(slot++),{score:0,ack:0,attackTick:0,skillTick:0,skillReadyTick:0});
      this.queues.set(p.id,[]);this.lastReceived.set(p.id,0);
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
    const slots=Array.from({length:6},(_,i)=>spawnSlot(i));
    const spawn=slots.find(s=>[...this.players.values()].every(p=>Math.hypot(p.x-s.x,p.y-s.y)>.3))??SPAWN;
    const p={...spawn,id,name,classId,hp:0,ack:0,online:true,score:0,spectator:false,stats:{...BASE_STATS}} as ServerPlayer;
    this.equip(p);
    this.players.set(id,p);this.queues.set(id,[]);this.lastReceived.set(id,0);return p;
  }
  remove(id:string){this.players.delete(id);this.queues.delete(id);this.lastReceived.delete(id);}
  setOnline(id:string,online:boolean){const p=this.players.get(id);if(p){p.online=online;this.queues.set(id,[]);this.lastReceived.set(id,p.ack);delete p.target;}}
  input(id:string,value:unknown){
    const p=this.players.get(id),q=this.queues.get(id);
    if(!p?.online||p.spectator||!q||!validInput(value)||value.seq<=(this.lastReceived.get(id)??0)||value.seq>p.ack+40||q.length>=8)return false;
    this.lastReceived.set(id,value.seq);q.push({seq:value.seq,x:value.x,y:value.y,attack:value.attack,target:value.target,skill:value.skill});return true;
  }
  /** Upgrade pick from the offer panel; forged, repeated and out-of-order picks are refused by progression. */
  choose(id:string,offerId:string,index:number):ChooseResult{
    if(this.result)return {ok:false,reason:'no-offer'};
    return this.systems.progression.choose(this.world,id,offerId,index);
  }
  offers(id:string):LevelOffer[]{return this.world.offers.get(id)??[];}
  /** One server tick; returns its events. */
  step(){
    this.pending={victory:false,defeat:false};
    const events=this.world.step();
    if(!this.result)this.result=this.pending.victory?'victory':this.pending.defeat?'defeat':undefined;
    this.pending=undefined;
    for(const e of events)if(e.type==='fire'&&!e.weapon.startsWith('skill:')){
      const p=this.players.get(e.player);
      if(p&&this.tick-(p.attackTick??0)>=ATTACK_ANIMATION_TICKS)p.attackTick=this.tick;
    }
    this.trackRemovals();
    this.recent=this.recent.filter(r=>r.tick>this.tick-EVENT_WINDOW);
    for(const event of events)this.recent.push({tick:this.tick,event});
    return events;
  }
  /** Enemies gone since the last step become tombstones ([id,x,y,0]) for a few ticks, so protocol 3 clients hide them. */
  private trackRemovals(){
    for(const [id,at] of this.alive)if(!this.world.enemies.has(id))this.tombs.set(id,{wire:[id,round(at.x),round(at.y),0],tick:this.tick});
    this.alive.clear();
    for(const e of this.world.enemies.values())this.alive.set(e.id,{x:e.x,y:e.y});
    for(const [id,tomb] of this.tombs)if(tomb.tick<=this.tick-TOMBSTONE_TICKS)this.tombs.delete(id);
  }
  /** Hash of everything that decides future ticks (world, run systems, pending inputs, outcome). */
  stateHash(){return stateHash({world:this.world.state(),systems:this.systems.state(),queues:[...this.queues],lastReceived:[...this.lastReceived],outcome:this.result??null});}
  /** Pure client view for one player (protocol 4 encodes this in VGM-042b). */
  view(playerId:string):RunView{
    const w=this.world;
    return {
      tick:w.tick,team:{...w.team},round:{...w.round},
      enemies:[...w.enemies.values()].map(e=>({id:e.id,kind:e.kind,x:e.x,y:e.y,hp:e.hp,maxHp:e.maxHp,elite:e.elite,boss:e.boss,phase:e.phase})),
      pickups:[...w.pickups.values()].map(p=>({id:p.id,kind:p.kind,x:p.x,y:p.y,value:p.value,resource:p.resource})),
      projectiles:[...w.projectiles.values()].map(p=>({id:p.id,source:p.source,x:p.x,y:p.y,vx:p.vx,vy:p.vy,radius:p.radius,hostile:p.hostile})),
      telegraphs:[...w.telegraphs.values()].map(t=>({id:t.id,shape:t.shape,x:t.x,y:t.y,radius:t.radius,dx:t.dx,dy:t.dy,width:t.width,fireTick:t.fireTick})),
      structures:[],
      players:[...this.players.values()].map(p=>({
        id:p.id,name:p.name,classId:p.classId,hp:p.hp,maxHp:p.stats.maxHp,online:p.online,spectator:p.spectator,
        downed:p.downed?{progress:p.downed.progress,bleedOutTick:p.downed.bleedOutTick}:undefined,eliminated:p.eliminated,
        weapons:p.build.weapons.map(i=>({...i})),passives:p.build.passives.map(i=>({...i})),
      })),
      offers:this.offers(playerId).map(o=>({id:o.id,source:o.source,level:o.level,choices:o.choices.map(c=>({...c})),deadlineTick:o.deadlineTick,defaultIndex:o.defaultIndex})),
      events:[...w.lastEvents],
    };
  }
  snapshot():Snapshot{
    const w=this.world;
    const enemies:EnemyWire[]=[...w.enemies.values()].map(packEnemy);
    for(const tomb of this.tombs.values())if(!w.enemies.has(tomb.wire[0]))enemies.push(tomb.wire);
    return {terrain:{seed:this.terrain.seed,version:TERRAIN_VERSION,signature:this.terrain.signature},t:'state',tick:this.tick,full:true,
      players:[...this.players.values()].map(packPlayer),enemies,removed:[],victory:this.victory,
      x:{round:{...w.round},team:{...w.team},
        pickups:[...w.pickups.values()].map(p=>[p.id,p.kind,round(p.x),round(p.y),p.value]),
        projectiles:[...w.projectiles.values()].map(p=>[p.id,p.source,round(p.x),round(p.y),round(p.vx),round(p.vy),p.radius,p.hostile]),
        telegraphs:[...w.telegraphs.values()].map(t=>({id:t.id,shape:t.shape,x:t.x,y:t.y,radius:t.radius,dx:t.dx,dy:t.dy,width:t.width,fireTick:t.fireTick})),
        events:this.recent.map(r=>r.event)}};
  }
}

/** Only changed players/enemies (by id) since the previous snapshot; linear in the number of entities. */
export function delta(previous:Snapshot,next:Snapshot):Snapshot {
  const changed=<T extends [string,...unknown[]]>(before:T[],after:T[])=>{
    const old=new Map(before.map(b=>[b[0],JSON.stringify(b)]));
    return after.filter(a=>JSON.stringify(a)!==old.get(a[0]));
  };
  const alive=new Set(next.players.map(n=>n[0]));
  return {...next,full:false,players:changed(previous.players,next.players),enemies:changed(previous.enemies,next.enemies),removed:previous.players.filter(p=>!alive.has(p[0])).map(p=>p[0])};
}
export type {SimEvent};
