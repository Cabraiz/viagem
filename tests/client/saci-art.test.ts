import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setArtIndex,parseArtIndex,artPiece} from '../../src/client/art/manifest.ts';
import {ENEMY_DRAW_SCALE,HERO_DRAW_SCALE} from '../../src/client/render/draw-scale.ts';
import {ART_HEIGHT,HERO_FIGURE_PX,SHADOW,artTargetHeight,chooseAnim,drawnScale,enemyFrame,enemyFrameAt,enemyPieceLoads,fileInfo,loopAnim,
  ownElite,rowFrames} from '../../src/client/art/horde-art.ts';

// Card saci-elite-no-jogo: E1's aberração-saci, an elite-only figure with a real cast shadow sheet and 7-15 frames per row.
const EMPTY={version:2,groups:{}};
afterEach(()=>setArtIndex(parseArtIndex(EMPTY)));
const enemies=JSON.parse(readFileSync(new URL('../../public/art/enemies/manifest.json',import.meta.url),'utf8'));
const SACI=enemies.pieces['aberracao-saci'];
const loadSaci=(piece=SACI)=>setArtIndex(parseArtIndex({version:2,groups:{inimigos:{output:'public/art/enemies',pieces:{'aberracao-saci':piece}}}}));

test('the saci piece: idle and its shadow on the same grid, frames per row, its own elite art',()=>{
  assert.deepEqual(Object.keys(SACI.files).sort(),['idle','shadow/idle']);
  const body=SACI.files.idle,shadow=SACI.files['shadow/idle'];
  assert.deepEqual(body.dirFrames,[14,10,12,7,13,15,11,9]);
  for(const k of ['cell','frames','directions','dirFrames','anchor','fps'])assert.deepEqual(shadow[k],body[k],k);
  assert.equal(body.frames,Math.max(...body.dirFrames));
  assert.deepEqual(SACI.meta,{eliteArt:true});
  loadSaci();
  const piece=artPiece('inimigos','aberracao-saci')!;
  assert.deepEqual(piece.files.idle.dirFrames,body.dirFrames,'the parsed index keeps dirFrames');
  assert.ok(ownElite(piece));
  // Both sheets load (the shadow is drawn), each under its own key.
  assert.deepEqual(enemyPieceLoads('aberracao-saci').map(l=>l.key).sort(),['art:enemy:aberracao-saci:idle','art:enemy:aberracao-saci:shadow/idle']);
});

test('a malformed dirFrames is dropped: every row then plays the widest count',()=>{
  const file=(dirFrames:unknown)=>({file:'saci/idle.webp',cell:[256,256],frames:15,directions:8,dirFrames});
  for(const bad of [[14,10],[14,10,12,7,13,16,11,9],[14,10,12,0,13,15,11,9],[14,10,12,7.5,13,15,11,9],'14'])
    {loadSaci({kind:'animations',files:{idle:file(bad)}});assert.equal(artPiece('inimigos','aberracao-saci')?.files.idle.dirFrames,undefined,String(bad));}
  loadSaci({kind:'animations',files:{idle:file([14,10,12,7,13,15,11,9])}});
  assert.deepEqual(artPiece('inimigos','aberracao-saci')?.files.idle.dirFrames,[14,10,12,7,13,15,11,9]);
});

test('each row loops on its own frames, never on the empty cells past them',()=>{
  const info=fileInfo('aberracao-saci','idle',SACI.files.idle),dirs=SACI.files.idle.dirFrames as number[];
  assert.deepEqual(dirs.map((_,r)=>rowFrames(info,r)),dirs);
  assert.equal(rowFrames(info,-3),dirs[0]);assert.equal(rowFrames(info,99),dirs[7],'clamped like the rows');
  const frameMs=1000/info.fps,at=(n:number)=>(n+.5)*frameMs;
  for(let r=0;r<8;r++){
    const n=dirs[r],seen=new Set<number>();
    for(let i=0;i<3*n;i++)seen.add(enemyFrame('aberracao-saci',SACI,'idle',r,at(i))!.frame);
    assert.equal(seen.size,n,`row ${r} shows its ${n} frames`);
    assert.ok([...seen].every(f=>f>=r*15&&f<r*15+n),`row ${r} stays in its first ${n} columns`);
    assert.equal(enemyFrame('aberracao-saci',SACI,'idle',r,at(n))!.frame,r*15,'the frame after the last is the first');
    assert.equal(enemyFrameAt('aberracao-saci',SACI,'idle',r,n)!.frame,r*15,'a column past the row is its first frame');
    assert.equal(enemyFrameAt('aberracao-saci',SACI,'idle',r,n-1)!.frame,r*15+n-1);
  }
  // Without dirFrames every row keeps the widest count (the rest of the roster).
  const plain=fileInfo('x','idle',{file:'x.webp',cell:[96,96],frames:8,directions:8});
  assert.equal(rowFrames(plain,3),8);
});

test('the saci is its own elite: no elite layer needed, the idle walks, the shadow sheet is never a loop',()=>{
  loadSaci();
  const piece=artPiece('inimigos','aberracao-saci')!;
  const elite=(e:boolean)=>e&&!ownElite(piece);
  assert.equal(loopAnim(piece,true,elite(true)),'idle','no walk yet: the idle serves');
  assert.equal(loopAnim(piece,false,elite(true)),'idle');
  assert.equal(chooseAnim({kind:'animations',files:{[SHADOW+'idle']:SACI.files.idle}},false),undefined,'a shadow alone is no animation');
  assert.equal(ownElite({kind:'animations',files:{}}),false);
});

// Card saci-chefe-2x (the user, 30/10: "O saci é o boss do jogo então ponha o saci 2x"): 2.8 heroes, twice his 1.4.
test('the saci, the chefão, stands 2.8× the hero on screen (2× his old 1.4), and no elite scale on top',()=>{
  // On screen: the enemy's ENEMY_DRAW_SCALE over the hero's HERO_DRAW_SCALE (else 1.4 × 1.15 / 0.8 ≈ 2×).
  const onScreen=(art:number)=>art*ENEMY_DRAW_SCALE/(HERO_FIGURE_PX*HERO_DRAW_SCALE);
  assert.ok(Math.abs(onScreen(artTargetHeight('aberracao-saci'))-2.8)<1e-9);
  assert.equal(artTargetHeight('aberracao-saci'),HERO_FIGURE_PX*ART_HEIGHT['aberracao-saci']);
  assert.equal(drawnScale('aberracao-saci',140,false),artTargetHeight('aberracao-saci')/140);
});

test('the saci\'s copies: sized for his own height (no elite × 1.35), the shadow in half the cell',()=>{
  const body=SACI.files.idle,shadow=SACI.files['shadow/idle'];
  for(const f of ['liteCell','pcCell']){
    // At 2.8 heroes the PC copy needs the whole 256 px source; the phone copy stays smaller.
    assert.ok(f==='pcCell'?body[f][1]<=body.cell[1]:body[f][1]<body.cell[1],`${f} within the source`);
    assert.equal(shadow[f][1],Math.ceil(body[f][1]/2),`${f}: the shadow at half the body's`);
  }
  // Phone GPU memory of both sheets (RGBA): 15 × 8 cells each. ~19 MB at 2.8 heroes, one chefão on screen (a legacy
  // chefão's idle alone is ~18 MB).
  const mb=(c:number[])=>15*c[0]*8*c[1]*4/2**20;
  assert.ok(mb(body.liteCell)+mb(shadow.liteCell)<20,`${(mb(body.liteCell)+mb(shadow.liteCell)).toFixed(1)} MB`);
});
