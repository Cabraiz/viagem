/**
 * The match's download list (NEW-20261013-ORQ-3g-precarga-partida): the same URLs the scene's preload asks for, by
 * priority, each once.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ALBEDO_URL} from '../../src/client/render/city/relevo/albedo-meta.ts';
import {existsSync,readFileSync} from 'node:fs';
import {parseArtIndex,setArtIndex,artIndex} from '../../src/client/art/manifest.ts';
import {assetsParaPartida,matchAssets,matchKey,heroSheetUrl,ENDLESS_GROUND} from '../../src/client/preload/match-assets.ts';
import {directionalSheet} from '../../src/client/sprites/sprite-sheets.ts';
import {spriteUrl,thumbUrl,treeUrl} from '../../src/client/sprites/art-urls.ts';
import {spriteCatalog} from '../../src/client/sprites/sprite-catalog.ts';
import {artLoads} from '../../src/client/art/horde-art.ts';
import {baseLoads} from '../../src/client/art/base-art.ts';
import {framesLoads} from '../../src/client/art/frames-art.ts';
import {telegraphArtLoads} from '../../src/client/render/telegraph-art.ts';
import {buildCityArtPlan,cityArtOptions} from '../../src/client/render/city/art-plan.ts';
import {liveSheets} from '../../src/client/render/city/live/art.ts';
import {classes} from '../../src/rules/index.ts';

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
    ...plan.sheets.map(s=>s.url),...artLoads().map(l=>l.url),...baseLoads().map(l=>l.url),...framesLoads().map(l=>l.url),...telegraphArtLoads().map(l=>l.url),
    ALBEDO_URL, // the relief's ground albedo (chao-albedo-cidade): P0 with the ground
    ...liveSheets(artIndex()).map(s=>s.url)]; // cenário vivo (E8's `cenario` group): loops, lit objects, nests, decals
  assert.deepEqual(new Set(all),new Set(wanted));
  for(const url of all)assert.ok(existsSync('public'+url),`${url} is served`);
  const at=(url:string)=>list.find(a=>a.url===url)?.priority;
  for(const s of plan.sheets)assert.equal(at(s.url),s.key.startsWith('city:ground:')?'P0':s.key.startsWith('city:prop:')?'P2':'P1',s.key);
  assert.equal(at(heroSheetUrl(A)!),'P0');assert.equal(at(heroSheetUrl(B)!),'P1');
  // Enemies the render draws (horde-art artLoads) come in as P1; the index may hold roster enemies the render does not
  // know yet (pack 04 before the roster art is wired), and those are not preloaded.
  for(const a of list)if(a.kind==='enemy')assert.equal(a.priority,'P1',a.url);
  // Roster pieces load per match (arte-do-roster-no-render: the room's elenco, or the first sighting), never here.
  assert.ok(list.every(a=>a.kind!=='enemy'||artLoads().some(l=>l.url===a.url)),'no roster sheet in the waiting room');
  for(const url of ENDLESS_GROUND)assert.equal(at(url),undefined,'no island ground in the city');
  for(const s of liveSheets(artIndex()))assert.equal(at(s.url),'P2',s.key);
  assert.equal(at(ALBEDO_URL),'P0');
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

test('the key changes with the members and the map, not with their order or repeats',()=>{
  const k=matchKey({self:A,others:[B,C],map:'infinito'});
  assert.equal(matchKey({self:A,others:[C,B,B,undefined],map:'infinito'}),k);
  assert.notEqual(matchKey({self:A,others:[B],map:'infinito'}),k);
  assert.notEqual(matchKey({self:A,others:[B,C],map:'cidade-nevada'}),k);
});
