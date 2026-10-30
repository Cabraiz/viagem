/**
 * The defenses renderer's state (moved from towers.ts, corte C2): every field, the constructor, the scale getters and
 * the baked procedural effect and crater frames. TowerFx, TowerDraw, TowerAim and TowerRenderer extend it.
 */
import Phaser from 'phaser';
import {CoverFader,HERO_SCREEN} from '../city/occlusion.ts';
import {MATERIALS} from '../city/palette.ts';
import type {Pt} from '../city/projection.ts';
import {tokenColor} from '../../ui/tokens.ts';
import {TowerAtlas,type AtlasFrame} from './tower-atlas.ts';
import {lightEnabled} from '../light.ts';
import {CALIBRE,towerArtScale,towerKindScale,type CalibreLook,type TowerKind} from './tower-rules.ts';
import {BLAST_POOL,BLAST_BIG_GROUND,BLAST_BIG_H,BLAST_GROUND,BLAST_H,BLAST_R,BLAST_W,CONE_H,CONE_W,CRATER_BIG,CRATER_BIG_TEX,CRATER_FRAME,CRATER_POOL,CRATER_TEX,FLASH_LONG_H,FLASH_LONG_W,FLASH_POOL,FLASH_TEX,FX,FX_ART_KEY,FX_ART_URL,
  HEAD_TEX,RING_H,RING_W,SHOT_POOL,SPARK_TEX,SPOT_H,SPOT_W,STREAK_H,STREAK_LINE,STREAK_W,pool,type FxArtFrames} from './tower-tuning.ts';
import type {Blast,Crater,Flash,Shot,Tower,TowerRendererOptions} from './tower-types.ts';

export abstract class TowerRendererBase {

  protected readonly scene:Phaser.Scene;
  protected readonly o:TowerRendererOptions;
  protected readonly towers=new Map<string,Tower>();
  /** Scratch Graphics the procedural textures are drawn into (never on screen). */
  protected readonly bake:Phaser.GameObjects.Graphics;
  protected readonly atlas:TowerAtlas;
  /** Crater decals: baked frames, a fixed pool of Images in a layer on the ground, placed once. */
  protected readonly craterImages:Phaser.GameObjects.Image[];
  protected readonly craterFrames:{small:AtlasFrame;big:AtlasFrame};
  protected readonly ground:Phaser.GameObjects.Layer;
  /** The defenses' cast shadows: at the ground layer's depth, added after it (over craters and rails, under the rest). */
  protected readonly shade:Phaser.GameObjects.Layer;
  protected readonly light:boolean;
  protected economyOn:boolean;
  /** Shots, explosions and flashes: pooled Images in the scene's display list, each at its own point's actor depth. */
  protected readonly fxImages:Phaser.GameObjects.Image[]=[];
  protected readonly shots=pool<Shot>(SHOT_POOL,()=>({on:false,cal:CALIBRE.pistola,x0:0,y0:0,z0:0,x1:0,y1:0,born:0,ms:0,mx:0,my:0,ox:0,oy:0,cell:-1,d0:0,src:undefined,dz:0,trail:undefined,head:undefined,puff:undefined}));
  protected readonly flashes=pool<Flash>(FLASH_POOL,()=>({on:false,x:0,y:0,r:0,born:0,ms:0,depth:0,lift:0,src:undefined,img:undefined,smoke:false,long:false,rot:0}));
  protected readonly blasts=pool<Blast>(BLAST_POOL,()=>({on:false,x:0,y:0,r:0,born:0,ms:0,ring:false,depth:0,img:undefined,tint:0,look:'fogo',smokeMs:0,smoke:undefined}));
  protected readonly craters=pool<Crater>(CRATER_POOL,()=>({on:false,x:0,y:0,r:0,born:0,ms:0}));
  protected cursor={shot:0,flash:0,blast:0,crater:0};
  protected readonly fader=new CoverFader();
  protected readonly covered=new Set<string>();
  /** The figures of the last cover test (x, y, z each) and whether a defense changed since: else the test is skipped. */
  protected readonly lastFigures:number[]=[];
  protected coverDirty=true;
  /** The city's figure box at the current actor scale (the fade test's, as for the buildings). */
  protected figureBox={w:HERO_SCREEN.w,h:HERO_SCREEN.h,scale:-1};
  protected depthSeen=-1;
  protected enemies={n:0,xs:new Float32Array(0) as ArrayLike<number>,ys:new Float32Array(0) as ArrayLike<number>,air:undefined as ArrayLike<number>|undefined};
  protected shake={born:-1e9,cal:CALIBRE.pistola as CalibreLook};
  protected applied={x:0,y:0};
  protected readonly p:Pt={x:0,y:0};
  protected readonly q:Pt={x:0,y:0};
  protected readonly v:Pt={x:0,y:0};
  protected readonly corners:Pt[]=pool<Pt>(8,()=>({x:0,y:0}));
  protected stamp=0;
  protected now=0;
  protected unitPx=1;
  /** World px across the diamond of a 1 u ground square (the delivered art's scale, towerArtScale). */
  protected diamondPx=1;
  protected readonly breu=tokenColor('--c-breu');
  protected readonly papel=tokenColor('--c-papel');
  protected readonly amarelo=tokenColor('--c-amarelo');
  protected readonly cone=tokenColor('--c-cone');
  constructor(scene:Phaser.Scene,options:TowerRendererOptions){
    this.scene=scene;this.o=options;
    this.bake=scene.make.graphics({x:0,y:0},false);
    this.atlas=new TowerAtlas(scene.textures);
    this.craterFrames={small:this.bakeCrater(CRATER_FRAME,CRATER_TEX,false),big:this.bakeCrater(CRATER_BIG,CRATER_BIG_TEX,true)};
    this.ground=scene.add.layer().setDepth(options.groundDepth);
    this.shade=scene.add.layer().setDepth(options.groundDepth);
    this.light=options.light??lightEnabled();this.economyOn=!!options.economy;
    const small=this.craterFrames.small;
    this.craterImages=this.craters.map(()=>{const img=scene.make.image({x:0,y:0,key:small.key,frame:small.frame},false).setVisible(false);this.ground.add(img);return img;});
    this.bakeEffects();
    this.paintArt();
    this.atlas.flush();
    this.measure();
  }
  /** Paints the delivered effects over the baked ones, asking for them the first time (they come in a frame later). */
  protected paintArt(){
    const {textures,cache,load}=this.scene,json=`${FX_ART_KEY}:json`;
    if(!cache?.json||!textures)return;
    const paint=()=>{
      const art=cache.json.get(json) as FxArtFrames|undefined;
      if(!art?.frames||!textures.exists(FX_ART_KEY))return;
      const src=textures.get(FX_ART_KEY).getSourceImage() as HTMLImageElement;
      for(const [name,r] of Object.entries(art.frames))
        this.atlas.repaint(name,(ctx,x,y,w,h)=>ctx.drawImage(src,r.x,r.y,r.w,r.h,x,y,w,h));
    };
    if(textures.exists(FX_ART_KEY)&&cache.json.exists(json)){paint();return;}
    if(!load?.once)return;
    let left=0;const done=()=>{if(--left===0&&this.bake.scene)paint();};
    if(!textures.exists(FX_ART_KEY)){left++;load.image(FX_ART_KEY,`${FX_ART_URL}.webp`);load.once(`filecomplete-image-${FX_ART_KEY}`,done);}
    if(!cache.json.exists(json)){left++;load.json(json,`${FX_ART_URL}.json`);load.once(`filecomplete-json-${json}`,done);}
    if(!load.isLoading())load.start();
  }
  protected get s(){const k=this.o.actorScale;return typeof k==='function'?k():k??1;}
  /** Size unit of the weapons and effects: world px of 1/24 u, so they keep their size against the boxes at any scale. */
  protected get f(){return this.unitPx/24;}
  /** World px per art px of the delivered sheets (towerArtScale: the city scenery's). */
  protected get artScale(){const c=this.o.cell,cell=typeof c==='function'?c():c;return towerArtScale(this.diamondPx,cell&&cell>0?cell:undefined);}
  /** World px per art px of a kind's sheets: the scenery's, or the hero's for the ramo A posts (towerKindScale). */
  protected kindScale(kind:TowerKind){return towerKindScale(kind,this.artScale,this.s);}
  /** World px of 1 u along the ground (screen length of a unit step), for barrel lengths and blast ellipses. */
  protected measure(){
    const w=this.o.world,a=w.project(0,0,0,{x:0,y:0}),b=w.project(1,0,0,{x:0,y:0}),c=w.project(0,1,0,{x:0,y:0});
    this.unitPx=Math.max(1,Math.hypot(b.x-a.x,b.y-a.y));
    this.diamondPx=Math.max(1,Math.abs(b.x-a.x)+Math.abs(c.x-a.x));
  }
  protected setFrame(img:Phaser.GameObjects.Image,f:AtlasFrame){
    return img.texture.key===f.key&&img.frame.name===f.frame?img:img.setTexture(f.key,f.frame);
  }
  /**
   * A crater decal (torres-polimento), drawn once: soot thrown around it, the bowl dug in the snow with its lit front lip,
   * clods and snow thrown on the rim (a fixed pseudo-random scatter), the Breu edge; the big one (the large shells, the
   * Gustavão) is also cracked from the middle out. Its outline keeps to the ellipse its radius gives (w × w/2).
   */
  protected bakeCrater(name:string,w:number,big:boolean):AtlasFrame{
    return this.atlas.frame(name,w,w/2,this.bake,g=>{
      const h=w/2,k=w/CRATER_TEX,cx=w/2,cy=h/2,rx=w/2-2*k,ry=h/2-1*k; // rx, ry: the outer ellipse's half axes
      let seed=big?7:3;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
      const oval=(color:number,a:number,x:number,y:number,sx:number,sy:number)=>g.fillStyle(color,a).fillEllipse(x,y,2*rx*sx,2*ry*sy);
      // Soot: the whole ellipse dimmed, smudges thicker toward the middle.
      oval(this.breu,.2,cx,cy,1,1);
      for(let i=0;i<14;i++){const a=rnd()*Math.PI*2,d=.15+.45*rnd(),sz=.3+.25*rnd();oval(this.breu,.12,cx+Math.cos(a)*rx*d,cy+Math.sin(a)*ry*d,sz,sz);}
      // The bowl: the snow lip lit at the front, the dug earth, the dark middle.
      oval(this.papel,.85,cx,cy+ry*.07,.76,.76);
      oval(MATERIALS.pedra.escura,.92,cx,cy,.7,.66);
      oval(this.breu,.5,cx,cy-ry*.05,.46,.4);
      oval(this.breu,.75,cx,cy-ry*.08,.2,.18);
      if(big)for(let i=0;i<9;i++){ // cracks from the middle out, across the soot
        const a=i/9*Math.PI*2+rnd()*.4,l=.6+.3*rnd(),bend=.3*(rnd()-.5);
        const mx=cx+Math.cos(a+bend)*rx*l*.6,my=cy+Math.sin(a+bend)*ry*l*.6,ex=cx+Math.cos(a)*rx*l,ey=cy+Math.sin(a)*ry*l;
        g.lineStyle(2.2*k,this.breu,.7).lineBetween(cx+Math.cos(a)*rx*.15,cy+Math.sin(a)*ry*.15,mx,my).lineBetween(mx,my,ex,ey);
      }
      // Clods and snow thrown on the rim.
      for(let i=0;i<(big?26:14);i++){
        const a=rnd()*Math.PI*2,d=.66+.26*rnd(),r=(2.2+2.6*rnd())*k*(big?.7:1),x=cx+Math.cos(a)*rx*d,y=cy+Math.sin(a)*ry*d;
        g.fillStyle(this.breu,.8).fillEllipse(x,y+r*.25,r*2.3,r*1.5).fillStyle(rnd()<.6?this.papel:MATERIALS.pedra.clara,1).fillEllipse(x,y,r*1.8,r*1.1);
      }
      g.lineStyle(2*k,this.breu,.65).strokeEllipse(cx,cy,2*rx*.71,2*ry*.67);
    });
  }
  /** The effect textures, drawn once into the scratch Graphics (kept by the texture manager for every renderer). */
  protected bakeEffects(){
    const g=this.bake,make=(name:string,w:number,h:number,draw:()=>void)=>{this.atlas.frame(name,w,h,g,draw);};
    const c=FLASH_TEX/2;
    make(FX.flash,FLASH_TEX,FLASH_TEX,()=>g.fillStyle(this.cone,.7).fillCircle(c,c,c).fillStyle(this.amarelo,1).fillCircle(c,c,c/1.25)
      .fillStyle(this.papel,1).fillCircle(c,c,c/1.25*.45));
    { // a rifle's flash: a long tongue forward, two short ones aside, from the muzzle at x ≈ 12 %
      const W=FLASH_LONG_W,H=FLASH_LONG_H,x0=W*.12,m=H/2,star=(color:number,a:number,s:number)=>{
        g.fillStyle(color,a).fillTriangle(x0,m-H*.2*s,x0,m+H*.2*s,x0+(W-x0-2)*s,m)
          .fillTriangle(x0-2,m,x0+W*.22*s,m-H*.46*s,x0+W*.14*s,m).fillTriangle(x0-2,m,x0+W*.22*s,m+H*.46*s,x0+W*.14*s,m)
          .fillTriangle(x0+2,m-H*.12*s,x0+2,m+H*.12*s,2,m).fillCircle(x0+2,m,H*.22*s);
      };
      make(FX.flashLong,W,H,()=>{star(this.cone,.75,1);star(this.amarelo,1,.72);star(this.papel,1,.38);});
    }
    { // a bullet's hit: a four-point star
      const C=SPARK_TEX/2,arm=(color:number,a:number,s:number)=>g.fillStyle(color,a)
        .fillTriangle(C,C-C*s,C-C*.22*s,C,C+C*.22*s,C).fillTriangle(C,C+C*s,C-C*.22*s,C,C+C*.22*s,C)
        .fillTriangle(C-C*s,C,C,C-C*.22*s,C,C+C*.22*s).fillTriangle(C+C*s,C,C,C-C*.22*s,C,C+C*.22*s);
      make(FX.spark,SPARK_TEX,SPARK_TEX,()=>{arm(this.breu,.55,1);arm(this.amarelo,1,.8);arm(this.papel,1,.45);});
    }
    {
      const R=BLAST_R,rh=R*.5,lift=rh*1.2*.5,cx=BLAST_W/2,cy=BLAST_GROUND;
      make(FX.blast,BLAST_W,BLAST_H,()=>g.fillStyle(this.breu,.35).fillEllipse(cx,cy-lift,R*2.1,rh*2.4)
        .fillStyle(this.cone,.85).fillEllipse(cx,cy-lift*.6,R*1.6,rh*1.9).fillStyle(this.amarelo,1).fillEllipse(cx,cy-lift*.4,R*.9,rh*1.1));
      // The big shells': the same fireball under a dark smoke cap, a white-hot core, snow kicked up at its foot.
      // Its texture is taller (the cap rises above the fireball), the ground as far from its foot as the small one's.
      make(FX.blastBig,BLAST_W,BLAST_BIG_H,()=>{
        const cy=BLAST_BIG_GROUND;
        g.fillStyle(this.breu,.35).fillEllipse(cx,cy-lift,R*2.1,rh*2.4).fillStyle(this.cone,.9).fillEllipse(cx,cy-lift*.6,R*1.6,rh*1.9)
          .fillStyle(this.amarelo,1).fillEllipse(cx,cy-lift*.4,R*.95,rh*1.15).fillStyle(this.papel,1).fillEllipse(cx,cy-lift*.3,R*.42,rh*.5);
        for(const [dx,dy,r] of [[-.5,-1,.42],[0,-1.2,.5],[.5,-.95,.4],[-.25,-1.35,.34],[.28,-1.4,.32]] as const)
          g.fillStyle(this.breu,.55).fillCircle(cx+dx*R,cy-lift+dy*rh,r*R*.62).fillStyle(MATERIALS.pedra.escura,.9).fillCircle(cx+dx*R,cy-lift+dy*rh-1,r*R*.5);
        g.fillStyle(this.papel,.9).fillEllipse(cx-R*.75,cy+rh*.35,R*.5,rh*.4).fillEllipse(cx+R*.78,cy+rh*.3,R*.45,rh*.36);
      });
    }
    make(FX.ring,RING_W,RING_H,()=>g.lineStyle(6,this.breu,.5).strokeEllipse(RING_W/2,RING_H/2,RING_W-8,RING_H-8)
      .lineStyle(3,this.papel,.9).strokeEllipse(RING_W/2,RING_H/2,RING_W-8,RING_H-8));
    const m=STREAK_H/2;
    const tracer=(name:string,core:number)=>make(name,STREAK_W,STREAK_H,()=>g.lineStyle(STREAK_LINE,this.breu,.6).lineBetween(0,m,STREAK_W,m)
      .lineStyle(STREAK_LINE*.55,core,1).lineBetween(0,m,STREAK_W,m));
    tracer(FX.tracer,this.amarelo);tracer(FX.tracerBranco,this.papel);tracer(FX.tracerVermelho,this.cone);
    make(FX.smoke,STREAK_W,STREAK_H,()=>g.lineStyle(STREAK_LINE,this.papel,1).lineBetween(0,m,STREAK_W,m));
    const h=HEAD_TEX/2,rim=h*.25;
    make(FX.headPapel,HEAD_TEX,HEAD_TEX,()=>g.fillStyle(this.papel,1).fillCircle(h,h,h));
    make(FX.puff,HEAD_TEX,HEAD_TEX,()=>g.fillStyle(this.papel,1).fillCircle(h,h,h));
    make(FX.headShell,HEAD_TEX,HEAD_TEX,()=>g.fillStyle(this.breu,1).fillCircle(h,h,h).fillStyle(MATERIALS.pedra.clara,1).fillCircle(h,h,h-rim));
    make(FX.headRocket,HEAD_TEX,HEAD_TEX,()=>g.fillStyle(this.breu,1).fillCircle(h,h,h).fillStyle(this.cone,1).fillCircle(h,h,h-rim*1.4));
    make(FX.cone,CONE_W,CONE_H,()=>g.fillStyle(this.amarelo,1).fillTriangle(2,CONE_H/2,CONE_W-2,2,CONE_W-2,CONE_H-2)
      .lineStyle(2.5,this.breu,1).strokeTriangle(2,CONE_H/2,CONE_W-2,2,CONE_W-2,CONE_H-2));
    make(FX.spot,SPOT_W,SPOT_H,()=>g.fillStyle(this.amarelo,1).fillEllipse(SPOT_W/2,SPOT_H/2,SPOT_W-4,SPOT_H-4)
      .lineStyle(2.5,this.breu,1).strokeEllipse(SPOT_W/2,SPOT_H/2,SPOT_W-4,SPOT_H-4));
  }
}
