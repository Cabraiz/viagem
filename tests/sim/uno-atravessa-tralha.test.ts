/**
 * NEW-20261028-ORQ-uno-atravessa-tralha (the user, 28/10, print: a junk pile with a shopping cart and a loose zinc fence
 * in the open snow: "Ainda tô vendo muitas tralhas que vão me atrapalhar a caminhar com o carro pelo jogo todo"). The
 * Uno meets only the buildings, the blocks' walls and the map's edge:
 *  1. the map's tralha (owner 'mapa') the Uno's body touches goes at once (a 'structure' event at hp 0: the junk wall's
 *     break); a barricada a player built still only alerts (6 s) as before;
 *  2. on the real Cidade Nevada (Simulation, chaveiro, ninhos) the car is driven into a square of tralha: it goes, and
 *     the car's own blocks never hold it;
 *  3. the loose fences (a few fence pieces in the open, closing nothing) are off the map (becos-cidade.ts
 *     tirarCercasSoltas), at most the one whose removal would shorten a horde's walk left;
 *  4. per match (seeds 1–8, the living nests' keep out), the Uno's body (carBodyDiscs, 8 headings) gets within 3 u of
 *     ≥ 98 % of the hero's ground off the safe places and the nests' keep out, of every spawn and of every crate off them.
 * D-031: results only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CityTerrain,cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {citySafePlaces} from '../../src/maps/safe-places.ts';
import {cityAsField,type Point} from '../../src/maps/index.ts';
import {cityAssetToData} from '../../src/maps/city-asset.ts';
import {CAR_NEST_KEEP_OUT,carBodyDiscs,type SimEvent} from '../../src/contract/index.ts';
import {FREE_CELL,pieceRectOf,unoAlertStep,type PieceState} from '../../src/sim/towers/free-build.ts';
import {TRALHA_OWNER} from '../../src/sim/towers/tralha.ts';
import {placeWall} from '../../src/sim/stonewards/wall.ts';
import {cercasSoltas} from '../../scripts/becos-cidade.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import type {SimContext} from '../../src/sim/context.ts';
import type {StonewardsState} from '../../src/sim/stonewards/state.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,A=city.asset,P=A.points,CAR=placeWall(city);

function rig(owner:string){
  // barricada-2x: the square covers cells 10..11 × 10..11, centred at 11.
  const piece:PieceState={id:'tralha-1',kind:'barricada',cell:{c:10,r:10},owner,x:11*FREE_CELL,y:11*FREE_CELL,hp:200,maxHp:200,startTick:0,readyTick:0};
  const state={defenses:{list:[],pieces:[piece]}} as unknown as StonewardsState;
  const events:SimEvent[]=[];
  const ctx={tick:0,emit:(e:SimEvent)=>{events.push(e);}} as unknown as SimContext&{tick:number};
  return {piece,state,events,ctx};
}

test('the map\'s tralha the body touches goes at once; a player\'s barricada only alerts; tralha off the body stays',()=>{
  const edge=12*FREE_CELL,touch={x:edge+.5,y:11*FREE_CELL,radius:1,heading:Math.PI},off={x:edge+2,y:11*FREE_CELL,radius:1,heading:Math.PI};
  const map=rig(TRALHA_OWNER);
  assert.deepEqual(unoAlertStep(map.ctx,undefined,map.state,off),[],'off the body: stays');
  assert.equal(map.state.defenses!.pieces!.length,1);
  assert.deepEqual(unoAlertStep(map.ctx,undefined,map.state,touch),['tralha-1']);
  assert.equal(map.state.defenses!.pieces!.length,0);
  assert.deepEqual(map.events.filter(e=>e.type==='structure'),[{type:'structure',id:'tralha-1',hp:0,maxHp:200}]);
  const built=rig('ana');
  assert.deepEqual(unoAlertStep(built.ctx,undefined,built.state,touch),[],'a built one: the alert first');
  assert.equal(built.piece.alertUntil!==undefined,true);
  assert.equal(built.state.defenses!.pieces!.length,1);
});

test('a real match: the Uno driven into a square of tralha runs it over, and its blocks never hold it',()=>{
  const s=new Simulation(1,{world:'cidade',terrain:cityAsField(city),cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
  s.add('p0','P0','cidadao-comum');s.resetRun();s.step();
  const pieces=()=>((s.run.stonewards.state as unknown as {defenses?:{pieces?:PieceState[]}}).defenses?.pieces??[]).filter(p=>p.owner===TRALHA_OWNER);
  const all=pieces();
  // NEW-20261029-ORQ-sem-tralha-nas-entradas: off the entrances, fewer squares (4–8 a match); one is enough here.
  assert.ok(all.length>=1,`${all.length} squares`);
  const target=all[0],r=pieceRectOf(target),car=s.run.chaveiro!.state.car;
  // The car's nose into the square's left side, along +x.
  car.x=r.x-.3;car.y=r.y+r.h/2;car.heading=0;
  let gone=false;
  for(let t=0;t<3&&!gone;t++){const ev=s.step();gone=ev.some(e=>e.type==='structure'&&e.id===target.id&&e.hp===0);}
  assert.ok(gone,'a structure event at hp 0 for the square');
  assert.ok(!pieces().some(p=>p.id===target.id),'the square is off the map');
});

test('the loose fences in the open are off the map (at most the one the defence keeps)',()=>{
  const left=cercasSoltas(cityAssetToData(A));
  assert.ok(left.length<=1,`${left.length} loose fences: ${left.map(g=>g.map(t=>`(${t%A.cells.w},${Math.floor(t/A.cells.w)})`).join('')).join(' ')}`);
});

// The body's reach: probes of CELL u × 8 headings (half a turn: the body is symmetric), 4-neighbour moves and turns in place.
const CELL=.5,W=Math.ceil(A.size.w/CELL),H=Math.ceil(A.size.h/CELL),NH=8,NEAR=Math.ceil(3/CELL);
const body=new Uint8Array(W*H*NH);
for(let k=0;k<W*H;k++)for(let h=0;h<NH;h++)body[k*NH+h]=carBodyDiscs((k%W+.5)*CELL,(Math.floor(k/W)+.5)*CELL,h*Math.PI/NH).every(d=>city.clearDisc(d.x,d.y,d.r))?1:0;
const hero=(()=>{const open=(k:number)=>city.clearDisc((k%W+.5)*CELL,(Math.floor(k/W)+.5)*CELL,.35),seen=new Uint8Array(W*H),q=[Math.floor(CAR.x/CELL)+Math.floor(CAR.y/CELL)*W];seen[q[0]]=1;
  for(let i=0;i<q.length;i++){const c=q[i],x=c%W;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const m=c+dx+dy*W;if(x+dx<0||x+dx>=W||m<0||m>=W*H||seen[m]||!open(m))continue;seen[m]=1;q.push(m);}}
  return seen;})();
const SAFE=new Set<number>();for(const p of citySafePlaces(new CityTerrain(A,'uno')))for(const t of p.cells)SAFE.add(t);
const inSafe=(p:Point)=>SAFE.has(Math.floor(p.x/A.unitsPerCell)+Math.floor(p.y/A.unitsPerCell)*A.cells.w);
const centre=(k:number):Point=>({x:(k%W+.5)*CELL,y:(Math.floor(k/W)+.5)*CELL});
function bodyNear(nests:readonly Point[]):Uint8Array{
  const free=(k:number)=>{const p=centre(k);return nests.every(n=>Math.hypot(p.x-n.x,p.y-n.y)>=CAR_NEST_KEEP_OUT);};
  const seen=new Uint8Array(W*H*NH),q:number[]=[],s0=Math.floor(CAR.x/CELL)+Math.floor(CAR.y/CELL)*W;
  for(let h=0;h<NH;h++)if(body[s0*NH+h]){seen[s0*NH+h]=1;q.push(s0*NH+h);}
  for(let i=0;i<q.length;i++){const s=q[i],c=Math.floor(s/NH),h=s%NH,x=c%W,next=[c*NH+(h+1)%NH,c*NH+(h+NH-1)%NH];
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])if(x+dx>=0&&x+dx<W)next.push((c+dx+dy*W)*NH+h);
    for(const n of next)if(n>=0&&n<seen.length&&!seen[n]&&body[n]&&free(Math.floor(n/NH))){seen[n]=1;q.push(n);}}
  const near=new Uint8Array(W*H);
  for(let s=0;s<seen.length;s+=NH){if(!seen.subarray(s,s+NH).some(v=>v))continue;const k=s/NH,x=k%W,y=(k-x)/W;
    for(let dy=-NEAR;dy<=NEAR;dy++)for(let dx=-NEAR;dx<=NEAR;dx++){if(dx*dx+dy*dy>NEAR*NEAR)continue;const X=x+dx,Y=y+dy;if(X>=0&&Y>=0&&X<W&&Y<H)near[X+Y*W]=1;}}
  return near;
}

test('per match, the Uno\'s body gets near ≥ 98 % of the hero\'s ground, every spawn and every crate (off the safe places and the nests)',t=>{
  for(const seed of [1,2,3,4,5,6,7,8]){
    const s=new Simulation(seed,{world:'cidade',terrain:cityAsField(city),cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
    s.add('p0','P0','cidadao-comum');s.resetRun();s.step();
    const nests=(s.run.nests?.state.nests??[]).filter(n=>!n.down).map(n=>({x:n.x,y:n.y}));
    const near=bodyNear(nests),kept=(p:Point)=>!inSafe(p)&&nests.every(n=>Math.hypot(p.x-n.x,p.y-n.y)>=CAR_NEST_KEEP_OUT+3);
    let all=0,got=0;
    for(let k=0;k<W*H;k++)if(hero[k]&&kept(centre(k))){all++;if(near[k])got++;}
    const at=(p:Point)=>near[Math.floor(p.x/CELL)+Math.floor(p.y/CELL)*W]===1;
    t.diagnostic(`seed ${seed}: ${(100*got/all).toFixed(2)} %`);
    assert.ok(got/all>=.98,`seed ${seed}: ${(100*got/all).toFixed(2)} % of the hero's ground`);
    for(const [k,p] of Object.entries({N:P.spawnN,S:P.spawnS,L:P.spawnL,O:P.spawnO}))assert.ok(at(p),`seed ${seed}: spawn ${k}`);
    const out=A.loot.filter(p=>kept(p)&&!at(p));
    assert.deepEqual(out,[],`seed ${seed}: crates the Uno never gets near`);
  }
});

test('the client: a run-over tralha square bursts (only near the Uno) and thwacks; other structures stay quiet',async()=>{
  const {ranOver,runOverPieces}=await import('../../src/client/render/stonewards-rules.ts');
  const {soundForEvent}=await import('../../src/client/audio/events.ts');
  const sq={id:'tralha-3',kind:'barricada',x:10,y:10,hp:200,maxHp:200,c:6,r:6} as never;
  const far={id:'tralha-4',kind:'barricada',x:40,y:40,hp:200,maxHp:200,c:26,r:26} as never;
  const before=new Map([['tralha-3',sq],['tralha-4',far]]);
  assert.deepEqual(ranOver(before,[],{x:11,y:10}).map(s=>s.id),['tralha-3'],'the far one went by a coleta or a horde');
  assert.deepEqual(ranOver(before,[sq,far],{x:11,y:10}),[],'still standing');
  assert.deepEqual(ranOver(before,[],undefined),[],'no Uno');
  // The pieces are cuts of the square's own art: they tile its shown rect exactly, no colour of their own.
  const rect={x:10,y:4,w:96,h:120},pieces=runOverPieces(rect,12,7);
  assert.ok(pieces.length>=8&&pieces.length<=16,`${pieces.length} pieces`);
  assert.equal(pieces.reduce((a,p)=>a+p.w*p.h,0),rect.w*rect.h,'they tile the rect');
  assert.ok(pieces.every(p=>p.x>=rect.x&&p.y>=rect.y&&p.x+p.w<=rect.x+rect.w&&p.y+p.h<=rect.y+rect.h&&p.up>0&&p.spin!==0));
  // Each shows as a 4–6 point shard inside its own cut, so no straight square edge.
  assert.ok(pieces.every(p=>p.shard.length>=4&&p.shard.length<=6&&p.shard.every(q=>q.x>0&&q.y>0&&q.x<p.w&&q.y<p.h)),'shards');
  assert.deepEqual(runOverPieces(rect,12,7),pieces,'seeded');
  assert.deepEqual(runOverPieces({x:0,y:0,w:0,h:10},12,7),[]);
  assert.equal(soundForEvent({type:'structure',id:'tralha-3',hp:0,maxHp:200}),'golpe');
  assert.equal(soundForEvent({type:'structure',id:'tralha-3',hp:100,maxHp:200}),undefined);
  assert.equal(soundForEvent({type:'structure',id:'torre-1',hp:0,maxHp:200}),undefined);
});
