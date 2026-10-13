// arte-do-roster-no-render: roster enemies (D-040) draw their own imported art by roster id, load it per match and
// keep the role's reserve without it; the role's event and acting animations play by id.
import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {artPiece,setArtIndex,parseArtIndex,type ArtPiece} from '../../src/client/art/manifest.ts';
import {projectileAction} from '../../src/client/art/horde-actions.ts';
const artPieceOf=(id:string)=>artPiece('inimigos',id);
import {ACTION_ALIASES,HERO_FIGURE_PX,deathAnim,MASS_ALPHA,applyEnemyArt,artLoads,artTargetHeight,drawnScale,topRow,deathDuration,enemyArtActive,enemyArtId,enemyArtOn,enemyPieceLoads,hasDeathArt,
  loopAnim,pieceAction,playEnemyAction,queueEnemyArt} from '../../src/client/art/horde-art.ts';
import {actAnim,PHASE_ACTING,PHASE_BUFFED} from '../../src/client/render/phase-look.ts';
import {enemyKind} from '../../src/client/render/keys.ts';
import {ROSTER as ENEMY_ROSTER} from '../../src/rules/index.ts';

const EMPTY={version:2,groups:{}};
afterEach(()=>setArtIndex(parseArtIndex(EMPTY)));

const sheet=(file:string,frames:number,cell=128,fps=10)=>({file,cell:[cell,cell] as [number,number],frames,directions:8,anchor:[.5,.88] as [number,number],fps});
// Shapes of E7's pack-04 import (scripts/art-v2/enemies-table.mjs roles): a kamikaze, an enxame, a suporte-less brute.
const grauzeiro:ArtPiece={kind:'animations',files:{idle:sheet('grauzeiro/idle.webp',4,160),aim:sheet('grauzeiro/aim.webp',6,160),
  charge:sheet('grauzeiro/charge.webp',6,160),crash:sheet('grauzeiro/crash.webp',10,160)}};
const rato:ArtPiece={kind:'animations',files:{walk:sheet('rato-de-boteco/walk.webp',6,64),attack:sheet('rato-de-boteco/attack.webp',4,64),
  death:sheet('rato-de-boteco/death.webp',6,64)}};
const bebado:ArtPiece={kind:'animations',files:{idle:sheet('bebado/idle.webp',6),walk:sheet('bebado/walk.webp',8)}};
function useArt(pieces:Record<string,ArtPiece>){setArtIndex(parseArtIndex({version:2,groups:{inimigos:{output:'public/art/enemies',pieces}}}));}

interface Mock {[k:string]:unknown;texture:{key:string};frame:number;scaleX:number;originY:number}
function mockScene(loaded:Set<string>,loading=false){
  const queued:string[]=[];let starts=0;
  const scene={textures:{exists:(k:string)=>loaded.has(k)},add:{image:()=>mockImage(scene)},events:{on(){},off(){}},
    load:{spritesheet:(k:string)=>{queued.push(k);},isLoading:()=>loading,start:()=>{starts++;}},queued,get starts(){return starts;}};
  return scene;
}
function mockImage(scene:object):Mock{
  const m:Mock={texture:{key:'horde:enemy:motoboy'},frame:0,scaleX:1,originY:.92,scene,visible:true,alpha:1,x:0,y:0,depth:0,originX:.5};
  const self=(f:(...a:never[])=>void)=>(...a:never[])=>{f(...a);return m;};
  Object.assign(m,{setTexture:self(((k:string,f?:number)=>{m.texture={key:k};m.frame=f??0;}) as never),setFrame:self(((f:number)=>{m.frame=f;}) as never),
    setOrigin:self(((_:number,y:number)=>{m.originY=y;}) as never),setScale:self(((s:number)=>{m.scaleX=s;}) as never),
    setFlipX:self(()=>{}),setRotation:self(()=>{}),setAlpha:self(()=>{}),setVisible:self(()=>{}),setPosition:self(()=>{}),setDepth:self(()=>{}),once:()=>m});
  return m;
}
const keysOf=(piece:ArtPiece,id:string)=>Object.keys(piece.files).map(f=>`art:enemy:${id}:${f}`);
const roster=(id:string)=>{const e=ENEMY_ROSTER.find(r=>r.id===id);assert.ok(e,id);return e;};

test('art id: a legacy kind keeps its art, a roster id is its own (never its base kind\'s)',()=>{
  assert.equal(enemyArtId('bebado','bebado'),'bebado');assert.equal(enemyArtId('chefe','chefe'),'chefe');
  assert.equal(enemyArtId('grauzeiro',enemyKind('grauzeiro')),'grauzeiro');
  assert.equal(enemyKind('grauzeiro'),'motoboy','a kamikaze draws on the motoboy reserve');
  for(const id of ['grauzeiro','rato-de-boteco','tio-do-isopor','barata-voadora'])assert.equal(roster(id).id,id,'E7 imports roster ids');
});

test('loads: the boot preload lists only the nine kinds; a roster piece loads by its own id',()=>{
  useArt({grauzeiro,'rato-de-boteco':rato,bebado});
  const boot=artLoads().map(l=>l.key);
  assert.ok(boot.includes('art:enemy:bebado:walk'));
  assert.ok(boot.every(k=>!k.includes('grauzeiro')&&!k.includes('rato-de-boteco')),'the roster is not in the preload');
  assert.deepEqual(enemyPieceLoads('grauzeiro').map(l=>[l.key,l.url,l.cell[0]]),[
    ['art:enemy:grauzeiro:idle','/art/lite/enemies/grauzeiro/idle.webp',160],['art:enemy:grauzeiro:aim','/art/lite/enemies/grauzeiro/aim.webp',160],
    ['art:enemy:grauzeiro:charge','/art/lite/enemies/grauzeiro/charge.webp',160],['art:enemy:grauzeiro:crash','/art/lite/enemies/grauzeiro/crash.webp',160]]);
  assert.deepEqual(enemyPieceLoads('pamonheiro'),[],'no piece: nothing');
});

test('queueEnemyArt: once per id and scene, skips what is loaded, starts the loader only when idle',()=>{
  useArt({grauzeiro,'rato-de-boteco':rato});
  const s=mockScene(new Set(['art:enemy:grauzeiro:idle']));
  assert.equal(queueEnemyArt(s as never,'grauzeiro'),true);
  assert.deepEqual(s.queued,['art:enemy:grauzeiro:aim','art:enemy:grauzeiro:charge','art:enemy:grauzeiro:crash']);assert.equal(s.starts,1);
  assert.equal(queueEnemyArt(s as never,'grauzeiro'),false,'asked once');assert.equal(s.starts,1);
  assert.equal(queueEnemyArt(s as never,'pamonheiro'),false,'no piece: no load');
  const busy=mockScene(new Set(),true);
  assert.equal(queueEnemyArt(busy as never,'rato-de-boteco'),true);assert.equal(busy.queued.length,3);assert.equal(busy.starts,0,'joins the running load');
  const other=mockScene(new Set());assert.equal(queueEnemyArt(other as never,'grauzeiro'),true,'another scene asks again');
});

test('applyEnemyArt by roster id: own sheet once loaded, the reserve before and without a piece; the base kind\'s art is never borrowed',()=>{
  useArt({grauzeiro,motoboy:bebado});
  const none=mockScene(new Set()),img=mockImage(none);
  assert.equal(applyEnemyArt(img as never,{kind:'motoboy',art:'grauzeiro',elite:false,phase:0},false,0,0,0),false,'not loaded yet: reserve');
  assert.equal(enemyArtOn(img),false);
  const ready=mockScene(new Set(keysOf(grauzeiro,'grauzeiro'))),art=mockImage(ready);
  assert.ok(applyEnemyArt(art as never,{kind:'motoboy',art:'grauzeiro',elite:false,phase:0},false,0,0,0));
  assert.equal(art.texture.key,'art:enemy:grauzeiro:idle');assert.equal(enemyArtOn(art),true);
  // Size: the kind's reserve height (keys.ts ENEMY_ART), whatever the cell (160 here).
  const base=mockImage(mockScene(new Set(keysOf(bebado,'motoboy'))));
  applyEnemyArt(base as never,{kind:'motoboy',elite:false,phase:0},false,0,0,0);
  assert.ok(Math.abs(art.scaleX*160-base.scaleX*128)<1e-9,'same on-screen height as the motoboy art');
  // A roster id without its own piece stays procedural even though its base kind (motoboy) has art.
  const loaned=mockImage(mockScene(new Set(keysOf(bebado,'motoboy'))));
  assert.equal(applyEnemyArt(loaned as never,{kind:'motoboy',art:'bebum-de-carrinho',elite:false,phase:0},false,0,0,0),false);
});

test('acting pose by role: the suporte lectures, the kamikaze aims, the refletor poses, the invocador summons',()=>{
  const kamikaze=ENEMY_ROSTER.find(r=>r.role==='kamikaze'&&r.id!=='motoboy')!;
  const suporte=ENEMY_ROSTER.find(r=>r.role==='suporte'&&r.id!=='coach')!;
  const refletor=ENEMY_ROSTER.find(r=>r.role==='refletor'&&r.id!=='influencer')!;
  const invocador=ENEMY_ROSTER.find(r=>r.role==='invocador')!;
  assert.equal(actAnim(kamikaze.id,enemyKind(kamikaze.id),PHASE_ACTING),'aim');
  assert.equal(actAnim(suporte.id,enemyKind(suporte.id),PHASE_ACTING),'lecture');
  assert.equal(actAnim(refletor.id,enemyKind(refletor.id),PHASE_ACTING),'pose');
  assert.equal(actAnim(invocador.id,enemyKind(invocador.id),PHASE_ACTING),'summon');
  assert.equal(actAnim('coach','coach',PHASE_ACTING),'lecture');
  assert.equal(actAnim(kamikaze.id,enemyKind(kamikaze.id),PHASE_BUFFED),undefined,'buffed is not acting');
  assert.equal(actAnim(kamikaze.id,enemyKind(kamikaze.id),undefined),undefined);
  assert.equal(actAnim('chefe','chefe',PHASE_ACTING),undefined,'the chefe phase is his boss phase');
  assert.equal(actAnim('bebado','bebado',PHASE_ACTING),undefined);
  // The loop: the acting sheet while it lasts (an elite only with its elite layer); without it, the walk/idle loop.
  assert.equal(loopAnim(grauzeiro,false,false,1,'aim'),'aim');
  assert.equal(loopAnim(grauzeiro,false,true,1,'aim'),undefined,'no elite layer at all');
  assert.equal(loopAnim(grauzeiro,false,false,1,'lecture'),'idle');
  assert.equal(loopAnim(grauzeiro,false,false),'idle');
  useArt({grauzeiro});
  const img=mockImage(mockScene(new Set(keysOf(grauzeiro,'grauzeiro'))));
  applyEnemyArt(img as never,{kind:'motoboy',art:'grauzeiro',act:'aim',elite:false,phase:0},false,0,0,0);assert.equal(img.texture.key,'art:enemy:grauzeiro:aim');
  applyEnemyArt(img as never,{kind:'motoboy',art:'grauzeiro',elite:false,phase:0},false,0,0,10);assert.equal(img.texture.key,'art:enemy:grauzeiro:idle');
});

test('event cues by id: the role\'s animation, or its alias (an enxame\'s poop is its attack)',()=>{
  assert.equal(pieceAction(rato,'attack'),'attack');assert.equal(pieceAction(rato,'poop'),'attack');
  assert.equal(pieceAction(grauzeiro,'charge'),'charge');assert.equal(pieceAction(rato,'charge'),'attack');
  assert.equal(pieceAction(grauzeiro,'hit'),undefined,'no hit sheet: the loop goes on');
  for(const [action,aliases] of Object.entries(ACTION_ALIASES))assert.ok(!aliases.includes(action),action);
  useArt({'rato-de-boteco':rato,grauzeiro});
  const img=mockImage(mockScene(new Set(keysOf(rato,'rato-de-boteco'))));
  assert.ok(playEnemyAction(img,'rato-de-boteco','poop',0));
  applyEnemyArt(img as never,{kind:'pombos',art:'rato-de-boteco',elite:false,phase:0},true,1,0,10);assert.equal(img.texture.key,'art:enemy:rato-de-boteco:attack');
  assert.equal(playEnemyAction(mockImage({}),'grauzeiro','hit',0),false);
  assert.equal(playEnemyAction(mockImage({}),'pamonheiro','attack',0),false,'no piece');
});

test('death by roster id; enemyArtActive with only roster pieces',()=>{
  assert.equal(enemyArtActive(),false);
  useArt({'rato-de-boteco':rato});
  assert.equal(enemyArtActive(),true,'a roster piece alone turns the action cues on');
  const loaded=new Set(keysOf(rato,'rato-de-boteco'));
  assert.ok(hasDeathArt({exists:k=>loaded.has(k)},'rato-de-boteco'));
  assert.equal(hasDeathArt({exists:k=>loaded.has(k)},'pombos'),false,'the base kind has no death sheet');
  assert.equal(hasDeathArt({exists:()=>true},'grauzeiro'),false,'no piece');
  assert.equal(deathDuration('rato-de-boteco')>0,true);assert.equal(deathDuration('grauzeiro'),0);
});

test('size by drawn height (D-037, Orquestrador): the role\'s target over the figure\'s alpha mass, not the cell',()=>{
  assert.equal(HERO_FIGURE_PX,96);
  assert.equal(artTargetHeight('grauzeiro'),96*.9,'kamikaze: the default 0.9× the hero');
  assert.equal(artTargetHeight('rato-de-boteco'),96*.5,'enxame 0.5');
  assert.equal(artTargetHeight('tio-do-isopor'),96*1.3,'brutamontes 1.3');
  const mini=ENEMY_ROSTER.find(r=>r.role==='mini-chefe')!,chefe=ENEMY_ROSTER.find(r=>r.role==='chefe'&&r.id!=='chefe')!;
  assert.equal(artTargetHeight(mini.id),96*2);assert.equal(artTargetHeight(chefe.id),96*3);assert.equal(artTargetHeight('chefe'),96*3);
  // The barata (voador 0.6, Orquestrador): its 39 px figure in its 96 px cell reaches 57.6 world px; the cell does not matter.
  assert.equal(artTargetHeight('barata-voadora'),96*.6);
  assert.ok(Math.abs(39*drawnScale('barata-voadora',39)!-57.6)<1e-9);
  assert.ok(Math.abs(22*drawnScale('rato-de-boteco',22)!-48)<1e-9,'the rat: 22 px drawn, 0.5× the hero');
  assert.ok(Math.abs(drawnScale('grauzeiro',80,true)!/drawnScale('grauzeiro',80)!-1.35)<1e-9,'the elite is bigger like today\'s');
  assert.equal(drawnScale('grauzeiro',undefined),undefined,'not measured: today\'s cell rule');
  assert.equal(drawnScale('grauzeiro',2),undefined,'an empty frame is no measure');
  // topRow: the first row with alpha ≥ 0.5; the rim's faint edge (alpha < 128) does not count.
  const w=4,h=6,cell=new Uint8ClampedArray(w*h*4);
  cell[(1*w+2)*4+3]=100;cell[(3*w+1)*4+3]=200;
  assert.equal(topRow(cell,w,h),3);assert.equal(topRow(cell,w,h,90),1);assert.equal(topRow(new Uint8ClampedArray(w*h*4),w,h),-1);
  assert.equal(MASS_ALPHA,128);
});

test('review fixes: the kamikaze charges while it dashes and dies with its crash; roster shots play the attack; a missing loop sheet tries another; off() keeps the acting texture',()=>{
  // Aiming still, charging on the move (the sim keeps it acting through the dash); without a charge sheet, still the aim.
  assert.equal(loopAnim(grauzeiro,false,false,1,'aim'),'aim');assert.equal(loopAnim(grauzeiro,true,false,1,'aim'),'charge');
  assert.equal(loopAnim({kind:'animations',files:{idle:grauzeiro.files.idle,aim:grauzeiro.files.aim}},true,false,1,'aim'),'aim');
  useArt({grauzeiro,'rato-de-boteco':rato});
  assert.equal(deathAnim(artPieceOf('grauzeiro')),'crash');assert.equal(deathAnim(artPieceOf('rato-de-boteco')),'death');
  const crash=new Set(keysOf(grauzeiro,'grauzeiro'));
  assert.ok(hasDeathArt({exists:k=>crash.has(k)},'grauzeiro'),'the crash is its death');
  assert.ok(deathDuration('grauzeiro')>0);
  // The generic shot of a roster atirador cues the nearest agiota-drawn actor's throw (its piece plays the attack).
  const cue=projectileAction('tiro',true,1,0,{enemy:()=>undefined,nearest:(kind,_x,_y,max)=>kind==='agiota'&&max>=1?{id:'m1',kind:'agiota',nx:0,ny:0}:undefined,telegraph:()=>undefined},{enemy:'',action:'hit'});
  assert.deepEqual(cue&&{...cue},{enemy:'m1',action:'throw'});
  assert.equal(pieceAction({kind:'animations',files:{idle:sheet('m/idle.webp',6),aim:sheet('m/aim.webp',6),attack:sheet('m/attack.webp',6)}},'throw'),'attack');
  // Only the walk loaded (idle still loading): the still enemy shows the walk instead of dropping to the reserve.
  const walkOnly=mockImage(mockScene(new Set(['art:enemy:rato-de-boteco:walk'])));
  useArt({'rato-de-boteco':{kind:'animations',files:{idle:sheet('r/idle.webp',6,64),walk:rato.files.walk}}});
  assert.ok(applyEnemyArt(walkOnly as never,{kind:'pombos',art:'rato-de-boteco',elite:false,phase:0},false,0,0,0));
  assert.equal(walkOnly.texture.key,'art:enemy:rato-de-boteco:walk');
  // The art goes (a manifest without it): the reserve comes back with the renderer's own (acting) texture.
  setArtIndex(parseArtIndex(EMPTY));
  applyEnemyArt(walkOnly as never,{kind:'motoboy',art:'rato-de-boteco',tex:'horde:enemy:motoboy:act',elite:false,phase:0},false,0,0,10);
  assert.equal(walkOnly.texture.key,'horde:enemy:motoboy:act');
});
