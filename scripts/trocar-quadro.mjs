#!/usr/bin/env node
/**
 * Troca um quadro de uma folha de inimigo (card NEW-20261023-E4-inimigos-tremor-arte-nova): o que o medidor
 * (scripts/medir-tremor.mjs) marca como arte nova e o corretor não conserta. Ou o quadro vira cópia de um vizinho
 * (--de <quadro>, também nas camadas elite/ da animação: a coroa acompanha), ou recebe um desenho novo (--png
 * <célula.png>, já do tamanho da célula, pé no pivô; --sombrear passa a pseudo-sombra nela, com a força do carimbo), ou
 * é movido/escalado em torno do pé (--mover dx,dy,escala: a `correcao` que o medidor sugere para o quadro de arte nova).
 *
 *   node scripts/trocar-quadro.mjs <id> <anim> <dir 0-7> <quadro> (--de <quadro> | --png <arquivo> [--sombrear] | --mover dx,dy,s)
 *
 * Grava no lugar em public/art/enemies e acerta, como o corretor, o sha256 de página/arquivo/peça no manifest dela,
 * o carimbo da pseudo-sombra (a folha já sombreada continua carimbada: rodar a sombra de novo não escurece duas vezes)
 * e o do tremor. Depois: node scripts/art-lite.mjs --kinds enemies.
 */
import sharp from 'sharp';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LOSSLESS,camadasDe,moverCelula} from './corrigir-tremor.mjs';
import {medirQuadro} from './medir-tremor.mjs';
import {shadeCell} from './pseudo-sombra.mjs';

const sha256=b=>createHash('sha256').update(b).digest('hex');
const paginas=f=>f.pages??[{file:f.file,columns:f.frames??1,rows:f.directions??1,firstFrame:0,frameCount:(f.frames??1)*(f.directions??1)}];

/** Onde está o quadro global g de um arquivo: página e canto da célula. */
function lugar(file,g){
  const [w,h]=file.cell;
  for(const p of paginas(file))if(g>=p.firstFrame&&g<p.firstFrame+p.frameCount){
    const i=g-p.firstFrame;return {p,x:(i%p.columns)*w,y:Math.floor(i/p.columns)*h};
  }
  throw new Error(`quadro ${g} fora das páginas de ${file.file}`);
}

/** Copia a célula `de` para `para` (mesma direção) ou põe `cel` (RGBA w×h) em `para`. Devolve as páginas regravadas. */
export async function trocarCelula(dirArte,file,dir,para,{de,cel}){
  const [w,h]=file.cell,frames=file.frames??1,alvo=lugar(file,dir*frames+para);
  const caminho=join(dirArte,alvo.p.file);
  const {data,info}=await sharp(readFileSync(caminho)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const leitura=de==null?null:lugar(file,dir*frames+de);
  let fonte=cel;
  if(leitura){
    const src=leitura.p.file===alvo.p.file?{data,info}:await sharp(readFileSync(join(dirArte,leitura.p.file))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    fonte=Buffer.alloc(w*h*4);
    for(let y=0;y<h;y++)src.data.copy(fonte,y*w*4,((leitura.y+y)*src.info.width+leitura.x)*4,((leitura.y+y)*src.info.width+leitura.x+w)*4);
  }
  for(let y=0;y<h;y++)fonte.copy(data,((alvo.y+y)*info.width+alvo.x)*4,y*w*4,(y+1)*w*4);
  writeFileSync(caminho,await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).webp(LOSSLESS).toBuffer());
  return [alvo.p.file];
}

/** Célula nova de um PNG (redimensionada para a célula se vier maior, sem mexer na proporção). */
async function celulaDoPng(arquivo,[w,h],sombrear,forca){
  const {data,info}=await sharp(readFileSync(arquivo)).ensureAlpha().resize(w,h,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).raw().toBuffer({resolveWithObject:true});
  if(info.width!==w||info.height!==h)throw new Error(`célula ${info.width}x${info.height}, esperada ${w}x${h}`);
  if(sombrear)shadeCell(data,w,0,0,w,h,forca);
  return data;
}

async function main(){
  const args=process.argv.slice(2),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:undefined;};
  const [id,anim,dirS,quadroS]=args;
  if(!quadroS||(opt('--de')==null&&!opt('--png')&&!opt('--mover')))throw new Error('uso: trocar-quadro.mjs <id> <anim> <dir> <quadro> (--de <quadro> | --png <arquivo> [--sombrear] | --mover dx,dy,s)');
  const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const g=JSON.parse(readFileSync(join(repo,'public/art/manifest.json'),'utf8')).groups.inimigos,dirArte=join(repo,g.output);
  const peca=g.pieces[id],file=peca?.files?.[anim];if(!file)throw new Error(`sem ${id}/${anim}`);
  const MAN=join(dirArte,'manifest.json'),SOMBRA=join(dirArte,'pseudo-sombra.json'),CARIMBO=join(dirArte,'tremor.json');
  const man=JSON.parse(readFileSync(MAN,'utf8')),sombra=existsSync(SOMBRA)?JSON.parse(readFileSync(SOMBRA,'utf8')):null;
  const carimbo=existsSync(CARIMBO)?JSON.parse(readFileSync(CARIMBO,'utf8')):{files:{}};
  const dir=+dirS,para=+quadroS,de=opt('--de')==null?null:+opt('--de');
  let cel=opt('--png')?await celulaDoPng(opt('--png'),file.cell,args.includes('--sombrear'),sombra?.forca??3):null;
  if(opt('--mover')){
    // Como o corretor: escala em torno do pé (cx, base) e desloca. A camada elite/ não segue (só vale para --de).
    const [dx,dy,sc]=opt('--mover').split(',').map(Number),[w,h]=file.cell,{p,x,y}=lugar(file,+dirS*(file.frames??1)+(+quadroS));
    const {data,info}=await sharp(readFileSync(join(dirArte,p.file))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const atual=Buffer.alloc(w*h*4);for(let k=0;k<h;k++)data.copy(atual,k*w*4,((y+k)*info.width+x)*4,((y+k)*info.width+x+w)*4);
    const q=medirQuadro(atual,w,0,0,w,h);
    cel=await moverCelula(atual,w,h,{dx,dy:Math.round(dy),s:sc},q.cx,q.base);
  }
  const mexidas=await trocarCelula(dirArte,file,dir,para,{de,cel});
  // As camadas elite/ só seguem uma cópia de vizinho; um desenho novo não tem coroa desenhada para ele.
  if(de!=null){for(const cam of camadasDe(peca,anim))if((cam.frames??1)===(file.frames??1))mexidas.push(...await trocarCelula(dirArte,cam,dir,para,{de}));}
  else if(camadasDe(peca,anim).length)console.warn(`aviso: ${id}/${anim} tem camadas elite/ que ficaram com o quadro antigo`);
  const mp=man.pieces[id];
  for(const f of Object.values(mp.files)){
    const pgs=paginas(f);
    for(const p of pgs){
      if(!existsSync(join(dirArte,p.file)))continue;
      const h=sha256(readFileSync(join(dirArte,p.file)));if(p.sha256===h)continue;p.sha256=h;
      if(sombra?.files[p.file])sombra.files[p.file]=h;
      if(carimbo.files[p.file])carimbo.files[p.file]=h;
    }
    if(f.pages&&pgs.every(p=>p.sha256))f.sha256=pgs.length===1?pgs[0].sha256:sha256(pgs.map(p=>`${p.file} ${p.sha256}`).join('\n'));
  }
  mp.sha256=sha256(Object.entries(mp.files).map(([k,f])=>`${k} ${f.sha256}`).sort().join('\n'));
  writeFileSync(MAN,`${JSON.stringify(man,null,2)}\n`);
  if(sombra)writeFileSync(SOMBRA,`${JSON.stringify({...sombra,files:Object.fromEntries(Object.entries(sombra.files).sort())},null,1)}\n`);
  writeFileSync(CARIMBO,`${JSON.stringify({files:Object.fromEntries(Object.entries(carimbo.files).sort())},null,1)}\n`);
  console.log(`${id} ${anim} d${dir} q${para} ← ${de!=null?`q${de}`:opt('--png')??`mover ${opt('--mover')}`} (${[...new Set(mexidas)].join(', ')})`);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
