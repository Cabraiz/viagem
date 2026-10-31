// NEW-20261031-ORQ-esconder-dejetos-sem-brilho (the user, 31/10: "alguns dejetos no jogo simplesmente estão muito sem
// brilho ou mal feitos, seria bom remove-los pq eles não trazem nada"): the junk pieces picked on the numbered prancha
// (claims/…/prancha-dejetos.png) leave the city map. Nothing is deleted: the art stays in public/art, the map just stops
// placing it. compactar-cidade.ts runs semDejetos last (version + 1).
import {decodeCityAsset,encodeCityAsset,type CityAssetData,type CityBlock,type CityDecor} from '../../src/maps/city-asset.ts';
import {PROP_REMOVED,openCells} from '../becos-cidade.ts';

/** Sidewalk decor ids hidden: the plain little box and the dark bin bags (prancha 3, 16, 17). */
export const DECOR_OCULTO:ReadonlySet<string>=new Set(['caixa-papelao-1','saco-lixo-1','saco-lixo-2']);
/**
 * The ruin props (drawn as debris, art-plan.ts propSheet) whose piece was hidden: carrinho-supermercado, isopor and
 * placa-torta buried in rock, the blurry tronco-caido (prancha 21, 23, 25, 27). By position (u): the client picks a
 * prop's art by its index (`p${i}`), so they stay in the list as PROP_REMOVED. None is solid.
 */
export const PROPS_OCULTOS:readonly (readonly [number,number])[]=[[153.418,65.138],[136.17,85.523],[56.139,111.421],[70.067,122.134],[76.709,160.06]];
const NEAR=.01;

/**
 * Every rubble block (the faded entulho-1x1 heaps, prancha 18–20) opens: walkable and buildable ground, no block and so
 * no lot or mound drawn on it (becos-cidade.ts openCells). The hidden decor ids go, and the hidden props go as
 * PROP_REMOVED. Changes `data`, returns what it took.
 */
export function semDejetos(data:CityAssetData):{rubble:string[];cells:number;decor:CityDecor[];props:number[]}{
  const m=data.cells.w,u=data.unitsPerCell!;
  const cellsOf=(b:CityBlock)=>{const cells:number[]=[];
    for(const [x,y,w,h] of b.rects)for(let cy=Math.round(y/u);cy<Math.round((y+h)/u);cy++)for(let cx=Math.round(x/u);cx<Math.round((x+w)/u);cx++)cells.push(cx+cy*m);
    return cells;};
  const heaps=data.blocks.filter(b=>b.kind==='rubble'),cells=heaps.flatMap(cellsOf);
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
  return {rubble:heaps.map(b=>b.id),cells:cells.length,decor,props};
}
