#!/usr/bin/env node
/**
 * Relatório do playtest (NEW-20261009-UX-playtest-metricas): junta os JSON exportados pelos celulares (botão "Métricas"
 * no resultado, com ?dev=1) e imprime a tabela contra as métricas-alvo de docs/playtest-ux.md.
 * Uso: node scripts/ux-report.mjs <arquivo.json|pasta>...   (pasta: todos os .json dela)
 * Sai com 0 sempre que leu ao menos um arquivo (o veredito está na tabela); 1 sem arquivo válido.
 */
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const SCHEMA='viagem-ux/1';
/**
 * Alvos do roteiro. `share`: fração mínima dos novatos (1ª run de cada celular novato) que cumpre o alvo individual;
 * `max`: teto da fração da turma toda (ofertas no padrão).
 */
export const TARGETS={
  firstMove:{label:'1º movimento ≤ 3 s (80% dos novatos)',limitMs:3000,share:.8,who:'novatos'},
  round1:{label:'Round 1 sem queda (80% dos novatos)',share:.8,who:'novatos'},
  defaulted:{label:'Ofertas no padrão < 20%',max:.2,who:'todas as runs'},
  rematch:{label:'Revanche (60% dos grupos)',share:.6,who:'grupos'},
  chip:{label:'1º chip ≤ 30 s (80% dos novatos)',limitMs:30000,share:.8,who:'novatos'},
};

/** A finite number, or null: anything missing, broken or NaN is "sem dado", never a value. */
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const median=list=>{const s=list.map(num).filter(v=>v!==null).sort((a,b)=>a-b);if(!s.length)return null;const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const sec=ms=>num(ms)===null?'—':`${(ms/1000).toFixed(1).replace('.',',')} s`;
const pct=v=>num(v)===null?'—':`${Math.round(v*100)}%`;
const sumOf=(list,f)=>list.reduce((a,x)=>a+(num(f(x))??0),0);

/** Reads files and folders into export objects; invalid files are listed, never fatal. */
export function load(paths){
  const files=[],skipped=[];
  const add=path=>{
    try{const data=JSON.parse(readFileSync(path,'utf8'));if(data?.schema===SCHEMA&&Array.isArray(data.runs))files.push({path,data});else skipped.push(`${path}: não é ${SCHEMA}`);}
    catch(e){skipped.push(`${path}: ${e.message}`);}
  };
  for(const p of paths){
    try{if(statSync(p).isDirectory()){for(const f of readdirSync(p).sort())if(f.endsWith('.json'))add(join(p,f));}else add(p);}
    catch(e){skipped.push(`${p}: ${e.message}`);}
  }
  return {files,skipped};
}

/** The table's rows from export objects (one per phone and room). Pure: the test calls it. Never throws on partial files. */
export function summarize(exports){
  const phones=(Array.isArray(exports)?exports:[]).filter(e=>e?.schema===SCHEMA&&Array.isArray(e.runs));
  const runsOf=e=>e.runs.filter(r=>r&&typeof r==='object');
  const novices=phones.filter(e=>e.novice===true);
  // The novice metrics read the first run of each first-time phone; without any novice, every phone's first run (noted).
  const base=(novices.length?novices:phones).map(e=>runsOf(e)[0]).filter(Boolean);
  const noviceNote=novices.length?'':' (nenhum celular novato: todos)';
  const runs=phones.flatMap(runsOf);
  const rows=[];
  /** A share target over the runs that HAVE the value (`get` not null); the others are counted as "sem dado". */
  const share=(key,list,get,pass)=>{
    const t=TARGETS[key],known=list.filter(r=>get(r)!==null),n=known.length,k=known.filter(r=>pass(get(r))).length,missing=list.length-n;
    rows.push({key,label:t.label,value:n?`${k} de ${n} (${pct(k/n)})${missing?`, ${missing} sem dado`:''}`:'sem dado',ok:n?k/n>=t.share:null,detail:''});
    return rows[rows.length-1];
  };
  // The novice's move is the finger's first drag on the joystick; without it (no touch), the hero's first step.
  const move=r=>num(r.firstStickMs)??num(r.firstMoveMs);
  share('firstMove',base,move,v=>v<=TARGETS.firstMove.limitMs).detail=`mediana ${sec(median(base.map(move)))} (herói anda: ${sec(median(base.map(r=>r.firstMoveMs)))}); tentou na sala de espera: ${novices.filter(e=>num(obj(e.waitingRoom).stickMs)!==null).length}${noviceNote}`;
  share('round1',base,r=>num(obj(r.downs).meRound1),v=>v===0).detail=`quedas no round 1 (da turma): ${sumOf(base,r=>obj(r.downs).teamRound1)}${noviceNote}`;
  {
    const o=r=>obj(r.offers);
    const chosen=sumOf(runs,r=>o(r).chosen),defaulted=sumOf(runs,r=>o(r).defaulted),n=chosen+defaulted;
    const part=k=>{const c=sumOf(runs,r=>obj(o(r)[k]).chosen),d=sumOf(runs,r=>obj(o(r)[k]).defaulted);return c+d?`${pct(d/(c+d))} (${d} de ${c+d})`:'—';};
    const v=n?defaulted/n:null;
    rows.push({key:'defaulted',label:TARGETS.defaulted.label,value:n?`${pct(v)} (${defaulted} de ${n})`:'sem dado',ok:n?v<TARGETS.defaulted.max:null,
      detail:`chegaram em combate ${part('combat')}; no intervalo ${part('intermission')}; toques não enviados ${sumOf(runs,r=>o(r).unsent)}`});
  }
  {
    // A group (random label) counts when one of its phones saw a result; it passes when any of them saw the rematch start.
    const groups=new Map();
    for(const e of phones){const id=typeof e.group==='string'&&e.group?e.group:`sem-grupo-${groups.size}`;const g=groups.get(id)??{result:false,rematch:false};
      for(const r of runsOf(e)){if(r.ended==='result')g.result=true;if(obj(r.rematch).started===true)g.rematch=true;}groups.set(id,g);}
    const played=[...groups.values()].filter(g=>g.result),k=played.filter(g=>g.rematch).length;
    rows.push({key:'rematch',label:TARGETS.rematch.label,value:played.length?`${k} de ${played.length} grupos (${pct(k/played.length)})`:'sem dado',ok:played.length?k/played.length>=TARGETS.rematch.share:null,
      detail:`apertaram Revanche: ${runs.filter(r=>num(obj(r.rematch).pressedMs)!==null).length} vez(es)`});
  }
  share('chip',base,r=>num(obj(r.chip).firstMs),v=>v<=TARGETS.chip.limitMs).detail=`mediana ${sec(median(base.map(r=>obj(r.chip).firstMs)))}; 1º toque no chip: mediana ${sec(median(base.map(r=>obj(r.chip).firstTapMs)))}${noviceNote}`;

  // Without a target: what the observer reads next to the table.
  const info=[];
  info.push(['Parado nos primeiros 60 s (mediana, 1ª run)',sec(median(base.map(r=>{const v=num(obj(r.still60).seconds);return v===null?null:v*1000;})))]);
  info.push(['Tempo de escolha (mediana das médias por run)',sec(median(runs.map(r=>obj(r.offers).choiceMsAvg)))]);
  info.push(['"Depois" tocado',String(sumOf(runs,r=>obj(r.offers).later))]);
  info.push(['Caídos resgatados / perdidos',`${sumOf(runs,r=>obj(r.fallen).rescued)} / ${sumOf(runs,r=>obj(r.fallen).lost)}`]);
  info.push(['"Me salva" enviados / recebidos',`${sumOf(runs,r=>obj(r.pings).sent)} / ${sumOf(runs,r=>obj(r.pings).received)}`]);
  info.push(['Emotes',runs.some(r=>obj(r.emotes).available===true)?String(sumOf(runs,r=>obj(r.emotes).sent)):'não existem na sala ainda']);
  const LESSON_NAMES={walk:'andar',xp:'gotinhas (XP)',chip:'chip +N',rescue:'resgatar',gather:'coleta'};
  for(const lesson of Object.keys(LESSON_NAMES)){
    const seen=base.map(r=>obj(obj(r.coach)[lesson])).filter(l=>Object.keys(l).length&&l.knownAtStart!==true);
    if(!seen.length)continue;
    const learned=seen.filter(l=>num(l.learnedMs)!==null);
    info.push([`Dica "${LESSON_NAMES[lesson]}": aprendida`,`${learned.length} de ${seen.length} (vista em ${sec(median(seen.map(l=>l.shownMs)))}, aprendida em ${sec(median(learned.map(l=>l.learnedMs)))}; por ação ${learned.filter(l=>l.by==='action').length})`]);
  }
  const owner=k=>sumOf(phones,e=>obj(e.owner)[k]);
  info.push(['Comandos de dono confirmados (expulsar / pôr bot / tirar bot)',`${owner('kick')} / ${owner('botAdd')} / ${owner('botRemove')} (sem confirmação ${owner('unconfirmed')}, não enviados ${owner('unsent')})`]);
  const moments={};for(const r of runs)for(const [k,v] of Object.entries(obj(r.moments)))if(num(v)!==null)moments[k]=(moments[k]??0)+v;
  info.push(['Momentos de risada que aconteceram (ver a folha do observador)',Object.entries(moments).map(([k,v])=>`${k} ${v}`).join(', ')||'—']);
  return {phones:phones.length,novices:novices.length,groups:new Set(phones.map(e=>e.group)).size,runs:runs.length,rows,info};
}

export function formatReport(s){
  const mark=ok=>ok===null?'sem dado':ok?'ok':'falhou';
  const lines=[`Playtest UX: ${s.phones} celular(es), ${s.novices} novato(s), ${s.groups} grupo(s), ${s.runs} run(s)`,'',
    '| Métrica-alvo | Resultado | Veredito | Detalhe |','|---|---|---|---|',
    ...s.rows.map(r=>`| ${r.label} | ${r.value} | ${mark(r.ok)} | ${r.detail} |`),'',
    '| Sem alvo | Valor |','|---|---|',...s.info.map(([k,v])=>`| ${k} | ${v} |`)];
  return lines.join('\n');
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const args=process.argv.slice(2);
  if(!args.length){console.error('Uso: node scripts/ux-report.mjs <arquivo.json|pasta>...');process.exit(1);}
  const {files,skipped}=load(args);
  for(const s of skipped)console.error(`ignorado: ${s}`);
  if(!files.length){console.error('Nenhum JSON viagem-ux/1 válido.');process.exit(1);}
  console.log(formatReport(summarize(files.map(f=>f.data))));
}
