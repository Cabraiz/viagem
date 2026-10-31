// NEW-20261031-ORQ-esconder-dejetos-sem-brilho (the user, 31/10: "alguns dejetos no jogo simplesmente estão muito sem
// brilho ou mal feitos, seria bom remove-los pq eles não trazem nada"): the junk pieces picked on the numbered prancha
// (claims/…/prancha-dejetos.png) leave the city map. Nothing is deleted: the art stays in public/art, the map just stops
// placing it. compactar-cidade.ts runs semDejetos before the last clearing of the entrances (version + 1).
import {decodeCityAsset,encodeCityAsset,type CityAssetData,type CityBlock,type CityDecor} from '../../src/maps/city-asset.ts';
import {PROP_REMOVED,openCells} from '../becos-cidade.ts';
import {LINK,lineShape} from '../../src/maps/city-decor.ts';

/** Sidewalk decor ids hidden: the plain little box and the dark bin bags (prancha 3, 16, 17). */
export const DECOR_OCULTO:ReadonlySet<string>=new Set(['caixa-papelao-1','saco-lixo-1','saco-lixo-2']);
/**
 * The ruin props (drawn as debris, art-plan.ts propSheet) whose piece was hidden: carrinho-supermercado, isopor and
 * placa-torta buried in rock, the blurry tronco-caido (prancha 21, 23, 25, 27). By position (u): the client picks a
 * prop's art by its index (`p${i}`), so they stay in the list as PROP_REMOVED. None is solid.
 */
export const PROPS_OCULTOS:readonly (readonly [number,number])[]=[[153.418,65.138],[136.17,85.523],[56.139,111.421],[70.067,122.134],[76.709,160.06]];
const NEAR=.01;

const cellsOf=(data:CityAssetData,b:CityBlock)=>{const m=data.cells.w,u=data.unitsPerCell!,cells:number[]=[];
  for(const [x,y,w,h] of b.rects)for(let cy=Math.round(y/u);cy<Math.round((y+h)/u);cy++)for(let cx=Math.round(x/u);cx<Math.round((x+w)/u);cx++)cells.push(cx+cy*m);
  return cells;};
const kindAt=(data:CityAssetData,c:number,r:number)=>{const u=data.unitsPerCell!;
  return data.blocks.find(b=>b.rects.some(([x,y,w,h])=>(c+.5)*u>x&&(c+.5)*u<x+w&&(r+.5)*u>y&&(r+.5)*u<y+h))?.kind;};
/**
 * The heaps plugging a gap in a cliff wall (cliff on two opposite sides of each of their cells) become cliff: opened,
 * one would cut a new passage through the wall, a new street mouth that takes the shops' ring spots (b-0143 in cliff
 * b-0127: chaveiro seed 1 banco-2 29 → 52 u from the car). Still solid, as before, drawn as cliff: a cliff line piece on
 * each of their cells and the 1×1 line pieces next to them linked again (city-decor.ts lineShape); the rest of the
 * decor stays where it was (converting before decorate reshuffles the whole seeded plan). `apply` false: only lists them.
 */
export function tampoesDePenhasco(data:CityAssetData,apply=true):string[]{
  const m=data.cells.w,cliff=(c:number,r:number)=>kindAt(data,c,r)==='cliff';
  const plugs=(b:CityBlock)=>cellsOf(data,b).every(t=>{const c=t%m,r=(t-c)/m;return cliff(c-1,r)&&cliff(c+1,r)||cliff(c,r-1)&&cliff(c,r+1);});
  const found=data.blocks.filter(b=>b.kind==='rubble'&&plugs(b)),ids=new Set(found.map(b=>b.id));
  if(!apply||!found.length)return [...ids];
  const cells=found.flatMap(b=>cellsOf(data,b)).map(t=>[t%m,Math.floor(t/m)] as const);
  data.blocks=data.blocks.map(b=>ids.has(b.id)?{...b,kind:'cliff'}:b);
  const piece=(c:number,r:number)=>{
    const links=(cliff(c,r-1)?LINK.N:0)|(cliff(c+1,r)?LINK.E:0)|(cliff(c,r+1)?LINK.S:0)|(cliff(c-1,r)?LINK.W:0),{shape,rot}=lineShape(links);
    return {id:shape==='quina'?'penhasco2-quina-externa':shape==='ponta'?'penhasco-ponta':'penhasco2-reto',c,r,w:1,h:1,rot,links};
  };
  const covers=(q:CityDecor,c:number,r:number)=>c>=q.c&&c<q.c+q.w&&r>=q.r&&r<q.r+q.h;
  const line=(q:CityDecor)=>q.w===1&&q.h===1&&(q.id.startsWith('penhasco2-')||q.id==='penhasco-ponta');
  const beside=(q:CityDecor)=>cells.some(([c,r])=>Math.abs(q.c-c)+Math.abs(q.r-r)===1);
  data.decor=[...(data.decor??[]).filter(q=>!cells.some(([c,r])=>covers(q,c,r))).map(q=>line(q)&&beside(q)?{...q,...piece(q.c,q.r)}:q),
    ...cells.map(([c,r])=>piece(c,r))];
  return [...ids];
}

/**
 * Every rubble block (the faded entulho-1x1 heaps, prancha 18–20) opens: walkable and buildable ground, no block and so
 * no lot or mound drawn on it (becos-cidade.ts openCells), but the heaps plugging a cliff gap stand as cliff
 * (tampoesDePenhasco).
 * The hidden decor ids go, and the hidden props go as PROP_REMOVED. Changes `data`, returns what it took.
 */
export function semDejetos(data:CityAssetData):{rubble:string[];cliff:string[];cells:number;decor:CityDecor[];props:number[]}{
  const cliff=tampoesDePenhasco(data);
  const heaps=data.blocks.filter(b=>b.kind==='rubble'),cells=heaps.flatMap(b=>cellsOf(data,b));
  if(cells.length)openCells(data,cells);
  const decor=(data.decor??[]).filter(q=>DECOR_OCULTO.has(q.id));
  data.decor=(data.decor??[]).filter(q=>!DECOR_OCULTO.has(q.id));
  const props:number[]=[];
  for(const [x,y] of PROPS_OCULTOS){
    const i=data.props.findIndex(p=>p.kind!==PROP_REMOVED&&Math.abs(p.x-x)<NEAR&&Math.abs(p.y-y)<NEAR);
    if(i<0)throw new Error(`semDejetos: no prop at (${x}, ${y}): the map moved, pick the hidden props again (scripts/dejetos/catalogo.ts)`);
    if(data.props[i].solid)throw new Error(`semDejetos: the prop at (${x}, ${y}) is solid`);
    data.props[i]={...data.props[i],kind:PROP_REMOVED,solid:false};props.push(i);
  }
  const d=decodeCityAsset(encodeCityAsset(data));
  if(!d.ok)throw new Error(d.error);
  return {rubble:heaps.map(b=>b.id),cliff,cells:cells.length,decor,props};
}
