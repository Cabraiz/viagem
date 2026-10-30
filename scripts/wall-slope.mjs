#!/usr/bin/env node
/**
 * Levels the base of the walls' straight pieces already in the game (NEW-20261029-ORQ-cercas-nordeste-ligadas):
 * public/art/city/decor/<família>-reto-<estado>/sheet.webp, every view through levelWallBase
 * (scripts/art-v2/adaptar/wall-slope.mjs), so a line of them joins without a step at each post. New deliveries are
 * levelled by the adapter (adaptar/decor.mjs renderRoot); this one-off covers the sheets imported before it.
 * The lite copies follow: node scripts/art-lite.mjs --kinds city.
 *
 *   node scripts/wall-slope.mjs           level the sheets (lossless WebP, the importer's settings)
 *   node scripts/wall-slope.mjs --check   exit 1 when a view's base is off ±1/2
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import sharp from 'sharp';
import {WALLS} from './art-v2/adaptar/decor.mjs';
import {levelWallBase,wallBaseSlope,WALL_SLOPE,WALL_SLOPE_TOLERANCE} from './art-v2/adaptar/wall-slope.mjs';
import {WEBP} from './art-v2/convert.mjs';

const ROOT=join(import.meta.dirname,'..'),DIR=join(ROOT,'public/art/city/decor');
const manifest=JSON.parse(readFileSync(join(DIR,'manifest.json'),'utf8'));
const check=process.argv.includes('--check');
let off=0;
for(const family of WALLS)for(const state of ['intacto','quebrado']){
  const id=`${family}-reto-${state}`,sheet=manifest.pieces[id]?.files?.sheet;
  if(!sheet)throw new Error(`${id}: not in public/art/city/decor/manifest.json`);
  const file=join(DIR,sheet.file),[cw,ch]=sheet.cell;
  const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const out=Buffer.from(data),slopes=[];
  for(let v=0;v<sheet.views;v++){
    const view={data:Buffer.alloc(cw*ch*4),width:cw,height:ch};
    for(let y=0;y<ch;y++)data.copy(view.data,y*cw*4,(y*info.width+v*cw)*4,(y*info.width+(v+1)*cw)*4);
    const slope=wallBaseSlope(view)?.slope;slopes.push(slope);
    if(slope!==undefined&&Math.abs(Math.abs(slope)-WALL_SLOPE)>WALL_SLOPE_TOLERANCE)off++;
    if(check)continue;
    const level=levelWallBase(view);
    for(let y=0;y<ch;y++)level.data.copy(out,(y*info.width+v*cw)*4,y*cw*4,(y+1)*cw*4);
  }
  console.error(id,slopes.map(s=>s?.toFixed(3)).join(' '));
  if(!check)writeFileSync(file,await sharp(out,{raw:{width:info.width,height:info.height,channels:4}}).webp(WEBP).toBuffer());
}
if(check&&off){console.error(`wall-slope: ${off} views off ±${WALL_SLOPE} (node scripts/wall-slope.mjs)`);process.exit(1);}
