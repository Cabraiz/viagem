/**
 * The chefão's arena in the dark (card NEW-20261023-ORQ-boss-fim-onda-1, etapa 7; the user, 24/10: "Algum tipo de fear
 * avançada?"): while the 1st wave's chefão stands, the map goes dark and only the fight stays lit.
 * - the arena: a clear circle around him (ARENA.radius u), its centre eased so the 20 Hz feed does not shake it;
 * - the bodies: the own hero, the allies on their feet and the Uno keep a small light, so nobody is lost in it;
 * - the moment: it closes in as the camera holds on him (the arrival scene), and opens again when he falls.
 * Over the lighting vignette, under the fear's own dark (card fear-escuridao-sozinho: alone outside the arena, that one
 * still closes in on top). Pure (no Phaser): node tests pin the curve and the arena.
 */
import {WAVE_BOSS_IDS} from '../../rules/index.ts';

export const ARENA=Object.freeze({
  /**
   * The lit ground around his feet (u; 1 u ≈ 30 px across on screen at zoom 1): his slam and the heroes next to him.
   * His body (several heroes tall) gets its own light (bodyLight × his drawn height), so he never stands in the dark.
   */
  radius:6,bodyLight:.5,
  /** Light around the own hero, an ally on their feet and the Uno (u). */
  heroLight:2.2,allyLight:1.8,unoLight:3,
  /** The dark's opacity: the map still reads as shapes, the fight is the only colour. */
  alpha:.9,
  /** Seconds to close in once he stands, and to open again once he falls. */
  inS:1.4,outS:1.1,
  /** The arena's centre follows him with this time constant (s). */
  followS:.25,
});

/** An enemy on the wire (EnemyView). */
export interface ArenaEnemy {id:string;kind:string;x:number;y:number;hp:number}
/** A spot's radius is where its soft edge is half dark: the texture is clear to `core` of its size, nothing at 1. */
export const spotScale=(core:number)=>2/(1+core);
/** The 1st wave's chefão on his feet, or undefined. */
export const arenaBoss=(enemies:Iterable<ArenaEnemy>)=>{
  for(const e of enemies)if(e.hp>0&&WAVE_BOSS_IDS.includes(e.kind))return e;
  return undefined;
};

export interface ArenaFrame {
  /** Opacity of the dark, 0 = none. */
  alpha:number;
  /** The arena's centre (world units), eased; undefined before the first chefão. */
  at?:{x:number;y:number};
}

const clamp01=(v:number)=>v<0?0:v>1?1:v;
const smooth=(t:number)=>t*t*(3-2*t);

/** The arena's clock, one per run screen: fades the dark in while he stands, out after, and eases his spot. */
export class ArenaClock {
  /** 0..1 along the fade (smoothed when drawn). */
  private level=0;
  private at?:{x:number;y:number};
  /** One frame: `boss` where he stands (world units) or undefined (none, or he fell), `dtMs` since the last frame. */
  step(boss:{x:number;y:number}|undefined,dtMs:number):ArenaFrame{
    const dt=Math.max(0,Math.min(dtMs,250))/1000;
    this.level=clamp01(this.level+(boss?dt/ARENA.inS:-dt/ARENA.outS));
    if(boss){
      if(!this.at)this.at={x:boss.x,y:boss.y};
      else{const k=1-Math.exp(-dt/ARENA.followS);this.at.x+=(boss.x-this.at.x)*k;this.at.y+=(boss.y-this.at.y)*k;}
    }
    if(this.level<=0)this.at=undefined;
    return {alpha:ARENA.alpha*smooth(this.level),...this.at?{at:{x:this.at.x,y:this.at.y}}:{}};
  }
  reset(){this.level=0;this.at=undefined;}
}
