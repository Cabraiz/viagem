import Phaser from 'phaser';
import {spriteCatalog} from './sprite-catalog.ts';
import {rotateVector} from './projection.ts';
import {SpriteMotion,SPRITE_CLIPS,type Motion} from './sprite-motion.ts';

export class CharacterSprites {
  private requested=new Set<string>();
  private states=new WeakMap<Phaser.GameObjects.Sprite,{motion:SpriteMotion;x:number;y:number}>();
  constructor(private scene:Phaser.Scene){}
  queue(id:string){
    if(!spriteCatalog[id]||this.requested.has(id)||this.scene.textures.exists(`sprite:${id}`))return;
    this.requested.add(id);
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
