/**
 * Protocol 4 (VGM-041, wide map in NEW-20261009-ORQ-rede-mapa-grande): binary server -> client run frames,
 * delta-encoded per entity against the last frame the client acknowledged, plus JSON control messages.
 * The Room speaks it since VGM-042b (ROOM_PROTOCOL 4): binary frames out, JSON control messages both ways.
 *
 * Frame layout (little endian, varints are LEB128, signed varints zigzag):
 *   u8 magic 0x56 'V' | u8 version (PROTOCOL_VERSION) | uvar seq | uvar baseSeq (0 = full frame) | uvar tick | svar originX | svar originY
 *   team: uvar xp, uvar level, uvar nextXp
 *   u8 flags (bit0 round, bit1 wave, bit2 world, bit3 camp) | round? | wave? | world? (u8 kind, uvar terrain version,
 *     uvar generator version, uvar seed, str signature; in every full frame and whenever it changes) |
 *     camp? (u8 bits: 1 horn, 2 wall down; uvar units (whole, D-048); svar hornEndsTick-tick if horn)
 *   7 entity sections (players, enemies, pickups, projectiles, telegraphs, structures, nodes):
 *     uvar removedCount, (uvar idGap*2 + left)* | uvar upsertCount, (uvar idGap, uvar mask, [label], [i8 dx, i8 dy], fields*)*
 *     `left` = 1: the entity still exists but left this client's area of interest (not a death: no poof).
 *   events: uvar count, (uvar eventIdGap, uvar byteLength, u8 code, [u8 optional bits], fields*)*
 *     byteLength covers code, bits and fields: a decoder skips event codes it does not know (a newer room) and
 *     ignores fields appended after the ones it knows, instead of throwing the whole frame away.
 * Positions are at 1/512 unit everywhere in the endless world: i16 relative to the frame origin (an integer point by
 * the client's player, so ±64 units around it cost 2 bytes), or the escape i16 -32768 followed by an absolute svar
 * (allies far away, a far base, up to ±4 194 304 units). Velocities are i16 at 1/256 unit/s, radii u16 at 1/256 unit.
 * Ticks inside a frame are signed offsets from the frame tick. Known strings travel as one-byte
 * dictionary indexes; unknown ones inline as UTF-8.
 * Wire ids are monotonic per entity type and never reused, so a client baseline can never confuse two entities.
 * Events are resent (after resendTicks, or right after a resync) until the client acks a frame that carried them;
 * the decoder drops ids it has seen. Entity references inside events are wire ids, not strings.
 * Area of interest: an encoder with a `viewer` sends every player (allies always, for the minimap), structures (the
 * base) and the boss, plus enemies, pickups, projectiles, telegraphs and nodes within INTEREST_RADIUS of the viewer (kept
 * until INTEREST_HYSTERESIS farther), and drops the events nobody near the viewer could see.
 */
import type {OfferChoice,OfferSource,PickupKind,RoundState,SimEvent} from '../contract/index.ts';
import type {CampView,EnemyView,NodeView,OfferView,PickupView,PlayerRunView,ProjectileView,RunView,StructureView,TelegraphView} from '../contract/index.ts';
import type {TelegraphKind} from '../contract/index.ts';
import {CIDA_ITEM_IDS,INTEREST_HYSTERESIS,INTEREST_RADIUS,TELEGRAPH_KINDS,visibleOffset} from '../contract/index.ts';
import type {MotoMode,ObjectiveStopKind,ObjectiveView} from '../contract/index.ts';

/**
 * 5 since E7-skill-hud-wiring: every event carries its byte length (and the `skill` event exists), so a 4 decoder
 * would misread any frame with events. 6 since VGM-046B (Stonewards): the camp block (flag bit 3), a seventh section
 * (gather nodes) and the towers' `untilTick`; a 5 decoder would refuse the flags or misread the sections. 7 since
 * VGM-053B: the zueira events (`happening`: boleto rain, flash sale, blackout) and the round's last critter
 * (`last-bicho`, the kill-cam); a 6 decoder would skip them silently (no blackout, no kill-cam), so the version moves.
 * 8 since D-034: the world kind 'cidade' (Cidade Nevada, seed 0 + asset sha256); a 7 decoder would refuse the frame's
 * world byte, so it must ask to update instead. 9 since D-036: the player's slow/slip state (prediction), the telegraph
 * kind and the D-033 cast in the DICT; an 8 decoder would refuse the player field mask and read the new dictionary
 * indexes as unknown strings. 10 since the P1 cast (NEW-20261012-ORQ-elenco-p1): 'coach', 'motoboy' and 'influencer'
 * in the DICT (they went inline in 9: 1 + 1 + their UTF-8 bytes each, on every enemy, kill and downed event); a 9
 * decoder would read their indexes as unknown strings. 11 since torres-fio: the tower defenses in the structures (four
 * optional fields: tier, branch, phase, aim) and their ids, phases and branches in the DICT; a 10 decoder would refuse
 * the structure field mask. 12 since the roster of D-040
 * (NEW-20261013-ORQ-papeis-de-inimigo): the atiradores' generic shot 'tiro' and the 64 P0 pack enemies in the DICT
 * (the P1/P2 ids stay inline: 0xFF + length + UTF-8); an 11 decoder would read their indexes as unknown strings.
 * 13 since torre-contador-de-tiros: a defense's volley counter (`shots`, one byte mod 256) in the structures; a 12
 * decoder would refuse the structure field mask.
 * 14 since velocidade-heroi-e-projetil: the same bytes, but the hero walks 2× (maps heroSpeed) and shots fly at half
 * speed, and the phone predicts its own walk (maps/prediction.ts moveStep): a 13 client in front of a 14 room (or the
 * other way round) would be corrected on every input, so the versions must not meet.
 * 15 since the chaveiro objective (D-047, NEW-20261013-ORQ-objetivo-chaveiro): the objective block (flag bit 4: the moto,
 * ETA, alarm, Grana, Dona Cida, the car; its static route and stops on full frames and when they change), the car's
 * `parts` in the structures, `sugar` on the enemies, Dona Cida's buffs on the players (fastUntil drives the prediction),
 * the events alarm/part/moto/sale/buy and their strings in the DICT; a 14 decoder would refuse the flags and the masks.
 * 16 since ficha-de-torre (D-048): the camp carries one uvar `units` (the team's single pile of material, the fichas de
 * torre come from it) instead of coco and pedra.
 * The join handshake refuses other versions with the update message.
 */
export const PROTOCOL_VERSION=16;
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
  // Stonewards (protocol 6): tower kind, forge recipes and node `say` keys
  'torre-chinelo','reparo','gambiarra','no-coco','no-pedra',
  // Zueira events (protocol 7, VGM-053B); the boleto marker on rain pickups is 'boleto' (already above)
  'boletos','promo','apagao',
  // D-036 (protocol 9): the D-033 cast ('pombos' is also the ShameKey), the agiota's hostile boleto and the telegraph
  // kinds (TELEGRAPH_KINDS; 'coco' is above). Each was 1 + 1 + its UTF-8 bytes inline in protocol 8.
  'bebado','anao-molotov','pombos','agiota','boleto-juros',
  'arroto','molotov','fogo','explosao','pancada','investida','varredura','carimbo',
  // Protocol 10 (NEW-20261012-ORQ-elenco-p1): the P1 cast. Each was 1 + 1 + its UTF-8 bytes inline in protocol 9.
  'coach','motoboy','influencer',
  // Protocol 11 (torres-fio): the tower defenses (src/sim/towers/catalog.ts DefenseId), their phases and branches.
  'vigia-do-predio','vigias-armados','atiradores-do-telhado','ninho-de-metralhadora','guarnicao-do-predio','ninho-do-sniper',
  'equipe-antimaterial','rojao-de-festa','morteiro','lanca-foguetes','obuseiro','gustavao','holofote','arame-e-sirene',
  'antiaerea-quadrupla','posto-de-radar','obra-1','obra-2','obra-3','pronta','danificada','ruina','A','B','C',
  // Protocol 12 (NEW-20261013-ORQ-papeis-de-inimigo, D-040): the generic hostile shot of the atiradores and the 64 P0
  // pack entries of the roster (rules/enemy-roster.ts), in roster order; the nine legacy kinds were already above. P1/P2
  // roster ids go inline (0xFF + uvar length + UTF-8): 96 + 1 + 164 = 261 would not fit under the escape.
  // 161 strings: index 255 is the inline escape, so 94 slots are left.
  'tiro',
  // pack 1 (design/proximos/04-INIMIGOS-*.md)
  'flanelinha-interdimensional','ambulante-guarda-chuva','malabarista-do-sinal','bebado-do-karaoke','dono-do-boteco',
  'tiozinho-da-sinuca','rato-de-boteco','barata-voadora','perueiro','marronzinho','pamonheiro','espetinho-suspeito',
  'tio-do-isopor','bebum-de-carrinho','grauzeiro','moco-do-gas','ressaca-ambulante','paredao-ambulante',
  // pack 2 (design/proximos/05-INIMIGOS-*.md)
  'gerente-vampiro','boleto-vivo','carimbador','estagiario-imortal','chefe-pizza','telemarketing','subsindico',
  'vizinho-da-furadeira','cliente-do-gerente','caixa-eletronico','guru-cripto','vendedor-de-piramide',
  'impressora-possuida','seguranca-de-shopping','leao-da-receita','robo-de-atendimento',
  // pack 3 (design/proximos/06-INIMIGOS-*.md)
  'tia-do-zap','primo-do-violao','cunhado-sabe-tudo','sogra-do-chinelo','dj-de-casamento','bolo-vivo',
  'balao-rancoroso','hater-anonimo','bot-de-curtida','torcedor-fanatico','juiz-vendido','crossfiteiro-do-pneu',
  'quadrilheiro','fogueteiro','boneco-gigante','noel-derretendo',
  // pack 4 (design/proximos/07-INIMIGOS-*.md)
  'capivara-blindada','pombo-tres-cabecas','pernilongo-vampiro','cachorro-de-madame','furry-de-convencao',
  'poste-gambiarra','rei-do-boteco','caminhao-do-lixo','pombo-rei','trio-eletrico','rainha-das-baratas',
  'o-grande-credor','dj-do-fim-do-mundo','o-algoritmo',
  // Protocol 15 (D-047, the chaveiro objective): the car and the moto, the objective kind, the moto's modes and moments
  // (morta/lombada/entrega are also the stop kinds), the car's parts and Dona Cida's sweets.
  'quadradao','moto','chaveiro','anda','lombada','entrega','morta','tombo','volta','abrindo','tranco','chegou',
  'para-choque','retrovisor','porta','capo','brigadeiro','pacoca','cocada',
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
/** A counter mod 256 in one byte (a defense's volleys, torre-contador-de-tiros). */
const byteCount=(v:number)=>((Math.round(finite(v))%256)+256)%256;
const u8:Codec<number>={write:(w,v)=>w.u8(byteCount(v)),read:r=>r.u8(),norm:byteCount,eq:same};
const str:Codec<string>={write:(w,v)=>w.str(v),read:r=>r.str(),norm:v=>clip(v),eq:same};
const bool:Codec<boolean>={write:(w,v)=>w.u8(v?1:0),read:r=>r.u8()===1,norm:v=>!!v,eq:same};
/** A flag that is only ever true or absent (EnemyView.sugar): optional(trueFlag) is its presence byte, no value byte. */
const trueFlag:Codec<true>={write:()=>{},read:()=>true,norm:()=>true,eq:same};
function optional<V>(c:Codec<V>):Codec<V|undefined>{
  return {
    write:(w,v,f)=>{if(v===undefined)w.u8(0);else{w.u8(1);c.write(w,v,f);}},
    read:(r,f)=>r.u8()?c.read(r,f):undefined,
    norm:v=>v===undefined?undefined:c.norm(v),
    eq:(a,b)=>a===undefined||b===undefined?a===b:c.eq(a,b),
  };
}
/** D-036 slide direction (a unit vector): both axes at the velocity scale, like a telegraph's dx/dy. */
const slipDir=optional<{x:number;y:number}>({
  write:(w,v,f)=>{vel.write(w,v.x,f);vel.write(w,v.y,f);},
  read:(r,f)=>({x:vel.read(r,f),y:vel.read(r,f)}),
  norm:v=>({x:vel.norm(v.x),y:vel.norm(v.y)}),
  eq:(a,b)=>a.x===b.x&&a.y===b.y,
});
const TELEGRAPH_KIND_SET=new Set<string>(TELEGRAPH_KINDS);
/**
 * D-036 telegraph kind: one dictionary byte, '' (index 0) for none. Strict like the happening kinds: a kind this client
 * does not know rejects the frame (only a newer room sends one, and that is a version bump). The server side maps a
 * kind outside TELEGRAPH_KINDS to none, so it never sends one.
 */
const telegraphKind:Codec<TelegraphKind|undefined>={
  write:(w,v)=>w.str(v??''),
  read:r=>{const s=r.str();if(s==='')return undefined;if(!TELEGRAPH_KIND_SET.has(s))throw new FrameError('bad telegraph kind');return s as TelegraphKind;},
  norm:v=>v!==undefined&&TELEGRAPH_KIND_SET.has(v)?v:undefined,
  eq:same,
};
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
/** Run counters (award-stats-server): all nine always travel, so a protocol 4 client has the server's numbers. */
const STAT_KEYS=['damage','kills','revives','pickups','downs','heals','chests','magnets','evolves'] as const;
type Contribution=Record<typeof STAT_KEYS[number],number>;
const contribution=optional<Contribution>({
  write:(w,v)=>{for(const k of STAT_KEYS)w.uvar(v[k]);},
  read:r=>{const out={} as Contribution;for(const k of STAT_KEYS)out[k]=r.uvar();return out;},
  norm:v=>{const out={} as Contribution;for(const k of STAT_KEYS)out[k]=uint(v[k]);return out;},
  eq:(a,b)=>STAT_KEYS.every(k=>a[k]===b[k]),
});

/**
 * Player record on the wire: the view plus optional position and last processed input seq, so the client
 * can render and reconcile players from protocol 4 alone (view.ts stays unchanged). The three ticks drive the
 * sprite (attack swing, skill ring, skill cooldown); absent means 0 (never).
 */
export type PlayerWireView=PlayerRunView&{x?:number;y?:number;ack?:number;attackTick?:number;skillTick?:number;skillReadyTick?:number};
type SectionKey='players'|'enemies'|'pickups'|'projectiles'|'telegraphs'|'structures'|'nodes';
export const SECTIONS:readonly SectionKey[]=['players','enemies','pickups','projectiles','telegraphs','structures','nodes'];
type AnyCodec=Codec<unknown>;
interface Schema {
  prefix:string;
  fields:Record<string,AnyCodec>;
  /** Linear motion: the decoder moves x/y by vx/vy between frames, so they are only sent on drift. */
  extrapolate?:boolean;
}
const c=<V>(codec:Codec<V>)=>codec as unknown as AnyCodec;
const SCHEMAS:Record<SectionKey,Schema>={
  // Fields that change every frame come first, so the usual mask (nudge + ack + hp + stats) fits one byte.
  players:{prefix:'',fields:{
    ack:c(optional(count)),hp:c(count),stats:c(contribution),downed:c(downed),attackTick:c(optional(tickRel)),
    x:c(optional(posX)),y:c(optional(posY)),skillTick:c(optional(tickRel)),skillReadyTick:c(optional(tickRel)),
    online:c(bool),spectator:c(bool),eliminated:c(optional(bool)),maxHp:c(count),weapons:c(items),passives:c(items),
    name:c(str),classId:c(str),
    // D-036: movement effects, last (they change only when a burp or a poop lands; absent travels as nothing).
    slowUntil:c(optional(tickRel)),slipUntil:c(optional(tickRel)),slip:c(slipDir),
    // Protocol 15 (D-047): Dona Cida's sweets (fastUntil also drives the phone's prediction, like slowUntil).
    fastUntil:c(optional(tickRel)),mightUntil:c(optional(tickRel)),guardUntil:c(optional(tickRel)),
  }},
  enemies:{prefix:'e',fields:{
    kind:c(str),x:c(posX),y:c(posY),hp:c(count),maxHp:c(count),elite:c(optional(bool)),boss:c(optional(bool)),phase:c(optional(count)),
    // Protocol 15 (D-047): Dona Cida sold it a sweet.
    sugar:c(optional(trueFlag)),
  }},
  pickups:{prefix:'k',fields:{kind:c(str),x:c(posX),y:c(posY),value:c(count),resource:c(optional(str))}},
  projectiles:{prefix:'p',fields:{source:c(str),x:c(posX),y:c(posY),vx:c(vel),vy:c(vel),radius:c(radius),hostile:c(bool)},extrapolate:true},
  telegraphs:{prefix:'t',fields:{
    shape:c(str),x:c(posX),y:c(posY),radius:c(radius),dx:c(optional(vel)),dy:c(optional(vel)),width:c(optional(radius)),fireTick:c(tickRel),
    kind:c(telegraphKind),
  }},
  // Protocol 11 (torres-fio): a defense's tier, branch, building phase and aim (turns of a circle, 1 byte); each only when it changes.
  structures:{prefix:'s',fields:{kind:c(str),x:c(posX),y:c(posY),hp:c(count),maxHp:c(count),untilTick:c(optional(tickRel)),
    tier:c(optional(count)),branch:c(optional(str)),phase:c(optional(str)),aim:c(optional(unit)),
    // torre-contador-de-tiros: the volleys mod 256, so a turret firing at a target that does not move shows every shot.
    shots:c(optional(u8)),
    // Protocol 15 (D-047): the car's fallen parts (bits of CAR_PARTS), only when they change.
    parts:c(optional(count))}},
  // Gather nodes (VGM-046B): progress moves while someone gathers, the rest only when a unit comes out.
  nodes:{prefix:'n',fields:{progress:c(unit),remaining:c(count),kind:c(str),x:c(posX),y:c(posY),capacity:c(count),value:c(count)}},
};
const SECTION_BY_PREFIX=new Map(SECTIONS.filter(s=>s!=='players').map(s=>[SCHEMAS[s].prefix,s]));
/** Server tick rate; kept here so the client module does not import server code. */
const WIRE_HZ=20;
/**
 * Broadcast every SEND_EVERY ticks: 10 Hz on the 20 Hz room (D-018).
 * Staggered broadcast (for VGM-042b): give each client a slot (`sendSlot(index)`) and encode it only on ticks where
 * `sendsOn(tick, slot)`, so with 6 clients every tick encodes 3 instead of every other tick encoding 6. Each client
 * still gets 10 Hz; keep calling `pushEvents` on every encoder every tick. Frame ticks may be odd or even: deltas,
 * extrapolation and resends work on any tick. Build one FrameInput per tick and hand the same object to every
 * encoder due that tick (the live-id cache is shared through it).
 */
export const SEND_EVERY=2;
export const sendSlot=(clientIndex:number)=>((Math.floor(clientIndex)%SEND_EVERY)+SEND_EVERY)%SEND_EVERY;
export const sendsOn=(tick:number,slot:number)=>tick%SEND_EVERY===sendSlot(slot);

// ---------- Wire ids ----------
/**
 * Maps server string ids to client-facing ids (`e12`, `k3`, ...), shared by every encoder of a room.
 * Numbers are monotonic per section and never reused. Players keep their real ids on the client.
 */
export class WireIds {
  private next:Record<string,number>={};
  /** One map per section (no string keys to build on the hot path). */
  private toWire=Object.fromEntries(SECTIONS.map(s=>[s,new Map<string,number>()])) as Record<SectionKey,Map<string,number>>;
  private toServer=new Map<string,string>();
  wire(section:SectionKey,serverId:string):number{
    const map=this.toWire[section];
    let n=map.get(serverId);
    if(n===undefined){
      n=this.next[section]=(this.next[section]??0)+1;
      map.set(serverId,n);
      if(section!=='players')this.toServer.set(SCHEMAS[section].prefix+n,serverId);
    }
    return n;
  }
  has(section:SectionKey,serverId:string){return this.toWire[section].has(serverId);}
  label(section:SectionKey,serverId:string){return section==='players'?serverId:SCHEMAS[section].prefix+this.wire(section,serverId);}
  /** Server id for a client-facing id (e.g. a tapped enemy `e12`), or undefined. */
  resolve(clientId:string){return this.toServer.get(clientId);}
  /**
   * New run (server ids restart, e.g. `xp-1` again): forget the map, keep counters so wire ids stay unique.
   * Players keep theirs: their ids survive the rematch, and a new wire id would resend (and "leave") every player.
   */
  reset(){for(const s of SECTIONS)if(s!=='players')this.toWire[s].clear();this.toServer.clear();}
  /** Forget ids of entities gone for good (call with the live server ids, e.g. once per second). */
  prune(live:Partial<Record<SectionKey,Iterable<string>>>){
    for(const section of SECTIONS){
      const ids=live[section];
      if(section==='players'||!ids)continue;
      const keep=new Set(ids),map=this.toWire[section];
      for(const [id,n] of map)if(!keep.has(id)){map.delete(id);this.toServer.delete(SCHEMAS[section].prefix+n);}
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
  // source: kind of the critter behind the fall (UX-voce-e-dano), added with the switch to the room (VGM-042b).
  ['downed',[['player','ref'],['by','ref',true],['source','str',true]]],
  ['revived',[['player','ref'],['by','ref',true]]],
  ['eliminated',[['player','ref'],['by','ref',true]]],
  ['telegraph',[['telegraph','ref',false,'telegraphs']]],
  ['boss-phase',[['enemy','ref',false,'enemies'],['phase','count']]],
  ['wave',[['index','count'],['label','str']]],
  ['round',[['index','count'],['phase','str'],['name','str',true],['modifier','str',true]]],
  ['bark',[['enemy','ref',false,'enemies'],['line','str']]],
  ['structure',[['id','ref',false,'structures'],['hp','count'],['maxHp','count']]],
  // Class skill cast (E7-skill-hud-wiring): balloon line, dice result and landing spot (x, y only when the skill moved the caster).
  ['skill',[['player','ref'],['skill','str'],['line','str'],['outcome','str',true],['x','pos',true],['y','pos',true]]],
  // D-013 (VGM-046B): the return horn (when the round starts, its joke) and lines from things that are not enemies.
  ['horn',[['endsTick','tick'],['line','str',true]]],
  ['say',[['source','ref'],['key','str'],['line','str']]],
  // VGM-053B (protocol 7): a zueira event in the round (kind, when it stops) and the round's last critter (kill-cam).
  ['happening',[['kind','str'],['endsTick','tick']]],
  ['last-bicho',[['kind','str'],['x','pos'],['y','pos'],['round','count'],['by','ref',true]]],
  // Protocol 15 (D-047, the chaveiro objective): the car alarm, a car part, a moto moment, Dona Cida's sale to a critter
  // and a team purchase.
  ['alarm',[['untilTick','tick']]],
  ['part',[['name','str']]],
  ['moto',[['mode','str'],['alone','count',true]]],
  ['sale',[['enemy','ref',false,'enemies']]],
  ['buy',[['player','ref'],['item','str']]],
];
const MOTO_MOMENTS=new Set<string>(['morta','tranco','lombada','entrega','tombo','volta','abrindo','chegou']);
const CIDA_SET=new Set<string>(CIDA_ITEM_IDS);
const EVENT_CODE=new Map<string,number>(EVENT_SPECS.map(([type],i)=>[type,i]));
/** Upper bound of one event's body (a few refs, numbers and strings of at most MAX_STRING_BYTES). */
const MAX_EVENT_BYTES=4096;
const REF_INLINE=0,REF_PLAYER=1;
const REF_SECTIONS:SectionKey[]=['enemies','pickups','projectiles','telegraphs','structures','nodes'];
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
      case 'count':e[name]=name==='crit'||name==='alone'?r.uvar()>0:r.uvar();return;
      case 'tick':e[name]=tickRel.read(r,f);return;
      case 'str':e[name]=r.str();return;
    }
  });
  if(type==='round'&&e.phase!=='wave'&&e.phase!=='prepare'&&e.phase!=='end')throw new FrameError('bad round phase');
  if(type==='happening'&&e.kind!=='boletos'&&e.kind!=='promo'&&e.kind!=='apagao')throw new FrameError('bad happening');
  if(type==='moto'&&!MOTO_MOMENTS.has(e.mode as string))throw new FrameError('bad moto moment');
  if(type==='moto'&&e.alone===false)delete e.alone;
  if(type==='buy'&&!CIDA_SET.has(e.item as string))throw new FrameError('bad cida item');
  if(type==='skill'&&e.outcome!==undefined&&e.outcome!=='flop'&&e.outcome!=='hit'&&e.outcome!=='miracle')throw new FrameError('bad dice outcome');
  return e as unknown as WireEvent;
}

// ---------- Frames ----------
type Entity={id:string}&Record<string,unknown>;
/** One section as the client holds it: wire id -> record with client-facing id. */
type Table=Map<number,Entity>;
/** `objective`: the objective as the client holds it after this frame (normalized: what the wire carries). */
interface World {tick:number;tables:Record<SectionKey,Table>;objective?:ObjectiveView}

// ---------- Objective block (protocol 15, D-047) ----------
/**
 * Flag bit 4 of the frame: u8 bits (1 dynamic part, 2 static part, 4 cleared) | dynamic? | static?. Sent only when it
 * differs from the baseline's (every full frame has both parts); the decoder keeps the baseline's otherwise.
 *   dynamic: str kind | svar motoX*16 | svar motoY*16 | str mode | u8 has (1 push, 2 delivery, 4 victory, 8 defeat) |
 *     uvar etaS | svar alarmUntil-tick | uvar grana | uvar budget | uvar n, uvar stock* | [u8 push 0..255] |
 *     [svar x*16, svar y*16, uvar etaS] | svar carX*16 | svar carY*16 | uvar hits | uvar limit | uvar parts
 *   static: uvar n, (svar x*16, svar y*16)* route | uvar m, (str kind, svar x*16, svar y*16, uvar s*16)* stops
 */
const OBJ_DYN=1,OBJ_STATIC=2,OBJ_CLEAR=4;
const OBJ_PUSH=1,OBJ_DELIVERY=2,OBJ_VICTORY=4,OBJ_DEFEAT=8;
/** Objective positions travel at 1/16 unit. */
export const OBJECTIVE_POS_SCALE=16;
const MAX_ROUTE_POINTS=512,MAX_STOPS=64,MAX_STOCK=8;
const MOTO_MODES=new Set<string>(['anda','lombada','entrega','morta','tombo','volta','abrindo']);
const STOP_KINDS=new Set<string>(['morta','lombada','entrega']);
const q16=(v:number)=>Math.max(-POS_LIMIT*OBJECTIVE_POS_SCALE,Math.min(POS_LIMIT*OBJECTIVE_POS_SCALE,Math.round(finite(v)*OBJECTIVE_POS_SCALE)));
const n16=(v:number)=>q16(v)/OBJECTIVE_POS_SCALE;
const pt16=(p:{x:number;y:number})=>({x:n16(p.x),y:n16(p.y)});
/** The objective as the client ends up with it (quantized), so the encoder compares like for like. */
function normObjective(v:ObjectiveView):ObjectiveView{
  return {
    kind:v.kind,moto:{...pt16(v.moto),mode:v.moto.mode,...(v.moto.push!==undefined?{push:unitByte(v.moto.push)/255}:{})},
    route:v.route.slice(0,MAX_ROUTE_POINTS).map(pt16),
    stops:v.stops.slice(0,MAX_STOPS).map(o=>({kind:o.kind,...pt16(o),s:Math.max(0,n16(o.s))})),
    etaS:uint(v.etaS),alarmUntil:Math.round(finite(v.alarmUntil)),grana:uint(v.grana),budget:uint(v.budget),stock:v.stock.slice(0,MAX_STOCK).map(uint),
    ...(v.delivery?{delivery:{...pt16(v.delivery),etaS:uint(v.delivery.etaS)}}:{}),
    car:{...pt16(v.car),hits:uint(v.car.hits),limit:uint(v.car.limit),parts:uint(v.car.parts)},
    ...(v.ended?{ended:v.ended}:{}),
  };
}
const samePts=(a:readonly {x:number;y:number}[],b:readonly {x:number;y:number}[])=>a.length===b.length&&a.every((p,i)=>p.x===b[i].x&&p.y===b[i].y);
const sameStatic=(a:ObjectiveView,b:ObjectiveView)=>samePts(a.route,b.route)&&a.stops.length===b.stops.length&&
  a.stops.every((o,i)=>o.kind===b.stops[i].kind&&o.x===b.stops[i].x&&o.y===b.stops[i].y&&o.s===b.stops[i].s);
const sameDynamic=(a:ObjectiveView,b:ObjectiveView)=>a.kind===b.kind&&a.moto.x===b.moto.x&&a.moto.y===b.moto.y&&a.moto.mode===b.moto.mode&&
  a.moto.push===b.moto.push&&a.etaS===b.etaS&&a.alarmUntil===b.alarmUntil&&a.grana===b.grana&&a.budget===b.budget&&
  a.stock.length===b.stock.length&&a.stock.every((n,i)=>n===b.stock[i])&&a.ended===b.ended&&
  (a.delivery===undefined?b.delivery===undefined:b.delivery!==undefined&&a.delivery.x===b.delivery.x&&a.delivery.y===b.delivery.y&&a.delivery.etaS===b.delivery.etaS)&&
  a.car.x===b.car.x&&a.car.y===b.car.y&&a.car.hits===b.car.hits&&a.car.limit===b.car.limit&&a.car.parts===b.car.parts;
function writeObjective(w:Writer,v:ObjectiveView,bits:number,tick:number){
  w.u8(bits);
  if(bits&OBJ_DYN){
    w.str(v.kind);w.svar(q16(v.moto.x));w.svar(q16(v.moto.y));w.str(v.moto.mode);
    w.u8((v.moto.push!==undefined?OBJ_PUSH:0)|(v.delivery?OBJ_DELIVERY:0)|(v.ended==='victory'?OBJ_VICTORY:0)|(v.ended==='defeat'?OBJ_DEFEAT:0));
    w.uvar(v.etaS);w.svar(v.alarmUntil-tick);w.uvar(v.grana);w.uvar(v.budget);
    w.uvar(v.stock.length);for(const n of v.stock)w.uvar(n);
    if(v.moto.push!==undefined)w.u8(unitByte(v.moto.push));
    if(v.delivery){w.svar(q16(v.delivery.x));w.svar(q16(v.delivery.y));w.uvar(v.delivery.etaS);}
    w.svar(q16(v.car.x));w.svar(q16(v.car.y));w.uvar(v.car.hits);w.uvar(v.car.limit);w.uvar(v.car.parts);
  }
  if(bits&OBJ_STATIC){
    w.uvar(v.route.length);for(const p of v.route){w.svar(q16(p.x));w.svar(q16(p.y));}
    w.uvar(v.stops.length);for(const o of v.stops){w.str(o.kind);w.svar(q16(o.x));w.svar(q16(o.y));w.uvar(q16(o.s));}
  }
}
function readObjective(r:Reader,tick:number,base:ObjectiveView|undefined):ObjectiveView|undefined{
  const bits=r.u8();
  if(bits>7||(bits&OBJ_CLEAR&&bits!==OBJ_CLEAR))throw new FrameError('bad objective bits');
  if(bits&OBJ_CLEAR)return undefined;
  const pos=()=>r.svar()/OBJECTIVE_POS_SCALE;
  let next:ObjectiveView|undefined=base?structuredClone(base):undefined;
  if(bits&OBJ_DYN){
    const kind=r.str(),mx=pos(),my=pos(),mode=r.str();
    if(kind!=='chaveiro')throw new FrameError('unknown objective');
    if(!MOTO_MODES.has(mode))throw new FrameError('bad moto mode');
    const has=r.u8();if(has>15||(has&OBJ_VICTORY&&has&OBJ_DEFEAT))throw new FrameError('bad objective flags');
    const etaS=r.uvar(),alarmUntil=tick+r.svar(),grana=r.uvar(),budget=r.uvar();
    const stock=Array.from({length:r.count(MAX_STOCK)},()=>r.uvar());
    const push=has&OBJ_PUSH?r.u8()/255:undefined;
    const delivery=has&OBJ_DELIVERY?{x:pos(),y:pos(),etaS:r.uvar()}:undefined;
    const car={x:pos(),y:pos(),hits:r.uvar(),limit:r.uvar(),parts:r.uvar()};
    next={kind,moto:{x:mx,y:my,mode:mode as MotoMode,...(push!==undefined?{push}:{})},route:next?.route??[],stops:next?.stops??[],
      etaS,alarmUntil,grana,budget,stock,...(delivery?{delivery}:{}),car,
      ...(has&OBJ_VICTORY?{ended:'victory' as const}:has&OBJ_DEFEAT?{ended:'defeat' as const}:{})};
  }
  if(bits&OBJ_STATIC){
    if(!next)throw new FrameError('objective route without its state');
    next.route=Array.from({length:r.count(MAX_ROUTE_POINTS)},()=>({x:pos(),y:pos()}));
    next.stops=Array.from({length:r.count(MAX_STOPS)},()=>{
      const kind=r.str();if(!STOP_KINDS.has(kind))throw new FrameError('bad stop kind');
      return {kind:kind as ObjectiveStopKind,x:pos(),y:pos(),s:r.uvar()/OBJECTIVE_POS_SCALE};
    });
  }
  if(!next)throw new FrameError('objective without its state');
  return next;
}
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
/** City (D-034): seed 0 and signature = the asset sha256, the same hash as the map-select MapRef (D-027). */
export interface WorldDescriptor {kind:'ilha'|'infinito'|'cidade';terrainVersion:number;generatorVersion:number;seed:number;signature:string}
/** Appended only: the u8 index is on the wire. */
const WORLD_KINDS=['ilha','infinito','cidade'] as const;
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
  /** Broadcast slot (0..SEND_EVERY-1, see sendSlot); `due(tick)` says when this client's frame goes. Default 0. */
  slot?:number;
  /**
   * N27 (horde bytes): delta against the frame sent just before, not the last acked one. A WebSocket is ordered and
   * reliable, so while the connection lives the client decoded every frame it was sent; a frame it could not decode
   * makes it ask for a resync (the next frame is full), and a new connection gets a new encoder. Acks then only retire
   * events. Without it a client acking once a second (standing still, ACK_EVERY_MS) or late (a slow phone) gets deltas
   * against a frame up to a second or more old: whole positions instead of nudges (300 critters: 19 → 13 KB/s).
   * The wire format is the same (baseSeq is the previous seq), so decoders need nothing new. Default false.
   */
  chain?:boolean;
  /**
   * N27 (horde bytes): critters off every legal phone screen around the viewer (offscreen.ts visibleOffset, the
   * union of orientations and views) are updated only every `farEvery` frames; new ones and removals go at once.
   * On screen nothing changes. Needs a viewer. Default 1 (every frame).
   */
  farEvery?:number;
}
/**
 * Server ids of a section list, built once per list and tick: the encoders of one room share the same FrameInput,
 * so 6 clients build it once. Rebuilt when the tick or the length changes (a list reused from an older tick).
 */
const liveCache=new WeakMap<readonly Entity[],{tick:number;length:number;ids:Set<string>}>();
function liveIds(list:readonly Entity[],tick:number){
  let hit=liveCache.get(list);
  if(!hit||hit.tick!==tick||hit.length!==list.length){hit={tick,length:list.length,ids:new Set(list.map(e=>e.id))};liveCache.set(list,hit);}
  return hit.ids;
}
/** Events every client needs, wherever they happened (team progress, falls and revives, rounds, the wall). */
const GLOBAL_EVENTS=new Set<string>(['levelup','offer','upgrade','evolve','downed','revived','eliminated','wave','round','structure','boss-phase','horn',
  // The whole team lives the zueira event, and the kill-cam shows the last critter wherever it fell (VGM-053B).
  'happening','last-bicho',
  // D-047: the car and the moto are the whole team's business (the sale names a critter: judged like any other).
  'alarm','part','moto','buy']);
/** A section the frame input left out (an older Simulation, a test): sent as empty. Shared, so the live-id cache holds. */
const NONE:readonly Entity[]=Object.freeze([]) as readonly Entity[];
/** Camp block bits. */
const CAMP_HORN=1,CAMP_WALL_DOWN=2;
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
  /** Reused buffer for one event body (its byte length goes first on the wire). */
  private readonly scratch=new Writer();
  private pending:Pending[]=[];
  /** Server ids per section sent in this frame and the previous one (hysteresis, event relevance). */
  private members:Partial<Record<SectionKey,Set<string>>>={};
  private previous:Partial<Record<SectionKey,Set<string>>>={};
  private sentWorld?:WorldDescriptor;
  /**
   * Unacked events are sent again after this many ticks (and right after a resync, which is what a reconnect or a
   * lost baseline does). 5 s, not 1 s: on a bad network the acks come late, and resending every second doubled the
   * bytes exactly when the link was worst (review of VGM-042b: 492 KB against 79 KB with acks held back).
   */
  resendTicks=5*WIRE_HZ;
  readonly stats:EncoderStats={frames:0,fullFrames:0,bytes:0,eventBytes:0,culled:0,droppedEvents:0};
  readonly ids:WireIds;
  readonly viewer?:string;
  readonly slot:number;
  private readonly interest?:InterestOptions;
  private readonly chain:boolean;
  private readonly farEvery:number;
  constructor(ids=new WireIds(),options:EncoderOptions={}){
    this.ids=ids;this.viewer=options.viewer;this.slot=sendSlot(options.slot??0);this.chain=!!options.chain;
    this.farEvery=Math.max(1,Math.floor(options.farEvery??1));
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
  /** Seq of the last frame encoded (0 before the first). */
  get lastSeq(){return this.seq;}
  /** Whether this client's frame goes out on `tick` (staggered broadcast). */
  due(tick:number){return sendsOn(tick,this.slot);}

  /** The client decoded frame `seq`. Old, future or unknown acks are ignored. */
  ack(seq:number,_eventId?:number){
    // Chained, an ack only retires events: a late one (a slow phone) still counts once its frame left the history.
    if(!Number.isSafeInteger(seq)||seq<=this.acked||seq>this.seq||(!this.chain&&!this.history.has(seq)))return;
    this.acked=seq;
    this.pending=this.pending.filter(p=>p.firstSeq===undefined||p.firstSeq>seq);
    if(!this.chain)for(const s of this.history.keys())if(s<seq)this.history.delete(s);
  }
  /** Client lost its baselines (reconnect or decode error): next frame is full and unacked events go again. */
  resync(){
    // Late acks for frames before the resync must not revive a baseline the client dropped.
    this.acked=0;this.history.clear();this.sentWorld=undefined;
    for(const p of this.pending){p.firstSeq=undefined;p.sentTick=undefined;}
  }

  /**
   * Where this client's frame is centred: `focus`, else the viewer's player, else (a spectator without a body)
   * the first player who has one, else the base, else the origin. Undefined only without a viewer (no interest).
   */
  private focusOf(view:FrameInput,focus?:Point2):Point2|undefined{
    if(focus&&Number.isFinite(focus.x)&&Number.isFinite(focus.y))return focus;
    if(this.viewer===undefined)return undefined;
    const at=(p?:{x?:number;y?:number})=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?{x:p.x!,y:p.y!}:undefined;
    return at(view.players.find(p=>p.id===this.viewer))??at(view.players.find(p=>!p.spectator&&!p.eliminated&&Number.isFinite(p.x)))??
      at(view.structures[0])??{x:0,y:0};
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
    const near=interest.radius,stay=interest.radius+interest.hysteresis,near2=near*near,stay2=stay*stay,tele=section==='telegraphs';
    for(const e of list){
      const dx=(e.x as number)-focus.x,dy=(e.y as number)-focus.y;
      let d2=dx*dx+dy*dy;
      if(tele){const d=Math.sqrt(d2)-Math.max(0,finite(e.radius as number))-Math.max(0,finite((e.width as number|undefined)??0));d2=d<0?0:d*d;}
      // The boss is always sent: the arrow to it and its hp bar matter from anywhere. NaN positions stay out.
      const inside=(section==='enemies'&&e.boss===true)||d2<=near2||(d2<=stay2&&!!before?.has(e.id));
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
    // Chained: the previous frame (gone after a resync, which clears the history: then this one is full).
    const baseSeq=this.chain?this.seq:this.acked,seq=++this.seq,base=this.history.get(baseSeq);
    const focus=this.focusOf(view,options.focus);
    const f:FrameCtx={tick:view.tick,ox:focus?Math.round(focus.x):0,oy:focus?Math.round(focus.y):0};
    if(!(Math.abs(f.ox)<=POS_LIMIT))f.ox=0;
    if(!(Math.abs(f.oy)<=POS_LIMIT))f.oy=0;
    const w=new Writer();
    w.u8(MAGIC);w.u8(PROTOCOL_VERSION);w.uvar(seq);w.uvar(base?baseSeq:0);w.uvar(view.tick);w.svar(f.ox);w.svar(f.oy);
    w.uvar(view.team.xp);w.uvar(view.team.level);w.uvar(view.team.nextXp);
    const sendWorld=!!view.world&&(!base||!sameWorld(view.world,this.sentWorld));
    // Protocol 15: the objective block only when it differs from the baseline's (both parts on a full frame).
    const objective=view.objective?normObjective(view.objective):undefined,had=base?.objective;
    const objBits=objective?(had&&sameDynamic(had,objective)?0:OBJ_DYN)|(had&&sameStatic(had,objective)?0:OBJ_STATIC):had?OBJ_CLEAR:0;
    w.u8((view.round?1:0)|(view.wave?2:0)|(sendWorld?4:0)|(view.camp?8:0)|(objBits?16:0));
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
    if(view.camp){
      const camp=view.camp,horn=camp.hornEndsTick!==undefined&&Number.isFinite(camp.hornEndsTick);
      w.u8((horn?CAMP_HORN:0)|(camp.wallDown?CAMP_WALL_DOWN:0));w.uvar(Math.max(0,Math.floor(camp.units)));
      if(horn)w.svar(camp.hornEndsTick!-view.tick);
    }
    if(objBits)writeObjective(w,objective!,objBits,view.tick);
    const world:World={tick:view.tick,tables:emptyTables(),...(objective?{objective}:{})};
    for(const section of SECTIONS){
      const schema=SCHEMAS[section],list=(view[section]??NONE) as unknown as Entity[];
      const client=advance(schema,base?.tables[section],view.tick,base?.tick??view.tick);
      const current=this.select(section,list,focus);
      // Off-screen critters wait for their frame (farEvery): the client keeps the copy it has.
      const hold=section==='enemies'&&this.farEvery>1&&focus&&this.viewer!==undefined&&seq%this.farEvery!==0?
        // Both where the client has it and where it is now: one walking off the edge still gets its last steps.
        (e:Entity,had:Entity)=>e.boss!==true&&!visibleOffset((e.x as number)-focus.x,(e.y as number)-focus.y)&&
          !visibleOffset((had.x as number)-focus.x,(had.y as number)-focus.y):undefined;
      // Removed from this client but still in the world: it left the area of interest (no death poof).
      const exists=this.interest?(label:string)=>liveIds(list,view.tick).has(section==='players'?label:this.ids.resolve(label)??''):()=>false;
      world.tables[section]=writeSection(w,schema,current,client,f,(id)=>this.ids.label(section,id),exists,hold);
    }
    const start=w.len;
    // Events are judged once, on their first frame: those nobody near this client could see are dropped.
    if(this.interest&&focus)this.pending=this.pending.filter(p=>{
      if(p.sentTick!==undefined||this.relevant(p,focus,view.players))return true;
      this.stats.droppedEvents++;return false;
    });
    // Chained frames on an ordered link: a frame sent was decoded, or the client asks for a resync (which clears
    // sentTick), so an event goes once and again only after a resync. Acked baselines resend after resendTicks.
    const due=this.pending.filter(p=>p.sentTick===undefined||(!this.chain&&view.tick-p.sentTick>=this.resendTicks));
    w.uvar(due.length);
    let last=0;
    for(const p of due){
      w.uvar(p.event.eventId-last);last=p.event.eventId;
      this.resolve(p);
      const body=this.scratch;body.len=0;writeEvent(body,p.event,f,this.ids);
      w.uvar(body.len);w.raw(body.buf.subarray(0,body.len));
      p.firstSeq??=seq;p.sentTick=view.tick;
    }
    this.stats.eventBytes+=w.len-start;
    // Chained, the next frame only needs this one (6 clients × 64 worlds of 300 critters stays out of the room's memory).
    if(this.chain)this.history.clear();
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
/** At most 29 fields per schema, so masks stay inside 31-bit integers (`>>>` and `1<<`). */
const bit=(field:number)=>1<<(field+FIELD_BIT);
const has=(mask:number,field:number)=>((mask>>>(field+FIELD_BIT))&1)===1;
/**
 * Writes one section and returns the client's resulting table. Layout: removed ids (gap*2 + left-interest bit),
 * then upserts as (id gap, mask, [player id if new], [i8 dx, i8 dy if moved a little], changed fields).
 * Ids are ascending gaps. Non-player client ids are derived from the wire id (prefix + number), so they never
 * travel as text. `exists`: whether a client id is still in the server world (its removal is a culling).
 */
function writeSection(w:Writer,schema:Schema,current:Map<number,Entity>,client:Table,f:FrameCtx,label:(serverId:string)=>string,exists:(clientId:string)=>boolean,
  hold?:(e:Entity,had:Entity)=>boolean):Table{
  const keys=Object.keys(schema.fields);
  const xi=keys.indexOf('x'),yi=keys.indexOf('y');
  const removed=[...client.keys()].filter(id=>!current.has(id)).sort((a,b)=>a-b);
  w.uvar(removed.length);
  let last=0;
  for(const id of removed){w.uvar((id-last)*2+(exists(client.get(id)!.id)?1:0));last=id;client.delete(id);}
  const ups:{id:number;mask:number;e:Entity;nx?:number;ny?:number}[]=[];
  for(const id of [...current.keys()].sort((a,b)=>a-b)){
    const cur=current.get(id)!,prev=client.get(id);
    // Held back this frame (off screen, farEvery): the client's copy stays as it is, nothing goes.
    if(prev&&hold?.(cur,prev))continue;
    // `client` is this frame's own copy (advance), so a known entity is updated in place: no second copy.
    const next:Entity=prev??{id:label(cur.id)};
    const px=prev?.x,py=prev?.y;
    let mask=prev?0:NEW;
    keys.forEach((k,j)=>{
      const codec=schema.fields[k],v=codec.norm(cur[k]);
      const old=j===xi?px:j===yi?py:undefined;
      if(prev&&(j===xi||j===yi)&&typeof v==='number'&&typeof old==='number'){
        // Positions: the client keeps its own (possibly extrapolated) value until it drifts by a quantum.
        if(!(Math.abs(old-finite(cur[k] as number))<=(schema.extrapolate?1:.5)/POS_SCALE)){mask+=bit(j);next[k]=v;}
        return;
      }
      if(prev?codec.eq(prev[k],v):v===undefined)return;
      mask+=bit(j);
      if(v===undefined)delete next[k];else next[k]=v;
    });
    let nx:number|undefined,ny:number|undefined;
    if(prev&&xi>=0&&(has(mask,xi)||has(mask,yi))&&typeof px==='number'&&typeof py==='number'&&typeof cur.x==='number'&&typeof cur.y==='number'){
      const dx=Math.round((cur.x-px)*POS_SCALE),dy=Math.round((cur.y-py)*POS_SCALE);
      if(Math.abs(dx)<=127&&Math.abs(dy)<=127){
        mask=mask-(has(mask,xi)?bit(xi):0)-(has(mask,yi)?bit(yi):0)+NUDGE;nx=dx;ny=dy;
        next.x=px+dx/POS_SCALE;next.y=py+dy/POS_SCALE;
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
    // `client` is this frame's copy (advance): update in place. A bad frame is dropped whole, so nothing leaks.
    const e:Entity=mask&NEW?{id:schema.prefix?schema.prefix+id:r.str()}:prev!;
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
      if(flags>31)throw new FrameError('bad flags');
      let round:RoundState|undefined,wave:RunView['wave'],world=this.world,camp:CampView|undefined;
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
      if(flags&8){
        const bits=r.u8();if(bits>3)throw new FrameError('bad camp bits');
        camp={units:r.uvar()};
        if(bits&CAMP_HORN)camp.hornEndsTick=tick+r.svar();
        if(bits&CAMP_WALL_DOWN)camp.wallDown=true;
      }
      const objective=flags&16?readObjective(r,tick,base?.objective):base?.objective;
      const next:World={tick,tables:emptyTables(),...(objective?{objective}:{})},left:string[]=[];
      for(const section of SECTIONS){
        const schema=SCHEMAS[section];
        next.tables[section]=readSection(r,schema,advance(schema,base?.tables[section],tick,base?.tick??tick),f,left);
      }
      const count=r.count(MAX_EVENTS),events:WireEvent[]=[],fresh:number[]=[];
      let eventId=0;
      for(let i=0;i<count;i++){
        const gap=r.uvar();if(!gap)throw new FrameError('event ids out of order');
        eventId+=gap;
        const size=r.uvar();if(size<1||size>MAX_EVENT_BYTES)throw new FrameError('bad event size');
        const body=new Reader(r.take(size));
        // Unknown code (a newer room): skipped, the rest of the frame still counts. Its id is not marked as seen.
        if(!EVENT_SPECS[body.buf[0]])continue;
        const e=readEvent(body,eventId,f,next.tables.players);
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
        nodes:list<NodeView>('nodes'),...(camp?{camp}:{}),...(objective?{objective:structuredClone(objective)}:{}),
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
