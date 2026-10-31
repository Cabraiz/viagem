// NEW-20261029-E3-sandbox-elenco-ativo: `?sandbox=horda&elenco=1` shows today's cast (the liberated enemies, each with
// its own warning, and liberated heroes), the old D-033 line-up only behind `elenco=legado`; the HUD sandboxes' team is
// made of liberated heroes only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ALIADO_SLOT,AVISO,elencoAtivo,elencoMode,heroiDoJogador} from '../../src/client/sandboxes/elenco-ativo.ts';
import {fakePlayers,fakeResult,HUD_SCENARIOS} from '../../src/client/hud/fixtures.ts';
import {ELITE_ONLY,INIMIGOS_LIBERADOS,PERSONAGEM_PADRAO,PERSONAGENS_LIBERADOS} from '../../src/rules/index.ts';

test('elenco=1: the line-up is INIMIGOS_LIBERADOS, in order, the elite-only ones as elites (none: the saci is the chefão)',()=>{
  const slots=elencoAtivo();
  assert.deepEqual(slots.map(s=>s.id),[...INIMIGOS_LIBERADOS]);
  for(const s of slots)assert.equal(s.elite,ELITE_ONLY.includes(s.id),s.id);
  assert.equal(slots.find(s=>s.id==='aberracao-saci')?.elite,false,'the chefão: his own 2.8-hero drawing, no elite scale');
  // Every slot apart from the others and from the hero and his ally (no two figures on the same feet).
  const spots=[[0,0],[...ALIADO_SLOT],...slots.map(s=>[s.sx,s.sy])];
  assert.equal(new Set(spots.map(p=>p.join())).size,spots.length);
});

test('elenco=1: every liberated enemy has its own warning, the sanfoneiro\'s ready for when he joins',()=>{
  for(const id of [...INIMIGOS_LIBERADOS,'sanfoneiro']){
    const aviso=AVISO[id];assert.ok(aviso,id);
    const [,shape,radius,width,ticks]=aviso;
    assert.ok(radius>0&&ticks>0,id);
    assert.equal(shape==='cone',width!==undefined,id);
  }
});

test('elenco=1: the first player is PERSONAGEM_PADRAO and the ally another liberated hero',()=>{
  assert.equal(heroiDoJogador(0),PERSONAGEM_PADRAO);
  assert.notEqual(heroiDoJogador(1),PERSONAGEM_PADRAO);
  for(let i=0;i<6;i++)assert.ok(PERSONAGENS_LIBERADOS.includes(heroiDoJogador(i)),String(i));
});

test('elenco=legado keeps the D-033 line-up; the stress run has no line-up',()=>{
  assert.equal(elencoMode('1'),'ativo');
  assert.equal(elencoMode('legado'),'legado');
  assert.equal(elencoMode(null),undefined);
  const src=readFileSync(new URL('../../src/client/sandboxes/sandbox-horde.ts',import.meta.url),'utf8');
  for(const kind of ['coach','motoboy','influencer','agiota'])assert.match(src,new RegExp(`\\['${kind}'`),kind);
});

test('HUD fixtures: no hero outside PERSONAGENS_LIBERADOS, in any scenario or the result',()=>{
  for(const scenario of HUD_SCENARIOS)for(const p of fakePlayers(6,scenario))assert.ok(PERSONAGENS_LIBERADOS.includes(p.classId),`${scenario} ${p.id} ${p.classId}`);
  for(const p of fakeResult(6,true,true).players)assert.ok(PERSONAGENS_LIBERADOS.includes(p.classId),p.classId);
  assert.equal(fakePlayers(1)[0].classId,PERSONAGEM_PADRAO);
});
