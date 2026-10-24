/**
 * Card NEW-20261023-ORQ-inimigos-querem-o-uno, etapa 2 (leitura no cliente): the Uno taking hits reads without text.
 * - each hit's number rises off the roof (merged when a horde hits together, at most HIT_POPS_MAX in the air), the car
 *   flashes for a blink (never with reduced effects), the hood smokes dark under CAR_LOW;
 * - the car gets a Cone edge arrow only while it takes hits out of view, right after a caído, never dropped;
 * - the result screen names the cause ("O Uno não aguentou").
 * Run: node --experimental-strip-types --test tests/client/uno-apanhando.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {CAR_LOW,HIT_FLASH_MS,HIT_MERGE_MS,HIT_POP_MS,HIT_POPS_MAX,carLife,hitFlash,hitPop} from '../../src/client/render/chaveiro/rules.ts';
import {ChaveiroTracker} from '../../src/client/render/chaveiro/tracker.ts';
import type {ChaveiroView} from '../../src/client/render/chaveiro/view.ts';
import * as city from '../../src/client/hud/city/index.ts';
import {EDGE_KINDS_SHOWN,shownTargets} from '../../src/client/hud/arrows.ts';
import {OBJECTIVE_CAUSE_TEXT} from '../../src/client/hud/chaveiro.ts';
import {PEEK_MS,PIP_FAR_U,PIP_HIDE_MS,PIP_ZOOM_K,peeking,pipViewport,pipWanted,pipZoom} from '../../src/client/render/chaveiro/pip-rules.ts';

const view=(hits:number,extra:Partial<ChaveiroView>={}):ChaveiroView=>({moto:{x:84.5,y:40,mode:'anda'},etaS:300,alarmUntil:0,
  car:{x:84.5,y:84.5,hits,limit:120,parts:0},...extra});

test('tracker: a hit since the last view pops its number; close hits add up; the first view and the end pop nothing',()=>{
  const t=new ChaveiroTracker();
  t.push(view(30),1,0,false);
  assert.equal(t.pops.length,0,'old damage on the first view is no news');assert.equal(t.lastHitAt,undefined);
  t.push(view(33),2,100,false);
  assert.deepEqual(t.pops,[{amount:3,at:100}]);assert.equal(t.lastHitAt,100);
  t.push(view(35),3,100+HIT_MERGE_MS-1,false);
  assert.deepEqual(t.pops,[{amount:5,at:100}],'a horde hitting together is one number');
  t.push(view(35),4,600,false);assert.equal(t.pops.length,1,'no hit, no number');
  for(let i=0;i<HIT_POPS_MAX+2;i++)t.push(view(36+i),5+i,1000+i*HIT_MERGE_MS,false);
  assert.equal(t.pops.length,HIT_POPS_MAX,'never more than the pool');
  t.settle(1000+(HIT_POPS_MAX+1)*HIT_MERGE_MS+HIT_POP_MS);assert.equal(t.pops.length,0,'gone once risen');
  t.push(view(80,{ended:'defeat'}),20,5000,false);assert.equal(t.pops.length,0,'the wreck pops nothing');
  t.push(undefined,21,5100,false);assert.equal(t.lastHitAt,undefined);
  t.push(view(90),22,5200,false);assert.equal(t.pops.length,0,'back: a first view again');
});

test('rules: the number rises and fades, the flash is a blink (none reduced), life share and the low smoke line',()=>{
  const a=hitPop(0,false)!,b=hitPop(HIT_POP_MS/2,false)!,c=hitPop(HIT_POP_MS*.9,false)!;
  assert.equal(a.rise,0);assert.ok(b.rise>a.rise&&c.rise>b.rise);assert.equal(a.alpha,1);assert.ok(c.alpha<.5);
  assert.equal(hitPop(HIT_POP_MS,false),undefined);assert.equal(hitPop(-1,false),undefined);
  assert.equal(hitPop(HIT_POP_MS/2,true)!.rise,0,'reduced effects: it stays put');
  assert.ok(hitFlash(0,false)&&hitFlash(HIT_FLASH_MS-1,false));
  assert.ok(!hitFlash(HIT_FLASH_MS,false)&&!hitFlash(undefined,false)&&!hitFlash(10,true));
  assert.equal(carLife({hits:0,limit:120}),1);assert.equal(carLife({hits:90,limit:120}),.25);
  assert.equal(carLife({hits:200,limit:120}),0);assert.equal(carLife({hits:0,limit:0}),0);
  assert.ok(carLife({hits:90,limit:120})<CAR_LOW&&carLife({hits:80,limit:120})>=CAR_LOW);
});

test('edges: the Uno gets a Cone arrow only while it takes hits out of view, after the caído, never dropped',()=>{
  const map=city.DEFAULT_CITY,locate=(p:{x:number;y:number})=>({x:p.x*10,y:p.y*10});
  const base={hero:{x:84.5,y:150},selfId:'p1',players:[],enemies:[],map,phase:'wave' as const,locate,isOnScreen:()=>false};
  const uno=(hit:boolean,onScreen=false)=>city.cityEdgeTargets({...base,isOnScreen:()=>onScreen,car:{x:84.5,y:84.5,hit}}).targets.find(t=>t.kind==='uno');
  const a=uno(true)!;
  assert.equal(a.danger,true);assert.equal(a.name,'O Uno está apanhando');assert.equal(a.distance,150-84.5);
  assert.equal(uno(false),undefined,'quiet car: no arrow (the orange arrow at the top already points at it)');
  assert.equal(uno(true,true),undefined,'on screen: the bar and the numbers say it');
  assert.ok(EDGE_KINDS_SHOWN.has('uno'));assert.equal(shownTargets([a]).length,1);
  assert.equal(city.cityEdgeRank(a),.5);assert.ok(city.cityMustPoint(a));
  const caido={key:'p2',kind:'caido' as const,screen:{x:-50,y:400},distance:20};
  assert.ok(city.cityEdgeRank(caido)<city.cityEdgeRank(a));
  const arrows=city.layoutCityEdges([a],{x:0,y:0,width:390,height:844},undefined,{});
  assert.equal(arrows.length,1);assert.equal(arrows[0].kind,'uno');assert.equal(arrows[0].danger,true);
  assert.ok(city.UNO_HIT_MS>=2000&&city.UNO_HIT_MS<=4000,'a horde keeps it up, a scratch blinks it once');
});

test('result: the run lost with the car names it',()=>{
  assert.match(OBJECTIVE_CAUSE_TEXT.car,/^O Uno não aguentou/);
});

test('etapa 3, the Uno live window: shows while hit out of view or far, goes 3 s after the last hit, not while peeking',()=>{
  const base={live:true,lastHitAt:1000,now:1500,carOnScreen:false,distance:40};
  assert.ok(pipWanted(base));
  assert.ok(!pipWanted({...base,now:1000+PIP_HIDE_MS}),'3 s after the last hit');
  assert.ok(pipWanted({...base,now:1000+PIP_HIDE_MS-1}));
  assert.ok(!pipWanted({...base,lastHitAt:undefined}),'never hit');
  assert.ok(!pipWanted({...base,live:false}),'the run ended');
  assert.ok(!pipWanted({...base,carOnScreen:true,distance:PIP_FAR_U}),'on screen and near: the player sees it');
  assert.ok(pipWanted({...base,carOnScreen:true,distance:PIP_FAR_U+1}),'on screen but far');
  assert.ok(!pipWanted({...base,peeking:true}),'the camera is already on it');
  assert.ok(!pipWanted({...base,now:900}),'a clock going back');
  assert.equal(pipZoom(1),PIP_ZOOM_K);assert.equal(pipZoom(0),.05);assert.equal(pipZoom(NaN),PIP_ZOOM_K);
  assert.ok(peeking(100,100)&&peeking(100,100+PEEK_MS-1)&&!peeking(100,100+PEEK_MS)&&!peeking(undefined,5)&&!peeking(100,50));
});

test('etapa 3: the window camera viewport is its frame inner box in game px (a scaled canvas too)',()=>{
  const inner={left:1000,top:300,width:240,height:150},canvas={left:0,top:0,width:1280,height:800};
  assert.deepEqual(pipViewport(inner,canvas,{width:1280,height:800}),{x:1000,y:300,width:240,height:150});
  assert.deepEqual(pipViewport(inner,canvas,{width:2560,height:1600}),{x:2000,y:600,width:480,height:300},'DPR 2 canvas');
  assert.deepEqual(pipViewport({left:10,top:20,width:0,height:0},{left:10,top:0,width:100,height:100},{width:100,height:100}),{x:0,y:20,width:1,height:1});
});
