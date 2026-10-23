/**
 * The Defumador's aura on the ground (card upgrades-megabonk, the Megabonk aura): a hero who took the tome walks inside
 * a ring of incense smoke of the sim's radius (sim/weapons/system.ts auraRadius: rules AURA.radius × the build's area),
 * from the view's passives (nothing new on the wire).
 * BUG-20261022-ORQ-circulo-roxo: no drawn ellipse (the lilac fill with a thick purple rim read as a big purple circle
 * around every bot). The smoke is painted (public/art/fx/aura-defumador.webp, scripts/import-aura-defumador.mjs: the
 * ring seen by the game's camera, Myth look, no edge: it dissolves at the radius), two paintings cross-fading slowly;
 * the local hero's is plain, the allies' fainter. None until the strip is loaded (never a fallback ellipse).
 */
import type Phaser from 'phaser';
import {AURA,classBonusOf,computeStats} from '../../rules/index.ts';
import type {Projector} from './projector.ts';
import {CITY_UNDER} from './melee-cone.ts';

/** The painted strip: AURA_FRAMES frames of AURA_FRAME_W×AURA_FRAME_H side by side (each the ring's ellipse, 2:1). */
export const AURA_KEY='fx:aura-defumador',AURA_URL='/art/fx/aura-defumador.webp',AURA_FRAME_W=512,AURA_FRAME_H=256,AURA_FRAMES=2;
/** Opacity of the local hero's smoke and of an ally's (fainter: someone else's aura is not your business). */
export const AURA_SELF_ALPHA=.9,AURA_ALLY_ALPHA=.4;
/** The painted ellipse over the aura's ground ellipse: the smoke's band thins out right at the radius. */
export const AURA_FIT=1.06;
/** One cross-fade A→B→A (ms). */
export const AURA_CYCLE_MS=5200;

/** World radius of a hero's aura from its view (passives, class), or 0 without the Defumador. */
export function auraRingRadius(p:{classId:string;weapons:readonly {id:string;level:number}[];passives:readonly {id:string;level:number}[]}){
  const level=p.passives.find(o=>o.id==='defumador')?.level??0;
  if(level<=0)return 0;
  const stats=computeStats({weapons:[...p.weapons],passives:[...p.passives]},classBonusOf(p.classId));
  return AURA.radius(level)*stats.area;
}
/** Screen half axes of a ground circle of world radius r (the projector's 2:1: x and y steps of 42 px across, 21 down). */
export const auraAxes=(r:number)=>({rx:r*42*Math.SQRT2*AURA_FIT,ry:r*21*Math.SQRT2*AURA_FIT});
/**
 * Opacity of each painted frame at `now` (ms), times `alpha`: a smooth cross-fade (they always sum to `alpha`, so the
 * smoke never blinks); the first frame alone with reduced motion.
 */
export function auraFrameAlphas(now:number,reduced:boolean,alpha:number):[number,number]{
  if(reduced)return [alpha,0];
  const b=.5-.5*Math.cos(now/AURA_CYCLE_MS*2*Math.PI);
  return [alpha*(1-b),alpha*b];
}

type Ring={x:number;y:number;r:number;self:boolean};
type Pair=[Phaser.GameObjects.Image,Phaser.GameObjects.Image];

/**
 * Two Images per ring (the two paintings). In the city the ground is pieces at actor depths (projector.depthOverride),
 * so each ring lies just under its hero (melee-cone CITY_UNDER, under the shadow); elsewhere on the ground layer's depth.
 */
export class AuraRings{
  private pool:Pair[]=[];
  private q={x:0,y:0};
  private projector:Projector;private scene:Phaser.Scene;private depth:number;private asked=false;
  /** Every Image made so far (the owner tracks them for destroy). */
  readonly made:Phaser.GameObjects.Image[]=[];
  constructor(scene:Phaser.Scene,projector:Projector,depth:number){
    this.scene=scene;this.projector=projector;this.depth=depth;
  }
  /** Redraws every ring: `rings` world centre, radius (u) and whether it is the local hero's. */
  draw(rings:readonly Ring[],now:number,reduced:boolean){
    if(!this.ready(rings.length>0)){for(const pair of this.pool)for(const im of pair)im.setVisible(false);return;}
    while(this.pool.length<rings.length){
      const make=(frame:number)=>{const im=this.scene.add.image(0,0,AURA_KEY,frame).setName('aura-defumador');this.made.push(im);return im;};
      this.pool.push([make(0),make(1).setFlipX(true)]);
    }
    this.pool.forEach((pair,i)=>{
      const ring=rings[i];
      if(!ring){for(const im of pair)im.setVisible(false);return;}
      const p=this.projector,at=p.project(ring.x,ring.y,this.q),{rx,ry}=auraAxes(ring.r);
      const alphas=auraFrameAlphas(now,reduced,ring.self?AURA_SELF_ALPHA:AURA_ALLY_ALPHA);
      const depth=p.depthOverride?p.depth(ring.x,ring.y)-CITY_UNDER:this.depth;
      pair.forEach((im,k)=>{
        im.setVisible(alphas[k]>.01).setPosition(at.x,at.y).setDisplaySize(2*rx,2*ry).setAlpha(alphas[k]).setDepth(depth);
      });
    });
  }
  /** Whether the strip is in; asks for it the first time a ring is wanted. */
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
