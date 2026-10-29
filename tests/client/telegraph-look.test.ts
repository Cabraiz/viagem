import test from 'node:test';
import assert from 'node:assert/strict';
import {TELEGRAPH_KINDS,type TelegraphKind} from '../../src/contract/index.ts';
import {DECOR_MAX_OPS,DECOR_STRIDE,DecorBuffer,LAYER_AIR,LAYER_ZONE,OP_CIRCLE,OP_ELLIPSE,OP_POLY,TELEGRAPH_LOOKS,explosionBeat,opColors,planDecor,telegraphLook,
  type DecorFrame} from '../../src/client/render/telegraph-look.ts';
import {telegraphOutline,type Pt} from '../../src/client/render/telegraph-shape.ts';
import {effectOn,spiralPoints} from '../../src/client/render/you-rules.ts';

/** The view-0 projection (render/projector.ts without terrain). */
const iso=(x:number,y:number,out:Pt)=>{out.x=(x-y)*42;out.y=(x+y)*21;return out;};
const HAZARDS=['arroto','molotov','fogo','coco','explosao'] as const;
/** Server shapes and sizes (sim/enemies/catalog.ts, sim/boss.ts). */
const ZONES:Record<TelegraphKind,{shape:'circle'|'line'|'cone';radius:number;width?:number;dx:number;dy:number}>={
  arroto:{shape:'cone',radius:2.5,width:Math.PI/2,dx:1,dy:0},molotov:{shape:'circle',radius:.9,dx:1,dy:0},fogo:{shape:'circle',radius:.75,dx:1,dy:0},
  coco:{shape:'circle',radius:.5,dx:1,dy:0},explosao:{shape:'circle',radius:1.6,dx:1,dy:0},pancada:{shape:'circle',radius:2,dx:1,dy:0},
  investida:{shape:'line',radius:8,width:1.6,dx:Math.SQRT1_2,dy:Math.SQRT1_2},varredura:{shape:'cone',radius:3,width:1.2,dx:0,dy:1},carimbo:{shape:'circle',radius:1.8,dx:1,dy:0},
};
const zone=(kind:string|undefined,base:TelegraphKind='molotov')=>({...ZONES[base],x:10,y:12,kind});
/** The renderer's frame: bounds of the drawn outline at k = 1. */
function frame(t:ReturnType<typeof zone>,over:Partial<DecorFrame>={}):DecorFrame{
  const bounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity},p:Pt={x:0,y:0};
  telegraphOutline(t,1,(_i,x,y)=>{iso(x,y,p);bounds.minX=Math.min(bounds.minX,p.x);bounds.maxX=Math.max(bounds.maxX,p.x);bounds.minY=Math.min(bounds.minY,p.y);bounds.maxY=Math.max(bounds.maxY,p.y);});
  return {u:.5,ticksLeft:10,now:1000,reduced:false,phase:.3,css:1.7,bounds,...over};
}

test('every telegraph kind has a look; the cast hazards each have their own drawing and color',()=>{
  for(const kind of TELEGRAPH_KINDS)assert.equal(telegraphLook(kind).id,kind,kind);
  const decor=new Set(HAZARDS.map(k=>telegraphLook(k).decor)),fills=new Set(HAZARDS.map(k=>telegraphLook(k).fill));
  assert.equal(decor.size,HAZARDS.length,'distinct drawing per hazard');
  assert.equal(fills.size,HAZARDS.length,'distinct fill per hazard');
  assert.ok(!decor.has('plain'));
  // The boss keeps the generic look; the charge gets the arrow and the stamp its mark.
  assert.equal(telegraphLook('pancada').decor,'plain');assert.equal(telegraphLook('varredura').decor,'plain');
  assert.equal(telegraphLook('investida').decor,'dash');assert.equal(telegraphLook('carimbo').decor,'stamp');
  assert.equal(telegraphLook('pancada').fill,undefined,'boss moves stay Laranja Cone');
});

test('absent or unknown kind falls back to the generic look and draws nothing extra',()=>{
  const buf=new DecorBuffer();
  for(const kind of [undefined,'','generic','gosma-nova','__proto__','toString','constructor']){
    assert.equal(telegraphLook(kind),TELEGRAPH_LOOKS.generic,String(kind));
    for(const base of ['molotov','arroto','investida'] as const){
      const t=zone(kind,base);assert.equal(planDecor(t,frame(t),iso,buf),0,`${kind} ${base}`);
    }
  }
});

test('each hazard plans its own drawing, with its own colors, within the op budget',()=>{
  const buf=new DecorBuffer(),colors=new Map<string,Set<number>>();
  for(const kind of TELEGRAPH_KINDS){
    const t=zone(kind,kind),n=planDecor(t,frame(t),iso,buf);
    if(telegraphLook(kind).decor==='plain'){assert.equal(n,0,kind);continue;}
    assert.ok(n>0&&n<=DECOR_MAX_OPS,`${kind}: ${n} ops`);assert.equal(buf.dropped,0,kind);
    colors.set(kind,opColors(buf));
  }
  const key=(s:Set<number>)=>[...s].sort().join(',');
  const signatures=new Set(HAZARDS.map(k=>key(colors.get(k)!)));
  assert.equal(signatures.size,HAZARDS.length,'every hazard draws with its own palette');
  // What reads at a glance on a phone: the falling bottle is blue glass, the poop brown and white, the fire red.
  assert.ok(colors.get('molotov')!.has(0x2a5fb0));assert.ok(colors.get('coco')!.has(0x7a4b24)&&colors.get('coco')!.has(0xf7f2e6));
  assert.ok(colors.get('fogo')!.has(0xe0381a));assert.ok(colors.get('arroto')!.has(0xe4f08a));
});

test('ground decoration of a circle stays inside the drawn zone',()=>{
  const buf=new DecorBuffer();
  for(const kind of ['molotov','fogo','explosao','carimbo'] as const){
    const t=zone(kind,kind),f=frame(t),b=f.bounds,n=planDecor(t,f,iso,buf);
    for(let i=0;i<n;i++){
      const o=i*DECOR_STRIDE,d=buf.data;
      if(d[o+1]!==LAYER_ZONE||(d[o]!==OP_ELLIPSE&&d[o]!==OP_CIRCLE))continue;
      const x=d[o+4],y=d[o+5],nx=(x-(b.minX+b.maxX)/2)/((b.maxX-b.minX)/2),ny=(y-(b.minY+b.maxY)/2)/((b.maxY-b.minY)/2);
      assert.ok(nx*nx+ny*ny<=1.0001,`${kind} op ${i} at (${nx.toFixed(2)},${ny.toFixed(2)})`);
    }
  }
});

test('steady state: one buffer and one scratch point, bounded ops, no growth over many frames',()=>{
  const buf=new DecorBuffer(),data=buf.data,outs=new Set<Pt>();
  const spy=(x:number,y:number,out:Pt)=>{outs.add(out);return iso(x,y,out);};
  for(const kind of TELEGRAPH_KINDS){
    const t=zone(kind,kind),f=frame(t);let most=0;
    for(let i=0;i<600;i++){
      f.now=i*16.7;f.u=(i%60)/60;f.ticksLeft=30-(i%60)/2;f.reduced=i%200>150;
      most=Math.max(most,planDecor(t,f,spy,buf));
    }
    assert.ok(most<=DECOR_MAX_OPS,kind);
  }
  assert.equal(buf.data,data,'the op buffer is never replaced');
  assert.equal(buf.dropped,0);
  assert.ok(outs.size<=1,`projection writes into ${outs.size} scratch points`);
});

test('reduced motion: the drawing does not move with time (only with the fill-up)',()=>{
  const a=new DecorBuffer(),b=new DecorBuffer();
  for(const kind of TELEGRAPH_KINDS){
    const t=zone(kind,kind),n=planDecor(t,frame(t,{reduced:true,now:0}),iso,a),m=planDecor(t,frame(t,{reduced:true,now:98765}),iso,b);
    assert.equal(n,m,kind);
    assert.deepEqual([...a.data.subarray(0,n*DECOR_STRIDE)],[...b.data.subarray(0,m*DECOR_STRIDE)],kind);
  }
  // Full motion does animate (flames flicker, gas rolls).
  const t=zone('fogo','fogo');planDecor(t,frame(t,{now:0}),iso,a);planDecor(t,frame(t,{now:333}),iso,b);
  assert.notDeepEqual([...a.data.subarray(0,a.count*DECOR_STRIDE)],[...b.data.subarray(0,b.count*DECOR_STRIDE)]);
});

test('the molotov bottle and the next plop come down as the telegraph fills up; they are in the air layer',()=>{
  const buf=new DecorBuffer();
  const highest=(kind:'molotov'|'coco',u:number)=>{
    const t=zone(kind,kind);const n=planDecor(t,frame(t,{u}),iso,buf);let top=Infinity;
    for(let i=0;i<n;i++){
      const o=i*DECOR_STRIDE,d=buf.data;if(d[o+1]!==LAYER_AIR)continue;
      if(d[o]===OP_CIRCLE)top=Math.min(top,d[o+5]);else if(d[o]===OP_POLY)top=Math.min(top,d[o+6]); // circle y; first polygon point y
    }
    return top;
  };
  for(const kind of ['molotov','coco'] as const)assert.ok(highest(kind,0)<highest(kind,.9),`${kind}: falls`);
});

test('explosion beat speeds up near fireTick; steady under reduced motion',()=>{
  const crossings=(from:number,to:number)=>{let c=0,last=explosionBeat(from,false)>.5;for(let l=from;l>=to;l-=.05){const now=explosionBeat(l,false)>.5;if(now!==last)c++;last=now;}return c;};
  assert.ok(crossings(10,0)>crossings(30,20)*1.8,`${crossings(10,0)} vs ${crossings(30,20)}`);
  assert.equal(explosionBeat(3,true),1);assert.equal(explosionBeat(25,true),1);
  for(let l=0;l<40;l+=.37){const v=explosionBeat(l,false);assert.ok(v>=0&&v<=1);}
});

test('slow and slip status: on while tick < until, and the swirl is allocation-free',()=>{
  assert.equal(effectOn(undefined,5),false);assert.equal(effectOn(10,9.5),true);assert.equal(effectOn(10,10),false);assert.equal(effectOn(0,0),false);
  const out=Array.from({length:14},()=>({x:0,y:0})),first=out[0];
  assert.equal(spiralPoints(100,50,10,2,0,out),14);
  assert.equal(out[0],first);assert.deepEqual(out[0],{x:100,y:50},'starts at the center');
  assert.ok(Math.abs(Math.hypot(out[13].x-100,out[13].y-50)-10)<1e-9,'ends on the rim');
  for(let k=1;k<14;k++)assert.ok(Math.hypot(out[k].x-100,out[k].y-50)>=Math.hypot(out[k-1].x-100,out[k-1].y-50)-1e-9,'grows outward');
});
