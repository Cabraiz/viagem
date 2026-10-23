// Folhas do mockup fortes x fracos (card NEW-20261023-ORQ-inimigos-fortes-x-fracos): para cada variante, as folhas lite
// dos 5 inimigos da cena com a pseudo-sombra da V5a (scripts/pseudo-sombra.mjs força 2) por cima:
//   antes   a arte de hoje
//   escuro  os 3 fracos com a roupa escura (corrigir.py escuro)
//   cor     os 3 fracos com a roupa na cor de destaque (corrigir.py cor)
// O gravar-mockup.mjs serve essas folhas no lugar das lite (page.route). Nada versionado em public/.
//   node scripts/estudo-fortes-fracos/preparar-mockup.mjs <saida>
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {shadeSheet} from '../pseudo-sombra.mjs';

export const FORTES=['seguranca-de-shopping','motoboy'];
export const FRACOS={bebado:'#2f9a4a','tio-pave':'#2f6fd6','cobrador-do-busao':'#7b3fc4'};
const saida=process.argv[2]??'public/art/estudo/fortes-fracos';
const pieces=JSON.parse(readFileSync('public/art/enemies/manifest.json','utf8')).pieces;
const tmp=join(saida,'_recolor');
for(const [id,cor] of Object.entries(FRACOS))for(const modo of ['escuro','cor'])
  execFileSync('python',['-I','scripts/estudo-fortes-fracos/corrigir.py','.',id,modo,join(tmp,modo),'--fonte','lite','--cor',cor],{stdio:['ignore','ignore','inherit']});
let n=0;
for(const variante of ['antes','escuro','cor'])for(const id of [...FORTES,...Object.keys(FRACOS)]){
  for(const file of Object.values(pieces[id].files))for(const page of file.pages){
    if(!Array.isArray(file.liteCell))continue;
    const recolor=variante!=='antes'&&id in FRACOS?join(tmp,variante,page.file):null;
    const src=recolor&&existsSync(recolor)?recolor:join('public/art/lite/enemies',page.file);
    if(!existsSync(src))continue;
    mkdirSync(join(saida,variante,id),{recursive:true});
    await shadeSheet(src,join(saida,variante,page.file),file.liteCell,2);n++;
  }
}
console.log(`mockup: ${n} folhas em ${saida}`);
