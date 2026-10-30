import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LUZ,LUZES_BUDGET,LUZES_DEPTH,LUZ_FADE_MS,WINDOW_LIT,faroisPose,luzLevel,luzSpots,luzesBudget,luzesEnabled,pickGroups,stepFade,
} from '../../src/client/render/luzes/rules.ts';
import {JANELAS} from '../../src/client/render/luzes/janelas.ts';


test('?luzes=0 and ?luz=0 turn the lights off; anything else keeps them', ()=>{
  assert.equal(luzesEnabled(''),true);
  assert.equal(luzesEnabled('?luzes=1'),true);
  assert.equal(luzesEnabled('?foto=cidade-praca&luzes=0'),false);
  assert.equal(luzesEnabled('?luz=0'),false);
});

test('the halos sit over the fog and under the apagão', ()=>{
  assert.ok(LUZES_DEPTH>93902&&LUZES_DEPTH<94000);
});

test('a lit pole only adds its bloom over the fog at its lamp head', ()=>{
  const s=luzSpots('poste-aceso-amarelo-1',0,[512,768],'k');
  assert.equal(s.length,1);
  assert.equal(s[0]!.frame,LUZ.bloom);
  assert.equal(s[0]!.over,true);
  assert.deepEqual(s[0]!.at,[392/512,168/768]);
  assert.equal(luzSpots('fogueira-tambor-1',0,[256,256],'k')[0]!.flicker,'breath');
});

test('a building lights about half of its painted windows, with its own piece, the same ones every time', ()=>{
  const id='padaria-1',wins=JANELAS[id]![0]!;
  assert.ok(wins.length>0);
  let lit=0,total=0;
  for(let i=0;i<40;i++){
    const s=luzSpots(id,0,[512,512],`d:${i}`),w=s.filter(x=>x.frame===LUZ.window);
    assert.ok(w.every(x=>!x.over));
    lit+=w.length;total+=wins.length;
  }
  const share=lit/total;
  assert.ok(share>WINDOW_LIT-.15&&share<WINDOW_LIT+.15,String(share));
  assert.deepEqual(luzSpots(id,0,[512,512],'d:3'),luzSpots(id,0,[512,512],'d:3'));
});

test('the kombi shows headlights and a cone toward its nose, taillights from behind', ()=>{
  const front=luzSpots('kombi-velha-1',0,[512,512],'k');
  assert.equal(front.filter(s=>s.frame===LUZ.lamp).length,2);
  const cone=front.find(s=>s.frame===LUZ.cone)!;
  assert.ok(cone.over&&!cone.flipX);
  assert.equal(luzSpots('kombi-velha-1',270,[512,512],'k').find(s=>s.frame===LUZ.cone)!.flipX,true);
  const back=luzSpots('kombi-velha-1',90,[512,512],'k');
  assert.ok(back.length===1&&back[0]!.frame===LUZ.lamp&&back[0]!.tint===0xff5040);
});

test('about one wall in ten hangs a lantern; other pieces light nothing', ()=>{
  let lanterns=0;
  for(let i=0;i<400;i++)if(luzSpots('muro-pichado-1',0,[256,256],`w:${i}`).length)lanterns++;
  assert.ok(lanterns>15&&lanterns<70,String(lanterns));
  assert.deepEqual(luzSpots('arvore-seca-1',0,[256,256],'k'),[]);
});

test('steady lights, reduced motion and Leve hold full; pisca follows the lamp; breath stays bright', ()=>{
  assert.equal(luzLevel('steady',1234,'k',false),1);
  assert.equal(luzLevel('tv',1234,'k',true),1);
  assert.equal(luzLevel('neon',1234,'k',true),1);
  assert.equal(luzLevel('pisca',1234,'k',false,.3),.3);
  for(let t=0;t<5000;t+=97){const b=luzLevel('breath',t,'k',false);assert.ok(b>=.7&&b<=1);}
});

test('budget: Leve a few, a phone half a computer; the nearest groups win, ties by key', ()=>{
  assert.equal(luzesBudget(true,false),LUZES_BUDGET.leve);
  assert.equal(luzesBudget(false,true),LUZES_BUDGET.phone);
  assert.equal(luzesBudget(false,false),LUZES_BUDGET.desktop);
  const g=[{key:'a',x:100,y:0},{key:'b',x:1,y:0},{key:'c',x:-1,y:0},{key:'d',x:50,y:0}];
  assert.deepEqual([...pickGroups(g,0,0,2)].sort(),['b','c']);
  assert.equal(pickGroups(g,0,0,10).size,4);
});

test('a group fades in and out over LUZ_FADE_MS, never past its target', ()=>{
  assert.equal(stepFade(0,1,LUZ_FADE_MS/2),.5);
  assert.equal(stepFade(.9,1,LUZ_FADE_MS),1);
  assert.equal(stepFade(.1,0,LUZ_FADE_MS),0);
});

test('Uno headlights: the cone points from the nose ahead, lamps show only with the nose toward the screen', ()=>{
  const toward=faroisPose({left:{x:-5,y:10},right:{x:5,y:10},nose:{x:0,y:10},ahead:{x:0,y:60},tail:{x:0,y:-30}});
  assert.equal(toward.facing,true);
  assert.ok(Math.abs(toward.angle-Math.PI/2)<1e-9);
  assert.ok(toward.length>toward.width);
  const away=faroisPose({left:{x:-5,y:-10},right:{x:5,y:-10},nose:{x:0,y:-10},ahead:{x:0,y:-60},tail:{x:0,y:30}});
  assert.equal(away.facing,false);
});
