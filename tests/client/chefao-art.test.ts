/**
 * The HD chefões' sheets on demand (BUG-20261025-ORQ-celular-travando, src/client/art/chefao-art.ts): none at the
 * opening, the run's chefão (the elenco's last HD id) before the minuto de Minerva ends or on his scene, a fallen one
 * freed after his death, and the scene's opening loop skips them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CHEFAO_LEAD_S,CHEFAO_NO_MINERVA_S,CHEFAO_RELEASE_MS,ChefaoArtPlan,chefaoDeferred} from '../../src/client/art/chefao-art.ts';
import {HD_ENEMIES} from '../../src/client/art/manifest.ts';
import {SCALED_WAVE_BOSS_IDS} from '../../src/rules/index.ts';

const ELENCO=['pombo-da-praca','o-grande-credor','motoboy','mapinguari-do-shopping'];
const base={elenco:ELENCO,combat:true,tick:0};

test('every HD wave chefão waits; a common enemy and the saci (his 256 px sheet rides the elenco) do not',()=>{
  for(const id of SCALED_WAVE_BOSS_IDS)assert.ok(chefaoDeferred(id),id);
  assert.equal(chefaoDeferred('aberracao-saci'),false);
  for(const id of HD_ENEMIES)assert.ok(chefaoDeferred(id),id);
  assert.equal(chefaoDeferred('motoboy'),false);
  assert.equal(ChefaoArtPlan.waveChefao(ELENCO),'mapinguari-do-shopping');
  assert.equal(ChefaoArtPlan.waveChefao(['motoboy']),undefined);
});

test('the run\'s chefão loads CHEFAO_LEAD_S before Minerva ends, once, and nobody else',()=>{
  const plan=new ChefaoArtPlan(20),until=2400;
  assert.deepEqual(plan.step({...base,nowMs:0,minervaAteTick:until}),{load:[],release:[]});
  assert.deepEqual(plan.step({...base,nowMs:1,tick:until-CHEFAO_LEAD_S*20-1,minervaAteTick:until}).load,[]);
  assert.deepEqual(plan.step({...base,nowMs:2,tick:until-CHEFAO_LEAD_S*20,minervaAteTick:until}).load,['mapinguari-do-shopping']);
  assert.deepEqual(plan.step({...base,nowMs:3,tick:until+1}).load,[]);
});

test('Minerva over before the plan saw the lead (a late joiner) or no Minerva at all',()=>{
  const late=new ChefaoArtPlan(20);
  late.step({...base,nowMs:0,tick:10,minervaAteTick:2400});
  assert.deepEqual(late.step({...base,nowMs:5,tick:2401}).load,['mapinguari-do-shopping']);
  const none=new ChefaoArtPlan(20);
  assert.deepEqual(none.step({...base,nowMs:0}).load,[]);
  assert.deepEqual(none.step({...base,nowMs:CHEFAO_NO_MINERVA_S*1000-1}).load,[]);
  assert.deepEqual(none.step({...base,nowMs:CHEFAO_NO_MINERVA_S*1000}).load,['mapinguari-do-shopping']);
});

test('his arrival scene names him: he loads then, whatever the clock',()=>{
  const plan=new ChefaoArtPlan(20);
  assert.deepEqual(plan.step({...base,nowMs:0,minervaAteTick:9999,cenaWho:'o-grande-credor'}).load,['o-grande-credor']);
  assert.deepEqual(plan.step({...base,nowMs:1,tick:9999}).load,[],'the clock does not ask a second one');
});

test('out of combat nothing loads, and a rematch starts the clock over',()=>{
  const plan=new ChefaoArtPlan(20);
  assert.deepEqual(plan.step({...base,combat:false,nowMs:0,tick:5000}).load,[]);
  plan.step({...base,nowMs:0,tick:5000});
  plan.step({...base,combat:false,nowMs:10});
  assert.deepEqual(plan.step({...base,nowMs:20,minervaAteTick:2400,tick:0}).load,[],'already loaded: not asked again');
});

test('a fallen chefão lets his sheets go CHEFAO_RELEASE_MS later; he loads again on his next scene',()=>{
  const plan=new ChefaoArtPlan(20);
  plan.step({...base,nowMs:0,cenaWho:'mapinguari-do-shopping'});
  plan.killed('motoboy',100);
  plan.killed('mapinguari-do-shopping',100);
  assert.deepEqual(plan.step({...base,nowMs:100+CHEFAO_RELEASE_MS-1}).release,[]);
  assert.deepEqual(plan.step({...base,nowMs:100+CHEFAO_RELEASE_MS}).release,['mapinguari-do-shopping']);
  assert.deepEqual(plan.step({...base,nowMs:100+CHEFAO_RELEASE_MS+1,cenaWho:'mapinguari-do-shopping'}).load,['mapinguari-do-shopping']);
});

test('the scene skips the HD chefões in the opening elenco loop and frees them on a kill',()=>{
  const scene=readFileSync(new URL('../../src/client/scene.ts',import.meta.url),'utf8');
  assert.match(scene,/for\(const id of elenco\)if\(!chefaoDeferred\(id\)\)queueEnemyArt\(this,id\)/);
  assert.match(scene,/onKill:kind=>this\.chefaoArt\.killed\(kind,performance\.now\(\)\)/);
  assert.match(scene,/releaseEnemyArt\(this,id\)/);
});
