// Card NEW-20261024-ORQ-maromba-cabeca-proporcao: each hero's rest pose keeps its declared head proportions (±3 %), a human
// hero's head is a cartoon head (HUMAN band), and a new M16 hero has to declare its own (scripts/proporcao-herois.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-expect-error plain ESM script without types
import {HEROES,HUMAN,TOL,gatedHeroes,headBox,measureHero,verdictHero} from '../../scripts/proporcao-herois.mjs';

const manifest=JSON.parse(readFileSync('public/art/sprites/manifest.json','utf8'));

/** A 96 px soft-alpha cell: a head of w × h px over shoulders of width sw, the body below down to y = 90. */
function figure(h:number,w:number,sw:number,neck=3){
  const a=new Float32Array(96*96),top=90-Math.round(h/.4);
  const fill=(y0:number,y1:number,width:number)=>{for(let y=y0;y<y1;y++)for(let x=48-(width>>1);x<48-(width>>1)+width;x++)a[y*96+x]=1;};
  fill(top,top+h,w);fill(top+h,top+h+neck,Math.round(w*.4));fill(top+h+neck,90,sw);
  return a;
}

test('headBox reads a drawn head: down to the last narrow row (the neck included), width over the shoulders',()=>{
  const b=headBox(figure(20,18,30));
  assert.equal(b.cab,20+3-1);assert.equal(b.H,50);
  assert.equal(b.cabW,18);assert.equal(b.ombro,30);
  assert.equal(headBox(new Float32Array(96*96)),undefined);
});

test('verdictHero: ±3 % of the declared value, the human band, an undeclared hero fails',()=>{
  const rule={cabAlt:.4,cabOmbro:.9};
  assert.deepEqual(verdictHero({id:'x',cabAlt:.41,cabOmbro:.89},rule),[]);
  assert.equal(verdictHero({id:'x',cabAlt:.42,cabOmbro:.9},rule).length,1);
  assert.equal(verdictHero({id:'x',cabAlt:.3,cabOmbro:.9},{cabAlt:.3,cabOmbro:.9}).length,1,'a human pin head');
  assert.deepEqual(verdictHero({id:'x',cabAlt:.3,cabOmbro:.9},{cabAlt:.3,cabOmbro:.9,animal:true}),[]);
  assert.equal(verdictHero({id:'nobody',cabAlt:.4,cabOmbro:.9},undefined).length,1);
  assert.equal(TOL,.03);assert.deepEqual(HUMAN.cabAlt,[.36,.45]);
});

const heroes:string[]=gatedHeroes(manifest);
assert.ok(heroes.includes('maromba')&&heroes.includes('viciado-em-bet')&&heroes.includes('clt-cansado'));
for(const id of heroes)test(`${id}: the rest pose from the front keeps its head proportions (${HEROES[id]?`cab/alt ${HEROES[id].cabAlt}, cab/ombro ${HEROES[id].cabOmbro}`:'undeclared'} ±${TOL*100} %)`,async()=>{
  const m=await measureHero(manifest,id);
  assert.ok(Object.keys(m.dirs).length>=2,`${id}: at least two front directions measured`);
  assert.deepEqual(verdictHero(m),[]);
});
