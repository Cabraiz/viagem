/**
 * NEW-20261022-ORQ-trocar-procedurais-por-arte: the built muro and the chaveiro's moto wear painted sheets instead of
 * procedural boxes. The sheets have what the renderers ask for; with a sheet loaded the art path answers true (the
 * renderer then hides the boxes), without it false (the boxes stay); the moto faces the right column in every view.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BASE_ART} from '../../src/client/art/base-art.ts';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {MOTO_ART,MOTO_POSE_STATE,applyMotoArt,motoColumn} from '../../src/client/render/chaveiro/moto-art.ts';
import {MURALHA_ESTADOS,cellKey,muralhaPlan,type MuralhaSquare} from '../../src/client/render/muralha-rules.ts';
import {MOTO_ROWS} from '../../scripts/import-moto-chaveiro.mjs';
import {BASE_LITE_PIECES} from '../../src/client/render/city/art-plan.ts';

const base=JSON.parse(readFileSync('public/art/city/base/manifest.json','utf8')).pieces;

test('the muro-bloco sheets: an even count of straight pieces, the pillars, every damage row, 2 views, a lite copy',()=>{
  for(const id of [BASE_ART.muro,BASE_ART.muroPilar]){
    const p=base[id],f=p.files.sheet;
    assert.ok(p,id);assert.equal(f.views,2);assert.equal(f.pages.length,1);
    assert.deepEqual(f.rows,p.meta.pecas.flatMap((n:string)=>MURALHA_ESTADOS.map(s=>`${n}:${s}`)));
    assert.deepEqual(f.liteCell,f.cell,'lite copy at the same cell');
    assert.ok(BASE_LITE_PIECES.includes(id));
  }
  assert.equal(base[BASE_ART.muro].meta.pecas.length%2,0,'two parities of straight pieces');
  assert.ok(base[BASE_ART.muroPilar].meta.pecas.length>=2);
});

test('muralhaPlan with the muro\'s own counts: pieces in range, two neighbours in a run never the same',()=>{
  const counts={retos:base[BASE_ART.muro].meta.pecas.length,pilares:base[BASE_ART.muroPilar].meta.pecas.length};
  const sq:MuralhaSquare[]=[...Array.from({length:12},(_,i)=>({c:i,r:3})),...Array.from({length:6},(_,i)=>({c:11,r:4+i}))];
  const cells=new Set(sq.map(s=>cellKey(s.c,s.r))),plans=sq.map(s=>muralhaPlan(s,cells,counts));
  for(const p of plans)for(const d of p)assert.ok(d.piece>=0&&d.piece<(d.kind==='reto'?counts.retos:counts.pilares));
  for(let i=1;i<10;i++)assert.notEqual(plans[i][0].piece,plans[i+1][0].piece,`run ${i}`);
});

test('the moto-chaveiro sheet: every row the renderer asks for, 4 directions, its scale, a lite copy',()=>{
  const p=base[MOTO_ART],f=p.files.sheet;
  assert.deepEqual(f.rows,MOTO_ROWS.map(r=>r.state));
  for(const s of [...Object.values(MOTO_POSE_STATE),'em-pe-bolsa','em-pe-ferramenta'])assert.ok(f.rows.includes(s),s);
  assert.equal(f.views,4);assert.equal(f.pages[0].frameCount,4*f.rows.length);
  assert.ok(p.meta.escala>0&&p.meta.escala<1,'world px per art px');
  assert.deepEqual(f.liteCell,f.cell);assert.ok(BASE_LITE_PIECES.includes(MOTO_ART));
});

test('motoColumn: down-right, down-left, up-right, up-left on screen, turning with the camera',()=>{
  // World +x projects down-right (screen = ((x−y)·42, (x+y)·21)), +y down-left, −x up-left, −y up-right.
  assert.deepEqual([0,Math.PI/2,Math.PI,-Math.PI/2].map(h=>motoColumn(h,0)),[0,1,3,2]);
  // A quarter turn of the camera moves every facing one step.
  assert.deepEqual([0,Math.PI/2,Math.PI,-Math.PI/2].map(h=>motoColumn(h,1)),[1,3,2,0]);
});

test('with the sheet loaded the moto takes the art (the boxes are not drawn); without it the boxes stay',()=>{
  setArtIndex(parseArtIndex(JSON.parse(readFileSync('public/art/manifest.json','utf8'))));
  const calls:string[]=[];
  const image=(loaded:boolean)=>{
    const img:any={scene:{textures:{exists:()=>loaded}},texture:{key:''},
      setTexture(k:string,f:number){calls.push(`tex ${k} ${f}`);this.texture.key=k;return this;},setFrame(f:number){calls.push(`frame ${f}`);return this;},
      setOrigin(){return this;},setScale(s:number){calls.push(`scale ${s}`);return this;}};
    return img;
  };
  for(const pose of ['sitting','parked','fallen'] as const)assert.equal(applyMotoArt(image(true),MOTO_POSE_STATE[pose],0),true,pose);
  assert.equal(applyMotoArt(image(true),'em-pe-ferramenta',3),true);
  assert.equal(applyMotoArt(image(false),'sentados',0),false,'texture not loaded yet: the boxes');
  assert.ok(calls.some(c=>c.startsWith('tex art:base:moto-chaveiro')));
  setArtIndex(parseArtIndex({version:2,groups:{}}));
  assert.equal(applyMotoArt(image(true),'sentados',0),false,'no piece: the boxes');
});
