import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('lite refresh can target the sprites (R06 walk128 and the dir4c cardinals) while leaving unrelated sources and manifest entries untouched',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'viagem-lite-scope-'));
  try{
    // The real script (it imports the art-v2 and client modules) over a scratch tree: ART_LITE_ROOT.
    mkdirSync(path.join(dir,'scripts'),{recursive:true});
    const sentinel={source:'unrelated-source',lite:'unrelated-lite',bytes:10,liteBytes:5,psnr:99,shownPsnr:99};
    writeFileSync(path.join(dir,'scripts/art-lite.json'),JSON.stringify({webp:{},files:{'trees/untouched.webp':sentinel}}));
    for(const file of ['trees/untouched.webp','sprites/aposentado.dir4c.webp','sprites/aposentado.walk128-s.0123456789ab.webp']){
      const output=path.join(dir,'public/art',file);mkdirSync(path.dirname(output),{recursive:true});
      await sharp({create:{width:32,height:32,channels:4,background:{r:120,g:80,b:220,alpha:.7}}}).webp({lossless:true}).toFile(output);
    }
    const run=(...args:string[])=>spawnSync(process.execPath,['scripts/art-lite.mjs',...args],{
      encoding:'utf8',env:{...process.env,ART_LITE_ROOT:dir},
    });
    const result=run('--kinds','sprites');assert.equal(result.status,0,result.stderr);
    assert.ok(existsSync(path.join(dir,'public/art/lite/sprites/aposentado.dir4c.webp')));
    assert.ok(existsSync(path.join(dir,'public/art/lite/sprites/aposentado.walk128-s.0123456789ab.webp')));
    assert.equal(existsSync(path.join(dir,'public/art/lite/trees')),false);
    const manifestPath=path.join(dir,'scripts/art-lite.json'),before=readFileSync(manifestPath,'utf8');
    assert.deepEqual(JSON.parse(before).files['trees/untouched.webp'],sentinel);
    assert.equal(run('--kinds','sprites','--check').status,0);
    assert.equal(readFileSync(manifestPath,'utf8'),before,'--check never writes the manifest');
    assert.notEqual(run('--kinds','unknown').status,0);
    assert.equal(readFileSync(manifestPath,'utf8'),before,'invalid scope cannot mutate existing entries');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the menu family copies only the dance pages, the backgrounds and the letreiros: the button, the cut-out heroes and the mureta (light already) stay without a copy and --check passes (BUG-20261022-ORQ-art-lite-menu)',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'viagem-lite-menu-'));
  try{
    mkdirSync(path.join(dir,'scripts'),{recursive:true});
    writeFileSync(path.join(dir,'scripts/art-lite.json'),JSON.stringify({webp:{},files:{}}));
    const copied=['danca/aposentado-p1.webp','fundo-estadio-viciado.webp','letreiro/clt-cansado.webp'];
    const plain=['botao/pilula.webp','heroi/viciado-em-bet-529.webp','mureta-estadio.webp'];
    for(const file of [...copied,...plain]){
      const output=path.join(dir,'public/art/menu',file);mkdirSync(path.dirname(output),{recursive:true});
      await sharp({create:{width:32,height:32,channels:4,background:{r:120,g:80,b:220,alpha:.7}}}).webp({lossless:true}).toFile(output);
    }
    const run=(...args:string[])=>spawnSync(process.execPath,['scripts/art-lite.mjs',...args],{
      encoding:'utf8',env:{...process.env,ART_LITE_ROOT:dir},
    });
    assert.equal(run('--kinds','menu','--check').status,1,'the dance page and the background have no copy yet');
    const result=run('--kinds','menu');assert.equal(result.status,0,result.stderr);
    for(const file of copied)assert.ok(existsSync(path.join(dir,'public/art/lite/menu',file)),file);
    for(const file of plain)assert.equal(existsSync(path.join(dir,'public/art/lite/menu',file)),false,file);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(dir,'scripts/art-lite.json'),'utf8')).files).sort(),copied.map(f=>`menu/${f}`).sort());
    const check=run('--kinds','menu','--check');assert.equal(check.status,0,check.stderr);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
