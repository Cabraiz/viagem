import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setArtIndex,parseArtIndex,type ArtPiece} from '../../src/client/art/manifest.ts';
import {ENEMY_ANIM_RATE,ENEMY_LOOP_RATE,ENEMY_ART_ID,STATIC_ART,artLoads,enemyPieceLoads,chooseAnim,enemyArtKey,enemyDrawScale,enemyFrame,facingRow,fileFps,
  groundFacingRow,screenFacingRow,eliteFile,cachedAnim,fileInfo,ELITE_ART_SCALE,ELITE_LAYER_DEPTH,
  WEAPON_PROJECTILE_IDS,WEAPON_PROJECTILE_KEY} from '../../src/client/art/horde-art.ts';
import {ELITE_SCALE,ENEMY_ART,ENEMY_KINDS,FX,pickupTexture} from '../../src/client/render/keys.ts';

const ROWS=['S','SW','W','NW','N','NE','E','SE'];
const EMPTY={version:2,groups:{}};
afterEach(()=>setArtIndex(parseArtIndex(EMPTY)));

const sheet=(frames:number,extra:object={})=>({file:'x.webp',cell:[128,128] as [number,number],frames,directions:8,anchor:[.5,.88] as [number,number],...extra});
const bebado:ArtPiece={kind:'animations',files:{idle:sheet(6,{file:'bebado/idle.webp',fps:6}),walk:sheet(8,{file:'bebado/walk.webp',fps:10}),[eliteFile('walk')]:sheet(8,{file:'elite/bebado-walk.webp'})}};
const pombos:ArtPiece={kind:'animations',files:{fly:sheet(6,{file:'pombos/fly.webp'}),poop:sheet(6,{file:'pombos/poop.webp'})}};

test('every enemy kind maps to an importer id (identity after the D-033/D-036 renames)',()=>{
  for(const kind of ENEMY_KINDS)assert.equal(typeof ENEMY_ART_ID[kind],'string');
  assert.deepEqual(Object.values(ENEMY_ART_ID),['bebado','anao-molotov','pombos','tio-pave','agiota','chefe','coach','motoboy','influencer']);
});

test('static art replaces today\'s keys: pickups, projectiles and FX',()=>{
  const keys=STATIC_ART.map(s=>s.key);
  for(const k of ['heal','chest','resource'])assert.ok(keys.includes(pickupTexture(k)),k);
  // D-054: no gem nor ímã art; NEW-20261024-ORQ-tirar-drops-cedula-girando: nor the boleto rain's.
  assert.ok(!STATIC_ART.some(s=>s.ids.some(id=>id.startsWith('gema')||id==='ima'||id==='boleto-chuva')),'no gem, no ímã, no boleto rain');
  for(const k of [FX.projFriendly,FX.shadow,FX.puff,FX.warning])assert.ok(keys.includes(k),k);
  // The agiota's boleto has its own key now (art:proj:boleto-juros, horde-actions.test.ts), not today's FX.projBoleto.
  assert.ok(!keys.includes(FX.projBoleto));
  assert.equal(new Set(keys).size,keys.length,'one entry per key');
  for(const s of STATIC_ART)if(s.mode==='bake')assert.ok(s.size&&s.size[0]>0&&s.size[1]>0,`${s.key} needs today's size`);
});

test('screen facing: the 8 directions in S,SW,W,NW,N,NE,E,SE order (y down, S towards the viewer)',()=>{
  const dirs:[string,number,number][]=[['S',0,1],['SW',-1,1],['W',-1,0],['NW',-1,-1],['N',0,-1],['NE',1,-1],['E',1,0],['SE',1,1]];
  for(const [name,x,y] of dirs)assert.equal(ROWS[groundFacingRow(x,y)],name,name);
  // Screen space is flattened 2:1: a screen diagonal of (2,1) is the ground diagonal SE.
  assert.equal(ROWS[screenFacingRow(2,1)],'SE');assert.equal(ROWS[screenFacingRow(-2,-1)],'NW');
  assert.equal(ROWS[screenFacingRow(0,3)],'S');assert.equal(ROWS[screenFacingRow(-5,0)],'W');
});

test('world facing through the camera views: world +x reads SE at view 0 and turns with the camera',()=>{
  // Projector: screen x ∝ rx−ry, screen y ∝ rx+ry. World +x at view 0 goes right and down: SE; +y goes left and down: SW.
  assert.equal(ROWS[facingRow(1,0,0)],'SE');assert.equal(ROWS[facingRow(0,1,0)],'SW');
  assert.equal(ROWS[facingRow(1,1,0)],'S');assert.equal(ROWS[facingRow(-1,-1,0)],'N');
  assert.equal(ROWS[facingRow(1,-1,0)],'E');assert.equal(ROWS[facingRow(-1,1,0)],'W');
  // View 1 rotates (x,y) → (−y,x): world +x becomes the old +y.
  assert.equal(ROWS[facingRow(1,0,1)],'SW');assert.equal(ROWS[facingRow(1,0,2)],'NW');assert.equal(ROWS[facingRow(1,0,3)],'NE');
  assert.equal(ROWS[facingRow(1,1,2)],'N');assert.equal(ROWS[facingRow(1,0,4)],'SE','views wrap');assert.equal(ROWS[facingRow(1,0,-1)],'NE');
});

test('facing hysteresis and no motion keep the current row',()=>{
  const sw=ROWS.indexOf('SW');
  assert.equal(groundFacingRow(0,0,sw),sw);assert.equal(groundFacingRow(0,0),0,'no motion and no row: facing the camera');
  // 25° from S towards SW is past the sector edge (22.5°) but inside the hysteresis band: S stays.
  const a=25*Math.PI/180,x=-Math.sin(a),y=Math.cos(a);
  assert.equal(groundFacingRow(x,y,0),0);assert.equal(groundFacingRow(x,y),sw);
  // Well inside SW it changes.
  assert.equal(groundFacingRow(-1,1,0),sw);
});

test('animation choice: walk when moving, idle when still, fly for the pombos, elite only with its layer',()=>{
  assert.equal(chooseAnim(bebado,true),'walk');assert.equal(chooseAnim(bebado,false),'idle');
  assert.equal(chooseAnim(pombos,true),'fly');assert.equal(chooseAnim(pombos,false),'fly');
  assert.equal(chooseAnim({kind:'animations',files:{poop:sheet(6)}},false),'poop','first animation as last resort');
  assert.equal(chooseAnim({kind:'animations',files:{idle:sheet(6)}},true),'idle','moving without walk/fly: idle');
  assert.equal(chooseAnim(bebado,true,true),'walk');
  assert.equal(chooseAnim(bebado,false,true),'walk','elite: only animations with an elite layer');
  assert.equal(chooseAnim(pombos,true,true),undefined,'no elite layer: the procedural elite stays');
});

/** On-screen time of `ms` of drawn animation: enemies play at ENEMY_ANIM_RATE (+1 ms clears float rounding at a frame edge). */
const slow=(ms:number)=>ms/ENEMY_ANIM_RATE+1;
/** The same for the loops (idle, walk, fly), half as fast again (inimigos-animacao-2x-lenta). */
const slowLoop=(ms:number)=>ms/ENEMY_LOOP_RATE+1;

test('enemyFrame: row-major frames at the file fps, default 8',()=>{
  assert.equal(fileFps(bebado.files.walk,'walk'),10);assert.equal(fileFps(pombos.files.fly,'fly'),8);
  assert.equal(fileFps({cell:[1,1],fps:{walk:12}},'elite/walk'),12,'elite layer uses its animation fps');
  const f=enemyFrame('bebado',bebado,'walk',ROWS.indexOf('W'),slowLoop(250));
  assert.deepEqual(f,{key:'art:enemy:bebado:walk',frame:2*8+2}); // 250 drawn ms × 10 fps = frame 2 of row W
  assert.deepEqual(enemyFrame('bebado',bebado,'walk',7,slowLoop(1000)),{key:'art:enemy:bebado:walk',frame:7*8+(10%8)},'loops');
  assert.deepEqual(enemyFrame('pombos',pombos,'fly',0,slowLoop(500)),{key:'art:enemy:pombos:fly',frame:4});
  assert.deepEqual(enemyFrame('bebado',bebado,eliteFile('walk'),1,0),{key:'art:enemy:bebado:elite/walk',frame:8});
  assert.equal(enemyFrame('bebado',bebado,'death',0,0),undefined);
  assert.equal(enemyFrame('bebado',bebado,'idle',99,0)?.frame,7*6,'row clamped to the sheet');
});

test('enemyFrame: paged sheets (the chefe at 384 px) find the frame in its page',()=>{
  // 16 frames × 8 rows of 384 px: 10 columns × 10 rows per 4096 page → 100 frames per page, 2 pages.
  const death={cell:[384,384] as [number,number],frames:16,directions:8,fps:{death:16},
    pages:[{file:'chefe/death-p1.webp',columns:10,rows:10,firstFrame:0,frameCount:100},{file:'chefe/death-p2.webp',columns:10,rows:3,firstFrame:100,frameCount:28}]};
  const chefe:ArtPiece={kind:'animations',files:{death}};
  assert.deepEqual(enemyFrame('chefe',chefe,'death',0,0),{key:'art:enemy:chefe:death:p1',frame:0});
  assert.deepEqual(enemyFrame('chefe',chefe,'death',5,slow(250)),{key:'art:enemy:chefe:death:p1',frame:5*16+4});
  assert.deepEqual(enemyFrame('chefe',chefe,'death',6,slow(250)),{key:'art:enemy:chefe:death:p2',frame:0},'first frame of page 2');
  assert.deepEqual(enemyFrame('chefe',chefe,'death',6,slow(500)),{key:'art:enemy:chefe:death:p2',frame:6*16+8-100});
  assert.deepEqual(enemyFrame('chefe',chefe,'death',7,slow(15*1000/16)),{key:'art:enemy:chefe:death:p2',frame:127-100});
  assert.equal(enemyArtKey('chefe','death',1,2),'art:enemy:chefe:death:p2');assert.equal(enemyArtKey('chefe','death'),'art:enemy:chefe:death');
});

test('draw scale keeps today\'s feet-to-top height; the elite is bigger',()=>{
  const s=enemyDrawScale('bebado',bebado.files.walk);
  assert.ok(Math.abs(128*.88*s-ENEMY_ART.bebado.height*ENEMY_ART.bebado.originY)<1e-9);
  assert.ok(enemyDrawScale('bebado',bebado.files.walk,true)>s);
});

test('empty manifest: nothing is queued',()=>{
  setArtIndex(parseArtIndex(EMPTY));
  assert.deepEqual(artLoads(),[]);
});

test('a manifest with enemies and items queues every page under the art keys and today\'s keys',()=>{
  setArtIndex(parseArtIndex({version:2,groups:{
    inimigos:{output:'public/art/enemies',pieces:{bebado,chefe:{kind:'animations',files:{idle:{cell:[384,384],frames:6,directions:8,
      pages:[{file:'chefe/idle-p1.webp',columns:10,rows:4,firstFrame:0,frameCount:40},{file:'chefe/idle-p2.webp',columns:8,rows:1,firstFrame:40,frameCount:8}]}}}}},
    itens:{output:'public/art/items',pieces:{'coxinha':{kind:'frames',files:{sheet:{file:'coxinha.webp',cell:[64,64],frames:4}}}}},
    projeteis:{output:'public/art/projectiles',pieces:{'tiro-aliado':{kind:'frames',files:{sheet:{file:'tiro-aliado.webp',cell:[32,32],frames:4}}}}},
  }}));
  const loads=artLoads(),by=new Map([...loads,...enemyPieceLoads('bebado'),...enemyPieceLoads('chefe')].map(l=>[l.key,l]));
  assert.ok(loads.every(l=>!l.key.startsWith('art:enemy:')),'enemies load per match (queueEnemyArt), not up front');
  assert.equal(by.get('art:enemy:bebado:walk')?.url,'/art/lite/enemies/bebado/walk.webp','enemies load their lite copy');
  assert.deepEqual(by.get('art:enemy:bebado:walk')?.cell,[128,128]);
  assert.ok(by.has('art:enemy:bebado:idle')&&by.has('art:enemy:bebado:elite/walk'));
  assert.equal(by.get('art:enemy:chefe:idle:p2')?.url,'/art/lite/enemies/chefe/idle-p2.webp');assert.ok(by.has('art:enemy:chefe:idle:p1'));
  const coxinha=by.get('art:itens:coxinha');
  assert.equal(coxinha?.url,'/art/items/coxinha.webp');assert.equal(coxinha?.bake?.key,pickupTexture('heal'));
  assert.equal(by.get(FX.projFriendly)?.url,'/art/projectiles/tiro-aliado.webp','projectiles load under today\'s key');
  assert.equal(by.get(FX.projFriendly)?.bake,undefined);
  assert.equal(loads.length,2);
});

test('the imported elite uses today\'s ELITE_SCALE and its layer sits a hair over its base',()=>{
  assert.equal(ELITE_ART_SCALE,ELITE_SCALE);assert.equal(ELITE_ART_SCALE,1.35);
  const s=enemyDrawScale('bebado',bebado.files.walk);
  assert.ok(Math.abs(enemyDrawScale('bebado',bebado.files.walk,true)-s*1.35)<1e-12);
  assert.ok(ELITE_LAYER_DEPTH>0&&ELITE_LAYER_DEPTH<=.001,'never sorts over a nearer enemy');
});

test('resources: only the generic recurso replaces the single resource texture (no coconut painted as a stone)',()=>{
  const resource=STATIC_ART.find(s=>s.key===pickupTexture('resource'));
  assert.deepEqual(resource?.ids,['recurso']);
  for(const s of STATIC_ART)for(const id of s.ids)assert.ok(!/^recurso-/.test(id),`${id} must not map to ${s.key}`);
  setArtIndex(parseArtIndex({version:2,groups:{itens:{output:'public/art/items',pieces:{
    'recurso-coco':{kind:'frames',files:{sheet:{file:'recurso-coco.webp',cell:[64,64],frames:1}}},
    'recurso-pedra':{kind:'frames',files:{sheet:{file:'recurso-pedra.webp',cell:[64,64],frames:1}}}}}}}));
  assert.deepEqual(artLoads(),[],'per-resource pieces load nothing until today has per-resource keys');
});

test('weapon projectiles: each one has its own key; tiro-aliado stays the shared friendly look',()=>{
  assert.deepEqual([...WEAPON_PROJECTILE_IDS],['chinelo','boleto','cafe','guarda-chuva','pombo','audio','chinelo-evo','boleto-evo','cafe-evo','garrafa-molotov',
    // D-051 arsenal (armas-caixas-render): the bullets and the rojão's rocket.
    'bala-revolver','bala-metralhadora','bala-fuzil','rojao']);
  for(const id of WEAPON_PROJECTILE_IDS)assert.equal(WEAPON_PROJECTILE_KEY[id],`art:proj:${id}`,id);
  const friendly=STATIC_ART.filter(s=>s.key===FX.projFriendly);
  assert.equal(friendly.length,1);assert.deepEqual(friendly[0].ids,['tiro-aliado']);assert.equal(friendly[0].mode,'sheet');
});

test('the contact shadow is stretched to today\'s 48×18 footprint; other bakes stay contain-fit',()=>{
  const shadow=STATIC_ART.find(s=>s.key===FX.shadow);
  assert.equal(shadow?.fit,'fill');assert.deepEqual(shadow?.size,[48,18]);assert.ok(shadow?.ids.includes('sombra-contato'));
  setArtIndex(parseArtIndex({version:2,groups:{
    efeitos:{output:'public/art/fx',pieces:{'sombra-contato':{kind:'frames',files:{sheet:{file:'sombra-contato.webp',cell:[128,64],frames:1}}}}},
    itens:{output:'public/art/items',pieces:{coxinha:{kind:'frames',files:{sheet:{file:'coxinha.webp',cell:[64,64],frames:1}}}}},
  }}));
  const by=new Map(artLoads().map(l=>[l.bake?.key,l.bake]));
  assert.deepEqual(by.get(FX.shadow),{key:FX.shadow,size:[48,18],fit:'fill'});
  assert.equal(by.get(pickupTexture('heal'))?.fit,'contain');
});

test('per-frame cache: the same pages, keys and fps objects on every call; chooseAnim cached per piece',()=>{
  const death={cell:[384,384] as [number,number],frames:16,directions:8,fps:{death:16},
    pages:[{file:'chefe/death-p1.webp',columns:10,rows:10,firstFrame:0,frameCount:100},{file:'chefe/death-p2.webp',columns:10,rows:3,firstFrame:100,frameCount:28}]};
  const a=fileInfo('chefe','death',death),b=fileInfo('chefe','death',death);
  assert.equal(a,b);assert.equal(a.pages,b.pages);assert.equal(a.keys,b.keys);
  assert.deepEqual(a.keys,['art:enemy:chefe:death:p1','art:enemy:chefe:death:p2']);assert.equal(a.fps,16*ENEMY_ANIM_RATE,'played 30% slower than drawn');
  const walk=fileInfo('bebado','walk',bebado.files.walk);
  assert.equal(fileInfo('bebado','walk',bebado.files.walk),walk);assert.deepEqual(walk.keys,['art:enemy:bebado:walk']);assert.equal(walk.fps,10*ENEMY_LOOP_RATE);
  // The frame's key is the cached string itself (nothing built per frame).
  const out={key:'',frame:0};
  assert.equal(enemyFrame('chefe',{kind:'animations',files:{death}},'death',6,slow(250),out)?.key,a.keys[1]);
  assert.equal(cachedAnim(bebado,true,false),'walk');assert.equal(cachedAnim(bebado,false,false),'idle');
  assert.equal(cachedAnim(bebado,false,true),'walk');assert.equal(cachedAnim(pombos,true,true),undefined);
  assert.equal(cachedAnim(pombos,true,true),undefined,'a cached miss stays a miss');
});
