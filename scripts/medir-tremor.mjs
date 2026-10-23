#!/usr/bin/env node
/**
 * Medidor de tremor por quadro das folhas de inimigo (NEW-20261023-ORQ-inimigos-tremor-quadros). Quadros que na
 * criação não foram olhados um a um fazem o inimigo "tremer": o pé sobe 2 px num quadro só, a figura encolhe 5 % e
 * volta, o corpo pula de lado. Isso não é o "andar no lugar" (a posição no mundo, corrigido em 76bffa9): é o desenho.
 *
 *   node scripts/medir-tremor.mjs [--ids a,b] [--json out.json] [--md out.md] [--top N]
 *
 * Por quadro (alfa ≥ ALFA): base (linha mais baixa = pé no chão), pex (centro entre os dois pés, na faixa de baixo),
 * topo, altura, largura, cx/cy (centroide pesado pelo alfa) e escala (raiz da área). Por sequência (inimigo × animação
 * × direção) cada medida vira uma série, e o salto é medido contra o ciclo: resíduo = valor − média dos dois vizinhos
 * (nos loops o último quadro encosta no primeiro). O pé das animações no chão também pela diferença simples (um degrau
 * de 2 px dá só 1 px de resíduo em cada ponta).
 * Tremor = um pico que passa do limite (do card: pé 1,5 px numa célula de 128, altura 3 %) E destoa da própria série
 * (≥ OUTLIER × a mediana dos resíduos dela): o balanço do andar mexe todo quadro um pouco e não conta; um quadro só
 * fora de lugar conta. Só o pico local vira achado (os vizinhos de um quadro torto também têm resíduo, metade).
 * Ações (golpe, pulo, morte) têm quadros-chave de verdade: limite × FROUXO e categoria própria no relatório.
 */
import sharp from 'sharp';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ALFA=32,PE_LINHAS=4,PE_FAIXA=.08;
/** Limites numa célula de 128 px (escalam com a célula): pé/centro em px; altura e escala em fração da mediana. */
export const LIMITE={pe:1.5,pex:2,cy:1.5,cx:2.5,altura:.03,escala:.03};
export const FROUXO=2,OUTLIER=3;
/** Loops (o último quadro encosta no primeiro): parado, andar, voo, sono. Voo não pisa o chão. */
export const ehLoop=anim=>/(^|-)(idle|walk|run|fly|sleep)$/.test(anim);
export const categoria=anim=>ehLoop(anim)?'loop':anim==='hit'?'dano':'acao';

/** Medidas de um quadro (x0,y0,w,h) de uma imagem RGBA de largura `stride`; null quando o quadro está vazio. */
export function medirQuadro(rgba,stride,x0,y0,w,h,alfa=ALFA){
  let topo=-1,base=-1,esq=w,dir=-1,soma=0,sx=0;
  for(let y=0;y<h;y++){
    let linha=false;
    for(let x=0;x<w;x++){
      const a=rgba[((y0+y)*stride+x0+x)*4+3];
      if(a<alfa)continue;
      linha=true;soma+=a;sx+=a*x;if(x<esq)esq=x;if(x>dir)dir=x;
    }
    if(linha){if(topo<0)topo=y;base=y;}
  }
  if(base<0)return null;
  // Faixa dos pés: os dois pés juntos (o mais baixo troca a cada passo; o centro entre eles não).
  let pe0=w,pe1=-1,sy=0;
  const faixa=Math.max(PE_LINHAS,Math.round((base-topo+1)*PE_FAIXA));
  for(let y=topo;y<=base;y++)for(let x=0;x<w;x++){
    const a=rgba[((y0+y)*stride+x0+x)*4+3];if(a<alfa)continue;
    sy+=a*y;if(y>base-faixa){if(x<pe0)pe0=x;if(x>pe1)pe1=x;}
  }
  return {base,pex:(pe0+pe1)/2,topo,altura:base-topo+1,largura:dir-esq+1,cx:sx/soma,cy:sy/soma,escala:Math.sqrt(soma/255)};
}

/** Resíduo de cada quadro contra a média dos vizinhos; nas pontas de uma animação sem loop, contra o único vizinho. */
export function residuos(serie,loop){
  const n=serie.length;
  return serie.map((v,i)=>{
    if(n<3)return 0;
    const a=i>0?serie[i-1]:loop?serie[n-1]:null,b=i<n-1?serie[i+1]:loop?serie[0]:null;
    if(a==null)return 0;if(b==null)return 0; // ponta sem loop: a diferença simples cobre
    return v-(a+b)/2;
  });
}
/** Diferença de cada quadro para o anterior (no loop, o quadro 0 compara com o último). */
export function saltos(serie,loop){
  const n=serie.length;
  return serie.map((v,i)=>i>0?v-serie[i-1]:loop&&n>1?v-serie[n-1]:0);
}

const mediana=v=>{const s=[...v].sort((a,b)=>a-b);return s.length?s[s.length>>1]:0;};

/**
 * Tremores de uma sequência: `quadros` = medidas (null = quadro vazio), `celula` = altura da célula. Cada achado:
 * quadro, medida, valor do pico, limite e gravidade (pico / limite).
 */
export function acharTremores(quadros,anim,celula=128){
  const loop=ehLoop(anim),cat=categoria(anim),chao=loop&&!/fly$/.test(anim);
  const k=celula/128*(cat==='acao'?FROUXO:1),out=[];
  const vazios=new Set(quadros.map((q,i)=>q?-1:i).filter(i=>i>=0));
  for(const i of vazios)out.push({quadro:i,medida:'vazio',valor:1,limite:1,gravidade:9});
  if(vazios.size===quadros.length||quadros.length<3)return out;
  const qs=quadros.map(q=>q??quadros.find(Boolean)),serie=c=>qs.map(q=>q[c]);
  const marca=(medida,vals,limite)=>{
    const n=vals.length,abs=vals.map(Math.abs);
    vals.forEach((v,i)=>{
      const av=abs[i],ant=i>0?abs[i-1]:loop?abs[n-1]:0,pro=i<n-1?abs[i+1]:loop?abs[0]:0;
      if(vazios.has(i)||av<limite||av<ant||av<pro)return;
      // O resto da série, sem o quadro e os dois vizinhos (que herdam metade do pico dele).
      const resto=abs.filter((_,j)=>(loop?Math.min(Math.abs(j-i),n-Math.abs(j-i)):Math.abs(j-i))>1);
      if(av<OUTLIER*mediana(resto))return;
      const ja=out.find(o=>o.quadro===i&&o.medida===medida),g=+(av/limite).toFixed(2);
      if(!ja)out.push({quadro:i,medida,valor:+v.toFixed(2),limite:+limite.toFixed(2),gravidade:g});
      else if(g>ja.gravidade)Object.assign(ja,{valor:+v.toFixed(2),gravidade:g});
    });
  };
  const alt=mediana(serie('altura')),esc=mediana(serie('escala'));
  marca('pe',residuos(serie('base'),loop),LIMITE.pe*k);
  if(chao)marca('pe',saltos(serie('base'),loop),LIMITE.pe*k);
  if(/idle$/.test(anim))marca('pex',residuos(serie('pex'),loop),LIMITE.pex*k);
  marca('cy',residuos(serie('cy'),loop),LIMITE.cy*k);
  marca('cx',residuos(serie('cx'),loop),LIMITE.cx*k);
  marca('altura',residuos(serie('altura'),loop),LIMITE.altura*alt*(cat==='acao'?FROUXO:1));
  marca('escala',residuos(serie('escala'),loop),LIMITE.escala*esc*(cat==='acao'?FROUXO:1));
  return out.sort((a,b)=>a.quadro-b.quadro||b.gravidade-a.gravidade);
}

/** Lê uma folha do manifest (todas as páginas) e devolve as medidas por direção: medidas[dir][quadro]. */
export async function medirFolha(dirArte,file){
  const [w,h]=file.cell,frames=Math.max(1,file.frames??1),dirs=Math.max(1,file.directions??1);
  const medidas=Array.from({length:dirs},()=>Array(frames).fill(null));
  for(const p of file.pages??[{file:file.file,columns:frames,rows:dirs,firstFrame:0,frameCount:frames*dirs}]){
    const caminho=join(dirArte,p.file);
    if(!existsSync(caminho))throw new Error(`folha ausente: ${caminho}`);
    const {data,info}=await sharp(caminho).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(let k=0;k<p.frameCount;k++){
      const g=p.firstFrame+k,d=Math.floor(g/frames),q=g%frames;
      if(d>=dirs)continue;
      const c=k%p.columns,r=Math.floor(k/p.columns);
      if((c+1)*w>info.width||(r+1)*h>info.height)continue;
      medidas[d][q]=medirQuadro(data,info.width,c*w,r*h,w,h);
    }
  }
  return medidas;
}

export const DIRECOES=['S','SW','W','NW','N','NE','E','SE'];

/** Mede o elenco inteiro (ou `ids`): lista de achados com inimigo, animação, direção e quadro, do pior ao melhor. */
export async function medirElenco(repo,{ids}={}){
  const m=JSON.parse(readFileSync(join(repo,'public/art/manifest.json'),'utf8')).groups.inimigos;
  const dirArte=join(repo,m.output),achados=[],folhas=[];
  for(const [id,peca] of Object.entries(m.pieces)){
    if(ids&&!ids.includes(id))continue;
    for(const [anim,file] of Object.entries(peca.files??{})){
      // elite/<anim> e as fantasias são camadas (coroa, aura) desenhadas sobre a base: tremem junto com ela.
      if(!Array.isArray(file.cell)||anim.includes('/'))continue;
      const medidas=await medirFolha(dirArte,file);
      folhas.push({id,anim,dirs:medidas.length,frames:medidas[0].length});
      medidas.forEach((qs,d)=>{
        for(const t of acharTremores(qs,anim,file.cell[1]))
          achados.push({inimigo:id,anim,categoria:categoria(anim),direcao:medidas.length===8?DIRECOES[d]:String(d),dir:d,...t});
      });
    }
  }
  achados.sort((a,b)=>b.gravidade-a.gravidade);
  return {folhas,achados};
}

function markdown({folhas,achados},top){
  const porInimigo=new Map();
  for(const a of achados)if(a.categoria==='loop')porInimigo.set(a.inimigo,(porInimigo.get(a.inimigo)??0)+a.gravidade);
  const rank=[...porInimigo].sort((a,b)=>b[1]-a[1]),conta=c=>achados.filter(a=>a.categoria===c).length;
  const tabela=lista=>['| inimigo | animação | direção | quadro | medida | valor | limite | gravidade |','|---|---|---|---|---|---|---|---|',
    ...lista.slice(0,top).map(a=>`| ${a.inimigo} | ${a.anim} | ${a.direcao} | ${a.quadro} | ${a.medida} | ${a.valor} | ${a.limite} | ${a.gravidade} |`)];
  return [`# Tremor por quadro — ${folhas.length} folhas, ${achados.length} achados (loop ${conta('loop')}, dano ${conta('dano')}, ação ${conta('acao')})`,'',
    'Loops (parado, andar, voo, sono) tocam o tempo todo: é onde o tremor aparece. Ações têm limite × 2.','',
    '## Inimigos — soma das gravidades nos loops','','| inimigo | soma |','|---|---|',...rank.slice(0,top).map(([i,g])=>`| ${i} | ${g.toFixed(1)} |`),'',
    `## Loops — ${top} piores`,'',...tabela(achados.filter(a=>a.categoria==='loop')),'',
    `## Dano e ações — ${top} piores`,'',...tabela(achados.filter(a=>a.categoria!=='loop')),''].join('\n');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:undefined;};
  const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const r=await medirElenco(repo,{ids:opt('--ids')?.split(',')});
  const top=+(opt('--top')??40);
  const salvar=(f,t)=>{mkdirSync(dirname(resolve(f)),{recursive:true});writeFileSync(f,t);};
  if(opt('--json'))salvar(opt('--json'),JSON.stringify(r,null,1)+'\n');
  const md=markdown(r,top);
  if(opt('--md'))salvar(opt('--md'),md);else console.log(md);
}
