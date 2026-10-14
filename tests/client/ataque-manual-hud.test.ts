// D-051 manual combat, step 2 (NEW-20261014-E4-ataque-manual-passo2): the attack button's aim, press and texts, and the
// room's combat reaching the client (create body → RoomOptions.combat → welcome).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AIM_RANGE,AttackPress,DEAD_ZONE_PX,KNOB_MAX_PX,LastHit,autoAim,dragAim,rayEnd} from '../../src/client/hud/attack-aim.ts';
import {AGGRO_TICKS,attackTargets} from '../../src/rules/index.ts';
import {controlsHintLines,MANUAL_HINT} from '../../src/client/controls-phase.ts';
import {INPUT_TEXTS,MANUAL_NOTICE,coopNotice} from '../../src/client/desktop-input.ts';
import {objectiveFromSearch} from '../../src/client/ui/solo-plan.ts';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';

const read=(p:string)=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');
const hero={x:0,y:0};
const foe=(id:string,x:number,y:number,extra:{boss?:boolean;hp?:number}={})=>({id,x,y,hp:extra.hp??10,...(extra.boss?{boss:true}:{})});
// A plain iso-like affine projection around the hero (1 u = 32 px along x, 16 px along y, skewed).
const toScreen=(p:{x:number;y:number})=>({x:200+(p.x-p.y)*32,y:300+(p.x+p.y)*16});

test('auto aim: the same order as the server (attackTargets) over the enemies within AIM_RANGE; dead and far ones never',()=>{
  const enemies=[foe('a',3,0),foe('b',2,0),foe('far',AIM_RANGE+.5,0),foe('dead',.5,0,{hp:0}),foe('boss',2.6,0,{boss:true})];
  const {pick,auto}=autoAim(hero,enemies,{tick:100});
  const near=enemies.filter(e=>e.hp>0&&Math.hypot(e.x,e.y)<=AIM_RANGE);
  assert.equal(pick?.id,attackTargets(hero,near,{tick:100}).order[0].id);
  // The boss counts 30 % closer: 2.6 × .7 = 1.82 < 2.
  assert.equal(pick?.id,'boss');assert.equal(auto,'boss');
  assert.equal(autoAim(hero,[foe('far',AIM_RANGE+.5,0)],{tick:1}).pick,undefined,'nothing in range: no reticle');
});

test('auto aim: the chosen target first, then whoever hit me within AGGRO_TICKS, then the hysteresis keeps the current one',()=>{
  const enemies=[foe('a',1,0),foe('b',3,0),foe('c',4,0)];
  assert.equal(autoAim(hero,enemies,{tick:10,chosen:'c'}).pick?.id,'c');
  assert.equal(autoAim(hero,enemies,{tick:10,lastHit:{id:'b',tick:5}}).pick?.id,'b');
  assert.equal(autoAim(hero,enemies,{tick:10+AGGRO_TICKS+5,lastHit:{id:'b',tick:5}}).pick?.id,'a','an old hit no longer counts');
  // 'b' at 1.1 stays ahead of 'a' at 1.0 (not 20 % closer).
  assert.equal(autoAim(hero,[foe('a',1,0),foe('b',1.1,0)],{tick:1,current:'b'}).pick?.id,'b');
});

test('LastHit: only damage on me from an enemy, each event once, forgotten after AGGRO_TICKS and on reset',()=>{
  const h=new LastHit(),isEnemy=(id:string)=>/^e[0-9]/.test(id);
  h.note([{type:'damage',eventId:1,target:'me',source:'e1'},{type:'damage',eventId:2,target:'p2',source:'e2'},{type:'damage',eventId:3,target:'me',source:'env:lava'}],'me',50,isEnemy);
  assert.deepEqual(h.at(50),{id:'e1',tick:50});
  h.note([{type:'damage',eventId:1,target:'me',source:'e9'}],'me',60,isEnemy);
  assert.equal(h.at(60)?.id,'e1','an event already read is not read again');
  assert.equal(h.at(50+AGGRO_TICKS+1),undefined);
  h.reset();assert.equal(h.at(50),undefined);
});

test('drag aim: inside the dead zone is the auto aim; past it the cone picks by angle, the knob is clamped',()=>{
  const centre={x:600,y:700};
  const enemies=[foe('east',3,0),foe('south',0,3)];
  assert.equal(dragAim(centre,{x:DEAD_ZONE_PX-1,y:0},hero,enemies,toScreen).mode,'auto');
  // World +x goes to the screen's lower right: a drag that way picks 'east'.
  const east=toScreen({x:1,y:0}),h=toScreen(hero),d={x:east.x-h.x,y:east.y-h.y},k=200/Math.hypot(d.x,d.y);
  const r=dragAim(centre,{x:d.x*k,y:d.y*k},hero,enemies,toScreen);
  assert.equal(r.mode,'arrasto');assert.equal(r.pick?.id,'east');assert.deepEqual(r.reticle,toScreen(enemies[0]));
  assert.ok(Math.abs(Math.hypot(r.knob.x-centre.x,r.knob.y-centre.y)-KNOB_MAX_PX)<1e-9,'knob clamped to its ring');
});

test('drag aim: an empty cone has no pick and the reticle sits at the range along the ray; the held pick survives a near tie',()=>{
  const centre={x:0,y:0};
  const r=dragAim(centre,{x:0,y:-100},hero,[foe('east',3,0)],toScreen);
  assert.equal(r.pick,undefined);
  const end=rayEnd(hero,{x:0,y:-1},AIM_RANGE,toScreen),h=toScreen(hero);
  assert.deepEqual(r.reticle,end);assert.ok(end.y<h.y&&Math.abs(end.x-h.x)<1e-9,'straight up the screen');
  // Two enemies almost on the same bearing: the previous pick stays (no flicker).
  const a=foe('a',3,0),b=foe('b',3.05,.05),drag={x:32*100,y:16*100};
  const first=dragAim(centre,drag,hero,[a,b],toScreen);
  const other=first.pick?.id==='a'?'b':'a';
  assert.equal(dragAim(centre,drag,hero,[a,b],toScreen,other).pick?.id,other);
});

test('AttackPress: a tap between two input steps still attacks once; holding attacks every step; clear lets go',()=>{
  const p=new AttackPress();
  assert.equal(p.take(),false);
  p.press();p.release();
  assert.equal(p.take(),true,'the quick tap is latched');assert.equal(p.take(),false,'once');
  p.press();assert.equal(p.take(),true);assert.equal(p.take(),true);assert.equal(p.held,true);
  p.clear();assert.equal(p.take(),false);assert.equal(p.held,false);
});

test('texts: the manual combat speaks of the attack button and of Space, never of a weapon firing on its own',()=>{
  for(const kind of ['touch','mouse'] as const){
    assert.equal(coopNotice(kind,false),INPUT_TEXTS[kind].coopNotice);
    assert.equal(coopNotice(kind,true),MANUAL_NOTICE[kind]);assert.doesNotMatch(coopNotice(kind,true),/sozinha/);
    const lines=controlsHintLines('lobby',kind,true);
    assert.equal(lines[1],MANUAL_HINT[kind]);assert.doesNotMatch(lines.join(' '),/sozinha/);
    assert.deepEqual(controlsHintLines('countdown',kind,true),controlsHintLines('countdown',kind));
  }
  assert.match(coopNotice('mouse',true),/Espaço/);
});

test('?combate=manual asks the room for the manual combat; any other value is dropped',()=>{
  assert.deepEqual(objectiveFromSearch('?combate=manual'),{combat:'manual'});
  assert.deepEqual(objectiveFromSearch('?modo=chaveiro&combate=manual'),{objective:'chaveiro',combat:'manual'});
  for(const s of ['?combate=auto','?combate=MANUAL',''])assert.deepEqual(objectiveFromSearch(s),{});
  // The room create sends a body whenever something was asked.
  assert.match(read('src/client/lobby.ts'),/asked\.objective\|\|asked\.combat\?\{body:JSON\.stringify\(asked\)\}/);
});

function peer(){
  const messages:any[]=[];
  return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
}
const joinAs=(room:Room,p:ReturnType<typeof peer>,now:number)=>{room.connect(p as Peer,now);room.receive(p as Peer,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum'}),now);};

test('the welcome says combat:"manual" only in a manual room (the client turns the skill slot into Atacar)',()=>{
  const t0=Date.now();
  const manual=new Room(t0,7,{combat:'manual'}),auto=new Room(t0,7);
  const a=peer(),b=peer();joinAs(manual,a,t0);joinAs(auto,b,t0);
  assert.equal(a.messages.find(m=>m.t==='welcome')?.combat,'manual');
  const w=b.messages.find(m=>m.t==='welcome');assert.ok(w);assert.equal('combat' in w,false);
  // The client reads it on welcome.
  assert.match(read('src/client/net/client.ts'),/this\.combat=m\.combat==='manual'\?'manual':'auto';/);
});
