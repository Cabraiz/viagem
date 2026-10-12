/**
 * Client run feed (VGM-043): turns what the room sends into the RunView that the horde renderer (VGM-039)
 * and the run HUD (VGM-040) consume. The room speaks protocol 4 since VGM-042b: FrameRunFeed decodes its binary
 * frames behind the RunFeed interface, so the scene and the HUD did not change. JsonRunFeed (protocol 3 JSON plus
 * the horde extras `x`) stays as the reference the JSON snapshot tests use; no room sends it any more.
 * Pure (no DOM, no Phaser): unit-tested under node.
 */
import type {EnemyView,OfferView,PickupView,PlayerRunView,ProjectileView,RunView,TelegraphView} from '../../contract/index.ts';
import type {LevelOffer,PickupKind,SimEvent} from '../../contract/index.ts';
import {unpackStats,type EnemyWire,type PlayerExtraWire,type PlayerWire,type Snapshot} from '../../protocol/index.ts';
import {FrameDecoder,type DecodeResult,type PlayerWireView,type WorldDescriptor} from '../../protocol/index.ts';

type StampedEvent=SimEvent&{eventId:number};

/** What the scene and the HUD need from the network, whatever the wire format. */
export interface RunFeed {
  /** Bumps on each new authoritative state (a tick): the horde renderer is pushed only then. */
  readonly stateVersion:number;
  /** Bumps when the local player's offers change; the HUD refreshes without a horde push (no tick moved). */
  readonly offersVersion:number;
  /** Live enemies by id (latest authoritative positions), for tap targeting. */
  readonly enemies:ReadonlyMap<string,EnemyView>;
  /** HUD state of each player (fall, elimination, build) by id. */
  readonly players:ReadonlyMap<string,PlayerRunView>;
  /** Latest view; `events` holds the ones received since the previous take, each once and in eventId order. */
  take():RunView;
  /** Latest view without consuming events (offer-only refresh). */
  peek():RunView;
  /** Pending offers for the local player (the room pushes them on change). */
  setOffers(offers:readonly LevelOffer[]|readonly OfferView[]):void;
  /** Reconnection to a fresh room or a new run: entities and offers start over (D-018: decoder.reset()). */
  reset():void;
}

/** Events kept between two takes (the tab may be in the background); the oldest are cosmetic and dropped first. */
export const MAX_FEED_EVENTS=1500;

/** Kind of an enemy whose first full record was lost: the basic chaser (D-033), like render/keys.ts enemyKind. */
const KIND_FALLBACK='bebado';

/** Protocol 3 + horde extras (JSON). */
export class JsonRunFeed implements RunFeed {
  stateVersion=0;
  offersVersion=0;
  readonly enemies=new Map<string,EnemyView>();
  readonly players=new Map<string,PlayerRunView>();
  private extras=new Map<string,PlayerExtraWire>();
  private pickups=new Map<string,PickupView>();
  private projectiles=new Map<string,ProjectileView>();
  private telegraphs:TelegraphView[]=[];
  private bossPhase=new Map<string,number>();
  private offers:OfferView[]=[];
  private events:StampedEvent[]=[];
  private lastEventId=-1;
  private tick=0;
  private team={xp:0,level:1,nextXp:1};
  private round?:RunView['round'];

  reset(){
    this.enemies.clear();this.players.clear();this.extras.clear();this.pickups.clear();this.projectiles.clear();
    this.telegraphs=[];this.bossPhase.clear();this.offers=[];this.events=[];this.round=undefined;this.stateVersion++;this.offersVersion++;
  }

  apply(s:Snapshot){
    // A full snapshot older than what we have means a restarted room: its event ids start over too.
    if(s.full&&s.tick<this.tick)this.lastEventId=-1;
    this.tick=s.tick;
    if(s.full){this.enemies.clear();this.players.clear();this.pickups.clear();this.projectiles.clear();}
    for(const p of s.players)this.applyPlayer(p);
    for(const id of s.removed){this.players.delete(id);this.extras.delete(id);}
    for(const e of s.enemies)this.applyEnemy(e);
    const x=s.x;
    if(x){
      this.round=x.round;this.team={...x.team};
      if(s.full)this.extras.clear();
      for(const extra of x.players??[]){this.extras.set(extra[0],extra);const p=this.players.get(extra[0]);if(p)this.syncExtra(p);}
      for(const id of x.gone?.pickups??[])this.pickups.delete(id);
      for(const id of x.gone?.projectiles??[])this.projectiles.delete(id);
      for(const [id,kind,px,py,value] of x.pickups)this.pickups.set(id,{id,kind:kind as PickupKind,x:px,y:py,value});
      for(const [id,source,px,py,vx,vy,radius,hostile] of x.projectiles)this.projectiles.set(id,{id,source,x:px,y:py,vx,vy,radius,hostile});
      this.telegraphs=x.telegraphs;
      for(const event of x.events)this.pushEvent(event as StampedEvent);
    }
    this.stateVersion++;
  }

  setOffers(offers:readonly LevelOffer[]|readonly OfferView[]){
    this.offers=offers.map(o=>({id:o.id,source:o.source,level:o.level,choices:o.choices.map(c=>({...c})),deadlineTick:o.deadlineTick,defaultIndex:o.defaultIndex}));
    this.offersVersion++;
  }

  take():RunView{
    const events=this.events;this.events=[];
    return this.view(events);
  }

  peek():RunView{return this.view([]);}

  private view(events:StampedEvent[]):RunView{
    return {
      tick:this.tick,team:{...this.team},round:this.round?{...this.round}:undefined,
      enemies:[...this.enemies.values()],pickups:[...this.pickups.values()],projectiles:[...this.projectiles.values()],
      telegraphs:this.telegraphs,structures:[],players:[...this.players.values()],offers:this.offers,events,
    };
  }

  private applyPlayer(w:PlayerWire){
    const id=w[0],old=this.players.get(id);
    const p:PlayerRunView={id,name:w[7],classId:w[8],hp:w[3],maxHp:old?.maxHp??Math.max(1,w[3]),online:w[5],spectator:w[10]??false,
      weapons:old?.weapons??[],passives:old?.passives??[],downed:old?.downed,eliminated:old?.eliminated,stats:old?.stats};
    this.players.set(id,p);
    this.syncExtra(p);
  }

  private syncExtra(p:PlayerRunView){
    const extra=this.extras.get(p.id);
    if(!extra)return;
    const [,maxHp,flags,progress,bleedOutTick,weapons,passives,stats]=extra;
    p.maxHp=Math.max(1,maxHp);
    p.downed=flags&1?{progress,bleedOutTick}:undefined;
    p.eliminated=flags&2?true:undefined;
    p.weapons=weapons.map(([id,level])=>({id,level}));
    p.passives=passives.map(([id,level])=>({id,level}));
    // Server run counters (award-stats-server): the result screen trusts these over its own event tally.
    if(Array.isArray(stats)&&stats.length>=9&&stats.every(n=>Number.isFinite(n)))p.stats=unpackStats(stats);
  }

  private applyEnemy(w:EnemyWire){
    const id=w[0];
    // hp 0 is a tombstone (sent a few ticks after the kill): the kill event already played the poof.
    if(w[3]<=0){this.enemies.delete(id);this.bossPhase.delete(id);return;}
    const old=this.enemies.get(id);
    const full=w.length>4;
    const flags=full?(w[6]??0):(old?(old.elite?1:0)|(old.boss?2:0):0);
    const enemy:EnemyView={id,kind:full?(w[4]??KIND_FALLBACK):old?.kind??KIND_FALLBACK,x:w[1],y:w[2],hp:w[3],
      maxHp:full?(w[5]??w[3]):old?.maxHp??w[3],elite:flags&1?true:undefined,boss:flags&2?true:undefined};
    if(enemy.boss)enemy.phase=this.bossPhase.get(id)??1;
    this.enemies.set(id,enemy);
  }

  private pushEvent(event:StampedEvent){
    if(event.eventId<=this.lastEventId)return;
    this.lastEventId=event.eventId;
    if(event.type==='boss-phase'){
      this.bossPhase.set(event.enemy,event.phase);
      const boss=this.enemies.get(event.enemy);if(boss)boss.phase=event.phase;
    }
    this.events.push(event);
    if(this.events.length>MAX_FEED_EVENTS)this.events.splice(0,this.events.length-MAX_FEED_EVENTS);
  }
}

const copyOffers=(offers:readonly LevelOffer[]|readonly OfferView[]):OfferView[]=>
  offers.map(o=>({id:o.id,source:o.source,level:o.level,choices:o.choices.map(c=>({...c})),deadlineTick:o.deadlineTick,defaultIndex:o.defaultIndex}));

/**
 * Protocol 4 (VGM-042b): binary frames through FrameDecoder. Ids are the client-facing ones the frames carry
 * (`e12` for a critter, real ids for players), the same ids the events and the tap target use. An entity that
 * left this client's area of interest (`left`) just disappears: no kill event, so no poof (rede-mapa-grande).
 */
export class FrameRunFeed implements RunFeed {
  stateVersion=0;
  offersVersion=0;
  readonly enemies=new Map<string,EnemyView>();
  readonly players=new Map<string,PlayerWireView>();
  /** The world the frames describe (a full frame always says it); the client checks it against its terrain. */
  world?:WorldDescriptor;
  /** Ids that left the area of interest in the last decoded frame (diagnostics and tests). */
  left:string[]=[];
  private decoder=new FrameDecoder();
  private last?:RunView;
  private offers:OfferView[]=[];
  private events:StampedEvent[]=[];

  /** Decodes one binary frame; on success the view, the maps and the event queue move forward. */
  decode(data:ArrayBuffer|Uint8Array):DecodeResult{
    const result=this.decoder.decode(data);
    if(!result.ok)return result;
    const view=result.view;
    this.enemies.clear();for(const e of view.enemies)this.enemies.set(e.id,e);
    this.players.clear();for(const p of view.players)this.players.set(p.id,p as PlayerWireView);
    if(result.world)this.world=result.world;
    this.left=result.left;
    for(const event of view.events)this.events.push(event);
    if(this.events.length>MAX_FEED_EVENTS)this.events.splice(0,this.events.length-MAX_FEED_EVENTS);
    this.last=view;this.stateVersion++;
    return result;
  }

  setOffers(offers:readonly LevelOffer[]|readonly OfferView[]){this.offers=copyOffers(offers);this.offersVersion++;}
  /** Room bots (D-025, from the run state's members): their players come out with `bot: true`. */
  private bots:ReadonlySet<string>=new Set();
  setBots(ids:readonly string[]){if(ids.length!==this.bots.size||ids.some(id=>!this.bots.has(id)))this.bots=new Set(ids);}

  take():RunView{const events=this.events;this.events=[];return this.view(events);}

  peek():RunView{return this.view([]);}

  /** New connection (D-018): the decoder forgets its baselines, but keeps the seen event ids (no replays). */
  reset(){
    this.decoder.reset();this.enemies.clear();this.players.clear();this.offers=[];this.events=[];this.last=undefined;this.left=[];
    this.stateVersion++;this.offersVersion++;
  }

  private view(events:StampedEvent[]):RunView{
    const v=this.last;
    return {
      tick:v?.tick??0,team:v?{...v.team}:{xp:0,level:1,nextXp:1},round:v?.round?{...v.round}:undefined,...(v?.wave?{wave:{...v.wave}}:{}),
      enemies:v?.enemies??[],pickups:v?.pickups??[],projectiles:v?.projectiles??[],telegraphs:v?.telegraphs??[],structures:v?.structures??[],
      nodes:v?.nodes??[],...(v?.camp?{camp:{...v.camp}}:{}),
      players:this.bots.size&&v?v.players.map(p=>this.bots.has(p.id)?{...p,bot:true}:p):v?.players??[],offers:this.offers,events,
    };
  }
}

/** Per-player damage dealt to enemies, from `damage` events (the room does not send stats yet: card N2-award-stats-server). */
export class DamageTally {
  private totals=new Map<string,number>();
  private lastEventId=-1;
  /** isPlayer: damage on a player is taken, not dealt (the killing blow's enemy may already be gone, so test the player side). */
  add(view:Pick<RunView,'events'>,isPlayer:(id:string)=>boolean){
    for(const event of view.events){
      if(event.eventId<=this.lastEventId)continue;
      this.lastEventId=event.eventId;
      if(event.type==='damage'&&event.source&&!isPlayer(event.target))this.totals.set(event.source,(this.totals.get(event.source)??0)+event.amount);
    }
  }
  of(id:string){return Math.round(this.totals.get(id)??0);}
  /** New run: totals clear, event de-duplication continues (ids are monotonic, D-011). */
  reset(){this.totals.clear();}
}
