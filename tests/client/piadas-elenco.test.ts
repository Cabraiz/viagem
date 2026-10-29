import test from 'node:test';
import assert from 'node:assert/strict';
import {DEATH_LINES,ELENCO_POPS,ELENCO_STYLES,GENERIC_LINES,deathLine,deathLines,kindStyle,styleKey} from '../../src/client/render/jokes.ts';
import {CLASS_LINES} from '../../src/client/fun/lines.data.ts';
import {INIMIGOS_LIBERADOS} from '../../src/rules/inimigos-liberados.ts';
import {PERSONAGENS_LIBERADOS} from '../../src/rules/personagens-liberados.ts';
import {ELITE_ROUND_NAMES,MODIFIERS,ROUND_NAMES} from '../../src/rules/waves.ts';
import {CIDADE_ELITE_ROUND_NAMES,CIDADE_HORN_LINES,CIDADE_MODIFIERS,CIDADE_ROUND_NAMES} from '../../src/rules/zueira-cidade.ts';

/** The game's enemies (NEW-20261029-E3-piadas-so-elenco-ativo): the liberated ones plus the sanfoneiro, held until his rule lands. */
const ELENCO=[...new Set([...INIMIGOS_LIBERADOS,'sanfoneiro'])];
/** Words that name a hidden enemy (the nine's legacy kinds). The síndico/chefão boss stays in the game. */
const HIDDEN=/pombo|agiota|b[êe]bad|pav[êe]|molotov|an[ãa]o|coach|motoboy|influencer/i;
/**
 * Modifiers that only exist because of a hidden kind: they stay as they are, as legacy, until the rotation takes
 * them out of the draw (the ORQ's card).
 */
const HIDDEN_KIND_MODIFIERS=new Set(['uncle-party','mosquito-swarm','lovesick-slimes','taxman-day-off','audit-day','uncle-hug','bug-spray',
  'uncle-popsicle','beanie-mosquito','frozen-ink']);

test('each enemy in the game has at least 5 own death pops, in CAIXA ALTA and at most 22 chars', ()=>{
  for(const kind of ELENCO){
    const pops=deathLines(kind);
    assert.equal(pops,ELENCO_POPS[kind],kind);
    assert.notEqual(pops,GENERIC_LINES,kind);
    assert.ok(pops.length>=5,kind);
    assert.equal(new Set(pops).size,pops.length,`${kind}: no repeated pop`);
    for(const pop of pops){
      assert.equal(pop,pop.toUpperCase(),`${kind}: ${pop}`);
      assert.ok(pop.length<=22,`${kind}: ${pop}`);
      assert.ok(!GENERIC_LINES.includes(pop),`${kind}: ${pop}`);
      assert.doesNotMatch(pop,HIDDEN,`${kind}: ${pop}`);
    }
    assert.ok(pops.includes(deathLine(kind,'e1')));
  }
});

test('the enemies in the game have their own pop style, not the generic one', ()=>{
  for(const kind of ELENCO){
    assert.equal(kindStyle(kind),ELENCO_STYLES[kind],kind);
    assert.equal(styleKey(kind),kind);
  }
  assert.equal(new Set(ELENCO.map(k=>ELENCO_STYLES[k].stroke)).size,ELENCO.length,'one stroke per enemy');
});

test('the nine legacy kinds keep their own pops', ()=>{
  for(const [kind,lines] of Object.entries(DEATH_LINES))assert.equal(deathLines(kind),lines);
});

test('no visible round title or neutral modifier cites a hidden enemy', ()=>{
  for(const name of [...ROUND_NAMES,...ELITE_ROUND_NAMES,...CIDADE_ROUND_NAMES,...CIDADE_ELITE_ROUND_NAMES])assert.doesNotMatch(name,HIDDEN,name);
  for(const m of [...MODIFIERS,...CIDADE_MODIFIERS]){
    if(HIDDEN_KIND_MODIFIERS.has(m.id))continue;
    assert.doesNotMatch(`${m.name}: ${m.description}`,HIDDEN,m.id);
  }
  for(const line of CIDADE_HORN_LINES)assert.doesNotMatch(line,HIDDEN,line);
});

test('no victory or defeat line of a hero in the game cites a hidden enemy', ()=>{
  for(const id of PERSONAGENS_LIBERADOS){
    const lines=CLASS_LINES[id];
    assert.ok(lines,id);
    for(const line of [...lines.win,...lines.lose])assert.doesNotMatch(line,HIDDEN,`${id}: ${line}`);
  }
});
