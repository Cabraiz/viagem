/**
 * Card NEW-20261028-ORQ-levelup-estouro-e-tremida (auditoria som-impacto 28/10, items 8 and 5): the level-up burst (a ring
 * of light and a short confetti on the hero, ≤ 400 ms, before the offer opens; the ring alone and still with reduced
 * motion) and the camera shake on a hit above 10 % of the local player's max hp (2 px / 120 ms, the towers' shakeAt
 * rule, none with reduced motion). The pure rules, and the wiring read from the source (node cannot load Phaser).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CONFETTI_N,HURT_SHAKE,HURT_SHAKE_SHARE,LEVELUP_BURST_MS,LEVELUP_DEPTH,RING_FROM,RING_STILL,RING_TO,burstFrame,hurtOn,hurtShakes} from '../../src/client/render/levelup-fx-rules.ts';
import {shakeAt,shakeOffset} from '../../src/client/render/towers/tower-rules.ts';
import type {RunView} from '../../src/contract/index.ts';

const COLORS=[1,2,3];
const read=(f:string)=>readFileSync(f,'utf8');

test('the burst lasts at most 400 ms: the ring grows out and fades, the confetti flies and fades',()=>{
  assert.ok(LEVELUP_BURST_MS<=400);
  const start=burstFrame(0,false,COLORS),mid=burstFrame(200,false,COLORS),late=burstFrame(390,false,COLORS);
  assert.equal(start.ring.radius,RING_FROM);
  assert.ok(mid.ring.radius>start.ring.radius&&late.ring.radius>mid.ring.radius&&late.ring.radius<=RING_TO);
  assert.ok(start.ring.alpha===1&&late.ring.alpha<mid.ring.alpha&&late.ring.alpha>0);
  assert.equal(mid.confetti.length,CONFETTI_N);
  assert.equal(mid.confettiAlpha,1);
  assert.ok(late.confettiAlpha<.2);
  // The pieces leave the centre in every direction of the upper fan, and use the given colours.
  const far=mid.confetti.map(c=>Math.hypot(c.x,c.y));
  assert.ok(Math.min(...far)>.1);
  assert.ok(mid.confetti.some(c=>c.x<0)&&mid.confetti.some(c=>c.x>0)&&mid.confetti.some(c=>c.y<0));
  assert.deepEqual([...new Set(mid.confetti.map(c=>c.color))].sort(),COLORS);
  // Deterministic: the same burst on every phone.
  assert.deepEqual(burstFrame(200,false,COLORS),mid);
  for(const ms of [-1,LEVELUP_BURST_MS,LEVELUP_BURST_MS+50,Number.NaN]){
    const none=burstFrame(ms,false,COLORS);
    assert.equal(none.ring.alpha,0);assert.equal(none.confetti.length,0);
  }
});

test('reduced motion: only the ring, still, for the same 400 ms; no confetti',()=>{
  const a=burstFrame(0,true,COLORS),b=burstFrame(300,true,COLORS);
  assert.deepEqual(a,b);
  assert.equal(a.ring.radius,RING_STILL);
  assert.ok(a.ring.alpha>0);
  assert.equal(a.confetti.length,0);
  assert.equal(burstFrame(LEVELUP_BURST_MS,true,COLORS).ring.alpha,0);
});

const view=(events:unknown[],players=[{id:'me',maxHp:100}]):RunView=>({events,players} as unknown as RunView);
const dmg=(eventId:number,target:string,amount:number)=>({eventId,type:'damage',target,amount});

test('hurt shake: only hits on the local player, summed per view, above 10 % of max hp; never with reduced motion',()=>{
  assert.equal(HURT_SHAKE_SHARE,.1);
  const v=view([dmg(1,'me',6),dmg(2,'ana',50),dmg(3,'me',5),{eventId:4,type:'levelup',level:3}]);
  const hurt=hurtOn(v,'me',-1);
  assert.deepEqual(hurt,{amount:11,last:4});
  assert.equal(hurtShakes(hurt.amount,100,false),true);
  assert.equal(hurtShakes(hurt.amount,100,true),false);
  assert.equal(hurtShakes(10,100,false),false,'exactly 10 % does not shake');
  assert.equal(hurtShakes(5,0,false),false);
  // Events already read never count twice.
  assert.deepEqual(hurtOn(v,'me',4),{amount:0,last:4});
  assert.deepEqual(hurtOn(v,'me',1),{amount:5,last:4});
});

test('hurt shake uses the towers\' rule at 2 px over 120 ms (none with reduced motion)',()=>{
  assert.deepEqual({...HURT_SHAKE},{shake:2,shakeMs:120});
  assert.equal(shakeAt(HURT_SHAKE,0,false),2);
  assert.ok(shakeAt(HURT_SHAKE,60,false)>0&&shakeAt(HURT_SHAKE,60,false)<2);
  assert.equal(shakeAt(HURT_SHAKE,120,false),0);
  assert.equal(shakeAt(HURT_SHAKE,0,true),0);
  for(let ms=0;ms<120;ms+=7){const o=shakeOffset(shakeAt(HURT_SHAKE,ms,false),ms);assert.ok(Math.abs(o.x)<=2&&Math.abs(o.y)<=1.2);}
});

test('wiring: zueira-fx plays the burst on levelup and shakes on a hurting hit; no layers.ts, no audio',()=>{
  const fx=read('src/client/render/zueira-fx.ts');
  assert.match(fx,/e\.type==='levelup'\)this\.levelUp\(e\.level\)/);
  assert.match(fx,/hurtShakes\(hurt\.amount,me\.maxHp,this\.options\.reduced\)/);
  assert.match(fx,/shakeAt\(HURT_SHAKE,ms,this\.options\.reduced\)/);
  assert.match(fx,/setDepth\(LEVELUP_DEPTH\)/);
  assert.doesNotMatch(fx,/from '\.\/layers\.ts'|from '\.\.\/audio\//);
  // Above the hero's mark (you.ts SELF_DEPTH), under its balloon (layers.ts HERO_BALLOON_DEPTH).
  const depth=(f:string,n:string)=>Number(new RegExp(`${n}=(\\d+)`).exec(read(f))![1]);
  assert.ok(LEVELUP_DEPTH>depth('src/client/render/you.ts','SELF_DEPTH')&&LEVELUP_DEPTH<depth('src/client/render/layers.ts','HERO_BALLOON_DEPTH'));
});

test('wiring: the scene adds the hurt shake after centring and starts the burst when the pause opens',()=>{
  const scene=read('src/client/scene.ts');
  assert.match(scene,/for\(const source of \[this\.towers,this\.zueira\]\)/);
  assert.match(scene,/if\(net\.run\?\.pause\)this\.zueira\?\.levelUp\(net\.run\.pause\.level\)/);
  assert.match(scene,/localId:\(\)=>this\.hooks\.net\?\.id/);
});

test('wiring: the HUD holds the pause\'s screen (veil, title, offer) for the burst, and lets go when the pause ends',()=>{
  const hud=read('src/client/hud/hud.ts');
  assert.match(hud,/if\(!was&&pause\)this\.holdOffer\(\);else if\(!pause\)this\.releaseOffer\(\);/);
  assert.match(hud,/setTimeout\(\(\)=>this\.releaseOffer\(\),LEVELUP_BURST_MS\)/);
  assert.match(hud,/this\.pauseScreen=\[pausa\.dim,pausa\.el,offer\.el\]/);
  assert.match(hud,/for\(const el of this\.pauseScreen\)el\.style\.visibility='hidden'/);
  assert.match(hud,/for\(const el of this\.pauseScreen\)el\.style\.removeProperty\('visibility'\)/);
});
