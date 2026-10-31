/**
 * NEW-20261031-ORQ-tiro-rapido-e-local (the user: "o tiro tem que sair na hora"): the local hero's own projectile drawn
 * on the press, before the room's copy (net/attack-predict.ts draws the swing, the flash and the sound). The room keeps
 * the authority: hits, damage and kills are only its own.
 *
 * A press spawns a ghost flying straight from the hero at the weapon's speed for its flight (hud/weapon-reach.ts
 * SHOT_FLIGHT). The room's first friendly projectile of that weapon that shows up within MATCH_MS, near the ghost's line
 * and heading its way, is the same shot: the ghost goes and that projectile is drawn from where the ghost was, the gap
 * fading over ADOPT_MS (no jump, no second bullet). A ghost no copy took within MATCH_MS (the room refused the shot)
 * is gone; one whose flight ended first is still the late copy's, which then stays hidden. Pure (no Phaser), so node
 * tests it.
 */
import {MATCH_MS} from '../net/attack-predict.ts';

/** The gap between the ghost and the room's copy fades with this time constant (ms). */
export const ADOPT_MS=120;
/** A room projectile this far (u) from the ghost's line is another shot. */
export const ADOPT_UNITS=2.5;
/** Its heading within this cosine of the ghost's (≈ 50°: the assist bends the room's aim a little). */
const ADOPT_COS=.64;
/** Ghosts alive at once (a held submachine gun refires every 200 ms). */
const CAP=16;

/** `spent`: its flight ended before any copy came; kept until MATCH_MS so a late copy is known (and not drawn again). */
export interface Ghost {id:string;weapon:string;x:number;y:number;vx:number;vy:number;born:number;until:number;spent?:boolean}
export interface Point {x:number;y:number}

export class OwnShots {
  readonly ghosts:Ghost[]=[];
  /** Learned speed (u/s) per weapon from the room's copies (a passive that speeds the shot). */
  private speed=new Map<string,number>();
  private n=0;

  /** The press: a ghost from (x,y) along (dx,dy) at `flight` ([u/s, ticks]); undefined for a weapon that does not travel. */
  spawn(now:number,weapon:string,x:number,y:number,dx:number,dy:number,flight:readonly [number,number]|undefined):Ghost|undefined{
    if(!flight)return undefined;
    const len=Math.hypot(dx,dy),speed=this.speed.get(weapon)??flight[0];
    if(!(len>1e-9)||!(speed>0))return undefined;
    // The reach stays the table's: a learned faster shot flies for less time.
    const life=flight[1]*50*flight[0]/speed;
    const g:Ghost={id:`eu:${++this.n}`,weapon,x,y,vx:dx/len*speed,vy:dy/len*speed,born:now,until:now+life};
    this.ghosts.push(g);
    if(this.ghosts.length>CAP)this.ghosts.shift();
    return g;
  }

  /** Where the ghost is at `now`. */
  at(g:Ghost,now:number,out:Point={x:0,y:0}):Point{
    const t=Math.max(0,Math.min(now,g.until)-g.born)/1000;
    out.x=g.x+g.vx*t;out.y=g.y+g.vy*t;return out;
  }

  /**
   * A friendly projectile of `source` the room just sent (fresh this view), at (x,y) heading (vx,vy): the ghost it is,
   * removed, or undefined (none waiting: someone else's shot, or one the phone never drew).
   */
  adopt(source:string,x:number,y:number,vx:number,vy:number,now:number):Ghost|undefined{
    this.expire(now);
    const sp=Math.hypot(vx,vy);
    let best=-1,bestD=ADOPT_UNITS;
    for(let i=0;i<this.ghosts.length;i++){
      const g=this.ghosts[i];
      if(g.weapon!==source)continue;
      const gs=Math.hypot(g.vx,g.vy),cos=sp>1e-9&&gs>1e-9?(g.vx*vx+g.vy*vy)/(gs*sp):1;
      if(cos<ADOPT_COS)continue;
      // Distance from the ghost's line (its start to where it is now): the room's copy is behind it in time.
      const d=segmentDistance(x,y,g.x,g.y,g.x+g.vx*(now-g.born)/1000,g.y+g.vy*(now-g.born)/1000);
      if(d<bestD){bestD=d;best=i;}
    }
    if(best<0)return undefined;
    const g=this.ghosts.splice(best,1)[0];
    if(sp>1e-9)this.speed.set(source,sp);
    return g;
  }

  /**
   * Ghosts to stop drawing (`gone`, ids): no copy took them within MATCH_MS (removed) or their flight ended (spent,
   * kept for a late copy until MATCH_MS).
   */
  expire(now:number,gone?:string[]){
    for(let i=this.ghosts.length-1;i>=0;i--){
      const g=this.ghosts[i],refused=now-g.born>MATCH_MS;
      if(!g.spent&&(refused||now>=g.until)){g.spent=true;gone?.push(g.id);}
      if(refused)this.ghosts.splice(i,1);
    }
  }

  clear(){this.ghosts.length=0;}
}

/** The adopted copy's drawn offset at `now`: the gap at adoption fading over ADOPT_MS (exponential). */
export function adoptFade(since:number):number{return since<=0?1:Math.exp(-since/ADOPT_MS);}

function segmentDistance(px:number,py:number,ax:number,ay:number,bx:number,by:number){
  const dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy;
  const t=l2>1e-12?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l2)):0;
  return Math.hypot(px-ax-dx*t,py-ay-dy*t);
}
