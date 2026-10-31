// NEW-20261021-ORQ-cone-ataque-melee: the local hero's melee swing lays an aim cone on the ground (render/melee-cone.ts):
// the sim's radius and aperture, the fade, the mouse's direction on a PC and the swing's on a phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BAND_INNER,CONE_FILL,CONE_FILL_ALPHA,FADE_IN_MS,FADE_OUT_MS,MELEE_CONES,MeleeCone,arcPoints,coneAlpha,meleeCone,runeCount} from '../../src/client/render/melee-cone.ts';
import {Projector} from '../../src/client/render/projector.ts';
import {NEW_WEAPONS} from '../../src/sim/weapons/arsenal.ts';
import {computeStats,classBonusOf} from '../../src/rules/index.ts';

test('the melee cones are the sim\'s: the faca\'s area at every rarity and its coneHalfAngle; the firearm cones are not melee',()=>{
  for(const [id,cone] of Object.entries(MELEE_CONES)){
    const def=NEW_WEAPONS.find(w=>w.id===id);
    assert.ok(def,`${id} is an arsenal weapon`);
    assert.equal(def.pattern,'cone');
    assert.equal(def.coneHalfAngle,cone.half);
    for(const row of def.levels)assert.equal(row.area,cone.area,`${id}: area of every rarity`);
  }
  assert.deepEqual(Object.keys(MELEE_CONES),['faca']);
  assert.equal(meleeCone('escopeta',{weapons:[],passives:[]},'concursado'),undefined);
  assert.equal(meleeCone('pistola',{weapons:[],passives:[]},'concursado'),undefined);
  assert.equal(meleeCone(undefined,{weapons:[],passives:[]},'concursado'),undefined);
});

test('the radius grows with the build\'s area like the sim\'s strike (area × stats.area)',()=>{
  const plain=meleeCone('faca',{weapons:[{id:'faca',level:1}],passives:[]},'nenhuma-classe');
  assert.ok(plain);
  const base=computeStats({weapons:[],passives:[]},classBonusOf('nenhuma-classe')).area;
  assert.equal(plain.radius,2.6*base,'melee-alcance-2x: the faca reaches 1.3 × 2');assert.equal(plain.half,1);
  const build={weapons:[{id:'faca',level:2}],passives:[{id:'megafone',level:3}]};
  const big=meleeCone('faca',build,'concursado');
  assert.ok(big);
  assert.ok(Math.abs(big.radius-2.6*computeStats(build,classBonusOf('concursado')).area)<1e-9);
  assert.ok(big.radius>plain.radius,'megafone widens it');
});

test('fade: up in 80 ms, down over 2 s; a new swing starts from where the cone was',()=>{
  assert.equal(FADE_IN_MS,80);assert.equal(FADE_OUT_MS,2000);
  assert.equal(coneAlpha(0),0);
  assert.equal(coneAlpha(40),.5);
  assert.equal(coneAlpha(80),1);
  assert.equal(coneAlpha(80+1000),.5);
  assert.equal(coneAlpha(80+2000),0);
  assert.equal(coneAlpha(5000),0);
  assert.equal(coneAlpha(0,.6),.6,'a swing over a fading cone does not blink');
  assert.ok(Math.abs(coneAlpha(40,.6)-.8)<1e-9);
});

test('arc points span the aperture at the radius; the runes fill the band',()=>{
  const out=Array.from({length:5},()=>({x:0,y:0}));
  arcPoints(1,2,2,-1,1,5,out);
  for(const p of out)assert.ok(Math.abs(Math.hypot(p.x-1,p.y-2)-2)<1e-9);
  assert.ok(Math.abs(Math.atan2(out[0].y-2,out[0].x-1)+1)<1e-9);
  assert.ok(Math.abs(Math.atan2(out[4].y-2,out[4].x-1)-1)<1e-9);
  assert.ok(runeCount(1.3,1)>=3);
  assert.ok(runeCount(2.6,1)>runeCount(1.3,1));
  assert.ok(BAND_INNER>.7&&BAND_INNER<1);
});

/** A Graphics that records the fills (colour, alpha, first points) and whether it shows. */
function fakeGraphics(){
  const calls:{fill:{color:number;alpha:number;points:{x:number;y:number}[]}[];visible:boolean}={fill:[],visible:false};
  let style={color:0,alpha:0};
  const g:Record<string,unknown>={};
  const self=()=>g;
  Object.assign(g,{
    setDepth:self,setName:self,clear:()=>{calls.fill.length=0;return g;},setVisible:(v:boolean)=>{calls.visible=v;return g;},
    fillStyle:(color:number,alpha:number)=>{style={color,alpha};return g;},
    fillPoints:(pts:{x:number;y:number}[],_c:boolean,_cl:boolean,n:number)=>{calls.fill.push({...style,points:pts.slice(0,n).map(p=>({...p}))});return g;},
    lineStyle:self,strokePoints:self,lineBetween:self,fillCircle:self,destroy:self,
  });
  return {g,calls,scene:{add:{graphics:()=>g}} as never};
}

test('the cone shows at the hero, toward the swing (phone) or the mouse (PC), and goes away after the fade',()=>{
  const {calls,scene}=fakeGraphics(),projector=new Projector(0);
  const cone=new MeleeCone(scene,projector,-9974);
  const hero={x:10,y:10};
  cone.draw(0,1,hero);
  assert.equal(calls.visible,false,'nothing before a swing');
  cone.swing(1000,1.3,1,0,1);
  cone.draw(1000+FADE_IN_MS,1,hero);
  assert.equal(calls.visible,true);
  const fill=calls.fill[0];
  assert.equal(fill.color,CONE_FILL);assert.ok(Math.abs(fill.alpha-CONE_FILL_ALPHA)<1e-9);
  // The apex is the hero; the arc's middle point lies toward the swing (+y), radius 1.3.
  const apex=projector.project(10,10,{x:0,y:0}),mid=fill.points[1+20];
  const toward=(wx:number,wy:number)=>projector.project(wx,wy,{x:0,y:0});
  assert.deepEqual(fill.points[0],apex);
  const swingTip=toward(10,11.3);
  assert.ok(Math.hypot(mid.x-swingTip.x,mid.y-swingTip.y)<3,'the middle of the arc is toward the swing');
  // The mouse wins on a PC: aim at +x.
  cone.draw(1000+FADE_IN_MS,1,hero,{x:14,y:10});
  const pcMid=calls.fill[0].points[1+20],mouseTip=toward(11.3,10);
  assert.ok(Math.hypot(pcMid.x-mouseTip.x,pcMid.y-mouseTip.y)<3,'the middle of the arc is toward the mouse');
  // Fading out, then gone.
  cone.draw(1000+FADE_IN_MS+1000,1,hero);
  assert.ok(Math.abs(calls.fill[0].alpha-CONE_FILL_ALPHA*.5)<1e-9);
  cone.draw(1000+FADE_IN_MS+FADE_OUT_MS+1,1,hero);
  assert.equal(calls.visible,false);
});

test('swings of one frame are the build\'s extra cones; the next swing restarts the fade',()=>{
  const {calls,scene}=fakeGraphics(),cone=new MeleeCone(scene,new Projector(0),-9974),hero={x:5,y:5};
  cone.swing(100,1.3,1,1,0);cone.swing(100,1.3,1,-1,0);
  cone.draw(100+FADE_IN_MS,1,hero);
  assert.equal(calls.fill.filter(f=>f.color===CONE_FILL&&Math.abs(f.alpha-CONE_FILL_ALPHA)<1e-9).length,2,'two sectors');
  cone.swing(1500,1.3,1,1,0);
  cone.draw(1500,1,hero);
  assert.ok(Math.abs(calls.fill[0].alpha-CONE_FILL_ALPHA*coneAlpha(1400))<1e-9,'starts from the current opacity, no blink');
  cone.draw(1500+FADE_IN_MS,1,hero);
  assert.equal(calls.fill.filter(f=>f.color===CONE_FILL&&Math.abs(f.alpha-CONE_FILL_ALPHA)<1e-9).length,1,'one sector again, full');
});

test('only the local hero\'s melee swing lays it, from the fire event (nothing new on the wire)',()=>{
  const fx=readFileSync(new URL('../../src/client/render/arsenal-fx.ts',import.meta.url),'utf8');
  assert.match(fx,/event\.player===this\.options\.selfId\?\.\(\)/);
  assert.match(fx,/meleeCone\(weapon,p,p\.classId\)/);
  const scene=readFileSync(new URL('../../src/client/scene.ts',import.meta.url),'utf8');
  assert.match(scene,/aim:\(\)=>this\.mouseGround\(\)/);
  assert.match(scene,/return !p\|\|p\.wasTouch\|\|!p\.time\?undefined/,'a finger: no aim (the phone keeps the auto aim)');
  assert.match(scene,/net\.input\(direction,false,this\.attackTarget,[^,]*,aim(,work)?\)/,'the same mouse goes to the sim');
});
