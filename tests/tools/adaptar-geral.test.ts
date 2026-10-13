/**
 * Delivery adapter of the flat groups (scripts/art-v2/adaptar/geral.mjs, NEW-20261012-ORQ-adaptar-entrega-codex) on a
 * tiny SYNTHETIC delivery: `<name>.png` + `<name>.meta.json` with the delivery's extra keys become `<id>.png` (bytes
 * unchanged) + `<id>.json` with only importer keys, under the spec ids (map `cidade` → `cidade-nevada`, renamed
 * materials, effects, items, minimap marks); flat ground gets a D-038 "ask back" note but is still adapted; the run is
 * idempotent; and the real importer approves the adapted effects (the full-bleed blackout veil too), items and icons.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {adapt,renameStem,RENAMES,sidecarFor} from '../../scripts/art-v2/adaptar/geral.mjs';
import {SIDECAR_KEYS} from '../../scripts/art-v2/validate.mjs';
import {importArtV2} from '../../scripts/import-art-v2.mjs';

sharp.cache(false);sharp.concurrency(1);

type Rec={group:string,id:string,action:string,notes?:string[],refused?:string};

/** RGBA buffer w×h from a pixel function. */
const rgba=(w:number,h:number,px:(x:number,y:number)=>[number,number,number,number])=>{
  const b=Buffer.alloc(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)b.set(px(x,y),(y*w+x)*4);
  return b;
};
const png=async(file:string,w:number,h:number,px:(x:number,y:number)=>[number,number,number,number])=>{
  mkdirSync(path.dirname(file),{recursive:true});
  await sharp(rgba(w,h,px),{raw:{width:w,height:h,channels:4}}).png().toFile(file);
};
const meta=(file:string,data:object)=>writeFileSync(file,JSON.stringify(data));
/** A disc of colour c centred in each cw×ch cell (transparent around, ≥ 2 px margin). */
const discs=(cw:number,ch:number,c:[number,number,number])=>(x:number,y:number):[number,number,number,number]=>{
  const dx=x%cw-cw/2+.5,dy=y%ch-ch/2+.5,r=Math.min(cw,ch)/2-4;
  return dx*dx+dy*dy<=r*r?[...c,255]:[0,0,0,0];
};

async function makeDelivery(root:string){
  const chao=path.join(root,'cenario/chao');
  // Flat snow (the old 0.08 rule): two tones 1 step apart; periodic, so it tiles.
  await png(path.join(chao,'cidade/neve-1.png'),64,64,(x,y)=>{const v=200+((x+y)%2);return [v,v,v+4,255];});
  meta(path.join(chao,'cidade/neve-1.meta.json'),{cell:[64,64],frames:1,sourceGrid:[1,1],worldCell:.88,anchor:[.5,.5],finalAudit:{pass:true}});
  // Detailed cobblestone: high-contrast 8 px checker (tiles too).
  await png(path.join(chao,'cidade/paralelepipedo-2.png'),64,64,(x,y)=>{const v=((x>>3)+(y>>3))%2?40:200;return [v,v,v,255];});
  meta(path.join(chao,'cidade/paralelepipedo-2.meta.json'),{cell:[64,64],frames:1,provenance:'x'});
  await png(path.join(chao,'cidade/trans-neve-lama.png'),64,64,x=>{const v=x<32?0:255;return [v,v,v,255];});
  meta(path.join(chao,'cidade/trans-neve-lama.meta.json'),{cell:[64,64],frames:1,id:'x',files:[],cells:1});
  await png(path.join(chao,'infinito/espuma.png'),128,16,discs(16,16,[240,240,255]));
  meta(path.join(chao,'infinito/espuma.meta.json'),{cell:[16,16],frames:8,sourceGrid:[8,1],fps:8,anchor:[.5,.5]});
  const fx=path.join(root,'efeitos');
  await png(path.join(fx,'vida-normal-moldura.png'),64,12,(x,y)=>x<2||y<2||x>61||y>9?[120,90,50,255]:[0,0,0,0]);
  meta(path.join(fx,'vida-normal-moldura.meta.json'),{id:'efeitos/vida-normal-moldura',type:'frame',cell:[64,12],frames:1,nineSlice:[2,2,2,2],geometry:[]});
  await png(path.join(fx,'perigo-borda.png'),128,16,x=>x%16<8?[255,60,40,200]:[0,0,0,0]);
  meta(path.join(fx,'perigo-borda.meta.json'),{id:'efeitos/perigo-borda',type:'pattern',cell:[128,16],frames:1,visualReview:'ok'});
  await png(path.join(fx,'fogo-no-chao.png'),256,32,discs(32,32,[255,120,0]));
  meta(path.join(fx,'fogo-no-chao.meta.json'),{id:'efeitos/fogo-no-chao',type:'strip',cell:[32,32],frames:8,fps:8,dimensions:[256,32]});
  // Blackout veil: a vignette dark up to the border on purpose (spec fullBleed: no padding rule).
  await png(path.join(fx,'veu-apagao.png'),32,32,(x,y)=>{const d=Math.hypot(x-15.5,y-15.5);return d<8?[0,0,0,0]:[20,10,0,Math.min(255,Math.round((d-8)*20))];});
  meta(path.join(fx,'veu-apagao.meta.json'),{id:'efeitos/veu-apagao',type:'single',cell:[32,32],frames:1});
  await png(path.join(root,'itens/gema-xp-pequena.png'),64,16,discs(16,16,[40,90,255]));
  meta(path.join(root,'itens/gema-xp-pequena.meta.json'),{cell:[16,16],frames:4,anchor:[.5,.5],fps:8,itemScaleFactor:.7});
  await png(path.join(root,'ui/voce.png'),128,128,discs(128,128,[250,160,90]));
  meta(path.join(root,'ui/voce.meta.json'),{id:'ui/voce',type:'ui',subject:'face',cell:[128,128],frames:1,rawColumns:1,rawRows:1,status:'validated'});
  await png(path.join(root,'ui/config.png'),128,128,discs(128,128,[250,160,90]));
}

const files=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)).map(f=>`${e.name}/${f}`):[e.name]).sort();

test('renames: map materials, effects, items, projectiles and minimap marks to the spec ids', ()=>{
  assert.equal(renameStem(RENAMES['chao/cidade-nevada'],'neve-2'),'neve-fofa-2');
  assert.equal(renameStem(RENAMES['chao/cidade-nevada'],'trans-neve-lama'),'trans-neve-lama');
  assert.equal(renameStem(RENAMES['chao/infinito'],'espuma'),'espuma-borda');
  assert.equal(renameStem(RENAMES.efeitos,'perigo-hachura'),'telegraph-enchimento');
  assert.equal(renameStem(RENAMES.projeteis,'molotov'),'garrafa-molotov');
  assert.equal(renameStem(RENAMES.ui,'voce'),'marca-voce');
  assert.equal(renameStem(RENAMES.ui,'coco'),'coco');
});

test('sidecar: rawColumns/rawRows give the cell; a 1-row strip leaves frames to the importer', ()=>{
  const {sidecar}=sidecarFor('efeitos','x',{rawColumns:4,rawRows:1,fps:6},{width:256,height:64,alpha:true});
  assert.deepEqual(sidecar,{kind:'frames',cell:[64,64],fps:6});
});

test('adapts the synthetic delivery: spec ids, importer-only keys, bytes kept, D-038 note, idempotent', async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'adaptar-geral-'));
  try{
    const src=path.join(dir,'entrega'),out=path.join(dir,'saida');
    await makeDelivery(src);
    const records:Rec[]=await adapt({src,out,log:()=>{}});
    assert.equal(records.filter(r=>r.refused).length,0);
    assert.deepEqual(files(out),[
      'cenario/chao/cidade-nevada/neve-fofa-1.json','cenario/chao/cidade-nevada/neve-fofa-1.png',
      'cenario/chao/cidade-nevada/paralelepipedo-2.json','cenario/chao/cidade-nevada/paralelepipedo-2.png',
      'cenario/chao/cidade-nevada/trans-neve-lama.json','cenario/chao/cidade-nevada/trans-neve-lama.png',
      'cenario/chao/infinito/espuma-borda.json','cenario/chao/infinito/espuma-borda.png',
      'efeitos/barra-vida-moldura.json','efeitos/barra-vida-moldura.png','efeitos/fogo-chao.json','efeitos/fogo-chao.png',
      'efeitos/telegraph-borda.json','efeitos/telegraph-borda.png','efeitos/veu-apagao.json','efeitos/veu-apagao.png',
      'itens/gema-pequena.json','itens/gema-pequena.png',
      'ui/config.json','ui/config.png','ui/marca-voce.json','ui/marca-voce.png',
    ]);
    const sc=(f:string)=>JSON.parse(readFileSync(path.join(out,f),'utf8'));
    for(const f of files(out).filter(f=>f.endsWith('.json')))for(const k of Object.keys(sc(f)))assert.ok(SIDECAR_KEYS.includes(k),`${f}: ${k}`);
    assert.deepEqual(sc('cenario/chao/cidade-nevada/neve-fofa-1.json'),{kind:'seamless',cell:[64,64],wrap:'xy'});
    assert.deepEqual(sc('cenario/chao/cidade-nevada/trans-neve-lama.json'),{kind:'seamless',mask:true,cell:[64,64]});
    assert.deepEqual(sc('cenario/chao/infinito/espuma-borda.json'),{kind:'frames',cell:[16,16],fps:8,anchor:[.5,.5]});
    assert.deepEqual(sc('efeitos/barra-vida-moldura.json'),{kind:'nineslice',cell:[64,12],slice:[2,2,2,2]});
    assert.deepEqual(sc('efeitos/telegraph-borda.json'),{kind:'seamless',cell:[128,16],wrap:'x',transparent:true});
    assert.deepEqual(sc('ui/marca-voce.json'),{kind:'icon'});
    assert.deepEqual(readFileSync(path.join(out,'itens/gema-pequena.png')),readFileSync(path.join(src,'itens/gema-xp-pequena.png')));
    const note=(id:string)=>records.find(r=>r.id===id)?.notes??[];
    assert.ok(note('cidade-nevada/neve-fofa-1').some(n=>n.startsWith('ask back: D-038')),'flat snow is asked back');
    assert.ok(note('cidade-nevada/neve-fofa-1').includes('renamed from cenario/chao/cidade/neve-1'));
    assert.ok(!note('cidade-nevada/paralelepipedo-2').some(n=>n.startsWith('ask back')),'a detailed tile is not asked back');
    // Idempotent: same bytes on a second run over a dirty output.
    const before=files(out).map(f=>readFileSync(path.join(out,f)));
    writeFileSync(path.join(out,'ui/stale.png'),'x');
    await adapt({src,out,log:()=>{}});
    assert.deepEqual(files(out).map(f=>readFileSync(path.join(out,f))),before);
    assert.ok(!existsSync(path.join(out,'ui/stale.png')));
    // The real importer approves what came (effects, items, icons, ground).
    const {pieces}=await importArtV2({input:out,groups:['chao','efeitos','itens','ui'],write:false});
    const got=pieces.filter((p:{status:string})=>p.status==='aprovado'||p.status==='reprovado');
    for(const p of got)assert.equal(p.status,'aprovado',`${p.group}/${p.id}: ${p.problems.join(' | ')}`);
    assert.equal(got.length,11);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
