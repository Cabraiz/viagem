import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {withMendigo} from '../../src/client/art/mendigo.ts';
import {DEATH_LINES,GENERIC_LINES,MENDIGO_POPS,SACI_POPS,deathLine,deathLines} from '../../src/client/render/jokes.ts';
import {ENEMY_KINDS} from '../../src/client/render/keys.ts';
import {ROSTER} from '../../src/rules/enemy-roster.ts';

/** The legacy cast (auditoria-textos-30-10 §3-4) and the glossary: none of it may pop over the mendigo or the saci. */
const LEGACY=/s[íi]ndico|condom[íi]nio|assembleia|story|pav[êe]|agiota|porra/i;

test('pops de morte: a body drawn as the mendigo pops the mendigo, the saci its own, never the legacy kind', ()=>{
  setArtIndex(withMendigo(parseArtIndex({version:2,groups:{inimigos:{output:'public/art/enemies',pieces:{}}}})));
  try{
    for(const kind of ['bebado','agiota','influencer','coach','sanfoneiro'])assert.equal(deathLines(kind),MENDIGO_POPS,kind);
    assert.equal(deathLines('aberracao-saci'),SACI_POPS);
    for(let i=0;i<40;i++)assert.ok(MENDIGO_POPS.includes(deathLine('influencer',`e-${i}`)));
    const commons=[...ENEMY_KINDS,...ROSTER.map(e=>e.id)].filter(k=>deathLines(k)===MENDIGO_POPS);
    assert.ok(commons.length>100,'every plain enemy, legacy or roster, pops the mendigo');
    for(const line of [...MENDIGO_POPS,...SACI_POPS]){
      assert.doesNotMatch(line,LEGACY,line);
      assert.doesNotMatch(line,/\.\.\./,line);
    }
  }finally{setArtIndex(parseArtIndex({}));}
});

test('pops de morte: without the mendigo piece (hand-built index) each kind keeps its own pops; no swear word left', ()=>{
  assert.equal(deathLines('bebado'),DEATH_LINES.bebado);
  assert.equal(deathLines('gosma'),GENERIC_LINES);
  assert.ok(DEATH_LINES.agiota.includes('QUITADO!'));
  for(const lines of Object.values(DEATH_LINES))for(const line of lines)assert.doesNotMatch(line,/porra/i,line);
});
