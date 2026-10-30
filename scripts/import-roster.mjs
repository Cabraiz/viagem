#!/usr/bin/env node
/**
 * Regenerates src/rules/enemy-roster.ts (NEW-20261013-ORQ-papeis-de-inimigo, D-040) from the board's enemy packs and
 * the pt-BR copy in scripts/roster-text.json. Deterministic: same inputs, same bytes.
 *
 *   node scripts/import-roster.mjs [board-dir]        (default: $VIAGEM_BOARD, else viagem-board beside the repo)
 *   node scripts/import-roster.mjs --check [board-dir] (exit 1 when the committed file differs)
 *
 * Packs: design/proximos/04..07-INIMIGOS-*.md, markdown rows `| # | id | Name | Role | Cell | Concept | Accent | P |`.
 * Every row becomes an entry (id, name, role, cell, priority, pack, accent color); the copy file adds the text: P0 rows
 * need 4 barks, 3 death lines, a pop and the death gag; P1/P2 rows the gag only. The nine hand-tuned kinds come first
 * (pack 0); their lines stay in sim/enemies/catalog.ts and the client, only the gag is here.
 * Display-name overrides (copy file `names`): 'pelad' is a lint trap of the D-033 text rules, LinkedIn and CrossFit are
 * real brands (D-033: no real brands), "Homem-Surdo" (the drum) alone reads as a deafness joke (D-033: no disability
 * jokes), so he is the Homem-Tambor; the ids (the art folders) stay as the packs have them.
 * Flying (`flying`, D-041: anti-air reaches it, ground towers do not) is per entry: every voador, the pombos, the aerial
 * swarms in FLYING and any entry whose concept (before "Death:") says it flies/hovers/floats; a concept that matches
 * FLY_WORDS but whose subject is not the body itself is listed in GROUNDED with the reason, and an unlisted match stops
 * the import until someone decides.
 */
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),check=args.includes('--check');
// The board sits next to the repo (D:/Gits/viagem-board beside D:/Gits/viagem), or next to the worktrees' folder.
const board=resolve(args.find(a=>!a.startsWith('--'))??process.env.VIAGEM_BOARD??
  [join(repo,'..','viagem-board'),join(repo,'..','..','viagem-board')].find(d=>existsSync(d))??join(repo,'..','viagem-board'));
const packDir=join(board,'design','proximos');
const OUT=join(repo,'src','rules','enemy-roster.ts');
const TEXT=join(repo,'scripts','roster-text.json');

const ROLES=['corredor','brutamontes','arremessador','atirador','suporte','palhaco','kamikaze','enxame','voador','refletor','invocador','mini-chefe','chefe'];
/** The nine hand-tuned kinds (sim/enemies/catalog.ts ENEMIES): name and accent as there, role by behavior. */
const LEGACY=[
  ['bebado','Bêbado do Boteco','corredor',128,0x8a5a2b],['anao-molotov','Anão do Molotov','arremessador',128,0xd0502a],
  ['pombos','Pombos do Centro','enxame',64,0x5d6b7a],['tio-pave','Tio do Pavê','palhaco',160,0xa86b3c],
  ['agiota','Agiota do Bairro','atirador',128,0x2f3f2f],['coach','Coach Quântico','suporte',128,0x2a3f8f],
  ['motoboy','Motoboy Kamikaze','kamikaze',160,0xc23b2a],['influencer','Influencer de Academia','refletor',160,0xe0407a],
  ['chefe','Síndico Supremo','chefe',384,0x6b3f7a],
];
/**
 * Held entries (HELD_ROSTER): defined and spawnable by id (sim/enemies/catalog.ts reads them through rules/enemy-cast.ts)
 * but out of the wave draw (rules/enemy-rotation.ts reads ROSTER only) until their art and the user's go land. Pack 0,
 * P0 (copy file `held`: 4 barks, 3 death lines, a pop and the gag). [id, name, role, cell, accent]
 */
const HELD=[
  // NEW-20261029-ORQ-sanfoneiro-regra-arrastar (sim/enemies/sanfoneiro.ts): cell 128, ~1.2× the hero until the user decides.
  ['sanfoneiro','Sanfoneiro Arrasta-Pé','brutamontes',128,0xc68e3a],
];
/** Entries that fly although their role (enxame) does not: aerial swarms. */
const FLYING={'pernilongo-vampiro':'a mosquito swarm','bot-de-curtida':'"a tiny hovering thumbs-up creature"'};
/** FLY_WORDS matches in a concept (before "Death:") that do not make the body fly. */
const GROUNDED={
  'executivo-de-patinete':'his tie flies like a cape, he rides a scooter',
  'sogra-do-chinelo':'her flip-flop flies, she does not',
  'rainha-das-baratas':'a chefe: she hovers only in her phase 2 (the boss is sim/boss.ts, never a flying def)',
  'o-algoritmo':'a chefe: a floating eye on spider legs (walks)',
};
const FLY_WORDS=/\b(fly|flies|flying|hover|hovers|hovering|airborne|float|floats|floating)\b/i;
/** Accent text → color: the first color word in the pack's Accent column (tint of the fallback sprite and the pop). */
const COLORS={
  orange:0xe07a2a,red:0xc8322c,yellow:0xe8c22a,blue:0x2f6bc4,green:0x3e9a3e,lime:0x9acd32,cyan:0x2ec4d0,teal:0x2a9d8f,
  pink:0xe86aa8,magenta:0xd02a9a,purple:0x7a3fb0,lilac:0xb79ad8,gold:0xd4a62a,amber:0xd9902a,copper:0xb8733a,brown:0x8a5a2b,
  burgundy:0x8a1e3a,mustard:0xc9a227,rust:0xa0522d,caramel:0xc68e3a,steel:0x8a96a0,chrome:0xb0b8c0,swamp:0x4a6b3a,
  rainbow:0xe86aa8,iridescent:0x7a3fb0,brass:0xb5a642,silver:0xa8b0b8,neon:0xd040a0,
};
function accentColor(text,id){
  const low=text.toLowerCase();let best;
  for(const [word,hex] of Object.entries(COLORS)){
    const m=new RegExp(`\\b${word}\\b`).exec(low);
    if(m&&(!best||m.index<best.index||m.index===best.index&&word!=='neon'))best={index:m.index,hex};
  }
  if(!best)throw new Error(`${id}: no color word in accent "${text}"`);
  return best.hex;
}

const files=readdirSync(packDir).filter(f=>/^0[4-7]-INIMIGOS-.*\.md$/.test(f)).sort();
if(files.length!==4)throw new Error(`expected 4 packs in ${packDir}, found ${files.length}`);
const copy=JSON.parse(readFileSync(TEXT,'utf8'));
const rows=[];
files.forEach((file,i)=>{
  for(const line of readFileSync(join(packDir,file),'utf8').split(/\r?\n/)){
    if(!/^\|\s*\d+\s*\|/.test(line))continue;
    const cells=line.split('|').slice(1,-1).map(s=>s.trim());
    if(cells.length!==8)throw new Error(`${file}: bad row ${line}`);
    const [,id,name,role,cell,concept,accent,priority]=cells;
    if(!ROLES.includes(role))throw new Error(`${id}: unknown role ${role}`);
    if(!/^P[012]$/.test(priority))throw new Error(`${id}: bad priority ${priority}`);
    const said=FLY_WORDS.test(concept.split(/\bDeath:/)[0]);
    if(said&&role!=='voador'&&!(id in FLYING)&&!(id in GROUNDED))throw new Error(`${id}: its concept says it flies; add it to FLYING or GROUNDED`);
    const flying=role==='voador'||id in FLYING||said&&!(id in GROUNDED);
    if(id in GROUNDED&&!said)throw new Error(`${id}: in GROUNDED but its concept no longer says it flies`);
    rows.push({id,name:copy.names?.[id]??name,role,cell:Number(cell),priority,pack:i+1,accent:accentColor(accent,id),...(flying?{flying:true}:{})});
  }
});

const problems=[];
const seen=new Set(LEGACY.map(l=>l[0]));
for(const r of rows){if(seen.has(r.id))problems.push(`duplicate id ${r.id}`);seen.add(r.id);}
for(const id of Object.keys(copy.entries))if(!rows.some(r=>r.id===id))problems.push(`copy for unknown id ${id}`);
for(const id of Object.keys(copy.names??{}))if(!rows.some(r=>r.id===id))problems.push(`name override for unknown id ${id}`);
const extras=Object.entries(copy.extra??{}).map(([id,x])=>{
  if(!ROLES.includes(x.role))problems.push(`${id}: unknown role ${x.role}`);
  if(seen.has(id))problems.push(`duplicate id ${id}`);seen.add(id);
  if(!x.gag||x.barks||x.death||x.pop)problems.push(`${id}: an extra entry has a gag and no own lines`);
  return {id,name:x.name,role:x.role,cell:x.cell,priority:'P1',pack:5,accent:Number(x.accent),gag:x.gag};
});
for(const id of [...Object.keys(FLYING),...Object.keys(GROUNDED)])if(!rows.some(r=>r.id===id))problems.push(`flying rule for unknown id ${id}`);
const entries=[
  ...LEGACY.map(([id,name,role,cell,accent])=>{
    const gag=copy.legacy?.[id]?.gag;if(!gag)problems.push(`${id}: no gag`);
    // The pombos fly (sim/enemies/catalog.ts ENEMIES.pombos.flying); the flag here only mirrors it.
    return {id,name,role,cell,priority:'P0',pack:0,accent,gag,legacy:true,...(id==='pombos'?{flying:true}:{})};
  }),
  ...rows.map(r=>{
    const t=copy.entries[r.id];
    if(!t?.gag){problems.push(`${r.id}: no gag`);return r;}
    const e={...r,gag:t.gag};
    if(r.priority==='P0'){
      if(t.barks?.length!==4||t.death?.length!==3||typeof t.pop!=='string')problems.push(`${r.id}: P0 needs 4 barks, 3 death lines and a pop`);
      Object.assign(e,{barks:t.barks,deathLines:t.death,pop:t.pop});
    }else if(t.barks||t.death||t.pop)problems.push(`${r.id}: ${r.priority} carries P0 lines`);
    return e;
  }),
  ...extras,
];
const held=HELD.map(([id,name,role,cell,accent])=>{
  if(seen.has(id))problems.push(`held id ${id} is already in the roster`);
  const t=copy.held?.[id];
  if(!t?.gag||t.barks?.length!==4||t.death?.length!==3||typeof t.pop!=='string')problems.push(`${id}: a held entry needs 4 barks, 3 death lines, a pop and the gag`);
  return {id,name,role,cell,priority:'P0',pack:0,accent,gag:t?.gag,barks:t?.barks,deathLines:t?.death,pop:t?.pop};
});
for(const id of Object.keys(copy.held??{}))if(!HELD.some(h=>h[0]===id))problems.push(`held copy for unknown id ${id}`);
if(problems.length){console.error(problems.join('\n'));process.exit(1);}

const hex=n=>`0x${n.toString(16).padStart(6,'0')}`;
const str=s=>JSON.stringify(s).replace(/'/g,"\\'").replace(/^"|"$/g,"'").replace(/\\"/g,'"');
const list=a=>`[${a.map(str).join(',')}]`;
const line=e=>{
  const parts=[`id:${str(e.id)}`,`name:${str(e.name)}`,`role:${str(e.role)}`,`cell:${e.cell}`,`priority:${str(e.priority)}`,`pack:${e.pack}`,`accent:${hex(e.accent)}`];
  if(e.legacy)parts.push('legacy:true');
  if(e.flying)parts.push('flying:true');
  parts.push(`gag:${str(e.gag)}`);
  if(e.barks)parts.push(`\n    barks:${list(e.barks)},\n    deathLines:${list(e.deathLines)},pop:${str(e.pop)}`);
  return `  {${parts.join(',')}},`;
};
const out=`/**
 * GENERATED by scripts/import-roster.mjs from the board packs (design/proximos/04..07-INIMIGOS-*.md) and
 * scripts/roster-text.json. Do not edit by hand: change the copy file (or the packs) and run the script.
 *
 * The cast of D-040: the nine hand-tuned kinds (pack 0, \`legacy\`: their stats and lines live in sim/enemies/catalog.ts
 * and the client), the ${rows.length} pack entries (${rows.filter(r=>r.priority==='P0').length} P0) and the ${extras.length} extra (pack 5, from no pack). Every entry
 * has its role (enemy-roles.ts) and the pt-BR death gag (≤ 60 chars); P0 entries also their own lines: 4 barks and 3
 * death lines (≤ 30 chars) and the death pop (ALL CAPS, ≤ 21 chars). P1/P2 entries use their role's generic lines.
 * \`accent\` is the pack's accent color (fallback tint).
 */
import type {EnemyRole} from './enemy-roles.ts';

export type RosterPriority='P0'|'P1'|'P2';
export interface RosterEntry {
  id:string;name:string;role:EnemyRole;
  /** Sprite cell (px) of the art; the role's default unless the pack overrides it. */
  cell:number;
  priority:RosterPriority;
  /** 0: the hand-tuned cast; 1..4: design/proximos/04..07; 5: extra entries from no pack (the aberrações). */
  pack:number;
  /** 0xRRGGBB of the pack's accent. */
  accent:number;
  /** The nine hand-tuned kinds of sim/enemies/catalog.ts. */
  legacy?:true;
  /**
   * Flies (D-041): anti-air towers reach it, ground fire and the wire pass under it (sim/enemies/catalog.ts rosterDef).
   * Every voador, the pombos, the aerial swarms and the entries whose pack concept says the body flies or hovers.
   */
  flying?:true;
  /** The death gag (from the pack's "Death:"), pt-BR. */
  gag:string;
  barks?:readonly string[];deathLines?:readonly string[];pop?:string;
}

const freeze=<T>(entries:T[]):readonly T[]=>Object.freeze(entries.map(e=>{
  for(const v of Object.values(e as object))if(Array.isArray(v))Object.freeze(v);
  return Object.freeze(e);
}));

export const ROSTER:readonly RosterEntry[]=freeze<RosterEntry>([
${entries.map(line).join('\n')}
]);

/** Defined but kept out of the wave draw (enemy-rotation.ts reads ROSTER only) until their art and the user's go land. */
export const HELD_ROSTER:readonly RosterEntry[]=freeze<RosterEntry>([
${held.map(line).join('\n')}
]);
`;
// LF only, whatever the checkout does to this script's own line endings (core.autocrlf); the check ignores CRs too.
const lf=s=>s.split(String.fromCharCode(13)).join('');
const text=lf(out);
if(check){
  const current=existsSync(OUT)?lf(readFileSync(OUT,'utf8')):'';
  if(current!==text){console.error('src/rules/enemy-roster.ts is stale: run node scripts/import-roster.mjs');process.exit(1);}
  console.log(`enemy-roster.ts is current (${entries.length} entries)`);
}else{
  writeFileSync(OUT,text);
  console.log(`wrote ${OUT}: ${entries.length} entries (${rows.length} from ${files.length} packs, ${rows.filter(r=>r.priority==='P0').length} P0, ${extras.length} extra)`);
}
