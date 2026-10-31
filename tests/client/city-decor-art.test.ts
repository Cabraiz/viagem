/**
 * Card cenario-no-mapa, client side: the asset's decor reaches the render asset, the art plan loads the `cenario` base
 * sheet of each decor id the map uses (render/city/art-plan.ts), and decorSprite says where and how each one is drawn
 * (render/city/decor-art.ts). The index is shaped like E8's importer output (ids.md: id = delivery stem, files.sheet).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseArtIndex,type ArtIndex} from '../../src/client/art/manifest.ts';
import {ART_CELL,DECOR_PROP_SCALE,DECOR_WALL_FAMILIES,WALL_RETO_SPAN,buildCityArtPlan,wallScale,cityLiteFile,cityLiteFiles,cityLiteScale,decorRule,texelOf,type DecorSheet} from '../../src/client/render/city/art-plan.ts';
import {liteOnly} from '../../src/client/art/horde-art.ts';
import {parseCityAsset,type CityAsset} from '../../src/client/render/city/asset.ts';
import {decorChunk,decorFootprint,decorSprite,wallBase} from '../../src/client/render/city/decor-art.ts';
import {cityRenderAsset,leftoverWallLines} from '../../src/client/render/city/from-maps.ts';
import {ART_SCALE,buildingAnchor,frontCorner} from '../../src/client/render/city/materials.ts';
import {TILE_X,VIEW_PIVOT,depth,project,viewPoint} from '../../src/client/render/city/projection.ts';
import sharp from 'sharp';
import {decodeCityAsset} from '../../src/maps/index.ts';
import {DECOR_REFUSED} from '../../src/maps/city-decor.ts';

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
    piece('pedregulho-2',[160,120],1-8/120,{footprint:[1,1]}),
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
  // Plus the lines of the wall cells the scenery left bare (trocar-procedurais-por-arte, from-maps leftoverWallLines).
  assert.equal(r.decor?.length,decoded.asset.decor.length+leftoverWallLines(decoded.asset).length);
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

test('border boulders fill their cell and cover the box; walls and footprint pieces cover, other objects do not', ()=>{
  const plan=buildCityArtPlan(cenarioIndex(),{cell:1.496,decor:['pedregulho-2','poste-concreto-1','muro-pichado-reto-intacto','farmacia-1']});
  const b=plan.decor['pedregulho-2'];
  assert.equal(b.rule,'prop');assert.equal(b.covers,true);
  assert.ok(Math.abs(b.scale-plan.decor['farmacia-1'].scale)<1e-9,'the footprint scale');
  assert.equal(plan.decor['poste-concreto-1'].covers,false);
  assert.equal(plan.decor['muro-pichado-reto-intacto'].covers,true);
  assert.equal(plan.decor['farmacia-1'].covers,true);
});

test('decorSprite: a footprint piece puts its front corner on the anchor, sorts by its centre, the frame is the art view', ()=>{
  const a=mini([]),plan=buildCityArtPlan(cenarioIndex(),{cell:1.5,decor:['farmacia-1','poste-concreto-1']});
  const s=plan.decor['farmacia-1'] as DecorSheet;
  for(const [rot,w,h] of [[0,2,1],[90,1,2],[180,2,1],[270,1,2]] as const)for(const view of [0,1,2,3]){
    const e={id:'farmacia-1',c:2,r:1,w,h,rot},d=decorSprite(e,s,view,a,VIEW_PIVOT);
    const art=((view*90+rot)%360),fc=frontCorner(view);
    assert.equal(d.artView,art);assert.equal(d.frame,art/90);
    const wx=(e.c+fc.i*w)*a.cell,wy=(e.r+fc.j*h)*a.cell,at=project(wx,wy,0,view,VIEW_PIVOT);
    assert.ok(Math.abs(d.x-at.x)<1e-9&&Math.abs(d.y-at.y)<1e-9);
    assert.equal(d.depth,depth((e.c+w/2)*a.cell,(e.r+h/2)*a.cell,view,VIEW_PIVOT));
    // The art's 2×1 (front along a) whatever the rot.
    assert.deepEqual(decorFootprint(e),[2,1]);
    assert.equal(d.originX,buildingAnchor(2,1,art/90,512,480,ART_CELL).originX);
    assert.equal(d.scale,s.scale);assert.equal(d.originY,s.originY);
  }
});

test('decorSprite: a pole beside a mountain sorts in front of it exactly when it stands in front (montanha-sobre-poste)', ()=>{
  // A 6×6 mountain at cells 4..9 and a pole on every cell around it, in the four views. The pole stands in front when it
  // is past the mountain's far edge on one view axis, behind when it is before its near edge on one (the only cells
  // where they can overlap on screen are those whose screen column crosses the mountain's).
  const a=mini([]),plan=buildCityArtPlan(cenarioIndex(),{cell:1.5,decor:['montanha-4x4-1','poste-concreto-1']});
  const m={id:'montanha-4x4-1',c:4,r:4,w:6,h:6,rot:0};
  for(const view of [0,1,2,3]){
    const md=decorSprite(m,plan.decor['montanha-4x4-1'],view,a,VIEW_PIVOT);
    const corners=[[4,4],[10,4],[4,10],[10,10]].map(([x,y])=>viewPoint(x*a.cell,y*a.cell,view,VIEW_PIVOT));
    const lo={x:Math.min(...corners.map(q=>q.x)),y:Math.min(...corners.map(q=>q.y))},hi={x:Math.max(...corners.map(q=>q.x)),y:Math.max(...corners.map(q=>q.y))};
    let checked=0;
    for(let r=3;r<=10;r++)for(let c=3;c<=10;c++){
      if(c>=4&&c<10&&r>=4&&r<10)continue;
      const p={id:'poste-concreto-1',c,r,w:1,h:1,rot:0},pd=decorSprite(p,plan.decor['poste-concreto-1'],view,a,VIEW_PIVOT);
      const q=viewPoint((c+.5)*a.cell,(r+.5)*a.cell,view,VIEW_PIVOT),sx=q.x-q.y;
      if(sx<=lo.x-hi.y||sx>=hi.x-lo.y)continue;
      const front=q.x>=hi.x||q.y>=hi.y;
      assert.equal(pd.depth>md.depth,front,`view ${view}, pole at ${c},${r}: ${front?'in front of':'behind'} the mountain`);
      checked++;
    }
    assert.ok(checked>=20,`view ${view}: ${checked} poles beside the mountain`);
  }
});

test('decorSprite: objects stand at their cells centre, centred on their feet', ()=>{
  const a=mini([]),plan=buildCityArtPlan(cenarioIndex(),{cell:1.5,decor:['poste-concreto-1']});
  const e={id:'poste-concreto-1',c:4,r:3,w:1,h:1,rot:270},d=decorSprite(e,plan.decor['poste-concreto-1'],1,a,VIEW_PIVOT);
  const at=project(4.5*1.5,3.5*1.5,0,1,VIEW_PIVOT);
  assert.ok(Math.abs(d.x-at.x)<1e-9&&Math.abs(d.y-at.y)<1e-9);
  assert.equal(d.originX,.5);assert.equal(d.artView,0);
});

test('cercas-nordeste-ligadas: a straight wall run stands level over a dipped terrace corner, never above the ground', ()=>{
  // Corners all 2.5 but one 0.3 under the run's middle (the raw terraces wall cells keep): the pieces' centre ground
  // jumped 2.5 -> 1.4 -> 2.5, steps and gaps along one line.
  const corners=new Array(9*7).fill(2.5);corners[3*9+4]=.3;
  const a=parseCityAsset({version:1,name:'t',cell:1.5,width:8,height:6,origin:{x:0,y:0},heights:new Array(48).fill(2.5),corners,
    ground:'s'.repeat(48),blocks:[],props:[],points:{},decor:[]});
  const plan=buildCityArtPlan(cenarioIndex(),{cell:1.5,decor:['muro-pichado-reto-intacto']}),s=plan.decor['muro-pichado-reto-intacto'];
  for(const c of [2,3,4])assert.equal(decorSprite({id:'muro-pichado-reto-intacto',c,r:2,w:2,h:2,rot:90},s,0,a,VIEW_PIVOT).base,.3,`c${c}: the lowest corner under the piece`);
  assert.equal(wallBase(a,{c:0,r:0,w:2,h:2}),2.5,'away from the dip the run keeps its ground');
});

test('decorChunk: the chunk holding the piece\'s centre cell', ()=>{
  assert.equal(decorChunk({c:8,r:0,w:2,h:1},9),'0,0');
  assert.equal(decorChunk({c:8,r:8,w:3,h:3},9),'1,1');
  assert.equal(decorChunk({c:17,r:26,w:1,h:1},9),'1,2');
});

test('the real asset places no refused piece, and its walls are straight pieces centred on their line (grades-sem-padrao)', ()=>{
  const raw=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
  const decoded=decodeCityAsset(raw);
  assert.ok(decoded.ok);
  for(const e of decoded.asset.decor){
    // The pieces E8's import refused are never placed (no invisible wall waiting for art).
    assert.ok(!DECOR_REFUSED.has(e.id),e.id);
    const rule=decorRule(e.id);
    if(rule==='wall')assert.ok(/-reto-(intacto|quebrado)$/.test(e.id)&&e.w<=2&&e.h<=2&&(!e.cover||e.w*e.h===1),e.id);
  }
});

test('a lite copy (liteCell, decor-lite-arte-perto) draws the same piece: lite url and cell, the same anchor, height and on-screen size', ()=>{
  const lite=(index:ArtIndex)=>{
    const raw=JSON.parse(JSON.stringify(index));
    for(const id of ['farmacia-1','poste-concreto-1']){const f=raw.groups.cenario.pieces[id].files.sheet;f.liteCell=[Math.ceil(f.cell[0]/2),Math.ceil(f.cell[1]/2)];}
    return parseArtIndex(raw);
  };
  const a=mini([]),decor=['farmacia-1','poste-concreto-1'];
  const full=buildCityArtPlan(cenarioIndex(),{cell:1.496,decor}),half=buildCityArtPlan(lite(cenarioIndex()),{cell:1.496,decor});
  for(const id of decor){
    const o=full.decor[id],l=half.decor[id];
    assert.equal(o.url,`/art/city/decor/${id}/sheet.webp`);assert.equal(texelOf(o),1);
    assert.equal(l.url,`/art/lite/city/decor/${id}/sheet.webp`);
    assert.deepEqual([l.frameWidth,l.frameHeight],[o.frameWidth/2,o.frameHeight/2]);
    assert.equal(texelOf(l),.5);
    assert.ok(Math.abs(l.scale*l.frameHeight-o.scale*o.frameHeight)<1e-9,`${id}: same drawn size`);
    assert.equal(l.height,o.height);assert.equal(l.originY,o.originY);
    for(const view of [0,1,2,3]){
      const e={id,c:2,r:1,w:id==='farmacia-1'?2:1,h:1,rot:0},d=decorSprite(e,o,view,a,VIEW_PIVOT),dl=decorSprite(e,l,view,a,VIEW_PIVOT);
      assert.ok(Math.abs(d.originX-dl.originX)<1e-9,`${id} view ${view}: originX ${dl.originX} vs ${d.originX}`);
      assert.ok(Math.abs(dl.scale-d.scale*2)<1e-9,"per texture px: twice the scale on half the texels");assert.equal(dl.frame,d.frame);
    }
  }
  assert.ok(liteOnly(half.decor['farmacia-1'].url),'no fallback to the approved file (other cells)');
  // Footprint pieces keep their cell (lossy only, as sharp); the smaller-drawn props, walls and nests take 0.75.
  assert.equal(cityLiteScale('cenario','farmacia-1',{meta:{footprint:[2,1],storeys:1}}),1);
  assert.equal(cityLiteScale('cenario','montanha-4x4-1',{}),1);
  assert.equal(cityLiteScale('cenario','pedregulho-2',{}),1);
  assert.equal(cityLiteScale('predios','casa-2x1-1',{}),1);
  assert.equal(cityLiteScale('cenario','ninho-festa-ativo',{meta:{footprint:[3,3]}}),.75);
  assert.equal(cityLiteScale('cenario','outdoor-1',{meta:{footprint:[1,1]}}),.75);
  assert.equal(cityLiteScale('cenario','muro-pichado-reto-intacto',{}),.75);
  assert.equal(cityLiteScale('props','fonte',{}),.75);
  assert.equal(cityLiteFile('cenario','farmacia-1',cenarioIndex().groups.cenario!.pieces['farmacia-1']),'sheet');
  assert.deepEqual(cityLiteFiles('cenario','farmacia-1',{kind:'decor',meta:{footprint:[2,1],storeys:1},files:{sheet:{file:'farmacia-1/sheet.webp',cell:[512,480],views:4},
    'anim-cruz':{file:'farmacia-1/anim-cruz.webp',cell:[111,111],frames:6}}} as never),[{name:'sheet',scale:1},{name:'anim-cruz',scale:1}],'the live loops keep their cell');
  assert.equal(cityLiteFile('cenario','bueiro',{kind:'decor',files:{sheet:{file:'bueiro/sheet.webp',cell:[256,256],frames:1}}} as never),undefined,'decals are no view sheet');
  assert.equal(cityLiteFile('base','forja',{kind:'views',files:{sheet:{file:'forja.webp',cell:[256,256],views:4}}} as never),undefined,'base pieces other than the fountain load elsewhere');
  assert.equal(cityLiteFile('predios','arena-1',{kind:'views',files:{sheet:{file:'arena-1.webp',cell:[256,256],views:4}}} as never),undefined,'unused building families');
});

test('grades-sem-padrao: the straight piece of a wall is drawn one city cell long (the pieces of a line meet post to post)', async ()=>{
  for(const family of DECOR_WALL_FAMILIES){
    // The span is the intact piece's view 0 alpha width less about a post (shared by the neighbours).
    const {data,info}=await sharp(`public/art/city/decor/${family}-reto-intacto/sheet.webp`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const fw=info.width/4;let x0=fw,x1=0;
    for(let y=0;y<info.height;y++)for(let x=0;x<fw;x++)if(data[(y*info.width+x)*4+3]>40){x0=Math.min(x0,x);x1=Math.max(x1,x);}
    const width=x1-x0,span=WALL_RETO_SPAN[family];
    assert.ok(span<width&&span>width*.9,`${family}: span ${span} vs art width ${width}`);
    assert.ok(Math.abs(wallScale(family,1.496)*span-1.496*TILE_X)<1e-9);
  }
  const plan=buildCityArtPlan(cenarioIndex(),{cell:1.496,decor:['muro-pichado-reto-intacto']});
  assert.ok(Math.abs(plan.decor['muro-pichado-reto-intacto'].scale-wallScale('muro-pichado',1.496))<1e-9);
});

test('grades-sem-padrao: a cover entry reaches the render asset (it covers its cell, draws nothing)', ()=>{
  const raw=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8'));
  const decoded=decodeCityAsset(JSON.stringify(raw));
  assert.ok(decoded.ok);
  const covers=decoded.asset.decor.filter(d=>d.cover);
  assert.ok(covers.length>0);
  const render=cityRenderAsset(decoded.asset);
  assert.equal(render.decor!.filter(d=>d.cover).length,covers.length+leftoverWallLines(decoded.asset).filter(d=>d.cover).length);
});
