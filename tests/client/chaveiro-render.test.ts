// D-047, card NEW-20261013-ORQ-chaveiro-render: the chaveiro objective's provisional art (boxes in the city's projection),
// its pure render rules, the moto's edge arrow and the minimap's car, moto, delivery and route ahead.
import test from 'node:test';
import assert from 'node:assert/strict';
import {boxFaces,faceBounds,isoOffset,mix,shade,viewTurn,M,type Box} from '../../src/client/render/chaveiro/iso.ts';
import {CAR_HALF,CAR_TOP,carBoxes,fallenParts,fallingPart,motoBoxes,partBit,standingChaveiro} from '../../src/client/render/chaveiro/figures.ts';
import {ALARM_WAVE_LIFE_MS,ALARM_WAVE_MS,OPEN_SECONDS,VOLTA_RADIUS,alarmOn,alarmWaves,chargerLabel,engineShake,hazardLit,headingOf,motoLift,motoPose,newlyFallen,openProgress,routeAhead,routeHeadingAt,trunkOpen,voltaLap} from '../../src/client/render/chaveiro/rules.ts';
import {CAR_PARTS,objectiveOf,type ChaveiroView} from '../../src/client/render/chaveiro/view.ts';
import {HEIGHT_PX} from '../../src/client/render/city/projection.ts';
import * as city from '../../src/client/hud/city/index.ts';
import {EDGE_ICON,EDGE_PRIORITY} from '../../src/client/hud/edges.ts';
import {ICON_NAMES} from '../../src/client/ui/icon.ts';
import {fakeChaveiro} from '../../src/client/sandboxes/sandbox-chaveiro.ts';

const box=(extra:Partial<Box>={}):Box=>({x:0,y:0,z:0,l:2,w:1,h:1,color:0x808080,...extra});
const near=(a:number,b:number,eps=1e-6)=>Math.abs(a-b)<=eps;

test('iso: a world offset turns with the camera like the projector, and a unit up is HEIGHT_PX up the screen',()=>{
  assert.deepEqual(viewTurn(1,0,0),{x:1,y:0});
  assert.deepEqual(viewTurn(1,0,1),{x:-0,y:1});
  assert.deepEqual(viewTurn(1,0,2),{x:-1,y:-0});
  assert.deepEqual(viewTurn(1,0,3),{x:0,y:-1});
  assert.deepEqual(isoOffset(1,0,0,0),{x:42,y:21});
  assert.equal(isoOffset(0,0,1,0).y,-HEIGHT_PX);
  // The hero (1.75 m) is 1.245 u tall: the figures are in metres × M.
  assert.ok(near(1.75*M,1.245));
});

test('iso: a box shows its top and only the sides facing the screen, the lit side lighter than the shaded one',()=>{
  for(let view=0;view<4;view++)for(const heading of [0,.4,1.3,Math.PI,-2]){
    const faces=boxFaces([box()],heading,view);
    assert.ok(faces.length===3||faces.length===2,`view ${view} heading ${heading}: ${faces.length} faces`);
    // The top is the base colour and comes last.
    assert.equal(faces[faces.length-1].color,0x808080);
  }
  // View 0, heading 0: the +x side faces the screen's lower right (shade), the +y side its lower left (sun).
  const [a,b]=boxFaces([box()],0,0),avg=(c:number)=>(c>>16&255);
  assert.ok(avg(a.color)!==avg(b.color));
  assert.ok(Math.max(avg(a.color),avg(b.color))<128,'sides are darker than the top');
  assert.equal(shade(0x808080,.5),0x404040);assert.equal(shade(0xffffff,2),0xffffff);
  assert.equal(mix(0x000000,0xffffff,.5),0x808080);
});

test('iso: a higher layer draws after a lower one; inside a layer, the far box first',()=>{
  // The tops keep the base colour: their order is the boxes' order.
  const far=box({x:-3,color:0x100000}),front=box({x:3,color:0x200000}),top=box({x:-3,z:1,color:0x300000,layer:1});
  const tops=(boxes:Box[],view:number)=>boxFaces(boxes,0,view).map(f=>f.color).filter(c=>boxes.some(b=>b.color===c));
  assert.deepEqual(tops([front,top,far],0),[0x100000,0x200000,0x300000]);
  // Turned half a lap, the front box is the far one.
  assert.deepEqual(tops([front,far],2),[0x200000,0x100000]);
  const b=faceBounds(boxFaces([box()],0,0));
  assert.ok(b.x0<0&&b.x1>0&&b.y0<-HEIGHT_PX*.9&&b.y1>0);
});

test('figures: the Quadradão is a hatch at the hero\'s scale; fallen parts leave it and lie around it',()=>{
  const whole=carBoxes({parts:0,hazard:false,trunk:0,wrecked:false});
  const top=Math.max(...whole.map(b=>b.z+b.h));
  assert.ok(near(top,1.47*M,.01),'roof ≈ 1.47 m');
  assert.ok(top<1.245,'lower than the hero');
  assert.ok(near(CAR_TOP,1.45*M)&&CAR_HALF.l>CAR_HALF.w);
  const all=(parts:number)=>carBoxes({parts,hazard:false,trunk:0,wrecked:false}).length;
  assert.equal(all(15),whole.length-5,'bumper, 2 mirrors, door, hood fall off');
  assert.equal(fallenParts(0).length,0);
  assert.equal(fallenParts(15).length,4);
  assert.equal(fallenParts(15,partBit('porta')).length,3,'a part still falling is not on the ground yet');
  for(const b of fallenParts(15))assert.equal(b.z,0,'on the ground');
  // A falling part starts on the car and ends where it lies.
  const start=fallingPart('capo',0)[0],end=fallingPart('capo',1)[0];
  assert.ok(start.z>.5&&end.z===0);
  assert.deepEqual(CAR_PARTS.map(p=>partBit(p)),[1,2,4,8]);
  // Hazard lights turn the lamps Cone; the trunk lid moves with the end scene; wrecked paint is darker.
  const lit=carBoxes({parts:0,hazard:true,trunk:0,wrecked:false});
  assert.equal(lit.filter(b=>b.color===0xff7a1f).length,4);
  assert.ok(carBoxes({parts:0,hazard:false,trunk:1,wrecked:false}).length>whole.length);
});

test('figures: the moto carries the chaveiro (bag) and Cida (tray), parks with Cida alone, falls on its side',()=>{
  const sitting=motoBoxes('sitting'),parked=motoBoxes('parked'),fallen=motoBoxes('fallen');
  assert.ok(parked.length<sitting.length,'he is away');
  const top=Math.max(...sitting.map(b=>b.z+b.h));
  assert.ok(top>1.245&&top<2*M+.1,'the tray on Cida\'s head stands a bit over the hero');
  assert.ok(Math.max(...fallen.map(b=>b.z+b.h))<1.1*M,'fallen: everything low');
  assert.ok(Math.min(...motoBoxes('sitting',.05).filter(b=>(b.layer??0)>=1).map(b=>b.z))>.05,'the bounce lifts all but the wheels');
  assert.equal(standingChaveiro(0,0,true).length,4);
  assert.equal(standingChaveiro(0,0,false).length,5);
});

test('rules: alarm, hazard blink, fallen parts, poses and motion',()=>{
  assert.equal(alarmOn({alarmUntil:10},9),true);assert.equal(alarmOn({alarmUntil:10},10),false);
  assert.equal(hazardLit(false,0),false);assert.equal(hazardLit(true,0),true);assert.equal(hazardLit(true,260),false);
  assert.deepEqual(newlyFallen(0b0001,0b0111),[1,2]);assert.deepEqual(newlyFallen(0b1111,0b1111),[]);
  assert.equal(motoPose('tombo'),'fallen');assert.equal(motoPose('entrega'),'parked');assert.equal(motoPose('abrindo'),'parked');
  for(const m of ['anda','lombada','morta','volta'] as const)assert.equal(motoPose(m),'sitting');
  assert.equal(motoLift('morta',123,false),0);assert.equal(motoLift('anda',123,true),0);
  assert.ok(motoLift('lombada',400,false)>0);
  const lap=voltaLap(900);assert.ok(near(Math.hypot(lap.dx,lap.dy),VOLTA_RADIUS));
  assert.equal(headingOf({x:0,y:0},{x:0,y:1},5),Math.PI/2);assert.equal(headingOf({x:0,y:0},{x:.001,y:0},5),5);
  assert.deepEqual(engineShake(100,true,true),{x:0,y:0});
  assert.equal(openProgress(OPEN_SECONDS),0);assert.equal(openProgress(0),1);assert.equal(openProgress(7.5),.5);
  assert.equal(trunkOpen(0),0);assert.equal(trunkOpen(5000),1);
  assert.equal(chargerLabel(0),false);assert.equal(chargerLabel(5000),true);
});

test('rules: alarm waves leave every ALARM_WAVE_MS, newest last, and live ALARM_WAVE_LIFE_MS; none when silent or reduced',()=>{
  assert.deepEqual(alarmWaves(undefined,1000,false),[]);
  assert.deepEqual(alarmWaves(0,1000,true),[]);
  assert.deepEqual(alarmWaves(0,0,false),[0]);
  const w=alarmWaves(0,5000,false);
  assert.ok(w.length>=Math.floor(ALARM_WAVE_LIFE_MS/ALARM_WAVE_MS)&&w.length<=Math.ceil(ALARM_WAVE_LIFE_MS/ALARM_WAVE_MS));
  for(let i=1;i<w.length;i++)assert.ok(w[i]<w[i-1],'newest last');
  assert.ok(w.every(t=>t>=0&&t<1));
});

test('rules: the route ahead starts at the moto and ends at the car; the bump lies across the route',()=>{
  const route=[{x:0,y:0},{x:10,y:0},{x:10,y:10}];
  const ahead=routeAhead(route,{x:4,y:.5});
  assert.deepEqual(ahead[0],{x:4,y:.5});assert.deepEqual(ahead[1],{x:4,y:0});assert.deepEqual(ahead.at(-1),{x:10,y:10});
  assert.equal(ahead.length,4);
  assert.deepEqual(routeAhead(route,{x:10.2,y:6}).slice(1),[{x:10,y:6},{x:10,y:10}]);
  assert.equal(routeHeadingAt(route,{x:3,y:.1}),0);
  assert.equal(routeHeadingAt(route,{x:10,y:7}),Math.PI/2);
  assert.equal(routeHeadingAt(undefined,{x:0,y:0}),0);
});

const view=(extra:Partial<ChaveiroView>={}):ChaveiroView=>({moto:{x:84.5,y:40,mode:'anda'},etaS:300,alarmUntil:0,car:{x:84.5,y:84.5,hits:20,limit:80,parts:1},
  route:[{x:84.5,y:0},{x:84.5,y:74},{x:82,y:86}],...extra});

test('minimap: the car takes the base\'s place with the hits left on its ring; the moto (Cone when it needs the team), the delivery, the route ahead',()=>{
  const map=city.DEFAULT_CITY,input={map,view:0 as const,selfId:'p1',players:[{id:'p1',x:84.5,y:120}],enemies:[]};
  const marks=city.cityMinimapMarks({...input,chaveiro:view({delivery:{x:84.5,y:60,etaS:20}})});
  assert.ok(!marks.some(m=>m.kind==='base'));
  const car=marks.find(m=>m.kind==='carro')!;assert.equal(car.hp,.75);
  assert.ok(marks.some(m=>m.kind==='moto'&&!m.danger));
  assert.ok(marks.some(m=>m.kind==='entrega'));
  assert.ok(city.cityMinimapMarks({...input,chaveiro:view({moto:{x:84.5,y:40,mode:'morta',push:.3}})}).some(m=>m.kind==='moto'&&m.danger));
  // Without the objective, the base as before.
  assert.ok(city.cityMinimapMarks(input).some(m=>m.kind==='base'));
  const route=city.cityMinimapRoute({...input,chaveiro:view()});
  assert.equal(route.length,4);assert.deepEqual(route[0],city.cityMinimapPoint({x:84.5,y:40},0));
  assert.deepEqual(city.cityMinimapRoute({...input,chaveiro:view({ended:'victory'})}),[]);
  assert.ok(!city.cityMinimapMarks({...input,chaveiro:view({ended:'victory'})}).some(m=>m.kind==='moto'));
  assert.ok(city.CITY_DRAW_ORDER.moto>city.CITY_DRAW_ORDER.carro&&city.CITY_DRAW_ORDER.moto<city.CITY_DRAW_ORDER.voce);
});

test('edges: the moto gets an arrow when out of view (Cone while dead or fallen, none at the car), ranked after the mouths',()=>{
  const map=city.DEFAULT_CITY,locate=(p:{x:number;y:number})=>({x:p.x*10,y:p.y*10});
  const base={hero:{x:84.5,y:120},selfId:'p1',players:[],enemies:[],map,phase:'wave' as const,locate,isOnScreen:()=>false};
  const moto=(mode:ChaveiroView['moto']['mode'])=>city.cityEdgeTargets({...base,moto:{x:84.5,y:40,mode}}).targets.find(t=>t.kind==='moto');
  const a=moto('anda')!;assert.equal(a.danger,undefined);assert.equal(a.name,'Chaveiro');assert.equal(a.distance,80);
  assert.equal(moto('morta')!.danger,true);assert.equal(moto('tombo')!.danger,true);
  assert.equal(moto('abrindo'),undefined);
  assert.equal(city.cityEdgeTargets({...base,isOnScreen:()=>true,moto:{x:84.5,y:40,mode:'anda'}}).targets.length,0);
  assert.equal(city.cityEdgeRank(a),3.5);
  assert.ok(city.motoNeedsTeam('morta')&&!city.motoNeedsTeam('lombada'));
  const arrows=city.layoutCityEdges([a],{x:0,y:0,width:390,height:844},undefined,{});
  assert.equal(arrows.length,1);assert.equal(arrows[0].kind,'moto');
  assert.equal(EDGE_ICON.moto,'moto');assert.ok((ICON_NAMES as readonly string[]).includes('moto'));
  assert.ok(EDGE_PRIORITY.moto>EDGE_PRIORITY.obra);
});

test('objectiveOf reads RunView.objective loosely; the sandbox\'s fake objective is deterministic and walks its route',()=>{
  assert.equal(objectiveOf({}),undefined);assert.equal(objectiveOf(undefined),undefined);
  assert.equal(objectiveOf({objective:view()})?.etaS,300);
  const params=new URLSearchParams('moto=anda&cai=1');
  const fake=fakeChaveiro(params,{x:84,y:84},{x:84,y:0},{x:84,y:72});
  const a=fake.view(1000),b=fake.view(1000),c=fake.view(21000);
  assert.deepEqual(a,b);
  assert.ok(c.view.moto.y>a.view.moto.y,'he rides toward the plaza');
  assert.equal(a.view.car.parts,0);assert.equal(fake.view(2600).view.car.parts,1);assert.equal(fake.view(10100).view.car.parts,15);
  assert.equal(c.view.route!.length,3);
  assert.equal(c.view.stops!.filter(s=>s.kind==='morta').length,3);
  const dead=fakeChaveiro(new URLSearchParams('moto=morta&empurra=.4'),{x:84,y:84}).view(0).view;
  assert.equal(dead.moto.mode,'morta');assert.equal(dead.moto.push,.4);
  const end=fakeChaveiro(new URLSearchParams('fim=derrota'),{x:84,y:84}).view(0).view;
  assert.equal(end.ended,'defeat');assert.equal(end.car.parts,15);assert.equal(end.car.hits,80);
});
