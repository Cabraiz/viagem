// The top bar's logos in one ink (BUG-20261023-ORQ-insta-letreiros-mesma-cor-tamanho, the user: "um filtro nos emblemas
// para eles terem as mesmas cores e size"): each letreiro's lightness, stretched to its own 2..98 % range, mapped onto
// one ramp (dark, middle, light), so the four read as one family like Instagram's one-colour logo; and each drawn at
// the height that gives it the same visual weight (its darkness summed over its opaque pixels) as the lightest one,
// because the maromba's dark disc read bigger than the viciado's airy letters at the same height. Used by
// scripts/insta-arte.mjs (it writes the files) and tests/tools/insta-tinta.test.ts (it checks them).

/** The ramps the user chose between: (a) the @handle's ink up to the page; (b) the game's purple (SELECIONAR). */
export const TINTAS={
  a:['#170D36','#5B5470','#FBFAF8'],
  b:['#3A0B78','#8623CC','#F1E6FF'],
};
export const TINTA='a';

const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const luz=(d,i)=>(.2126*d[i]+.7152*d[i+1]+.0722*d[i+2])/255;

/** The ramp's colour at t (0 = dark, 1 = light). */
export function rampa(stops,t){
  const s=stops.map(hex),[p,q,u]=t<.5?[s[0],s[1],t*2]:[s[1],s[2],t*2-1];
  return p.map((c,k)=>c+(q[k]-c)*u);
}

/** Lightness stretched to the letreiro's own 2..98 % (opaque pixels only): every logo spans the whole ramp. */
function esticar(data){
  const ls=[];
  for(let i=0;i<data.length;i+=4)if(data[i+3]>128)ls.push(luz(data,i));
  ls.sort((a,b)=>a-b);
  const lo=ls[Math.floor(ls.length*.02)],hi=ls[Math.floor(ls.length*.98)];
  return i=>Math.max(0,Math.min(1,(luz(data,i)-lo)/(hi-lo)));
}

/** Paints raw RGBA (in place) in the ramp. */
export function tingir(data,stops){
  const t=esticar(data),ls=[];
  for(let i=0;i<data.length;i+=4)ls.push(t(i));
  for(let i=0,k=0;i<data.length;i+=4,k++){const c=rampa(stops,ls[k]);data[i]=Math.round(c[0]);data[i+1]=Math.round(c[1]);data[i+2]=Math.round(c[2]);}
}

/** A logo's visual weight, Σ alpha·darkness: the darkness read back between the ramp's dark and light ends. */
export function pesoVisual(data,stops){
  const [d,,c]=stops.map(hex),ld=(.2126*d[0]+.7152*d[1]+.0722*d[2])/255,lc=(.2126*c[0]+.7152*c[1]+.0722*c[2])/255;
  let peso=0;
  for(let i=0;i<data.length;i+=4)peso+=data[i+3]/255*Math.max(0,Math.min(1,(lc-luz(data,i))/(lc-ld)));
  return peso;
}
