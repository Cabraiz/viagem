/**
 * The Defumador's aura on the ground (card upgrades-megabonk, the Megabonk aura): a hero who took the tome walks inside
 * a ring of incense smoke of the sim's radius (sim/weapons/system.ts auraRadius: rules AURA.radius × the build's area),
 * from the view's passives (nothing new on the wire).
 * BUG-20261022-ORQ-circulo-roxo: no drawn ellipse. NEW-20261029-ORQ-aura-defumador-fumaca: the old painted ring read
 * as trodden hay (two still paintings cross-fading in 5.2 s). Now the ring is puffs of smoke rising: each puff stands
 * at a point of the radius, lives through the six frames of one painting (public/art/fx/aura-defumador.webp,
 * scripts/import-aura-defumador.mjs: ChatGPT via Codex, the attack effects' cartoon look: birth, growing, full,
 * swelling, breaking up, vanishing), rises and grows while it does, faint on the ground and fullest mid-air; the ring
 * drifts slowly round. The puffs in front of the hero draw over his feet, the ones behind under him. The local hero's
 * plain, the allies' fainter; with reduced motion the puffs stand still. None until the sheet is loaded (no fallback).
 */
import type Phaser from 'phaser';
import {AURA,classBonusOf,computeStats} from '../../rules/index.ts';
import type {Projector} from './projector.ts';
import {CITY_UNDER} from './melee-cone.ts';

/** The painted sheet: AURA_FRAMES square frames of AURA_FRAME_W×AURA_FRAME_H side by side, one puff's life. */
export const AURA_KEY='fx:aura-defumador',AURA_URL='/art/fx/aura-defumador.webp',AURA_FRAME_W=160,AURA_FRAME_H=160,AURA_FRAMES=6;
/** Peak opacity of the local hero's puffs and of an ally's (fainter: someone else's aura is not your business). */
export const AURA_SELF_ALPHA=.78,AURA_ALLY_ALPHA=.34;
/** Opacity of a puff still on the ground, over its peak: the smoke is thin where it touches the floor. */
export const AURA_GROUND_ALPHA=.3;
/** One puff's life (ms): born on the ground, gone mid-air. */
export const AURA_CYCLE_MS=2600;
/** How far a puff rises over its life (screen px) and how big a frame is drawn (world u: the projector's 2:1 grid). */
export const AURA_RISE_PX=30,AURA_PUFF_U=.85;
/** Puffs along the ring: one every AURA_SPACING_U of its length, between AURA_MIN_PUFFS and AURA_MAX_PUFFS. */
export const AURA_SPACING_U=.55,AURA_MIN_PUFFS=10,AURA_MAX_PUFFS=24;
/** One slow turn of the whole ring (ms). */
export const AURA_SWIRL_MS=26000;
/**
 * Outside the city the heroes draw at fixed depths over the horde (render/you.ts SELF_DEPTH 96500, ALLY_DEPTH 96400):
 * a puff in front of its hero draws just over them.
 */
export const AURA_FRONT_SELF=96500.5,AURA_FRONT_ALLY=96400.5;

/** World radius of a hero's aura from its view (passives, class), or 0 without the Defumador. */
export function auraRingRadius(p:{classId:string;weapons:readonly {id:string;level:number}[];passives:readonly {id:string;level:number}[]}){
  const level=p.passives.find(o=>o.id==='defumador')?.level??0;
  if(level<=0)return 0;
  const stats=computeStats({weapons:[...p.weapons],passives:[...p.passives]},classBonusOf(p.classId));
  return AURA.radius(level)*stats.area;
}
/** Screen half axes of a ground circle of world radius r (the projector's 2:1: x and y steps of 42 px across, 21 down). */
export const auraAxes=(r:number)=>({rx:r*42*Math.SQRT2,ry:r*21*Math.SQRT2});
/** How many puffs a ring of world radius r gets. */
export const auraPuffCount=(r:number)=>Math.max(AURA_MIN_PUFFS,Math.min(AURA_MAX_PUFFS,Math.round(2*Math.PI*r/AURA_SPACING_U)));

/** A stable pseudo-random number in [0,1) for puff i (its phase, spot and size never jump between frames). */
const hash=(i:number,salt:number)=>{const s=Math.sin(i*127.1+salt*311.7)*43758.5453;return s-Math.floor(s);};

export type Puff={
  /** World point on the ground the puff rises from. */
  x:number;y:number;
  /** Its age in [0,1) (0 born on the ground), the frame it shows, its opacity, its size factor and screen rise (px). */
  t:number;frame:number;alpha:number;scale:number;rise:number;flip:boolean;
};
/**
 * Puff i of n around (cx,cy) on a ring of world radius r at `now` (ms), peak opacity `alpha`. With reduced motion
 * every puff is still, full and on the ground.
 */
export function auraPuff(i:number,n:number,cx:number,cy:number,r:number,now:number,reduced:boolean,alpha:number,out:Puff):Puff{
  const life=AURA_CYCLE_MS*(.85+.3*hash(i,3));
  const t=reduced?.25+.25*hash(i,1):(now/life+hash(i,1))%1;
  const a=2*Math.PI*(i+.6*(hash(i,2)-.5))/n+(reduced?0:now/AURA_SWIRL_MS*2*Math.PI);
  const rho=r*(.86+.14*hash(i,4));
  out.x=cx+Math.cos(a)*rho;out.y=cy+Math.sin(a)*rho;out.t=t;
  out.frame=Math.min(AURA_FRAMES-1,Math.floor(t*AURA_FRAMES));
  // Thin on the ground, fullest mid-air, gone at the end (the last frames are wisps: they fade out too).
  const up=Math.min(1,t/.35),end=t<.7?1:Math.max(0,(1-t)/.3);
  out.alpha=alpha*(AURA_GROUND_ALPHA+(1-AURA_GROUND_ALPHA)*up*up*(3-2*up))*end*end*(3-2*end);
  out.scale=(.8+.4*t)*(.9+.2*hash(i,5));
  out.rise=reduced?0:t*AURA_RISE_PX;
  out.flip=hash(i,6)<.5;
  return out;
}

type Ring={x:number;y:number;r:number;self:boolean};

/**
 * The puffs of every ring, one Image each, pooled per ring. Behind the hero they lie on the ground (in the city at
 * the actor depths, projector.depthOverride: just under its hero, melee-cone CITY_UNDER; elsewhere on the ground
 * layer's depth); in front of him, over him (city: the puff's own actor depth, never under the hero's).
 */
export class AuraRings{
  private pool:Phaser.GameObjects.Image[][]=[];
  private q={x:0,y:0};private c={x:0,y:0};
  private puff:Puff={x:0,y:0,t:0,frame:0,alpha:0,scale:1,rise:0,flip:false};
  private projector:Projector;private scene:Phaser.Scene;private depth:number;private asked=false;
  /** Every Image made so far (the owner tracks them for destroy). */
  readonly made:Phaser.GameObjects.Image[]=[];
  constructor(scene:Phaser.Scene,projector:Projector,depth:number){
    this.scene=scene;this.projector=projector;this.depth=depth;
  }
  /** Redraws every ring: `rings` world centre, radius (u) and whether it is the local hero's. */
  draw(rings:readonly Ring[],now:number,reduced:boolean){
    if(!this.ready(rings.length>0)){for(const ims of this.pool)for(const im of ims)im.setVisible(false);return;}
    while(this.pool.length<rings.length)this.pool.push([]);
    const p=this.projector,size=AURA_PUFF_U*42*Math.SQRT2;
    this.pool.forEach((ims,k)=>{
      const ring=rings[k],n=ring?auraPuffCount(ring.r):0;
      while(ims.length<n){const im=this.scene.add.image(0,0,AURA_KEY,0).setOrigin(.5,.75).setName('aura-defumador');this.made.push(im);ims.push(im);}
      ims.forEach((im,i)=>{
        if(!ring||i>=n){im.setVisible(false);return;}
        const at=p.project(ring.x,ring.y,this.c),centre=p.depthOverride?p.depth(ring.x,ring.y):0;
        const o=auraPuff(i,n,ring.x,ring.y,ring.r,now,reduced,ring.self?AURA_SELF_ALPHA:AURA_ALLY_ALPHA,this.puff);
        const q=p.project(o.x,o.y,this.q),front=q.y>at.y;
        const depth=p.depthOverride?front?Math.max(p.depth(o.x,o.y),centre+.5):centre-CITY_UNDER
          :front?ring.self?AURA_FRONT_SELF:AURA_FRONT_ALLY:this.depth;
        im.setVisible(o.alpha>.01).setFrame(o.frame).setFlipX(o.flip).setPosition(q.x,q.y-o.rise)
          .setDisplaySize(size*o.scale,size*o.scale).setAlpha(o.alpha).setDepth(depth);
      });
    });
  }
  /** Whether the sheet is in; asks for it the first time a ring is wanted. */
  private ready(wanted:boolean){
    const textures=this.scene.textures;
    if(textures.exists(AURA_KEY))return true;
    if(!wanted||this.asked)return false;
    this.asked=true;
    const load=this.scene.load,src=`${AURA_KEY}:src`;
    load.image(src,AURA_URL);
    load.once(`filecomplete-image-${src}`,()=>{
      if(textures.exists(AURA_KEY)||!textures.exists(src))return;
      textures.addSpriteSheet(AURA_KEY,textures.get(src).getSourceImage() as HTMLImageElement,{frameWidth:AURA_FRAME_W,frameHeight:AURA_FRAME_H,endFrame:AURA_FRAMES-1});
    });
    if(!load.isLoading())load.start();
    return false;
  }
  destroy(){for(const im of this.made)im.destroy();this.made.length=0;this.pool.length=0;}
}
