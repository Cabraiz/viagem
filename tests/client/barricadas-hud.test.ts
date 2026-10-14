// NEW-20261012-E5-cidade-barricadas-cliente (front B): the forge window at a city barricade. Which mouth a barricade
// structure closes (its wire id is s<n>, the mouth comes from the asset's bocas), the barricade the hero stands at, the
// tag's texts and refusals, the window's place, towers counted only by their kind, and the forge tap's `target`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {barricadeAt,barricadeTarget,mouthOf,MOUTH_NAMES,BARRICADE_KIND,type CityBocas} from '../../src/client/hud/city/index.ts';
import {barricadeBlocked,barricadeText,blockedReason,forgePlace,isTower,MAX_TOWERS} from '../../src/client/hud/camp.ts';
import {CAMP_RADIUS,FORGE_REFUSALS,RECIPES,isForgeTarget} from '../../src/rules/stonewards.ts';
import type {RunView,StructureView} from '../../src/contract/view.ts';
import {fakeView} from '../../src/client/hud/fixtures.ts';

const city=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8')) as {points:{bocas:CityBocas;praca:{x:number;y:number}}};
const bocas=city.points.bocas;
const fence=(id:string,at:{x:number;y:number},hp=300):StructureView=>({id,kind:BARRICADE_KIND,x:at.x,y:at.y,hp,maxHp:300});

test('the mouth of a barricade is the nearest boca; no asset, no mouth',()=>{
  for(const m of ['N','S','L','O'] as const){
    assert.equal(mouthOf(bocas[m],bocas),m);
    assert.equal(mouthOf({x:bocas[m].x+.3,y:bocas[m].y-.2},bocas),m,'wire positions are rounded');
    assert.ok(isForgeTarget(barricadeTarget(m)),'the room accepts the target');
  }
  assert.equal(mouthOf(bocas.N,undefined),undefined);
  assert.deepEqual(Object.values(MOUTH_NAMES),['Norte','Sul','Leste','Oeste']);
});

test('the barricade the hero stands at: nearest within CAMP_RADIUS, by wire label s<n>, only kind barricada',()=>{
  const wall:StructureView={id:'s1',kind:'muralha',x:city.points.praca.x,y:city.points.praca.y,hp:600,maxHp:600};
  const list=[wall,fence('s7',bocas.N),fence('s8',bocas.S,0),fence('s9',bocas.L),fence('s10',bocas.O)];
  const atN=barricadeAt({x:bocas.N.x,y:bocas.N.y-CAMP_RADIUS},list,bocas,CAMP_RADIUS);
  assert.deepEqual(atN&&{id:atN.structure.id,mouth:atN.mouth,target:atN.target,name:atN.name,down:atN.down},{id:'s7',mouth:'N',target:'barricada-N',name:'Norte',down:false});
  assert.equal(barricadeAt({x:bocas.N.x,y:bocas.N.y-CAMP_RADIUS-.01},list,bocas,CAMP_RADIUS),undefined,'just out of reach');
  const atS=barricadeAt(bocas.S,list,bocas,CAMP_RADIUS);
  assert.equal(atS?.target,'barricada-S');assert.equal(atS?.down,true,'hp 0 on the wire: fallen');
  assert.equal(barricadeAt(bocas.N,list,undefined,CAMP_RADIUS),undefined,'off the city (no bocas): never');
  assert.equal(barricadeAt(undefined,list,bocas,CAMP_RADIUS),undefined);
  // The island: a wall and towers only.
  assert.equal(barricadeAt({x:0,y:0},[{...wall,x:0,y:0},{id:'s2',kind:'torre-chinelo',x:0,y:0,hp:1,maxHp:1}],bocas,CAMP_RADIUS),undefined);
});

test('the barricade tag: pt-BR texts, refusals in the server\'s order, the same price as the wall repair',()=>{
  const up=barricadeText({name:'Norte',down:false}),down=barricadeText({name:'Sul',down:true});
  assert.deepEqual(up,{name:'Reparar barricada Norte',describe:'Conserta 25% da barricada',done:'Barricada Norte consertada!'});
  assert.deepEqual(down,{name:'Reerguer barricada Sul',describe:'Levanta de novo com 25% da vida',done:'Barricada Sul de pé!'});
  for(const t of [up,down]){
    assert.ok(t.describe.length<=40);
    // Design checklist: no "PALAVRA — fragmento", no arrows, no shouting outside a stamp.
    for(const s of Object.values(t))assert.ok(!/[—→·]/.test(s)&&!/[A-Z]{2}/.test(s),s);
  }
  // The forge is paid in Grana (D-048): the barricade's repair is the wall's, R$ 5.
  const rich={units:0,grana:18},s=fence('s7',bocas.N,100);
  assert.equal(barricadeBlocked({structure:s,down:false},rich),undefined);
  assert.equal(barricadeBlocked({structure:{...s,hp:300},down:false},rich),'full');
  assert.equal(barricadeBlocked({structure:{...s,hp:0},down:true},rich),undefined,'a fallen one can be raised');
  assert.equal(barricadeBlocked({structure:s,down:false},{units:999,grana:RECIPES.reparo.cost-1}),'balance','material does not pay the forge');
  assert.equal(barricadeBlocked({structure:s,down:false},{...rich,wallDown:true}),'wall-down');
  assert.equal(barricadeBlocked({structure:s,down:false},undefined),'phase');
  for(const reason of ['blocked','target','away','full'])assert.ok(FORGE_REFUSALS[reason],reason);
});

test('the window\'s place: the camp (Forja) or a barricade (Barricada); away from the wall the forge refuses with away',()=>{
  const spot={structure:fence('s7',bocas.N),mouth:'N' as const,target:'barricada-N',name:'Norte',down:false};
  assert.deepEqual(forgePlace(true,undefined),{open:true,away:false,title:'Forja',barricadeFirst:false,key:'base'});
  assert.deepEqual(forgePlace(false,spot),{open:true,away:true,title:'Barricada',barricadeFirst:true,key:'barricada-N'});
  assert.deepEqual(forgePlace(true,spot),{open:true,away:false,title:'Forja',barricadeFirst:false,key:'base'});
  assert.equal(forgePlace(false,undefined).open,false);
  const v={...fakeView('camp-forge',1),camp:{units:40,grana:40}} as RunView;
  for(const id of ['reparo','gambiarra','torre-chinelo'] as const){
    assert.equal(blockedReason(id,v,'p1',true),'away',id);
    assert.equal(blockedReason(id,v,'p1'),undefined,`${id}: in the camp, as before`);
  }
  assert.equal(blockedReason('reparo',{...v,camp:{...v.camp!,wallDown:true}},'p1',true),'wall-down','the wall first, like the server');
});

test('towers are counted only by their kind: four barricades never fill the tower cap',()=>{
  const v={...fakeView('camp-forge',1),camp:{units:40,grana:40}} as RunView;
  const fences=(['N','S','L','O'] as const).map((m,i)=>fence(`s${i+5}`,bocas[m]));
  assert.ok(fences.length>=MAX_TOWERS);
  assert.equal(blockedReason('torre-chinelo',{...v,structures:[...v.structures,...fences]},'p1'),undefined);
  const towers=Array.from({length:MAX_TOWERS},(_,i)=>({id:`t${i}`,kind:'torre-chinelo',x:0,y:0,hp:80,maxHp:80}));
  assert.equal(blockedReason('torre-chinelo',{...v,structures:[...v.structures,...fences,...towers]},'p1'),'full');
  assert.deepEqual(['muralha','barricada','torre-chinelo'].map(kind=>isTower({kind})),[false,false,true]);
});

test('net.forge sends target only when given; the HUD and explore pass it through',()=>{
  const read=(path:string)=>readFileSync(new URL(`../../src/client/${path}`,import.meta.url),'utf8');
  assert.match(read('net/client.ts'),/forge\(recipe:string,target\?:string\)\{[\s\S]{0,300}\.\.\.\(target===undefined\?\{\}:\{target\}\)/);
  assert.match(read('explore.ts'),/onForge:\(recipe,target\)=>net\.forge\(recipe,target\)/);
  assert.match(read('hud/hud.ts'),/this\.camp\.setBocas\(/);
  // The wall's tags never name a target: an older room (or the island) sees exactly the old message.
  assert.match(read('hud/camp.ts'),/at\?options\.onForge\(recipe,at\.target\):options\.onForge\(recipe\)/);
});
