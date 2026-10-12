// TEST 4-direction batch for the lab flag (?lab=sprites4) — NOT ART. Derived from the approved cidadao-comum sheet,
// which is only read: front-right is the sheet itself, front-left its mirror, and the two back facings recolour the
// head as hair and print "COSTAS" over the body, so a print shows at a glance which drawing the render picked.
// Every facing carries its code (FD, FE, CD, CE) on the shirt. Also writes the reference strip (standing cell of each
// facing, 768×192) next to the fixture. Overlays are clipped to the figure (blend "atop"),
// so alpha, pivot and height stay exactly the approved ones.
//   node scripts/make-lab-sprites4.mjs [outDir=artifacts/lab-sprites4]
//   node --experimental-strip-types scripts/import-sprites.mjs --dir4 artifacts/lab-sprites4 --lab
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {CELL,COLUMNS,ROWS,SINGLE,DIR4,FACING_BLOCKS,cellStats} from './sprite-atlas.mjs';

const ID='cidadao-comum';
const out=process.argv[2]??'artifacts/lab-sprites4';
const source=`public/art/sprites/${ID}.webp`;
const CODES={'front-right':'FD','front-left':'FE','back-right':'CD','back-left':'CE'};

// The approved drawing keeps its own feet column (the importer checks each class against its approved sheet), and the
// left facings are its mirror around the cell's centre, exactly like the flip the game does today.
const clear={r:0,g:0,b:0,alpha:0};
const at=frame=>({left:frame%COLUMNS*CELL,top:Math.floor(frame/COLUMNS)*CELL});
const cells=await Promise.all(Array.from({length:COLUMNS*ROWS},(_,frame)=>sharp(source).extract({...at(frame),width:CELL,height:CELL}).png().toBuffer()));
const sheet=inputs=>sharp({create:{width:SINGLE.width,height:SINGLE.height,channels:4,background:clear}})
  .composite(inputs.map((input,frame)=>({input,...at(frame)}))).png().toBuffer();
const straight=await sheet(cells);
const mirror=await sheet(await Promise.all(cells.map(cell=>sharp(cell).flop().png().toBuffer())));

async function block(facing){
  const base=facing.endsWith('left')?mirror:straight,back=facing.startsWith('back');
  const {data,info}=await sharp(base).raw().toBuffer({resolveWithObject:true});
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${SINGLE.width}" height="${SINGLE.height}">`;
  for(let frame=0;frame<COLUMNS*ROWS;frame++){
    const s=cellStats(data,info.width,frame),ox=frame%COLUMNS*CELL,oy=Math.floor(frame/COLUMNS)*CELL;
    const cx=ox+(s.minX+s.maxX)/2,head=s.height*.42,chest=oy+s.minY+s.height*.58;
    if(back){
      // The back of the head: the face goes under the hair colour; the body gets a darker back-lit tone.
      svg+=`<rect x="${ox}" y="${oy}" width="${CELL}" height="${CELL}" fill="#1d1630" fill-opacity="0.38"/>`;
      svg+=`<ellipse cx="${cx}" cy="${oy+s.minY+head*.55}" rx="${(s.maxX-s.minX)*.36}" ry="${head*.55}" fill="#4a2a17"/>`;
      svg+=`<rect x="${cx-40}" y="${chest-13}" width="80" height="22" fill="#ffffff"/>`;
      svg+=`<text x="${cx}" y="${chest+4}" font-family="DejaVu Sans" font-weight="bold" font-size="15" text-anchor="middle" fill="#1d1630">COSTAS</text>`;
    }
    svg+=`<rect x="${cx-15}" y="${chest+10}" width="30" height="18" fill="${back?'#ffde3b':'#2a6bff'}"/>`;
    svg+=`<text x="${cx}" y="${chest+24}" font-family="DejaVu Sans" font-weight="bold" font-size="14" text-anchor="middle" fill="${back?'#1d1630':'#ffffff'}">${CODES[facing]}</text>`;
  }
  svg+='</svg>';
  return sharp(base).composite([{input:Buffer.from(svg),blend:'atop'}]).png().toBuffer();
}

const blocks=[];
for(const facing of FACING_BLOCKS)blocks.push(await block(facing));
await mkdir(path.join(out,ID),{recursive:true});
const file=path.join(out,ID,'atlas-4dir.png');
await sharp({create:{width:DIR4.width,height:DIR4.height,channels:4,background:clear}})
  .composite(blocks.map((input,i)=>({input,left:0,top:i*SINGLE.height}))).png().toFile(file);
await sharp({create:{width:CELL*4,height:CELL,channels:4,background:clear}})
  .composite(await Promise.all(blocks.map(async(input,i)=>({input:await sharp(input).extract({left:0,top:0,width:CELL,height:CELL}).png().toBuffer(),left:i*CELL,top:0}))))
  .png().toFile('tests/fixtures/sprites-4dir/tira-referencia.png');
console.log(file);
