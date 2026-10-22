#!/usr/bin/env node
/**
 * Card NEW-20261022-ORQ-monstros-sem-deslizar: the enemies' walk, frame by frame, in the game's own horde renderer
 * (?sandbox=horda&elenco=1&andar=…: each enemy to and fro on its lane, the camera still). The page's game loop is put
 * to sleep and stepped by hand at a fixed 60 fps, so every rendered frame is recorded (screen point, sheet frame,
 * scale, origin) and, every `--cada` frames, a screenshot of `--clip` for the GIF. scripts/desliza-inimigos.mjs
 * --pixels measures the planted foot on screen from the log and the sheets' pixels.
 *
 *   node scripts/pes-inimigos-sandbox.mjs <out-prefix> --andar a,b,c [--url http://127.0.0.1:4266/] [--relogio]
 *        [--vel 0.35] [--rumo 1,0] [--quadros 240] [--cada 2] [--clip x,y,w,h]
 */
import {pathToFileURL} from 'node:url';import {join} from 'node:path';import {existsSync,writeFileSync,mkdirSync} from 'node:fs';
const arg=(n,d)=>{const i=process.argv.indexOf(`--${n}`);return i>0?process.argv[i+1]:d;};
const OUT=process.argv[2],BASE=arg('url','http://127.0.0.1:4266/'),ANDAR=arg('andar','bebado'),FRAMES=Number(arg('quadros',240)),EVERY=Number(arg('cada',2));
const query=`?sandbox=horda&n=0&elenco=1&hud=0&andar=${ANDAR}&vel=${arg('vel','0.35')}&rumo=${arg('rumo','1,0')}${process.argv.includes('--relogio')?'&relogio=1':''}`;
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const pwDir='D:/Gits/viagem-tools/node_modules/playwright';
const pw=await import(pathToFileURL(join(pwDir,existsSync(join(pwDir,'index.mjs'))?'index.mjs':'index.js')).href);
const chromium=pw.chromium??pw.default.chromium;let browser,release;
try{
  release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E6 monstros-sem-deslizar sandbox'});
  browser=await chromium.launch({args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']});
  const ctx=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1,serviceWorkers:'block'});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(BASE+query,{waitUntil:'load',timeout:120000});
  // Ready: every walker shows its imported walk sheet.
  await page.waitForFunction(n=>{const l=window.__horde?.scene?.layers;if(!l)return false;let k=0;for(const [,e] of l.enemies.entries)if(e.item.image.texture.key.startsWith('art:enemy:'))k++;return k>=n;},ANDAR.split(',').length,{timeout:120000});
  await page.waitForTimeout(1500);
  await page.evaluate(()=>{const g=window.__horde.game;g.loop.sleep();window.__t=g.loop.now||performance.now();});
  const [cx,cy,cw,ch]=(arg('clip','0,0,1280,720')).split(',').map(Number),clip={x:cx,y:cy,width:cw,height:ch};
  mkdirSync(`${OUT}-quadros`,{recursive:true});
  const rows=[];let zoom=1;
  for(let f=0;f<FRAMES;f++){
    const r=await page.evaluate(f=>{
      const H=window.__horde,g=H.game,s=H.scene,cam=s.cameras.main;window.__t+=1000/60;g.step(window.__t,1000/60);
      const out=[];
      for(const [id,e] of s.layers.enemies.entries){const a=e.item,im=a.image;if(!im.visible)continue;
        out.push([+(f*1000/60).toFixed(2),id,a.art,a.kind,+a.x.toFixed(5),+a.y.toFixed(5),+((im.x-cam.worldView.x)*cam.zoom).toFixed(3),+((im.y-cam.worldView.y)*cam.zoom).toFixed(3),im.texture.key,Number(im.frame.name),+(im.scaleY*cam.zoom).toFixed(5),a.moving?1:0,a.elite?1:0,im.originX,im.originY,im.frame.width]);}
      return {out,zoom:cam.zoom};
    },f);
    rows.push(...r.out);zoom=r.zoom;
    if(f%EVERY===0)await page.screenshot({path:`${OUT}-quadros/${String(f/EVERY).padStart(4,'0')}.png`,clip});
  }
  writeFileSync(`${OUT}.json`,JSON.stringify({zoom,view:0,query,fps:60,rows}));
  console.log('quadros',FRAMES,'linhas',rows.length,'zoom',zoom.toFixed(3),'erros',errors.length,errors.slice(0,2).join(' | '));
}finally{await browser?.close();release?.();}
