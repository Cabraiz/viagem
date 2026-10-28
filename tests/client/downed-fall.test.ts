// Card NEW-20261028-ORQ-queda-6-herois: a downed hero falls through its downed16 (16 poses, one gag, the last pose held
// until someone lifts it) instead of the rest sprite turned −90°; each of the 6 menu heroes has it in all 8 directions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {hasDowned16,downedPlan,swingFrame,MOVEMENT16_DURATION} from '../../src/client/sprites/movement128.ts';
import {HERO_DIRECTIONS} from '../../src/client/sprites/sprite-motion.ts';

const HEROES=['aposentado','clt-cansado','viciado-em-bet','maromba','vendedor-praia','gato-nada-pra-comer'];
const index=()=>setArtIndex(parseArtIndex(JSON.parse(readFileSync('public/art/manifest.json','utf8'))));

test('the 6 menu heroes fall through a downed16 in all 8 directions, played once',()=>{
  index();
  for(const id of HEROES){
    assert.ok(hasDowned16(id),`${id}: downed16`);
    for(const d of HERO_DIRECTIONS){const p=downedPlan(id,d)!;assert.equal(p.motion,'downed');assert.equal(p.loop,false);assert.equal(p.frameCount,16);assert.equal(p.durationMs,MOVEMENT16_DURATION.downed);}
  }
  assert.equal(hasDowned16('nao-existe'),false);assert.equal(downedPlan('nao-existe','S'),undefined,'no sheet: the scene turns the rest −90°');
});

test('the fall holds its last pose (lying) after it ends, until the hero is lifted',()=>{
  const plan={frameCount:16},at=(ms:number)=>swingFrame(plan,ms/MOVEMENT16_DURATION.downed);
  assert.equal(at(0),0,'starts standing (the rest pose)');
  for(let ms=0,last=0;ms<=MOVEMENT16_DURATION.downed;ms+=50){const f=at(ms);assert.ok(f>=last,'never goes back');last=f;}
  for(const ms of [MOVEMENT16_DURATION.downed,5_000,60_000])assert.equal(at(ms),15);
});

test('no downed16 cell has the body within 2 px of its edge',async()=>{
  const sprites=JSON.parse(readFileSync('public/art/sprites/manifest.json','utf8')).pieces;
  for(const id of HEROES)for(const [key,f] of Object.entries<any>(sprites[id].files)){
    if(!key.startsWith('downed16-'))continue;
    const {data,info}=await sharp(path.join('public/art/sprites',f.pages[0].file)).ensureAlpha().raw().toBuffer({resolveWithObject:true}),[cw,ch]=f.cell;
    for(let i=0;i<f.frames;i++){
      const ox=i%f.pages[0].columns*cw,oy=Math.floor(i/f.pages[0].columns)*ch;
      for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
        if(x>=2&&y>=2&&x<cw-2&&y<ch-2)continue;
        assert.ok(data[((oy+y)*info.width+ox+x)*4+3]<=20,`${id} ${key} q${i}: pixel at (${x},${y})`);
      }
    }
  }
});
