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
  firstMove:{label:'1º movimento ≤ 3 s',limitMs:3000,share:.8,who:'novatos'},
  round1:{label:'Round 1 sem queda (4 de 5 novatos)',share:.8,who:'novatos'},
  defaulted:{label:'Ofertas no padrão < 20%',max:.2,who:'todas as runs'},
  rematch:{label:'Revanche ≥ 60% dos grupos',share:.6,who:'grupos'},
  chip:{label:'1º chip ≤ 30 s',limitMs:30000,share:.8,who:'novatos'},
};

const median=list=>{const s=list.filter(v=>typeof v==='number').sort((a,b)=>a-b);if(!s.length)return null;const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const sec=ms=>ms===null||ms===undefined?'—':`${(ms/1000).toFixed(1).replace('.',',')} s`;
const pct=v=>v===null?'—':`${Math.round(v*100)}%`;

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

/** The table's rows from export objects (one per phone and room). Pure: the test calls it. */
export function summarize(exports){
  const phones=exports.filter(e=>e?.schema===SCHEMA&&Array.isArray(e.runs));
  const novices=phones.filter(e=>e.novice);
  // The novice metrics read the first run of each first-time phone; without any novice, every phone's first run (noted).
  const base=(novices.length?novices:phones).map(e=>e.runs[0]).filter(Boolean);
  const noviceNote=novices.length?'':' (nenhum celular novato: todos)';
  const runs=phones.flatMap(e=>e.runs);
  const rows=[];
  const share=(key,list,pass)=>{
    const t=TARGETS[key],n=list.length,k=list.filter(pass).length;
    rows.push({key,label:t.label,value:n?`${k} de ${n}`:'sem dado',ok:n?k/n>=t.share:null,detail:''});
    return rows[rows.length-1];
  };
  // The novice's move is the finger's first drag on the joystick; without it (no touch), the hero's first step.
  const move=r=>r.firstStickMs??r.firstMoveMs??null;
  const firstMoves=base.map(move);
  share('firstMove',base,r=>move(r)!==null&&move(r)<=TARGETS.firstMove.limitMs).detail=`mediana ${sec(median(firstMoves))} (herói anda: ${sec(median(base.map(r=>r.firstMoveMs)))}); nunca andou: ${firstMoves.filter(v=>v===null).length}${noviceNote}`;
  share('round1',base,r=>r.downs?.meRound1===0).detail=`quedas no round 1 (da turma): ${base.reduce((a,r)=>a+(r.downs?.teamRound1??0),0)}${noviceNote}`;
  {
    const sum=(f)=>runs.reduce((a,r)=>a+f(r),0);
    const chosen=sum(r=>r.offers?.chosen??0),defaulted=sum(r=>r.offers?.defaulted??0),n=chosen+defaulted;
    const part=k=>{const c=sum(r=>r.offers?.[k]?.chosen??0),d=sum(r=>r.offers?.[k]?.defaulted??0);return c+d?`${pct(d/(c+d))} (${d} de ${c+d})`:'—';};
    const v=n?defaulted/n:null;
    rows.push({key:'defaulted',label:TARGETS.defaulted.label,value:n?`${pct(v)} (${defaulted} de ${n})`:'sem dado',ok:n?v<TARGETS.defaulted.max:null,
      detail:`em combate ${part('combat')}; no intervalo ${part('intermission')}`});
  }
  {
    // A group (room) counts when one of its phones saw a result; it passes when any of them saw the rematch start.
    const groups=new Map();
    for(const e of phones){const g=groups.get(e.group)??{result:false,rematch:false};for(const r of e.runs){if(r.ended==='result')g.result=true;if(r.rematch?.started)g.rematch=true;}groups.set(e.group,g);}
    const played=[...groups.values()].filter(g=>g.result),k=played.filter(g=>g.rematch).length;
    rows.push({key:'rematch',label:TARGETS.rematch.label,value:played.length?`${k} de ${played.length} grupos`:'sem dado',ok:played.length?k/played.length>=TARGETS.rematch.share:null,
      detail:`apertaram Revanche: ${runs.filter(r=>r.rematch?.pressedMs!==null&&r.rematch?.pressedMs!==undefined).length} vez(es)`});
  }
  share('chip',base,r=>r.chip?.firstMs!==null&&r.chip?.firstMs!==undefined&&r.chip.firstMs<=TARGETS.chip.limitMs).detail=`mediana ${sec(median(base.map(r=>r.chip?.firstMs)))}; 1º toque no chip: mediana ${sec(median(base.map(r=>r.chip?.firstTapMs)))}${noviceNote}`;

  // Without a target: what the observer reads next to the table.
  const info=[];
  info.push(['Parado nos primeiros 60 s (mediana, 1ª run)',sec(median(base.map(r=>r.still60?.seconds*1000)))]);
  info.push(['Tempo de escolha (mediana das médias por run)',sec(median(runs.map(r=>r.offers?.choiceMsAvg)))]);
  info.push(['"Depois" tocado',String(runs.reduce((a,r)=>a+(r.offers?.later??0),0))]);
  info.push(['Caídos resgatados / perdidos',`${runs.reduce((a,r)=>a+(r.fallen?.rescued??0),0)} / ${runs.reduce((a,r)=>a+(r.fallen?.lost??0),0)}`]);
  info.push(['"Me salva" enviados / recebidos',`${runs.reduce((a,r)=>a+(r.pings?.sent??0),0)} / ${runs.reduce((a,r)=>a+(r.pings?.received??0),0)}`]);
  info.push(['Emotes',runs.some(r=>r.emotes?.available)?String(runs.reduce((a,r)=>a+(r.emotes?.sent??0),0)):'não existem na sala ainda']);
  const LESSON_NAMES={walk:'andar',xp:'gotinhas (XP)',chip:'chip +N',rescue:'resgatar',gather:'coleta'};
  for(const lesson of Object.keys(LESSON_NAMES)){
    const seen=base.filter(r=>r.coach?.[lesson]&&!r.coach[lesson].knownAtStart);
    if(!seen.length)continue;
    const learned=seen.filter(r=>r.coach[lesson].learnedMs!==null);
    info.push([`Dica "${LESSON_NAMES[lesson]}": aprendida`,`${learned.length} de ${seen.length} (vista em ${sec(median(seen.map(r=>r.coach[lesson].shownMs)))}, aprendida em ${sec(median(learned.map(r=>r.coach[lesson].learnedMs)))}; por ação ${learned.filter(r=>r.coach[lesson].by==='action').length})`]);
  }
  const owner=phones.reduce((a,e)=>({kick:a.kick+(e.owner?.kick??0),botAdd:a.botAdd+(e.owner?.botAdd??0),botRemove:a.botRemove+(e.owner?.botRemove??0)}),{kick:0,botAdd:0,botRemove:0});
  info.push(['Comandos de dono (expulsar / pôr bot / tirar bot)',`${owner.kick} / ${owner.botAdd} / ${owner.botRemove}`]);
  const moments={};for(const r of runs)for(const [k,v] of Object.entries(r.moments??{}))moments[k]=(moments[k]??0)+v;
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
