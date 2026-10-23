// Card BUG-20261022-ORQ-troca-de-perna (pedido do usuário): every frame of a hero's run at the rest pose's scale. The image
// tool draws each pose a little bigger or smaller (and the two halves of a cycle apart): scripts/normalizar-quadros.py
// measures each frame's head against the rest pose (--checar) and rescales it (--corrigir).
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const PY=process.env.PYTHON??'python',SCRIPT='scripts/normalizar-quadros.py';
const sharp=createRequire(import.meta.url)('sharp');
const manifest=JSON.parse(readFileSync('public/art/sprites/manifest.json','utf8'));
const run=(...args:string[])=>spawnSync(PY,[SCRIPT,...args],{encoding:'utf8'});

test('a sheet of the rest pose with one frame drawn at 85 % fails --checar, and --corrigir brings it back',async()=>{
  const idle=manifest.pieces['viciado-em-bet'].files['idle16-SE'],src=`public/art/sprites/${idle.file}`;
  const rest=await sharp(src).extract({left:0,top:0,width:96,height:96}).png().toBuffer();
  // frame 5 shrunk to 85 % about its feet: the cell scaled about (48, 84), the anchor's foot line
  const small=await sharp(rest).resize(82,82,{kernel:'lanczos3'}).png().toBuffer();
  const shrunk=await sharp({create:{width:96,height:96,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:small,left:7,top:12}]).png().toBuffer();
  const sheet=join(tmpdir(),`normalizar-${process.pid}.png`),fixed=join(tmpdir(),`normalizar-${process.pid}-ok.png`);
  await sharp({create:{width:384,height:384,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
    .composite(Array.from({length:16},(_,i)=>({input:i===5?shrunk:rest,left:(i%4)*96,top:Math.floor(i/4)*96}))).png().toFile(sheet);
  const bad=run('--folha',sheet,'--celula','96','--parado-id','viciado-em-bet','--dir','SE','--checar');
  assert.equal(bad.status,1,bad.stdout+bad.stderr);
  assert.match(bad.stdout,/^ 5 .*FALHA: cabeça 0\.8/m);
  const fix=run('--folha',sheet,'--celula','96','--parado-id','viciado-em-bet','--dir','SE','--corrigir',fixed,'--checar');
  assert.equal(fix.status,0,fix.stdout+fix.stderr);
  const again=run('--folha',fixed,'--celula','96','--parado-id','viciado-em-bet','--dir','SE','--checar');
  assert.equal(again.status,0,again.stdout);
});

for(const id of ['viciado-em-bet','clt-cansado'])test(`${id}: every run16 frame at the rest pose's head (±3 %), height (±4 % on a planted foot) and its neighbours' scale (±2 %)`,()=>{
  for(const key of Object.keys(manifest.pieces[id].files).filter(k=>k.startsWith('run16-'))){
    const r=run('--id',id,'--chave',key,'--checar');
    assert.equal(r.status,0,`${id} ${key}\n${r.stdout}${r.stderr}`);
  }
});
