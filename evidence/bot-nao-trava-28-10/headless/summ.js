const pre=process.argv[2];for(const n of [1,3]){const r=require('fs').readFileSync(pre+'-'+n+'.jsonl','utf8').trim().split('\n').map(JSON.parse);
const np=r.filter(x=>!x.partner),pp=r.filter(x=>x.partner);
console.log(n+'p non-partner: armed<=30s',np.filter(x=>x.armed!==null&&x.armed<=30).length+'/'+np.length,'never',np.filter(x=>x.armed===null).map(x=>x.seed+x.id).join(','),'| max5s>1',np.filter(x=>x.max5s>1).map(x=>x.seed+x.id+':'+x.max5s).join(','),'| slow',np.filter(x=>x.armed>30).map(x=>x.seed+x.id+'@'+x.armed).join(','),'| flips',np.reduce((a,x)=>a+x.flips,0));
if(pp.length)console.log('  partner armed',pp.filter(x=>x.armed!==null).length+'/'+pp.length);}
for(const n of [1,3]){const r=require('fs').readFileSync(pre+'-'+n+'.jsonl','utf8').trim().split('\n').map(JSON.parse).filter(x=>!x.partner);
if(r[0].max5sMerged===undefined)continue;console.log(n+'p merged>1',r.filter(x=>x.max5sMerged>1).map(x=>x.seed+x.id+':'+x.max5sMerged).join(','),'| first30s>1',r.filter(x=>x.max5s30>1).map(x=>x.seed+x.id+':'+x.max5s30).join(','));}
