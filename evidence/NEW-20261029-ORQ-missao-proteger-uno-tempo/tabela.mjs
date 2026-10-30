// Tabela das 3 versões: por nº de jogadores, mediana (min–max) da duração, vitórias, batidas (total, do orçamento
// BUDGET_BASE 25 + 3 por batida), tempo somado e ondas.
import fs from 'node:fs';
const dir=new URL('.',import.meta.url).pathname.replace(/^\/(\w:)/,'$1');
const med=a=>{const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length?(s.length&1?s[m]:(s[m-1]+s[m])/2):NaN;};
const f=(a,d=1)=>`${med(a).toFixed(d)} (${Math.min(...a).toFixed(d)}–${Math.max(...a).toFixed(d)})`;
const rows=['| versão | jog. | vitórias | duração min | batidas | +s por batidas | ondas | derrotas: causa |','|---|---|---|---|---|---|---|---|'];
for(const v of process.argv.slice(2)){
  const p=`${dir}/${v}.json`;if(!fs.existsSync(p)){rows.push(`| ${v} | (falta) |`);continue;}
  const runs=JSON.parse(fs.readFileSync(p,'utf8')).runs;
  for(const n of [1,3,6]){
    const rs=runs.filter(r=>r.players===n);if(!rs.length)continue;
    const o=rs.map(r=>r.objective??{}),wins=o.filter(x=>x.outcome==='victory').length;
    const causes={};for(const x of o)if(x.outcome!=='victory'){const c=x.cause??x.outcome??'?';causes[c]=(causes[c]??0)+1;}
    rows.push(`| ${v} | ${n}p | ${wins}/${rs.length} | ${f(rs.map(r=>r.simMinutes),2)} | ${f(o.map(x=>(x.budget-25)/3),0)} | ${o.some(x=>x.addedS!==undefined)?f(o.map(x=>x.addedS??0),0):'—'} | ${f(rs.map(r=>r.nests?.waves?.n??0),0)} | ${Object.entries(causes).map(([k,c])=>`${k} ${c}`).join(', ')||'—'} |`);
  }
}
console.log(rows.join('\n'));
