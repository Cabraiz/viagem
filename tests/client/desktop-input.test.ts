// NEW-20261013-ORQ-controles-desktop (D-044): WASD, the arrows or the mouse on the desktop; the phone keeps the joystick.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HOLD_MIN_MOVE,HOLD_RETARGET_MS,HoldFollow,INPUT_TEXTS,InputKindWatch,MARKER_MS,MOVE_KEYS,finePointer,focusLost,hotkeyFor,hotkeyOf,keyVector,mapButtonDown,markerVisible,turnFor} from '../../src/client/desktop-input.ts';
import {JoystickInput} from '../../src/client/joystick.ts';
import {screenDirection} from '../../src/client/projection.ts';
import {quantizeDirection} from '../../src/protocol/input-track.ts';

const read=(path:string)=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');
type Held={up?:boolean;down?:boolean;left?:boolean;right?:boolean};
/** The 8 key combos and their screen direction (+x right, +y down). */
const EIGHT:[Held,number,number][]=[
  [{up:true},0,-1],[{down:true},0,1],[{left:true},-1,0],[{right:true},1,0],
  [{up:true,right:true},1,-1],[{up:true,left:true},-1,-1],[{down:true,right:true},1,1],[{down:true,left:true},-1,1],
];

test('keyVector: eight unit directions in the stick\'s screen frame',()=>{
  for(const [held,x,y] of EIGHT){
    const v=keyVector(held),length=Math.hypot(x,y);
    assert.ok(Math.abs(v.sx-x/length)<1e-9&&Math.abs(v.sy-y/length)<1e-9,`${JSON.stringify(held)} → ${JSON.stringify(v)}`);
    assert.ok(Math.abs(Math.hypot(v.sx,v.sy)-1)<1e-9,'unit length: a diagonal is no faster');
  }
  assert.deepEqual(keyVector({}),{sx:0,sy:0});
});
test('keyVector: opposite keys cancel (alone or under a third key)',()=>{
  assert.deepEqual(keyVector({up:true,down:true}),{sx:0,sy:0});
  assert.deepEqual(keyVector({left:true,right:true}),{sx:0,sy:0});
  assert.deepEqual(keyVector({up:true,down:true,left:true,right:true}),{sx:0,sy:0});
  assert.deepEqual(keyVector({up:true,down:true,right:true}),{sx:1,sy:0});
  assert.deepEqual(keyVector({left:true,right:true,down:true}),{sx:0,sy:1});
});
test('keys and the stick: the same screen direction lands in the same input-10hz bucket in all four views',()=>{
  for(let view=0;view<4;view++)for(const [held,x,y] of EIGHT){
    const keys=keyVector(held);
    // The stick pushed all the way the same way on screen (joystick.ts: 40 px against a 30 px radius).
    const stick=new JoystickInput();stick.start(1);stick.move(1,x*40,y*40,30);
    const fromKeys=quantizeDirection(screenDirection(keys.sx,keys.sy,view)),fromStick=quantizeDirection(screenDirection(stick.x,stick.y,view));
    assert.ok(fromKeys>=0,`view ${view} ${JSON.stringify(held)} moves`);
    assert.equal(fromKeys,fromStick,`view ${view} ${JSON.stringify(held)}`);
  }
  // The four views turn "up" (W) a quarter each: four different buckets.
  const ups=new Set([0,1,2,3].map(view=>quantizeDirection(screenDirection(0,-1,view))));
  assert.equal(ups.size,4);
});
test('movement keys: W,A,S,D and the arrows, as Phaser reads them in scene.ts',()=>{
  assert.deepEqual(MOVE_KEYS,{up:['KeyW','ArrowUp'],down:['KeyS','ArrowDown'],left:['KeyA','ArrowLeft'],right:['KeyD','ArrowRight']});
  const scene=read('src/client/scene.ts');
  assert.match(scene,/createCursorKeys\(\)/);assert.match(scene,/addKeys\('W,A,S,D'\)/);
  // One key reading for solo and room (no copy of the old sums left behind).
  assert.equal((scene.match(/this\.keyAxis\(\)/g)??[]).length,2);
  assert.doesNotMatch(scene,/Number\(!!\(this\.cursors/);
});

test('Q/E turn the camera like its buttons (Q: data-turn -1, left; E: 1, right); Space the skill, T the emotes',()=>{
  assert.equal(turnFor('q'),-1);assert.equal(turnFor('e'),1);assert.equal(turnFor('Q'),-1,'Shift or Caps Lock');assert.equal(turnFor('E'),1);
  for(const key of ['w',' ','t','r','Escape','KeyQ'])assert.equal(turnFor(key),undefined,key);
  assert.deepEqual(hotkeyOf({code:'KeyQ',key:'q'},false),{kind:'turn',turn:-1});
  assert.deepEqual(hotkeyOf({code:'KeyE',key:'e'},false),{kind:'turn',turn:1});
  assert.deepEqual(hotkeyOf({code:'Space',key:' '},false),{kind:'skill'});
  assert.deepEqual(hotkeyOf({code:'KeyT',key:'t'},false),{kind:'emote'});
  for(const [code,key] of [['KeyW','w'],['ArrowUp','ArrowUp'],['Escape','Escape'],['Enter','Enter'],['Tab','Tab']])
    assert.equal(hotkeyOf({code,key},false),undefined,`${code} is not a hotkey`);
  // The markup the hotkeys press: the left button is -1.
  assert.match(read('src/client/explore.ts'),/<button data-turn="-1" aria-label="Girar câmera para a esquerda"/);
});
test('Q/E/T go by the layout\'s letter like Phaser\'s W,A,S,D; Space by its code',()=>{
  // AZERTY: the "A" key sits where QWERTY has Q (code KeyQ): it walks (Phaser reads the letter A) and never turns.
  assert.equal(hotkeyFor('KeyQ','a'),undefined);assert.equal(hotkeyOf({code:'KeyQ',key:'a'},false),undefined);
  // …and its "Q" (code KeyA) turns left; Dvorak's E and T wherever they sit.
  assert.deepEqual(hotkeyFor('KeyA','q'),{kind:'turn',turn:-1});
  assert.deepEqual(hotkeyFor('KeyD','e'),{kind:'turn',turn:1});assert.deepEqual(hotkeyFor('KeyK','t'),{kind:'emote'});
  // Space is the place, whatever the layout writes; a code alone (no letter) never makes a letter hotkey.
  assert.deepEqual(hotkeyFor('Space',' '),{kind:'skill'});
  for(const code of ['KeyQ','KeyE','KeyT'])assert.equal(hotkeyFor(code),undefined,code);
  // The wiring passes the letter.
  const explore=read('src/client/explore.ts');
  assert.match(explore,/inputWatch\.key\(event\.code,event\.key\)/);assert.match(explore,/hotkeyOf\(event,settings\.open\)/);
});
test('hotkeys stay with the page: settings open, a modifier, typing in a field',()=>{
  for(const [code,key] of [['KeyQ','q'],['KeyE','e'],['Space',' '],['KeyT','t']]){
    assert.equal(hotkeyOf({code,key},true),undefined,`${code} with the settings open`);
    for(const mod of ['ctrlKey','altKey','metaKey'])assert.equal(hotkeyOf({code,key,[mod]:true},false),undefined,`${mod}+${code}`);
    for(const tagName of ['INPUT','textarea','SELECT'])assert.equal(hotkeyOf({code,key,target:{tagName}},false),undefined,`${code} in ${tagName}`);
    assert.equal(hotkeyOf({code,key,target:{tagName:'DIV',isContentEditable:true}},false),undefined);
    // A focused button keeps no key: Phaser captures Space, so the browser would never press it (Space dead after a
    // click on the emote toggle).
    assert.ok(hotkeyOf({code,key,target:{tagName:'BUTTON'}},false),`${code} on a focused button`);
  }
});
test('Space on a focused skill button casts once: the keydown casts, the keyup\'s press is prevented',()=>{
  const explore=read('src/client/explore.ts');
  assert.match(explore,/if\(hotkey\.kind==='skill'\)event\.preventDefault\(\);/);
  assert.match(explore,/document\.addEventListener\('keyup',event=>\{if\(!closed&&hotkeyOf\(event,settings\.open\)\?\.kind==='skill'\)event\.preventDefault\(\);\},\{signal\}\)/);
  // The skill button's own keyboard click (detail 0) is the only other way in, and a prevented keyup never fires it.
  assert.match(explore,/attack\.addEventListener\('click',e=>\{if\(e\.detail===0&&!attack\.disabled\)tapSkill\(\);\}\)/);
  // Phaser captures Space too (createCursorKeys adds space and shift to its captures).
  assert.match(read('src/client/scene.ts'),/this\.cursors=this\.input\.keyboard\?\.createCursorKeys\(\);/);
});

test('detection: a fine pointer starts as mouse, a coarse one as touch; never the user agent',()=>{
  assert.equal(new InputKindWatch(true).kind,'mouse');assert.equal(new InputKindWatch(false).kind,'touch');
  assert.equal(finePointer(q=>({matches:q==='(pointer:fine)'})),true);
  assert.equal(finePointer(()=>({matches:false})),false);
  assert.equal(finePointer(undefined),false);
  assert.equal(finePointer(()=>{throw new Error('no media');}),false);
  const source=read('src/client/desktop-input.ts')+read('src/client/explore.ts');
  assert.doesNotMatch(source.replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm,''),/userAgent|navigator\.platform|maxTouchPoints/);
});
test('detection: the first mouse event or game key turns a touch start into mouse; a finger turns it back',()=>{
  const watch=new InputKindWatch(false);
  assert.equal(watch.pointer('touch',false),false);assert.equal(watch.pointer('pen',true),false);assert.equal(watch.kind,'touch');
  assert.equal(watch.key('KeyZ'),false,'not a game key');assert.equal(watch.key('Unidentified','Unidentified'),false);assert.equal(watch.kind,'touch');
  assert.equal(watch.pointer('mouse',false),true,'a real mouse move');assert.equal(watch.kind,'mouse');
  assert.equal(watch.pointer('mouse',true),false,'already mouse');
  assert.equal(watch.pointer('touch',false),false,'a touch move alone does not switch');assert.equal(watch.kind,'mouse');
  assert.equal(watch.pointer('touch',true),true,'a touch pointerdown switches back');assert.equal(watch.kind,'touch');
  for(const [code,key] of [['KeyW','w'],['ArrowLeft','ArrowLeft'],['KeyQ','q'],['KeyE','e'],['Space',' '],['KeyT','t'],['KeyZ','w'],['KeyQ','a']]){
    const w=new InputKindWatch(false);assert.equal(w.key(code,key),true,`${code} ${key}`);assert.equal(w.kind,'mouse');
  }
});

test('focus lost: the phone pauses as before; the desktop never pauses and lets go of everything',()=>{
  const calls:string[]=[];
  const actions={pause:()=>calls.push('pause'),release:()=>calls.push('release')};
  focusLost('touch',actions);assert.deepEqual(calls,['pause']);
  calls.length=0;focusLost('mouse',actions);assert.deepEqual(calls,['release']);
  // The wiring: blur and a hidden tab go through focusLost; release resets the stick and the scene's held input.
  const explore=read('src/client/explore.ts');
  assert.match(explore,/focusLost\(inputWatch\.kind,\{pause:\(\)=>pause\(true\),release:\(\)=>\{reset\(\);controller\?\.scene\.releaseInput\(\);\}\}\)/);
  assert.match(explore,/document\.addEventListener\('visibilitychange',\(\)=>\{if\(document\.hidden\)lost\(\);\}/);
  assert.match(explore,/window\.addEventListener\('blur',lost,/);
  assert.doesNotMatch(explore,/addEventListener\('blur',\(\)=>pause\(true\)/,'no unconditional pause on blur');
  // The settings window still pauses (both kinds).
  assert.match(explore,/const openSettings=\(\)=>\{pause\(true\);/);
  const scene=read('src/client/scene.ts');
  assert.match(scene,/releaseInput\(\)\{this\.hold\.release\(\);this\.input\.keyboard\?\.resetKeys\(\);\}/);
});
test('focus lost on the desktop: the real release lets go of the stick, its capture, the keys and the mouse hold',()=>{
  const explore=read('src/client/explore.ts'),scene=read('src/client/scene.ts');
  // explore.ts reset(): the stick's finger, its knob, its drag look and its pointer capture.
  const reset=explore.match(/const reset=\(\)=>\{([^\n]*)\};\n/)?.[1]??'';
  for(const part of ['direction.reset()',"knob.style.transform=''","stick.classList.remove('is-dragging')",'stick.releasePointerCapture(pointer)'])
    assert.ok(reset.includes(part),`reset() lacks ${part}`);
  // The release handed to focusLost is that reset plus the scene's releaseInput (Phaser's keys, the hold).
  assert.match(explore,/release:\(\)=>\{reset\(\);controller\?\.scene\.releaseInput\(\);\}/);
  const release=scene.match(/releaseInput\(\)\{([^\n]*)\}\n/)?.[1]??'';
  assert.ok(release.includes('this.hold.release()')&&release.includes('this.input.keyboard?.resetKeys()'),release);
  // The hold also ends when the button is no longer down (a mouseup lost outside the window): followHold checks it.
  assert.match(scene,/if\(this\.paused\|\|!pointer\|\|!mapButtonDown\(pointer\)\)\{\n\s*const last=this\.hold\.release\(\);/);
  // And the release really ends the hold: no target comes back after it.
  const hold=new HoldFollow();hold.press({x:1,y:1},0);hold.release();
  assert.equal(hold.held,false);assert.equal(hold.move({x:9,y:9},10_000),undefined);
});
test('explore: the HUD measures its zones again when the joystick comes or goes',()=>{
  const explore=read('src/client/explore.ts');
  const sync=explore.match(/const syncInput=\(\)=>\{[\s\S]*?\n {2}\};\n/)?.[0]??'';
  assert.ok(sync.indexOf('shell.dataset.input=kind')>=0&&sync.indexOf('shell.dataset.input=kind')<sync.indexOf('hud?.layoutChanged()'),'layoutChanged after the switch');
  assert.match(sync,/if\(shell\.dataset\.input===kind\)return;/,'only on a change');
});

test('hold-follow: at most one new target every 150 ms, and only past 0.3 u of change',()=>{
  assert.equal(HOLD_RETARGET_MS,150);assert.equal(HOLD_MIN_MOVE,.3);
  const hold=new HoldFollow();
  assert.equal(hold.move({x:5,y:5},0),undefined,'not held');
  hold.press({x:0,y:0},1000);assert.equal(hold.held,true);
  assert.equal(hold.move({x:3,y:0},1100),undefined,'too soon after the press');
  assert.deepEqual(hold.move({x:3,y:0},1150),{x:3,y:0});
  assert.equal(hold.move({x:6,y:0},1200),undefined,'50 ms after the last target');
  assert.equal(hold.move({x:3.2,y:0},1400),undefined,'0.2 u is no new target');
  assert.deepEqual(hold.move({x:3.3,y:0.1},1400),{x:3.3,y:.1});
  // A frame-by-frame drag for 1 s: about 1000/150 targets, never two within 150 ms.
  const times:number[]=[];
  for(let t=2000;t<=3000;t+=16){if(hold.move({x:t/100,y:0},t))times.push(t);}
  assert.ok(times.length>=6&&times.length<=7,`${times.length} targets`);
  for(let i=1;i<times.length;i++)assert.ok(times[i]-times[i-1]>=HOLD_RETARGET_MS);
  assert.deepEqual(hold.release(),{x:times.at(-1)!/100,y:0},'the release hands back the last target');
  assert.equal(hold.held,false);assert.equal(hold.release(),undefined);
});
test('marker: a tap keeps it to the end of the walk; a click shows it ~600 ms',()=>{
  assert.equal(MARKER_MS,600);
  assert.equal(markerVisible(undefined,1e9),true);
  assert.equal(markerVisible(1000+MARKER_MS,1000),true);assert.equal(markerVisible(1000+MARKER_MS,1599),true);
  assert.equal(markerVisible(1000+MARKER_MS,1600),false);
});
test('scene: a press on the canvas ground starts the hold, an enemy is still a target, the follow is silent',()=>{
  const scene=read('src/client/scene.ts');
  const down=scene.match(/this\.input\.on\('pointerdown',[\s\S]*?\n {4}\}\);/)?.[0]??'';
  assert.ok(down.indexOf('enemyAt(p)')<down.indexOf('this.hold.press'),'the enemy check comes first');
  assert.match(down,/if\(hit\)\{this\.attackTarget=hit;[^}]*return;\}/);
  assert.match(down,/mouse=!pointer\.wasTouch/);assert.match(down,/this\.goTo\(target,mouse\?\{markerMs:MARKER_MS\}:undefined\)/);
  // The follow re-targets with findPath, without the message and without redrawing the marker.
  const follow=scene.match(/private followHold\([\s\S]*?\n {2}\}\n/)?.[0]??'';
  assert.ok(follow.length>0);assert.match(follow,/findPath\(this\.position,next,this\.field\)/);
  const holding=follow.slice(follow.indexOf('if(steering)return;'));
  assert.doesNotMatch(holding,/hooks\.message|drawDestination/);
  // Keys and the stick win (the follow waits), pause or a paused scene lets go.
  assert.match(scene,/this\.followHold\(_time,Math\.hypot\(sx,sy\)>\.05\)/);
  assert.match(scene,/this\.followHold\(time,still\|\|Math\.hypot\(sx,sy\)>\.05\)/);
  assert.match(scene,/setPaused\(paused:boolean\)\{[^\n]*this\.hold\.release\(\);/);
  // The input still leaves through net.input (input-10hz); D-051: the attack button rides it as the 4th argument, the
  // mouse's aim (cone-ataque-melee) as the 5th.
  assert.match(scene,/net\.input\(direction,false,this\.attackTarget,!frozen&&!!this\.hooks\.attacking\?\.\(\),aim\)/);
  assert.match(scene,/const frozen=this\.paused\|\|!!net\.run\?\.pause;/,'D-050: the level-up pause holds the controls too');
});

test('right button on the map: works like the left one, the middle does nothing, the canvas menu stays shut',()=>{
  // Phaser's Pointer: primaryDown is the left button or a finger; rightButtonDown() reads buttons bit 2 (middle is bit 4).
  const ptr=(primaryDown:boolean,buttons:number)=>({primaryDown,rightButtonDown:()=>(buttons&2)!==0});
  assert.equal(mapButtonDown(ptr(true,1)),true,'left');assert.equal(mapButtonDown(ptr(true,0)),true,'finger');
  assert.equal(mapButtonDown(ptr(false,2)),true,'right');assert.equal(mapButtonDown(ptr(false,4)),false,'middle');
  assert.equal(mapButtonDown(ptr(false,0)),false,'none');assert.equal(mapButtonDown(ptr(true,3)),true,'left with right');
  const scene=read('src/client/scene.ts');
  const down=scene.match(/this\.input\.on\('pointerdown',[\s\S]*?\n {4}\}\);/)?.[0]??'';
  // The same press: an enemy under the right button becomes the priority target, the ground the walk and the hold.
  assert.match(down,/if\(this\.paused\|\|!mapButtonDown\(pointer\)\)return;/);assert.doesNotMatch(down,/primaryDown/);
  assert.match(down,/if\(hit\)\{this\.attackTarget=hit;this\.horde\?\.setTarget\(hit\);/);assert.match(down,/this\.hold\.press\(target/);
  // The hold follows while either button stays down and lets go when both are up.
  const follow=scene.match(/private followHold\([\s\S]*?\n {2}\}\n/)?.[0]??'';
  assert.match(follow,/if\(this\.paused\|\|!pointer\|\|!mapButtonDown\(pointer\)\)\{/);assert.doesNotMatch(follow,/primaryDown/);
  // Phaser's disableContextMenu cancels 'contextmenu' on its mouse target, the game canvas only (no mouseTarget set):
  // text fields and the DOM menus keep the browser's menu.
  assert.ok(scene.indexOf('this.input.mouse?.disableContextMenu();')>=0&&scene.indexOf('this.input.mouse?.disableContextMenu();')<scene.indexOf("this.input.on('pointerdown'"));
  assert.doesNotMatch(read('src/main.ts')+read('src/client/explore.ts'),/mouseTarget|document\.addEventListener\('contextmenu'/);
  const phaser=read('node_modules/phaser/src/input/mouse/MouseManager.js');
  assert.match(phaser,/disableContextMenu: function \(\)\s*\{\s*this\.target\.addEventListener\('contextmenu', function \(event\)\s*\{\s*event\.preventDefault\(\);/);
});

test('texts per input kind: the phone keeps its words, the desktop speaks of keys and clicks',()=>{
  assert.deepEqual(INPUT_TEXTS.touch,{soloNotice:'Toque na trilha para caminhar.',soloHelp:'Toque no chão ou use o direcional.',
    coopNotice:'Arraste para andar. A arma atira sozinha; toque num bicho para priorizar o alvo.'});
  for(const text of Object.values(INPUT_TEXTS.mouse)){
    assert.doesNotMatch(text,/[Tt]oque|[Aa]rrast|direcional|joystick/,text);assert.match(text,/[Cc]lique/,text);
  }
  assert.match(INPUT_TEXTS.mouse.coopNotice,/^WASD, setas ou clique pra andar\. A arma atira sozinha/);
  const explore=read('src/client/explore.ts');
  assert.match(explore,/\$\{INPUT_TEXTS\.touch\.soloNotice\}/);assert.match(explore,/\$\{INPUT_TEXTS\.touch\.soloHelp\}/);
  assert.match(explore,/textContent=INPUT_TEXTS\.touch\.coopNotice/);
});
test('explore: data-input on the shell, the joystick hidden on the desktop, the hotkeys wired',()=>{
  const explore=read('src/client/explore.ts');
  assert.match(explore,/new InputKindWatch\(finePointer\(\)\)/);assert.match(explore,/shell\.dataset\.input=kind/);
  assert.match(explore,/document\.addEventListener\('pointerdown',event=>\{if\(inputWatch\.pointer\(event\.pointerType,true\)\)syncInput\(\);\},\{capture:true,signal\}\)/);
  assert.match(explore,/const hotkey=hotkeyOf\(event,settings\.open\)/);
  assert.match(explore,/if\(hotkey\.kind==='skill'\)event\.preventDefault\(\);/);
  assert.match(explore,/\[data-turn="\$\{hotkey\.turn\}"\]:not\(:disabled\)`\)\?\.click\(\)/);
  assert.match(explore,/castSkill&&!\$<HTMLButtonElement>\('#coop-attack'\)\.disabled/);
  assert.match(explore,/emotes&&!emotes\.root\.hidden\)emotes\.setOpen\(!emotes\.open\)/);
  assert.match(read('src/client/explore.css'),/\.explore-shell\[data-input=mouse\] \.explore-stick\{display:none\}/);
});
