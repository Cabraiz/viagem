// Antes × depois: node compara.mjs [antes depois] -> markdown table of the card's items over {pref}-{1,3,6}p.json.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const prefs=process.argv.slice(2).length?process.argv.slice(2):['antes','depois'];
const r1=v=>Math.round(v*10)/10,sum=a=>a.reduce((x,y)=>x+y,0);
const med=a=>{if(!a.length)return '-';const s=[...a].sort((x,y)=>x-y);return r1(s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2);};
const legit=e=>e.mode==='bank'||e.mode==='push'||((e.mode==='home'||e.mode==='carro'||e.mode==='escort')&&(e.carU??99)<=6)||e.attack>=.3;
function stats(runs){
  const n=runs.length,o={};
  o.runs=n;
  o.wins=runs.filter(r=>r.outcome==='victory').length;
  o.defCar=runs.filter(r=>r.outcome==='defeat'&&r.cause==='car').length;
  o.defTeam=runs.filter(r=>r.outcome==='defeat'&&r.cause!=='car').length;
  o.cap=runs.filter(r=>r.outcome!=='victory'&&r.outcome!=='defeat').length;
  const downs=runs.flatMap(r=>r.downs),elim=downs.filter(d=>d.end==='eliminated');
  o.downs=downs.length;o.elim=elim.length;
  o.elimMate2=elim.filter(d=>d.mateNearS>=2).length;o.elimMate3=elim.filter(d=>d.mateNearS>3).length;
  o.revMed=med(downs.filter(d=>d.end==='revived').map(d=>d.endS-d.atS));
  const idle=runs.flatMap(r=>r.idle).filter(e=>!legit(e));
  o.idleS=r1(sum(idle.map(e=>e.durS))/n);
  const by=m=>idle.filter(e=>e.mode===m);
  o.fight10=by('fight').filter(e=>e.durS>10).length;o.fightS=r1(sum(by('fight').map(e=>e.durS))/n);
  o.fightOpen=by('fight').filter(e=>e.durS>10&&e.startS<60).length;
  o.build8=by('build').filter(e=>e.durS>8).length;o.buildS=r1(sum(by('build').map(e=>e.durS))/n);
  o.loot8=by('loot').filter(e=>e.durS>8).length;o.lootS=r1(sum(by('loot').map(e=>e.durS))/n);
  const far=runs.flatMap(r=>r.far);o.farS=r1(sum(far.map(e=>e.durS))/n);o.farMax=Math.max(0,...far.map(e=>e.carU??0));
  const st=runs.flatMap(r=>r.stuck);o.stuckS=r1(sum(st.map(e=>e.durS))/n);o.stuckCar=r1(sum(st.filter(e=>e.near==='carro').map(e=>e.durS))/n);
  const cr=runs.flatMap(r=>r.crates),op=cr.filter(c=>c.openedS!==null);
  o.crates=`${r1(op.length/Math.max(1,cr.length)*100)}%`;
  const rr=k=>{const a=cr.filter(c=>c.rarity===k);return `${r1(a.filter(c=>c.openedS!==null).length/Math.max(1,a.length)*100)}%`;};
  o.r1=rr(1);o.r2=rr(2);o.r3=rr(3);
  const nearC=cr.filter(c=>(c.carU??99)<=20&&c.openedS!==null);o.crateNearMed=med(nearC.map(c=>c.openedS-c.bornS));
  o.kills=r1(sum(runs.map(r=>r.kills))/n);
  return o;
}
const rows=[['runs','partidas'],['wins','vitórias'],['defCar','derrotas Uno'],['defTeam','derrotas time'],['cap','estouro 30 min'],
  ['downs','quedas'],['elim','eliminados'],['elimMate2','elim. c/ colega ≤6 u ≥2 s'],['elimMate3','elim. c/ colega ≤6 u >3 s'],['revMed','reviver mediana s'],
  ['idleS','parado "burro" s/partida'],['fight10','fight parado >10 s (ep.)'],['fightOpen','  desses, na abertura (<60 s)'],['fightS','fight parado s/partida'],
  ['build8','build parado >8 s (ep.)'],['buildS','build parado s/partida'],['loot8','loot parado >8 s (ep.)'],['lootS','loot parado s/partida'],
  ['farS','longe do Uno s/partida'],['farMax','longe máx u'],['stuckS','preso s/partida'],['stuckCar','preso no Uno s/partida'],
  ['crates','caixas abertas'],['r1','  r1'],['r2','  r2'],['r3','  r3'],['crateNearMed','caixa ≤20 u: até abrir s'],['kills','abates/partida']];
const data={};
for(const p of prefs)for(const n of [1,3,6]){const f=path.join(dir,`${p}-${n}p.json`);data[`${p}${n}`]=fs.existsSync(f)?stats(JSON.parse(fs.readFileSync(f,'utf8'))):null;}
const cols=[1,3,6].flatMap(n=>prefs.map(p=>[`${n}p ${p}`,`${p}${n}`]));
console.log(`| | ${cols.map(c=>c[0]).join(' | ')} |`);console.log(`|---|${cols.map(()=>'---').join('|')}|`);
for(const [k,l] of rows)console.log(`| ${l} | ${cols.map(([,c])=>data[c]?data[c][k]:'-').join(' | ')} |`);
