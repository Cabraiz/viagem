/**
 * Melee aim cone (NEW-20261021-ORQ-cone-ataque-melee): like Diablo / LoL, a swing of the local hero's melee weapon lays a
 * sector on the ground from the hero toward the aim: the mouse on a PC (followed while it shows), the swing's own
 * direction on a phone. Cyan translucent fill, a bright thick rim with a thinner line inside it, small runes along the
 * band between them, a curled ornament at each end of the arc and thin straight sides. Radius and aperture are the sim's
 * (sim/weapons/system.ts fireCone: an enemy is struck within `area` + its own radius and `coneHalfAngle` of the swing),
 * through the hero's build and class (rules computeStats). Local only: drawn from the 'fire' event the client already
 * gets, nothing new on the wire. Fades in over FADE_IN_MS, out over FADE_OUT_MS; a new swing restarts it. Procedural
 * (one Graphics, every point projected on the ground, so the relief and the camera turn bend it like the floor).
 */
import type Phaser from 'phaser';
import {classBonusOf,computeStats} from '../../rules/index.ts';
import type {Projector} from './projector.ts';

type Pt={x:number;y:number};

/**
 * The melee weapons and their cone (world units, radians), the sim's numbers (sim/weapons/arsenal.ts; a test keeps
 * them identical): `area` of the weapon's row (the same at every rarity), `half` its coneHalfAngle. The firearm cones
 * (escopeta, maçarico) are not melee: no aim cone.
 */
export const MELEE_CONES:Readonly<Record<string,{area:number;half:number}>>={faca:{area:1.3,half:1}};
export const FADE_IN_MS=80,FADE_OUT_MS=2000;
/** The reference's cyan (outside the UI palette, like the XP gem's --c-gema: an aim on the map, not a system colour). */
export const CONE_FILL=0x5ff5e6,CONE_RIM=0xc8fff9,CONE_FILL_ALPHA=.25;
/** Breu under the rim and the curls (the map's rule: Breu outlines everything on it), so the cyan reads on snow too. */
const BREU=0x1e1530;
/** The rim band: the inner line at this fraction of the radius, the runes in the middle of the band. */
export const BAND_INNER=.84;

/** Radius (world u) and half aperture (rad) of a melee weapon's cone for this build, or undefined (not melee). */
export function meleeCone(weapon:string|undefined,build:{weapons:readonly {id:string;level:number}[];passives:readonly {id:string;level:number}[]},classId:string){
  const cone=weapon===undefined?undefined:MELEE_CONES[weapon];
  if(!cone)return undefined;
  const stats=computeStats({weapons:[...build.weapons],passives:[...build.passives]},classBonusOf(classId));
  return {radius:Math.max(0,cone.area*stats.area),half:cone.half};
}

/** Opacity `ageMs` after a swing that found the cone at `from` (0 hidden .. 1 full): up over FADE_IN_MS, down over FADE_OUT_MS. */
export function coneAlpha(ageMs:number,from=0){
  if(!(ageMs>=0))return from;
  if(ageMs<FADE_IN_MS)return from+(1-from)*ageMs/FADE_IN_MS;
  return Math.max(0,1-(ageMs-FADE_IN_MS)/FADE_OUT_MS);
}

/** Points of the arc of radius r around (x,y) from angle a0 to a1 (world), `n` of them, written into out[0..n). */
export function arcPoints(x:number,y:number,r:number,a0:number,a1:number,n:number,out:Pt[]){
  for(let i=0;i<n;i++){const t=a0+(a1-a0)*i/(n-1);out[i].x=x+Math.cos(t)*r;out[i].y=y+Math.sin(t)*r;}
  return out;
}

/**
 * The cone's depth: under the hero's shadow (`shadow`, its depth this frame), in the city at the actor depths, elsewhere
 * also never over the ground layer's `ground`; without a shadow depth, the old way (the hero's world point).
 */
export function coneDepth(city:boolean,ground:number,shadow:number|undefined,heroDepth:()=>number){
  if(shadow!==undefined)return city?shadow-UNDER_SHADOW:Math.min(ground,shadow-UNDER_SHADOW);
  return city?heroDepth()-CITY_UNDER:ground;
}

/** Runes along the band: how many fit an arc of this length (world u), one every ~0.32 u, at least 3. */
export const runeCount=(radius:number,half:number)=>Math.max(3,Math.round(radius*BAND_INNER*2*half/.32));

const ARC_POINTS=40,GLYPH_POINTS=8;
/**
 * How far under the hero's shadow the cone lies (cone-por-cima-e-clique-em-loop): the shadow and the hero's silhouette are at
 * the actor depth −2 (scene.ts place), the "você" ring at −1, so the cone is always on the ground under all of them.
 */
export const UNDER_SHADOW=.5;
/** In the city, how far under the hero's actor depth the cone lies when no shadow depth is given (under the shadow at −2). */
export const CITY_UNDER=2+UNDER_SHADOW;

export class MeleeCone{
  private g:Phaser.GameObjects.Graphics;
  private projector:Projector;
  private born=-Infinity;private from=0;
  /** World unit vector of the swing (the phone's aim) and the cones of one swing (the build's `amount`). */
  private dir:Pt={x:1,y:0};private count=1;
  private radius=0;private half=0;
  private world:Pt[]=Array.from({length:ARC_POINTS+1},()=>({x:0,y:0}));
  private screen:Pt[]=Array.from({length:ARC_POINTS+2},()=>({x:0,y:0}));
  private glyph:Pt[]=Array.from({length:GLYPH_POINTS},()=>({x:0,y:0}));
  private q:Pt={x:0,y:0};
  /** The ground layer's depth (outside the city). */
  private depth:number;

  constructor(scene:Phaser.Scene,projector:Projector,depth:number){
    this.projector=projector;this.depth=depth;
    this.g=scene.add.graphics().setDepth(depth).setName('cone-ataque');
  }
  get object(){return this.g;}

  /** The current opacity at `now` (0: nothing drawn). */
  alpha(now:number){return coneAlpha(now-this.born,this.from);}

  /**
   * A swing at `now` of a cone of `radius` / `half`, toward world (dx,dy). Swings of the same frame are the build's
   * extra cones (amount): counted, the first one's direction kept.
   */
  swing(now:number,radius:number,half:number,dx:number,dy:number){
    if(now===this.born){this.count++;return;}
    this.from=Math.max(0,Math.min(1,this.alpha(now)));
    this.born=now;this.count=1;this.radius=radius;this.half=half;
    const len=Math.hypot(dx,dy);
    if(len>1e-6){this.dir.x=dx/len;this.dir.y=dy/len;}
  }

  /**
   * Draws the frame: the cone at the hero (world), toward `aim` (world, the mouse) when given, else the swing's direction.
   * `shadow`: the depth of the hero's shadow this frame (the drawn hero, scene.ts place): the cone goes just under it.
   */
  draw(now:number,body:number,hero:Pt|undefined,aim?:Pt,shadow?:number){
    const g=this.g;g.clear();
    const a=this.alpha(now);
    if(a<=.004||!hero||this.radius<=0){g.setVisible(false);return;}
    // City (the projector's actor depths): the ground there is pieces at actor depths, so the cone sits just under the
    // hero, below its "você" ring and shadow (you-rules RING_UNDER .3, shadow −1), like those; elsewhere the ground layer.
    g.setVisible(true).setDepth(coneDepth(!!this.projector.depthOverride,this.depth,shadow,()=>this.projector.depth(hero.x,hero.y)));
    let ux=this.dir.x,uy=this.dir.y;
    if(aim){const dx=aim.x-hero.x,dy=aim.y-hero.y,len=Math.hypot(dx,dy);if(len>1e-3){ux=dx/len;uy=dy/len;}}
    const base=Math.atan2(uy,ux);
    for(let i=0;i<this.count;i++)this.sector(hero.x,hero.y,base+2*Math.PI*i/this.count,a,body);
  }

  destroy(){this.g.destroy();}

  private sector(x:number,y:number,angle:number,a:number,b:number){
    const g=this.g,p=this.projector,r=this.radius,half=Math.min(this.half,Math.PI),a0=angle-half,a1=angle+half;
    const world=this.world,screen=this.screen,n=ARC_POINTS;
    const project=(w:Pt,out:Pt)=>p.project(w.x,w.y,out);
    // Fill: the apex and the outer arc.
    arcPoints(x,y,r,a0,a1,n,world);
    p.project(x,y,screen[0]);
    for(let i=0;i<n;i++)project(world[i],screen[i+1]);
    g.fillStyle(CONE_FILL,CONE_FILL_ALPHA*a).fillPoints(screen,true,true,n+1);
    // The rim band, a touch denser than the fill.
    const ri=r*BAND_INNER;
    this.band(x,y,r,ri,a0,a1,a);
    // Straight sides: thin, from the apex to the rim.
    const q=this.q;
    for(const t of [a0,a1]){
      p.project(x,y,screen[0]);p.project(x+Math.cos(t)*r,y+Math.sin(t)*r,q);
      g.lineStyle(Math.max(1,1.4*b),CONE_RIM,.55*a).lineBetween(screen[0].x,screen[0].y,q.x,q.y);
    }
    // The rim: a soft glow, the bright thick line, the thinner parallel one inside.
    arcPoints(x,y,r,a0,a1,n,world);for(let i=0;i<n;i++)project(world[i],screen[i]);
    g.lineStyle(10*b,CONE_FILL,.2*a).strokePoints(screen,false,false,n);
    g.lineStyle(Math.max(3,6.5*b),BREU,.4*a).strokePoints(screen,false,false,n);
    g.lineStyle(Math.max(2,4.5*b),CONE_RIM,a).strokePoints(screen,false,false,n);
    arcPoints(x,y,ri,a0,a1,n,world);for(let i=0;i<n;i++)project(world[i],screen[i]);
    g.lineStyle(Math.max(1,2*b),CONE_RIM,.85*a).strokePoints(screen,false,false,n);
    this.runes(x,y,(r+ri)/2,(r-ri)*.62,a0,a1,a,b);
    this.ornament(x,y,r,a0,-1,a,b);
    this.ornament(x,y,r,a1,1,a,b);
  }

  /** The band between the two rim lines, filled a little denser than the cone. */
  private band(x:number,y:number,r:number,ri:number,a0:number,a1:number,a:number){
    const p=this.projector,n=ARC_POINTS/2,world=this.world,screen=this.screen;
    arcPoints(x,y,r,a0,a1,n,world);for(let i=0;i<n;i++)p.project(world[i].x,world[i].y,screen[i]);
    arcPoints(x,y,ri,a1,a0,n,world);for(let i=0;i<n;i++)p.project(world[i].x,world[i].y,screen[n+i]);
    this.g.fillStyle(CONE_FILL,.2*a).fillPoints(screen,true,true,2*n);
  }

  /** Small runes on the ground along the band: three glyphs taking turns (a crossed bar, a diamond, a chevron). */
  private runes(x:number,y:number,rm:number,size:number,a0:number,a1:number,a:number,b:number){
    const g=this.g,p=this.projector,count=runeCount(this.radius,Math.min(this.half,Math.PI)),pts=this.glyph,q=this.q;
    g.lineStyle(Math.max(1,1.8*b),CONE_RIM,.9*a);
    for(let k=0;k<count;k++){
      const t=a0+(a1-a0)*(k+.5)/count,cx=x+Math.cos(t)*rm,cy=y+Math.sin(t)*rm;
      // Local ground basis: radial (out) and tangent (along the arc), so the glyph lies flat on the band.
      const rx=Math.cos(t),ry=Math.sin(t),tx=-ry,ty=rx,s=size/2;
      const at=(u:number,v:number,out:Pt)=>p.project(cx+rx*u*s+tx*v*s,cy+ry*u*s+ty*v*s,out);
      switch(k%3){
        case 0:{ // a radial bar with a crossbar
          at(-1,0,pts[0]);at(1,0,pts[1]);g.lineBetween(pts[0].x,pts[0].y,pts[1].x,pts[1].y);
          at(.25,-.55,pts[0]);at(.25,.55,pts[1]);g.lineBetween(pts[0].x,pts[0].y,pts[1].x,pts[1].y);break;
        }
        case 1:{ // a diamond
          at(-1,0,pts[0]);at(0,.6,pts[1]);at(1,0,pts[2]);at(0,-.6,pts[3]);g.strokePoints(pts,true,true,4);break;
        }
        default:{ // a chevron pointing out, with a dot inside
          at(-.8,-.6,pts[0]);at(.8,0,pts[1]);at(-.8,.6,pts[2]);g.strokePoints(pts,false,false,3);
          at(-.25,0,q);g.fillStyle(CONE_RIM,.8*a).fillCircle(q.x,q.y,Math.max(1,1.3*b));
        }
      }
    }
  }

  /** The curl at one end of the arc (side -1: the start, 1: the end): a small hook turning out of the cone and back. */
  private ornament(x:number,y:number,r:number,t:number,side:number,a:number,b:number){
    const p=this.projector,pts=this.glyph,n=GLYPH_POINTS,cr=r*.09;
    // Centre of the curl: just past the arc's end, along the arc's tangent (out of the cone) and a little inside.
    const tx=-Math.sin(t)*side,ty=Math.cos(t)*side,ex=x+Math.cos(t)*r,ey=y+Math.sin(t)*r;
    const cx=ex+tx*cr-Math.cos(t)*cr*.15,cy=ey+ty*cr-Math.sin(t)*cr*.15;
    // Starts at the arc's end and winds ~1.4 turns inward (radius shrinking), like a scroll.
    const start=Math.atan2(ey-cy,ex-cx);
    for(let i=0;i<n;i++){
      const u=i/(n-1),ang=start+side*u*Math.PI*1.4,rad=cr*(1-.55*u);
      p.project(cx+Math.cos(ang)*rad,cy+Math.sin(ang)*rad,pts[i]);
    }
    this.g.lineStyle(Math.max(2.5,5*b),BREU,.35*a).strokePoints(pts,false,false,n);
    this.g.lineStyle(Math.max(1.5,3*b),CONE_RIM,a).strokePoints(pts,false,false,n);
  }
}
