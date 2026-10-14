/**
 * Card ligar-arte-v2: the pure mapping manifest → city keys, frames, anchors and scale (render/city/art-plan.ts).
 * Source of the test pieces: tests/fixtures/art-v2/demo-city.mjs (the demo ruined 2×1 house with its L/S/O/N walls and
 * the park bench), written into a manifest the way scripts/import-art-v2.mjs writes it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {parseArtIndex,type ArtIndex} from '../../src/client/art/manifest.ts';
import {
  ART_CELL,CITY_ART_HEIGHT,FILL_MAX_AREA,GROUND_FROM_MANIFEST,LOT_UNIT,MOUND_HEIGHT,blockArt,buildCityArtPlan,cityArtOptions,fillLots,
  fountainLot,lotCells,moundPiece,pieceFamily,planHasArt,planHasBuildingArt,planLots,PROP_WORLD_SCALE,propSheet,sheetHeight,type BlockArt,type CityArtPlan,
} from '../../src/client/render/city/art-plan.ts';
import type {CityAsset,CityBlock} from '../../src/client/render/city/asset.ts';
import {blockPieces} from '../../src/client/render/city/chunks.ts';
import {shadowUnion} from '../../src/client/render/city/decor.ts';
import {cityRenderAsset} from '../../src/client/render/city/from-maps.ts';
import {ART_SCALE,CityMaterials,buildingAnchor,buildingFrame} from '../../src/client/render/city/materials.ts';
import {TILE_X,TILE_Y,HEIGHT_PX,rotate} from '../../src/client/render/city/projection.ts';
import {decodeCityAsset} from '../../src/maps/index.ts';
import {BUILDING,CITY_ART,DEMO_CITY_SIDECARS,PROP,writeDemoCity} from '../fixtures/art-v2/demo-city.mjs';

const ROOT=path.resolve(import.meta.dirname,'../..');
const sidecar=(id:string)=>(DEMO_CITY_SIDECARS as Record<string,{cell:number[];anchor:number[]}>)[id];
/** The demo pieces as the importer lists them (single 4-view sheet, meta from the spec table). */
function demoIndex(extra:Record<string,unknown>={}):ArtIndex{
  const sheet=(id:string)=>({file:`${id}.webp`,cell:sidecar(id).cell,views:4,anchor:sidecar(id).anchor});
  return parseArtIndex({version:2,groups:{
    predios:{output:'public/art/city/buildings',pieces:{[BUILDING.id]:{kind:'views',files:{sheet:sheet(BUILDING.id)},
      meta:{footprint:[...BUILDING.footprint],ruin:true,framesPerView:1}}}},
    props:{output:'public/art/city/props',pieces:{[PROP.id]:{kind:'views',files:{sheet:sheet(PROP.id)},meta:{prop:'banco-praca'}}}},
    chao:{output:'public/art/ground',pieces:{'cidade-nevada/neve-fofa-1':{kind:'seamless',files:{sheet:{file:'cidade-nevada/neve-fofa-1.webp',cell:[512,512],frames:1}},meta:{ground:'snow'}}}},
    ...extra,
  }});
}
const block=(over:Partial<CityBlock>):CityBlock=>({id:'b1',kind:'building',x:10,y:20,w:2,h:1,height:3,ruined:true,...over});

function realCity(){
  const d=decodeCityAsset(readFileSync(path.join(ROOT,'public/maps/cidade-nevada.json'),'utf8'));
  if(!d.ok)throw new Error(d.error);
  return cityRenderAsset(d.asset);
}

test('empty manifest (and arte=0): empty plan, the real city keeps every block, prop and key of today', ()=>{
  const before=realCity();
  for(const plan of [buildCityArtPlan(parseArtIndex({version:2,groups:{}})),buildCityArtPlan(demoIndex(),{enabled:false})]){
    assert.equal(planHasArt(plan),false);
    assert.deepEqual(plan.sheets,[]);
    const asset=realCity();
    assert.deepEqual(asset,before,'the render asset does not depend on the art');
    for(const b of asset.blocks)assert.deepEqual(planLots(b,plan),[]);
    for(const p of asset.props)assert.equal(propSheet(p,plan),undefined);
    assert.equal(fountainLot(asset,plan),undefined);
  }
  // Without the plan the layer keeps the materials.ts path: same keys asked, none loaded → all procedural.
  const asked:string[]=[],materials=new CityMaterials({has:k=>{asked.push(k);return false;},frames:()=>4});
  for(const b of before.blocks)assert.equal(materials.building(b,0),undefined);
  assert.ok(asked.every(k=>/^city:building:\d+x\d+(-ruin)?$/.test(k)));
});

test('demo manifest → keys, url, anchor line, height and scale per option', ()=>{
  assert.equal(CITY_ART_HEIGHT,'b');
  for(const height of ['a','b'] as const){
    const plan=buildCityArtPlan(demoIndex(),{height}),unit=LOT_UNIT[height];
    assert.equal(plan.unit,unit);
    const [house]=plan.buildings.ruin;
    assert.equal(house.key,`city:building:2x1-ruin/${BUILDING.id}`);
    assert.equal(house.url,`/art/city/buildings/${BUILDING.id}.webp`);
    assert.deepEqual([house.frameWidth,house.frameHeight],[...BUILDING.cell]);
    assert.ok(Math.abs(house.originY-(1-CITY_ART.buildingBottom/BUILDING.cell[1]))<1e-6,'anchor line from the sheet');
    assert.equal(house.scale,unit/ART_SCALE);
    const back=(2+1)*ART_CELL*TILE_Y*ART_SCALE,h=(BUILDING.cell[1]*house.originY-back)*house.scale/HEIGHT_PX;
    assert.ok(Math.abs(house.height-h)<1e-9&&Math.abs(sheetHeight(BUILDING.cell[1],house.originY,[2,1],ART_CELL,house.scale)-h)<1e-9);
    const bench=propSheet({id:'p1',kind:'bench'},plan)!;
    assert.equal(bench.key,`city:prop:bench/${PROP.id}`);
    assert.equal(bench.scale,PROP_WORLD_SCALE.bench/ART_SCALE,'props: the delivered scale × their world scale (proporcoes-postes-predios), in both options');
    assert.ok(Math.abs(bench.originY-(1-CITY_ART.propBottom/PROP.cell[1]))<1e-6);
    assert.equal(propSheet({id:'p1',kind:'lamp'},plan),undefined,'no poste piece: procedural lamp');
    assert.deepEqual(plan.ground,{},'ground stays off (D-038)');
  }
  assert.equal(GROUND_FROM_MANIFEST,false);
  const on=buildCityArtPlan(demoIndex(),{ground:true});
  assert.equal(on.ground.snow?.key,'city:ground:snow');
  assert.equal(on.ground.snow?.url,'/art/ground/cidade-nevada/neve-fofa-1.webp');
});

test('the front corner comes from buildingAnchor, not from the sidecar x (±37 px on the demo house)', ()=>{
  const [W,H]=BUILDING.cell;
  for(const frame of [0,1,2,3]){
    const a=buildingAnchor(2,1,frame,W,H,ART_CELL),dx=a.originX*W-W/2;
    assert.ok(Math.abs(Math.abs(dx)-0.88/2*TILE_X*ART_SCALE)<1e-9);
    assert.equal(Math.sign(dx),frame%2===0?1:-1);
    assert.notEqual(a.originX,sidecar(BUILDING.id).anchor[0]);
  }
});

test('lot planner: exact cover, seeded turns and variants, leftovers procedural, option a takes 2×2-cell lots', ()=>{
  const b=buildCityArtPlan(demoIndex(),{height:'b'}),a=buildCityArtPlan(demoIndex(),{height:'a'});
  const one=planLots(block({}),b);
  assert.equal(one.length,1);
  assert.deepEqual([one[0].x,one[0].y,one[0].w,one[0].h,one[0].a,one[0].b],[10,20,2,1,2,1]);
  assert.ok([0,2].includes(one[0].turns));
  assert.ok(one[0].height>=3,'never lower than the block');
  const tall=planLots(block({id:'b2',w:1,h:2}),b);
  assert.equal(tall.length,1);assert.ok([1,3].includes(tall[0].turns),'1×2 block: the 2×1 sheet turned');
  const odd=planLots(block({id:'b3',w:3,h:1}),b);
  assert.equal(odd.length,1,'the third cell stays procedural (no 1×1 piece)');
  assert.deepEqual(planLots(block({id:'b4',w:5,h:4}),b),planLots(block({id:'b4',w:5,h:4}),b),'deterministic');
  const many=planLots(block({id:'b4',w:5,h:4}),b),seen=new Set<string>();
  for(const lot of many)for(let j=lot.y;j<lot.y+lot.h;j++)for(let i=lot.x;i<lot.x+lot.w;i++){
    assert.ok(i>=10&&i<15&&j>=20&&j<24);const k=`${i},${j}`;assert.ok(!seen.has(k),'lots never overlap');seen.add(k);
  }
  assert.ok(seen.size>=18,'greedy fill covers most of an odd block');
  assert.deepEqual(planLots(block({kind:'wall'}),b),[],'walls keep the procedural look');
  assert.deepEqual(planLots(block({ruined:false}),b),[],'no intact piece in the demo: intact blocks stay procedural');
  // Option a: a 2×1 sheet needs 4×2 cells; a 2×1 block gets nothing.
  assert.deepEqual(planLots(block({}),a),[]);
  const big=planLots(block({w:4,h:2}),a);
  assert.equal(big.length,1);assert.deepEqual([big[0].w,big[0].h],[4,2]);
});

test('variants: same footprint chosen per block id among pieces; families decide the pool', ()=>{
  const extra=(id:string,meta:Record<string,unknown>)=>({kind:'views',files:{sheet:{file:`${id}.webp`,cell:[184,184],views:4,anchor:[.5,.913]}},meta});
  const idx=demoIndex();
  const predios=idx.groups.predios.pieces;
  Object.assign(predios,parseArtIndex({version:2,groups:{predios:{output:'public/art/city/buildings',pieces:{
    'casa-terrea-2x1-2':extra('casa-terrea-2x1-2',{footprint:[2,1],ruin:true}),
    'entulho-1x1-1':extra('entulho-1x1-1',{footprint:[1,1]}),
    'muro-pedra-reto-1':extra('muro-pedra-reto-1',{footprint:[1,1]}),
    'arena-1':extra('arena-1',{footprint:[4,4],storeys:1}),
    'sobrado-2x2-1':extra('sobrado-2x2-1',{footprint:[2,2],storeys:2}),
  }}}}).groups.predios.pieces);
  const plan:CityArtPlan=buildCityArtPlan(idx,{height:'b'});
  assert.deepEqual(plan.buildings.ruin.map(s=>s.key.split('/')[1]),['casa-terrea-2x1-1','casa-terrea-2x1-2']);
  assert.deepEqual(plan.buildings.rubble.map(s=>s.key),['city:rubble:1x1/entulho-1x1-1']);
  assert.deepEqual(plan.buildings.intact.map(s=>s.key),['city:building:2x2/sobrado-2x2-1'],'walls and landmarks are not lots');
  const picks=new Set<string>();
  for(let i=0;i<40;i++)picks.add(planLots(block({id:`r${i}`}),plan)[0].sheet.key);
  assert.equal(picks.size,2,'both 2×1 ruins get used');
  assert.equal(planLots(block({kind:'rubble',ruined:false}),plan).length,2,'rubble block → two 1×1 entulho lots');
  assert.equal(pieceFamily('casa-terrea-2x1-3'),'casa-terrea');
  assert.equal(pieceFamily('arena-1'),'arena');
});

test('URL options: arte=0 and altura', ()=>{
  assert.deepEqual(cityArtOptions('?sandbox=cidade'),{enabled:true});
  assert.deepEqual(cityArtOptions('?arte=0&altura=a'),{enabled:false,height:'a'});
  assert.deepEqual(cityArtOptions('?altura=x'),{enabled:true});
});

test('rotation: the demo house frame the layer picks shows the walls that face the camera in that view (L/S/O/N)', async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'city-demo-'));
  try{
    await writeDemoCity(dir);
    const file=path.join(dir,'cenario','predios',`${BUILDING.id}.png`);
    const {data,info}=await sharp(file).raw().ensureAlpha().toBuffer({resolveWithObject:true});
    const [W,H]=BUILDING.cell,[fa,fb]=BUILDING.footprint,S=CITY_ART.artScale;
    const SIDES={E:[220,80,70],S:[70,120,225],W:[70,170,90],N:[230,190,50]} as const;
    const NORMAL={E:[1,0],S:[0,1],W:[-1,0],N:[0,-1]} as const;
    type Side=keyof typeof SIDES;
    const pixel=(x:number,y:number)=>{const i=(Math.round(y)*info.width+Math.round(x))*4;return [data[i],data[i+1],data[i+2]];};
    const hue=([r,g,b]:number[])=>{
      let best:Side='E',d=Infinity;
      for(const s of Object.keys(SIDES) as Side[]){
        const c=SIDES[s],t=(r+g+b)/(c[0]+c[1]+c[2]),e=(r-c[0]*t)**2+(g-c[1]*t)**2+(b-c[2]*t)**2;
        if(e<d){d=e;best=s;}
      }
      return best;
    };
    /** World side whose wall is the left-front (screen x of its normal < 0) or right-front one in a view. */
    const facing=(view:number)=>{
      const out:{left?:Side;right?:Side}={};
      for(const s of Object.keys(NORMAL) as Side[]){
        const r=rotate(NORMAL[s][0],NORMAL[s][1],view);
        if(r.x+r.y>0)out[r.x-r.y<0?'left':'right']=s;
      }
      return out;
    };
    /** Art side of the left-front and right-front walls drawn in a frame (sampled low on each wall, off the letter). */
    const drawn=(frame:number)=>{
      const [A,B]=frame%2===0?[fa*CITY_ART.cell,fb*CITY_ART.cell]:[fb*CITY_ART.cell,fa*CITY_ART.cell];
      const cx=frame*W+W/2+(A-B)/2*CITY_ART.tileX*S,cy=H-CITY_ART.buildingBottom;
      const P=(x:number,y:number,z:number)=>[cx+((x-A)-(y-B))*CITY_ART.tileX*S,cy+((x-A)+(y-B))*CITY_ART.tileY*S-z*CITY_ART.heightPx*S];
      return {left:hue(pixel(...(P(A*.15,B,.08) as [number,number]))),right:hue(pixel(...(P(A,B*.15,.08) as [number,number])))};
    };
    for(const turns of [0,1,2,3])for(const view of [0,1,2,3]){
      const frame=buildingFrame(view,turns),art=drawn(frame),want=facing(view);
      // The block is the art turned by `turns`: an art side's normal n shows in the world as rotate(n, turns).
      const world=(s:Side):Side=>{const r=rotate(NORMAL[s][0],NORMAL[s][1],turns);
        return (Object.keys(NORMAL) as Side[]).find(k=>Math.abs(NORMAL[k][0]-r.x)<1e-9&&Math.abs(NORMAL[k][1]-r.y)<1e-9)!;};
      assert.equal(world(art.left),want.left,`view ${view}, turns ${turns}: left-front wall`);
      assert.equal(world(art.right),want.right,`view ${view}, turns ${turns}: right-front wall`);
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the repo manifest (codex-706 delivery, eca61ed) gives the city art', ()=>{
  const plan=buildCityArtPlan(parseArtIndex(JSON.parse(readFileSync(path.join(ROOT,'public/art/manifest.json'),'utf8'))));
  assert.equal(planHasArt(plan),true);
  assert.ok(plan.sheets.length>0);
});

// NEW-20261013-ORQ-cidade-escala-1-7: on the 1.7× Cidade Nevada (asset cell 1.496 u) a footprint sheet still covers its
// city cells, so buildings, rubble and the fountain draw 1.7× larger; props keep their absolute size; the anchor's
// origin is in art pixels (ART_CELL), the same on any map.
test('cidade-escala-1-7: the asset cell scales the footprint sheets (buildings 1.7×), never the props', ()=>{
  const decoded=decodeCityAsset(readFileSync(path.join(ROOT,'public/maps/cidade-nevada.json'),'utf8'));
  if(!decoded.ok)throw new Error(decoded.error);
  const cell=decoded.asset.unitsPerCell,k=cell/ART_CELL;
  assert.equal(cell,1.496);assert.ok(Math.abs(k-1.7)<1e-9);
  for(const height of ['a','b'] as const){
    const base=buildCityArtPlan(demoIndex(),{height}),big=buildCityArtPlan(demoIndex(),{height,cell});
    const [h0]=base.buildings.ruin,[h1]=big.buildings.ruin;
    assert.ok(Math.abs(h1.scale-h0.scale*k)<1e-12,'the house sheet is drawn × cell / ART_CELL');
    assert.ok(Math.abs(h1.height-h0.height*k)<1e-9,'and stands that much taller');
    assert.ok(Math.abs(sheetHeight(BUILDING.cell[1],h1.originY,[2,1],ART_CELL,h1.scale)-h1.height)<1e-9,'heights stay in art px of ART_CELL');
    // The house's 2×1 footprint on screen: art px × scale = the lot's 2×1 city cells projected (TILE_X px per u).
    const lotPx=(2+1)*cell*TILE_X,artPx=(2+1)*ART_CELL*TILE_X*ART_SCALE;
    assert.ok(Math.abs(artPx*h1.scale/LOT_UNIT[height]-lotPx)<1e-6,'one art cell on one city cell');
    assert.deepEqual(propSheet({id:'p1',kind:'bench'},big),propSheet({id:'p1',kind:'bench'},base),'props: today\'s absolute size');
    assert.deepEqual(h1.originY,h0.originY);
  }
  assert.deepEqual(buildCityArtPlan(demoIndex(),{cell:ART_CELL}),buildCityArtPlan(demoIndex()),'ART_CELL is the default');
  assert.throws(()=>buildCityArtPlan(demoIndex(),{cell:0}),RangeError);
});

// ---------- Fill pass (BUG-20261013-ORQ-predios-procedurais-fora): no building cell drawn as the procedural column ----------
const repoPlan=(height?:'a'|'b')=>buildCityArtPlan(parseArtIndex(JSON.parse(readFileSync(path.join(ROOT,'public/art/manifest.json'),'utf8'))),height?{height}:{});
/**
 * The real city at the 1.7× map scale (card NEW-20261013-ORQ-cidade-escala-1-7), both ways it can land: the same grid
 * with unitsPerCell 0.88 × 1.7 = 1.496 u, or the cell kept and every block 1.7× more cells (rounded edges: the blocks
 * stay disjoint).
 */
const SCALED_CELL=1.496;
function scaled(asset:CityAsset,k:number):{bigCell:CityAsset;bigGrid:CityAsset}{
  const R=(v:number)=>Math.round(v*k);
  return {bigCell:{...asset,cell:SCALED_CELL,origin:{x:asset.origin.x*k,y:asset.origin.y*k}},
    bigGrid:{...asset,width:R(asset.width),height:R(asset.height),
      blocks:asset.blocks.map(b=>({...b,x:R(b.x),y:R(b.y),w:Math.max(1,R(b.x+b.w)-R(b.x)),h:Math.max(1,R(b.y+b.h)-R(b.y))}))}};
}
/** Every cell of the block covered exactly once by its lots and mounds, inside the block; returns the mound count. */
function exactCover(b:CityBlock,art:BlockArt):number{
  const seen=new Set<string>(),add=(i:number,j:number)=>{
    assert.ok(i>=b.x&&i<b.x+b.w&&j>=b.y&&j<b.y+b.h,`${b.id}: ${i},${j} outside the block`);
    const k=`${i},${j}`;assert.ok(!seen.has(k),`${b.id}: ${k} drawn twice`);seen.add(k);
  };
  for(const l of art.lots)for(let j=l.y;j<l.y+l.h;j++)for(let i=l.x;i<l.x+l.w;i++)add(i,j);
  for(const m of art.mounds)add(m.x,m.y);
  assert.equal(seen.size,b.w*b.h,`${b.id}: every cell shows something`);
  return art.mounds.length;
}

test('fill pass: the real city has no building cell left for the procedural column, at 0.88 u and at 1.7×', ()=>{
  // The real asset is the 1.7× one (cidade-escala-1-7: cell 1.496 u); the 0.88 u variant is the same grid at the old cell.
  const real=realCity(),old={...real,cell:ART_CELL},{bigGrid}=scaled(old,1.7);
  assert.equal(real.cell,SCALED_CELL);
  for(const [name,asset] of [['0.88 u cell',old],['1.496 u (asset v2)',real],['1.7× grid',bigGrid]] as const){
    const plan=repoPlan();
    let cells=0,left=0,filled=0,mounds=0;
    for(const b of asset.blocks){
      const lots=planLots(b,plan),art=blockArt(b,plan);
      if(b.kind!=='building'&&b.kind!=='rubble'){assert.deepEqual(art,{lots:[],mounds:[]},'walls and cliffs: untouched');continue;}
      cells+=b.w*b.h;left+=b.w*b.h-lots.reduce((n,l)=>n+l.w*l.h,0);
      assert.deepEqual(art.lots.slice(0,lots.length),lots,'the planLots lots stay as they are');
      for(const l of art.lots.slice(lots.length)){filled+=l.w*l.h;assert.ok(l.a*l.b<=FILL_MAX_AREA&&l.height>=b.height);}
      mounds+=exactCover(b,art);
    }
    assert.ok(cells>1000,name);
    assert.ok(left>0,`${name}: planLots alone leaves cells (no 1×1 intact piece)`);
    assert.equal(filled,left,`${name}: every one gets a 1×1 / 1×2 piece`);
    assert.equal(mounds,0,`${name}: none left even for the mound`);
  }
  assert.equal(old.blocks.length,real.blocks.length);
});

test('fill pass with 2×2-cell lots (option a): what no piece fits is a mound, never left bare', ()=>{
  const real=realCity(),plan=repoPlan('a');
  for(const asset of [real,scaled(real,1.7).bigGrid]){
    let mounds=0,filled=0;
    for(const b of asset.blocks){
      if(b.kind!=='building'&&b.kind!=='rubble')continue;
      const art=blockArt(b,plan);mounds+=exactCover(b,art);filled+=art.lots.length-planLots(b,plan).length;
    }
    assert.ok(mounds>0&&filled>0,'1-cell-deep strips cannot take a 2×2-cell lot: mounds; wider gaps take pieces');
  }
});

test('fill pass order: small building pieces (own look first), then rubble, then the mound; deterministic', ()=>{
  const piece=(id:string,meta:Record<string,unknown>)=>({kind:'views',files:{sheet:{file:`${id}.webp`,cell:[184,184],views:4,anchor:[.5,.913]}},meta});
  const withPieces=(pieces:Record<string,unknown>)=>{
    const idx=demoIndex();
    Object.assign(idx.groups.predios.pieces,parseArtIndex({version:2,groups:{predios:{output:'public/art/city/buildings',pieces}}}).groups.predios.pieces);
    return buildCityArtPlan(idx,{height:'b'});
  };
  // Demo: only the 2×1 ruin. A 3×1 ruin leaves one cell, nothing fits it → mound.
  const demo=buildCityArtPlan(demoIndex(),{height:'b'}),odd=block({id:'b3',w:3,h:1});
  const bare=blockArt(odd,demo);
  assert.equal(bare.lots.length,1);assert.deepEqual(bare.mounds,[{x:12,y:20}]);
  // An intact 1-cell building with no small piece at all → mound; a 1×1 rubble piece → rubble.
  assert.deepEqual(blockArt(block({id:'i1',w:1,h:1,ruined:false}),demo).mounds,[{x:10,y:20}]);
  const rubble=withPieces({'entulho-1x1-1':piece('entulho-1x1-1',{footprint:[1,1]})});
  const r=blockArt(odd,rubble);
  assert.equal(r.mounds.length,0);assert.equal(r.lots[1].sheet.key,'city:rubble:1x1/entulho-1x1-1');
  assert.deepEqual([r.lots[1].x,r.lots[1].y,r.lots[1].w,r.lots[1].h],[12,20,1,1]);
  // A 1×1 ruin house beats the rubble; an intact block takes an intact 1×1 before the ruin one.
  const both=withPieces({'entulho-1x1-1':piece('entulho-1x1-1',{footprint:[1,1]}),'casa-terrea-1x1-1':piece('casa-terrea-1x1-1',{footprint:[1,1],ruin:true}),
    'quiosque-1x1-1':piece('quiosque-1x1-1',{footprint:[1,1]}),'sobrado-2x2-1':piece('sobrado-2x2-1',{footprint:[2,2]})});
  assert.equal(blockArt(odd,both).lots.at(-1)!.sheet.key,'city:building:1x1-ruin/casa-terrea-1x1-1');
  const ia=fillLots(block({id:'i3',w:3,h:3,ruined:false}),both,[]);
  assert.equal(ia.mounds.length,0);assert.equal(ia.lots.length,9);
  assert.ok(ia.lots.every(l=>l.sheet.key==='city:building:1x1/quiosque-1x1-1'),'own look first; the 2×2 is too big for the fill');
  // A 1×2 gap takes the 2×1 ruin turned (1 or 3), not a mound.
  const gap=fillLots(block({id:'g',w:1,h:2}),demo,[]);
  assert.equal(gap.lots.length,1);assert.ok([1,3].includes(gap.lots[0].turns));assert.deepEqual(gap.mounds,[]);
  // Rubble blocks: rubble pieces only (never a house), mounds when none fits.
  assert.deepEqual(blockArt(block({id:'rb',kind:'rubble',ruined:false,w:3,h:1}),demo),{lots:[],mounds:[{x:10,y:20},{x:11,y:20},{x:12,y:20}]});
  for(const kind of ['wall','cliff'] as const)assert.deepEqual(blockArt(block({kind,w:3}),both),{lots:[],mounds:[]},`${kind}: untouched`);
  const b5=block({id:'b5',w:5,h:3});
  assert.deepEqual(blockArt(b5,both),blockArt(b5,both),'deterministic');
});

test('mound piece: low rubble look, no ruin roof, seams as given; never above the block', ()=>{
  const asset=realCity(),b=asset.blocks.find(x=>x.kind==='building'&&x.ruined&&x.w>=3)!;
  for(const p of blockPieces(asset,b)){
    const m=moundPiece(p,{n:false,s:true,e:false,w:true});
    assert.equal(m.kind,'rubble');assert.equal(m.height,Math.min(p.height,MOUND_HEIGHT));
    assert.ok(!m.ruined&&!m.bite&&!m.drops);
    assert.deepEqual([m.id,m.blockId,m.x,m.y,m.w,m.h,m.base],[p.id,p.blockId,p.x,p.y,p.w,p.h,p.base]);
    assert.deepEqual(m.seams,{n:false,s:true,e:false,w:true});
  }
  assert.ok(MOUND_HEIGHT<=0.3+1e-9,'as low as the maps rubble blocks');
});

test('mound shadow: as long as the mound is tall, not the building', ()=>{
  const asset=realCity(),b=asset.blocks.find(x=>x.kind==='building'&&x.height>1)!;
  const [p]=blockPieces(asset,b),open={n:false,s:false,e:false,w:false},solo={...p,seams:open},m=moundPiece(p,open);
  const region={x0:0,y0:0,x1:asset.width,y1:asset.height};
  const area=(prims:ReturnType<typeof shadowUnion>)=>prims.reduce((n,q)=>{
    const pts=q.points??[];
    let a=0;for(let i=0;i<pts.length;i++){const u=pts[i],v=pts[(i+1)%pts.length];a+=u.x*v.y-v.x*u.y;}
    return n+Math.abs(a)/2;
  },0);
  for(const view of [0,1,2,3]){
    const full=area(shadowUnion([solo],asset,region,view)),low=area(shadowUnion([m],asset,region,view));
    assert.ok(low>0&&low<full,`view ${view}: the mound (${m.height} u) casts less than the ${b.height.toFixed(2)} u building`);
    const look={length:1,color:0,alpha:1},foot=area(shadowUnion([{...m,height:0}],asset,region,view,undefined,look));
    // Shadow length grows with the height: the mound's extra area over the bare footprint is height × the building's / its height.
    const extra=(h:number)=>area(shadowUnion([{...m,height:h}],asset,region,view,undefined,look))-foot;
    assert.ok(Math.abs(extra(m.height)*b.height/m.height-extra(b.height))<1e-6*Math.max(1,extra(b.height)),'uses the mound height');
  }
});

test('a manifest with art but no building sheets keeps the procedural columns (no fill, no mounds)', ()=>{
  const idx=demoIndex();
  idx.groups.predios.pieces={};
  const plan=buildCityArtPlan(idx,{height:'b'});
  assert.equal(planHasArt(plan),true,'props and the ground are still art');
  assert.equal(planHasBuildingArt(plan),false);
  for(const b of realCity().blocks)assert.deepEqual(blockArt(b,plan),{lots:[],mounds:[]},b.id);
  assert.equal(planHasBuildingArt(repoPlan()),true);
  assert.equal(planHasBuildingArt(buildCityArtPlan(demoIndex(),{enabled:false})),false);
});

test('the praça fountain: no fill lot, planned lot or mound lands on its footprint (bug: a ruin over the basin)', ()=>{
  const asset=realCity();
  for(const height of ['b','a'] as const){
    const plan=repoPlan(height),f=fountainLot(asset,plan);
    assert.ok(f,'the repo manifest places the fountain');
    const under=lotCells(f);
    let touched=0,blocksNear=0;
    for(const b of asset.blocks){
      if(b.x+b.w<=f.x||f.x+f.w<=b.x||b.y+b.h<=f.y||f.y+f.h<=b.y)continue;
      blocksNear++;
      const art=blockArt(b,plan,under);
      for(const l of art.lots)for(let y=l.y;y<l.y+l.h;y++)for(let x=l.x;x<l.x+l.w;x++)if(under(x,y))touched++;
      for(const m of art.mounds)if(under(m.x,m.y))touched++;
    }
    assert.equal(touched,0,`height ${height}: ${touched} cells of art over the fountain`);
    // Without the reservation the old code did put art there (the bug this guards against), when a block meets it.
    if(blocksNear){
      let before=0;
      for(const b of asset.blocks){const art=blockArt(b,plan);for(const l of art.lots)for(let y=l.y;y<l.y+l.h;y++)for(let x=l.x;x<l.x+l.w;x++)if(under(x,y))before++;for(const m of art.mounds)if(under(m.x,m.y))before++;}
      assert.ok(before>0,'the fixture reproduces the bug without the reservation');
    }
  }
});

test('reserved cells: blockArt without a reservation is unchanged', ()=>{
  const asset=realCity(),plan=repoPlan();
  for(const b of asset.blocks.slice(0,200))assert.deepEqual(blockArt(b,plan,()=>false),blockArt(b,plan));
});
