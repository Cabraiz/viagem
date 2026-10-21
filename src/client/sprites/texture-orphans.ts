/**
 * BUG-20261021-E8-sourcesize-null: a texture removed while a game object still shows it leaves that object on a
 * destroyed Frame (Frame.data null). The next read of its size (getBounds/displayWidth in movement128Visible, the
 * renderer) throws "reading 'sourceSize'" inside Phaser's step, and the game loop stops for good (the scene froze).
 * Streamed clips (Movement128Textures' LRU) and city copies (CityOutlines: a zoom change retires every copy) are
 * removed while a figure can still hold them: a pose held while the next clip decodes, a figure waiting off camera,
 * a hidden one whose lease was swept, and the silhouettes that copy their frame. On removal, every object of the
 * scene still on that texture moves to its bare sheet (a city copy's base, same frame names) or to Phaser's blank
 * '__DEFAULT' until its next update draws it again.
 */
import type Phaser from 'phaser';
import {bareFrameOf,setBareFrame} from '../render/silhouette.ts';

type Shown=Phaser.GameObjects.Image|Phaser.GameObjects.Sprite;
interface Scene {textures?:{on?(event:string,fn:(key:string)=>void):unknown;off?(event:string,fn:(key:string)=>void):unknown;exists(key:string):boolean};
  children?:{list:unknown[]};events?:{once(event:string,fn:()=>void):unknown;off?(event:string,fn:()=>void):unknown}}

/** Moves the scene's objects off texture `key` (just removed). Exported for the unit test. */
export function rehomeOrphans(scene:Scene,key:string){
  for(const child of scene.children?.list??[]){
    const o=child as Shown;
    if(o.texture?.key!==key)continue;
    // Their animation's frames went with the texture (CityOutlines drop removes them too): nothing to resume.
    (o as Phaser.GameObjects.Sprite).anims?.stop();
    const name=o.frame?.name,bare=bareFrameOf(o);
    if(bare&&bare.key!==key&&scene.textures?.exists(bare.key)){
      o.setTexture(bare.key,name).setOrigin(bare.ox,bare.oy).setScale(bare.sx,bare.sy);setBareFrame(o,undefined);
    }else o.setTexture('__DEFAULT');
  }
}

const watched=new WeakSet<Scene>();
/** Keeps `scene`'s objects off removed textures until it shuts down (call it every update: a restart watches again). */
export function watchOrphans(scene:Scene){
  const textures=scene.textures;
  if(watched.has(scene)||!textures?.on)return;
  watched.add(scene);
  const on=(key:string)=>rehomeOrphans(scene,key);
  textures.on('removetexture',on);
  const stop=()=>{watched.delete(scene);textures.off?.('removetexture',on);scene.events?.off?.('shutdown',stop);scene.events?.off?.('destroy',stop);};
  scene.events?.once('shutdown',stop);scene.events?.once('destroy',stop);
}
