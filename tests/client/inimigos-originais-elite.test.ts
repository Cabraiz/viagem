/**
 * NEW-20261016-ORQ-inimigos-originais-elite: the nine original kinds drawn from their imported sheets, and the elite
 * (Funcionário do Mês) layer `elite/<anim>` over every animation. The fixture is the delivery's own file list
 * (arte-entrada/inimigos/<id>/ and arte-entrada/elite/<id>-<anim>), as the importer lists it in the manifest.
 */
import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setArtIndex,parseArtIndex,type ArtPiece} from '../../src/client/art/manifest.ts';
import {COSTUME_LAYER_DEPTH,ELITE_LAYER_DEPTH,ENEMY_ART_ID,ROUND_COSTUMES,applyEnemyArt,costumeFile,enemyPieceLoads,deathAnim,drawDeathArt,eliteFile,enemyArtKey,enemyFrame,loopAnim,pieceAction,playEnemyAction,roundCostume,unusedEnemyFile} from '../../src/client/art/horde-art.ts';
import {CIDADE_MODIFIERS,cidadeModifierLabel} from '../../src/rules/index.ts';
import {ENEMY_ACTIONS} from '../../src/client/art/horde-actions.ts';
import {PHASE_ACTING,actAnim} from '../../src/client/render/phase-look.ts';
import {ENEMY_KINDS,type EnemyKind} from '../../src/client/render/keys.ts';

/** Animations and cell of each original, as delivered (sleep/wake belong to the nests card but load like any file). */
const DELIVERY:Readonly<Record<EnemyKind,{cell:number;anims:readonly string[]}>>={
  bebado:{cell:128,anims:['idle','walk','attack','hit','death','sleep','wake']},
  'anao-molotov':{cell:112,anims:['idle','walk','throw','hit','death','sleep','wake']},
  pombos:{cell:96,anims:['fly','poop','hit','death','sleep','wake']},
  'tio-pave':{cell:160,anims:['idle','walk','joke','shove','hit','death','sleep','wake']},
  agiota:{cell:128,anims:['idle','walk','throw','hit','death','sleep','wake']},
  coach:{cell:128,anims:['idle','walk','lecture','hit','death','sleep','wake']},
  motoboy:{cell:160,anims:['idle','aim','charge','crash','sleep','wake']},
  influencer:{cell:160,anims:['idle','walk','pose','hit','death','sleep','wake']},
  chefe:{cell:384,anims:['idle','walk','phase2-idle','charge','slam','summon','hit','death','sleep','wake']},
};
const file=(id:string,name:string,cell:number)=>({file:`${id}/${name}.webp`,cell:[cell,cell] as [number,number],frames:6,directions:8,anchor:[.5,.88] as [number,number]});
function piece(kind:EnemyKind):ArtPiece{
  const {cell,anims}=DELIVERY[kind],id=ENEMY_ART_ID[kind],files:ArtPiece['files']={};
  for(const a of anims){files[a]=file(id,a,cell);files[eliteFile(a)]=file(id,`elite-${a}`,cell);}
  return {kind:'animations',files};
}
const EMPTY={version:2,groups:{}};
afterEach(()=>setArtIndex(parseArtIndex(EMPTY)));
const loadAll=()=>setArtIndex(parseArtIndex({version:2,groups:{inimigos:{output:'public/art/enemies',
  pieces:Object.fromEntries(ENEMY_KINDS.map(k=>[ENEMY_ART_ID[k],piece(k)]))}}}));

test('the nine originals are the delivery\'s ids (the fixture covers every kind)',()=>{
  assert.deepEqual([...ENEMY_KINDS].sort(),Object.keys(DELIVERY).sort());
  for(const k of ENEMY_KINDS)assert.equal(ENEMY_ART_ID[k],k);
});

test('every original queues its sheets and every elite layer in the loads of its enemy (enemyPieceLoads: they come with the enemy)',()=>{
  loadAll();
  const keys=new Set(ENEMY_KINDS.flatMap(k=>enemyPieceLoads(ENEMY_ART_ID[k]).map(l=>l.key)));
  // The rest rows (sleep, wake) are the nests' card's: no match downloads them yet (unusedEnemyFile).
  for(const k of ENEMY_KINDS)for(const a of DELIVERY[k].anims.filter(a=>!unusedEnemyFile(a))){
    assert.ok(keys.has(enemyArtKey(k,a)),`${k} ${a}`);
    assert.ok(keys.has(enemyArtKey(k,eliteFile(a))),`${k} elite/${a}`);
  }
});

test('no procedural state left: moving, still, acting and dying all have a sheet, plain and elite',()=>{
  loadAll();
  for(const k of ENEMY_KINDS){
    const p=piece(k);
    for(const elite of [false,true])for(const moving of [false,true]){
      const act=actAnim(k,k,PHASE_ACTING);
      for(const a of [undefined,act]){
        const anim=loopAnim(p,moving,elite,1,a);
        assert.ok(anim,`${k} moving=${moving} elite=${elite} act=${a}`);
        assert.ok(enemyFrame(k,p,anim as string,3,500),`${k} ${anim} has a frame`);
        if(elite)assert.ok(enemyFrame(k,p,eliteFile(anim as string),3,500),`${k} elite layer of ${anim}`);
      }
    }
    const death=deathAnim(p);
    assert.ok(death,`${k} dies with its sheet`);
    assert.ok(p.files[eliteFile(death as string)],`${k} elite layer of ${death}`);
  }
});

test('the acting poses loop their own sheet (lecture, aim → charge on the dash, pose)',()=>{
  loadAll();
  assert.equal(loopAnim(piece('coach'),false,true,1,actAnim('coach','coach',PHASE_ACTING)),'lecture');
  assert.equal(loopAnim(piece('motoboy'),false,true,1,actAnim('motoboy','motoboy',PHASE_ACTING)),'aim');
  assert.equal(loopAnim(piece('motoboy'),true,true,1,actAnim('motoboy','motoboy',PHASE_ACTING)),'charge');
  assert.equal(loopAnim(piece('influencer'),true,true,1,actAnim('influencer','influencer',PHASE_ACTING)),'pose');
  assert.equal(loopAnim(piece('pombos'),true,true),'fly','the pombos fly, elite too');
  assert.equal(loopAnim(piece('motoboy'),true,false),'idle','no walk: the motoboy rides on its idle');
  assert.equal(loopAnim(piece('chefe'),false,false,2),'phase2-idle');
});

test('every action cue a kind can get resolves to a sheet with its elite layer (the badge never blinks off)',()=>{
  loadAll();
  for(const k of ENEMY_KINDS){
    const p=piece(k);
    for(const action of ENEMY_ACTIONS){
      const played=pieceAction(p,action);
      if(played)assert.ok(p.files[eliteFile(played)],`${k} ${action} → ${played} has elite/${played}`);
    }
  }
  // The ones the horde actually cues (horde-actions.ts) all have their sheet.
  const cued:[EnemyKind,string][]=[['bebado','attack'],['anao-molotov','throw'],['pombos','poop'],['tio-pave','joke'],['tio-pave','shove'],
    ['agiota','throw'],['chefe','slam'],['chefe','charge'],['chefe','summon']];
  for(const [k,a] of cued)assert.equal(pieceAction(piece(k),a),a,`${k} ${a}`);
  for(const k of ENEMY_KINDS)if(k!=='motoboy')assert.equal(pieceAction(piece(k),'hit'),'hit',`${k} hit`);
});

// ---------------------------------------------------------------- zueira round costumes (Picolé de Tio, Pombos de Gorro)
/** The delivery's costume layers: `elite/<id>-<variant>-<anim>` → manifest key `elite/<variant>-<anim>`. */
function dressed(kind:EnemyKind,variant:string):ArtPiece{
  const p=piece(kind),{cell,anims}=DELIVERY[kind];
  for(const a of anims)p.files[costumeFile(variant,a)]=file(ENEMY_ART_ID[kind],`elite-${variant}-${a}`,cell);
  return p;
}
interface Mock {[k:string]:unknown;texture:{key:string};frame:number;visible:boolean;alpha:number;depth:number;scaleX:number}
function mockScene(loaded:Set<string>){
  const hooks:(()=>void)[]=[],made:Mock[]=[];
  const scene={textures:{exists:(k:string)=>loaded.has(k)},add:{image:()=>{const o=mockImage(scene);made.push(o);return o;}},
    events:{on:(_:string,f:()=>void)=>hooks.push(f),off(){}},hooks,made};
  return scene;
}
function mockImage(scene:unknown):Mock{
  const m:Mock={texture:{key:'horde:enemy:x'},frame:0,visible:true,alpha:1,x:0,y:0,depth:0,scaleX:1,originX:.5,originY:.92,scene,
    tintFill:false,tintTopLeft:0,tintTopRight:0,tintBottomLeft:0,tintBottomRight:0};
  const self=(f:(...a:never[])=>void)=>(...a:never[])=>{f(...a);return m;};
  Object.assign(m,{
    setTexture:self(((k:string,f?:number)=>{m.texture={key:k};m.frame=f??0;}) as never),setFrame:self(((f:number)=>{m.frame=f;}) as never),
    setOrigin:self(()=>{}),setScale:self(((s:number)=>{m.scaleX=s;}) as never),setFlipX:self(()=>{}),setRotation:self(()=>{}),
    setAlpha:self(((a:number)=>{m.alpha=a;}) as never),setVisible:self(((v:boolean)=>{m.visible=v;}) as never),
    setPosition:self(()=>{}),setDepth:self(((d:number)=>{m.depth=d;}) as never),once:()=>m,
  });
  return m;
}
const keysOf=(p:ArtPiece,id:string)=>Object.keys(p.files).map(f=>`art:enemy:${id}:${f}`);

test('the round banner names the costume: Picolé de Tio dresses the tio-pave, Pombos de Gorro the pombos; other rounds none',()=>{
  const label=(id:string)=>cidadeModifierLabel(CIDADE_MODIFIERS.find(m=>m.id===id) as never);
  assert.deepEqual(roundCostume(label('uncle-popsicle')),{art:'tio-pave',variant:'picole'});
  assert.deepEqual(roundCostume(label('beanie-mosquito')),{art:'pombos',variant:'gorro'});
  assert.equal(roundCostume(label('black-ice')),undefined);assert.equal(roundCostume(undefined),undefined);
  for(const id of Object.keys(ROUND_COSTUMES))assert.ok(CIDADE_MODIFIERS.some(m=>m.id===id),`${id} is a cidade modifier`);
  assert.equal(costumeFile('gorro','fly'),'elite/gorro-fly');
  assert.ok(COSTUME_LAYER_DEPTH>0&&COSTUME_LAYER_DEPTH<ELITE_LAYER_DEPTH,'base < costume < elite badge');
});

test('a costume never picks the animation: the elite and plain loops stay the same with costume sheets in the piece',()=>{
  for(const [kind,variant] of [['tio-pave','picole'],['pombos','gorro']] as [EnemyKind,string][]){
    const plain=piece(kind),dress=dressed(kind,variant);
    for(const elite of [false,true])for(const moving of [false,true])assert.equal(loopAnim(dress,moving,elite),loopAnim(plain,moving,elite));
  }
});

test('applyEnemyArt: an elite tio-pave in Picolé de Tio wears the ice under the badge; outside the round, only the badge',()=>{
  const p=dressed('tio-pave','picole');
  setArtIndex(parseArtIndex({version:2,groups:{inimigos:{output:'public/art/enemies',pieces:{'tio-pave':p}}}}));
  const scene=mockScene(new Set(keysOf(p,'tio-pave'))),image=mockImage(scene) as never as Parameters<typeof applyEnemyArt>[0],m=image as never as Mock;
  const a:{kind:EnemyKind;elite:boolean;phase:number;costume?:string}={kind:'tio-pave',elite:true,phase:0,costume:'picole'};
  assert.ok(applyEnemyArt(image,a,true,1,0,0));scene.hooks.forEach(h=>h());
  const [elite,ice]=scene.made;
  assert.equal(m.texture.key,'art:enemy:tio-pave:walk');
  assert.equal(elite.texture.key,'art:enemy:tio-pave:elite/walk');assert.equal(ice.texture.key,'art:enemy:tio-pave:elite/picole-walk');
  assert.ok(elite.visible&&ice.visible);assert.ok(m.depth<ice.depth&&ice.depth<elite.depth);
  assert.equal(ice.frame,m.frame,'the costume follows the base frame');
  // An action (joke) plays its own costume sheet.
  assert.ok(playEnemyAction(image,'tio-pave','joke',100));applyEnemyArt(image,a,true,1,0,150);
  assert.equal(ice.texture.key,'art:enemy:tio-pave:elite/picole-joke');
  // The round is over: the costume hides, the badge stays.
  a.costume=undefined;applyEnemyArt(image,a,true,1,0,5000);scene.hooks.forEach(h=>h());
  assert.equal(ice.visible,false);assert.equal(elite.visible,true);
});

test('drawDeathArt: a gorro pigeon dies with its beanie',()=>{
  const p=dressed('pombos','gorro');
  setArtIndex(parseArtIndex({version:2,groups:{inimigos:{output:'public/art/enemies',pieces:{pombos:p}}}}));
  const scene=mockScene(new Set(keysOf(p,'pombos')));
  const body=mockImage(scene) as never as Parameters<typeof drawDeathArt>[0],top=mockImage(scene) as never as Parameters<typeof drawDeathArt>[0],hat=mockImage(scene);
  const costume={image:hat as never as Parameters<typeof drawDeathArt>[0],variant:'gorro'};
  assert.ok(drawDeathArt(body,top,'pombos',false,0,50,1,'pombos',costume));
  assert.equal(hat.texture.key,'art:enemy:pombos:elite/gorro-death');assert.equal(hat.visible,true);
  assert.equal((top as never as Mock).visible,false,'not an elite: no badge');
  costume.variant=undefined as never;drawDeathArt(body,top,'pombos',false,0,60,1,'pombos',costume);assert.equal(hat.visible,false);
});
