import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cycleWatched,type Watchable} from '../../src/client/framing.ts';
import {CHINELO_LINES,LEAVE_TEXT,NOBODY_TEXT,chineloLine,shortName,spectatorView} from '../../src/client/hud/spectator.ts';

const w=(id:string,standing=true,inRun=true):Watchable=>({id,x:0,y:0,standing,inRun});

test('‹ › cycle the teammates still in the run, in id order, wrapping, downed ones included', ()=>{
  const list=[w('c'),w('a'),w('b',false,true),w('z',false,false)];
  assert.equal(cycleWatched(list,'a',1),'b');
  assert.equal(cycleWatched(list,'b',1),'c');
  assert.equal(cycleWatched(list,'c',1),'a');
  assert.equal(cycleWatched(list,'a',-1),'c');
  // An eliminated teammate ('z') is never a stop.
  assert.equal(cycleWatched(list,'z',1),'a');
  assert.equal(cycleWatched(list,undefined,-1),'c');
  assert.equal(cycleWatched([w('z',false,false)],undefined,1),undefined);
  assert.equal(cycleWatched([],'a',1),undefined);
});

test('the bar shows only in combat, out (eliminated) or watching (joined mid-run)', ()=>{
  const watching={id:'p2',name:'Tia Cleide Aparecida',classId:'cidadao-comum',choices:3};
  assert.equal(spectatorView({phase:'combat',watching}).show,false);
  assert.equal(spectatorView({phase:'result',eliminated:true,watching}).show,false);
  assert.equal(spectatorView({phase:'lobby',spectator:true}).show,false);
  assert.deepEqual(spectatorView({phase:'combat',eliminated:true,watching}),{show:true,name:'Tia',classId:'cidadao-comum',arrows:true});
  assert.equal(spectatorView({phase:'combat',spectator:true,watching:{...watching,choices:1}}).arrows,false);
  assert.deepEqual(spectatorView({phase:'combat',eliminated:true}),{show:true,name:NOBODY_TEXT,arrows:false});
});

test('names are cut like the banner and the chinelo lines cycle in a fixed order', ()=>{
  assert.equal(shortName('  Bartolomeu Silva '),'Bartolomeu');
  assert.equal(shortName('Concurseira Eterna da Silva'),'Concurseira');
  assert.equal(shortName('Maximilianos'),'Maximil.');
  // Two bots of one class stay apart on the ‹ › (bot-nome-do-personagem).
  assert.equal(shortName('Mendigo 2'),'Mendigo 2');
  assert.equal(shortName('Concurseira 2'),'Concurs. 2');
  const watching={id:'b2',name:'Mendigo 2',choices:2};
  assert.equal(spectatorView({phase:'combat',eliminated:true,watching}).name,'Mendigo 2');
  assert.equal(chineloLine(0),CHINELO_LINES[0]);
  assert.equal(chineloLine(CHINELO_LINES.length+1),CHINELO_LINES[1]);
  assert.equal(chineloLine(-1),CHINELO_LINES.at(-1));
  assert.equal(LEAVE_TEXT,'Voltar ao lobby');
});

test('the torcida never reaches the room: the bar holds no network handle and sends nothing', ()=>{
  const src=readFileSync(new URL('../../src/client/hud/spectator.ts',import.meta.url),'utf8');
  for(const word of ['net.','CoopClient','socket','send(','emote(','cast(','input('])assert.ok(!src.includes(word),`spectator.ts mentions ${word}`);
  // explore.ts hands it only the scene's camera and the shell's close.
  const wiring=readFileSync(new URL('../../src/client/explore.ts',import.meta.url),'utf8').match(/spect=new SpectatorBar\(.*?\}\);\n/s)?.[0]??'';
  assert.ok(wiring.includes('watchStep')&&wiring.includes('watchedScreen')&&wiring.includes('close()'));
  assert.ok(!/net\./.test(wiring),'the bar wiring must not touch the room');
});

test('watching: the depth origin follows the watched friend and a turned phone resizes the game (22/10 prova)', ()=>{
  const scene=readFileSync(new URL('../../src/client/scene.ts',import.meta.url),'utf8');
  // Anchored on the dead body, everything near a far friend sorted under the ground layers (depth −10 000): invisible.
  const rebase=scene.match(/private rebaseDepth\(force=false\)\{[\s\S]*?\n  \}/)?.[0]??'';
  assert.match(rebase,/at=(near\?\?)?this\.watchPoint\?\?this\.position/);
  assert.match(rebase,/this\.depthOrigin=\{x:Math\.round\(at\.x\),y:Math\.round\(at\.y\)\}/);
  // Phaser 3.90 misses the size after screen.orientation 'change': the parent's real size refreshes the scale again.
  assert.match(scene,/new ResizeObserver\([\s\S]{0,300}s\.getParentBounds\(\);s\.refresh\(\);/);
  assert.match(scene,/Phaser\.Core\.Events\.DESTROY,\(\)=>sizes\?\.disconnect\(\)/);
});
