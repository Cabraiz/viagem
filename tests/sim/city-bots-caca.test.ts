/**
 * NEW-20261016-E2-bot-caca-ultimo-na-borda (+ the 90 u chase of balanco-manual-cidade): the end of a city wave.
 *  - A roamer hunts a last critter that stands just past the lure band (LURE_REACH): between it and the old LEASH+3 one
 *    neither lured nor was hunted, and the bots held at their leash's edge.
 *  - The wave's very last critter takes a guard out to the roamers' LEASH (both guards held 6 u from it).
 *  - Nobody hunts a retreating wave (past its timer): the survivors walk back up the avenues faster than a bot and
 *    vanish only out of sight, so the chase kept one in sight up to the 60 s cap, 120 u out (city-bots seed 1).
 * Synthetic views on the plaza's south street (15° south of east, as city-bots-barricadas), decide() only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {walkable} from '../../src/maps/world.ts';
import {GUARD_LEASH,LEASH,LURE_REACH,ROAM_IN,decide,newMemory} from '../../src/sim/bot-brain.ts';
import type {RunView} from '../../src/contract/view.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(TEXT,HASH);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,wall=city.asset.points.praca;
const DIR={x:Math.cos(Math.PI/12),y:Math.sin(Math.PI/12)};
const along=(d:number)=>({x:wall.x+DIR.x*d,y:wall.y+DIR.y*d});
const dot=(v:{x:number;y:number})=>v.x*DIR.x+v.y*DIR.y;

type Spot={x:number;y:number};
function think(opts:{index:number;at:Spot;critters:Spot[];retreating?:boolean}){
  const id=`bot-${opts.index+1}`;
  return decide({
    view:{tick:2400,team:{xp:0,level:3,nextXp:50},round:{index:3,total:10,phase:'wave',phaseEndsTick:opts.retreating?2000:4000,remaining:opts.critters.length},
      enemies:opts.critters.map((c,i)=>({id:`e${i}`,kind:'cunhado-sabe-tudo',x:c.x,y:c.y,hp:20,maxHp:20})),pickups:[],projectiles:[],telegraphs:[],
      structures:[{id:'s1',kind:'muralha',x:wall.x,y:wall.y,hp:600,maxHp:600}],
      players:[{id,name:id,hp:100,maxHp:100,x:opts.at.x,y:opts.at.y,online:true,weapons:[],passives:[]}],offers:[],events:[],camp:{units:0,grana:0}} as unknown as RunView,
    selfId:id,at:opts.at,index:opts.index,terrain:city,memory:newMemory(opts.index)});
}
/** How much of the bot's step goes out along the street, toward the critters (1: straight at them). */
const out=(opts:Parameters<typeof think>[0])=>dot(think(opts).direction);

test('the spots of the south street are walkable, and the bands meet',()=>{
  for(const d of [3,4,7.5,9.1,11])assert.ok(walkable(along(d),city),`${d} u from the wall`);
  assert.ok(LURE_REACH>LEASH&&LURE_REACH<LEASH+3,'the hunt starts where the lure band ends, inside the old LEASH+3');
});

test('a roamer hunts the last critter standing just past the lure band (it used to hold at its leash)',()=>{
  const opts={index:1,at:along(LEASH-ROAM_IN-.5),critters:[along(LURE_REACH+.4)]};
  assert.equal(think(opts).mode,'fight');
  assert.ok(out(opts)>.9,`it walks out to it (${out(opts).toFixed(2)})`);
});

test('nobody hunts a retreating wave: past the timer the survivors walk away, the bot stays at the wall',()=>{
  for(const d of [LURE_REACH+.4,11]){
    const live=out({index:1,at:along(4),critters:[along(d)]}),gone=out({index:1,at:along(4),critters:[along(d)],retreating:true});
    assert.ok(live>.9,`${d} u: hunted while the wave lasts (${live.toFixed(2)})`);
    assert.ok(gone<.5,`${d} u: no walk out after it once it retreats (${gone.toFixed(2)})`);
  }
});

test('the very last critter takes a guard out to the roamers leash; with two left it keeps the wall',()=>{
  const at=along(GUARD_LEASH-.5),critter=along(7.5);
  const last=out({index:0,at,critters:[critter]}),two=out({index:0,at,critters:[critter,along(11)]});
  assert.ok(last>.5,`last one: the guard walks out (${last.toFixed(2)})`);
  assert.ok(two<.5,`two left: the guard holds (${two.toFixed(2)})`);
  assert.ok(out({index:0,at,critters:[critter],retreating:true})<.5,'not when the wave retreats');
  // The guard only lengthens its leash: a last critter past the lure band is the roamers' hunt, not its.
  assert.ok(out({index:0,at,critters:[along(LURE_REACH+.4)]})<.5,'past the lure band the guard holds');
});
