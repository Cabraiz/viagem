// bots-vendedor-aposentado (29/10): a room bot may be any of the 5 active heroes but the gato. Each one walks, attacks and
// rests on its own sheets in all 8 directions (M16: 5 drawn, 3 mirrored), with the real manifest: no frame missing, no
// legacy fallback. The vendedor and the aposentado resolve the same clips as the viciado and the maromba.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {movementPlan} from '../../src/client/sprites/movement128.ts';
import {HERO_DIRECTIONS} from '../../src/client/sprites/sprite-motion.ts';
import {BOT_CLASS_IDS} from '../../src/rules/classes.ts';

const manifest=JSON.parse(readFileSync(new URL('../../public/art/manifest.json',import.meta.url),'utf8'));
const asset=(url:string)=>new URL(`../../public${url}`,import.meta.url);

test('every bot class walks, attacks and rests in the 8 directions on real sheets',()=>{
  setArtIndex(parseArtIndex(manifest));
  assert.deepEqual([...BOT_CLASS_IDS],['viciado-em-bet','clt-cansado','maromba','vendedor-praia','aposentado']);
  for(const id of BOT_CLASS_IDS)for(const motion of ['walk','attack','idle'] as const)for(const d of HERO_DIRECTIONS){
    const p=movementPlan(id,motion,d);
    assert.ok(p,`${id} ${motion} ${d}: a clip`);
    assert.equal(p.columns*p.rows,p.frameCount,`${id} ${motion} ${d}: the grid holds every frame`);
    assert.ok(existsSync(asset(p.original)),`${id} ${motion} ${d}: ${p.original} on disk`);
    assert.ok(existsSync(asset(p.url)),`${id} ${motion} ${d}: ${p.url} (lite) on disk`);
  }
});
