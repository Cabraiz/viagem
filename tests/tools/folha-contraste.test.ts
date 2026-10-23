// scripts/folha-contraste.mjs: the HUD's contrast over the real map (NEW-20261009-DSG-contraste-mapa). The math the print
// sheet fails on, and the HUD's CSS without soft shadows (anti-slop: only hard shadows and rings over the map).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {judge,over,ratio,ringPoints} from '../../scripts/folha-contraste.mjs';

const BREU=[0x1e,0x15,0x30,255],PAPEL=[0xee,0xdd,0xb8,255],AMARELO=[0xff,0xd2,0x3f,255];
const SNOW=[236,240,244],ROAD=[58,62,70];

test('ratio is the WCAG contrast: black on white 21, a colour on itself 1', ()=>{
  assert.equal(Math.round(ratio([0,0,0],[255,255,255])),21);
  assert.equal(ratio(SNOW,SNOW),1);
  assert.ok(ratio(BREU,AMARELO)>=4.5,'Breu on Amarelo is a readable CTA');
});

test('over composites a see-through colour onto the ground', ()=>{
  assert.deepEqual(over([0,0,0,0],SNOW),SNOW);
  assert.deepEqual(over([0,0,0,255],SNOW),[0,0,0]);
  assert.deepEqual(over([255,255,255,128],[0,0,0]),[128,128,128]);
});

test('a Papel chip with a Papel edge vanishes on the snow; the Breu edge (borda dupla) saves it', ()=>{
  const chip={name:'ficha',body:PAPEL,edge:PAPEL,texts:[]};
  assert.equal(judge(chip,[SNOW]).fails.length,1);
  assert.match(judge(chip,[SNOW]).fails[0],/ficha: corpo #eeddb8 e contorno #eeddb8/);
  assert.deepEqual(judge({...chip,edge:BREU},[SNOW,ROAD]).fails,[]);
});

test('a Breu chip on a dark road needs a light edge; on the snow its body alone is enough', ()=>{
  const chip={name:'ficha',body:BREU,edge:null,texts:[]};
  assert.deepEqual(judge(chip,[SNOW]).fails,[]);
  assert.equal(judge(chip,[ROAD]).fails.length,1);
  assert.deepEqual(judge({...chip,edge:PAPEL},[ROAD]).fails,[]);
});

test('an inner ring counts: Lilás body, Papel ring, Breu edge reads on the dark road through the Papel ring', ()=>{
  const LILAS=[0x5b,0x3f,0x8c,255];
  const level={name:'nível',body:LILAS,edge:BREU,texts:[]};
  assert.match(judge(level,[ROAD]).fails[0],/nível: corpo #5b3f8c e contorno #1e1530/);
  assert.deepEqual(judge({...level,rings:[PAPEL]},[SNOW,ROAD]).fails,[]);
  // An ally's portrait: Papel body, Breu ring, emblem edge (light cyan) — the Breu ring holds it on the snow.
  const ally={name:'retrato',body:PAPEL,edge:[0x3e,0xc1,0xd3,255],texts:[]};
  assert.equal(judge(ally,[SNOW]).fails.length,1);
  assert.deepEqual(judge({...ally,rings:[BREU]},[SNOW,ROAD]).fails,[]);
  assert.match(judge({...level,rings:[LILAS]},[ROAD]).fails[0],/aros #5b3f8c e contorno/);
});

test('a see-through body is the map: only the edge counts', ()=>{
  const ghost={name:'fantasma',body:[0,0,0,40],edge:null,texts:[]};
  assert.equal(judge(ghost,[SNOW]).fails.length,1);
});

test('text under 4.5:1 on its own body fails, composited over the map when the body is see-through', ()=>{
  const pale={name:'onda',body:BREU,edge:PAPEL,texts:[{text:'Onda 3',color:[90,80,110,255],layers:[]}]};
  assert.match(judge(pale,[SNOW]).fails.join(),/onda: texto "Onda 3"/);
  const ok={...pale,texts:[{text:'Onda 3',color:PAPEL,layers:[]}]};
  assert.deepEqual(judge(ok,[SNOW,ROAD]).fails,[]);
  // A 50 % Breu body over the snow: light text on it is grey on grey.
  const thin={name:'fina',body:[0x1e,0x15,0x30,128],edge:BREU,texts:[{text:'XP',color:[255,255,255,255],layers:[]}]};
  assert.ok(judge(thin,[SNOW]).worstText<MIN_TEXT_OK);
  // A Breu CTA label on its own Amarelo button inside a Breu chip: the button's layer is what the text sits on.
  const cta={name:'cta',body:BREU,edge:PAPEL,texts:[{text:'Pegar',color:BREU,layers:[AMARELO]}]};
  assert.deepEqual(judge(cta,[SNOW]).fails,[]);
});
const MIN_TEXT_OK=4.5;

test('ringPoints: 8 points just outside the rect, clipped to the viewport', ()=>{
  const r={left:100,top:100,right:200,bottom:140,width:100,height:40};
  const pts=ringPoints(r,3,1000,1000);
  assert.equal(pts.length,8);
  assert.ok(pts.every(([x,y])=>x<100||x>200||y<100||y>140),'all outside the piece');
  assert.equal(ringPoints({...r,left:0,top:0,right:100,bottom:40},3,1000,1000).length,3,'off-screen corners dropped');
});

test('HUD CSS: no box-shadow with a blur (anti-slop: hard shadows and rings only)', ()=>{
  const files=[...readdirSync('src/client/hud').filter(f=>f.endsWith('.css')).map(f=>join('src/client/hud',f)),'src/client/coop.css'];
  const soft:string[]=[];
  for(const f of files){
    const css=readFileSync(f,'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
    for(const m of css.matchAll(/box-shadow\s*:\s*([^;}]+)/g)){
      // Each shadow: inset? x y [blur [spread]] colour. A third length that is not 0 is a blur.
      for(const sh of m[1].split(/,(?![^(]*\))/)){
        const lens=sh.replace(/var\([^)]*\)|color-mix\([^)]*\)|rgba?\([^)]*\)|#[0-9a-f]+/gi,'').match(/-?[\d.]+(px|rem|em)?/g)??[];
        if(lens.length>=3&&parseFloat(lens[2])!==0)soft.push(`${f}: ${sh.trim()}`);
      }
    }
  }
  assert.deepEqual(soft,[]);
});
