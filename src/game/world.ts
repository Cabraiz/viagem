import type {TerrainField} from './terrain/field.ts';
export type Point = { x: number; y: number };
export type Obstacle = Point & { radius: number; kind: 'palm' | 'tree' | 'rock' };
export const SPAWN: Point = { x: 12, y: 17 };
export const SPEED = 3.1;
export const RADIUS = .22;
export const landmarks = [
  { x: 8, y: 11, name: 'Praça do Improviso', detail: 'Todo mundo começa com o que tem.', icon: '✦' },
  { x: 17, y: 11, name: 'Fonte dos Palpites', detail: 'Nem todo palpite merece uma aposta.', icon: '◇' },
  { x: 12, y: 5, name: 'Mirante da Turma', detail: 'Um lugar para reunir histórias. E, depois, os amigos.', icon: '△' },
];
export const obstacles: Obstacle[] = [
  {x:6,y:9,radius:.45,kind:'tree'}, {x:9,y:8,radius:.4,kind:'tree'},
  {x:14,y:7,radius:.4,kind:'tree'}, {x:16,y:9,radius:.4,kind:'tree'},
  {x:7,y:14,radius:.42,kind:'palm'}, {x:5,y:12,radius:.4,kind:'palm'},
  {x:9,y:19,radius:.4,kind:'palm'}, {x:14,y:19,radius:.4,kind:'palm'},
  {x:20,y:13,radius:.4,kind:'palm'}, {x:18,y:17,radius:.4,kind:'palm'},
  {x:10,y:5,radius:.4,kind:'tree'}, {x:14,y:4,radius:.4,kind:'tree'},
  {x:11,y:12,radius:.5,kind:'rock'}, {x:14,y:14,radius:.48,kind:'rock'},
  {x:8,y:6,radius:.45,kind:'rock'}, {x:18,y:8,radius:.6,kind:'rock'},
];
export function elevation(x: number, y: number, terrain?:TerrainField) {
  if(terrain)return terrain.height(x,y);
  return 12 + 70 * Math.exp(-((x-12)**2 / 35 + (y-6)**2 / 22));
}
export function project(p: Point) {
  return { x:(p.x-p.y)*42, y:(p.x+p.y)*21-elevation(p.x,p.y) };
}
export function unproject(p: Point): Point {
  const difference = p.x / 42;
  let sum = p.y / 21;
  for (let i=0;i<24;i++) sum=(p.y+elevation((sum+difference)/2,(sum-difference)/2))/21;
  return {x:(sum+difference)/2,y:(sum-difference)/2};
}
export function isLand(p: Point, margin=0, terrain?:TerrainField) {
  if(terrain)return terrain.land(p.x,p.y,margin);
  const x=(p.x-12)/(10.6-margin), y=(p.y-12)/(10.3-margin);
  return x*x+y*y < 1;
}
export function walkable(p: Point, terrain?:TerrainField) {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && isLand(p,RADIUS+.2,terrain) &&
    obstacles.every(o=>Math.hypot(p.x-o.x,p.y-o.y)>o.radius+RADIUS);
}
export function clearSegment(a:Point,b:Point,terrain?:TerrainField) {
  const n=Math.max(1,Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)/.08));
  for(let i=0;i<=n;i++) if(!walkable({x:a.x+(b.x-a.x)*i/n,y:a.y+(b.y-a.y)*i/n},terrain)) return false;
  return true;
}
/** Half-tile navigation with swept collision checks, also suitable for server validation. */
export function findPath(start:Point,target:Point,terrain?:TerrainField):Point[] {
  target={x:target.x,y:target.y};
  if(!walkable(start,terrain)||!walkable(target,terrain)) return [];
  if(clearSegment(start,target,terrain)) return [target];
  const step=.5, size=49;
  const key=(x:number,y:number)=>y*size+x;
  const point=(id:number):Point=>({x:(id%size)*step,y:Math.floor(id/size)*step});
  const nearest=(p:Point)=>{
    const candidates:number[]=[];
    for(let y=-2;y<=2;y++) for(let x=-2;x<=2;x++) {
      const nx=Math.round(p.x/step)+x,ny=Math.round(p.y/step)+y;
      if(nx<0||ny<0||nx>=size||ny>=size)continue;
      const id=key(nx,ny); if(clearSegment(p,point(id),terrain))candidates.push(id);
    }
    return candidates.sort((a,b)=>Math.hypot(point(a).x-p.x,point(a).y-p.y)-Math.hypot(point(b).x-p.x,point(b).y-p.y))[0];
  };
  const first=nearest(start),last=nearest(target);
  if(first===undefined||last===undefined)return [];
  const open=new Set([first]),came=new Map<number,number>(),cost=new Map([[first,0]]);
  const heuristic=(id:number)=>Math.hypot(point(id).x-point(last).x,point(id).y-point(last).y);
  while(open.size) {
    let current=-1,best=Infinity;
    for(const id of open) {const score=cost.get(id)!+heuristic(id);if(score<best){best=score;current=id;}}
    if(current===last){
      const ids=[last];while(came.has(ids[0]))ids.unshift(came.get(ids[0])!);
      const rough=[start,...ids.map(point),target],smooth:Point[]=[];
      let at=0;
      while(at<rough.length-1){let next=rough.length-1;while(next>at+1&&!clearSegment(rough[at],rough[next],terrain))next--;smooth.push(rough[next]);at=next;}
      return smooth;
    }
    open.delete(current);
    const a=point(current);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const nx=current%size+dx,ny=Math.floor(current/size)+dy;
      if(nx<0||ny<0||nx>=size||ny>=size)continue;
      const id=key(nx,ny),b=point(id);
      if(!clearSegment(a,b,terrain))continue;
      const next=cost.get(current)!+Math.hypot(dx,dy)*step;
      if(next<(cost.get(id)??Infinity)){cost.set(id,next);came.set(id,current);open.add(id);}
    }
  }
  return [];
}
export function moveAlong(position:Point,path:Point[],seconds:number,terrain?:TerrainField):Point {
  let result={...position},remaining=SPEED*Math.min(.1,Math.max(0,seconds));
  while(path.length&&remaining>0){
    const to=path[0],distance=Math.hypot(to.x-result.x,to.y-result.y);
    const amount=Math.min(distance,remaining);
    const next=distance<1e-8?to:{x:result.x+(to.x-result.x)*amount/distance,y:result.y+(to.y-result.y)*amount/distance};
    if(!clearSegment(result,next,terrain)){path.length=0;break;}
    result={...next};remaining-=amount;
    if(distance<=amount+1e-8)path.shift();
  }
  return result;
}
export function moveDirection(position:Point,direction:Point,seconds:number,terrain?:TerrainField):Point {
  const length=Math.hypot(direction.x,direction.y);
  if(!Number.isFinite(length)||length<.01)return position;
  const distance=SPEED*Math.min(.1,Math.max(0,seconds));
  const next={x:position.x+direction.x/length*distance,y:position.y+direction.y/length*distance};
  if(clearSegment(position,next,terrain))return next;
  const slideX={x:next.x,y:position.y},slideY={x:position.x,y:next.y};
  return clearSegment(position,slideX,terrain)?slideX:clearSegment(position,slideY,terrain)?slideY:position;
}
