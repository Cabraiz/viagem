/**
 * Card inimigos-variedade (the user 25/10: "muitos inimigos repetidos e iguais"): two critters of the same kind side
 * by side should not be clones. Each regular enemy gets, from its id, a slight tone (a vertex tint multiplied into the
 * sun tint, render/light-actors.ts sunlit: no texture, no shader, no GPU memory) and a slight size (×SIZE_RANGE, on the
 * drawn image only: the city's outline copy is the kind's own, horde-art.ts applyEnemyArt). The elite and the boss keep
 * their exact look (their size is a gameplay cue). No mirror: the imported art has 8 facing rows, a flip would turn it
 * the wrong way. Pure and deterministic: every client draws the same critter the same way.
 */

/** Tones multiplied into the art (≤ 5 % off white per channel): neutral, warm, cool, dim, rosy, mossy. */
export const ENEMY_TONES:readonly number[]=Object.freeze([0xffffff,0xfff5eb,0xebf1ff,0xf2f2f2,0xfff0f3,0xf1f8eb]);
/** The size range (× the kind's drawn size). */
export const SIZE_RANGE=[.95,1.05] as const;

export interface EnemyLook {readonly tone:number;readonly size:number}
const NEUTRAL:EnemyLook=Object.freeze({tone:0xffffff,size:1});

/** FNV-1a with its own seed, so the look does not follow the animation phase (motion.ts hashPhase). */
function hash(id:string):number{
  let h=0x9e3779b9;
  for(let i=0;i<id.length;i++){h^=id.charCodeAt(i);h=Math.imul(h,0x01000193);}
  h^=h>>>15;h=Math.imul(h,0x2c1b3c6d);h^=h>>>12;
  return h>>>0;
}

/** The look of enemy `id`; neutral for the elite and the boss. */
export function enemyLook(id:string,special=false):EnemyLook{
  if(special||!id)return NEUTRAL;
  const h=hash(id),tone=ENEMY_TONES[h%ENEMY_TONES.length];
  // 11 size steps across the range (the high bits, apart from the tone's low ones).
  const size=Math.round((SIZE_RANGE[0]+(SIZE_RANGE[1]-SIZE_RANGE[0])*((h>>>8)%11)/10)*100)/100;
  return {tone,size};
}
