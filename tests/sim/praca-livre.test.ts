/**
 * NEW-20261030-ORQ-bocas-chao-aberto (ORQ 30/10: the plaza is no street, its ground stays free whole, not only its
 * mouths). Within PRACA_LIVRE u of the plaza's base point, nothing solid the map lays on the ground:
 *  1. per match (seeds 1–8, the real Cidade Nevada): no piece laid at the start (tralha, a feirinha's barracas, any owner)
 *     and no drawn art of a terreno nest; the map's fixed obras are build spots, nothing solid until a hero builds;
 *  2. on the map: no decor (fence, wall, rock) on the ground and no solid prop on the ground.
 * D-031: results only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {PRACA_LIVRE} from '../../src/maps/city/entradas.ts';
import {cityAsField} from '../../src/maps/index.ts';
import {cityNestPlan,nestArte} from '../../src/maps/nests.ts';
import {pieceRectOf,type PieceState} from '../../src/sim/towers/free-build.ts';
import {Simulation} from '../../multiplayer/simulation.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const json=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const loaded=await cityTerrainFrom(json,(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,a=city.asset,C=a.unitsPerCell,P=a.points.praca;
type Rect={x:number;y:number;w:number;h:number};
const inRing=(r:Rect)=>Math.hypot(Math.max(r.x-P.x,0,P.x-r.x-r.w),Math.max(r.y-P.y,0,P.y-r.y-r.h))<PRACA_LIVRE;
const at=(r:Rect)=>`(${r.x.toFixed(1)},${r.y.toFixed(1)})`;

test('per match (seeds 1–8): no piece laid at the start and no terreno nest in the plaza ring',()=>{
  for(let seed=1;seed<=8;seed++){
    const s=new Simulation(seed,{world:'cidade',terrain:cityAsField(city),cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
    s.add('p0','P0','cidadao-comum');s.resetRun();s.step();
    const pieces=(s.run.stonewards.state as unknown as {defenses?:{pieces?:PieceState[]}}).defenses?.pieces??[];
    assert.ok(pieces.length>=6,`seed ${seed}: ${pieces.length} pieces laid`);
    assert.deepEqual(pieces.map(p=>({p,r:pieceRectOf(p)})).filter(({r})=>inRing(r)).map(({p,r})=>`${p.owner} ${p.id} ${at(r)}`),[],`seed ${seed}`);
    const nests=cityNestPlan(city,seed).nests.filter(n=>n.kind==='terreno');
    assert.ok(nests.length,`seed ${seed}: terreno nests drawn`);
    assert.deepEqual(nests.filter(n=>inRing(nestArte(C,n,n.size))).map(n=>`${n.id} (${n.x},${n.y})`),[],`seed ${seed}`);
  }
});

test('the map: no decor and no solid prop on the plaza ring\'s ground',()=>{
  const j=JSON.parse(json) as {decor:{id:string;c:number;r:number;w:number;h:number}[];props:{x:number;y:number;r:number;kind:string;solid?:boolean}[]};
  const decor=j.decor.map(d=>({d,r:{x:d.c*C,y:d.r*C,w:d.w*C,h:d.h*C}})).filter(({d,r})=>inRing(r)&&a.walkableAt((d.c+.5)*C,(d.r+.5)*C));
  assert.deepEqual(decor.map(({d,r})=>`${d.id} ${at(r)}`),[]);
  const props=j.props.filter(p=>p.solid&&a.walkableAt(p.x,p.y)&&inRing({x:p.x-p.r,y:p.y-p.r,w:2*p.r,h:2*p.r}));
  assert.deepEqual(props.map(p=>`${p.kind} (${p.x},${p.y})`),[]);
});
