import {DEFAULT_SEED,type WorldKind,cityTerrainFrom,cityTerrainFor,cityAsField,type CityTerrain} from '../src/maps/index.ts';
import {Simulation,DEFAULT_WORLD,worldDescriptor,type SimCheckpoint} from './simulation.ts';
import {LevelupPause} from './levelup-pause.ts';
import {CITY_PLAYABLE,CITY_SOON,INFINITO_REF,MAP_TEXT,ROOM_DEFAULT_MAP,checkJoinMaps,clientCatalog,isMapId,playersMissingMap,readMapRef,roomCatalog,sameMap,validateSetMap,welcomeMap,type MapCatalog,type MapId,type MapRef} from '../src/protocol/index.ts';
import {SOLO_ROOM_REFUSED,GRACE_MS,ROOM_PROTOCOL,ROOM_CLOSING_NOTICE,restartedNotice,resumedNotice,REPLACED_MESSAGE,UPDATE_NEEDED,KICK_BAN_MS,kickedMessage,OWNER_ONLY,OWNER_NOT_NOW,ROOM_FULL_BOTS} from '../src/protocol/index.ts';
import {RoomBots,botIdentity} from './room-bots.ts';
import {FrameEncoder,WireIds,SEND_EVERY,type FrameInput} from '../src/protocol/index.ts';
import {RunLifecycle,RUN_DURATION_TICKS,CITY_RUN_DURATION_TICKS,RUN_HZ} from '../src/sim/index.ts';
import { classes } from '../src/rules/index.ts';
import {createEnemy,isEnemyKind,isDefenseId} from '../src/sim/index.ts';
import {addTelegraph} from '../src/sim/index.ts';
import {CIDA_ITEM_IDS,TELEGRAPH_KINDS,type CombatMode,type ObjectiveKind,type TelegraphKind} from '../src/contract/index.ts';
import {walkable,worldBase} from '../src/maps/index.ts';
import {sha256Hex} from '../src/protocol/index.ts';
import {downPlayer} from '../src/sim/index.ts';
import {SOS_COOLDOWN_MS,SOS_SLACK_MS,EMOTE_COOLDOWN_MS,EMOTE_SLACK_MS,isEmoteId,MARK_ID,MARK_COOLDOWN_MS,relayMark} from '../src/rules/index.ts';

/** Lab moves ({t:'lab',to}) stay this close to the lab's base (the base plus labOffset), in world units. */
export const LAB_REACH=200;
import {isForgeTarget,isRecipeId} from '../src/rules/index.ts';
import type {ZueiraLab} from '../src/sim/index.ts';

/** Text frames are JSON control messages; binary frames are protocol 4 run frames (server -> client only). */
export type Peer={ send:(data:string|Uint8Array)=>void; close:(code:number,reason:string)=>void };
/**
 * offers: the pending-offer list (JSON) this peer last received, so each change is pushed once.
 * encoder: this client's protocol 4 encoder (VGM-042b), created on join; a reconnect gets a fresh one.
 */
type Connection={peer:Peer;playerId?:string;opened:number;ownerAt?:number;window:number;count:number;seen:number;offers:string;encoder?:FrameEncoder;bytes:number;frames:number;received:number;
  /** Its slot came up during a catch-up burst (N17): the frame goes once, on the burst's last tick. */
  owed?:boolean;
  /** When the recent frames left (seq → ms, a ring of FRAME_TIMES): an ack says how late this phone runs. */
  frameSeq?:Int32Array;frameAt?:Float64Array;
  /** How far behind this phone decodes (ms, the latest ack's frame age) and how many acks in a row came that late. */
  lag:number;lateAcks:number};
/** `hash` is sha256(token): storage only ever sees hashes; `token` is known in memory once issued or presented. */
type Session={id:string;hash:string;token?:string;until:number};
export interface RoomOptions {
  /** Combat safety limit in server ticks (tests shorten it). */
  durationTicks?:number;
  /** "Jogar sozinho" (sala-solo-privada): one person and their bots; any other person's first join is refused. */
  solo?:boolean;
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
  /** Lab only (wrangler dev with ALLOW_LOCAL and LAB_ZUEIRA "apagao,boletos,promo"): those zueira events, one per round from round 2 (VGM-053B). */
  labZueira?:ZueiraLab;
  /** Lab only (wrangler dev with ALLOW_LOCAL): keep per-tick and per-frame time samples for the /lab percentiles. */
  lab?:boolean;
  /**
   * VGM-047: called (at most once per receive/advance) when the roster changed, so the Durable Object can keep it in
   * storage (one row) and a restarted object can seat everyone again. See RoomRoster.
   */
  onRoster?:(roster:RoomRoster)=>void;
  /**
   * E5-checkpoint-por-round: called at the start of each round's intermission from round CHECKPOINT_FROM_ROUND on, with
   * the run as it stands then (RoomCheckpoint, at most CHECKPOINT_MAX_BYTES of JSON), so the Durable Object keeps it
   * in storage under its own key (one row per round, apart from the roster's) and a restarted object resumes it.
   */
  onCheckpoint?:(checkpoint:RoomCheckpoint)=>void;
  /** One line per socket end (closeLogLine): the Durable Object passes console.log, so `wrangler tail` shows it. */
  log?:(line:string)=>void;
  /**
   * D-034/D-035: the city asset's exact text and its manifest ref ({id,version,hash}), handed over by worker.ts (which
   * bundles them); room.ts never imports the asset, so node tests stay light and inject it themselves.
   */
  cityText?:string;
  cityRef?:MapRef;
  /** Whether the owner may pick the city: CITY_PLAYABLE (false until cidade-10) unless a test says otherwise. */
  cityPlayable?:boolean;
  /**
   * The map a new room opens on: ROOM_DEFAULT_MAP unless the Worker (the lab pins the endless map) or a test says
   * otherwise. A city that cannot be played here (locked, or no asset) falls back to the endless map, logged.
   */
  map?:MapId;
  /**
   * A person's seat id (default crypto.randomUUID). The run is a pure function of the seed, the inputs and these ids:
   * the sim breaks ties by player id (pickup order, revives, skills, zueira), so a person's random id decides whether
   * they come before or after the bots ('bot-1'…). Tests that compare runs pass a fixed sequence.
   */
  newId?:()=>string;
  /**
   * D-047: the match objective of the city room ('chaveiro': the car, the chaveiro's moto, Dona Cida, the waves).
   * false plays the old wall mode (survive 10 rounds, the boss). Absent: CITY_OBJECTIVE_DEFAULT. The endless map never
   * has one.
   */
  objective?:ObjectiveKind|false;
  /**
   * D-051: how the heroes fight in every map of this room (Simulation combat). 'manual': the attack button and the
   * equipped weapon, and {t:'cast'} is answered ok:false without a cast. Absent: the automatic weapons and the skill.
   */
  combat?:CombatMode;
  /**
   * D-051: 'ninhos' plays the nests instead of the waves in the city with the chaveiro (Simulation mode); ignored with
   * the wall mode and on the endless map. Absent: the rounds, as before (the default turns after the nests' bench).
   */
  mode?:'ninhos';
}
/**
 * D-047: the city rooms' objective when RoomOptions.objective is absent: the chaveiro, since it is balanced
 * (balanco-pos-1-7 part B, CI bench, 16 seeds, 30 min cap): the car v1 (alarm per contact, boss 2 hits, solo ETA) won
 * 1p 6/16 and 6p 11/16 with no car lost (from 1/16 and 6/16), Executor-6's economy (eco-v9: bill R$ 25 + 3 per hit,
 * bots keep 1.3× it) brought the victories with debt under a third. It had been off (the wall mode) until then: the
 * first calibrated bench (8 seeds) won 2/8 with 1 player but 1/8 with 6. false (RoomOptions.objective) still plays the
 * wall mode.
 */
export const CITY_OBJECTIVE_DEFAULT:ObjectiveKind|false='chaveiro';
/** The owner's setMap was refused because these people's builds cannot load that map (playersMissingMap). */
export const mapMissingText=(names:string[])=>`${names.join(', ')} ${names.length>1?'precisam':'precisa'} atualizar a página antes de trocar o mapa.`;
/**
 * What survives a restart of the Durable Object (deploy, eviction, crash), VGM-047: who sits in the room and where the
 * room was. The run itself is the checkpoint's (E5-checkpoint-por-round, RoomCheckpoint, its own storage row); without
 * a usable one the run ends honestly (D-024).
 */
export interface RoomRoster {
  v:2;
  /** A run was in combat (its loss is announced after a restart), and how far it got. */
  running:boolean;lost?:{round:number;level:number};
  /**
   * E5-checkpoint-por-round: the checkpoint this run stored last (its round and tick), only while running. A restart
   * resumes a stored checkpoint only when it is this one: an older row (a write that failed, or another run's) is ignored.
   */
  checkpoint?:{round:number;tick:number;run?:number};
  /** tokenHash = sha256(token); until = seat expiry of an offline player (null: connected when saved). */
  players:{id:string;name:string;classId:string;tokenHash:string;until:number|null}[];
  /** D-025 (optional, older rows have none): the owner, the room bots (seat slot), bots added so far, kicked seats. */
  owner?:string;
  bots?:{id:string;name:string;classId:string;slot:number}[];
  botsAdded?:number;
  bans?:{hash:string;until:number}[];
  nameBans?:{name:string;until:number}[];
  /**
   * D-035: the map the room plays, always written (the endless map too, so a room switched back to it stays there
   * whatever ROOM_DEFAULT_MAP is). Rows from before cidade-10 have none: they were on the endless map.
   */
  map?:MapId;
}
/**
 * E5-checkpoint-por-round: a restarted room puts everyone back at the start of the round that was going (the
 * intermission that opened it) instead of the lobby. Bumped when RoomCheckpoint's own envelope changes, or when only a
 * field that appears late in a run changes meaning: the systems' and seats' fields a fresh run holds are checked by
 * the shape fingerprint (SimCheckpoint.shape) without a bump. A stored checkpoint of another version is not resumed
 * (the lobby and the 'restarted' notice, as before).
 * 2: balanco-pos-1-7 renumbered the city's build sites (maps/build-sites.ts CITY_CELLS): a stored defense's `site`
 * ('obra-NN') would name another place than the x/y it stands on.
 */
export const CHECKPOINT_V=2;
/**
 * The first round whose intermission is checkpointed. Round 1 has nothing to keep yet (the starting kit, level 1, a
 * whole wall: its "intermission" is the 3 s opening), so a restart there falls back to the lobby, and every run writes
 * one row fewer. From round 2 on, a restart comes back to the round's intermission.
 */
export const CHECKPOINT_FROM_ROUND=2;
/** A checkpoint bigger than this (JSON chars) is not written (a storage value holds 128 KiB): that round restarts in the lobby. */
export const CHECKPOINT_MAX_BYTES=120_000;
/** What a room keeps of a run at a round's intermission (E5-checkpoint-por-round), stored apart from the roster. */
export interface RoomCheckpoint {
  v:number;
  /** The map it was taken on: resumed only on the same map (id, version and hash). */
  map:MapRef;
  /** The director's round (its intermission had just started) and the simulation tick: the roster's link. */
  round:number;tick:number;
  /** RunLifecycle: the run number clients echo, combat ticks so far, who was watching. */
  run:{round:number;elapsed:number;spectators:string[]};
  sim:SimCheckpoint;
}
const linkOf=(v:unknown)=>{
  const l=v as {round?:unknown;tick?:unknown;run?:unknown}|undefined;
  // run (review): the run counter too, so two runs of one room (the tick starts over) never share a link.
  return l&&typeof l==='object'&&Number.isSafeInteger(l.round)&&Number.isSafeInteger(l.tick)
    ?{round:l.round as number,tick:l.tick as number,...(Number.isSafeInteger(l.run)?{run:l.run as number}:{})}:undefined;
};
const classIds=new Set(classes.map(c=>c.id));
/** A class this build no longer has (Tia da Festa left, NEW-20261013-ORQ-classes-cartas-e-nomes): an old client that
 *  joins with it plays as the default class instead of being refused. Not a string is still invalid, and a restored
 *  roster stays strict (junk is dropped; that player joins again and lands here). */
const DEFAULT_CLASS=classes[0].id;
const knownClass=(id:unknown)=>typeof id==='string'&&classIds.has(id)?id:DEFAULT_CLASS;
/** The roster without what the owner churns (bots, map): what has to reach storage at once when it changes. */
const rosterCore=(r:RoomRoster)=>JSON.stringify({...r,bots:undefined,botsAdded:undefined,map:undefined});
/** Classes a room bot may get (any of the 36, D-025), in a fixed order for the seed pick. */
const BOT_CLASSES=classes.map(c=>c.id);
/** A command from the owner arrives with a bot's or a person's id (wire ids are the players' own). */
const PLAYER_ID=/^[\w-]{1,64}$/;
/** The owner's commands (kick, bot-add, bot-remove) from one connection: at most one this often (ms). */
export const OWNER_GAP_MS=300;
/**
 * A roster change that is only about bots or the map (the owner adding/removing bots, picking maps) is written at most
 * this often (ms); the room tick (and a socket end) flushes the last one.
 */
export const ROSTER_BOTS_MS=1000;
/**
 * The second sign of a kicked seat (D-025): the name, lower case, without accents, spaces or punctuation. The token is
 * the first (kept on the phone); a fresh browser with the same name is refused too. A new name gets in: no IP is kept.
 */
export const nameKey=(name:string)=>name.normalize('NFD').replace(/[^\p{L}\p{N}]/gu,'').toLocaleLowerCase('pt-BR');
/** A room accepts connections for this long after creation (the Worker's alarm deletes it a minute later). */
/** 50 min (D-043): a lobby plus the city's 30 min combat cap (cidade-escala-1-7) fit, with room for a rematch's countdown. */
/** No room emits this many events per ms (20 ticks/s: 2 500 per tick): the floor of event ids after a restart. */
const EVENTS_PER_MS_CEIL=50;
export const ROOM_LIFETIME_MS=50*60_000;
/**
 * Autopilot slots (3g-rede-sem-teleporte): 7, 9, 11… — apart from the room bots' 0..5 (own gather node and think tick)
 * and odd, so the bot brain makes them roamers that follow the team, not wall guards.
 */
const AUTOPILOT_SLOT=7;
const NO_SEATS:ReadonlySet<string>=new Set();
/** torres-fio: what a {t:'build'} may name (a build site or the Gustavão's rail) and an upgrade's branch. */
const BUILD_SITE=/^(obra-\d{2}|trilho)$/;
/**
 * An upgrade's branch, in any form the sim's pickChild takes: A/B/C, a tree label (A2…A5, A4b, A5b, B2…B6, C2…C5: what
 * the HUD's tree sends, trilho-no-snapshot) or the child's DefenseId.
 */
const BRANCH=/^([ABC]|[ABC][2-6]b?)$/;
const branchOk=(b:unknown)=>b===undefined||(typeof b==='string'&&(BRANCH.test(b)||isDefenseId(b)));
/**
 * A new run only starts when the room still has this long to live: a full horde run took ~13.7 min (plan §1); the
 * Stonewards intermissions of 30 s (VGM-046B) add ~1.5 min and the horn may stretch them by 90 s in all
 * (MAX_STRETCH_PER_RUN). The worst case on paper (every round to its timeout, every stretch, boss at its nominal 90 s)
 * is 16.6 min, so 18 (tests/sim/sim-stonewards.test.ts). Starting later would end with the room closing (4004) instead of a
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
/**
 * Critters off every legal screen of a client go in every other frame of it (5 Hz instead of 10; N27, horde bytes).
 * The frames are chained (FrameEncoder `chain`): deltas against the previous frame, the WebSocket being ordered.
 */
export const FAR_EVERY=2;
/**
 * A connection silent this long is closed (4004) and its seat waits GRACE_MS: with no network the close never comes
 * back, so this is also what stops the room's clock when every phone is gone (VGM-048 review).
 */
export const SILENT_MS=12_000;
/**
 * N27 (slow phone): a phone that is merely slow keeps its connection. Its main thread falls behind (CPU 4–6× in the
 * lab: frames decoded 10–40 s late, timers starved for 20 s), so its messages come late, yet it is there. What tells
 * it from a phone gone: its acks keep naming old frames, one after the other (SLOW_ACKS in a row at least
 * LATE_ACK_MS late). Only then the limit is SILENT_MS on top of how late it decodes, capped at SLOW_SILENT_MAX_MS,
 * counted from its last message. One ack on time puts it back at SILENT_MS. A network hiccup (an antenna change: one
 * late ack, then fresh ones) never extends it, and a phone that went away for good gets no more late acks: an empty
 * room stops its clock at most SLOW_SILENT_MAX_MS after a slow phone's last message (~6 GB-s at 128 MB).
 */
export const SLOW_SILENT_MAX_MS=45_000;
export const LATE_ACK_MS=2000,SLOW_ACKS=2;
/** Frame send times kept per connection for the lateness of its acks (10 Hz: ~51 s). */
const FRAME_TIMES=512;
export const silenceLimit=(c:{lag:number;lateAcks:number})=>c.lateAcks>=SLOW_ACKS?Math.min(SLOW_SILENT_MAX_MS,SILENT_MS+c.lag):SILENT_MS;
/**
 * BUG-20261012-ORQ-reconecta-round2: what one socket end looked like, for one log line (closeLogLine). `by` is who
 * ended it: the browser or the network (the socket's close event), an error event, or the room itself (silence, flood,
 * refused join, kick, replaced, leave, alarm). Only counters and the room's state: no name, token, player id or address.
 */
export interface CloseLog {
  by:'client'|'error'|'room';code:number|null;reason:string;clean:boolean|null;
  /** Run lifecycle phase and run round; the director's round index and phase (combat); the simulation tick. */
  phase:string;run:number;round:number;roundPhase:string;tick:number;
  /** Connection age, time since its last message, the silence limit it had (ms). */
  ageMs:number;idleMs:number;limitMs:number;
  /** Sent to it (bytes, binary frames), received from it (messages); its ack lag (ms) and late acks in a row. */
  bytes:number;frames:number;received:number;lag:number;lateAcks:number;
  /** It had a seat (joined); sockets the room held at that moment (this one included). */
  seated:boolean;conns:number;
}
/** Close reasons are cut to this many characters in the log (a client may send up to 123 bytes). */
export const CLOSE_REASON_MAX=60;
/**
 * The JSON line for one socket end: only the CloseLog keys, in a fixed order, numbers rounded (null when not finite),
 * the reason cut to CLOSE_REASON_MAX. Whatever else the caller's object carries never reaches the log.
 */
export function closeLogLine(f:CloseLog):string{
  const n=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?Math.round(v):null;
  const text=(v:unknown,max:number)=>typeof v==='string'?v.slice(0,max):'';
  return JSON.stringify({ev:'ws-end',by:f.by==='client'||f.by==='error'?f.by:'room',code:n(f.code),reason:text(f.reason,CLOSE_REASON_MAX),clean:typeof f.clean==='boolean'?f.clean:null,
    phase:text(f.phase,16),run:n(f.run),round:n(f.round),roundPhase:text(f.roundPhase,16),tick:n(f.tick),
    ageMs:n(f.ageMs),idleMs:n(f.idleMs),limitMs:n(f.limitMs),bytes:n(f.bytes),frames:n(f.frames),received:n(f.received),lag:n(f.lag),lateAcks:n(f.lateAcks),
    seated:f.seated===true,conns:n(f.conns)});
}
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
  /** wrangler dev with ALLOW_LOCAL (and tests): lab commands such as {t:'lab',down:true} are accepted. */
  private readonly labOn:boolean;
  private readonly newId:()=>string;
  /** Last "Me salva" ping per player (wall clock), for the room-side anti-spam (UX-resgate-e-ping). */
  private readonly sosAt=new Map<string,number>();
  /** When each player's last relayed emote went out (emote-relay-sala anti-spam). */
  private readonly emoteAt=new Map<string,number>();
  /** Last minimap ping per player (mark): its own anti-spam, apart from the emotes'. */
  private readonly markAt=new Map<string,number>();
  /** RunState last pushed as {t:'run'}, without the per-tick counters (clients count elapsed from frame ticks). */
  private runKey='';
  private readonly onRoster?:(roster:RoomRoster)=>void;
  private readonly log?:(line:string)=>void;
  /** Roster as last handed to onRoster (JSON), so only real changes are written. */
  private rosterKey='';
  /** Restored after a restart that cut a run: these players still have to hear why they are back in the lobby. */
  private lostRun=new Map<string,{round:number;level:number}>();
  /** Restored after a restart and the run resumed (E5-checkpoint-por-round): these players still have to hear it (the round). */
  private resumedRun=new Map<string,number>();
  private readonly onCheckpoint?:(checkpoint:RoomCheckpoint)=>void;
  /** The checkpoint this run stored last (RoomRoster.checkpoint); cleared when the combat ends. */
  private checkpointRef?:{round:number;tick:number;run?:number};
  /** The checkpoint the restored roster linked (restore), which resume() accepts; used once. */
  private restoredRef?:{round:number;tick:number;run?:number};
  /**
   * The owner ("chefe da sala", D-025): the first person seated, then the oldest person left when the owner leaves for
   * good (leave, seat expired). A short drop changes nothing. Only the owner's kick and bot commands are accepted.
   */
  owner?:string;
  /** Kicked seats: sha256(token) → until (ms). A join presenting that token (as `token` or `kicked`) is refused. */
  private bans=new Map<string,number>();
  /** Kicked names (nameKey) → until (ms): the second sign, for a join with no token at all. */
  private nameBans=new Map<string,number>();
  /** The room's bots (D-025): played inside the tick, no socket. */
  readonly bots=new RoomBots();
  /** "Jogar sozinho" (sala-solo-privada): only the person who opened it sits (their bots too). */
  readonly solo:boolean;
  /**
   * 3g-rede-sem-teleporte: the same light brain plays the hero of a person whose connection dropped (Simulation
   * autopilot), apart from the room bots (not in the roster, not counted as bots, never removed for a newcomer).
   */
  readonly autopilots=new RoomBots({chooses:false});
  /** D-050: the team's level-up pause (multiplayer/levelup-pause.ts); `lastNow`: the room clock its view counts from. */
  readonly levelup=new LevelupPause();
  private lastNow=Date.now();
  /** The bots' minds for Simulation.stateHash: the room bots', and the autopilots' when any (same hash as before otherwise). */
  private minds(){return this.autopilots.size?{bots:this.bots.state(),autopilots:this.autopilots.state()}:this.bots.state();}
  /** Bots ever added in this room (their names and classes follow the seed and this count). */
  private botsAdded=0;
  /** The map the room plays (D-026): announced in welcome and {t:'map'}, kept in the roster. */
  map:MapRef=INFINITO_REF;
  /** The world of the endless map's slot: DEFAULT_WORLD, or the island in tests and the lab (LAB_WORLD). */
  private readonly baseWorld:WorldKind;
  private readonly cityText?:string;
  private readonly cityRef?:MapRef;
  private readonly cityPlayable:boolean;
  /** D-047: the city runs' objective (RoomOptions.objective), undefined for the wall mode. */
  private readonly cityObjective?:ObjectiveKind;
  /** D-051: RoomOptions.combat, for every Simulation this room builds (undefined: the automatic weapons). */
  private readonly combat?:CombatMode;
  /** Each person's build catalog from join.maps (undefined: a client that sent none), for playersMissingMap. */
  private readonly catalogs=new Map<string,MapCatalog|undefined>();
  /** A city switch waiting for the asset to decode (its first use in this isolate); see ready(). */
  private switching?:Promise<void>;
  /** The map that waiting switch goes to: the owner's last pick, which a newer pick compares against (and cancels). */
  private target?:MapRef;
  /** Bumped by every switch: a waiting switch that finds a newer one when its decode lands gives way to it. */
  private mapGen=0;
  /** A test/tool's explicit combat cap; otherwise the map decides (D-043). */
  private fixedDuration:number|undefined;
  /** D-051: the Simulation option of RoomOptions.combat (nothing for the automatic weapons, so those rooms are as before). */
  private combatOption():{combat?:CombatMode}{return this.combat?{combat:this.combat}:{};}
  /** D-051: RoomOptions.mode, kept for the city Simulation (only with the chaveiro). */
  private readonly cityMode?:'ninhos';
  private durationFor(ref:MapRef){return this.fixedDuration??(ref.id==='cidade-nevada'?CITY_RUN_DURATION_TICKS:RUN_DURATION_TICKS);}
  constructor(createdAt=Date.now(),seed=DEFAULT_SEED,options:RoomOptions={}){
    this.solo=options.solo===true;
    const objective=options.objective===undefined?CITY_OBJECTIVE_DEFAULT:options.objective;if(objective)this.cityObjective=objective;
    if(options.combat==='manual')this.combat='manual';
    if(options.mode==='ninhos')this.cityMode='ninhos';
    this.baseWorld=options.world??DEFAULT_WORLD;this.cityText=options.cityText;this.cityRef=options.cityRef;this.cityPlayable=options.cityPlayable??CITY_PLAYABLE;
    this.createdAt=createdAt;this.sim=new Simulation(seed,{world:this.baseWorld,...this.combatOption()});this.sim.botState=()=>this.minds();
    this.labHorde=Math.max(0,Math.min(600,Math.floor(options.labHorde??0)));
    const o=options.labOffset;if(o&&Number.isFinite(o.x)&&Number.isFinite(o.y)&&(o.x||o.y))this.labOffset={x:o.x,y:o.y};this.sampling=!!options.lab||this.labHorde>0;this.labOn=!!options.lab;
    if(options.labZueira)this.sim.zueiraLab=options.labZueira;
    this.fixedDuration=options.durationTicks;this.newId=options.newId??(()=>crypto.randomUUID());
    this.run=new RunLifecycle(crypto.randomUUID(),options.durationTicks??RUN_DURATION_TICKS);
    this.onRoster=options.onRoster;this.onCheckpoint=options.onCheckpoint;this.log=options.log;
    // A city default starts decoding here; the Worker awaits ready() before the first join, so the welcome names it.
    // The default needs the city asset (the Worker always passes it); a room built without it (tests, tools) is simply
    // the endless map, without a fallback log. An explicit options.map still asks and logs when it can't be played.
    const map=options.map??(this.cityText!==undefined?ROOM_DEFAULT_MAP:'infinito');if(map!=='infinito')this.openMap(map,'create');
  }
  /** The maps this room accepts: the endless one, and the city once it is playable and its asset was handed over. */
  private catalog(){return roomCatalog(this.cityText!==undefined?this.cityRef:undefined,this.cityPlayable);}
  /** Resolves once no map switch is waiting for the city to decode (the Durable Object awaits it after a restore). */
  async ready(){
    while(this.switching)await this.switching;
    // The checkpoint fingerprint's throwaway run (50-130 ms once per process and map) is built here, not inside a tick.
    try{this.sim.freshShape();}catch{/* built (or not) on the first checkpoint instead */}
  }
  /** One JSON line about the map (fallbacks, decode failures) for `wrangler tail`; without a sink (tests, lab) nothing. */
  private logMap(line:object){try{this.log?.(JSON.stringify({ev:'map',...line}));}catch{/* a log line never ends a room */}}
  /**
   * A room opened or restored on `id` (RoomOptions.map, the stored roster): the city only when this room may play it,
   * else the endless map, logged; never a crash. False when it fell back. Supersedes whatever the room was heading to
   * (a restore after the constructor started the default city), and changes nothing when already going there.
   */
  private openMap(id:unknown,why:'create'|'restore'){
    const ref=id==='infinito'?INFINITO_REF:isMapId(id)?this.catalog().get(id):undefined;
    if(!ref)this.logMap({fallback:typeof id==='string'?id.slice(0,20):typeof id,why,to:'infinito'});
    const to=ref??INFINITO_REF;
    if(!sameMap(to,this.target??this.map))this.switchTo(to);
    return ref!==undefined;
  }
  /** Who sits in the room, whether a run is going and how far it got, for storage (token hashes only). */
  roster():RoomRoster{
    const running=this.run.snapshot().phase==='combat',w=this.sim.world;
    const bans=[...this.bans].map(([hash,until])=>({hash,until})),nameBans=[...this.nameBans].map(([name,until])=>({name,until}));
    const bots=[...this.sim.players.values()].filter(p=>this.sim.bots.has(p.id)).map(p=>({id:p.id,name:p.name,classId:p.classId,slot:this.bots.slotOf(p.id)}));
    return {v:2,running,...(running?{lost:{round:w.round.index,level:w.team.level}}:{}),...(running&&this.checkpointRef?{checkpoint:{...this.checkpointRef}}:{}),players:[...this.sim.players.values()].flatMap(p=>{
      const s=this.sessions.get(p.id);return s?[{id:p.id,name:p.name,classId:p.classId,tokenHash:s.hash,until:Number.isFinite(s.until)?s.until:null}]:[];
    }),...(this.owner?{owner:this.owner}:{}),...(bots.length?{bots}:{}),...(this.botsAdded?{botsAdded:this.botsAdded}:{}),...(bans.length?{bans}:{}),...(nameBans.length?{nameBans}:{}),map:this.map.id};
  }
  /**
   * A restarted Durable Object seats the stored roster again (VGM-047): same ids, token hashes and seat expiries
   * (a player already away keeps the grace it had; the ones connected at the restart get a fresh one), the room in
   * the lobby. A run that was going is lost, and each player is told what was lost when back (D-024).
   */
  restore(roster:RoomRoster,now=Date.now()){
    if(roster?.v!==2||!Array.isArray(roster.players))return;
    const lost=roster.running===true?{round:Number(roster.lost?.round)||0,level:Number(roster.lost?.level)||0}:undefined;
    this.restoredRef=lost?linkOf(roster.checkpoint):undefined;
    for(const r of roster.players.slice(0,6)){
      if(typeof r?.id!=='string'||typeof r.tokenHash!=='string'||!/^[0-9a-f]{64}$/.test(r.tokenHash)||typeof r.name!=='string'||!classIds.has(r.classId)||this.sim.players.has(r.id))continue;
      const until=typeof r.until==='number'&&Number.isFinite(r.until)?r.until:now+GRACE_MS;
      if(until<now)continue;
      this.sim.add(r.id,r.name,r.classId);this.sessions.set(r.id,{id:r.id,hash:r.tokenHash,until});
      this.run.join(r.id);this.run.setOnline(r.id,false);this.sim.setOnline(r.id,false);this.autopilots.add(r.id,this.autopilots.freeSlot(AUTOPILOT_SLOT,2));
      if(lost)this.lostRun.set(r.id,lost);
    }
    // D-025: kicked seats still out, the owner if still seated (else the oldest person), and the bots (only with people).
    for(const b of Array.isArray(roster.bans)?roster.bans:[])if(typeof b?.hash==='string'&&/^[0-9a-f]{64}$/.test(b.hash)&&Number.isFinite(b.until)&&b.until>now)this.bans.set(b.hash,b.until);
    for(const b of Array.isArray(roster.nameBans)?roster.nameBans:[])if(typeof b?.name==='string'&&b.name.length<=40&&Number.isFinite(b.until)&&b.until>now)this.nameBans.set(b.name,b.until);
    this.botsAdded=Number.isSafeInteger(roster.botsAdded)&&roster.botsAdded!>0?roster.botsAdded!:0;
    if(this.sessions.size)for(const b of Array.isArray(roster.bots)?roster.bots:[]){
      if(this.sim.players.size>=6||typeof b?.id!=='string'||!PLAYER_ID.test(b.id)||typeof b.name!=='string'||!classIds.has(b.classId)||this.sim.players.has(b.id))continue;
      this.seatBot(b.id,b.name.slice(0,20),b.classId,Number.isInteger(b.slot)?b.slot:this.bots.freeSlot());
    }
    this.setOwner(typeof roster.owner==='string'&&this.sessions.has(roster.owner)?roster.owner:this.oldestPerson());
    // D-035: the map the owner had picked (a row from before cidade-10 names none: the endless map, whatever the
    // default now is); a city this room cannot play now comes back as the endless map (logged).
    const kept=this.openMap(roster.map??'infinito','restore');
    this.syncSpectators();const restored=this.roster();
    // Keyed as the stored row reads (it may still name a city that is decoding): a decode that lands writes nothing
    // new, while one that fails (or a newer pick of the endless map) differs from it and rewrites the row.
    const stored=roster.map!==undefined&&roster.map!==this.map.id?{...restored,map:roster.map}:restored;
    this.rosterKey=JSON.stringify(stored);this.rosterCore=rosterCore(restored);this.rosterDirty=false;
    // The stored row still names the city: rewrite it on the next flush.
    if(!kept)this.rosterDirty=true;
  }
  /**
   * E5-checkpoint-por-round: after restore() and ready() (the map in place), the run the restart cut comes back from
   * its stored checkpoint: combat at the start of that round's intermission, every seat with its run (spectators as
   * they were, a seat the checkpoint never knew watching), and each restored player hears 'resumed' instead of
   * 'restarted' when back. Only the checkpoint the restored roster linked, of this CHECKPOINT_V, on the same map and
   * whose simulation part checks out; otherwise false and the room stays as restore() left it (lobby, 'restarted').
   */
  resume(checkpoint:unknown):boolean{
    // Never a half-loaded run (review): anything that throws on the stored data ends in today's lobby.
    try{return this.resumeChecked(checkpoint);}
    catch(e){try{this.sim.resetRun();}catch{/* the lobby's next run starts over anyway */}this.logCheckpoint({fallback:'throw',error:String(e).slice(0,120)});return false;}
  }
  /**
   * After a restart (worker load, resumed or not): event ids jump past anything the crashed process could have handed
   * out (EVENTS_PER_MS_CEIL per ms of the room's life), or the phones would drop the new events as already seen.
   */
  afterRestart(now=Date.now()){this.sim.world.raiseEventSeq(Math.max(0,now-this.createdAt)*EVENTS_PER_MS_CEIL);}
  private resumeChecked(checkpoint:unknown):boolean{
    const ref=this.restoredRef;this.restoredRef=undefined;
    const fallback=(why:string)=>{this.logCheckpoint({fallback:why});return false;};
    if(!ref)return fallback('no-link');
    const cp=checkpoint as Partial<RoomCheckpoint>|undefined;
    if(!cp||typeof cp!=='object')return fallback('missing');
    if(cp.v!==CHECKPOINT_V)return fallback('version');
    if(cp.round!==ref.round||cp.tick!==ref.tick||(ref.run!==undefined&&cp.run?.round!==ref.run))return fallback('stale');
    const map=readMapRef(cp.map);
    if(this.switching||!map||!sameMap(map,this.map))return fallback('map');
    const run=cp.run;
    if(this.run.snapshot().phase!=='lobby'||!this.sessions.size)return fallback('room');
    if(!run||!Number.isSafeInteger(run.round)||run.round<1||!Number.isSafeInteger(run.elapsed)||run.elapsed<0||!Array.isArray(run.spectators)||!run.spectators.every(id=>typeof id==='string'))return fallback('run');
    // Written by a build whose run state had another shape (a deploy changed a system's fields): never fed to this one.
    if(!this.sim.checkpointShapeOk(cp.sim))return fallback('shape');
    if(!this.sim.resume(cp.sim))return fallback('sim');
    if(!this.run.resume(run,new Set(cp.sim!.players.map(p=>p.id)))){this.sim.resetRun();return fallback('run');}
    this.ids.reset();this.sosAt.clear();this.emoteAt.clear();this.markAt.clear();this.bots.reset();this.autopilots.reset();this.levelup.reset();
    this.syncSpectators();
    // This round is the one stored: no new checkpoint until the next round, and the roster says running again.
    this.rosterRound=this.sim.world.round.index;this.checkpointRef=ref;this.rosterDirty=true;
    for(const id of this.lostRun.keys())this.resumedRun.set(id,ref.round);
    this.lostRun.clear();
    this.logCheckpoint({resumed:ref.round,tick:ref.tick});
    return true;
  }
  /** One JSON line about checkpoints (skipped, resumed, fallback) for `wrangler tail`; nothing without a sink. */
  private logCheckpoint(line:object){try{this.log?.(JSON.stringify({ev:'checkpoint',...line}));}catch{/* a log line never ends a room */}}
  /**
   * The run at the start of this intermission goes to storage (onCheckpoint) and the roster links it; one too big, or
   * a sink that throws, leaves the roster without a link (a restart in this round falls back to the lobby).
   */
  private saveCheckpoint(){
    this.checkpointRef=undefined;
    if(!this.onCheckpoint)return;
    const w=this.sim.world,run=this.run.snapshot();
    const cp:RoomCheckpoint={v:CHECKPOINT_V,map:{...this.map},round:w.round.index,tick:w.tick,
      run:{round:run.round,elapsed:run.elapsed,spectators:run.members.filter(m=>m.spectator).map(m=>m.id)},sim:this.sim.checkpoint()};
    let size=Infinity;try{size=JSON.stringify(cp).length;}catch{/* not JSON-safe: not stored */}
    if(size>CHECKPOINT_MAX_BYTES){this.logCheckpoint({skipped:Number.isFinite(size)?size:'json',round:cp.round});return;}
    try{this.onCheckpoint(cp);}catch{return;}
    this.checkpointRef={round:cp.round,tick:cp.tick,run:cp.run.round};
  }
  /** Something stored in the roster changed (seat, expiry, combat start/end, round): flush at the end of this call. */
  private rosterDirty=false;
  private rosterRound=-1;
  /** Hands the roster to storage when it changed: one row each time. */
  private flushRoster(now:number){
    if(!this.onRoster||!this.rosterDirty)return;
    const roster=this.roster(),key=JSON.stringify(roster);
    if(key===this.rosterKey){this.rosterDirty=false;return;}
    // Only the bots or the map changed (the owner adding or removing bots, D-025, or picking maps, D-035): at most one
    // row a second; the tick (or the next socket end) flushes the last one. Seats, kicks, leaves and runs are written
    // at once, and they carry the map and bots as they are then.
    const core=rosterCore(roster);
    if(core===this.rosterCore&&now-this.rosterWrittenAt<ROSTER_BOTS_MS)return;
    this.rosterDirty=false;this.rosterKey=key;this.rosterCore=core;this.rosterWrittenAt=now;this.perf.rosterWrites++;
    try{this.onRoster(roster);}catch{}
  }
  private rosterCore='';
  private rosterWrittenAt=-Infinity;
  connect(peer:Peer,now=Date.now()){
    if(now-this.createdAt>ROOM_LIFETIME_MS){this.logClose(undefined,'room',4004,'Sala encerrada. Crie uma nova.',null,now);peer.close(4004,'Sala encerrada. Crie uma nova.');return;}
    if(this.connections.size>=12){this.logClose(undefined,'room',4008,'Muitas conexões.',null,now);peer.close(4008,'Muitas conexões.');return;}
    this.connections.set(peer,{peer,opened:now,window:now,count:0,seen:now,offers:'[]',bytes:0,frames:0,received:0,lag:0,lateAcks:0});
  }
  receive(peer:Peer,raw:string,now=Date.now()){
    this.handle(peer,raw,now);this.flushRoster(now);
  }
  private handle(peer:Peer,raw:string,now:number){
    const c=this.connections.get(peer);if(!c)return;
    c.received++;
    if(raw.length>1024){this.logClose(c,'room',1009,'Mensagem muito grande.',null,now);peer.close(1009,'Mensagem muito grande.');this.disconnect(peer,now);return;}
    if(now-c.window>=1000){c.window=now;c.count=0;}
    if(++c.count>45){this.logClose(c,'room',4008,'Limite de mensagens.',null,now);peer.close(4008,'Limite de mensagens.');this.disconnect(peer,now);return;}
    let m:any;try{m=JSON.parse(raw);}catch{return;}
    if(!m||typeof m!=='object')return;
    c.seen=now;
    if(m.t==='join'&&!c.playerId){
      if(m.protocol!==ROOM_PROTOCOL){this.reject(peer,VERSION_REFUSED,now);return;}
      // A solo room with its person seated: a newcomer hears why at once, before any other check (review).
      if(this.solo&&m.token===undefined&&this.sessions.size>0){this.reject(peer,SOLO_ROOM_REFUSED,now);return;}
      this.expire(now);
      // Kicked from this room (D-025): the seat's token, presented to sit again or as `kicked` by a fresh join.
      const banned=this.banOf(m.token,now)??this.banOf(m.kicked,now);
      if(banned!==undefined){this.sendKicked(peer,banned,now);return;}
      // D-026: the room's map must be one this build ships (same version and hash). A build that sends no `maps`
      // (deployed before D-035) ships the endless map only: refused on the city, and its catalog says so afterwards.
      const maps=checkJoinMaps(m.maps===undefined?clientCatalog(undefined):m.maps,this.map);
      if(!maps.ok){this.reject(peer,maps.text,now);return;}
      let session:Session|undefined;
      if(m.token!==undefined){
        const hash=typeof m.token==='string'&&m.token.length<=200?sha256Hex(m.token):'';
        session=[...this.sessions.values()].find(s=>s.hash===hash);
        if(!session||session.until<now){this.reject(peer,'Sua sessão expirou. Entre novamente.',now);return;}
        // The newest connection takes the character (BUG-20261009-N1-reconexao-socket-velho): a phone back from another
        // network while the room still holds its dead socket, or a second tab. The old one hears why and is closed with
        // 4009, which the client never retries, so two real tabs cannot keep knocking each other out.
        for(const other of [...this.connections.values()])if(other!==c&&other.playerId===session.id){
          this.logClose(other,'room',4009,'Personagem entrou por outra conexão.',null,now);
          this.connections.delete(other.peer);
          try{other.peer.send(JSON.stringify({t:'replaced',message:REPLACED_MESSAGE}));}catch{}
          try{other.peer.close(4009,'Personagem entrou por outra conexão.');}catch{}
        }
        this.sim.setOnline(session.id,true);this.autopilots.remove(session.id);session.token=m.token;
      }else{
        // A solo room has its person already (a seat, online or away): nobody else sits (they come back with their token).
        if(this.solo&&this.sessions.size>0){this.reject(peer,SOLO_ROOM_REFUSED,now);return;}
        if(typeof m.name!=='string'||m.name.trim().length<1||m.name.trim().length>20||/[\u0000-\u001f\u007f]/.test(m.name)||typeof m.classId!=='string'){this.reject(peer,'Nome ou classe inválidos.',now);return;}
        const named=this.nameBans.get(nameKey(m.name));
        if(named!==undefined&&named>now){this.sendKicked(peer,named,now);return;}
        // A full room out of combat: the newest bot gives its seat to the person (bots fill, people come first).
        if(this.sim.players.size>=6&&this.run.snapshot().phase!=='combat'&&this.bots.size){this.removeBot(this.bots.ids.at(-1)!);this.pushRun();}
        if(this.sim.players.size>=6){this.reject(peer,'Sala cheia. Máximo de seis jogadores.',now);return;}
        const id=this.newId(),token=crypto.randomUUID()+crypto.randomUUID();session={id,hash:sha256Hex(token),token,until:Infinity};
        this.sim.add(id,m.name.trim(),knownClass(m.classId));this.sessions.set(id,session);
        if(!this.owner)this.setOwner(id);
      }
      session.until=Infinity;c.playerId=session.id;this.rosterDirty=true;this.catalogs.set(session.id,maps.maps);
      this.run.join(session.id);
      this.syncSpectators();
      // A fresh encoder per connection (the client's decoder.reset() on welcome matches it), in the emptier slot.
      c.encoder=new FrameEncoder(this.ids,{viewer:session.id,slot:this.freeSlot(c),chain:true,farEvery:FAR_EVERY});
      const player=this.sim.players.get(session.id)!;
      this.sendJson(c,{t:'welcome',protocol:ROOM_PROTOCOL,id:session.id,token:session.token,ack:player.ack,tick:this.sim.tick,
        run:this.runForClients(),world:worldDescriptor(this.sim.terrain),map:welcomeMap(this.map)});
      // The joiner sees the room at once (a full frame), not on its next broadcast slot.
      this.sendFrame(c,this.sim.frame(),now);
      // The run's drawn enemies, so this phone fetches their art now (arte-do-roster-no-render).
      this.pushElenco(c);
      // A reconnecting player gets its pending offers right away instead of on the next broadcast tick.
      this.pushOffers(c);
      // Back after the room restarted in the middle of a run (VGM-047): say what happened, once.
      const lost=this.lostRun.get(session.id);
      if(lost){this.lostRun.delete(session.id);this.sendJson(c,{t:'notice',kind:'restarted',...restartedNotice(lost)});}
      // E5-checkpoint-por-round: the run came back at the start of its round instead; said once too.
      const resumed=this.resumedRun.get(session.id);
      if(resumed!==undefined){this.resumedRun.delete(session.id);this.sendJson(c,{t:'notice',kind:'resumed',...resumedNotice(resumed)});}
      this.pushRun();return;
    }
    if(!c.playerId)return;
    if(m.t==='input'){
      // Inputs carry the ack of the last frame (one message instead of two at 20 Hz).
      if(m.ack!==undefined){c.encoder?.ack(m.ack);this.lateness(c,m.ack,now);}
      const state=this.run.snapshot();
      if(state.phase==='combat'&&m.round===state.round){
        // Tap targets are client ids (e12); the simulation knows server ids. Unknown ones only drop the target.
        const target=(label:unknown)=>typeof label==='string'?this.ids.resolve(label):undefined;
        // input-10hz: change segments [from,x,y,flags,target?]; a legacy single step still works.
        if(Array.isArray(m.steps))this.sim.input(c.playerId,{seq:m.seq,steps:m.steps.map((w:unknown)=>Array.isArray(w)&&w.length===5?[...w.slice(0,4),...(target(w[4])!==undefined?[target(w[4])]:[])]:w)},now);
        else this.sim.input(c.playerId,{...m,target:target(m.target)},now);
      }
    }
    else if(m.t==='ack'){c.encoder?.ack(m.seq);this.lateness(c,m.seq,now);}
    // Skill tap (input-10hz/E7): one-shot, answered with {t:'cast'} after the step that carries it.
    // D-051: the manual combat has no skill: an older client's tap is answered at once, ok false, and nothing is cast.
    else if(m.t==='cast'){
      if(this.combat==='manual'){if(Number.isSafeInteger(m.id))this.sendJson(c,{t:'cast',seq:m.id,ok:false,readyTick:0});}
      else{const state=this.run.snapshot();if(state.phase==='combat'&&m.round===state.round&&!this.levelup.paused)this.sim.tap(c.playerId,m.id);}
    }
    // The client lost its baselines (a frame failed to decode): next frame is full, unacked events go again.
    else if(m.t==='resync')c.encoder?.resync();
    else if(m.t==='choose')this.choose(c,m);
    else if(m.t==='forge')this.forge(c,m);
    else if(m.t==='build'||m.t==='upgrade'||m.t==='repair')this.tower(c,m);
    else if(m.t==='cida')this.cida(c,m);
    else if(m.t==='ready'&&typeof m.ready==='boolean'){
      if(m.ready&&!this.canStartRun(now)){this.notice(c,ROOM_CLOSING_NOTICE);return;}
      if(this.run.ready(c.playerId,m.round,m.ready)){this.syncSpectators();this.pushRun();}
    }
    else if(m.t==='rematch'){
      if(!this.canStartRun(now)){this.notice(c,ROOM_CLOSING_NOTICE);return;}
      if(this.run.rematch(c.playerId,m.round)){this.resetRun();this.syncSpectators();this.pushRun();}
    }
    else if(m.t==='ping')this.sendJson(c,{t:'pong',at:m.at});
    else if(m.t==='sos')this.sos(c,m,now);
    else if(m.t==='emote')this.emote(c,m,now);
    // Consent for the result's "momento mais vergonhoso" (VGM-053B): {t:'pref',shame:false} leaves this player out.
    else if(m.t==='pref'&&typeof m.shame==='boolean')this.sim.setShamePref(c.playerId,m.shame);
    // Lab only (wrangler dev with ALLOW_LOCAL, tests): put the sender down, or move it to a walkable spot, for the
    // acceptance shots of the off-screen and rescue cards (six players spread over the map, one caído far away).
    else if(m.t==='lab'&&this.labOn&&this.run.snapshot().phase==='combat')this.labCommand(c.playerId,m);
    else if(m.t==='kick')this.kick(c,m,now);
    else if(m.t==='bot-add')this.addBot(c,m,now);
    else if(m.t==='bot-remove')this.removeBotCommand(c,m,now);
    else if(m.t==='setMap')this.setMap(c,m,raw.length,now);
    else if(m.t==='leave'){this.logClose(c,'room',1000,'Saiu da sala.',null,now);this.dropPerson(c.playerId);this.syncSpectators();this.connections.delete(peer);peer.close(1000,'Saiu da sala.');this.pushRun();}
  }
  /** sha256(token) is kicked and still out at `now`: until when; else undefined. */
  private banOf(token:unknown,now:number){
    if(typeof token!=='string'||token.length>200||!this.bans.size)return undefined;
    const until=this.bans.get(sha256Hex(token));
    if(until===undefined)return undefined;
    if(until<=now){this.bans.delete(sha256Hex(token));this.rosterDirty=true;return undefined;}
    return until;
  }
  /** Says why and closes (4003: the client stops); the client keeps the token to show the same answer next time. */
  private sendKicked(peer:Peer,until:number,now:number){
    const message=kickedMessage(until,now);
    try{peer.send(JSON.stringify({t:'kicked',message,until}));}catch{}
    this.logClose(this.connections.get(peer),'room',4003,'Expulso da sala.',null,now);
    this.connections.delete(peer);
    try{peer.close(4003,'Expulso da sala.');}catch{}
  }
  /**
   * The owner's commands (D-025) go through here: from the owner only, out of combat only (lobby, countdown, result),
   * for this run's round. A refusal is a notice to the sender (its buttons were stale).
   */
  private ownerCommand(c:Connection,m:any,now:number){
    const state=this.run.snapshot();
    if(m.round!==state.round)return false;
    // One owner command per OWNER_GAP_MS per connection: a stuck finger or a script cannot churn bots (and rows).
    if(c.ownerAt!==undefined&&now>=c.ownerAt&&now-c.ownerAt<OWNER_GAP_MS)return false;
    c.ownerAt=now;
    if(c.playerId!==this.owner){this.notice(c,OWNER_ONLY);return false;}
    if(state.phase==='combat'){this.notice(c,OWNER_NOT_NOW);return false;}
    return true;
  }
  /** {t:'kick',id,round}: the person leaves the room and stays out for KICK_BAN_MS; a bot id just removes the bot. */
  private kick(c:Connection,m:any,now:number){
    if(!this.ownerCommand(c,m,now))return;
    const id=m.id;
    if(typeof id!=='string'||id===c.playerId)return;
    if(this.sim.bots.has(id)){this.removeBot(id);return;}
    const session=this.sessions.get(id);
    if(!session)return;
    const until=now+KICK_BAN_MS,name=this.sim.players.get(id)?.name;
    this.bans.set(session.hash,until);
    if(name)this.nameBans.set(nameKey(name),until);
    for(const other of [...this.connections.values()])if(other.playerId===id)this.sendKicked(other.peer,until,now);
    this.dropPerson(id);this.syncSpectators();this.pushRun();
  }
  /** {t:'bot-add',round}: one more bot, while the room has fewer than six (bots count). */
  private addBot(c:Connection,m:any,now:number){
    if(!this.ownerCommand(c,m,now))return;
    if(this.sim.players.size>=6){this.notice(c,ROOM_FULL_BOTS);return;}
    const n=this.botsAdded++,taken=new Set([...this.sim.players.values()].map(p=>p.name));
    const {name,classId}=botIdentity(this.sim.seed,n,BOT_CLASSES,taken);
    this.seatBot(`bot-${n+1}`,name,classId,this.bots.freeSlot());
    this.syncSpectators();this.pushRun();
  }
  /** {t:'bot-remove',round,id?}: that bot, or the last one added. */
  private removeBotCommand(c:Connection,m:any,now:number){
    if(!this.ownerCommand(c,m,now))return;
    const id=typeof m.id==='string'?m.id:this.bots.ids.at(-1);
    if(id&&this.sim.bots.has(id)){this.removeBot(id);this.pushRun();}
  }
  /**
   * {t:'setMap',map} (D-026/D-035): the owner picks the map in the lobby. Throttled like the other owner commands; the
   * locked city answers CITY_SOON; then validateSetMap (owner, lobby, catalog). The pick is compared with where the
   * room is going (a city still decoding counts as picked): the same map changes nothing; another one supersedes the
   * waiting switch, so the room ends on the owner's last pick. One that a connected person's build cannot load is
   * refused with their names.
   */
  private setMap(c:Connection,m:unknown,rawLength:number,now:number){
    if(c.ownerAt!==undefined&&now>=c.ownerAt&&now-c.ownerAt<OWNER_GAP_MS)return;
    c.ownerAt=now;
    if((m as {map?:unknown}).map==='cidade-nevada'&&!this.catalog().has('cidade-nevada')){this.notice(c,CITY_SOON);return;}
    const check=validateSetMap(m,{rawLength,senderId:c.playerId,ownerId:this.owner,phase:this.run.snapshot().phase,current:this.target??this.map,catalog:this.catalog()});
    if(!check.ok){this.notice(c,check.text);return;}
    if(!check.changed||this.missing(c,check.map))return;
    this.switchTo(check.map,c);
  }
  /**
   * Connected people whose build cannot load `ref`: the owner hears their names and true comes back (no switch).
   * Only connected people count: their catalog came with this connection's join. A seat that is away (a dropped
   * phone, or every seat right after a restart, whose catalogs were never stored) is checked again by checkJoinMaps
   * when it comes back, and refused with the update text then if its build lacks the map; it never blocks the owner.
   */
  private missing(c:Connection,ref:MapRef){
    const online=new Map<string,MapCatalog|undefined>();
    for(const other of this.connections.values())if(other.playerId&&this.catalogs.has(other.playerId))online.set(other.playerId,this.catalogs.get(other.playerId));
    const names=playersMissingMap(ref,online).map(id=>this.sim.players.get(id)?.name??id).sort((x,y)=>x.localeCompare(y,'pt-BR'));
    if(names.length)this.notice(c,mapMissingText(names));
    return names.length>0;
  }
  /**
   * Switches to `ref`, superseding any switch still waiting (only the newest pick applies): the endless map at once;
   * the city at once when this isolate already decoded it, else after its asset decodes (sha256 checked). `from` (the
   * owner's connection) is checked again after the wait: a countdown that started, an owner who left or a person who
   * joined without the map cancel it. A decode that fails leaves the room where it is and its roster row rewritten
   * (a restored row may still name the city).
   */
  private switchTo(ref:MapRef,from?:Connection){
    const gen=++this.mapGen;this.rosterDirty=true;
    const city=ref.id==='cidade-nevada';
    const cached=city&&ref.hash?cityTerrainFor(ref.hash):undefined;
    if(!city||cached){this.target=undefined;if(!sameMap(ref,this.map))this.applyMap(ref,cached);return;}
    this.target=ref;
    const prev=this.switching,text=this.cityText;
    const job=(async()=>{
      try{
        await prev;
        const decoded=text!==undefined&&ref.hash?await cityTerrainFrom(text,ref.hash):undefined;
        // A newer pick came while this one decoded: it already decided (or will), this one gives way silently.
        if(gen!==this.mapGen)return;
        this.target=undefined;
        if(!decoded?.ok){
          this.logMap({failed:ref.id,error:decoded?.error.slice(0,80)??'no asset'});if(from)this.notice(from,MAP_TEXT.unknown);
          this.rosterDirty=true;this.flushRoster(Date.now());return;
        }
        if(sameMap(ref,this.map))return;
        if(this.run.snapshot().phase!=='lobby'){if(from)this.notice(from,MAP_TEXT.lobbyOnly);return;}
        if(from&&(this.connections.get(from.peer)!==from||from.playerId!==this.owner||this.missing(from,ref)))return;
        this.applyMap(ref,decoded.terrain);this.flushRoster(Date.now());
      }catch(error){if(gen===this.mapGen)this.target=undefined;this.logMap({failed:ref.id,error:String(error).slice(0,80)});}
    })();
    this.switching=job;
    void job.then(()=>{if(this.switching===job)this.switching=undefined;});
  }
  /**
   * The new map: a fresh Simulation on its terrain with the same people and bots (seats, online, spectators, the
   * shame opt-outs), fresh wire ids and full frames for everyone, readies reset (bots stay ready), the roster marked,
   * then {t:'map',map,world} to every seated player before the run state and the next frame.
   */
  private applyMap(ref:MapRef,city?:CityTerrain){
    const old=this.sim;
    // The city's frames carry its 4 barricades (kind 'barricada', cityStructures): the client draws them and repairs them.
    const sim=city?new Simulation(old.seed,{world:'cidade',terrain:cityAsField(city),cityStructures:true,...(this.cityObjective?{objective:this.cityObjective}:{}),...(this.cityMode&&this.cityObjective==='chaveiro'?{mode:this.cityMode}:{}),...this.combatOption()})
      :new Simulation(old.seed,{world:this.baseWorld,...this.combatOption()});
    sim.botState=()=>this.minds();if(old.zueiraLab)sim.zueiraLab=old.zueiraLab;
    for(const p of old.players.values()){
      const next=old.bots.has(p.id)?sim.addBot(p.id,p.name,p.classId):sim.add(p.id,p.name,p.classId);
      next.ack=p.ack;next.spectator=p.spectator;sim.setOnline(p.id,p.online);
    }
    for(const id of old.shameOptOut)if(sim.players.has(id))sim.shameOptOut.add(id);
    // The event ids go on from the old simulation's (phones drop an id they already saw).
    sim.world.raiseEventSeq(old.world.lastEventId);
    this.sim=sim;this.map=ref;this.run.setDurationTicks(this.durationFor(ref));
    this.ids.reset();this.sosAt.clear();this.emoteAt.clear();this.markAt.clear();this.bots.reset();this.autopilots.reset();
    for(const c of this.connections.values())c.encoder?.resync();
    this.run.resetReady();this.syncSpectators();this.rosterDirty=true;
    this.send({t:'map',map:welcomeMap(ref),world:worldDescriptor(sim.terrain)});
    this.pushRun();
  }
  private seatBot(id:string,name:string,classId:string,slot:number){
    this.sim.addBot(id,name,classId);this.run.join(id,{bot:true});this.bots.add(id,slot);this.rosterDirty=true;
  }
  private removeBot(id:string){
    this.sim.remove(id);this.run.leave(id);this.bots.remove(id);this.sosAt.delete(id);this.emoteAt.delete(id);this.rosterDirty=true;this.syncSpectators();
  }
  /**
   * A person leaves for good (leave, kicked, seat expired): out of the run and the room; the owner's post goes to the
   * oldest person left; with nobody left, the bots go too (a room of bots alone plays for no one).
   */
  private dropPerson(id:string){
    this.autopilots.remove(id);
    this.rosterDirty=true;this.sim.remove(id);this.run.leave(id);this.sessions.delete(id);this.catalogs.delete(id);this.sosAt.delete(id);this.emoteAt.delete(id);this.lostRun.delete(id);this.resumedRun.delete(id);
    if(!this.sessions.size)for(const bot of this.bots.ids)this.removeBot(bot);
    if(this.owner===id||!this.sessions.has(this.owner??''))this.setOwner(this.oldestPerson());
  }
  /** The person seated longest (sessions keep the join order; a restore keeps the roster's). */
  private oldestPerson(){return this.sessions.keys().next().value as string|undefined;}
  private setOwner(id:string|undefined){if(this.owner!==id){this.owner=id;this.rosterDirty=true;}this.run.setOwner(id);}
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
  private labCommand(id:string,m:any){
    const p=this.sim.players.get(id);if(!p)return;
    if(m.down===true)downPlayer(this.sim.world,p);
    // D-025 proofs: the run ends now (a defeat), so the owner's result screen is photographed without a 15-minute wait.
    if(m.end===true){if(this.run.finish('defeat',this.sim.shameMoment()))this.announce();return;}
    // VGM-053B proofs: the sender knocks out every critter left (not the boss), so a round ends by its last kill
    // (and its kill-cam) without waiting for stragglers on the endless map.
    if(m.wipe===true)for(const e of [...this.sim.world.enemies.values()])if(!e.boss)this.sim.world.damageEnemy(e.id,1e9,id);
    // VGM-053B proofs (design review D3): a harmless telegraph (0 damage) and a critter at a point near the base reach,
    // so the blackout is photographed with danger on screen.
    const lab=(v:unknown)=>v&&typeof v==='object'&&Number.isFinite((v as {x:number}).x)&&Number.isFinite((v as {y:number}).y)&&
      Math.hypot((v as {x:number}).x-worldBase(this.sim.terrain).x,(v as {y:number}).y-worldBase(this.sim.terrain).y)<=LAB_REACH?v as {x:number;y:number}:undefined;
    // D-036 proofs: `telegraph.kind` (one of TELEGRAPH_KINDS) gives it a hazard's look, and 'arroto'/'coco' its effect.
    const tg=lab(m.telegraph),tgKind=(m.telegraph as {kind?:unknown}|undefined)?.kind;
    if(tg)addTelegraph(this.sim.world,{shape:'circle',x:tg.x,y:tg.y,radius:1.8,damage:0,owner:'env:lab',
      ...(TELEGRAPH_KINDS.includes(tgKind as TelegraphKind)?{kind:tgKind as TelegraphKind}:{})},50);
    const at=lab(m.spawn),kind=typeof m.kind==='string'?m.kind:'';
    if(at&&isEnemyKind(kind)&&kind!=='chefe'&&walkable(at,this.sim.terrain))createEnemy(this.sim.world,kind,at);
    const to=m.to;
    // Within LAB_REACH of the base (the endless world is walkable almost everywhere: no lab jump to the far chunks).
    // Measured from where the lab put the team (LAB_OFFSET moves everyone away from the world's base).
    const b=worldBase(this.sim.terrain),o=this.labOffset,base={x:b.x+(o?.x??0),y:b.y+(o?.y??0)};
    if(to&&Number.isFinite(to.x)&&Number.isFinite(to.y)&&Math.hypot(to.x-base.x,to.y-base.y)<=LAB_REACH&&walkable(to,this.sim.terrain)){p.x=to.x;p.y=to.y;this.sim.setOnline(id,true);}
  }
  /**
   * "Me salva" (UX-resgate-e-ping): a caído in combat asks for help; the room relays {t:'sos',id,x,y,tick} once to
   * everyone in the room (the sender included, as its confirmation), at most once per SOS_COOLDOWN_MS − SOS_SLACK_MS
   * per player (the button already waits the full 3 s; the slack absorbs network jitter between two honest taps).
   * The position is the room's, never the client's. Anything else (standing, out, stale round, flood) is dropped.
   */
  private sos(c:Connection,m:any,now:number){
    const state=this.run.snapshot();
    if(state.phase!=='combat'||m.round!==state.round)return;
    const p=this.sim.players.get(c.playerId!);
    if(!p||!p.downed||p.eliminated||p.spectator)return;
    const last=this.sosAt.get(p.id);
    if(last!==undefined&&now>=last&&now-last<SOS_COOLDOWN_MS-SOS_SLACK_MS)return;
    this.sosAt.set(p.id,now);
    this.send({t:'sos',id:p.id,x:Math.round(p.x*100)/100,y:Math.round(p.y*100)/100,tick:this.sim.tick});
  }
  /**
   * Quick emote (emote-relay-sala): {t:'emote',round,id} in a match (wave or intermission), relayed once to everyone as
   * {t:'emote',player,id,round}, the sender included (its confirmation: the bar never shows its own tap twice), at most
   * once per EMOTE_COOLDOWN_MS − EMOTE_SLACK_MS per player. Spectators watch; unknown ids, stale rounds and floods drop.
   */
  private emote(c:Connection,m:any,now:number){
    const state=this.run.snapshot();
    if(state.phase!=='combat'||m.round!==state.round)return;
    if(m.id===MARK_ID){this.mark(c,m,state.round,now);return;}
    if(!isEmoteId(m.id))return;
    const p=this.sim.players.get(c.playerId!);
    if(!p||p.spectator)return;
    const last=this.emoteAt.get(p.id);
    if(last!==undefined&&now>=last&&now-last<EMOTE_COOLDOWN_MS-EMOTE_SLACK_MS)return;
    this.emoteAt.set(p.id,now);
    this.send({t:'emote',player:p.id,id:m.id,round:state.round});
  }
  /**
   * A minimap ping (minimapa-wc3, client/fun/marks.ts): an emote with the id 'marca' and a world point, relayed to
   * everyone (the sender included) as {t:'emote',player,id:'marca',round,x,y}, at most once per MARK_COOLDOWN_MS per
   * player (its own clock: a ping never eats an emote's turn). Spectators watch; a bad point drops.
   */
  private mark(c:Connection,m:any,round:number,now:number){
    const p=this.sim.players.get(c.playerId!),at=relayMark(m);
    if(!p||p.spectator||!at)return;
    const last=this.markAt.get(p.id);
    if(last!==undefined&&now>=last&&now-last<MARK_COOLDOWN_MS)return;
    this.markAt.set(p.id,now);
    this.send({t:'emote',player:p.id,id:MARK_ID,round,x:at.x,y:at.y});
  }
  /** "Me salva" of a fallen bot: the same relay and anti-spam as a person's (UX-resgate-e-ping). */
  private botSos(id:string,now:number){
    const p=this.sim.players.get(id);
    if(!p?.downed||p.eliminated||p.spectator)return;
    const last=this.sosAt.get(id);
    if(last!==undefined&&now>=last&&now-last<SOS_COOLDOWN_MS)return;
    this.sosAt.set(id,now);
    this.send({t:'sos',id,x:Math.round(p.x*100)/100,y:Math.round(p.y*100)/100,tick:this.sim.tick});
  }
  /**
   * Forge tap (VGM-046B): {t:'forge',round,recipe,req,target?}. The simulation validates everything (phase, standing,
   * in the camp, team balance; `req` makes a resend apply once); the buyer hears {t:'forged',req,ok,reason?} at once,
   * everyone sees the balance in the next frame and the recipe's line as a `say` event. `target` (cidade-06, optional,
   * so older phones are unchanged) names what 'reparo' repairs: 'muralha' or 'barricada-N|S|L|O' (isForgeTarget);
   * absent means the wall, any other value drops the tap here.
   */
  private forge(c:Connection,m:any){
    const state=this.run.snapshot();
    if(state.phase!=='combat'||m.round!==state.round)return;
    if(!isRecipeId(m.recipe)||!Number.isSafeInteger(m.req)||m.req<1)return;
    if(m.target!==undefined&&!isForgeTarget(m.target))return;
    const result=this.sim.forge(c.playerId!,m.recipe,String(m.req),m.target);
    this.sendJson(c,{t:'forged',req:m.req,recipe:m.recipe,ok:result.ok,...(result.ok?{}:{reason:result.reason})});
  }
  /**
   * torres-fio: {t:'build',round,req,site} (a build site id 'obra-NN' or the rail 'trilho') or {t:'upgrade',round,req,
   * defense,branch?} (the defense's wire label; branch A/B/C, or A4b/A5b for the alternative), and since torres-ajustes
   * {t:'repair',round,req,defense} (same label). Anything malformed is dropped here; the sim says no with a reason (e.g.
   * 'away' when the hero is not next to the obra). The sender hears {t:'built',req,ok,reason?,kind?}.
   */
  private tower(c:Connection,m:any){
    const state=this.run.snapshot();
    if(state.phase!=='combat'||m.round!==state.round)return;
    if(!Number.isSafeInteger(m.req)||m.req<1)return;
    let result;
    if(m.t==='build'){
      if(typeof m.site!=='string'||!BUILD_SITE.test(m.site))return;
      result=this.sim.build(c.playerId!,m.site,`p:${m.req}`);
    }else{
      const id=typeof m.defense==='string'&&m.defense.length<=12?this.ids.resolve(m.defense):undefined;
      if(!id)return;
      if(m.t==='repair')result=this.sim.repair(c.playerId!,id,`p:${m.req}`);
      else{
        if(!branchOk(m.branch))return;
        result=this.sim.upgrade(c.playerId!,id,m.branch,`p:${m.req}`);
      }
    }
    this.sendJson(c,{t:'built',req:m.req,ok:result.ok,...(result.ok?{kind:result.kind}:{reason:result.reason})});
  }
  /**
   * D-047 Dona Cida: {t:'cida',round,req,item} (item one of CIDA_ITEM_IDS). Malformed taps are dropped here; the sim
   * says no with a reason ('away' from the moto, 'stock', 'grana', 'phase', or 'duplicate' for a resent req). The
   * buyer hears {t:'bought',req,item,ok,grana?|reason?}; everyone sees the Grana and the stock in the next frame and the
   * purchase as a `buy` event.
   */
  private cida(c:Connection,m:any){
    const state=this.run.snapshot();
    if(state.phase!=='combat'||m.round!==state.round)return;
    if(!Number.isSafeInteger(m.req)||m.req<1||typeof m.item!=='string'||!(CIDA_ITEM_IDS as readonly string[]).includes(m.item))return;
    // D-050: nobody shops while the team picks its cards (the forge and the obra are intermission-only anyway).
    const result=this.levelup.paused?{ok:false as const,reason:'phase' as const}:this.sim.buyCida(c.playerId!,m.item,`p:${m.req}`);
    this.sendJson(c,{t:'bought',req:m.req,item:m.item,ok:result.ok,...(result.ok?{grana:result.grana}:{reason:result.reason})});
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
  /** The run as clients see it: RunState plus, in a level-up pause (D-050), its clock and who is still picking. */
  private runForClients(){
    const snap=this.run.snapshot(),pause=snap.phase==='combat'?this.levelup.view(this.sim,this.lastNow):undefined;
    return pause?{...snap,pause}:snap;
  }
  private pushRun(force=false){
    const run=this.runForClients(),pause=run.pause;
    // A pause goes out once per second of its clock (and when who is waiting changes), like the countdown.
    const key=JSON.stringify({...run,elapsed:0,remaining:run.phase==='countdown'?Math.ceil(run.remaining/RUN_HZ):0,...(pause?{pause:{...pause,leftMs:Math.ceil(pause.leftMs/1000)}}:{})});
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
  private reject(peer:Peer,message:string,now:number){peer.send(JSON.stringify({t:'error',message}));this.logClose(this.connections.get(peer),'room',4003,message,null,now);this.connections.delete(peer);peer.close(4003,message);}
  /** The socket's close (or error) event, from the Durable Object: one log line, and the seat waits GRACE_MS. */
  closed(peer:Peer,end:{by?:'client'|'error';code?:number;reason?:string;clean?:boolean}={},now=Date.now()){
    this.logClose(this.connections.get(peer),end.by??'client',end.code??null,end.reason??'',end.clean??null,now);
    // The last socket's end stops the room's clock (worker.ts): write now, so a map or bots row still waiting on
    // ROSTER_BOTS_MS, and this seat's grace, survive a restart.
    this.disconnect(peer,now);this.flushRoster(now);
  }
  /** The Durable Object ends a socket itself (a binary message, the alarm): one log line, the seat waits, closed. */
  close(peer:Peer,code:number,reason:string,now=Date.now()){
    this.logClose(this.connections.get(peer),'room',code,reason,null,now);
    this.disconnect(peer,now);peer.close(code,reason);this.flushRoster(now);
  }
  /** One closeLogLine for this socket end (nothing without a log sink: tests and the lab stay quiet). */
  private logClose(c:Connection|undefined,by:CloseLog['by'],code:number|null,reason:string,clean:boolean|null,now:number){
    if(!this.log)return;
    const run=this.run.snapshot(),round=this.sim.world.round;
    try{this.log(closeLogLine({by,code,reason,clean,phase:run.phase,run:run.round,round:round.index,roundPhase:round.phase,tick:this.sim.tick,
      ageMs:c?now-c.opened:0,idleMs:c?now-c.seen:0,limitMs:c?silenceLimit(c):0,bytes:c?.bytes??0,frames:c?.frames??0,received:c?.received??0,lag:c?.lag??0,lateAcks:c?.lateAcks??0,
      seated:!!c?.playerId,conns:this.connections.size}));}catch{/* a log line never ends a room */}
  }
  disconnect(peer:Peer,now=Date.now()){
    const c=this.connections.get(peer);this.connections.delete(peer);
    if(c?.playerId){
      this.rosterDirty=true;this.sim.setOnline(c.playerId,false);this.run.setOnline(c.playerId,false);this.syncSpectators();const session=this.sessions.get(c.playerId);if(session)session.until=now+GRACE_MS;
      if(!this.autopilots.has(c.playerId))this.autopilots.add(c.playerId,this.autopilots.freeSlot(AUTOPILOT_SLOT,2));
    }
  }
  private syncSpectators(){for(const m of this.run.snapshot().members){const p=this.sim.players.get(m.id);if(p)p.spectator=m.spectator;}}
  /**
   * 3g-rede-sem-teleporte: during a match the seats of the people away are held for the whole run (their hero plays on
   * its own), as long as someone is still connected: an empty room keeps the GRACE_MS rule, so it does not tick (and
   * bill) for nobody. The held seats keep GRACE_MS after the hold ends (result, rematch).
   */
  holdsSeats():ReadonlySet<string>{
    const run=this.run.snapshot();
    if((run.phase!=='combat'&&run.phase!=='countdown')||![...this.connections.values()].some(c=>!!c.playerId))return NO_SEATS;
    // Only the run's own players (a person who never came back is a spectator of the next run: not held again).
    return new Set(run.members.filter(m=>!m.spectator&&!m.bot).map(m=>m.id));
  }
  expire(now:number){
    const held=this.holdsSeats();
    for(const s of [...this.sessions.values()]){
      // Extended in memory only (a write per tick would bill): a restart loses the run anyway (VGM-047).
      if(held.has(s.id)&&Number.isFinite(s.until))s.until=Math.max(s.until,now+GRACE_MS);
      else if(s.until<now)this.dropPerson(s.id);
    }
    for(const [hash,until] of this.bans)if(until<=now){this.bans.delete(hash);this.rosterDirty=true;}
    for(const [name,until] of this.nameBans)if(until<=now){this.nameBans.delete(name);this.rosterDirty=true;}
    this.syncSpectators();
  }
  /** New run (start or rematch): fresh simulation run and fresh wire ids (server ids start over, D-018). */
  private resetRun(){
    this.checkpointRef=undefined;this.levelup.reset();
    this.sim.resetRun();this.ids.reset();this.sosAt.clear();this.emoteAt.clear();this.markAt.clear();this.bots.reset();this.autopilots.reset();
    const o=this.labOffset;if(!o)return;
    // Lab: the whole team moves out together, each onto the nearest walkable spot.
    for(const p of this.sim.players.values()){
      const at={x:p.x+o.x,y:p.y+o.y};
      for(let r=0;r<20&&!walkable(at,this.sim.terrain);r++){at.x+=.7;at.y+=.3;}
      p.x=at.x;p.y=at.y;
    }
  }
  /**
   * One room tick. `flush` false: a tick of a catch-up burst before its last one (multiplayer/tick-clock.ts): the
   * simulation steps and every encoder gets the events, but frames wait for the burst's last tick, one per client.
   */
  advance(now=Date.now(),flush=true){
    const started=performance.now();this.lastNow=now;
    for(const c of [...this.connections.values()]){
      if(now-this.createdAt>ROOM_LIFETIME_MS||(!c.playerId&&now-c.opened>5000)||now-c.seen>silenceLimit(c)){this.logClose(c,'room',4004,'Conexão expirada.',null,now);this.disconnect(c.peer,now);c.peer.close(4004,'Conexão expirada.');}
    }
    this.expire(now);
    // Nobody left to play (the last participant's session expired; late arrivals are spectators; bots do not play for
    // no one): a defeat, not ~18 min of empty combat.
    if(this.run.snapshot().phase==='combat'&&!this.run.snapshot().members.some(m=>!m.spectator&&!m.bot)){if(this.run.finish('defeat',this.sim.shameMoment()))this.announce();}
    // The room is about to close: end the run now so the result is announced before the 4004.
    else if(this.run.snapshot().phase==='combat'&&now>=this.createdAt+ROOM_LIFETIME_MS-ROOM_CLOSING_MARGIN_MS){if(this.run.finish('timeout',this.sim.shameMoment()))this.announce();}
    // The simulation steps before the lifecycle so a victory or defeat on this tick beats a same-tick timeout.
    // D-050: a team level-up in a wave pauses the run for the picks (multiplayer/levelup-pause.ts): no step, no clock.
    const paused=this.run.snapshot().phase==='combat'&&this.levelup.update(this.sim,now);
    if(this.run.snapshot().phase==='combat'&&!paused){
      if(this.labHorde)this.fillHorde();
      // Room bots decide before the step (their stick is this tick's input); a fallen one calls for help like a phone.
      for(const id of this.bots.think(this.sim))this.botSos(id,now);
      // People away: their hero follows the team on its own until they are back (no help calls: nobody is holding the phone).
      this.autopilots.think(this.sim);
      const events=this.sim.step(now);
      this.pushElenco();
      // Skill taps: the owner hears at once whether its tap went off (the button never guesses, E7/N16).
      for(const cast of this.sim.casts)for(const c of this.connections.values())if(c.playerId===cast.id)this.sendJson(c,{t:'cast',seq:cast.seq,ok:cast.ok,readyTick:cast.readyTick});
      // Every encoder gets every tick's events while their ids are still known (D-018), sent or not this tick.
      for(const c of this.connections.values())c.encoder?.pushEvents(events);
      const outcome=this.sim.outcome;
      if(outcome&&this.run.finish(outcome,this.sim.shameMoment()))this.announce();
    }
    // Paused: the run's combat clock (elapsed, the timeout) stands still with the sim.
    const transition=paused?{started:false,finished:false}:this.run.step(this.run.snapshot().phase==='combat'?this.sim.shameMoment():undefined);
    if(transition.started){this.resetRun();this.syncSpectators();}
    if(transition.finished)this.announce();
    if(++this.ticks%PRUNE_EVERY===0)this.prune();
    this.pushRun();
    // Lobby, countdown and result keep their frames too (the waiting room lists players from them).
    let input:FrameInput|undefined;
    for(const c of [...this.connections.values()]){
      if(!c.encoder)continue;
      const due=c.encoder.due(this.ticks);
      if(!flush){if(due)c.owed=true;continue;}
      if(!due&&!c.owed)continue;
      c.owed=false;
      this.sendFrame(c,input??=this.sim.frame(),now);
      this.pushOffers(c);
    }
    // Combat start/end and each new round go to storage (what a restart reports as lost). From CHECKPOINT_FROM_ROUND on,
    // a new round is the start of its intermission (the director's endRound): the run is checkpointed there, once.
    const round=this.run.snapshot().phase==='combat'?this.sim.world.round.index:-1;
    if(round!==this.rosterRound){
      this.rosterRound=round;this.rosterDirty=true;
      if(round<0){this.checkpointRef=undefined;this.resumedRun.clear();}
      else if(round>=CHECKPOINT_FROM_ROUND&&this.sim.world.round.phase==='prepare'&&!this.sim.outcome)this.saveCheckpoint();
    }
    this.flushRoster(now);
    this.measure(performance.now()-started);
  }
  /** Lab stress (labHorde): critters spawn 8–30 u around a random standing player, up to 25 per tick (and stragglers come back); nobody falls. */
  private fillHorde(){
    const w=this.sim.world,players=[...this.sim.players.values()].filter(p=>!p.spectator);
    if(!players.length)return;
    for(const p of players){p.invulnerableUntil=w.tick+40;if(p.downed){delete p.downed;p.hp=p.stats.maxHp;}}
    const kinds=['bebado','pombos','agiota','tio-pave','anao-molotov'];
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
  /**
   * Lab report: tick and encode cost (p50/p95/max over the last minute) and bytes per connection. `tickSamples` is
   * that last minute raw (oldest first; the newest is tick number `ticks`), so a poller (the VGM-045 bots) can stitch
   * a whole run together.
   */
  lab(){
    const pct=(list:number[],q:number)=>{if(!list.length)return 0;const sorted=[...list].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(q*sorted.length))];};
    const {samples,encodeSamples,...totals}=this.perf;
    return {...totals,bots:{count:this.bots.size,thinkMs:Math.round(this.bots.thinkMs*1000)/1000,thinks:this.bots.thinks,forged:this.bots.forged},tick:this.sim.tick,phase:this.run.snapshot().phase,round:this.sim.world.round.index,enemies:this.sim.world.enemies.size,
      tickP50:pct(samples,.5),tickP95:pct(samples,.95),encodeP50:pct(encodeSamples,.5),encodeP95:pct(encodeSamples,.95),
      tickSamples:samples.map(ms=>Math.round(ms*1000)/1000),
      connections:[...this.connections.values()].map(c=>({player:c.playerId,slot:c.encoder?.slot,frames:c.frames,bytes:c.bytes,received:c.received,
        pending:c.encoder?.pendingEvents,stats:c.encoder?.stats}))};
  }
  private measure(ms:number){
    const p=this.perf;p.ticks++;p.tickMs+=ms;p.maxTickMs=Math.max(p.maxTickMs,ms);
    if(this.sampling){p.samples.push(ms);if(p.samples.length>PERF_SAMPLES)p.samples.shift();}
  }
  /**
   * Ids of entities gone for good leave the shared map (encoders keep their own baselines). The city barricades stay
   * live for the whole run (a fallen one is hp 0, not gone): left out, their wire ids were re-issued every prune. The
   * same for the nests (D-051, a fallen one stays) and the sleeping bodies sent in the last frame (Simulation.sleeperIds).
   */
  private prune(){
    const w=this.sim.world,ids=(m:Map<string,unknown>)=>m.keys();
    const st=this.sim.run.stonewards.state;
    this.ids.prune({enemies:[...ids(w.enemies),...this.sim.sleeperIds],pickups:ids(w.pickups),projectiles:ids(w.projectiles),telegraphs:ids(w.telegraphs),
      structures:[st.wall.id,...st.towers.map(t=>t.id),...(st.barricades??[]).map(b=>b.id),...this.sim.defenses().map(d=>d.id),...[this.sim.railView()?.id].filter((id):id is string=>!!id),...(this.sim.run.nests?.state.nests??[]).map(n=>n.id)],nodes:this.sim.nodeIds});
  }
  /** Runs once per run, right after RunLifecycle.finish accepted the outcome: the result state, then the result. */
  private announce(){
    // D-047: the chaveiro's bill (opened, total loss, the team fell or the D-043 cap) goes with the result.
    this.run.setObjective(this.sim.objectiveResult(this.run.snapshot().outcome));
    const {outcome,resultId,round}=this.run.snapshot();
    this.pushRun(true);
    this.send({t:'result',outcome,resultId,round});
  }
  /** An ack of frame `seq` arrived at `now`: this phone decodes that late (the frame's age), see silenceLimit. */
  private lateness(c:Connection,seq:unknown,now:number){
    if(!Number.isSafeInteger(seq)||!c.frameSeq||!c.frameAt)return;
    for(let i=0;i<FRAME_TIMES;i++)if(c.frameSeq[i]===seq){
      c.lag=Math.max(0,now-c.frameAt[i]);c.lateAcks=c.lag>=LATE_ACK_MS?c.lateAcks+1:0;return;
    }
  }
  private sendFrame(c:Connection,input:FrameInput,now=Date.now()){
    // The owner sees itself at the last step it reported (input-10hz): its prediction replays only its own steps.
    const own=c.playerId?this.sim.confirmed(c.playerId):undefined;
    const view=own?{...input,players:input.players.map(p=>p.id===c.playerId?{...p,...own}:p)}:input;
    const started=performance.now(),bytes=c.encoder!.encode(view),ms=performance.now()-started;
    this.perf.encodeMs+=ms;
    if(this.sampling){this.perf.encodeSamples.push(ms);if(this.perf.encodeSamples.length>PERF_SAMPLES)this.perf.encodeSamples.shift();}
    this.perf.frames++;this.perf.bytes+=bytes.length;c.frames++;c.bytes+=bytes.length;
    const slot=c.encoder!.lastSeq%FRAME_TIMES;(c.frameSeq??=new Int32Array(FRAME_TIMES).fill(-1))[slot]=c.encoder!.lastSeq;(c.frameAt??=new Float64Array(FRAME_TIMES))[slot]=now;
    try{c.peer.send(bytes);}catch{this.sendFailed(c,now);}
  }
  private sendJson(c:Connection,message:object){
    const raw=JSON.stringify(message);this.perf.jsonBytes+=raw.length;c.bytes+=raw.length;
    try{c.peer.send(raw);}catch{this.sendFailed(c);}
  }
  /** A send that throws means the socket is gone: log it like any other end and close it, so it leaves `peers` too. */
  private sendFailed(c:Connection,now=Date.now()){if(this.connections.get(c.peer)===c)this.close(c.peer,1011,'Falha ao enviar.',now);}
  /**
   * {t:'elenco',ids} (protocol/room.ts ElencoMessage): to `c` (a joiner) when the run has a rotation, else to everyone
   * when the run's rotation changed (drawn on its first step; a new run draws another). Cheap: a key compare per tick.
   */
  private pushElenco(c?:Connection){
    const ids=this.sim.rotationIds();
    if(c){if(ids.length)this.sendJson(c,{t:'elenco',ids});return;}
    const key=ids.join(',');
    if(key===this.elencoKey)return;
    this.elencoKey=key;
    if(ids.length)this.send({t:'elenco',ids});
  }
  private elencoKey='';
  private send(message:object){
    for(const c of [...this.connections.values()])if(c.playerId)this.sendJson(c,message);
  }
}
