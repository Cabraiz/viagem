// cidade-borda-e-quadras · beyond the map edge: snow sinking into Breu fog (choice (b)), and the island/endless untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {CityAsset} from '../../src/client/render/city/asset.ts';
import {FOG_RINGS,FOG_RING_CELLS,FOG_SEGMENT_CELLS,borderFog,fogColor} from '../../src/client/render/city/border-fog.ts';
import {CITY_PALETTE,GROUND_COLORS,OUTSIDE_CITY,luminance} from '../../src/client/render/city/palette.ts';
import {VIEW_PIVOT,project,unproject} from '../../src/client/render/city/projection.ts';

const W=40,H=24,CELL=0.88;
const heights=Array.from({length:W*H},(_,i)=>(i%W)%7===0?1.5:0.9);
const corners=Array.from({length:(W+1)*(H+1)},(_,i)=>((i%(W+1))*3+Math.floor(i/(W+1)))%5*0.2+0.9);
const asset:CityAsset={version:1,name:'fog',cell:CELL,width:W,height:H,origin:{x:0,y:0},heights,corners,ground:'s'.repeat(W*H),blocks:[],props:[],points:{}};
const flat:CityAsset={...asset,heights:new Array(W*H).fill(0.9),corners:undefined};
const contrast=(a:number,b:number)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};

test('fog colours: darker ring by ring, the last one exactly the background beyond, the first never reads as walkable ground',()=>{
  let prev=Infinity;
  for(let k=0;k<FOG_RINGS;k++){const l=luminance(fogColor(k));assert.ok(l<prev,`ring ${k} darker`);prev=l;}
  assert.equal(fogColor(FOG_RINGS-1),OUTSIDE_CITY);
  // Ring 0 against every walkable ground (snow, streets, ice, plaza): a clear step, 1.5:1 or more.
  for(const kind of ['snow','packed','ice','cobble'] as const)
    assert.ok(contrast(fogColor(0),GROUND_COLORS[kind].base)>=1.5,`${kind} ${contrast(fogColor(0),GROUND_COLORS[kind].base).toFixed(2)}`);
  assert.ok(luminance(fogColor(0))>luminance(CITY_PALETTE.breu),'still snow, not black, at the wall');
});

test('fog geometry: 4 sides × segments, FOG_RINGS rings each, every point outside the map, the ring band closed at the corners (all views)',()=>{
  for(const view of [0,1,2,3]){
    const parts=borderFog(flat,view);
    assert.equal(parts.length,2*Math.ceil(W/FOG_SEGMENT_CELLS)+2*Math.ceil(H/FOG_SEGMENT_CELLS));
    let area=0;
    for(const part of parts){
      assert.equal(part.length,FOG_RINGS);
      part.forEach((q,k)=>{
        assert.equal(q.color,fogColor(k));
        // Shoelace area in screen px: a real polygon.
        let a=0;for(let i=0;i<q.points.length;i++){const p=q.points[i],n=q.points[(i+1)%q.points.length];a+=p.x*n.y-n.x*p.y;}
        assert.ok(Math.abs(a)>1,`view ${view} ring ${k} has area`);area+=Math.abs(a)/2;
      });
    }
    // On flat ground the fog's total area is exactly the ring band around the map (no overlap, no hole): a world unit²
    // projects to 2·TILE_X·TILE_Y px² in every view.
    const D=FOG_RINGS*FOG_RING_CELLS*CELL,X=W*CELL,Y=H*CELL,band=(X+2*D)*(Y+2*D)-X*Y,px=band*2*42*21;
    assert.ok(Math.abs(area-px)/px<1e-6,`view ${view}: ${area.toFixed(0)} vs ${px.toFixed(0)}`);
  }
});

test('fog inner edge meets the drawn ground at the map border (same height there: no gap whatever the relief)',()=>{
  const view=1,parts=borderFog(asset,view);
  // North side, first segment, ring 0: its inner points (after the mitered corner) are the border's cell corners.
  const q=parts[0][0];
  for(let i=1;i<FOG_SEGMENT_CELLS;i++){
    const want=project(i*CELL,0,corners[i],view,VIEW_PIVOT),got=q.points[i];
    assert.ok(Math.abs(got.x-want.x)<1e-6&&Math.abs(got.y-want.y)<1e-6,`corner ${i}`);
  }
  // On flat ground every point lies outside (or on) the map rectangle.
  for(const part of borderFog(flat,0))for(const r of part)for(const p of r.points){
    const w=unproject(p.x,p.y,0.9,0);
    assert.ok(!(w.x>1e-6&&w.y>1e-6&&w.x<W*CELL-1e-6&&w.y<H*CELL-1e-6),`(${w.x.toFixed(2)},${w.y.toFixed(2)}) outside`);
  }
});

test('city only: the see-through and the fog live in the city layer; the scene feeds them only in city mode (island/endless unchanged)',()=>{
  const read=(p:string)=>readFileSync(new URL(`../../src/client/${p}`,import.meta.url),'utf8');
  const scene=read('scene.ts');
  // The city layer exists only for city worlds, and updateCity bails out without it.
  assert.match(scene,/private updateCity\(delta:number\)\{\s*if\(!this\.city\)return;/);
  assert.match(scene,/const city=this\.city=new CityLayer\(/);
  // Allies are collected for the see-through only in city mode.
  assert.match(scene,/if\(city&&player\.online&&!player\.spectator\)this\.allyFeet\.push/);
  assert.equal((scene.match(/allyFeet/g)??[]).length,4,'declared, reset, pushed (city only), read in updateCity');
  // Nothing outside render/city imports the new modules.
  for(const f of ['scene.ts','render/layers.ts','render/you.ts','render/outline.ts','render/projector.ts'])
    assert.doesNotMatch(read(f),/border-fog|CoverFader|coveringColumns/,f);
});
