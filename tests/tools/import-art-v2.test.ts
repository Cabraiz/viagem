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
import {importArtV2} from '../../scripts/import-art-v2.mjs';
import {GROUPS,DIRECTIONS,DIR4_FROM_DIR8,CARDINALS,ANCHOR} from '../../scripts/art-v2/spec.mjs';
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
type Piece={group:string,id:string,status:'aprovado'|'reprovado'|'pendente',problems:string[],notes:string[],files:string[],outputs:string[],thumb?:string};
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
