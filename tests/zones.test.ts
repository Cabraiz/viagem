import test from 'node:test';
import assert from 'node:assert/strict';
import {THUMB_GAP,auditBoxes,chooseSlot,computeZones,crosses,gap,orientationOf,union,veiled} from '../src/game/hud/zones.ts';

const portrait=computeZones({viewport:{width:390,height:844},status:[{x:14,y:12,width:44,height:44},{x:166,y:8,width:142,height:46},{x:8,y:72,width:292,height:26}],
  team:{x:8,y:120,width:54,height:380},joystick:{x:24,y:708,width:112,height:112},skill:{x:284,y:738,width:82,height:82},emote:{x:301,y:666,width:48,height:48}});
const landscape=computeZones({viewport:{width:844,height:390},status:[{x:14,y:12,width:44,height:44},{x:330,y:8,width:180,height:40},{x:212,y:52,width:420,height:20}],
  team:{x:258,y:318,width:328,height:64},joystick:{x:18,y:278,width:96,height:96},skill:{x:746,y:292,width:82,height:82}});

test('zones per orientation: top band with the announcement slot, thumbs with 24 px, useful area left over',()=>{
  assert.equal(orientationOf({width:390,height:844}),'portrait');assert.equal(orientationOf({width:844,height:390}),'landscape');
  assert.equal(portrait.announce.y,102);assert.equal(portrait.useful.y,portrait.announce.y+portrait.announce.height);
  assert.equal(portrait.useful.x,70,'portrait: right of the team column');
  assert.equal(portrait.leftThumb!.x,0);assert.equal(portrait.rightThumb!.y,666-THUMB_GAP,'emote is in the right-thumb zone');
  assert.equal(portrait.useful.y+portrait.useful.height,portrait.rightThumb!.y);
  assert.equal(landscape.useful.x,18+96+THUMB_GAP,'landscape: between the thumbs');assert.equal(landscape.useful.x+landscape.useful.width,746-THUMB_GAP);
  assert.equal(landscape.useful.y+landscape.useful.height,318-8,'landscape: down to the team row');
  for(const z of [portrait,landscape])for(const zone of [z.top,z.leftThumb!,z.rightThumb!])assert.equal(crosses(z.useful,zone),false);
});

test('geometry helpers',()=>{
  assert.equal(gap({x:0,y:0,width:10,height:10},{x:30,y:0,width:5,height:5}),20);
  assert.equal(gap({x:0,y:0,width:10,height:10},{x:5,y:5,width:5,height:5}),0);
  assert.deepEqual(union([{x:0,y:0,width:1,height:1},undefined,{x:4,y:5,width:1,height:1}]),{x:0,y:0,width:5,height:6});
  assert.equal(crosses({x:0,y:0,width:10,height:10},{x:10,y:0,width:5,height:5}),false);
  assert.equal(crosses({x:0,y:0,width:10,height:10},{x:30,y:0,width:5,height:5},21),true);
});

test('announcement slot: top unless it crosses the hero (± 40), then the low slot; least overlap when both cross',()=>{
  const top={x:70,y:112,width:300,height:40},low={x:70,y:640,width:300,height:40};
  assert.equal(chooseSlot([top,low],undefined),0);
  assert.equal(chooseSlot([top,low],{x:180,y:400,width:30,height:30}),0);
  assert.equal(chooseSlot([top,low],{x:180,y:180,width:30,height:30}),1,'hero 28 px under the banner');
  assert.equal(chooseSlot([top,low],{x:180,y:120,width:30,height:600}),0,'both cross: the top one overlaps less');
});

test('zones audit: HUD over the hero, a target too close to a thumb, or a box in the useful area fail; offer is allowed',()=>{
  const hero={x:200,y:400,width:30,height:30};
  const thumbs=[{name:'joystick',rect:{x:24,y:708,width:112,height:112},thumb:true,target:true},{name:'habilidade',rect:{x:284,y:738,width:82,height:82},thumb:true,target:true}];
  const ok=auditBoxes([...thumbs,{name:'round',rect:{x:166,y:8,width:142,height:46}},{name:'emote',rect:{x:301,y:656,width:48,height:48},target:true}],portrait,hero);
  assert.equal(ok.ok,true);assert.equal(ok.minThumbGap,34);
  const bad=auditBoxes([...thumbs,{name:'aviso',rect:{x:150,y:420,width:200,height:30}},{name:'emote',rect:{x:301,y:680,width:48,height:48},target:true},
    {name:'oferta',rect:{x:8,y:380,width:370,height:300},allowedInPlay:true}],portrait,hero);
  assert.equal(bad.ok,false);assert.deepEqual(bad.heroCrossed,['aviso']);assert.deepEqual(bad.inPlay,['aviso']);
  assert.deepEqual(bad.thumbGaps,[{a:'emote',b:'habilidade',gap:10}]);assert.deepEqual(bad.allowedOverHero,['oferta']);
  const fallback=auditBoxes([...thumbs,{name:'aviso',rect:{x:150,y:600,width:200,height:30},fallback:true}],portrait,hero);
  assert.equal(fallback.ok,true);assert.deepEqual(fallback.fallbackInPlay,['aviso']);
});

test('veil: only the readouts the hero (± 40) walked under go see-through',()=>{
  const boxes=[{rect:{x:330,y:8,width:180,height:40}},{rect:{x:212,y:52,width:420,height:20}},{rect:{x:258,y:318,width:60,height:64}}];
  assert.deepEqual(veiled(boxes,{x:400,y:100,width:60,height:60}),[false,true,false]);
  assert.deepEqual(veiled(boxes,undefined),[false,false,false]);
});
