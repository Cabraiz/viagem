// After limpar-ilhas: the delivered sheets' sha256 in public/art/towers/manifest.json and the index (public/art/manifest.json).
import {createHash} from 'node:crypto';import {readFileSync,writeFileSync} from 'node:fs';
const files=process.argv.slice(2);let n=0;
for(const path of ['public/art/towers/manifest.json','public/art/manifest.json']){
  let text=readFileSync(path,'utf8');
  const json=JSON.parse(text),pieces=path.endsWith('towers/manifest.json')?json.pieces:json.groups.torres.pieces;
  for(const rel of files){const [k]=rel.split('/'),sha=createHash('sha256').update(readFileSync('public/art/towers/'+rel)).digest('hex');
    for(const f of Object.values(pieces[k].files)){
      if(f.file===rel&&f.sha256&&f.sha256!==sha){text=text.split(f.sha256).join(sha);n++;}
      for(const p of f.pages??[])if(p.file===rel&&p.sha256&&p.sha256!==sha){text=text.split(p.sha256).join(sha);n++;}
    }}
  writeFileSync(path,text);
}
console.log('trocados',n);
