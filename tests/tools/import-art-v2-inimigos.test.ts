/**
 * 173 enemies and towers (NEW-20261013-ORQ-importador-inimigos-173): the pack table generated from the board's .md
 * (scripts/art-v2/gen-enemies.mjs → enemies-table.mjs) is up to date and keeps the 9 first enemies as they were; the
 * synthetic delivery tests/fixtures/art-v2/enemies-towers.mjs (one enemy per role + towers) passes a dry run; an id
 * outside the table is "extra"; per-direction images are assembled in DIRECTIONS order; towers keep rows and views.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtempSync,rmSync,existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {importArtV2,summaryText} from '../../scripts/import-art-v2.mjs';
import {GROUPS,DIRECTIONS,TOWER_ROWS,TOWER_WALL_ROWS,PACK_ENEMIES} from '../../scripts/art-v2/spec.mjs';
import {ENEMY_ROLES,ENEMY_TABLE} from '../../scripts/art-v2/enemies-table.mjs';
import {generate,parsePack,parseRoles,DEFAULT_BOARD,TABLE_FILE,LEGACY_IDS} from '../../scripts/art-v2/gen-enemies.mjs';
import {assembleDirections} from '../../scripts/art-v2/validate.mjs';
import {raw} from '../../scripts/sprite-atlas.mjs';
import {
  writeEnemiesTowers,ENEMIES_TOWERS,ROLE_SAMPLES,PER_DIRECTION_ENEMY,DIRECTION_RGB,TOWER,WALL,
} from '../fixtures/art-v2/enemies-towers.mjs';

sharp.cache(false);sharp.concurrency(1);

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
type Piece={group:string,id:string,status:string,problems:string[],notes:string[],outputs:string[]};
const withTemp=async(fn:(dir:string)=>Promise<void>)=>{
  const dir=mkdtempSync(path.join(tmpdir(),'art-v2-173-'));
  try{await fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}
};
const find=(pieces:Piece[],group:string,id:string)=>{const p=pieces.find(x=>x.group===group&&x.id===id);assert.ok(p,`no result for ${group}/${id}`);return p;};
const save=async(file:string,width:number,height:number,rgb:number[])=>{
  mkdirSync(path.dirname(file),{recursive:true});
  const data=Buffer.alloc(width*height*4);
  // A block in the lower middle, transparent around.
  for(let y=Math.round(height*.3);y<Math.round(height*.88);y++)for(let x=Math.round(width*.35);x<Math.round(width*.65);x++)data.set([...rgb,255],(y*width+x)*4);
  await sharp(data,{raw:{width,height,channels:4}}).png().toFile(file);
};

// ---------------------------------------------------------------- generated table
test('enemies-table.mjs is what gen-enemies.mjs makes of the board .md (skipped without the board)',{skip:!existsSync(DEFAULT_BOARD)&&'board folder absent'},()=>{
  assert.equal(readFileSync(TABLE_FILE,'utf8').replace(/\r\n/g,'\n'),generate(DEFAULT_BOARD),'run node scripts/art-v2/gen-enemies.mjs');
});

test('table: 164 pack enemies with their role animations and cell; the 9 first enemies unchanged and first',()=>{
  const pieces=GROUPS.inimigos.pieces as Record<string,any>;
  assert.equal(Object.keys(ENEMY_TABLE).length,164);
  assert.deepEqual(Object.keys(pieces).slice(0,9),[...LEGACY_IDS]);
  assert.equal(Object.keys(pieces).length,173);
  assert.deepEqual(Object.fromEntries(LEGACY_IDS.map(id=>[id,pieces[id]])),{
    bebado:{cell:128,anims:{idle:6,walk:8,attack:6,hit:3,death:10},priority:'P0'},
    'anao-molotov':{cell:112,anims:{idle:6,walk:8,throw:8,hit:3,death:10},priority:'P0'},
    pombos:{cell:96,anims:{fly:6,poop:6,hit:2,death:6},priority:'P0'},
    'tio-pave':{cell:160,anims:{idle:6,walk:8,joke:8,shove:7,hit:3,death:10},priority:'P0'},
    agiota:{cell:128,anims:{idle:6,walk:8,throw:6,hit:3,death:8},priority:'P0'},
    chefe:{cell:384,anims:{idle:6,walk:8,slam:10,charge:8,summon:10,hit:3,'phase2-idle':6,death:16},priority:'P0'},
    coach:{cell:128,anims:{idle:6,walk:8,lecture:10,hit:3,death:8},priority:'P1'},
    motoboy:{cell:160,anims:{idle:4,aim:6,charge:6,crash:10},priority:'P1'},
    influencer:{cell:160,anims:{idle:6,walk:8,pose:8,hit:3,death:10},priority:'P1'},
  });
  for(const [id,e] of Object.entries(ENEMY_TABLE) as [string,any][]){
    assert.deepEqual(pieces[id],PACK_ENEMIES[id]);
    assert.deepEqual(pieces[id],{cell:e.cell,anims:{...(ENEMY_ROLES as any)[e.role].anims},priority:e.priority,role:e.role},id);
  }
  assert.equal(Object.keys(ENEMY_ROLES).length,13);
});

test('generator fails loudly on a malformed row, naming file and line',()=>{
  const roles=parseRoles('## 5. Roles\n| Role | What | Cell | Animations |\n|---|---|---|---|\n| `corredor` (runner) | x | 128 | idle 6, walk 8 |\n');
  assert.deepEqual(roles,{corredor:{cell:128,anims:{idle:6,walk:8}}});
  const head='| # | id | Name | Role | Cell | Concept | Accent | P |\n|---|---|---|---|---|---|---|---|\n';
  assert.equal(parsePack(`${head}| 1 | ok-id | N | corredor | 128 | c | a | P1 |\n`,'p.md',roles)[0].id,'ok-id');
  assert.throws(()=>parsePack(`${head}| 1 | x | N | voador | 128 | c | a | P0 |\n`,'p.md',roles),/p\.md:3: unknown role "voador"/);
  assert.throws(()=>parsePack(`${head}| 1 | x | N | corredor | 128 | c | P0 |\n`,'p.md',roles),/p\.md:3: row with 7 columns/);
  assert.throws(()=>parsePack(`${head}| 1 | Bad Id | N | corredor | 128 | c | a | P0 |\n`,'p.md',roles),/bad id/);
  assert.throws(()=>parsePack(`${head}| 1 | x | N | corredor | 12a | c | a | P0 |\n`,'p.md',roles),/bad cell/);
  assert.throws(()=>parsePack(`${head}| 1 | x | N | corredor | 128 | c | a | P3 |\n`,'p.md',roles),/bad priority/);
  assert.throws(()=>parseRoles('## 5. Roles\n| Role | a | Cell | Animations |\n|---|---|---|---|\n| x | y | 64 | walk six |\n'),/bad animation/);
});

// ---------------------------------------------------------------- fixture: dry run, extra
test('fixture (1 enemy per role + towers): dry run approved; an id outside the table is "extra"',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),reportFile=path.join(dir,'relatorio.html');
  await writeEnemiesTowers(input);
  mkdirSync(path.join(input,'inimigos','zumbi-inventado'),{recursive:true});
  writeFileSync(path.join(input,'inimigos','zumbi-inventado','idle.png'),'x');
  const r=await importArtV2({input,repoRoot,outRoot:path.join(dir,'saida'),groups:['inimigos','torres'],write:false,reportFile});
  const pieces=r.pieces as Piece[];
  assert.deepEqual(pieces.filter(p=>p.status==='reprovado').map(p=>`${p.id}: ${p.problems.join(' | ')}`),[]);
  for(const [g,ids] of Object.entries(ENEMIES_TOWERS))for(const id of ids)assert.equal(find(pieces,g,id).status,'aprovado',`${g}/${id}`);
  assert.equal(Object.keys(ROLE_SAMPLES).length,13);
  const extra=find(pieces,'inimigos','zumbi-inventado');
  assert.equal(extra.status,'extra');
  assert.match(extra.problems[0],/inimigos\/zumbi-inventado\/: "zumbi-inventado" não está na tabela de inimigos \(extra\)/);
  assert.equal(find(pieces,'inimigos','bebado').status,'pendente');
  assert.ok(!existsSync(path.join(dir,'saida','public')),'dry run wrote files');
  assert.match(summaryText(r,{input,dryRun:true}),/1 extra \(fora da tabela\)/);
  const html=readFileSync(reportFile,'utf8');
  assert.match(html,/extra \(fora da tabela\)<\/span><span class="piece-id">zumbi-inventado/);
}));

// ---------------------------------------------------------------- per-direction delivery
test('per-direction images are assembled in S, SW, W, NW, N, NE, E, SE row order',async()=>withTemp(async dir=>{
  const ctx={input:dir},dirs:Record<string,string>={};
  // Written in reverse order on disk, with a lower-case suffix for one: the row order comes from DIRECTIONS only.
  for(const d of [...DIRECTIONS].reverse()){dirs[d]=path.join(dir,'x',`walk-${d==='NW'?'nw':d}.png`);await save(dirs[d],96,32,DIRECTION_RGB[d as keyof typeof DIRECTION_RGB]);}
  const problems:string[]=[];
  const png=await assembleDirections(ctx,'inimigos/x','walk',{dirs},problems);
  assert.deepEqual(problems,[]);
  const img=await raw(png);
  assert.deepEqual([img.width,img.height],[96,32*8]);
  DIRECTIONS.forEach((d,row)=>{const i=((row*32+20)*96+48)*4;assert.deepEqual([...img.data.subarray(i,i+3)],DIRECTION_RGB[d as keyof typeof DIRECTION_RGB],d);});
  // Refusals: a missing direction, an unknown suffix, a different size.
  const bad:string[]=[];
  const {NE,...seven}=dirs;
  await assembleDirections(ctx,'inimigos/x','walk',{dirs:seven,unknown:[path.join(dir,'x','walk-XY.png')]},bad);
  assert.equal(bad.length,2,bad.join('\n'));
  assert.match(bad[0],/x\/walk-XY\.png: direção desconhecida no nome/);
  assert.match(bad[1],/inimigos\/x\/walk-\*\.png: falta a direção NE \(nordeste\)/);
  await save(NE,64,32,[1,2,3]);
  const sized:string[]=[];
  await assembleDirections(ctx,'inimigos/x','walk',{dirs:{...seven,NE}},sized);
  assert.match(sized.join('\n'),/x\/walk-NE\.png: tamanho 64×32, diferente de walk-S\.png \(96×32\)/);
}));

test('importer: a per-direction enemy is approved; sheet and per-direction together, or a missing direction, is refused',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada');
  await writeEnemiesTowers(input);
  const id=PER_DIRECTION_ENEMY,folder=path.join(input,'inimigos',id);
  // Keep only the per-direction enemy, then break one animation of a copy of it.
  const groups={inimigos:{...GROUPS.inimigos,pieces:{[id]:(GROUPS.inimigos.pieces as any)[id]}}};
  let r=await importArtV2({input,repoRoot,outRoot:path.join(dir,'saida'),groups,write:false});
  assert.equal(find(r.pieces,'inimigos',id).status,'aprovado');
  rmSync(path.join(folder,'walk-E.png'));
  writeFileSync(path.join(folder,'idle.png'),readFileSync(path.join(folder,'idle-S.png')));
  r=await importArtV2({input,repoRoot,outRoot:path.join(dir,'saida'),groups,write:false});
  const p=find(r.pieces,'inimigos',id);
  assert.equal(p.status,'reprovado');
  assert.match(p.problems.join('\n'),new RegExp(`inimigos/${id}/walk-\\*\\.png: falta a direção E \\(leste\\)`));
  assert.match(p.problems.join('\n'),new RegExp(`inimigos/${id}/idle: veio a folha idle\\.png e também imagens por direção`));
}));

// ---------------------------------------------------------------- towers
test('towers: base keeps 4 views × the 6 rows (wall: 3), weapon in 8 directions (fire assembled), meta footprint/mount',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada'),outRoot=path.join(dir,'saida');
  await writeEnemiesTowers(input);
  const r=await importArtV2({input,repoRoot,outRoot,groups:['torres'],write:true});
  assert.deepEqual((r.pieces as Piece[]).map(p=>`${p.id} ${p.status} ${p.problems.join('|')}`),[`${WALL.id} aprovado `,`${TOWER.id} aprovado `]);
  const out=path.join(outRoot,GROUPS.torres.output);
  const m=JSON.parse(readFileSync(path.join(out,'manifest.json'),'utf8'));
  const t=m.pieces[TOWER.id];
  assert.equal(t.kind,'tower');
  assert.deepEqual(t.meta,{footprint:TOWER.footprint,mount:TOWER.mount});
  assert.deepEqual([t.files.base.views,t.files.base.rows,t.files.base.cell],[4,[...TOWER_ROWS],TOWER.base]);
  assert.deepEqual(Object.keys(t.files).sort(),['base','fire','idle','reload']);
  for(const [anim,frames] of Object.entries(TOWER.anims))assert.deepEqual([t.files[anim].frames,t.files[anim].directions],[frames,8],anim);
  const meta=await sharp(path.join(out,TOWER.id,'base.webp')).metadata();
  assert.deepEqual([meta.width,meta.height],[4*TOWER.base[0],TOWER_ROWS.length*TOWER.base[1]]);
  const fire=await raw(path.join(out,TOWER.id,'fire.webp')),[cw,ch]=TOWER.weapon;
  assert.deepEqual([fire.width,fire.height],[6*cw,8*ch]);
  DIRECTIONS.forEach((d,row)=>{const i=((row*ch+Math.round(ch*.7))*fire.width+cw/2)*4;assert.deepEqual([...fire.data.subarray(i,i+3)],DIRECTION_RGB[d as keyof typeof DIRECTION_RGB],`fire row ${d}`);});
  const w=m.pieces[WALL.id];
  assert.deepEqual([w.files.base.rows,Object.keys(w.files),w.meta],[[...TOWER_WALL_ROWS],['base'],{footprint:WALL.footprint}]);
  const idx=JSON.parse(readFileSync(path.join(outRoot,'public/art/manifest.json'),'utf8'));
  assert.ok(idx.groups.torres.pieces[TOWER.id],'index lacks the tower');
}));

test('towers: wrong rows, missing mount and a wall with a weapon are refused in pt-BR',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada');
  await writeEnemiesTowers(input);
  const tower=path.join(input,'torres',TOWER.id),wall=path.join(input,'torres',WALL.id);
  const base=JSON.parse(readFileSync(path.join(tower,'base.json'),'utf8'));
  writeFileSync(path.join(tower,'base.json'),JSON.stringify({...base,rows:['pronta','ruina'],meta:{footprint:[1,1]}}));
  writeFileSync(path.join(wall,'idle.png'),readFileSync(path.join(tower,'idle.png')));
  const r=await importArtV2({input,repoRoot,outRoot:path.join(dir,'saida'),groups:['torres'],write:false});
  const t=find(r.pieces,'torres',TOWER.id).problems.join('\n'),w=find(r.pieces,'torres',WALL.id).problems.join('\n');
  assert.match(t,/torres\/rojao-de-festa\/base\.json: rows \["pronta","ruina"\] inválido/);
  assert.match(t,/falta meta\.mount/);
  assert.match(w,/torres\/muro-de-concreto: um muro .* não tem arma; tire idle\.png da pasta/);
}));

test('towers: foot line within 12 % of the cell height and no foot-centre check on the base; 15 % off is refused',async()=>withTemp(async dir=>{
  const input=path.join(dir,'entrada');
  await writeEnemiesTowers(input);
  const tower=path.join(input,'torres',TOWER.id),wall=path.join(input,'torres',WALL.id);
  const side=(folder:string,file:string,anchor:number[])=>{
    const p=path.join(folder,file);writeFileSync(p,JSON.stringify({...JSON.parse(readFileSync(p,'utf8')),anchor}));
  };
  // A character's 5 % would refuse all of these (the drawings stay where the fixture put them).
  side(tower,'base.json',[.2,TOWER.anchor[1]-.1]);side(tower,'meta.json',[.5,.88+.1]);side(wall,'base.json',[.8,WALL.anchor[1]+.1]);
  let r=await importArtV2({input,repoRoot,outRoot:path.join(dir,'saida'),groups:['torres'],write:false});
  for(const id of [TOWER.id,WALL.id])assert.deepEqual(find(r.pieces,'torres',id).problems,[],id);
  side(tower,'base.json',[.5,TOWER.anchor[1]-.15]);side(tower,'meta.json',[.5,.88-.15]);
  r=await importArtV2({input,repoRoot,outRoot:path.join(dir,'saida'),groups:['torres'],write:false});
  const t=find(r.pieces,'torres',TOWER.id).problems.join('\n');
  assert.match(t,/base\.png, "pronta" \(linha 4\): base do desenho fora da linha de apoio.*± 38\.4/);
  assert.match(t,/idle\.png, .*base do desenho fora da linha de apoio.*± 15\.4/);
}));
