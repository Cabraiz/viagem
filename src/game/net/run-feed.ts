/**
 * Client run feed (VGM-043): turns what the room sends into the RunView that the horde renderer (VGM-039)
 * and the run HUD (VGM-040) consume. Today the room speaks protocol 3 JSON plus the horde extras (`x`);
 * protocol 4 (VGM-042b) swaps in a feed backed by FrameDecoder behind the same RunFeed interface, so the
 * scene and the HUD do not change. Pure (no DOM, no Phaser): unit-tested under node.
 */
import type {EnemyView,OfferView,PickupView,PlayerRunView,ProjectileView,RunView,TelegraphView} from '../sim/view.ts';
import type {LevelOffer,PickupKind,SimEvent} from '../sim/types.ts';
import type {EnemyWire,PlayerExtraWire,PlayerWire,Snapshot} from './shared.ts';

type StampedEvent=SimEvent&{eventId:number};

/** What the scene and the HUD need from the network, whatever the wire format. */
export interface RunFeed {
  /** Bumps whenever there is something new to show (state, offers). */
  readonly version:number;
  /** Live enemies by id (latest authoritative positions), for tap targeting. */
  readonly enemies:ReadonlyMap<string,EnemyView>;
  /** Latest view; `events` holds the ones received since the previous take, each once and in eventId order. */
  take():RunView;
  /** Pending offers for the local player (the room pushes them on change). */
  setOffers(offers:readonly LevelOffer[]|readonly OfferView[]):void;
  /** Reconnection to a fresh room or a new run: entities and offers start over (D-018: decoder.reset()). */
  reset():void;
}

/** Events kept between two takes (the tab may be in the background); the oldest are cosmetic and dropped first. */
export const MAX_FEED_EVENTS=1500;

const KIND_FALLBACK='gosma';

/** Protocol 3 + horde extras (JSON). */
export class JsonRunFeed implements RunFeed {
  version=0;
  readonly enemies=new Map<string,EnemyView>();
  private players=new Map<string,PlayerRunView>();
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
    this.telegraphs=[];this.bossPhase.clear();this.offers=[];this.events=[];this.round=undefined;this.version++;
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
    this.version++;
  }

  setOffers(offers:readonly LevelOffer[]|readonly OfferView[]){
    this.offers=offers.map(o=>({id:o.id,source:o.source,level:o.level,choices:o.choices.map(c=>({...c})),deadlineTick:o.deadlineTick,defaultIndex:o.defaultIndex}));
    this.version++;
  }

  take():RunView{
    const events=this.events;this.events=[];
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
    const [,maxHp,flags,progress,bleedOutTick,weapons,passives]=extra;
    p.maxHp=Math.max(1,maxHp);
    p.downed=flags&1?{progress,bleedOutTick}:undefined;
    p.eliminated=flags&2?true:undefined;
    p.weapons=weapons.map(([id,level])=>({id,level}));
    p.passives=passives.map(([id,level])=>({id,level}));
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
