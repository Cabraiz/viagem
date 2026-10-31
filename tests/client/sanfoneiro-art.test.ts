import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setArtIndex,parseArtIndex,artPiece} from '../../src/client/art/manifest.ts';
import {enemyFrame,enemyPieceLoads,fileInfo,loopAnim,rowFrames} from '../../src/client/art/horde-art.ts';
import {MENDIGO,gameEnemyArt,keepsOwnArt} from '../../src/client/art/mendigo.ts';
import {INIMIGOS_LIBERADOS} from '../../src/rules/inimigos-liberados.ts';

// Card sanfoneiro-brinquedo-no-jogo: the wooden toy sanfoneiro, 16-frame idle in 8 directions plus its cast shadow.
const EMPTY={version:2,groups:{}};
afterEach(()=>setArtIndex(parseArtIndex(EMPTY)));
const enemies=JSON.parse(readFileSync(new URL('../../public/art/enemies/manifest.json',import.meta.url),'utf8'));
const SANF=enemies.pieces.sanfoneiro;
const load=(extra:Record<string,unknown>={})=>setArtIndex(parseArtIndex({version:2,groups:{inimigos:{output:'public/art/enemies',
  pieces:{sanfoneiro:SANF,...extra}}}}));

test('the sanfoneiro piece: idle 16 × 8 and its shadow on the same grid',()=>{
  assert.ok(Object.keys(SANF.files).includes('idle'));
  assert.ok(Object.keys(SANF.files).includes('shadow/idle'));
  const body=SANF.files.idle,shadow=SANF.files['shadow/idle'];
  assert.equal(body.frames,16);assert.equal(body.directions,8);
  for(const k of ['cell','frames','directions','dirFrames','anchor','fps'])assert.deepEqual(shadow[k],body[k],k);
  load();
  assert.ok(artPiece('inimigos','sanfoneiro'));
  assert.ok(enemyPieceLoads('sanfoneiro').map(l=>l.key).includes('art:enemy:sanfoneiro:shadow/idle'),'the shadow sheet loads');
});

test('every row loops its 16 frames and the idle serves the walk until the walk sheet lands',()=>{
  load();
  const info=fileInfo('sanfoneiro','idle',SANF.files.idle),frameMs=1000/info.fps;
  for(let r=0;r<8;r++){
    assert.equal(rowFrames(info,r),16);
    const seen=new Set<number>();
    for(let i=0;i<48;i++)seen.add(enemyFrame('sanfoneiro',SANF,'idle',r,(i+.5)*frameMs)!.frame);
    assert.equal(seen.size,16,`row ${r}`);
  }
  const piece=artPiece('inimigos','sanfoneiro')!;
  assert.equal(loopAnim(piece,false,false),'idle');
  if(!SANF.files.walk)assert.equal(loopAnim(piece,true,false),'idle');
});

test('liberated with his own art: never drawn as the mendigo',()=>{
  assert.ok(INIMIGOS_LIBERADOS.includes('sanfoneiro'));
  assert.ok(keepsOwnArt('sanfoneiro'));
  load({[MENDIGO]:SANF});
  assert.equal(gameEnemyArt('sanfoneiro'),'sanfoneiro');
});

test('the sanfoneiro\'s copies: smaller than the source, the shadow at half, a phone GPU bound',()=>{
  const body=SANF.files.idle,shadow=SANF.files['shadow/idle'];
  for(const f of ['liteCell','pcCell']){
    assert.ok(body[f][1]<body.cell[1],`${f} smaller than the source`);
    assert.equal(shadow[f][1],Math.ceil(body[f][1]/2),`${f}: the shadow at half the body's`);
  }
  // Phone GPU memory of both sheets (RGBA): 16 × 8 cells each.
  const mb=(c:number[])=>16*c[0]*8*c[1]*4/2**20;
  assert.ok(mb(body.liteCell)+mb(shadow.liteCell)<18,`${(mb(body.liteCell)+mb(shadow.liteCell)).toFixed(1)} MB`);
});
