import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CityTerrain,cityManifest,cityTerrainFrom} from '../../src/maps/index.ts';
import {projectView,unprojectView} from '../../src/client/projection.ts';

test('city: a tap on high ground unprojects back to the point under it (relief above 128 px)',async()=>{
  const json=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
  const hash=(await cityManifest(json)).hash;
  const res=await cityTerrainFrom(json,hash);
  assert.ok(res.ok,res.ok?'':res.error);
  const terrain=res.terrain;
  // Find the highest walkable-ish points on a coarse grid.
  let best={x:0,y:0,h:-Infinity};
  for(let x=2;x<168;x+=1.7)for(let y=2;y<168;y+=1.7){const h=terrain.height(x,y);if(h>best.h)best={x,y,h};}
  assert.ok(best.h>128,`relief ${best.h.toFixed(1)} px tops the old 128 px search`);
  for(const view of [0,1,2,3]){
    // The tap resolves to a ground point under that pixel (the peak itself, or a slope in front hiding it).
    const s=projectView({x:best.x,y:best.y},view,terrain),back=unprojectView(s,view,terrain),again=projectView(back,view,terrain);
    assert.ok(Math.hypot(again.x-s.x,again.y-s.y)<0.5,`view ${view}: lands ${Math.hypot(again.x-s.x,again.y-s.y).toFixed(2)} px off`);
  }
});

test('city: a tap marches down from the top first, so a tall ridge in front wins over the ground behind it',()=>{
  // A ridge 200 px tall across view depth at x + y ≈ 38, flat 0 elsewhere. A pure bisection over [0, 256] tests z = 128
  // first, lands in the gap in front of the ridge (x + y ≈ 35) and settles on the ground behind it.
  const ridge=Object.create(CityTerrain.prototype) as CityTerrain;
  // A smooth tent (the reprojection below reads the height again at the landing point).
  (ridge as unknown as {height:(x:number,y:number)=>number}).height=(x,y)=>200*Math.max(0,1-Math.abs(x+y-38)/1.5);
  const s={x:0,y:29*21};
  const back=unprojectView(s,0,ridge);
  assert.ok(Math.abs(back.x+back.y-38)<1.5,`lands at x + y = ${(back.x+back.y).toFixed(2)}, on the ridge`);
  const again=projectView(back,0,ridge);
  assert.ok(Math.hypot(again.x-s.x,again.y-s.y)<0.5);
});
