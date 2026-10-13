/**
 * SYNTHETIC delivery for the 173-enemy table and the towers (NEW-20261013-ORQ-importador-inimigos-173), REAL sizes:
 *  - one enemy per role of scripts/art-v2/enemies-table.mjs (the first id of each role, by name), every animation of
 *    its role at the table's cell; the `corredor` one comes as one PNG per direction (`<anim>-S.png` … `-SE.png`);
 *  - one tower `rojao-de-festa` (08-TORRES.md B2: base 256×320, 4 views × 6 rows; weapon 128, idle 4 / fire 6 /
 *    reload 8, the fire one per direction) and one wall `muro-de-concreto` (384×320, 3 rows, no weapon).
 * Every cell is a flat block standing on the anchor; each direction has its own colour (DIRECTION_RGB).
 *
 *   node tests/fixtures/art-v2/enemies-towers.mjs <pasta>   then: node scripts/import-art-v2.mjs --dry-run --input <pasta>
 */
import sharp from 'sharp';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DIRECTIONS,ANCHOR,TOWER_ROWS,TOWER_WALL_ROWS} from '../../../scripts/art-v2/spec.mjs';
import {ENEMY_ROLES,ENEMY_TABLE} from '../../../scripts/art-v2/enemies-table.mjs';

/** One colour per direction, so a test can tell the rows of an assembled sheet apart. */
export const DIRECTION_RGB=Object.freeze({S:[200,40,40],SW:[40,200,40],W:[40,40,200],NW:[200,200,40],N:[200,40,200],NE:[40,200,200],E:[230,120,20],SE:[120,20,230]});
/** role → the enemy id the fixture draws for it. */
export const ROLE_SAMPLES=Object.freeze(Object.fromEntries(Object.keys(ENEMY_ROLES).map(role=>
  [role,Object.keys(ENEMY_TABLE).find(id=>ENEMY_TABLE[id].role===role)])));
/** The enemy delivered one PNG per direction. */
export const PER_DIRECTION_ENEMY=ROLE_SAMPLES.corredor;
export const TOWER=Object.freeze({id:'rojao-de-festa',base:[256,320],weapon:[128,128],anims:{idle:4,fire:6,reload:8},
  footprint:[1,1],mount:[128,180],anchor:[.5,.9]});
export const WALL=Object.freeze({id:'muro-de-concreto',base:[384,320],footprint:[2,1],anchor:[.5,.9]});
/** What the fixture writes, by group (every piece must be approved). */
export const ENEMIES_TOWERS=Object.freeze({inimigos:Object.freeze(Object.values(ROLE_SAMPLES)),torres:Object.freeze([TOWER.id,WALL.id])});

const json=(file,value)=>{mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(value));};
/** A w×h transparent canvas with a block in each cell (cw×ch, `cols`×`rows`), bottom at anchor y, centred on anchor x. */
function blocks(cw,ch,cols,rows,colour,anchor=ANCHOR){
  const width=cw*cols,height=ch*rows,data=Buffer.alloc(width*height*4);
  const bw=Math.round(cw*.3),bh=Math.round(ch*.5),foot=Math.round(anchor[1]*ch),cx=Math.round(anchor[0]*cw);
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const px=Buffer.from([...colour(r,c),255]);
    for(let y=foot-bh;y<foot;y++){const at=((r*ch+y)*width+c*cw+cx-(bw>>1))*4;data.fill(px,at,at+bw*4);}
  }
  return {data,width,height};
}
async function save(file,{data,width,height}){
  mkdirSync(path.dirname(file),{recursive:true});
  await sharp(data,{raw:{width,height,channels:4}}).png({compressionLevel:1}).toFile(file);
}
const shade=([r,g,b],f)=>[r,g,(b+f*12)%256];

/** One animation: a sheet (8 rows) or, `perDirection`, the 8 files `<anim>-<DIR>.png`. */
async function animation(folder,anim,[cw,ch],frames,{perDirection=false,anchor}={}){
  if(!perDirection)return save(path.join(folder,`${anim}.png`),blocks(cw,ch,frames,DIRECTIONS.length,(r,c)=>shade(DIRECTION_RGB[DIRECTIONS[r]],c),anchor));
  for(const d of DIRECTIONS)await save(path.join(folder,`${anim}-${d}.png`),blocks(cw,ch,frames,1,(_,c)=>shade(DIRECTION_RGB[d],c),anchor));
}

/** Writes the delivery under `dir` (the `arte-entrada/` layout). Returns ENEMIES_TOWERS. */
export async function writeEnemiesTowers(dir){
  for(const id of ENEMIES_TOWERS.inimigos){
    const {cell}=ENEMY_TABLE[id],{anims}=ENEMY_ROLES[ENEMY_TABLE[id].role],folder=path.join(dir,'inimigos',id);
    for(const [anim,frames] of Object.entries(anims))await animation(folder,anim,[cell,cell],frames,{perDirection:id===PER_DIRECTION_ENEMY});
    json(path.join(folder,'meta.json'),{cell:[cell,cell],anchor:[...ANCHOR],fps:Object.fromEntries(Object.keys(anims).map(a=>[a,8]))});
  }
  const tower=path.join(dir,'torres',TOWER.id),[bw,bh]=TOWER.base;
  await save(path.join(tower,'base.png'),blocks(bw,bh,4,TOWER_ROWS.length,(r,c)=>[90+r*25,80+c*30,60],TOWER.anchor));
  json(path.join(tower,'base.json'),{kind:'views',cell:[bw,bh],views:4,rows:[...TOWER_ROWS],anchor:[...TOWER.anchor],meta:{footprint:[...TOWER.footprint],mount:[...TOWER.mount]}});
  for(const [anim,frames] of Object.entries(TOWER.anims))await animation(tower,anim,TOWER.weapon,frames,{perDirection:anim==='fire'});
  json(path.join(tower,'meta.json'),{cell:[...TOWER.weapon],anchor:[...ANCHOR],fps:{idle:4,fire:12,reload:8}});
  const wall=path.join(dir,'torres',WALL.id),[ww,wh]=WALL.base;
  await save(path.join(wall,'base.png'),blocks(ww,wh,4,TOWER_WALL_ROWS.length,(r,c)=>[120,110-r*20,90+c*20],WALL.anchor));
  json(path.join(wall,'base.json'),{kind:'views',cell:[ww,wh],views:4,rows:[...TOWER_WALL_ROWS],anchor:[...WALL.anchor],meta:{footprint:[...WALL.footprint]}});
  return ENEMIES_TOWERS;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const dir=process.argv[2];
  if(!dir){console.error('Uso: node tests/fixtures/art-v2/enemies-towers.mjs <pasta>');process.exit(2);}
  console.log(await writeEnemiesTowers(path.resolve(dir)));
}
