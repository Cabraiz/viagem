/**
 * BUG-20261013-ORQ-balao-ultimo-bicho-sem-imagem: the "Último bicho!" card shows the critter's own portrait (its roster
 * id's imported art, never its base kind's), and no frame at all when there is no picture or it fails to load.
 */
import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setArtIndex,parseArtIndex} from '../../src/client/art/manifest.ts';
import {critterIconSource,critterSheetFrame} from '../../src/client/art/hud-art.ts';
import {showPortrait,type PortraitImage} from '../../src/client/hud/killcam.ts';

const EMPTY={version:2,groups:{}};
afterEach(()=>setArtIndex(parseArtIndex(EMPTY)));
const anim=(id:string,name:string,cell:[number,number],frames:number)=>({file:`${id}/${name}.webp`,cell,frames,directions:8,anchor:[.5,.88],
  pages:[{file:`${id}/${name}.webp`,columns:frames,rows:8,firstFrame:0,frameCount:frames*8}]});
const ART={version:2,groups:{inimigos:{output:'public/art/enemies',pieces:{
  'rato-de-boteco':{kind:'animations',files:{walk:anim('rato-de-boteco','walk',[64,64],6),attack:anim('rato-de-boteco','attack',[64,64],4)}},
  bebado:{kind:'animations',files:{idle:anim('bebado','idle',[96,96],4)}},
}}}};

test('a roster id with its own art: its still frame (walk when it has no idle), row S, from the lite copy',()=>{
  setArtIndex(parseArtIndex(ART));
  const s=critterIconSource('rato-de-boteco');
  assert.ok(s&&'key' in s&&s.frame===0,JSON.stringify(s));
  assert.deepEqual(critterSheetFrame('rato-de-boteco'),{url:'/art/lite/enemies/rato-de-boteco/walk.webp',cell:[64,64],col:0,row:0,columns:6,rows:8});
  assert.equal(critterSheetFrame('bebado')?.url,'/art/lite/enemies/bebado/idle.webp','a legacy kind keeps its own art');
});
test('no art of its own → no picture (a roster id never borrows its base kind\'s art; unknown ids have none)',()=>{
  setArtIndex(parseArtIndex(ART));
  for(const id of ['marronzinho','sem-arte','bichos']){assert.equal(critterIconSource(id),undefined,id);assert.equal(critterSheetFrame(id),undefined,id);}
  setArtIndex(parseArtIndex(EMPTY));
  assert.equal(critterSheetFrame('rato-de-boteco'),undefined);
});

const fakeImg=()=>{
  const img:PortraitImage&{removed:boolean}={src:'',complete:false,naturalWidth:0,onload:null,onerror:null,removed:false,
    removeAttribute(){img.src='';img.removed=true;}};
  return img;
};
test('portrait frame: none without a picture; shown only after the picture loads; a failing load removes it',()=>{
  const frame={hidden:false},img=fakeImg();
  showPortrait(frame,img,undefined);
  assert.equal(frame.hidden,true,'no picture → no frame');assert.ok(img.removed);
  showPortrait(frame,img,'data:image/png;base64,AAAA');
  assert.equal(img.src,'data:image/png;base64,AAAA');assert.equal(frame.hidden,true,'never an empty frame while it loads');
  img.onload?.();assert.equal(frame.hidden,false);
  showPortrait(frame,img,'/art/lite/enemies/x/walk.webp');
  assert.equal(frame.hidden,true);img.onerror?.();assert.equal(frame.hidden,true,'a 404 never leaves an empty frame');
  // A picture already in the cache shows at once.
  const cached={...fakeImg(),complete:true,naturalWidth:64},f2={hidden:true};
  showPortrait(f2,cached,'a.webp');assert.equal(f2.hidden,false);
  // The next critter without a picture hides the frame again and drops the old load handlers.
  showPortrait(f2,cached,undefined);assert.equal(f2.hidden,true);assert.equal(cached.onload,null);assert.equal(cached.onerror,null);
});
