#!/usr/bin/env node
/**
 * BUG-20261022-ORQ-arma-flutua-corrida-clt, 2nd batch: the bots' attack fists marked by eye (the CLT_KEYS method of
 * scripts/hand-points.mjs: the tracking loses a punch, the hand tone also lights a shirt or a glove-grey vest).
 *
 *   node scripts/hand-mark.mjs grid <id> <sheetA> <sheetB> <out.png>
 *     two sheets stacked (A: rows 1-2, B: rows 3-4), poses 0, 8, … 120 at 4x on a 96 px cell grid (lines every 4 px,
 *     labels every 8), the current hand (magenta ring) and the keys already marked (green cross). 2080×1360 px: read it
 *     at 2000 px wide (the Read tool shows it so).
 *   node scripts/hand-mark.mjs keys <id> <sheetA> <sheetB> "X,Y X,Y …"
 *     32 points read on that 2000 px wide picture, in tile order (16 for A then 16 for B; "-" skips a tile): the fist
 *     of the weapon hand (the one that throws the punch) → scripts/hand-keys/<id>.json. Then run `grid` again and
 *     check the green crosses sit on the fists.
 *   node scripts/hand-mark.mjs side <id> <sheet> behind|front
 *     W/E (and any sheet) whose punch is thrown by the far hand: the weapon goes behind the body (the CLT's W and E).
 *
 * Then `node scripts/hand-points.mjs --ids <id>` measures the sheet guided by the keys (guided(): each pose slides onto
 * the hand tone within 6 px of the keys' line).
 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sharp=createRequire(path.join(ROOT,'package.json'))('sharp');
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'public/art/manifest.json'),'utf8'));
const DATA=path.join(ROOT,'src/client/sprites/hand-points-data.ts');
const KEYS_DIR=path.join(ROOT,'scripts/hand-keys');
const K=4,X0=16,Y0=4,W=64,H=84,STEP=8,TW=W*K+4,TH=H*K+4,SHOWN=2000/(8*TW);

const keysFile=id=>path.join(KEYS_DIR,`${id}.json`);
const readKeys=id=>fs.existsSync(keysFile(id))?JSON.parse(fs.readFileSync(keysFile(id),'utf8')):{};
const writeKeys=(id,all)=>{
  fs.mkdirSync(KEYS_DIR,{recursive:true});
  const names=Object.keys(all).sort();
  fs.writeFileSync(keysFile(id),'{\n'+names.map(n=>`${JSON.stringify(n)}:${JSON.stringify(all[n])}`).join(',\n')+'\n}\n');
};
const table=()=>{const s=fs.readFileSync(DATA,'utf8');return JSON.parse(s.slice(s.indexOf('=',s.indexOf('HAND_POINTS'))+1).replace(/;\s*$/,''));};

async function sheetGrid(id,name){
  const f=manifest.groups.personagens.pieces[id].files[name].file,file=path.join(ROOT,'public/art/sprites',f);
  const sheet=table()[f],keys=readKeys(id)[name]?.keys??{};
  const {width}=await sharp(file).metadata(),cols=width/96,tiles=[];
  for(let k=0;k<128/STEP;k++){
    const i=k*STEP;
    const cell=await sharp(file).extract({left:(i%cols)*96+X0,top:Math.floor(i/cols)*96+Y0,width:W,height:H}).resize(W*K,H*K,{kernel:'nearest'}).flatten({background:'#d8efe0'}).toBuffer();
    let g='';
    for(let x=Math.ceil(X0/4)*4;x<X0+W;x+=4)g+=`<line x1="${(x-X0)*K}" y1="0" x2="${(x-X0)*K}" y2="${H*K}" stroke="${x%8?'#0002':'#0005'}"/>`+(x%8?'':`<text x="${(x-X0)*K+1}" y="${H*K-2}" font-size="10" font-family="Arial" fill="#036">${x}</text>`);
    for(let y=Math.ceil(Y0/4)*4;y<Y0+H;y+=4)g+=`<line x1="0" y1="${(y-Y0)*K}" x2="${W*K}" y2="${(y-Y0)*K}" stroke="${y%8?'#0002':'#0005'}"/>`+(y%8?'':`<text x="1" y="${(y-Y0)*K-1}" font-size="10" font-family="Arial" fill="#036">${y}</text>`);
    const p=sheet?.points[i],q=keys[i];
    const svg=`<svg width="${W*K}" height="${H*K}">${g}<text x="${W*K-90}" y="14" font-size="13" font-family="Arial" fill="#c00">${name.replace('attack128-','')} #${i}</text>`+
      (q?`<path d="M${(q[0]-X0)*K-6} ${(q[1]-Y0)*K}h12M${(q[0]-X0)*K} ${(q[1]-Y0)*K-6}v12" stroke="#0a0" stroke-width="3"/>`:'')+
      (p?`<circle cx="${(p[0]-X0)*K}" cy="${(p[1]-Y0)*K}" r="5" fill="none" stroke="#e0f" stroke-width="2"/>`:'')+'</svg>';
    tiles.push({input:await sharp(cell).composite([{input:Buffer.from(svg)}]).png().toBuffer(),left:(k%8)*TW,top:Math.floor(k/8)*TH});
  }
  return sharp({create:{width:8*TW,height:2*TH,channels:3,background:'#000'}}).composite(tiles).png().toBuffer();
}

const [cmd,id,a,b,arg]=process.argv.slice(2);
if(cmd==='grid'){
  const [ga,gb]=await Promise.all([sheetGrid(id,a),sheetGrid(id,b)]);
  await sharp({create:{width:8*TW,height:4*TH,channels:3,background:'#000'}}).composite([{input:ga,left:0,top:0},{input:gb,left:0,top:2*TH}]).png().toFile(arg);
  console.log('wrote',arg);
}else if(cmd==='keys'){
  const xs=arg.trim().split(/\s+/);
  if(xs.length!==32)throw new Error(`32 points (16 per sheet), got ${xs.length}`);
  const all=readKeys(id);
  for(const [s,name] of [a,b].entries()){
    const keys={};
    xs.slice(s*16,s*16+16).forEach((xy,k)=>{
      if(xy==='-')return;
      const [X,Y]=xy.split(',').map(Number),dx=X/SHOWN-(k%8)*TW,dy=Y/SHOWN-(Math.floor(k/8)+2*s)*TH;
      keys[k*STEP]=[Math.round((X0+dx/K)*10)/10,Math.round((Y0+dy/K)*10)/10];
    });
    all[name]={...all[name],keys};
    console.log(id,name,JSON.stringify(keys));
  }
  writeKeys(id,all);
}else if(cmd==='side'){
  const all=readKeys(id);all[a]={...all[a],behind:b==='behind'};writeKeys(id,all);console.log(id,a,all[a].behind);
}else{
  console.log('node scripts/hand-mark.mjs grid|keys|side … (see the header)');process.exit(1);
}
