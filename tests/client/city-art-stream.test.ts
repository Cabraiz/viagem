/**
 * NEW-20261020-ORQ-partida-abre-com-P0: the match opens with the city art around the camera; the rest streams nearest
 * first, a few files at a time, and a chunk built before its art is rebuilt off screen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ART_BUDGET,CityArtStream,EVICT_PX,NEAR_ART_CAP_MS,RELOAD_PX,STREAM_FILES,TICK_MS,evictions,missingByDistance,type ResidentArt} from '../../src/client/render/city/art-stream.ts';

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

test("CityArtStream: while the first frame's art is not all in, nothing farther takes a slot (cena-nasce-rapido)",()=>{
  const missing=[{key:'n1',px:0},{key:'n2',px:0},{key:'f1',px:300},{key:'f2',px:600}];
  const loads:string[]=[];
  const stream=new CityArtStream({missing:()=>missing.filter(m=>!loads.includes(m.key)||m.px===0&&!done.has(m.key)),load:key=>{loads.push(key);return true;}});
  const done=new Set<string>();
  stream.pump();assert.deepEqual(loads,['n1','n2'],'two slots stay free while n1 and n2 come');
  done.add('n1');stream.settled('n1',true);assert.deepEqual(loads,['n1','n2'],'n2 still on its way');
  done.add('n2');stream.settled('n2',true);assert.deepEqual(loads,['n1','n2','f1','f2'],'then the rest, nearest first');
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
  assert.match(src,/if\(this\.cityHeld\)this\.readyHeld=true;else this\.hooks\.ready\(\);/,'create holds the cover while the near art comes');
  // auditoria-desempenho-28-10: no defense sheet is preloaded (every kind's was ~134 MB of textures on a phone); a kit's
  // ghost or a defense asks for its own kind's (needTowerArt).
  assert.doesNotMatch(src,/queueTowerArt|queueLateArt/,'no bulk tower preload');
  assert.match(src,/needArt:kind=>this\.needTowerArt\(kind\)/,'the defenses ask for their own sheets');
  const update=src.slice(src.indexOf('  private updateCity(delta:number){'),src.indexOf('this.city.update({camera'));
  assert.match(update,/this\.cityStream\?\.nearReady\(\)&&this\.city\.groundSettled\(\)/,'near art and the final ground');
  assert.match(update,/performance\.now\(\)-this\.heldSince<NEAR_ART_CAP_MS\)return;/,'no chunk is built while held, at most the cap');
  assert.match(update,/if\(this\.readyHeld\)\{this\.readyHeld=false;this\.hooks\.ready\(\);\}/);
  assert.match(update,/this\.cityHeld=false;this\.releaseBackground\(\);/,'the background downloads go on with the cover');
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
  assert.match(read('scene.ts'),/if\(elenco&&elenco!==this\.elenco&&!this\.cityHeld\)\{this\.elenco=elenco;for\(const id of elenco\)if\(!chefaoDeferred\(id\)\)queueEnemyArt\(this,id\);\}/);
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

test('towers.ts: a defense made before its sheet is not drawn until it lands (fetched first), procedural only after TOWER_ART_WAIT_MS',()=>{
  const src=read('render/towers/towers.ts');
  assert.match(src,/if\(t\.artWait\)\{t\.hideUntil=this\.now\+TOWER_ART_WAIT_MS;this\.o\.needArt\?\.\(view\.kind\);\}/);
  const drawSrc=read('render/towers/tower-draw.ts'); // corte C2: drawing a defense moved out of towers.ts
  const draw=drawSrc.slice(drawSrc.indexOf('  protected drawTower('),drawSrc.indexOf('  protected sortTower('));
  assert.match(draw,/if\(this\.scene\.textures\.exists\(towerBaseKey\(v\.kind\)\)\)\{t\.artWait=false;t\.art=true;t\.drawnPhase='';\}/,'adopts the sheet when it lands');
  assert.match(draw,/else if\(this\.now<t\.hideUntil\)\{if\(t\.base\.visible\)\{t\.base\.setVisible\(false\);t\.weapon\.setVisible\(false\);\}return;\}/,'unseen meanwhile');
  const scene=read('scene.ts');
  assert.match(scene,/needArt:kind=>this\.needTowerArt\(kind\)/);
  assert.match(scene.slice(scene.indexOf('  private needTowerArt(')),/fetchBitmap\(l\.url,'high'\)/,'past the loader\'s queue');
});

// Q3 fatia 3: the LRU of the city's art by camera proximity.
const art=(key:string,px:number,bytes=10,inUse=false):ResidentArt=>({key,px,bytes,inUse});

test('evictions: down to the budget, never art a live chunk draws nor art within EVICT_PX, least recently near first',()=>{
  const far=EVICT_PX+1;
  const resident=[art('a',far),art('b',far+500),art('c',far),art('used',far*3,10,true),art('near',EVICT_PX)];
  assert.deepEqual(evictions(resident,50,()=>0),[],'under the budget: nothing');
  const last=new Map([['a',3],['b',5],['c',1]]);
  assert.deepEqual(evictions(resident,30,k=>last.get(k)??0),['c','a'],'50 → 30: the two least recently near');
  assert.deepEqual(evictions(resident,0,()=>0),['b','a','c'],'ties: farthest first, then by key; used and near stay');
  const total=(keys:string[])=>resident.filter(r=>!keys.includes(r.key)).reduce((s,r)=>s+r.bytes,0);
  for(const budget of [45,30,25,20])assert.ok(total(evictions(resident,budget,()=>0))<=budget,`fits ${budget}`);
});

test('ART_BUDGET: Leve < Normal < Alta; RELOAD_PX ≥ the chunks kept (city-layer CHUNK_KEEP_PX) < EVICT_PX',()=>{
  assert.ok(ART_BUDGET.leve<ART_BUDGET.normal&&ART_BUDGET.normal<ART_BUDGET.alta);
  assert.ok(Object.isFrozen(ART_BUDGET));
  const keep=Number(/CHUNK_KEEP_PX=(\d+)/.exec(read('render/city/city-layer.ts'))![1]);
  assert.ok(RELOAD_PX>=keep&&RELOAD_PX<EVICT_PX);
});

/** A city of keys at a distance (px), each `bytes` decoded; `load` answers at once unless `hold`. */
function lruWorld(keys:Record<string,number>,budget:number){
  const px=new Map(Object.entries(keys)),loaded=new Set<string>(),used=new Set<string>(),loads:string[]=[],dropped:string[]=[];
  const stream:CityArtStream=new CityArtStream({
    missing:()=>[...px].filter(([k])=>!loaded.has(k)).map(([key,p])=>({key,px:p})).sort((a,b)=>a.px-b.px||(a.key<b.key?-1:1)),
    load:key=>{loads.push(key);queueMicrotask(()=>{loaded.add(key);stream.settled(key,true);});return true;},
    resident:()=>[...loaded].map(k=>art(k,px.get(k)!,10,used.has(k))),
    evict:key=>{dropped.push(key);loaded.delete(key);},
    budget:()=>budget,
  },1);
  return {stream,px,loaded,used,loads,dropped};
}
const settle=()=>new Promise(r=>setTimeout(r,0));

test('LRU stream: the budget holds, nothing visible goes, far art is not fetched once full, dropped art comes back the same',async()=>{
  const far=EVICT_PX+100;
  const w=lruWorld({on:0,near:200,f1:far,f2:far+10,f3:far+20,f4:far+30},25);
  w.used.add('on');
  w.stream.pump();
  for(let i=0;i<10;i++)await settle();
  assert.ok(w.loaded.size*10<=25,'within the budget');
  assert.ok(w.loaded.has('on')&&w.loaded.has('near'),'the visible and near art stays');
  assert.deepEqual(w.dropped,['f1'],'only the far art over the budget went');
  assert.deepEqual(w.loads,['on','near','f1'],'once full, the farther art is not fetched (it would only push other art out)');
  // The camera walks to f1's chunk: f1 comes back (the same key, the same load) and the art left behind goes.
  w.px.set('on',far+50);w.px.set('near',far+60);w.used.delete('on');w.px.set('f1',100);w.used.add('f1');
  w.stream.tick(0);
  for(let i=0;i<10;i++)await settle();
  w.stream.tick(TICK_MS);
  assert.equal(w.loads.filter(k=>k==='f1').length,2,'fetched again once near');
  assert.ok(w.loaded.has('f1'));
  assert.deepEqual([...w.loaded].sort(),['f1','on'],'the art left behind went, the farthest first');
  assert.equal(w.stream.dropped,w.dropped.filter(k=>!w.loaded.has(k)).length);
});

test('LRU stream: a dropped key is not fetched while far; tick runs at most every TICK_MS',async()=>{
  const far=EVICT_PX+100;
  const w=lruWorld({a:0,b:far,c:far+10},15);
  w.stream.pump();
  for(let i=0;i<10;i++)await settle();
  assert.deepEqual(w.dropped,['b']);
  w.px.set('b',RELOAD_PX+1);
  w.stream.tick(1000);
  await settle();
  assert.equal(w.loads.filter(k=>k==='b').length,1,'past RELOAD_PX: stays dropped');
  w.px.set('b',RELOAD_PX);
  w.stream.tick(1000+TICK_MS-1);
  await settle();
  assert.equal(w.loads.filter(k=>k==='b').length,1,'throttled');
  w.stream.tick(1000+TICK_MS);
  await settle();
  assert.equal(w.loads.filter(k=>k==='b').length,2,'within RELOAD_PX: back');
});

test('LRU stream: without resident/evict/budget nothing is dropped and everything streams (the old host)',async()=>{
  const loads:string[]=[],loaded=new Set<string>();
  const keys={a:0,b:EVICT_PX*4,c:EVICT_PX*5};
  const stream:CityArtStream=new CityArtStream({
    missing:()=>Object.entries(keys).filter(([k])=>!loaded.has(k)).map(([key,px])=>({key,px})),
    load:key=>{loads.push(key);queueMicrotask(()=>{loaded.add(key);stream.settled(key,true);});return true;},
  },1);
  stream.pump();stream.tick(0);
  for(let i=0;i<10;i++)await settle();
  assert.deepEqual(loads,['a','b','c']);
  assert.equal(stream.dropped,0);
});

test("scene wiring: the LRU sees only the stream's sheets, keeps the viaduct's props and the nests, ticks from updateCity",()=>{
  const scene=read('scene.ts');
  const stream=scene.slice(scene.indexOf('  private streamCityArt('),scene.indexOf('  /** The hold streamCityArt takes'));
  assert.match(stream,/const pinned=new Set\(VIADUCT_PROP_IDS\.map\(id=>plan\.decor\[id\]\?\.key\)/);
  assert.match(stream,/sheets\.has\(key\)&&!pinned\.has\(key\)&&!key\.startsWith\('city:live:ninho-'\)&&this\.textures\.exists\(key\)/);
  assert.match(stream,/inUse=new Set\(city\.liveChunks\(\)\.flatMap\(c=>art\.get\(c\)\?\?\[\]\)\)/,"a live chunk's art is in use");
  assert.match(stream,/budget:\(\)=>ART_BUDGET\[this\.quality\]/);
  assert.match(stream,/img instanceof ImageBitmap\)img\.close\(\)/,'the decoded bitmap is freed too');
  const update=scene.slice(scene.indexOf('  private updateCity('),scene.indexOf('  private updateCamera('));
  assert.match(update,/this\.cityStream\?\.tick\(performance\.now\(\)\);\n {4}\/\/ The fade test/,'after the hold');
  const layer=read('render/city/city-layer.ts');
  assert.match(layer.slice(layer.indexOf('  artDistance(')),/return missingByDistance\(chunks,camera,\(\)=>false\);/,'every key, loaded or not');
});
