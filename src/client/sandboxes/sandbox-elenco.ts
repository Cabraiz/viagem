/**
 * Roster contact sheet (modo foto `elenco-roster`, D-049): `?sandbox=elenco[&ids=a,b][&novos=1][&antes=a,b][&pagina=N][&heroi=id]`.
 * Plain DOM + canvas over a snow-like ground, no Phaser: per roster id with art (rules ENEMY_ART_IDS), the hero at its
 * game size and the enemy's still loop frame 0 facing S, SE and E from the lite copy, at the game's size; caption: id,
 * role, animation. Layout and scale rules: dev/elenco.ts. Ready: body[data-elenco-ready="1"].
 */
import {artReady} from '../ui/art-boot.ts';
import {artPages,artPiece,artUrl,type ArtFile} from '../art/manifest.ts';
import {MASS_ALPHA,chooseAnim,liteEnemyUrl,topRow} from '../art/horde-art.ts';
import {directionalSheet} from '../sprites/sprite-sheets.ts';
import {roleOf} from '../../rules/index.ts';
import {ELENCO_DIRS,GAP_PX,PAD_PX,CAPTION_PX,caixaMundo,elencoGrade,elencoIds,elencoPagina,elencoZoom,enemyEscala,heroEscala,type Caixa} from '../dev/elenco.ts';

interface Figura {img:HTMLImageElement;sx:number;sy:number;cell:readonly [number,number];anchor:readonly [number,number];escala:number;caixa:Caixa}
const imagens=new Map<string,Promise<HTMLImageElement>>();
const imagem=(url:string)=>{
  let p=imagens.get(url);
  if(!p){p=new Promise((ok,erro)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>erro(new Error(`não carregou ${url}`));i.src=url;});imagens.set(url,p);}
  return p;
};
const probe=document.createElement('canvas').getContext('2d',{willReadFrequently:true})!;
/** The cell's pixels (RGBA) at source (sx, sy). */
function pixels(img:HTMLImageElement,sx:number,sy:number,w:number,h:number){
  probe.canvas.width=w;probe.canvas.height=h;probe.clearRect(0,0,w,h);
  probe.drawImage(img,sx,sy,w,h,0,0,w,h);
  return probe.getImageData(0,0,w,h).data;
}
/** Alpha box (≥ MASS_ALPHA) of a cell, or the whole cell when empty. */
function alphaBox(data:Uint8ClampedArray,w:number,h:number){
  let x0=w,x1=-1,y0=h,y1=-1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(data[(y*w+x)*4+3]>=MASS_ALPHA){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
  return x1<0?{x0:0,x1:w-1,y0:0,y1:h-1}:{x0,x1,y0,y1};
}
/** Source position of frame `col` of sheet row `row` (paged sheets: the page holding it). */
async function celula(file:ArtFile,row:number,col:number){
  const frames=file.frames??1,global=row*frames+col;
  const page=artPages(file).find(p=>global>=p.firstFrame&&global<p.firstFrame+p.frameCount);
  const url=page&&artUrl('inimigos',page.file);if(!page||!url)throw new Error(`sem página para ${file.file} linha ${row}`);
  const i=global-page.firstFrame;
  return {img:await imagem(liteEnemyUrl(url)),sx:(i%page.columns)*file.cell[0],sy:Math.floor(i/page.columns)*file.cell[1]};
}

async function inimigo(id:string){
  const piece=artPiece('inimigos',id),anim=piece&&chooseAnim(piece,false),file=anim?piece.files[anim]:undefined;
  if(!piece||!anim||!file)throw new Error(`${id}: sem arte no índice`);
  const cell=file.cell,anchor=file.anchor??[.5,.88],feet=cell[1]*anchor[1];
  // The game's drawn height (horde-art drawnHeight): the tallest of the 8 directions' frame 0.
  let drawn:number|undefined;
  const cels=await Promise.all(Array.from({length:file.directions??8},(_,r)=>celula(file,r,0)));
  for(const c of cels){const top=topRow(pixels(c.img,c.sx,c.sy,cell[0],cell[1]),cell[0],cell[1]);if(top>=0&&top<feet)drawn=Math.max(drawn??0,feet-top);}
  const escala=enemyEscala(id,drawn,cell[1],anchor[1]);
  const figs=ELENCO_DIRS.map(({row}):Figura=>{
    const c=cels[Math.min(row,cels.length-1)];
    return {...c,cell,anchor,escala,caixa:caixaMundo(alphaBox(pixels(c.img,c.sx,c.sy,cell[0],cell[1]),cell[0],cell[1]),cell,anchor,escala)};
  });
  return {id,anim,figs};
}
async function heroi(id:string):Promise<Figura>{
  const sheet=directionalSheet(id);if(!sheet)throw new Error(`herói ${id}: sem atlas de 4 direções`);
  const img=await imagem(sheet.url),cell=[192,192] as const,anchor=[.5,.88] as const,escala=heroEscala(sheet.height);
  // Frame 0 of the front-right block's idle row (sprite-motion.ts FACINGS): the hero standing, as in the game.
  return {img,sx:0,sy:0,cell,anchor,escala,caixa:caixaMundo(alphaBox(pixels(img,0,0,192,192),192,192),cell,anchor,escala)};
}

const css=`
.elenco{position:fixed;inset:0;z-index:2147483000;overflow:hidden;font:12px/1.2 system-ui,sans-serif;color:#2b3440;
  background:radial-gradient(ellipse at 30% 20%,#f8fbfd,#e6edf2 60%,#d9e2e9);display:grid;gap:${GAP_PX}px}
.elenco-tile{display:flex;flex-direction:column;min-width:0;min-height:0;background:rgba(255,255,255,.35);border-radius:6px}
.elenco-tile canvas{display:block}
.elenco-cap{height:${CAPTION_PX}px;display:flex;flex-direction:column;justify-content:center;align-items:center;white-space:nowrap;overflow:hidden}
.elenco-cap b{font-size:12px}.elenco-cap span{font-size:10px;color:#5b6773}
.elenco-tag{position:fixed;top:2px;right:4px;z-index:2147483001;font:10px system-ui,sans-serif;color:#5b6773}
.elenco-erro{position:fixed;inset:0;display:grid;place-items:center;z-index:2147483001;background:#eef3f6;font:14px system-ui,sans-serif}`;

async function abrir(){
  const q=new URLSearchParams(location.search);
  const style=document.createElement('style');style.textContent=css;document.head.append(style);
  await artReady();
  const {ids,desconhecidos}=elencoIds(location.search);
  const w=innerWidth,h=innerHeight,grade=elencoGrade(w,h);
  const pagina=elencoPagina(ids,Number(q.get('pagina')??1),grade.porPagina);
  if(!ids.length){const e=document.createElement('div');e.className='elenco-erro';e.textContent=`nenhum id (desconhecidos: ${desconhecidos.join(', ')||'—'})`;document.body.append(e);return;}
  // One zoom for the whole selection (every page compares): all the still loops are measured.
  const [hero,tiles]=await Promise.all([heroi(q.get('heroi')||'cidadao-comum'),Promise.all(ids.map(inimigo))]);
  const k=elencoZoom(tiles.map(t=>[hero.caixa,...t.figs.map(f=>f.caixa)]),grade.cw,grade.ch);
  const root=document.createElement('div');root.className='elenco';
  root.style.gridTemplateColumns=`repeat(${grade.cols},1fr)`;root.style.gridTemplateRows=`repeat(${grade.rows},1fr)`;
  const dpr=devicePixelRatio||1;
  for(const t of tiles.filter(t=>pagina.itens.includes(t.id))){
    const tile=document.createElement('div');tile.className='elenco-tile';
    const canvas=document.createElement('canvas'),cw=grade.cw,chh=grade.ch-CAPTION_PX;
    canvas.width=Math.round(cw*dpr);canvas.height=Math.round(chh*dpr);canvas.style.width=`${cw}px`;canvas.style.height=`${chh}px`;
    const ctx=canvas.getContext('2d')!;ctx.scale(dpr,dpr);ctx.imageSmoothingQuality='high';
    const figs=[hero,...t.figs],abaixo=Math.max(...figs.map(f=>f.caixa.bottom))*k,base=chh-PAD_PX-abaixo;
    const largura=figs.reduce((s,f)=>s+(f.caixa.right-f.caixa.left)*k,0)+GAP_PX*(figs.length-1);
    let x=(cw-largura)/2;
    // Snow shadow line under the feet, then each figure with its feet on the baseline.
    ctx.fillStyle='rgba(120,140,160,.18)';ctx.fillRect(PAD_PX,base,cw-2*PAD_PX,1);
    for(const f of figs){
      const s=f.escala*k,fx=x-f.caixa.left*k;
      ctx.drawImage(f.img,f.sx,f.sy,f.cell[0],f.cell[1],fx-f.cell[0]*f.anchor[0]*s,base-f.cell[1]*f.anchor[1]*s,f.cell[0]*s,f.cell[1]*s);
      x+=(f.caixa.right-f.caixa.left)*k+GAP_PX;
    }
    const cap=document.createElement('div');cap.className='elenco-cap';
    const nome=document.createElement('b');nome.textContent=t.id;
    const info=document.createElement('span');info.textContent=`${roleOf(t.id)??'?'} · ${t.anim} · herói, ${ELENCO_DIRS.map(d=>d.nome).join(', ')}`;
    cap.append(nome,info);tile.append(canvas,cap);root.append(tile);
  }
  const tag=document.createElement('div');tag.className='elenco-tag';
  tag.textContent=`página ${pagina.pagina}/${pagina.paginas} · ${ids.length} ids${desconhecidos.length?` · desconhecidos: ${desconhecidos.join(', ')}`:''}`;
  document.body.append(root,tag);
}

abrir().then(()=>{document.body.dataset.elencoReady='1';},e=>{
  (window as unknown as {__fotoErro?:string}).__fotoErro=`elenco: ${String(e)}`;
  document.body.dataset.elencoReady='1';
});
