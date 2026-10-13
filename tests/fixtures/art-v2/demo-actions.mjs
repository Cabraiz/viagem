/**
 * DEMO action animations for art v2 (NEW-20261012-ORQ-importar-arte-c-completa): REAL sizes, SYNTHETIC look, added to
 * an `arte-entrada/` folder (on its own or after tests/fixtures/art-v2/demo.mjs). Every cell is obviously fake: a flat
 * figure, the animation's letter on the body (A attack, H hit, D death, I idle, W walk, S slam), the direction under
 * it (S, SW, W…, one per row) and the frame number on the head, so a screenshot shows which action and frame plays.
 *  - inimigos/bebado: attack 6, hit 3, death 10 frames (cell 128); meta.json merged with what is already there.
 *  - inimigos/chefe: idle 6, walk 8, slam 10, death 16 frames (cell 384, the spec's; death is 6144 px wide, so the
 *    importer paginates it).
 *  - projeteis/chinelo and projeteis/garrafa-molotov: 8 frames of 64 (a turning sandal, a spinning bottle).
 * Grounded animations keep the feet on the 0.88 line and centred; nothing touches the 2 px cell margin.
 *
 *   node tests/fixtures/art-v2/demo-actions.mjs <pasta>   then: node scripts/import-art-v2.mjs --dry-run --input <pasta>
 */
import sharp from 'sharp';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DIRECTIONS,ANCHOR} from '../../../scripts/art-v2/spec.mjs';
import {DIRECTION_COLORS} from './make.mjs';

/** What writeDemoActions adds, by group / piece: frames per animation, cell and fps. */
export const DEMO_ACTIONS=Object.freeze({
  inimigos:Object.freeze({
    bebado:Object.freeze({cell:128,anims:Object.freeze({attack:6,hit:3,death:10}),fps:Object.freeze({attack:12,hit:12,death:12})}),
    chefe:Object.freeze({cell:384,anims:Object.freeze({idle:6,walk:8,slam:10,death:16}),fps:Object.freeze({idle:6,walk:10,slam:12,death:12})}),
  }),
  projeteis:Object.freeze({chinelo:Object.freeze({cell:64,frames:8}),'garrafa-molotov':Object.freeze({cell:64,frames:8})}),
});
const LETTER={attack:'A',hit:'H',death:'D',idle:'I',walk:'W',slam:'S'};

// ---------------------------------------------------------------- raw RGBA drawing
const canvas=(width,height)=>({width,height,data:Buffer.alloc(width*height*4)});
function rect(img,x0,y0,x1,y1,[r,g,b,a=255]){
  for(let y=Math.max(0,Math.round(y0));y<=Math.min(img.height-1,Math.round(y1));y++)
    for(let x=Math.max(0,Math.round(x0));x<=Math.min(img.width-1,Math.round(x1));x++){
      const i=(y*img.width+x)*4;img.data[i]=r;img.data[i+1]=g;img.data[i+2]=b;img.data[i+3]=a;
    }
}
/** 5×7 bitmap font: the letters and digits the demo writes. */
const FONT={
  A:['.###.','#...#','#...#','#####','#...#','#...#','#...#'],H:['#...#','#...#','#...#','#####','#...#','#...#','#...#'],
  D:['####.','#...#','#...#','#...#','#...#','#...#','####.'],I:['#####','..#..','..#..','..#..','..#..','..#..','#####'],
  W:['#...#','#...#','#...#','#.#.#','#.#.#','##.##','#...#'],S:['.####','#....','#....','.###.','....#','....#','####.'],
  N:['#...#','##..#','#.#.#','#..##','#...#','#...#','#...#'],E:['#####','#....','#....','####.','#....','#....','#####'],
  0:['.###.','#...#','#..##','#.#.#','##..#','#...#','.###.'],1:['..#..','.##..','..#..','..#..','..#..','..#..','.###.'],
  2:['.###.','#...#','....#','...#.','..#..','.#...','#####'],3:['####.','....#','....#','.###.','....#','....#','####.'],
  4:['#...#','#...#','#...#','#####','....#','....#','....#'],5:['#####','#....','####.','....#','....#','#...#','.###.'],
  6:['.###.','#....','#....','####.','#...#','#...#','.###.'],7:['#####','....#','...#.','..#..','.#...','.#...','.#...'],
  8:['.###.','#...#','#...#','.###.','#...#','#...#','.###.'],9:['.###.','#...#','#...#','.####','....#','....#','.###.'],
};
/** Writes `str` centred on (cx, cy), `scale` px per font pixel. */
function text(img,str,cx,cy,scale,rgba){
  const w=str.length*6*scale-scale,x0=Math.round(cx-w/2),y0=Math.round(cy-3.5*scale);
  [...str].forEach((ch,k)=>FONT[ch].forEach((row,ry)=>[...row].forEach((on,rx)=>{
    if(on==='#')rect(img,x0+k*6*scale+rx*scale,y0+ry*scale,x0+k*6*scale+(rx+1)*scale-1,y0+(ry+1)*scale-1,rgba);
  })));
}
const INK=[20,18,24,255],PAPER=[255,250,235,255];
const shade=([r,g,b],k)=>[r*k,g*k,b*k].map(Math.round);
async function save(img,file){
  mkdirSync(path.dirname(file),{recursive:true});
  await sharp(img.data,{raw:{width:img.width,height:img.height,channels:4}}).png({compressionLevel:6}).toFile(file);
}

/**
 * One enemy cell at (left, top): feet (bottom row) on round(0.88 × cell), centred; body with the animation letter, the
 * direction under it, the frame number on the head. Attack and slam lean the body (feet stay); hit shakes it; death
 * sinks it frame by frame (the feet row stays, the body gets shorter).
 */
function enemyCell(img,left,top,cell,anim,d,f,frames){
  const u=cell/128,cx=left+(cell-1)/2,foot=top+Math.round(ANCHOR[1]*cell),colour=DIRECTION_COLORS[d];
  const k=frames>1?f/(frames-1):0;
  const lean=anim==='attack'||anim==='slam'?Math.round(Math.sin(k*Math.PI)*14*u):anim==='hit'?(f%2?-6:6)*u:0;
  const height=anim==='death'?Math.round((86-60*k)*u):Math.round(86*u)+(anim==='walk'?(f%2)*2*u:0);
  rect(img,cx-16*u,foot-10*u,cx-4*u,foot,shade(colour,.55));rect(img,cx+4*u,foot-10*u,cx+16*u,foot,shade(colour,.55));
  rect(img,cx-24*u+lean,foot-10*u-height,cx+24*u+lean,foot-10*u,[...colour,255]);
  const mid=foot-10*u-height/2;
  text(img,LETTER[anim],cx+lean,mid-6*u,Math.max(2,Math.round(3*u)),INK);
  text(img,d,cx+lean,mid+18*u,Math.max(1,Math.round(1.6*u)),INK);
  // Head with the frame number (1-based), above the body and inside the margin.
  const headTop=Math.max(top+4,foot-10*u-height-30*u);
  rect(img,cx-16*u+lean,headTop,cx+16*u+lean,foot-10*u-height-2,PAPER);
  text(img,String(f+1),cx+lean,(headTop+foot-10*u-height-2)/2,Math.max(1,Math.round(2*u)),INK);
}
async function enemySheet(file,cell,anim,frames){
  const img=canvas(cell*frames,cell*DIRECTIONS.length);
  DIRECTIONS.forEach((d,r)=>{for(let f=0;f<frames;f++)enemyCell(img,f*cell,r*cell,cell,anim,d,f,frames);});
  await save(img,file);
}
/** meta.json of an enemy folder: what is there (demo.mjs's idle/walk fps) merged with this piece's fps. */
function writeMeta(file,cell,fps){
  let meta={cell:[cell,cell],anchor:[...ANCHOR],fps:{}};
  if(existsSync(file)){try{const old=JSON.parse(readFileSync(file,'utf8'));if(old&&typeof old==='object')meta={...meta,...old};}catch{/* rewritten below */}}
  meta.fps={...(typeof meta.fps==='object'&&meta.fps?meta.fps:{}),...fps};
  writeFileSync(file,`${JSON.stringify(meta,null,2)}\n`);
}

/** Projectile strip: `frames` cells of `cell`; a turning bar with a tip (sandal) or a bottle with a flame (molotov). */
async function projectileStrip(file,id,cell,frames){
  const img=canvas(cell*frames,cell),c=(cell-1)/2;
  for(let f=0;f<frames;f++){
    const a=f/frames*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a),left=f*cell;
    const half=id==='chinelo'?[20,8]:[10,22],body=id==='chinelo'?[40,120,230,255]:[60,170,90,255];
    for(let y=4;y<cell-4;y++)for(let x=4;x<cell-4;x++){
      const u=(x-c)*ca+(y-c)*sa,v=-(x-c)*sa+(y-c)*ca;
      if(Math.abs(u)<=half[0]&&Math.abs(v)<=half[1]){
        const tip=id==='chinelo'?u>half[0]-6:v<-half[1]+7;
        rect(img,left+x,y,left+x,y,tip?(id==='chinelo'?[255,255,255,255]:[255,140,30,255]):body);
      }
    }
    text(img,String(f+1),left+c,c,2,INK);
  }
  await save(img,file);
}

/** Adds the demo action animations and projectiles under `dir` (an `arte-entrada/` root). Returns DEMO_ACTIONS. */
export async function writeDemoActions(dir){
  for(const [id,{cell,anims,fps}] of Object.entries(DEMO_ACTIONS.inimigos)){
    const folder=path.join(dir,'inimigos',id);
    for(const [anim,frames] of Object.entries(anims))await enemySheet(path.join(folder,`${anim}.png`),cell,anim,frames);
    writeMeta(path.join(folder,'meta.json'),cell,fps);
  }
  for(const [id,{cell,frames}] of Object.entries(DEMO_ACTIONS.projeteis))await projectileStrip(path.join(dir,'projeteis',`${id}.png`),id,cell,frames);
  return DEMO_ACTIONS;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const dir=process.argv[2];
  if(!dir){console.error('Uso: node tests/fixtures/art-v2/demo-actions.mjs <pasta>');process.exitCode=2;}
  else{
    await writeDemoActions(path.resolve(dir));
    console.log(`Ações de demonstração (sintéticas) em ${path.resolve(dir)}: bebado (attack, hit, death), chefe (idle, walk, slam, death), projéteis chinelo e garrafa-molotov.`);
    console.log(`Confira com: node scripts/import-art-v2.mjs --dry-run --input ${path.resolve(dir)}`);
  }
}
