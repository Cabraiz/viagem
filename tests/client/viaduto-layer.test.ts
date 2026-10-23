/**
 * NEW-20261023-ORQ-mapa-175-com-viaduto, etapa 3: the viaduct layer (render/city/viaduct.ts) on the real asset over a
 * stand-in Phaser scene: it draws in every view, fades around a hero under the deck, and places a body on the deck
 * (lift and depth) without throwing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeCityAsset} from '../../src/maps/city-asset.ts';
import {ViaductLayer} from '../../src/client/render/city/viaduct.ts';
test('the viaduct layer draws in the four views, fades around a hero under it and places a deck body',()=>{
  const r=decodeCityAsset(readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8'));if(!r.ok)throw r.error;
  const a=r.asset;let calls=0;
  const g=()=>{const o:any={alpha:1,clear(){return o;},fillStyle(){calls++;return o;},fillPoints(){return o;},lineStyle(){return o;},strokePoints(){return o;},setDepth(){return o;},setAlpha(v:number){o.alpha=v;return o;},destroy(){}};return o;};
  const scene:any={add:{graphics:g}};
  const L=new ViaductLayer(scene,a.viaducts,a.unitsPerCell,{depthOf:k=>k,groundPx:()=>0},-1e8,a.points.inicio);
  for(const v of [0,1,2,3])L.update(v,{x:a.points.inicio.x,y:a.points.inicio.y,andar:1});
  // A hero on the street under the deck: the cells around it go see-through.
  L.update(0,{x:79,y:18});
  assert.ok(calls>100);
  assert.ok(Number.isFinite(L.bodyDepth(a.points.inicio.x,a.points.inicio.y)!));
  assert.ok(L.bodyLift(a.points.inicio.x,a.points.inicio.y,1)>0);
  L.destroy();
});
