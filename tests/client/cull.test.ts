// Culling of the horde off camera (card NEW-20261018-ORQ-culling-horda, estudo-desempenho F2): the view test the
// renderer uses to skip a critter, at each edge of the view, with the figure's width, height and the margin.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CULL_MARGIN_CSS,inView,overCap} from '../../src/client/render/cull.ts';

const v={x:100,y:200,right:500,bottom:800};

test('a critter inside the view is drawn', () => {
  assert.equal(inView(v,300,500,20,60,0),true);
});

test('left and right: the figure half width and the margin reach past the edge', () => {
  assert.equal(inView(v,79,500,20,60,0),false);
  assert.equal(inView(v,80,500,20,60,0),true); // its right side touches x
  assert.equal(inView(v,70,500,20,60,10),true);
  assert.equal(inView(v,521,500,20,60,0),false);
  assert.equal(inView(v,520,500,20,60,0),true);
});

test('above: the body over the feet counts, so a tall one under the bottom edge still shows its head', () => {
  assert.equal(inView(v,300,199,20,60,0),false); // feet over the top edge, body further up
  assert.equal(inView(v,300,200,20,60,0),true);
  assert.equal(inView(v,300,860,20,60,0),true); // head at 800
  assert.equal(inView(v,300,861,20,60,0),false);
  assert.equal(inView(v,300,861,20,60,1),true);
});

test('below the feet only the margin counts', () => {
  assert.equal(inView(v,300,190,20,60,10),true);
  assert.equal(inView(v,300,189,20,60,10),false);
});

test('far away in any direction is culled, whatever the size', () => {
  for(const [x,y] of [[-5000,500],[5000,500],[300,-5000],[300,5000]])assert.equal(inView(v,x,y,40,120,CULL_MARGIN_CSS),false);
});

test('overCap: the nearest fill the cap, the rest are marked hidden', ()=>{
  const out:boolean[]=[];
  assert.equal(overCap([9,1,4,16,0],[false,false,false,false,false],3,out),2);
  assert.deepEqual(out,[true,false,false,true,false]);
  assert.equal(out.filter(Boolean).length,2);
});
test('overCap: at or under the cap nobody is hidden', ()=>{
  const out:boolean[]=[true,true];
  assert.equal(overCap([5,3],[false,false],2,out),0);assert.deepEqual(out,[false,false]);
  assert.equal(overCap([],[],0,out),0);assert.deepEqual(out,[]);
});
test('overCap: the always drawn stay and count against the cap, even far away', ()=>{
  const out:boolean[]=[];
  // 0 is a far boss, 3 the target: both kept; one place left for the nearest of the others (2).
  assert.equal(overCap([100,4,1,50,9],[true,false,false,true,false],3,out),2);
  assert.deepEqual(out,[false,true,false,false,true]);
  // More kept than the cap: all kept still drawn, every other hidden.
  assert.equal(overCap([1,2,3],[true,true,false],1,out),1);assert.deepEqual(out,[false,false,true]);
});
test('overCap: a tie goes to the lower index', ()=>{
  const out:boolean[]=[];
  assert.equal(overCap([4,4,4,4],[false,false,false,false],2,out),2);
  assert.deepEqual(out,[false,false,true,true]);
});
test('overCap: the levels of quality.ts (150/300/3000) cap a 400-critter horde', ()=>{
  const n=400,dist=Array.from({length:n},(_,i)=>(n-i)**2),keep=new Array<boolean>(n).fill(false),out:boolean[]=[],order:number[]=[];
  for(const [cap,hidden] of [[150,250],[300,100],[3000,0]] as const){
    assert.equal(overCap(dist,keep,cap,out,order),hidden);
    assert.equal(out.filter(Boolean).length,hidden);
    // The nearest (the highest indices here) are the drawn ones.
    for(let i=n-Math.min(cap,n);i<n;i++)assert.equal(out[i],false);
  }
});
test('wiring: the scene hands the level\'s cap to the horde, which hides the ones over it like the culled', ()=>{
  const read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');
  const scene=read('../../src/client/scene.ts'),layers=read('../../src/client/render/layers.ts');
  assert.match(scene,/this\.horde\?\.setEnemyCap\(profile\.enemyCap\);[^\n]*\n  \}/,'the last line of setQuality');
  assert.match(layers,/overCap\(dist,keep,this\.enemyCap,/);
  assert.match(layers,/if\(a\.capped\|\|this\.options\.cull!==false&&/);
  assert.match(layers,/this\.enemies\.end\(\);this\.capDirty=true;/,'ranked again on every push');
});
