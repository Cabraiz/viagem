/**
 * Delivery adapter for the new scenery pack (NEW-20261016-ORQ-importar-cenario-novo): the flat `cenario/` root,
 * `cenario/banco` and `cenario/decor` → importer group `cenario` (kind 'decor', scripts/art-v2/spec.mjs), one folder per
 * piece `cenario/decor/<id>/`:
 *  - `sheet.png` + `sheet.json`: the piece in 4 view columns (0°/90°/180°/270° = city views 0..3), one row;
 *  - `anim-<nome>.png` + `.json`: a place's overlay (meta `anims.<nome>.<view>` = its top-left in the sheet cell, px),
 *    4 rows (views) × N frames of its own cell;
 *  - `anim.png` / `quebra.png` + `.json`: a full-cell animation / break sheet of the object (same cell and anchor as the
 *    sheet), 4 rows × N frames.
 * Ids are the delivery's stems (no prefix, no rename: agreed with E1/E3 on 16/10, list in the card's ids.md).
 *
 * The delivery ships `<id>-0|90|180|270.png` (+ `<id>.meta.json`: cell, footprint, storeys, anchor, anims, animCell,
 * animFrames, fps, wires, loop…), overlays `<id>-anim[-<nome>]-<view>.png` and break sheets `<id>-quebra-<view>.png`.
 * Scale (one factor per piece, the rules of cenario.mjs): buildings, terrain and nests by their footprint; walls and
 * fences (WALLS) and loose objects by their drawn height (DECOR_HEIGHT). Every layer of a piece (overlays, break sheet,
 * wires, anims, the bank screen point) goes through the SAME transform as its sheet, so they stay where they were drawn.
 * banco/: each PNG is 4 views stacked in rows; every piece of one machine takes the machine's factor. decal/: 1 view,
 * delivered scale (flat on the ground, no world size to compare).
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {levelWallBase} from './wall-slope.mjs';
import {plan,measure,cornerOffset,HEIGHT_PX,ART_SCALE,BUILDING_BOTTOM,PROP_BOTTOM,OUTLIER,MAX_UPSCALE} from './cenario.mjs';

// 238 pieces of up to 1024² × 4 views: no libvips cache and one thread keep the run within a shared PC's memory.
sharp.cache(false);sharp.concurrency(1);
const PAD=2,PNG={compressionLevel:9,adaptiveFiltering:false,palette:false,effort:10};
export const VIEW_DEGREES=Object.freeze(['0','90','180','270']);
/** Wall and fence families (`<family>-<part>-<state>`): drawn through the cell's middle. */
export const WALLS=Object.freeze(['alambrado','cerca-madeira','grade','muro-condominio','muro-pichado','tapume']);
export const WALL_THICKNESS=.3;
/** Walls may be upscaled a bit more (thin parts drawn small in their canvas; a fence still reads at ×1.6). */
export const WALL_MAX_UPSCALE=1.6;
/** Pieces scaled by their footprint (besides every piece with `storeys`). */
const FOOTPRINT_RULE=/^(ninho-|montanha-|morro-|penhasco|rampa$|ponte$|cachoeira-)/;
/**
 * Drawn height (world units, tallest point to the ground; hero ≈ 2.3 u) of the walls and loose objects, by series
 * (the id without its variation number and state). Same scale as cenario.mjs WORLD_HEIGHT.
 */
export const DECOR_HEIGHT=Object.freeze({
  alambrado:2.4,'cerca-madeira':1.6,'cerca-madeira-portao':2.6,grade:2.2,'muro-condominio':2.6,'muro-pichado':2.4,tapume:2.6,
  'academia-praca':2.4,'antena-parabolica':1.6,'arvore-natal-torta':3.2,'banca-jornal':2.8,'barraca-feira':2.8,
  'barril-quebravel':1.2,bebedouro:1.3,bicicleta:1.4,'cacamba-entulho':1.6,'cadeira-praia':1.1,'caixa-dagua':1.8,
  'caixa-papelao':.8,'caixote-quebravel':1,'carrinho-pipoca':2.2,carroca:1.8,'fogueira-tambor':1.6,
  'gaiola-passarinho':1,'geladeira-calcada':2.2,'kombi-velha':2.6,'luminaria-quebrada-pisca':2.5,
  'maquina-lavar-calcada':1.3,'mesa-domino':1.3,'moto-velha':1.5,outdoor:5,pedregulho:1.2,'piscina-plastico':.7,
  'pneus-empilhados':1.3,'ponto-mototaxi':3,'poste-aceso-amarelo':5,'poste-concreto':5.5,'poste-gato':5,
  'presepio-quebrado':1.6,'saco-lixo':.8,'varal-roupa':2.2,'vaso-planta':1.1,banco:2.6,
});
/** Meta keys copied from the delivery (positions are rewritten through the piece's transform). */
const COPY_META=['footprint','storeys','fps','loop'];

const round=(v,d=3)=>Math.round(v*10**d)/10**d;
const ceil8=v=>Math.ceil(v/8)*8;
const median=a=>{const s=[...a].sort((x,y)=>x-y),n=s.length;return n?(n%2?s[n>>1]:(s[n/2-1]+s[n/2])/2):NaN;};
const readJson=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^﻿/,''));}catch{return undefined;}};
const isPair=v=>Array.isArray(v)&&v.length===2&&v.every(n=>Number.isInteger(n)&&n>0);
export const wallOf=id=>WALLS.find(f=>id.startsWith(`${f}-`));
/** Series of a piece: the id without its variation number and state (walls: family and part, `grade-portao`). */
export const seriesOf=id=>id.replace(/-(intacto|quebrado)$/,'').replace(/-\d+$/,'');
/** World height of a piece: its series, else (walls) its family. */
export const heightOf=id=>DECOR_HEIGHT[seriesOf(id)]??DECOR_HEIGHT[wallOf(id)];
export function ruleOf(id,meta){
  if(wallOf(id))return 'wall';
  if(Number.isInteger(meta?.storeys)||FOOTPRINT_RULE.test(id))return 'building';
  return 'prop';
}

// ---------------------------------------------------------------- raster helpers
async function readRaw(file){
  const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {data,width:info.width,height:info.height};
}
function cut(img,w,h){
  const out=[];
  for(let r=0;r+h<=img.height;r+=h)for(let c=0;c+w<=img.width;c+=w){
    const data=Buffer.alloc(w*h*4);
    for(let y=0;y<h;y++)img.data.copy(data,y*w*4,((r+y)*img.width+c)*4,((r+y)*img.width+c+w)*4);
    out.push({data,width:w,height:h});
  }
  return out;
}
async function scale(img,f){
  if(f===1)return img;
  const W=Math.max(1,Math.round(img.width*f)),H=Math.max(1,Math.round(img.height*f));
  const data=await sharp(img.data,{raw:{width:img.width,height:img.height,channels:4}}).resize(W,H,{kernel:'lanczos3',fit:'fill'}).raw().toBuffer();
  return {data,width:W,height:H};
}
/** Writes `cells[row][col]` (images of cell w×h each) into one PNG. */
async function sheetPng(cells,w,h){
  const rows=cells.length,cols=cells[0].length,stride=w*cols*4,buf=Buffer.alloc(stride*h*rows);
  cells.forEach((row,r)=>row.forEach((c,col)=>{
    if(!c)return;
    const {img,ox,oy}=c;
    for(let y=0;y<img.height;y++){
      const ty=oy+y;if(ty<0||ty>=h)continue;
      for(let x=0;x<img.width;x++){
        const tx=ox+x;if(tx<0||tx>=w)continue;
        const si=(y*img.width+x)*4;if(!img.data[si+3])continue;
        img.data.copy(buf,(r*h+ty)*stride+(col*w+tx)*4,si,si+4);
      }
    }
  }));
  return sharp(buf,{raw:{width:w*cols,height:h*rows,channels:4}}).png(PNG).toBuffer();
}

// ---------------------------------------------------------------- delivery discovery
/** Layers of a root piece: `anim-<nome>` / `anim` / `quebra` → {name, views:[img per view]}. */
function layerFiles(dir,id,names){
  const layers=new Map(),re=new RegExp(`^${id.replace(/[-]/g,'\\-')}-(anim(?:-[a-z0-9-]+?)?|quebra)-(0|90|180|270)\\.png$`);
  for(const f of names){
    const m=re.exec(f);if(!m)continue;
    if(!layers.has(m[1]))layers.set(m[1],{});
    layers.get(m[1])[m[2]]=path.join(dir,f);
  }
  return layers;
}

async function loadRoot(dir,id,names){
  const meta=readJson(path.join(dir,`${id}.meta.json`));
  const p={id,source:'raiz',meta,rule:ruleOf(id,meta),stems:[id]};
  if(!isPair(meta?.cell))return {...p,missing:`${id}.meta.json has no cell`};
  const views=[];
  for(const deg of VIEW_DEGREES){
    const file=path.join(dir,`${id}-${deg}.png`);
    if(!fs.existsSync(file))return {...p,missing:path.basename(file)};
    const img=await readRaw(file);
    if(img.width!==meta.cell[0]||img.height!==meta.cell[1])return {...p,missing:`${path.basename(file)} (${img.width}×${img.height}, cell ${meta.cell.join('×')})`};
    views.push(img);
  }
  p.views=views;p.layers=[];
  for(const [name,files] of layerFiles(dir,id,names)){
    const missing=VIEW_DEGREES.filter(d=>!files[d]);
    if(missing.length)return {...p,missing:`${id}-${name}: views ${missing.join(', ')}`};
    const imgs=await Promise.all(VIEW_DEGREES.map(d=>readRaw(files[d])));
    const full=name==='quebra'||name==='anim'&&!meta.anims;
    // Overlay frames are square unless the meta says otherwise (several metas have no animCell / animFrames).
    const cell=full?meta.cell:isPair(meta.animCell)?meta.animCell:[imgs[0].height,imgs[0].height];
    if(imgs.some(i=>i.height!==cell[1]||i.width%cell[0]))return {...p,missing:`${id}-${name}: ${imgs[0].width}×${imgs[0].height} is not a strip of ${cell.join('×')} frames`};
    const named=name.startsWith('anim-')?name.slice(5):undefined;
    if(named&&!meta.anims?.[named])return {...p,missing:`${id}-${name}: no position in meta.anims.${named}`};
    p.layers.push({name,named,full,cell,views:imgs.map(i=>cut(i,cell[0],cell[1]))});
    p.stems.push(`${id}-${name}`);
  }
  return p;
}

/** banco/: `<machine>[-<suffix>].png` with 4 views stacked in rows; every piece of a machine gets the machine's factor. */
async function loadBank(dir,stem){
  const meta=readJson(path.join(dir,`${stem}.meta.json`)),p={id:stem,source:'banco',meta,stems:[`banco/${stem}`]};
  if(!isPair(meta?.cell))return {...p,missing:`banco/${stem}.meta.json has no cell`};
  const img=await readRaw(path.join(dir,`${stem}.png`)),[cw,ch]=meta.cell,frames=img.width/cw;
  if(img.height!==4*ch||!Number.isInteger(frames))return {...p,missing:`banco/${stem}.png ${img.width}×${img.height}: not 4 view rows of ${cw}×${ch}`};
  p.machine=stem.replace(/-(sacando|tela-.+)$/,'');
  p.rows=cut(img,cw,ch);p.frames=frames;
  return p;
}

// ---------------------------------------------------------------- root pieces: factor, transform, layers
function factorOf(p){
  const pieceForPlan={states:[{views:p.views.map(v=>[v])}],cell:p.meta.cell,
    ...(p.rule==='building'?{footprint:p.meta.footprint,storeys:p.meta.storeys}:{})};
  const pl=plan(pieceForPlan);
  if(pl.refused||p.rule==='building')return pl;
  const world=heightOf(p.id),max=p.rule==='wall'?WALL_MAX_UPSCALE:MAX_UPSCALE;
  if(!world)return {...pl,factor:1,notes:[...pl.notes,'no world size known for it: kept the delivered scale']};
  const factor=world*HEIGHT_PX*ART_SCALE/median(p.views.map(v=>measure([v]).h));
  if(factor>max)return {refused:`drawn too small for its world size: it would be upscaled ×${round(factor,2)} (max ×${max})`,notes:pl.notes,factor};
  return {...pl,factor};
}

/**
 * Renders a root piece with its transform: per output view column c (source view (c+shift)%4) the sheet frame is
 * scaled by `factor` and its pin put at x = W/2 + off, its lowest drawn row at H − bottom. Full-cell layers share that
 * placement; named overlays and point lists are mapped through it.
 */
export async function renderRoot(p,{factor,shift=0}){
  const wall=p.rule==='wall',building=p.rule==='building',fp=isPair(p.meta.footprint)?p.meta.footprint:[1,1];
  const drop=wall?fp[1]/2*.88*HEIGHT_PX:0,bottom=(building||wall?BUILDING_BOTTOM:PROP_BOTTOM)+drop;
  const cols=[];
  let need={left:0,right:0,up:0,foot:0};
  for(let c=0;c<4;c++){
    // A wall's straight piece gets its base levelled to the screen slope of a cell axis (wall-slope.mjs).
    const sv=(c+shift)%4,scaled=await scale(p.views[sv],factor),img=wall&&/-reto-/.test(p.id)?levelWallBase(scaled,{grow:true}):scaled,m=measure([img]);
    const fx=img.width/p.views[sv].width,fy=img.height/p.views[sv].height;
    const off=building&&!wall?cornerOffset(fp,c):0,pin=wall?(m.x0+m.x1)/2:m.footX;
    const full=[];
    for(const l of p.layers.filter(l=>l.full)){
      const frames=[];for(const f of l.views[sv])frames.push(await scale(f,factor));
      full.push(frames);
      const b=measure(frames);if(b)need={...need,left:Math.max(need.left,pin-b.x0-off),right:Math.max(need.right,b.x1-pin+off),up:Math.max(need.up,m.y1-b.y0)};
    }
    need={left:Math.max(need.left,pin-m.x0-off),right:Math.max(need.right,m.x1-pin+off),up:Math.max(need.up,m.y1-m.y0),foot:Math.max(need.foot,Math.abs(m.footX-pin+off))};
    cols.push({sv,img,m,fx,fy,off,pin,full});
  }
  const W=Math.max(ceil8(2*(Math.max(need.left,need.right)+PAD+3)),ceil8((need.foot+2)/.12));
  const H=ceil8(need.up+bottom+PAD+3);
  for(const k of cols){k.ox=Math.round(W/2+k.off-k.pin);k.oy=Math.round(H-bottom)-k.m.y1;}
  const map=(c,[x,y])=>{const k=cols[c];return [Math.round(k.ox+x*k.fx),Math.round(k.oy+y*k.fy)];};
  const byView=(src,fn)=>src&&typeof src==='object'?Object.fromEntries(cols.map((k,c)=>[VIEW_DEGREES[c],src[VIEW_DEGREES[k.sv]]]).filter(([,v])=>v!==undefined).map(([d,v],i)=>[d,fn(VIEW_DEGREES.indexOf(d),v)])):undefined;
  const files={sheet:{png:await sheetPng([cols.map(k=>({img:k.img,ox:k.ox,oy:k.oy}))],W,H),json:{cell:[W,H],views:4,anchor:[.5,round(1-Math.round(bottom)/H,6)]}}};
  const meta={cell:[W,H]};
  for(const key of COPY_META)if(p.meta[key]!==undefined)meta[key]=p.meta[key];
  if(p.meta.wires)meta.wires=byView(p.meta.wires,(c,pts)=>pts.map(pt=>map(c,pt)));
  // {nome:[degrees]}: the output views whose source view shows the overlay (it can be fewer than the anims offsets).
  if(p.meta.animVisibleViews)meta.animVisibleViews=Object.fromEntries(Object.entries(p.meta.animVisibleViews).map(([n,list])=>[n,cols.map((k,c)=>list.map(String).includes(VIEW_DEGREES[k.sv])?Number(VIEW_DEGREES[c]):undefined).filter(d=>d!==undefined)]));
  if(p.meta.anims)meta.anims=Object.fromEntries(Object.entries(p.meta.anims).map(([n,v])=>[n,byView(v,(c,pt)=>map(c,pt))]));
  const fpsOf=name=>typeof p.meta.fps==='number'?p.meta.fps:p.meta.fps?.[name];
  for(const l of p.layers){
    const frames=l.views[0].length;
    let cw,ch,rows;
    if(l.full){
      [cw,ch]=[W,H];
      rows=cols.map((k,c)=>k.full[p.layers.filter(x=>x.full).indexOf(l)].map(img=>({img,ox:k.ox,oy:k.oy})));
    }else{
      cw=Math.max(1,Math.round(l.cell[0]*factor));ch=Math.max(1,Math.round(l.cell[1]*factor));
      rows=[];
      for(const k of cols){const row=[];for(const f of l.views[k.sv])row.push({img:await scaleTo(f,cw,ch),ox:0,oy:0});rows.push(row);}
    }
    const fps=fpsOf(l.named??l.name);
    files[l.name]={png:await sheetPng(rows,cw,ch),json:{cell:[cw,ch],frames,views:4,...(fps?{fps}:{})}};
  }
  files.sheet.json.meta=meta;
  return {files,cell:[W,H]};
}
async function scaleTo(img,w,h){
  if(img.width===w&&img.height===h)return img;
  const data=await sharp(img.data,{raw:{width:img.width,height:img.height,channels:4}}).resize(w,h,{kernel:'lanczos3',fit:'fill'}).raw().toBuffer();
  return {data,width:w,height:h};
}

// ---------------------------------------------------------------- banco and decal
/**
 * One bank machine: `sheet` = the machine (4 view rows → columns), and every `<machine>-<suffix>` PNG (the screens
 * `tela-*`, the cash animation `sacando`) a layer `anim-<suffix>` (4 view rows × frames, as delivered) drawn at the
 * machine's screen point `meta.tela` (also written as meta.anims.<suffix>, the layout of the places' overlays).
 */
async function renderBank(machine,layers,factor){
  const [cw,ch]=machine.meta.cell,W=Math.max(1,Math.round(cw*factor)),H=Math.max(1,Math.round(ch*factor));
  const cols=[];for(let v=0;v<4;v++)cols.push({img:await scaleTo(machine.rows[v],W,H),ox:0,oy:0});
  const tela=machine.meta.tela&&Object.fromEntries(Object.entries(machine.meta.tela).map(([d,[x,y]])=>[d,[Math.round(x*W/cw),Math.round(y*H/ch)]]));
  const meta={cell:[W,H],footprint:machine.meta.footprint??[1,1],...(tela?{tela,anims:{}}:{}),fps:{}};
  const files={sheet:{png:await sheetPng([cols],W,H),json:{cell:[W,H],views:4,anchor:machine.meta.anchor,meta}}};
  for(const l of layers){
    const name=l.id.slice(machine.id.length+1),[lw,lh]=l.meta.cell,w=Math.max(1,Math.round(lw*factor)),h=Math.max(1,Math.round(lh*factor));
    const rows=[];for(let v=0;v<4;v++){const row=[];for(let f=0;f<l.frames;f++)row.push({img:await scaleTo(l.rows[v*l.frames+f],w,h),ox:0,oy:0});rows.push(row);}
    files[`anim-${name}`]={png:await sheetPng(rows,w,h),json:{cell:[w,h],frames:l.frames,views:4,...(l.meta.fps?{fps:l.meta.fps}:{})}};
    if(tela)meta.anims[name]=tela;
    if(l.meta.fps)meta.fps[name]=l.meta.fps;
    if(l.meta.loop!==undefined)(meta.loop??={})[name]=l.meta.loop;
  }
  if(!Object.keys(meta.fps).length)delete meta.fps;
  return files;
}

// ---------------------------------------------------------------- adapter entry
function write(out,id,files){
  const dir=path.join(out,'cenario','decor',id);
  fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
  for(const [name,{png,json}] of Object.entries(files)){
    fs.writeFileSync(path.join(dir,`${name}.png`),png);
    fs.writeFileSync(path.join(dir,`${name}.json`),JSON.stringify(json)+'\n');
  }
  return Object.keys(files);
}

export async function adapt({src,out,log=()=>{}}){
  const root=path.join(src,'cenario'),records=[],group='cenario';
  if(!fs.existsSync(root))return records;
  const names=fs.readdirSync(root);
  // Root pieces: one per meta stem.
  const planned=[];
  for(const f of names.filter(f=>f.endsWith('.meta.json')).sort()){
    const p=await loadRoot(root,f.slice(0,-10),names);
    if(p.missing){records.push({group,id:p.id,action:'refused',notes:[`from ${p.stems.join(' + ')}`],refused:`incomplete delivery: ${p.missing}`});continue;}
    planned.push({p,plan:factorOf(p)});
  }
  // Outliers against the series drawn on the same canvas (the delivery fits each canvas size on its own).
  const key=p=>`${seriesOf(p.id)} ${p.meta.cell.join('x')}`,series=new Map();
  for(const x of planned)if(!x.plan.refused){const k=key(x.p);series.set(k,[...(series.get(k)??[]),x.plan.factor]);}
  for(const x of planned){
    const fs_=series.get(key(x.p));
    if(x.plan.refused||!fs_||fs_.length<2)continue;
    const med=median(fs_),gap=x.plan.factor/med-1;
    if(Math.abs(gap)>OUTLIER)x.plan={...x.plan,refused:`scale ×${round(x.plan.factor,2)} is ${Math.round(gap*100)} % off its series (×${round(med,2)}): drawn at a different size than its variations`};
  }
  for(const {p,plan:pl} of planned){
    const notes=[`from ${p.stems.join(' + ')}`,`rule: ${p.rule}`,...pl.notes];
    if(pl.refused){records.push({group,id:p.id,action:'refused',...(pl.factor?{factor:round(pl.factor)}:{}),notes,refused:pl.refused});continue;}
    const r=await renderRoot(p,pl),written=write(out,p.id,r.files);
    const action=`joined 4 views${pl.factor!==1?`, scaled ×${round(pl.factor)}`:''}, cell ${r.cell.join('×')}${written.length>1?` + ${written.filter(n=>n!=='sheet').join(', ')}`:''}`;
    records.push({group,id:p.id,action,factor:round(pl.factor),notes});
    log(`${group}/${p.id}: ${action}`);
  }
  // banco/: the machine's factor from its idle sheet's drawn height.
  const bankDir=path.join(root,'banco');
  if(fs.existsSync(bankDir)){
    const pieces=[];
    for(const f of fs.readdirSync(bankDir).filter(f=>f.endsWith('.png')).sort())pieces.push(await loadBank(bankDir,f.slice(0,-4)));
    const factors=new Map();
    for(const p of pieces)if(!p.missing&&p.machine===p.id){
      const h=median([0,1,2,3].map(v=>measure([p.rows[v*p.frames]])?.h??NaN));
      factors.set(p.id,Math.min(1,DECOR_HEIGHT.banco*HEIGHT_PX*ART_SCALE/h));
    }
    for(const m of pieces.filter(p=>p.machine===p.id||p.missing)){
      const layers=pieces.filter(p=>p.machine===m.id&&p.id!==m.id),from=`from ${[m,...layers].flatMap(p=>p.stems).join(' + ')}`,factor=factors.get(m.id);
      const bad=[m,...layers].find(p=>p.missing);
      if(bad||factor===undefined){records.push({group,id:m.id,action:'refused',notes:[from],refused:bad?`incomplete delivery: ${bad.missing}`:`no machine sheet banco/${m.id}.png to scale it by`});continue;}
      const files=await renderBank(m,layers,factor),written=write(out,m.id,files);
      records.push({group,id:m.id,action:`4 view rows → columns, scaled ×${round(factor)} + ${written.filter(n=>n!=='sheet').join(', ')}`,factor:round(factor),notes:[from]});
    }
    for(const p of pieces.filter(p=>!p.missing&&p.machine!==p.id&&!factors.has(p.machine)))
      records.push({group,id:p.id,action:'refused',notes:[`from ${p.stems.join(' + ')}`],refused:`no machine sheet banco/${p.machine}.png`});
  }
  // decal/: 1 view, delivered scale.
  const decalDir=path.join(root,'decal');
  if(fs.existsSync(decalDir))for(const f of fs.readdirSync(decalDir).filter(f=>f.endsWith('.png')).sort()){
    const id=f.slice(0,-4),png=fs.readFileSync(path.join(decalDir,f)),m=await sharp(png).metadata();
    // Flat on the ground: the anchor is the cell's centre.
    write(out,id,{sheet:{png,json:{cell:[m.width,m.height],views:1,anchor:[.5,.5],meta:{decal:true}}}});
    records.push({group,id,action:'decal copied (1 view, delivered scale)',notes:[`from decal/${f}`]});
  }
  return records;
}
