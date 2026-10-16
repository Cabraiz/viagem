/**
 * NEW-20261016-ORQ-inimigos-originais-elite: the nine original kinds drawn from their imported sheets, and the elite
 * (Funcionário do Mês) layer `elite/<anim>` over every animation. The fixture is the delivery's own file list
 * (arte-entrada/inimigos/<id>/ and arte-entrada/elite/<id>-<anim>), as the importer lists it in the manifest.
 */
import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setArtIndex,parseArtIndex,type ArtPiece} from '../../src/client/art/manifest.ts';
import {ENEMY_ART_ID,artLoads,deathAnim,eliteFile,enemyArtKey,enemyFrame,loopAnim,pieceAction} from '../../src/client/art/horde-art.ts';
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

test('every original queues its sheets and every elite layer in the preload',()=>{
  loadAll();
  const keys=new Set(artLoads().map(l=>l.key));
  for(const k of ENEMY_KINDS)for(const a of DELIVERY[k].anims){
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
