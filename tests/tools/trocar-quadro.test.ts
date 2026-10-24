import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {trocarCelula} from '../../scripts/trocar-quadro.mjs';
import {aplicarAceitos,chaveAceito} from '../../scripts/medir-tremor.mjs';

// Folha 3 quadros × 2 direções de 8 px; cada célula pintada com um tom próprio (dir*10 + quadro).
async function folha(dir: string){
  const w=24,h=16,px=Buffer.alloc(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,v=Math.floor(y/8)*10+Math.floor(x/8);px[i]=v;px[i+1]=v;px[i+2]=v;px[i+3]=255;}
  mkdirSync(join(dir,'x'),{recursive:true});
  await sharp(px,{raw:{width:w,height:h,channels:4}}).webp({lossless:true}).toFile(join(dir,'x/walk.webp'));
  return {file:'x/walk.webp',cell:[8,8],frames:3,directions:2};
}
const tom=async (f: string,q: number,d: number)=>{const {data,info}=await sharp(readFileSync(f)).raw().toBuffer({resolveWithObject:true});return data[((d*8+4)*info.width+q*8+4)*info.channels];};

test('trocarCelula copia o vizinho só na direção pedida', async()=>{
  const dir=mkdtempSync(join(tmpdir(),'troca-')),file=await folha(dir);
  await trocarCelula(dir,file,1,2,{de:1});
  const f=join(dir,file.file);
  assert.equal(await tom(f,2,1),11);
  assert.equal(await tom(f,2,0),2);
  assert.equal(await tom(f,0,1),10);
});

test('aceite só vale para a mesma folha (sha) e só para arte nova', ()=>{
  const a={inimigo:'skatista-de-47',anim:'walk',direcao:'E',quadro:3,tipo:'arte-nova'};
  const aceitos={[chaveAceito(a)]:{sha256:'abc',motivo:'chute'}};
  assert.equal(aplicarAceitos([a],aceitos,'abc')[0].tipo,'aceito');
  assert.equal(aplicarAceitos([a],aceitos,'outro')[0].tipo,'arte-nova');
  assert.equal(aplicarAceitos([{...a,tipo:'desalinhamento'}],aceitos,'abc')[0].tipo,'desalinhamento');
});
