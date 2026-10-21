/**
 * Muralha de tralha (NEW-20261021-ORQ-muralha-tralha-no-jogo): the E3's 10 straight junk pieces and 3 pillars
 * (arte-entrada/cenario/base/muralha-tralha/, card muralha-tralha-arte) → two base sheets the free barricade squares
 * draw (render/muralha-rules.ts):
 *   public/art/city/base/muralha-tralha.webp        reto-01..10
 *   public/art/city/base/muralha-tralha-pilar.webp  pilar-1..3
 * Each source is a Codex edit of a gray box template (molde.py) already keyed by montar.py (`<id>-t.png`, 1536×1024): the
 * box's ground centre is known (CENTER), so every piece is cut from the same window around it and lines up with the
 * others. Rows: one per piece × damage state (DAMAGE, baked here: bites off the top, darker); columns (views): 0 the
 * piece as drawn (it runs lower-left → upper-right), 1 mirrored (the other diagonal). Frames in reading order of that
 * grid, laid out PAGE_COLUMNS wide so the sheet stays under 4096 px. meta.celula: art px across one build cell along the
 * wall (the renderer scales a cell to the projected CITY_BUILD_CELL, so pieces meet without a gap).
 * The group manifest and the index are rewritten; then `node scripts/art-lite.mjs --kinds city` makes the lite copies.
 *   node scripts/import-muralha-tralha.mjs [--src <folder>]
 */
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');

/** Damage rows, best first (base-art.ts names; a fallen square is removed, so no 'quebrada'). */
export const DAMAGE=['inteira','avariada','quase-caindo'];
/** Template geometry (molde.py): one cell is 700 px across along the wall; the box's ground centre in the 1536×1024 frame. */
export const SOURCE_CELL=700;
export const KINDS={
  reto:{ids:Array.from({length:10},(_,i)=>`reto-${String(i+1).padStart(2,'0')}`),center:[768,694],
    // Window around the centre (covers every piece's drift: reto-08 reaches 624 up), wall height on screen, ground slope.
    window:{left:450,up:630,down:230},cell:[164,157],height:380,slope:.5,lift:45,piece:'muralha-tralha',columns:8},
  pilar:{ids:['pilar-1','pilar-2','pilar-3'],center:[768,792],
    window:{left:330,up:780,down:175},cell:[120,174],height:600,slope:0,lift:60,piece:'muralha-tralha-pilar',columns:6},
};
/** Share of the full height kept, the bites taken off the top and the darkening, per damage state. */
const BITES={inteira:{keep:1,bites:0,depth:0,jag:0,shade:1},avariada:{keep:.8,bites:2,depth:.3,jag:.035,shade:.86},'quase-caindo':{keep:.52,bites:3,depth:.2,jag:.05,shade:.72}};

/** Small deterministic generator (mulberry32) seeded by a name. */
export function rngOf(name){
  let a=parseInt(sha256(name).slice(0,8),16)>>>0;
  return ()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
/**
 * Height kept above the ground at each source x (px) for `state` of piece `id`: the top cut lower by the state's share,
 * a few smooth bites and some jag. Whole: Infinity (nothing cut).
 */
export function keepProfile(id,state,width,height){
  const b=BITES[state];
  if(!b||b.keep>=1)return new Float32Array(width).fill(Infinity);
  const rnd=rngOf(`${id}:${state}`),bites=Array.from({length:b.bites},()=>({at:width*(.15+.7*rnd()),w:50+60*rnd(),d:b.depth*(.6+.4*rnd())}));
  const f1=.02+.02*rnd(),f2=.07+.05*rnd(),p1=rnd()*6.3,p2=rnd()*6.3,out=new Float32Array(width);
  for(let x=0;x<width;x++){
    let frac=b.keep+b.jag*(Math.sin(x*f1+p1)*.6+Math.sin(x*f2+p2)*.4);
    for(const t of bites)frac-=t.d*Math.exp(-(((x-t.at)/t.w)**2));
    out[x]=Math.max(.15,frac)*height;
  }
  return out;
}
/**
 * Applies a damage state to an RGBA buffer (source px, in place): pixels higher above the local ground (a line through
 * the box's ground centre, `slope` px down per px right… the wall rises to the right) than the profile are cleared, the
 * rest darkened by the state's shade and a darker rim under the cut (it reads as broken, not as a lower wall).
 */
export function bakeDamage(data,width,height,{id,state,center,kind}){
  const b=BITES[state];if(!b||b.keep>=1)return data;
  const keep=keepProfile(id,state,width,kind.height),[cx,cy]=center,rim=10;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;if(data[i+3]===0)continue;
    const above=cy+kind.lift-(x-cx)*kind.slope-y;
    if(above>keep[x]){data[i+3]=0;continue;}
    const s=b.shade*(keep[x]-above<rim?.62:1);
    data[i]=Math.round(data[i]*s);data[i+1]=Math.round(data[i+1]*s);data[i+2]=Math.round(data[i+2]*s);
  }
  return dropFloating(data,width,height);
}
/**
 * Clears what the cut left floating (pilar-2's slippers hang from the umbrella): only pixels connected (8-way, alpha
 * over 8) to the lowest rows of the piece stay.
 */
export function dropFloating(data,width,height,base=24){
  let bottom=-1;
  for(let i=data.length-1;i>=3&&bottom<0;i-=4)if(data[i]>8)bottom=Math.floor((i>>2)/width);
  if(bottom<0)return data;
  const seen=new Uint8Array(width*height),stack=[];
  for(let y=Math.max(0,bottom-base);y<=bottom;y++)for(let x=0;x<width;x++){const p=y*width+x;if(data[p*4+3]>8){seen[p]=1;stack.push(p);}}
  while(stack.length){
    const p=stack.pop(),x=p%width,y=(p-x)/width;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=width||ny>=height)continue;
      const q=ny*width+nx;if(!seen[q]&&data[q*4+3]>8){seen[q]=1;stack.push(q);}
    }
  }
  for(let p=0;p<width*height;p++)if(!seen[p])data[p*4+3]=0;
  return data;
}

/** Row names of a sheet: `<piece>:<state>`, pieces in order, states in DAMAGE order. */
export const sheetRows=ids=>ids.flatMap(id=>DAMAGE.map(s=>`${id}:${s}`));
/** Art px across one build cell along the wall in the sheet (the cell scaled with the window). */
export const celulaOf=kind=>SOURCE_CELL*kind.cell[0]/(2*kind.window.left);

async function main(){
  const require=createRequire(join(ROOT,'package.json')),sharp=require('sharp');
  const {GROUPS}=await import(pathToFileURL(join(ROOT,'scripts/art-v2/spec.mjs')).href);
  const {writeIndex}=await import(pathToFileURL(join(ROOT,'scripts/art-v2/convert.mjs')).href);
  const args=process.argv.slice(2),srcAt=args.indexOf('--src');
  const SRC=srcAt>=0?args[srcAt+1]:'D:/Gits/viagem-board/arte-entrada/cenario/base/muralha-tralha';
  const spec=GROUPS.base,dir=join(ROOT,spec.output),manifestFile=join(dir,'manifest.json');
  const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
  for(const [name,kind] of Object.entries(KINDS)){
    const {left,up,down}=kind.window,ww=2*left,wh=up+down,[cw,ch]=kind.cell,frames=[];
    for(const id of kind.ids){
      const src=await sharp(join(SRC,`${id}-t.png`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      if(src.info.width!==1536||src.info.height!==1024)throw new Error(`${id}: ${src.info.width}×${src.info.height}, esperado 1536×1024 (o quadro do molde)`);
      for(const state of DAMAGE){
        const data=Buffer.from(src.data);
        bakeDamage(data,src.info.width,src.info.height,{id,state,center:kind.center,kind});
        const cut=sharp(data,{raw:{width:src.info.width,height:src.info.height,channels:4}})
          .extract({left:kind.center[0]-left,top:kind.center[1]-up,width:ww,height:wh});
        const cell=await sharp(await cut.png().toBuffer()).resize(cw,ch,{fit:'fill',kernel:'lanczos3'}).raw().toBuffer();
        frames.push(cell,await sharp(cell,{raw:{width:cw,height:ch,channels:4}}).flop().raw().toBuffer());
      }
    }
    const cols=kind.columns,rows=Math.ceil(frames.length/cols),sheet=Buffer.alloc(cols*cw*rows*ch*4);
    frames.forEach((f,n)=>{
      const fx=(n%cols)*cw,fy=Math.floor(n/cols)*ch;
      for(let y=0;y<ch;y++)f.copy(sheet,((fy+y)*cols*cw+fx)*4,y*cw*4,(y+1)*cw*4);
    });
    const file=`${kind.piece}.webp`,webp=await sharp(sheet,{raw:{width:cols*cw,height:rows*ch,channels:4}}).webp({lossless:true,effort:6}).toBuffer();
    writeFileSync(join(dir,file),webp);
    const hash=sha256(webp),rowNames=sheetRows(kind.ids);
    const entry={file,cell:[cw,ch],views:2,rows:rowNames,anchor:[.5,+(up/wh).toFixed(6)],
      pages:[{file,columns:cols,rows,firstFrame:0,frameCount:frames.length,sha256:hash}],sha256:hash};
    manifest.pieces[kind.piece]={kind:'views',files:{sheet:entry},sha256:sha256(`sheet ${hash}`),
      meta:{pecas:kind.ids,estados:DAMAGE,celula:+celulaOf(kind).toFixed(4),
        origem:`arte-entrada/cenario/base/muralha-tralha (${name}, E3, card muralha-tralha-arte); dano assado por scripts/import-muralha-tralha.mjs`}};
    console.error(`${kind.piece}: ${frames.length} frames ${cw}×${ch}, ${cols}×${rows}, ${Math.round(webp.length/1024)} KB`);
  }
  manifest.pieces=Object.fromEntries(Object.keys(manifest.pieces).sort().map(k=>[k,manifest.pieces[k]]));
  writeFileSync(manifestFile,`${JSON.stringify(manifest,null,2)}\n`);
  await writeIndex({base:spec},{outRoot:ROOT});
  console.error('manifest e índice gravados; agora: node scripts/art-lite.mjs --kinds city');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
