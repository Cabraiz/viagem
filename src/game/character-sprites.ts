import Phaser from 'phaser';
import {spriteCatalog} from './sprite-catalog.ts';
import {directionalSheets,sheetKey} from './sprite-sheets.ts';
import {SpriteMotion,SPRITE_CLIPS,FACINGS,FACING_FRAMES,FacingTracker,legacyFlip,type Motion,type Facing} from './sprite-motion.ts';

/** Box of the drawn figure inside a 192 px frame (frame px): the union over the sheet's frames (all 4 facings). */
export interface FigureBox {left:number;top:number;right:number;bottom:number}

export class CharacterSprites {
  private requested=new Set<string>();
  private figures=new Map<string,FigureBox|null>();
  /**
   * Where the figure really is in its frame (alpha > 20), all animation frames together, so the hero's screen box is
   * the character and not the frame's empty margin (UX-zonas-tela audit, follow camera). Read once per class.
   */
  figure(id:string):FigureBox|undefined{return this.figures.get(id)??undefined;}
  private measure(id:string){
    const key=sheetKey(id);
    if(this.figures.has(id)||!this.scene.textures.exists(key))return;
    let box:FigureBox|null=null;
    try{
      const image=this.scene.textures.get(key).getSourceImage() as CanvasImageSource&{width:number;height:number};
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
    this.figures.set(id,box);
  }
  private states=new WeakMap<Phaser.GameObjects.Sprite,{motion:SpriteMotion;facing:FacingTracker;x:number;y:number}>();
  constructor(private scene:Phaser.Scene){}
  queue(id:string){
    if(!spriteCatalog[id]||this.requested.has(id))return;
    this.requested.add(id);
    const key=sheetKey(id);
    if(this.scene.textures.exists(key)){this.measure(id);return;}
    // The figure box is read when the sheet arrives (loading time), never in the middle of a frame (review onda 4).
    this.scene.load.once(`filecomplete-spritesheet-${key}`,()=>this.measure(id));
    this.scene.load.once('complete',()=>this.measure(id));
    this.scene.load.spritesheet(key,directionalSheets.get(id)?.url??`/art/sprites/${id}.webp`,{frameWidth:192,frameHeight:192});
  }
  animate(sprite:Phaser.GameObjects.Sprite,id:string,x:number,y:number,attackTick=0,alive=true,view=0){
    const key=sheetKey(id),directional=directionalSheets.get(id);
    if(!this.scene.textures.exists(key)){
      this.queue(id);if(!this.scene.load.isLoading()&&this.scene.load.list.size)this.scene.load.start();return;
    }
    if(sprite.texture.key!==key){
      sprite.setTexture(key,0).setOrigin(.5,.88).setScale(96/(directional?.height??spriteCatalog[id].height));
      // A 4-direction atlas draws its left side itself: no mirror (single sheets keep the flip they had).
      if(directional)sprite.setFlipX(false);
    }
    let state=this.states.get(sprite);
    if(!state){state={motion:new SpriteMotion(),facing:new FacingTracker(),x,y};this.states.set(sprite,state);}
    const dx=x-state.x,dy=y-state.y,moving=Math.hypot(dx,dy)>.001;
    // Remote allies come here with their interpolated positions, so their facing follows the interpolated velocity.
    const facing:Facing|undefined=directional?state.facing.update(dx,dy,view):undefined;
    if(!directional)sprite.setFlipX(legacyFlip(sprite.flipX,dx,dy,view));
    const motion=state.motion.update(this.scene.time.now,moving,attackTick,alive);
    state.x=x;state.y=y;
    for(const name of Object.keys(SPRITE_CLIPS) as Motion[])for(const block of directional?FACINGS:[undefined]){
      const clip=SPRITE_CLIPS[name],offset=block?FACINGS.indexOf(block)*FACING_FRAMES:0;
      const animation=block?`${key}:${name}:${block}`:`${key}:${name}`;
      if(!this.scene.anims.exists(animation))this.scene.anims.create({key:animation,frames:this.scene.anims.generateFrameNumbers(key,{frames:clip.frames.map(f=>f+offset)}),frameRate:clip.frameRate,repeat:clip.repeat});
    }
    const animation=facing?`${key}:${motion}:${facing}`:`${key}:${motion}`;
    // A turn in the middle of a clip keeps its progress: the walk cycle or the swing goes on in the new drawing.
    const current=sprite.anims.currentAnim,turning=!!facing&&!!current&&current.key!==animation&&current.key.startsWith(`${key}:${motion}:`);
    const progress=turning?sprite.anims.getProgress():0;
    sprite.play(animation,true);
    if(turning)sprite.anims.setProgress(progress);
    if(!alive)sprite.anims.pause();else sprite.anims.resume();
  }
}
