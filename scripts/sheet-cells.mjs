/**
 * Cell hygiene of every character and enemy sheet (card BUG-20261022-ORQ-quadro-sangra-vizinho, 22/10: "uma mão
 * flutuando atrás de mim" and "esse senhor inimigo foi mal cortado"). Per frame, in the full sheet and its lite copies:
 *
 *   corte  a piece cut off by the cell's edge: an opaque part apart from the figure within FIX_RING px of the cell's
 *          edge (1 px in a lite copy, whose cells are smaller): a hand or a prop whose arm is outside the cell
 *          floats there on its own.
 *   borda  an opaque pixel on the cell's outer ring: the game samples the sheet with LINEAR filtering and no padding
 *          between frames, so that pixel bleeds into the next frame's edge (and the neighbour's into this one).
 *   fundo  a background left around the figure: a pale, warm area reached from the transparent outside without
 *          crossing the figure's dark outline (estagiario-imortal's death: a cream slab behind him).
 *
 * A part apart from the figure inside the cell (sparkles, a thrown bottle, a hat brim) is listed as `ilhas`, not a
 * failure: most enemies draw props and effects loose on purpose.
 *
 *   node scripts/sheet-cells.mjs            analyse (only sheets whose sha changed) and write scripts/sheet-cells.json
 *   node scripts/sheet-cells.mjs --fix      remove cut pieces and backgrounds, clear a FIX_RING px ring in the full
 *                                           sheets that fail; then `node scripts/art-lite.mjs` remakes their copies
 *   node scripts/sheet-cells.mjs --report   print every failing frame
 * tests/tools/sheet-cells.test.ts keeps the record fresh and every sheet clean.
 */
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Windows: libvips keeps a read file open (its cache), and --fix writes over it.
sharp.cache(false);
const ROOT=process.env.SHEET_CELLS_ROOT??fileURLToPath(new URL('..',import.meta.url));
export const RECORD='scripts/sheet-cells.json';
/** Bump `version` when the analysis changes: the record is redone. */
export const RULES={version:6,alpha:40,minArea:7,edge:1,fixRing:2,cutMax:.15,haloArea:300,wrap:.3,slab:250,fringe:2,crumb:60};
/** Opaque above this alpha (sprite-atlas.mjs's figure threshold is 20; 40 skips the faintest glow). */
export const ALPHA=RULES.alpha;
/** A loose part smaller than this (px) is anti-aliasing dust. */
export const MIN_AREA=RULES.minArea;
/** Outer ring (px) that must stay clear in every cell: LINEAR filtering reads half a texel past the quad. */
export const EDGE=RULES.edge;
/** Ring --fix clears: 2 px, so the lite copy (each cell resized on its own, lanczos) keeps its 1 px ring clear too. */
export const FIX_RING=RULES.fixRing;
/** A background left around the figure: at least this many pale px reached from outside. */
export const HALO_AREA=RULES.haloArea;
/** Warm cream or its near-white highlights (a background), not grey-white hair. */
const pale=(r,g,b)=>{const sum=r+g+b,chroma=Math.max(r,g,b)-Math.min(r,g,b);return sum>=540&&chroma<=90&&r-b>=30||sum>=705&&chroma<=40;};
/** The background blended into the figure's edge: a darker cream, trimmed FRINGE px deep next to a removed background. */
const creamish=(r,g,b)=>r+g+b>=420&&Math.max(r,g,b)-Math.min(r,g,b)<=110&&r-b>=30;
export const FRINGE=RULES.fringe;
/** Loose bits left next to a removed background, smaller than this (px), go with it. */
export const CRUMB=RULES.crumb;
/** A cut piece bigger than this share of the figure is a drawn prop clipped by the cell: reported, not removed. */
export const CUT_MAX=RULES.cutMax;
/** A background's rim is at least this share of the figure's outline. */
export const WRAP=RULES.wrap;
/** …and its biggest connected piece has at least this many px. */
export const SLAB=RULES.slab;
/** The enemies' baked rim, #2A2018 (public/art/enemies/manifest.json `rim`). */
export const RIM=[42,32,24];
const isRim=(r,g,b)=>Math.abs(r-RIM[0])+Math.abs(g-RIM[1])+Math.abs(b-RIM[2])<=12;

/** The groups checked: heroes and bots (personagens) and enemies (inimigos), as the art index lists them. */
export function sheets(root=ROOT){
  const index=JSON.parse(readFileSync(join(root,'public/art/manifest.json'),'utf8')),out=[];
  for(const group of ['personagens','inimigos']){
    const g=index.groups[group];if(!g)continue;
    const dir=g.output.replace(/^public\/art\//,'');
    for(const piece of Object.values(g.pieces))for(const f of Object.values(piece.files)){
      if(!f.cell||!f.pages?.length)continue;
      // the full sheet, its phone copy and, for the enemies that have one, the computer's (art-lite.mjs enemies-pc)
      const copies=[['',f.cell,false],['lite/',f.liteCell??f.cell,true],...(f.pcCell?[['lite/',f.pcCell,true,'-pc']]:[])];
      for(const page of f.pages)for(const [pre,cell,lite,suffix=''] of copies){
        const key=`${pre}${dir}${suffix}/${page.file}`;
        if(out.some(s=>s.key===key))continue;
        out.push({key,path:join(root,'public/art',key),cell,columns:page.columns,frames:page.frameCount,firstFrame:page.firstFrame,lite});
      }
    }
  }
  return out;
}

/** One cell of a raw RGBA sheet: cut pieces, ring px, background px and loose parts inside. `mask` marks what --fix clears. */
export function analyzeCell(data,width,x0,y0,cw,ch,mask,cutRing=FIX_RING){
  const n=cw*ch,label=new Int32Array(n),at=(x,y)=>((y0+y)*width+x0+x)*4;
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++)label[y*cw+x]=data[at(x,y)+3]>ALPHA?-1:0;
  const parts=[],stack=[];
  for(let i=0;i<n;i++)if(label[i]===-1){
    const id=parts.length+1,part={id,area:0,px:[],minX:cw,minY:ch,maxX:0,maxY:0};label[i]=id;stack.push(i);
    while(stack.length){
      const p=stack.pop(),x=p%cw,y=(p-x)/cw;part.area++;part.px.push(p);
      if(x<part.minX)part.minX=x;if(x>part.maxX)part.maxX=x;if(y<part.minY)part.minY=y;if(y>part.maxY)part.maxY=y;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const qx=x+dx,qy=y+dy;if(qx<0||qy<0||qx>=cw||qy>=ch)continue;
        const q=qy*cw+qx;if(label[q]===-1){label[q]=id;stack.push(q);}
      }
    }
    parts.push(part);
  }
  const result={cut:[],ilhas:[],borda:0,fundo:0};
  if(!parts.length)return result;
  const main=parts.reduce((a,b)=>b.area>a.area?b:a);
  const border=p=>Math.min(p.minX,p.minY,cw-1-p.maxX,ch-1-p.maxY);
  for(const part of parts){
    if(part===main||part.area<MIN_AREA)continue;
    const box=[part.minX,part.minY,part.maxX,part.maxY];
    if(border(part)<cutRing){
      // A big piece (a grill, a dropped prop) is drawn on purpose and only clipped: it needs a bigger cell, not --fix.
      const big=part.area>CUT_MAX*main.area;
      result.cut.push({area:part.area,box,...(big?{grande:true}:{})});
      if(mask&&!big)for(const p of part.px){
        mask[p]=1;
        // Its faint edge (alpha ≤ ALPHA, outside every part) would stay as a ghost outline.
        const x=p%cw,y=(p-x)/cw;
        for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const qx=x+dx,qy=y+dy;if(qx>=0&&qy>=0&&qx<cw&&qy<ch&&!label[qy*cw+qx])mask[qy*cw+qx]=1;}
      }
    }
    else result.ilhas.push({area:part.area,box});
  }
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
    const ring=Math.min(x,y,cw-1-x,ch-1-y);
    if(ring<EDGE&&label[y*cw+x])result.borda++;
    if(mask&&ring<FIX_RING)mask[y*cw+x]=1;
  }
  // Background: pale px flooded (4-connected) from the transparent outside.
  const seen=new Uint8Array(n),queue=[];
  // The enemies' importer bakes a dark rim (RIM) around the alpha, around a background too: a background is pale px
  // reached from outside through that rim. Pale px the outside touches directly (a glow, a flashlight beam) are drawn.
  const kind=new Uint8Array(n),halo=[],rims=[];// 1 rim, 2 background, 3 glow
  for(let i=0;i<n;i++)if(!label[i]){seen[i]=1;queue.push(i);}
  for(let k=0;k<queue.length;k++){
    const p=queue[k],x=p%cw,y=(p-x)/cw,from=label[p]?kind[p]:0;
    for(const [qx,qy] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){
      if(qx<0||qy<0||qx>=cw||qy>=ch)continue;
      const q=qy*cw+qx;if(seen[q])continue;
      const o=at(qx,qy),r=data[o],g=data[o+1],b=data[o+2];
      if(pale(r,g,b)){kind[q]=from===1||from===2?2:3;if(kind[q]===2)halo.push(q);}
      else if((from===0||from===1)&&isRim(r,g,b)){kind[q]=1;rims.push(q);}
      else continue;
      seen[q]=1;queue.push(q);
    }
  }
  // A background is wide and smooth: keep its core (a full 3×3 window of background) and grow it back 3 px inside the
  // candidates, so narrow cream parts of the drawing next to it (eggs on a tray) stay.
  // Only a background behind the figure: its rim is a good part of the figure's outline (WRAP), in big pieces (SLAB). Papers flying around or a
  // dust cloud at the wheels are drawn with the same cream and rim, along a small part of it.
  if(halo.length>=HALO_AREA){
    let outline=0,wrapped=0;
    for(let i=0;i<n;i++){
      if(!label[i])continue;
      const x=i%cw,y=(i-x)/cw;let out=false,pale=false;
      for(const [qx,qy] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){if(qx<0||qy<0||qx>=cw||qy>=ch||!label[qy*cw+qx])out=true;}
      if(!out)continue;outline++;
      for(let dy=-2;dy<=2&&!pale;dy++)for(let dx=-2;dx<=2;dx++){const qx=x+dx,qy=y+dy;if(qx>=0&&qy>=0&&qx<cw&&qy<ch&&kind[qy*cw+qx]===2){pale=true;break;}}
      if(pale)wrapped++;
    }
    result.wrap=outline?wrapped/outline:0;
    // The biggest connected piece of it (a background is one slab or two; papers are many small ones).
    const seenR=new Uint8Array(n);let big=0;
    for(const start of halo){if(seenR[start])continue;const list=[start];seenR[start]=1;
      for(let k=0;k<list.length;k++){const p=list[k],x=p%cw,y=(p-x)/cw;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const qx=x+dx,qy=y+dy;if(qx<0||qy<0||qx>=cw||qy>=ch)continue;const q=qy*cw+qx;if(kind[q]===2&&!seenR[q]){seenR[q]=1;list.push(q);}}}
      big=Math.max(big,list.length);}
    result.slab=big;
    if(result.wrap<WRAP||big<SLAB)halo.length=0;

  }
  if(halo.length>=HALO_AREA){
    const core=[];
    for(const p of halo){
      const x=p%cw,y=(p-x)/cw;let c=0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const qx=x+dx,qy=y+dy;if(qx>=0&&qy>=0&&qx<cw&&qy<ch&&kind[qy*cw+qx]===2)c++;}
      if(c===9)core.push(p);
    }
    const keep=new Uint8Array(n);for(const p of core)keep[p]=1;
    let edge=core;
    for(let step=0;step<3;step++){
      const next=[];
      for(const p of edge){const x=p%cw,y=(p-x)/cw;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const qx=x+dx,qy=y+dy;if(qx<0||qy<0||qx>=cw||qy>=ch)continue;
          const q=qy*cw+qx;if(!keep[q]&&kind[q]===2){keep[q]=1;next.push(q);}}}
      edge=next;
    }
    halo.length=0;for(let i=0;i<n;i++)if(keep[i])halo.push(i);
    // The rim that outlined the background goes with it (the figure gets its own back in clearMask).
    const near=p=>{const x=p%cw,y=(p-x)/cw;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const qx=x+dx,qy=y+dy;if(qx>=0&&qy>=0&&qx<cw&&qy<ch&&keep[qy*cw+qx])return true;}return false;};
    rims.splice(0,rims.length,...rims.filter(near));
  }
  if(halo.length>=HALO_AREA){result.fundo=halo.length;if(mask){for(const p of halo)mask[p]=2;for(const p of rims)mask[p]=2;}}
  return result;
}

/**
 * Clears what analyzeCell marked; where a background went (mask 2), the figure gets the importer's rim back (RIM at
 * alpha .85, one px) on the side the background used to cover.
 */
export function clearMask(data,width,x0,y0,cw,ch,mask){
  let changed=false;const at=(x,y)=>((y0+y)*width+x0+x)*4;
  // The fringe: up to FRINGE layers of darker cream (the background blended into the figure's edge) go with it.
  for(let pass=0;pass<FRINGE;pass++){
    const more=[];
    for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
      if(mask[y*cw+x])continue;
      const o=at(x,y);if(data[o+3]<=ALPHA||!creamish(data[o],data[o+1],data[o+2]))continue;
      let next=false;
      for(let dy=-1;dy<=1&&!next;dy++)for(let dx=-1;dx<=1;dx++){const qx=x+dx,qy=y+dy;if(qx>=0&&qy>=0&&qx<cw&&qy<ch&&mask[qy*cw+qx]===2){next=true;break;}}
      if(next)more.push(y*cw+x);
    }
    for(const p of more)mask[p]=2;
  }
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++)if(mask[y*cw+x]&&data[at(x,y)+3]){data[at(x,y)+3]=0;changed=true;}
  // Crumbs: bits of the background's light left loose next to where it was (smaller than CRUMB px) go too.
  const label=new Int32Array(cw*ch),parts=[];
  for(let i=0;i<cw*ch;i++){
    if(label[i]||data[at(i%cw,(i-i%cw)/cw)+3]<=ALPHA)continue;
    const part={px:[],touches:false},stack=[i];label[i]=parts.length+1;
    while(stack.length){
      const p=stack.pop(),x=p%cw,y=(p-x)/cw;part.px.push(p);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const qx=x+dx,qy=y+dy;if(qx<0||qy<0||qx>=cw||qy>=ch)continue;
        const q=qy*cw+qx;if(mask[q]===2)part.touches=true;
        if(!label[q]&&data[at(qx,qy)+3]>ALPHA){label[q]=parts.length+1;stack.push(q);}
      }
    }
    parts.push(part);
  }
  const biggest=parts.reduce((a,b)=>b.px.length>a.px.length?b:a,parts[0]);
  for(const part of parts)if(part!==biggest&&part.touches&&part.px.length<CRUMB)for(const p of part.px){data[at(p%cw,(p-p%cw)/cw)+3]=0;mask[p]=2;}
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
    if(mask[y*cw+x]!==2||Math.min(x,y,cw-1-x,ch-1-y)<FIX_RING)continue;
    let near=false;
    for(let dy=-1;dy<=1&&!near;dy++)for(let dx=-1;dx<=1;dx++){
      const qx=x+dx,qy=y+dy;if(qx<0||qy<0||qx>=cw||qy>=ch||mask[qy*cw+qx])continue;
      if(data[at(qx,qy)+3]>ALPHA){near=true;break;}
    }
    if(near){const o=at(x,y);data[o]=RIM[0];data[o+1]=RIM[1];data[o+2]=RIM[2];data[o+3]=217;}
  }
  return changed;
}

const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
async function rgba(path){
  const {data,info}=await sharp(path).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {data,width:info.width,height:info.height};
}
const failing=c=>c.cut.length||c.borda||c.fundo;

/** Every cell of a sheet: the failing ones and how many loose parts inside. */
export async function analyzeSheet(sheet,fix=false){
  const img=await rgba(sheet.path),[cw,ch]=sheet.cell,fails=[];let ilhas=0,changed=false;
  for(let k=0;k<sheet.frames;k++){
    const x0=k%sheet.columns*cw,y0=Math.floor(k/sheet.columns)*ch,mask=fix?new Uint8Array(cw*ch):undefined;
    const c=analyzeCell(img.data,img.width,x0,y0,cw,ch,mask,sheet.lite?EDGE:FIX_RING);
    ilhas+=c.ilhas.length;
    if(!failing(c))continue;
    fails.push({frame:sheet.firstFrame+k,...(c.cut.length?{corte:c.cut}:{}),...(c.borda?{borda:c.borda}:{}),...(c.fundo?{fundo:c.fundo}:{})});
    if(mask)changed=clearMask(img.data,img.width,x0,y0,cw,ch,mask)||changed;
  }
  return {fails,ilhas,img:changed?img:undefined};
}

export const readRecord=(root=ROOT)=>existsSync(join(root,RECORD))?JSON.parse(readFileSync(join(root,RECORD),'utf8')):{files:{}};

/**
 * The enemies' group manifest keeps a sha256 per page, per file entry and per piece (scripts/art-v2/convert.mjs: the
 * importer tells a changed piece by them): a fixed sheet updates all three.
 */
export const ENEMY_MANIFEST='public/art/enemies/manifest.json';
function rehash(page,hash,root=ROOT){
  const path=join(root,ENEMY_MANIFEST),manifest=JSON.parse(readFileSync(path,'utf8'));
  for(const piece of Object.values(manifest.pieces)){
    let touched=false;
    for(const f of Object.values(piece.files)){
      const pages=f.pages??[];if(!pages.some(p=>p.file===page))continue;
      for(const p of pages)if(p.file===page)p.sha256=hash;
      f.sha256=pages.length===1?pages[0].sha256:sha(pages.map(p=>`${p.file} ${p.sha256}`).join('\n'));touched=true;
    }
    if(touched)piece.sha256=sha(Object.entries(piece.files).map(([k,f])=>`${k} ${f.sha256}`).sort().join('\n'));
  }
  writeFileSync(path,`${JSON.stringify(manifest,null,2)}\n`);
}

async function main(){
  const args=new Set(process.argv.slice(2)),all=sheets(),files={};
  // Other rules: every sheet again.
  const read=readRecord(),record=JSON.stringify(read.rules)===JSON.stringify(RULES)?read:{files:{}};
  let analysed=0,fixed=0;
  for(const sheet of all){
    if(!existsSync(sheet.path))continue;
    let hash=sha(readFileSync(sheet.path)),entry=record.files[sheet.key];
    if(args.has('--fix')&&!sheet.lite&&sheet.key.startsWith('enemies/')&&(entry?.sha!==hash||entry.fails.length)){
      const r=await analyzeSheet(sheet,true);
      if(r.img){
        await sharp(r.img.data,{raw:{width:r.img.width,height:r.img.height,channels:4}}).webp({lossless:true,effort:6}).toBuffer().then(b=>writeFileSync(sheet.path,b));
        hash=sha(readFileSync(sheet.path));fixed++;console.error(`corrigida ${sheet.key}: ${r.fails.length} quadros`);
        rehash(sheet.key.slice('enemies/'.length),hash);
      }
    }
    if(entry?.sha!==hash){
      const r=await analyzeSheet(sheet);analysed++;
      entry={sha:hash,ilhas:r.ilhas,fails:r.fails};
    }
    files[sheet.key]=entry;
  }
  const sorted=Object.fromEntries(Object.entries(files).sort(([a],[b])=>a<b?-1:1));
  const summary={sheets:Object.keys(sorted).length,failing:Object.values(sorted).filter(e=>e.fails.length).length,
    frames:Object.values(sorted).reduce((s,e)=>s+e.fails.length,0)};
  writeFileSync(join(ROOT,RECORD),`${JSON.stringify({rules:RULES,summary,files:sorted},null,1)}\n`);
  console.error(`sheet-cells: ${summary.sheets} folhas (${analysed} analisadas${fixed?`, ${fixed} corrigidas`:''}), ${summary.failing} reprovam (${summary.frames} quadros)`);
  if(args.has('--report'))for(const [key,e] of Object.entries(sorted))for(const f of e.fails)
    console.log(`${key} quadro ${f.frame}:${f.corte?` corte ${f.corte.length} (${f.corte.map(c=>c.area).join('+')} px)`:''}${f.borda?` borda ${f.borda} px`:''}${f.fundo?` fundo ${f.fundo} px`:''}`);
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await main();
