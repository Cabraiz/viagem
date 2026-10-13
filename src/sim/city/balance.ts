/**
 * City run balance knobs (cidade-11): the Cidade Nevada is tuned on top of the shared tables, never in them. ROUNDS
 * (rules/waves.ts), BOSS_TUNING (boss.ts), RECIPES and STONEWARDS_INTERMISSION_SECONDS stay as the island and the
 * endless world use them; the city multiplies what they give, only where the world is 'cidade':
 *
 *  - per round (2..ROUND_COUNT), on the plan planRound built (director.ts startWave, applyCityBalance below):
 *    `count` × the regular members (swarm included, elite and boss not), `hp` × plan.hp and plan.eliteHp, `cadence` ×
 *    the spacing of the groups (every non-boss group's `at` measured from the round's first one; the round's time grows
 *    by what its last group moved), and `siegeShare` replacing the director's share of groups that besiege the wall;
 *  - `lootValue` × the units a crate pays (stonewards/system.ts, after gatherStep; each crate rounded to whole units);
 *  - `intermissionExtraSeconds` added to every city intermission after the trip sizing (stonewards/system.ts), within
 *    the intermission cap (MAX_PREPARE_TICKS);
 *  - `bossHp` × the city boss's hp (assemble.ts: BossTuning.baseHp for the city's boss controller);
 *  - `players[n]` (cidade-11 run): knobs by team size, on top of all of the above, so a small team can be eased without
 *    touching the shared playerScale (rules/waves.ts). Its count/hp/cadence multiply `all` × `rounds[i]` (rounds 2..10
 *    only), its siegeShare replaces theirs, its lootValue multiplies the global lootValue, its `damage` scales every hit
 *    a player takes (core.ts SimWorld.playerDamageScale, wired by assemble.ts) and its `bossHp` multiplies the global
 *    bossHp. The team size `n` is:
 *      · for the round knobs, the count planRound scaled the round with (RoundPlan.players: the director's
 *        scalePlayers at the wave start, the highest activePlayers — online, not spectator, not eliminated — of the
 *        current tick and the last 60 one-second samples, clamped 1..6);
 *      · for the loot, the heroes standing at the intermission's start (revive.ts isStanding: online, not spectator,
 *        not downed, not eliminated, hp > 0), clamped 1..6, counted once on the intermission's first tick and kept in
 *        StonewardsState.cityLootTeam for the whole intermission (only when some players entry has a lootValue);
 *      · for `damage`, the round knobs' count (RoundPlan.players) of the current round, kept through the intermission
 *        that follows it (the director keeps state.plan until the next wave); neutral before round 2 (the opening,
 *        round 1 / the tutorial and its intermission), like the round knobs (teamDamage below);
 *      · for `bossHp`, the same plan count when the boss spawns (round 10's plan), fixed for the fight.
 *    A team size with no entry, and any knob an entry leaves out, is neutral.
 *
 * Round 1 is the tutorial walk (cidade-08, TUTORIAL_PLAN): no knob ever touches it (roundKnobs(…, 1) is neutral), so a
 * tuning can not make the first round lethal. Neutral knobs leave the plan object itself untouched (same reference),
 * so CITY_BALANCE at its defaults plays the city exactly as before this module (same plans, same state hashes).
 *
 * Injection: createRunSystems({cityBalance}) (assemble.ts; default CITY_BALANCE), which hands the round knobs to the
 * director (DirectorOptions.cityBalance), the loot/intermission ones to Stonewards (StonewardsOptions.cityBalance),
 * the team damage to the core (SimWorld.playerDamageScale) and the boss hp to the boss (tuning, BossOptions.hpScale),
 * only on a city terrain. A headless runner reads a JSON with cityBalanceFrom.
 */
import {MAX_ROUND_ENEMIES,ROUND_COUNT,type RoundPlan,type SpawnGroup} from '../../rules/index.ts';

/** Knobs of one round. count/hp/cadence are multipliers (1 = the table); siegeShare (0..1) replaces the director's. */
export interface CityRoundKnobs {count:number;hp:number;cadence:number;siegeShare?:number}
/**
 * Knobs of one team size: the round knobs (count/hp/cadence ×, siegeShare replacing), lootValue × the global one,
 * damage × every hit the players take (contact, hostile projectiles, telegraphs: the core's damagePlayer, before armor)
 * and bossHp × the global bossHp.
 */
export type CityTeamKnobs=Partial<CityRoundKnobs&{lootValue:number;damage:number;bossHp:number}>;
/** Team sizes a `players` entry may name (the director's scaling clamps to 1..6). */
export const CITY_TEAM_SIZES=[1,2,3,4,5,6] as const;
export interface CityBalance {
  /** Applied to every round 2..ROUND_COUNT (multiplied with the round's own entry; its siegeShare when the round has none). */
  readonly all:Readonly<Partial<CityRoundKnobs>>;
  /** Per round index (2..ROUND_COUNT); round 1 (the tutorial) and absent rounds are neutral. */
  readonly rounds:Readonly<Record<number,Readonly<Partial<CityRoundKnobs>>>>;
  /** × the units a crate pays (rounded per crate, never below 0). */
  readonly lootValue:number;
  /** Seconds added to every city intermission (not the opening before round 1), ≥ 0. */
  readonly intermissionExtraSeconds:number;
  /** × the city boss's hp. */
  readonly bossHp:number;
  /**
   * By team size (1..6; see the module comment for which count each knob reads): count/hp/cadence × the round's
   * all × rounds (rounds 2..ROUND_COUNT only), siegeShare replacing theirs, lootValue × the global lootValue, damage ×
   * the damage players take (rounds 2..ROUND_COUNT and their intermissions), bossHp × the global bossHp. Absent sizes
   * and knobs are neutral.
   */
  readonly players?:Readonly<Record<number,Readonly<CityTeamKnobs>>>;
}

export const NEUTRAL_ROUND:Readonly<CityRoundKnobs>=Object.freeze({count:1,hp:1,cadence:1});
/** Neutral knobs: the shared tables as they are (tests and benches compare against it). */
export const NEUTRAL_CITY_BALANCE:CityBalance=Object.freeze({
  all:Object.freeze({}),
  rounds:Object.freeze({}),
  lootValue:1,
  intermissionExtraSeconds:0,
  bossHp:1,
});
/**
 * The city's tuning (cidade-11), measured with `npm run bench:city-run` (16 seeds × 1/3/6 bots, 10 rounds; table in
 * done/NEW-20261012-ORQ-cidade-11-balanco-run.md). The shared player scaling is too heavy for small teams in the city
 * (a solo hero has no one to revive it, the boss has no solo scaling), so 1 and 3 players get fewer, softer bodies that
 * hit less, a weaker boss and more loot; 6 players a little more pressure. Wins: 1p 3/16, 3p 8/16, 6p 9/16.
 */
export const CITY_BALANCE:CityBalance=Object.freeze({
  ...NEUTRAL_CITY_BALANCE,
  players:Object.freeze({
    1:Object.freeze({count:.5,hp:.7,damage:.45,bossHp:.45,lootValue:2,siegeShare:.15}),
    3:Object.freeze({count:.8,hp:.85,damage:.55,bossHp:.5,lootValue:1.3}),
    6:Object.freeze({count:1.07,hp:1.05}),
  }),
});

/** The `players` entry for a team of `team` (an integer 1..6), or {} (neutral). */
export function teamKnobs(balance:Pick<CityBalance,'players'>,team:number|undefined):Readonly<CityTeamKnobs>{
  const p=balance.players;
  return p&&team!==undefined&&Object.hasOwn(p,team)?p[team]:{};
}
/**
 * Effective knobs of round `index` for a team of `team` (RoundPlan.players; absent: no team knobs): `all` × the round's
 * entry × the team's entry (siegeShare: team, else round, else all); neutral for round 1 and outside 2..ROUND_COUNT.
 */
export function roundKnobs(balance:CityBalance,index:number,team?:number):CityRoundKnobs{
  if(!Number.isInteger(index)||index<2||index>ROUND_COUNT)return NEUTRAL_ROUND;
  const a=balance.all,r=Object.hasOwn(balance.rounds,index)?balance.rounds[index]:{},t=teamKnobs(balance,team);
  const share=t.siegeShare??r.siegeShare??a.siegeShare;
  return {count:(a.count??1)*(r.count??1)*(t.count??1),hp:(a.hp??1)*(r.hp??1)*(t.hp??1),cadence:(a.cadence??1)*(r.cadence??1)*(t.cadence??1),
    ...(share!==undefined?{siegeShare:Math.max(0,Math.min(1,share))}:{})};
}
/** The crate multiplier for a team of `team` standing at the intermission start: lootValue × players[team].lootValue. */
export const teamLootValue=(balance:Pick<CityBalance,'lootValue'|'players'>,team?:number)=>balance.lootValue*(teamKnobs(balance,team).lootValue??1);
/** Whether some team size has its own lootValue (Stonewards only then counts the team at the intermission start). */
export const hasTeamLoot=(balance:Pick<CityBalance,'players'>)=>!!balance.players&&Object.values(balance.players).some(k=>k.lootValue!==undefined&&k.lootValue!==1);
/**
 * × every hit a player takes in the city for the round planned as `plan` (the director's state.plan: the current round,
 * or during an intermission the round that just ended): players[plan.players].damage; 1 before round 2 (no plan, or
 * round 1 / the tutorial) and outside 2..ROUND_COUNT.
 */
export function teamDamage(balance:Pick<CityBalance,'players'>,plan:Pick<RoundPlan,'index'|'players'>|undefined):number{
  if(!plan||!Number.isInteger(plan.index)||plan.index<2||plan.index>ROUND_COUNT)return 1;
  return teamKnobs(balance,plan.players).damage??1;
}
/** Whether some team size has its own damage (assemble.ts only then hooks the core's damagePlayer). */
export const hasTeamDamage=(balance:Pick<CityBalance,'players'>)=>!!balance.players&&Object.values(balance.players).some(k=>k.damage!==undefined&&k.damage!==1);
/** × the city boss's base hp for a team of `team` (the plan count at the spawn), on top of the global bossHp. */
export const teamBossHp=(balance:Pick<CityBalance,'players'>,team?:number)=>teamKnobs(balance,team).bossHp??1;
/** Whether some team size has its own bossHp (assemble.ts only then hands the boss an hpScale). */
export const hasTeamBossHp=(balance:Pick<CityBalance,'players'>)=>!!balance.players&&Object.values(balance.players).some(k=>k.bossHp!==undefined&&k.bossHp!==1);
export const isNeutralRound=(k:CityRoundKnobs)=>k.count===1&&k.hp===1&&k.cadence===1&&k.siegeShare===undefined;

/**
 * The round's plan with the knobs applied (pure, no rng). Neutral knobs (or round 1) return `plan` itself.
 *  - count: the regular members (not elite, not boss) become round(total × count), at most MAX_ROUND_ENEMIES, split
 *    over the same groups in proportion to their sizes (largest remainder, ties by group order), at least one each;
 *    a group grows by repeating its own members in order and shrinks by dropping its last ones;
 *  - hp: plan.hp and plan.eliteHp (the elite and the catalog stand-in boss; the real boss is `bossHp`);
 *  - cadence: every non-boss group's `at` becomes at0 + (at − at0) × cadence (at0: the earliest of them), and the
 *    round's time grows by however much later its last group now goes out (never shorter).
 * siegeShare is read by the director itself (isSiege), not stored in the plan.
 */
export function applyCityBalance(plan:RoundPlan,knobs:CityRoundKnobs):RoundPlan{
  if(plan.index<2||knobs.count===1&&knobs.hp===1&&knobs.cadence===1)return plan;
  let groups:SpawnGroup[]=plan.groups.map(g=>({...g,members:[...g.members]}));
  const regular=groups.filter(g=>!g.boss&&!g.elite);
  if(knobs.count!==1&&regular.length){
    const sizes=regular.map(g=>g.members.length),sum=sizes.reduce((a,b)=>a+b,0);
    const target=Math.max(regular.length,Math.min(MAX_ROUND_ENEMIES,Math.round(sum*Math.max(0,knobs.count))));
    const raw=sizes.map(s=>s*target/sum),out=raw.map(r=>Math.max(1,Math.floor(r)));
    let left=target-out.reduce((a,b)=>a+b,0);
    const order=raw.map((r,i)=>({i,f:r-Math.floor(r)})).sort((a,b)=>b.f-a.f||a.i-b.i);
    for(let j=0;left>0&&order.length;j++,left--)out[order[j%order.length].i]++;
    regular.forEach((g,i)=>{const src=g.members;g.members=Array.from({length:out[i]},(_,j)=>src[j%src.length]);});
  }
  let durationTicks=plan.durationTicks;
  if(knobs.cadence!==1){
    const moving=groups.filter(g=>!g.boss);
    if(moving.length){
      const at0=Math.min(...moving.map(g=>g.at)),last=Math.max(...moving.map(g=>g.at));
      for(const g of moving)g.at=Math.round(at0+(g.at-at0)*Math.max(0,knobs.cadence));
      durationTicks+=Math.max(0,Math.max(...moving.map(g=>g.at))-last);
    }
    // Stable: equal ticks keep the plan's order.
    groups=groups.map((g,i)=>({g,i})).sort((a,b)=>a.g.at-b.g.at||a.i-b.i).map(x=>x.g);
  }
  return {...plan,groups,total:groups.reduce((n,g)=>n+g.members.length,0),durationTicks,hp:plan.hp*knobs.hp,eliteHp:plan.eliteHp*knobs.hp};
}

/** Units a crate of `value` pays with the loot knob (whole units, ≥ 0). */
export const cityCrateValue=(value:number,lootValue:number)=>lootValue===1?value:Math.max(0,Math.round(value*lootValue));

const KNOB_KEYS=['count','hp','cadence','siegeShare'] as const;
function knobsFrom(input:unknown,where:string):Partial<CityRoundKnobs>{
  if(input===undefined)return {};
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error(`${where}: an object of knobs`);
  const out:Partial<CityRoundKnobs>={};
  for(const [key,value] of Object.entries(input)){
    if(!(KNOB_KEYS as readonly string[]).includes(key))throw new Error(`${where}: unknown knob '${key}'`);
    if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new Error(`${where}.${key}: a finite number ≥ 0`);
    if(key==='siegeShare'&&value>1)throw new Error(`${where}.siegeShare: 0..1`);
    out[key as keyof CityRoundKnobs]=value;
  }
  return out;
}
const TEAM_KEYS=[...KNOB_KEYS,'lootValue','damage','bossHp'] as const;
/** A `players` entry: the round knobs plus lootValue, damage and bossHp, every number finite and > 0 (siegeShare also ≤ 1). */
function teamFrom(input:unknown,where:string):CityTeamKnobs{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error(`${where}: an object of knobs`);
  const out:CityTeamKnobs={};
  for(const [key,value] of Object.entries(input)){
    if(!(TEAM_KEYS as readonly string[]).includes(key))throw new Error(`${where}: unknown knob '${key}'`);
    if(typeof value!=='number'||!Number.isFinite(value)||value<=0)throw new Error(`${where}.${key}: a finite number > 0`);
    if(key==='siegeShare'&&value>1)throw new Error(`${where}.siegeShare: 0..1`);
    out[key as keyof CityTeamKnobs]=value;
  }
  return out;
}
/**
 * A CityBalance from JSON (a runner's --knobs file): every field optional, the rest from `base` (CITY_BALANCE).
 * `rounds` is an object keyed by round index ("2".."10"); `players` an object keyed by team size ("1".."6"), each
 * entry replacing the base's for that size. Throws on unknown keys, bad numbers, round 1 or a team size outside 1..6.
 */
export function cityBalanceFrom(input:unknown,base:CityBalance=CITY_BALANCE):CityBalance{
  if(input===undefined||input===null)return base;
  if(typeof input!=='object'||Array.isArray(input))throw new Error('city balance: an object');
  const o=input as Record<string,unknown>;
  for(const key of Object.keys(o))if(!['all','rounds','lootValue','intermissionExtraSeconds','bossHp','players'].includes(key))throw new Error(`city balance: unknown key '${key}'`);
  const num=(key:string,fallback:number)=>{
    const v=o[key];
    if(v===undefined)return fallback;
    if(typeof v!=='number'||!Number.isFinite(v)||v<0)throw new Error(`city balance.${key}: a finite number ≥ 0`);
    return v;
  };
  const rounds:Record<number,Partial<CityRoundKnobs>>={...base.rounds};
  if(o.rounds!==undefined){
    if(!o.rounds||typeof o.rounds!=='object'||Array.isArray(o.rounds))throw new Error('city balance.rounds: an object keyed by round index');
    for(const [key,value] of Object.entries(o.rounds)){
      const index=Number(key);
      if(!Number.isInteger(index)||index<2||index>ROUND_COUNT)throw new Error(`city balance.rounds: '${key}' is not a round 2..${ROUND_COUNT} (round 1 is the tutorial)`);
      rounds[index]=Object.freeze(knobsFrom(value,`city balance.rounds.${key}`));
    }
  }
  let players=base.players;
  if(o.players!==undefined){
    if(!o.players||typeof o.players!=='object'||Array.isArray(o.players))throw new Error('city balance.players: an object keyed by team size');
    const out:Record<number,CityTeamKnobs>={...base.players};
    for(const [key,value] of Object.entries(o.players)){
      const team=Number(key);
      if(!(CITY_TEAM_SIZES as readonly number[]).includes(team)||String(team)!==key)throw new Error(`city balance.players: '${key}' is not a team size 1..6`);
      out[team]=Object.freeze(teamFrom(value,`city balance.players.${key}`));
    }
    players=Object.freeze(out);
  }
  return Object.freeze({
    all:o.all===undefined?base.all:Object.freeze(knobsFrom(o.all,'city balance.all')),
    rounds:Object.freeze(rounds),
    lootValue:num('lootValue',base.lootValue),
    intermissionExtraSeconds:num('intermissionExtraSeconds',base.intermissionExtraSeconds),
    bossHp:num('bossHp',base.bossHp),
    ...(players?{players}:{}),
  });
}
