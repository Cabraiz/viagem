/**
 * The match's download list (NEW-20261013-ORQ-3g-precarga-partida): the same URLs the scene's preload asks for, by
 * priority, each once.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ALBEDO_URL} from '../../src/client/render/city/relevo/albedo-meta.ts';
import {existsSync,readFileSync} from 'node:fs';
import {parseArtIndex,setArtIndex,artIndex} from '../../src/client/art/manifest.ts';
import {assetsParaPartida,matchAssets,matchKey,heroSheetUrl,heroMotionUrls,offerIconUrls,ENDLESS_GROUND} from '../../src/client/preload/match-assets.ts';
import {directionalSheet} from '../../src/client/sprites/sprite-sheets.ts';
import {spriteUrl,thumbUrl,treeUrl} from '../../src/client/sprites/art-urls.ts';
import {spriteCatalog} from '../../src/client/sprites/sprite-catalog.ts';
import {artLoads} from '../../src/client/art/horde-art.ts';
import {baseLoads} from '../../src/client/art/base-art.ts';
import {framesLoads} from '../../src/client/art/frames-art.ts';
import {telegraphArtLoads} from '../../src/client/render/telegraph-art.ts';
import {buildCityArtPlan,cityArtOptions} from '../../src/client/render/city/art-plan.ts';
import {liveSheets} from '../../src/client/render/city/live/art.ts';
import {PASSIVE_IDS,classes} from '../../src/rules/index.ts';
import {itemDisplay} from '../../src/client/hud/items.ts';
import {uiArtUrl} from '../../src/client/ui/icon.ts';

const ids=classes.map(c=>c.id).filter(id=>spriteCatalog[id]);
const [A,B,C]=ids;
const real=()=>setArtIndex(parseArtIndex(JSON.parse(readFileSync('public/art/manifest.json','utf8'))));
const urls=(list:{url:string}[])=>list.map(a=>a.url);
const RANK={P0:0,P1:1,P2:2} as const;

test('empty art index, endless map: own hero and ground are P0, teammates P1, as the scene asks for them',()=>{
  setArtIndex(parseArtIndex(undefined));
  const list=assetsParaPartida({self:A,others:[B,undefined,A],map:'infinito'});
  const own=directionalSheet(A)?.url??spriteUrl(A);
  assert.equal(heroSheetUrl(A),own);
  assert.deepEqual(list.filter(a=>a.priority==='P0').map(a=>a.url),[own,thumbUrl(A),...ENDLESS_GROUND]);
  assert.deepEqual(list.filter(a=>a.priority==='P1').map(a=>a.url),[directionalSheet(B)?.url??spriteUrl(B),thumbUrl(B)]);
  assert.equal(list.some(a=>a.priority==='P2'),false,'nothing imported, nothing else to fetch');
  assert.equal(matchAssets,assetsParaPartida);
});

test('real manifest, city: every texture of the scene\'s planners is listed once, by priority, and exists on disk',()=>{
  real();
  const list=assetsParaPartida({self:A,others:[B,C],map:'cidade-nevada'});
  const all=urls(list);
  assert.equal(new Set(all).size,all.length,'no duplicates');
  for(let i=1;i<list.length;i++)assert.ok(RANK[list[i-1].priority]<=RANK[list[i].priority],'sorted by priority');
  const plan=buildCityArtPlan(artIndex(),cityArtOptions(''));
  assert.ok(plan.sheets.length>0,'the manifest has city art');
  const wanted=[heroSheetUrl(A),heroSheetUrl(B),heroSheetUrl(C),thumbUrl(A),thumbUrl(B),thumbUrl(C),treeUrl('arvore-nevada'),
    ...heroMotionUrls(A), // own walk and attack clips only (preload-heroi-primeiro): the teammates' come on demand
    ...plan.sheets.filter(s=>s.key.startsWith('city:ground:')).map(s=>s.url),...artLoads().map(l=>l.url),...baseLoads().map(l=>l.url),...framesLoads().map(l=>l.url),...telegraphArtLoads().map(l=>l.url),
    ALBEDO_URL, // the relief's ground albedo (chao-albedo-cidade): P0 with the ground
    ...offerIconUrls()]; // the upgrade cards' stickers (ofertas-sem-xp-e-icones)
  assert.deepEqual(new Set(all),new Set(wanted));
  for(const url of all)assert.ok(existsSync('public'+url),`${url} is served`);
  const at=(url:string)=>list.find(a=>a.url===url)?.priority;
  // Buildings, props, decor and live sheets: the scene streams them nearest first (partida-abre-com-P0), not listed here.
  for(const s of plan.sheets)assert.equal(at(s.url),s.key.startsWith('city:ground:')?'P0':undefined,s.key);
  for(const s of liveSheets(artIndex()))assert.equal(at(s.url),undefined,s.key);
  assert.equal(at(heroSheetUrl(A)!),'P0');assert.equal(at(heroSheetUrl(B)!),'P1');
  // Enemies the render draws (horde-art artLoads) come in as P1; the index may hold roster enemies the render does not
  // know yet (pack 04 before the roster art is wired), and those are not preloaded.
  for(const a of list)if(a.kind==='enemy')assert.equal(a.priority,'P1',a.url);
  // Roster pieces load per match (arte-do-roster-no-render: the room's elenco, or the first sighting), never here.
  assert.ok(list.every(a=>a.kind!=='enemy'||artLoads().some(l=>l.url===a.url)),'no roster sheet in the waiting room');
  for(const url of ENDLESS_GROUND)assert.equal(at(url),undefined,'no island ground in the city');
  assert.equal(at(ALBEDO_URL),'P0');
});

test('real manifest: every upgrade card sticker is downloaded before the match (P1), on both maps',()=>{
  real();
  // Card ofertas-sem-xp-e-icones (print of 25/10): Cartão Fidelidade and Café Coado na Meia opened as an empty frame.
  const icons=offerIconUrls();
  for(const id of [...PASSIVE_IDS,'heal']){
    const url=uiArtUrl(itemDisplay(id).icon);
    assert.ok(url,`${id}: its sticker has imported art`);
    assert.ok(icons.includes(url!),`${id}: ${url} is preloaded`);
  }
  assert.ok(icons.includes('/art/ui/cartao.webp')&&icons.includes('/art/ui/cafe-forte.webp'));
  for(const map of ['cidade-nevada','infinito'] as const){
    const list=assetsParaPartida({self:A,others:[],map});
    for(const url of icons)assert.equal(list.find(a=>a.url===url)?.priority,'P1',`${map}: ${url}`);
  }
});

test('real manifest, endless map: no city art; a class with no sheet adds nothing; sizes are carried',()=>{
  real();
  const own=heroSheetUrl(A)!;
  const list=assetsParaPartida({self:A,others:['nao-existe'],map:'infinito',sizes:{[own]:1234}});
  assert.equal(list.find(a=>a.url===own)?.bytes,1234);
  assert.equal(list.some(a=>a.url.startsWith('/art/city/')&&a.kind!=='enemy'&&a.kind!=='base'&&a.kind!=='effect'),false);
  assert.equal(list.some(a=>a.url.includes('nao-existe')),false);
  assert.deepEqual(urls(list.filter(a=>a.kind==='ground')),[...ENDLESS_GROUND]);
});

test("real manifest: the own hero's walk clips (8 directions) close P0, after the ground; its attack opens P1; teammates' are not listed",()=>{
  real();
  const self=ids.find(id=>heroMotionUrls(id).length)!,mate=ids.find(id=>id!==self&&heroMotionUrls(id).length)!;
  assert.ok(self&&mate,'the manifest has heroes with detailed clips');
  const motion=heroMotionUrls(self);
  assert.equal(motion.length,16,'walk and attack, 8 directions each');
  assert.ok(motion.every(u=>u.startsWith('/art/lite/sprites/')&&existsSync('public'+u)),'the lite copies the scene fetches');
  assert.ok(motion.slice(0,8).every(u=>u.includes('.walk128-'))&&motion.slice(8).every(u=>u.includes('.attack128-')),'walk first');
  for(const map of ['cidade-nevada','infinito'] as const){
    const list=assetsParaPartida({self,others:[mate],map}),p0=list.filter(a=>a.priority==='P0').map(a=>a.url);
    assert.deepEqual(p0.slice(-8),motion.slice(0,8),`${map}: the walk closes P0`);
    const p1=list.filter(a=>a.priority==='P1').map(a=>a.url);
    assert.deepEqual(p1.slice(0,8),motion.slice(8),`${map}: the attack opens P1 (cena-nasce-rapido)`);
    assert.ok(p0.indexOf(motion[0])>Math.max(...list.filter(a=>a.kind==='ground').map(a=>p0.indexOf(a.url))),`${map}: ground first`);
    assert.equal(p0[0],heroSheetUrl(self),`${map}: the resting sheet (first frame) still opens the list`);
    for(const u of heroMotionUrls(mate))assert.equal(list.some(a=>a.url===u),false,`${map}: no teammate clip`);
  }
});

test('the key changes with the members and the map, not with their order or repeats',()=>{
  const k=matchKey({self:A,others:[B,C],map:'infinito'});
  assert.equal(matchKey({self:A,others:[C,B,B,undefined],map:'infinito'}),k);
  assert.notEqual(matchKey({self:A,others:[B],map:'infinito'}),k);
  assert.notEqual(matchKey({self:A,others:[B,C],map:'cidade-nevada'}),k);
});
