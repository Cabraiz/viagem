/**
 * Delivery adapter for the standing scenery (NEW-20261012-ORQ-adaptar-entrega-codex): cenario/predios, cenario/props
 * and cenario/base (cenario/chao is geral.mjs). Contract: scripts/art-v2/adaptar-entrega.mjs.
 *
 * The delivery ships one PNG per camera view (`<stem>-v0..v3.png`, views 0°/90°/180°/270° = the city's views 0..3:
 * v0 shows the south+east walls, v1 east+north…) plus `<stem>.meta.json` (cell, footprint, storeys, worldCell,
 * provenance…), each view scaled on its own to fill a fixed canvas. For the importer (scripts/art-v2/spec.mjs 'views')
 * this adapter writes ONE sheet `<id>.png` (4 view columns × 1 row per state/frame) + `<id>.json` with only importer keys
 * (cell, views, rows, anchor, meta), under the spec ids (renames below). Provenance stays in the delivery.
 *
 * ENGINE SCALE (src/client/render/city/projection.ts + materials.ts): art px = ART_SCALE × game px; one world unit along
 * world x spans TILE_X·ART_SCALE px across, one unit of height HEIGHT_PX·ART_SCALE px up; a city cell is WORLD_CELL u and
 * one storey ≈ STOREY u (D-037). Every piece gets ONE factor (the same for all its views, states and frames), resampled
 * with lanczos3:
 *  - a piece with a footprint a×b (predios; chafariz): the drawn width (median over the views of the alpha bbox, which
 *    for a projected box is the footprint diamond in every view) becomes (a+b)·WORLD_CELL·TILE_X·ART_SCALE;
 *  - props and base objects (no footprint in the delivery, every one fitted to its canvas: a cone as tall as a lamp
 *    post): the drawn height (median over the views) becomes WORLD_HEIGHT[kind] u (hero ≈ one storey ≈ 2.3 u);
 *  - 1-view pieces (loot box, slipper tower) and effects keep the delivered scale (no world size to compare).
 * Anchor = what materials.ts draws with: buildings (and footprint pieces) put the footprint's FRONT corner, i.e. the
 * lowest drawn point, BUILDING_BOTTOM px above the frame bottom at x = frameW/2 + (A−B)/2·TILE_X·ART_SCALE
 * (buildingAnchor: +, −, +, − for views 0..3 of an a>b footprint, 0 for a square); props stand on their feet,
 * centred, PROP_BOTTOM px above the bottom. The sidecar anchor is [0.5, 1 − bottom/H] (one anchor for the 4 views: the
 * per-view corner x stays inside the importer's 12 % tolerance, see tests/fixtures/art-v2/demo-city.mjs). The cell is the
 * smallest one (multiple of 8) that holds every view with that anchor and the importer's 2 px margin.
 *
 * REFUSED (real art problems, listed for PEDIR-DE-VOLTA.md), never "fixed":
 *  - views that are not the same object turned: views v and v+2 are 180° turns of each other, so their projected
 *    width and height must match for ANY shape; a gap over VIEW_MISMATCH is refused;
 *  - an a×b (a≠b) footprint whose long side runs the wrong way in some view (it must alternate view by view); when it
 *    runs the wrong way in EVERY view the art is the b×a turn of the piece, which is a format fix: views shifted by one;
 *  - a factor more than OUTLIER away from its series (variations of the same piece) or an upscale beyond it.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {GROUPS} from '../spec.mjs';

/** city projection (src/client/render/city/projection.ts, materials.ts) and world sizes (D-037). */
export const TILE_X=42,HEIGHT_PX=42,ART_SCALE=2,WORLD_CELL=.88,STOREY=2.3;
export const BUILDING_BOTTOM=16,PROP_BOTTOM=8;
/** Importer margin (spec.mjs PADDING) and alpha threshold (ALPHA_THRESHOLD). */
const PAD=2,ALPHA=20;
export const VIEW_MISMATCH=.25,OUTLIER=.4,MAX_UPSCALE=1+OUTLIER;
const PNG={compressionLevel:9,adaptiveFiltering:false,palette:false,effort:10};
const GROUP_DIRS={predios:'cenario/predios',props:'cenario/props',base:'cenario/base'};

/**
 * Drawn height (world units) of props and base objects, from the tallest point to the ground, hero ≈ 2.3 u ≈ 1.75 m
 * (≈ 1.3 u per metre, a bit generous on small things so they read). Trees match the approved pine sheet (≈ 4.1 u).
 */
export const WORLD_HEIGHT=Object.freeze({
  poste:5,'carro-velho':2,'onibus-tombado':3.4,'ponto-onibus':3.2,'banco-praca':1.3,lixeira:1.3,barril:1.2,caixote:1,
  orelhao:2.8,hidrante:1,'placa-torta':3,'bicicleta-presa-gelo':1.5,'varal-congelado':2.4,'boneco-neve-tio-pave':2.5,
  'mesa-bar':1.5,isopor:.8,'churrasqueira-tambor':1.4,'carrinho-supermercado':1.4,'sofa-calcada':1.3,'cone-transito':1,
  'arvore-nevada':4.1,rocha:1.6,coqueiro:6,arbusto:1.4,toco:1,'tronco-caido':1.1,'portal-praca':4.6,fonte:3,mirante:5.5,
  'muralha-acampamento':3,barricada:2,forja:1.8,'no-coco':5.5,'no-pedra':2.2,'helicoptero-caido':4,
});

/** Delivery stem → spec id (predios: footprint dropped from the id where the spec has none; props: no `-1`). */
export const RENAMES=Object.freeze({
  predios:{
    'boteco-2x1-1':'boteco-esquina-2x1-1','garagem-2x1-1':'garagem-oficina-2x1-1','oficina-2x1-1':'garagem-oficina-2x1-2',
    'templo-4x4-1':'templo-murado-1','arena-4x4-1':'arena-1','portao-1x1-1':'portao-1','portao-2x1-1':'portao-2',
  },
  props:{
    'banco-1':'banco-praca','bicicleta-gelo-1':'bicicleta-presa-gelo','carro-velho-1-1':'carro-velho-1',
    'carro-velho-2-1':'carro-velho-2','churrasqueira-1':'churrasqueira-tambor','cone-1':'cone-transito',
    'fonte-ilha-1':'fonte','mesa-boteco-1':'mesa-bar','mirante-bandeira-1':'mirante','placa-nome':'plaquinha',
    'sofa-1':'sofa-calcada',
  },
});
/**
 * Linear parts of predios (they do not fill their footprint): thickness in cells, from the art (a stone wall ≈ 0.3 of a
 * cell, a cliff edge ≈ 0.5). Their 4 views run the part through the cell's middle (corner and T pieces too: every
 * delivered muro part is as wide as the straight one). Cliff corners are rock masses that fill the cell: footprint rule.
 */
export const LINEAR=Object.freeze([[/^muro-pedra-/,.3],[/^portao-/,.3],[/^penhasco-reto-/,.5]]);
export const linearThickness=id=>LINEAR.find(([re])=>re.test(id))?.[1];
/** Base pieces whose delivery stem differs from the spec id (the delivery ships `<stem>-<state>`). */
const BASE_STEMS=Object.freeze({'muralha-acampamento':'muralha'});

const round=(v,d=3)=>Math.round(v*10**d)/10**d;
const ceil8=v=>Math.ceil(v/8)*8;
const median=a=>{const s=[...a].sort((x,y)=>x-y),n=s.length;return n?(n%2?s[n>>1]:(s[n/2-1]+s[n/2])/2):NaN;};
const readJson=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^﻿/,''));}catch{return undefined;}};
const isPair=v=>Array.isArray(v)&&v.length===2&&v.every(n=>Number.isInteger(n)&&n>0);
/** Series of a spec id: the id without its variation number (casa-terrea-2x1-3 → casa-terrea-2x1). */
export const seriesOf=id=>id.replace(/-\d+$/,'');

/** Spec id of a delivery stem: explicit rename; `muro-<part>-1x1-<n>` → muro-pedra-<part>-<n>; cliffs; `-1` dropped. */
export function specId(group,stem){
  if(RENAMES[group]?.[stem])return RENAMES[group][stem];
  const expected=GROUPS[group].expected;
  if(group==='predios'){
    let m=/^muro-(.+)-1x1-(\d+)$/.exec(stem);if(m)return `muro-pedra-${m[1]}-${m[2]}`;
    m=/^penhasco-(.+)-1x1-(\d+)$/.exec(stem);if(m)return `penhasco-${m[1]}-${m[2]}`;
  }
  if(!expected[stem]&&/-1$/.test(stem)&&expected[stem.slice(0,-2)])return stem.slice(0,-2);
  return stem;
}

// ---------------------------------------------------------------- raster helpers (raw RGBA)
async function readRaw(file){
  const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {data,width:info.width,height:info.height};
}
/** Cuts an image into cells of w×h (row-major). */
function cut(img,w,h){
  const out=[];
  for(let r=0;r+h<=img.height;r+=h)for(let c=0;c+w<=img.width;c+=w){
    const data=Buffer.alloc(w*h*4);
    for(let y=0;y<h;y++)img.data.copy(data,y*w*4,((r+y)*img.width+c)*4,((r+y)*img.width+c+w)*4);
    out.push({data,width:w,height:h});
  }
  return out;
}
/** Alpha bbox and foot (mean x of the 6 lowest drawn rows, as validate.mjs cellBox) of one or more same-size images. */
export function measure(imgs){
  const {width:w,height:h}=imgs[0];
  const on=(x,y)=>imgs.some(i=>i.data[(y*w+x)*4+3]>ALPHA);
  let x0=w,y0=h,x1=-1,y1=-1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(on(x,y)){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
  if(y1<0)return undefined;
  let sum=0,n=0;
  for(let y=Math.max(0,y1-5);y<=y1;y++)for(let x=0;x<w;x++)if(on(x,y)){sum+=x;n++;}
  return {x0,y0,x1,y1,w:x1-x0+1,h:y1-y0+1,footX:sum/n};
}
async function resize(img,box,f){
  const m=3,left=Math.max(0,box.x0-m),top=Math.max(0,box.y0-m);
  const width=Math.min(img.width,box.x1+m+1)-left,height=Math.min(img.height,box.y1+m+1)-top;
  const W=Math.max(1,Math.round(width*f)),H=Math.max(1,Math.round(height*f));
  const data=await sharp(img.data,{raw:{width:img.width,height:img.height,channels:4}})
    .extract({left,top,width,height}).resize(W,H,{kernel:'lanczos3',fit:'fill'}).raw().toBuffer();
  return {data,width:W,height:H};
}

// ---------------------------------------------------------------- piece model
/**
 * A delivered piece: `states` = [{name, views:[[frame img…] per view]}] (one view for 1-view pieces); `footprint`
 * [a,b] when known; `kind` = the size-table key; `cell` = delivered cell [w,h].
 */
async function loadViews(dir,stem,cell,count){
  const views=[];
  for(let v=0;v<count;v++){
    const file=count>1?path.join(dir,`${stem}-v${v}.png`):path.join(dir,`${stem}.png`);
    if(!fs.existsSync(file))return {missing:path.basename(file)};
    const img=await readRaw(file);
    if(img.height!==cell[1]||img.width%cell[0])return {missing:`${path.basename(file)} (${img.width}×${img.height}, cell ${cell.join('×')})`};
    views.push(cut(img,cell[0],cell[1]));
  }
  return {views};
}

/** Footprint front-corner x offset (target px) of an a×b footprint in view v (materials.ts frameExtents). */
export const cornerOffset=([a,b],v)=>(v%2===0?a-b:b-a)/2*WORLD_CELL*TILE_X*ART_SCALE;

/** One factor for the piece and the checks that refuse it. Returns {factor, refused?, notes, shift}. */
export function plan(piece){
  const notes=[],ref=piece.states[0],n=ref.views.length;
  const boxes=piece.states.map(s=>s.views.map(frames=>measure(frames)));
  const empty=[];boxes.forEach((s,si)=>s.forEach((b,v)=>{if(!b)empty.push(`${piece.states[si].name??''} v${v}`.trim());}));
  if(empty.length)return {refused:`empty view: ${empty.join(', ')}`,notes};
  // Views v and v+2 are 180° turns: same projected width and height for any shape.
  if(n===4)for(const [si,s] of boxes.entries()){
    const bad=[];
    for(const [p,q] of [[0,2],[1,3]])for(const k of ['w','h']){
      const gap=Math.abs(s[p][k]-s[q][k])/Math.max(s[p][k],s[q][k]);
      if(gap>VIEW_MISMATCH)bad.push(`${k==='w'?'width':'height'} ${s[p][k]} px in view ${p*90}° vs ${s[q][k]} px in ${q*90}° (${Math.round(gap*100)} %)`);
    }
    if(bad.length)return {refused:`${piece.states[si].name?`state "${piece.states[si].name}": `:''}views 180° apart must be the same size (same object turned): ${bad.join('; ')}`,notes};
  }
  const rb=boxes[0];
  let factor=1,shift=0;
  if(piece.footprint){
    const [a,b]=piece.footprint,drawn=median(rb.map(x=>x.w));
    // A linear part (wall, gate, cliff edge) runs a cells through the footprint's middle: its widest view spans
    // a cells plus its thickness, not the whole diamond.
    factor=piece.linear!==undefined?(a+piece.linear)*WORLD_CELL*TILE_X*ART_SCALE/Math.max(...rb.map(x=>x.w))
      :(a+b)*WORLD_CELL*TILE_X*ART_SCALE/drawn;
    if(a!==b&&n===4){
      // Front corner (lowest point) relative to the bbox centre: + in views 0/2, − in 1/3 for a > b (buildingAnchor).
      const expect=Math.abs(a-b)/(a+b)*drawn/2,signs=rb.map(x=>{const off=x.footX-(x.x0+x.x1)/2;return Math.abs(off)<.3*expect?0:Math.sign(off);});
      const want_=[1,-1,1,-1],known=signs.map((s,v)=>s?s*want_[v]:0),right=known.filter(s=>s>0).length,wrong=known.filter(s=>s<0).length;
      if(wrong&&!right&&wrong>=2){shift=1;notes.push(`long side ran the wrong way in every view (the art is the ${b}×${a} turn): views shifted by one`);}
      else if(wrong)return {refused:`footprint ${a}×${b}: the long side runs the wrong way in view ${known.map((s,v)=>s<0?`${v*90}°`:'').filter(Boolean).join(', ')} (it must alternate view by view; ${known.map((s,v)=>s>0?`${v*90}°`:'').filter(Boolean).join(', ')||'no view'} ${right===1?'is':'are'} right)`,notes,factor};
    }
    if(piece.storeys){
      const H=median(rb.map(x=>x.h))*factor,diamond=(a+b)*WORLD_CELL*HEIGHT_PX;
      notes.push(`storey ≈ ${round((H-diamond)/(HEIGHT_PX*ART_SCALE)/piece.storeys,2)} u after scaling (D-037: ${STOREY} u)`);
    }
  }else if(n===4&&WORLD_HEIGHT[piece.kind]){
    factor=WORLD_HEIGHT[piece.kind]*HEIGHT_PX*ART_SCALE/median(rb.map(x=>x.h));
  }else if(n===4)notes.push('no world size known for it: kept the delivered scale');
  if(factor>MAX_UPSCALE)return {refused:`drawn too small for its world size: it would be upscaled ×${round(factor,2)} (max ×${MAX_UPSCALE})`,notes,factor};
  return {factor,shift,notes};
}

/** Renders the sheet: views columns × (states × frames) rows, every cell placed on the engine anchor. */
export async function render(piece,{factor,shift=0}){
  const building=!!piece.footprint,linear=building&&piece.linear!==undefined;
  // A linear part stands on the footprint's middle line: its low end is half the short side above the front corner.
  const drop=linear?piece.footprint[1]/2*WORLD_CELL*HEIGHT_PX:0,bottom=(building?BUILDING_BOTTOM:PROP_BOTTOM)+drop;
  const keep=factor===1&&!building&&piece.states[0].views.length===1;
  const n=piece.states[0].views.length;
  const rows=[];
  for(const s of piece.states){
    const frames=s.views[0].length;
    for(let k=0;k<frames;k++)rows.push({state:s,k});
  }
  // Pass 1: resample every cell; one placement per (state, view) from the union of its frames (no jitter).
  const cells=[];let need={left:0,right:0,up:0};
  for(const s of piece.states){
    s.out=[];
    for(let col=0;col<n;col++){
      const src=s.views[(col+shift)%n],box=measure(src);
      const scaled=[];for(const img of src)scaled.push(factor===1?img:await resize(img,box,factor));
      // Pin (drawn point) → target x = W/2 + off: buildings and props pin their foot (the footprint's front corner,
      // the feet); linear parts pin their bbox centre on the footprint diamond's centre.
      const m=measure(scaled),off=building&&!linear&&n===4?cornerOffset(piece.footprint,col):0,pin=linear?(m.x0+m.x1)/2:m.footX;
      s.out[col]={scaled,m,off,pin};
      need={left:Math.max(need.left,pin-m.x0-off),right:Math.max(need.right,m.x1-pin+off),up:Math.max(need.up,m.y1-m.y0),
        foot:Math.max(need.foot??0,Math.abs(m.footX-pin+off))};
      cells.push(s.out[col]);
    }
  }
  let W,H;
  if(keep){[W,H]=piece.cell;}
  else{
    // The importer wants every view's foot within 12 % of the width from the anchor x (0.5).
    W=Math.max(ceil8(2*(Math.max(need.left,need.right)+PAD+3)),ceil8((need.foot+2)/.12));
    H=ceil8(need.up+bottom+PAD+3);
  }
  const sheet=Buffer.alloc(W*n*H*rows.length*4),stride=W*n*4;
  rows.forEach(({state,k},r)=>{
    for(let col=0;col<n;col++){
      const {scaled,m,off,pin}=state.out[col],img=scaled[k];
      // 1-view pieces at their delivered scale keep their own placement.
      const ox=keep?0:Math.round(W/2+off-pin),oy=keep?0:Math.round(H-bottom)-m.y1;
      for(let y=0;y<img.height;y++){
        const ty=oy+y;if(ty<0||ty>=H)continue;
        for(let x=0;x<img.width;x++){
          const tx=ox+x;if(tx<0||tx>=W)continue;
          const si=(y*img.width+x)*4,a=img.data[si+3];if(!a)continue;
          img.data.copy(sheet,(r*H+ty)*stride+(col*W+tx)*4,si,si+4);
        }
      }
    }
  });
  // A piece kept as delivered keeps the delivery's anchor (validated as [x,y] in 0..1).
  const own=Array.isArray(piece.anchor)&&piece.anchor.length===2&&piece.anchor.every(v=>typeof v==='number'&&v>=0&&v<=1);
  const anchor=keep&&own?piece.anchor:[.5,round(1-Math.round(bottom)/H,6)];
  const png=await sharp(sheet,{raw:{width:W*n,height:H*rows.length,channels:4}}).png(PNG).toBuffer();
  return {png,cell:[W,H],anchor,rows:rows.length};
}

// ---------------------------------------------------------------- per-group discovery
const metaStems=dir=>fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>f.endsWith('.meta.json')).map(f=>f.slice(0,-10)).sort():[];

async function viewsPiece(dir,stem,meta){
  const cell=meta?.cell;
  if(!isPair(cell))return {missing:`${stem}.meta.json has no cell`};
  const count=Array.isArray(meta.views)&&meta.views.length===4?4:1;
  return loadViews(dir,stem,cell,count);
}

/** Pieces of predios/props: one per meta stem (poste: two stems, one per row). */
async function collectSimple(group,dir){
  const pieces=new Map();
  for(const stem of metaStems(dir)){
    const meta=readJson(path.join(dir,`${stem}.meta.json`));
    let id=specId(group,stem),state;
    if(group==='props'){const m=/^poste-(aceso|apagado)-1$/.exec(stem);if(m){id='poste';state=m[1];}}
    const exp=GROUPS[group].expected[id];
    if(exp?.kind==='nineslice'||Array.isArray(meta?.nineSlice)){pieces.set(id,{id,stems:[stem],nineslice:{meta,file:path.join(dir,`${stem}.png`)}});continue;}
    const p=pieces.get(id)??{id,stems:[],states:[],cell:meta?.cell,
      footprint:isPair(meta?.footprint)?meta.footprint:undefined,storeys:Number.isInteger(meta?.storeys)?meta.storeys:undefined,
      kind:group==='props'?seriesOf(id):undefined};
    if(group==='predios'){const t=linearThickness(id);if(t!==undefined)p.linear=t;}
    p.stems.push(stem);
    const v=await viewsPiece(dir,stem,meta);
    if(v.missing)p.missing=v.missing;else p.states.push({name:state,views:v.views});
    pieces.set(id,p);
  }
  // Rows in the table's order (poste: aceso, apagado).
  for(const p of pieces.values()){const order=GROUPS[group].expected[p.id]?.rows;if(order&&p.states)p.states.sort((x,y)=>order.indexOf(x.name)-order.indexOf(y.name));}
  return [...pieces.values()];
}

/** Base pieces: `<stem>-<state>` files grouped into the spec's stateful pieces; the rest one piece per stem. */
async function collectBase(dir){
  const pieces=[],used=new Set(),expected=GROUPS.base.expected;
  const stems=fs.existsSync(dir)?[...new Set(fs.readdirSync(dir).filter(f=>f.endsWith('.png')).map(f=>f.slice(0,-4).replace(/-v\d$/,'')))].sort():[];
  for(const [id,exp] of Object.entries(expected)){
    const states=exp.meta?.states;
    if(!states)continue;
    const base=BASE_STEMS[id]??id,p={id,stems:[],states:[],kind:id,footprint:exp.meta?.footprint};
    let sibling;
    for(const st of states){const m=readJson(path.join(dir,`${base}-${st}.meta.json`));if(m){sibling=m;break;}}
    for(const st of states){
      const stem=`${base}-${st}`;if(!stems.includes(stem))continue;
      used.add(stem);p.stems.push(stem);
      const meta=readJson(path.join(dir,`${stem}.meta.json`))??sibling;
      p.cell??=meta?.cell;p.anchor??=meta?.anchor;
      const v=await viewsPiece(dir,stem,meta);
      if(v.missing)p.missing=v.missing;else p.states.push({name:st,views:v.views});
    }
    if(p.stems.length)pieces.push(p);
  }
  for(const stem of stems){
    if(used.has(stem))continue;
    const meta=readJson(path.join(dir,`${stem}.meta.json`)),exp=expected[stem];
    if(exp?.kind==='frames'){pieces.push({id:stem,stems:[stem],frames:{meta,file:path.join(dir,`${stem}.png`),exp}});continue;}
    const p={id:stem,stems:[stem],states:[],cell:meta?.cell,kind:stem,footprint:exp?.meta?.footprint??(isPair(meta?.footprint)?meta.footprint:undefined)};
    const v=await viewsPiece(dir,stem,meta);
    if(v.missing)p.missing=v.missing;else p.states.push({name:undefined,views:v.views});
    pieces.push(p);
  }
  return pieces;
}

/** Row names of a stacked piece: state names, `<state>-1..n` for animated states (spec.mjs stateful rows). */
function rowNames(piece){
  const names=[];
  for(const s of piece.states){const k=s.views[0].length;if(!s.name)continue;names.push(...(k>1?Array.from({length:k},(_,i)=>`${s.name}-${i+1}`):[s.name]));}
  return names.length?names:undefined;
}

// ---------------------------------------------------------------- adapter entry
export async function adapt({src,out,log=()=>{}}){
  const records=[];
  for(const [group,rel] of Object.entries(GROUP_DIRS)){
    const dir=path.join(src,rel),dest=path.join(out,rel);
    if(!fs.existsSync(dir))continue;
    const pieces=group==='base'?await collectBase(dir):await collectSimple(group,dir);
    fs.mkdirSync(dest,{recursive:true});
    const planned=[];
    for(const p of pieces){
      const from=`from ${p.stems.join(' + ')}`;
      if(p.nineslice){
        const {meta,file}=p.nineslice;
        fs.copyFileSync(file,path.join(dest,`${p.id}.png`));
        const sc={cell:meta.cell,...(Array.isArray(meta.nineSlice)?{slice:meta.nineSlice}:{})};
        fs.writeFileSync(path.join(dest,`${p.id}.json`),JSON.stringify(sc)+'\n');
        records.push({group,id:p.id,action:'nine-slice copied',notes:[from]});continue;
      }
      if(p.frames){
        const {meta,file,exp}=p.frames;
        fs.copyFileSync(file,path.join(dest,`${p.id}.png`));
        if(!(isPair(exp.cell)&&isPair(meta?.cell)&&exp.cell.every((v,i)=>v===meta.cell[i]))&&isPair(meta?.cell))
          fs.writeFileSync(path.join(dest,`${p.id}.json`),JSON.stringify({cell:meta.cell,...(meta.fps?{fps:meta.fps}:{})})+'\n');
        records.push({group,id:p.id,action:'frames strip copied',notes:[from]});continue;
      }
      if(p.missing||!p.states.length){records.push({group,id:p.id,action:'refused',notes:[from],refused:`incomplete delivery: ${p.missing??'no views'}`});continue;}
      planned.push({p,plan:plan(p),from});
    }
    // Outliers against the series (variations of one piece share the delivery's scale and the world size).
    const series=new Map();
    for(const x of planned){
      if(x.plan.refused)continue;
      const key=seriesOf(x.p.id);
      if(!series.has(key))series.set(key,[]);
      series.get(key).push(x.plan.factor);
    }
    for(const x of planned){
      const fs_=series.get(seriesOf(x.p.id));
      if(x.plan.refused||!fs_||fs_.length<2)continue;
      const med=median(fs_),gap=x.plan.factor/med-1;
      if(Math.abs(gap)>OUTLIER)x.plan={...x.plan,refused:`scale ×${round(x.plan.factor,2)} is ${Math.round(gap*100)} % off its series (×${round(med,2)}): drawn at a different size than its variations`};
    }
    for(const {p,plan:pl,from} of planned){
      const notes=[from,...pl.notes];
      if(pl.refused){records.push({group,id:p.id,action:'refused',...(pl.factor?{factor:round(pl.factor)}:{}),notes,refused:pl.refused});continue;}
      const r=await render(p,pl);
      fs.writeFileSync(path.join(dest,`${p.id}.png`),r.png);
      const views=p.states[0].views.length,rows=rowNames(p);
      const meta={...(p.footprint&&group!=='base'?{footprint:p.footprint}:{}),...(p.storeys?{storeys:p.storeys}:{})};
      const sc={cell:r.cell,views,...(rows?{rows}:{}),anchor:r.anchor,...(Object.keys(meta).length?{meta}:{})};
      fs.writeFileSync(path.join(dest,`${p.id}.json`),JSON.stringify(sc)+'\n');
      const action=`${views>1?`joined ${views} views`:'stacked rows'}${pl.factor!==1?`, scaled ×${round(pl.factor)}`:''}, cell ${r.cell.join('×')}`;
      records.push({group,id:p.id,action,factor:round(pl.factor),notes});
      log(`${group}/${p.id}: ${action}`);
    }
  }
  return records;
}
