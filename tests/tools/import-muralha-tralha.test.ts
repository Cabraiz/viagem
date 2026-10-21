/**
 * NEW-20261021-ORQ-muralha-tralha-no-jogo (scripts/import-muralha-tralha.mjs): the damage baked into the junk wall
 * sheets: the whole row keeps everything, the damaged ones cut the top lower and lower (seeded: the same every run),
 * what the cut leaves floating goes, and the rows/cell helpers the manifest is written with.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DAMAGE,KINDS,SOURCE_CELL,bakeDamage,celulaOf,dropFloating,keepProfile,sheetRows} from '../../scripts/import-muralha-tralha.mjs';

test('keep profile: whole keeps all; avariada over quase-caindo on average; seeded',()=>{
  const w=900,h=380;
  assert.ok(keepProfile('reto-01','inteira',w,h).every(v=>v===Infinity));
  const mean=(a:Float32Array)=>a.reduce((s,v)=>s+v,0)/a.length;
  const av=keepProfile('reto-01','avariada',w,h),qc=keepProfile('reto-01','quase-caindo',w,h);
  assert.ok(mean(av)>mean(qc),`${mean(av)} > ${mean(qc)}`);
  assert.ok(mean(av)<h&&mean(qc)>.15*h-1e-6);
  assert.deepEqual(keepProfile('reto-01','avariada',w,h),av,'the same every run');
  assert.notDeepEqual(keepProfile('reto-02','avariada',w,h),av,'each piece its own bites');
});

test('bake: a tall opaque column loses its top when damaged, keeps it whole; a floating bit goes',()=>{
  const w=40,h=200,kind={...KINDS.pilar,height:150,slope:0,lift:0},center:[number,number]=[20,190];
  const column=()=>{const d=new Uint8ClampedArray(w*h*4);for(let y=10;y<190;y++)for(let x=10;x<30;x++){const i=(y*w+x)*4;d.set([200,100,50,255],i);}return d;};
  const top=(d:Uint8ClampedArray)=>{for(let y=0;y<h;y++)if(d[(y*w+20)*4+3]>0)return y;return h;};
  const whole=bakeDamage(column(),w,h,{id:'pilar-1',state:'inteira',center,kind});
  assert.equal(top(whole),10);
  const hit=bakeDamage(column(),w,h,{id:'pilar-1',state:'quase-caindo',center,kind});
  assert.ok(top(hit)>10+150*.3,`top at ${top(hit)}`);
  assert.ok(hit[(185*w+20)*4]<200,'darker');
  const island=column();for(let y=0;y<5;y++)island[(y*w+2)*4+3]=255;
  dropFloating(island,w,h);
  assert.equal(island[(2*w+2)*4+3],0,'the floating bit is cleared');
  assert.equal(island[(100*w+20)*4+3],255,'the body stays');
});

test('rows and cell: every piece × state in order; celula = the source cell scaled with the window',()=>{
  assert.deepEqual(sheetRows(['a','b']),DAMAGE.flatMap(()=>[]).concat(['a:inteira','a:avariada','a:quase-caindo','b:inteira','b:avariada','b:quase-caindo']));
  assert.equal(celulaOf(KINDS.reto),SOURCE_CELL*KINDS.reto.cell[0]/(2*KINDS.reto.window.left));
});
