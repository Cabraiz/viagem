import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {BLACKOUT_ALPHA,BLACKOUT_ALPHA_REDUCED,BLACKOUT_DEPTH,EYES_DEPTH,FADE_IN_MS,FADE_OUT_MS,LIFTED_DEPTH,auditBlackout,blackoutAlpha,eyesOpen} from '../../src/client/render/blackout-rules.ts';
import {HAPPENING_COPY,KILLCAM_ALONE,KILLCAM_LINES,KILLCAM_MS,killcamCaption,shameText} from '../../src/client/fun/zueira.ts';
import {killcamBoxes,killcamFrame,KILLCAM_MIN_CRITTER_CSS,KILLCAM_SAFE_CSS} from '../../src/client/render/killcam-rules.ts';
import {ENEMY_ART} from '../../src/client/render/keys.ts';
import {SHAME_SCORE,type ShameKey} from '../../src/sim/shame.ts';
import {closerName} from '../../src/client/hud/killcam.ts';
import {pickupLook,pickupTexture,FX} from '../../src/client/render/keys.ts';
import {HAPPENING_KINDS} from '../../src/sim/zueira.ts';

/** Depth constants of the Phaser modules, read from the source (node cannot load Phaser). */
const constant=(file:string,name:string)=>{
  const m=new RegExp(`${name}=(\\d+)`).exec(fs.readFileSync(file,'utf8'));
  assert.ok(m,`${name} in ${file}`);return Number(m[1]);
};

test('blackout audit: telegraphs, hero, allies, caídos, hit numbers, eyes and lifted danger all sit above the dark', ()=>{
  const above={
    TELEGRAPH_TOP_DEPTH:constant('src/client/render/layers.ts','TELEGRAPH_TOP_DEPTH'),
    PLAYER_HIT_DEPTH:constant('src/client/render/layers.ts','PLAYER_HIT_DEPTH'),
    HERO_BALLOON_DEPTH:constant('src/client/render/layers.ts','HERO_BALLOON_DEPTH'),
    ALLY_DEPTH:constant('src/client/render/you.ts','ALLY_DEPTH'),
    MARK_DEPTH:constant('src/client/render/you.ts','MARK_DEPTH'),
    SELF_DEPTH:constant('src/client/render/you.ts','SELF_DEPTH'),
    LABEL_DEPTH:constant('src/client/scene.ts','LABEL_DEPTH'),
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
  const layers=fs.readFileSync('src/client/render/layers.ts','utf8'),scene=fs.readFileSync('src/client/scene.ts','utf8');
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
  // Kill-cam captions never repeat inside a run, never carry the round number (M1), and name who closed it.
  const used=new Set<string>(),lines:string[]=[];
  for(let i=0;i<4;i++){const c=killcamCaption('Tia','bebado',i*7+1,used);used.add(c.template);lines.push(c.line);assert.equal(c.title,'Último bicho!');assert.doesNotMatch(c.line,/Round|\d/);}
  assert.equal(new Set(lines).size,4);
  assert.ok(lines.every(l=>l.includes('Tia')));
  assert.ok(KILLCAM_ALONE.includes(killcamCaption(undefined,'agiota',3).line));
  assert.ok(KILLCAM_LINES.length>=4);
  for(const key of Object.keys(SHAME_SCORE) as ShameKey[]){
    const t=shameText({player:'a',key,round:3,tick:1,source:'pombos',seconds:4},'Tia Cleide');
    assert.ok(t.text.startsWith('Tia Cleide')&&t.joke.length>0,key);
  }
  assert.equal(shameText({player:'a',key:'cedo',round:1,tick:1,source:'bebado'},'Zé').text,'Zé caiu no Round 1 pra um bêbado do boteco.');
  assert.equal(shameText({player:'a',key:'recaida',round:5,tick:1,seconds:3},'Tia').text,'Tia levantou e caiu de novo em 3 s.');
  // varredura-celular: the chaveiro counts in Ondas, the nests mode (D-051) has no number at all.
  assert.equal(shameText({player:'a',key:'cedo',round:1,tick:1,source:'bebado'},'Zé','onda').text,'Zé caiu na Onda 1 pra um bêbado do boteco.');
  assert.equal(shameText({player:'a',key:'cedo',round:1,tick:1,source:'bebado'},'Zé','ninhos').text,'Zé caiu logo no começo pra um bêbado do boteco.');
  assert.equal(shameText({player:'a',key:'caiu',round:3,tick:1,source:'bebado'},'Zé','ninhos').text,'Zé caiu pra um bêbado do boteco.');
  assert.equal(shameText({player:'a',key:'apagao',round:3,tick:1},'Zé','onda').text,'Zé caiu no apagão na Onda 3.');
  assert.match(shameText({player:'a',key:'caiu',round:2,tick:1,source:'??'},'X').text,/um bicho/);
  // The room reads it: never "você", no gendered participles, no attack on the person (design review B1/D6).
  for(const key of Object.keys(SHAME_SCORE) as ShameKey[]){
    const t=shameText({player:'a',key,round:3,tick:1,source:'bebado',seconds:2},'Kim');
    assert.doesNotMatch(`${t.text} ${t.joke}`,/\bvoc[eê]\b/i,key);
    assert.doesNotMatch(t.text,/\b(resgatad[oa]|derrubad[oa]|sozinh[oa])\b/i,key);
  }
});

test('kill-cam name: "Você" for the local player, the nickname for the others, nothing for a tower', ()=>{
  const view={players:[{id:'a',name:'Tia'},{id:'b',name:'Zé'}]} as never;
  assert.equal(closerName(view,'a','a'),'Você');
  assert.equal(closerName(view,'b','a'),'Zé');
  assert.equal(closerName(view,undefined,'a'),undefined);
});

test('a boleto of the rain looks like a boleto, and so does any XP on the ground (D-054: no gems)', ()=>{
  assert.equal(pickupLook('xp','boleto'),FX.boleto);
  assert.equal(pickupLook('xp'),FX.boleto);
  assert.equal(pickupLook('heal','promo'),pickupTexture('heal'));
});

test('kill-cam framing: the critter (≥ 40 px CSS when it fits) and its line stay inside the TV, portrait and landscape', ()=>{
  for(const tv of [{width:100,height:76},{width:82,height:64}])for(const kind of ['bebado','anao-molotov','pombos','tio-pave','agiota'] as const)for(const reduced of [false,true]){
    const art=ENEMY_ART[kind];
    for(const t of [0,.1,.2,.35,.46,.55,.6,.7,.9,1]){
      const input={tv,mainZoom:.58,art,feet:{x:300,y:500},t,reduced,pop:{width:180,height:36}};
      const f=killcamFrame(input),b=killcamBoxes(input,f);
      const inside=(r:{left:number;right:number;top:number;bottom:number})=>r.left>=KILLCAM_SAFE_CSS-1&&r.right<=tv.width-KILLCAM_SAFE_CSS+1&&r.top>=KILLCAM_SAFE_CSS-1.5&&r.bottom<=tv.height-KILLCAM_SAFE_CSS+1.5;
      if(f.ghost.visible)assert.ok(inside(b.ghost),`${kind} ${JSON.stringify(tv)} t=${t} reduced=${reduced}: ${JSON.stringify(b.ghost)}`);
      if(f.pop.visible)assert.ok(inside(b.pop),`${kind} line t=${t}: ${JSON.stringify(b.pop)}`);
      if(art.height*f.zoom<KILLCAM_MIN_CRITTER_CSS-.5)assert.ok(tv.height<70,'only the short landscape TV may shrink the critter');
    }
  }
});
