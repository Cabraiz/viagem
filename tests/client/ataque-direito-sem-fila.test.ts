// NEW-20261021-ORQ-cone-por-cima-e-clique-em-loop: the right mouse button and Space never leave the attack held after
// they let go (fast clicks attacked forever on the live game), and the desktop shows no yellow reticle nor its line.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {coneDepth,CITY_UNDER,UNDER_SHADOW} from '../../src/client/render/melee-cone.ts';
import {AttackPress} from '../../src/client/hud/attack-aim.ts';

const read=(path:string)=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');

const makeButton=()=>({b:new AttackPress()});
/** Attacks over `steps` input steps (take() once per 50 ms step). */
const attacks=(b:{take():boolean},steps:number)=>{let n=0;for(let i=0;i<steps;i++)if(b.take())n++;return n;};

test('20 fast right clicks then let go: at most one more swing, never a loop',()=>{
  const {b}=makeButton();
  for(let i=0;i<20;i++){b.key('direito',true);b.take();b.key('direito',false);}
  assert.ok(attacks(b,1)<=1,'the last click may still swing once');
  assert.equal(attacks(b,100),0,'then nothing: let go = stop');
});

test('Space and the right button hold the same press: letting go of one keeps it while the other is down',()=>{
  const {b}=makeButton();
  b.key('espaco',true);b.key('direito',true);b.key('direito',false);
  assert.equal(attacks(b,5),5,'Space still holds it');
  b.key('espaco',false);b.take();
  assert.equal(attacks(b,20),0,'both up: stopped');
  // A let-go without its press (a stray keyup) never releases another key's hold, nor holds anything.
  b.key('direito',true);b.key('espaco',false);
  assert.equal(attacks(b,3),3);b.key('direito',false);b.take();assert.equal(attacks(b,10),0);
});

test('a press that wakes the game (pause(false)) stays releasable: the scene lets go only on pause and sets its flag after the hook',()=>{
  // The live loop: rightAttack(true) → attackHold → key(true) → wake → setPaused(false) → rightAttack(false) cleared the
  // flag mid-press, so the per-frame check never let go. Unpausing no longer lets go; the flag is set after the hook.
  const scene=read('src/client/scene.ts');
  assert.match(scene,/setPaused\(paused:boolean\)\{[^\n]*this\.hold\.release\(\);if\(paused\)this\.rightAttack\(false\);/);
  assert.match(scene,/private rightAttack\(down:boolean\)\{if\(this\.rightHeld===down\)return;this\.hooks\.attackHold\?\.\(down\);this\.rightHeld=down;\}/);
  const explore=read('src/client/explore.ts');
  assert.match(explore,/attackBtn\?\.key\(false,'direito'\);else if\(attackBtn\?\.active&&!\$<HTMLButtonElement>\('#coop-attack'\)\.disabled\)attackBtn\.key\(true,'direito'\);/);
  assert.match(explore,/attackBtn\.key\(true,'espaco'\);return;\}/);assert.match(explore,/event\.code==='Space'\)attackBtn\?\.key\(false,'espaco'\);/);
});

test('desktop: no yellow reticle nor line while Space or the right button holds the attack; a finger on the button keeps them',()=>{
  const button=read('src/client/hud/attack-button.ts');
  // Only a press of the button by a finger (or pen) shows the reticle and its line; the keys and the mouse never do.
  assert.match(button,/this\.pointer=e\.pointerId;this\.touchAim=e\.pointerType!=='mouse';/);
  assert.match(button,/if\(!this\.on\|\|!hero\|\|!this\.press\.held\|\|!this\.touchAim\)\{this\.hide\(true\);/);
  assert.match(button,/key\(down:boolean,source='espaco'\)\{\n\s*if\(!this\.on\)return;\n\s*if\(down\)this\.deps\.wake\(\);\n\s*this\.press\.key\(source,down\);/);
  assert.doesNotMatch(button,/touchAim=true/,'never forced on');
});

test('the cone lies under the hero\'s shadow at the depth he is drawn at, in the city and outside it',()=>{
  // City: the actor depths; the shadow is at the hero's depth −2 (scene.ts place), the cone half a unit under it.
  for(const shadow of [10,512.25,-3000])assert.equal(coneDepth(true,-9974,shadow,()=>NaN),shadow-UNDER_SHADOW);
  // Outside: the ground layer, or under a shadow that sits lower than it.
  assert.equal(coneDepth(false,-9974,500,()=>NaN),-9974);assert.equal(coneDepth(false,-9974,-20000,()=>NaN),-20000-UNDER_SHADOW);
  // No shadow given (sandboxes): the old rule, now under the shadow too.
  assert.equal(coneDepth(true,-9974,undefined,()=>100),100-CITY_UNDER);assert.ok(CITY_UNDER>2,'under the shadow at −2');
  // The scene draws it every coop frame right after place(), from the drawn hero and his shadow's depth.
  const scene=read('src/client/scene.ts');
  assert.match(scene,/this\.place\(\);\n\s*this\.horde\?\.selfCone\(this\.position,this\.shadow\.depth\);/);
  assert.match(scene,/coneFromScene:true,/);
  assert.match(read('src/client/scene.ts'),/this\.shadow\.setPosition\(p\.x,p\.y\)\.setDepth\(depth-2\);/,'the shadow rule the cone counts on');
});
