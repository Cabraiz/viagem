// The heroes' feet on the floor of the menu (NEW-20261021-ORQ-heroi-esrgan-no-ar, the user, 21/10: "garantia de que o
// pé encosta no chão"; NEW-20261021-ORQ-mureta-camada-frente: "o pé de trás deveria estar escondido"). On the BUILT
// site, for the heroes drawn in place on the PC (stadium.ts RECORTES) at 8 window sizes (DPR 1), from two transparent
// screenshots (everything else hidden): the hero alone and, for a hero with a front layer (`frente`: the stadium's bar
// drawn over the viciado), that layer alone.
//   - A hero with a front layer (the viciado): the bar's top edge is where the layer's opaque pixels (alpha >= 128)
//     start, column by column; it must sit where the background draws the bar (stadium.ts muretaTopo through the
//     stage's computed background-size/position) ±1.5 px. Front foot (NA_MURETA.frente columns): the sole, the hero
//     alone, on that edge — the median of (sole - edge) within ±4 px (a few px behind the padded top's curve is
//     standing on it), and no gap: 90% of its columns at most 4 px above the edge. Back foot (NA_MURETA.tras): behind
//     the bar — not a pixel of it seen below the edge (the layer drawn and aligned), and at least 15% of its sneaker hidden.
//   - A hero on a floor of his own picture (the CLT, PES): each foot's lowest row with alpha >= 128 in its columns
//     against the row where its sole touches the floor in the approved 1920x1080 picture, put on the screen by the
//     background as the page draws it (frameHero must agree), ±4 px.
//   - Every hero: what is seen of him (alpha > 0, not under the layer) at least FEET_MARGIN - 1 px above the window's
//     bottom (8, 1 for rounding: the ORQ, 21/10, the back sneaker touched the edge at 1920x1000); his box inside it.
//   - Same place (NEW-20261021-ORQ-clt-mesmo-lugar, the user: "os rostos deles e corpo deles estejam meio que quase no
//     mesmo lugar"): every hero's face (stadium.ts `rosto`, through his drawn <img>) within MESMO_LUGAR of the width and
//     of the height from the first hero's, at each window, plus the offset stadium.ts gives him (clt-direita-15-maior:
//     the CLT bigger and to the right, `lugar.dx`; tests/client/menu-estadio.test.ts bounds that offset). The phone held upright (PHONE: no cutout, the dance): the
//     dancer's box the same for every one of them.
// Out: <out>/pes.json ({ok, fails, rows}) and <out>/pes-<hero>-<w>x<h>.png.
// node scripts/pes-no-chao.mjs [outDir=folha-out] [--dist dist] [--url http://127.0.0.1:5173/]: run from the checkout
// whose dist/ it serves (or against a running server with --url). Exit 0 ok, 1 a foot is off, 2 infrastructure.
// Self-tests (never in CI): --flutua <px> lifts every hero by px; --sem-mureta hides the front layer. Both must fail.
import {createServer} from 'node:http';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {extname,join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback;};
const outDir=resolve(process.argv.slice(2).find((a,i,all)=>!a.startsWith('--')&&!(i>0&&all[i-1].startsWith('--')))??'folha-out');
const dist=resolve(arg('dist','dist'));
const flutua=Number(arg('flutua',0)),semMureta=process.argv.includes('--sem-mureta');
const VIEWPORTS=[[1920,1080],[1920,1000],[1920,950],[1590,903],[1366,768],[1280,720],[2560,1080],[1024,768]];
/**
 * The feet of a hero on a floor of his own picture, in the approved 1920x1080 picture (px): [first column, last column,
 * floor], the floor being the bottom edge of that sole's lowest row with alpha >= 128, where the picture the user
 * approved has it touching the plateau (the cat: the rooftop's tiles). CLT, cat: left, right. tests/client/menu-estadio.test.ts re-measures them on the art.
 */
const PES={"clt-cansado":[[792,965,921],[1290,1427,935]],"gato-nada-pra-comer":[[1009,1241,1047],[1366,1592,1076]],"maromba":[[1057,1228,1076],[1373,1594,1069]]};
const NOMES={"clt-cansado":['pé esquerdo','pé direito'],"gato-nada-pra-comer":['pantufa esquerda','pantufa direita'],"maromba":['tênis esquerdo','tênis direito']};
/**
 * The feet of a hero behind a front layer (whole-picture px): the columns of the sole on the bar's top; the columns of
 * the one behind it and the row its sneaker starts at (desce included). The bar's top falls to the right faster than the
 * viciado's back sneaker: its heel and side go behind (~22% of it), its laces and toe stay over the edge.
 */
const NA_MURETA={"viciado-em-bet":{"frente":[1000,1260],"tras":[1500,1746,950]}};
const TOLERANCIA=4,ALPHA=128,ALINHA=1.5,ESCONDIDO=.15,MESMO_LUGAR=.03;
const PHONE=[390,844];
class Infra extends Error {}

async function playwright(){
  for(const spec of [process.env.PLAYWRIGHT_MODULE,join(process.cwd(),'node_modules','playwright'),'playwright','D:/Gits/viagem-tools/node_modules/playwright']){
    if(!spec)continue;
    try{
      const url=spec==='playwright'?spec:pathToFileURL(join(spec,existsSync(join(spec,'index.mjs'))?'index.mjs':'index.js')).href;
      const m=await import(url);return m.chromium?m:m.default;
    }catch{}
  }
  throw new Infra('Playwright não encontrado: npm install --no-save playwright@1.63.0 (ou PLAYWRIGHT_MODULE)');
}
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.mp3':'audio/mpeg','.ogg':'audio/ogg'};
/** dist/ on a free port (the menu needs no room). */
function serve(){
  if(!existsSync(join(dist,'index.html')))throw new Infra(`sem ${join(dist,'index.html')}: npm run build antes`);
  const server=createServer(async(req,res)=>{
    try{
      const pathname=decodeURIComponent(new URL(req.url||'/','http://localhost').pathname);
      const file=resolve(dist,'.'+(pathname==='/'?'/index.html':pathname));
      if(!file.startsWith(dist+sep)){res.writeHead(403).end();return;}
      const data=await readFile(file);
      res.writeHead(200,{'Content-Type':MIME[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);
    }catch{res.writeHead(404).end('Not found');}
  });
  return new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',()=>ok(server));});
}
/** Only `selector` drawn, on a transparent page: a PNG of it alone. */
async function alone(page,selector){
  const style=await page.addStyleTag({content:`html,body,body *{background:transparent!important;visibility:hidden!important}body ${selector}{visibility:visible!important}`});
  try{return await page.screenshot({omitBackground:true});}finally{await style.evaluate(el=>el.remove());}
}
/**
 * Column by column (decoded by the page's own canvas: no extra package in CI), the bottom edge (row + 1, 0 = none) of:
 * the hero's lowest pixel with alpha >= ALPHA (`sole`), the same not under the layer (`seen`); the row where the layer's
 * pixels with alpha >= ALPHA start (`edge`, -1 = none); and of everything seen of the hero (`any`, alpha > 0). Per
 * column range (from its row on), the hero's pixels (alpha >= ALPHA) and how many of them the layer hides.
 */
async function analyse(page,hero,front,ranges){
  return page.evaluate(async([heroB64,frontB64,alpha,ranges])=>{
    const decode=async b64=>{
      const img=new Image();img.src=`data:image/png;base64,${b64}`;await img.decode();
      const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
      const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0);
      return {w:c.width,h:c.height,a:g.getImageData(0,0,c.width,c.height).data};
    };
    const H=await decode(heroB64),F=frontB64?await decode(frontB64):undefined,{w,h}=H;
    const ha=(x,y)=>H.a[(y*w+x)*4+3],fa=(x,y)=>F?F.a[(y*w+x)*4+3]:0;
    const sole=[],seen=[],edge=[];let any=0;
    for(let x=0;x<w;x++){
      let s=0,v=0,e=-1;
      for(let y=h-1;y>=0;y--){
        if(!s&&ha(x,y)>=alpha)s=y+1;
        if(!v&&ha(x,y)>=alpha&&fa(x,y)<alpha)v=y+1;
        if(y+1>any&&ha(x,y)>0&&fa(x,y)<alpha)any=y+1;
      }
      for(let y=0;y<h;y++)if(fa(x,y)>=alpha){e=y;break;}
      sole.push(s);seen.push(v);edge.push(e);
    }
    const counts=ranges.map(([x0,x1,y0=0])=>{
      let total=0,hidden=0;
      for(let x=Math.max(0,Math.round(x0));x<=Math.min(w-1,Math.round(x1));x++)for(let y=Math.max(0,Math.ceil(y0));y<h;y++)if(ha(x,y)>=alpha){total++;if(fa(x,y)>=alpha)hidden++;}
      return {total,hidden};
    });
    return {sole,seen,edge,any,counts};
  },[hero.toString('base64'),front?.toString('base64'),ALPHA,ranges]);
}
const median=v=>{const s=[...v].sort((a,b)=>a-b);return s.length?s[s.length>>1]:NaN;};
const quantile=(v,q)=>{const s=[...v].sort((a,b)=>a-b);return s.length?s[Math.min(s.length-1,Math.floor(q*s.length))]:NaN;};

async function main(){
  mkdirSync(outDir,{recursive:true});
  const {frameHero,STADIUM,RECORTES,FEET_MARGIN,muretaTopo,placeCutout,fitCutout}=await import(pathToFileURL(resolve('src/client/ui/stadium.ts')).href);
  for(const [id,cut] of Object.entries(RECORTES))
    if(!(cut.frente?id in NA_MURETA:id in PES))throw new Error(`${id}: um herói recortado sem ${cut.frente?'NA_MURETA':'PES'} em scripts/pes-no-chao.mjs`);
  const {chromium}=await playwright();
  const server=arg('url')?undefined:await serve(),url=arg('url')??`http://127.0.0.1:${server.address().port}/`;
  let browser;
  try{browser=await chromium.launch();}catch(e){server?.close();throw new Infra(`o navegador não abriu: ${String(e).split('\n')[0]}`);}
  const rows=[],fails=[];
  try{
    for(const [w,h] of VIEWPORTS){
      const page=await browser.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
      const selfTest=[flutua?`.estadio-recorte{translate:0 ${-flutua}px}`:'',semMureta?'.estadio-mureta{display:none!important}':''].join('');
      if(selfTest)await page.addInitScript(css=>addEventListener('DOMContentLoaded',()=>document.head.append(Object.assign(document.createElement('style'),{textContent:css}))),selfTest);
      try{
        await page.goto(url,{waitUntil:'load',timeout:60000});
        await page.waitForSelector('[data-hero="clt-cansado"]',{timeout:60000});
        const rostos=[];
        for(const hero of Object.keys(RECORTES)){
          const cut=RECORTES[hero];
          await page.click(`[data-hero="${hero}"]`);
          // The cutout placed, its file decoded, (the CLT) his own background swapped in, (the viciado) the bar over him.
          await page.waitForFunction(([id,fundo,front])=>{
            const i=document.querySelector('.estadio-recorte'),stage=document.querySelector('.estadio-palco'),m=document.querySelector('.estadio-mureta');
            return i&&!i.hidden&&i.complete&&i.naturalWidth>0&&i.dataset.box&&document.querySelector(`[data-hero="${id}"]`)?.getAttribute('aria-pressed')==='true'
              &&(!fundo||stage.style.backgroundImage.includes(fundo))&&(!front||(m&&!m.hidden&&m.complete&&m.naturalWidth>0))&&(front||!m||m.hidden);
          },[hero,cut.fundo??'',!!cut.frente],{timeout:60000});
          await page.evaluate(()=>Promise.all([...document.querySelectorAll('.estadio-recorte,.estadio-mureta')].map(i=>i.decode().catch(()=>{}))));
          await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
          const drawn=await page.evaluate(()=>{
            const stage=document.querySelector('.estadio-palco'),r=stage.getBoundingClientRect(),cs=getComputedStyle(stage);
            const num=s=>s.split(',')[0].trim().split(/\s+/).map(parseFloat);
            const img=document.querySelector('.estadio-recorte'),ir=img.getBoundingClientRect();
            return {top:r.top,left:r.left,box:{w:stage.clientWidth,h:stage.clientHeight},size:num(cs.backgroundSize),at:num(cs.backgroundPosition),
              file:img.currentSrc||img.src,img:{l:ir.left,t:ir.top,r:ir.right,b:ir.bottom}};
          });
          // His own background moves with him (lugar), the stadium does not; both zoomed for him (heroi-grande-por-tela).
          const art=STADIUM.bleed,f=art.focal,frame=frameHero(drawn.box,art,cut);
          // The background as the page draws it (its px size/position); a whole-picture point → the screen and back.
          const [bw,bh]=drawn.size,[bx,by]=drawn.at,sx=bw/art.w,sy=bh/art.h;
          const toX=X=>drawn.left+bx+(f.x+X)*sx,toY=Y=>drawn.top+by+(f.y+Y)*sy,fromX=x=>(x-drawn.left-bx)/sx-f.x;
          writeFileSync(join(outDir,`pes-${hero}-${w}x${h}.png`),await page.screenshot());
          const heroPng=await alone(page,'.estadio-recorte'),frontPng=cut.frente?await alone(page,'.estadio-mureta'):undefined;
          const spec=NA_MURETA[hero],ranges=spec?[[toX(spec.frente[0]),toX(spec.frente[1])],[toX(spec.tras[0]),toX(spec.tras[1]),toY(spec.tras[2])]]
            :PES[hero].map(([a,b])=>[toX(a),toX(b)]);
          const got=await analyse(page,heroPng,frontPng,ranges);
          const cols=([x0,x1])=>{const out=[];for(let x=Math.max(0,Math.ceil(x0));x<=Math.min(w-1,Math.floor(x1));x++)out.push(x);return out;};
          const why=[],pes=[];
          if(!(Number.isFinite(bh)&&bh>0))why.push(`fundo sem tamanho em px (${JSON.stringify(drawn.size)})`);
          const frameY=drawn.top+frame.oy+(f.y+1000)*frame.s;
          if(Math.abs(toY(1000)-frameY)>ALINHA)why.push(`fundo desenhado fora do frameHero (${toY(1000).toFixed(1)} × ${frameY.toFixed(1)})`);
          // His face through the <img> as drawn (its box is his box of the whole picture).
          const r=cut.rosto,iw=(drawn.img.r-drawn.img.l)/cut.w;
          // Where stadium.ts puts that face (the offset of a hero in another's place is his own, lugar).
          const fit=fitCutout(drawn.box,placeCutout(drawn.box,art,cut)),fk=fit.w/cut.w;
          rostos.push({hero,cx:drawn.img.l-drawn.left+(r.x-cut.x+r.w/2)*iw,cy:drawn.img.t-drawn.top+(r.y-cut.y+r.h/2)*iw,h:r.h*iw,
            ex:fit.x+(r.x-cut.x+r.w/2)*fk,ey:fit.y+(r.y-cut.y+r.h/2)*fk});
          if(spec){
            // The layer's edge where the background draws the bar.
            const barTop=x=>toY(muretaTopo(fromX(x+.5)));
            const all=cols([toX(spec.frente[0]),toX(spec.tras[1])]),drawnEdge=all.filter(x=>got.edge[x]>=0);
            const off=drawnEdge.map(x=>got.edge[x]-barTop(x));
            if(drawnEdge.length<all.length*.95)why.push(`mureta não desenhada (${drawnEdge.length} de ${all.length} colunas)`);
            else if(Math.max(...off.map(Math.abs))>ALINHA+.5)why.push(`mureta fora do fundo (até ${Math.max(...off.map(Math.abs)).toFixed(1)} px)`);
            // Front: the sole on the edge (the hero alone), no gap under it.
            const fc=cols(ranges[0]).filter(x=>got.sole[x]>0&&got.edge[x]>=0);
            const onTop=median(fc.map(x=>got.sole[x]-got.edge[x])),gap=quantile(fc.map(x=>got.edge[x]-got.seen[x]),.9);
            pes.push({pe:'pé da frente',sola:+onTop.toFixed(1),vao:gap});
            if(!fc.length)why.push('pé da frente fora da tela');
            else{
              if(Math.abs(onTop)>TOLERANCIA)why.push(`pé da frente ${onTop<0?'flutua':'afunda'} ${Math.abs(onTop)} px (sola × topo da mureta)`);
              if(gap>TOLERANCIA)why.push(`vão de ${gap} px sob o pé da frente`);
            }
            // Back: nothing of it seen below the edge, and a good part of it hidden.
            const bc=cols(ranges[1]).filter(x=>got.sole[x]>0),below=bc.filter(x=>got.seen[x]>barTop(x)+ALINHA+.5);
            const {total,hidden}=got.counts[1],share=total?hidden/total:0;
            pes.push({pe:'pé de trás',escondido:+share.toFixed(2),abaixo:below.length});
            if(below.length)why.push(`pé de trás aparece abaixo do topo da mureta em ${below.length} colunas`);
            if(share<ESCONDIDO)why.push(`pé de trás só ${(share*100).toFixed(0)}% atrás da mureta`);
          }else PES[hero].forEach(([,,Y],k)=>{
            const feet=Math.max(0,...cols(ranges[k]).map(x=>got.sole[x])),floor=toY(Y),diff=+(feet-floor).toFixed(1);
            pes.push({pe:NOMES[hero][k],feet,floor:+floor.toFixed(1),diff});
            if(feet<=0)why.push(`${NOMES[hero][k]} fora da tela`);
            else if(Math.abs(diff)>TOLERANCIA)why.push(`${NOMES[hero][k]} em ${feet}, chão em ${floor.toFixed(1)} (${diff<0?'flutua':'afunda'} ${Math.abs(diff)} px)`);
          });
          const margin=h-got.any,i=drawn.img;
          rows.push({hero,w,h,file:drawn.file.split('/').pop(),pes,margin,img:Object.fromEntries(Object.entries(i).map(([k,v])=>[k,Math.round(v*10)/10]))});
          if(got.any<=0)why.push('herói invisível');
          else if(margin<FEET_MARGIN-1)why.push(`só ${margin} px entre o pé e o fim da janela (mínimo ${FEET_MARGIN})`);
          if(i.l<-.5||i.t<-.5||i.r>w+.5||i.b>h+.5)why.push(`herói fora da janela (${Math.round(i.l)},${Math.round(i.t)} a ${Math.round(i.r)},${Math.round(i.b)})`);
          if(why.length)fails.push(`${hero} ${w}x${h}: ${why.join('; ')}`);
        }
        const [ref,...others]=rostos;
        for(const o of others){
          const dx=(o.cx-ref.cx-(o.ex-ref.ex))/w,dy=(o.cy-ref.cy-(o.ey-ref.ey))/h,row=rows.find(r=>r.hero===o.hero&&r.w===w&&r.h===h);
          row.rosto={dx:+(dx*100).toFixed(2),dy:+(dy*100).toFixed(2),tamanho:+(o.h/ref.h).toFixed(2)};
          if(Math.abs(dx)>MESMO_LUGAR||Math.abs(dy)>MESMO_LUGAR)
            fails.push(`${o.hero} ${w}x${h}: rosto fora do lugar do ${ref.hero} (${(dx*100).toFixed(1)}% da largura, ${(dy*100).toFixed(1)}% da altura; máximo ${MESMO_LUGAR*100}%)`);
        }
      }finally{await page.close();}
    }
    // The phone held upright: no cutout, every hero's dancer on the same spot of the bar.
    const page=await browser.newPage({viewport:{width:PHONE[0],height:PHONE[1]},deviceScaleFactor:1});
    try{
      await page.goto(url,{waitUntil:'load',timeout:60000});
      await page.waitForSelector('[data-hero="clt-cansado"]',{timeout:60000});
      const boxes=[];
      for(const hero of Object.keys(RECORTES)){
        // The upright row pages its faces (4+ heroes: the first one can be off the page): the click the row itself takes.
        await page.evaluate(id=>document.querySelector(`[data-hero="${id}"]`).click(),hero);
        await page.waitForFunction(id=>document.querySelector(`[data-hero="${id}"]`)?.getAttribute('aria-pressed')==='true',hero,{timeout:60000});
        await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
        boxes.push(await page.evaluate(()=>{const r=document.querySelector('#portrait').getBoundingClientRect();return {hidden:!!document.querySelector('.estadio-recorte')?.hidden,x:r.x,y:r.y,w:r.width,h:r.height};}));
        writeFileSync(join(outDir,`pes-${hero}-${PHONE[0]}x${PHONE[1]}.png`),await page.screenshot());
      }
      const why=[];
      if(boxes.some(b=>!b.hidden))why.push('recorte no celular em pé (é a dança)');
      if(boxes.some(b=>['x','y','w','h'].some(k=>Math.abs(b[k]-boxes[0][k])>1)))why.push(`dançarinos em lugares diferentes ${JSON.stringify(boxes)}`);
      rows.push({hero:'celular',w:PHONE[0],h:PHONE[1],file:'dança',pes:[],margin:'-',img:boxes[0],celular:why.length?'FALHOU':'ok'});
      if(why.length)fails.push(`celular ${PHONE[0]}x${PHONE[1]}: ${why.join('; ')}`);
    }finally{await page.close();}
  }finally{await browser.close();server?.close();}
  const ok=!fails.length;
  writeFileSync(join(outDir,'pes.json'),JSON.stringify({ok,tolerancia:TOLERANCIA,fails,rows},null,1));
  const sign=d=>`${d>=0?'+':''}${d}`;
  const feetText=r=>r.pes.map(p=>'sola' in p?`${p.pe}: sola ${sign(p.sola)} do topo, vão ${p.vao}`:'escondido' in p?`${p.pe}: ${Math.round(p.escondido*100)}% atrás`:`${p.pe} ${p.feet}/${p.floor} (${sign(p.diff)})`).join(', ');
  const lugarText=r=>r.rosto?`  rosto ${sign(r.rosto.dx)}% ${sign(r.rosto.dy)}% (x${r.rosto.tamanho})`:r.celular?`  dança no mesmo lugar: ${r.celular}`:'';
  for(const r of rows)console.log(`${r.hero.padEnd(15)} ${`${r.w}x${r.h}`.padEnd(10)} ${feetText(r)}  margem ${r.margin} px${lugarText(r)}  (${r.file})`);
  for(const f of fails)console.log(`FALHOU: ${f}`);
  console.log(ok?`pés no chão e mesmo lugar: ok (${rows.length} telas, ±${TOLERANCIA} px, rostos ±${MESMO_LUGAR*100}%)`:`pés no chão: ${fails.length} falha(s)`);
  if(process.env.GITHUB_STEP_SUMMARY){
    const {appendFileSync}=await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n### Pés no chão do menu (±${TOLERANCIA} px, margem >= 8 px, pé de trás atrás da mureta, rostos no mesmo lugar ±${MESMO_LUGAR*100}%): ${ok?'ok':'FALHOU'}\n\n| herói | tela | pés | margem embaixo | mesmo lugar |\n|---|---|---|---|---|\n${rows.map(r=>`| ${r.hero} | ${r.w}×${r.h} | ${feetText(r)} | ${r.margin} px | ${lugarText(r).trim()} |`).join('\n')}\n`);
  }
  return ok?0:1;
}
main().then(code=>process.exit(code),e=>{console.error(e instanceof Infra?`infra: ${e.message}`:e);process.exit(e instanceof Infra?2:1);});
