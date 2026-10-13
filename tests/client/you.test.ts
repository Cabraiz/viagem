import test from 'node:test';
import assert from 'node:assert/strict';
import {ARROW_BOB_MS,ARROW_MS,HP_LINGER_MS,RING_CSS,RING_SCALE,RING_UNDER,ringSize,arrowFrame,arrowTrigger,beakPoints,canopyCovers,facingFrom,hpBarStep,hurtStrength,ringBands} from '../../src/client/render/you-rules.ts';
import {HURT_MIN_GAP_MS,canFlash,hitsOn} from '../../src/client/hud/hurt.ts';
import {CAUSE_COPY,emptyCauses,recordFall,rememberKill,resolveCause,resultCause,topCause,KILL_MEMORY} from '../../src/client/hud/cause.ts';
import {applyEvents,emptyTally,reviveBanner} from '../../src/client/hud/model.ts';
import type {RunView} from '../../src/contract/view.ts';

test('health bar: shown below full, lingers 2 s once full again, hidden when downed',()=>{
  let s=hpBarStep(.5,undefined,1000);assert.equal(s.visible,true);
  s=hpBarStep(1,s.fullSince,2000);assert.equal(s.visible,true);assert.equal(s.fullSince,2000);
  s=hpBarStep(1,s.fullSince,2000+HP_LINGER_MS-1);assert.equal(s.visible,true);
  s=hpBarStep(1,s.fullSince,2000+HP_LINGER_MS);assert.equal(s.visible,false);
  assert.equal(hpBarStep(.2,undefined,0,true).visible,false);
});

test('"Você" arrow: 2 s, one bob (not with reduced motion); rounds and own revive bring it back',()=>{
  assert.equal(arrowFrame(0,false).visible,true);assert.equal(arrowFrame(ARROW_MS,false).visible,false);assert.equal(arrowFrame(-1,false).visible,false);
  assert.ok(arrowFrame(ARROW_BOB_MS/2,false).bob>.99);assert.equal(arrowFrame(ARROW_BOB_MS/2,true).bob,0);
  assert.equal(arrowFrame(ARROW_BOB_MS,false).bob,0);assert.equal(arrowFrame(ARROW_MS-1,false).bob,0);
  assert.equal(arrowTrigger([{type:'round',phase:'wave'}],'me'),true);
  assert.equal(arrowTrigger([{type:'round',phase:'prepare'},{type:'revived',player:'zé'}],'me'),false);
  assert.equal(arrowTrigger([{type:'revived',player:'me'}],'me'),true);
});

test('hurt flash strength grows with the share of max hp lost; hits are summed per view and read once',()=>{
  assert.equal(hurtStrength(0,100),0);assert.equal(hurtStrength(2,100),.35);assert.equal(hurtStrength(25,100),1);assert.ok(Math.abs(hurtStrength(15,100)-.6)<1e-9);
  const view={events:[{type:'damage',target:'me',amount:3,eventId:5},{type:'damage',target:'zé',amount:9,eventId:6},{type:'damage',target:'me',amount:4,eventId:7}]} as unknown as RunView;
  assert.deepEqual(hitsOn(view,'me',-1),{amount:7,last:7});
  assert.deepEqual(hitsOn(view,'me',6),{amount:4,last:7});
  assert.deepEqual(hitsOn(view,'me',7),{amount:0,last:7});
  // Never more than 3 flashes a second under a stream of hits.
  assert.equal(canFlash(0,-Infinity),true);assert.equal(canFlash(HURT_MIN_GAP_MS-1,0),false);assert.equal(canFlash(HURT_MIN_GAP_MS,0),true);
  assert.ok(1000/HURT_MIN_GAP_MS<=3);
});

test('canopy covers a hero only when the tree is in front, close and tall enough',()=>{
  const tree={x:100,y:140,halfWidth:40,height:120,front:true};
  assert.equal(canopyCovers({x:110,y:100},tree),true);
  assert.equal(canopyCovers({x:110,y:100},{...tree,front:false}),false);
  assert.equal(canopyCovers({x:150,y:100},tree),false);
  assert.equal(canopyCovers({x:110,y:150},tree),false);
  assert.equal(canopyCovers({x:110,y:10},tree),false);
});

const viewOf=(events:unknown[],enemies:unknown[]=[])=>({tick:1,team:{xp:0,level:1,nextXp:5},enemies,pickups:[],projectiles:[],telegraphs:[],structures:[],players:[],offers:[],events}) as unknown as RunView;

test('fall causes: source first, then the live hitter, then a hitter killed on the same tick; unknown is "bichos"',()=>{
  const log=emptyCauses();
  assert.equal(resolveCause({source:'agiota',by:'e1'},viewOf([]),log),'agiota');
  assert.equal(resolveCause({by:'e1'},viewOf([],[{id:'e1',kind:'bebado'}]),log),'bebado');
  rememberKill(log,'e2','tio-pave');assert.equal(resolveCause({by:'e2'},viewOf([]),log),'tio-pave');
  assert.equal(resolveCause({by:'e9'},viewOf([]),log),'bichos');
  for(let i=0;i<KILL_MEMORY+5;i++)rememberKill(log,`k${i}`,'bebado');
  assert.equal(log.kills.size,KILL_MEMORY);assert.equal(log.kills.has('e2'),false);
  // The kill that comes after the fall in the same view still names it.
  const tally=emptyTally();
  applyEvents(tally,viewOf([{type:'downed',player:'me',by:'e5',eventId:1},{type:'kill',enemy:'e5',kind:'pombos',x:0,y:0,eventId:2}]));
  assert.equal(tally.causes.last.get('me'),'pombos');
  applyEvents(tally,viewOf([{type:'downed',player:'zé',by:'b1',source:'chefe',eventId:3}]));
  assert.equal(tally.causes.last.get('zé'),'chefe');
  // An agiota seen in an earlier view, gone when its shot downs someone: still named.
  applyEvents(tally,viewOf([],[{id:'f9',kind:'agiota'}]));
  applyEvents(tally,viewOf([{type:'downed',player:'bia',by:'f9',eventId:4}]));
  assert.equal(tally.causes.last.get('bia'),'agiota');
});

test('result names what downed you, else the team; the own-fall banner carries the joke line',()=>{
  const log=emptyCauses();
  assert.equal(resultCause(log,'me'),undefined);
  recordFall(log,'zé','bebado');recordFall(log,'bia','bebado');recordFall(log,'bia','agiota');
  assert.deepEqual(resultCause(log,'me'),{kind:'bebado',text:'Derrubou a turma: Bêbado do Boteco 2×'});
  recordFall(log,'me','agiota');
  assert.deepEqual(resultCause(log,'me'),{kind:'agiota',text:'Te derrubou: Agiota do Bairro'});
  recordFall(log,'me','bebado');
  assert.equal(topCause(log,'me')?.kind,'bebado');
  const view={...viewOf([]),tick:0,players:[{id:'me',name:'Eu',classId:'x',hp:0,maxHp:100,online:true,spectator:false,downed:{progress:0,bleedOutTick:600},weapons:[],passives:[]}]} as RunView;
  const banner=reviveBanner(view,'me',undefined,log)!;
  assert.equal(banner.kind,'self');assert.deepEqual(banner.cause,{kind:'bebado',...CAUSE_COPY.bebado});
  assert.equal(reviveBanner(view,'me')!.cause,undefined);
  for(const copy of Object.values(CAUSE_COPY)){assert.ok(copy.line.length<=40,copy.line);assert.doesNotMatch(copy.line,/[A-ZÀ-Ú]{2}/);}
});

test('"você" ring: hard bands Papel outside, Lilás body, Breu inside; beak points where the hero faces',()=>{
  const b=ringBands(),edges=(band:{width:number;offset:number})=>[band.offset-band.width/2,band.offset+band.width/2];
  const total=RING_CSS.papel+RING_CSS.voce+RING_CSS.breu;
  assert.deepEqual(edges(b.papel),[-total/2,total/2]);
  assert.deepEqual(edges(b.voce),[total/2-RING_CSS.papel-RING_CSS.voce,total/2-RING_CSS.papel]);
  assert.deepEqual(edges(b.breu),[-total/2,-total/2+RING_CSS.breu]);
  // Facing right: the tip is to the right of the ellipse's right edge; facing down, below the bottom edge.
  const right=beakPoints(0,0,20,9,0,8,5);assert.ok(Math.abs(right[2].x-28)<1e-9&&Math.abs(right[2].y)<1e-9);
  const down=beakPoints(0,0,20,9,Math.PI/2,8,5);assert.ok(Math.abs(down[2].y-17)<1e-9);
  assert.equal(facingFrom(0,0,1.5),1.5);assert.equal(facingFrom(3,0,1.5),0);assert.ok(Math.abs(facingFrom(0,-3,0)+Math.PI/2)<1e-9);
});

test('ring (BUG-20261013-ORQ-anel-voce-atras): 30 % smaller than before, under the sprite on top and over its shadow',()=>{
  assert.equal(RING_SCALE,.7);
  for(const s of [.5,1,1.6])for(const fig of [20,60,140]){
    const old=Math.max(RING_CSS.width*s,fig*.8),{w,h}=ringSize(fig,s);
    assert.ok(Math.abs(w-old*.7)<1e-9,'width ×0.7');
    assert.ok(Math.abs(h-Math.max(RING_CSS.height*s,old*.5)*.7)<1e-9,'height ×0.7');
  }
  // Under the sticker contour (−0.2, −0.1 under the sprite) and above the contact shadow (−1).
  assert.ok(RING_UNDER>.2&&RING_UNDER<1);
});
