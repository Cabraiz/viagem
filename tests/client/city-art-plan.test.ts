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
  ART_CELL,CITY_ART_HEIGHT,GROUND_FROM_MANIFEST,LOT_UNIT,buildCityArtPlan,cityArtOptions,fountainLot,pieceFamily,planHasArt,planLots,
  propSheet,sheetHeight,type CityArtPlan,
} from '../../src/client/render/city/art-plan.ts';
import type {CityBlock} from '../../src/client/render/city/asset.ts';
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
    assert.equal(bench.scale,1/ART_SCALE,'props keep the delivered scale in both options');
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
