/**
 * Referência do fundo do minimapa (card NEW-20261025-ORQ-minimapa-arte-chatgpt, etapa 4): o mapa real da Cidade Nevada
 * visto de cima, alinhado ao mundo (o minimapa gira a imagem para o losango com imageTransform, então a mesma imagem
 * serve para toda vista da câmera). Gera, em <saída>/:
 *   ref-topo.png      as cores do minimapa de hoje (terrain.ts cityTerrainPixels), ampliadas sem suavizar;
 *   planta.png        a planta fina (4 amostras por célula): onde se anda claro (neve, avenida, praça, gelo), o sólido
 *                     escuro, a água azul, o viaduto claro com borda — a referência que vai ao ChatGPT;
 *   mascara.png       o sólido da planta em preto, o resto branco: o gabarito da métrica de igualdade (iou.ts);
 *   ref-losango.png   a mesma imagem girada como o minimapa a mostra (só para olhar).
 * Uso: node --experimental-strip-types scripts/minimapa/referencia.ts <saída> [lado=1024]
 */
import {readFileSync,mkdirSync} from 'node:fs';
import sharp from 'sharp';
import {decodeCityAsset} from '../../src/maps/index.ts';
import {MM_COLORS,cityTerrainPixels} from '../../src/client/hud/wc-minimap/terrain.ts';

const out=process.argv[2]??'evidence/minimapa-arte-chatgpt/ref',side=Number(process.argv[3]??1024);
mkdirSync(out,{recursive:true});
const decoded=decodeCityAsset(readFileSync('public/maps/cidade-nevada.json','utf8'));
if(!decoded.ok)throw new Error(decoded.error);
const px=cityTerrainPixels(decoded.asset),W=px.width,H=px.height;
const dark=[1,3,5].map(i=>parseInt(MM_COLORS.building.slice(i,i+2),16));
const rgba={raw:{width:W,height:H,channels:4 as const}};
await sharp(Buffer.from(px.data.buffer),rgba).resize(side,side,{kernel:'nearest'}).png().toFile(`${out}/ref-topo.png`);
await sharp(Buffer.from(px.data.buffer),rgba).resize(side,side,{kernel:'nearest'}).rotate(45,{background:'#2b2542'}).png().toFile(`${out}/ref-losango.png`);
// The fine plan: one pixel per walkability sample.
const a=decoded.asset,S=4,step=a.unitsPerCell/S,FW=W*S,FH=H*S,plan=Buffer.alloc(FW*FH*4),solid=Buffer.alloc(FW*FH);
const hex=(h:string)=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
for(let y=0;y<FH;y++)for(let x=0;x<FW;x++){
  const wx=(x+.5)*step,wy=(y+.5)*step,i=y*FW+x,c=Math.floor(y/S)*W+Math.floor(x/S);
  const walk=a.walkableAt(wx,wy),water=a.waterAt?.(wx,wy);
  // The ground's colour of today's image, on the walkable samples; solid one dark tone.
  let col:number[];
  if(water)col=hex(MM_COLORS.water);
  else if(!walk)col=dark;
  else{const r=px.data[c*4],g=px.data[c*4+1],b=px.data[c*4+2];col=r===dark[0]&&g===dark[1]&&b===dark[2]?hex(MM_COLORS.snow):[r,g,b];}
  plan[i*4]=col[0];plan[i*4+1]=col[1];plan[i*4+2]=col[2];plan[i*4+3]=255;solid[i]=walk||water?255:0;
}
await sharp(plan,{raw:{width:FW,height:FH,channels:4}}).resize(side,side,{kernel:'nearest'}).png().toFile(`${out}/planta.png`);
await sharp(solid,{raw:{width:FW,height:FH,channels:1}}).resize(side,side,{kernel:'nearest'}).png().toFile(`${out}/mascara.png`);
await sharp(plan,{raw:{width:FW,height:FH,channels:4}}).resize(side,side,{kernel:'nearest'}).rotate(45,{background:'#2b2542'}).png().toFile(`${out}/planta-losango.png`);
let built=0;for(const v of solid)if(!v)built++;
console.log(JSON.stringify({cells:[W,H],unit:px.unit,origin:px.origin,solid:+(built/(FW*FH)).toFixed(3),out}));
