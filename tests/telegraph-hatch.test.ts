import test from 'node:test';
import assert from 'node:assert/strict';
import {HATCH_MAX_LINES,OUTLINE_MAX_POINTS,hatchSegments,telegraphOutline,type Pt} from '../src/game/render/telegraph-shape.ts';

const outline=(t:Parameters<typeof telegraphOutline>[0])=>{
  const pts:Pt[]=Array.from({length:OUTLINE_MAX_POINTS},()=>({x:0,y:0}));
  const n=telegraphOutline(t,1,(i,x,y)=>{pts[i].x=x;pts[i].y=y;});
  return {pts,n};
};
const inside=(pts:Pt[],n:number,x:number,y:number)=>{
  let c=false;for(let i=0,j=n-1;i<n;j=i++){const a=pts[i],b=pts[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)c=!c;}return c;
};

test('telegraph hatch stays inside every shape, on 45° lines, and is bounded',()=>{
  const out=new Float64Array(HATCH_MAX_LINES*4),xs=new Float64Array(OUTLINE_MAX_POINTS);
  for(const t of [
    {shape:'circle' as const,x:100,y:50,radius:80,dx:1,dy:0},
    {shape:'line' as const,x:0,y:0,radius:200,dx:Math.SQRT1_2,dy:Math.SQRT1_2,width:40},
    {shape:'cone' as const,x:-30,y:10,radius:150,dx:0,dy:1,width:Math.PI*.6},
    {shape:'cone' as const,x:0,y:0,radius:150,dx:1,dy:0,width:Math.PI*1.5},
  ]){
    const {pts,n}=outline(t),count=hatchSegments(pts,n,9,out,xs);
    assert.ok(count>3,`${t.shape}: ${count} segments`);
    assert.ok(count<=HATCH_MAX_LINES);
    for(let i=0;i<count;i++){
      const [x0,y0,x1,y1]=out.subarray(i*4,i*4+4);
      assert.ok(Math.abs((x1-x0)-(y1-y0))<1e-6,'diagonal');
      const mx=(x0+x1)/2,my=(y0+y1)/2;
      assert.ok(inside(pts,n,mx,my),`${t.shape}: midpoint inside`);
    }
  }
  // Huge zone: the spacing grows so the count stays bounded.
  const {pts,n}=outline({shape:'circle',x:0,y:0,radius:1e5,dx:1,dy:0});
  assert.ok(hatchSegments(pts,n,9,out,xs)<=HATCH_MAX_LINES);
  assert.equal(hatchSegments(pts,2,9,out,xs),0);
  assert.equal(hatchSegments(pts,n,0,out,xs),0);
});
