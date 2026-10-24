/**
 * Room messages (texts the phone shows, handshake version, seat rules) and the protocol 3 JSON format (snapshots,
 * deltas, packing, input validation), shared by the room (multiplayer/) and the phone (src/client/net).
 * Protocol 4 binary run frames are protocol4.ts.
 */
import {PROTOCOL_VERSION} from './protocol4.ts';
import type {EnemyState,PixRefusal,PixResult,PlayerInput,Point,RoundState,RunState,StampedEvent,TelegraphView,WorldKind} from '../contract/index.ts';
import {PIX_REFUSALS} from '../contract/index.ts';
/**
 * Room protocol (join handshake). 7 since VGM-053B (zueira events and the kill-cam), 6 was VGM-046B (5 E7-skill-hud-wiring,
 * 4 VGM-042b): binary run frames (protocol4.ts: camp block, gather nodes, zueira events) plus JSON control messages
 * (`forge` asks the forge for a recipe).
 * The site and the rooms Worker publish together (pages.yml, Worker first); a client with another version is
 * refused at join with a readable message, never fed frames it cannot parse.
 */
export const ROOM_PROTOCOL=PROTOCOL_VERSION;
/**
 * The one text for "this page and the room do not match" (UX onda 4, B15): version refused, terrain or generator
 * differs, frames that never decode. In the house voice, with what to do and what to do if it comes back (the
 * site may lag the Worker for a minute during a release, pages.yml).
 */
export const UPDATE_NEEDED='Saiu versão nova do jogo. Atualiza a página pra entrar. Se voltar esta mensagem, espera 1 minuto.';
/** Whether a terminal message asks for a reload (also older rooms' wording, "Atualize a página"). */
export const needsUpdate=(message:string)=>message===UPDATE_NEEDED||/Atualiz[ae] a página/.test(message);
/** Room notice when a new run would not fit in the room's lifetime (042a R2); the client turns the rematch button into advice. */
export const ROOM_CLOSING_NOTICE='O síndico vai fechar a sala antes de dar tempo de outra run inteira. Criem uma sala nova, que o bêbado espera.';

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
/**
 * The room's Durable Object restarted in the middle of a run and the run came back (E5-checkpoint-por-round): everyone
 * is at the start of the round that was going, with the level, weapons, wall and defenses they had then. `kind`
 * 'resumed' (the lost run keeps 'restarted'). Shown once, as news over the match; `message` is both lines.
 */
export function resumedNotice(round:number){
  const title=round>0?`A sala caiu e voltou: recomeçando o Round ${round}.`:'A sala caiu e voltou: recomeçando o round.';
  const body='Nível, armas, muralha e defesas estão como no começo dele.';
  return {title,body,message:`${title} ${body}`};
}
/** A kicked player stays out of the same room this long (D-025): by the seat's token, which the page keeps. */
export const KICK_BAN_MS=10*60_000;
/** What the kicked phone reads (and reads again if it knocks before the time is up): who, until when, what to do. */
export function kickedMessage(until:number,now=Date.now()){
  const minutes=Math.max(1,Math.ceil((until-now)/60_000));
  return `O dono da sala te tirou da turma. Dá pra voltar nesta sala daqui a ${minutes} min, ou cria uma sala sua.`;
}
/** Refusals of the owner's commands (D-025), as room notices. */
export const OWNER_ONLY='Só o dono da sala mexe na turma.';
/** Title of the kicked window (D-025, design review): who did what, in the voice of the room. */
export const KICKED_TITLE='Tiraram você da sala';
export const OWNER_NOT_NOW='No meio do Round não dá. Espera o resultado.';
/** A second person knocking on a "Jogar sozinho" room (sala-solo-privada). */
export const SOLO_ROOM_REFUSED='Essa sala é de alguém jogando sozinho. Peça um código de sala da turma.';
/**
 * What a POST /rooms may ask (sala-solo-privada): the map it opens on and a solo room (one person, the bots). Read from
 * an optional JSON body; anything else is ignored, so an older client (no body) gets the room it always got.
 */
/**
 * objective (D-047): ?modo=chaveiro asks for the chaveiro (the city's default anyway), ?modo=muralha for the old wall mode.
 * mode (D-051): ?modo=ninhos asks for the nests instead of the waves (with the chaveiro, the default objective).
 * combat (D-051): 'manual' opens the room with the attack button (?combate=manual); absent: the automatic weapons.
 */
export interface RoomCreateOptions {map?:'infinito'|'cidade-nevada';solo?:true;objective?:'chaveiro'|'muralha';mode?:'ninhos';combat?:'manual'}
/** This connection lost the character to a newer one (another tab, or the same phone back on another network). */
export const REPLACED_MESSAGE='Seu personagem entrou por outra aba ou outro aparelho. Pra jogar aqui, toca em Atualizar.';
export const MAX_PLAYERS = 10;
/** MAX_PLAYERS in words, for the room's texts ("Máximo de dez jogadores."). */
export function playersWord(n=MAX_PLAYERS){return ['zero','um','dois','três','quatro','cinco','seis','sete','oito','nove','dez'][n]??String(n);}
/** A person knocking on a room with MAX_PLAYERS seats taken (bots count). */
export const ROOM_FULL=`Sala cheia. Máximo de ${playersWord()} jogadores.`;
/** The owner's bot-add on a full room (D-025). */
export const ROOM_FULL_BOTS=`Sala cheia: ${playersWord()} é o máximo, bot conta.`;
/**
 * The run's rotation (D-040) for the client's per-match art (arte-do-roster-no-render): {t:'elenco',ids} on welcome and
 * when a run draws a new one, so a phone fetches the drawn enemies' sheets before they show up. JSON control, no
 * protocol bump: an older client ignores an unknown `t`, and an older room never sends it (the client then loads each
 * enemy's art the first time one shows up).
 */
export interface ElencoMessage {t:'elenco';ids:string[]}
/** At most this many ids are read (a rotation has 12-18); longer than ELENCO_ID_MAX chars is not a roster id. */
export const ELENCO_MAX=32,ELENCO_ID_MAX=64;
/** The ids of an {t:'elenco'} message (strings only, capped), or undefined when it is not one. */
export function parseElenco(m:unknown):string[]|undefined{
  if(!m||typeof m!=='object'||(m as {t?:unknown}).t!=='elenco')return undefined;
  const ids=(m as {ids?:unknown}).ids;if(!Array.isArray(ids))return undefined;
  const out:string[]=[];
  for(const id of ids){if(out.length>=ELENCO_MAX)break;if(typeof id==='string'&&id.length>0&&id.length<=ELENCO_ID_MAX&&!out.includes(id))out.push(id);}
  return out;
}
/**
 * PIX (NEW-20261014-ORQ-carteira-e-pix, contract wallet.ts). Phone → room {t:'pix',round,req,to,amount}; room → phone
 * {t:'pixed',req,ok,to?,amount?,grana?|reason?} (grana: the sender's wallet after it). No protocol bump of its own: an
 * older room never answers (the phone's promise gives up after PIX_ANSWER_MS) and an older phone never sends it.
 */
export interface PixCommand {t:'pix';round:number;req:number;to:string;amount:number}
/** Longest player id a PIX may name (room ids are far shorter). */
export const PIX_TO_MAX=64;
/** How long the phone waits for {t:'pixed'} before it gives the PIX up as refused ('phase'). */
export const PIX_ANSWER_MS=5000;
/**
 * The shape of a {t:'pix'} command (the room's first check), or undefined: a whole round, a whole positive req, a
 * player id string, a number amount (the simulation judges the value: 'amount').
 */
export function parsePix(m:unknown):PixCommand|undefined{
  if(!m||typeof m!=='object')return undefined;
  const o=m as Record<string,unknown>;
  if(o.t!=='pix'||!Number.isSafeInteger(o.round)||!Number.isSafeInteger(o.req)||(o.req as number)<1)return undefined;
  if(typeof o.to!=='string'||!o.to.length||o.to.length>PIX_TO_MAX||typeof o.amount!=='number')return undefined;
  return {t:'pix',round:o.round as number,req:o.req as number,to:o.to,amount:o.amount};
}
/** The room's answer to a PIX as the phone reads it, or undefined when malformed (an unknown reason included). */
export function parsePixed(m:unknown):{req:number;result:PixResult}|undefined{
  if(!m||typeof m!=='object')return undefined;
  const o=m as Record<string,unknown>;
  if(o.t!=='pixed'||!Number.isSafeInteger(o.req)||typeof o.ok!=='boolean')return undefined;
  const req=o.req as number;
  if(o.ok){
    if(typeof o.to!=='string'||!Number.isSafeInteger(o.amount)||!Number.isSafeInteger(o.grana))return undefined;
    return {req,result:{ok:true,to:o.to,amount:o.amount as number,grana:o.grana as number}};
  }
  return typeof o.reason==='string'&&Object.hasOwn(PIX_REFUSALS,o.reason)?{req,result:{ok:false,reason:o.reason as PixRefusal}}:undefined;
}
/**
 * A dropped player keeps the seat this long (VGM-047, definitive for phones, D-009/D-016): switching apps, answering a
 * message or changing networks is normal. Costs nothing on the free plan (an offline player sends nothing); the
 * standing character can still be hit, so a long absence ends in a fall like any other.
 */
export const GRACE_MS = 120_000;
export type Input = PlayerInput;
export type Player = Point & { id:string; name:string; classId:string; hp:number; ack:number; online:boolean; score:number; attackTick?:number; spectator?:boolean; skillTick?:number; skillReadyTick?:number;
  /** The viaduct (maps city/viaduct.ts): on a deck, floor 1; absent on the ground. */
  andar?:1 };
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
const wireHp=(hp:number)=>Number.isFinite(hp)&&hp>0?Math.ceil(hp-1e-9):0;
export function validInput(value:unknown):value is Input {
  if(!value||typeof value!=='object')return false;
  const v=value as Input;
  return Number.isSafeInteger(v.seq)&&v.seq>0&&v.seq<2**31&&Number.isFinite(v.x)&&Number.isFinite(v.y)&&Math.abs(v.x)<=1&&Math.abs(v.y)<=1&&typeof v.attack==='boolean'&&(v.skill===undefined||typeof v.skill==='boolean')&&(v.target===undefined||(typeof v.target==='string'&&/^[a-zA-Z0-9-]{1,40}$/.test(v.target)));
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
/** Wire rounding, also used by the room's Simulation for the fields it packs itself. */
export {round as wireRound,wireHp};
