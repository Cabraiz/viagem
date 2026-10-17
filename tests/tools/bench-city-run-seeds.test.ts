// NEW-20261017-ORQ-seed-vaza-estado: the city bench plays many seeds in one process (scripts/bench-city-run.ts), and
// the CI one seed per job; they must agree. Seed 16 of the 1p bench won alone and lost after seed 15: the navigator's
// crate fields were cached by crate id, and the arsenal crates' ids (D-051, ctx.nextId) start again every match at
// other spots, so seed 16's bots walked to seed 15's crates. Now cached by goal cell. The sim side (two matches in
// one Worker) is tests/rooms/seed-repete.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {CityNavigator,playRun,runDigest,HZ} from '../../scripts/bench-city-run.ts';

const text=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const hash=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8')).hash;

test('one bench process: seed 16 after seed 15 (same navigator) is seed 16 alone, digest for digest',async()=>{
  const loaded=await cityTerrainFrom(text,hash);if(!loaded.ok)throw new Error(loaded.error);
  const city=loaded.terrain,capTicks=30*60*HZ;
  const run=(seed:number,nav:CityNavigator)=>{const r=playRun({seed,players:1,capTicks,city,nav,route:'none',towers:true,combat:'manual'});return runDigest(r);};
  const alone=run(16,new CityNavigator(city));
  const shared=new CityNavigator(city);
  run(15,shared);
  assert.equal(run(16,shared),alone);
});

test('a crate field is the one of its spot: the same id at another spot gets its own field',async()=>{
  const loaded=await cityTerrainFrom(text,hash);if(!loaded.ok)throw new Error(loaded.error);
  const nav=new CityNavigator(loaded.terrain),g=nav.grid,cs=g.cellSize;
  const open:number[]=[];for(let i=0;i<g.width*g.height&&open.length<2;i+=997)if(g.walkable(i%g.width,Math.floor(i/g.width)))open.push(i);
  const at=(i:number)=>({x:(i%g.width+.5)*cs,y:(Math.floor(i/g.width)+.5)*cs});
  const a=nav.crateField('caixa-1',at(open[0])),b=nav.crateField('caixa-1',at(open[1]));
  assert.notEqual(a,b);
  assert.equal(b.costAt(at(open[1]).x,at(open[1]).y),0,'the field leads to the spot it was asked for');
  assert.equal(nav.crateField('caixa-9',at(open[0])),a,'another id at the same spot shares the field');
});
