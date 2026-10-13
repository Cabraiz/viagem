/**
 * DEMO face avatars, art v2 (board design/PACOTE-ROSTOS.md): REAL size, SYNTHETIC look, so a print shows the wiring and
 * never passes for finished art. Each `rostos/<classe>-<expressão>.png` is 256×256, transparent, circle-safe (everything
 * inside the central circle of diameter 240, scripts/art-v2/spec.mjs FACE_CIRCLE): a flat disc in the class colour with
 * a thick ring in the expression colour, the class initials in big block letters and an expression glyph under them:
 *  - normal: green ring, smile;   ferido: orange ring, flat wavy mouth and a sweat drop;   caido: gray ring, two X eyes;
 *  - rindo: yellow ring, wide open mouth;   bravo: red ring, frown and angry brows.
 * Classes: cidadao-comum (all 5 expressions), mendigo (only normal), viciado-em-bet (normal and bravo).
 *
 *   node tests/fixtures/art-v2/demo-faces.mjs <pasta>     then: node scripts/import-art-v2.mjs --dry-run --input <pasta>
 */
import sharp from 'sharp';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const FACE_DEMO_SIZE=256,FACE_DEMO_RADIUS=118;
/** Expressions delivered per class. */
export const DEMO_FACE_SET=Object.freeze({
  'cidadao-comum':Object.freeze(['normal','ferido','caido','rindo','bravo']),
  mendigo:Object.freeze(['normal']),
  'viciado-em-bet':Object.freeze(['normal','bravo']),
});
/** What writeDemoFaces writes, by group (every one must be approved by the importer). */
export const DEMO_FACES=Object.freeze({rostos:Object.freeze(Object.entries(DEMO_FACE_SET).flatMap(([c,list])=>list.map(e=>`${c}-${e}`)))});

const CLASS_COLOURS={'cidadao-comum':[200,160,110],mendigo:[110,150,90],'viciado-em-bet':[160,110,210]};
const RING={normal:[40,190,70],ferido:[245,140,20],caido:[140,140,150],rindo:[255,215,0],bravo:[225,30,40]};
const INK=[20,18,24,255],WHITE=[255,255,255,255],SWEAT=[70,170,255,255];
/** 5×7 bitmap font: the initials this demo writes (other letters are left blank). */
const FONT={
  C:['.####','#....','#....','#....','#....','#....','.####'],M:['#...#','##.##','#.#.#','#.#.#','#...#','#...#','#...#'],
  V:['#...#','#...#','#...#','#...#','.#.#.','.#.#.','..#..'],B:['####.','#...#','#...#','####.','#...#','#...#','####.'],
};
/** Initials of a class id: first letter of its words, without linking words, at most 2 (cidadao-comum → CC). */
export const initials=id=>id.split('-').filter(w=>!['em','do','da','de'].includes(w)).map(w=>w[0].toUpperCase()).slice(0,2).join('');

const C=FACE_DEMO_SIZE/2;
/** Paints pixel (x, y) when its centre is inside the face disc (so nothing ever leaves the circle). */
function dot(data,x,y,rgba){
  if(x<0||y<0||x>=FACE_DEMO_SIZE||y>=FACE_DEMO_SIZE||Math.hypot(x+.5-C,y+.5-C)>FACE_DEMO_RADIUS)return;
  data.set(rgba,(y*FACE_DEMO_SIZE+x)*4);
}
function rect(data,x0,y0,x1,y1,rgba){for(let y=Math.round(y0);y<=Math.round(y1);y++)for(let x=Math.round(x0);x<=Math.round(x1);x++)dot(data,x,y,rgba);}
/** Thick stroke from (ax, ay) to (bx, by). */
function line(data,ax,ay,bx,by,w,rgba){
  const n=Math.ceil(Math.hypot(bx-ax,by-ay));
  for(let i=0;i<=n;i++){const t=n?i/n:0;rect(data,ax+(bx-ax)*t-w/2,ay+(by-ay)*t-w/2,ax+(bx-ax)*t+w/2,ay+(by-ay)*t+w/2,rgba);}
}
/** Arc of the circle (cx, cy, r) from angle a0 to a1 (radians, screen y down), `w` px thick. */
function arc(data,cx,cy,r,a0,a1,w,rgba){
  for(let k=0;k<=64;k++){const a=a0+(a1-a0)*k/64;rect(data,cx+Math.cos(a)*r-w/2,cy+Math.sin(a)*r-w/2,cx+Math.cos(a)*r+w/2,cy+Math.sin(a)*r+w/2,rgba);}
}
function text(data,str,cx,cy,scale,rgba){
  const w=str.length*6*scale-scale,h=7*scale,x0=Math.round(cx-w/2),y0=Math.round(cy-h/2);
  [...str].forEach((ch,k)=>(FONT[ch]??[]).forEach((row,ry)=>[...row].forEach((on,rx)=>{
    if(on==='#')rect(data,x0+k*6*scale+rx*scale,y0+ry*scale,x0+k*6*scale+(rx+1)*scale-1,y0+(ry+1)*scale-1,rgba);
  })));
}
/** Expression glyph centred at (C, 178). */
function glyph(data,expr){
  const y=178;
  if(expr==='normal')arc(data,C,y-22,30,Math.PI*.15,Math.PI*.85,8,INK);
  else if(expr==='rindo'){
    for(let yy=0;yy<=32;yy++)for(let xx=-38;xx<=38;xx++)if(xx*xx/(38*38)+yy*yy/(32*32)<=1)dot(data,C+xx,y-12+yy,INK);
    rect(data,C-30,y-12,C+30,y-6,WHITE);
  }else if(expr==='ferido'){
    for(let k=0;k<6;k++)line(data,C-36+k*12,y+(k%2?6:-6),C-24+k*12,y+(k%2?-6:6),6,INK);
    for(let yy=0;yy<=16;yy++)for(let xx=-8;xx<=8;xx++)if(Math.hypot(xx,yy-10)<=8||(yy<10&&Math.abs(xx)<=yy*.8))dot(data,C+62+xx,y-58+yy,SWEAT);
  }else if(expr==='caido'){
    for(const sx of [-1,1]){const x=C+sx*30;line(data,x-12,y-14,x+12,y+10,7,INK);line(data,x-12,y+10,x+12,y-14,7,INK);}
  }else if(expr==='bravo'){
    arc(data,C,y+22,30,-Math.PI*.85,-Math.PI*.15,8,INK);
    line(data,C-52,y-34,C-18,y-22,7,INK);line(data,C+52,y-34,C+18,y-22,7,INK);
  }
}

/** One face as raw RGBA (256×256, transparent outside the disc). */
export function drawFace(id,expr){
  const data=Buffer.alloc(FACE_DEMO_SIZE*FACE_DEMO_SIZE*4),fill=[...(CLASS_COLOURS[id]??[180,180,180]),255],ring=[...RING[expr],255];
  for(let y=0;y<FACE_DEMO_SIZE;y++)for(let x=0;x<FACE_DEMO_SIZE;x++){
    const d=Math.hypot(x+.5-C,y+.5-C);
    if(d<=FACE_DEMO_RADIUS)dot(data,x,y,d>FACE_DEMO_RADIUS-12?ring:fill);
  }
  text(data,initials(id),C,92,10,INK);
  glyph(data,expr);
  return data;
}

/** Writes the demo faces under `dir` (the `arte-entrada/` layout: `<dir>/rostos/<id>-<expr>.png`). Returns DEMO_FACES. */
export async function writeDemoFaces(dir){
  const out=path.join(dir,'rostos');
  mkdirSync(out,{recursive:true});
  for(const [id,list] of Object.entries(DEMO_FACE_SET))for(const expr of list)
    await sharp(drawFace(id,expr),{raw:{width:FACE_DEMO_SIZE,height:FACE_DEMO_SIZE,channels:4}}).png({compressionLevel:6})
      .toFile(path.join(out,`${id}-${expr}.png`));
  return DEMO_FACES;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const dir=process.argv[2];
  if(!dir){console.error('Uso: node tests/fixtures/art-v2/demo-faces.mjs <pasta>');process.exitCode=2;}
  else{
    await writeDemoFaces(path.resolve(dir));
    console.log(`Rostos de demonstração (sintéticos) em ${path.resolve(dir)}/rostos: ${DEMO_FACES.rostos.join(', ')}`);
  }
}
