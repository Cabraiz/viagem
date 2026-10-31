// NEW-20261031-ORQ-tiro-rapido-e-local: the front cone's aim assist shared by the sim's shot and the client's red arrows.
import test from 'node:test';
import assert from 'node:assert/strict';
import {FRONT_HALF,FRONT_KEEP_MARGIN,frontAssist} from '../../src/rules/front-assist.ts';

const deg=(d:number)=>d*Math.PI/180;
const O={x:0,y:0},EAST={x:1,y:0},REACH=8;
const at=(id:string,dist:number,angle:number,radius=.3)=>({id,x:dist*Math.cos(deg(angle)),y:dist*Math.sin(deg(angle)),radius});
const pick=(c:ReturnType<typeof at>[],current?:string)=>frontAssist(O,EAST,REACH,c,{current})[0]?.e.id;

test('the cone is ±35° of the front',()=>{assert.ok(Math.abs(FRONT_HALF-deg(35))<1e-12);});

test('30° off the front bends the shot onto it; 60°, the side and behind are never picked',()=>{
  assert.equal(pick([at('a',4,30)]),'a');
  assert.equal(pick([at('a',4,-30)]),'a');
  for(const angle of [36,60,90,-90,135,180])assert.equal(pick([at('a',4,angle)]),undefined,`${angle}°`);
  assert.equal(pick([at('a',4,0)]),'a','dead ahead');
});

test('only within reach (plus the radius with pad)',()=>{
  assert.equal(pick([at('a',REACH+.2,0)]),undefined);
  assert.equal(frontAssist(O,EAST,REACH,[at('a',REACH+.2,0)],{pad:true})[0]?.e.id,'a');
});

test('the angle weighs more than the distance: a far one near the front line beats a near one at the cone\'s edge',()=>{
  assert.equal(pick([at('near',1,28),at('far',7,4)]),'far');
  // At the same angle the nearer wins.
  assert.equal(pick([at('near',2,10),at('far',7,10)]),'near');
});

test('sticky: the focus stays until another is clearly better, then switches; gone from the cone, it is dropped',()=>{
  // Two side by side: whichever is the focus stays (no flicker).
  const twins=[at('a',4,8),at('b',4,-10)];
  assert.equal(pick(twins),'a');
  assert.equal(pick(twins,'b'),'b','b keeps it although a scores a bit lower');
  // b drifting off: a is clearly better (beyond the margin) → switch.
  const s=(e:ReturnType<typeof at>)=>frontAssist(O,EAST,REACH,[e])[0].score;
  const drift=[at('a',4,8),at('b',4,-25)];
  assert.ok(s(drift[1])-s(drift[0])>FRONT_KEEP_MARGIN);
  assert.equal(pick(drift,'b'),'a');
  assert.equal(pick([at('a',4,8),at('b',4,-50)],'b'),'a','out of the cone: dropped');
  // Walking past a row of critters a step at a time: the focus changes at most once per critter, never back and forth.
  const row=[at('a',5,-6),at('b',5,6)];let focus:string|undefined,switches=0;
  for(let t=-20;t<=20;t+=1){
    const dir={x:Math.cos(deg(t*.3)),y:Math.sin(deg(t*.3))};
    const next=frontAssist(O,dir,REACH,row,{current:focus})[0]?.e.id;
    if(next!==focus&&focus!==undefined)switches++;
    focus=next;
  }
  assert.ok(switches<=1,`switches ${switches}`);
});
