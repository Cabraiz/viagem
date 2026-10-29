/**
 * The mission line (card NEW-20261023-ORQ-inicio-no-uno-caixas-120, src/client/hud/missao.ts): big in the middle for
 * MISSION_BIG_MS, then small at the top; "Volte ao Uno." in the last RETURN_SECONDS of the Minerva and of each time to
 * explore (with the Uno's arrow); after the Minerva, once a run: the towers (only with a kit) then "Eles vão atrás do Uno. Defenda.".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SIM_HZ} from '../../src/contract/index.ts';
import {DARK_PRESS,DEFEND_LATE_S,DEFEND_MS,MISSION_BIG_MS,MISSION_TEXT,MissionTracker,ORDER_GAP_S,RETURN_SECONDS,TOWERS_MAX_S,UNO_LEAVE_U,UNO_NEAR_U,missionFacts} from '../../src/client/hud/missao.ts';
import {MOTO_ACTIONS} from '../../src/client/hud/chaveiro.ts';
import {missionKeys,nestKey,nestTarget,shownTargets} from '../../src/client/hud/arrows.ts';

const s=(n:number)=>Math.round(n*SIM_HZ);
const START=40,MINERVA_END=START+s(120);

test('the copy: pt-BR, short (one row on the phone), no forced exclamation',()=>{
  assert.equal(MISSION_TEXT.minerva,'Junte caixas e volte ao Uno.');
  // Only the dark's "Volte ao Uno!" shouts (card objetivo-com-verbo: when the dark presses).
  for(const [key,line] of Object.entries(MISSION_TEXT))if(key!=='escuro')assert.doesNotMatch(line,/!/);
  assert.equal(MISSION_TEXT.explora,'Junte mais caixas, em dupla.');
  // One row on a 393 px phone (item 6): short lines, the top's clock says the time.
  for(const line of Object.values(MISSION_TEXT))assert.ok(line.length<=31,`${line} (${line.length})`);
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

test('after the Minerva, once: the towers while a kit is in the inventory; placed inside the gap, "Defenda." waits and is dropped late',()=>{
  const m=new MissionTracker(),at=(tick:number,towerKit:boolean)=>m.step({tick,minervaAte:MINERVA_END,towerKit,playing:true});
  at(START,true);
  const towers=at(MINERVA_END,true);
  assert.equal(towers.line?.key,'torres');assert.equal(towers.line?.text,'Ponha as torres perto do Uno.');assert.equal(towers.pointUno,false);
  assert.equal(at(MINERVA_END+s(5),true).line?.key,'torres');
  // Placed it (no kit left) 6 s into the towers' order: "Defenda." would be a second order inside the gap (ordens-menos-e-claras).
  assert.equal(at(MINERVA_END+s(6),false).line,undefined,'the towers done, the gap still closed: an empty line');
  assert.equal(at(MINERVA_END+s(6+DEFEND_LATE_S),false).line,undefined,'too late for the wave start: dropped');
  assert.equal(at(MINERVA_END+s(ORDER_GAP_S),false).line,undefined,'the gap open, nothing left to say');
  // Once a run: a kit picked up later says nothing.
  assert.equal(at(MINERVA_END+s(60),true).line,undefined);
});

test('no kit at the end of the Minerva: straight to "Eles vão atrás do Uno. Defenda."; a kit never placed lets go after TOWERS_MAX_S',()=>{
  const a=new MissionTracker();a.step({tick:START,minervaAte:MINERVA_END,towerKit:false,playing:true});
  const defend=a.step({tick:MINERVA_END,minervaAte:MINERVA_END,towerKit:false,playing:true});
  assert.deepEqual(defend.line,{key:'defenda',text:'Eles vão atrás do Uno. Defenda.',big:true,urgent:false});
  assert.equal(a.step({tick:MINERVA_END+s(DEFEND_MS/1000)-1,towerKit:false,playing:true}).line?.key,'defenda');
  assert.equal(a.step({tick:MINERVA_END+s(DEFEND_MS/1000),towerKit:false,playing:true}).line,undefined,'gone after DEFEND_MS');
  const b=new MissionTracker();b.step({tick:START,minervaAte:MINERVA_END,towerKit:true,playing:true});
  b.step({tick:MINERVA_END,towerKit:true,playing:true});
  assert.equal(b.step({tick:MINERVA_END+s(TOWERS_MAX_S)-1,towerKit:true,playing:true}).line?.key,'torres');
  assert.equal(b.step({tick:MINERVA_END+s(TOWERS_MAX_S),towerKit:true,playing:true}).line?.key,'defenda');
});

test('each time to explore: "Junte mais caixas, em dupla.", big then small, the Uno pointed only in its last 20 s with "Volte ao Uno."',()=>{
  const m=new MissionTracker(),from=5000,explora={from,until:from+s(120)};
  const at=(tick:number)=>m.step({tick,explora,towerKit:false,playing:true});
  const open=at(from);
  assert.deepEqual(open.line,{key:'explora',text:'Junte mais caixas, em dupla.',big:true,urgent:false});
  assert.equal(open.pointUno,false);
  assert.equal(at(from+s(10)).line?.big,false);
  const back=at(explora.until-s(RETURN_SECONDS));
  assert.equal(back.line?.key,'volta');assert.equal(back.pointUno,true);
  assert.equal(back.line?.text,'Volte ao Uno.','the last seconds of a time to explore say come back, not the explore line (video etapa 3)');assert.equal(back.line?.urgent,true);
  assert.equal(at(explora.until).line,undefined,'the wave: nothing');
  // The next window opens big again.
  const next={from:explora.until+s(80),until:explora.until+s(80+90)};
  assert.equal(m.step({tick:next.from,explora:next,towerKit:false,playing:true}).line?.big,true);
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

// Card objetivo-com-verbo (auditoria-jogabilidade item 8): one sentence with a verb, with its target's arrow.
const view=(o:{chests?:number[];nests?:{hp:number;x:number}[];moto?:string;fear?:number;ended?:boolean}={})=>({
  players:(o.chests??[0]).map((c,i)=>({id:`p${i+1}`,stats:{damage:0,kills:0,revives:0,pickups:0,chests:c},...(i===0&&o.fear!==undefined?{fear:o.fear}:{})})),
  structures:(o.nests??[]).map((n,i)=>({id:`ninho-${i}`,kind:'ninho',x:n.x,y:0,hp:n.hp,maxHp:40,phase:n.hp>0?'dormindo':'destruido'})),
  ...(o.moto?{objective:{car:{x:3,y:4},moto:{x:0,y:0,mode:o.moto},ended:!!o.ended}}:{}),
}) as unknown as Parameters<typeof missionFacts>[0];

test('the facts: the team\'s crates, the nests standing and the nearest to the hero, the moto, the dark',()=>{
  const f=missionFacts(view({chests:[2,1],nests:[{hp:0,x:1},{hp:40,x:30},{hp:40,x:12}],moto:'morta',fear:.3}),'p1',{x:0,y:0});
  assert.deepEqual(f,{crates:3,nests:{alive:2,nearest:{id:'ninho-2',x:12,y:0}},moto:'morta',uno:5,dark:.3});
  assert.deepEqual(missionFacts(view({moto:'tombo',ended:true}),'p1'),{crates:0},'an ended objective has no moto');
});

test('the Minerva and the explore count the crates the team opened in this window: "Junte caixas (2)"',()=>{
  const m=new MissionTracker();
  const at=(tick:number,crates:number)=>m.step({tick,minervaAte:MINERVA_END,towerKit:false,playing:true,facts:{crates}});
  assert.equal(at(START,5).line?.text,MISSION_TEXT.minerva,'no crate yet this window: the whole sentence');
  const two=at(START+s(2),7);
  assert.equal(two.line?.text,'Junte caixas (2)');assert.equal(two.line?.big,true);
  assert.equal(at(START+s(10),8).line?.big,false,'a new count keeps the same line (no new band)');
  const from=MINERVA_END+s(60),explora={from,until:from+s(120)};
  const ex=(tick:number,crates:number)=>m.step({tick,explora,towerKit:false,playing:true,facts:{crates}});
  assert.equal(ex(from,9).line?.text,MISSION_TEXT.explora,'the count starts over in each window');
  assert.equal(ex(from+s(5),10).line?.text,'Junte caixas em dupla (1)');
  for(const n of [9,99])for(const text of [`Junte caixas (${n})`,`Junte caixas em dupla (${n})`])assert.ok(text.length<=31,text);
});

test('the dark pressing says "Volte ao Uno!" over every line, urgent, with the Uno\'s arrow',()=>{
  const m=new MissionTracker();
  const calm=m.step({tick:START,minervaAte:MINERVA_END,towerKit:false,playing:true,facts:{dark:DARK_PRESS-.01}});
  assert.equal(calm.line?.key,'minerva');
  const dark=m.step({tick:START+1,minervaAte:MINERVA_END,towerKit:false,playing:true,facts:{dark:DARK_PRESS}});
  assert.deepEqual(dark.line,{key:'escuro',text:'Volte ao Uno!',big:true,urgent:true});
  assert.equal(dark.pointUno,true);assert.deepEqual(dark.arrow,{kind:'uno',urgent:true});
});

test('the moto stopped for the team: a verb and the moto\'s arrow; the reason row leaves those two to the line',()=>{
  const m=new MissionTracker();
  const dead=m.step({tick:START,towerKit:false,playing:true,facts:{moto:'morta'}});
  assert.deepEqual(dead.line,{key:'moto',text:'Moto do chaveiro: vá empurrar',big:true,urgent:true},'the chaveiro named: the moto is his, the Uno the team\'s');
  assert.deepEqual(dead.arrow,{kind:'moto'});
  // The other verb is a new order: inside the gap it waits (the line empties: "vá empurrar" no longer holds).
  assert.equal(m.step({tick:START+1,towerKit:false,playing:true,facts:{moto:'tombo'}}).line,undefined);
  const fell=m.step({tick:START+s(ORDER_GAP_S),towerKit:false,playing:true,facts:{moto:'tombo'}});
  assert.equal(fell.line?.text,'Chaveiro caiu: tire os bichos');assert.equal(fell.line?.big,true);
  assert.equal(m.step({tick:START+s(ORDER_GAP_S)+1,towerKit:false,playing:true,facts:{moto:'anda'}}).line,undefined);
  for(const text of Object.values(MOTO_ACTIONS))assert.ok(text!.length<=31,text);
});

test('the nests mode out of a window: "Derrube os ninhos (5)" with the nearest nest\'s arrow; none standing, no line',()=>{
  const m=new MissionTracker(),nearest={id:'ninho-3',x:4,y:5};
  const out=m.step({tick:START,towerKit:false,playing:true,facts:{nests:{alive:5,nearest}}});
  assert.deepEqual(out.line,{key:'ninhos',text:'Derrube os ninhos (5)',big:true,urgent:false});
  assert.deepEqual(out.arrow,{kind:'ninho',...nearest});
  assert.equal(out.pointUno,false);
  assert.equal(m.step({tick:START+s(5),towerKit:false,playing:true,facts:{nests:{alive:4,nearest}}}).line?.text,'Derrube os ninhos (4)');
  assert.equal(m.step({tick:START+s(6),towerKit:false,playing:true,facts:{nests:{alive:0}}}).line,undefined);
  // The moto outranks the nests, once the gap opens (the nests line holds until then).
  assert.equal(m.step({tick:START+s(7),towerKit:false,playing:true,facts:{nests:{alive:3},moto:'morta'}}).line?.key,'ninhos');
  assert.equal(m.step({tick:START+s(ORDER_GAP_S),towerKit:false,playing:true,facts:{nests:{alive:3},moto:'morta'}}).line?.key,'moto');
});

test('the arrows: the moto and the nearest nest join the shown keys only while the line points there',()=>{
  const moto={kind:'moto' as const,key:'moto'},nest=nestTarget({id:'n1',x:3,y:4},{x:0,y:0},p=>p);
  assert.equal(nest.key,nestKey('n1'));assert.equal(nest.distance,5);assert.equal(nest.kind,'spawn');
  assert.deepEqual(shownTargets([moto,nest]),[]);
  assert.deepEqual(shownTargets([moto,nest],missionKeys({kind:'moto'})),[moto]);
  assert.deepEqual(shownTargets([moto,nest],missionKeys({kind:'ninho',id:'n1',x:3,y:4})),[nest]);
  assert.equal(missionKeys({kind:'uno',urgent:false}),undefined);
  const rescue=readFileSync(new URL('../../src/client/hud/rescue.ts',import.meta.url),'utf8');
  assert.match(rescue,/shownTargets\(targets,missionKeys\(aim\)\)/);
  const hud=readFileSync(new URL('../../src/client/hud/hud.ts',import.meta.url),'utf8');
  assert.match(hud,/facts:missionFacts\(view,this\.ctx\.localId,this\.routeInput\?\.hero\)/);
});

// Card ordens-menos-e-claras (auditoria-primeiro-minuto item 5): one new order every ORDER_GAP_S at most.
type Facts=NonNullable<Parameters<MissionTracker['step']>[0]['facts']>;

test('the gap: a new order at most every ORDER_GAP_S; the most important one wanted when it opens wins',()=>{
  const m=new MissionTracker(),at=(tick:number,facts:Facts)=>m.step({tick,towerKit:false,playing:true,facts});
  assert.equal(at(START,{nests:{alive:5}}).line?.key,'ninhos');
  assert.equal(m.orderRecent(START+s(ORDER_GAP_S)-1),true);assert.equal(m.orderRecent(START+s(ORDER_GAP_S)),false);
  // 1.4 s later the moto falls (the phone's log): the nests line holds, small after 4 s.
  const held=at(START+s(1.4),{nests:{alive:5,nearest:{id:'n1',x:1,y:1}},moto:'tombo'});
  assert.equal(held.line?.key,'ninhos');assert.equal(held.arrow?.kind,'ninho');
  assert.equal(at(START+s(10),{nests:{alive:5},moto:'tombo'}).line?.big,false);
  const moto=at(START+s(ORDER_GAP_S),{nests:{alive:5},moto:'tombo'});
  assert.equal(moto.line?.key,'moto');assert.equal(moto.line?.big,true);assert.deepEqual(moto.arrow,{kind:'moto'});
  // The moto up again 5 s later: "tire os bichos" no longer holds, and the nests wait out the gap (an empty line).
  assert.equal(at(START+s(ORDER_GAP_S+5),{nests:{alive:4}}).line,undefined);
  assert.equal(at(START+s(2*ORDER_GAP_S),{nests:{alive:4}}).line?.key,'ninhos');
});

test('the gap: the nests count changing is the same order (no new band, the gap not restarted)',()=>{
  const m=new MissionTracker(),at=(tick:number,alive:number)=>m.step({tick,towerKit:false,playing:true,facts:{nests:{alive}}});
  at(START,5);
  const four=at(START+s(6),4);
  assert.equal(four.line?.text,'Derrube os ninhos (4)');assert.equal(four.line?.big,false);
  assert.equal(m.orderAge(START+s(6)),s(6));
});

test('"Volte ao Uno." is not shown with the hero at the Uno (UNO_NEAR_U), back past UNO_LEAVE_U; the arrow still points',()=>{
  const m=new MissionTracker(),at=(tick:number,uno:number)=>m.step({tick,minervaAte:MINERVA_END,towerKit:false,playing:true,facts:{uno}});
  at(START,20);
  const t=MINERVA_END-s(RETURN_SECONDS);
  const near=at(t,UNO_NEAR_U);
  assert.equal(near.line,undefined,'at the Uno: no "Volte ao Uno."');assert.equal(near.pointUno,true);
  assert.equal(at(t+1,UNO_LEAVE_U).line,undefined,'between 4 and 5 u: still at the Uno (no blink)');
  const far=at(t+2,UNO_LEAVE_U+.1);
  assert.equal(far.line?.key,'volta');assert.equal(far.line?.big,true);
  assert.equal(at(t+3,UNO_LEAVE_U).line?.key,'volta','walking back: the line holds until UNO_NEAR_U');
  assert.equal(at(t+4,UNO_NEAR_U).line,undefined);
});

test('the dark goes over the gap and does not count as an order',()=>{
  const m=new MissionTracker(),at=(tick:number,dark:number)=>m.step({tick,towerKit:false,playing:true,facts:{nests:{alive:5},moto:'tombo',dark}});
  m.step({tick:START,towerKit:false,playing:true,facts:{nests:{alive:5}}});
  assert.equal(at(START+s(2),DARK_PRESS).line?.key,'escuro');
  assert.equal(m.orderAge(START+s(2)),s(2),'the gap still counts from the nests');
  assert.equal(at(START+s(3),0).line?.key,'ninhos');
});

test('the fear\'s notice waits out the gap of the mission line (hud.ts)',()=>{
  const hud=readFileSync(new URL('../../src/client/hud/hud.ts',import.meta.url),'utf8');
  assert.match(hud,/missionTracker\.orderRecent\(this\.last\.tick\)/);
  assert.match(hud,/this\.fear\.frame\(gap\?\{\.\.\.frame,notice:undefined\}:frame,far\)/);
});

/** The phone's first 3 min (evidence/auditoria-primeiro-minuto-29-10, celular-log), solo: each band the line raises. */
const firstMinutes=()=>{
  const m=new MissionTracker(),start=s(20),end=start+s(120),out:{t:number;text:string}[]=[];
  let last:string|undefined;
  for(let tick=start;tick<=start+s(180);tick++){
    const t=(tick-start)/SIM_HZ;
    const facts:Facts={uno:t<95?30:t<110?12:2,...(t>=125?{nests:{alive:5}}:{}),
      ...(t>=126.4&&t<167?{moto:'tombo' as const}:t>=167?{moto:'morta' as const}:{})};
    const line=m.step({tick,minervaAte:end,towerKit:false,playing:true,facts}).line;
    const key=line&&`${line.key}|${line.text}`;
    if(line?.big&&key!==last)out.push({t:Math.round(t*10)/10,text:line.text});
    last=key;
  }
  return out;
};

test('the first 3 minutes solo: from seven orders to one every 30 s at most',()=>{
  const lines=firstMinutes();
  for(let i=1;i<lines.length;i++)assert.ok(lines[i]!.t-lines[i-1]!.t>=ORDER_GAP_S,JSON.stringify(lines));
  assert.equal(lines[0]!.text,MISSION_TEXT.minerva);
  if(process.env.LINHA_DO_TEMPO)console.log(JSON.stringify(lines));
});
