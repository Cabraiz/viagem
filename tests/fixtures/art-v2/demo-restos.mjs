/**
 * DEMO "restos" art v2 (NEW-20261012-ORQ-importar-arte-d-restos items 3–6): REAL sizes, SYNTHETIC look. Every piece is
 * loud on purpose (neon colours, a black "X" or bars) so a print shows the wiring and never passes for finished art:
 *  - projeteis/tiro-inimigo.png 4 × 32×32: a red disc with a yellow bar that turns (any hostile shot without its own art).
 *  - efeitos/seta-investida.png 4 × 64×64: a lime chevron pointing right (+x) with a black edge; its tip blinks magenta.
 *  - efeitos/aviso-explosao.png 8 × 128×128: magenta and cyan target rings; the inner ring grows frame by frame.
 *  - efeitos/arroto.png 6 × 192×128: a lime cloud flowing right with violet polka dots that drift.
 *  - efeitos/olhos-escuro.png 4 × 64×32: two orange eyes with black pupils; frames 1–3 close them (blink).
 *  - efeitos/morte-poof.png 8 × 128×128: a cyan ring that grows and thins, white stars inside (no poof is cyan).
 * No sidecars: every cell comes from scripts/art-v2/spec.mjs.
 *
 *   node tests/fixtures/art-v2/demo-restos.mjs <pasta>     then: node scripts/import-art-v2.mjs --dry-run --input <pasta>
 */
import sharp from 'sharp';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

/** What writeDemoRestos writes, by group (every one must be approved by the importer). */
export const DEMO_RESTOS=Object.freeze({
  projeteis:Object.freeze(['tiro-inimigo']),
  efeitos:Object.freeze(['seta-investida','aviso-explosao','arroto','olhos-escuro','morte-poof']),
});

const INK=[20,10,30,255],LIME=[120,255,40,255],PINK=[255,40,200,255],CYAN=[0,230,255,255],RED=[235,20,40,255],
  YELLOW=[255,230,0,255],ORANGE=[255,140,0,255],VIOLET=[150,60,255,255],WHITE=[245,245,245,255];

async function save(file,width,height,paint){
  const data=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const c=paint(x,y);if(c)data.set(c,(y*width+x)*4);}
  mkdirSync(path.dirname(file),{recursive:true});
  await sharp(data,{raw:{width,height,channels:4}}).png({compressionLevel:6}).toFile(file);
}
/** Strip of `frames` cells of w×h: cell(f, x, y) paints in the cell's own coordinates. */
const strip=(file,[w,h],frames,cell)=>save(file,w*frames,h,(x,y)=>cell(Math.floor(x/w),x%w,y));

/** Writes the demo under `dir` (the `arte-entrada/` layout). Returns DEMO_RESTOS. */
export async function writeDemoRestos(dir){
  const fx=path.join(dir,'efeitos');
  await strip(path.join(dir,'projeteis','tiro-inimigo.png'),[32,32],4,(f,x,y)=>{
    const dx=x-15.5,dy=y-15.5,d=Math.hypot(dx,dy);if(d>12)return undefined;if(d>10)return INK;
    const a=f*Math.PI/4,along=Math.abs(-dx*Math.sin(a)+dy*Math.cos(a));
    return along<3?YELLOW:RED;
  });
  await strip(path.join(fx,'seta-investida.png'),[64,64],4,(f,x,y)=>{
    // A ">" 14 px thick: |y−32| + (44−x) within the band, tip at x = 56.
    const v=Math.abs(y-31.5)+(56-x);if(x<6||x>58||y<6||y>57)return undefined;
    if(v<0||v>22)return undefined;
    if(v<3||v>19)return INK;
    return x>46&&f%2?PINK:LIME;
  });
  await strip(path.join(fx,'aviso-explosao.png'),[128,128],8,(f,x,y)=>{
    const d=Math.hypot(x-63.5,y-63.5);if(d>58)return undefined;
    if(d>52)return PINK;if(d>48)return INK;
    const r=10+f*5;if(Math.abs(d-r)<4)return CYAN;
    if(Math.abs(x-63.5)<2||Math.abs(y-63.5)<2)return INK;
    return undefined;
  });
  await strip(path.join(fx,'arroto.png'),[192,128],6,(f,x,y)=>{
    // A cloud widening to the right, from the mouth at the left edge.
    const k=(x-6)/180;if(k<0||k>1)return undefined;
    const half=12+46*k+4*Math.sin(x*.18+f);if(Math.abs(y-63.5)>half)return undefined;
    if(Math.abs(y-63.5)>half-3)return INK;
    const px=(x+f*8)%24,py=y%24;return (px-12)**2+(py-12)**2<25?VIOLET:LIME;
  });
  await strip(path.join(fx,'olhos-escuro.png'),[64,32],4,(f,x,y)=>{
    const open=[1,.5,.12,.5][f];
    for(const cx of [19.5,44.5]){
      const dx=(x-cx)/10,dy=(y-15.5)/(11*open);
      if(dx*dx+dy*dy<=1)return Math.hypot(x-cx,y-15.5)<4&&open>.3?INK:ORANGE;
      if(Math.abs(dx)<=1.2&&Math.abs(y-15.5)<=11*open+2)return INK;
    }
    return undefined;
  });
  await strip(path.join(fx,'morte-poof.png'),[128,128],8,(f,x,y)=>{
    const d=Math.hypot(x-63.5,y-63.5),r=14+f*5.5,t=Math.max(2,12-f*1.3);
    if(Math.abs(d-r)<t/2)return CYAN;
    const a=Math.atan2(y-63.5,x-63.5),star=Math.abs(Math.sin(a*5))*.5+.5;
    return d<r*.45*star&&f<6?WHITE:undefined;
  });
  return DEMO_RESTOS;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const dir=process.argv[2];
  if(!dir){console.error('Uso: node tests/fixtures/art-v2/demo-restos.mjs <pasta>');process.exitCode=2;}
  else{
    const pieces=await writeDemoRestos(path.resolve(dir));
    console.log(`Restos de demonstração (sintéticos) em ${path.resolve(dir)}:`);
    for(const [group,ids] of Object.entries(pieces))console.log(`  ${group}: ${ids.join(', ')}`);
  }
}
