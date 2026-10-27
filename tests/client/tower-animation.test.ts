/**
 * Card NEW-20261025-ORQ-torres-animacao-idle-tiro: the delivered weapon sheets play. The idle loops at its own pace
 * (offset per defense, still with reduced motion), each volley plays the fire sheet from its first frame (the flash on
 * the shot's tick) to its last, then back to the idle; the fire sheet is in the art index with a lite copy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setArtIndex,parseArtIndex} from '../../src/client/art/manifest.ts';
import {clipOf,towerArt,weaponFrame,weaponPose,weaponSeed,type TowerKind} from '../../src/client/render/towers/tower-rules.ts';

const IDLE={frames:4,fps:4},FIRE={frames:8,fps:12};

test('1. idle: loops its frames at its fps, offset by the seed; reduced motion stands on frame 0',()=>{
  assert.deepEqual(weaponPose(0,-1e9,0,IDLE,FIRE),{fire:false,frame:0});
  assert.deepEqual(weaponPose(250,-1e9,0,IDLE,FIRE),{fire:false,frame:1});
  assert.deepEqual(weaponPose(999,-1e9,0,IDLE,FIRE),{fire:false,frame:3});
  assert.deepEqual(weaponPose(1000,-1e9,0,IDLE,FIRE),{fire:false,frame:0},'loops');
  assert.deepEqual(weaponPose(0,-1e9,500,IDLE,FIRE),{fire:false,frame:2},'offset');
  assert.deepEqual(weaponPose(750,-1e9,0,IDLE,FIRE,true),{fire:false,frame:0},'reduced motion');
  assert.deepEqual(weaponPose(750,-1e9,0,{frames:1,fps:4},FIRE),{fire:false,frame:0},'a one-frame idle');
});

test('2. fire: from frame 0 at the volley to the last, then the idle; a new volley restarts it',()=>{
  const at=10000,clip=FIRE.frames*1000/FIRE.fps;
  assert.deepEqual(weaponPose(at,at,0,IDLE,FIRE),{fire:true,frame:0},'the flash frame on the shot');
  assert.deepEqual(weaponPose(at+84,at,0,IDLE,FIRE),{fire:true,frame:1});
  assert.deepEqual(weaponPose(at+clip-1,at,0,IDLE,FIRE),{fire:true,frame:7});
  assert.equal(weaponPose(at+Math.ceil(clip),at,0,IDLE,FIRE).fire,false,'back to the idle');
  assert.deepEqual(weaponPose(at+300,at+300,0,IDLE,FIRE),{fire:true,frame:0},'restarted by the next volley');
  assert.equal(weaponPose(at,at,0,IDLE,FIRE,true).fire,true,'reduced motion still shows the shot');
  assert.equal(weaponPose(at,at,0,IDLE,undefined).fire,false,'no fire sheet loaded: the idle');
  assert.equal(weaponPose(at-1,at,0,IDLE,FIRE).fire,false,'nothing before the volley');
});

test('3. weaponSeed: stable, 0..999; clipOf: the sheet pace or the default',()=>{
  assert.equal(weaponSeed('defesa-1'),weaponSeed('defesa-1'));
  for(const id of ['a','defesa-1','defesa-22','x'.repeat(40)]){const s=weaponSeed(id);assert.ok(s>=0&&s<1000,`${id}: ${s}`);}
  assert.notEqual(weaponSeed('defesa-1'),weaponSeed('defesa-2'));
  assert.deepEqual(clipOf({frames:6,fps:12},4),{frames:6,fps:12});
  assert.deepEqual(clipOf({frames:6},12),{frames:6,fps:12});
  assert.deepEqual(clipOf({frames:6,fps:{idle:3}},12),{frames:6,fps:12},'per-motion fps maps: the default');
  assert.equal(clipOf(undefined,4),undefined);
});

test('4. towerArt: the fire sheet with its idle; the real manifest has a lite fire for every tower with one',()=>{
  setArtIndex(parseArtIndex({version:2,groups:{torres:{output:'public/art/towers',pieces:{
    morteiro:{kind:'views',files:{base:{file:'morteiro/base.webp',cell:[448,448],views:4,rows:6},idle:{file:'morteiro/idle.webp',cell:[160,160],frames:4,directions:8},
      fire:{file:'morteiro/fire.webp',cell:[160,160],frames:8,directions:8,fps:12}}},
    holofote:{kind:'views',files:{base:{file:'holofote/base.webp',cell:[256,512],views:4,rows:6},fire:{file:'holofote/fire.webp',cell:[160,160],frames:4,directions:8}}}}}}}));
  assert.equal(towerArt('morteiro')?.fire?.frames,8);
  assert.equal(towerArt('holofote')?.fire,undefined,'no idle sheet: no fire either (the weapon is procedural)');
  const index=JSON.parse(readFileSync('public/art/manifest.json','utf8'));
  setArtIndex(parseArtIndex(index));
  const kinds=Object.keys(index.groups.torres.pieces) as TowerKind[];
  let fires=0;
  for(const k of kinds){
    const a=towerArt(k);if(!a?.fire)continue;fires++;
    assert.ok(a.fire.liteCell,`${k}: fire sem cópia lite (node scripts/art-lite.mjs --kinds towers)`);
    assert.equal(a.fire.directions,8,`${k}: 8 direções`);
    assert.ok(weaponFrame(7,(a.fire.frames??1)-1,a.fire.frames??1)<(a.fire.frames??1)*8,k);
  }
  assert.ok(fires>=14,`${fires} torres com fire`);
  setArtIndex(parseArtIndex({version:2,groups:{}}));
});

test('5. meta.muzzle: 8 cell fractions with the idle sheet, else none; the six that shoot from a barrel have it',()=>{
  const piece=(muzzle:unknown)=>({kind:'views',meta:{muzzle},files:{base:{file:'b.webp',cell:[448,448],views:4,rows:6},idle:{file:'i.webp',cell:[160,160],frames:4,directions:8}}});
  const eight=Array.from({length:8},(_,i)=>[i/10,.5]);
  setArtIndex(parseArtIndex({version:2,groups:{torres:{output:'public/art/towers',pieces:{morteiro:piece(eight),obuseiro:piece(eight.slice(0,7)),holofote:piece([...eight.slice(0,7),[1.2,.5]])}}}}));
  assert.deepEqual(towerArt('morteiro')?.muzzle?.[3],[.3,.5]);
  assert.equal(towerArt('obuseiro')?.muzzle,undefined,'7 directions: refused');
  assert.equal(towerArt('holofote')?.muzzle,undefined,'outside the cell: refused');
  setArtIndex(parseArtIndex(JSON.parse(readFileSync('public/art/manifest.json','utf8'))));
  for(const k of ['obuseiro','antiaerea-quadrupla','holofote','morteiro','rojao-de-festa','lanca-foguetes'] as TowerKind[])
    assert.equal(towerArt(k)?.muzzle?.length,8,`${k}: boca nas 8 direções (evidence/…/bocas.mjs)`);
  setArtIndex(parseArtIndex({version:2,groups:{}}));
});
