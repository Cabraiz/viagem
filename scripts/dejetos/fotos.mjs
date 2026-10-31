// NEW-20261031-ORQ-esconder-dejetos-sem-brilho: in-game crops of every junk piece (catalogo.ts) on the real map, drawn by
// the city sandbox (its real ground, light and outline), and the numbered prancha with each piece's count on the map.
//   node scripts/dejetos/fotos.mjs --catalogo <json> --saida <dir> [--web http://127.0.0.1:4201/] [--marcar 1,2,…] [--so-montar]
// The hero is put on the piece (camera centered there), the camera fixed, the hero moved in front of it and hidden: the
// piece is never faded by the see-through, nothing covers it. --marcar: the numbers drawn with a red frame (esconder).
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {claimSlot} from '../../tools/vaga.mjs';

const arg=(n,f)=>{const i=process.argv.indexOf(`--${n}`);return i>0?process.argv[i+1]:f;};
const OUT=arg('saida'),WEB=arg('web','http://127.0.0.1:4201/'),ONLY_SHEET=process.argv.includes('--so-montar');
const MARK=new Set((arg('marcar','')||'').split(',').filter(Boolean).map(Number));
const items=JSON.parse(readFileSync(arg('catalogo'),'utf8'));
const BOARD=process.env.VIAGEM_BOARD??'D:/Gits/viagem-board',LOCKS=join(BOARD,'locks');
const CW=240,CH=220,SAMPLES=2,TW=CW*SAMPLES,TH=CH,LABEL=40,COLS=4;
mkdirSync(OUT,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const name=it=>it.key.replace(/^.*\//,'');
/** The samples photographed: two spread over the list (a piece can sit buried in a rock massif at one spot). */
const samples=it=>[...new Set([Math.floor(it.at.length/4),Math.floor(it.at.length*3/4)])].map(i=>it.at[i]);
const tileFile=(n,k)=>join(OUT,`${String(n).padStart(2,'0')}-${k}.png`);

if(!ONLY_SHEET){
  const {chromium}=await import(pathToFileURL('D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href);
  const releases=[];let browser;
  try{
    const server=join(LOCKS,'foto-servidor.json');
    if(existsSync(server)){
      try{browser=await chromium.connect(JSON.parse(readFileSync(server,'utf8')).wsEndpoint,{timeout:5000});
        releases.push(await claimSlot({locks:LOCKS,prefix:'foto-pagina',count:2,label:'dejetos/fotos.mjs',staleMs:20000}));}
      catch{browser=undefined;}
    }
    if(!browser){
      releases.push(await claimSlot({locks:LOCKS,prefix:'browser',count:2,label:'dejetos/fotos.mjs'}));
      browser=await chromium.launch({headless:true,args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']});
    }
    const ctx=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1});
    const p=await ctx.newPage();
    const errors=[];p.on('pageerror',e=>errors.push(String(e).slice(0,200)));
    const s0=items[0].at[0];
    await p.goto(`${WEB}?sandbox=cidade&mapa=real&hero=${s0.x/1.496},${s0.y/1.496}`,{waitUntil:'load',timeout:180000});
    await p.waitForFunction(()=>window.__cidade?.ground?.(),null,{timeout:180000,polling:500});
    await p.addStyleTag({content:'.cidade-turn,.cidade-acao,.cidade-fps{display:none!important}'});
    for(const [i,it] of items.entries())for(const [k,at] of samples(it).entries()){
      await p.evaluate(({x,y})=>{const c=window.__cidade;c.fixar(false);c.hero.setVisible(true);c.move(x,y);},at);
      await sleep(400);
      await p.waitForFunction(()=>window.__cidade.ground(),null,{timeout:60000,polling:200});
      const feet=await p.evaluate(({x,y})=>{
        const c=window.__cidade,h=c.hero,cam=h.scene.cameras.main,r=h.scene.game.canvas.getBoundingClientRect();
        const s={x:r.left+(h.x-cam.worldView.x)*cam.zoom,y:r.top+(h.y-cam.worldView.y)*cam.zoom};
        // In front of the piece (larger x+y draws nearer the viewer): it never covers the hero, so it is never faded.
        c.fixar(true);c.move(x+6,y+6);h.setVisible(false);c.mate?.setVisible?.(false);
        return s;
      },at);
      await sleep(900);
      const clip={x:Math.round(feet.x-CW/2),y:Math.round(feet.y-CH*.7),width:CW,height:CH};
      await p.screenshot({path:tileFile(i+1,k),clip});
      console.log(i+1,k,name(it),it.count,JSON.stringify(at));
    }
    if(errors.length)console.log('page errors',errors.slice(0,3));
    await ctx.close();
  }finally{
    try{await browser?.close();}catch{}
    for(const r of releases)r();
  }
}

// The prancha: tiles in reading order, each with its number, name and count on the map; marked ones framed red.
const rows=Math.ceil(items.length/COLS),W=COLS*TW,H=rows*(TH+LABEL);
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
const parts=[];
for(const [i,it] of items.entries()){
  const x=(i%COLS)*TW,y=Math.floor(i/COLS)*(TH+LABEL),n=i+1,m=MARK.has(n);
  for(const k of samples(it).keys())parts.push({input:tileFile(n,k),left:x+k*CW,top:y});
  const svg=`<svg width="${TW}" height="${TH+LABEL}" xmlns="http://www.w3.org/2000/svg">
    ${m?`<rect x="3" y="3" width="${TW-6}" height="${TH+LABEL-6}" fill="none" stroke="#E0262B" stroke-width="6"/>`:''}
    <rect x="0" y="${TH}" width="${TW}" height="${LABEL}" fill="${m?'#E0262B':'#1E1530'}"/>
    <circle cx="26" cy="26" r="20" fill="#EEDDB8" stroke="#1E1530" stroke-width="3"/>
    <text x="26" y="34" font-family="Arial" font-weight="bold" font-size="22" text-anchor="middle" fill="#1E1530">${n}</text>
    <text x="10" y="${TH+29}" font-family="Arial" font-weight="bold" font-size="19" fill="#FFFFFF">${esc(name(it))} ×${it.count}${m?' · ESCONDER':''}</text>
  </svg>`;
  parts.push({input:Buffer.from(svg),left:x,top:y});
}
const file=join(OUT,'prancha-dejetos.png');
await sharp({create:{width:W,height:H,channels:3,background:'#2B2542'}}).composite(parts).png().toFile(file);
writeFileSync(join(OUT,'legenda.json'),JSON.stringify(items.map((it,i)=>({n:i+1,key:it.key,count:it.count,samples:samples(it),esconder:MARK.has(i+1)})),null,1));
console.log('prancha',file);
