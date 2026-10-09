import type {TerrainField} from './terrain/field.ts';
import {isLand,landmarks,obstacles,project} from './world.ts';
import {projectView,normalizeView} from './projection.ts';

const center=project({x:12,y:12});
export const SHORE={x:center.x,y:center.y+40,width:1290,height:710};

// Include the coast, tile cliffs, scenery and character silhouettes at the
// edges. The render texture also has decorative ocean ripples outside the map.
function islandBounds(view=0,terrain?:TerrainField){
  let left=SHORE.x-SHORE.width/2,right=SHORE.x+SHORE.width/2;
  let top=SHORE.y-SHORE.height/2,bottom=SHORE.y+SHORE.height/2;
  const include=(x:number,y:number)=>{left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);};
  for(let y=1;y<24;y++)for(let x=1;x<24;x++)if(isLand({x:x+.5,y:y+.5},0,terrain)){
    for(const corner of [{x,y},{x:x+1,y},{x:x+1,y:y+1},{x,y:y+1}]){
      const p=projectView(corner,view,terrain);include(p.x-56,p.y-100);include(p.x+56,p.y+30);
    }
  }
  for(const prop of [...obstacles,...landmarks]){
    const p=projectView(prop,view,terrain);include(p.x-160,p.y-250);include(p.x+160,p.y+65);
  }
  return {left,right,top,bottom};
}
export const ISLAND_BOUNDS=islandBounds();
export const ISLAND_VIEWS=[ISLAND_BOUNDS,islandBounds(1),islandBounds(2),islandBounds(3)];

export function fitIsland(width:number,height:number,view=0,terrain?:TerrainField){
  const bounds=terrain?islandBounds(normalizeView(view),terrain):ISLAND_VIEWS[normalizeView(view)];
  const zoom=Math.min(Math.max(1,width-32)/(bounds.right-bounds.left),Math.max(1,height-32)/(bounds.bottom-bounds.top));
  return {zoom,x:(bounds.left+bounds.right)/2,y:(bounds.top+bounds.bottom)/2};
}
