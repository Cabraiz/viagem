/**
 * cidade-relevo-pseudo-realista (data part): the Cidade Nevada relief over the asset's terraces. Ramps instead of
 * steps on open ground, a low snow undulation, streets and plaza without it, buildings/walls/edge corners untouched
 * (up to one global shift that keeps the lowest corner), the same array for everyone, and nothing the simulation reads.
 * Result asserts only (D-031), except the last test, which checks which sectors may call it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {CityTerrain,cityRelief,cityReliefAt,decodeCityAsset,UNDULATION_HEIGHT,type CityAsset} from '../../src/maps/index.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const decode=():CityAsset=>{const r=decodeCityAsset(TEXT);if(!r.ok)throw new Error(r.error);return r.asset;};
const asset=decode(),R=cityRelief(asset),W=asset.cells.w,H=asset.cells.h,hw=W+1,cell=asset.unitsPerCell;
const src=(i:number)=>asset.heightsCenti[i]/100;
const cellsOf=(kinds:readonly string[])=>{
  const out=new Set<number>();
  for(const b of asset.blocks)if(kinds.includes(b.kind))for(const r of b.rects){
    for(let y=Math.floor(r[1]/cell+1e-6);y<Math.ceil((r[1]+r[3])/cell-1e-6);y++)for(let x=Math.floor(r[0]/cell+1e-6);x<Math.ceil((r[0]+r[2])/cell-1e-6);x++)out.add(y*W+x);
  }
  return out;
};
const cornersOf=(cells:Set<number>)=>{const out=new Set<number>();for(const c of cells){const i=Math.floor(c/W)*hw+c%W;out.add(i);out.add(i+1);out.add(i+hw);out.add(i+hw+1);}return out;};

test('one finite corner per asset corner, the same lowest corner, computed once and the same on every decode', () => {
  assert.equal(R.length,asset.heightsCenti.length);
  assert.ok(R.every(Number.isFinite));
  let s=Infinity,r=Infinity;for(let i=0;i<R.length;i++){s=Math.min(s,src(i));r=Math.min(r,R[i]);}
  assert.equal(r,s,'the lowest corner stays the terrain zero');
  assert.equal(cityRelief(asset),R,'cached per asset');
  assert.deepEqual(Array.from(cityRelief(decode())),Array.from(R),'deterministic');
});

test('walls stay walls: buildings, walls and the map edge keep their corners (one global shift at most)', () => {
  const locked=[...cornersOf(cellsOf(['building','wall','edge']))];
  assert.ok(locked.length>1000);
  const shift=R[locked[0]]-src(locked[0]);
  for(const i of locked)assert.ok(Math.abs(R[i]-src(i)-shift)<1e-9,`corner ${i}: ${src(i)} → ${R[i]}`);
  assert.ok(Math.abs(shift)<1,'a small shift');
});

test('terraces become ramps: no terrace-sized step left between open-ground neighbours (a terrace is 0.88 u)', () => {
  const locked=cornersOf(cellsOf(['building','wall','edge']));
  let srcBig=0,big=0,steps=0;
  for(let y=1;y<H;y++)for(let x=1;x<W;x++){
    const i=y*hw+x,j=i+1;
    if(locked.has(i)||locked.has(j))continue;
    steps++;
    if(Math.abs(src(j)-src(i))>=.85)srcBig++;
    if(Math.abs(R[j]-R[i])>=.85)big++;
  }
  assert.ok(srcBig>100,`the source has terrace steps (${srcBig})`);
  assert.ok(big<srcBig/10,`ramps: ${big} terrace-sized steps (≥ 0.85 u) left of ${srcBig} (${steps} pairs)`);
});

test('snow undulation on open ground, none in the plaza', () => {
  // Open ground: relief minus the smooth mean of its 5×5 neighbourhood varies (bumps a cell or more wide).
  const p=asset.points.praca,pc={x:Math.floor(p.x/cell),y:Math.floor(p.y/cell)};
  let plazaMax=0;
  for(let y=pc.y-1;y<=pc.y+1;y++)for(let x=pc.x-1;x<=pc.x+1;x++){
    const i=y*hw+x;plazaMax=Math.max(plazaMax,Math.abs(R[i+1]-R[i]),Math.abs(R[i+hw]-R[i]));
  }
  assert.ok(plazaMax<.02,`plaza is flat (${plazaMax.toFixed(4)} u between neighbours)`);
  const locked=cornersOf(cellsOf(['building','wall','edge']));
  let moved=0,open=0;
  for(let i=0;i<R.length;i++){if(locked.has(i))continue;open++;if(R[i]-src(i)>UNDULATION_HEIGHT*.3)moved++;}
  assert.ok(moved>open*.05,`snow bumps on ${moved} of ${open} open corners`);
  for(let i=0;i<R.length;i++)assert.ok(R[i]-src(i)<UNDULATION_HEIGHT+2.5,'no corner flies off');
});

test('CityTerrain stands actors on the relief, bilinear, the lowest corner at 0', () => {
  const t=new CityTerrain(asset,'x');
  for(const [x,y] of [[10.3,40.7],[84,90.5],[120.12,33.3],[150,150]]){
    const want=(cityReliefAt(asset,x,y)-cityReliefAt(asset,0,0))*21;
    assert.ok(Math.abs(t.height(x,y)-t.height(0,0)-want)<1e-9);
  }
});

test('the simulation and the rooms never read ground height (so they stay byte-identical)', () => {
  const files:string[]=[];
  const walk=(d:string)=>{for(const f of readdirSync(d)){const p=join(d,f);if(statSync(p).isDirectory())walk(p);else if(p.endsWith('.ts'))files.push(p);}};
  walk(fromRoot('src/sim'));walk(fromRoot('multiplayer'));walk(fromRoot('src/protocol'));
  for(const f of files){
    const s=readFileSync(f,'utf8');
    assert.doesNotMatch(s,/cityRelief|sampleRelief|\.bed\(|\belevation\(|heightAt\(/,f);
  }
});
