import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cityManifest,cityTerrainFrom} from '../../src/maps/index.ts';
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
