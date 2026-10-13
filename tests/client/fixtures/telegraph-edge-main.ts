/**
 * main's telegraph danger edge, frozen (src/client/render/layers.ts drawTelegraph before card cidade-contorno-breu,
 * with main's insetPolygon from telegraph-shape.ts): the reference of tests/client/telegraph-edge.test.ts, which proves
 * the island and the endless map still stroke exactly this. Do not edit.
 */
type Pt={x:number;y:number};
interface G {lineStyle(w:number,c:number,a?:number):unknown;strokePoints(p:Pt[],cs?:boolean,cp?:boolean,e?:number):unknown}

const INSET_MITER_LIMIT=6;
function insetPolygon(src:readonly Pt[],n:number,d:number,out:Pt[]):number{
  let area=0,perimeter=0;
  for(let i=0;i<n;i++){const a=src[i],b=src[(i+1)%n];area+=a.x*b.y-b.x*a.y;perimeter+=Math.hypot(b.x-a.x,b.y-a.y);}
  area/=2;
  const inradius=perimeter>0?2*Math.abs(area)/perimeter:0;
  d=Math.max(0,Math.min(d,inradius*.5));
  const sign=area>0?1:-1;
  for(let i=0;i<n;i++){
    const prev=src[(i+n-1)%n],cur=src[i],next=src[(i+1)%n];
    let ax=cur.x-prev.x,ay=cur.y-prev.y,bx=next.x-cur.x,by=next.y-cur.y;
    const la=Math.hypot(ax,ay)||1,lb=Math.hypot(bx,by)||1;ax/=la;ay/=la;bx/=lb;by/=lb;
    const n1x=-ay*sign,n1y=ax*sign,n2x=-by*sign,n2y=bx*sign;
    let mx=n1x+n2x,my=n1y+n2y;const ml=Math.hypot(mx,my);
    const o=out[i];
    if(ml<1e-9){o.x=cur.x+n1x*d;o.y=cur.y+n1y*d;continue;}
    mx/=ml;my/=ml;
    const cos=mx*n1x+my*n1y,scale=Math.min(INSET_MITER_LIMIT,1/Math.max(1e-6,cos))*d;
    o.x=cur.x+mx*scale;o.y=cur.y+my*scale;
  }
  return d;
}

const TELEGRAPH_STROKE=8;
const TELEGRAPH_BANDS_CSS={breu:2,papel:2,cone:3} as const;
const TELEGRAPH_EDGE_CSS=2*TELEGRAPH_BANDS_CSS.breu+2*TELEGRAPH_BANDS_CSS.papel+TELEGRAPH_BANDS_CSS.cone;

/** main's last lines of drawTelegraph, on the same inputs (pts, n, css, w = ui, blink, c = palette). */
export function mainEdge(top:G,pts:Pt[],n:number,css:number,w:number,blink:number,c:{breu:number;papel:number;cone:number}){
  const ptsIn:Pt[]=Array.from({length:n},()=>({x:0,y:0}));
  const want=Math.max(TELEGRAPH_EDGE_CSS*css,TELEGRAPH_STROKE*w)/2,half=insetPolygon(pts,n,want,ptsIn),k=2*half/TELEGRAPH_EDGE_CSS;
  top.lineStyle(2*half,c.breu,.95);top.strokePoints(ptsIn,true,true,n);
  top.lineStyle(k*(2*TELEGRAPH_BANDS_CSS.papel+TELEGRAPH_BANDS_CSS.cone),c.papel,.55+.45*blink);top.strokePoints(ptsIn,true,true,n);
  top.lineStyle(k*TELEGRAPH_BANDS_CSS.cone,c.cone,1);top.strokePoints(ptsIn,true,true,n);
}
