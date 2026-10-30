// Tabela das versões (antes = elenco legado, a referência): por nº de jogadores, vitórias, onda da derrota, tempo até o
// carro cair, duração, mortes por onda (eliminados somados nas 16 seeds; w0 = antes da 1ª onda) e a mistura da horda.
// Uso: node tabela.mjs antes so3-sem-ajuste so3-ajustado
import fs from 'node:fs';
const dir=new URL('.',import.meta.url).pathname.replace(/^\/(\w:)/,'$1');
const med=a=>{const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length?(s.length&1?s[m]:(s[m-1]+s[m])/2):NaN;};
const f=(a,d=1)=>a.length?`${med(a).toFixed(d)} (${Math.min(...a).toFixed(d)}–${Math.max(...a).toFixed(d)})`:'—';
const load=v=>{const p=`${dir}/${v}.json`;return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')).runs:null;};
const stats=rs=>{
  const o=rs.map(r=>r.objective??{}),lost=o.filter(x=>x.outcome!=='victory'),car=lost.filter(x=>x.cause==='car');
  const causes={};for(const x of lost){const c=x.cause??'?';causes[c]=(causes[c]??0)+1;}
  const wn=Math.max(0,...rs.map(r=>r.nests?.waves?.eliminated?.length??0)),sum=k=>Array.from({length:wn},(_,i)=>rs.reduce((s,r)=>s+(r.nests?.waves?.[k]?.[i]??0),0));
  const kinds={};for(const r of rs)for(const [k,c] of Object.entries(r.enemies?.kinds??{}))kinds[k]=(kinds[k]??0)+c;
  const total=Object.values(kinds).reduce((a,b)=>a+b,0),top=Object.entries(kinds).sort((a,b)=>b[1]-a[1]);
  return {n:rs.length,wins:o.filter(x=>x.outcome==='victory').length,lostWave:lost.map(x=>x.wave??0),carS:car.map(x=>x.seconds),
    min:rs.map(r=>r.simMinutes),causes,elim:sum('eliminated'),downed:sum('downed'),
    mix:top.slice(0,3).map(([k,c])=>`${k} ${Math.round(c/total*100)} %`).join(', ')+(top.length>3?`, +${top.length-3} tipos`:''),perRun:Math.round(total/rs.length)};
};
const vs=process.argv.slice(2),ref=load(vs[0]);
const rows=['| versão | jog. | vitórias | Δ vitórias × antes | onda da derrota | carro caiu em (s) | duração min | mortes por onda (w0, w1…) | caídos por onda | derrotas: causa | inimigos/partida | horda |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|'];
for(const v of vs){
  const runs=load(v);if(!runs){rows.push(`| ${v} | (falta) |`);continue;}
  for(const n of [1,3,6]){
    const rs=runs.filter(r=>r.players===n);if(!rs.length)continue;
    const s=stats(rs),r0=ref?stats(ref.filter(r=>r.players===n)):null;
    const d=r0&&v!==vs[0]?`${s.wins-r0.wins>=0?'+':''}${s.wins-r0.wins} (${Math.round((s.wins-r0.wins)/s.n*100)} pp)`:'—';
    rows.push(`| ${v} | ${n}p | ${s.wins}/${s.n} | ${d} | ${f(s.lostWave,0)} | ${f(s.carS,0)} | ${f(s.min,2)} | ${s.elim.join(' ')||'—'} | ${s.downed.join(' ')||'—'} | ${Object.entries(s.causes).map(([k,c])=>`${k} ${c}`).join(', ')||'—'} | ${s.perRun} | ${s.mix} |`);
  }
}
console.log(rows.join('\n'));
