// Card NEW-20261029-ORQ-mendigo-andar-poses: the supervision tools (proporcao.mjs, troca-de-perna.mjs) measure the
// mendigo through scripts/inimigos-m16.mjs; the game loads it through src/client/art/mendigo.ts. Both read the same files.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
// @ts-expect-error plain ESM script without types
import {ENEMIES,mendigoPiece,withEnemies} from '../../scripts/inimigos-m16.mjs';
import {MENDIGO,MENDIGO_FILES} from '../../src/client/art/mendigo.ts';

test('the mendigo the tools measure is the one the game loads: idle and walk, 8 directions, 16 frames, 192 px cells',()=>{
  const files:Record<string,{file:string,frames:number,cell:number[]}>=mendigoPiece().files;
  for(const motion of ['idle','walk'] as const){
    const game=MENDIGO_FILES[motion];
    const pages=(game.pages??[]).map(p=>p.file);
    const tool=Object.entries(files).filter(([k])=>k.startsWith(`${motion}16-`)).map(([,f])=>f);
    assert.deepEqual(tool.map(f=>f.file).sort(),[...pages].sort(),`${motion}: the same files`);
    for(const f of tool){
      assert.equal(f.frames,game.frames);
      assert.deepEqual(f.cell,game.cell);
      assert.ok(existsSync(join(ENEMIES,f.file)),f.file);
    }
  }
});

test('withEnemies adds the mendigo to a copy of the manifest',()=>{
  const base={pieces:{x:{files:{}}}},m=withEnemies(base);
  assert.deepEqual(Object.keys(m.pieces),['x',MENDIGO]);
  assert.deepEqual(Object.keys(base.pieces),['x']);
});
