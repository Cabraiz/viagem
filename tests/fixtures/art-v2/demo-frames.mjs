/**
 * DEMO 9-slice frames and ground marks, art v2 (NEW-20261012-ORQ-importar-arte-c-completa items 3 and 5): REAL sizes,
 * SYNTHETIC look. Every piece is loud on purpose (neon magenta, lime, cyan, warning stripes) so a print shows the wiring
 * and never passes for finished art. Sizes from scripts/art-v2/spec.mjs `expected`; the 9-slices carry the sidecar
 * `slice` the importer requires, with an explicit `"kind":"nineslice"` (a sidecar without `kind` would keep the table's
 * kind and cell too, validate.mjs withExpected) and, for the plaque, its `cell` (the table has none):
 *  - efeitos/balao-fala.png 74×28 (slice 10): pink body, thick lime edge, cyan stripes in the stretching middle.
 *  - efeitos/etiqueta-devendo.png 96×64 (slice 14): red body with a yellow/black warning-striped edge.
 *  - efeitos/barra-vida-moldura(-elite).png 64×12 (slice 4): magenta (elite: orange with notches) frame, hollow.
 *  - efeitos/barra-vida-preenchimento(-elite).png 64×12 (slice 3): near-white fill with dark ticks (the game tints it).
 *  - efeitos/anel-alvo, anel-habilidade, marcador-destino.png 4 × 128×128: a 2:1 neon ellipse, a dot that walks a
 *    quarter turn per frame (the frame is visible in a print).
 *  - efeitos/heroi-voce.png 128×128: a violet/lime dashed 2:1 ring (the beak stays drawn by the game).
 *  - efeitos/aviso-spawn.png 6 × 128×128: an orange disc on the ground pulsing in size, black "!" bar.
 *  - efeitos/caido-resgate.png 6 × 128×256: a lime ring in the bottom square (centre at 0.75 of the height) and a
 *    cyan column rising from it, brightening frame by frame.
 *  - cenario/props/plaquinha.png 48×32 (slice 8): teal plate with a hot-pink edge and corner studs.
 *
 *   node tests/fixtures/art-v2/demo-frames.mjs <pasta>     then: node scripts/import-art-v2.mjs --dry-run --input <pasta>
 */
import sharp from 'sharp';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

/** What writeDemoFrames writes, by group (every one must be approved by the importer). */
export const DEMO_FRAMES=Object.freeze({
  efeitos:Object.freeze(['balao-fala','etiqueta-devendo','barra-vida-moldura','barra-vida-preenchimento','barra-vida-moldura-elite',
    'barra-vida-preenchimento-elite','anel-alvo','anel-habilidade','marcador-destino','heroi-voce','aviso-spawn','caido-resgate']),
  props:Object.freeze(['plaquinha']),
});
/** Sidecars by piece: 9-slice insets [left, top, right, bottom] (and the plaque's cell). */
export const DEMO_FRAME_SIDECARS=Object.freeze({
  'balao-fala':{kind:'nineslice',slice:[10,10,10,10]},'etiqueta-devendo':{kind:'nineslice',slice:[14,14,14,14]},
  'barra-vida-moldura':{kind:'nineslice',slice:[4,4,4,4]},'barra-vida-moldura-elite':{kind:'nineslice',slice:[4,4,4,4]},
  'barra-vida-preenchimento':{kind:'nineslice',slice:[3,3,3,3]},'barra-vida-preenchimento-elite':{kind:'nineslice',slice:[3,3,3,3]},
  plaquinha:{kind:'nineslice',cell:[48,32],slice:[8,8,8,8]},
});

const PINK=[255,40,200,255],LIME=[120,255,40,255],CYAN=[0,230,255,255],RED=[235,20,40,255],YELLOW=[255,230,0,255],
  INK=[20,10,30,255],ORANGE=[255,140,0,255],VIOLET=[150,60,255,255],WHITE=[245,245,245,255],TEAL=[0,170,160,255];

/** Writes a width×height PNG whose pixel (x, y) is paint(x, y) (RGBA array) or transparent (undefined). */
async function save(file,width,height,paint){
  const data=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const c=paint(x,y);if(c)data.set(c,(y*width+x)*4);}
  mkdirSync(path.dirname(file),{recursive:true});
  await sharp(data,{raw:{width,height,channels:4}}).png({compressionLevel:6}).toFile(file);
}
const json=(file,value)=>{mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,`${JSON.stringify(value,null,2)}\n`);};
/** Inside a rounded rectangle [x0,x1]×[y0,y1] with corner radius r. */
function inRound(x,y,x0,y0,x1,y1,r){
  if(x<x0||x>x1||y<y0||y>y1)return false;
  const cx=Math.min(Math.max(x,x0+r),x1-r),cy=Math.min(Math.max(y,y0+r),y1-r);
  return (x-cx)**2+(y-cy)**2<=r*r;
}
/** Strip of `frames` cells of w×h: cell(f, x, y) paints in the cell's own coordinates. */
const strip=(file,[w,h],frames,cell)=>save(file,w*frames,h,(x,y)=>cell(Math.floor(x/w),x%w,y));
/** Distance-from-ellipse ring test, 2:1 (the game camera), centre (cx, cy), radius rx, thickness t. */
const onRing=(x,y,cx,cy,rx,t)=>{const d=Math.hypot((x-cx)/rx,(y-cy)/(rx/2));return Math.abs(d-1)*rx<=t/2;};

/** Writes the demo under `dir` (the `arte-entrada/` layout). Returns DEMO_FRAMES. */
export async function writeDemoFrames(dir){
  const fx=path.join(dir,'efeitos'),props=path.join(dir,'cenario','props');
  // Speech balloon (body only, edge to edge): pink body, lime edge (4 px), cyan diagonal stripes only in the middle.
  await save(path.join(fx,'balao-fala.png'),74,28,(x,y)=>{
    if(!inRound(x,y,0,0,73,27,8))return;
    if(!inRound(x,y,4,4,69,23,5))return LIME;
    return x>10&&x<63&&y>10&&y<17&&(x+y)%10<3?CYAN:PINK;
  });
  // "DEVENDO" tag: red body, yellow/black striped edge.
  await save(path.join(fx,'etiqueta-devendo.png'),96,64,(x,y)=>{
    if(!inRound(x,y,1,1,94,62,10))return;
    if(!inRound(x,y,8,8,87,55,5))return (x+y)%12<6?YELLOW:INK;
    return RED;
  });
  // Life bar frames: hollow (the fill shows through), 3 px edge; the elite one with notches on top.
  const frame=(edge,notch)=>(x,y)=>{
    const border=x<3||x>60||y<3||y>8;
    if(!border)return undefined;
    if(notch&&y<3&&x%8>=4)return undefined;
    return edge;
  };
  await save(path.join(fx,'barra-vida-moldura.png'),64,12,frame(PINK,false));
  await save(path.join(fx,'barra-vida-moldura-elite.png'),64,12,frame(ORANGE,true));
  // Fills: near white (the game tints by hp), dark ticks every 6 px so the stretch is visible; a 1 px clear rim.
  const fill=tick=>(x,y)=>x<1||x>62||y<1||y>10?undefined:x%6===0?tick:WHITE;
  await save(path.join(fx,'barra-vida-preenchimento.png'),64,12,fill(INK));
  await save(path.join(fx,'barra-vida-preenchimento-elite.png'),64,12,fill(VIOLET));
  // Rings (4 frames): a 2:1 neon ellipse and a dot walking a quarter turn per frame.
  const ring=(color,dot)=>(f,x,y)=>{
    const a=f*Math.PI/2,dx=64+Math.cos(a)*50,dy=64+Math.sin(a)*25;
    if((x-dx)**2+(y-dy)**2<=64)return dot;
    return onRing(x,y,64,64,54,8)?color:undefined;
  };
  await strip(path.join(fx,'anel-alvo.png'),[128,128],4,ring(YELLOW,PINK));
  await strip(path.join(fx,'anel-habilidade.png'),[128,128],4,ring(CYAN,YELLOW));
  await strip(path.join(fx,'marcador-destino.png'),[128,128],4,(f,x,y)=>ring(LIME,PINK)(f,x,y)??((x-64)**2+(y-64)**2<=36?INK:undefined));
  // "Você" ring: violet with lime dashes.
  await strip(path.join(fx,'heroi-voce.png'),[128,128],1,(_f,x,y)=>onRing(x,y,64,64,54,10)?(Math.floor(Math.atan2(y-64,x-64)*6)%2?LIME:VIOLET):undefined);
  // Spawn warning (6 frames): an orange 2:1 disc pulsing in size with a black "!" bar.
  await strip(path.join(fx,'aviso-spawn.png'),[128,128],6,(f,x,y)=>{
    const r=36+[0,6,12,16,12,6][f];
    if(Math.abs(x-64)<=3&&y>=52&&y<=70)return INK;
    if(Math.abs(x-64)<=3&&y>=74&&y<=78)return INK;
    const d=Math.hypot((x-64)/r,(y-64)/(r/2));
    return d<=1?(d>.8?INK:ORANGE):undefined;
  });
  // Caído (6 frames, 128×256): lime ring centred at y 192 (0.75), cyan column rising, brighter each frame.
  await strip(path.join(fx,'caido-resgate.png'),[128,256],6,(f,x,y)=>{
    if(onRing(x,y,64,192,56,8))return LIME;
    if(Math.abs(x-64)<=10&&y>=8&&y<=192){const a=Math.round((60+f*30)*(y-8)/184);return a>0?[CYAN[0],CYAN[1],CYAN[2],a]:undefined;}
    return undefined;
  });
  // Name plaque: teal plate, hot-pink 3 px edge, yellow studs in the corners.
  await save(path.join(props,'plaquinha.png'),48,32,(x,y)=>{
    if(!inRound(x,y,0,0,47,31,6))return;
    if([[5,5],[42,5],[5,26],[42,26]].some(([cx,cy])=>(x-cx)**2+(y-cy)**2<=4))return YELLOW;
    return inRound(x,y,3,3,44,28,4)?TEAL:PINK;
  });
  for(const [id,sidecar] of Object.entries(DEMO_FRAME_SIDECARS))json(path.join(id==='plaquinha'?props:fx,`${id}.json`),sidecar);
  return DEMO_FRAMES;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const dir=process.argv[2];
  if(!dir){console.error('Uso: node tests/fixtures/art-v2/demo-frames.mjs <pasta>');process.exitCode=2;}
  else{
    const pieces=await writeDemoFrames(path.resolve(dir));
    console.log(`Molduras e marcas de demonstração (sintéticas) em ${path.resolve(dir)}:`);
    for(const [group,ids] of Object.entries(pieces))console.log(`  ${group}: ${ids.join(', ')}`);
    console.log(`Valide com: node scripts/import-art-v2.mjs --dry-run --input ${path.resolve(dir)}`);
  }
}
