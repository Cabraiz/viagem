/**
 * Imported 9-slice frames and ground marks (NEW-20261012-ORQ-importar-arte-c-completa, items 3 and 5): which element
 * uses which piece, slice insets passed through, the bar's fill width by hp (normal and elite), the mark frame by time,
 * and the empty manifest keeping today's drawing (nothing loaded, no Game Object made).
 */
import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setArtIndex,parseArtIndex} from '../../src/client/art/manifest.ts';
import {MARK_ANCHOR,MARK_FPS,MARK_PIECES,SLICE_PIECES,FramesPool,SceneMarks,barArt,barFillWidth,framesLoads,markArt,markFrame,
  markKey,queueFramesArt,sliceArt,sliceKey,type MarkElement,type SliceElement} from '../../src/client/art/frames-art.ts';

const EMPTY={version:2,groups:{}};
afterEach(()=>setArtIndex(parseArtIndex(EMPTY)));

const nine=(id:string,cell:[number,number],slice:[number,number,number,number])=>({kind:'nineslice',files:{sheet:{file:`${id}.webp`,cell,frames:1,slice}}});
const strip=(id:string,cell:[number,number],frames:number,extra:object={})=>({kind:'frames',files:{sheet:{file:`${id}.webp`,cell,frames,...extra}}});
const FULL={version:2,groups:{
  efeitos:{output:'public/art/fx',pieces:{
    'balao-fala':nine('balao-fala',[96,64],[24,20,24,28]),'etiqueta-devendo':nine('etiqueta-devendo',[96,64],[16,16,16,16]),
    'barra-vida-moldura':nine('barra-vida-moldura',[64,12],[4,4,4,4]),'barra-vida-preenchimento':nine('barra-vida-preenchimento',[64,12],[3,3,3,3]),
    'barra-vida-moldura-elite':nine('barra-vida-moldura-elite',[64,12],[6,4,6,4]),'barra-vida-preenchimento-elite':nine('barra-vida-preenchimento-elite',[64,12],[2,2,2,2]),
    'anel-alvo':strip('anel-alvo',[128,128],4,{fps:6}),'anel-habilidade':strip('anel-habilidade',[128,128],4),
    'marcador-destino':strip('marcador-destino',[128,128],4),'heroi-voce':strip('heroi-voce',[128,128],1),
    'caido-resgate':strip('caido-resgate',[128,256],6,{fps:10}),'aviso-spawn':strip('aviso-spawn',[128,128],6,{anchor:[.5,.6]}),
  }},
  props:{output:'public/art/city/props',pieces:{plaquinha:nine('plaquinha',[48,32],[8,8,8,8])}},
}};

test('every element names its importer piece (spec.mjs EFEITOS / PROPS ids)',()=>{
  assert.deepEqual(Object.fromEntries(Object.entries(SLICE_PIECES).map(([k,v])=>[k,`${v.group}/${v.id}`])),{
    balloon:'efeitos/balao-fala',tag:'efeitos/etiqueta-devendo',barFrame:'efeitos/barra-vida-moldura',barFill:'efeitos/barra-vida-preenchimento',
    barFrameElite:'efeitos/barra-vida-moldura-elite',barFillElite:'efeitos/barra-vida-preenchimento-elite',plaque:'props/plaquinha'});
  assert.deepEqual({...MARK_PIECES},{target:'anel-alvo',skill:'anel-habilidade',destination:'marcador-destino',you:'heroi-voce',
    rescue:'caido-resgate',spawn:'aviso-spawn'});
});

test('the importer expects every one of these pieces with the format the client reads',async()=>{
  const {GROUPS}=await import('../../scripts/art-v2/spec.mjs') as {GROUPS:Record<string,{expected?:Record<string,{kind?:string;cell?:number[];frames?:number}>}>};
  for(const {group,id} of Object.values(SLICE_PIECES))assert.equal(GROUPS[group].expected?.[id]?.kind,'nineslice',`${group}/${id}`);
  for(const id of Object.values(MARK_PIECES))assert.equal(GROUPS.efeitos.expected?.[id]?.kind,'frames',id);
  assert.deepEqual(GROUPS.efeitos.expected?.['caido-resgate']?.cell,[128,256]);
});

test('slice insets come through as [left, top, right, bottom], with the texture key and cell',()=>{
  setArtIndex(parseArtIndex(FULL));
  assert.deepEqual(sliceArt('balloon'),{key:sliceKey('efeitos','balao-fala'),group:'efeitos',id:'balao-fala',cell:[96,64],left:24,top:20,right:24,bottom:28});
  const plaque=sliceArt('plaque');
  assert.equal(plaque?.key,'art:slice:props:plaquinha');
  assert.deepEqual([plaque?.left,plaque?.top,plaque?.right,plaque?.bottom],[8,8,8,8]);
  assert.equal(sliceArt('tag')?.id,'etiqueta-devendo');
});

test('a 9-slice without a usable slice keeps today\'s drawing',()=>{
  setArtIndex(parseArtIndex({version:2,groups:{efeitos:{output:'public/art/fx',pieces:{
    'balao-fala':{kind:'nineslice',files:{sheet:{file:'b.webp',cell:[96,64]}}},
    'etiqueta-devendo':nine('etiqueta-devendo',[96,64],[50,8,50,8]),
    // Phaser makes a 3-slice (fixed height / width) when top+bottom or left+right is 0: it could not fit today's box.
    'barra-vida-moldura':nine('barra-vida-moldura',[64,12],[4,0,4,0]),
    'barra-vida-preenchimento':nine('barra-vida-preenchimento',[64,12],[0,3,0,3]),
    'barra-vida-moldura-elite':nine('barra-vida-moldura-elite',[64,12],[0,0,0,0]),
    'barra-vida-preenchimento-elite':nine('barra-vida-preenchimento-elite',[64,12],[0,2,3,0]),
  }}}}));
  assert.equal(sliceArt('balloon'),undefined,'no slice');
  assert.equal(sliceArt('tag'),undefined,'insets wider than the cell');
  assert.equal(sliceArt('barFrame'),undefined,'top + bottom = 0: a 3-slice of fixed height');
  assert.equal(sliceArt('barFill'),undefined,'left + right = 0: a 3-slice of fixed width');
  assert.equal(sliceArt('barFrameElite'),undefined,'no insets at all');
  assert.deepEqual([sliceArt('barFillElite')?.left,sliceArt('barFillElite')?.right],[0,3],'one inset per axis is enough');
  assert.equal(barArt(false),undefined,'the bar falls back to the procedural drawing');
});

test('the life bar is a pair per variant: elite uses the elite pair, a half pair keeps today\'s bar',()=>{
  setArtIndex(parseArtIndex(FULL));
  assert.equal(barArt(false)?.frame.id,'barra-vida-moldura');assert.equal(barArt(false)?.fill.id,'barra-vida-preenchimento');
  assert.equal(barArt(true)?.frame.id,'barra-vida-moldura-elite');assert.equal(barArt(true)?.fill.id,'barra-vida-preenchimento-elite');
  assert.equal(barArt(false),barArt(false),'cached: drawBar allocates nothing per frame');assert.equal(barArt(true),barArt(true));
  assert.notEqual(barArt(false),barArt(true));
  const only={version:2,groups:{efeitos:{output:'public/art/fx',pieces:{'barra-vida-moldura':nine('barra-vida-moldura',[64,12],[4,4,4,4]),
    'barra-vida-moldura-elite':nine('barra-vida-moldura-elite',[64,12],[4,4,4,4]),'barra-vida-preenchimento-elite':nine('barra-vida-preenchimento-elite',[64,12],[2,2,2,2])}}}};
  setArtIndex(parseArtIndex(only));
  assert.equal(barArt(false),undefined,'frame without fill');
  assert.equal(barArt(true)?.fill.id,'barra-vida-preenchimento-elite','the elite pair is whole');
});

test('bar fill width follows hp over today\'s inner width (normal 40, elite 54), never folded nor past full',()=>{
  // layers.ts drawBar: inner width 40·u (plain), 54·u (elite, u = sqrt(ui/body)·body), 170 (boss).
  assert.equal(barFillWidth(40,1),40);
  assert.equal(barFillWidth(40,.5),20);
  assert.equal(barFillWidth(54,.25),13.5);
  assert.equal(barFillWidth(54*1.5,.5),40.5,'elite at ui 2.25: u = 1.5');
  assert.equal(barFillWidth(170,.1),17);
  assert.equal(barFillWidth(40,0),0,'empty: no fill');
  assert.equal(barFillWidth(40,-1),0);assert.equal(barFillWidth(40,Number.NaN),0);
  assert.equal(barFillWidth(40,2),40,'over max hp: full');
  assert.equal(barFillWidth(40,.01,6),6,'at least the fill\'s insets, so the 9-slice never folds');
  assert.equal(barFillWidth(4,.5,6),4,'never wider than the bar');
});

test('marks: key, frames, fps (file or default) and anchor (file or MARK_ANCHOR)',()=>{
  setArtIndex(parseArtIndex(FULL));
  assert.deepEqual(markArt('target'),{key:markKey('anel-alvo'),id:'anel-alvo',cell:[128,128],frames:4,fps:6,anchor:[.5,.5]});
  assert.equal(markArt('skill')?.fps,MARK_FPS);
  assert.deepEqual(markArt('rescue')?.anchor,MARK_ANCHOR.rescue,'the caído ring sits in the bottom square of its 128×256 cell');
  assert.deepEqual(MARK_ANCHOR.rescue,[.5,.75]);
  assert.deepEqual(markArt('spawn')?.anchor,[.5,.6],'the sidecar anchor wins');
  assert.equal(markArt('you')?.frames,1);
});

test('mark frame by time: loops at the file fps; reduced motion and one-frame pieces stay on frame 0',()=>{
  setArtIndex(parseArtIndex(FULL));
  const ring=markArt('target')!,rescue=markArt('rescue')!,you=markArt('you')!;
  assert.deepEqual([0,166,167,333,334,500,666,667].map(t=>markFrame(ring,t)),[0,0,1,1,2,3,3,0]);
  assert.equal(markFrame(rescue,550),5);assert.equal(markFrame(rescue,600),0);
  assert.equal(markFrame(ring,400,true),0,'reduced motion');
  assert.equal(markFrame(you,12345),0);
  assert.equal(markFrame(ring,-50),0,'before the start');
});

test('loads: one per piece, 9-slices as images, marks as sheets of their cell',()=>{
  setArtIndex(parseArtIndex(FULL));
  const loads=framesLoads();
  assert.equal(loads.length,Object.keys(SLICE_PIECES).length+Object.keys(MARK_PIECES).length);
  assert.deepEqual(loads.find(l=>l.key===sliceKey('efeitos','balao-fala')),{key:'art:slice:efeitos:balao-fala',url:'/art/fx/balao-fala.webp',cell:[96,64],sheet:false});
  assert.deepEqual(loads.find(l=>l.key===markKey('caido-resgate')),{key:'art:mark:caido-resgate',url:'/art/fx/caido-resgate.webp',cell:[128,256],sheet:true});
  assert.equal(loads.find(l=>l.key===sliceKey('props','plaquinha'))?.url,'/art/city/props/plaquinha.webp');
});

// ---------- empty manifest: today's path, nothing made ----------
/** A scene that fails the test on any Game Object or load: the empty manifest must not reach them. */
function strictScene(){
  const fail=(what:string)=>()=>{throw new Error(`${what} with an empty manifest`);};
  return {
    textures:{exists:()=>false},
    load:{image:fail('load.image'),spritesheet:fail('load.spritesheet')},
    add:{image:fail('add.image'),nineslice:fail('add.nineslice')},
    sys:{game:{renderer:{type:2}}},
  } as never;
}

test('empty manifest: no piece, no load, no Game Object; every element keeps today\'s drawing',()=>{
  setArtIndex(parseArtIndex(EMPTY));
  for(const e of Object.keys(SLICE_PIECES) as SliceElement[])assert.equal(sliceArt(e),undefined,e);
  for(const e of Object.keys(MARK_PIECES) as MarkElement[])assert.equal(markArt(e),undefined,e);
  assert.equal(barArt(false),undefined);assert.equal(barArt(true),undefined);
  assert.deepEqual(framesLoads(),[]);
  const scene=strictScene();
  queueFramesArt(scene);
  const pool=new FramesPool(scene);
  pool.begin();
  assert.equal(pool.slice({},sliceArt('balloon'),1,0,0,10,10),undefined);
  assert.equal(pool.mark('target',markArt('target'),1,0,0,0,10),undefined);
  assert.equal(pool.ready(markArt('you')),false);
  assert.equal(pool.created,0);
  const marks=new SceneMarks(scene,p=>p);
  marks.begin();
  assert.equal(marks.destinationArt,false,'goTo draws today\'s Graphics');
  assert.equal(marks.destination({x:1,y:1},1,0,false,100000),false);
  assert.equal(marks.skillRing('p1',1,1,2.8,3,1,0,false,90000),false,'the scene draws today\'s ring');
});

test('art listed but its texture not loaded (a failed load): today\'s drawing, nothing made',()=>{
  setArtIndex(parseArtIndex(FULL));
  const scene=strictScene();
  const pool=new FramesPool(scene);
  assert.equal(pool.slice({},sliceArt('balloon'),1,0,0,10,10),undefined);
  assert.equal(pool.mark('spawn',markArt('spawn'),1,0,0,0,10),undefined);
  assert.equal(new SceneMarks(scene,p=>p).skillRing('p1',0,0,1,3,1,0,false,1),false);
  assert.equal(pool.created,0);
});

test('with the art loaded: one pooled object per owner, hidden by begin() and shown again, none made per frame',()=>{
  setArtIndex(parseArtIndex(FULL));
  let made=0;
  const object=()=>{made++;const o={visible:false,key:'',width:0,height:0,texture:{key:''},
    setVisible(v:boolean){o.visible=v;return o;},setOrigin(){return o;},setPosition(){return o;},setScale(){return o;},setDepth(){return o;},
    setAlpha(){return o;},setTint(){return o;},setFrame(){return o;},setSize(w:number,h:number){o.width=w;o.height=h;return o;},
    setTexture(k:string){o.texture.key=k;return o;},setSlices(){return o;},destroy(){}};return o;};
  const scene={textures:{exists:()=>true},sys:{game:{renderer:{type:2}}},
    add:{image:(_x:number,_y:number,key:string)=>{const o=object();o.texture.key=key;return o;},
      nineslice:(_x:number,_y:number,key:string,_f:unknown,w:number,h:number)=>{const o=object();o.texture.key=key;o.width=w;o.height=h;return o;}}} as never;
  const pool=new FramesPool(scene),owner={};
  for(let frame=0;frame<5;frame++){
    pool.begin();
    const s=pool.slice(owner,sliceArt('balloon'),95990.5,0,0,120,60,1) as unknown as {visible:boolean;width:number;height:number};
    const m=pool.mark('target',markArt('target'),-9970,markFrame(markArt('target')!,frame*100),0,0,60) as unknown as {visible:boolean};
    assert.ok(s.visible&&m.visible);
    assert.deepEqual([s.width,s.height],[120,60],'the frame stretches to the text box');
  }
  assert.equal(made,2);assert.equal(pool.created,2);
  // A tiny box never folds the 9-slice: at least its insets + 1.
  const s=pool.slice(owner,sliceArt('balloon'),1,0,0,10,10,1) as unknown as {width:number;height:number};
  assert.deepEqual([s.width,s.height],[49,49]);
  // Under Canvas the 9-slices keep today's drawing (NineSlice is WebGL only).
  const canvas=new FramesPool({...(scene as object),sys:{game:{renderer:{type:1}}}} as never);
  assert.equal(canvas.slice({},sliceArt('tag'),1,0,0,10,10),undefined);
});

test('skill ring: one scratch point for every projection (no allocation per frame); destroy releases the pool',()=>{
  setArtIndex(parseArtIndex(FULL));
  let destroyed=0;
  const image=()=>{const o={visible:false,texture:{key:''},setVisible(v:boolean){o.visible=v;return o;},setOrigin(){return o;},setPosition(){return o;},
    setScale(){return o;},setDepth(){return o;},setAlpha(){return o;},setFrame(){return o;},setTexture(k:string){o.texture.key=k;return o;},destroy(){destroyed++;}};return o;};
  const scene={textures:{exists:()=>true},sys:{game:{renderer:{type:2}}},add:{image}} as never;
  const inputs=new Set<object>();
  const marks=new SceneMarks(scene,p=>{inputs.add(p);return {x:p.x*2,y:p.y};});
  for(let frame=0;frame<4;frame++){marks.begin();assert.ok(marks.skillRing('p1',3,4,2.8,3,1,frame*100,false,90000));}
  assert.equal(inputs.size,1,'the same point object is projected every time');
  marks.destroy();assert.equal(destroyed,1,'the scene release destroys the ring image');
  marks.destroy();assert.equal(destroyed,1,'twice is harmless (shutdown then destroy)');
});

test('the demo fixture (tests/fixtures/art-v2/demo-frames.mjs) passes the importer and covers every element',async()=>{
  const {mkdtemp,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const path=await import('node:path');
  const {writeDemoFrames,DEMO_FRAMES}=await import('../fixtures/art-v2/demo-frames.mjs') as {writeDemoFrames:(dir:string)=>Promise<Record<string,readonly string[]>>;DEMO_FRAMES:Record<string,readonly string[]>};
  const {importArtV2}=await import('../../scripts/import-art-v2.mjs') as {importArtV2:(o:object)=>Promise<{pieces:{group:string;id:string;status:string;problems:string[]}[]}>};
  for(const {group,id} of Object.values(SLICE_PIECES))assert.ok(DEMO_FRAMES[group]?.includes(id),`${group}/${id}`);
  for(const id of Object.values(MARK_PIECES))assert.ok(DEMO_FRAMES.efeitos.includes(id),id);
  const dir=await mkdtemp(path.join(tmpdir(),'demo-frames-'));
  try{
    await writeDemoFrames(dir);
    const result=await importArtV2({input:dir,groups:['efeitos','props'],write:false});
    for(const [group,ids] of Object.entries(DEMO_FRAMES))for(const id of ids){
      const piece=result.pieces.find(p=>p.group===group&&p.id===id);
      assert.equal(piece?.status,'aprovado',`${group}/${id}: ${piece?.problems.join(' ')}`);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
