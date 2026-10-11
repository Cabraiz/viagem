import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {BLACKOUT_ALPHA,BLACKOUT_ALPHA_REDUCED,BLACKOUT_DEPTH,EYES_DEPTH,FADE_IN_MS,FADE_OUT_MS,LIFTED_DEPTH,auditBlackout,blackoutAlpha,eyesOpen} from '../src/game/render/blackout-rules.ts';
import {HAPPENING_COPY,KILLCAM_MS,killcamCaption,shameText} from '../src/game/fun/zueira.ts';
import {SHAME_SCORE,type ShameKey} from '../src/game/sim/shame.ts';
import {closerName} from '../src/game/hud/killcam.ts';
import {pickupLook,pickupTexture,FX} from '../src/game/render/keys.ts';
import {HAPPENING_KINDS} from '../src/game/sim/zueira.ts';

/** Depth constants of the Phaser modules, read from the source (node cannot load Phaser). */
const constant=(file:string,name:string)=>{
  const m=new RegExp(`${name}=(\\d+)`).exec(fs.readFileSync(file,'utf8'));
  assert.ok(m,`${name} in ${file}`);return Number(m[1]);
};

test('blackout audit: telegraphs, hero, allies, caídos, hit numbers, eyes and lifted danger all sit above the dark', ()=>{
  const above={
    TELEGRAPH_TOP_DEPTH:constant('src/game/render/layers.ts','TELEGRAPH_TOP_DEPTH'),
    PLAYER_HIT_DEPTH:constant('src/game/render/layers.ts','PLAYER_HIT_DEPTH'),
    HERO_BALLOON_DEPTH:constant('src/game/render/layers.ts','HERO_BALLOON_DEPTH'),
    ALLY_DEPTH:constant('src/game/render/you.ts','ALLY_DEPTH'),
    MARK_DEPTH:constant('src/game/render/you.ts','MARK_DEPTH'),
    SELF_DEPTH:constant('src/game/render/you.ts','SELF_DEPTH'),
    LABEL_DEPTH:constant('src/game/scene.ts','LABEL_DEPTH'),
    EYES_DEPTH,LIFTED_DEPTH,
  };
  const layers=Object.entries(above).map(([name,depth])=>({name,depth}));
  assert.deepEqual(auditBlackout(layers),[]);
  // Eyes under the lifted danger and under every hero.
  assert.ok(BLACKOUT_DEPTH<EYES_DEPTH&&EYES_DEPTH<LIFTED_DEPTH&&LIFTED_DEPTH<above.ALLY_DEPTH);
  // Enemy bodies, pickups and the ground are world depths (≤ a few thousand) or the ground layers: under the dark.
  assert.ok(BLACKOUT_DEPTH>20000);
  // The audit flags a layer left under the dark, and a hidden one.
  assert.deepEqual(auditBlackout([{name:'telegraph',depth:-9970}]),[`telegraph (-9970) under the blackout (${BLACKOUT_DEPTH})`]);
  assert.equal(auditBlackout([{name:'hero',depth:96500,visible:false}]).length,0,'a hidden layer is not judged');
});

test('blackout wiring: hostile shots, spawn warnings and caído rings go above the dark only while it is dark', ()=>{
  const layers=fs.readFileSync('src/game/render/layers.ts','utf8'),scene=fs.readFileSync('src/game/scene.ts','utf8');
  assert.match(layers,/a\.hostile&&this\.dark>0\?LIFTED_DEPTH\+1:depth\+2/);
  assert.match(layers,/setDepth\(dark\?LIFTED_DEPTH\+1:this\.depth\(this\.at\)\+2\)/);
  assert.match(layers,/\(dark\?this\.lifted:this\.ground\)/);
  assert.match(scene,/this\.downedLayer\?\.update\(marks,[^;]*\?LIFTED_DEPTH:undefined\)/);
  // Telegraph outlines are drawn on the top layer, dark or not.
  assert.match(layers,/const top=this\.top,w=this\.ui;/);
});

test('blackout alpha: fades in and out, never a cut; reduced motion is lighter and slower', ()=>{
  assert.equal(blackoutAlpha(-1,0,3000,false),0);
  assert.ok(blackoutAlpha(FADE_IN_MS/2,0,3000,false)<BLACKOUT_ALPHA);
  assert.equal(blackoutAlpha(1500,0,3000,false),BLACKOUT_ALPHA);
  assert.ok(blackoutAlpha(3000-FADE_OUT_MS/2,0,3000,false)<BLACKOUT_ALPHA);
  assert.equal(blackoutAlpha(3000,0,3000,false),0);
  assert.equal(blackoutAlpha(1500,0,3000,true),BLACKOUT_ALPHA_REDUCED);
  assert.ok(blackoutAlpha(100,0,3000,true)<=BLACKOUT_ALPHA_REDUCED*.25,'reduced: a slow fade');
  // Eyes blink sometimes; with reduced motion they never do.
  let closed=0;for(let t=0;t<3000;t+=10)if(!eyesOpen(t,.3,false))closed++;
  assert.ok(closed>0&&closed<20);
  for(let t=0;t<3000;t+=10)assert.ok(eyesOpen(t,.3,true));
});

test('copy: every event has a banner, the kill-cam names who closed the round, every moment has a sentence', ()=>{
  for(const kind of HAPPENING_KINDS){
    const c=HAPPENING_COPY[kind];
    assert.ok(c.title.length<=22&&c.subtitle.length<=36,kind);
    assert.doesNotMatch(c.title+c.subtitle,/·|→|—/);
    assert.notEqual(c.title,c.title.toUpperCase());
  }
  assert.ok(KILLCAM_MS>=2000&&KILLCAM_MS<=3000,'short');
  assert.deepEqual(killcamCaption(3,'Tia'),{title:'Último bicho!',line:'Tia fechou a conta do Round 3.'});
  assert.deepEqual(killcamCaption(4),{title:'Último bicho!',line:'Caiu sozinho no Round 4.'});
  for(const key of Object.keys(SHAME_SCORE) as ShameKey[]){
    const t=shameText({player:'a',key,round:3,tick:1,source:'pernilongo',seconds:4},'Tia Cleide');
    assert.ok(t.text.startsWith('Tia Cleide')&&t.joke.length>0,key);
  }
  assert.equal(shameText({player:'a',key:'cedo',round:1,tick:1,source:'gosma'},'Zé').text,'Zé caiu no Round 1 pra uma gosma.');
  assert.equal(shameText({player:'a',key:'recaida',round:5,tick:1,seconds:3},'Você').text,'Você foi resgatado e caiu de novo em 3 s.');
  assert.match(shameText({player:'a',key:'caiu',round:2,tick:1,source:'??'},'X').text,/um bicho/);
});

test('kill-cam name: "Você" for the local player, the nickname for the others, nothing for a tower', ()=>{
  const view={players:[{id:'a',name:'Tia'},{id:'b',name:'Zé'}]} as never;
  assert.equal(closerName(view,'a','a'),'Você');
  assert.equal(closerName(view,'b','a'),'Zé');
  assert.equal(closerName(view,undefined,'a'),undefined);
});

test('a boleto of the rain looks like a boleto; any other XP stays a gem', ()=>{
  assert.equal(pickupLook('xp','boleto'),FX.boleto);
  assert.equal(pickupLook('xp'),pickupTexture('xp'));
  assert.equal(pickupLook('heal','promo'),pickupTexture('heal'));
});
