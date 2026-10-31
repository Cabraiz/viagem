// NEW-20261031-ORQ-esconder-dejetos-sem-brilho: every piece of junk on the real map (debris props, rubble lots, sidewalk
// junk decor) with its count and world centers, for the numbered prancha (fotos.mjs).
//   node --experimental-strip-types scripts/dejetos/catalogo.ts > <out.json>
import {readFileSync} from 'node:fs';
import {parseArtIndex} from '../../src/client/art/manifest.ts';
import {buildCityArtPlan,propSheet,planLots} from '../../src/client/render/city/art-plan.ts';
import {cityRenderAsset} from '../../src/client/render/city/from-maps.ts';
import {decodeCityAsset} from '../../src/maps/index.ts';

/** The sidewalk decor that is junk (the rest of OBJETOS_1/2 are stalls, plants, vehicles in use). */
export const JUNK_DECOR=['cacamba-entulho','saco-lixo','caixa-papelao','pneus-empilhados','geladeira-calcada','maquina-lavar-calcada',
  'presepio-quebrado','arvore-natal-torta','kombi-velha','moto-velha','carroca'];

const d=decodeCityAsset(readFileSync('public/maps/cidade-nevada.json','utf8'));
if(!d.ok)throw new Error(d.error);
const asset=cityRenderAsset(d.asset),cell=asset.cell,o=asset.origin;
const plan=buildCityArtPlan(parseArtIndex(JSON.parse(readFileSync('public/art/manifest.json','utf8'))));
type At={x:number;y:number};
const items=new Map<string,{key:string;source:'prop'|'lot'|'decor';at:At[]}>();
const add=(key:string,source:'prop'|'lot'|'decor',at:At)=>{
  const it=items.get(key)??{key,source,at:[]};it.at.push({x:+at.x.toFixed(2),y:+at.y.toFixed(2)});items.set(key,it);
};
for(const p of asset.props){
  if(p.kind!=='debris')continue;
  const s=propSheet(p,plan);add(s?s.key:`(sem arte) ${p.kind}`,'prop',p);
}
for(const b of asset.blocks){
  if(b.kind!=='rubble')continue;
  for(const l of planLots(b,plan))add(l.sheet.key,'lot',{x:o.x+(l.x+l.w/2)*cell,y:o.y+(l.y+l.h/2)*cell});
}
for(const x of d.asset.decor){
  if(x.cover)continue;
  const base=x.id.replace(/-\d$/,'');
  if(!JUNK_DECOR.includes(base))continue;
  add(`decor/${x.id}`,'decor',{x:o.x+(x.c+x.w/2)*cell,y:o.y+(x.r+x.h/2)*cell});
}
const out=[...items.values()].sort((a,b)=>a.source.localeCompare(b.source)||a.key.localeCompare(b.key))
  .map(it=>({key:it.key,source:it.source,count:it.at.length,at:it.at}));
process.stdout.write(JSON.stringify(out,null,1));
