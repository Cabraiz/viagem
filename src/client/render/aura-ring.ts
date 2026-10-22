/**
 * The Defumador's aura on the ground (card upgrades-megabonk, the Megabonk aura): a hero who took the tome walks inside
 * a soft smoke ring of the sim's radius (sim/weapons/system.ts auraRadius: rules AURA.radius × the build's area), drawn
 * for every hero who has it, from the view's passives (nothing new on the wire). A slow breathing of the fill, none with
 * reduced motion. Procedural: one Graphics, every point projected on the ground like the melee cone.
 */
import type Phaser from 'phaser';
import {AURA,classBonusOf,computeStats} from '../../rules/index.ts';
import type {Projector} from './projector.ts';
import {CITY_UNDER} from './melee-cone.ts';

type Pt={x:number;y:number};
/** Smoke white with a lilac rim (the defumador's sticker), Breu under the rim so it reads on snow. */
export const AURA_FILL=0xd9cdf2,AURA_RIM=0x9d82d9,AURA_FILL_ALPHA=.3,AURA_RIM_ALPHA=.95;
const BREU=0x1e1530,POINTS=48;

/** World radius of a hero's aura from its view (passives, class), or 0 without the Defumador. */
export function auraRingRadius(p:{classId:string;weapons:readonly {id:string;level:number}[];passives:readonly {id:string;level:number}[]}){
  const level=p.passives.find(o=>o.id==='defumador')?.level??0;
  if(level<=0)return 0;
  const stats=computeStats({weapons:[...p.weapons],passives:[...p.passives]},classBonusOf(p.classId));
  return AURA.radius(level)*stats.area;
}
/** Fill opacity at `now` (ms): a slow breath around AURA_FILL_ALPHA; steady with reduced motion. */
export const auraAlpha=(now:number,reduced:boolean)=>reduced?AURA_FILL_ALPHA:AURA_FILL_ALPHA*(1+.35*Math.sin(now*.003));

/**
 * One Graphics per ring: in the city the ground is pieces at actor depths (projector.depthOverride), so each ring lies
 * just under its hero (melee-cone CITY_UNDER, under the shadow); elsewhere on the ground layer's depth.
 */
export class AuraRings{
  private pool:Phaser.GameObjects.Graphics[]=[];
  private pts:Pt[]=Array.from({length:POINTS},()=>({x:0,y:0}));
  private projector:Projector;private scene:Phaser.Scene;private depth:number;
  /** Every Graphics made so far (the owner tracks them for destroy). */
  readonly made:Phaser.GameObjects.Graphics[]=[];
  constructor(scene:Phaser.Scene,projector:Projector,depth:number){
    this.scene=scene;this.projector=projector;this.depth=depth;
  }
  /** Redraws every ring: `rings` world centre and radius (u), `body` the line scale. */
  draw(rings:readonly {x:number;y:number;r:number}[],now:number,body:number,reduced:boolean){
    while(this.pool.length<rings.length){const g=this.scene.add.graphics().setName('aura-defumador');this.pool.push(g);this.made.push(g);}
    this.pool.forEach((g,i)=>{
      g.clear();
      const ring=rings[i];
      if(!ring){g.setVisible(false);return;}
      const {x,y,r}=ring,p=this.projector;
      g.setVisible(true).setDepth(p.depthOverride?p.depth(x,y)-CITY_UNDER:this.depth);
      for(let k=0;k<POINTS;k++){const t=2*Math.PI*k/POINTS;p.project(x+Math.cos(t)*r,y+Math.sin(t)*r,this.pts[k]);}
      g.fillStyle(AURA_FILL,auraAlpha(now,reduced)).fillPoints(this.pts,true,true);
      g.lineStyle(Math.max(3,6*body),BREU,.5).strokePoints(this.pts,true,true);
      g.lineStyle(Math.max(2,3*body),AURA_RIM,AURA_RIM_ALPHA).strokePoints(this.pts,true,true);
    });
  }
  destroy(){for(const g of this.made)g.destroy();this.made.length=0;this.pool.length=0;}
}
