/**
 * The mission line (card NEW-20261023-ORQ-inicio-no-uno-caixas-120, src/client/hud/missao.ts): big in the middle for
 * MISSION_BIG_MS, then small at the top; "Volte ao Uno." in the last RETURN_SECONDS of the Minerva and of each time to
 * explore (with the Uno's arrow); after the Minerva, once a run: the towers (only with a kit) then "Eles vão atrás do Uno. Defenda.".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SIM_HZ} from '../../src/contract/index.ts';
import {DEFEND_MS,MISSION_BIG_MS,MISSION_TEXT,MissionTracker,RETURN_SECONDS,TOWERS_MAX_S,durationText,exploreText} from '../../src/client/hud/missao.ts';

const s=(n:number)=>Math.round(n*SIM_HZ);
const START=40,MINERVA_END=START+s(120);

test('the copy: pt-BR, short, no forced exclamation; the window length as people say it',()=>{
  assert.equal(MISSION_TEXT.minerva,'Busque o máximo de caixas e volte ao Uno antes do tempo acabar.');
  for(const line of Object.values(MISSION_TEXT))assert.doesNotMatch(line,/!/);
  assert.equal(exploreText(120),'Você tem 2 minutos para buscar mais caixas. Vá em dupla.');
  assert.deepEqual([60,90,120,150,45].map(durationText),['1 minuto','1 minuto e meio','2 minutos','2 minutos e meio','45 segundos']);
});

test('the Minerva: big for MISSION_BIG_MS, then small; "Volte ao Uno." (urgent, big again) in its last 20 s; the Uno pointed the whole time',()=>{
  const m=new MissionTracker(),at=(tick:number,towerKit=false)=>m.step({tick,minervaAte:MINERVA_END,towerKit,playing:true});
  const first=at(START);
  assert.deepEqual(first.line,{key:'minerva',text:MISSION_TEXT.minerva,big:true,urgent:false});
  assert.equal(first.pointUno,true);
  assert.equal(at(START+s(MISSION_BIG_MS/1000)-1).line?.big,true);
  assert.equal(at(START+s(MISSION_BIG_MS/1000)).line?.big,false,'small at the top after 4 s');
  assert.equal(at(MINERVA_END-s(RETURN_SECONDS)-1).line?.key,'minerva');
  const back=at(MINERVA_END-s(RETURN_SECONDS));
  assert.deepEqual(back.line,{key:'volta',text:'Volte ao Uno.',big:true,urgent:true});
  assert.equal(back.pointUno,true);
  assert.equal(at(MINERVA_END-1).line?.big,false);
});

test('after the Minerva, once: the towers while a kit is in the inventory, then "Eles vão atrás do Uno. Defenda." (big), then nothing',()=>{
  const m=new MissionTracker(),at=(tick:number,towerKit:boolean)=>m.step({tick,minervaAte:MINERVA_END,towerKit,playing:true});
  at(START,true);
  const towers=at(MINERVA_END,true);
  assert.equal(towers.line?.key,'torres');assert.equal(towers.line?.text,'Ponha as torres perto do Uno.');assert.equal(towers.pointUno,false);
  assert.equal(at(MINERVA_END+s(5),true).line?.key,'torres');
  // Placed it (no kit left): "Eles vão atrás do Uno. Defenda." at once, big all along, gone after DEFEND_MS.
  const defend=at(MINERVA_END+s(6),false);
  assert.deepEqual(defend.line,{key:'defenda',text:'Eles vão atrás do Uno. Defenda.',big:true,urgent:false});
  assert.equal(at(MINERVA_END+s(6+DEFEND_MS/1000)-1,false).line?.key,'defenda');
  assert.equal(at(MINERVA_END+s(6+DEFEND_MS/1000),false).line,undefined);
  // Once a run: a kit picked up later says nothing.
  assert.equal(at(MINERVA_END+s(60),true).line,undefined);
});

test('no kit at the end of the Minerva: straight to "Eles vão atrás do Uno. Defenda."; a kit never placed lets go after TOWERS_MAX_S',()=>{
  const a=new MissionTracker();a.step({tick:START,minervaAte:MINERVA_END,towerKit:false,playing:true});
  assert.equal(a.step({tick:MINERVA_END,minervaAte:MINERVA_END,towerKit:false,playing:true}).line?.key,'defenda');
  const b=new MissionTracker();b.step({tick:START,minervaAte:MINERVA_END,towerKit:true,playing:true});
  b.step({tick:MINERVA_END,towerKit:true,playing:true});
  assert.equal(b.step({tick:MINERVA_END+s(TOWERS_MAX_S)-1,towerKit:true,playing:true}).line?.key,'torres');
  assert.equal(b.step({tick:MINERVA_END+s(TOWERS_MAX_S),towerKit:true,playing:true}).line?.key,'defenda');
});

test('each time to explore: "Você tem 2 minutos…" with the real length, big then small, the Uno pointed only in its last 20 s with "Volte ao Uno."',()=>{
  const m=new MissionTracker(),from=5000,explora={from,until:from+s(120)};
  const at=(tick:number)=>m.step({tick,explora,towerKit:false,playing:true});
  const open=at(from);
  assert.deepEqual(open.line,{key:'explora',text:'Você tem 2 minutos para buscar mais caixas. Vá em dupla.',big:true,urgent:false});
  assert.equal(open.pointUno,false);
  assert.equal(at(from+s(10)).line?.big,false);
  const back=at(explora.until-s(RETURN_SECONDS));
  assert.equal(back.line?.key,'volta');assert.equal(back.pointUno,true);
  assert.equal(at(explora.until).line,undefined,'the wave: nothing');
  // The next window opens big again, with its own length.
  const next={from:explora.until+s(80),until:explora.until+s(80+90)};
  assert.equal(m.step({tick:next.from,explora:next,towerKit:false,playing:true}).line?.text,'Você tem 1 minuto e meio para buscar mais caixas. Vá em dupla.');
});

test('a spectator or someone out sees no mission; a rematch (the tick back to 0) starts it over',()=>{
  const m=new MissionTracker();
  assert.equal(m.step({tick:START,minervaAte:MINERVA_END,towerKit:false,playing:false}).line,undefined);
  m.step({tick:MINERVA_END+s(30),towerKit:false,playing:true});
  assert.equal(m.step({tick:START,minervaAte:MINERVA_END,towerKit:false,playing:true}).line?.key,'minerva');
});

test('the HUD mounts the band and the row right under the clock; the Uno arrow is shown by key',()=>{
  const hud=readFileSync(new URL('../../src/client/hud/hud.ts',import.meta.url),'utf8');
  assert.match(hud,/stack\.append\(minerva\.el,mission\.band,mission\.row,/);
  assert.match(hud,/import '\.\/missao\.css';/);
  const css=readFileSync(new URL('../../src/client/hud/missao.css',import.meta.url),'utf8');
  assert.match(css,/\.rh-missao-grande\{[^}]*pointer-events:none/);
  assert.match(css,/\.rh-missao\{[^}]*pointer-events:none/);
  const arrows=readFileSync(new URL('../../src/client/hud/arrows.ts',import.meta.url),'utf8');
  assert.match(arrows,/EDGE_KEYS_SHOWN[^\n]*new Set\(\['uno'\]\)/);
});
