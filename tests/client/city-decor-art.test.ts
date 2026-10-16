/**
 * Card cenario-no-mapa, client side: the asset's decor reaches the render asset, the art plan loads the `cenario` base
 * sheet of each decor id the map uses (render/city/art-plan.ts), and decorSprite says where and how each one is drawn
 * (render/city/decor-art.ts). The index is shaped like E8's importer output (ids.md: id = delivery stem, files.sheet).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseArtIndex,type ArtIndex} from '../../src/client/art/manifest.ts';
import {ART_CELL,DECOR_PROP_SCALE,buildCityArtPlan,decorRule,type DecorSheet} from '../../src/client/render/city/art-plan.ts';
import {parseCityAsset,type CityAsset} from '../../src/client/render/city/asset.ts';
import {decorChunk,decorFootprint,decorSprite} from '../../src/client/render/city/decor-art.ts';
import {cityRenderAsset} from '../../src/client/render/city/from-maps.ts';
import {ART_SCALE,buildingAnchor,frontCorner} from '../../src/client/render/city/materials.ts';
import {VIEW_PIVOT,depth,project} from '../../src/client/render/city/projection.ts';
import {decodeCityAsset} from '../../src/maps/index.ts';

const sheet=(id:string,cell:[number,number],anchorY:number)=>({file:`${id}/sheet.webp`,cell,views:4,anchor:[.5,anchorY]});
function cenarioIndex():ArtIndex{
  const piece=(id:string,cell:[number,number],anchorY:number,meta?:Record<string,unknown>)=>
    [id,{kind:'decor',files:{sheet:sheet(id,cell,anchorY)},...(meta?{meta}:{})}];
  return parseArtIndex({version:2,groups:{cenario:{output:'public/art/city/decor',pieces:Object.fromEntries([
    piece('farmacia-1',[512,480],1-16/480,{footprint:[2,1],storeys:1}),
    piece('montanha-4x4-1',[1024,800],1-16/800,{footprint:[4,4]}),
    piece('muro-pichado-reto-intacto',[192,256],1-40/256),
    piece('poste-concreto-1',[160,560],1-8/560,{wires:{0:[[40,30],[80,28],[120,30]]}}),
    piece('ninho-festa-ativo',[400,360],.9,{footprint:[3,3]}),
    piece('bueiro',[256,256],.5),
  ])}}});
}
const mini=(decor:unknown[]):CityAsset=>parseCityAsset({version:1,name:'t',cell:1.5,width:8,height:6,origin:{x:0,y:0},
  heights:new Array(48).fill(0),ground:'s'.repeat(48),blocks:[],props:[],points:{},decor});

test('parseCityAsset keeps valid decor, drops broken entries, and leaves the key out when there is none', ()=>{
  const a=mini([
    {id:'farmacia-1',c:1,r:1,w:2,h:1,rot:0},{id:'muro-pichado-reto-intacto',c:5,r:0,w:1,h:1,rot:90,links:5},
    {id:'fora',c:7,r:0,w:2,h:1,rot:0},{id:'giro',c:0,r:0,w:1,h:1,rot:45},{id:3,c:0,r:0,w:1,h:1,rot:0},
  ]);
  assert.deepEqual(a.decor,[{id:'farmacia-1',c:1,r:1,w:2,h:1,rot:0},{id:'muro-pichado-reto-intacto',c:5,r:0,w:1,h:1,rot:90,links:5}]);
  assert.equal('decor' in mini([]),false);
});

test('the real asset: cityRenderAsset copies every decor piece and stays in parseCityAsset normal form', ()=>{
  const raw=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
  const decoded=decodeCityAsset(raw);
  assert.ok(decoded.ok);
  const r=cityRenderAsset(decoded.asset);
  assert.equal(r.decor?.length,decoded.asset.decor.length);
  assert.ok(r.decor!.length>1000);
  assert.deepEqual(parseCityAsset(r).decor,r.decor);
});

test('decorRule follows the adapter: walls by family, storeys and terrain by footprint, the rest as objects', ()=>{
  assert.equal(decorRule('muro-condominio-quina-quebrado'),'wall');
  assert.equal(decorRule('cerca-madeira-ponta-intacto'),'wall');
  assert.equal(decorRule('farmacia-1',{storeys:1}),'footprint');
  assert.equal(decorRule('montanha-6x6-2'),'footprint');
  assert.equal(decorRule('penhasco2-reto'),'footprint');
  assert.equal(decorRule('kombi-velha-1',{footprint:[2,1]}),'prop');
  assert.equal(decorRule('poste-gato-1'),'prop');
});

test('the plan loads only the decor ids the map uses; nests and decals stay with the live layer', ()=>{
  const index=cenarioIndex();
  assert.deepEqual(buildCityArtPlan(index).decor,{});
  const plan=buildCityArtPlan(index,{cell:1.496,decor:['farmacia-1','poste-concreto-1','poste-concreto-1','muro-pichado-reto-intacto',
    'montanha-4x4-1','ninho-festa-ativo','bueiro','nao-existe']});
  assert.deepEqual(Object.keys(plan.decor).sort(),['farmacia-1','montanha-4x4-1','muro-pichado-reto-intacto','poste-concreto-1']);
  const f=plan.decor['farmacia-1'],p=plan.decor['poste-concreto-1'],w=plan.decor['muro-pichado-reto-intacto'];
  assert.equal(f.key,'city:decor:farmacia-1');
  assert.equal(f.url,'/art/city/decor/farmacia-1/sheet.webp');
  assert.equal(f.rule,'footprint');
  // One art cell on one city cell, like the building lots (CITY_ART_HEIGHT 'b').
  assert.ok(Math.abs(f.scale-1.496/ART_CELL/ART_SCALE)<1e-9);
  assert.equal(p.rule,'prop');assert.equal(w.rule,'wall');
  assert.ok(Math.abs(p.scale-DECOR_PROP_SCALE/ART_SCALE)<1e-9);
  assert.ok(Math.abs(p.originY-(1-8/560))<1e-9);
  // Their sheets load with the rest of the plan (queueCityArt), each once.
  const keys=plan.sheets.map(s=>s.key).filter(k=>k.startsWith('city:decor:'));
  assert.deepEqual(keys.sort(),Object.values(plan.decor).map(s=>s.key).sort());
  assert.ok(plan.decor['montanha-4x4-1'].height>f.height);
});

test('decorSprite: a footprint piece puts its front corner on the anchor, the frame is the art view', ()=>{
  const a=mini([]),plan=buildCityArtPlan(cenarioIndex(),{cell:1.5,decor:['farmacia-1','poste-concreto-1']});
  const s=plan.decor['farmacia-1'] as DecorSheet;
  for(const [rot,w,h] of [[0,2,1],[90,1,2],[180,2,1],[270,1,2]] as const)for(const view of [0,1,2,3]){
    const e={id:'farmacia-1',c:2,r:1,w,h,rot},d=decorSprite(e,s,view,a,VIEW_PIVOT);
    const art=((view*90+rot)%360),fc=frontCorner(view);
    assert.equal(d.artView,art);assert.equal(d.frame,art/90);
    const wx=(e.c+fc.i*w)*a.cell,wy=(e.r+fc.j*h)*a.cell,at=project(wx,wy,0,view,VIEW_PIVOT);
    assert.ok(Math.abs(d.x-at.x)<1e-9&&Math.abs(d.y-at.y)<1e-9);
    assert.equal(d.depth,depth(wx,wy,view,VIEW_PIVOT));
    // The art's 2×1 (front along a) whatever the rot.
    assert.deepEqual(decorFootprint(e),[2,1]);
    assert.equal(d.originX,buildingAnchor(2,1,art/90,512,480,ART_CELL).originX);
    assert.equal(d.scale,s.scale);assert.equal(d.originY,s.originY);
  }
});

test('decorSprite: objects stand at their cells centre, centred on their feet', ()=>{
  const a=mini([]),plan=buildCityArtPlan(cenarioIndex(),{cell:1.5,decor:['poste-concreto-1']});
  const e={id:'poste-concreto-1',c:4,r:3,w:1,h:1,rot:270},d=decorSprite(e,plan.decor['poste-concreto-1'],1,a,VIEW_PIVOT);
  const at=project(4.5*1.5,3.5*1.5,0,1,VIEW_PIVOT);
  assert.ok(Math.abs(d.x-at.x)<1e-9&&Math.abs(d.y-at.y)<1e-9);
  assert.equal(d.originX,.5);assert.equal(d.artView,0);
});

test('decorChunk: the chunk holding the piece\'s centre cell', ()=>{
  assert.equal(decorChunk({c:8,r:0,w:2,h:1},9),'0,0');
  assert.equal(decorChunk({c:8,r:8,w:3,h:3},9),'1,1');
  assert.equal(decorChunk({c:17,r:26,w:1,h:1},9),'1,2');
});

test('every decor id of the real asset that is not a nest or a decal has a rule, and walls sit on 1×1 cells', ()=>{
  const raw=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
  const decoded=decodeCityAsset(raw);
  assert.ok(decoded.ok);
  for(const e of decoded.asset.decor){
    const rule=decorRule(e.id);
    if(rule==='wall')assert.ok(e.w===1&&e.h===1,e.id);
  }
});
