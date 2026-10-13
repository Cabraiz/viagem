/**
 * DEMO city art v2 (cidade-03 hookup): REAL sizes, SYNTHETIC look, added to an `arte-entrada/` folder (on its own or
 * after tests/fixtures/art-v2/demo.mjs), following the convention at the top of src/client/render/city/materials.ts:
 *  - cenario/chao/cidade-nevada/neve-fofa-1.png (ground 'snow') and neve-pisada-1.png (ground 'packed'): 512×512
 *    opaque tiles covering 4.4 u, seamless by construction (every feature is periodic in 512 px), light and calm
 *    (relative luminance of every pixel ≥ 0.131) with a faint 128 px grid so the tiling is visible in a print. No sidecar:
 *    kind, size and meta.ground come from the spec.mjs `expected` table.
 *  - cenario/predios/casa-terrea-2x1-1.png (+ .json): a RUINED 2×1 house, 4 views of 384×320 (one row "ruina"), drawn
 *    with the city projection (TILE_X 42, TILE_Y 21, HEIGHT_PX 42, ART_SCALE 2, cell 0.88 u): footprint diamond centred
 *    in the frame, front-bottom corner BUILDING_ANCHOR_BOTTOM_PX (16) above the bottom, at x = frameW/2 ± 37 px
 *    (buildingAnchor: +37 in views 0/180, −37 in 90/270). Sidecar anchor [0.5, 0.95]: y is that corner line exactly; x is
 *    the frame centre (one anchor serves the 4 views, the per-view corner x is within the importer's 12% tolerance).
 *    Each wall is coloured by the WORLD side it faces (Leste red, Sul blue, Oeste green, Norte yellow, with its initial
 *    L/S/O/N), so the rotation can be checked: the right-front wall of view v is the left-front wall of view v+1. A big
 *    0°/90°/180°/270° label tops each frame. meta (footprint [2,1], ruin, framesPerView 1) comes from the table.
 *  - cenario/props/banco-praca.png (+ .json): a park bench, 4 views of 192×192 (long side in 0°/180°, end-on in
 *    90°/270°, backrest behind in 0° and in front in 180°), legs symmetric so the foot is centred, lowest pixel
 *    PROP_ANCHOR_BOTTOM_PX (8) above the bottom: anchor [0.5, 0.958333]. Big view label on top. meta.prop from the table.
 * Nothing touches the 2 px cell margin of the transparent sheets.
 *
 *   node tests/fixtures/art-v2/demo-city.mjs <pasta>   then: node scripts/import-art-v2.mjs --dry-run --input <pasta>
 */
import sharp from 'sharp';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

/** What writeDemoCity writes, by group. */
export const DEMO_CITY=Object.freeze({
  chao:Object.freeze(['cidade-nevada/neve-fofa-1','cidade-nevada/neve-pisada-1']),
  predios:Object.freeze(['casa-terrea-2x1-1']),
  props:Object.freeze(['banco-praca']),
});
/** materials.ts / projection.ts constants the drawings follow. */
export const CITY_ART=Object.freeze({tile:512,tileX:42,tileY:21,heightPx:42,artScale:2,cell:.88,buildingBottom:16,propBottom:8});
const {tileX:TX,tileY:TY,heightPx:HP,artScale:S,cell:CELL}=CITY_ART;
export const BUILDING=Object.freeze({id:'casa-terrea-2x1-1',footprint:Object.freeze([2,1]),cell:Object.freeze([384,320])});
export const PROP=Object.freeze({id:'banco-praca',cell:Object.freeze([192,192])});
/** Sidecars (cell + anchor; rows named). meta stays in the spec.mjs table. */
export const DEMO_CITY_SIDECARS=Object.freeze({
  [BUILDING.id]:Object.freeze({cell:[...BUILDING.cell],views:4,rows:['ruina'],anchor:[.5,1-CITY_ART.buildingBottom/BUILDING.cell[1]]}),
  [PROP.id]:Object.freeze({cell:[...PROP.cell],views:4,rows:['inteiro'],anchor:[.5,+(1-CITY_ART.propBottom/PROP.cell[1]).toFixed(6)]}),
});
const VIEW_LABELS=['0°','90°','180°','270°'];
/** World side colours and pt-BR initials; per view, the world side of the left-front and right-front walls. */
const SIDES={E:{rgb:[220,80,70],letter:'L'},S:{rgb:[70,120,225],letter:'S'},W:{rgb:[70,170,90],letter:'O'},N:{rgb:[230,190,50],letter:'N'}};
const FRONT=[['S','E'],['E','N'],['N','W'],['W','S']];
const OPPOSITE={E:'W',W:'E',N:'S',S:'N'};
const INK=[20,18,24,255];

// ---------------------------------------------------------------- raw RGBA drawing
const canvas=(width,height)=>({width,height,data:Buffer.alloc(width*height*4)});
function dot(img,x,y,[r,g,b,a=255],clip){
  x=Math.round(x);y=Math.round(y);
  const [x0,y0,x1,y1]=clip??[0,0,img.width-1,img.height-1];
  if(x<x0||x>x1||y<y0||y>y1)return;
  const i=(y*img.width+x)*4;img.data[i]=r;img.data[i+1]=g;img.data[i+2]=b;img.data[i+3]=a;
}
function rect(img,x0,y0,x1,y1,rgba,clip){for(let y=Math.round(y0);y<=Math.round(y1);y++)for(let x=Math.round(x0);x<=Math.round(x1);x++)dot(img,x,y,rgba,clip);}
/** Filled polygon (even-odd, pixel centres). */
function polygon(img,pts,rgba,clip){
  const ys=pts.map(p=>p[1]),xs=pts.map(p=>p[0]);
  for(let y=Math.floor(Math.min(...ys));y<=Math.ceil(Math.max(...ys));y++)for(let x=Math.floor(Math.min(...xs));x<=Math.ceil(Math.max(...xs));x++){
    let inside=false;
    for(let i=0,j=pts.length-1;i<pts.length;j=i++){
      const [xi,yi]=pts[i],[xj,yj]=pts[j];
      if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
    }
    if(inside)dot(img,x,y,rgba,clip);
  }
}
/** 5×7 bitmap font: the glyphs this demo writes ('°' is the degree ring). */
const FONT={
  '0':['.###.','#...#','#..##','#.#.#','##..#','#...#','.###.'],'1':['..#..','.##..','..#..','..#..','..#..','..#..','.###.'],
  '2':['.###.','#...#','....#','...#.','..#..','.#...','#####'],'7':['#####','....#','...#.','..#..','.#...','.#...','.#...'],
  '8':['.###.','#...#','#...#','.###.','#...#','#...#','.###.'],'9':['.###.','#...#','#...#','.####','....#','...#.','.##..'],
  '°':['.##..','#..#.','#..#.','.##..','.....','.....','.....'],
  L:['#....','#....','#....','#....','#....','#....','#####'],S:['.####','#....','#....','.###.','....#','....#','####.'],
  O:['.###.','#...#','#...#','#...#','#...#','#...#','.###.'],N:['#...#','##..#','#.#.#','#..##','#...#','#...#','#...#'],
};
function text(img,str,cx,cy,scale,rgba,clip){
  const w=str.length*6*scale-scale,h=7*scale,x0=Math.round(cx-w/2),y0=Math.round(cy-h/2);
  [...str].forEach((ch,k)=>FONT[ch].forEach((row,ry)=>[...row].forEach((on,rx)=>{
    if(on==='#')rect(img,x0+k*6*scale+rx*scale,y0+ry*scale,x0+k*6*scale+(rx+1)*scale-1,y0+(ry+1)*scale-1,rgba,clip);
  })));
}
const shade=([r,g,b],k)=>[r*k,g*k,b*k].map(Math.round);
const tint=([r,g,b],k)=>[r+(255-r)*k,g+(255-g)*k,b+(255-b)*k].map(Math.round);
/** View label: white plate with the angle in ink. */
function label(img,str,cx,cy,scale,clip){
  const w=str.length*6*scale+scale*2,h=9*scale;
  rect(img,cx-w/2,cy-h/2,cx+w/2,cy+h/2,[255,255,255,255],clip);
  text(img,str,cx,cy,scale,INK,clip);
}
async function save(img,file){
  mkdirSync(path.dirname(file),{recursive:true});
  await sharp(img.data,{raw:{width:img.width,height:img.height,channels:4}}).png({compressionLevel:6}).toFile(file);
}
const json=(file,value)=>{mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,`${JSON.stringify(value)}\n`);};

// ---------------------------------------------------------------- ground
/** sRGB relative luminance of [r,g,b] (0–255). */
export function luminance([r,g,b]){
  const lin=c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;};
  return .2126*lin(r)+.7152*lin(g)+.0722*lin(b);
}
const TAU=Math.PI*2,N=CITY_ART.tile;
/** Periodic in N: integer frequencies only. */
const wave=(x,y,kx,ky,phase=0)=>Math.sin(TAU*(kx*x+ky*y)/N+phase);
const mod=(v,m)=>((v%m)+m)%m;
/** Faint 128 px grid (every 1.1 u), so the tiling shows in a print. */
const grid=(x,y)=>mod(x,128)===0||mod(y,128)===0;
const GROUND_PAINT={
  // Fresh snow: white-blue swells + a hex lattice of soft bluish dimples (period 64 × 128, offset rows).
  'neve-fofa-1':(x,y)=>{
    const v=5*wave(x,y,2,1)+4*wave(x,y,-1,3,1)+2*wave(x,y,5,4,2);
    let c=[232+v,238+v,247+v*.6];
    const row=Math.floor(mod(y,128)/64),dx=mod(x+row*32,64)-32,dy=mod(y,64)-32,d=Math.hypot(dx,dy);
    if(d<7)c=c.map((ch,i)=>ch-(1-d/7)*[22,16,6][i]);
    if(grid(x,y))c=c.map(ch=>ch-10);
    return c;
  },
  // Packed snow: greyer, diagonal tyre ruts (x + 2y, 8 per tile) and a short tread hatch.
  'neve-pisada-1':(x,y)=>{
    const v=4*wave(x,y,1,2,.5)+3*wave(x,y,3,-2,1.5);
    const rut=Math.max(0,wave(x,y,4,8))**6;
    let c=[200+v-26*rut,206+v-24*rut,216+v-18*rut];
    if(rut>.5&&mod(x-y,8)<2)c=c.map(ch=>ch-8);
    if(grid(x,y))c=c.map(ch=>ch-10);
    return c;
  },
};
async function groundTile(file,paint){
  const img=canvas(N,N);
  for(let y=0;y<N;y++)for(let x=0;x<N;x++)dot(img,x,y,[...paint(x,y).map(c=>Math.max(0,Math.min(255,Math.round(c)))),255]);
  await save(img,file);
}

// ---------------------------------------------------------------- building (ruined 2×1, 4 views)
/** Jagged top (fraction of the wall run → height in world units). */
const jag=(hs,t)=>{const p=t*(hs.length-1),i=Math.min(hs.length-2,Math.floor(p)),f=p-i;return hs[i]+(hs[i+1]-hs[i])*f;};
const BACK_TOP=[1.05,.95,1.1,.7,.9,.55,.8];
const FRONT_TOP=[.62,.5,.66,.3,.45,.18,.4,.55];
function drawBuilding(img,v){
  const [W,H]=BUILDING.cell,left=v*W,clip=[left+2,2,left+W-3,H-3];
  const [a,b]=BUILDING.footprint,[A,B]=v%2===0?[a*CELL,b*CELL]:[b*CELL,a*CELL];
  const cx=left+W/2+(A-B)/2*TX*S,cy=H-CITY_ART.buildingBottom;
  const P=(x,y,z=0)=>[cx+((x-A)-(y-B))*TX*S,cy+((x-A)+(y-B))*TY*S-z*HP*S];
  /** Wall from ground point p to q (view coords) with jagged top heights `hs`. */
  const wall=(p,q,hs,rgb)=>{
    const n=24,top=Array.from({length:n+1},(_,k)=>{const t=1-k/n;return P(p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t,jag(hs,t));});
    polygon(img,[P(...p),P(...q),...top],[...rgb,255],clip);
  };
  const [lf,rf]=FRONT[v];
  // floor (rubble-strewn), inner faces of the back walls (darker, the side opposite the front wall)
  polygon(img,[P(0,0),P(A,0),P(A,B),P(0,B)],[96,90,88,255],clip);
  wall([0,B],[0,0],BACK_TOP,shade(SIDES[OPPOSITE[rf]].rgb,.55));
  wall([0,0],[A,0],[...BACK_TOP].reverse(),shade(SIDES[OPPOSITE[lf]].rgb,.7));
  for(const [x,y,r] of [[.25,.2,.12],[.55,.15,.1],[.3,.5,.09]].map(([x,y,r])=>[x*A,y*B,r])){
    polygon(img,[P(x-r,y-r,0),P(x+r,y-r,.05),P(x+r,y+r,.12),P(x-r,y+r,.04)],[150,144,140,255],clip);
  }
  // front walls, coloured by the world side they face, with its initial
  wall([0,B],[A,B],FRONT_TOP,SIDES[lf].rgb);
  wall([A,0],[A,B],[...FRONT_TOP].reverse().map(h=>h*.9),shade(SIDES[rf].rgb,.82));
  const [lx,ly]=P(A/2,B,.2),[rx,ry]=P(A,B/2,.2);
  text(img,SIDES[lf].letter,lx,ly,3,INK,clip);text(img,SIDES[rf].letter,rx,ry,3,INK,clip);
  label(img,VIEW_LABELS[v],left+W/2,44,6,clip);
}

// ---------------------------------------------------------------- prop (park bench, 4 views)
function drawBench(img,v){
  const [W,H]=PROP.cell,left=v*W,clip=[left+2,2,left+W-3,H-3],cx=left+(W-1)/2,foot=H-CITY_ART.propBottom;
  const wood=[160,105,60],dark=shade(wood,.7),iron=[105,108,122],snow=tint([225,235,248],.2);
  const long=v%2===0,half=long?52:16,seatY=foot-34;
  // legs: symmetric about cx, down to the foot line
  for(const s of long?[-1,1]:[0])rect(img,cx+s*(half-8)-4,seatY,cx+s*(half-8)+4,foot,[...iron,255],clip);
  const seat=()=>{rect(img,cx-half,seatY-6,cx+half,seatY+4,[...wood,255],clip);rect(img,cx-half,seatY-10,cx+half,seatY-7,[...snow,255],clip);};
  const back=()=>long
    ?rect(img,cx-half,v===2?seatY-28:seatY-40,cx+half,v===2?seatY+2:seatY-16,[...dark,255],clip)
    :rect(img,cx+(v===1?-1:1)*half-(v===1?0:6),seatY-40,cx+(v===1?-1:1)*half+(v===1?6:0),seatY-6,[...dark,255],clip);
  if(v===2){seat();back();}else{back();seat();}
  label(img,VIEW_LABELS[v],left+W/2,36,5,clip);
}
async function viewsSheet(file,[W,H],draw){
  const img=canvas(W*4,H);
  for(let v=0;v<4;v++)draw(img,v);
  await save(img,file);
}

/** Writes the city pieces under `dir` (the `arte-entrada/` layout). Returns DEMO_CITY. */
export async function writeDemoCity(dir){
  const chao=path.join(dir,'cenario','chao','cidade-nevada');
  for(const [id,paint] of Object.entries(GROUND_PAINT))await groundTile(path.join(chao,`${id}.png`),paint);
  const predios=path.join(dir,'cenario','predios'),props=path.join(dir,'cenario','props');
  await viewsSheet(path.join(predios,`${BUILDING.id}.png`),BUILDING.cell,(img,v)=>drawBuilding(img,v));
  json(path.join(predios,`${BUILDING.id}.json`),DEMO_CITY_SIDECARS[BUILDING.id]);
  await viewsSheet(path.join(props,`${PROP.id}.png`),PROP.cell,(img,v)=>drawBench(img,v));
  json(path.join(props,`${PROP.id}.json`),DEMO_CITY_SIDECARS[PROP.id]);
  return DEMO_CITY;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const dir=process.argv[2];
  if(!dir){console.error('Uso: node tests/fixtures/art-v2/demo-city.mjs <pasta>');process.exitCode=2;}
  else{
    await writeDemoCity(path.resolve(dir));
    console.log(`Cidade de demonstração (sintética) em ${path.resolve(dir)}/cenario:`);
    for(const [group,ids] of Object.entries(DEMO_CITY))console.log(`  ${group}: ${ids.join(', ')}`);
  }
}
