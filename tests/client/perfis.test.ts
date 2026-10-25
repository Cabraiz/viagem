// The new enemy's dating-app profile (card nome-inimigo-rede-social, hud/perfis.ts): once per kind, near the hero (the
// boss from anywhere), PROFILE_MS on screen without pausing anything, a fan of at most FAN_MAX when several come in a
// row, the clock standing still under a window, ✕/✓ to throw it away; the texts' limits and one photo per profile.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {FAN_MAX,LEAVE_MS,MATCH_MS,NEAR_M,PERFIS_KEY,PROFILE_MS,ProfileDeck,fanPose,loadSeen,perfilOf,saveSeen,type DeckInput} from '../../src/client/hud/perfis.ts';
import {PERFIS_TEXTO} from '../../src/client/hud/perfis-texto.ts';
import {ROSTER} from '../../src/rules/index.ts';
import {ENEMY_ART_IDS} from '../../src/rules/enemy-art-ids.ts';

const has=(k:string)=>!!perfilOf(k);
const at=(kind:string,x=2,y=0,extra:Partial<DeckInput['enemies'][number]>={})=>({kind,x,y,...extra});
const hero={x:0,y:0};
const kinds=(deck:ProfileDeck)=>deck.shown.filter(c=>!c.leaving).map(c=>c.kind);

test('lotes 1–3: every P0 and P1 kind with art has a profile with its photo; the texts fit the card',()=>{
  const ids=Object.keys(PERFIS_TEXTO);
  assert.equal(ids.length,132);
  const due=ROSTER.filter(e=>(e.priority==='P0'||e.priority==='P1')&&ENEMY_ART_IDS.includes(e.id)).map(e=>e.id);
  assert.deepEqual(due.filter(id=>!ids.includes(id)),[],'P0/P1 with art and no profile');
  for(const id of ids){
    const p=perfilOf(id);
    assert.ok(p,`${id} is in the roster`);
    assert.equal(p.name,ROSTER.find(e=>e.id===id)?.name);
    assert.ok(existsSync(fileURLToPath(new URL(`../../public${p.foto}`,import.meta.url))),`${id}: photo`);
    assert.ok(p.bio.length<=66,`${id}: bio ${p.bio.length}`);
    assert.ok(p.recado.length<=28,`${id}: recado ${p.recado.length}`);
    assert.ok(p.idade.length>0&&p.idade.length<=24,`${id}: idade`);
  }
  for(const b of ['curtir','passar'])assert.ok(existsSync(fileURLToPath(new URL(`../../public/art/perfis/botao-${b}.webp`,import.meta.url))));
  assert.equal(perfilOf('noivo-em-fuga'),undefined,'a kind of a later batch has no card yet');
});

test('first time near the hero: its card; the same kind never again; far, asleep or without a profile: none',()=>{
  const deck=new ProfileDeck(has);
  assert.deepEqual(deck.step({enemies:[at('tio-pave',NEAR_M+1)],hero},0).cards,[],'too far');
  assert.deepEqual(deck.step({enemies:[at('tio-pave',1,0,{asleep:true})],hero},10).cards,[],'asleep on the map');
  assert.deepEqual(deck.step({enemies:[at('noivo-em-fuga',1)],hero},20).cards,[],'no profile yet');
  assert.deepEqual(kinds(deck),[]);
  deck.step({enemies:[at('tio-pave',NEAR_M)],hero},30);
  assert.deepEqual(kinds(deck),['tio-pave']);
  assert.equal(deck.shown[0].distance,NEAR_M);
  deck.step({enemies:[at('tio-pave',1),at('tio-pave',2)],hero},40);
  assert.equal(deck.shown.length,1,'two of the same kind: one card');
  deck.step({enemies:[],hero},30+PROFILE_MS);
  deck.step({enemies:[at('tio-pave',1)],hero},30+PROFILE_MS+LEAVE_MS);
  assert.deepEqual(deck.shown,[],'met once: never again');
});

test('the boss gets its card from anywhere; without a hero every kind counts as near',()=>{
  const deck=new ProfileDeck(has);
  deck.step({enemies:[at('chefe',80,0,{boss:true})],hero},0);
  assert.deepEqual(kinds(deck),['chefe']);
  const free=new ProfileDeck(has);
  free.step({enemies:[at('pombos',500)]},0);
  assert.deepEqual(kinds(free),['pombos']);
});

test('PROFILE_MS on screen, then it leaves; the photo of a far kind is loaded ahead (spotted, once)',()=>{
  const deck=new ProfileDeck(has);
  assert.deepEqual(deck.step({enemies:[at('bebado',40)],hero},0).spotted,['bebado']);
  assert.deepEqual(deck.step({enemies:[at('bebado',40)],hero},10).spotted,[]);
  deck.step({enemies:[at('bebado',3)],hero},100);
  deck.step({enemies:[at('bebado',3)],hero},100+PROFILE_MS-1);
  assert.deepEqual(kinds(deck),['bebado']);
  deck.step({enemies:[at('bebado',3)],hero},100+PROFILE_MS);
  assert.equal(deck.shown[0].leaving,'tempo');
  deck.step({enemies:[],hero},100+PROFILE_MS+LEAVE_MS);
  assert.deepEqual(deck.shown,[]);
});

test('several in a row: a fan of at most FAN_MAX, newest in front; the rest wait their turn',()=>{
  const deck=new ProfileDeck(has);
  const five=['bebado','pombos','tio-pave','boleto-vivo','bot-de-curtida'].map((k,i)=>at(k,1+i));
  deck.step({enemies:five,hero},0);
  assert.equal(FAN_MAX,3);
  assert.deepEqual(kinds(deck),['tio-pave','pombos','bebado'],'the newest first (in front)');
  deck.step({enemies:five,hero},PROFILE_MS);
  deck.step({enemies:five,hero},PROFILE_MS+1);
  assert.deepEqual(kinds(deck),['bot-de-curtida','boleto-vivo'],'the next two take the freed places');
  assert.deepEqual(fanPose(0,3),{rot:0,x:0,y:0});
  assert.ok(fanPose(1,3).rot<0&&fanPose(2,3).rot<fanPose(1,3).rot,'older cards turn further, as in a hand');
  assert.deepEqual(fanPose(0,1),{rot:0,x:0,y:0});
});

test('under a window (offer, pause, result) the clock stands still and no card opens; it never pauses the match itself',()=>{
  const deck=new ProfileDeck(has);
  deck.step({enemies:[at('bebado',1)],hero},0);
  deck.step({enemies:[at('bebado',1)],hero},1000);
  deck.step({enemies:[at('bebado',1),at('pombos',1)],hero},1001,true);
  deck.step({enemies:[at('bebado',1),at('pombos',1)],hero},60000,true);
  assert.deepEqual(kinds(deck),['bebado'],'pombos waits for the window to close');
  assert.equal(deck.shown[0].shownMs,1000);
  deck.step({enemies:[at('bebado',1),at('pombos',1)],hero},60001);
  assert.equal(deck.shown.find(c=>c.kind==='bebado')?.shownMs,1001,'time under the window does not count');
  assert.deepEqual(kinds(deck),['pombos','bebado']);
});

test('✕ throws the card at once, ✓ after the "DEU MATCH" stamp',()=>{
  const deck=new ProfileDeck(has);
  deck.step({enemies:[at('bebado',1),at('pombos',1)],hero},0);
  const [pombos,bebado]=deck.shown;
  deck.dismiss(pombos.id,'curtir');deck.dismiss(bebado.id,'passar');
  deck.step({enemies:[],hero},LEAVE_MS);
  assert.deepEqual(deck.shown.map(c=>[c.kind,c.leaving]),[['pombos','curtir']],'✕ gone, ✓ still stamping');
  deck.step({enemies:[],hero},MATCH_MS+LEAVE_MS);
  assert.deepEqual(deck.shown,[]);
});

test('the phone remembers the kinds it met (and a broken or missing storage never throws)',()=>{
  const store=new Map<string,string>();
  const storage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);}};
  let saved:ReadonlySet<string>|undefined;
  const deck=new ProfileDeck(has,loadSeen(storage),seen=>{saved=seen;saveSeen(seen,storage);});
  deck.step({enemies:[at('bebado',1)],hero},0);
  assert.deepEqual([...saved??[]],['bebado']);
  assert.deepEqual(JSON.parse(store.get(PERFIS_KEY)??'[]'),['bebado']);
  const again=new ProfileDeck(has,loadSeen(storage));
  again.step({enemies:[at('bebado',1)],hero},0);
  assert.deepEqual(again.shown,[]);
  store.set(PERFIS_KEY,'{broken');
  assert.ok(loadSeen(storage) instanceof Set);
  assert.doesNotThrow(()=>saveSeen(new Set(['x']),{getItem:()=>{throw new Error('off');},setItem:()=>{throw new Error('off');}}));
});
