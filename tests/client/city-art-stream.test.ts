/**
 * NEW-20261020-ORQ-partida-abre-com-P0: the match opens with the city art around the camera; the rest streams nearest
 * first, a few files at a time, and a chunk built before its art is rebuilt off screen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CityArtStream,NEAR_ART_CAP_MS,STREAM_FILES,missingByDistance} from '../../src/client/render/city/art-stream.ts';

const read=(path:string)=>readFileSync(new URL(`../../src/client/${path}`,import.meta.url),'utf8');
const box=(x:number,y:number,w=10,h=10)=>({x,y,w,h});

test('missingByDistance: missing keys only, each at its nearest chunk, 0 inside the wanted rect, nearest first',()=>{
  const want=box(0,0,100,100);
  const chunks=[
    {bounds:box(50,50),keys:['a','b']}, // inside
    {bounds:box(120,0),keys:['b','c']}, // 20 px right of the rect
    {bounds:box(-40,-40),keys:['d']}, // 30 px left and above: hypot
    {bounds:box(400,400),keys:['loaded','e']},
  ];
  const got=missingByDistance(chunks,want,k=>k==='loaded');
  assert.deepEqual(got.map(g=>g.key),['a','b','c','d','e']);
  assert.equal(got.find(g=>g.key==='b')!.px,0,'the nearest chunk drawing it counts');
  assert.equal(got.find(g=>g.key==='c')!.px,20);
  assert.equal(got.find(g=>g.key==='d')!.px,Math.hypot(30,30));
  assert.equal(got.some(g=>g.key==='loaded'),false);
  assert.deepEqual(missingByDistance(chunks,want,()=>true),[],'everything in: nothing missing');
});

test('CityArtStream: STREAM_FILES at once, nearest first, the order asked again for every free slot',()=>{
  let missing=['n1','n2','n3','n4','n5','f1'].map((key,i)=>({key,px:key.startsWith('n')?0:500+i}));
  const loads:string[]=[];
  const stream=new CityArtStream({missing:()=>missing,load:key=>{loads.push(key);return true;}});
  stream.pump();
  assert.equal(STREAM_FILES,4);
  assert.deepEqual(loads,['n1','n2','n3','n4']);assert.equal(stream.inFlight,4);
  stream.pump();assert.equal(loads.length,4,'no slot free, nothing more');
  assert.equal(stream.nearReady(),false);
  // n1 arrived and the camera moved: f1 is now the nearest.
  missing=[{key:'f1',px:0},...missing.filter(m=>m.key!=='n1'&&m.key!=='f1')];
  stream.settled('n1',true);
  assert.deepEqual(loads.slice(4),['f1']);
  stream.settled('nope',true);assert.equal(loads.length,5,'an answer for a file it did not ask is ignored');
});

test('CityArtStream: a failed or unknown file is never asked again and does not hold the match',()=>{
  const missing=[{key:'near',px:0},{key:'unknown',px:0},{key:'far',px:900}];
  const loads:string[]=[];
  const stream=new CityArtStream({missing:()=>missing,load:key=>{if(key==='unknown')return false;loads.push(key);return true;}},1);
  stream.pump();assert.deepEqual(loads,['near']);
  assert.equal(stream.nearReady(),false);
  stream.settled('near',false);
  assert.deepEqual(loads,['near','far'],'the next one, the unknown key skipped');
  assert.equal(stream.nearReady(),true,'only failed files left at distance 0');
  stream.settled('far',true);stream.pump();assert.deepEqual(loads,['near','far'],'still missing but failed: not retried');
  assert.ok(NEAR_ART_CAP_MS>=10_000&&NEAR_ART_CAP_MS<=30_000);
});

test('scene.ts: the preload takes only the city ground; the rest streams from the city layer and holds the cover',()=>{
  const src=read('scene.ts');
  const preload=src.slice(src.indexOf('  preload(){'),src.indexOf('  private classIcon('));
  assert.match(preload,/queueCityArt\(this,\{\.\.\.plan,sheets:plan\.sheets\.filter\(s=>s\.key\.startsWith\('city:ground:'\)\)\}\)/);
  assert.doesNotMatch(src,/queueLiveArt/,'no live sheet in the preload (nor every live sheet of the index)');
  const ground=src.slice(src.indexOf('  private drawGround(){'));
  assert.match(ground,/const stopStream=this\.streamCityArt\(city,art\);/);
  assert.match(ground,/const drop=\(\)=>\{stopStream\(\);city\.destroy\(\);/);
  assert.match(src,/if\(this\.cityHeld\)this\.readyHeld=true;else\{this\.hooks\.ready\(\);this\.queueLateArt\(\);\}/,'create holds the cover while the near art comes');
  // cena-nasce-rapido: the defenses' sheets (~11 MB) are not in the city's preload; they follow the near art, and the
  // waiting room's P1/P2 wait for it too (background-hold.ts).
  assert.match(preload,/if\(!\(this\.field instanceof CityTerrain\)\)this\.queueLateArt\(\);/);
  assert.doesNotMatch(src.slice(src.indexOf('  preload(){'),src.indexOf('  private lateArtQueued')),/queueTowerArt\(this\)/,'no tower sheet before the first frame in the city');
  const update=src.slice(src.indexOf('  private updateCity(delta:number){'),src.indexOf('this.city.update({camera'));
  assert.match(update,/this\.cityStream\?\.nearReady\(\)&&this\.city\.groundSettled\(\)/,'near art and the final ground');
  assert.match(update,/performance\.now\(\)-this\.heldSince<NEAR_ART_CAP_MS\)return;/,'no chunk is built while held, at most the cap');
  assert.match(update,/if\(this\.readyHeld\)\{this\.readyHeld=false;this\.hooks\.ready\(\);\}/);
  assert.match(update,/this\.cityHeld=false;this\.releaseBackground\(\);/,'the background downloads go on with the cover');
  assert.match(src.slice(src.indexOf('  private updateCity(delta:number){')),/this\.queueLateArt\(\);/,'the towers after the near art');
  const stream=src.slice(src.indexOf('  private streamCityArt('),src.indexOf('  private cityArt():'));
  assert.match(stream,/if\(ok\)city\.artArrived\(key\);stream\.settled\(key,ok\);/);
  assert.match(stream,/Events\.FILE_LOAD_ERROR,failed/);
  // Outside Phaser's first-in first-out loader (the run's enemies would hold the near art), the near art asked first.
  assert.match(stream,/fetchBitmap\(s\.url,px===0\?'high':'low'\)\.then\(bitmap=>queueUpload\(bitmap\.width\*bitmap\.height,/);
  assert.match(stream,/this\.textures\.addSpriteSheet\(key,bitmap as unknown as HTMLImageElement,\{frameWidth:s\.frameWidth,frameHeight:s\.frameHeight\}\)/);
  assert.match(stream,/this\.load\.off\(Phaser\.Loader\.Events\.FILE_COMPLETE,complete\)/,'the stop forgets the listeners');
  assert.match(stream,/this\.releaseBackground\(\);this\.backgroundHold=holdBackground\(\);/,'held while the near art comes');
});

test("scene.ts: the run's enemies wait for the near city art (they held the albedo behind them in the loader)",()=>{
  assert.match(read('scene.ts'),/if\(elenco&&elenco!==this\.elenco&&!this\.cityHeld\)\{this\.elenco=elenco;for\(const id of elenco\)queueEnemyArt\(this,id\);\}/);
});

test('city-layer: late art is rebuilt one chunk per update, only off screen; dropped chunks leave the queue; the modo foto waits',()=>{
  const src=read('render/city/city-layer.ts');
  const update=src.slice(src.indexOf('  update(frame:CityFrame){'),src.indexOf('this.applyOcclusion(frame,view);'));
  assert.match(update,/if\(old===undefined&&!show\.length\)for\(const key of this\.lateArt\)\{const c=this\.chunksByKey\.get\(key\);if\(c&&!rectsOverlap\(this\.tracker\.bounds\(c,view\),frame\.camera\)\)\{old=key;break;\}\}/);
  assert.match(src,/this\.live\.delete\(key\);this\.stale\.delete\(key\);this\.lateArt\.delete\(key\);/);
  assert.match(src,/groundSettled\(\)\{return this\.stale\.size===0&&this\.lateArt\.size===0&&/);
  const arrived=src.slice(src.indexOf('  artArrived(key:string){'),src.indexOf('  /** Live chunks still waiting'));
  assert.match(arrived,/if\(this\.live\.has\(chunkKey\)&&keys\.includes\(key\)\)this\.lateArt\.add\(chunkKey\)/,'only live chunks drawing it');
  const art=src.slice(src.indexOf('  chunkArt():'),src.indexOf('  missingArt('));
  for(const part of ['this.lotAt.get(p.y*width+p.x)?.sheet.key','propSheet(p,this.art)?.key','f.sheet.key','this.art?.decor[e.id]?.key','this.decalsOf'])
    assert.ok(art.includes(part),`chunkArt lists ${part}`);
});

test('relief albedo joins the running loader (the stream never lets it reach COMPLETE early)',()=>{
  const src=read('render/city/relevo/baker.ts');
  assert.match(src,/this\.scene\.events\.once\(Phaser\.Scenes\.Events\.UPDATE,start\);/);
  assert.doesNotMatch(src,/Loader\.Events\.COMPLETE,start/);
});
