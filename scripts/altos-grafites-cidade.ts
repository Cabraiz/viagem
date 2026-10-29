// NEW-20261029-ORQ-cidade-decor-alto-e-grafite (colocação): the scenery the street mouths lost (semDecorNasBocas) comes
// back where it narrows nothing. Tall pieces (altos: a water tower, a cell tower, old signs) stand in the place of a few
// solid wall pieces, and graffiti (grafites) are painted on the faces of the solid walls that look onto a street. Both
// stand on wall cells, which are solid already: the walkable grid and the collision stay as they are.
import {decodeCityAsset,encodeCityAsset,type CityAssetData,type CityDecor} from '../src/maps/city-asset.ts';
import {FACE_ROT,type DecorFace} from '../src/maps/city-decor.ts';
import {cityEntradas,estreitaBoca} from '../src/maps/city/entradas.ts';

/** The tall pieces (E1's art, scripts/art-v2/adaptar/decor.mjs DECOR_HEIGHT). Cut one by taking its id out. */
export const ALTOS=['caixa-dagua-torre-1','torre-celular-1','letreiro-velho-1','placa-igreja-1','placa-forro-1'] as const;
/** The graffiti (E1's art, meta.decal: one view, drawn on a wall's face). Cut one by taking its id out. */
export const GRAFITES=[
  'grafite-arretado','grafite-asa-branca','grafite-bode','grafite-boneco-cangaceiro','grafite-cade-verao',
  'grafite-chapeu-cangaceiro','grafite-coracao-jm','grafite-fora-uno','grafite-jegue','grafite-mandacaru','grafite-oxe',
  'grafite-sextou','grafite-sol-gorro','grafite-tags','grafite-te-amo-maria','grafite-ze-do-gas',
] as const;
export const isGrafite=(id:string)=>(GRAFITES as readonly string[]).includes(id);
export const isAlto=(id:string)=>(ALTOS as readonly string[]).includes(id);
/** The solid wall pieces a tall piece or a graffito may take (the open fences show the street through them). */
export const PAREDE=/^(muro-pichado|muro-condominio|tapume)-reto-(intacto|quebrado)$/;
/** The boulders of the border band (one cell each, on solid ground) a tall piece may also take. */
export const PEDRA=/^pedregulho-\d$/;
/** The wall pieces a graffito is painted on: a broken one has its hole in the middle, where the paint would float. */
export const PAREDE_INTEIRA=/-reto-intacto$/;
export const ALTOS_SEED=20261029;
/** How many of each (the mouths lost 100 pieces: 40 + 72 bring at least that many back). */
export const N_ALTOS=40,N_GRAFITES=72;
/**
 * No tall piece this near (u) an entrance's point, nor on the cells of its passage (estreitaBoca). The city has 375
 * entrances on 1.5 u cells: TRALHA_ENTRADA_RAIO (6 u, the barricades on the ground) leaves 7 walls; a piece on a wall
 * cell blocks nothing, so two cells keep it off the mouth itself.
 */
export const ALTO_ENTRADA_RAIO=3;
/** Spacing (cells, centre to centre): between tall pieces, two of the same tall piece, any two graffiti, two of the same graffito. */
export const GAP={alto:8,mesmoAlto:20,grafite:2,mesmoGrafite:12} as const;
/** No tall piece this near (cells, centre to centre) a standing piece (a cart, a lamp): it would stand over it. */
export const ALTO_LIVRE=2;
/** Around a removed piece (u): a wall this near the place that lost it scores first. */
const PERTO=16,LONGE=32;
/** How far (u) the scenery is counted to find the streets left empty. */
const VAZIO_RAIO=10;

const FACES:Readonly<Record<DecorFace,readonly [number,number]>>={N:[0,-1],S:[0,1],E:[1,0],W:[-1,0]};

function mulberry(seed:number){
  let t=seed>>>0;
  return ()=>{t=(t+0x6d2b79f5)>>>0;let x=Math.imul(t^(t>>>15),1|t);x^=x+Math.imul(x^(x>>>7),61|x);return ((x^(x>>>14))>>>0)/4294967296;};
}

export interface AltosGrafites {readonly altos:readonly CityDecor[];readonly grafites:readonly CityDecor[]}

/**
 * Places the tall pieces and the graffiti on `data` (changed in place). `removidos`: the pieces the mouths lost (their
 * places score first); then the walls on a street with little scenery. Every pick is seeded: the same map and seed give
 * the same pieces. A tall piece takes the place of the wall piece (a `cover` of the wall's own id keeps its cell from
 * the procedural box); a graffito is one more entry on the wall's cell, `rot` the face it is painted on (FACE_ROT).
 */
export function altosEGrafites(data:CityAssetData,removidos:readonly CityDecor[],seed=ALTOS_SEED):AltosGrafites{
  const d=decodeCityAsset(encodeCityAsset(data));
  if(!d.ok)throw new Error(d.error);
  const a=d.asset,u=a.unitsPerCell,rnd=mulberry(seed),bocas=cityEntradas(a);
  // Points in cells (a wall piece's centre may sit on a cell edge: wall-lines.ts pieceRect).
  const walk=(x:number,y:number)=>x>=0&&y>=0&&x<a.cells.w&&y<a.cells.h&&a.walkableAt(x*u,y*u);
  const mid=(q:CityDecor)=>({x:q.c+q.w/2,y:q.r+q.h/2});
  const decor=[...(data.decor??[])];
  const standing=decor.filter(q=>!q.cover&&!PAREDE.test(q.id)&&!/^(pedregulho|penhasco)/.test(q.id)&&!/-(reto|quina|t|ponta)-/.test(q.id));
  const crowd=(x:number,y:number)=>standing.reduce((n,q)=>n+(Math.hypot((q.c+q.w/2)*u-x,(q.r+q.h/2)*u-y)<=VAZIO_RAIO?1:0),0);
  const near=(x:number,y:number)=>removidos.reduce((m,q)=>Math.min(m,Math.hypot((q.c+q.w/2)*u-x,(q.r+q.h/2)*u-y)),Infinity);
  interface Spot {readonly i:number;readonly q:CityDecor;readonly face:DecorFace;readonly score:number;readonly wall:boolean;readonly deep:boolean}
  const spots:Spot[]=[];
  decor.forEach((q,i)=>{
    if(q.cover)return;
    const wall=PAREDE.test(q.id),o=mid(q);
    if(!(wall||PEDRA.test(q.id)&&q.w===1&&q.h===1)||walk(o.x,o.y))return;
    // A wall shows its two long faces (rot 0: a line along r, rot 90 along c); a boulder any side.
    const faces=(wall?q.rot===0||q.rot===180?['E','W']:['N','S']:['S','E','N','W']) as DecorFace[];
    for(const face of faces){
      const [dx,dy]=FACES[face];
      // A face onto walkable ground (a cell and a bit out from the line: a wall two cells thick has its own cell
      // there); deep: a cell further walkable too (a street, not a notch: a tall piece wants one).
      if(!walk(o.x+1.25*dx,o.y+1.25*dy))continue;
      const deep=walk(o.x+2.25*dx,o.y+2.25*dy);
      const x=(o.x+1.25*dx)*u,y=(o.y+1.25*dy)*u,m=near(x,y);
      spots.push({i,q,face,wall,deep,score:(m<=PERTO?2:m<=LONGE?1:0)+1/(1+crowd(x,y))+rnd()*.75});
    }
  });
  spots.sort((p,q)=>q.score-p.score||p.i-q.i||p.face.localeCompare(q.face));
  const dist=(p:CityDecor,q:CityDecor)=>{const A=mid(p),B=mid(q);return Math.hypot(A.x-B.x,A.y-B.y);};
  const mouthGap=(q:CityDecor)=>bocas.reduce((m,e)=>Math.min(m,Math.hypot(Math.max(q.c*u-e.x,0,e.x-(q.c+q.w)*u),Math.max(q.r*u-e.y,0,e.y-(q.r+q.h)*u))),Infinity);
  const pick=<T extends string>(ids:readonly T[],placed:readonly CityDecor[],q:CityDecor,same:number):T|undefined=>{
    const used=new Map<string,number>();for(const p of placed)used.set(p.id,(used.get(p.id)??0)+1);
    const free=ids.filter(id=>!placed.some(p=>p.id===id&&dist(p,q)<same));
    if(!free.length)return undefined;
    const least=Math.min(...free.map(id=>used.get(id)??0)),pool=free.filter(id=>(used.get(id)??0)===least);
    return pool[Math.floor(rnd()*pool.length)];
  };
  // The tall pieces first, in the place of the piece (its rect: drawn at its centre), away from the mouths, each
  // other and the standing pieces. A wall scores less for one: the walls are the graffiti's, the border's boulders the towers'.
  const altos:CityDecor[]=[],taken=new Set<number>();
  for(const s of [...spots].sort((p,q)=>(q.score-(q.wall?1:0))-(p.score-(p.wall?1:0))||p.i-q.i||p.face.localeCompare(q.face))){
    if(altos.length>=N_ALTOS)break;
    if(!s.deep||taken.has(s.i)||mouthGap(s.q)<=ALTO_ENTRADA_RAIO||bocas.some(e=>estreitaBoca(a,e,s.q))||altos.some(p=>dist(p,s.q)<GAP.alto)||standing.some(p=>dist(p,s.q)<ALTO_LIVRE))continue;
    const id=pick(ALTOS,altos,s.q,GAP.mesmoAlto);
    if(!id)continue;
    taken.add(s.i);altos.push({id,c:s.q.c,r:s.q.r,w:s.q.w,h:s.q.h,rot:FACE_ROT[s.face]});
  }
  // Then the graffiti on the other walls: one face per piece, on the piece's rect, never two alike side by side.
  const grafites:CityDecor[]=[],painted=new Set<number>();
  for(const s of spots){
    if(grafites.length>=N_GRAFITES)break;
    if(!s.wall||!PAREDE_INTEIRA.test(s.q.id)||taken.has(s.i)||painted.has(s.i)||grafites.some(p=>dist(p,s.q)<GAP.grafite))continue;
    const id=pick(GRAFITES,grafites,s.q,GAP.mesmoGrafite);
    if(!id)continue;
    painted.add(s.i);grafites.push({id,c:s.q.c,r:s.q.r,w:s.q.w,h:s.q.h,rot:FACE_ROT[s.face]});
  }
  const covers=[...taken].map(i=>{const q=decor[i];return {id:q.id,c:q.c,r:q.r,w:q.w,h:q.h,rot:0,cover:true} as CityDecor;});
  data.decor=[...decor.filter((_,i)=>!taken.has(i)),...covers,...altos,...grafites];
  return {altos,grafites};
}
