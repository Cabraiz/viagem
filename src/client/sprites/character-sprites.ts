import Phaser from 'phaser';
import {spriteCatalog,type FigureBox} from './sprite-catalog.ts';
import {directionalSheets,type DirectionalSheet} from './sprite-sheets.ts';
import {spriteUrl} from './art-urls.ts';
import {SpriteMotion,SPRITE_CLIPS,FACINGS,FACING_FRAMES,FacingTracker,legacyFlip,type Motion,type Facing} from './sprite-motion.ts';

export type {FigureBox};
const MOTIONS=Object.keys(SPRITE_CLIPS) as Motion[];

/** Everything about one class's sheet that does not change per frame: keys, scale, figure, animation names. */
interface Sheet {
  key:string;
  directional?:DirectionalSheet;
  scale:number;
  figure?:FigureBox;
  /** Animation key per motion (single sheet) or per motion and facing (4-direction atlas); set once the texture is in. */
  single?:Record<Motion,string>;
  facing?:Record<Motion,Record<Facing,string>>;
}

export class CharacterSprites {
  /**
   * World px multiplier on every sheet's 96 px figure: framing.ts CITY_VIEW_SCALE in the city, so the hero draws ≈56 CSS
   * px (≈1 cell) under the city zoom (D-030); 1 on the island and the endless map. The next animate() applies a change.
   */
  viewScale=1;
  private requested=new Set<string>();
  private sheets=new Map<string,Sheet>();
  /** Fallback boxes measured from the texture (only a sheet the catalog does not measure; see measure()). */
  private measured=new Map<string,FigureBox|null>();
  private sheet(id:string):Sheet{
    let sheet=this.sheets.get(id);
    if(!sheet){
      const directional=directionalSheets.get(id),catalog=spriteCatalog[id];
      sheet={key:directional?`sprite:${id}:dir4`:`sprite:${id}`,directional,scale:96/(directional?.height??catalog?.height??96),figure:directional?directional.figure:catalog?.figure};
      this.sheets.set(id,sheet);
    }
    return sheet;
  }
  /**
   * Where the figure really is in its frame (alpha > 20), all animation frames (and facings) together, so the hero's
   * screen box is the character and not the frame's empty margin (UX-zonas-tela audit, follow camera). The importer
   * measures it into the catalog, so no pixels are read during a match.
   */
  figure(id:string):FigureBox|undefined{return this.sheet(id).figure??this.measured.get(id)??undefined;}
  /**
   * Fallback for a sheet without a catalog box: reads the pixels once, when the file arrives (load event, not the
   * frame loop). A 4-direction atlas is 1152×2304 (≈ 2.7 M pixels, tens of ms on a phone), hence the catalog.
   */
  private measure(id:string){
    const sheet=this.sheet(id);
    if(sheet.figure||this.measured.has(id)||!this.scene.textures.exists(sheet.key))return;
    let box:FigureBox|null=null;
    try{
      const image=this.scene.textures.get(sheet.key).getSourceImage() as CanvasImageSource&{width:number;height:number};
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(ctx){
        ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        let left=192,top=192,right=-1,bottom=-1;
        for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(data[(y*canvas.width+x)*4+3]>20){
          const fx=x%192,fy=y%192;if(fx<left)left=fx;if(fx>right)right=fx;if(fy<top)top=fy;if(fy>bottom)bottom=fy;
        }
        if(right>=left)box={left,top,right:right+1,bottom:bottom+1};
      }
    }catch{box=null;}
    this.measured.set(id,box);
  }
  private states=new WeakMap<Phaser.GameObjects.Sprite,{motion:SpriteMotion;facing:FacingTracker;x:number;y:number;shown?:Motion;side?:Facing}>();
  constructor(private scene:Phaser.Scene){}
  queue(id:string){
    if(!spriteCatalog[id]||this.requested.has(id))return;
    this.requested.add(id);
    const {key,directional}=this.sheet(id);
    if(this.scene.textures.exists(key)){this.measure(id);return;}
    // The figure box is read when the sheet arrives (loading time), never in the middle of a frame (review onda 4).
    this.scene.load.once(`filecomplete-spritesheet-${key}`,()=>this.measure(id));
    this.scene.load.once('complete',()=>this.measure(id));
    this.scene.load.spritesheet(key,directional?.url??spriteUrl(id),{frameWidth:192,frameHeight:192});
  }
  /** Creates the class's animations once and keeps their keys (no string building or lookups per frame). */
  private animations(sheet:Sheet){
    const make=(name:Motion,key:string,offset:number)=>{
      const clip=SPRITE_CLIPS[name];
      if(!this.scene.anims.exists(key))this.scene.anims.create({key,frames:this.scene.anims.generateFrameNumbers(sheet.key,{frames:clip.frames.map(f=>f+offset)}),frameRate:clip.frameRate,repeat:clip.repeat});
      return key;
    };
    if(sheet.directional){
      const all={} as Record<Motion,Record<Facing,string>>;
      for(const name of MOTIONS){all[name]={} as Record<Facing,string>;FACINGS.forEach((f,i)=>{all[name][f]=make(name,`${sheet.key}:${name}:${f}`,i*FACING_FRAMES);});}
      sheet.facing=all;
    }else{
      const all={} as Record<Motion,string>;
      for(const name of MOTIONS)all[name]=make(name,`${sheet.key}:${name}`,0);
      sheet.single=all;
    }
  }
  /**
   * `intent` (local hero only): the world direction the hero is sent to walk this step (joystick or route), so its
   * drawing never turns on a reconciliation snap; remote figures leave it out and turn by their displacement.
   */
  animate(sprite:Phaser.GameObjects.Sprite,id:string,x:number,y:number,attackTick=0,alive=true,view=0,intent?:{x:number;y:number}){
    const sheet=this.sheet(id);
    if(!this.scene.textures.exists(sheet.key)){
      this.queue(id);if(!this.scene.load.isLoading()&&this.scene.load.list.size)this.scene.load.start();return;
    }
    if(!sheet.single&&!sheet.facing)this.animations(sheet);
    const scale=sheet.scale*this.viewScale;
    if(sprite.texture.key!==sheet.key){
      sprite.setTexture(sheet.key,0).setOrigin(.5,.88).setScale(scale);
      // A 4-direction atlas draws its left side itself: no mirror (single sheets keep the flip they had).
      if(sheet.directional)sprite.setFlipX(false);
    }else if(sprite.scaleX!==scale||sprite.scaleY!==scale)sprite.setScale(scale);
    let state=this.states.get(sprite);
    if(!state){state={motion:new SpriteMotion(),facing:new FacingTracker(),x,y};this.states.set(sprite,state);}
    const dx=x-state.x,dy=y-state.y,moving=Math.hypot(dx,dy)>.001;
    const motion=state.motion.update(this.scene.time.now,moving,attackTick,alive);
    state.x=x;state.y=y;
    if(sheet.facing){
      // Remote allies come here with their interpolated positions, so their facing follows the interpolated velocity.
      const facing=state.facing.update(dx,dy,view,intent);
      // A turn in the middle of a clip keeps its progress: the walk cycle or the swing goes on in the new drawing.
      const turning=state.shown===motion&&state.side!==facing;
      const progress=turning?sprite.anims.getProgress():0;
      sprite.play(sheet.facing[motion][facing],true);
      if(turning)sprite.anims.setProgress(progress);
      state.shown=motion;state.side=facing;
    }else{
      sprite.setFlipX(legacyFlip(sprite.flipX,dx,dy,view));
      sprite.play(sheet.single![motion],true);
    }
    if(!alive)sprite.anims.pause();else sprite.anims.resume();
  }
}
