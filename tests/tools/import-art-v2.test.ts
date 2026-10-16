/**
 * Art v2 importer (NEW-20261012-ORQ-importador-arte-a) on SYNTHETIC deliveries (tests/fixtures/art-v2/make.mjs): the
 * correct set is approved and converted (WebP sizes, manifest with sha256, dir8 split into the 4-direction atlases);
 * every planted fault is refused with a pt-BR message naming the file and the fault, and nothing is written for it;
 * a partial delivery keeps what was not delivered; the HTML report lists every piece with the refused thumbnails.
 * Small cells through a reduced `groups` override keep it light; only the dir8 atlas has the real size.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {importArtV2,summaryText} from '../../scripts/import-art-v2.mjs';
import {GROUPS,DIRECTIONS,DIR4_FROM_DIR8,CARDINALS,ANCHOR,RIM,INDEX_FILE} from '../../scripts/art-v2/spec.mjs';
import {makeDemoDelivery,DEMO_PIECES} from '../fixtures/art-v2/demo.mjs';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {importedSheet} from '../../src/client/sprites/sprite-sheets.ts';
import {heroMeasures,leanIndex} from '../../scripts/art-v2/convert.mjs';
import {raw} from '../../scripts/sprite-atlas.mjs';
import {renderReport} from '../../scripts/art-v2/report.mjs';
import {
  makeCorrectSet,makeErrorSet,writeEnemy,TEST_ENEMY,TEST_TILE,TEST_ICON,TEST_VIEWS,TEST_NINESLICE,TEST_FRAMES,
  DIR8_OK,DIR8_WRONG_COLUMN,DIR8_LIFTED,DIRECTION_COLORS,ENEMY_FAULTS,VIEWS_BROKEN,FRAMES_BROKEN,SEAMLESS_BROKEN,
  MASK_BROKEN,NINESLICE_BROKEN,ICON_BROKEN,writeEliteLayer,writeDowned,writeCorrupt,writeFrames,writeViews,
  writeCornerViews,writeSeamless,writeIcon,json,
} from '../fixtures/art-v2/make.mjs';

// Light under memory pressure (many test processes at once): no libvips operation cache, one libvips thread.
sharp.cache(false);sharp.concurrency(1);

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
type Piece={group:string,id:string,status:'aprovado'|'reprovado'|'pendente'|'opcional',priority?:string,problems:string[],notes:string[],files:string[],outputs:string[],thumb?:string};
type Result={pieces:Piece[],written:string[],reportFile?:string};

/** The real groups with small sizes; enemy pieces given explicitly (all with the reduced cell and anims). */
const testGroups=(enemyIds:string[])=>({
  inimigos:{...GROUPS.inimigos,pieces:Object.fromEntries(enemyIds.map(id=>[id,{cell:TEST_ENEMY.cell,anims:{...TEST_ENEMY.anims}}]))},
  personagens:GROUPS.personagens,
  chao:{...GROUPS.chao,size:TEST_TILE,nested:false},
  predios:GROUPS.predios,
  props:GROUPS.props,
  itens:GROUPS.itens,
  ui:{...GROUPS.ui,size:TEST_ICON},
});
const out=(root:string,group:keyof typeof GROUPS,...rest:string[])=>path.join(root,GROUPS[group].output,...rest);
const piece=(r:Result,group:string,id:string)=>{
  const p=r.pieces.find(x=>x.group===group&&x.id===id);
  assert.ok(p,`no result for ${group}/${id}; got ${r.pieces.filter(x=>x.status!=='pendente').map(x=>`${x.group}/${x.id}`).join(', ')}`);
  return p;
};
const sizeOf=async(file:string)=>{const m=await sharp(file).metadata();return [m.width,m.height,m.format];};
const withTemp=async(fn:(dir:string)=>Promise<void>)=>{
  const dir=mkdtempSync(path.join(tmpdir(),'art-v2-'));
  try{await fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}
};
const norm=(root:string,f:string)=>path.resolve(root,f).toLowerCase();

test('correct set: every piece approved, WebP of the expected size, manifest with sha256',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida');
  const ids=await makeCorrectSet(input,{repoRoot});
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups:testGroups(['blob']),write:true});
  for(const [group,list] of Object.entries(ids))for(const id of list){
    const p=piece(r,group,id);
    assert.equal(p.status,'aprovado',`${group}/${id}: ${p.problems.join(' | ')}`);
    assert.deepEqual(p.problems,[]);
  }
  const [cell]=[TEST_ENEMY.cell],[vw,vh]=TEST_VIEWS.cell;
  const expected:[string,number,number][]=[
    [out(outRoot,'inimigos','blob','idle.webp'),cell*TEST_ENEMY.anims.idle,cell*8],
    [out(outRoot,'inimigos','blob','walk.webp'),cell*TEST_ENEMY.anims.walk,cell*8],
    [out(outRoot,'personagens',`${DIR8_OK}.dir4.webp`),1152,2304],
    [out(outRoot,'personagens',`${DIR8_OK}.dir4c.webp`),1152,2304],
    [out(outRoot,'chao','neve-1.webp'),TEST_TILE,TEST_TILE],
    [out(outRoot,'chao','trans-neve-lama.webp'),TEST_TILE,TEST_TILE],
    [out(outRoot,'predios','casinha.webp'),vw*TEST_VIEWS.views,vh*TEST_VIEWS.rows.length],
    [out(outRoot,'props','placa.webp'),TEST_NINESLICE.cell[0],TEST_NINESLICE.cell[1]],
    [out(outRoot,'itens','moeda.webp'),TEST_FRAMES.cell*TEST_FRAMES.frames,TEST_FRAMES.cell],
    [out(outRoot,'ui','botao.webp'),TEST_ICON,TEST_ICON],
  ];
  const written=new Set(r.written.map(f=>norm(outRoot,f)));
  for(const [file,w,h] of expected){
    assert.ok(existsSync(file),`missing ${path.relative(outRoot,file)}`);
    assert.deepEqual(await sizeOf(file),[w,h,'webp'],path.relative(outRoot,file));
    assert.ok(written.has(norm(outRoot,file)),`not listed in written: ${path.relative(outRoot,file)}`);
  }
  // The real art folder is never touched: everything lands under outRoot.
  assert.ok(r.written.every(f=>norm(outRoot,f).startsWith(path.resolve(outRoot).toLowerCase())),r.written.join('\n'));
  for(const [group,list] of Object.entries(ids)){
    const manifest=JSON.parse(readFileSync(out(outRoot,group as keyof typeof GROUPS,'manifest.json'),'utf8'));
    assert.equal(manifest.version,2);assert.equal(manifest.group,group);
    for(const id of list){
      const entry=manifest.pieces[id];
      assert.ok(entry,`${group}/manifest.json lacks ${id}`);
      assert.match(entry.sha256,/^[0-9a-f]{64}$/,`${group}/${id} sha256`);
      const files=Object.values(entry.files) as {file:string,cell:number[]}[];
      assert.ok(files.length>0,`${group}/${id} lists no file`);
      for(const f of files)assert.ok(existsSync(path.resolve(out(outRoot,group as keyof typeof GROUPS),f.file))||existsSync(path.resolve(outRoot,f.file)),`${group}/${id}: manifest file ${f.file} does not exist`);
    }
  }
  const enemies=JSON.parse(readFileSync(out(outRoot,'inimigos','manifest.json'),'utf8')).pieces.blob;
  const idle=(Object.values(enemies.files) as any[]).find(f=>/idle\.webp$/.test(f.file));
  assert.deepEqual([idle.cell,idle.frames,idle.directions],[[cell,cell],TEST_ENEMY.anims.idle,8]);
  assert.deepEqual(idle.anchor??[...ANCHOR],[...ANCHOR]);

  // dir8 split: each 3-row block of the outputs carries the colour of the input block it came from.
  const signatures=async(file:string)=>{
    const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const blockH=192*3,blocks=info.height/blockH;
    return Array.from({length:blocks},(_,b)=>{
      const sum=[0,0,0];let n=0;
      for(let y=b*blockH;y<(b+1)*blockH;y+=2)for(let x=0;x<info.width;x+=2){
        const i=(y*info.width+x)*4;if(data[i+3]>200){sum[0]+=data[i];sum[1]+=data[i+1];sum[2]+=data[i+2];n++;}
      }
      const mean=sum.map(s=>s/n);
      return DIRECTIONS.reduce((best,d)=>{
        const dist=(c:number[])=>c.reduce((a,v,k)=>a+(v-mean[k])**2,0);
        return dist(DIRECTION_COLORS[d])<dist(DIRECTION_COLORS[best])?d:best;
      },DIRECTIONS[0]);
    });
  };
  assert.deepEqual(await signatures(path.join(input,'personagens',`${DIR8_OK}.dir8.png`)),[...DIRECTIONS],'input block order');
  assert.deepEqual(await signatures(out(outRoot,'personagens',`${DIR8_OK}.dir4.webp`)),[...DIR4_FROM_DIR8],'dir4 = SE, SW, NE, NW');
  assert.deepEqual(await signatures(out(outRoot,'personagens',`${DIR8_OK}.dir4c.webp`)),[...CARDINALS],'dir4c = S, W, N, E');

  // The hero atlas carries the measures the game scales it by (96 world px, D-030), taken from the written pixels;
  // the client turns that entry into the sheet it loads for `sprite:<id>:dir4`.
  const heroEntry=JSON.parse(readFileSync(out(outRoot,'personagens','manifest.json'),'utf8')).pieces[DIR8_OK];
  const measured=heroMeasures(await raw(out(outRoot,'personagens',`${DIR8_OK}.dir4.webp`)));
  assert.ok(measured&&measured.height>0,'atlas measured');
  assert.deepEqual([heroEntry.files.dir4.height,heroEntry.files.dir4.figure],[measured!.height,measured!.figure]);
  assert.equal(heroEntry.files.dir4c.height,undefined,'only the diagonal atlas is measured');
  setArtIndex(parseArtIndex({version:2,groups:{personagens:{output:GROUPS.personagens.output,pieces:{[DIR8_OK]:heroEntry}}}}));
  assert.deepEqual(importedSheet(DIR8_OK),{url:`/art/lite/sprites/${DIR8_OK}.dir4.webp`,height:measured!.height,figure:measured!.figure});
  setArtIndex(parseArtIndex(undefined));

  // Per-file manifest merge: a later delivery of only the downed sheet keeps the dir4/dir4c entries and files.
  const charManifest=()=>JSON.parse(readFileSync(out(outRoot,'personagens','manifest.json'),'utf8')).pieces[DIR8_OK];
  const before=charManifest(),input2=path.join(dir,'entrada-2');
  await writeDowned(path.join(input2,'personagens',`${DIR8_OK}.downed.png`));
  const r2:Result=await importArtV2({input:input2,repoRoot,outRoot,groups:{personagens:GROUPS.personagens},write:true});
  const downed=piece(r2,'personagens',DIR8_OK);
  assert.equal(downed.status,'aprovado',downed.problems.join(' | '));
  assert.ok(downed.notes.some(n=>n.includes(`${DIR8_OK}.dir8.png`)),`note about the absent atlas: ${downed.notes.join(' | ')}`);
  const after=charManifest();
  assert.deepEqual(Object.keys(after.files).sort(),['dir4','dir4c','downed']);
  assert.deepEqual([after.files.dir4,after.files.dir4c],[before.files.dir4,before.files.dir4c]);
  assert.notEqual(after.sha256,before.sha256,'piece hash covers the new file');
  for(const f of ['dir4','dir4c'])assert.ok(existsSync(out(outRoot,'personagens',`${DIR8_OK}.${f}.webp`)),`${f} atlas removed`);
  assert.deepEqual(await sizeOf(out(outRoot,'personagens',`${DIR8_OK}.downed.webp`)),[1152,1536,'webp']);
}));

/** Each planted fault: group, id, a fragment that names the file, and the fault (pt-BR). */
const FAULTS:{group:string,id:string,file:string,fault:RegExp}[]=[
  {group:'inimigos',id:'tamanho-errado',file:'idle.png',fault:/128\s*[×x]\s*448/},
  {group:'inimigos',id:'fundo-opaco',file:'idle.png',fault:/transpar|fundo|alfa/i},
  {group:'inimigos',id:'celula-vazia',file:'walk.png',fault:/vazi/i},
  {group:'inimigos',id:'na-borda',file:'idle.png',fault:/borda|encost|margem/i},
  {group:'inimigos',id:'pe-fora-linha',file:'idle.png',fault:/p[ée]s.*(linha|y\s*=)|(linha|y\s*=).*p[ée]s/i},
  {group:'inimigos',id:'pe-fora-centro',file:'walk.png',fault:/p[ée]s.*(centr|coluna|x\s*=)/i},
  {group:'inimigos',id:'quadros-errados',file:'walk.png',fault:/quadro|192\s*[×x]\s*512/i},
  {group:'inimigos',id:'sem-animacoes',file:'inimigos/sem-animacoes/',fault:/nenhuma animação/i},
  {group:'inimigos',id:'sem-meta',file:'meta.json',fault:/falt|ausente|não (foi )?encontrad|não existe|sem /i},
  {group:'inimigos',id:'meta-invalido',file:'meta.json',fault:/inválid|JSON|ler|leitura|formato/i},
  {group:'inimigos',id:'ancora-errada',file:'meta.json',fault:/âncora|anchor/i},
  {group:'personagens',id:DIR8_WRONG_COLUMN,file:`${DIR8_WRONG_COLUMN}.dir8.png`,fault:/p[ée]s.*(centr|coluna|x\s*=)/i},
  {group:'personagens',id:DIR8_LIFTED,file:`${DIR8_LIFTED}.dir8.png`,fault:/(nordeste|\bNE\b).*(p[ée]s|linha)|(p[ée]s|linha).*(nordeste|\bNE\b)/i},
  {group:'predios',id:VIEWS_BROKEN.wrongViews,file:`${VIEWS_BROKEN.wrongViews}.png`,fault:/vista|96\s*[×x]\s*96/i},
  {group:'predios',id:VIEWS_BROKEN.wrongRows,file:`${VIEWS_BROKEN.wrongRows}.png`,fault:/linha|128\s*[×x]\s*144/i},
  {group:'itens',id:FRAMES_BROKEN,file:`${FRAMES_BROKEN}.png`,fault:/quadro|96\s*[×x]\s*32/i},
  {group:'chao',id:SEAMLESS_BROKEN,file:`${SEAMLESS_BROKEN}.png`,fault:/emend|cont[íi]nu|seamless|ladrilh|repet|encaix|borda/i},
  {group:'chao',id:MASK_BROKEN,file:`${MASK_BROKEN}.png`,fault:/cinza|gray|tons|colorid|m[áa]scara/i},
  {group:'props',id:NINESLICE_BROKEN,file:NINESLICE_BROKEN,fault:/slice|corte|nove/i},
  {group:'ui',id:ICON_BROKEN,file:`${ICON_BROKEN}.png`,fault:/40\s*[×x]\s*40|\b32\b/},
];

test('every planted fault is refused with a pt-BR message naming the file and the fault; nothing is written',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida');
  await makeErrorSet(input,{repoRoot});
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups:testGroups(Object.keys(ENEMY_FAULTS)),write:true});
  const failures:string[]=[];
  for(const {group,id,file,fault} of FAULTS){
    const p=r.pieces.find(x=>x.group===group&&x.id===id);
    if(!p){failures.push(`${group}/${id}: no result`);continue;}
    if(p.status!=='reprovado')failures.push(`${group}/${id}: status ${p.status}, expected reprovado (${p.problems.join(' | ')})`);
    else if(!p.problems.some(m=>m.includes(file)&&fault.test(m)))failures.push(`${group}/${id}: no problem naming ${file} and matching ${fault}; got: ${p.problems.join(' | ')||'(none)'}`);
  }
  assert.deepEqual(failures,[],failures.join('\n'));
  assert.deepEqual(r.written,[],'nothing written for refused pieces');
  for(const {group,id} of FAULTS){
    const g=group as keyof typeof GROUPS;
    for(const f of [out(outRoot,g,id),out(outRoot,g,`${id}.webp`),out(outRoot,g,`${id}.dir4.webp`),out(outRoot,g,`${id}.dir4c.webp`)])
      assert.ok(!existsSync(f),`written for a refused piece: ${path.relative(outRoot,f)}`);
    const manifest=out(outRoot,g,'manifest.json');
    if(existsSync(manifest))assert.ok(!JSON.parse(readFileSync(manifest,'utf8')).pieces?.[id],`${id} in ${group} manifest`);
  }
}));

test('partial delivery: good written, bad refused, absent pending, old manifest entry kept; HTML report',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida'),reportFile=path.join(dir,'relatorio.html');
  await writeEnemy(path.join(input,'inimigos','blob'));
  await writeEnemy(path.join(input,'inimigos','fundo-opaco'),{fault:'opaque'});
  // 'ausente' was imported before and is not in this delivery: its art and manifest entry stay.
  const old={kind:'animations',files:{idle:{file:'ausente/idle.webp',cell:[64,64],frames:2,directions:8}},sha256:'0'.repeat(64)};
  mkdirSync(out(outRoot,'inimigos','ausente'),{recursive:true});
  writeFileSync(out(outRoot,'inimigos','ausente','idle.webp'),'old art');
  writeFileSync(out(outRoot,'inimigos','manifest.json'),JSON.stringify({version:2,group:'inimigos',pieces:{ausente:old}}));
  const groups={inimigos:testGroups(['blob','fundo-opaco','ausente']).inimigos};
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups,write:true,reportFile});
  const good=piece(r,'inimigos','blob'),bad=piece(r,'inimigos','fundo-opaco'),absent=piece(r,'inimigos','ausente');
  assert.equal(good.status,'aprovado',good.problems.join(' | '));
  assert.equal(bad.status,'reprovado');
  assert.equal(absent.status,'pendente');
  assert.ok(existsSync(out(outRoot,'inimigos','blob','idle.webp')));
  assert.ok(!existsSync(out(outRoot,'inimigos','fundo-opaco')),'refused piece written');
  assert.equal(readFileSync(out(outRoot,'inimigos','ausente','idle.webp'),'utf8'),'old art');
  const manifest=JSON.parse(readFileSync(out(outRoot,'inimigos','manifest.json'),'utf8'));
  assert.deepEqual(Object.keys(manifest.pieces).sort(),['ausente','blob']);
  assert.deepEqual(manifest.pieces.ausente,old);

  assert.equal(path.resolve(r.reportFile??''),path.resolve(reportFile));
  assert.ok(existsSync(reportFile),'report not written');
  const html=readFileSync(reportFile,'utf8');
  for(const id of ['blob','fundo-opaco','ausente'])assert.ok(html.includes(id),`report lacks ${id}`);
  assert.match(bad.thumb??'',/^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/,'refused piece thumbnail');
  assert.ok(html.includes(bad.thumb!),'report lacks the refused thumbnail');
}));

test('the placeholder silhouette (inventário §2): 8 directions of 192 px in one row; a wrong size is refused',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'art-v2-silhueta-'));
  try{
    const cell=192,width=cell*DIRECTIONS.length;
    // A grey figure per direction, centred, feet on the 0.88 line, 2 px clear of every border.
    const sheet=(height:number)=>{const data=Buffer.alloc(width*height*4);
      for(let d=0;d<DIRECTIONS.length;d++)for(let y=100;y<Math.min(height-2,Math.round(ANCHOR[1]*cell));y++)for(let x=76;x<116;x++){
        const i=(y*width+d*cell+x)*4;data[i]=data[i+1]=data[i+2]=90;data[i+3]=255;}
      return sharp(data,{raw:{width,height,channels:4}}).png().toBuffer();};
    const run=async(height:number)=>{
      const input=path.join(root,`in-${height}`),out=path.join(root,`out-${height}`);
      mkdirSync(path.join(input,'personagens'),{recursive:true});
      writeFileSync(path.join(input,'personagens','_silhueta.png'),await sheet(height));
      const r=await importArtV2({input,repoRoot,outRoot:out,groups:{personagens:GROUPS.personagens}}) as Result;
      return {piece:r.pieces.find(p=>p.id==='_silhueta')!,out};
    };
    const ok=await run(cell);
    assert.equal(ok.piece.status,'aprovado',ok.piece.problems.join('\n'));
    const meta=await sharp(path.join(ok.out,'public/art/sprites/_silhueta.webp')).metadata();
    assert.deepEqual([meta.width,meta.height],[width,cell]);
    const bad=await run(cell-2);
    assert.equal(bad.piece.status,'reprovado');
    assert.match(bad.piece.problems.join('\n'),/_silhueta\.png.*1536/);
    assert.ok(!existsSync(path.join(bad.out,'public/art/sprites/_silhueta.webp')));
  }finally{rmSync(root,{recursive:true,force:true});}
});

// ---------------------------------------------------------------- small scenarios
const enemies=(pieces:Record<string,Record<string,number>>)=>({inimigos:{...GROUPS.inimigos,
  pieces:Object.fromEntries(Object.entries(pieces).map(([id,anims])=>[id,{cell:TEST_ENEMY.cell,anims}]))}});
const readManifestOf=(outRoot:string,group:keyof typeof GROUPS)=>JSON.parse(readFileSync(out(outRoot,group,'manifest.json'),'utf8'));
const approved=(p:Piece)=>assert.equal(p.status,'aprovado',`${p.group}/${p.id}: ${p.problems.join(' | ')}`);
const refused=(p:Piece,re:RegExp)=>{
  assert.equal(p.status,'reprovado',`${p.group}/${p.id} should be refused`);
  assert.ok(p.problems.some(m=>re.test(m)),`${p.group}/${p.id}: no problem matching ${re}; got: ${p.problems.join(' | ')}`);
};

test('partial enemy (only idle): approved with a note naming the missing animation; manifest lists only idle',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida');
  await writeEnemy(path.join(input,'inimigos','parcial'),{fault:'missingAnim'});
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups:testGroups(['parcial']),write:true});
  const p=piece(r,'inimigos','parcial');
  approved(p);
  assert.ok(p.notes.some(n=>/inimigos\/parcial/.test(n)&&/\bwalk\b/.test(n)&&/falta/.test(n)),p.notes.join(' | '));
  assert.ok(!p.notes.some(n=>/falta.*\bidle\b/.test(n)),'idle came and is not reported missing');
  assert.deepEqual(Object.keys(readManifestOf(outRoot,'inimigos').pieces.parcial.files),['idle']);
  assert.ok(!existsSync(out(outRoot,'inimigos','parcial','walk.webp')));
}));

test('AIRBORNE animation off the line is approved; LUNGE off-centre approved but off the line refused',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida');
  await writeEnemy(path.join(input,'inimigos','voador'),{anims:{idle:2,fly:2},shift:{fly:{x:15,y:-12}}});
  await writeEnemy(path.join(input,'inimigos','empurra'),{anims:{idle:2,attack:2},shift:{attack:{x:15}}});
  await writeEnemy(path.join(input,'inimigos','tropeca'),{anims:{idle:2,attack:2},shift:{attack:{y:-12}}});
  const groups=enemies({voador:{idle:2,fly:2},empurra:{idle:2,attack:2},tropeca:{idle:2,attack:2}});
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups,write:true});
  approved(piece(r,'inimigos','voador'));
  approved(piece(r,'inimigos','empurra'));
  const bad=piece(r,'inimigos','tropeca');
  refused(bad,/attack\.png.*p[ée]s fora do ch[ãa]o/);
  assert.ok(!bad.problems.some(m=>/idle\.png/.test(m)),bad.problems.join(' | '));
}));

test('elite layer alone: approved over a base in the previous manifest, refused without it, noted for a base never approved',async()=>withTemp(async dir=>{
  const groups=enemies({blob:{...TEST_ENEMY.anims}});
  const run=async(name:string,elite:string,previous?:object)=>{
    const input=path.join(dir,`in-${name}`),outRoot=path.join(dir,`out-${name}`);
    await writeEliteLayer(path.join(input,'inimigos','elite',`blob-${elite}.png`));
    if(previous){
      mkdirSync(out(outRoot,'inimigos'),{recursive:true});
      writeFileSync(out(outRoot,'inimigos','manifest.json'),JSON.stringify({version:2,group:'inimigos',pieces:{blob:previous}}));
    }
    const r:Result=await importArtV2({input,repoRoot,outRoot,groups,write:true});
    return {p:piece(r,'inimigos','blob'),outRoot};
  };
  const idle={file:'blob/idle.webp',cell:[64,64],frames:2,directions:8,sha256:'1'.repeat(64)};
  const prev={kind:'animations',files:{idle},sha256:'2'.repeat(64)};

  const none=await run('none','idle');
  refused(none.p,/elite.*sem a pe[çc]a base/);
  assert.ok(!existsSync(out(none.outRoot,'inimigos')),'nothing written without a base');

  const ok=await run('ok','idle',prev);
  approved(ok.p);
  assert.deepEqual(ok.p.outputs,['public/art/enemies/elite/blob-idle.webp']);
  const merged=readManifestOf(ok.outRoot,'inimigos').pieces.blob;
  assert.deepEqual(Object.keys(merged.files).sort(),['elite/idle','idle']);
  assert.deepEqual(merged.files.idle,idle,'the base entry is kept');

  const walk=await run('walk','walk',prev);
  assert.ok(walk.p.notes.some(n=>/blob-walk\.png/.test(n)&&/ignorada/.test(n)),walk.p.notes.join(' | '));
  assert.notEqual(walk.p.status,'aprovado');
  assert.ok(!existsSync(out(walk.outRoot,'inimigos','elite','blob-walk.webp')));
}));

test('rest rows sleep/wake (one row, S) and the elite round variants: approved with their sidecars; a rest row of 8 directions is refused',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida'),c=TEST_ENEMY.cell;
  const enemy=path.join(input,'inimigos','pombos');
  await writeEnemy(enemy);
  // sleep: 6 frames, wake: 4, cut from the idle's S row (the figure stays on the anchor).
  const cell=await sharp(path.join(enemy,'idle.png')).extract({left:0,top:0,width:c,height:c}).png().toBuffer();
  const strip=async(file:string,frames:number,rows=1)=>sharp({create:{width:frames*c,height:rows*c,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
    .composite(Array.from({length:frames*rows},(_,i)=>({input:cell,left:(i%frames)*c,top:Math.floor(i/frames)*c}))).png().toFile(file);
  await strip(path.join(enemy,'sleep.png'),6);
  await strip(path.join(enemy,'wake.png'),4);
  writeFileSync(path.join(enemy,'sleep.meta.json'),JSON.stringify({cell:[c,c],frames:6,fps:8,loop:true,anchor:ANCHOR}));
  await writeEliteLayer(path.join(input,'inimigos','elite','pombos-idle.png'));
  await writeEliteLayer(path.join(input,'inimigos','elite','pombos-gorro-idle.png'));
  writeFileSync(path.join(input,'inimigos','elite','pombos-gorro-idle.meta.json'),'{}');
  const groups=enemies({pombos:{...TEST_ENEMY.anims}});
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups,write:true});
  approved(piece(r,'inimigos','pombos'));
  const files=readManifestOf(outRoot,'inimigos').pieces.pombos.files;
  assert.deepEqual(Object.keys(files).sort(),['elite/gorro/idle','elite/idle','idle','sleep','wake','walk']);
  assert.equal(files.sleep.directions,1);assert.equal(files.sleep.frames,6);assert.equal(files.wake.frames,4);
  assert.equal(files['elite/gorro/idle'].file,'elite/pombos-gorro-idle.webp');
  // A rest row drawn in 8 directions: refused, naming the one-row rule.
  const bad=path.join(dir,'bad');await writeEnemy(path.join(bad,'inimigos','pombos'));
  await strip(path.join(bad,'inimigos','pombos','sleep.png'),6,8);
  const r2:Result=await importArtV2({input:bad,repoRoot,outRoot:path.join(dir,'saida2'),groups,write:false});
  refused(piece(r2,'inimigos','pombos'),/sleep\.png.*uma linha s[óo]/);
}));

test('seamless: transparent telegraph fill, x-only strip and a high-contrast cobble tile approved; one broken stretch refused naming the side',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida');
  await writeSeamless(path.join(input,'efeitos','preenchimento.png'),{transparent:true});
  json(path.join(input,'efeitos','preenchimento.json'),{kind:'seamless',cell:[32,32],transparent:true});
  await writeSeamless(path.join(input,'efeitos','borda.png'),{width:32,height:8,pattern:'stripX',transparent:true});
  json(path.join(input,'efeitos','borda.json'),{kind:'seamless',cell:[32,8],wrap:'x',transparent:true});
  await writeSeamless(path.join(input,'cenario/chao/teste','pedra-1.png'),{pattern:'cobble'});
  await writeSeamless(path.join(input,'cenario/chao/teste','neve-rasgo.png'),{breakRows:[8,11]});
  const groups={chao:{...GROUPS.chao,size:TEST_TILE},efeitos:GROUPS.efeitos};
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups,write:true});
  approved(piece(r,'efeitos','preenchimento'));
  approved(piece(r,'efeitos','borda'));
  approved(piece(r,'chao','teste/pedra-1'));
  const bad=piece(r,'chao','teste/neve-rasgo');
  refused(bad,/neve-rasgo\.png.*horizontal.*direita.*1 de 8 trechos \(y = 8–11\)/);
  assert.ok(!bad.problems.some(m=>/vertical/.test(m)),bad.problems.join(' | '));
  assert.ok(!existsSync(out(outRoot,'chao','teste','neve-rasgo.webp')));
  assert.deepEqual(await sizeOf(out(outRoot,'efeitos','borda.webp')),[32,8,'webp']);
  assert.equal((await sharp(out(outRoot,'efeitos','preenchimento.webp')).metadata()).hasAlpha,true);
  assert.ok(existsSync(out(outRoot,'chao','teste','pedra-1.webp')));
}));

test('manifest of a seamless piece records its wrap and transparent (spec.mjs manifest fields)',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida');
  await writeSeamless(path.join(input,'efeitos','borda.png'),{width:32,height:8,pattern:'stripX',transparent:true});
  json(path.join(input,'efeitos','borda.json'),{kind:'seamless',cell:[32,8],wrap:'x',transparent:true});
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups:{efeitos:GROUPS.efeitos},write:true});
  approved(piece(r,'efeitos','borda'));
  const sheet=readManifestOf(outRoot,'efeitos').pieces.borda.files.sheet;
  assert.deepEqual({cell:sheet.cell,wrap:sheet.wrap,transparent:sheet.transparent},{cell:[32,8],wrap:'x',transparent:true});
}));

test('app icon full-bleed opaque approved at its own size; chao "frames" piece approved',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida');
  await writeIcon(path.join(input,'ui','app-icon.png'),{size:64,opaque:true});
  await writeFrames(path.join(input,'cenario/chao/praia','espuma.png'),{cell:[32,16],frames:4});
  json(path.join(input,'cenario/chao/praia','espuma.json'),{kind:'frames',cell:[32,16],frames:4});
  const groups={chao:{...GROUPS.chao,size:TEST_TILE},ui:{...GROUPS.ui,size:TEST_ICON,sizes:{'app-icon':64}}};
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups,write:true});
  approved(piece(r,'ui','app-icon'));
  assert.deepEqual(await sizeOf(out(outRoot,'ui','app-icon.webp')),[64,64,'webp']);
  approved(piece(r,'chao','praia/espuma'));
  assert.deepEqual(await sizeOf(out(outRoot,'chao','praia','espuma.webp')),[128,16,'webp']);
  const entry=readManifestOf(outRoot,'chao').pieces['praia/espuma'];
  assert.deepEqual([entry.kind,entry.files.sheet.cell,entry.files.sheet.frames],['frames',[32,16],4]);
}));

test('views: a corner anchor in the sidecar is approved; non-character messages never talk about "boneco"',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida');
  await writeCornerViews(path.join(input,'cenario/predios','esquina.png'),{anchor:[.25,.9]});
  json(path.join(input,'cenario/predios','esquina.json'),{cell:TEST_VIEWS.cell,views:4,rows:['inteiro'],anchor:[.25,.9]});
  await writeViews(path.join(input,'cenario/predios','torto.png'));
  json(path.join(input,'cenario/predios','torto.json'),{...TEST_VIEWS,anchor:[.2,.6]});
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups:{predios:GROUPS.predios},write:true});
  const corner=piece(r,'predios','esquina');
  approved(corner);
  assert.ok(!corner.problems.some(m=>/centraliz/i.test(m)));
  const bad=piece(r,'predios','torto');
  refused(bad,/torto\.png.*base do desenho fora da linha de apoio.*torto\.json/);
  refused(bad,/torto\.png.*base do desenho fora do ponto de apoio/);
  for(const m of bad.problems)assert.doesNotMatch(m,/boneco|p[ée]s\b/i);
}));

test('input errors give clean pt-BR messages: corrupt PNG, bad JSON, frames without cell, bad names, kind not accepted',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida'),items=path.join(input,'itens');
  const badNames=['moeda grande','moéda','Moeda','a..b'];
  writeCorrupt(path.join(items,'quebrado.png'));
  await writeFrames(path.join(items,'ruim.png'));
  writeFileSync(path.join(items,'ruim.json'),'{\n  "cell": [32,32],\n  "frames" 4\n}\n');
  await writeFrames(path.join(items,'barra.png'),{cell:[50,32],frames:1});
  for(const name of badNames)await writeFrames(path.join(items,`${name}.png`));
  await writeFrames(path.join(items,'textura.png'));
  json(path.join(items,'textura.json'),{kind:'seamless'});
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups:{itens:GROUPS.itens},write:true});
  refused(piece(r,'itens','quebrado'),/itens\/quebrado\.png: .*(PNG|corromp)/);
  refused(piece(r,'itens','ruim'),/itens\/ruim\.json: .*linha 3/);
  refused(piece(r,'itens','barra'),/itens\/barra\.png: 50×32 .*"cell"/);
  for(const name of badNames)refused(piece(r,'itens',name),new RegExp(`nome "${name.replace(/\./g,'\\.')}" inválido`));
  refused(piece(r,'itens','textura'),/textura\.json: .*"seamless".*não é aceito em itens/);
  const english=/\b(input|unsupported|error|unexpected|token|position|buffer|vips|sharp|expected)\b/i;
  for(const p of r.pieces)for(const m of p.problems)assert.doesNotMatch(m,english,`${p.id}: ${m}`);
  assert.deepEqual(r.written,[]);
  assert.ok(!existsSync(outRoot),'nothing written');
}));

test('write:false writes nothing and lists the planned files; a re-run is idempotent (same bytes and sha256)',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida');
  await writeEnemy(path.join(input,'inimigos','blob'));
  await writeFrames(path.join(input,'itens','moeda.png'));
  const groups={inimigos:testGroups(['blob']).inimigos,itens:GROUPS.itens};
  const outputs=(r:Result)=>[...piece(r,'inimigos','blob').outputs,...piece(r,'itens','moeda').outputs].sort();
  const dry:Result=await importArtV2({input,repoRoot,outRoot,groups,write:false});
  assert.deepEqual(dry.written,[]);
  assert.ok(!existsSync(outRoot),'dry run wrote something');
  const planned=['public/art/enemies/blob/idle.webp','public/art/enemies/blob/walk.webp','public/art/items/moeda.webp'];
  assert.deepEqual(outputs(dry),planned);

  const first:Result=await importArtV2({input,repoRoot,outRoot,groups,write:true});
  assert.deepEqual(outputs(first),planned,'dry run matches the real run');
  const snapshot=()=>Object.fromEntries([...planned,'public/art/enemies/manifest.json','public/art/items/manifest.json']
    .map(f=>[f,readFileSync(path.join(outRoot,f)).toString('base64')]));
  const once=snapshot();
  await importArtV2({input,repoRoot,outRoot,groups,write:true});
  assert.deepEqual(snapshot(),once,'second run changed a file');
  assert.match(readManifestOf(outRoot,'itens').pieces.moeda.sha256,/^[0-9a-f]{64}$/);
  const leftovers=(d:string):string[]=>readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?leftovers(path.join(d,e.name)):/\.tmp$/.test(e.name)?[e.name]:[]);
  assert.deepEqual(leftovers(outRoot),[],'temp files left behind');
}));

const pageRows=(entry:any)=>entry.pages.map(({file,columns,rows,firstFrame,frameCount}:any)=>[file,columns,rows,firstFrame,frameCount]);
const region=(file:string,left:number,top:number,width:number,height:number)=>sharp(file).extract({left,top,width,height}).ensureAlpha().raw().toBuffer();

test('pagination: a strip wider than 4096 px that fits one page is reflowed into a single -p1 page',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida');
  // 4 frames of 1100×8 = 4400 px wide: 3 columns per page, so the 4th frame goes to a second row of the same page.
  await writeFrames(path.join(input,'itens','faixa.png'),{cell:[1100,8],frames:4});
  json(path.join(input,'itens','faixa.json'),{cell:[1100,8],frames:4});
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups:{itens:GROUPS.itens},write:true});
  const p=piece(r,'itens','faixa');
  approved(p);
  assert.ok(p.notes.some(n=>/4400×8/.test(n)&&/p[áa]ginas/.test(n)),p.notes.join(' | '));
  assert.deepEqual(p.outputs,['public/art/items/faixa-p1.webp']);
  assert.ok(!existsSync(out(outRoot,'itens','faixa.webp')));
  assert.deepEqual(await sizeOf(out(outRoot,'itens','faixa-p1.webp')),[3300,16,'webp']);
  assert.deepEqual(pageRows(readManifestOf(outRoot,'itens').pieces.faixa.files.sheet),[['faixa-p1.webp',3,2,0,4]]);
  const source=path.join(input,'itens','faixa.png'),page=out(outRoot,'itens','faixa-p1.webp');
  assert.ok((await region(source,3300,0,1100,8)).equals(await region(page,0,8,1100,8)),'frame 4 starts the second row');
}));

test('pagination: a sheet over 4096 px is approved and written as -p1/-p2 pages, each within 4096, listed in the manifest',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida');
  // Smallest sheet that needs two pages: 2 frames of 2049×2049 (one frame per 4096 page).
  const c=2049;
  await writeFrames(path.join(input,'itens','placa.png'),{cell:[c,c],frames:2});
  json(path.join(input,'itens','placa.json'),{cell:[c,c],frames:2});
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups:{itens:GROUPS.itens},write:true});
  const p=piece(r,'itens','placa');
  approved(p);
  assert.ok(p.notes.some(n=>/4098×2049/.test(n)&&/p[áa]ginas/.test(n)),p.notes.join(' | '));
  assert.deepEqual(p.outputs,['public/art/items/placa-p1.webp','public/art/items/placa-p2.webp']);
  assert.ok(!existsSync(out(outRoot,'itens','placa.webp')));
  for(const n of [1,2])assert.deepEqual(await sizeOf(out(outRoot,'itens',`placa-p${n}.webp`)),[c,c,'webp']);
  const entry=readManifestOf(outRoot,'itens').pieces.placa.files.sheet;
  assert.equal(entry.file,undefined);
  assert.deepEqual(pageRows(entry),[['placa-p1.webp',1,1,0,1],['placa-p2.webp',1,1,1,1]]);
  for(const page of entry.pages)assert.match(page.sha256,/^[0-9a-f]{64}$/);
  const source=path.join(input,'itens','placa.png');
  assert.ok((await region(source,c,0,c,c)).equals(await region(out(outRoot,'itens','placa-p2.webp'),0,0,c,c)),'page 2 holds frame 2');
}));

test('thumbnail of a refused piece fits 256×256 and comes from the faulty file',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida');
  await writeEnemy(path.join(input,'inimigos','pe-fora-centro'),{fault:'footX'});
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups:testGroups(['pe-fora-centro']),write:true});
  const p=piece(r,'inimigos','pe-fora-centro');
  refused(p,/walk\.png/);
  assert.ok(!p.problems.some(m=>/idle\.png/.test(m)));
  const thumb=Buffer.from((p.thumb??'').replace(/^data:image\/png;base64,/,''),'base64');
  const {data,info}=await sharp(thumb).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.deepEqual([info.width,info.height],[64,256],'128×512 sheet fitted inside 256×256');
  const fitted=async(f:string)=>{
    const png=await sharp(path.join(input,'inimigos','pe-fora-centro',f)).resize({width:256,height:256,fit:'inside',withoutEnlargement:true}).png().toBuffer();
    return sharp(png).ensureAlpha().raw().toBuffer();
  };
  assert.ok(data.equals(await fitted('walk.png')),'thumbnail is the faulty walk.png');
  assert.ok(!data.equals(await fitted('idle.png')),'thumbnail is not idle.png');
}));

test('report: text is escaped and approved pieces carry no thumbnail',()=>{
  const thumb='data:image/png;base64,iVBORw0KGgo=';
  const html=renderReport([
    {group:'itens',id:'<script>alert(1)</script>',status:'reprovado',problems:['a & b "c" <img src=x>'],notes:[],files:[],outputs:[],source:'itens/<x>.png',thumb},
    {group:'itens',id:'moeda',status:'aprovado',problems:[],notes:['nota <b>'],files:[],outputs:['public/art/items/moeda.webp'],thumb},
  ],{generatedAt:new Date(2026,9,12,14,5)});
  assert.ok(!html.includes('<script>alert'),'raw script tag');
  assert.ok(!html.includes('<img src=x>')&&!html.includes('nota <b>'),'raw markup from messages');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('a &amp; b &quot;c&quot; &lt;img src=x&gt;'));
  assert.ok(html.includes('itens/&lt;x&gt;.png'));
  assert.equal(html.match(/<img class="thumb"/g)?.length,1,'only the refused piece has a thumbnail');
  const approvedItem=html.slice(html.indexOf('>moeda</span>'));
  assert.ok(!/<img/.test(approvedItem.slice(0,approvedItem.indexOf('</li>'))),'approved piece with a thumbnail');
});

// ---------------------------------------------------------------- P0 table, index, D-037 rim, demo delivery
test('P0 table: absent P0 pieces are pending, absent P1/P2 only optional; extra ids still accepted',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),reportFile=path.join(dir,'relatorio.html');
  await writeFrames(path.join(input,'itens','gema-pequena.png'),{cell:64,frames:4});
  await writeFrames(path.join(input,'itens','moeda.png'));
  mkdirSync(path.join(input,'inimigos'),{recursive:true});
  const r:Result=await importArtV2({input,repoRoot,outRoot:path.join(dir,'saida'),groups:{inimigos:GROUPS.inimigos,itens:GROUPS.itens},write:false,reportFile});
  approved(piece(r,'itens','gema-pequena'));
  approved(piece(r,'itens','moeda'));
  for(const id of ['gema-media','gema-grande','coxinha','ima','bau','recurso-coco','recurso-pedra'])
    assert.deepEqual([piece(r,'itens',id).status,piece(r,'itens',id).priority],['pendente','P0'],id);
  assert.deepEqual([piece(r,'itens','boleto-chuva').status,piece(r,'itens','boleto-chuva').priority],['opcional','P1']);
  for(const id of ['coach','motoboy','influencer'])assert.equal(piece(r,'inimigos',id).status,'opcional',id);
  assert.equal(piece(r,'inimigos','bebado').status,'pendente');
  const html=readFileSync(reportFile,'utf8');
  const optional=[...html.matchAll(/<p class="pending optional">[^\n]*?<\/p>/g)].map(m=>m[0]).join('\n');
  assert.match(optional,/Opcionais \(P1\/P2\).*<code>boleto-chuva<\/code>/);
  const pending=[...html.matchAll(/<p class="pending">[^\n]*?<\/p>/g)].map(m=>m[0]).join('\n');
  assert.match(pending,/<code>gema-media<\/code>/);
  assert.doesNotMatch(pending,/boleto-chuva|coach/,'P1 piece listed as pending');
  assert.match(summaryText(r,{input,dryRun:true}),/opcionais P1\/P2/);
  // Every pieces:'any' group carries its inventory table, in kebab-case, each entry with a priority.
  for(const g of ['chao','predios','base','props','itens','projeteis','efeitos','ui'] as const){
    const table=(GROUPS[g] as any).expected;
    assert.ok(table&&Object.keys(table).length,`${g} has no expected table`);
    for(const [id,e] of Object.entries(table) as [string,any][]){
      assert.match(id,/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/,`${g}/${id}`);
      assert.ok(['P0','P1','P2'].includes(e.priority),`${g}/${id} priority`);
    }
  }
}));

test('expected ids without a sidecar take the table cell/frames (192×128 strip); a sidecar overrides; a frame range is enforced',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida');
  await writeFrames(path.join(input,'efeitos','arroto.png'),{cell:[192,128],frames:6});
  await writeFrames(path.join(input,'efeitos','sombra-contato.png'),{cell:[128,64],frames:1});
  await writeFrames(path.join(input,'itens','gema-grande.png'),{cell:32,frames:4});
  json(path.join(input,'itens','gema-grande.json'),{cell:[32,32]});
  await writeFrames(path.join(input,'itens','gema-media.png'),{cell:32,frames:4});
  await writeFrames(path.join(input,'projeteis','chinelo.png'),{cell:64,frames:7});
  await writeFrames(path.join(input,'projeteis','boleto.png'),{cell:64,frames:5});
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups:{itens:GROUPS.itens,projeteis:GROUPS.projeteis,efeitos:GROUPS.efeitos},write:true});
  for(const [g,id] of [['efeitos','arroto'],['efeitos','sombra-contato'],['itens','gema-grande'],['projeteis','chinelo']]){
    const p=piece(r,g,id);approved(p);
    assert.ok(!p.notes.some(n=>/assumi/.test(n)),`${g}/${id} should not assume square frames: ${p.notes.join(' | ')}`);
  }
  const sheet=(g:keyof typeof GROUPS,id:string)=>readManifestOf(outRoot,g).pieces[id].files.sheet;
  assert.deepEqual([sheet('efeitos','arroto').cell,sheet('efeitos','arroto').frames],[[192,128],6]);
  assert.deepEqual([sheet('efeitos','sombra-contato').cell,sheet('efeitos','sombra-contato').frames],[[128,64],1]);
  assert.deepEqual([sheet('itens','gema-grande').cell,sheet('itens','gema-grande').frames],[[32,32],4],'sidecar cell wins');
  assert.equal(sheet('projeteis','chinelo').frames,7);
  refused(piece(r,'itens','gema-media'),/gema-media\.png: tamanho 128×32, esperado 256×64/);
  refused(piece(r,'projeteis','boleto'),/boleto\.png: 5 quadros de 64×64 px, esperado de 6 a 8/);
}));

test('a sidecar without "kind" keeps the table kind and cell (9-slice frame whose sidecar only gives "slice")',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida');
  await writeFrames(path.join(input,'efeitos','balao-fala.png'),{cell:[96,64],frames:1});
  json(path.join(input,'efeitos','balao-fala.json'),{slice:[16,16,16,16]});
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups:{efeitos:GROUPS.efeitos},write:true});
  approved(piece(r,'efeitos','balao-fala'));
  const entry=readManifestOf(outRoot,'efeitos').pieces['balao-fala'];
  assert.equal(entry.kind,'nineslice');
  const file:any=Object.values(entry.files)[0];
  assert.deepEqual([file.cell,file.slice],[[96,64],[16,16,16,16]]);
}));

test('index public/art/manifest.json: every group manifest merged, meta from table + sidecar; dry-run writes nothing',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida'),index=path.join(outRoot,...INDEX_FILE.split('/'));
  await writeSeamless(path.join(input,'cenario/chao/cidade-nevada','neve-fofa-1.png'));
  await writeSeamless(path.join(input,'cenario/chao/cidade-nevada','trans-neve-asfalto.png'),{gray:true});
  await writeViews(path.join(input,'cenario/predios','casa-terrea-1x1-1.png'),{rows:1});
  json(path.join(input,'cenario/predios','casa-terrea-1x1-1.json'),{cell:TEST_VIEWS.cell,anchor:TEST_VIEWS.anchor,rows:['inteira'],meta:{framesPerView:1,neve:'muita'}});
  await writeViews(path.join(input,'cenario/base','no-coco.png'),{rows:3});
  json(path.join(input,'cenario/base','no-coco.json'),{cell:TEST_VIEWS.cell,anchor:TEST_VIEWS.anchor});
  await writeIcon(path.join(input,'ui','chinelo.png'));
  const groups={chao:{...GROUPS.chao,size:TEST_TILE},predios:GROUPS.predios,base:GROUPS.base,ui:{...GROUPS.ui,size:TEST_ICON}};
  const dry:Result=await importArtV2({input,repoRoot,outRoot,groups,write:false});
  for(const p of dry.pieces.filter(p=>p.files.length))approved(p);
  assert.ok(!existsSync(outRoot),'dry run wrote something');

  const r:Result=await importArtV2({input,repoRoot,outRoot,groups,write:true});
  assert.ok(r.written.some(f=>norm(outRoot,f)===index.toLowerCase()),'index not listed in written');
  const idx=JSON.parse(readFileSync(index,'utf8'));
  assert.equal(idx.version,2);
  assert.equal(readFileSync(index,'utf8').split(/\n/).length,2,'minified: one line + newline');
  assert.deepEqual(Object.keys(idx.groups),['base','chao','predios','ui']);
  for(const g of Object.keys(idx.groups) as (keyof typeof GROUPS)[]){
    assert.equal(idx.groups[g].output,GROUPS[g].output);
    // The index is the group manifest without its hashes (manifesto-enxuto-3g), minified.
    assert.deepEqual(idx.groups[g].pieces,leanIndex(readManifestOf(outRoot,g).pieces),`${g}: index differs from its manifest`);
    assert.ok(!JSON.stringify(idx.groups[g]).includes('sha256'),`${g}: index still carries hashes`);
  }
  const meta=(g:string,id:string)=>idx.groups[g].pieces[id].meta;
  assert.deepEqual(meta('chao','cidade-nevada/neve-fofa-1'),{ground:'snow'});
  assert.deepEqual(meta('chao','cidade-nevada/trans-neve-asfalto'),{mask:true,between:['snow','asphalt']});
  assert.deepEqual(meta('predios','casa-terrea-1x1-1'),{footprint:[1,1],framesPerView:1,ruin:true,neve:'muita'});
  assert.deepEqual(idx.groups.predios.pieces['casa-terrea-1x1-1'].files.sheet.anchor,TEST_VIEWS.anchor);
  assert.deepEqual(meta('base','no-coco'),{states:['cheio','meio','vazio']});
  assert.deepEqual(idx.groups.base.pieces['no-coco'].files.sheet.rows,['cheio','meio','vazio'],'rows from the table');
  assert.deepEqual(meta('ui','chinelo'),{replaces:['i-chinelo','a-chinelo']});
  // The client contract reads it as is.
  const parsed=parseArtIndex(idx);
  assert.deepEqual(Object.keys(parsed.groups).sort(),['base','chao','predios','ui']);
  assert.ok(parsed.groups.chao.pieces['cidade-nevada/neve-fofa-1']);

  // A later run of one group keeps the other groups in the index; a re-run gives the same bytes.
  const before=readFileSync(index,'utf8');
  await importArtV2({input,repoRoot,outRoot,groups:{ui:groups.ui},write:true});
  assert.equal(readFileSync(index,'utf8'),before);
}));

test('D-037 rim: enemy sheets get #2A2018 at 85% only where the source alpha is 0, within 1.5 px; drawn pixels (even semi-transparent) are untouched; the elite layer has none',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida');
  await writeEnemy(path.join(input,'inimigos','blob'));
  // Semi-transparent details in the first cell: a 3×3 "glass" patch (alpha 128) inside the body and a soft edge pixel
  // (alpha 128) just left of it. A rim composited under the whole sprite would darken both.
  {
    const file=path.join(input,'inimigos','blob','idle.png');
    const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const c=TEST_ENEMY.cell;let x0=c,y0=c,x1=-1,y1=-1;
    for(let y=0;y<c;y++)for(let x=0;x<c;x++)if(data[(y*info.width+x)*4+3]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
    const cx=Math.round((x0+x1)/2),cy=Math.round((y0+y1)/2);
    const set=(x:number,y:number)=>{const i=(y*info.width+x)*4;data[i]=200;data[i+1]=220;data[i+2]=255;data[i+3]=128;};
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)set(cx+dx,cy+dy);
    set(x0-1,cy);
    await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png({compressionLevel:1}).toFile(file+'.tmp');
    writeFileSync(file,readFileSync(file+'.tmp'));rmSync(file+'.tmp');
  }
  await writeEliteLayer(path.join(input,'inimigos','elite','blob-idle.png'));
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups:{inimigos:testGroups(['blob']).inimigos},write:true});
  approved(piece(r,'inimigos','blob'));
  const rgba=async(file:string)=>{const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});return {data,w:info.width,h:info.height};};
  const src=await rgba(path.join(input,'inimigos','blob','idle.png')),dst=await rgba(out(outRoot,'inimigos','blob','idle.webp'));
  assert.deepEqual([dst.w,dst.h],[src.w,src.h]);
  const cell=TEST_ENEMY.cell,[rr,rg,rb]=[0x2a,0x20,0x18],rimAlpha=Math.round(RIM.alpha*255);
  const a=(img:typeof src,x:number,y:number)=>img.data[(y*img.w+x)*4+3];
  /** A source pixel matching `drawn` (by alpha) at Euclidean distance < `reach` from (x, y), in the same cell. */
  const near=(x:number,y:number,reach:number,drawn=(sa:number)=>sa>0)=>{
    const r=Math.ceil(reach);
    for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
      const nx=x+dx,ny=y+dy;
      if(Math.hypot(dx,dy)>=reach||nx<0||ny<0||nx>=src.w||ny>=src.h)continue;
      if(Math.floor(nx/cell)!==Math.floor(x/cell)||Math.floor(ny/cell)!==Math.floor(y/cell))continue;
      if(drawn(a(src,nx,ny)))return true;
    }
    return false;
  };
  let rim=0,inside=0,translucent=0;
  for(let y=0;y<src.h;y++)for(let x=0;x<src.w;x++){
    const i=(y*src.w+x)*4,sa=src.data[i+3],da=dst.data[i+3];
    if(sa>0){
      // Any original alpha (opaque body, the alpha-128 glass and soft edge): byte-identical.
      inside++;if(sa<255)translucent++;
      assert.deepEqual([...dst.data.subarray(i,i+4)],[...src.data.subarray(i,i+4)],`drawn pixel (alpha ${sa}) changed at ${x},${y}`);
    }else if(near(x,y,1.01,sa=>sa===255)){
      // Edge-adjacent to the opaque body: the full rim.
      rim++;
      assert.ok(Math.abs(dst.data[i]-rr)<=1&&Math.abs(dst.data[i+1]-rg)<=1&&Math.abs(dst.data[i+2]-rb)<=1&&Math.abs(da-rimAlpha)<=1,
        `rim pixel at ${x},${y} is ${[...dst.data.subarray(i,i+4)]}`);
    }else if(da>0){
      // Any other rim pixel: was alpha 0, within the 1.5 px dilation (+ the 0.5 px anti-aliased edge) of the drawing.
      assert.ok(near(x,y,2),`stray rim at ${x},${y}`);
      assert.ok(Math.abs(dst.data[i]-rr)<=1&&Math.abs(dst.data[i+1]-rg)<=1&&Math.abs(dst.data[i+2]-rb)<=1&&da<=rimAlpha+1,
        `rim pixel at ${x},${y} is ${[...dst.data.subarray(i,i+4)]}`);
    }
  }
  assert.ok(rim>100&&inside>100,`rim ${rim}, inside ${inside}`);
  assert.equal(translucent,10,'the 3×3 glass patch and the soft edge pixel reached the check');
  // Nothing reaches the cell border (the 2 px padding is the rim's room).
  for(let y=0;y<src.h;y++)for(let x=0;x<src.w;x+=cell)for(const bx of [x,x+cell-1])assert.equal(a(dst,bx,y),0,`cell border at ${bx},${y}`);
  // Elite layer: no rim.
  const esrc=await rgba(path.join(input,'inimigos','elite','blob-idle.png')),edst=await rgba(out(outRoot,'inimigos','elite','blob-idle.webp'));
  for(let k=3;k<esrc.data.length;k+=4)if(esrc.data[k]===0)assert.equal(edst.data[k],0,'rim on the elite layer');
  const entry=readManifestOf(outRoot,'inimigos').pieces.blob;
  assert.deepEqual(entry.rim,{...RIM});
  assert.deepEqual(entry.files.idle.rim,{...RIM});
  assert.equal(entry.files['elite/idle'].rim,undefined);
}));

test('demo delivery (tests/fixtures/art-v2/demo.mjs): real sizes, every piece approved, all in the index',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida');
  const pieces=await makeDemoDelivery(input,{repoRoot});
  const groups=Object.fromEntries(Object.keys(pieces).map(g=>[g,GROUPS[g as keyof typeof GROUPS]]));
  const r:Result=await importArtV2({input,repoRoot,outRoot,groups,write:true});
  assert.deepEqual(r.pieces.filter(p=>p.status==='reprovado').map(p=>`${p.group}/${p.id}: ${p.problems.join(' | ')}`),[]);
  const idx=JSON.parse(readFileSync(path.join(outRoot,...INDEX_FILE.split('/')),'utf8'));
  for(const [g,ids] of Object.entries(DEMO_PIECES))for(const id of ids){
    approved(piece(r,g,id));
    assert.ok(idx.groups[g]?.pieces[id],`index lacks ${g}/${id}`);
  }
  assert.deepEqual(await sizeOf(out(outRoot,'inimigos','bebado','walk.webp')),[128*8,128*8,'webp']);
  assert.deepEqual(await sizeOf(out(outRoot,'inimigos','pombos','fly.webp')),[96*6,96*8,'webp']);
  assert.ok(existsSync(out(outRoot,'inimigos','elite','bebado-walk.webp')),'elite crown');
  assert.deepEqual(Object.keys(idx.groups.inimigos.pieces.bebado.files).sort(),['elite/walk','idle','walk']);
  assert.deepEqual(idx.groups.inimigos.pieces.bebado.rim,{...RIM});
}));

test('heroMeasures: standing height of the first cell and the figure box over every cell (alpha > 20)',()=>{
  const width=192*6,height=192*12,data=Buffer.alloc(width*height*4);
  const paint=(x0:number,y0:number,x1:number,y1:number,a=255)=>{for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)data[(y*width+x)*4+3]=a;};
  paint(80,68,110,169);                 // first idle cell of front-right: 101 px tall
  paint(192+30,192*4+60,192+150,192*4+168);  // a wider attack cell elsewhere widens the box
  paint(5,5,8,8,20);                    // alpha 20 does not count
  assert.deepEqual(heroMeasures({data,width,height}),{height:101,figure:{left:30,top:60,right:150,bottom:169}});
  assert.equal(heroMeasures({data:Buffer.alloc(width*height*4),width,height}),undefined,'empty first cell');
});
