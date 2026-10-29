// node agrega.mjs <pref> -> build reasons (s/partida), by moto phase, and crates by rarity × distance to the car.
import fs from 'node:fs';
const pref=process.argv[2]??'antes';
for(const n of [1,3,6]){
  const f=`${pref}-${n}p.json`;if(!fs.existsSync(f))continue;
  const runs=JSON.parse(fs.readFileSync(f,'utf8')),N=runs.length,why={},ph={};
  for(const r of runs){for(const[k,v]of Object.entries(r.buildWhy??{}))why[k]=(why[k]??0)+v;for(const[k,v]of Object.entries(r.buildWhyPhase??{}))ph[k]=(ph[k]??0)+v;}
  const fmt=o=>Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>`${k} ${(v/N).toFixed(1)}`).join(' | ');
  console.log(`${n}p N=${N} built/partida ${(runs.reduce((a,r)=>a+(r.built??0),0)/N).toFixed(1)}`);
  console.log('  motivo:',fmt(why));console.log('  fase:',fmt(ph));
  const cr=runs.flatMap(r=>r.crates);
  for(const k of [1,2,3]){const a=cr.filter(c=>c.rarity===k);const b=[[0,12],[12,20],[20,30],[30,999]].map(([lo,hi])=>{const x=a.filter(c=>(c.carU??999)>=lo&&(c.carU??999)<hi);return `${lo}-${hi}:${x.filter(c=>c.openedS!==null).length}/${x.length}`;});
    const early=a.filter(c=>c.bornS<240);console.log(`  r${k}: ${b.join(' ')} | nascidas<240s abertas ${early.filter(c=>c.openedS!==null).length}/${early.length}`);}
}
