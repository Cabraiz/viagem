// Aggregates runs-{1,3,6}p.json of audit-bots.ts into the numbers of the report (stdout, markdown-ish).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const r1=v=>Math.round(v*10)/10,sum=a=>a.reduce((x,y)=>x+y,0),mean=a=>a.length?r1(sum(a)/a.length):'-';
const med=a=>{if(!a.length)return '-';const s=[...a].sort((x,y)=>x-y);return r1(s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2);};
const cell=(x,y,g=6)=>`${Math.floor(x/g)*g},${Math.floor(y/g)*g}`;
const top=(o,n=8)=>Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k,v])=>`${k} ${typeof v==='number'?r1(v):v}`).join(' · ');
const add=(o,k,v=1)=>{o[k]=(o[k]??0)+v;};
// Legit idles: Trabalhar (bank), at the car (home/carro within 6 u), fighting (attack held), the obra (build), pushing the moto.
const legit=e=>e.mode==='bank'||e.mode==='push'||((e.mode==='home'||e.mode==='carro'||e.mode==='escort')&&(e.carU??99)<=6)||e.attack>=.3;
for(const n of [1,3,6]){
  const f=path.join(dir,`runs-${n}p.json`);if(!fs.existsSync(f))continue;
  const runs=JSON.parse(fs.readFileSync(f,'utf8'));
  console.log(`\n## ${n}p (${runs.length} runs)`);
  const out={};for(const r of runs)add(out,`${r.outcome}/${r.cause}`);
  console.log(`resultado: ${top(out)} | fim s: média ${mean(runs.map(r=>r.endS))} mediana ${med(runs.map(r=>r.endS))}`);
  // Phases.
  const ph={};for(const r of runs)for(const [k,v] of Object.entries(r.phases))add(ph,k,v);
  console.log(`fases (s médios por run): ${Object.entries(ph).map(([k,v])=>`${k} ${r1(v/runs.length)}`).join(' · ')}`);
  console.log(`1ª queda s: mediana ${med(runs.map(r=>r.firstDownS).filter(x=>x!==null))} (${runs.filter(r=>r.firstDownS!==null).length}/${runs.length}) | 1º nível s: ${med(runs.map(r=>r.firstLevelS).filter(x=>x!==null))} | chefe chamado s: ${med(runs.map(r=>r.bossS).filter(x=>x!==null))} (${runs.filter(r=>r.bossS!==null).length}) | pausas/run ${mean(runs.map(r=>r.pauses))} | ms/tick ${mean(runs.map(r=>r.msPerTick))}`);
  // Modes.
  const modes={};for(const r of runs)for(const b of r.bots)for(const [k,v] of Object.entries(b.modeS))add(modes,k,v);
  const tot=sum(Object.values(modes));
  console.log(`modos (% do tempo-bot): ${Object.entries(modes).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${r1(v/tot*100)}%`).join(' · ')}`);
  // Idle.
  const idle=runs.flatMap(r=>r.idle.map(e=>({...e,seed:r.seed}))),bad=idle.filter(e=>!legit(e));
  const byMode={};for(const e of bad)add(byMode,e.mode,e.durS);
  console.log(`parado >5 s: ${idle.length} episódios (${r1(sum(idle.map(e=>e.durS)))} s); fora dos legítimos ${bad.length} (${r1(sum(bad.map(e=>e.durS)))} s, ${r1(sum(bad.map(e=>e.durS))/runs.length)} s/run) por modo: ${top(byMode)}`);
  const pushing=bad.filter(e=>e.stick>=.5);console.log(`   desses, com o stick empurrando (preso, não "decidiu parar"): ${pushing.length} (${r1(sum(pushing.map(e=>e.durS)))} s)`);
  console.log(`   piores: ${bad.sort((a,b)=>b.durS-a.durS).slice(0,6).map(e=>`seed ${e.seed} ${e.bot}/${e.cls} ${e.mode} ${r1(e.durS)}s @${e.startS}s (${e.x},${e.y}) carro ${e.carU}u stick ${e.stick}`).join(' ; ')}`);
  // Stuck.
  const st=runs.flatMap(r=>r.stuck.map(e=>({...e,seed:r.seed})));
  const near={},stMode={},spots={},spotSeeds={};
  for(const e of st){add(near,e.near,e.durS);add(stMode,e.mode,e.durS);const c=cell(e.x,e.y);add(spots,c,e.durS);(spotSeeds[c]??=new Set()).add(e.seed);}
  console.log(`preso (empurra e não sai, ≥2 s): ${st.length} episódios, ${r1(sum(st.map(e=>e.durS)))} s (${r1(sum(st.map(e=>e.durS))/runs.length)} s/run), longos ≥10 s: ${st.filter(e=>e.durS>=10).length}`);
  console.log(`   onde: ${top(near)} | modo: ${top(stMode)}`);
  console.log(`   pontos (célula 6 u, s · sementes): ${Object.entries(spots).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>`(${k}) ${r1(v)}s·${spotSeeds[k].size}`).join(' ')}`);
  console.log(`   piores: ${st.sort((a,b)=>b.durS-a.durS).slice(0,5).map(e=>`seed ${e.seed} ${e.bot} ${e.mode} ${r1(e.durS)}s @${e.startS}s (${e.x},${e.y}) ${e.near}`).join(' ; ')}`);
  // Far.
  const far=runs.flatMap(r=>r.far.map(e=>({...e,seed:r.seed}))),farModes={};
  for(const e of far)for(const [k,v] of Object.entries(e.modes))add(farModes,k,v/20);
  console.log(`longe do carro (>25 u por >60 s): ${far.length} episódios, ${r1(sum(far.map(e=>e.durS)))} s (${r1(sum(far.map(e=>e.durS))/runs.length)} s/run); máx ${Math.max(0,...far.map(e=>e.carU??0))} u; modos nesse tempo: ${top(farModes)}`);
  console.log(`   piores: ${far.sort((a,b)=>b.durS-a.durS).slice(0,5).map(e=>`seed ${e.seed} ${e.bot}/${e.cls} ${r1(e.durS)}s @${e.startS}s até ${e.carU}u`).join(' ; ')}`);
  // Downs.
  const downs=runs.flatMap(r=>r.downs.map(d=>({...d,seed:r.seed})));const ends={};for(const d of downs)add(ends,d.end);
  const rev=downs.filter(d=>d.end==='revived'),elim=downs.filter(d=>d.end==='eliminated');
  const ignored=elim.filter(d=>d.mateNearS>=2),igModes={};for(const d of ignored)for(const [k,v] of Object.entries(d.mateNearModes))add(igModes,k,v/20);
  const src={};for(const d of downs)add(src,d.source??d.by?.replace(/[-_]?\d+$/,'')??'?');
  console.log(`quedas: ${downs.length} (${top(ends)}) | tempo até reviver mediana ${med(rev.map(d=>d.endS-d.atS))} s | eliminados com colega de pé a ≤6 u por ≥2 s: ${ignored.length}/${elim.length} (modos do colega: ${top(igModes)})`);
  console.log(`   eliminados sem colega por perto: ${elim.length-ignored.length}; distância mínima do colega mediana ${med(elim.map(d=>d.minMateU).filter(x=>x!==null))} u; quem derrubou: ${top(src,6)}`);
  console.log(`   exemplos ignorados: ${ignored.slice(0,4).map(d=>`seed ${d.seed} ${d.bot} caiu @${d.atS}s colega perto ${r1(d.mateNearS)}s`).join(' ; ')}`);
  // Enemies.
  const es=runs.flatMap(r=>r.enemyStuck.map(e=>({...e,seed:r.seed}))),eKind={},eSpot={};
  for(const e of es){add(eKind,e.kind);add(eSpot,cell(e.x,e.y,8));}
  console.log(`inimigo acordado parado ≥60 s: ${es.length} (${r1(es.length/runs.length)}/run) por tipo: ${top(eKind,6)} | pontos: ${top(eSpot,6)}`);
  // Crates.
  const cr=runs.flatMap(r=>r.crates.map(c=>({...c,seed:r.seed}))),nearC=cr.filter(c=>(c.carU??99)<=20);
  const byR={};for(const c of cr){const k=`r${c.rarity}`;byR[k]??=[0,0];byR[k][0]++;if(c.openedS!==null)byR[k][1]++;}
  console.log(`caixas: ${cr.length} vistas, abertas ${cr.filter(c=>c.openedS!==null).length} (${r1(cr.filter(c=>c.openedS!==null).length/Math.max(1,cr.length)*100)}%) | a ≤20 u do carro ao nascer: ${nearC.length}, abertas ${nearC.filter(c=>c.openedS!==null).length}, tempo até abrir mediana ${med(nearC.filter(c=>c.openedS!==null).map(c=>c.openedS-c.bornS))} s | por raridade (vistas/abertas): ${Object.entries(byR).map(([k,[a,b]])=>`${k} ${a}/${b}`).join(' ')}`);
  // Bot kills share.
  console.log(`abates/run ${mean(runs.map(r=>r.kills))}`);
  // Defeats.
  for(const r of runs.filter(r=>r.outcome==='defeat').slice(0,3)){console.log(`   derrota seed ${r.seed} (${r.cause}) @${r.endS}s, últimos 20 s:`);for(const l of r.lastMinute.slice(-4))console.log(`      ${l.atS}s ${l.snap}`);}
}
