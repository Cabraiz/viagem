// Roupa escura nos inimigos fracos (cards NEW-20261023-ORQ-inimigos-fortes-x-fracos e NEW-20261024-E5-fracos-roupa-escura):
// o que separa os fortes (grandão de terno, motoboy) dos fracos é a leitura de valor, um bloco escuro grande com pouca
// pele à mostra; os fracos vestem camiseta marrom/vermelha/laranja no tom da pele e viram uma mancha só. Sem arte nova:
// a ROUPA de cada peça é achada por cor (k-means em Lab no parado de frente; a pele é o que domina a faixa da cabeça) e
// recolorida no tom do terno do grandão, mantendo o sombreado. Onde a roupa escura não basta, os grupos escolhidos em
// scripts/roupa-escura.json levam uma cor de destaque (matiz longe da pele). Alfa e contorno (2 px) e a cabeça (topo 28 %
// da figura) não mudam; a pseudo-sombra já assada fica, porque o sombreado relativo de cada pixel é mantido.
//
//   node scripts/roupa-escura.mjs [--ids a,b]           todas as peças de scripts/roupa-escura.json (ou só estas), no lugar
//   node scripts/roupa-escura.mjs --saida <dir> --ids a  grava as folhas em <dir> (antes × depois), sem mexer no repositório
//   node scripts/art-lite.mjs --kinds enemies           depois: as cópias lite e enemies-pc saem das folhas recoloridas
//
// No lugar: grava public/art/enemies/<página> (WebP sem perda, como o import da art-v2), acerta o sha256 de página,
// arquivo e peça no manifest e os carimbos da pseudo-sombra e do tremor (senão eles refariam a folha), e carimba em
// public/art/enemies/roupa-escura.json a página com o sha novo e os grupos de cor da peça: rodar de novo pula as
// carimbadas (escurecer duas vezes mudaria a separação) e a separação não depende da folha já recolorida.
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';

/** Tom do terno do grandão (miolo da folha, ~RGB 40,40,48). */
export const TERNO=Object.freeze([42,42,50]);
const K=7,TEMP=60;

const LIN=Float64Array.from({length:256},(_,i)=>{const c=i/255;return c>.04045?((c+.055)/1.055)**2.4:c/12.92;});
const f3=t=>t>.008856?Math.cbrt(t):7.787*t+16/116;
/** sRGB 0-255 → Lab (D65). */
export function lab(r,g,b){
  const R=LIN[r],G=LIN[g],B=LIN[b];
  const x=f3((.4124*R+.3576*G+.1805*B)/.95047),y=f3(.2126*R+.7152*G+.0722*B),z=f3((.0193*R+.1192*G+.9505*B)/1.08883);
  return [116*y-16,500*(x-y),200*(y-z)];
}
function rng(seed){let a=seed>>>0;return()=>{a=a+0x6D2B79F5>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
/** k-means determinístico (semente fixa) sobre pontos Lab. */
export function kmeans(pts,k=K,it=30,seed=7){
  const n=pts.length/3,r=rng(seed),idx=Array.from({length:n},(_,i)=>i);
  for(let i=0;i<k;i++){const j=i+Math.floor(r()*(n-i));[idx[i],idx[j]]=[idx[j],idx[i]];}
  const C=Array.from({length:k},(_,i)=>[pts[idx[i]*3],pts[idx[i]*3+1],pts[idx[i]*3+2]]);
  const lbl=new Uint8Array(n);
  for(let t=0;t<it;t++){
    const s=Array.from({length:k},()=>[0,0,0,0]);
    for(let p=0;p<n;p++){
      let best=0,bd=Infinity;
      for(let j=0;j<k;j++){const d=(pts[p*3]-C[j][0])**2+(pts[p*3+1]-C[j][1])**2+(pts[p*3+2]-C[j][2])**2;if(d<bd){bd=d;best=j;}}
      lbl[p]=best;const q=s[best];q[0]+=pts[p*3];q[1]+=pts[p*3+1];q[2]+=pts[p*3+2];q[3]++;
    }
    for(let j=0;j<k;j++)if(s[j][3])C[j]=[s[j][0]/s[j][3],s[j][1]/s[j][3],s[j][2]/s[j][3]];
  }
  return {C,lbl};
}

/** Linha do topo da figura (alfa ≥ 128) num quadro, ou -1. */
function topo(px,stride,cx,cy,cw,ch){
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++)if(px[((cy+y)*stride+cx+x)*4+3]>=128)return y;
  return -1;
}

/**
 * Grupos de cor da peça, do 1º quadro do parado nas direções S, SW, SE, NW e W (linhas 0, 1, 7, 6, 2) da folha cheia:
 * pele = claro e quente que aparece na cabeça (topo 0-20 % da figura); roupa = o que domina tronco (25-60 %) e pernas
 * (60-92 %), não é pele nem preto de contorno/cabelo (L < 18), aparece bem mais no corpo que na cabeça, e não é objeto
 * de cor forte fora do tronco.
 */
export function separar(px,stride,cell,anchorY){
  const [cw,ch]=cell,pts=[],rel=[];
  for(const r of [0,1,7,6,2]){
    const cy=r*ch;if(cy+ch>px.length/4/stride)continue;
    const top=topo(px,stride,0,cy,cw,ch);if(top<0)continue;
    const h=Math.max(1,ch*anchorY-top);
    for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
      const p=((cy+y)*stride+x)*4;if(px[p+3]<200)continue;
      pts.push(...lab(px[p],px[p+1],px[p+2]));rel.push((y-top)/h);
    }
  }
  const {C,lbl}=kmeans(Float64Array.from(pts));
  const share=(j,lo,hi)=>{let a=0,b=0;for(let i=0;i<rel.length;i++)if(rel[i]>=lo&&rel[i]<hi){b++;if(lbl[i]===j)a++;}return a/Math.max(1,b);};
  const r3=v=>Math.round(v*1000)/1000;
  const grupos=C.map(([L,a,b],j)=>({j,L:Math.round(L*10)/10,croma:Math.round(Math.hypot(a,b)*10)/10,matiz:Math.round((Math.atan2(b,a)*180/Math.PI+360)%360),
    cabeca:r3(share(j,0,.2)),tronco:r3(share(j,.25,.6)),pernas:r3(share(j,.6,.92)),area:r3(lbl.filter(v=>v===j).length/lbl.length)}));
  const quente=grupos.filter(g=>g.L>45&&g.matiz>=15&&g.matiz<=85&&g.croma>12);
  const pele=new Set(quente.length?[quente.reduce((m,g)=>g.cabeca>m.cabeca?g:m).j]:[]);
  for(const g of quente)if(g.cabeca>=.12)pele.add(g.j);
  const roupa=grupos.filter(g=>!pele.has(g.j)&&g.L>=18&&g.tronco+g.pernas>=.12&&(g.tronco+g.pernas)/(g.cabeca+.02)>=2.2&&!(g.croma>=45&&g.tronco<.05)).map(g=>g.j);
  return {C:C.map(c=>c.map(v=>Math.round(v*100)/100)),pele:[...pele].sort(),roupa,grupos};
}

/**
 * Peso de cada pixel no corpo: 0 no contorno (2 px da borda do alfa ≥ 250: o aro da arte fica) e na cabeça (topo 0-28 %
 * da figura: cabeça de boneco é grande), subindo até 1 no tronco (34 %). Por quadro.
 */
function corpo(px,w,h,cell,anchorY){
  const out=new Float32Array(w*h),solid=new Uint8Array(w*h);
  for(let i=0;i<w*h;i++)solid[i]=px[i*4+3]>=250?1:0;
  let er=solid;
  for(let k=0;k<2;k++){
    const nx=new Uint8Array(w*h);
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;nx[i]=er[i]&er[i-1]&er[i+1]&er[i-w]&er[i+w];}
    er=nx;
  }
  const [cw,ch]=cell;
  for(let cy=0;cy+ch<=h;cy+=ch)for(let cx=0;cx+cw<=w;cx+=cw){
    const top=topo(px,w,cx,cy,cw,ch);if(top<0)continue;
    const feet=ch*anchorY;
    for(let y=0;y<ch;y++){
      const ramp=Math.max(0,Math.min(1,((y-top)/Math.max(1,feet-top)-.28)/.06));if(!ramp)continue;
      for(let x=0;x<cw;x++){const i=(cy+y)*w+cx+x;if(er[i])out[i]=ramp;}
    }
  }
  return out;
}

/**
 * Recolore uma folha RGBA no lugar. `alvos`: [{grupos:[j], cor:[r,g,b], teto}] — cada pixel vai para a cor do alvo na
 * proporção do seu peso nos grupos (softmax da distância Lab aos centroides) × corpo, com o brilho relativo à mediana
 * dos pixels do alvo (o sombreado e a pseudo-sombra ficam).
 */
export function recolorir(px,w,h,cell,anchorY,C,alvos){
  const n=w*h,prior=corpo(px,w,h,cell,anchorY),lum=new Float32Array(n),pesos=alvos.map(()=>new Float32Array(n));
  const d=new Float64Array(C.length);
  for(let i=0;i<n;i++){
    if(!prior[i])continue;
    const p=i*4,[L,a,b]=lab(px[p],px[p+1],px[p+2]);
    lum[i]=px[p]*.299+px[p+1]*.587+px[p+2]*.114;
    let mn=Infinity;for(let j=0;j<C.length;j++){d[j]=(L-C[j][0])**2+(a-C[j][1])**2+(b-C[j][2])**2;if(d[j]<mn)mn=d[j];}
    let s=0;for(let j=0;j<C.length;j++){d[j]=Math.exp(-(d[j]-mn)/TEMP);s+=d[j];}
    alvos.forEach((t,k)=>{let v=0;for(const j of t.grupos)v+=d[j];pesos[k][i]=v/s*prior[i];});
  }
  alvos.forEach((t,k)=>{
    const wk=pesos[k],sel=[];for(let i=0;i<n;i++)if(wk[i]>.5)sel.push(lum[i]);
    sel.sort((x,y)=>x-y);const ref=sel.length?sel[sel.length>>1]:100;
    const tl=t.cor[0]*.299+t.cor[1]*.587+t.cor[2]*.114,ganho=tl>110?Math.min(1.6,110/tl):1;
    for(let i=0;i<n;i++){
      const q=wk[i];if(q<=0)continue;
      const m=Math.max(.35,Math.min(t.teto,lum[i]/ref))*ganho,p=i*4;
      for(let c=0;c<3;c++)px[p+c]=Math.max(0,Math.min(255,Math.round(px[p+c]*(1-q)+Math.min(255,t.cor[c]*m)*q)));
    }
  });
}

const hex=s=>[1,3,5].map(i=>parseInt(s.slice(i,i+2),16));
/** Alvos da peça: a roupa no tom do terno e, se houver, os grupos de destaque na cor dela. */
export function alvosDa(cfg,sep){
  const roupa=cfg.roupa??sep.roupa,out=[{grupos:roupa,cor:[...TERNO],teto:2.2}];
  if(cfg.destaque)out.push({grupos:cfg.destaque.grupos,cor:hex(cfg.destaque.cor),teto:1.9});
  return out;
}

/**
 * Leitura de valor (scripts/estudo-fortes-fracos/medir.py, branch vgm/fortes-fracos): no 1º quadro do parado nas
 * direções de frente (S, SW, SE), alfa ≥ 200, a fatia escura neutra (croma < 40, luma < 70) menos a marrom/pele/vermelha
 * (croma ≥ 40, matiz HSV 0-30°). Grandão +0,78, motoboy +0,49.
 */
export function leitura(px,stride,cell){
  const [cw,ch]=cell;let n=0,esc=0,mar=0;
  for(const r of [0,1,7])for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
    const p=((r*ch+y)*stride+x)*4;if(p>=px.length||px[p+3]<200)continue;
    const R=px[p],G=px[p+1],B=px[p+2],mx=Math.max(R,G,B),mn=Math.min(R,G,B),cr=mx-mn,l=.299*R+.587*G+.114*B;
    const hue=(Math.atan2(Math.sqrt(3)*(G-B),2*R-G-B)*180/Math.PI+360)%360;n++;
    if(cr<40&&l<70)esc++;else if(cr>=40&&hue<30)mar++;
  }
  return {leitura:(esc-mar)/Math.max(1,n),escuro:esc/Math.max(1,n),marrom:mar/Math.max(1,n)};
}

const LOSSLESS=Object.freeze({lossless:true,effort:6});
const sha256=b=>createHash('sha256').update(b).digest('hex');
const paginas=f=>f.pages??[{file:f.file}];
/** O parado (ou a 1ª animação) da peça: de onde saem os grupos e a leitura. */
export const parado=peca=>peca.files.idle??peca.files[Object.keys(peca.files).find(k=>!k.includes('/'))];
async function ler(src){const {data,info}=await sharp(readFileSync(src)).ensureAlpha().raw().toBuffer({resolveWithObject:true});return {px:data,w:info.width,h:info.height};}

async function main(){
  const args=process.argv.slice(2),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:undefined;};
  const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..'),DIR=join(repo,'public/art/enemies');
  const MAN=join(DIR,'manifest.json'),SOMBRA=join(DIR,'pseudo-sombra.json'),TREMOR=join(DIR,'tremor.json'),CARIMBO=join(DIR,'roupa-escura.json');
  const conf=JSON.parse(readFileSync(join(repo,'scripts/roupa-escura.json'),'utf8')).pecas;
  const saida=opt('--saida'),noLugar=!saida,ids=opt('--ids')?.split(',')??Object.keys(conf);
  const man=JSON.parse(readFileSync(MAN,'utf8'));
  const lerJson=(f,d)=>existsSync(f)?JSON.parse(readFileSync(f,'utf8')):d;
  const sombra=lerJson(SOMBRA,null),tremor=lerJson(TREMOR,null),carimbo=lerJson(CARIMBO,{pecas:{},files:{}});
  const ordenado=o=>Object.fromEntries(Object.entries(o).sort());
  const gravar=()=>{
    writeFileSync(MAN,`${JSON.stringify(man,null,2)}\n`);
    if(sombra)writeFileSync(SOMBRA,`${JSON.stringify({...sombra,files:ordenado(sombra.files)},null,1)}\n`);
    if(tremor)writeFileSync(TREMOR,`${JSON.stringify({...tremor,files:ordenado(tremor.files)},null,1)}\n`);
    writeFileSync(CARIMBO,`${JSON.stringify({pecas:ordenado(carimbo.pecas),files:ordenado(carimbo.files)},null,1)}\n`);
  };
  const t0=Date.now();let n=0,pulou=0;
  for(const id of ids){
    const peca=man.pieces[id],cfg=conf[id];
    if(!peca||!cfg){console.warn('sem peça ou sem config:',id);continue;}
    const base=parado(peca),anchorY=base.anchor?.[1]??.88;
    // Os grupos vêm do carimbo (a folha do parado já recolorida não serve para separar de novo).
    let sep=carimbo.pecas[id];
    if(!sep){const {px,w}=await ler(join(DIR,paginas(base)[0].file));sep=separar(px,w,base.cell,anchorY);}
    const alvos=alvosDa(cfg,sep),antes={},depois={};
    for(const [anim,file] of Object.entries(peca.files)){
      if(cfg.pular?.includes(anim))continue;
      for(const page of paginas(file)){
        const src=join(DIR,page.file);if(!existsSync(src))continue;
        if(noLugar&&carimbo.files[page.file]===sha256(readFileSync(src))){pulou++;continue;}
        const {px,w,h}=await ler(src);
        if(file===base&&page===paginas(base)[0])antes.l=leitura(px,w,file.cell);
        recolorir(px,w,h,file.cell,file.anchor?.[1]??anchorY,sep.C,alvos);
        if(file===base&&page===paginas(base)[0])depois.l=leitura(px,w,file.cell);
        const out=await sharp(px,{raw:{width:w,height:h,channels:4}}).webp(LOSSLESS).toBuffer();
        const dst=noLugar?src:join(saida,page.file);mkdirSync(dirname(dst),{recursive:true});writeFileSync(dst,out);n++;
        if(noLugar){
          const hs=sha256(out);page.sha256=carimbo.files[page.file]=hs;
          if(sombra?.files[page.file])sombra.files[page.file]=hs;
          if(tremor?.files[page.file])tremor.files[page.file]=hs;
        }
      }
      if(noLugar&&file.pages&&file.pages.every(p=>p.sha256))
        file.sha256=file.pages.length===1?file.pages[0].sha256:sha256(file.pages.map(p=>`${p.file} ${p.sha256}`).join('\n'));
    }
    const fmt=l=>l?`${l.leitura>=0?'+':''}${l.leitura.toFixed(2)} (esc ${l.escuro.toFixed(2)} mar ${l.marrom.toFixed(2)})`:'—';
    console.log(`${id}: roupa ${alvos[0].grupos} pele ${sep.pele}${cfg.destaque?` destaque ${cfg.destaque.grupos}→${cfg.destaque.cor}`:''} · leitura ${fmt(antes.l)} → ${fmt(depois.l)}`);
    if(noLugar){
      carimbo.pecas[id]={C:sep.C,pele:sep.pele,roupa:sep.roupa,grupos:sep.grupos};
      peca.sha256=sha256(Object.entries(peca.files).map(([k,f])=>`${k} ${f.sha256}`).sort().join('\n'));
      gravar();
    }
  }
  console.log(`roupa escura: ${n} folhas, ${pulou} já estavam, ${ids.length} peças em ${((Date.now()-t0)/1000).toFixed(0)} s${saida?` → ${saida}`:''}`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
