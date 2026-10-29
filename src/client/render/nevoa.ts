/**
 * Card jogo-mais-escuro, the user's fog (render/nevoa-rules.ts): a light haze drifting slowly, faint wind bands running
 * across, ash falling, all three camera-fixed at NEVOA_DEPTH and drawn with the fog pipeline (exposure-pipeline.ts), so
 * they fade out around the hero; the world's colours go cold sepia through the default pipeline. Textures from ChatGPT
 * (public/art/nevoa/, white on alpha, tinted here), loaded once the map shows fog. Economy mode keeps the haze only;
 * `?nevoa=0..3` compares the levels, `?luz=0` turns it off.
 */
import Phaser from 'phaser';
import {NEVOA_PIPELINE,setFuro,setSepia} from './exposure-pipeline.ts';
import {NEVOA_DEPTH,NEVOA_LEVELS,WIND,nevoaFor,windScale,type NevoaLevel} from './nevoa-rules.ts';
import type {LightWorld} from './light.ts';

const HAZE='nevoa:haze',BANDS='nevoa:vento',ASH='nevoa:cinza';
const URL={[HAZE]:'/art/nevoa/haze.webp',[BANDS]:'/art/nevoa/vento.webp',[ASH]:'/art/nevoa/cinza.webp'} as const;
/** One tile across this many screen px (the texture is 1024 px): big soft shapes, the bands a bit tighter. */
const HAZE_SPAN=900,BANDS_SPAN=860,ASH_CELL=128,ASH_PX=[4,9] as const;
/** The haze a touch warm, the bands lighter (the board's fog 4 colour), the ash dark grey (it reads on the snow). */
const HAZE_TINT=0xcfcac2,BANDS_TINT=0xffffff,ASH_TINT=0x6f685f;

export interface NevoaOptions {reduced:boolean;hero:()=>{x:number;y:number}|undefined}

export class Nevoa {
  private level:NevoaLevel=NEVOA_LEVELS[0]!;
  private economy=false;
  private haze?:Phaser.GameObjects.TileSprite;
  private bands?:Phaser.GameObjects.TileSprite;
  private ash?:Phaser.GameObjects.Particles.ParticleEmitter;
  private loading=false;
  private drift=[0,0,0,0];
  /** Where the ash is born (local to the emitter at the screen centre) and the zoom its flakes are sized for. */
  private ashZone=new Phaser.Geom.Rectangle(0,0,1,1);
  private zoom=1;
  /** The ash starts as if it had been falling already (once its zone covers the screen). */
  private ashWarm=false;
  constructor(private scene:Phaser.Scene,private options:NevoaOptions){}
  /** Screen-space objects: a second camera (the Uno's live window, chaveiro/pip.ts) ignores them. */
  get objects():Phaser.GameObjects.GameObject[]{return [this.haze,this.bands,this.ash].filter(o=>!!o);}
  /** The map's level (and the sepia grade with it); economy mode drops the bands and the ash. */
  set(world:LightWorld,economy:boolean){
    this.level=NEVOA_LEVELS[nevoaFor(world)]!;this.economy=economy;
    setSepia(this.level.sepia);
    if(this.level.haze>0)this.load();
    this.show();
  }
  private load(){
    if(this.loading)return;this.loading=true;
    const scene=this.scene,load=scene.load;
    const need=([HAZE,BANDS,ASH] as const).filter(k=>!scene.textures.exists(k));
    if(!need.length){this.build();return;}
    for(const k of need){
      if(k===ASH)load.spritesheet(k,URL[k],{frameWidth:ASH_CELL,frameHeight:ASH_CELL});else load.image(k,URL[k]);
    }
    const done=()=>{if(need.every(k=>scene.textures.exists(k)))this.build();};
    for(const k of need)load.once(`filecomplete-${k===ASH?'spritesheet':'image'}-${k}`,done);
    if(!load.isLoading())load.start();
  }
  private build(){
    if(this.haze||!this.scene.sys.isActive())return;
    const add=this.scene.add,tile=(key:string,tint:number,depth:number)=>add.tileSprite(0,0,16,16,key).setOrigin(.5).setScrollFactor(0)
      .setDepth(depth).setTint(tint).setPipeline(NEVOA_PIPELINE).setVisible(false);
    this.haze=tile(HAZE,HAZE_TINT,NEVOA_DEPTH);
    this.bands=tile(BANDS,BANDS_TINT,NEVOA_DEPTH+1);
    const [vx,vy]=WIND.ashFall,k=windScale(this.options.reduced);
    this.ash=add.particles(0,0,ASH,{frame:[...Array(16).keys()],lifespan:9000,speedX:{min:vx*k*.6,max:vx*k*1.4},speedY:{min:vy*k*.7,max:vy*k*1.3},
      rotate:{min:0,max:360},scale:{onEmit:()=>Phaser.Math.FloatBetween(ASH_PX[0],ASH_PX[1])/32/this.zoom},
      emitZone:{type:'random',source:this.ashZone} as Phaser.Types.GameObjects.Particles.EmitZoneData,alpha:{start:.75,end:0,ease:'Quad.easeIn'},tint:ASH_TINT,emitting:false})
      .setScrollFactor(0).setDepth(NEVOA_DEPTH+2).setPipeline(NEVOA_PIPELINE).setVisible(false);
    this.show();
  }
  private show(){
    const l=this.level,on=l.haze>0;
    this.haze?.setVisible(on).setAlpha(l.haze);
    this.bands?.setVisible(on&&!this.economy&&l.bands>0).setAlpha(l.bands);
    if(this.ash){
      const ash=on&&!this.economy&&l.ash>0;
      this.ash.setVisible(ash);
      if(ash){this.ash.maxAliveParticles=l.ash;this.ash.frequency=9000/l.ash;if(!this.ash.emitting){this.ash.start();this.ashWarm=false;}}else this.ash.stop(true);
    }
    if(!on)setFuro(-1e4,-1e4,0,0,1);
  }
  /** Every frame: cover the camera (scroll factor 0 still zooms around the centre), drift, hole on the hero. */
  update(delta:number){
    const haze=this.haze;if(!haze?.visible)return;
    const scene=this.scene,cam=scene.cameras.main,z=cam.zoom||1,w=cam.width/z,h=cam.height/z,v=cam.worldView;
    const k=windScale(this.options.reduced)*delta/1000/z,d=this.drift;
    d[0]!+=WIND.haze[0]*k;d[1]!+=WIND.haze[1]*k;d[2]!+=WIND.bands[0]*k;d[3]!+=WIND.bands[1]*k;
    // Anchored to the world (the camera's scroll moves them as it moves the street), plus the wind on top.
    const place=(t:Phaser.GameObjects.TileSprite,span:number,dx:number,dy:number)=>{
      const s=span/1024/z;
      t.setPosition(cam.width/2,cam.height/2).setSize(w,h).setTileScale(s,s);
      t.tilePositionX=(v.x-dx)/s;t.tilePositionY=(v.y-dy)/s;
    };
    place(haze,HAZE_SPAN,d[0]!,d[1]!);
    if(this.bands?.visible)place(this.bands,BANDS_SPAN,d[2]!,d[3]!);
    const ash=this.ash;
    if(ash?.visible){
      // Born above and left of the screen too (they fall right and down), anywhere across it; a flake is ~32 px of its 128 px cell.
      ash.setPosition(cam.width/2,cam.height/2);this.ashZone.setTo(-w/2-w*.15,-h/2-h*.2,w*1.15,h*1.1);this.zoom=z;
      if(!this.ashWarm){this.ashWarm=true;ash.fastForward(9000,100);}
    }
    // The hole: the hero's chest in framebuffer pixels (origin bottom left), radii from the screen's short side.
    const r=scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer,ratio=r.width/scene.scale.width,hero=this.options.hero();
    if(!hero){setFuro(-1e4,-1e4,0,0,1);return;}
    const sx=((hero.x-v.x)*z+cam.x)*ratio,sy=((hero.y-v.y)*z+cam.y)*ratio,short=Math.min(cam.width,cam.height)*ratio;
    setFuro(sx,r.height-sy,this.level.clear[0]*short,this.level.clear[1]*short,this.level.floor);
  }
}
