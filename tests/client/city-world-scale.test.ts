// City figures' scale beyond the actors (cidade-04): the caído's light column, the Stonewards structures' bars and the
// kill-cam keep their endless-map CSS size under the city zoom when drawn with CITY_VIEW_SCALE; 1 changes nothing.
// Results only (D-031): no time or memory limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CITY_VIEW_SCALE,cityZoom,followZoom} from '../../src/client/framing.ts';
import {COLUMN,columnSize} from '../../src/client/render/downed-rules.ts';
import {STRUCTURE_BAR_GAP_CSS,STRUCTURE_TOP,structureBarY} from '../../src/client/render/stonewards-rules.ts';
import {killcamBoxes,killcamFrame,type KillcamInput} from '../../src/client/render/killcam-rules.ts';
import {ENEMY_ART} from '../../src/client/render/keys.ts';

const PHONES=[{width:390,height:844},{width:844,height:390},{width:430,height:932}];
const close=(a:number,b:number,what:string)=>assert.ok(Math.abs(a-b)<1e-6,`${what}: ${a} vs ${b}`);

test('caído light column: scale 1 is the old column; in the city it draws the endless CSS size', ()=>{
  assert.deepEqual(columnSize(),{height:COLUMN.height,width:COLUMN.width});
  assert.deepEqual(columnSize(1),columnSize());
  for(const v of PHONES){
    const city=columnSize(CITY_VIEW_SCALE),zc=cityZoom(v),ze=followZoom(v);
    close(city.height*zc,COLUMN.height*ze,`column height CSS px ${v.width}x${v.height}`);
    close(city.width*zc,COLUMN.width*ze,`column width CSS px ${v.width}x${v.height}`);
  }
});

test('Stonewards bars: scale 1 keeps the old place; in the city they hang the endless CSS distance over the feet', ()=>{
  for(const css of [1,1/.58,1/1.07])for(const feet of [0,431.5,-207.25]){
    assert.equal(structureBarY('muralha',feet,css),feet-100-12*css);
    assert.equal(structureBarY('torre',feet,css,1),feet-66-8*css);
  }
  for(const v of PHONES)for(const kind of ['muralha','torre'] as const){
    const zc=cityZoom(v),ze=followZoom(v);
    const city=(0-structureBarY(kind,0,1/zc,CITY_VIEW_SCALE))*zc,endless=(0-structureBarY(kind,0,1/ze))*ze;
    close(city,endless,`${kind} bar lift CSS px ${v.width}x${v.height}`);
    // The gap over the art stays a fixed CSS gap in both worlds.
    close(city-STRUCTURE_TOP[kind]*CITY_VIEW_SCALE*zc,STRUCTURE_BAR_GAP_CSS[kind],`${kind} gap`);
  }
});

test('kill-cam: the city frames its art-size copy exactly as the endless map does; no scale is scale 1', ()=>{
  const tvs=[{width:100,height:76},{width:82,height:64},{width:160,height:220}];
  for(const v of PHONES)for(const tv of tvs)for(const kind of ['bebado','pombos','agiota','chefe'] as const)for(const t of [0,.2,.45,.7]){
    const art=ENEMY_ART[kind],base={tv,art,feet:{x:120,y:-340},t,reduced:false,pop:{width:180,height:36}};
    const endless:KillcamInput={...base,mainZoom:followZoom(v)},city:KillcamInput={...base,mainZoom:cityZoom(v),actorScale:CITY_VIEW_SCALE};
    const fe=killcamFrame(endless),fc=killcamFrame(city);
    close(fc.zoom,fe.zoom,`zoom ${kind} ${tv.width}x${tv.height}`);
    close(fc.arc,fe.arc,`arc ${kind}`);
    const be=killcamBoxes(endless,fe),bc=killcamBoxes(city,fc);
    for(const side of ['left','right','top','bottom'] as const)close(bc.ghost[side],be.ghost[side],`ghost ${side} on the TV`);
    assert.deepEqual(killcamFrame({...endless,actorScale:1}),fe);
  }
});
