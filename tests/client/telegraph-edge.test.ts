/**
 * Telegraph danger edge (card NEW-20261012-E8-cidade-contorno-breu, cidade-nevada-arte.md §7): the island and the
 * endless map stroke exactly main's bands (golden against tests/client/fixtures/telegraph-edge-main.ts), and the
 * Cidade Nevada variant layers Breu dashed 2 | Cone solid 3 | Papel dashed 3 CSS px, outside in, with the Papel dashes
 * in the same dashes and phase as the Breu (D-020), widths constant on screen, and dashes still with reduced motion.
 * Run: node --experimental-strip-types --test tests/client/telegraph-edge.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {TelegraphEdge,type EdgeFrame} from '../../src/client/render/telegraph-edge.ts';
import {CITY_TELEGRAPH_CSS,CITY_TELEGRAPH_EDGE_CSS,DASH_MAX,DASH_MAX_SEGMENTS,OUTLINE_MAX_POINTS,cityEdgeBands,dashSegments,insetLimit,insetPolygon,telegraphOutline,type TelegraphShape} from '../../src/client/render/telegraph-shape.ts';
import {telegraphDashPhase} from '../../src/client/render/motion.ts';
import {mainEdge} from './fixtures/telegraph-edge-main.ts';

type Pt={x:number;y:number};
type Call=['lineStyle',number,number,number|undefined]|['strokePoints',Pt[],boolean|undefined,boolean|undefined,number|undefined];
/** Records what a Phaser Graphics would be asked to stroke (points copied: the painter reuses its arrays). */
class Recorder {
  calls:Call[]=[];
  lineStyle(w:number,c:number,a?:number){this.calls.push(['lineStyle',w,c,a]);return this;}
  strokePoints(p:Pt[],cs?:boolean,cp?:boolean,e?:number){this.calls.push(['strokePoints',p.slice(0,e??p.length).map(q=>({x:q.x,y:q.y})),cs,cp,e]);return this;}
}
const COLORS={breu:0x1e1530,papel:0xeeddb8,cone:0xff7a1f};
const mulberry=(seed:number)=>()=>{seed=(seed+0x6d2b79f5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/2**32;};

/** A telegraph outline projected like the game (42/21 px per unit, isometric), with some elevation noise. */
function outline(t:TelegraphShape,k:number,lift=0){
  const pts:Pt[]=Array.from({length:OUTLINE_MAX_POINTS},()=>({x:0,y:0}));
  const n=telegraphOutline(t,k,(i,x,y)=>{pts[i].x=(x-y)*42;pts[i].y=(x+y)*21-lift*Math.sin(x*1.7+y);});
  return {pts,n};
}
function randomShape(rnd:()=>number):TelegraphShape{
  const shape=(['circle','line','cone'] as const)[Math.floor(rnd()*3)];
  const a=rnd()*Math.PI*2;
  return {shape,x:rnd()*40,y:rnd()*40,radius:.3+rnd()*6,dx:Math.cos(a),dy:Math.sin(a),width:rnd()<.3?undefined:shape==='cone'?.3+rnd()*2.5:.4+rnd()*2};
}
const frame=(o:Partial<EdgeFrame>):EdgeFrame=>({css:1,ui:1,blink:1,city:false,dashPhase:0,colors:COLORS,...o});

test('island and endless map: the edge strokes exactly what main stroked (golden)',()=>{
  const rnd=mulberry(20261012),edge=new TelegraphEdge();
  for(let i=0;i<400;i++){
    const t=randomShape(rnd),{pts,n}=outline(t,rnd()<.2?.06+rnd()*.9:1,rnd()<.5?rnd()*40:0);
    // Zooms of the island, the endless map and the old whole-island view; ui from hordeUiScale's range.
    const css=1/(.25+rnd()*1.2),ui=1+rnd()*1.5,blink=rnd();
    const now=new Recorder(),main=new Recorder();
    edge.draw(now,pts,n,frame({css,ui,blink,city:false,dashPhase:rnd()*15}));
    mainEdge(main,pts,n,css,ui,blink,COLORS);
    assert.deepEqual(now.calls,main.calls,`scene ${i} (${t.shape})`);
  }
});

test('city: Breu dashed 2, Cone solid 3, Papel dashed 3 CSS px, outside in, on the zone edge (D-015)',()=>{
  const edge=new TelegraphEdge();
  for(const css of [.5,.933,1.72]){
    const {pts,n}=outline({shape:'circle',x:10,y:10,radius:3,dx:1,dy:0},1);
    const g=new Recorder();
    edge.draw(g,pts,n,frame({css,city:true,blink:.4}));
    const styles=g.calls.filter(c=>c[0]==='lineStyle') as ['lineStyle',number,number,number][];
    assert.deepEqual(styles.map(s=>s[2]),[COLORS.breu,COLORS.cone,COLORS.papel],'drawn outside in');
    assert.ok(Math.abs(styles[0][1]-2*css)<1e-9&&Math.abs(styles[1][1]-3*css)<1e-9&&Math.abs(styles[2][1]-3*css)<1e-9,'CSS widths at any zoom');
    assert.equal(styles[0][3],1);assert.equal(styles[1][3],1);
    assert.ok(Math.abs(styles[2][3]-(.55+.45*.4))<1e-12,'Papel keeps the urgency blink');
    // Exactly one solid closed stroke (the Cone ring); the rest are open dash polylines.
    const closed=g.calls.filter(c=>c[0]==='strokePoints'&&c[2]===true);
    assert.equal(closed.length,1);
    // Band center lines: Breu at 1, Cone at 3.5, Papel at 6.5 CSS px inside the zone edge.
    const b=cityEdgeBands(css,insetLimit(pts,n));
    assert.deepEqual([b.breu.d/css,b.cone.d/css,b.papel.d/css].map(v=>Math.round(v*1e9)/1e9),[1,3.5,6.5]);
    assert.equal(b.papel.d+b.papel.width/2,CITY_TELEGRAPH_EDGE_CSS*css,'the edge is 8 CSS px, all inside the zone');
  }
});

test('city: a zone too small for 8 CSS px shrinks every band together, never out of order',()=>{
  const {pts,n}=outline({shape:'circle',x:0,y:0,radius:.12,dx:1,dy:0},1);
  const limit=insetLimit(pts,n),b=cityEdgeBands(1.5,limit);
  assert.ok(b.scale<1.5&&b.scale>0);
  assert.ok(b.breu.d<b.cone.d&&b.cone.d<b.papel.d&&b.papel.d<=limit+1e-12);
  // insetPolygon does not clamp the deepest band: the painter gets the inset it asked for.
  const out=Array.from({length:n},()=>({x:0,y:0}));
  assert.equal(insetPolygon(pts,n,b.papel.d,out),b.papel.d);
  assert.equal(limit,insetPolygon(pts,n,1e9,out),'insetLimit is insetPolygon\'s own clamp');
});

test('city: Papel dashes sit right inside the Breu dashes (same dashes, same phase, D-020)',()=>{
  const edge=new TelegraphEdge(),css=1;
  for(const t of [{shape:'circle',x:5,y:5,radius:2.4,dx:1,dy:0},{shape:'line',x:0,y:0,radius:6,dx:.6,dy:.8,width:1.4},{shape:'cone',x:3,y:1,radius:4,dx:0,dy:1,width:1.2}] as TelegraphShape[]){
    const {pts,n}=outline(t,1);
    const g=new Recorder();
    edge.draw(g,pts,n,frame({css,city:true,dashPhase:4.2}));
    const runs:Pt[][][]=[];let current:Pt[][]|undefined;
    for(const c of g.calls){
      if(c[0]==='lineStyle'){current=[];runs.push(current);}
      else if(c[2]===false)current!.push(c[1]);
    }
    const [breu,,papel]=runs;
    assert.ok(breu.length>2,`${t.shape}: dashed`);
    assert.equal(breu.length,papel.length,`${t.shape}: one Papel dash per Breu dash`);
    // Each Papel dash starts where its Breu dash starts, moved inward by the band gap (5.5 CSS px), along the edge normal.
    for(let i=0;i<breu.length;i++){
      const a=breu[i][0],b=papel[i][0],d=Math.hypot(a.x-b.x,a.y-b.y);
      assert.ok(d>=5.5*css-1e-6&&d<=5.5*css*6+1e-6,`${t.shape} dash ${i}: ${d}`);
    }
  }
});

test('dashSegments: dash/gap by arc length, phase shifts them, pieces at a vertex share it, bounded',()=>{
  // A 100×50 rectangle: perimeter 300; dash 9, gap 6 → 20 dashes, 180 px on.
  const rect=[{x:0,y:0},{x:100,y:0},{x:100,y:50},{x:0,y:50}];
  const out=new Float64Array(DASH_MAX_SEGMENTS*4);
  const on=(count:number)=>{let s=0;for(let i=0;i<count;i++){const o=i*4;s+=Math.hypot(out[o+2]-out[o],out[o+3]-out[o+1]);}return s;};
  let count=dashSegments(rect,4,9,6,0,out);
  assert.ok(Math.abs(on(count)-180)<1e-9);
  assert.deepEqual([out[0],out[1],out[2],out[3]],[0,0,9,0],'phase 0: a dash starts at vertex 0');
  count=dashSegments(rect,4,9,6,4,out);
  assert.ok(Math.abs(on(count)-180)<1e-9);
  assert.deepEqual([out[0],out[1],out[2],out[3]],[4,0,13,0],'phase 4: the dashes move 4 px along the edge');
  // A dash over the corner (100,0): pieces meet exactly at the vertex.
  count=dashSegments(rect,4,9,6,95,out);
  let joined=false;
  for(let i=0;i+1<count;i++){const o=i*4;if(out[o+2]===100&&out[o+3]===0&&out[o+4]===100&&out[o+5]===0)joined=true;}
  assert.ok(joined);
  // `onto`: the same fractions on another polygon with corresponding vertices.
  const big=rect.map(p=>({x:p.x*2,y:p.y*2}));
  count=dashSegments(rect,4,9,6,0,out,big);
  assert.deepEqual([out[0],out[1],out[2],out[3]],[0,0,18,0]);
  // Huge zone: the pattern stretches so there are at most DASH_MAX dashes.
  const huge=rect.map(p=>({x:p.x*100,y:p.y*100}));
  count=dashSegments(huge,4,9,6,0,out);
  assert.ok(count<=DASH_MAX+4,`${count}`);
  assert.ok(Math.abs(on(count)/30000-.6)<1e-9,'still 60% on');
  // Degenerate input draws nothing and never loops.
  assert.equal(dashSegments(rect,1,9,6,0,out),0);
  assert.equal(dashSegments([{x:1,y:1},{x:1,y:1},{x:1,y:1}],3,9,6,0,out),0);
  assert.equal(dashSegments(rect,4,0,6,0,out),0);
});

test('dash phase: drifts slowly, stays still with prefers-reduced-motion',()=>{
  const period=CITY_TELEGRAPH_CSS.dash+CITY_TELEGRAPH_CSS.gap;
  assert.equal(telegraphDashPhase(0,period,false),0);
  assert.equal(telegraphDashPhase(123456,period,true),0);
  assert.equal(telegraphDashPhase(98765,period,true),0);
  const a=telegraphDashPhase(1000,period,false),b=telegraphDashPhase(1500,period,false);
  assert.ok(a>=0&&a<period&&b>a&&b-a<=4,'≤ 8 CSS px per second');
  for(let t=0;t<60000;t+=777){const p=telegraphDashPhase(t,period,false);assert.ok(p>=0&&p<period);}
});
