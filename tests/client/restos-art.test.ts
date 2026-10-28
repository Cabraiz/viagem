/**
 * NEW-20261012-ORQ-importar-arte-d-restos: the leftovers wired to imported art, each with today's drawing as fallback.
 * Critter HUD icon, ally ring and plaque (art/hud-art.ts), the hostile shot without its own art (tiro-inimigo), the
 * telegraph decorations (OP_SPRITE in telegraph-look.ts), the blackout eyes (olhos-escuro) and the death poof strip.
 * The empty manifest keeps today's path: no piece, no load, no Game Object, the very same decoration ops.
 */
import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setArtIndex,parseArtIndex} from '../../src/client/art/manifest.ts';
import {FX_MARK_PIECES,framesLoads,markArt,markKey} from '../../src/client/art/frames-art.ts';
import {HOSTILE_SHOT_ART,artLoads,poofArt,poofSheetFrame,projectileLook} from '../../src/client/art/horde-art.ts';
import {ALLY_RING_ALPHA,AllyRings,CRITTER_ICON_IDS,allyRingArt,critterIconSource,labelPlaque} from '../../src/client/art/hud-art.ts';
import {BLINK_EVERY_MS,BLINK_MS,eyesFrame,eyesOpen} from '../../src/client/render/blackout-rules.ts';
import {POOF_MS} from '../../src/client/render/motion.ts';
import {DECOR_ART_ARROW,DECOR_ART_BURST,DECOR_ART_GAS,DECOR_ART_IDS,DECOR_STRIDE,DecorBuffer,OP_SPRITE,decorLoopFrame,planDecor,
  type DecorFrame} from '../../src/client/render/telegraph-look.ts';
import {decorArtInfo,decorArtKey,queueTelegraphArt,telegraphDecorLoads} from '../../src/client/render/telegraph-art.ts';
import {ENEMY_KINDS} from '../../src/client/render/keys.ts';

const EMPTY={version:2,groups:{}};
afterEach(()=>setArtIndex(parseArtIndex(EMPTY)));
const strip=(id:string,cell:[number,number],frames:number)=>({kind:'frames',files:{sheet:{file:`${id}.webp`,cell,frames}}});
const FULL={version:2,groups:{
  efeitos:{output:'public/art/fx',pieces:{
    'olhos-escuro':strip('olhos-escuro',[64,32],4),'morte-poof':strip('morte-poof',[128,128],8),
    'seta-investida':strip('seta-investida',[64,64],4),'aviso-explosao':strip('aviso-explosao',[128,128],8),
    arroto:strip('arroto',[192,128],6),'heroi-voce':strip('heroi-voce',[128,128],1),
  }},
  projeteis:{output:'public/art/projeteis',pieces:{'tiro-inimigo':strip('tiro-inimigo',[32,32],4)}},
  ui:{output:'public/art/ui',pieces:{'inimigo-agiota':{kind:'icon',files:{sheet:{file:'inimigo-agiota.webp',cell:[128,128],frames:1}},meta:{}}}},
  props:{output:'public/art/city/props',pieces:{plaquinha:{kind:'nineslice',files:{sheet:{file:'plaquinha.webp',cell:[48,32],frames:1,slice:[8,8,8,8]}}}}},
}};
const full=()=>setArtIndex(parseArtIndex(FULL));

// ---------- item 1/2: critter icon, ally ring and plaque ----------
test('critter icon: the ui piece inimigo-<id> when imported; none for the others and for unknown kinds',()=>{
  assert.equal(CRITTER_ICON_IDS.agiota,'inimigo-agiota');
  assert.equal(critterIconSource('agiota'),undefined);
  full();
  const s=critterIconSource('agiota');
  assert.ok(s&&'url' in s&&s.url.endsWith('inimigo-agiota.webp'),JSON.stringify(s));
  assert.equal(critterIconSource('bebado'),undefined,'no ui icon and no enemy sheet: today\'s texture');
  assert.equal(critterIconSource('bichos'),undefined);
});
test('ally ring reuses the "Você" ring; ally names use the place plaque, never the SOS ficha',()=>{
  assert.equal(allyRingArt(),undefined);assert.equal(labelPlaque('ally',false),undefined);
  full();
  assert.equal(allyRingArt()?.key,markKey('heroi-voce'));
  assert.ok(labelPlaque('ally',false));assert.ok(labelPlaque('place',false));assert.equal(labelPlaque('ally',true),undefined);
  assert.ok(ALLY_RING_ALPHA>0&&ALLY_RING_ALPHA<=1);
});
test('AllyRings: no Game Object with an empty manifest (today\'s ellipse draws)',()=>{
  const scene={textures:{exists:()=>false},add:{image:()=>{throw new Error('add.image with an empty manifest');}}} as never;
  const rings=new AllyRings(scene,0);
  assert.equal(rings.draw('p2',0,0,48,1,0,false),false);assert.equal(rings.created,0);
});

// ---------- item 3: hostile shots ----------
test('a hostile shot without its own art plays tiro-inimigo; a player weapon never does',()=>{
  assert.equal(projectileLook(true,'bichos'),undefined);
  full();
  assert.equal(HOSTILE_SHOT_ART,'tiro-inimigo');
  assert.deepEqual(projectileLook(true,'algo-novo'),{key:'art:proj:tiro-inimigo',frames:4,fps:8});
  assert.equal(projectileLook(true,'boleto'),undefined,'a player weapon shot by a critter keeps today\'s look');
  assert.ok(artLoads().some(l=>l.key==='art:proj:tiro-inimigo'));
});

// ---------- item 4: telegraph decorations ----------
const frame=(art?:DecorFrame['art']):DecorFrame=>({u:.5,ticksLeft:10,now:1234,reduced:false,phase:.3,css:1,bounds:{minX:0,minY:0,maxX:-1,maxY:-1},art});
const project=(x:number,y:number,out:{x:number;y:number})=>{out.x=(x-y)*32;out.y=(x+y)*16;return out;};
const sprites=(b:DecorBuffer)=>{const out:number[][]=[];for(let i=0;i<b.count;i++){const o=i*DECOR_STRIDE;if(b.data[o]===OP_SPRITE)out.push([...b.data.slice(o,o+11)]);}return out;};
const CHARGE={shape:'line' as const,x:0,y:0,radius:6,dx:1,dy:0,width:1.5,kind:'investida'};
const BOOM={shape:'circle' as const,x:0,y:0,radius:2,dx:1,dy:0,kind:'explosao'};
const BURP={shape:'cone' as const,x:0,y:0,radius:3,dx:0,dy:1,width:Math.PI/2,kind:'arroto'};

test('decorations: without art (or art not in) the ops are today\'s, with no sprite',()=>{
  for(const t of [CHARGE,BOOM,BURP]){
    const a=new DecorBuffer(),b=new DecorBuffer();
    planDecor(t,frame(),project,a);planDecor(t,frame({frames:[0,0,0],aspect:[1,1,1]}),project,b);
    assert.ok(a.count>0);assert.equal(sprites(a).length,0,t.kind);
    assert.deepEqual([...b.data.slice(0,b.count*DECOR_STRIDE)],[...a.data.slice(0,a.count*DECOR_STRIDE)],t.kind);
  }
});
test('decorations with art: one sprite per chevron (turned along the charge), one target, one burp cloud',()=>{
  const art={frames:[4,8,6],aspect:[1,1,128/192]},b=new DecorBuffer();
  planDecor(CHARGE,frame(art),project,b);
  const chevrons=sprites(b);
  assert.equal(chevrons.length,3);assert.equal(b.count,3,'no vector chevron left');
  for(const s of chevrons){assert.equal(s[4],DECOR_ART_ARROW);assert.ok(Math.abs(s[7]-Math.atan2(16,32))<1e-9,'rotated along the projected +x');assert.ok(s[8]>0&&s[9]>0);}
  planDecor(BOOM,frame(art),project,b);
  const [boom]=sprites(b);assert.equal(b.count,1);assert.equal(boom[4],DECOR_ART_BURST);assert.ok(boom[10]>=0&&boom[10]<8);
  planDecor(BURP,frame(art),project,b);
  const [cloud]=sprites(b);assert.equal(b.count,1);assert.equal(cloud[4],DECOR_ART_GAS);
  assert.ok(Math.abs(cloud[9]/cloud[8]-128/192)<1e-9,'cell aspect kept');
});
test('decoration loop frame: 8 fps, shifted per chevron, still with reduced motion',()=>{
  assert.equal(decorLoopFrame({now:0,reduced:false},4),0);
  assert.equal(decorLoopFrame({now:130,reduced:false},4),1);
  assert.equal(decorLoopFrame({now:130,reduced:false},4,3),0);
  assert.equal(decorLoopFrame({now:999,reduced:true},4),0);
  assert.equal(decorLoopFrame({now:999,reduced:false},1),0);
});
test('decoration loads: sheets of their cell from the manifest, nothing when empty',()=>{
  assert.deepEqual(telegraphDecorLoads(DECOR_ART_IDS),[]);
  const strict={textures:{exists:()=>false},load:{image:()=>{throw new Error('load');},spritesheet:()=>{throw new Error('load');},isLoading:()=>false,start:()=>{throw new Error('start');}}} as never;
  queueTelegraphArt(strict);
  full();
  assert.deepEqual(decorArtInfo('arroto'),{key:decorArtKey('arroto'),cell:[192,128],frames:6});
  assert.deepEqual(telegraphDecorLoads(DECOR_ART_IDS).map(l=>l.key),DECOR_ART_IDS.map(decorArtKey));
});

// ---------- item 5: blackout eyes ----------
test('eyes: the olhos-escuro strip loads with the marks; the blink plays frames 1.. on today\'s clock',()=>{
  assert.equal(markArt('eyes'),undefined);
  full();
  assert.equal(FX_MARK_PIECES.eyes,'olhos-escuro');
  assert.deepEqual(markArt('eyes'),{key:markKey('olhos-escuro'),id:'olhos-escuro',cell:[64,32],frames:4,fps:8,anchor:[.5,.5]});
  assert.ok(framesLoads().some(l=>l.key===markKey('olhos-escuro')&&l.sheet));
  const closedAt=BLINK_EVERY_MS*2;
  assert.equal(eyesOpen(closedAt,0,false),false);
  assert.deepEqual([0,BLINK_MS/3,BLINK_MS*2/3,BLINK_MS-1].map(t=>eyesFrame(closedAt+t,0,false,4)),[1,2,3,3]);
  assert.equal(eyesFrame(closedAt+BLINK_MS,0,false,4),0);
  assert.equal(eyesFrame(closedAt,0,true,4),0,'reduced motion: never blinks');
  assert.equal(eyesFrame(closedAt,0,false,1),0,'one frame: no blink');
});

// ---------- item 6: death poof ----------
test('poof: the whole morte-poof strip over today\'s lifetime at today\'s 64 px; none with an empty manifest',()=>{
  assert.equal(poofArt(),undefined);
  full();
  assert.deepEqual(poofArt(),{key:'art:efeitos:morte-poof',frames:8,fit:.5});
  assert.ok(artLoads().some(l=>l.key==='art:efeitos:morte-poof'),'the bake source sheet is what plays');
  assert.deepEqual([0,POOF_MS/8,POOF_MS/2,POOF_MS-1,POOF_MS*2].map(t=>poofSheetFrame(t,8)),[0,1,4,7,7]);
  assert.equal(poofSheetFrame(300,1),0);
});

// ---------- importer side ----------
test('the importer expects every piece and the demo fixture passes it',async()=>{
  const {GROUPS}=await import('../../scripts/art-v2/spec.mjs') as {GROUPS:Record<string,{expected?:Record<string,{kind?:string;cell?:number[]}>}>};
  for(const id of [...DECOR_ART_IDS,'olhos-escuro','morte-poof'])assert.ok(GROUPS.efeitos.expected?.[id],id);
  assert.ok(GROUPS.projeteis.expected?.['tiro-inimigo']);
  for(const kind of ENEMY_KINDS)assert.ok(GROUPS.ui.expected?.[CRITTER_ICON_IDS[kind]],kind);
  const {mkdtemp,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const path=await import('node:path');
  const {writeDemoRestos,DEMO_RESTOS}=await import('../fixtures/art-v2/demo-restos.mjs') as {writeDemoRestos:(d:string)=>Promise<unknown>;DEMO_RESTOS:Record<string,readonly string[]>};
  const {importArtV2}=await import('../../scripts/import-art-v2.mjs') as {importArtV2:(o:object)=>Promise<{pieces:{group:string;id:string;status:string;problems:string[]}[]}>};
  const dir=await mkdtemp(path.join(tmpdir(),'demo-restos-'));
  try{
    await writeDemoRestos(dir);
    const result=await importArtV2({input:dir,groups:['efeitos','projeteis'],write:false});
    for(const [group,ids] of Object.entries(DEMO_RESTOS))for(const id of ids){
      const piece=result.pieces.find(p=>p.group===group&&p.id===id);
      assert.equal(piece?.status,'aprovado',`${group}/${id}: ${piece?.problems.join(' | ')}`);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
