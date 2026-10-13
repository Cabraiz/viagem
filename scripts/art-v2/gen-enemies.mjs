#!/usr/bin/env node
/**
 * Generates scripts/art-v2/enemies-table.mjs (NEW-20261013-ORQ-importador-inimigos-173) from the board's enemy briefs,
 * so the 164 new enemies are never typed by hand:
 *  - `03-INIMIGOS-0-REGRAS.md` §5, the role table: role → default cell and animations with frame counts;
 *  - `04..07-INIMIGOS-*.md`, the pack tables `| # | id | Name | Role | Cell | Concept | Accent | P |`: id, role, cell
 *    and priority of every enemy.
 * Deterministic (ids and roles sorted). Any malformed row (wrong column count, bad id, unknown role, bad cell or
 * priority, duplicate id, an id of the 9 enemies already in spec.mjs) throws, naming the file and line.
 *
 *   node scripts/art-v2/gen-enemies.mjs [--board <design/proximos>] [--check]
 * `--check` writes nothing and exits 1 when the committed module differs from what the .md files give.
 */
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const DEFAULT_BOARD='D:/Gits/viagem-board/design/proximos';
export const TABLE_FILE=path.join(path.dirname(fileURLToPath(import.meta.url)),'enemies-table.mjs');
export const RULES_FILE='03-INIMIGOS-0-REGRAS.md';
/** Pack files: 04..07, in name order. */
export const PACK_PATTERN=/^0[4-7]-INIMIGOS-.*\.md$/;
/** The 9 enemies briefed before the packs (spec.mjs keeps them as they are); a pack row with one of them is an error. */
export const LEGACY_IDS=Object.freeze(['bebado','anao-molotov','pombos','tio-pave','agiota','chefe','coach','motoboy','influencer']);
const ID=/^[a-z0-9][a-z0-9-]*$/,PRIORITY=/^P[012]$/;
const PACK_HEADER=['#','id','Name','Role','Cell','Concept','Accent','P'];

/** Cells of a markdown table line (`| a | b |` → ['a','b']), backticks stripped. */
const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>c.trim().replace(/`/g,""));
const fail=(file,line,message)=>{throw new Error(`${file}:${line}: ${message}`);};

/** Role table of 03 §5: {[role]:{cell, anims:{[anim]:frames}}}. */
export function parseRoles(text,file=RULES_FILE){
  const lines=text.split(/\r?\n/);
  const start=lines.findIndex(l=>/^##\s*5\.\s*Roles/i.test(l));
  if(start<0)fail(file,0,'section "## 5. Roles" not found');
  const roles={};
  let header=false;
  for(let i=start+1;i<lines.length&&!/^##\s/.test(lines[i]);i++){
    const line=lines[i];
    if(!line.startsWith('|'))continue;
    const c=cells(line);
    if(!header){
      if(c[0]!=='Role')fail(file,i+1,`role table header expected, got "${line}"`);
      header=true;continue;
    }
    if(/^-+$/.test(c[0]))continue;
    if(c.length!==4)fail(file,i+1,`role row with ${c.length} columns, expected 4`);
    const role=/^([a-z0-9-]+)(\s*\(.*\))?$/.exec(c[0])?.[1];
    if(!role)fail(file,i+1,`bad role "${c[0]}"`);
    const cell=Number(c[2]);
    if(!Number.isInteger(cell)||cell<=0)fail(file,i+1,`bad cell "${c[2]}" for role ${role}`);
    const anims={};
    for(const part of c[3].split(',')){
      const m=/^([a-z0-9-]+)\s+(\d+)$/.exec(part.trim());
      if(!m)fail(file,i+1,`bad animation "${part.trim()}" for role ${role} (expected "<name> <frames>")`);
      if(anims[m[1]])fail(file,i+1,`animation ${m[1]} twice for role ${role}`);
      anims[m[1]]=Number(m[2]);
    }
    if(roles[role])fail(file,i+1,`role ${role} twice`);
    roles[role]={cell,anims};
  }
  if(!Object.keys(roles).length)fail(file,start+1,'role table is empty');
  return roles;
}

/** Rows of one pack file: [{id, role, cell, priority, line}], checked against `roles`. */
export function parsePack(text,file,roles){
  const lines=text.split(/\r?\n/),out=[];
  let inTable=false;
  lines.forEach((line,i)=>{
    if(!line.startsWith('|')){inTable=false;return;}
    const c=cells(line);
    if(c[0]==='#'){
      if(c.join('|')!==PACK_HEADER.join('|'))fail(file,i+1,`pack table header must be ${PACK_HEADER.join(' | ')}`);
      inTable=true;return;
    }
    if(!inTable||/^-+$/.test(c[0]))return;
    if(c.length!==PACK_HEADER.length)fail(file,i+1,`row with ${c.length} columns, expected ${PACK_HEADER.length}`);
    const [n,id,,role,cellText,,,priority]=c;
    if(!/^\d+$/.test(n))fail(file,i+1,`bad row number "${n}"`);
    if(!ID.test(id))fail(file,i+1,`bad id "${id}" (kebab-case a-z0-9)`);
    if(!roles[role])fail(file,i+1,`unknown role "${role}" for ${id} (roles: ${Object.keys(roles).join(', ')})`);
    const cell=Number(cellText);
    if(!Number.isInteger(cell)||cell<=0)fail(file,i+1,`bad cell "${cellText}" for ${id}`);
    if(!PRIORITY.test(priority))fail(file,i+1,`bad priority "${priority}" for ${id} (P0, P1 or P2)`);
    out.push({id,role,cell,priority,line:i+1});
  });
  if(!out.length)fail(file,0,'no enemy rows');
  return out;
}

/** {roles, enemies:{[id]:{role,cell,priority,pack}}} from the board folder (03 + 04..07). */
export function readBoard(board=DEFAULT_BOARD){
  const roles=parseRoles(readFileSync(path.join(board,RULES_FILE),'utf8'));
  const packs=readdirSync(board).filter(f=>PACK_PATTERN.test(f)).sort();
  if(!packs.length)throw new Error(`${board}: no pack files 04..07-INIMIGOS-*.md`);
  const enemies={};
  for(const file of packs){
    const pack=Number(file.slice(0,2));
    for(const row of parsePack(readFileSync(path.join(board,file),'utf8'),file,roles)){
      if(LEGACY_IDS.includes(row.id))fail(file,row.line,`${row.id} is one of the 9 enemies already in spec.mjs`);
      if(enemies[row.id])fail(file,row.line,`id ${row.id} repeated (also in pack ${enemies[row.id].pack})`);
      enemies[row.id]={role:row.role,cell:row.cell,priority:row.priority,pack};
    }
  }
  return {roles,enemies};
}

const sortKeys=o=>Object.fromEntries(Object.keys(o).sort().map(k=>[k,o[k]]));
/** Source text of enemies-table.mjs. */
export function renderTable({roles,enemies}){
  const lines=[
    '// GENERATED by scripts/art-v2/gen-enemies.mjs from the board\'s design/proximos/03..07-INIMIGOS-*.md. Do not edit by',
    '// hand: change the .md and run `node scripts/art-v2/gen-enemies.mjs`.',
    '/** Role → default cell and animations {name: frames} (03-INIMIGOS-0-REGRAS.md §5), in the brief\'s animation order. */',
    'export const ENEMY_ROLES=Object.freeze({',
    ...Object.keys(roles).sort().map(r=>`  ${JSON.stringify(r)}:Object.freeze({cell:${roles[r].cell},anims:Object.freeze(${JSON.stringify(roles[r].anims)})}),`),
    '});',
    '/** Enemy id → role, cell (the pack table\'s "Cell") and priority ("P"); `pack`: 4..7, the source file. */',
    'export const ENEMY_TABLE=Object.freeze({',
    ...Object.entries(sortKeys(enemies)).map(([id,e])=>`  ${JSON.stringify(id)}:Object.freeze({role:${JSON.stringify(e.role)},cell:${e.cell},priority:${JSON.stringify(e.priority)},pack:${e.pack}}),`),
    '});',
    '',
  ];
  return lines.join('\n');
}

export const generate=(board=DEFAULT_BOARD)=>renderTable(readBoard(board));

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const argv=process.argv.slice(2),at=argv.indexOf('--board'),board=at>=0?argv[at+1]:DEFAULT_BOARD;
  const text=generate(board);
  if(argv.includes('--check')){
    const now=readFileSync(TABLE_FILE,'utf8').replace(/\r\n/g,'\n');
    if(now!==text){console.error(`${TABLE_FILE} is out of date: run node scripts/art-v2/gen-enemies.mjs`);process.exit(1);}
    console.log('enemies-table.mjs is up to date.');
  }else{
    writeFileSync(TABLE_FILE,text);
    const {enemies}=readBoard(board),byRole={};
    for(const e of Object.values(enemies))byRole[e.role]=(byRole[e.role]??0)+1;
    console.log(`${Object.keys(enemies).length} enemies → ${path.relative(process.cwd(),TABLE_FILE)}`,sortKeys(byRole));
  }
}
