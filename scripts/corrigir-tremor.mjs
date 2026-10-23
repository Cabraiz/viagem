#!/usr/bin/env node
/**
 * Corretor de tremor por quadro (NEW-20261023-ORQ-inimigos-tremor-quadros, etapa 3). Lê os achados do medidor
 * (scripts/medir-tremor.mjs) e realinha só os quadros de tipo desalinhamento: escala em torno do pé (cx, base) e
 * desloca até o lugar dos vizinhos. Arte nova fica de fora (precisa redesenhar).
 *
 *   node scripts/corrigir-tremor.mjs --saida <dir> [--ids a,b] [--acoes] [--json relatorio.json]
 *
 * Cada eixo só se a medida dele foi marcada: dx por cx/pex, dy por pe/cy, escala por altura/escala. O alvo é a média
 * dos dois vizinhos (o balanço natural do andar fica; só o quadro fora do ciclo volta). Ações (golpe, morte, batida)
 * têm movimento de verdade: com --acoes, só entra o pico isolado — os dois vizinhos concordam entre si e o quadro foge
 * dos dois para o mesmo lado. Sem --acoes, só loops. Grava as folhas corrigidas em <dir>, com o mesmo caminho relativo.
 */
import sharp from 'sharp';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {medirFolha,achadosDaFolha,ehLoop,LIMITE} from './medir-tremor.mjs';

// pex (centro dos pés no parado) não move nada: com o corpo no lugar, pé que muda é pose (o grandão aprovado tem).
const EIXO={cx:'x',pe:'y',cy:'y',altura:'s',escala:'s'};

/** Quadros a corrigir de uma folha: Map "dir|quadro" → conjunto de eixos marcados. */
export function marcados(achados,id,anim){
  const out=new Map();
  for(const a of achados){
    if((id&&a.inimigo!==id)||a.anim!==anim||a.tipo!=='desalinhamento'||!EIXO[a.medida])continue;
    const k=`${a.dir}|${a.quadro}`;if(!out.has(k))out.set(k,{dir:a.dir,quadro:a.quadro,eixos:new Set(),escala:a.correcao?.escala??1});
    out.get(k).eixos.add(EIXO[a.medida]);
  }
  return [...out.values()];
}

/**
 * Correção de um quadro contra os vizinhos (medidas da sequência): {dx, dy, s} em px da célula, ou null quando é ação e
 * o quadro não é pico isolado. `celula` escala os limites (definidos numa célula de 128).
 */
export function correcaoQuadro(qs,i,anim,eixos,escala,celula=128){
  const n=qs.length,loop=ehLoop(anim),q=qs[i];
  const a=qs[i>0?i-1:loop?n-1:-1],b=qs[i<n-1?i+1:loop?0:-1];
  if(!q||!a||!b)return null;
  const k=celula/128;
  // Pico isolado: vizinhos parecidos entre si e o quadro foge dos dois do mesmo lado.
  const pico=(c,lim)=>Math.abs(a[c]-b[c])<=lim&&Math.sign(q[c]-a[c])===Math.sign(q[c]-b[c]);
  if(!loop){
    if(eixos.has('x')&&!pico('cx',LIMITE.cx*k))eixos.delete('x');
    if(eixos.has('y')&&!pico('base',LIMITE.pe*k)&&!pico('cy',LIMITE.cy*k))eixos.delete('y');
    if(eixos.has('s')&&!pico('altura',LIMITE.altura*q.altura))eixos.delete('s');
    if(!eixos.size)return null;
  }
  // Escala só a que o medidor achou casando a silhueta com um vizinho (a altura engana: braço levantado, corpo deitado).
  const s=eixos.has('s')&&Math.abs(escala-1)>=.02?escala:1;
  return {
    dx:eixos.has('x')?(a.cx+b.cx)/2-q.cx:0,
    dy:eixos.has('y')?Math.round((a.base+b.base)/2-q.base):0,
    s:+s.toFixed(3),
  };
}

/** Uma célula RGBA (w×h) escalada por s em torno de (ax, ay) e levada a (ax+dx, ay+dy). */
export async function moverCelula(cel,w,h,{dx,dy,s},ax,ay){
  let img=sharp(cel,{raw:{width:w,height:h,channels:4}}),ox=ax,oy=ay,sw=w,sh=h;
  if(Math.abs(s-1)>.002){sw=Math.max(1,Math.round(w*s));sh=Math.max(1,Math.round(h*s));img=img.resize(sw,sh,{kernel:'lanczos3'});ox=ax*sw/w;oy=ay*sh/h;}
  const src=await img.raw().toBuffer(),out=Buffer.alloc(w*h*4);
  const offX=Math.round(ax+dx-ox),offY=Math.round(ay+dy-oy);
  for(let y=0;y<h;y++){const sy=y-offY;if(sy<0||sy>=sh)continue;
    for(let x=0;x<w;x++){const sx=x-offX;if(sx<0||sx>=sw)continue;src.copy(out,(y*w+x)*4,(sy*sw+sx)*4,(sy*sw+sx)*4+4);}}
  return out;
}

/** Páginas de uma folha (as antigas, sem `pages`, são uma página só). */
const paginas=file=>{const f=Math.max(1,file.frames??1),d=Math.max(1,file.directions??1);
  return file.pages??[{file:file.file,columns:f,rows:d,firstFrame:0,frameCount:f*d}];};

/** Aplica o plano (quadro global → {c, âncora}) às páginas de `file`, de `dirIn` para `saida`; âncora e deslocamento
 * escalam pela célula (as camadas elite/ podem ter outra célula que a base). Devolve as páginas regravadas. */
async function aplicarPlano(dirIn,saida,file,plano,celBase){
  const [w,h]=file.cell,k=w/celBase,gravadas=[];
  for(const p of paginas(file)){
    const dst=join(saida,p.file);mkdirSync(dirname(dst),{recursive:true});
    const alvos=[...plano.keys()].filter(g=>g>=p.firstFrame&&g<p.firstFrame+p.frameCount);
    if(!alvos.length){if(resolve(dirIn,p.file)!==resolve(dst))copyFileSync(join(dirIn,p.file),dst);continue;}
    // Do buffer: na 2ª passada a entrada e a saída são o mesmo arquivo (o Windows não deixa regravar o aberto).
    const {data,info}=await sharp(readFileSync(join(dirIn,p.file))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(const g of alvos){
      const i=g-p.firstFrame,x0=(i%p.columns)*w,y0=Math.floor(i/p.columns)*h,{c,ax,ay}=plano.get(g);
      if((x0+w)>info.width||(y0+h)>info.height)continue;
      const cel=Buffer.alloc(w*h*4);
      for(let y=0;y<h;y++)data.copy(cel,y*w*4,((y0+y)*info.width+x0)*4,((y0+y)*info.width+x0+w)*4);
      const novo=await moverCelula(cel,w,h,{dx:c.dx*k,dy:Math.round(c.dy*k),s:c.s},ax*k,ay*k);
      for(let y=0;y<h;y++)novo.copy(data,((y0+y)*info.width+x0)*4,y*w*4,(y+1)*w*4);
    }
    await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).webp(LOSSLESS).toFile(dst);
    gravadas.push(p.file);
  }
  return gravadas;
}

/** O mesmo da importação art-v2 (scripts/art-v2/convert.mjs) e da pseudo-sombra. */
export const LOSSLESS=Object.freeze({lossless:true,effort:6});

/**
 * Corrige uma folha e grava em `saida` (as `camadas`, elite/ da mesma animação, levam a mesma correção: a coroa
 * acompanha o corpo). Devolve os quadros mexidos e as páginas regravadas.
 */
export async function corrigirFolha(dirArte,saida,file,anim,lista,camadas=[]){
  const [,h]=file.cell,frames=Math.max(1,file.frames??1);
  const medidas=await medirFolha(dirArte,file),feitos=[],plano=new Map();
  for(const m of lista){
    const q=medidas[m.dir]?.[m.quadro],c=correcaoQuadro(medidas[m.dir],m.quadro,anim,new Set(m.eixos),m.escala,h);
    if(q&&c&&(Math.abs(c.dx)>=.5||c.dy||c.s!==1)){
      plano.set(m.dir*frames+m.quadro,{c,ax:q.cx,ay:q.base});
      feitos.push({dir:m.dir,quadro:m.quadro,eixos:[...m.eixos],...c,dx:+c.dx.toFixed(1)});
    }
  }
  if(!plano.size)return {feitos,paginas:[]};
  const gravadas=await aplicarPlano(dirArte,saida,file,plano,file.cell[0]);
  for(const cam of camadas){
    // A camada da 2ª passada em diante já está na saída.
    const dirCam=existsSync(join(saida,paginas(cam)[0].file))?saida:dirArte;
    if((cam.frames??1)===frames&&(cam.directions??1)===(file.directions??1))gravadas.push(...await aplicarPlano(dirCam,saida,cam,plano,file.cell[0]));
  }
  return {feitos,paginas:gravadas};
}

/** Passadas: um pico grande esconde o menor da mesma sequência (a mediana do resto sobe); remedir e corrigir de novo. */
export const PASSADAS=3;

/** Corrige uma folha em até PASSADAS rodadas (a 1ª com os achados do relatório, as outras remedindo a saída). */
export async function corrigirFolhaIterando(dirArte,saida,file,anim,lista,camadas=[]){
  const feitos=[],gravadas=new Set();let dir=dirArte;
  for(let p=0;p<PASSADAS&&lista.length;p++){
    const r=await corrigirFolha(dir,saida,file,anim,lista,camadas);
    if(!r.feitos.length)break;
    feitos.push(...r.feitos.map(x=>({...x,passada:p+1})));r.paginas.forEach(x=>gravadas.add(x));dir=saida;
    lista=marcados((await achadosDaFolha(saida,file,anim)).achados,null,anim);
  }
  return {feitos,paginas:[...gravadas]};
}

const sha256=b=>createHash('sha256').update(b).digest('hex');
/** Camadas elite/ de uma animação: elite/<anim> e as fantasias elite/<variante>-<anim>. */
export const camadasDe=(peca,anim)=>Object.entries(peca.files??{}).filter(([k])=>k===`elite/${anim}`||(k.startsWith('elite/')&&k.endsWith(`-${anim}`))).map(([,f])=>f);

/**
 * No lugar (sem --saida): grava em public/art/enemies e acerta o sha256 de página, arquivo e peça no manifest dele
 * (as regras de scripts/pseudo-sombra.mjs), o carimbo da pseudo-sombra (senão ela sombrearia de novo) e o próprio
 * carimbo, public/art/enemies/tremor.json: folha carimbada com o sha atual não é corrigida de novo com um relatório velho.
 */
async function main(){
  const args=process.argv.slice(2),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:undefined;};
  const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const g=JSON.parse(readFileSync(join(repo,'public/art/manifest.json'),'utf8')).groups.inimigos,dirArte=join(repo,g.output);
  const noLugar=!opt('--saida'),saida=resolve(opt('--saida')??dirArte),ids=opt('--ids')?.split(','),acoes=args.includes('--acoes');
  const {achados}=JSON.parse(readFileSync(opt('--json')??join(repo,'evidence/tremor/relatorio.json'),'utf8'));
  const MAN=join(dirArte,'manifest.json'),SOMBRA=join(dirArte,'pseudo-sombra.json'),CARIMBO=join(dirArte,'tremor.json');
  const man=noLugar?JSON.parse(readFileSync(MAN,'utf8')):null,sombra=noLugar&&existsSync(SOMBRA)?JSON.parse(readFileSync(SOMBRA,'utf8')):null;
  const carimbo=noLugar&&existsSync(CARIMBO)?JSON.parse(readFileSync(CARIMBO,'utf8')):{files:{}};
  const gravar=()=>{
    writeFileSync(MAN,`${JSON.stringify(man,null,2)}\n`);
    if(sombra)writeFileSync(SOMBRA,`${JSON.stringify({...sombra,files:Object.fromEntries(Object.entries(sombra.files).sort())},null,1)}\n`);
    writeFileSync(CARIMBO,`${JSON.stringify({files:Object.fromEntries(Object.entries(carimbo.files).sort())},null,1)}\n`);
  };
  let total=0,folhas=0;const t0=Date.now();
  for(const [id,peca] of Object.entries(g.pieces)){
    if(ids&&!ids.includes(id))continue;
    const mexidas=new Set();
    for(const [anim,file] of Object.entries(peca.files??{})){
      if(!Array.isArray(file.cell)||anim.includes('/'))continue;
      if(!ehLoop(anim)&&!acoes)continue;
      const lista=marcados(achados,id,anim);if(!lista.length)continue;
      if(noLugar&&paginas(file).every(p=>carimbo.files[p.file]&&carimbo.files[p.file]===sha256(readFileSync(join(dirArte,p.file)))))continue;
      const r=await corrigirFolhaIterando(dirArte,saida,file,anim,lista,camadasDe(peca,anim));
      total+=r.feitos.length;if(r.feitos.length)folhas++;r.paginas.forEach(x=>mexidas.add(x));
      for(const f of r.feitos)console.log(`${id} ${anim} d${f.dir} q${f.quadro} p${f.passada} [${f.eixos}] dx=${f.dx} dy=${f.dy} s=${f.s}`);
      // Carimbo também nas folhas sem nada a corrigir: a rodada seguinte não as remede à toa.
      if(noLugar)for(const p of paginas(file))carimbo.files[p.file]=sha256(readFileSync(join(dirArte,p.file)));
    }
    if(noLugar&&mexidas.size){
      const mp=man.pieces[id];
      for(const file of Object.values(mp.files)){
        const pgs=paginas(file);
        for(const p of pgs)if(mexidas.has(p.file)){
          const h=sha256(readFileSync(join(dirArte,p.file)));p.sha256=h;
          if(sombra?.files[p.file])sombra.files[p.file]=h;
          if(carimbo.files[p.file])carimbo.files[p.file]=h;
        }
        if(file.pages&&pgs.every(p=>p.sha256))file.sha256=pgs.length===1?pgs[0].sha256:sha256(pgs.map(p=>`${p.file} ${p.sha256}`).join('\n'));
      }
      mp.sha256=sha256(Object.entries(mp.files).map(([k,f])=>`${k} ${f.sha256}`).sort().join('\n'));
    }
    if(noLugar)gravar();
  }
  console.log(`${total} quadros corrigidos em ${folhas} folhas → ${saida} (${((Date.now()-t0)/1000).toFixed(0)} s)`);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
