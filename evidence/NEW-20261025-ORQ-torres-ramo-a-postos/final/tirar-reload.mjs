// Etapa 2: the new crews have idle + fire only (the client never plays reload): drops the old reload sheet of the
// given towers from both manifests and deletes its file. node tirar-reload.mjs <id> [...]
import {readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
const ids=process.argv.slice(2);
for(const [path,get] of [['public/art/towers/manifest.json',j=>j.pieces],['public/art/manifest.json',j=>j.groups.torres.pieces]]){
  const text=readFileSync(path,'utf8'),json=JSON.parse(text),pieces=get(json);
  for(const id of ids)if(pieces[id]?.files?.reload)delete pieces[id].files.reload;
  const indent=/\n( +)"/.exec(text)?.[1]??'';
  writeFileSync(path,JSON.stringify(json,null,indent.length||undefined)+(text.endsWith('\n')?'\n':''));
}
for(const id of ids){const f=`public/art/towers/${id}/reload.webp`;if(existsSync(f)){rmSync(f);console.log('apagado',f);}}
