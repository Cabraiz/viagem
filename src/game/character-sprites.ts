import Phaser from 'phaser';
import {spriteCatalog} from './sprite-catalog.ts';
import {SpriteMotion} from './sprite-motion.ts';

export class CharacterSprites {
  private requested=new Set<string>();
  private states=new WeakMap<Phaser.GameObjects.Sprite,{motion:SpriteMotion;x:number;y:number}>();
  constructor(private scene:Phaser.Scene){}
  queue(id:string){
    if(!spriteCatalog[id]||this.requested.has(id)||this.scene.textures.exists(`sprite:${id}`))return;
    this.requested.add(id);
    this.scene.load.spritesheet(`sprite:${id}`,`/art/sprites/${id}.webp`,{frameWidth:192,frameHeight:192});
  }
  animate(sprite:Phaser.GameObjects.Sprite,id:string,x:number,y:number,attackTick=0,alive=true){
    const key=`sprite:${id}`;
    if(!this.scene.textures.exists(key)){
      this.queue(id);if(!this.scene.load.isLoading()&&this.scene.load.list.size)this.scene.load.start();return;
    }
    if(sprite.texture.key!==key)sprite.setTexture(key,0).setOrigin(.5,.88).setScale(96/spriteCatalog[id].height);
    let state=this.states.get(sprite);
    if(!state){state={motion:new SpriteMotion(),x,y};this.states.set(sprite,state);}
    const dx=x-state.x,dy=y-state.y,moving=Math.hypot(dx,dy)>.001;
    if(Math.abs(dx-dy)>.001)sprite.setFlipX(dx-dy<0);
    const motion=state.motion.update(this.scene.time.now,moving,attackTick,alive);
    state.x=x;state.y=y;
    for(const [name,start,rate,repeat] of [['idle',0,6,-1],['walk',6,10,-1],['attack',12,12,0]] as const){
      const animation=`${key}:${name}`;
      if(!this.scene.anims.exists(animation))this.scene.anims.create({key:animation,frames:this.scene.anims.generateFrameNumbers(key,{start,end:start+5}),frameRate:rate,repeat});
    }
    sprite.play(`${key}:${motion}`,true);
    if(!alive)sprite.anims.pause();else sprite.anims.resume();
  }
}
