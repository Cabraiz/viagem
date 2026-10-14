import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CITY_MAP_SCALE} from '../../src/rules/scale.ts';
import {scaleCity} from '../../scripts/escalar-cidade.ts';

const ASSET='public/maps/cidade-nevada.json';
// The source .w3x never enters the repo (D-026); the re-import check runs only where W3X_MAP points to it.
const MAP=process.env.W3X_MAP;
const text=readFileSync(ASSET,'utf8');
const asset=JSON.parse(text);
type P={x:number;y:number};

/** "bits-lsb-base64": bit i = byte[i>>3]>>(i&7)&1. Decoded here independently of the encoder (D-027 contract). */
function decodeBits(section:{w:number;h:number;encoding:string;data:string}){
  assert.equal(section.encoding,'bits-lsb-base64');
  const n=section.w*section.h,bytes=Buffer.from(section.data,'base64');
  assert.equal(bytes.length,Math.ceil(n/8),'bitset length');
  const out=new Uint8Array(n);for(let i=0;i<n;i++)out[i]=bytes[i>>3]>>(i&7)&1;
  return out;
}
const {w:PW,h:PH,step:STEP}=asset.walkable;
const walk=decodeBits(asset.walkable),water=decodeBits(asset.water);
const pix=(p:P)=>Math.floor(p.y/STEP)*PW+Math.floor(p.x/STEP);
const isWalk=(i:number)=>walk[i]===1;

/** A hero body (radius 0.22 u, under 1 sample of 0.374 u since the 1.7× map) fits where the sample and its 4 neighbours are walkable. */
const roomy=new Uint8Array(PW*PH);
for(let y=1;y<PH-1;y++)for(let x=1;x<PW-1;x++){const i=y*PW+x;roomy[i]=walk[i]&walk[i-1]&walk[i+1]&walk[i-PW]&walk[i+PW];}
/** BFS distances (in samples, 4-neighbour) from a point over samples where a hero body fits. */
function bfs(from:P,blocked?:Uint8Array){
  const dist=new Int32Array(PW*PH).fill(-1),queue=new Int32Array(PW*PH);
  const s=pix(from);assert.ok(roomy[s],'BFS source must fit a hero');
  let head=0,tail=0;queue[tail++]=s;dist[s]=0;
  while(head<tail){
    const i=queue[head++],x=i%PW,y=(i/PW)|0,d=dist[i]+1;
    for(const n of [x>0?i-1:-1,x<PW-1?i+1:-1,y>0?i-PW:-1,y<PH-1?i+PW:-1])
      if(n>=0&&dist[n]<0&&roomy[n]&&!blocked?.[n]){dist[n]=d;queue[tail++]=n;}
  }
  return dist;
}
const points=asset.points as Record<string,P>&{bocas:Record<'N'|'S'|'L'|'O',P>};
const SPAWNS=['spawnN','spawnS','spawnL','spawnO'] as const;
const DIRS={N:[0,-1],S:[0,1],L:[1,0],O:[-1,0]} as const;
const fromPraca=bfs(points.praca);
const units=(px:number)=>px*STEP;

// NEW-20261013-ORQ-cidade-escala-1-7: version 2 is the .w3x import (version 1: 0.88 u cells, 169 u) × CITY_MAP_SCALE 1.7
// (scripts/escalar-cidade.ts): same 192 cells and 768 samples per side, each 1.7× wider.
test('asset header uses the D-026 scale × CITY_MAP_SCALE: 1 cell = 1.496 u, whole 192-cell city ≈ 287 u',()=>{
  assert.equal(asset.format,'viagem-city');assert.equal(asset.formatVersion,1);assert.equal(asset.version,2);assert.equal(asset.id,'cidade-nevada');
  assert.equal(CITY_MAP_SCALE,1.7);
  assert.equal(asset.unitsPerCell,1.496);assert.equal(asset.cells.w,192);assert.equal(asset.cells.h,192);
  assert.ok(Math.abs(asset.size.w-287.232)<1e-6&&Math.abs(asset.size.h-287.232)<1e-6);
  assert.equal(PW,768);assert.ok(Math.abs(STEP-.374)<1e-9);
  assert.equal(asset.heights.w,193);assert.equal(asset.heights.encoding,'i16le-centi-base64');
  assert.equal(Buffer.from(asset.heights.data,'base64').length,193*193*2);
  const blocked=walk.reduce((n,c)=>n+(c?0:1),0)/walk.length;
  assert.ok(blocked>.2&&blocked<.6,`blocked fraction ${blocked}`);
});

test('plaza, its 4 mouths, start and the 4 spawns are walkable and inside the playable area',()=>{
  const all:[string,P][]=[...Object.entries(points).filter(([k])=>k!=='bocas') as [string,P][],...Object.entries(points.bocas).map(([k,p])=>[`boca${k}`,p] as [string,P])];
  assert.equal(all.length,10);
  const {x,y,w,h}=asset.playable;
  for(const [name,p] of all){
    assert.ok(isWalk(pix(p))&&!water[pix(p)],`${name} walkable and dry`);
    assert.ok(p.x>=x&&p.x<=x+w&&p.y>=y&&p.y<=y+h,`${name} inside playable`);
  }
});

test('spawns and mouths point the right way from the plaza; mouths sit between plaza and spawn',()=>{
  const c=points.praca;
  for(const [k,[dx,dy]] of Object.entries(DIRS) as [keyof typeof DIRS,readonly [number,number]][]){
    const spawn=points[`spawn${k}`],boca=points.bocas[k];
    const along=(p:P)=>(p.x-c.x)*dx+(p.y-c.y)*dy;
    assert.ok(along(spawn)>50,`spawn ${k} far along its avenue (${along(spawn)})`);
    assert.ok(along(boca)>0&&along(boca)<along(spawn)/3,`boca ${k} near the plaza (${along(boca)})`);
  }
  assert.ok(points.inicio.y>c.y+40,'start (crashed helicopter) is south of the plaza');
});

test('paths exist start→plaza→every spawn and plaza→every mouth, with plausible street lengths',()=>{
  const fromStart=bfs(points.inicio);
  const toPraca=fromStart[pix(points.praca)];
  assert.ok(toPraca>0,'start reaches the plaza');
  const straight=Math.hypot(points.inicio.x-points.praca.x,points.inicio.y-points.praca.y);
  assert.ok(units(toPraca)>=straight&&units(toPraca)<straight*3,`start→plaza ${units(toPraca).toFixed(1)} u vs ${straight.toFixed(1)} u straight`);
  for(const s of SPAWNS){const d=fromPraca[pix(points[s])];assert.ok(d>0,`plaza reaches ${s}`);assert.ok(units(d)<200,`${s} ${units(d)} u`);}
  for(const k of Object.keys(DIRS) as (keyof typeof DIRS)[])assert.ok(fromPraca[pix(points.bocas[k])]>=0,`plaza reaches boca ${k}`);
});

test('loot candidates are reachable, spread out and away from spawns, start and plaza',()=>{
  assert.ok(asset.loot.length>=30&&asset.loot.length<=60,`${asset.loot.length} loot spots`);
  const keep=[points.inicio,points.praca,...SPAWNS.map(s=>points[s])];
  for(const [i,l] of (asset.loot as P[]).entries()){
    assert.ok(isWalk(pix(l))&&fromPraca[pix(l)]>0,`loot ${i} reachable`);
    for(const p of keep)assert.ok(Math.hypot(l.x-p.x,l.y-p.y)>=6,`loot ${i} too close to a key point`);
    for(const m of (asset.loot as P[]).slice(i+1))assert.ok(Math.hypot(l.x-m.x,l.y-m.y)>=4,`loot ${i} crowded`);
  }
});

test('blocks and props are well formed and inside the map',()=>{
  const kinds=new Set(['building','wall','cliff','rubble','edge']);
  const inside=([x,y,w,h]:number[])=>x>=0&&y>=0&&w>0&&h>0&&x+w<=asset.size.w+1e-6&&y+h<=asset.size.h+1e-6;
  assert.ok(asset.blocks.length>10);
  const ids=new Set<string>();
  for(const b of asset.blocks){
    assert.ok(kinds.has(b.kind),b.kind);assert.ok(!ids.has(b.id));ids.add(b.id);
    assert.ok(inside(b.bbox)&&b.rects.length>0&&b.rects.every(inside),b.id);
  }
  for(const p of asset.props)assert.ok(p.x>=0&&p.y>=0&&p.x<=asset.size.w&&p.y<=asset.size.h&&p.r>0&&typeof p.solid==='boolean'&&typeof p.kind==='string');
});

test('asset stays small and carries no names or texts from the source map (D-026)',()=>{
  const gz=gzipSync(Buffer.from(text),{level:9}).length;
  assert.ok(gz<=600*1024,`${gz} bytes gzip`);
  const deny=Buffer.from('cmVzaWRlbnR8ZXZpbHx1bWJyZWxsYXxibGl6emFyZHx1ZGdffFRSSUdTVFJ8XGJyZWN0XGQ=','base64').toString();
  assert.doesNotMatch(text,new RegExp(deny,'i'));
  assert.doesNotMatch(text,/'[A-Z][A-Za-z0-9]{3}'|"[A-Z][A-Z][a-z0-9]{2}"/,'no 4-char source object ids');
});

test('manifest carries id, version and the sha256 of the exact asset bytes',async()=>{
  const manifest=JSON.parse(readFileSync('public/maps/cidade-nevada.manifest.json','utf8'));
  const bytes=readFileSync(ASSET);
  assert.deepEqual(manifest,{id:'cidade-nevada',version:2,hash:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
});

test('heights keep the source orientation: the hill is east, the flooded pit centre-north',()=>{
  const b=Buffer.from(asset.heights.data,'base64'),h=new Int16Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));
  let hi=0,lo=0;for(let i=1;i<h.length;i++){if(h[i]>h[hi])hi=i;if(h[i]<h[lo])lo=i;}
  // Positions and heights in .w3x-import lengths (version 1) × CITY_MAP_SCALE.
  const K=CITY_MAP_SCALE,at=(i:number)=>({x:(i%193)*asset.unitsPerCell,y:Math.floor(i/193)*asset.unitsPerCell});
  const top=at(hi),pit=at(lo);
  assert.ok(top.x>120*K&&top.y<84*K,`highest corner east/north (${top.x},${top.y})`);
  assert.ok(pit.x>84*K&&pit.x<120*K&&pit.y<60*K,`lowest corner centre-north (${pit.x},${pit.y})`);
  assert.ok(h[hi]/100>5*K&&h[lo]/100<-1*K,'height range in u');
});

test('closing the 4 mouths seals the plaza from every spawn (the base can be walled)',()=>{
  const wall=new Uint8Array(PW*PH),R=7;
  for(const b of Object.values(points.bocas)){
    const cx=Math.floor(b.x/STEP),cy=Math.floor(b.y/STEP);
    for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++)if(dx*dx+dy*dy<=R*R)wall[(cy+dy)*PW+cx+dx]=1;
  }
  const sealed=bfs(points.praca,wall);
  for(const s of SPAWNS)assert.equal(sealed[pix(points[s])],-1,`${s} must not reach the walled plaza`);
});

// The importer writes version 1 (the .w3x proportions); the committed asset is that × CITY_MAP_SCALE (cidade-escala-1-7),
// so each run goes through scripts/escalar-cidade.ts scaleCity before the byte comparison, and the two runs must agree.
test('two separate importer runs, scaled by CITY_MAP_SCALE, reproduce the committed asset and manifest byte for byte',{skip:!(MAP&&existsSync(MAP))&&'set W3X_MAP to the source .w3x to run'},()=>{
  const dir=mkdtempSync(join(tmpdir(),'cidade-'));
  try{
    for(const run of ['a','b'])execFileSync(process.execPath,['scripts/import-w3x.mjs',MAP!,join(dir,`${run}.json`)],{stdio:'pipe'});
    const committed=JSON.parse(readFileSync('public/maps/cidade-nevada.manifest.json','utf8'));
    for(const run of ['a','b']){
      const v1=readFileSync(join(dir,`${run}.json`),'utf8'),scaled=JSON.stringify(scaleCity(JSON.parse(v1),CITY_MAP_SCALE));
      assert.equal(JSON.parse(v1).version,1,`run ${run} imports version 1`);
      assert.equal(scaled,text,`run ${run} asset × CITY_MAP_SCALE`);
      assert.equal(readFileSync(join(dir,`${run}.json`),'utf8'),readFileSync(join(dir,'a.json'),'utf8'),`run ${run} = run a`);
      assert.deepEqual({id:committed.id,version:committed.version,hash:createHash('sha256').update(scaled).digest('hex'),bytes:Buffer.byteLength(scaled)},committed,`run ${run} manifest`);
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});
