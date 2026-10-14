// Art v2 importer (NEW-20261012-ORQ-importador-arte-a): reads the delivery folder `arte-entrada/` laid out as in
// scripts/art-v2/spec.mjs (board: design/inventario-sprites.md and design/arte-v2.md §5–6), validates every piece,
// converts the approved ones to lossless WebP with a manifest per group, and writes an HTML report for the artist.
// Partial delivery: approved pieces are written even when others fail; a rejected piece writes nothing; an absent one
// stays "pendente" (P0; a P1/P2 one is "opcional") and the game keeps its current art. After the group manifests, the
// client index public/art/manifest.json is rewritten (not in --dry-run). Never touches src/client/sprites/sprite-catalog.ts.
//
//   node scripts/import-art-v2.mjs [--input <pasta>] [--dry-run] [--report <arquivo.html>]
import {readdir,writeFile,stat,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {GROUPS,priorityOf} from './art-v2/spec.mjs';
import {validatePiece,relName,SILHOUETTE} from './art-v2/validate.mjs';
import {convertPiece,writeManifest,readManifest,manifestPath,plannedOutputs,writeIndex} from './art-v2/convert.mjs';
import {writeEnemyArtIds} from './art-v2/enemy-art-ids.mjs';

export const DEFAULT_INPUT='D:/Gits/viagem-board/arte-entrada';
export const REPORT_NAME='relatorio-importacao.html';
/** Thumbnails of refused pieces fit inside THUMB_SIZE×THUMB_SIZE; only the first THUMB_LIMIT refused pieces get one (bounded HTML). */
export const THUMB_SIZE=256,THUMB_LIMIT=40;
const REPO_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const IGNORED=new Set(['thumbs.db','desktop.ini']);
const visible=name=>!name.startsWith('.')&&!IGNORED.has(name.toLowerCase());
const exists=file=>stat(file).then(()=>true,()=>false);

async function entries(dir){
  try{return (await readdir(dir,{withFileTypes:true})).filter(e=>visible(e.name)).sort((a,b)=>a.name.localeCompare(b.name));}
  catch(e){if(e.code==='ENOENT'||e.code==='ENOTDIR')return [];throw e;}
}
/** Classes with an approved sheet: `public/art/sprites/<id>.webp` (not `.dir4.webp` & co.). */
export async function approvedClasses(repoRoot){
  return (await entries(path.join(repoRoot,'public/art/sprites'))).filter(e=>e.isFile()&&/^[a-z0-9-]+\.webp$/.test(e.name)).map(e=>e.name.slice(0,-5));
}

/**
 * Groups the files of one group folder into pieces ({id → absolute files}), unknown entries (with their message) and,
 * for the enemies, `extra` folders: ids not in the table (reported as "extra", nothing imported).
 */
async function collect(group,spec,ctx){
  const dir=path.join(ctx.input,spec.input),pieces=new Map(),unknown=[];
  const add=(id,file)=>{if(!pieces.has(id))pieces.set(id,[]);pieces.get(id).push(file);};
  const reject=(file,message,isDir=false)=>unknown.push({file,message,isDir});
  const extra=[];
  const top=await entries(dir);
  if(spec.kind==='animations'){
    const ids=Object.keys(spec.pieces),byLength=[...ids].sort((a,b)=>b.length-a.length);
    for(const e of top){
      const full=path.join(dir,e.name);
      if(e.isDirectory()&&spec.pieces[e.name])for(const f of await entries(full))add(e.name,path.join(full,f.name));
      else if(e.isDirectory()&&e.name==='elite')for(const f of await entries(full)){
        const id=byLength.find(i=>f.name.startsWith(`${i}-`));
        if(id&&f.isFile())add(id,path.join(full,f.name));
        else reject(path.join(full,f.name),`nome não reconhecido na camada elite. Use elite/<inimigo>-<animação>.png, com o id de um inimigo da tabela (ex.: elite/bebado-walk.png).`,f.isDirectory());
      }
      else if(e.isDirectory())extra.push({id:e.name,file:full});
      else reject(full,`não é uma pasta de inimigo. Em ${spec.input}/ vão só as pastas <inimigo>/ (ids da tabela) e elite/.`);
    }
    return {pieces,unknown,extra,order:ids};
  }
  if(spec.kind==='tower'){
    for(const e of top){
      const full=path.join(dir,e.name);
      if(e.isDirectory())for(const f of await entries(full))add(e.name,path.join(full,f.name));
      else reject(full,`fora de uma pasta de torre. Coloque em ${spec.input}/<torre>/ (ex.: ${spec.input}/vigia-do-predio/${e.name}).`);
    }
    return {pieces,unknown,order:[...pieces.keys()].sort()};
  }
  if(spec.kind==='dir8'){
    const classes=ctx.classes;
    for(const e of top){
      const full=path.join(dir,e.name),m=e.isFile()&&/^(.+)\.(dir8|downed)\.png$/i.exec(e.name);
      if(e.isFile()&&e.name.toLowerCase()===`${SILHOUETTE}.png`)add(SILHOUETTE,full);
      else if(m&&classes.includes(m[1]))add(m[1],full);
      else if(m)reject(full,`"${m[1]}" não é uma classe com folha aprovada (public/art/sprites/${m[1]}.webp). Confira o nome do arquivo (tabela de docs/sprite-directions.md).`);
      else reject(full,`arquivo não esperado. Use <classe>.dir8.png (e, opcional, <classe>.downed.png) com o nome de uma das ${classes.length} classes.`,e.isDirectory());
    }
    return {pieces,unknown,order:[...classes,SILHOUETTE]};
  }
  // pieces:'any': every `<id>.png` (with an optional `<id>.json`) is a piece; nested groups have a folder per map.
  const pair=async(folder,prefix)=>{
    for(const e of await entries(folder)){
      const full=path.join(folder,e.name),m=e.isFile()&&/^(.+)\.(png|json)$/i.exec(e.name);
      if(m)add(prefix+m[1],full);
      else if(e.isDirectory())reject(full,`pasta não esperada aqui. Coloque os arquivos direto em ${relName(ctx,folder)}/.`,true);
      else reject(full,`formato não aceito. Envie <nome>.png e, opcional, <nome>.json.`);
    }
  };
  if(spec.nested){
    for(const e of top){
      const full=path.join(dir,e.name);
      if(e.isDirectory())await pair(full,`${e.name}/`);
      else reject(full,`fora de uma pasta de mapa. Coloque em ${spec.input}/<mapa>/ (ex.: ${spec.input}/cidade-nevada/${e.name}).`);
    }
  }else await pair(dir,'');
  // The inventory's list (spec `expected`) comes first, so an absent listed piece is reported; extra ids follow.
  const listed=Object.keys(spec.expected??{});
  return {pieces,unknown,order:[...listed,...[...pieces.keys()].filter(id=>!Object.hasOwn(spec.expected??{},id)).sort()]};
}

/**
 * Thumbnail of the faulty file: the first PNG named in the problems (earliest problem, earliest mention), else the
 * first PNG of the piece; fitted inside THUMB_SIZE×THUMB_SIZE (a dir8 atlas gives 64×256), as a PNG data URI.
 */
async function thumbOf(files,problems,ctx){
  const pngs=files.filter(f=>/\.png$/i.test(f)).map(f=>({f,name:relName(ctx,f)}));
  let png;
  for(const m of problems??[]){
    const hit=pngs.map(p=>({...p,at:m.indexOf(p.name)})).filter(p=>p.at>=0).sort((a,b)=>a.at-b.at||b.name.length-a.name.length)[0];
    if(hit){png=hit.f;break;}
  }
  png??=pngs[0]?.f;
  if(!png)return;
  try{
    const buffer=await sharp(png).resize({width:THUMB_SIZE,height:THUMB_SIZE,fit:'inside',withoutEnlargement:true}).png().toBuffer();
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }catch{return undefined;}
}
const repoRel=(root,file)=>path.relative(root,file).split(path.sep).join('/');

/**
 * Imports a delivery folder. `groups`: the GROUPS object (or a subset of it, or an array of group names).
 * `repoRoot`: where the approved class sheets are read (public/art/sprites/<id>.webp); `outRoot`: where the WebP and
 * manifests are written (each group under its `output`). `write:false` validates only. `reportFile`: HTML report path.
 * @returns {Promise<{pieces:import('./art-v2/spec.mjs').PieceResult[],written:string[],reportFile?:string}>}
 */
export async function importArtV2({input,repoRoot=REPO_ROOT,outRoot=repoRoot,groups=GROUPS,write=true,reportFile}={}){
  input=path.resolve(input??process.env.ARTE_ENTRADA??DEFAULT_INPUT);
  const info=await stat(input).catch(()=>undefined);
  if(!info?.isDirectory()){
    const error=new Error(`Pasta de entrada não encontrada: ${input}. Crie a pasta com as subpastas da entrega (inimigos/, personagens/, cenario/, itens/, projeteis/, efeitos/, ui/, rostos/, torres/) ou indique outra com --input <pasta> ou a variável ARTE_ENTRADA.`);
    error.code='ARTE_ENTRADA_AUSENTE';throw error;
  }
  const selected=Array.isArray(groups)?Object.fromEntries(groups.map(g=>{if(!GROUPS[g])throw new Error(`grupo desconhecido: ${g}`);return [g,GROUPS[g]];})):groups;
  const ctx={input,repoRoot};
  if(Object.values(selected).some(s=>s.pieces==='classes'))ctx.classes=await approvedClasses(repoRoot);
  const pieces=[],written=[],thumbFiles=new Map();
  let wroteManifest=false;
  for(const [group,spec] of Object.entries(selected)){
    const {pieces:found,unknown,extra=[],order}=await collect(group,spec,ctx);
    // The group's current manifest: lets the validator see pieces approved in earlier runs (e.g. an elite layer alone).
    const manifest=await readManifest(manifestPath(spec,{outRoot}));
    const entries={};
    for(const id of order){
      const files=found.get(id);
      const priority=priorityOf(spec,id);
      // Absent: a P0 piece is pending; a P1/P2 one is only optional (never counted as pending).
      if(!files){pieces.push({group,id,status:priority==='P0'?'pendente':'opcional',priority,problems:[],notes:[],files:[],outputs:[]});continue;}
      files.sort();
      const result={group,id,status:'aprovado',priority,problems:[],notes:[],files:files.map(f=>relName(ctx,f)),outputs:[]};
      result.source=spec.kind==='animations'||spec.kind==='tower'?`${spec.input}/${id}`:relName(ctx,files.find(f=>/\.png$/i.test(f))??files[0]);
      const {problems,notes,sheets,kind,meta}=await validatePiece(group,id,files,{...ctx,spec,manifest});
      result.problems=problems;result.notes=Array.isArray(notes)?notes:[];
      if(!problems.length){
        try{
          if(write){
            const {entry,written:out}=await convertPiece(spec,id,kind,sheets,{outRoot,previous:manifest?.pieces?.[id],meta});
            entries[id]=entry;written.push(...out);result.outputs=out.map(f=>repoRel(outRoot,f));
          }else result.outputs=await plannedOutputs(spec,sheets);
        }catch(e){
          console.error(`[import-art-v2] ${group}/${id}: conversion failed:`,e);
          result.problems.push(`${result.source}: falha ao converter para WebP. Nada desta peça foi alterado no jogo. Exporte o PNG de novo; se repetir, fale com o dev.`);
          result.outputs=[];
        }
      }
      if(result.problems.length){result.status='reprovado';thumbFiles.set(result,files);}
      pieces.push(result);
    }
    // An enemy folder whose id is not in the table: listed as "extra", never imported (no role, so no animations).
    for(const x of extra){
      const name=`${spec.input}/${x.id}/`;
      pieces.push({group,id:x.id,status:'extra',problems:[`${name}: "${x.id}" não está na tabela de inimigos (extra): nada foi importado. Confira o id na coluna "id" dos pacotes 04–07 (design/proximos) ou peça ao dev para incluir o inimigo na tabela.`],
        notes:[],files:[name],outputs:[],source:name});
    }
    for(const u of unknown){
      const name=relName(ctx,u.file)+(u.isDir?'/':'');
      const result={group,id:path.relative(path.join(input,spec.input),u.file).split(path.sep).join('/'),status:'reprovado',
        problems:[`${name}: ${u.message}`],notes:[],files:[name],outputs:[],source:name};
      if(!u.isDir)thumbFiles.set(result,[u.file]);
      pieces.push(result);
    }
    if(Object.keys(entries).length){written.push(await writeManifest(group,spec,entries,{outRoot}));wroteManifest=true;}
  }
  // The client reads one index (public/art/manifest.json): every group manifest on disk, rewritten after any change.
  if(wroteManifest)written.push(await writeIndex({...GROUPS,...selected},{outRoot}));
  // The roster ids with art, as rules data for the rotation (ROSTER_ONLY_WITH_ART): the sim never reads the index.
  if(wroteManifest){const ids=await writeEnemyArtIds({outRoot});if(ids)written.push(ids);}
  // Thumbnails last, for the first THUMB_LIMIT refused pieces only (keeps the HTML report small).
  const refused=pieces.filter(p=>p.status==='reprovado');
  for(const p of refused.slice(0,THUMB_LIMIT)){const files=thumbFiles.get(p);if(files)p.thumb=await thumbOf(files,p.problems,ctx);}
  const thumbsOmitted=Math.max(0,refused.length-THUMB_LIMIT);
  const out={pieces,written,dryRun:!write,thumbsOmitted};
  if(reportFile){
    let report;
    try{report=await import('./art-v2/report.mjs');}
    catch(e){
      if(e.code==='ERR_MODULE_NOT_FOUND'&&String(e.message).includes('report.mjs')){console.warn('Aviso: scripts/art-v2/report.mjs ainda não existe; relatório HTML não gerado.');return out;}
      throw e;
    }
    reportFile=path.resolve(reportFile);
    await mkdir(path.dirname(reportFile),{recursive:true});
    await writeFile(reportFile,report.renderReport(pieces,{generatedAt:new Date(),dryRun:!write,thumbsOmitted}));
    out.reportFile=reportFile;
  }
  return out;
}

const plural=(n,one,many)=>`${n} ${n===1?one:many}`;
function count(pieces){
  const c={aprovado:0,reprovado:0,pendente:0,opcional:0,extra:0};for(const p of pieces)c[p.status]++;
  return `${plural(c.aprovado,'aprovada','aprovadas')}, ${plural(c.reprovado,'reprovada','reprovadas')}, ${plural(c.pendente,'pendente','pendentes')}${c.extra?`, ${plural(c.extra,'extra (fora da tabela)','extras (fora da tabela)')}`:''}${c.opcional?` (+ ${plural(c.opcional,'opcional P1/P2 ainda não entregue','opcionais P1/P2 ainda não entregues')})`:''}`;
}
/** pt-BR summary printed by the CLI. */
export function summaryText(result,{input,dryRun=false}={}){
  const lines=[`Importação da arte v2 — entrada: ${input}${dryRun?' (simulação: nada gravado no jogo)':''}`];
  for(const [group,spec] of Object.entries(GROUPS)){
    const of=result.pieces.filter(p=>p.group===group);
    if(of.length)lines.push(`  ${spec.title}: ${count(of)}`);
  }
  lines.push(`Total: ${count(result.pieces)}.`);
  const rejected=result.pieces.filter(p=>p.status==='reprovado'||p.status==='extra');
  if(rejected.length){
    lines.push('','Reprovadas ou fora da tabela (nada foi gravado para elas):');
    for(const p of rejected){lines.push(`  ${p.group}/${p.id}`);for(const m of p.problems)lines.push(`    - ${m}`);}
  }
  const noted=result.pieces.filter(p=>p.notes?.length);
  if(noted.length){
    lines.push('','Observações:');
    for(const p of noted){lines.push(`  ${p.group}/${p.id}`);for(const m of p.notes)lines.push(`    - ${m}`);}
  }
  if(!dryRun)lines.push('',`Arquivos gravados: ${result.written.length}`);
  if(result.reportFile)lines.push(`Relatório: ${result.reportFile}`);
  return lines.join('\n');
}

export function parseArgs(argv){
  const args={dryRun:false};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--dry-run')args.dryRun=true;
    else if(a==='--input'||a==='--report'){
      const v=argv[++i];if(!v||v.startsWith('--'))throw new Error(`${a} precisa de um caminho.`);
      args[a.slice(2)]=v;
    }else throw new Error(`opção desconhecida: ${a}. Uso: node scripts/import-art-v2.mjs [--input <pasta>] [--dry-run] [--report <arquivo.html>]`);
  }
  return args;
}

async function main(){
  let args;
  try{args=parseArgs(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=2;return;}
  const input=path.resolve(args.input??process.env.ARTE_ENTRADA??DEFAULT_INPUT);
  try{
    const result=await importArtV2({input,write:!args.dryRun,reportFile:args.report??path.join(input,REPORT_NAME)});
    console.log(summaryText(result,{input,dryRun:args.dryRun}));
  }catch(e){
    if(e.code==='ARTE_ENTRADA_AUSENTE'){console.error(e.message);process.exitCode=2;return;}
    console.error(e);process.exitCode=1;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
