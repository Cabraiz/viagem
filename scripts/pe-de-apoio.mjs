#!/usr/bin/env node
/**
 * Card NEW-20261022-ORQ-monstros-sem-deslizar: how far each enemy's planted foot slides on the ground, on screen, from
 * a frame-by-frame log of scripts/pes-inimigos-sandbox.mjs (screen point, sheet frame, scale and origin of every
 * enemy at every rendered frame) and the sheets' own pixels. Between two rendered frames the feet band (the lowest
 * 14 % of the figure) of the drawing shown is laid where the game put it on screen, and the shift that best lays the
 * one on the other is the planted foot's slide in that frame (0 = the foot stayed on its spot; while a drawing holds,
 * the whole drawing slides with the figure). Summed over the time a drawing stays up (until the next one shows), it is
 * the slide of the foot per drawn frame. Summed over a whole cycle (n drawn frames), the drift: what reads as gliding,
 * and what the walk's timing sets (the card asks ≤ 2 px); what stays per frame is the drawing's own jitter (generated
 * sheets rarely keep a foot on one spot from frame to frame), which only new art fixes. Also the cadence.
 *
 *   node scripts/pe-de-apoio.mjs <log.json> [--md out.md]
 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sharp=createRequire(path.join(ROOT,'package.json'))('sharp');
const group=JSON.parse(fs.readFileSync(path.join(ROOT,'public/art/manifest.json'),'utf8')).groups.inimigos,pieces=group.pieces;
const log=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const sheets=new Map(),masks=new Map();
async function mask(key,frame){
  const k=`${key}#${frame}`;if(masks.has(k))return masks.get(k);
  const [, , id,anim,p]=key.split(':'),file=pieces[id].files[anim],page=file.pages[p?Number(p.slice(1))-1:0],[cw,ch]=file.cell;
  let img=sheets.get(page.file);if(!img){img=await sharp(path.join(ROOT,group.output??'public/art/enemies',page.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});sheets.set(page.file,img);}
  const c=frame%page.columns,r=Math.floor(frame/page.columns),a=new Uint8Array(cw*ch);let top=ch,bottom=-1;
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){const o=img.data[((r*ch+y)*img.info.width+c*cw+x)*4+3]>128;if(o){a[y*cw+x]=1;if(y<top)top=y;if(y>bottom)bottom=y;}}
  const m={a,cw,ch,top,bottom,row:Math.floor((page.firstFrame+frame)/file.frames),frames:file.frames};masks.set(k,m);return m;
}
/**
 * Planted-foot slide (screen px) from rendered frame A to B, B drawn `o` cell px (ox, oy) further on screen than A: a
 * pixel u of A lands on B's pixel u + D; the best overlap of the feet bands picks D, and the foot moved (D + o) × scale.
 */
function slide(A,B,ox,oy,sc){
  const h=A.bottom-A.top+1,band=Math.max(4,Math.round(h*.14)),R=Math.ceil(Math.abs(ox))+Math.ceil(A.cw*.1);
  const pts=[];for(let y=A.bottom-band;y<=A.bottom;y++)for(let x=0;x<A.cw;x++)if(A.a[y*A.cw+x])pts.push(x,y);
  let best=-1,bs=Infinity;
  for(let dy=-2-Math.round(oy);dy<=2-Math.round(oy);dy++)for(let dx=-R;dx<=R;dx++){
    let n=0;
    for(let i=0;i<pts.length;i+=2){const X=pts[i]+dx,Y=pts[i+1]+dy;if(X>=0&&X<B.cw&&Y>=0&&Y<B.ch&&B.a[Y*B.cw+X])n++;}
    const s=dx+ox; // ties: the smaller slide (a foot that may have stayed is taken to have stayed)
    if(n>best||(n===best&&Math.abs(s)<Math.abs(bs))){best=n;bs=s;}
  }
  return bs*sc;
}
const by=new Map();for(const r of log.rows){if(!/:walk(:p\d+)?$/.test(r[8]))continue;(by.get(r[1])??by.set(r[1],[]).get(r[1])).push(r);}
const out=[];
for(const [id,rows] of by){
  const art=rows[0][2];let periods=[],cycles=[],win=[],acc=0,changes=0,started=false,prev;
  for(const r of rows){
    const m=await mask(r[8],r[9]);
    if(prev){
      // The game may draw the lite sheet (smaller cells): its scale is per lite px, the masks are the full sheet's.
      const [,,,,,,ax,ay,ak,af,lsc,,,,,fw]=prev.r,[,,,,,,bx,by_,bk,bf]=r,sc=lsc*(fw??prev.m.cw)/prev.m.cw;
      if(prev.m.row!==m.row){acc=0;started=false;win=[];prev={r,m};continue;} // turning at the end of the lane
      // B's cell point under A's cell point u: u − (P_b − P_a)/scale; the slide s: B's foot at u − o + s.
      const ox=(bx-ax)/sc,oy=(by_-ay)/sc;
      const d=slide(prev.m,m,ox,oy,sc);acc+=d;
      if(ak!==bk||af!==bf){changes++;if(started){periods.push(Math.abs(acc));win.push(acc);if(win.length>=m.frames){cycles.push(Math.abs(win.reduce((x,y)=>x+y,0)));win=[];}}started=true;acc=0;}
    }
    prev={r,m};
  }
  const secs=(rows.at(-1)[0]-rows[0][0])/1000,s=periods.sort((a,b)=>a-b);
  out.push({id,art,cps:changes/(rows.length?(pieces[art].files.walk.frames):1)/secs,n:s.length,med:s[s.length>>1]??NaN,p90:s[Math.floor(s.length*.9)]??NaN,max:s.at(-1)??NaN,scale:rows[0][10],cyc:cycles.sort((a,b)=>a-b),figure:0});
}
out.sort((a,b)=>a.art.localeCompare(b.art));
const lines=['| inimigo | ciclos/s | deriva do pé por ciclo: mediana px | máx px | ciclos medidos | tremido do desenho por quadro: mediana px | p90 px |','|---|---|---|---|---|---|---|'];
const f=v=>Number.isFinite(v)?v.toFixed(1):'—';
for(const o of out)lines.push(`| ${o.art} | ${o.cps.toFixed(2)} | ${f(o.cyc[o.cyc.length>>1])} | ${f(o.cyc.at(-1))} | ${o.cyc.length} | ${f(o.med)} | ${f(o.p90)} |`);
console.log(lines.join('\n'));
const i=process.argv.indexOf('--md');if(i>0)fs.writeFileSync(process.argv[i+1],lines.join('\n')+'\n');
const j=process.argv.indexOf('--json');if(j>0)fs.writeFileSync(process.argv[j+1],JSON.stringify(out,null,1));
