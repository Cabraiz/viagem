import {TerrainField,defaultTerrain,DEFAULT_SEED,TERRAIN_VERSION} from '../terrain/field.ts';
import { moveDirection, SPAWN, type Point } from '../world.ts';
import {SimWorld,stateHash} from '../sim/core.ts';
import {installLegacy,legacyGosmas,toLegacyEnemy,freshCombat,LEGACY_ORDER,type LegacyPlayer} from '../sim/systems/legacy.ts';
import type {EnemyState} from '../sim/types.ts';
import type {RunState} from './run.ts';
export const ROOM_PROTOCOL=3;

export {ATTACK_RANGE,BASIC_COOLDOWN_TICKS,SKILL_RANGE,SKILL_COOLDOWN_TICKS} from '../sim/systems/legacy.ts';
export const STEP = 1 / 20;
export const MAX_PLAYERS = 6;
export const GRACE_MS = 30_000;
export type Input = { seq:number; x:number; y:number; attack:boolean; target?:string; skill?:boolean };
export type Player = Point & { id:string; name:string; classId:string; hp:number; ack:number; online:boolean; score:number; attackTick?:number; spectator?:boolean; skillTick?:number; skillReadyTick?:number };
export type Enemy = Point & { id:string; hp:number };
// Fixed tuple fields avoid repeated property names in frequent patches.
export type PlayerWire = [string,number,number,number,number,boolean,number,string,string,number?,boolean?,number?,number?];
export type EnemyWire = [string,number,number,number];
export type Snapshot = { t:'state'; tick:number; full:boolean; players:PlayerWire[]; enemies:EnemyWire[]; removed:string[]; victory:boolean; run?:RunState; terrain?:{seed:number;version:number;signature:string} };
export const packPlayer = (p:Player):PlayerWire => [p.id,round(p.x),round(p.y),p.hp,p.ack,p.online,p.score,p.name,p.classId,p.attackTick??0,p.spectator??false,p.skillTick??0,p.skillReadyTick??0];
export const packEnemy = (e:Enemy):EnemyWire => [e.id,round(e.x),round(e.y),e.hp];
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
export type ServerPlayer = Player & LegacyPlayer & { spectator:boolean };
const runSeed=(seed:number,run:number)=>(seed^Math.imul(run+1,0x9e3779b9))>>>0;

export class Simulation {
  readonly terrain:TerrainField;
  readonly seed:number;
  readonly players=new Map<string,ServerPlayer>();
  /** Authoritative SimContext. VGM-042 registers the contract systems here. */
  readonly world:SimWorld;
  /** Prototype gosmas, kept after death (hp 0) because protocol 3 snapshots and victory read them. */
  private roster:EnemyState[]=[];
  private runs=0;
  private queues=new Map<string,Input[]>();
  private lastReceived=new Map<string,number>();
  constructor(seed=DEFAULT_SEED){
    this.seed=seed;this.terrain=new TerrainField(seed);
    this.world=new SimWorld({terrain:this.terrain,seed:runSeed(seed,0),players:this.players,order:LEGACY_ORDER});
    installLegacy(this.world,id=>this.queues.get(id)?.shift());
    this.enemies=legacyGosmas();
  }
  get tick(){return this.world.tick;}
  /** Events of the last step, with monotonic eventId. */
  get events(){return this.world.lastEvents;}
  get enemies():EnemyState[]{return this.roster;}
  /** Replaces the prototype enemies; bare {id,x,y,hp} objects are completed in place and stay live. */
  set enemies(list:Enemy[]){
    this.roster=list.map(e=>toLegacyEnemy(e,this.world.tick));
    this.world.enemies.clear();
    for(const e of this.roster)if(e.hp>0)this.world.enemies.set(e.id,e);
  }
  get victory(){return this.roster.every(e=>e.hp===0);}
  resetRun(){
    this.world.reset(runSeed(this.seed,++this.runs));
    this.enemies=legacyGosmas();
    let slot=0;
    for(const p of this.players.values()){
      Object.assign(p,freshCombat(p.classBonus));
      Object.assign(p,{x:SPAWN.x+(slot%3-1)*.7,y:SPAWN.y+Math.floor(slot/3)*.7,hp:p.stats.maxHp,score:0,ack:0,attackTick:0,skillTick:0,skillReadyTick:0});slot++;
      delete p.respawnTick;delete p.target;delete p.downed;delete p.eliminated;delete p.invulnerableUntil;
      this.queues.set(p.id,[]);this.lastReceived.set(p.id,0);
    }
  }
  add(id:string,name:string,classId:string){
    if(this.players.size>=MAX_PLAYERS)throw new Error('Sala cheia. Máximo de seis jogadores.');
    const slots=Array.from({length:6},(_,i)=>({x:SPAWN.x+(i%3-1)*.7,y:SPAWN.y+Math.floor(i/3)*.7}));
    const spawn=slots.find(s=>[...this.players.values()].every(p=>Math.hypot(p.x-s.x,p.y-s.y)>.3))??SPAWN;
    const combat=freshCombat();
    const p:ServerPlayer={...spawn,id,name,classId,hp:combat.stats.maxHp,ack:0,online:true,score:0,spectator:false,...combat};
    this.players.set(id,p);this.queues.set(id,[]);this.lastReceived.set(id,0);return p;
  }
  remove(id:string){this.players.delete(id);this.queues.delete(id);this.lastReceived.delete(id);}
  setOnline(id:string,online:boolean){const p=this.players.get(id);if(p){p.online=online;this.queues.set(id,[]);this.lastReceived.set(id,p.ack);delete p.target;}}
  input(id:string,value:unknown){
    const p=this.players.get(id),q=this.queues.get(id);
    if(!p?.online||p.spectator||!q||!validInput(value)||value.seq<=(this.lastReceived.get(id)??0)||value.seq>p.ack+40||q.length>=8)return false;
    this.lastReceived.set(id,value.seq);q.push({seq:value.seq,x:value.x,y:value.y,attack:value.attack,target:value.target,skill:value.skill});return true;
  }
  /** One server tick; returns its events. */
  step(){this.syncRoster();return this.world.step();}
  /** Direct hp writes on roster gosmas (tests, tools) keep world membership consistent: alive in, dead out. */
  private syncRoster(){
    for(const e of this.roster){
      if(e.hp>0&&!this.world.enemies.has(e.id))this.world.enemies.set(e.id,e);
      else if(!(e.hp>0)&&this.world.enemies.get(e.id)===e)this.world.enemies.delete(e.id);
    }
  }
  /** Hash of everything that decides future ticks (world, prototype roster, pending inputs). */
  stateHash(){return stateHash({world:this.world.state(),roster:this.roster,queues:[...this.queues],lastReceived:[...this.lastReceived]});}
  snapshot():Snapshot{return {terrain:{seed:this.terrain.seed,version:TERRAIN_VERSION,signature:this.terrain.signature},t:'state',tick:this.tick,full:true,players:[...this.players.values()].map(packPlayer),enemies:this.roster.map(packEnemy),removed:[],victory:this.victory};}
}

export function delta(previous:Snapshot,next:Snapshot):Snapshot {
  const changed=<T extends [string,...unknown[]]>(before:T[],after:T[])=>after.filter(a=>JSON.stringify(a)!==JSON.stringify(before.find(b=>b[0]===a[0])));
  return {...next,full:false,players:changed(previous.players,next.players),enemies:changed(previous.enemies,next.enemies),removed:previous.players.filter(p=>!next.players.some(n=>n[0]===p[0])).map(p=>p[0])};
}
