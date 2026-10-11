import Phaser from 'phaser';
import {spriteCatalog} from './sprite-catalog.ts';
import {rotateVector} from './projection.ts';
import {SpriteMotion,SPRITE_CLIPS,type Motion} from './sprite-motion.ts';

/** Box of the drawn figure inside a 192 px frame (frame px): the union over the sheet's 18 frames. */
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
    const key=`sprite:${id}`;
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
  private states=new WeakMap<Phaser.GameObjects.Sprite,{motion:SpriteMotion;x:number;y:number}>();
  constructor(private scene:Phaser.Scene){}
  queue(id:string){
    if(!spriteCatalog[id]||this.requested.has(id))return;
    this.requested.add(id);
    if(this.scene.textures.exists(`sprite:${id}`)){this.measure(id);return;}
    // The figure box is read when the sheet arrives (loading time), never in the middle of a frame (review onda 4).
    this.scene.load.once(`filecomplete-spritesheet-sprite:${id}`,()=>this.measure(id));
    this.scene.load.once('complete',()=>this.measure(id));
    this.scene.load.spritesheet(`sprite:${id}`,`/art/sprites/${id}.webp`,{frameWidth:192,frameHeight:192});
  }
  animate(sprite:Phaser.GameObjects.Sprite,id:string,x:number,y:number,attackTick=0,alive=true,view=0){
    const key=`sprite:${id}`;
    if(!this.scene.textures.exists(key)){
      this.queue(id);if(!this.scene.load.isLoading()&&this.scene.load.list.size)this.scene.load.start();return;
    }
    if(sprite.texture.key!==key)sprite.setTexture(key,0).setOrigin(.5,.88).setScale(96/spriteCatalog[id].height);
    let state=this.states.get(sprite);
    if(!state){state={motion:new SpriteMotion(),x,y};this.states.set(sprite,state);}
    const dx=x-state.x,dy=y-state.y,moving=Math.hypot(dx,dy)>.001;
    const direction=rotateVector({x:dx,y:dy},view);
    if(Math.abs(direction.x-direction.y)>.001)sprite.setFlipX(direction.x-direction.y<0);
    const motion=state.motion.update(this.scene.time.now,moving,attackTick,alive);
    state.x=x;state.y=y;
    for(const name of Object.keys(SPRITE_CLIPS) as Motion[]){
      const clip=SPRITE_CLIPS[name];
      const animation=`${key}:${name}`;
      if(!this.scene.anims.exists(animation))this.scene.anims.create({key:animation,frames:this.scene.anims.generateFrameNumbers(key,{frames:[...clip.frames]}),frameRate:clip.frameRate,repeat:clip.repeat});
    }
    sprite.play(`${key}:${motion}`,true);
    if(!alive)sprite.anims.pause();else sprite.anims.resume();
  }
}
