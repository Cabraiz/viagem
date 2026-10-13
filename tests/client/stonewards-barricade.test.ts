// City barricades in the Stonewards renderer (barricadas-cliente): kind routing (a barricade is never a tower), the
// damage stages, the pile across the mouth and its art turn, the bar and the hit flash rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BARRICADE_HALF_SPAN,HIT_FLASH_MS,STRUCTURE_BAR_GAP_CSS,STRUCTURE_TOP,barricadeBar,barricadeSpan,damageStage,
  hpDropped,structureBarY,structureRole} from '../../src/client/render/stonewards-rules.ts';
import type {StructureView} from '../../src/contract/view.ts';

test('kind routing: muralha is the wall, barricada a barricade, only torre-chinelo a tower',()=>{
  assert.equal(structureRole('muralha'),'wall');
  assert.equal(structureRole('barricada'),'barricade');
  assert.equal(structureRole('torre-chinelo'),'tower');
  for(const k of ['','torre','barricada-N','caixa-0','muralha-acampamento','chafariz'])assert.equal(structureRole(k),undefined,k);
  // The renderer routes by role: no "every non-wall is a tower" left (it drew a sandal on every plaza mouth).
  const src=readFileSync(new URL('../../src/client/render/stonewards.ts',import.meta.url),'utf8');
  assert.ok(!/kind\s*!==\s*'muralha'/.test(src),'no non-muralha → tower routing');
  assert.match(src,/role==='tower'\)this\.drawTower/);
  assert.match(src,/role==='barricade'\)this\.drawBarricade/);
});

test('damage stages: whole > 66%, damaged > 33%, about to fall > 0, broken at 0 or down',()=>{
  const cases:[number,number][]=[[1,0],[.67,0],[.66,1],[.5,1],[.34,1],[.33,2],[.2,2],[.001,2],[0,3],[-5,3],[Number.NaN,3]];
  for(const [r,s] of cases)assert.equal(damageStage(r),s,`ratio ${r}`);
  assert.equal(damageStage(1,true),3,'down wins');
});

test('barricade bar: hidden whole and down, shown (low under 30%) while damaged',()=>{
  assert.equal(barricadeBar(300,300).show,false);
  assert.equal(barricadeBar(0,300).show,false);
  assert.deepEqual(barricadeBar(150,300),{fraction:.5,low:false,show:true});
  assert.deepEqual(barricadeBar(60,300),{fraction:.2,low:true,show:true});
  assert.equal(barricadeBar(10,0).show,false,'no max life: nothing to show');
  // The bar hangs over the pile's far post, the CSS gap above it, like the wall's.
  assert.equal(structureBarY('barricada',0,1,1),-STRUCTURE_TOP.barricada-STRUCTURE_BAR_GAP_CSS.barricada);
});

test('the pile lies across the wall → barricade line, 2 u long; its art turn follows the camera views',()=>{
  const wall={x:10,y:10},R=2.2;
  // +y (S of the wall) is turn 0, then −x, −y, +x: the projector's quarter-turn order.
  const cases:[{x:number;y:number},number][]=[[{x:10,y:10+R},0],[{x:10-R,y:10},1],[{x:10,y:10-R},2],[{x:10+R,y:10},3]];
  for(const [b,turn] of cases){
    const s=barricadeSpan(b,wall);
    assert.equal(s.turn,turn,`turn of ${b.x},${b.y}`);
    const dx=s.bx-s.ax,dy=s.by-s.ay;
    assert.ok(Math.abs(Math.hypot(dx,dy)-2*BARRICADE_HALF_SPAN)<1e-9,'2 u long');
    assert.ok(Math.abs(dx*(b.x-wall.x)+dy*(b.y-wall.y))<1e-9,'across the radial line');
    assert.ok(Math.abs((s.ax+s.bx)/2-b.x)<1e-9&&Math.abs((s.ay+s.by)/2-b.y)<1e-9,'centred on the barricade');
  }
  assert.equal(barricadeSpan({x:13,y:12.6},wall).turn,3,'a diagonal mouth takes the nearest quarter');
  const lone=barricadeSpan({x:4,y:4});
  assert.deepEqual([Math.min(lone.ax,lone.bx),lone.ay,Math.max(lone.ax,lone.bx),lone.by,lone.turn],[3,4,5,4,0],'no wall: along x');
  assert.equal(barricadeSpan(wall,wall).turn,0,'on the wall: along x');
});

test('hit flash: only a structure whose life dropped since the last view, briefly',()=>{
  const s=(id:string,hp:number):StructureView=>({id,kind:'barricada',x:0,y:0,hp,maxHp:300});
  const before=new Map([['a',300],['b',200],['c',100]]);
  assert.deepEqual(hpDropped(before,[s('a',280),s('b',200),s('c',150),s('d',10)]),['a']);
  assert.deepEqual(hpDropped(new Map(),[s('a',1)]),[],'the first view never flashes');
  assert.ok(HIT_FLASH_MS>0&&HIT_FLASH_MS<=200);
  // Reduced effects: the renderer never schedules a flash (UX checklist B9).
  const src=readFileSync(new URL('../../src/client/render/stonewards.ts',import.meta.url),'utf8');
  assert.match(src,/if\(!this\.options\.reduced\)for\(const id of hpDropped/);
});
