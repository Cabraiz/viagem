/**
 * Card NEW-20261022-ORQ-arma-na-mao: the weapon hand followed pose to pose in a dense sheet (R06: 128 poses a clip, the hand
 * moves ~1-2 px a pose). The rule of scripts/hand-points.mjs (the outermost skin on the weapon side) jumps between the
 * hands of a side view, whose arms swing past each other, and lands on the nose when the hand passes behind the body
 * (the CLT's walk W). Here the hand is tracked instead:
 *  - frame 0: each skin blob under the head is a candidate hand (its tip: the blob's end away from the arm);
 *  - each next pose: the skin within SEARCH px of the last hand, the tip nearest to it; none = hidden behind the body,
 *    found again within a radius that grows with the frames hidden (never in the head: the nose and ears are skin);
 *  - the hidden poses are filled in between the last seen and the found again, marked behind (third element 1);
 *  - of the candidates, the hand hidden the fewest poses wins (ties: the outermost on the weapon side).
 * Pure functions on a pose accessor {alpha(x,y), skin(x,y)} of one 96 px cell; tests/client/hand-points.test.ts reads them.
 */
export const CELL=96;
/** Skin: the heroes' warm tones (alpha > 40), not their clothes, hair or outline. */
export const skin=(r,g,b,a)=>a>40&&r>150&&g>90&&g<205&&b<140&&r-b>70&&r>g;

/** The opaque figure's box, rows and columns (alpha > 40). */
export function figureOf(px){
  let top=CELL,bot=-1,left=CELL,right=-1;
  for(let y=0;y<CELL;y++)for(let x=0;x<CELL;x++)if(px.alpha(x,y)>40){top=Math.min(top,y);bot=Math.max(bot,y);left=Math.min(left,x);right=Math.max(right,x);}
  return bot<0?undefined:{top,bot,left,right,h:bot-top};
}
/** The head's rows: the top 36% of the figure (hair, face, ears). */
export const headBottom=fig=>fig.top+fig.h*.36;

/** The skin pixels connected (8-way) to `seed` within `radius` px of `center`. */
function blob(px,seed,center,radius){
  const key=(x,y)=>y*CELL+x,seen=new Set([key(...seed)]),out=[],queue=[seed];
  while(queue.length){
    const [x,y]=queue.pop();out.push([x,y]);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const nx=x+dx,ny=y+dy,k=key(nx,ny);
      if(nx<0||ny<0||nx>=CELL||ny>=CELL||seen.has(k)||!px.skin(nx,ny))continue;
      if(Math.hypot(nx-center[0],ny-center[1])>radius)continue;
      seen.add(k);queue.push([nx,ny]);
    }
  }
  return out;
}
/** Breadth-first steps from `from` over `pixels` (8-way): the farthest pixel and every pixel's steps. */
function walk(pixels,from){
  const at=new Map(pixels.map(p=>[p[1]*CELL+p[0],p])),dist=new Map([[from[1]*CELL+from[0],0]]),queue=[from];
  let far=from;
  for(let i=0;i<queue.length;i++){
    const [x,y]=queue[i],d=dist.get(y*CELL+x);
    if(d>dist.get(far[1]*CELL+far[0]))far=[x,y];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const k=(y+dy)*CELL+x+dx;
      if(!at.has(k)||dist.has(k))continue;
      dist.set(k,d+1);queue.push(at.get(k));
    }
  }
  return {far,dist};
}
const round=p=>[Math.round(p[0]*10)/10,Math.round(p[1]*10)/10];
const mean=pts=>[pts.reduce((s,p)=>s+p[0],0)/pts.length,pts.reduce((s,p)=>s+p[1],0)/pts.length];
/**
 * A skin blob's two ends (its longest path) and the hand at an end: the blob's pixels within 3 steps of it, averaged.
 * A blob shorter than 6 steps is the fist alone (`fist`: its middle).
 */
export function endsOf(pixels){
  const a=walk(pixels,pixels[0]).far,{far:b,dist}=walk(pixels,a);
  if(dist.get(b[1]*CELL+b[0])<6)return {fist:round(mean(pixels))};
  const at=end=>{const d=walk(pixels,end).dist;return round(mean(pixels.filter(p=>d.get(p[1]*CELL+p[0])<=3)));};
  return {ends:[at(a),at(b)]};
}
const gap=(p,q)=>Math.hypot(p[0]-q[0],p[1]-q[1]);
/**
 * Which end is the hand: the forearm is followed by both its ends, the hand and the elbow (or the sleeve's edge), so a
 * punch that throws the fist away from the last hand never swaps them (each end goes to the nearer one of the last pair).
 */
export function handEnd(found,last){
  if(found.fist)return {hand:found.fist,elbow:last.elbow};
  const [a,b]=found.ends;
  return gap(a,last.hand)+gap(b,last.elbow)<=gap(b,last.hand)+gap(a,last.elbow)?{hand:a,elbow:b}:{hand:b,elbow:a};
}
/** The skin nearest `p` within `radius` (outside the head when `noHead`), or undefined. */
function nearestSkin(px,p,radius,headY){
  let best,bd=Infinity;
  const x0=Math.max(0,Math.floor(p[0]-radius)),x1=Math.min(CELL-1,Math.ceil(p[0]+radius));
  const y0=Math.max(0,Math.floor(p[1]-radius)),y1=Math.min(CELL-1,Math.ceil(p[1]+radius));
  for(let y=y0;y<=y1;y++){
    if(headY!==undefined&&y<headY)continue;
    for(let x=x0;x<=x1;x++){
      if(!px.skin(x,y))continue;
      const d=Math.hypot(x-p[0],y-p[1]);if(d<=radius&&d<bd){bd=d;best=[x,y];}
    }
  }
  return best;
}
/** A hidden hand stays on the body that hides it: the nearest solid pixel (alpha > 200) when the line leaves it. */
export function onBody(px,p){
  const solid=(x,y)=>x>=0&&y>=0&&x<CELL&&y<CELL&&px.alpha(x,y)>200;
  if(solid(Math.round(p[0]),Math.round(p[1])))return p;
  let best=p,bd=Infinity;
  for(let y=0;y<CELL;y++)for(let x=0;x<CELL;x++)if(solid(x,y)){const d=Math.hypot(x-p[0],y-p[1]);if(d<bd){bd=d;best=[x,y];}}
  return best;
}
/** Steps a hand may move between two poses of a dense sheet, and the hand's reach around it. */
export const SEARCH=5,REACH=10,LOST_MAX=10;

/** Frame 0's candidate hands: the skin blobs under the head, each by its tip (the end away from the shoulders). */
export function candidates(px){
  const fig=figureOf(px);if(!fig)return [];
  // Lower than the head rows of the search: a side view's face reaches 40% down (the CLT's walk E).
  const headY=fig.top+fig.h*.42,shoulder=[(fig.left+fig.right)/2,fig.top+fig.h*.4],seen=new Set(),out=[];
  for(let y=Math.ceil(headY);y<=fig.bot;y++)for(let x=0;x<CELL;x++){
    if(!px.skin(x,y)||seen.has(y*CELL+x))continue;
    const whole=blob(px,[x,y],[x,y],CELL),pixels=whole.filter(p=>p[1]>=headY);
    for(const p of pixels)seen.add(p[1]*CELL+p[0]);
    // Skin reaching up into the head is the face (or the neck), not a hand at rest.
    if(pixels.length<4||whole.some(p=>p[1]<headBottom(fig)))continue;
    // Far from the shoulders: the end of the blob away from them is the hand.
    const ends=[walk(pixels,pixels[0]).far];ends.push(walk(pixels,ends[0]).far);
    const away=ends.reduce((a,b)=>Math.hypot(b[0]-shoulder[0],b[1]-shoulder[1])>Math.hypot(a[0]-shoulder[0],a[1]-shoulder[1])?b:a);
    const found=endsOf(pixels);
    if(found.fist){out.push({point:found.fist,elbow:shoulder,size:pixels.length});continue;}
    const [a,b]=found.ends,hand=gap(a,away)<=gap(b,away)?a:b;
    out.push({point:hand,elbow:hand===a?b:a,size:pixels.length});
  }
  return out;
}

/**
 * Tracks the hand from `start` through `poses` (accessors, in play order). Per pose [x, y] seen, or [x, y, 1] hidden
 * (filled in between the poses around it), and the count hidden.
 */
export function track(poses,start,elbow=start){
  const out=[],hidden=[];let p=start,arm={hand:start,elbow},lost=0;
  for(let i=0;i<poses.length;i++){
    const px=poses[i],fig=figureOf(px);
    // Lost, the search grows with the poses hidden and skips the head (the nose is skin); in sight, it follows anywhere.
    const radius=lost?Math.min(LOST_MAX,SEARCH+lost):SEARCH,seed=fig&&nearestSkin(px,p,radius,lost?headBottom(fig):undefined);
    if(!seed){out.push(undefined);hidden.push(i);lost++;continue;}
    arm=handEnd(endsOf(blob(px,seed,seed,REACH)),arm);
    out.push(arm.hand);p=arm.hand;lost=0;
  }
  // The hidden poses: in a line from the last seen to the next seen (around the loop), behind the body.
  const seen=out.map((q,i)=>q?i:-1).filter(i=>i>=0);
  if(!seen.length)return {points:poses.map(()=>[...round(start),1]),hidden:poses.length};
  for(const i of hidden){
    const before=[...seen].reverse().find(j=>j<i)??seen[seen.length-1],after=seen.find(j=>j>i)??seen[0];
    const span=(after-before+poses.length)%poses.length||poses.length,t=((i-before+poses.length)%poses.length)/span;
    const a=out[before],b=out[after];
    out[i]=[...round(onBody(poses[i],[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t])),1];
  }
  return {points:out,hidden:hidden.length};
}

/**
 * The weapon hand of a dense sheet: the frame-0 candidate tracked hidden the fewest poses; a tie goes to the outermost
 * on the weapon `side` (−1 screen-left, +1 right). `pick` forces a candidate (OVERRIDES: by its index from the side).
 */
export function trackSheet(poses,side,pick){
  const all=candidates(poses[0]).sort((a,b)=>side*b.point[0]-side*a.point[0]);
  if(!all.length)return undefined;
  const runs=all.map(c=>track(poses,c.point,c.elbow));
  if(pick!==undefined)return runs[pick];
  return runs.reduce((best,r)=>r.hidden<best.hidden?r:best);
}

/**
 * Guided by hand (conferência visual): `keys` {frame: [x, y]} mark the fist in some poses (a punch moves the fist away
 * from the elbow faster than the tracking follows, and a guard puts it beside the chin). Each pose starts on the marks'
 * line (or the last pose's hand, near it) and slides onto the skin around it (mean shift, SHIFT px: the fist is the biggest skin mass there), never more
 * than GUIDE px off the line. No skin there: the line's point, behind the body.
 */
export const GUIDE=6,SHIFT=3.5;
export function guided(poses,keys){
  const at=Object.keys(keys).map(Number).sort((a,b)=>a-b);
  let last;
  return poses.map((px,i)=>{
    const after=at.find(k=>k>=i)??at[at.length-1],before=[...at].reverse().find(k=>k<=i)??at[0];
    const t=after===before?0:(i-before)/(after-before),a=keys[before],b=keys[after];
    const guide=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
    // From the last pose's hand when still near the line (two fists side by side on guard: it keeps its own).
    let p=last&&gap(last,guide)<=GUIDE&&nearestSkin(px,last,2)?last:nearestSkin(px,guide,GUIDE);
    if(!p){last=undefined;return [...round(onBody(px,guide)),1];}
    for(let k=0;k<8;k++){
      const near=[];
      for(let y=Math.floor(p[1]-SHIFT);y<=Math.ceil(p[1]+SHIFT);y++)for(let x=Math.floor(p[0]-SHIFT);x<=Math.ceil(p[0]+SHIFT);x++)
        if(x>=0&&y>=0&&x<CELL&&y<CELL&&px.skin(x,y)&&Math.hypot(x-p[0],y-p[1])<=SHIFT&&gap([x,y],guide)<=GUIDE)near.push([x,y]);
      if(!near.length)break;
      const q=mean(near);if(gap(q,p)<.05){p=q;break;}p=q;
    }
    last=p;return round(p);
  });
}
