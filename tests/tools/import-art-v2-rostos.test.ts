/**
 * Art v2 face avatars (group `rostos`, board design/PACOTE-ROSTOS.md): the demo set (tests/fixtures/art-v2/demo-faces.mjs)
 * is approved and written as 256×256 WebP in the index; a face drawn outside the central 240 px circle, an unknown
 * expression and an unknown class are refused with pt-BR messages naming the file; the report lists the missing
 * `normal` faces as pending (P0) and the other expressions as optional (P1). The class list matches the game catalog.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtempSync,rmSync,readFileSync,mkdirSync,existsSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {importArtV2} from '../../scripts/import-art-v2.mjs';
import {GROUPS,INDEX_FILE,FACE_CLASSES,FACE_EXPRESSIONS,FACE_SIZE,FACE_CIRCLE,faceIdProblem} from '../../scripts/art-v2/spec.mjs';
import {writeDemoFaces,drawFace,DEMO_FACES,DEMO_FACE_SET,FACE_DEMO_SIZE} from '../fixtures/art-v2/demo-faces.mjs';
import {classes} from '../../src/rules/classes.ts';
import {parseArtIndex} from '../../src/client/art/manifest.ts';

sharp.cache(false);sharp.concurrency(1);

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
type Piece={group:string,id:string,status:string,priority?:string,problems:string[],notes:string[],files:string[],outputs:string[]};
type Result={pieces:Piece[],written:string[],reportFile?:string};
const withTemp=async(fn:(dir:string)=>Promise<void>)=>{
  const dir=mkdtempSync(path.join(tmpdir(),'art-v2-rostos-'));
  try{await fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}
};
const piece=(r:Result,id:string)=>{const p=r.pieces.find(x=>x.group==='rostos'&&x.id===id);assert.ok(p,`no result for rostos/${id}`);return p;};
const savePng=async(data:Buffer,file:string,size=FACE_DEMO_SIZE)=>{
  mkdirSync(path.dirname(file),{recursive:true});
  await sharp(data,{raw:{width:size,height:size,channels:4}}).png().toFile(file);
};

test('the 29 face classes are the game catalog (src/rules/classes.ts), in order; 5 expressions, normal first',()=>{
  assert.deepEqual([...FACE_CLASSES],classes.map(c=>c.id));
  assert.equal(FACE_CLASSES.length,29);
  assert.deepEqual([...FACE_EXPRESSIONS],['normal','ferido','caido','rindo','bravo']);
  const spec=GROUPS.rostos as any;
  assert.deepEqual([spec.input,spec.output,spec.kind,spec.size,spec.circle],['rostos','public/art/rostos','icon',256,240]);
  assert.equal([FACE_SIZE,FACE_CIRCLE].join(),'256,240');
  const table=Object.entries(spec.expected) as [string,{priority:string,meta:{face:string,expression:string}}][];
  assert.equal(table.length,29*5);
  for(const [id,e] of table){
    assert.equal(`${e.meta.face}-${e.meta.expression}`,id);
    assert.equal(e.priority,e.meta.expression==='normal'?'P0':'P1',id);
  }
});

test('demo faces: every one approved, 256×256 WebP with face/expression meta in the index; the report has the Rostos section',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida'),reportFile=path.join(dir,'relatorio.html');
  await writeDemoFaces(input);
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups:{rostos:GROUPS.rostos},write:true,reportFile});
  for(const id of DEMO_FACES.rostos){
    const p=piece(r,id);
    assert.equal(p.status,'aprovado',`${id}: ${p.problems.join(' | ')}`);
    assert.deepEqual(p.outputs,[`public/art/rostos/${id}.webp`]);
    const m=await sharp(path.join(outRoot,'public/art/rostos',`${id}.webp`)).metadata();
    assert.deepEqual([m.width,m.height,m.format,m.hasAlpha],[256,256,'webp',true],id);
  }
  const idx=parseArtIndex(JSON.parse(readFileSync(path.join(outRoot,...INDEX_FILE.split('/')),'utf8')));
  assert.equal(idx.groups.rostos.output,'public/art/rostos');
  assert.deepEqual(Object.keys(idx.groups.rostos.pieces).sort(),[...DEMO_FACES.rostos].sort());
  assert.deepEqual(idx.groups.rostos.pieces['mendigo-normal'].meta,{face:'mendigo',expression:'normal'});
  assert.equal(idx.groups.rostos.pieces['mendigo-normal'].files.sheet.file,'mendigo-normal.webp');

  // Absent: the 27 classes without a normal face are pending (P0); the other missing expressions only optional (P1).
  const pending=r.pieces.filter(p=>p.status==='pendente').map(p=>p.id);
  const withNormal=Object.keys(DEMO_FACE_SET);
  assert.deepEqual(pending.sort(),FACE_CLASSES.filter(c=>!withNormal.includes(c)).map(c=>`${c}-normal`).sort());
  assert.equal(piece(r,'mendigo-rindo').status,'opcional');
  assert.equal(piece(r,'mendigo-rindo').priority,'P1');
  assert.equal(r.pieces.filter(p=>p.status==='opcional').length,29*4-(4+1));
  const html=readFileSync(reportFile,'utf8');
  assert.match(html,/<h2>10\. Rostos \(avatares\)<\/h2>/);
  const pendingLine=html.match(/<p class="pending">[^\n]*?<\/p>/)?.[0]??'';
  assert.match(pendingLine,/<code>aposentado-normal<\/code>/);
  assert.match(pendingLine,/<code>vizinha-fofoqueira-normal<\/code>/);
  assert.doesNotMatch(pendingLine,/mendigo-normal|-rindo/);
  assert.match(html,/Opcionais \(P1\/P2\)[^\n]*<code>mendigo-rindo<\/code>/);
}));

test('a face drawn outside the central 240 px circle is refused naming the file, where and what to fix; nothing written',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida');
  // The demo face plus a hat brim in the top-left corner (inside the 2 px margin, outside the circle).
  const data=drawFace('cidadao-comum','normal');
  for(let y=10;y<30;y++)for(let x=10;x<30;x++)data.set([250,210,0,255],(y*FACE_DEMO_SIZE+x)*4);
  await savePng(data,path.join(input,'rostos','cidadao-comum-normal.png'));
  // A full-bleed opaque face (a painted square background) is refused too, even with "opaque":true.
  await savePng(Buffer.alloc(FACE_DEMO_SIZE*FACE_DEMO_SIZE*4,255),path.join(input,'rostos','maromba-normal.png'));
  writeFileSync(path.join(input,'rostos','maromba-normal.json'),'{"opaque":true}');
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups:{rostos:GROUPS.rostos},write:true});
  const p=piece(r,'cidadao-comum-normal');
  assert.equal(p.status,'reprovado');
  assert.equal(p.problems.length,1,p.problems.join(' | '));
  assert.match(p.problems[0],/^rostos\/cidadao-comum-normal\.png: 400 pixels desenhados fora do círculo central de 240 px \(no canto superior esquerdo;/);
  assert.match(p.problems[0],/Traga o desenho .* para dentro do círculo de 240 px centrado na imagem 256×256/);
  const opaque=piece(r,'maromba-normal');
  assert.equal(opaque.status,'reprovado');
  assert.match(opaque.problems.join(' '),/rostos\/maromba-normal\.png: nenhum pixel transparente/);
  assert.ok(!existsSync(path.join(outRoot,'public/art/rostos')),'something was written for refused faces');
}));

test('unknown expression or class, or a wrong size, is refused with a pt-BR message naming the file',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida');
  const ok=drawFace('mendigo','normal');
  await savePng(ok,path.join(input,'rostos','mendigo-chorando.png'));
  await savePng(ok,path.join(input,'rostos','palhaco-normal.png'));
  await savePng(Buffer.alloc(128*128*4),path.join(input,'rostos','streamer-normal.png'),128);
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups:{rostos:GROUPS.rostos},write:false});
  const expr=piece(r,'mendigo-chorando'),cls=piece(r,'palhaco-normal'),size=piece(r,'streamer-normal');
  for(const p of [expr,cls,size])assert.equal(p.status,'reprovado',p.id);
  assert.deepEqual(expr.problems,[`rostos/mendigo-chorando.png: expressão "chorando" desconhecida. O nome precisa terminar com uma das expressões normal, ferido, caido, rindo, bravo (ex.: rostos/mendigo-rindo.png).`]);
  assert.match(cls.problems[0],/^rostos\/palhaco-normal\.png: classe "palhaco" desconhecida\. Use o id de uma das 29 classes/);
  assert.match(size.problems[0],/^rostos\/streamer-normal\.png: tamanho 128×128, esperado 256×256 .*Exporte o ícone em 256×256\./);
  // The pure helper agrees with the table.
  assert.equal(faceIdProblem('rei-pastel-rindo'),undefined);
  assert.match(String(faceIdProblem('rei-pastel')),/expressão "pastel" desconhecida/);
  assert.match(String(faceIdProblem('rei-normal')),/classe "rei" desconhecida/);
}));
