/**
 * The Defumador's aura on the ground (card upgrades-megabonk, the Megabonk aura): a hero who took the tome walks inside
 * a soft smoke ring of the sim's radius (sim/weapons/system.ts auraRadius: rules AURA.radius × the build's area), drawn
 * for every hero who has it, from the view's passives (nothing new on the wire). A slow breathing of the fill, none with
 * reduced motion. Procedural: one Graphics, every point projected on the ground like the melee cone.
 */
import type Phaser from 'phaser';
import {AURA,classBonusOf,computeStats} from '../../rules/index.ts';
import type {Projector} from './projector.ts';

type Pt={x:number;y:number};
/** Smoke white with a lilac rim (the defumador's sticker), Breu under the rim so it reads on snow. */
export const AURA_FILL=0xe9e2f5,AURA_RIM=0xb9a6e0,AURA_FILL_ALPHA=.16,AURA_RIM_ALPHA=.75;
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

export class AuraRings{
  private g:Phaser.GameObjects.Graphics;
  private pts:Pt[]=Array.from({length:POINTS},()=>({x:0,y:0}));
  private projector:Projector;
  constructor(scene:Phaser.Scene,projector:Projector,depth:number){
    this.projector=projector;
    this.g=scene.add.graphics().setDepth(depth).setName('aura-defumador');
  }
  get object(){return this.g;}
  /** Redraws every ring: `rings` world centre and radius (u), `body` the line scale. */
  draw(rings:readonly {x:number;y:number;r:number}[],now:number,body:number,reduced:boolean){
    const g=this.g;g.clear();
    g.setVisible(rings.length>0);
    for(const {x,y,r} of rings){
      for(let i=0;i<POINTS;i++){const t=2*Math.PI*i/POINTS;this.projector.project(x+Math.cos(t)*r,y+Math.sin(t)*r,this.pts[i]);}
      g.fillStyle(AURA_FILL,auraAlpha(now,reduced)).fillPoints(this.pts,true,true);
      g.lineStyle(Math.max(2,4*body),BREU,.35).strokePoints(this.pts,true,true);
      g.lineStyle(Math.max(1,2*body),AURA_RIM,AURA_RIM_ALPHA).strokePoints(this.pts,true,true);
    }
  }
  destroy(){this.g.destroy();}
}
