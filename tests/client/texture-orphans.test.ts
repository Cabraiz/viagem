import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {rehomeOrphans,watchOrphans} from '../../src/client/sprites/texture-orphans.ts';
import {bareFrameOf,setBareFrame} from '../../src/client/render/silhouette.ts';

/** A Phaser-like object: its frame dies with its texture (Frame.destroy nulls `data`, read by realWidth → sourceSize). */
class Shown {
  texture:{key:string};frame:{name:string;data:{sourceSize:{w:number}}|null};originX=.5;originY=.5;scaleX=1;scaleY=1;stopped=0;
  anims={stop:()=>{this.stopped++;}};
  constructor(key:string,frame='3'){this.texture={key};this.frame={name:frame,data:{sourceSize:{w:96}}};}
  get displayWidth(){return this.scaleX*this.frame.data!.sourceSize.w;}
  setTexture(key:string,frame:string|number='0'){this.texture={key};this.frame={name:String(frame),data:{sourceSize:{w:96}}};return this;}
  setOrigin(x:number,y:number){this.originX=x;this.originY=y;return this;}
  setScale(x:number,y:number){this.scaleX=x;this.scaleY=y;return this;}
}
function scene(keys:string[]){
  const textures=Object.assign(new EventEmitter(),{have:new Set(keys),exists(key:string){return this.have.has(key);},
    remove(key:string){this.have.delete(key);for(const o of list)if((o as Shown).texture.key===key)(o as Shown).frame.data=null;this.emit('removetexture',key);}});
  const list:unknown[]=[];
  return {textures,children:{list},events:new EventEmitter()};
}

test('a removed texture leaves no object on its dead frame: a city copy goes back to its bare sheet, else to the blank',()=>{
  const s=scene(['sprite128:x:walk:S','sprite128:x:walk:S:cidade:1','other']);
  const hero=new Shown('sprite128:x:walk:S:cidade:1','7'),silhouette=new Shown('sprite128:x:walk:S:cidade:1','7'),other=new Shown('other');
  s.children.list.push(hero,silhouette,other);
  setBareFrame(hero as never,{key:'sprite128:x:walk:S',ox:.5,oy:.8,sx:1.2,sy:1.2});
  watchOrphans(s as never);watchOrphans(s as never);
  assert.equal(s.textures.listenerCount('removetexture'),1,'one watch per scene');
  s.textures.remove('sprite128:x:walk:S:cidade:1');
  assert.deepEqual([hero.texture.key,hero.frame.name,hero.originX,hero.originY,hero.scaleX],['sprite128:x:walk:S','7',.5,.8,1.2]);
  assert.equal(bareFrameOf(hero as never),undefined,'the bare frame is the texture shown now');
  assert.equal(silhouette.texture.key,'__DEFAULT','no bare sheet: the blank until its next update');
  assert.equal(hero.stopped,1);assert.equal(other.texture.key,'other');
  for(const o of [hero,silhouette,other])assert.doesNotThrow(()=>o.displayWidth,'nothing reads sourceSize on a dead frame');
  s.textures.remove('sprite128:x:walk:S');assert.equal(hero.texture.key,'__DEFAULT');assert.doesNotThrow(()=>hero.displayWidth);
  s.events.emit('shutdown');assert.equal(s.textures.listenerCount('removetexture'),0,'released with the scene');
  watchOrphans(s as never);assert.equal(s.textures.listenerCount('removetexture'),1,'a restarted scene watches again');
});

test('without the watch the same removal is the CI pageerror (reading sourceSize of a destroyed frame)',()=>{
  const s=scene(['copy']),hero=new Shown('copy');s.children.list.push(hero);
  s.textures.remove('copy');assert.throws(()=>hero.displayWidth,/sourceSize/);
  rehomeOrphans(s as never,'copy');assert.doesNotThrow(()=>hero.displayWidth);
});
