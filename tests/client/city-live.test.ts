import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIGHT_HEADS,WIRE_MAX_CELLS,artViewOf,cellFrame,cellPoint,decorKey,isPole,lightKind,lightLevel,liveMeta,loopFps,loopFrame,
  matchInsulators,onCamera,polePairs,sagLine,type DecorEntry,type Pt,
} from '../../src/client/render/city/live/rules.ts';

const pole=(c:number,r:number,id='poste-concreto-1'):DecorEntry=>({id,c,r,w:1,h:1,rot:0});

test('art view = camera quarter turns + the piece rot, wrapped', ()=>{
  assert.equal(artViewOf(0,90),90);
  assert.equal(artViewOf(1,270),0);
  assert.equal(artViewOf(3,180),90);
  assert.equal(artViewOf(2,0),180);
});

test('liveMeta keeps the delivery format and drops malformed parts', ()=>{
  const m=liveMeta({cell:[512,512],anims:{balanco:{0:[136,111],90:[128,110],180:'x'},'../x':{0:[1,1]}},animCell:[256,256],animFrames:8,fps:8,
    wires:{0:[[190,129],[258,102],[325,75]],90:[[1,2],'bad']}});
  assert.deepEqual(m.anims,{balanco:{0:[136,111],90:[128,110]}});
  assert.deepEqual(m.wires,{0:[[190,129],[258,102],[325,75]]});
  assert.equal(m.animFrames,8);
  assert.deepEqual(liveMeta({fps:{giroflex:8,'__proto__':3,radio:'x'}}).fps,{giroflex:8});
  assert.deepEqual(liveMeta(undefined),{});
});

test('overlay offsets map from the base cell to the screen through the image origin and scale', ()=>{
  const f=cellFrame({x:100,y:200,originX:.5,originY:.9,scaleX:.5},[512,512]);
  assert.deepEqual(f,{left:100-128,top:200-.9*256,scale:.5});
  assert.deepEqual(cellPoint(f,[136,111]),{x:-28+68,y:200-230.4+55.5});
});

test('loops: 8–10 fps, a phase per piece, frame 0 with reduced motion', ()=>{
  assert.equal(loopFps(undefined),8);assert.equal(loopFps(30),10);assert.equal(loopFps(4),8);assert.equal(loopFps(4,undefined,true),4);
  assert.equal(loopFps({giroflex:9},'giroflex'),9);assert.equal(loopFps({giroflex:9},'radio'),8);
  assert.equal(loopFrame(12345,8,8,'a',true),0);
  const seq=Array.from({length:16},(_,i)=>loopFrame(i*125,8,8,'a',false));
  for(let i=1;i<16;i++)assert.equal(seq[i],(seq[i-1]+1)%8,'one frame per 125 ms at 8 fps');
  assert.ok(new Set(['a','b','c','d','e'].map(k=>loopFrame(0,8,8,k,false))).size>1,'pieces start out of step');
});

test('poles wire to their nearest neighbour on the same sidewalk, once per pair', ()=>{
  const entries=[pole(0,0),pole(4,0),pole(8,0),pole(4,1,'poste-gato-1'),pole(30,0),{id:'farmacia-1',c:2,r:0,w:2,h:1,rot:0}];
  const pairs=polePairs(entries);
  const keys=pairs.map(p=>p.join('|'));
  assert.equal(new Set(keys).size,keys.length);
  assert.ok(keys.includes([decorKey(pole(0,0)),decorKey(pole(4,0))].sort().join('|')));
  assert.ok(!pairs.flat().includes(decorKey(pole(30,0))),'no neighbour within '+WIRE_MAX_CELLS+' cells');
  assert.ok(!pairs.flat().some(k=>k.startsWith('farmacia')));
  // a pole off both axes is on another sidewalk: it crosses to its nearest pole only when it has no line of its own
  assert.equal(polePairs([pole(0,0),pole(2,2)]).length,1);
  assert.equal(polePairs([pole(0,0),pole(4,0),pole(8,0),pole(2,3),pole(2,7)]).length,3,'(2,3)-(2,7) is a line: no crossing to the other street');
  assert.deepEqual(polePairs([pole(0,0),pole(4,0)]),polePairs([pole(4,0),pole(0,0)]),'order-free');
  // a street of evenly spaced poles is one continuous line (no gap every other span)
  assert.equal(polePairs([pole(0,0),pole(4,0),pole(8,0),pole(12,0)]).length,3);
  // a corner pole joins both streets
  assert.equal(polePairs([pole(0,0),pole(4,0),pole(0,4)]).length,2);
  assert.ok(isPole('poste-concreto-3')&&isPole('poste-gato-2')&&!isPole('poste-aceso-amarelo-1'));
});

const crosses=(a:Pt,b:Pt,c:Pt,d:Pt)=>{
  const s=(p:Pt,q:Pt,r:Pt)=>Math.sign((q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x));
  return s(a,b,c)*s(a,b,d)<0&&s(c,d,a)*s(c,d,b)<0;
};
test('the three wires never cross, whatever order the two poles list their insulators', ()=>{
  const a=[{x:0,y:-10},{x:0,y:0},{x:0,y:10}],b=[{x:200,y:12},{x:200,y:-8},{x:200,y:2}];
  const m=matchInsulators(a,b);
  assert.equal(m.length,3);
  for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)assert.ok(!crosses(m[i][0],m[i][1],m[j][0],m[j][1]));
});

test('a wire sags in the middle and ends on its insulators', ()=>{
  const pts=sagLine({x:0,y:0},{x:200,y:0});
  assert.deepEqual(pts[0],{x:0,y:0});assert.deepEqual(pts.at(-1),{x:200,y:0});
  const mid=pts[Math.floor(pts.length/2)];
  assert.ok(mid.y>10&&mid.y<=16,`sag ${mid.y}`);
});

test('lights: kinds, heads measured for every delivered variant, steady with reduced motion', async ()=>{
  assert.equal(lightKind('fogueira-tambor-2'),'fogueira');assert.equal(lightKind('poste-aceso-amarelo-1'),'poste');
  assert.equal(lightKind('luminaria-quebrada-pisca-1'),'pisca');assert.equal(lightKind('poste-concreto-1'),undefined);
  for(const views of Object.values(LIGHT_HEADS))assert.deepEqual(Object.keys(views).sort(),['0','180','270','90']);
  assert.equal(lightLevel('fogueira',1234,'k',true),1);
  // the importer may rescale the cell: the measured head follows
  const {lightHead}=await import('../../src/client/render/city/live/rules.ts');
  assert.deepEqual(lightHead('poste-aceso-amarelo-1',0,[512,768]),[392,168]);
  assert.deepEqual(lightHead('poste-aceso-amarelo-1',0,[256,384]),[196,84]);
  assert.equal(lightLevel('pisca',0,'k',false,2)<.2,true);
  for(let t=0;t<5000;t+=37){const v=lightLevel('fogueira',t,'k',false);assert.ok(v>.65&&v<=1);}
});

test('camera culling with a margin', ()=>{
  const cam={x:0,y:0,w:100,h:100};
  assert.ok(onCamera({x:120,y:0,w:10,h:10},cam));
  assert.ok(!onCamera({x:200,y:0,w:10,h:10},cam));
});

test('live sheets: place overlays, lit objects and nests from any group; bases are not loaded here', async ()=>{
  const {liveSheets,livePieces}=await import('../../src/client/render/city/live/art.ts');
  const f=(file:string,cell:[number,number]=[256,256])=>({file,cell,frames:8,views:4});
  const index={version:2,groups:{
    cenario:{output:'public/art/cenario',pieces:{
      'boteco-apocaliptico-1':{kind:'views',files:{views:f('boteco.webp',[768,1024]),'anim-janela':f('boteco-janela.webp')},meta:{anims:{janela:{0:[1,2]}}}},
      'fogueira-tambor-1':{kind:'views',files:{views:f('fog.webp'),anim:f('fog-anim.webp')}},
      'ninho-festa-ativo':{kind:'views',files:{sheet:f('nf.webp',[448,448])}},
      'ninho-boteco-ativo':{kind:'views',files:{sheet:f('nb.webp',[448,448]),'quebra':f('nbq.webp')}},
    }},
  }};
  const sheets=liveSheets(index);
  assert.deepEqual(sheets.map(s=>s.key).sort(),['city:live:boteco-apocaliptico-1:anim-janela','city:live:fogueira-tambor-1:anim','city:live:ninho-boteco-ativo:sheet','city:live:ninho-festa-ativo:sheet']);
  assert.equal(sheets.find(s=>s.key.endsWith('anim-janela'))!.url,'/art/cenario/boteco-janela.webp');
  const piece=livePieces(index)('boteco-apocaliptico-1')!;
  assert.equal(piece.key('anim-janela'),'city:live:boteco-apocaliptico-1:anim-janela');
  assert.equal(livePieces(index)('nada'),undefined);
});

test('decals: families, corners on the footprint, the texture turned by rot', async ()=>{
  const {decalCorners,isDecal}=await import('../../src/client/render/city/live/rules.ts');
  assert.ok(isDecal('bueiro')&&isDecal('rachadura-3')&&isDecal('faixa-pedestre')&&!isDecal('poste-concreto-1')&&!isDecal('rachadura'+'-x'));
  const at0=decalCorners({c:2,r:3,w:1,h:2,rot:0});
  assert.deepEqual(at0.map(p=>[p.cx,p.cy]),[[2,3],[3,3],[3,5],[2,5]]);
  assert.deepEqual(at0.map(p=>[p.u,p.v]),[[0,0],[1,0],[1,1],[0,1]]);
  // turned 90° clockwise: the image's top-left (0,0) now sits on the north-east corner
  assert.deepEqual(decalCorners({c:0,r:0,w:1,h:1,rot:90}).map(p=>[p.u,p.v]),[[0,1],[0,0],[1,0],[1,1]]);
  assert.deepEqual(decalCorners({c:0,r:0,w:1,h:1,rot:360}),decalCorners({c:0,r:0,w:1,h:1,rot:0}));
});

test('bank screens are states, not idle loops; animVisibleViews narrows the views', async ()=>{
  const {liveMeta,loopVisible,isIdleLoop}=await import('../../src/client/render/city/live/rules.ts');
  assert.ok(!isIdleLoop('sacando')&&!isIdleLoop('tela-azul')&&isIdleLoop('giroflex'));
  const bank=liveMeta({anims:{sacando:{0:[1,1]},'tela-azul':{0:[1,1]}}});
  assert.ok(!loopVisible(bank,'sacando',0)&&!loopVisible(bank,'tela-azul',0));
  const m=liveMeta({anims:{toldo:{0:[1,1],90:[2,2]}},animVisibleViews:{toldo:[0]}});
  assert.ok(loopVisible(m,'toldo',0)&&!loopVisible(m,'toldo',90)&&!loopVisible(m,'toldo',180));
  const all=liveMeta({anims:{toldo:{0:[1,1],90:[2,2]}},animVisibleViews:[90,'x']});
  assert.deepEqual(all.animVisibleViews,[90]);
  assert.ok(!loopVisible(all,'toldo',0)&&loopVisible(all,'toldo',90));
});
