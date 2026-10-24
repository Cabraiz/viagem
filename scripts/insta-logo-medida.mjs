// The top bar's logos measured so the four read as one size and sit on one point
// (BUG-20261023-ORQ-insta-letreiros-mesma-cor-tamanho; the user: "o size do maromba está maior que do viciado", then
// "centro igual", the gato's was off to the right and down). Each keeps its own colours. Used by scripts/insta-arte.mjs
// (it writes the files) and tests/tools/insta-logo-medida.test.ts (it checks them).

/** The lightest logo's drawing height (px); the others shrink from it to its weight. */
export const LOGO_H=168;
/** Every logo file's canvas (px): the drawing's visual centre at its middle, so CSS needs no per-hero rule. */
export const LOGO_CAIXA=[280,200];

const luz=(d,i)=>(.2126*d[i]+.7152*d[i+1]+.0722*d[i+2])/255;

/**
 * A logo's visual weight: Σ alpha·darkness over its pixels. The maromba's dark disc weighs more than the viciado's
 * light letters at the same height, which is what read as "bigger"; the weight grows with the square of the size.
 */
export function pesoVisual(data){
  let peso=0;
  for(let i=0;i<data.length;i+=4)peso+=data[i+3]/255*(1-luz(data,i));
  return peso;
}

/** The drawing's visual centre: the mean of its pixels weighted by alpha (the gato's thin ring and bell barely pull). */
export function centro(data,{width}){
  let sx=0,sy=0,s=0;
  for(let i=0,k=0;i<data.length;i+=4,k++){const a=data[i+3]/255;sx+=a*(k%width);sy+=a*Math.floor(k/width);s+=a;}
  return [sx/s,sy/s];
}
