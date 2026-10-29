// Card foto-cenas-cidade: a city print with the hero off the map shows only the camera's background (OUTSIDE_CITY,
// src/client/render/city/palette.ts) around him. tools/foto.mjs measures that share on every city print and fails it.

/** The city's background outside the map (#2B2542) and how far a pixel may be from it (per channel). */
export const OUTSIDE_RGB=[0x2b,0x25,0x42];
export const OUTSIDE_TOL=6;
/** A print with more than this share of background has no map (an edge of the map in the frame stays well under). */
export const EMPTY_MAX=0.5;

/** Share (0..1) of pixels at the background colour in raw pixels (`channels` per pixel, RGB first). */
export function emptyShare(data,channels){
  let n=0,total=0;
  for(let i=0;i+2<data.length;i+=channels){
    total++;
    if(Math.abs(data[i]-OUTSIDE_RGB[0])<=OUTSIDE_TOL&&Math.abs(data[i+1]-OUTSIDE_RGB[1])<=OUTSIDE_TOL&&Math.abs(data[i+2]-OUTSIDE_RGB[2])<=OUTSIDE_TOL)n++;
  }
  return total?n/total:0;
}

/** The scenes of the modo foto registry (src/client/dev/foto.ts source) with their sandbox; chaveiro(…) is the city. */
export function sceneSandboxes(src){
  return [...src.matchAll(/^\s+'([a-z0-9-]+)':\{(?:sandbox:'([a-z]+)'|\.\.\.chaveiro\()/gm)].map(m=>[m[1],m[2]??'cidade']);
}
