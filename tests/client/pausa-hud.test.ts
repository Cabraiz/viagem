/**
 * The team's level-up pause on the HUD (D-050, card NEW-20261014-E4-levelup-pausa-hud, src/client/hud/pausa.ts): the
 * pure model (title, deadline bar, who is missing, the strip's marks, what the screen reader hears), the local clock
 * between the room's messages, and the title's place: never over the combat offer's cards, the minimap or the hero at
 * the four reference screens (boxes measured on the photo-mode scenes pausa-*, 100 % and 125 % text).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PAUSE_GAP,PAUSE_URGENT_MS,PauseClock,namesList,pauseAnnouncement,pauseLeftMs,pauseSpot,pauseView,pauseRoster,pickMarks,spotCrosses,validPause,type PauseMember,type RunPause} from '../../src/client/hud/pausa.ts';
import {FOTO_CENAS} from '../../src/client/dev/foto.ts';

const ROSTER:PauseMember[]=[
  {id:'p1',name:'Mateus',online:true},{id:'p2',name:'Tia Cleide',online:true},
  {id:'p3',name:'Zé do Pix',online:true},{id:'p4',name:'Bruninha',online:true},
];
const pause=(leftMs:number,waiting:string[],totalMs=12000):RunPause=>({leftMs,totalMs,level:6,waiting});

test('absent pause: no view, no marks, nothing to announce',()=>{
  assert.equal(pauseView(undefined,ROSTER,'p1',1000),undefined);
  assert.equal(pickMarks(undefined,ROSTER).size,0);
  assert.equal(pauseAnnouncement(undefined,undefined),undefined);
  assert.equal(validPause(undefined),undefined);
  assert.deepEqual(validPause(pause(5000,['p2'])),pause(5000,['p2']));
  // A malformed pause never reaches the screen as "NaN s".
  assert.equal(validPause({leftMs:Number.NaN,totalMs:12000,level:2,waiting:[]}),undefined);
});

test('title "Escolham! N s" with the seconds rounded up, the bar from totalMs',()=>{
  const v=pauseView(pause(9400,['p1','p2']),ROSTER,'p1',0)!;
  assert.equal(v.title,'Escolham! 10 s');assert.equal(v.seconds,10);
  assert.ok(Math.abs(v.fraction-9400/12000)<1e-9);
  // The longest pause (20 s, three extra levels): the same leftMs is a shorter bar.
  assert.ok(Math.abs(pauseView(pause(9400,['p1'],20000),ROSTER,'p1',0)!.fraction-.47)<1e-9);
  assert.equal(pauseView(pause(12000,['p1']),ROSTER,'p1',0)!.fraction,1);
  // totalMs 0 (a room bug): an empty bar, no division by zero.
  assert.equal(pauseView({leftMs:500,totalMs:0,level:2,waiting:['p1']},ROSTER,'p1',0)!.fraction,0);
});

test('urgent at 3 s and under, like the offer\'s clock',()=>{
  assert.equal(pauseView(pause(PAUSE_URGENT_MS+1,['p1']),ROSTER,'p1',0)!.urgent,false);
  assert.equal(pauseView(pause(PAUSE_URGENT_MS,['p1']),ROSTER,'p1',0)!.urgent,true);
  assert.equal(pauseView(pause(2900,['p1']),ROSTER,'p1',0)!.title,'Escolham! 3 s');
  assert.equal(pauseView(pause(0,['p1']),ROSTER,'p1',0)!.urgent,true);
});

test('who is missing: names from the roster (short), "você" first, unknown ids ignored',()=>{
  const line=(waiting:string[],local='p1',roster=ROSTER)=>pauseView(pause(8000,waiting),roster,local,0)!.line;
  // The room sorts the ids; the line keeps the strip's order with this phone first.
  assert.equal(line(['p1','p2','p4']),'Esperando: você, Tia e Bruninha');
  assert.equal(line(['p4','p2','p1']),'Esperando: você, Tia e Bruninha');
  assert.equal(line(['p1']),'Falta você!');
  assert.equal(line(['p2','p4']),'Você já escolheu. Esperando: Tia e Bruninha');
  assert.equal(line(['p3']),'Você já escolheu. Esperando: Zé');
  assert.equal(line([]),'Todo mundo escolheu!');
  // An id the roster does not know (left the room, not in the view yet) is dropped, never shown as an id.
  assert.equal(line(['p2','p9']),'Você já escolheu. Esperando: Tia');
  assert.deepEqual(pauseView(pause(8000,['p9','p1']),ROSTER,'p1',0)!.waiting,['p1']);
  assert.equal(line(['p9']),'Todo mundo escolheu!');
  // A spectator phone never "already picked": it only sees who the team waits for.
  const watching=ROSTER.map(m=>m.id==='p1'?{...m,spectator:true}:m);
  assert.equal(line(['p2','p3'],'p1',watching),'Esperando: Tia e Zé');
  const v=pauseView(pause(8000,['p1']),ROSTER,'p1',0)!;
  assert.equal(v.onlyLocal,true);assert.equal(v.localWaiting,true);
  assert.equal(pauseView(pause(8000,['p1','p2']),ROSTER,'p1',0)!.onlyLocal,false);
});

test('the roster in the strip order: this phone first, then by id, spectators last',()=>{
  const players=[{id:'p3',name:'Zé do Pix',spectator:false,online:true},{id:'p9',name:'Kaique',spectator:true,online:true},{id:'p2',name:'Tia Cleide',spectator:false,online:true},{id:'p1',name:'Mateus',spectator:false,online:true}];
  assert.deepEqual(pauseRoster(players as never,'p2').map(m=>m.id),['p2','p1','p3','p9']);
});

test('the names list in pt-BR, "e mais N" past three',()=>{
  assert.equal(namesList([]),'');assert.equal(namesList(['Tia']),'Tia');
  assert.equal(namesList(['Tia','Zé']),'Tia e Zé');assert.equal(namesList(['você','Tia','Zé']),'você, Tia e Zé');
  assert.equal(namesList(['A','B','C','D','E']),'A, B, C e mais 2');
  const six=[...ROSTER,{id:'p5',name:'Seu Jorge',online:true},{id:'p6',name:'Kaique Mil Grau',online:true}];
  assert.equal(pauseView(pause(8000,['p2','p3','p4','p5','p6']),six,'p1',0)!.line,'Você já escolheu. Esperando: Tia, Zé, Bruninha e mais 2');
});

test('local clock: counts down from the message\'s arrival, clamps at 0, syncs on each new message',()=>{
  const p=pause(5000,['p1']);
  assert.equal(pauseLeftMs(p,1000,1000),5000);
  assert.equal(pauseLeftMs(p,2500,1000),3500);
  assert.equal(pauseLeftMs(p,9000,1000),0,'clamped at 0, never negative');
  assert.equal(pauseLeftMs(p,500,1000),5000,'a clock read before the arrival does not add time');
  assert.equal(pauseLeftMs(pause(15000,['p1']),0,0),12000,'never more than the whole deadline');
  const clock=new PauseClock();
  assert.equal(clock.sync(p,1000),true);
  assert.equal(clock.view(ROSTER,'p1',1600)!.leftMs,4400);
  // The same object again (the caller reads net.run every frame): no resync, it keeps counting down.
  assert.equal(clock.sync(p,1700),false);
  assert.equal(clock.view(ROSTER,'p1',2000)!.leftMs,4000);
  // The room's next message (a new object, resent at each whole second): the clock follows the room.
  const next=pause(4100,['p1']);
  assert.equal(clock.sync(next,2050),true);
  assert.equal(clock.view(ROSTER,'p1',2050)!.leftMs,4100);
  assert.equal(clock.view(ROSTER,'p1',2050)!.seconds,5);
  assert.equal(clock.sync(undefined,2100),true);
  assert.equal(clock.view(ROSTER,'p1',2100),undefined);
});

test('the strip\'s marks: a check on who picked, thinking on who is missing; offline and spectators unmarked',()=>{
  const roster=[...ROSTER,{id:'p5',name:'Seu Jorge',online:false},{id:'p6',name:'Kaique',online:true,spectator:true},{id:'p7',name:'Bot',online:true}];
  const marks=pickMarks(pause(8000,['p1','p4']),roster);
  assert.deepEqual(Object.fromEntries(marks),{p1:'pensando',p2:'escolheu',p3:'escolheu',p4:'pensando',p7:'escolheu'});
  assert.equal(pickMarks(pause(8000,[]),[{id:'p1',name:'Mateus',online:true,eliminated:true}]).size,0,'out of the run: no mark');
});

test('the screen reader hears the start and "Falta você!", never every second',()=>{
  const at=(leftMs:number,waiting:string[])=>pauseView(pause(leftMs,waiting),ROSTER,'p1',0);
  assert.equal(pauseAnnouncement(undefined,at(12000,['p1','p2'])),'Subiu pro nível 6! Escolham a carta: 12 segundos.');
  assert.equal(pauseAnnouncement(at(12000,['p1','p2']),at(11000,['p1','p2'])),undefined);
  assert.equal(pauseAnnouncement(at(11000,['p1','p2']),at(10000,['p1'])),'Falta você!');
  assert.equal(pauseAnnouncement(at(10000,['p1']),at(9000,['p1'])),undefined,'once');
  assert.equal(pauseAnnouncement(at(9000,['p1']),undefined),undefined);
});

/**
 * Boxes measured on the photo-mode scenes (pausa-escolhendo/esperando/ultimo, the HUD sandbox with its minimap slot,
 * 4 players; tools/foto.mjs phones with touch: the fone HUD): the top band, the minimap, the combat offer and the
 * title box's size. `box` is the widest of the three states (and 125 % text where it is wider).
 */
const SCREENS=[
  {name:'390x844',viewport:{width:390,height:844},top:77,minimap:{x:8,y:8,width:124,height:124},offer:{x:130,y:625,width:252,height:59},boxes:[{width:230,height:75},{width:188,height:75},{width:281,height:86}],picked:[{width:306,height:75},{width:360,height:107}]},
  {name:'360x690',viewport:{width:360,height:690},top:77,minimap:{x:8,y:8,width:124,height:124},offer:{x:100,y:471,width:252,height:59},boxes:[{width:230,height:75},{width:188,height:75},{width:281,height:86}],picked:[{width:306,height:75},{width:344,height:107}]},
  {name:'844x390',viewport:{width:844,height:390},top:42,minimap:{x:8,y:8,width:124,height:124},offer:{x:596,y:197,width:240,height:59},boxes:[{width:226,height:62},{width:184,height:62},{width:277,height:72}],picked:[{width:302,height:62},{width:360,height:92}]},
  {name:'1343x618',viewport:{width:1343,height:618},top:48,minimap:{x:1150,y:72,width:185,height:185},offer:{x:1083,y:399,width:252,height:59},boxes:[{width:230,height:75},{width:188,height:75},{width:281,height:86}],picked:[{width:306,height:75},{width:360,height:107}]},
] as const;
/** The hero's box where the round's camera puts it: body at the viewport centre, feet 28 px under it (56 px box). */
const heroOf=(v:{width:number;height:number})=>({x:v.width/2-28,y:v.height/2+28-56,width:56,height:56});

test('layout: the title and bar sit above the combat offer, never over its cards, the minimap or the hero',()=>{
  for(const s of SCREENS){
    for(const box of s.boxes){
      const spot=pauseSpot({viewport:s.viewport,box,top:s.top,offer:s.offer,avoid:[s.minimap]});
      const at=`${s.name} ${box.width}x${box.height}`;
      assert.ok(!spotCrosses(spot,box,s.offer),`${at}: over the offer`);
      assert.ok(spot.y+box.height<=s.offer.y-PAUSE_GAP+1,`${at}: above the cards, ${PAUSE_GAP} px clear`);
      assert.ok(!spotCrosses(spot,box,s.minimap),`${at}: over the minimap`);
      assert.ok(!spotCrosses(spot,box,heroOf(s.viewport)),`${at}: over the hero`);
      assert.ok(spot.x>=PAUSE_GAP&&spot.x+box.width<=s.viewport.width-PAUSE_GAP,`${at}: inside the screen`);
      assert.ok(spot.y>=s.top+PAUSE_GAP,`${at}: under the top band`);
    }
    // This phone picked: its offer closed, the title goes under the top band, clear of the minimap and the hero.
    for(const box of s.picked){
      const spot=pauseSpot({viewport:s.viewport,box,top:s.top,avoid:[s.minimap]});
      const at=`${s.name} picked ${box.width}x${box.height}`;
      assert.ok(!spotCrosses(spot,box,s.minimap),`${at}: over the minimap`);
      assert.ok(!spotCrosses(spot,box,heroOf(s.viewport)),`${at}: over the hero`);
      assert.ok(spot.y>=s.top+PAUSE_GAP&&spot.x>=PAUSE_GAP&&spot.x+box.width<=s.viewport.width-PAUSE_GAP,`${at}: inside`);
    }
  }
});

test('layout: beside the minimap when it fits (landscape), under it when it does not (portrait)',()=>{
  const land=SCREENS[2],box={width:302,height:62};
  const spot=pauseSpot({viewport:land.viewport,box,top:land.top,avoid:[land.minimap]});
  assert.equal(spot.y,land.top+PAUSE_GAP,'landscape: right under the top band');
  const port=SCREENS[0],wide={width:306,height:75};
  const low=pauseSpot({viewport:port.viewport,box:wide,top:port.top,avoid:[port.minimap]});
  assert.equal(low.y,port.minimap.y+port.minimap.height+PAUSE_GAP,'portrait: under the minimap');
});

test('the pause\'s photo-mode scenes and the overlay\'s CSS: tokens, no taps, reduced motion',()=>{
  for(const s of ['escolhendo','esperando','ultimo'])assert.match(FOTO_CENAS[`pausa-${s}`]!.query,new RegExp(`pausa=${s}&frozen=1`));
  const css=readFileSync(new URL('../../src/client/hud/pausa.css',import.meta.url),'utf8');
  assert.match(css,/\.rh-pausa-veu\{[^}]*pointer-events:none/);
  assert.match(css,/\.rh-pausa\{[^}]*pointer-events:none/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});
