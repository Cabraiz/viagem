/**
 * Protocol 4 (VGM-041, wide map in NEW-20261009-ORQ-rede-mapa-grande): binary server -> client run frames,
 * delta-encoded per entity against the last frame the client acknowledged, plus JSON control messages.
 * Not wired into the Room yet (VGM-042b).
 *
 * Frame layout (little endian, varints are LEB128, signed varints zigzag):
 *   u8 magic 0x56 'V' | u8 version 4 | uvar seq | uvar baseSeq (0 = full frame) | uvar tick | svar originX | svar originY
 *   team: uvar xp, uvar level, uvar nextXp
 *   u8 flags (bit0 round, bit1 wave, bit2 world) | round? | wave? | world? (u8 kind, uvar terrain version,
 *     uvar generator version, uvar seed, str signature; in every full frame and whenever it changes)
 *   6 entity sections (players, enemies, pickups, projectiles, telegraphs, structures):
 *     uvar removedCount, (uvar idGap*2 + left)* | uvar upsertCount, (uvar idGap, uvar mask, [label], [i8 dx, i8 dy], fields*)*
 *     `left` = 1: the entity still exists but left this client's area of interest (not a death: no poof).
 *   events: uvar count, (uvar eventIdGap, u8 code, [u8 optional bits], fields*)*
 * Positions are at 1/512 unit everywhere in the endless world: i16 relative to the frame origin (an integer point by
 * the client's player, so ±64 units around it cost 2 bytes), or the escape i16 -32768 followed by an absolute svar
 * (allies far away, a far base, up to ±4 194 304 units). Velocities are i16 at 1/256 unit/s, radii u16 at 1/256 unit.
 * Ticks inside a frame are signed offsets from the frame tick. Known strings travel as one-byte
 * dictionary indexes; unknown ones inline as UTF-8.
 * Wire ids are monotonic per entity type and never reused, so a client baseline can never confuse two entities.
 * Events are resent (after resendTicks, or right after a resync) until the client acks a frame that carried them;
 * the decoder drops ids it has seen. Entity references inside events are wire ids, not strings.
 * Area of interest: an encoder with a `viewer` sends every player (allies always, for the minimap), structures (the
 * base) and the boss, plus enemies, pickups, projectiles and telegraphs within INTEREST_RADIUS of the viewer (kept
 * until INTEREST_HYSTERESIS farther), and drops the events nobody near the viewer could see.
 */
import type {OfferChoice,OfferSource,PickupKind,RoundState,SimEvent} from '../sim/types.ts';
import type {EnemyView,OfferView,PickupView,PlayerRunView,ProjectileView,RunView,StructureView,TelegraphView} from '../sim/view.ts';
import {INTEREST_HYSTERESIS,INTEREST_RADIUS} from '../sim/offscreen.ts';

export const PROTOCOL_VERSION=4;
const MAGIC=0x56;
export const POS_SCALE=512,VEL_SCALE=256,RADIUS_SCALE=256;
/** Positions are clamped to ±POS_LIMIT units (the endless world ends at ±1 000 000, chunks.ts WORLD_LIMIT). */
export const POS_LIMIT=2**22;
const POS_ESCAPE=-32768;
/** Hard limits the decoder enforces, so garbage cannot allocate unbounded memory. */
export const MAX_SECTION_ITEMS=4096,MAX_EVENTS=1024,MAX_STRING_BYTES=256;
/** Frames the server and the client remember for delta baselines. */
export const HISTORY=64;
/** Unacked events kept for resending; older ones are dropped (cosmetic damage numbers first). */
export const MAX_PENDING_EVENTS=512;

// ---------- Dictionaries (append only: indexes are part of the wire format) ----------
export const DICT:readonly string[]=[
  '',
  // enemy kinds
  'gosma','pernilongo','tio-pave','fiscal','elite','chefe',
  // pickup kinds and resources
  'xp','heal','magnet','chest','resource','coco','pedra',
  // weapons and evolutions
  'chinelo','boleto','cafe','guarda-chuva','pombo','audio','chinelo-evo','boleto-evo','cafe-evo',
  // passives
  'cafe-forte','marmita','tenis','megafone','bone','ima','oculos','cartao',
  // telegraph shapes, structures, round phases, offer sources
  'circle','line','cone','muralha','torre','wave','prepare','end','level','round',
  // event types
  'downed','revived','eliminated',
  // legacy weapons, heal offer choice
  'basico','habilidade','heal',
];
const DICT_INDEX=new Map(DICT.map((s,i)=>[s,i]));
const INLINE_STRING=255;

// ---------- Byte writer / reader ----------
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const MAX_SVAR=2**51;
/** Truncates a string so its UTF-8 form fits MAX_STRING_BYTES, without splitting a code point. */
export function clip(s:string){
  if(s.length*3<=MAX_STRING_BYTES||encoder.encode(s).length<=MAX_STRING_BYTES)return s;
  let out='',bytes=0;
  for(const ch of s){const n=encoder.encode(ch).length;if(bytes+n>MAX_STRING_BYTES)break;out+=ch;bytes+=n;}
  return out;
}
/** What a number becomes on the wire when it is not finite. */
const finite=(v:number)=>Number.isFinite(v)?v:0;
class Writer {
  buf=new Uint8Array(1024);len=0;
  private grow(n:number){if(this.len+n<=this.buf.length)return;let size=this.buf.length*2;while(size<this.len+n)size*=2;const next=new Uint8Array(size);next.set(this.buf.subarray(0,this.len));this.buf=next;}
  u8(v:number){this.grow(1);this.buf[this.len++]=v&255;}
  uvar(v:number){
    // Server bugs (NaN, Infinity, huge numbers) must never hang the encoder or corrupt a frame.
    v=Number.isFinite(v)?Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,Math.floor(v))):0;
    this.grow(8);
    while(v>=128){this.buf[this.len++]=(v%128)|128;v=Math.floor(v/128);}
    this.buf[this.len++]=v;
  }
  svar(v:number){v=Number.isFinite(v)?Math.max(-MAX_SVAR,Math.min(MAX_SVAR,Math.round(v))):0;this.uvar(v<0?-2*v-1:2*v);}
  i16(v:number){this.grow(2);const n=Math.max(-32768,Math.min(32767,Math.round(finite(v))));this.buf[this.len++]=n&255;this.buf[this.len++]=(n>>8)&255;}
  u16(v:number){this.grow(2);const n=Math.max(0,Math.min(65535,Math.round(finite(v))));this.buf[this.len++]=n&255;this.buf[this.len++]=n>>8;}
  str(s:string){
    const i=DICT_INDEX.get(s);
    if(i!==undefined){this.u8(i);return;}
    const bytes=encoder.encode(clip(s));
    this.u8(INLINE_STRING);this.uvar(bytes.length);this.raw(bytes);
  }
  raw(bytes:Uint8Array){this.grow(bytes.length);this.buf.set(bytes,this.len);this.len+=bytes.length;}
  bytes(){return this.buf.slice(0,this.len);}
}
export class FrameError extends Error {}
class Reader {
  pos=0;
  readonly buf:Uint8Array;
  constructor(buf:Uint8Array){this.buf=buf;}
  private need(n:number){if(this.pos+n>this.buf.length)throw new FrameError('truncated frame');}
  u8(){this.need(1);return this.buf[this.pos++];}
  uvar(){
    let v=0,mul=1;
    for(let i=0;i<8;i++){
      const b=this.u8();v+=(b&127)*mul;
      if(b<128){if(!Number.isSafeInteger(v))throw new FrameError('varint overflow');return v;}
      mul*=128;
    }
    throw new FrameError('varint too long');
  }
  svar(){const u=this.uvar();return u%2?-(u+1)/2:u/2;}
  i16(){this.need(2);const v=this.buf[this.pos]|(this.buf[this.pos+1]<<8);this.pos+=2;return v>=32768?v-65536:v;}
  u16(){this.need(2);const v=this.buf[this.pos]|(this.buf[this.pos+1]<<8);this.pos+=2;return v;}
  str(){
    const i=this.u8();
    if(i!==INLINE_STRING){if(i>=DICT.length)throw new FrameError('unknown dictionary string');return DICT[i];}
    const n=this.uvar();if(n>MAX_STRING_BYTES)throw new FrameError('string too long');
    this.need(n);
    try{return decoder.decode(this.buf.subarray(this.pos,this.pos+=n));}catch{throw new FrameError('bad utf-8');}
  }
  take(n:number){this.need(n);return this.buf.subarray(this.pos,this.pos+=n);}
  count(max:number){const n=this.uvar();if(n>max)throw new FrameError('count over limit');return n;}
}

// ---------- Field codecs ----------
/** What a field needs from its frame: the tick (relative ticks) and the integer origin (relative positions). */
interface FrameCtx {tick:number;ox:number;oy:number}
interface Codec<V> {
  write(w:Writer,v:V,f:FrameCtx):void;
  read(r:Reader,f:FrameCtx):V;
  /** The value the client ends up with after a write/read round trip. */
  norm(v:V):V;
  eq(a:V,b:V):boolean;
}
const clampI16=(n:number)=>Math.max(-32768,Math.min(32767,Math.round(finite(n))));
const clampU16=(n:number)=>Math.max(0,Math.min(65535,Math.round(finite(n))));
const same=(a:unknown,b:unknown)=>a===b;
function scaled(scale:number,signed:boolean):Codec<number>{
  return {
    write:(w,v)=>signed?w.i16(v*scale):w.u16(v*scale),
    read:r=>(signed?r.i16():r.u16())/scale,
    norm:v=>(signed?clampI16(finite(v)*scale):clampU16(finite(v)*scale))/scale,
    eq:same,
  };
}
const vel=scaled(VEL_SCALE,true),radius=scaled(RADIUS_SCALE,false);
/** Position in 1/512 unit steps, as the integer count the client ends up with. */
const posQ=(v:number)=>Math.max(-POS_LIMIT*POS_SCALE,Math.min(POS_LIMIT*POS_SCALE,Math.round(finite(v)*POS_SCALE)));
/** Origin-relative position on one axis; exact at any distance (the escape carries the absolute value). */
function wide(axis:'ox'|'oy'):Codec<number>{
  return {
    write:(w,v,f)=>{
      const q=posQ(v),rel=q-f[axis]*POS_SCALE;
      if(rel>POS_ESCAPE&&rel<=32767)w.i16(rel);else{w.i16(POS_ESCAPE);w.svar(q);}
    },
    read:(r,f)=>{
      const rel=r.i16();
      if(rel!==POS_ESCAPE)return (f[axis]*POS_SCALE+rel)/POS_SCALE;
      const q=r.svar();if(Math.abs(q)>POS_LIMIT*POS_SCALE)throw new FrameError('position out of range');
      return q/POS_SCALE;
    },
    norm:v=>posQ(v)/POS_SCALE,
    eq:same,
  };
}
const posX=wide('ox'),posY=wide('oy');
/** Non-negative quantity rounded up to an integer (hp, xp, values): a sliver of hp still shows. */
/** Matches Writer.uvar: non-finite -> 0, clamped to safe integers. */
const uint=(v:number)=>Number.isFinite(v)?Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,Math.floor(v))):0;
const count:Codec<number>={write:(w,v)=>w.uvar(Math.ceil(v)),read:r=>r.uvar(),norm:v=>uint(Math.ceil(v)),eq:same};
/** Absolute tick as an offset from the frame tick. */
const tickRel:Codec<number>={write:(w,v,f)=>w.svar(v-f.tick),read:(r,f)=>f.tick+r.svar(),norm:v=>Math.round(finite(v)),eq:same};
/** 0..1 as a byte. */
const unitByte=(v:number)=>Math.round(Math.max(0,Math.min(1,finite(v)))*255);
const unit:Codec<number>={write:(w,v)=>w.u8(unitByte(v)),read:r=>r.u8()/255,norm:v=>unitByte(v)/255,eq:same};
const str:Codec<string>={write:(w,v)=>w.str(v),read:r=>r.str(),norm:v=>clip(v),eq:same};
const bool:Codec<boolean>={write:(w,v)=>w.u8(v?1:0),read:r=>r.u8()===1,norm:v=>!!v,eq:same};
function optional<V>(c:Codec<V>):Codec<V|undefined>{
  return {
    write:(w,v,f)=>{if(v===undefined)w.u8(0);else{w.u8(1);c.write(w,v,f);}},
    read:(r,f)=>r.u8()?c.read(r,f):undefined,
    norm:v=>v===undefined?undefined:c.norm(v),
    eq:(a,b)=>a===undefined||b===undefined?a===b:c.eq(a,b),
  };
}
type Item={id:string;level:number};
const items:Codec<Item[]>={
  write:(w,v)=>{w.uvar(v.length);for(const it of v){w.str(it.id);w.uvar(it.level);}},
  read:r=>Array.from({length:r.count(32)},()=>({id:r.str(),level:r.uvar()})),
  norm:v=>v.slice(0,32).map(it=>({id:clip(it.id),level:uint(it.level)})),
  eq:(a,b)=>a.length===b.length&&a.every((it,i)=>it.id===b[i].id&&it.level===b[i].level),
};
type Downed={progress:number;bleedOutTick:number};
const downed=optional<Downed>({
  write:(w,v,f)=>{unit.write(w,v.progress,f);tickRel.write(w,v.bleedOutTick,f);},
  read:(r,f)=>({progress:unit.read(r,f),bleedOutTick:tickRel.read(r,f)}),
  norm:v=>({progress:unit.norm(v.progress),bleedOutTick:tickRel.norm(v.bleedOutTick)}),
  eq:(a,b)=>a.progress===b.progress&&a.bleedOutTick===b.bleedOutTick,
});
type Contribution={damage:number;kills:number;revives:number;pickups:number};
const contribution=optional<Contribution>({
  write:(w,v)=>{w.uvar(v.damage);w.uvar(v.kills);w.uvar(v.revives);w.uvar(v.pickups);},
  read:r=>({damage:r.uvar(),kills:r.uvar(),revives:r.uvar(),pickups:r.uvar()}),
  norm:v=>({damage:uint(v.damage),kills:uint(v.kills),revives:uint(v.revives),pickups:uint(v.pickups)}),
  eq:(a,b)=>a.damage===b.damage&&a.kills===b.kills&&a.revives===b.revives&&a.pickups===b.pickups,
});

/**
 * Player record on the wire: the view plus optional position and last processed input seq, so the client
 * can render and reconcile players from protocol 4 alone (view.ts stays unchanged).
 */
export type PlayerWireView=PlayerRunView&{x?:number;y?:number;ack?:number};
type SectionKey='players'|'enemies'|'pickups'|'projectiles'|'telegraphs'|'structures';
export const SECTIONS:readonly SectionKey[]=['players','enemies','pickups','projectiles','telegraphs','structures'];
type AnyCodec=Codec<unknown>;
interface Schema {
  prefix:string;
  fields:Record<string,AnyCodec>;
  /** Linear motion: the decoder moves x/y by vx/vy between frames, so they are only sent on drift. */
  extrapolate?:boolean;
}
const c=<V>(codec:Codec<V>)=>codec as unknown as AnyCodec;
const SCHEMAS:Record<SectionKey,Schema>={
  players:{prefix:'',fields:{
    name:c(str),classId:c(str),hp:c(count),maxHp:c(count),online:c(bool),spectator:c(bool),downed:c(downed),eliminated:c(optional(bool)),
    weapons:c(items),passives:c(items),stats:c(contribution),x:c(optional(posX)),y:c(optional(posY)),ack:c(optional(count)),
  }},
  enemies:{prefix:'e',fields:{
    kind:c(str),x:c(posX),y:c(posY),hp:c(count),maxHp:c(count),elite:c(optional(bool)),boss:c(optional(bool)),phase:c(optional(count)),
  }},
  pickups:{prefix:'k',fields:{kind:c(str),x:c(posX),y:c(posY),value:c(count),resource:c(optional(str))}},
  projectiles:{prefix:'p',fields:{source:c(str),x:c(posX),y:c(posY),vx:c(vel),vy:c(vel),radius:c(radius),hostile:c(bool)},extrapolate:true},
  telegraphs:{prefix:'t',fields:{
    shape:c(str),x:c(posX),y:c(posY),radius:c(radius),dx:c(optional(vel)),dy:c(optional(vel)),width:c(optional(radius)),fireTick:c(tickRel),
  }},
  structures:{prefix:'s',fields:{kind:c(str),x:c(posX),y:c(posY),hp:c(count),maxHp:c(count)}},
};
const SECTION_BY_PREFIX=new Map(SECTIONS.filter(s=>s!=='players').map(s=>[SCHEMAS[s].prefix,s]));
/** Server tick rate; kept here so the client module does not import server code. */
const WIRE_HZ=20;

// ---------- Wire ids ----------
/**
 * Maps server string ids to client-facing ids (`e12`, `k3`, ...), shared by every encoder of a room.
 * Numbers are monotonic per section and never reused. Players keep their real ids on the client.
 */
export class WireIds {
  private next:Record<string,number>={};
  private toWire=new Map<string,number>();
  private toServer=new Map<string,string>();
  private key(section:SectionKey,id:string){return section+'\u0000'+id;}
  wire(section:SectionKey,serverId:string):number{
    const key=this.key(section,serverId);
    let n=this.toWire.get(key);
    if(n===undefined){
      n=this.next[section]=(this.next[section]??0)+1;
      this.toWire.set(key,n);
      if(section!=='players')this.toServer.set(SCHEMAS[section].prefix+n,serverId);
    }
    return n;
  }
  has(section:SectionKey,serverId:string){return this.toWire.has(this.key(section,serverId));}
  label(section:SectionKey,serverId:string){return section==='players'?serverId:SCHEMAS[section].prefix+this.wire(section,serverId);}
  /** Server id for a client-facing id (e.g. a tapped enemy `e12`), or undefined. */
  resolve(clientId:string){return this.toServer.get(clientId);}
  /** New run (server ids restart, e.g. `xp-1` again): forget the map, keep counters so wire ids stay unique. */
  reset(){this.toWire.clear();this.toServer.clear();}
  /** Forget ids of entities gone for good (call with the live server ids, e.g. once per second). */
  prune(live:Partial<Record<SectionKey,Iterable<string>>>){
    for(const section of SECTIONS){
      const ids=live[section];
      if(section==='players'||!ids)continue;
      const keep=new Set(ids),prefix=section+'\u0000';
      for(const [key,n] of this.toWire)if(key.startsWith(prefix)&&!keep.has(key.slice(prefix.length))){
        this.toWire.delete(key);this.toServer.delete(SCHEMAS[section].prefix+n);
      }
    }
  }
}

// ---------- Events ----------
export type WireEvent=SimEvent&{eventId:number};
type EventField=[name:string,kind:'ref'|'pos'|'vel'|'count'|'tick'|'str',optional?:boolean,hint?:SectionKey];
/** Field layout per event type. Codes are the index in this list: append only. */
const EVENT_SPECS:[SimEvent['type'],EventField[]][]=[
  ['damage',[['target','ref',false,'enemies'],['amount','count'],['source','ref',true],['weapon','str',true],['crit','count',true]]],
  ['kill',[['enemy','ref',false,'enemies'],['kind','str'],['x','pos'],['y','pos'],['by','ref',true]]],
  ['spawn-warning',[['x','pos'],['y','pos'],['atTick','tick'],['count','count']]],
  ['fire',[['player','ref'],['weapon','str'],['x','pos'],['y','pos'],['dx','vel',true],['dy','vel',true]]],
  ['pickup',[['player','ref'],['pickup','ref',false,'pickups'],['kind','str'],['value','count']]],
  ['levelup',[['level','count']]],
  ['offer',[['player','ref'],['offer','str']]],
  ['upgrade',[['player','ref'],['item','str'],['level','count']]],
  ['evolve',[['player','ref'],['from','str'],['to','str']]],
  ['downed',[['player','ref'],['by','ref',true]]],
  ['revived',[['player','ref'],['by','ref',true]]],
  ['eliminated',[['player','ref'],['by','ref',true]]],
  ['telegraph',[['telegraph','ref',false,'telegraphs']]],
  ['boss-phase',[['enemy','ref',false,'enemies'],['phase','count']]],
  ['wave',[['index','count'],['label','str']]],
  ['round',[['index','count'],['phase','str'],['name','str',true],['modifier','str',true]]],
  ['bark',[['enemy','ref',false,'enemies'],['line','str']]],
  ['structure',[['id','ref',false,'structures'],['hp','count'],['maxHp','count']]],
];
const EVENT_CODE=new Map<string,number>(EVENT_SPECS.map(([type],i)=>[type,i]));
const REF_INLINE=0,REF_PLAYER=1;
const REF_SECTIONS:SectionKey[]=['enemies','pickups','projectiles','telegraphs','structures'];
const LABEL=/^([a-z])(\d{1,9})$/;

function writeEvent(w:Writer,e:WireEvent,f:FrameCtx,ids:WireIds){
  const [,fields]=EVENT_SPECS[EVENT_CODE.get(e.type)!];
  const rec=e as unknown as Record<string,unknown>;
  w.u8(EVENT_CODE.get(e.type)!);
  let present=0;
  fields.forEach(([name,,opt],i)=>{if(opt&&rec[name]!==undefined&&rec[name]!==false)present|=1<<i;});
  if(fields.some(f=>f[2]))w.u8(present);
  fields.forEach(([name,kind,opt],i)=>{
    if(opt&&!(present>>i&1))return;
    const v=rec[name];
    switch(kind){
      case 'ref':writeRef(w,String(v),ids);return;
      case 'pos':(name==='y'?posY:posX).write(w,Number(v),f);return;
      case 'vel':vel.write(w,Number(v),f);return;
      case 'count':w.uvar(v===true?1:Math.ceil(Number(v)));return;
      case 'tick':tickRel.write(w,Number(v),f);return;
      case 'str':w.str(String(v));return;
    }
  });
}
function writeRef(w:Writer,label:string,ids:WireIds){
  if(ids.has('players',label)){w.u8(REF_PLAYER);w.uvar(ids.wire('players',label));return;}
  const m=LABEL.exec(label),section=m&&SECTION_BY_PREFIX.get(m[1]);
  if(m&&section){w.u8(2+REF_SECTIONS.indexOf(section));w.uvar(Number(m[2]));return;}
  w.u8(REF_INLINE);w.str(label);
}
function readEvent(r:Reader,eventId:number,f:FrameCtx,players:Table):WireEvent{
  const code=r.u8(),spec=EVENT_SPECS[code];
  if(!spec)throw new FrameError('unknown event type');
  const [type,fields]=spec;
  const present=fields.some(f=>f[2])?r.u8():0;
  const e:Record<string,unknown>={type,eventId};
  fields.forEach(([name,kind,opt],i)=>{
    if(opt&&!(present>>i&1))return;
    switch(kind){
      case 'ref':{
        const tag=r.u8();
        if(tag===REF_INLINE)e[name]=r.str();
        else if(tag===REF_PLAYER){const n=r.uvar();e[name]=players.get(n)?.id??`player-${n}`;}
        else{const section=REF_SECTIONS[tag-2];if(!section)throw new FrameError('bad reference');e[name]=SCHEMAS[section].prefix+r.uvar();}
        return;
      }
      case 'pos':e[name]=(name==='y'?posY:posX).read(r,f);return;
      case 'vel':e[name]=vel.read(r,f);return;
      case 'count':e[name]=name==='crit'?r.uvar()>0:r.uvar();return;
      case 'tick':e[name]=tickRel.read(r,f);return;
      case 'str':e[name]=r.str();return;
    }
  });
  if(type==='round'&&e.phase!=='wave'&&e.phase!=='prepare'&&e.phase!=='end')throw new FrameError('bad round phase');
  return e as unknown as WireEvent;
}

// ---------- Frames ----------
type Entity={id:string}&Record<string,unknown>;
/** One section as the client holds it: wire id -> record with client-facing id. */
type Table=Map<number,Entity>;
interface World {tick:number;tables:Record<SectionKey,Table>}
const emptyTables=()=>Object.fromEntries(SECTIONS.map(s=>[s,new Map()])) as Record<SectionKey,Table>;

/** Copy of a baseline section as the client sees it at `tick` (linear motion applied). */
function advance(schema:Schema,base:Table|undefined,tick:number,baseTick:number):Table{
  const table:Table=new Map();
  if(!base)return table;
  const dt=(tick-baseTick)/WIRE_HZ;
  for(const [id,e] of base){
    if(schema.extrapolate)table.set(id,{...e,x:(e.x as number)+(e.vx as number)*dt,y:(e.y as number)+(e.vy as number)*dt});
    else table.set(id,{...e});
  }
  return table;
}

/** Terrain the frames are about (rede-mapa-grande): the client builds the same TerrainField from it. */
export interface WorldDescriptor {kind:'ilha'|'infinito';terrainVersion:number;generatorVersion:number;seed:number;signature:string}
const WORLD_KINDS=['ilha','infinito'] as const;
const sameWorld=(a?:WorldDescriptor,b?:WorldDescriptor)=>!!a&&!!b&&a.kind===b.kind&&a.terrainVersion===b.terrainVersion&&
  a.generatorVersion===b.generatorVersion&&a.seed===b.seed&&a.signature===b.signature;

/** What the server hands the encoder each frame: a RunView with server ids, minus offers and events. */
export type FrameInput=Omit<RunView,'offers'|'events'|'players'>&{players:PlayerWireView[];world?:WorldDescriptor};
export interface EncoderStats {frames:number;fullFrames:number;bytes:number;eventBytes:number;
  /** Entities left out by the area of interest (summed over frames), and events dropped as out of sight. */
  culled:number;droppedEvents:number}
/** firstSeq: earliest frame that carried the event since the last resync; an ack of it or later retires the event. */
interface Pending {event:WireEvent;firstSeq?:number;sentTick?:number;unresolved?:[field:string,hint?:SectionKey][]}
export interface InterestOptions {radius:number;hysteresis:number}
export interface EncoderOptions {
  /**
   * The client's player id. With it the encoder sends only that client's area of interest (allies, structures and
   * the boss always; the rest within `interest.radius` of the viewer) and frames are relative to the viewer.
   */
  viewer?:string;
  /** Area of interest; false sends everything (the island room, tests). Default INTEREST_RADIUS/INTEREST_HYSTERESIS. */
  interest?:Partial<InterestOptions>|false;
}
/** Events every client needs, wherever they happened (team progress, falls and revives, rounds, the wall). */
const GLOBAL_EVENTS=new Set<string>(['levelup','offer','upgrade','evolve','downed','revived','eliminated','wave','round','structure','boss-phase']);
type Point2={x:number;y:number};

/**
 * Per-client encoder. Call `pushEvents` every tick with that tick's events, `encode` at the send rate,
 * and `ack` when the client confirms a frame. The encoder mirrors exactly what the client decoded,
 * so quantization and extrapolation errors never accumulate.
 */
export class FrameEncoder {
  private seq=0;
  private history=new Map<number,World>();
  private acked=0;
  private eventId=0;
  private pending:Pending[]=[];
  /** Server ids per section sent in this frame and the previous one (hysteresis, event relevance). */
  private members:Partial<Record<SectionKey,Set<string>>>={};
  private previous:Partial<Record<SectionKey,Set<string>>>={};
  private sentWorld?:WorldDescriptor;
  /** Unacked events are sent again after this many ticks (and right after a resync). */
  resendTicks=WIRE_HZ;
  readonly stats:EncoderStats={frames:0,fullFrames:0,bytes:0,eventBytes:0,culled:0,droppedEvents:0};
  readonly ids:WireIds;
  readonly viewer?:string;
  private readonly interest?:InterestOptions;
  constructor(ids=new WireIds(),options:EncoderOptions={}){
    this.ids=ids;this.viewer=options.viewer;
    if(options.viewer!==undefined&&options.interest!==false)
      this.interest={radius:options.interest?.radius??INTEREST_RADIUS,hysteresis:options.interest?.hysteresis??INTEREST_HYSTERESIS};
  }

  /**
   * Translates and queues events; call in the same tick they were emitted, while their ids are known.
   * Keeps the server's eventId when present (revive quips derive from it), otherwise numbers them.
   */
  pushEvents(events:Iterable<SimEvent&{eventId?:number}>){
    for(const event of events){
      const spec=EVENT_SPECS[EVENT_CODE.get(event.type)??-1];
      if(!spec)continue;
      const id=event.eventId!==undefined&&event.eventId>this.eventId?event.eventId:this.eventId+1;
      this.eventId=id;
      const e={...event,eventId:id} as unknown as Record<string,unknown>;
      const unresolved:[string,SectionKey?][]=[];
      for(const [name,kind,,hint] of spec[1]){
        const v=e[name];
        if(kind!=='ref'||typeof v!=='string')continue;
        // Known ids are fixed now (they may be pruned later); unknown ones wait for the frame's sections.
        const label=this.known(v);
        if(label===undefined)unresolved.push([name,hint]);else e[name]=label;
      }
      this.pending.push({event:e as unknown as WireEvent,...(unresolved.length?{unresolved}:{})});
    }
    if(this.pending.length>MAX_PENDING_EVENTS){
      // Drop cosmetic damage numbers first, then the oldest of anything else.
      let excess=this.pending.length-MAX_PENDING_EVENTS;
      this.pending=this.pending.filter(p=>!(excess>0&&p.event.type==='damage'&&excess--));
      if(this.pending.length>MAX_PENDING_EVENTS)this.pending.splice(0,this.pending.length-MAX_PENDING_EVENTS);
    }
  }
  private known(serverId:string){
    if(this.ids.has('players',serverId))return serverId;
    for(const s of REF_SECTIONS)if(this.ids.has(s,serverId))return this.ids.label(s,serverId);
    return undefined;
  }
  /** Resolves ids still unknown at push time, after this frame registered its players and entities. */
  private resolve(p:Pending){
    if(!p.unresolved)return;
    const e=p.event as unknown as Record<string,unknown>;
    for(const [name,hint] of p.unresolved){
      const v=e[name] as string;
      e[name]=this.known(v)??(hint?this.ids.label(hint,v):v);
    }
    delete p.unresolved;
  }

  /** Events still waiting for an ack (for monitoring and tests). */
  get pendingEvents(){return this.pending.length;}

  /** The client decoded frame `seq`. Old, future or unknown acks are ignored. */
  ack(seq:number,_eventId?:number){
    if(!Number.isSafeInteger(seq)||seq<=this.acked||seq>this.seq||!this.history.has(seq))return;
    this.acked=seq;
    this.pending=this.pending.filter(p=>p.firstSeq===undefined||p.firstSeq>seq);
    for(const s of this.history.keys())if(s<seq)this.history.delete(s);
  }
  /** Client lost its baselines (reconnect or decode error): next frame is full and unacked events go again. */
  resync(){
    // Late acks for frames before the resync must not revive a baseline the client dropped.
    this.acked=0;this.history.clear();this.sentWorld=undefined;
    for(const p of this.pending){p.firstSeq=undefined;p.sentTick=undefined;}
  }

  /** Where this client's frame is centred: `focus`, else the viewer's player, else no area of interest. */
  private focusOf(view:FrameInput,focus?:Point2):Point2|undefined{
    if(focus&&Number.isFinite(focus.x)&&Number.isFinite(focus.y))return focus;
    if(this.viewer===undefined)return undefined;
    const me=view.players.find(p=>p.id===this.viewer);
    if(me&&Number.isFinite(me.x)&&Number.isFinite(me.y))return {x:me.x!,y:me.y!};
    // A spectator without a body: follow the first player who has one.
    const other=view.players.find(p=>!p.spectator&&!p.eliminated&&Number.isFinite(p.x)&&Number.isFinite(p.y));
    return other?{x:other.x!,y:other.y!}:undefined;
  }
  /** The entities of a section this client gets, as wire id -> server entity. */
  private select(section:SectionKey,list:readonly Entity[],focus:Point2|undefined):Map<number,Entity>{
    const current=new Map<number,Entity>();
    const interest=this.interest,always=section==='players'||section==='structures';
    if(!interest||!focus||always){
      for(const e of list)current.set(this.ids.wire(section,e.id),e);
      if(interest){this.previous[section]=this.members[section];this.members[section]=new Set(list.map(e=>e.id));}
      return current;
    }
    const before=this.members[section],keep=new Set<string>();
    this.previous[section]=before;
    const near=interest.radius,stay=interest.radius+interest.hysteresis;
    for(const e of list){
      const x=e.x as number,y=e.y as number;
      let d=Math.hypot(x-focus.x,y-focus.y);
      if(section==='telegraphs')d-=Math.max(0,finite(e.radius as number))+Math.max(0,finite((e.width as number|undefined)??0));
      // The boss is always sent: the arrow to it and its hp bar matter from anywhere.
      const inside=(section==='enemies'&&e.boss===true)||d<=near||(d<=stay&&!!before?.has(e.id));
      if(!inside){this.stats.culled++;continue;}
      keep.add(e.id);current.set(this.ids.wire(section,e.id),e);
    }
    this.members[section]=keep;
    return current;
  }
  /**
   * Whether a not yet sent event concerns what this client can see: global events always; others when they
   * happen within the area, involve the viewer or a player in the area, or name an entity this client has (or
   * had in the previous frame, e.g. the one that just died). Judged on server ids, before resolving labels.
   */
  private relevant(p:Pending,focus:Point2|undefined,players:readonly PlayerWireView[]):boolean{
    const e=p.event;
    if(!this.interest||!focus||GLOBAL_EVENTS.has(e.type))return true;
    const rec=e as unknown as Record<string,unknown>,radius=this.interest.radius+this.interest.hysteresis;
    if(typeof rec.x==='number'&&typeof rec.y==='number'&&Math.hypot(rec.x-focus.x,rec.y-focus.y)<=radius)return true;
    const [,fields]=EVENT_SPECS[EVENT_CODE.get(e.type)!];
    for(const [name,kind] of fields){
      const v=rec[name];
      if(kind!=='ref'||typeof v!=='string')continue;
      if(v===this.viewer)return true;
      const player=players.find(o=>o.id===v);
      if(player){if(Number.isFinite(player.x)&&Math.hypot(player.x!-focus.x,player.y!-focus.y)<=radius)return true;continue;}
      const raw=p.unresolved?.some(([n])=>n===name)?v:this.ids.resolve(v);
      if(raw!==undefined)for(const s of REF_SECTIONS)if(this.members[s]?.has(raw)||this.previous[s]?.has(raw))return true;
    }
    return false;
  }

  /** `focus` overrides where the area of interest is centred (a spectator following someone). */
  encode(view:FrameInput,options:{focus?:Point2}={}):Uint8Array{
    const seq=++this.seq,base=this.history.get(this.acked);
    const focus=this.focusOf(view,options.focus);
    const f:FrameCtx={tick:view.tick,ox:focus?Math.round(focus.x):0,oy:focus?Math.round(focus.y):0};
    if(!(Math.abs(f.ox)<=POS_LIMIT))f.ox=0;
    if(!(Math.abs(f.oy)<=POS_LIMIT))f.oy=0;
    const w=new Writer();
    w.u8(MAGIC);w.u8(PROTOCOL_VERSION);w.uvar(seq);w.uvar(base?this.acked:0);w.uvar(view.tick);w.svar(f.ox);w.svar(f.oy);
    w.uvar(view.team.xp);w.uvar(view.team.level);w.uvar(view.team.nextXp);
    const sendWorld=!!view.world&&(!base||!sameWorld(view.world,this.sentWorld));
    w.u8((view.round?1:0)|(view.wave?2:0)|(sendWorld?4:0));
    if(view.round){
      const r=view.round;
      w.uvar(r.index);w.uvar(r.total);w.str(r.phase);w.svar(r.phaseEndsTick-view.tick);w.uvar(r.remaining);
    }
    if(view.wave){w.uvar(view.wave.index);w.str(view.wave.label);w.str(view.wave.phase??'');}
    if(sendWorld){
      const d=view.world!;
      w.u8(WORLD_KINDS.indexOf(d.kind)<0?0:WORLD_KINDS.indexOf(d.kind));w.uvar(d.terrainVersion);w.uvar(d.generatorVersion);w.uvar(d.seed);w.str(d.signature);
      this.sentWorld={...d,signature:clip(d.signature)};
    }
    const world:World={tick:view.tick,tables:emptyTables()};
    for(const section of SECTIONS){
      const schema=SCHEMAS[section],list=view[section] as unknown as Entity[];
      const client=advance(schema,base?.tables[section],view.tick,base?.tick??view.tick);
      const current=this.select(section,list,focus);
      // Removed from this client but still in the world: it left the area of interest (no death poof).
      let alive:Set<string>|undefined;
      const exists=this.interest?(label:string)=>{
        alive??=new Set(list.map(e=>e.id));
        return alive.has(section==='players'?label:this.ids.resolve(label)??'');
      }:()=>false;
      world.tables[section]=writeSection(w,schema,current,client,f,(id)=>this.ids.label(section,id),exists);
    }
    const start=w.len;
    // Events are judged once, on their first frame: those nobody near this client could see are dropped.
    if(this.interest&&focus)this.pending=this.pending.filter(p=>{
      if(p.sentTick!==undefined||this.relevant(p,focus,view.players))return true;
      this.stats.droppedEvents++;return false;
    });
    const due=this.pending.filter(p=>p.sentTick===undefined||view.tick-p.sentTick>=this.resendTicks);
    w.uvar(due.length);
    let last=0;
    for(const p of due){
      w.uvar(p.event.eventId-last);last=p.event.eventId;
      this.resolve(p);
      writeEvent(w,p.event,f,this.ids);
      p.firstSeq??=seq;p.sentTick=view.tick;
    }
    this.stats.eventBytes+=w.len-start;
    this.history.set(seq,world);
    if(this.history.size>HISTORY){
      const oldest=Math.min(...this.history.keys());
      this.history.delete(oldest);
      if(oldest===this.acked)this.acked=0;
    }
    const bytes=w.bytes();
    this.stats.frames++;if(!base)this.stats.fullFrames++;this.stats.bytes+=bytes.length;
    return bytes;
  }
}

/** Mask bits: 0 = moved a little (two i8 position deltas follow), 1 = new entity, then one bit per field. */
const NUDGE=1,NEW=2,FIELD_BIT=2;
const bit=(field:number)=>2**(field+FIELD_BIT);
const has=(mask:number,field:number)=>Math.floor(mask/bit(field))%2===1;
/**
 * Writes one section and returns the client's resulting table. Layout: removed ids (gap*2 + left-interest bit),
 * then upserts as (id gap, mask, [player id if new], [i8 dx, i8 dy if moved a little], changed fields).
 * Ids are ascending gaps. Non-player client ids are derived from the wire id (prefix + number), so they never
 * travel as text. `exists`: whether a client id is still in the server world (its removal is a culling).
 */
function writeSection(w:Writer,schema:Schema,current:Map<number,Entity>,client:Table,f:FrameCtx,label:(serverId:string)=>string,exists:(clientId:string)=>boolean):Table{
  const keys=Object.keys(schema.fields);
  const xi=keys.indexOf('x'),yi=keys.indexOf('y');
  const removed=[...client.keys()].filter(id=>!current.has(id)).sort((a,b)=>a-b);
  w.uvar(removed.length);
  let last=0;
  for(const id of removed){w.uvar((id-last)*2+(exists(client.get(id)!.id)?1:0));last=id;client.delete(id);}
  const ups:{id:number;mask:number;e:Entity;nx?:number;ny?:number}[]=[];
  for(const id of [...current.keys()].sort((a,b)=>a-b)){
    const cur=current.get(id)!,prev=client.get(id);
    const next:Entity=prev?{...prev}:{id:label(cur.id)};
    let mask=prev?0:NEW;
    keys.forEach((k,j)=>{
      const codec=schema.fields[k],v=codec.norm(cur[k]);
      if(prev&&(j===xi||j===yi)&&typeof v==='number'&&typeof prev[k]==='number'){
        // Positions: the client keeps its own (possibly extrapolated) value until it drifts by a quantum.
        if(!(Math.abs((prev[k] as number)-finite(cur[k] as number))<=(schema.extrapolate?1:.5)/POS_SCALE)){mask+=bit(j);next[k]=v;}
        return;
      }
      if(prev?codec.eq(prev[k],v):v===undefined)return;
      mask+=bit(j);
      if(v===undefined)delete next[k];else next[k]=v;
    });
    let nx:number|undefined,ny:number|undefined;
    if(prev&&xi>=0&&(has(mask,xi)||has(mask,yi))&&typeof prev.x==='number'&&typeof prev.y==='number'&&typeof cur.x==='number'&&typeof cur.y==='number'){
      const dx=Math.round((cur.x-prev.x)*POS_SCALE),dy=Math.round((cur.y-prev.y)*POS_SCALE);
      if(Math.abs(dx)<=127&&Math.abs(dy)<=127){
        mask=mask-(has(mask,xi)?bit(xi):0)-(has(mask,yi)?bit(yi):0)+NUDGE;nx=dx;ny=dy;
        next.x=prev.x+dx/POS_SCALE;next.y=prev.y+dy/POS_SCALE;
      }
    }
    client.set(id,next);
    if(mask)ups.push({id,mask,e:next,nx,ny});
  }
  w.uvar(ups.length);
  last=0;
  for(const u of ups){
    w.uvar(u.id-last);last=u.id;w.uvar(u.mask);
    if(u.mask&NEW&&!schema.prefix)w.str(u.e.id);
    if(u.mask&NUDGE){w.u8(u.nx!&255);w.u8(u.ny!&255);}
    keys.forEach((k,j)=>{if(has(u.mask,j))schema.fields[k].write(w,u.e[k],f);});
  }
  return client;
}

function readSection(r:Reader,schema:Schema,client:Table,f:FrameCtx,left:string[]):Table{
  const keys=Object.keys(schema.fields);
  const removed=r.count(MAX_SECTION_ITEMS);
  let last=0;
  for(let i=0;i<removed;i++){
    const v=r.uvar(),gap=Math.floor(v/2);if(!gap)throw new FrameError('ids out of order');
    last+=gap;
    const gone=client.get(last);
    if(v%2&&gone)left.push(gone.id);
    client.delete(last);
  }
  const n=r.count(MAX_SECTION_ITEMS);
  last=0;
  for(let i=0;i<n;i++){
    const gap=r.uvar();if(!gap)throw new FrameError('ids out of order');
    const id=last+=gap,mask=r.uvar();
    if(mask>=bit(keys.length))throw new FrameError('bad field mask');
    const prev=client.get(id);
    if(!(mask&NEW)&&!prev)throw new FrameError('delta for unknown entity');
    const e:Entity=mask&NEW?{id:schema.prefix?schema.prefix+id:r.str()}:{...prev!};
    if(mask&NUDGE){
      if(typeof e.x!=='number'||typeof e.y!=='number')throw new FrameError('nudge without position');
      const i8=(b:number)=>b>=128?b-256:b;
      e.x=e.x+i8(r.u8())/POS_SCALE;e.y=e.y+i8(r.u8())/POS_SCALE;
    }
    keys.forEach((k,j)=>{
      if(!has(mask,j))return;
      const v=schema.fields[k].read(r,f);
      if(v===undefined)delete e[k];else e[k]=v;
    });
    client.set(id,e);
  }
  return client;
}

// ---------- Client decoder ----------
export type DecodeResult={ok:true;view:RunView;seq:number;ack:AckMessage;
  /** Client ids removed because they left this client's area of interest (not dead: no poof, no kill). */
  left:string[];
  /** The world the frames describe, once a frame has said it (every full frame does when the server knows it). */
  world?:WorldDescriptor}|{ok:false;error:string;resync?:boolean};
/** Event ids the decoder remembers for de-duplication. */
const SEEN_EVENTS=4096;
/**
 * Client decoder. Feed every binary frame to `decode`; send the returned `ack` back as JSON.
 * Offers arrive as JSON control messages and are merged into each view.
 */
export class FrameDecoder {
  private history=new Map<number,World>();
  private lastSeq=0;
  private seen=new Set<number>();
  private seenOrder:number[]=[];
  private floor=0;
  private world?:WorldDescriptor;
  offers:OfferView[]=[];

  decode(data:ArrayBuffer|Uint8Array):DecodeResult{
    try{
      const bytes=data instanceof Uint8Array?data:new Uint8Array(data);
      const r=new Reader(bytes);
      if(r.u8()!==MAGIC)return {ok:false,error:'not a protocol 4 frame'};
      if(r.u8()!==PROTOCOL_VERSION)return {ok:false,error:'protocol version mismatch'};
      const seq=r.uvar(),baseSeq=r.uvar(),tick=r.uvar(),ox=r.svar(),oy=r.svar();
      if(Math.abs(ox)>POS_LIMIT||Math.abs(oy)>POS_LIMIT)throw new FrameError('origin out of range');
      const f:FrameCtx={tick,ox,oy};
      if(seq<=this.lastSeq)return {ok:false,error:'stale frame'};
      const base=baseSeq?this.history.get(baseSeq):undefined;
      if(baseSeq&&!base)return {ok:false,error:'missing baseline',resync:true};
      const team={xp:r.uvar(),level:r.uvar(),nextXp:r.uvar()};
      const flags=r.u8();
      if(flags>7)throw new FrameError('bad flags');
      let round:RoundState|undefined,wave:RunView['wave'],world=this.world;
      if(flags&1){
        const index=r.uvar(),total=r.uvar(),phase=r.str(),phaseEndsTick=tick+r.svar(),remaining=r.uvar();
        if(phase!=='wave'&&phase!=='prepare')throw new FrameError('bad round phase');
        round={index,total,phase,phaseEndsTick,remaining};
      }
      if(flags&2){
        const index=r.uvar(),label=r.str(),phase=r.str();
        wave={index,label,...(phase==='wave'||phase==='prepare'?{phase}:{})};
      }
      if(flags&4){
        const kind=WORLD_KINDS[r.u8()];if(!kind)throw new FrameError('unknown world');
        world={kind,terrainVersion:r.uvar(),generatorVersion:r.uvar(),seed:r.uvar(),signature:r.str()};
      }
      const next:World={tick,tables:emptyTables()},left:string[]=[];
      for(const section of SECTIONS){
        const schema=SCHEMAS[section];
        next.tables[section]=readSection(r,schema,advance(schema,base?.tables[section],tick,base?.tick??tick),f,left);
      }
      const count=r.count(MAX_EVENTS),events:WireEvent[]=[],fresh:number[]=[];
      let eventId=0;
      for(let i=0;i<count;i++){
        const gap=r.uvar();if(!gap)throw new FrameError('event ids out of order');
        eventId+=gap;
        const e=readEvent(r,eventId,f,next.tables.players);
        if(eventId>this.floor&&!this.seen.has(eventId)&&!fresh.includes(eventId)){events.push(e);fresh.push(eventId);}
      }
      if(r.pos!==bytes.length)throw new FrameError('trailing bytes');
      // Commit only after the whole frame parsed: a bad frame leaves the decoder untouched.
      this.lastSeq=seq;this.world=world;
      for(const id of fresh){this.seen.add(id);this.seenOrder.push(id);}
      while(this.seenOrder.length>SEEN_EVENTS){const old=this.seenOrder.shift()!;this.seen.delete(old);this.floor=Math.max(this.floor,old);}
      this.history.set(seq,next);
      for(const s of this.history.keys())if(s<=seq-HISTORY)this.history.delete(s);
      // Views are copies: the HUD or renderer mutating them must not corrupt the baselines.
      const list=<T>(s:SectionKey)=>[...next.tables[s].values()].map(e=>structuredClone(e)) as unknown as T[];
      const view:RunView={
        tick,team,...(round?{round}:{}),...(wave?{wave}:{}),
        players:list<PlayerWireView>('players').map(p=>({...p,weapons:p.weapons??[],passives:p.passives??[]})),
        enemies:list<EnemyView>('enemies'),pickups:list<PickupView>('pickups'),
        projectiles:list<ProjectileView>('projectiles'),telegraphs:list<TelegraphView>('telegraphs'),structures:list<StructureView>('structures'),
        offers:this.offers.map(o=>({...o,choices:o.choices.map(c=>({...c}))})),
        events,
      };
      return {ok:true,view,seq,ack:{t:'ack',seq,event:Math.max(this.floor,...fresh,0)},left,...(world?{world:{...world}}:{})};
    }catch(error){
      return {ok:false,error:error instanceof FrameError?error.message:'malformed frame'};
    }
  }

  /**
   * Call on every reconnect (new socket, restarted room): forgets baselines and the last seq, so the new
   * server encoder's frames are accepted; keeps the seen event ids, so resent events are not applied twice.
   */
  reset(){this.history.clear();this.lastSeq=0;}

  /** Applies a JSON control message that affects the view (offers). Returns false when it is not one. */
  applyControl(message:ControlMessage):boolean{
    if(message.t!=='offers')return false;
    this.offers=message.offers.filter(isOfferView);
    return true;
  }
}

// ---------- JSON control messages ----------
export interface AckMessage {t:'ack';seq:number;event:number}
export interface ChooseMessage {t:'choose';offer:string;index:number}
export interface OffersMessage {t:'offers';offers:OfferView[]}
export interface ResyncMessage {t:'resync'}
export type ControlMessage=AckMessage|ChooseMessage|OffersMessage|ResyncMessage;

const isInt=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):v is number=>Number.isSafeInteger(v)&&(v as number)>=min&&(v as number)<=max;
function isOfferView(o:unknown):o is OfferView{
  if(!o||typeof o!=='object')return false;
  const v=o as Record<string,unknown>;
  return typeof v.id==='string'&&(v.source==='level'||v.source==='round')&&isInt(v.level)&&isInt(v.deadlineTick)&&isInt(v.defaultIndex,0,8)&&
    Array.isArray(v.choices)&&v.choices.length<=8&&v.choices.every(c=>!!c&&typeof (c as OfferChoice).itemId==='string'&&isInt((c as OfferChoice).level,0,99));
}
/** Parses and validates a client -> server control message (never trust the client). */
export function parseClientControl(text:string):AckMessage|ChooseMessage|ResyncMessage|undefined{
  if(text.length>512)return undefined;
  let m:unknown;try{m=JSON.parse(text);}catch{return undefined;}
  if(!m||typeof m!=='object')return undefined;
  const v=m as Record<string,unknown>;
  if(v.t==='ack'&&isInt(v.seq)&&(v.event===undefined||isInt(v.event)))return {t:'ack',seq:v.seq,event:(v.event as number|undefined)??0};
  if(v.t==='choose'&&typeof v.offer==='string'&&v.offer.length<=64&&isInt(v.index,0,7))return {t:'choose',offer:v.offer,index:v.index};
  if(v.t==='resync')return {t:'resync'};
  return undefined;
}
/** Parses a server -> client control message for the decoder. */
export function parseServerControl(text:string):OffersMessage|undefined{
  if(text.length>16_384)return undefined;
  let m:unknown;try{m=JSON.parse(text);}catch{return undefined;}
  if(!m||typeof m!=='object')return undefined;
  const v=m as Record<string,unknown>;
  if(v.t==='offers'&&Array.isArray(v.offers))return {t:'offers',offers:v.offers.filter(isOfferView)};
  return undefined;
}
export type {OfferSource};
