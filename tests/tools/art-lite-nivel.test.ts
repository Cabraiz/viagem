import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

// Card q3-niveis-qualidade, fatia 2: the phone levels' hero copies (scripts/art-lite.mjs --kinds sprites-nivel).
test('sprites-nivel: R06 at 64 px with 64 (Normal) and 32 (Leve) poses, other 96 px sheets at 64 px, dir4/dir4c at 128 px',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'viagem-lite-nivel-'));
  try{
    mkdirSync(path.join(dir,'scripts'),{recursive:true});
    writeFileSync(path.join(dir,'scripts/art-lite.json'),JSON.stringify({webp:{},files:{}}));
    const page=(file:string,columns:number,rows:number)=>({file,cell:columns===6?[192,192]:[96,96],pages:[{file,columns,rows,firstFrame:0,frameCount:columns*rows}]});
    const files={walk:page('aposentado.walk128-s.webp',16,8),idle8:page('aposentado.idle8.webp',8,1),dir4:page('aposentado.dir4.webp',6,12)};
    mkdirSync(path.join(dir,'public/art/sprites'),{recursive:true});
    writeFileSync(path.join(dir,'public/art/sprites/manifest.json'),JSON.stringify({pieces:{aposentado:{files}}}));
    for(const f of Object.values(files)){
      const cell=f.cell[0],{columns,rows}=f.pages[0];
      await sharp({create:{width:columns*cell,height:rows*cell,channels:4,background:{r:120,g:80,b:220,alpha:.7}}}).webp({lossless:true}).toFile(path.join(dir,'public/art/sprites',f.file));
    }
    const run=(...args:string[])=>spawnSync(process.execPath,['scripts/art-lite.mjs',...args],{encoding:'utf8',env:{...process.env,ART_LITE_ROOT:dir}});
    const result=run('--kinds','sprites-nivel');assert.equal(result.status,0,result.stderr);
    const size=async(file:string)=>{const m=await sharp(readFileSync(path.join(dir,'public/art/lite',file))).metadata();return [m.width,m.height];};
    assert.deepEqual(await size('sprites-normal/aposentado.walk128-s.webp'),[8*64,8*64]);
    assert.deepEqual(await size('sprites-leve/aposentado.walk128-s.webp'),[8*64,4*64]);
    assert.deepEqual(await size('sprites-64/aposentado.idle8.webp'),[8*64,64]);
    assert.deepEqual(await size('sprites-celular/aposentado.dir4.webp'),[6*128,12*128]);
    assert.equal(existsSync(path.join(dir,'public/art/lite/sprites')),false,'the Alta copies are not touched');
    const manifestPath=path.join(dir,'scripts/art-lite.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
    assert.equal(manifest.files['sprites-leve/aposentado.walk128-s.webp'].frames,32);
    const before=readFileSync(manifestPath,'utf8');
    assert.equal(run('--kinds','sprites-nivel','--check').status,0,'fresh copies pass the check');
    assert.equal(readFileSync(manifestPath,'utf8'),before);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
