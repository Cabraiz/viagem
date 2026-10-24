/**
 * The new scenery on Cidade Nevada (NEW-20261016-ORQ-cenario-no-mapa): where each delivered piece stands (CityDecor).
 * Pure and deterministic (asset + seed + keep-outs); scripts/cenario-cidade.ts writes the result into the asset.
 * The map's quarters are compounds closed by 1-cell lines of wall and cliff, with open ground inside:
 *  - wall cells → one continuous line along the wall's middle, straight pieces back to back (wallLines), one family per
 *    block, ~20 % broken;
 *  - cliff cells → `penhasco2` pieces the same way; the border band (edge block) → mountains (6×6, 4×4, morro 3×3) where
 *    they fit whole and a boulder on every edge cell left (the render draws it over the cell instead of the box);
 *  - building blocks → packed lots: one place with life (lugar) per block while any is left, then houses and flats,
 *    fronts to the street when they can;
 *  - more places with life inside the compounds, backed onto a wall or cliff, front to the open ground, never closer than
 *    LUGAR_SPACING to another: their cells stop being walkable (`blocked`), only where the open ground stays connected and
 *    a 1-cell walk stays around them;
 *  - poles every ~POLE_SPACING cells along the sidewalks (walkable cells against a wall, cliff or building) and dense
 *    small objects on the rest of the sidewalks (walked through: they never change the grid).
 * Nothing stands in a keep-out (the base and the plaza, the start, spawns and mouths, build sites, nests, loot, props).
 */
import type {CityAsset,CityBlockKind,CityDecor} from './city-asset.ts';
import {pieceRect,wallPieces,wallRuns,type WallPiece} from './wall-lines.ts';

export type DecorFace='S'|'E'|'N'|'W';
/** The art view that shows a front facing that way with the camera at view 0 (CityDecor.rot). */
export const FACE_ROT:Readonly<Record<DecorFace,CityDecor['rot']>>={S:0,E:90,N:180,W:270};
/** Neighbour bits of CityDecor.links. */
export const LINK={N:1,E:2,S:4,W:8} as const;

/** Places with life (lugares): [id without the variant, footprint a×b with the front along a]. Two variants each (-1, -2). */
export const LUGARES:readonly (readonly [string,number,number])[]=[
  ['boteco-apocaliptico',2,1],['posto-gasolina',3,2],['posto-policial',2,1],['farmacia',2,1],['padaria',2,1],['escola',3,2],
  ['quadra',3,2],['feira-coberta',3,1],['ubs',2,2],['academia-praca',2,2],['lava-jato',2,1],['igreja-evangelica',2,1],
  ['acougue',1,1],['borracharia',1,1],['lan-house',1,1],['loterica',1,1],['salao-beleza',1,1],
];
/** Homes and flats for the building blocks, biggest first. */
export const MORADIAS:readonly (readonly [string,number,number])[]=[
  ['conjunto-habitacional',4,2],['predio-apto-8a',3,3],['predio-apto-5a',3,3],['predinho-3a',2,2],['igrejinha',2,2],
  ['casa-geminada',2,1],['casa-laje-2x1',2,1],['condominio-guarita',2,1],['casa-laje-1x1',1,1],['puxadinho',1,1],
];
export const WALL_FAMILIES=['muro-pichado','muro-condominio','grade','tapume','alambrado','cerca-madeira'] as const;
export const MOUNTAINS:readonly (readonly [string,number])[]=[['montanha-6x6',6],['montanha-4x4',4],['morro-3x3',3]];
/** Sidewalk objects, 1×1 (two variants each unless the id ends in a number already). */
export const OBJETOS_1:readonly string[]=['bebedouro','cadeira-praia','caixa-papelao','carrinho-pipoca','fogueira-tambor','gaiola-passarinho',
  'geladeira-calcada','maquina-lavar-calcada','mesa-domino','piscina-plastico','pneus-empilhados','presepio-quebrado','saco-lixo',
  'vaso-planta','arvore-natal-torta','bicicleta-1','carroca-1','outdoor-1'];
/** Sidewalk objects 2×1 (along the sidewalk). */
export const OBJETOS_2:readonly string[]=['banca-jornal','barraca-feira','cacamba-entulho','moto-velha','ponto-mototaxi','varal-roupa',
  'bicicleta-2','carroca-2','outdoor-2','kombi-velha-1'];
export const POSTES:readonly (readonly [string,number])[]=[['poste-concreto-1',3],['poste-concreto-2',3],['poste-concreto-3',3],
  ['poste-aceso-amarelo-1',1],['poste-aceso-amarelo-2',1],['poste-gato-1',1],['poste-gato-2',1],['luminaria-quebrada-pisca-1',.5],['luminaria-quebrada-pisca-2',.5]];

/** LUGAR_SPACING: cells between two places with life, a map distance (22 on the 1.7× city, ÷ 1.75 since asset v4). */
export const POLE_SPACING=4,LUGAR_SPACING=13,OBJECT_DENSITY=.35,BROKEN_SHARE=.2;
/**
 * Pieces the art import refused (E8, importar-cenario-novo 16/10: problems in the art, asked back from the artist):
 * never placed, so no cell turns into an invisible wall waiting for art that will not come. A family whose variants are
 * all refused (lava-jato, posto-gasolina, predio-apto-8a) is left out; take an id off this list when its art is back.
 */
export const DECOR_REFUSED:ReadonlySet<string>=new Set(['lava-jato-1','lava-jato-2','posto-policial-1','posto-gasolina-1','posto-gasolina-2',
  'quadra-1','predio-apto-8a-1','predio-apto-8a-2','arvore-natal-torta-2','caixa-papelao-2']);
/** Line shapes at rot 0 (links), turned a quarter (rot +90) the way FACE_ROT goes: S → E → N → W. */
const LINE_BASE={reto:LINK.N|LINK.S,quina:LINK.E|LINK.S,t:LINK.N|LINK.E|LINK.S,ponta:LINK.S} as const;

export interface DecorKeepOut {readonly x:number;readonly y:number;readonly r:number;
  /** Kept bare of every piece, lines and border boulders too (the plaza: the base stands there). */
  readonly all?:boolean}
export interface DecorOptions {
  /** Discs (u) nothing is placed in. */
  keepOut?:readonly DecorKeepOut[];
  /** Rects (u, top-left and size) nothing is placed in (build sites). */
  keepOutRects?:readonly {x:number;y:number;w:number;h:number}[];
}
export interface DecorResult {
  readonly decor:CityDecor[];
  /** Cells (c, r) that stop being walkable: the places with life put on open ground. */
  readonly blocked:readonly (readonly [number,number])[];
}

/** One quarter turn of a links mask, the way rot goes (S → E → N → W). */
export const turnLinks=(m:number)=>((m&LINK.N)?LINK.W:0)|((m&LINK.E)?LINK.N:0)|((m&LINK.S)?LINK.E:0)|((m&LINK.W)?LINK.S:0);
/** The line shape and rot that draw `links` (no links: a ponta; all four: a t). */
export function lineShape(links:number):{shape:keyof typeof LINE_BASE;rot:CityDecor['rot']}{
  const m=links===0?LINK.S:links===15?LINE_BASE.t:links;
  for(const shape of ['reto','quina','t','ponta'] as const){
    let b:number=LINE_BASE[shape];
    for(let k=0;k<4;k++){if(b===m)return {shape,rot:(k*90) as CityDecor['rot']};b=turnLinks(b);}
  }
  return {shape:'t',rot:0};
}

function mulberry(seed:number){
  let t=seed>>>0;
  return ()=>{t=(t+0x6d2b79f5)>>>0;let x=Math.imul(t^(t>>>15),1|t);x^=x+Math.imul(x^(x>>>7),61|x);return ((x^(x>>>14))>>>0)/4294967296;};
}
const hashText=(s:string)=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),0x01000193);return h>>>0;};

export function placeCityDecor(asset:CityAsset,seed:number,options:DecorOptions={}):DecorResult{
  const W=asset.cells.w,H=asset.cells.h,unit=asset.unitsPerCell,N=W*H;
  const rnd=mulberry(seed^0xdec0);
  const pick=<T>(list:readonly T[])=>list[Math.floor(rnd()*list.length)];
  // One draw per call whatever the outcome (the rest of the map keeps its draws): the drawn variant, else the other one,
  // else none (DECOR_REFUSED).
  const variant=(base:string)=>{
    const v=rnd()<.5?1:2;
    for(const id of [`${base}-${v}`,`${base}-${3-v}`])if(!DECOR_REFUSED.has(id))return id;
    return undefined;
  };
  const named=(id:string)=>/-\d$/.test(id)?(DECOR_REFUSED.has(id)?undefined:id):variant(id);
  const inMap=(c:number,r:number)=>c>=0&&r>=0&&c<W&&r<H;
  // Cell kinds: walk (every sample walkable), solid (none), mixed; the block kind and id of each cell.
  const walk=new Uint8Array(N),solid=new Uint8Array(N),kind:(CityBlockKind|undefined)[]=new Array(N),block:(string|undefined)[]=new Array(N);
  const per=asset.samples.w/W;
  for(let r=0;r<H;r++)for(let c=0;c<W;c++){
    let n=0;for(let j=0;j<per;j++)for(let i=0;i<per;i++)if(asset.walkable(c*per+i,r*per+j))n++;
    if(n===per*per)walk[r*W+c]=1;else if(n===0)solid[r*W+c]=1;
  }
  for(const b of asset.blocks)for(const [x,y,w,h] of b.rects){
    const c0=Math.round(x/unit),r0=Math.round(y/unit),c1=Math.round((x+w)/unit),r1=Math.round((y+h)/unit);
    for(let r=r0;r<r1;r++)for(let c=c0;c<c1;c++)if(inMap(c,r)){kind[r*W+c]=b.kind;block[r*W+c]=b.id;}
  }
  // Keep-outs, by cell (any part of the cell inside): `out` all of them; `fixed` only the rects (build sites, nest blocks) and the `all` discs, what the
  // pieces drawn over solid block cells (lines, border boulders) respect: they block nothing new, so the discs (kept
  // clear for walking) do not apply to them, and the spawns and mouths stop showing bare boxes.
  const out=new Uint8Array(N),fixed=new Uint8Array(N);
  for(const k of options.keepOut??[]){
    const rc=Math.ceil(k.r/unit)+1,cc=Math.floor(k.x/unit),cr=Math.floor(k.y/unit);
    for(let r=cr-rc;r<=cr+rc;r++)for(let c=cc-rc;c<=cc+rc;c++){
      if(!inMap(c,r))continue;
      const nx=Math.max(c*unit,Math.min(k.x,(c+1)*unit)),ny=Math.max(r*unit,Math.min(k.y,(r+1)*unit));
      if(Math.hypot(nx-k.x,ny-k.y)<k.r){out[r*W+c]=1;if(k.all)fixed[r*W+c]=1;}
    }
  }
  for(const k of options.keepOutRects??[]){
    for(let r=Math.floor(k.y/unit);r<Math.ceil((k.y+k.h)/unit);r++)for(let c=Math.floor(k.x/unit);c<Math.ceil((k.x+k.w)/unit);c++)if(inMap(c,r))out[r*W+c]=fixed[r*W+c]=1;
  }
  // A prop on a block cell is not drawn (the render drops it under the block), so `fixed` leaves it out.
  for(const p of asset.props){const c=Math.floor(p.x/unit),r=Math.floor(p.y/unit);if(inMap(c,r))out[r*W+c]=1;}

  const used=new Uint8Array(N),decor:CityDecor[]=[],blocked:[number,number][]=[];
  const free=(c:number,r:number)=>inMap(c,r)&&!used[r*W+c]&&!out[r*W+c];
  const put=(id:string,c:number,r:number,w:number,h:number,rot:CityDecor['rot'],links?:number)=>{
    for(let y=r;y<r+h;y++)for(let x=c;x<c+w;x++)used[y*W+x]=1;
    decor.push(links===undefined?{id,c,r,w,h,rot}:{id,c,r,w,h,rot,links});
  };
  const rect=(c:number,r:number,w:number,h:number,ok:(i:number)=>boolean)=>{
    for(let y=r;y<r+h;y++)for(let x=c;x<c+w;x++)if(!free(x,y)||!ok(y*W+x))return false;
    return true;
  };
  const isKind=(c:number,r:number,k:CityBlockKind)=>inMap(c,r)&&kind[r*W+c]===k;
  /** Footprint after the turn and the cells right in front of it. */
  const turned=(a:number,b:number,face:DecorFace)=>face==='S'||face==='N'?{w:a,h:b}:{w:b,h:a};
  const front=(c:number,r:number,w:number,h:number,face:DecorFace):[number,number][]=>{
    const cells:[number,number][]=[];
    if(face==='S')for(let x=c;x<c+w;x++)cells.push([x,r+h]);
    else if(face==='N')for(let x=c;x<c+w;x++)cells.push([x,r-1]);
    else if(face==='E')for(let y=r;y<r+h;y++)cells.push([c+w,y]);
    else for(let y=r;y<r+h;y++)cells.push([c-1,y]);
    return cells;
  };
  const opens=(cells:readonly [number,number][])=>cells.every(([x,y])=>inMap(x,y)&&walk[y*W+x]);
  const FACES:readonly DecorFace[]=['S','E','N','W'];

  // 1. Wall and cliff lines.
  const broken=new Uint8Array(N);
  for(let r=0;r<H;r++)for(let c=0;c<W;c++){
    const i=r*W+c,k=kind[i];
    if((k!=='wall'&&k!=='cliff')||fixed[i])continue;
    const same=(x:number,y:number)=>isKind(x,y,k);
    const links=(same(c,r-1)?LINK.N:0)|(same(c+1,r)?LINK.E:0)|(same(c,r+1)?LINK.S:0)|(same(c-1,r)?LINK.W:0);
    const {shape,rot}=lineShape(links);
    if(k==='wall'){
      // The line is drawn below, along the wall's middle (wallLines); the draw stays here so the rest keeps its own.
      broken[i]=rnd()<BROKEN_SHARE?1:0;used[i]=1;
    }else{
      const id=shape==='quina'?'penhasco2-quina-externa':shape==='ponta'?'penhasco-ponta':'penhasco2-reto';
      put(id,c,r,1,1,rot,links);
    }
  }

  decor.push(...wallLines(W,H,i=>kind[i]==='wall'&&!fixed[i],i=>WALL_FAMILIES[hashText(block[i]!)%WALL_FAMILIES.length],broken));

  // 2. The border band: mountains where they fit whole, boulders here and there.
  const edge=(i:number)=>kind[i]==='edge'&&solid[i]===1;
  for(const [base,s] of MOUNTAINS)for(let r=0;r+s<=H;r++)for(let c=0;c+s<=W;c++){
    const id=base==='morro-3x3'?base:variant(base);
    if(id&&rect(c,r,s,s,edge))put(id,c,r,s,s,pick([0,90,180,270] as const));
  }
  // Every edge cell no mountain took (mixed cells too: the render boxes them all), so no bare box shows on the border.
  for(let i=0;i<N;i++)if(kind[i]==='edge'&&!used[i]&&!fixed[i])put(`pedregulho-${1+Math.floor(rnd()*3)}`,i%W,Math.floor(i/W),1,1,pick([0,90,180,270] as const));

  // 3. Building blocks: lots, a place with life first while any is left.
  const lugares=LUGARES.map(([id,a,b])=>[variant(id),a,b] as const).filter((l):l is readonly [string,number,number]=>!!l[0]);
  for(let i=lugares.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[lugares[i],lugares[j]]=[lugares[j],lugares[i]];}
  let nextLugar=0;
  const building=(i:number)=>kind[i]==='building'&&solid[i]===1;
  const blocks=[...new Set(block.filter((b,i)=>b!==undefined&&building(i)))] as string[];
  const tryLot=(id:string,a:number,b:number,c:number,r:number,needFront:boolean,ok:(i:number)=>boolean)=>{
    for(const face of FACES){
      const {w,h}=turned(a,b,face);
      if(!rect(c,r,w,h,ok))continue;
      if(needFront&&!opens(front(c,r,w,h,face)))continue;
      put(id,c,r,w,h,FACE_ROT[face]);return true;
    }
    return false;
  };
  for(const id of blocks){
    const mine=(i:number)=>block[i]===id&&building(i);
    let hasLugar=false;
    for(let r=0;r<H;r++)for(let c=0;c<W;c++){
      if(!mine(r*W+c)||!free(c,r))continue;
      if(!hasLugar&&nextLugar<lugares.length){
        const [lid,a,b]=lugares[nextLugar];
        if(tryLot(lid,a,b,c,r,true,mine)){hasLugar=true;nextLugar++;continue;}
      }
      let done=false;
      for(const needFront of [true,false]){
        for(const [mid,a,b] of MORADIAS){const id=variant(mid);if(id&&tryLot(id,a,b,c,r,needFront,mine)){done=true;break;}}
        if(done)break;
      }
    }
  }

  // 4. More places with life on open ground, backed onto a line, while the open ground stays connected.
  const lugarAt:[number,number][]=decor.filter(d=>LUGARES.some(([l])=>d.id.startsWith(`${l}-`))).map(d=>[d.c,d.r]);
  // Reach from the plaza (the open ground the team plays on; pockets cut off from it never count).
  const plaza=Math.floor(asset.points.praca.y/unit)*W+Math.floor(asset.points.praca.x/unit);
  const reach=()=>{
    const start=plaza;
    const seen=new Uint8Array(N),stack=[start];let n=0;
    if(!walk[start])return {n:0,seen};
    seen[start]=1;
    while(stack.length){const i=stack.pop()!;n++;const c=i%W,r=(i-c)/W;
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const x=c+dx,y=r+dy,j=y*W+x;if(inMap(x,y)&&walk[j]&&!seen[j]){seen[j]=1;stack.push(j);}}}
    return {n,seen};
  };
  let walkTotal=reach().n;
  const wallish=(x:number,y:number)=>inMap(x,y)&&(kind[y*W+x]==='wall'||kind[y*W+x]==='cliff'||kind[y*W+x]==='building');
  const back=(c:number,r:number,w:number,h:number,face:DecorFace)=>front(c,r,w,h,face==='S'?'N':face==='N'?'S':face==='E'?'W':'E');
  const second=LUGARES.map(([id,a,b])=>[variant(id),a,b] as const).filter((l):l is readonly [string,number,number]=>!!l[0]);
  const pool=[...lugares.slice(nextLugar),...second];
  for(const [id,a,b] of pool){
    const spots:{c:number;r:number;w:number;h:number;face:DecorFace}[]=[];
    for(const face of FACES){
      const {w,h}=turned(a,b,face);
      for(let r=1;r+h<H;r++)for(let c=1;c+w<W;c++){
        if(!rect(c,r,w,h,i=>walk[i]===1))continue;
        if(!back(c,r,w,h,face).every(([x,y])=>wallish(x,y)))continue;
        // A 1-cell walk around the front and the sides; the front must not be a keep-out either.
        const ring=[...front(c,r,w,h,face),...front(c,r,w,h,face==='S'||face==='N'?'E':'S'),...front(c,r,w,h,face==='S'||face==='N'?'W':'N')];
        if(!ring.every(([x,y])=>inMap(x,y)&&walk[y*W+x]&&!used[y*W+x]))continue;
        if(lugarAt.some(([x,y])=>Math.max(Math.abs(x-c),Math.abs(y-r))<LUGAR_SPACING))continue;
        spots.push({c,r,w,h,face});
      }
    }
    while(spots.length){
      const k=Math.floor(rnd()*spots.length),s=spots[k];spots.splice(k,1);
      if(lugarAt.some(([x,y])=>Math.max(Math.abs(x-s.c),Math.abs(y-s.r))<LUGAR_SPACING))continue;
      for(let y=s.r;y<s.r+s.h;y++)for(let x=s.c;x<s.c+s.w;x++)walk[y*W+x]=0;
      const {n}=reach();
      // Every cell it took was reachable (it stands on the plaza's ground), and nothing else got cut off.
      if(n===walkTotal-s.w*s.h){
        walkTotal=n;put(id,s.c,s.r,s.w,s.h,FACE_ROT[s.face]);lugarAt.push([s.c,s.r]);
        for(let y=s.r;y<s.r+s.h;y++)for(let x=s.c;x<s.c+s.w;x++){blocked.push([x,y]);solid[y*W+x]=1;}
        break;
      }
      for(let y=s.r;y<s.r+s.h;y++)for(let x=s.c;x<s.c+s.w;x++)walk[y*W+x]=1;
    }
  }

  // 5. Sidewalks: walkable cells against a wall, a cliff, a building or a place; poles, then objects.
  const side=new Uint8Array(N);
  for(let r=0;r<H;r++)for(let c=0;c<W;c++){
    const i=r*W+c;
    if(!walk[i]||used[i]||out[i])continue;
    if([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>wallish(c+dx,r+dy)||(inMap(c+dx,r+dy)&&solid[(r+dy)*W+c+dx]===1&&used[(r+dy)*W+c+dx]===1)))side[i]=1;
  }
  const poles:[number,number][]=[];
  const poleWeights=POSTES.reduce((t,[,w])=>t+w,0);
  const pickPole=()=>{let x=rnd()*poleWeights;for(const [id,w] of POSTES)if((x-=w)<0)return id;return POSTES[0][0];};
  const near=(list:readonly [number,number][],c:number,r:number,d:number)=>list.some(([x,y])=>Math.max(Math.abs(x-c),Math.abs(y-r))<d);
  for(let r=0;r<H;r++)for(let c=0;c<W;c++){
    if(!side[r*W+c]||!free(c,r)||near(poles,c,r,POLE_SPACING))continue;
    poles.push([c,r]);put(pickPole(),c,r,1,1,0);
  }
  const objects:[number,number][]=[];
  for(let r=0;r<H;r++)for(let c=0;c<W;c++){
    if(!side[r*W+c]||!free(c,r)||rnd()>=OBJECT_DENSITY||near(objects,c,r,2)||near(poles,c,r,2))continue;
    // 2×1 along the sidewalk when the next cell is sidewalk too.
    if(rnd()<.3){
      const full=named(pick(OBJETOS_2));
      if(full&&c+1<W&&side[r*W+c+1]&&free(c+1,r)){put(full,c,r,2,1,FACE_ROT.S);objects.push([c,r]);continue;}
      if(full&&r+1<H&&side[(r+1)*W+c]&&free(c,r+1)){put(full,c,r,1,2,FACE_ROT.E);objects.push([c,r]);continue;}
    }
    const full=named(pick(OBJETOS_1));
    if(full){put(full,c,r,1,1,pick([0,90,180,270] as const));objects.push([c,r]);}
  }
  // 6. The thick cliffs as a few big massifs, not rows of 1-cell walls (rochas-grandes): its own generator, so the
  // rest of the placement does not change.
  return {decor:bigCliffRocks(decor,BIG_ROCKS,seed),blocked};
}

/**
 * The wall and fence pieces (BUG-20261022-ORQ-grades-sem-padrao): one continuous line along each wall's middle
 * (maps/wall-lines.ts), straight pieces one cell long turned along it, posts shared at corners and junctions; the
 * family of the block, intact or broken by the cell's draw. A bit of wall too small for a line (a lone cell or two)
 * gets one piece along its longer side. The wall cells no piece stands on get a `cover` entry (drawn by the line next
 * to them, never by the procedural box), so every wall cell reads as part of its line.
 */
export function wallLines(W:number,H:number,isWall:(i:number)=>boolean,familyOf:(i:number)=>string,broken:Uint8Array):CityDecor[]{
  const pieces=wallPieces(wallRuns(W,H,(c,r)=>isWall(r*W+c)));
  const covered=new Uint8Array(W*H),out:CityDecor[]=[];
  const add=(p:WallPiece)=>{
    const {c,r,w,h}=pieceRect(p),i=r*W+c;
    for(let y=r;y<r+h;y++)for(let x=c;x<c+w;x++)covered[y*W+x]=1;
    out.push({id:`${familyOf(i)}-reto-${broken[i]?'quebrado':'intacto'}`,c,r,w,h,
      rot:p.o==='h'?90:0,links:p.o==='h'?LINK.E|LINK.W:LINK.N|LINK.S});
  };
  for(const p of pieces)add(p);
  // Bits with no piece at all: one piece on their first cell, along their longer side.
  const seen=new Uint8Array(W*H);
  for(let i=0;i<W*H;i++){
    if(!isWall(i)||seen[i])continue;
    const cells=[i],stack=[i];seen[i]=1;
    while(stack.length){
      const j=stack.pop()!,c=j%W,r=(j-c)/W;
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const x=c+dx,y=r+dy,k=y*W+x;
        if(x>=0&&y>=0&&x<W&&y<H&&isWall(k)&&!seen[k]){seen[k]=1;stack.push(k);cells.push(k);}
      }
    }
    if(cells.some(j=>covered[j]))continue;
    const cs=cells.map(j=>j%W),rs=cells.map(j=>Math.floor(j/W));
    const wide=Math.max(...cs)-Math.min(...cs)>=Math.max(...rs)-Math.min(...rs);
    add({cx:2*(i%W)+1,cy:2*Math.floor(i/W)+1,o:wide?'h':'v'});
  }
  for(let i=0;i<W*H;i++)if(isWall(i)&&!covered[i])
    out.push({id:`${familyOf(i)}-reto-intacto`,c:i%W,r:Math.floor(i/W),w:1,h:1,rot:0,cover:true});
  return out;
}

/** The big cliff pieces (NEW-20261022-ORQ-rochas-grandes): 2×2 massifs and a 2×1 straight wall. */
export interface BigRocks {readonly bloco:readonly string[];readonly reto:string}
/** The look the user picked (22/10: the fused cold boulders, "o mais próximo da realidade"; scripts/import-rochas-grandes.mjs). */
export const BIG_ROCKS:BigRocks={bloco:['penhasco3-bloco-1','penhasco3-bloco-2'],reto:'penhasco3-reto'};
/**
 * The cliff cells drawn with bigger pieces (NEW-20261022-ORQ-rochas-grandes: a thick cliff read as rows of small parallel
 * walls). Every 1×1 `penhasco*` piece is a cliff cell; scanning rows top-down, 4 free cells in a square become one 2×2
 * massif (`bloco`, a variant and a turn at random), then 2 free cells side by side one 2×1 straight wall (`reto`, rot 0
 * along c, 90 along r); the cells left keep their piece. Only the drawing changes: the pieces cover the same cliff cells
 * (solid already), the grid and the collision stay as they are.
 */
export function bigCliffRocks(decor:readonly CityDecor[],rocks:BigRocks,seed:number):CityDecor[]{
  const at=new Map<string,number>();
  decor.forEach((e,i)=>{if(e.w===1&&e.h===1&&e.id.startsWith('penhasco'))at.set(`${e.c},${e.r}`,i);});
  const gone=new Set<number>(),out:CityDecor[]=[],rnd=mulberry(seed);
  const has=(c:number,r:number)=>{const i=at.get(`${c},${r}`);return i!==undefined&&!gone.has(i);};
  const take=(cells:readonly (readonly [number,number])[])=>{for(const [c,r] of cells)gone.add(at.get(`${c},${r}`)!);};
  const cells=[...at.keys()].map(k=>k.split(',').map(Number) as [number,number]).sort((a,b)=>a[1]-b[1]||a[0]-b[0]);
  for(const [c,r] of cells){
    if(!(has(c,r)&&has(c+1,r)&&has(c,r+1)&&has(c+1,r+1)))continue;
    take([[c,r],[c+1,r],[c,r+1],[c+1,r+1]]);
    out.push({id:rocks.bloco[Math.floor(rnd()*rocks.bloco.length)],c,r,w:2,h:2,rot:([0,90,180,270] as const)[Math.floor(rnd()*4)]});
  }
  for(const [c,r] of cells){
    if(!has(c,r))continue;
    if(has(c+1,r)){take([[c,r],[c+1,r]]);out.push({id:rocks.reto,c,r,w:2,h:1,rot:rnd()<.5?0:180});}
    else if(has(c,r+1)){take([[c,r],[c,r+1]]);out.push({id:rocks.reto,c,r,w:1,h:2,rot:rnd()<.5?90:270});}
  }
  return [...decor.filter((_,i)=>!gone.has(i)),...out];
}
