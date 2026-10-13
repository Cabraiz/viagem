/**
 * DEMO art v2 delivery for the acceptance prints (NEW-20261012-ORQ-importar-arte-b): REAL sizes, SYNTHETIC look. Every
 * piece is obviously fake (flat colours, big letters) so a screenshot shows the game wiring, never "finished art":
 *  - inimigos/bebado: idle 6 + walk 8 frames, cell 128; inimigos/pombos: fly 6 frames, cell 96. One flat colour per
 *    direction (DIRECTION_COLORS) with the direction written on the body (S, SW, W…) and an arrow on the head pointing
 *    where the figure faces, so the 8 rows are recognisable; feet on the 0.88 line, centred, 2 px padding.
 *  - inimigos/elite/bebado-walk.png: the elite layer of the walk (a yellow paper crown over the head).
 *  - itens/gema-pequena and itens/coxinha (64×64, 4 frames), projeteis/chinelo (64×64, 6 frames), efeitos/morte-poof
 *    (128×128, 8 frames): no sidecar, sizes from the spec.mjs `expected` table.
 *  - ui: 6 icons and 2 stickers that exist today (128×128, bright glyphs).
 *
 *   node tests/fixtures/art-v2/demo.mjs <pasta>     then: node scripts/import-art-v2.mjs --input <pasta>
 */
import sharp from 'sharp';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DIRECTIONS,ANCHOR} from '../../../scripts/art-v2/spec.mjs';
import {DIRECTION_COLORS} from './make.mjs';

/** What the demo writes, by group (every one must be approved by the importer). */
export const DEMO_PIECES=Object.freeze({
  inimigos:Object.freeze(['bebado','pombos']),
  itens:Object.freeze(['gema-pequena','coxinha']),
  projeteis:Object.freeze(['chinelo']),
  efeitos:Object.freeze(['morte-poof']),
  ui:Object.freeze(['config','som','fechar','bussola','relogio','dado','banana','coxinha']),
});
export const DEMO_ENEMIES=Object.freeze({bebado:{cell:128,anims:{idle:6,walk:8}},pombos:{cell:96,anims:{fly:6}}});
/** UI glyph per id: [letter, colour]; stickers get a white outline. */
const UI_GLYPHS={config:['C',[255,90,40]],som:['S',[40,200,90]],fechar:['X',[230,40,80]],bussola:['N',[40,140,255]],
  relogio:['R',[255,190,20]],dado:['D',[170,70,240]],banana:['B',[255,225,40]],coxinha:['C',[240,140,40]]};
const STICKERS=new Set(['banana','coxinha']);
/** Screen vector each direction faces (S = towards the camera = down). */
const FACING={S:[0,1],SW:[-1,1],W:[-1,0],NW:[-1,-1],N:[0,-1],NE:[1,-1],E:[1,0],SE:[1,1]};

// ---------------------------------------------------------------- raw RGBA drawing
const canvas=(width,height)=>({width,height,data:Buffer.alloc(width*height*4)});
/** Paints one pixel when inside the clip rectangle [x0,x1]×[y0,y1] (default: the image). */
function dot(img,x,y,[r,g,b,a=255],clip){
  x=Math.round(x);y=Math.round(y);
  const [x0,y0,x1,y1]=clip??[0,0,img.width-1,img.height-1];
  if(x<x0||x>x1||y<y0||y>y1)return;
  const i=(y*img.width+x)*4;img.data[i]=r;img.data[i+1]=g;img.data[i+2]=b;img.data[i+3]=a;
}
function rect(img,x0,y0,x1,y1,rgba,clip){for(let y=Math.round(y0);y<=Math.round(y1);y++)for(let x=Math.round(x0);x<=Math.round(x1);x++)dot(img,x,y,rgba,clip);}
function ellipse(img,cx,cy,rx,ry,rgba,clip){
  for(let y=Math.floor(cy-ry);y<=Math.ceil(cy+ry);y++)for(let x=Math.floor(cx-rx);x<=Math.ceil(cx+rx);x++)
    if(((x-cx)/rx)**2+((y-cy)/ry)**2<=1)dot(img,x,y,rgba,clip);
}
const disc=(img,cx,cy,r,rgba,clip)=>ellipse(img,cx,cy,r,r,rgba,clip);
/** Thick line from (ax,ay) to (bx,by). */
function line(img,ax,ay,bx,by,thick,rgba,clip){
  const n=Math.ceil(Math.hypot(bx-ax,by-ay))*2;
  for(let k=0;k<=n;k++)disc(img,ax+(bx-ax)*k/n,ay+(by-ay)*k/n,thick/2,rgba,clip);
}
/** Filled triangle. */
function triangle(img,[ax,ay],[bx,by],[cx,cy],rgba,clip){
  const side=(px,py,qx,qy,x,y)=>(qx-px)*(y-py)-(qy-py)*(x-px);
  for(let y=Math.floor(Math.min(ay,by,cy));y<=Math.ceil(Math.max(ay,by,cy));y++)for(let x=Math.floor(Math.min(ax,bx,cx));x<=Math.ceil(Math.max(ax,bx,cx));x++){
    const s1=side(ax,ay,bx,by,x,y),s2=side(bx,by,cx,cy,x,y),s3=side(cx,cy,ax,ay,x,y);
    if((s1>=0&&s2>=0&&s3>=0)||(s1<=0&&s2<=0&&s3<=0))dot(img,x,y,rgba,clip);
  }
}
/** 5×7 bitmap font: only the letters the demo writes. */
const FONT={
  S:['.####','#....','#....','.###.','....#','....#','####.'],W:['#...#','#...#','#...#','#.#.#','#.#.#','##.##','#...#'],
  N:['#...#','##..#','#.#.#','#..##','#...#','#...#','#...#'],E:['#####','#....','#....','####.','#....','#....','#####'],
  C:['.####','#....','#....','#....','#....','#....','.####'],X:['#...#','#...#','.#.#.','..#..','.#.#.','#...#','#...#'],
  R:['####.','#...#','#...#','####.','#.#..','#..#.','#...#'],D:['####.','#...#','#...#','#...#','#...#','#...#','####.'],
  B:['####.','#...#','#...#','####.','#...#','#...#','####.'],
};
/** Writes `text` centred on (cx, cy), `scale` px per font pixel. */
function text(img,str,cx,cy,scale,rgba,clip){
  const w=str.length*5*scale+(str.length-1)*scale,h=7*scale,x0=Math.round(cx-w/2),y0=Math.round(cy-h/2);
  [...str].forEach((ch,k)=>FONT[ch].forEach((row,ry)=>[...row].forEach((on,rx)=>{
    if(on==='#')rect(img,x0+k*6*scale+rx*scale,y0+ry*scale,x0+k*6*scale+(rx+1)*scale-1,y0+(ry+1)*scale-1,rgba,clip);
  })));
}
const tint=([r,g,b],k)=>[r+(255-r)*k,g+(255-g)*k,b+(255-b)*k].map(Math.round);
const shade=([r,g,b],k)=>[r*k,g*k,b*k].map(Math.round);
const INK=[20,18,24];
async function save(img,file){
  mkdirSync(path.dirname(file),{recursive:true});
  await sharp(img.data,{raw:{width:img.width,height:img.height,channels:4}}).png({compressionLevel:6}).toFile(file);
}
const json=(file,value)=>{mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,`${JSON.stringify(value,null,2)}\n`);};
/** Arrow inside a head disc, pointing where direction `d` faces. */
function arrow(img,cx,cy,len,d,clip){
  const [vx,vy]=FACING[d],n=Math.hypot(vx,vy),ux=vx/n,uy=vy/n,tx=cx+ux*len,ty=cy+uy*len;
  line(img,cx-ux*len*.6,cy-uy*len*.6,tx-ux*3,ty-uy*3,3,[...INK,255],clip);
  triangle(img,[tx+ux*2,ty+uy*2],[tx-ux*6-uy*5,ty-uy*6+ux*5],[tx-ux*6+uy*5,ty-uy*6-ux*5],[...INK,255],clip);
}

// ---------------------------------------------------------------- enemies
/** Bebado cell: feet on round(0.88 × cell), centred; walk lifts the feet alternately; body bobs. */
function drawWalker(img,left,top,cell,d,anim,f){
  const clip=[left+2,top+2,left+cell-3,top+cell-3],cx=left+(cell-1)/2,foot=top+Math.round(ANCHOR[1]*cell),colour=DIRECTION_COLORS[d];
  const lift=anim==='walk'?[0,2,4,2,0,0,0,0]:[0,0,0,0,0,0];
  const lf=lift[f%lift.length],rf=lift[(f+4)%lift.length],bob=anim==='walk'?(f%2):[0,0,1,1,1,0][f%6];
  // feet (one always on the line)
  rect(img,cx-15,foot-14-lf,cx-4,foot-lf,[...shade(colour,.55),255],clip);
  rect(img,cx+4,foot-14-rf,cx+15,foot-rf,[...shade(colour,.55),255],clip);
  // body with the direction written on it
  ellipse(img,cx,top+70+bob,25,32,[...colour,255],clip);
  text(img,d,cx,top+70+bob,d.length>1?3:4,[...INK,255],clip);
  // head with the facing arrow
  disc(img,cx,top+28+bob,14,[...tint(colour,.55),255],clip);
  arrow(img,cx,top+28+bob,10,d,clip);
}
/** Pombo cell (96): body, head with arrow, flapping wings, small legs on the foot line. */
function drawPigeon(img,left,top,cell,d,f){
  const clip=[left+2,top+2,left+cell-3,top+cell-3],cx=left+(cell-1)/2,foot=top+Math.round(ANCHOR[1]*cell),colour=DIRECTION_COLORS[d];
  const flap=[-14,-8,0,6,0,-8][f%6];
  rect(img,cx-7,foot-7,cx-4,foot,[...INK,255],clip);rect(img,cx+4,foot-7,cx+7,foot,[...INK,255],clip);
  ellipse(img,cx-31,top+52+flap,14,6,[...shade(colour,.7),255],clip);
  ellipse(img,cx+31,top+52+flap,14,6,[...shade(colour,.7),255],clip);
  ellipse(img,cx,top+62,28,17,[...colour,255],clip);
  text(img,d,cx,top+62,2,[...INK,255],clip);
  disc(img,cx,top+34,11,[...tint(colour,.55),255],clip);
  arrow(img,cx,top+34,8,d,clip);
}
async function enemySheet(file,cell,frames,draw){
  const img=canvas(cell*frames,cell*DIRECTIONS.length);
  DIRECTIONS.forEach((d,r)=>{for(let f=0;f<frames;f++)draw(img,f*cell,r*cell,d,f);});
  await save(img,file);
}
/** Elite crown over the bebado head (same grid as walk), following the walk bob. */
async function eliteCrown(file,cell,frames){
  const img=canvas(cell*frames,cell*DIRECTIONS.length),gold=[250,210,30,255];
  DIRECTIONS.forEach((d,r)=>{for(let f=0;f<frames;f++){
    const left=f*cell,top=r*cell,cx=left+(cell-1)/2,bob=f%2,clip=[left+2,top+2,left+cell-3,top+cell-3];
    rect(img,cx-13,top+11+bob,cx+13,top+15+bob,gold,clip);
    for(const k of [-1,0,1])triangle(img,[cx+k*10-6,top+12+bob],[cx+k*10+6,top+12+bob],[cx+k*10,top+3+bob],gold,clip);
  }});
  await save(img,file);
}

// ---------------------------------------------------------------- items, projectiles, effects, ui
async function strip(file,cell,frames,draw){
  const img=canvas(cell*frames,cell);
  for(let f=0;f<frames;f++)draw(img,f*cell,f,[f*cell+2,2,f*cell+cell-3,cell-3]);
  await save(img,file);
}
async function icon(file,id){
  const img=canvas(128,128),[letter,colour]=UI_GLYPHS[id],c=63.5;
  if(STICKERS.has(id)){disc(img,c,c,58,[255,255,255,255]);disc(img,c,c,50,[...colour,255]);text(img,letter,c,c,10,[...INK,255]);}
  else{disc(img,c,c,56,[...colour,255]);text(img,letter,c,c,11,[255,255,255,255]);}
  await save(img,file);
}

/**
 * Writes the demo delivery under `dir` (the `arte-entrada/` layout). `repoRoot` is accepted for symmetry with
 * makeCorrectSet (the demo has no player sheet). Returns DEMO_PIECES.
 */
export async function makeDemoDelivery(dir,{repoRoot}={}){
  void repoRoot;
  const enemies=path.join(dir,'inimigos');
  for(const [id,{cell,anims}] of Object.entries(DEMO_ENEMIES)){
    for(const [anim,frames] of Object.entries(anims))await enemySheet(path.join(enemies,id,`${anim}.png`),cell,frames,
      id==='pombos'?(img,l,t,d,f)=>drawPigeon(img,l,t,cell,d,f):(img,l,t,d,f)=>drawWalker(img,l,t,cell,d,anim,f));
    json(path.join(enemies,id,'meta.json'),{cell:[cell,cell],anchor:[...ANCHOR],fps:Object.fromEntries(Object.keys(anims).map(a=>[a,a==='idle'?6:10]))});
  }
  await eliteCrown(path.join(enemies,'elite','bebado-walk.png'),128,DEMO_ENEMIES.bebado.anims.walk);

  await strip(path.join(dir,'itens','gema-pequena.png'),64,4,(img,l,f,clip)=>{
    const c=l+31.5;
    triangle(img,[c,14],[c-14,32],[c+14,32],[60,220,255,255],clip);triangle(img,[c-14,32],[c+14,32],[c,50],[30,150,230,255],clip);
    disc(img,c+8,22,2+f,[255,255,255,255],clip);
  });
  await strip(path.join(dir,'itens','coxinha.png'),64,4,(img,l,f,clip)=>{
    const c=l+31.5,bob=[0,-1,-2,-1][f];
    disc(img,c,40+bob,15,[230,140,40,255],clip);triangle(img,[c-13,34+bob],[c+13,34+bob],[c,10+bob],[230,140,40,255],clip);
    text(img,'C',c,38+bob,2,[...INK,255],clip);
  });
  await strip(path.join(dir,'projeteis','chinelo.png'),64,6,(img,l,f,clip)=>{
    const c=l+31.5,a=f*Math.PI/3,ca=Math.cos(a),sa=Math.sin(a);
    for(let y=4;y<60;y++)for(let x=l+4;x<l+60;x++){
      const u=(x-c)*ca+(y-31.5)*sa,v=-(x-c)*sa+(y-31.5)*ca;
      if(Math.abs(u)<=18&&Math.abs(v)<=8)dot(img,x,y,Math.abs(u+6)<=2?[255,255,255,255]:[40,120,230,255],clip);
    }
  });
  await strip(path.join(dir,'efeitos','morte-poof.png'),128,8,(img,l,f,clip)=>{
    const c=l+63.5,r=8+f*3.5,spread=4+f*3,alpha=Math.round(255-f*16);
    for(let k=0;k<5;k++){const a=k*2*Math.PI/5+f*.2;disc(img,c+Math.cos(a)*spread,63.5+Math.sin(a)*spread,r,[205,205,215,alpha],clip);}
    disc(img,c,63.5,Math.max(4,r*.6),[245,245,250,alpha],clip);
  });
  for(const id of DEMO_PIECES.ui)await icon(path.join(dir,'ui',`${id}.png`),id);
  return DEMO_PIECES;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const dir=process.argv[2];
  if(!dir){console.error('Uso: node tests/fixtures/art-v2/demo.mjs <pasta>');process.exitCode=2;}
  else{
    const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
    const pieces=await makeDemoDelivery(path.resolve(dir),{repoRoot});
    console.log(`Entrega de demonstração (sintética) em ${path.resolve(dir)}:`);
    for(const [group,ids] of Object.entries(pieces))console.log(`  ${group}: ${ids.join(', ')}`);
    console.log(`Importe com: node scripts/import-art-v2.mjs --input ${path.resolve(dir)}`);
  }
}
