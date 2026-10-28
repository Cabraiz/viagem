// Card NEW-20261028-ORQ-exploracao-espera-carregar-e-sem-arma (the user, 28/10): with empty hands the attack button says
// "Dançar" and a tap (or Space) dances at once. The scene hands the tap's time to the hero's DanceGate as a cheer
// (scene.ts danceCue: the later of the room's cheer and hooks.danceAt), on the same clock as the tap's own poke.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DanceGate,CHEER_MS,DANCE_IDLE_MS} from '../../src/client/sprites/hero-dance.ts';
import {UNARMED_WORD,NOTE_OPEN_CRATE} from '../../src/client/hud/skill.ts';

const cue=(poke:number,danceAt?:number,cheer?:number)=>({allowed:true,poke,cheer:Math.max(cheer??-Infinity,danceAt??-Infinity)});

test('a tap on Dançar dances on that frame, though the tap is an input too',()=>{
  const gate=new DanceGate();
  assert.equal(gate.update(1000,true,cue(0)),undefined);
  assert.equal(gate.update(2000,true,cue(2000,2000)),2000,'dances from the tap');
  assert.equal(gate.prefetch,true,'its sheet is asked for at once');
  assert.equal(gate.update(2000+CHEER_MS+DANCE_IDLE_MS,true,cue(2000,2000)),2000,'still the same dance while it stands still');
});

test('walking cuts it; standing still after a walk does not dance until the next tap (or the idle wait)',()=>{
  const gate=new DanceGate();
  gate.update(2000,true,cue(2000,2000));
  assert.equal(gate.update(2500,false,cue(2500,2000)),undefined,'moved');
  assert.equal(gate.update(2600,true,cue(2500,2000)),undefined);
  assert.equal(gate.update(3000,true,cue(3000,3000)),3000,'tapped again');
});

test('no tap and no cheer: the cue never dances by itself before the idle wait',()=>{
  const gate=new DanceGate();
  assert.equal(gate.update(0,true,cue(0)),undefined);
  assert.equal(gate.update(DANCE_IDLE_MS-1,true,cue(0)),undefined);
});

test('the button says Dançar and, once a run, Abra uma caixa para pegar uma arma; Space, the right button and a tap all dance',()=>{
  assert.equal(UNARMED_WORD,'Dançar');
  assert.equal(NOTE_OPEN_CRATE,'Abra uma caixa para pegar uma arma');
  const explore=readFileSync(new URL('../../src/client/explore.ts',import.meta.url),'utf8');
  assert.match(explore,/if\(skill\?\.dancing\)\{[^}]*dance\(\);return;\}/,'Space');
  assert.match(explore,/towTap\(\);return;\}if\(down&&skill\?\.dancing\)\{[^}]*dance\(\);return;\}/,'right button');
  assert.match(explore,/window\.addEventListener\('pointerdown',onDance,\{capture:true,signal\}\)/,'tap');
  assert.match(explore,/danceAt:id=>dancedAt\.get\(id\)/);
});

test('carregou and the crate note wait for the island on screen, not the loading screen (PC lento: 22.9 s)',()=>{
  const scene=readFileSync(new URL('../../src/client/scene.ts',import.meta.url),'utf8');
  assert.match(scene,/if\(phase!=='combat'\)this\.loadSaid=false;else if\(!this\.readyHeld&&!this\.loadSaid\)\{this\.loadSaid=true;net\.loaded\(\);\}/);
  const skill=readFileSync(new URL('../../src/client/hud/skill.ts',import.meta.url),'utf8');
  assert.match(skill,/if\(this\.unarmed&&this\.visible&&!this\.hinted\)/);
  const explore=readFileSync(new URL('../../src/client/explore.ts',import.meta.url),'utf8');
  assert.match(explore,/ready:\(\)=>\{sceneReady=true;if\(skill\)skill\.visible=true;/);
});
