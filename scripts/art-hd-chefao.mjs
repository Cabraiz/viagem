#!/usr/bin/env node
/**
 * Card NEW-20261023-ORQ-boss-fim-onda-1, etapa 6 (the user, 24/10: "Hd no PC, mas semi hd no celular"): the 1st wave's
 * chefão drawn 3× (rules WAVE_BOSS.drawScale) stretches his 384 px cell ~3× on a computer and blurs. AI upscale
 * (Real-ESRGAN, realesr-animevideov3 ×2, D:/Gits/ferramentas/realesrgan) of the sheets he spends the fight in
 * (HD_ANIMS: idle, walk, slam) of the four WAVE_BOSSES, from the approved files (public/art/enemies/<id>/):
 *   - computer: the ×2 cell (768 px), pages ≤ 8192 px a side, at public/art/hd/enemies/<id>/pc/;
 *   - phone ("semi-HD", between the 384 sheet and the HD): the ×2 cell scaled to 512 px (Lanczos), pages ≤ 4096 px a
 *     side (the slam's 80 frames need two), at public/art/hd/enemies/<id>/celular/.
 * Pages hold the frames in reading order, direction-major (art/manifest.ts ArtPage), hdLayout below (the client's
 * twin: art/manifest.ts hdLayout, which parseArtIndex swaps in); the record (cells, pages, bytes) is scripts/art-hd-chefao.json.
 * The other files (charge, hit, death, summon, phase2-idle) keep the approved 384 sheet on both screens.
 *
 *   node scripts/art-hd-chefao.mjs           make every file (≈ 3 s of GPU per sheet; the PC's heavy slot)
 *   node scripts/art-hd-chefao.mjs --check   exit 1 when the table or a file is missing or does not match the layout
 */
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
export const HD_IDS=['o-grande-credor','dj-do-fim-do-mundo','mapinguari-do-shopping','boitata-de-sacolinha'];
export const HD_ANIMS=['idle','walk','slam'];
/** Cell and page side per screen: the computer's ×2 (8192 px pages), the phone's semi-HD (4096 px pages). */
export const HD_SCREENS={pc:{cell:768,maxSide:8192},celular:{cell:512,maxSide:4096}};
export const HD_TABLE='scripts/art-hd-chefao.json';
const REALESRGAN=process.env.REALESRGAN??'D:/Gits/ferramentas/realesrgan/realesrgan-ncnn-vulkan.exe';
/** Same lossy settings as the game's other copies (scripts/art-lite.mjs WEBP): colour at 90, exact alpha. */
const WEBP={quality:90,alphaQuality:100,effort:4,smartSubsample:true};

/**
 * Pages of `total` frames of a `cell` px square cell within `maxSide` px: as many columns as fit (never more than the
 * frames), rows up to what fits, the last page only as tall as its frames need. Files `<id>/<screen>/<anim>.webp`, or
 * `-p1`, `-p2`… when it takes more than one.
 */
export function hdLayout(id,anim,screen,total,cell,maxSide){
  const fit=Math.floor(maxSide/cell),columns=Math.min(total,fit),perPage=columns*fit,count=Math.ceil(total/perPage),pages=[];
  for(let i=0;i<count;i++){
    const firstFrame=i*perPage,frameCount=Math.min(perPage,total-firstFrame);
    pages.push({file:`${id}/${screen}/${anim}${count>1?`-p${i+1}`:''}.webp`,columns,rows:Math.ceil(frameCount/columns),firstFrame,frameCount});
  }
  return pages;
}

const sourceFile=(manifest,id,anim)=>{
  const f=manifest.groups.inimigos.pieces[id]?.files[anim];
  if(!f)throw new Error(`${id}/${anim}: sem o arquivo no manifesto`);
  return f;
};

async function make(){
  const sharp=(await import('sharp')).default;
  const manifest=JSON.parse(readFileSync(join(ROOT,'public/art/manifest.json'),'utf8'));
  // The frames and their ×2 stay in a work folder across runs (a run the GPU dropped resumes where it stood); removed once
  // every file is written.
  const work=process.env.HD_WORK??join(tmpdir(),'hd-chefao-work'),table={version:1,anims:HD_ANIMS,screens:HD_SCREENS,pieces:{}};
  mkdirSync(work,{recursive:true});
  {
    for(const id of HD_IDS){
      table.pieces[id]={};
      for(const anim of HD_ANIMS){
        const src=sourceFile(manifest,id,anim),[cw,ch]=src.cell,frames=src.frames??1,dirs=src.directions??1,total=frames*dirs;
        const inDir=join(work,`${id}-${anim}-in`),outDir=join(work,`${id}-${anim}-x2`),cells=[],name=k=>`${String(k).padStart(3,'0')}.png`;
        mkdirSync(inDir,{recursive:true});mkdirSync(outDir,{recursive:true});
        for(const page of src.pages??[{file:src.file,columns:frames,rows:dirs,firstFrame:0,frameCount:total}]){
          const sheet=await sharp(join(ROOT,'public/art/enemies',page.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
          for(let k=0;k<page.frameCount;k++){
            const c=k%page.columns,r=Math.floor(k/page.columns),file=join(inDir,name(page.firstFrame+k));
            if(!existsSync(file))await sharp(sheet.data,{raw:sheet.info}).extract({left:c*cw,top:r*ch,width:cw,height:ch}).png().toFile(file);
          }
        }
        await upscale(sharp,inDir,outDir,total,name,cw*2,ch*2,`${id}/${anim}`);
        for(let k=0;k<total;k++)cells.push((await sharp(join(outDir,name(k))).ensureAlpha().raw().toBuffer()));
        if(cells.length!==total)throw new Error(`${id}/${anim}: ${cells.length} quadros, esperava ${total}`);
        const entry={};
        for(const [screen,{cell,maxSide}] of Object.entries(HD_SCREENS)){
          const pages=hdLayout(id,anim,screen,total,cell,maxSide),sized=[];
          for(const buf of cells)sized.push(cell===cw*2?buf:await sharp(buf,{raw:{width:cw*2,height:ch*2,channels:4}})
            .resize(cell,cell,{kernel:'lanczos3',fit:'fill'}).raw().toBuffer());
          const bytes=[];
          for(const page of pages){
            const composite=[];
            for(let k=0;k<page.frameCount;k++)composite.push({input:sized[page.firstFrame+k],raw:{width:cell,height:cell,channels:4},
              left:(k%page.columns)*cell,top:Math.floor(k/page.columns)*cell});
            const out=join(ROOT,'public/art/hd/enemies',page.file);mkdirSync(dirname(out),{recursive:true});
            await sharp({create:{width:page.columns*cell,height:page.rows*cell,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
              .composite(composite).webp(WEBP).toFile(out);
            bytes.push(statSync(out).size);
          }
          entry[screen]={cell:[cell,cell],pages,bytes};
        }
        table.pieces[id][anim]=entry;
        console.log(`${id}/${anim}: pc ${entry.pc.pages.length} pág ${(entry.pc.bytes.reduce((a,b)=>a+b,0)/1e6).toFixed(2)} MB · celular ${entry.celular.pages.length} pág ${(entry.celular.bytes.reduce((a,b)=>a+b,0)/1e6).toFixed(2)} MB`);
      }
    }
  }
  writeFileSync(join(ROOT,HD_TABLE),JSON.stringify(table,null,1)+'\n');
  rmSync(work,{recursive:true,force:true});
}

/** A ×2 frame is done when it has the size and some alpha (a dropped GPU writes an empty image). */
async function upscaled(sharp,file,w,h){
  if(!existsSync(file))return false;
  try{
    const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    if(info.width!==w||info.height!==h)return false;
    for(let i=3;i<data.length;i+=4)if(data[i])return true;
  }catch{}
  return false;
}
/**
 * Every frame of `inDir` ×2 into `outDir`, BATCH frames per GPU run (a whole sheet, ≥ 3072 px, loses the GTX 1650:
 * vkQueueSubmit -4 and an empty output; a long run sometimes hangs at 0 % GPU). A run gets RUN_MS, then it is killed and
 * the frames still missing go again, up to TRIES times.
 */
const BATCH=8,RUN_MS=120_000,TRIES=4;
async function upscale(sharp,inDir,outDir,total,name,w,h,label){
  for(let tries=0;;tries++){
    const missing=[];
    for(let k=0;k<total;k++)if(!(await upscaled(sharp,join(outDir,name(k)),w,h)))missing.push(k);
    if(!missing.length)return;
    if(tries>=TRIES)throw new Error(`${label}: ${missing.length} quadros sem ×2 depois de ${TRIES} tentativas (GPU?)`);
    if(tries)console.log(`${label}: ${missing.length} quadros de novo (tentativa ${tries+1})`);
    for(let i=0;i<missing.length;i+=BATCH){
      const batch=join(dirname(inDir),'lote');rmSync(batch,{recursive:true,force:true});mkdirSync(batch);
      for(const k of missing.slice(i,i+BATCH))copyFileSync(join(inDir,name(k)),join(batch,name(k)));
      try{execFileSync(REALESRGAN,['-i',batch,'-o',outDir,'-n','realesr-animevideov3','-s','2','-t','128','-f','png'],
        {stdio:'ignore',cwd:dirname(REALESRGAN),timeout:RUN_MS,killSignal:'SIGKILL'});}
      catch(e){console.log(`${label}: o Real-ESRGAN parou (${e.code??e.signal??e.status}); sigo`);}
    }
  }
}

/** Problems of the table and the files against the manifest and hdLayout ([] when everything matches). */
export function checkHd(root=ROOT){
  const problems=[],path=join(root,HD_TABLE);
  if(!existsSync(path))return [`${HD_TABLE} não existe: rode node scripts/art-hd-chefao.mjs`];
  const table=JSON.parse(readFileSync(path,'utf8')),manifest=JSON.parse(readFileSync(join(root,'public/art/manifest.json'),'utf8'));
  for(const id of HD_IDS)for(const anim of HD_ANIMS){
    const src=sourceFile(manifest,id,anim),total=(src.frames??1)*(src.directions??1);
    for(const [screen,{cell,maxSide}] of Object.entries(HD_SCREENS)){
      const e=table.pieces?.[id]?.[anim]?.[screen];
      if(!e){problems.push(`${id}/${anim}/${screen}: fora da tabela`);continue;}
      if(JSON.stringify(e.pages)!==JSON.stringify(hdLayout(id,anim,screen,total,cell,maxSide))||e.cell?.[0]!==cell)problems.push(`${id}/${anim}/${screen}: páginas fora do layout`);
      for(const p of e.pages??[])if(!existsSync(join(root,'public/art/hd/enemies',p.file)))problems.push(`${p.file}: arquivo faltando`);
    }
  }
  return problems;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  if(process.argv.includes('--check')){const p=checkHd();for(const l of p)console.error(l);process.exit(p.length?1:0);}
  else await make();
}
