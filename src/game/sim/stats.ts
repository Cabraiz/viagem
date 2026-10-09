/**
 * Player stats (VGM-036): BASE_STATS + class bonus + owned passives, clamped to STAT_LIMITS.
 * The server recomputes stats whenever the build changes; the client never sends them.
 *
 * | stat      | base | passive (per level, x5)      | limits      |
 * | --------- | ---- | ---------------------------- | ----------- |
 * | maxHp     | 100  | marmita +20 (+100)           | 1 .. 1000   |
 * | regen     | 0    | -                            | 0 .. 10     |
 * | armor     | 0    | -                            | 0 .. 15     |
 * | moveSpeed | 1    | tenis +0.1 (+0.5)            | 0.5 .. 2    |
 * | might     | 1    | oculos +0.1 (+0.5)           | 0.25 .. 4   |
 * | area      | 1    | megafone +0.1 (+0.5)         | 0.5 .. 2.5  |
 * | cooldown  | 1    | cafe-forte -0.08 (-0.4)      | 0.4 .. 2    |
 * | amount    | 0    | -                            | 0 .. 6, int |
 * | duration  | 1    | -                            | 0.5 .. 3    |
 * | speed     | 1    | -                            | 0.5 .. 3    |
 * | magnet    | 1.2  | ima +0.5 (+2.5)              | 0.5 .. 6    |
 * | luck      | 1    | bone +0.1 (+0.5)             | 0.5 .. 3    |
 * | growth    | 1    | cartao +0.08 (+0.4)          | 0.5 .. 3    |
 * | revive    | 1    | -                            | 0.5 .. 3    |
 * Order: base + class bonus + passives, then clamp. Multipliers are additive, not compounding.
 */
import {BASE_STATS,type PlayerBuild,type PlayerStats,type SimPlayer} from './types.ts';
import {PASSIVE_MAX_LEVEL,passiveDef} from './passives.ts';

export type StatKey=keyof PlayerStats;
export const STAT_KEYS=Object.keys(BASE_STATS) as StatKey[];

/** Inclusive [min,max] per stat after all bonuses. */
export const STAT_LIMITS:Readonly<Record<StatKey,readonly [number,number]>>=Object.freeze({
  maxHp:[1,1000],
  regen:[0,10],
  armor:[0,15],
  moveSpeed:[0.5,2],
  might:[0.25,4],
  area:[0.5,2.5],
  cooldown:[0.4,2],
  amount:[0,6],
  duration:[0.5,3],
  speed:[0.5,3],
  magnet:[0.5,6],
  luck:[0.5,3],
  growth:[0.5,3],
  revive:[0.5,3],
});

/** Stats that must be whole numbers (extra projectiles). */
const INTEGER_STATS:ReadonlySet<StatKey>=new Set(['amount']);

/** Class kits (VGM-044) pass additive deltas, e.g. {might:0.1, maxHp:-10}. */
export type ClassBonus=Partial<PlayerStats>;

const clampStat=(key:StatKey,value:number)=>{
  const [min,max]=STAT_LIMITS[key];
  // Round before flooring so float noise (0.9999999) does not lose a whole projectile.
  const v=INTEGER_STATS.has(key)?Math.floor(Math.round(value*1e6)/1e6):value;
  // Round away float noise (0.1*3) so equal builds always serialize identically.
  return Math.round(Math.min(max,Math.max(min,v))*1e6)/1e6;
};

/** Highest valid level per known passive; duplicates and unknown ids never stack. */
export function passiveLevels(build:PlayerBuild):Map<string,number>{
  const levels=new Map<string,number>();
  for(const owned of build.passives){
    if(!passiveDef(owned.id)||!Number.isFinite(owned.level))continue;
    const level=Math.min(PASSIVE_MAX_LEVEL,Math.max(0,Math.floor(owned.level)));
    if(level>(levels.get(owned.id)??0))levels.set(owned.id,level);
  }
  return levels;
}

export function computeStats(build:PlayerBuild,classBonus?:ClassBonus):PlayerStats{
  const stats={...BASE_STATS} as PlayerStats;
  if(classBonus)for(const key of STAT_KEYS){
    const delta=classBonus[key];
    if(typeof delta==='number'&&Number.isFinite(delta))stats[key]+=delta;
  }
  for(const [id,level] of passiveLevels(build)){
    const perLevel=passiveDef(id)!.perLevel;
    for(const key of STAT_KEYS){const delta=perLevel[key];if(delta!==undefined)stats[key]+=delta*level;}
  }
  for(const key of STAT_KEYS)stats[key]=clampStat(key,stats[key]);
  return stats;
}

/**
 * Recomputes player.stats in place with the player's own class kit (SimPlayer.classBonus, D-005).
 * `classBonus` only overrides it (e.g. in tests); passing undefined uses the player's.
 * Gaining max HP heals by the same amount (a standing player only); losing max HP caps current HP.
 */
export function refreshStats(player:SimPlayer,classBonus:ClassBonus|undefined=player.classBonus):PlayerStats{
  const previousMax=player.stats.maxHp;
  player.stats=computeStats(player.build,classBonus);
  const gained=player.stats.maxHp-previousMax;
  if(gained>0&&!player.downed&&!player.eliminated&&player.hp>0)player.hp+=gained;
  player.hp=Math.min(player.hp,player.stats.maxHp);
  return player.stats;
}
