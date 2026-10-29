import fs from 'node:fs';
const dir=process.argv[2];
for(const p of [1,3,6]){
  const runs=fs.readdirSync(dir).filter(f=>f.startsWith(`runs-${p}p`)&&f.endsWith('.json')).flatMap(f=>JSON.parse(fs.readFileSync(dir+'/'+f,'utf8')));
  if(!runs.length)continue;
  let out=0,comp=0,st=0,s8=0,nu=0,wins=0;const near=[];
  for(const r of runs){out+=r.person.outS;comp+=r.person.companyS;st+=r.enemyStuck.length;s8+=r.enemyStill8.length;nu+=r.nudges??0;if(r.outcome==='victory')wins++;near.push(...r.person.nearestU);}
  near.sort((a,b)=>a-b);const q=f=>near[Math.floor(f*(near.length-1))];
  console.log(`${p}p n=${runs.length} wins ${wins} | out ${out.toFixed(0)}s company ${(comp/out*100).toFixed(1)}% nearest p50 ${q(.5)} p80 ${q(.8)} p95 ${q(.95)} | stuck60 ${st} (${(st/runs.length).toFixed(2)}/run) still8 ${s8} nudges ${nu}`);
}
