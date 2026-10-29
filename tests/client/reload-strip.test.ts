// NEW-20261029-ORQ-animacoes-de-recarga: while a hero reloads (card pente-e-recarga: reloadUntil / reloadTicks), the
// weapon in hand plays its reload strip (render/reload-strip.ts), stretched over the reload, and is the icon again after.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {RELOAD_FRAMES,RELOAD_WEAPONS,hasReloadStrip,reloadFrame,reloadUrl} from '../../src/client/render/reload-strip.ts';
import {WEAPON_HOLD} from '../../src/client/sprites/hand-points.ts';

const sharp=createRequire(import.meta.url)('sharp');

test('every firearm with a hold has its strip: 16 square frames of the icon size, light on the download',async()=>{
  for(const icon of RELOAD_WEAPONS){
    assert.ok(WEAPON_HOLD[icon],`${icon}: no WEAPON_HOLD (the strip keeps the icon's grip)`);
    const file=`public${reloadUrl(icon)}`,meta=await sharp(file).metadata(),iconMeta=await sharp(`public/art/ui/${icon}.webp`).metadata();
    assert.equal(meta.height,iconMeta.height,`${icon}: frame side`);
    assert.equal(meta.width,meta.height!*RELOAD_FRAMES,`${icon}: ${RELOAD_FRAMES} square frames`);
    assert.ok(readFileSync(file).length<80_000,`${icon}: strip over 80 KB`);
  }
  assert.ok(!hasReloadStrip('pistola-dourada'),'the dourada edition keeps its icon');
});

test('the first and last frames are the icon (no jump when the reload starts or ends); the rocket starts as the bare stick',async()=>{
  for(const icon of RELOAD_WEAPONS){
    const strip=sharp(`public${reloadUrl(icon)}`),side=(await strip.metadata()).height!;
    const raw=async(s:any)=>(await s.ensureAlpha().raw().toBuffer()) as Buffer;
    const ref=await raw(sharp(`public/art/ui/${icon}.webp`));
    // The rojão's rocket went up with the last shot: its reload starts from the bare stick.
    for(const f of icon==='rojao'?[RELOAD_FRAMES-1]:[0,RELOAD_FRAMES-1]){
      const cell=await raw(sharp(`public${reloadUrl(icon)}`).extract({left:f*side,top:0,width:side,height:side}));
      let diff=0,n=0;
      for(let i=0;i<ref.length;i+=4)if(ref[i+3]>128||cell[i+3]>128){n++;if(Math.abs(ref[i+3]-cell[i+3])>96||Math.abs(ref[i]-cell[i])+Math.abs(ref[i+1]-cell[i+1])+Math.abs(ref[i+2]-cell[i+2])>90)diff++;}
      assert.ok(diff/n<.03,`${icon} frame ${f}: ${(100*diff/n).toFixed(1)} % of the icon differs`);
    }
  }
});

test('the strip runs over the whole reload at the frame rate, the view tick carried forward between views',()=>{
  // Pistola 1.0 s = 20 ticks, view at tick 100 when the reload began (until 120), seen at t=1000 ms.
  const r={until:120,ticks:20,tick:100,at:1000};
  assert.equal(reloadFrame(r,1000),0);
  assert.equal(reloadFrame(r,1000+500),RELOAD_FRAMES/2,'half the reload: half the strip');
  assert.equal(reloadFrame(r,1000+990),RELOAD_FRAMES-1);
  assert.equal(reloadFrame(r,1000+1000),undefined,'over: the icon');
  // A later view (tick 110) at t=1500: the same frame as carrying the first one forward.
  assert.equal(reloadFrame({...r,tick:110,at:1500},1500),RELOAD_FRAMES/2);
  // Frames never go backwards and visit every frame on a 2 s rocket reload at 60 fps.
  const rocket={until:40,ticks:40,tick:0,at:0},seen=new Set<number>();let last=-1;
  for(let t=0;t<2000;t+=1000/60){const f=reloadFrame(rocket,t)!;assert.ok(f>=last);last=f;seen.add(f);}
  assert.equal(seen.size,RELOAD_FRAMES);
  assert.equal(reloadFrame({...r,ticks:0},1000),undefined,'no length: the icon');
});

test('the arsenal draws the strip in the hand while the hero reloads, and the held look keeps its frames',()=>{
  const src=readFileSync('src/client/render/arsenal-fx.ts','utf8');
  assert.match(src,/p\.reloadUntil!==undefined&&p\.reloadUntil>view\.tick/);
  assert.match(src,/reloadFrame\(reload,now\)/);
  assert.match(src,/setTexture\(look,frame\)/);
  assert.match(src,/tex\.add\(name,0,f\.cutX/);
});
