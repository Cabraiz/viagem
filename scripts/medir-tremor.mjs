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

/** Silhueta de um quadro (1 = alfa ≥ ALFA), reduzida por `f` (um pixel reduzido = cheio se algum do bloco é). */
export function mascaraQuadro(rgba,stride,x0,y0,w,h,f=1,alfa=ALFA){
  const mw=Math.ceil(w/f),mh=Math.ceil(h/f),m=new Uint8Array(mw*mh);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(rgba[((y0+y)*stride+x0+x)*4+3]>=alfa)m[(y/f|0)*mw+(x/f|0)]=1;
  return {w:mw,h:mh,f,m};
}
/** IoU de duas silhuetas do mesmo tamanho. */
export function iou(a,b){
  let i=0,u=0;
  for(let k=0;k<a.m.length;k++){const p=a.m[k],q=b.m[k];if(p&&q)i++;if(p||q)u++;}
  return u?i/u:1;
}
/** A silhueta `a` escalada por `s` em torno da âncora (ax,ay) e levada até (bx,by) (coordenadas da máscara). */
export function transformar(a,ax,ay,bx,by,s){
  const m=new Uint8Array(a.w*a.h);
  for(let y=0;y<a.h;y++){
    const sy=Math.round(ay+(y-by)/s);if(sy<0||sy>=a.h)continue;
    for(let x=0;x<a.w;x++){const sx=Math.round(ax+(x-bx)/s);if(sx>=0&&sx<a.w&&a.m[sy*a.w+sx])m[y*a.w+x]=1;}
  }
  return {...a,m};
}

/** Alinhado ≥ ALINHA × o IoU típico de dois quadros seguidos da sequência: o quadro é o mesmo desenho, só fora do lugar. */
export const ALINHA=.8,BUSCA=2;
/**
 * Classifica o quadro `i` de uma sequência com achado: 'desalinhamento' (transladado/escalado sobre um vizinho — pé,
 * centroide, altura dele — fica tão parecido com ele quanto dois quadros seguidos costumam ser; o pipeline corrige) ou
 * 'arte-nova' (mesmo alinhado destoa dos dois vizinhos: o desenho é outro). Cada vizinho é tentado sozinho: um vizinho
 * também fora do lugar não estraga o alinhamento com o outro. Devolve os IoU e a correção em px da célula (dx, dy,
 * escala em torno do pé) até o lugar de consenso: a mediana da sequência nos loops, a média dos vizinhos nas ações.
 */
export function classificarQuadro(mascaras,medidas,i,loop){
  const n=mascaras.length,q=medidas[i];
  if(!q)return {tipo:'arte-nova',motivo:'vazio'};
  const viz=[i>0?i-1:loop?n-1:-1,i<n-1?i+1:loop?0:-1].filter(j=>j>=0&&j!==i&&medidas[j]);
  if(!viz.length)return {tipo:'arte-nova',motivo:'sem vizinhos'};
  const f=mascaras[i].f,ax=q.cx/f,ay=q.base/f;
  const cru=viz.reduce((t,j)=>t+iou(mascaras[i],mascaras[j]),0)/viz.length;
  let melhor={v:-1,s:1};
  for(const j of new Set(viz)){
    const v=medidas[j],sAlt=Math.min(1.4,Math.max(.7,v.altura/q.altura));
    // Escala pela altura do vizinho, metade dela ou nenhuma (a altura engana quando o quadro levanta um braço).
    for(const s of new Set([1,(1+sAlt)/2,sAlt]))for(let dy=-BUSCA;dy<=BUSCA;dy++)for(let dx=-BUSCA;dx<=BUSCA;dx++){
      const t=iou(transformar(mascaras[i],ax,ay,v.cx/f+dx,v.base/f+dy,s),mascaras[j]);
      if(t>melhor.v+1e-9)melhor={v:t,s};
    }
  }
  // IoU típico de dois quadros seguidos, sem os pares que tocam o quadro.
  const pares=[];
  for(let j=0;j<(loop?n:n-1);j++){const k=(j+1)%n;if(j!==i&&k!==i&&medidas[j]&&medidas[k])pares.push(iou(mascaras[j],mascaras[k]));}
  const tipico=pares.length?mediana(pares):cru;
  const ref=loop?medidas.filter((m,j)=>m&&j!==i):viz.map(j=>medidas[j]);
  const alvo=c=>loop?mediana(ref.map(m=>m[c])):ref.reduce((s,m)=>s+m[c],0)/ref.length;
  const r=v=>+v.toFixed(3);
  return {tipo:melhor.v>=ALINHA*tipico?'desalinhamento':'arte-nova',iouCru:r(cru),iouAlinhado:r(melhor.v),iouTipico:r(tipico),
    correcao:{dx:+(alvo('cx')-q.cx).toFixed(1),dy:+(alvo('base')-q.base),escala:+melhor.s.toFixed(3)}};
}

/** Redução das silhuetas para a classificação: ~64 linhas por célula. */
export const reducao=h=>Math.max(1,Math.round(h/64));

/** Lê uma folha do manifest (todas as páginas) e devolve as medidas por direção: medidas[dir][quadro]. */
export async function medirFolha(dirArte,file,{mascaras}={}){
  const [w,h]=file.cell,frames=Math.max(1,file.frames??1),dirs=Math.max(1,file.directions??1);
  const medidas=Array.from({length:dirs},()=>Array(frames).fill(null));
  const ms=Array.from({length:dirs},()=>Array(frames).fill(null)),f=reducao(h);
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
      if(mascaras)ms[d][q]=mascaraQuadro(data,info.width,c*w,r*h,w,h,f);
    }
  }
  if(mascaras){for(const linha of ms)for(let q=0;q<frames;q++)linha[q]??=mascaraQuadro(new Uint8Array(w*h*4),w,0,0,w,h,f);return {medidas,mascaras:ms};}
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
      const {medidas,mascaras}=await medirFolha(dirArte,file,{mascaras:true});
      folhas.push({id,anim,dirs:medidas.length,frames:medidas[0].length});
      medidas.forEach((qs,d)=>{
        const cls=new Map();
        for(const t of acharTremores(qs,anim,file.cell[1])){
          if(!cls.has(t.quadro))cls.set(t.quadro,classificarQuadro(mascaras[d],qs,t.quadro,ehLoop(anim)));
          achados.push({inimigo:id,anim,categoria:categoria(anim),direcao:medidas.length===8?DIRECOES[d]:String(d),dir:d,...t,...cls.get(t.quadro)});
        }
      });
    }
  }
  achados.sort((a,b)=>b.gravidade-a.gravidade);
  return {folhas,achados};
}

function markdown({folhas,achados},top){
  const conta=f=>achados.filter(f).length,loops=achados.filter(a=>a.categoria==='loop');
  // Um quadro com várias medidas fora conta uma vez: chave inimigo/animação/direção/quadro, gravidade = a pior.
  const quadros=new Map();
  for(const a of achados){const k=`${a.inimigo}|${a.anim}|${a.direcao}|${a.quadro}`,q=quadros.get(k);
    if(!q)quadros.set(k,{...a,medidas:[a.medida]});else{q.medidas.push(a.medida);if(a.gravidade>q.gravidade)Object.assign(q,{...a,medidas:q.medidas});}}
  const qs=[...quadros.values()].sort((a,b)=>b.gravidade-a.gravidade);
  const porInimigo=new Map();
  for(const q of qs){if(q.categoria!=='loop')continue;const r=porInimigo.get(q.inimigo)??{soma:0,des:0,nova:0};
    r.soma+=q.gravidade;q.tipo==='desalinhamento'?r.des++:r.nova++;porInimigo.set(q.inimigo,r);}
  const rank=[...porInimigo].sort((a,b)=>b[1].soma-a[1].soma);
  const tabela=lista=>['| inimigo | animação | direção | quadro | medidas | gravidade | IoU cru → alinhado / típico | correção (dx, dy, escala) |','|---|---|---|---|---|---|---|---|',
    ...lista.slice(0,top).map(a=>`| ${a.inimigo} | ${a.anim} | ${a.direcao} | ${a.quadro} | ${a.medidas.join(', ')} | ${a.gravidade} | ${a.iouCru??'–'} → ${a.iouAlinhado??'–'} / ${a.iouTipico??'–'} | ${a.correcao?`${a.correcao.dx}, ${a.correcao.dy}, ${a.correcao.escala}`:a.motivo??'–'} |`)];
  const sel=(cat,tipo)=>qs.filter(q=>(cat==='loop'?q.categoria==='loop':q.categoria!=='loop')&&q.tipo===tipo);
  return [`# Tremor por quadro — ${folhas.length} folhas, ${achados.length} achados em ${qs.length} quadros`,'',
    `Loops: ${conta(a=>a.categoria==='loop')} achados (${sel('loop','desalinhamento').length} quadros desalinhados, ${sel('loop','arte-nova').length} de arte nova). `+
    `Dano e ações: ${conta(a=>a.categoria!=='loop')} achados (${sel('acao','desalinhamento').length} desalinhados, ${sel('acao','arte-nova').length} de arte nova).`,'',
    'Mede o desenho dentro da célula, não a posição no mundo: o "andar no lugar" (76bffa9) não entra aqui.',
    `Desalinhamento = o quadro, transladado/escalado até a âncora dos vizinhos (pé, centroide, altura), fica com IoU ≥ ${ALINHA} × o IoU típico de dois quadros seguidos: o pipeline corrige com a correção da tabela (px da célula). Arte nova = mesmo alinhado destoa: precisa redesenhar o quadro.`,'',
    '## Inimigos — soma das gravidades nos loops (um quadro conta uma vez)','','| inimigo | soma | desalinhados | arte nova |','|---|---|---|---|',
    ...rank.slice(0,top).map(([i,r])=>`| ${i} | ${r.soma.toFixed(1)} | ${r.des} | ${r.nova} |`),'',
    `## Loops, desalinhamento (corrigível) — ${top} piores`,'',...tabela(sel('loop','desalinhamento')),'',
    `## Loops, arte nova — ${top} piores`,'',...tabela(sel('loop','arte-nova')),'',
    `## Dano e ações, desalinhamento — ${top} piores`,'',...tabela(sel('acao','desalinhamento')),'',
    `## Dano e ações, arte nova — ${top} piores`,'',...tabela(sel('acao','arte-nova')),''].join('\n');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:undefined;};
  const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const r=await medirElenco(repo,{ids:opt('--ids')?.split(',')});
  const top=+(opt('--top')??40);
  const salvar=(f,t)=>{mkdirSync(dirname(resolve(f)),{recursive:true});writeFileSync(f,t);};
  // Um achado por linha: o diff entre rodadas fica legível.
  if(opt('--json'))salvar(opt('--json'),`{"folhas":[\n${r.folhas.map(f=>JSON.stringify(f)).join(',\n')}\n],"achados":[\n${r.achados.map(a=>JSON.stringify(a)).join(',\n')}\n]}\n`);
  const md=markdown(r,top);
  if(opt('--md'))salvar(opt('--md'),md);else console.log(md);
}
