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
 *  - `bossHp` × the city boss's hp (assemble.ts: BossTuning.baseHp for the city's boss controller).
 *
 * Round 1 is the tutorial walk (cidade-08, TUTORIAL_PLAN): no knob ever touches it (roundKnobs(…, 1) is neutral), so a
 * tuning can not make the first round lethal. Neutral knobs leave the plan object itself untouched (same reference),
 * so CITY_BALANCE at its defaults plays the city exactly as before this module (same plans, same state hashes).
 *
 * Injection: createRunSystems({cityBalance}) (assemble.ts; default CITY_BALANCE), which hands the round knobs to the
 * director (DirectorOptions.cityBalance) and the loot/intermission ones to Stonewards (StonewardsOptions.cityBalance),
 * only on a city terrain. A headless runner reads a JSON with cityBalanceFrom.
 */
import {MAX_ROUND_ENEMIES,ROUND_COUNT,type RoundPlan,type SpawnGroup} from '../../rules/index.ts';

/** Knobs of one round. count/hp/cadence are multipliers (1 = the table); siegeShare (0..1) replaces the director's. */
export interface CityRoundKnobs {count:number;hp:number;cadence:number;siegeShare?:number}
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
}

export const NEUTRAL_ROUND:Readonly<CityRoundKnobs>=Object.freeze({count:1,hp:1,cadence:1});
/** The city's tuning (edit here after measuring with the city run bench). All neutral: the tables as they are. */
export const CITY_BALANCE:CityBalance=Object.freeze({
  all:Object.freeze({}),
  rounds:Object.freeze({}),
  lootValue:1,
  intermissionExtraSeconds:0,
  bossHp:1,
});

/** Effective knobs of round `index`: `all` × the round's entry; neutral for round 1 and outside 2..ROUND_COUNT. */
export function roundKnobs(balance:CityBalance,index:number):CityRoundKnobs{
  if(!Number.isInteger(index)||index<2||index>ROUND_COUNT)return NEUTRAL_ROUND;
  const a=balance.all,r=Object.hasOwn(balance.rounds,index)?balance.rounds[index]:{};
  const share=r.siegeShare??a.siegeShare;
  return {count:(a.count??1)*(r.count??1),hp:(a.hp??1)*(r.hp??1),cadence:(a.cadence??1)*(r.cadence??1),
    ...(share!==undefined?{siegeShare:Math.max(0,Math.min(1,share))}:{})};
}
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
/**
 * A CityBalance from JSON (a runner's --knobs file): every field optional, the rest from `base` (CITY_BALANCE).
 * `rounds` is an object keyed by round index ("2".."10"). Throws on unknown keys, bad numbers or round 1.
 */
export function cityBalanceFrom(input:unknown,base:CityBalance=CITY_BALANCE):CityBalance{
  if(input===undefined||input===null)return base;
  if(typeof input!=='object'||Array.isArray(input))throw new Error('city balance: an object');
  const o=input as Record<string,unknown>;
  for(const key of Object.keys(o))if(!['all','rounds','lootValue','intermissionExtraSeconds','bossHp'].includes(key))throw new Error(`city balance: unknown key '${key}'`);
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
  return Object.freeze({
    all:o.all===undefined?base.all:Object.freeze(knobsFrom(o.all,'city balance.all')),
    rounds:Object.freeze(rounds),
    lootValue:num('lootValue',base.lootValue),
    intermissionExtraSeconds:num('intermissionExtraSeconds',base.intermissionExtraSeconds),
    bossHp:num('bossHp',base.bossHp),
  });
}
