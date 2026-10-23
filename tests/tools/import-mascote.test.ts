/**
 * Pack 12 mascot/investida importer (scripts/import-mascote.mjs, card NEW-20261022-ORQ-arsenal-completo-no-bau): a
 * synthetic delivery comes out in the enemies' format (8 rows × frames, anchor, fps, rim, page sha256) with the D-037
 * rim baked only outside the drawing; a sheet without 8 rows is refused. The art in public/art/mascote matches its
 * manifest (every file listed, size = frames × cell by 8 rows, sha256 of the file).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {importMascotes,OUT_DIR,DIRECTIONS,ANCHOR,RIM} from '../../scripts/import-mascote.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

/** A cw×ch-cell sheet, `frames` columns × `rows` rows, each cell a filled opaque square in its middle. */
async function sheet(file:string,cw:number,ch:number,frames:number,rows=DIRECTIONS){
  const w=cw*frames,h=ch*rows,data=Buffer.alloc(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const cx=x%cw,cy=y%ch;if(cx>=cw/4&&cx<cw*3/4&&cy>=ch/4&&cy<ch*3/4){const i=(y*w+x)*4;data[i]=200;data[i+1]=120;data[i+2]=40;data[i+3]=255;}}
  await sharp(data,{raw:{width:w,height:h,channels:4}}).png().toFile(file);
}

test('a delivery becomes the enemies format: 8 rows × frames, anchor, fps, rim and the page sha256', async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'mascote-'));
  try{
    const input=path.join(dir,'in'),root=path.join(dir,'repo');
    mkdirSync(path.join(input,'bicho'),{recursive:true});
    writeFileSync(path.join(input,'bicho','meta.json'),JSON.stringify({cell:[32,32],fps:{idle:6,walk:10}}));
    await sheet(path.join(input,'bicho','idle.png'),32,32,4);
    await sheet(path.join(input,'bicho','walk.png'),32,32,6);
    const m=await importMascotes(input,root);
    assert.equal(m.group,'mascote');
    const walk=m.pieces.bicho.files.walk;
    assert.deepEqual([walk.cell,walk.frames,walk.directions,walk.anchor,walk.fps],[[32,32],6,8,ANCHOR,10]);
    assert.deepEqual(walk.rim,RIM);
    assert.deepEqual(walk.pages[0],{file:'bicho/walk.webp',columns:6,rows:8,firstFrame:0,frameCount:48,sha256:walk.sha256});
    const webp=readFileSync(path.join(root,OUT_DIR,'bicho/walk.webp'));
    assert.equal(createHash('sha256').update(webp).digest('hex'),walk.sha256);
    const {data,info}=await sharp(webp).raw().toBuffer({resolveWithObject:true});
    assert.deepEqual([info.width,info.height],[192,256]);
    const px=(x:number,y:number)=>[...data.subarray((y*info.width+x)*4,(y*info.width+x)*4+4)];
    assert.deepEqual(px(16,16),[200,120,40,255],'the drawing is untouched');
    assert.equal(px(7,16)[3]>0,true,'the rim lies just outside the drawing');
    assert.deepEqual(px(1,1)[3],0,'far from the drawing stays transparent');
    assert.deepEqual(JSON.parse(readFileSync(path.join(root,OUT_DIR,'manifest.json'),'utf8')),m);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a sheet without the 8 direction rows is refused', async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'mascote-'));
  try{
    const input=path.join(dir,'in');
    mkdirSync(path.join(input,'bicho'),{recursive:true});
    writeFileSync(path.join(input,'bicho','meta.json'),JSON.stringify({cell:[32,32],fps:{run:12}}));
    await sheet(path.join(input,'bicho','run.png'),32,32,8,5);
    await assert.rejects(importMascotes(input,path.join(dir,'repo')),/run\.png: 256×160/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('public/art/mascote matches its manifest', async()=>{
  const file=path.join(ROOT,OUT_DIR,'manifest.json');
  assert.ok(existsSync(file));
  const m=JSON.parse(readFileSync(file,'utf8'));
  assert.ok(Object.keys(m.pieces).length>0);
  for(const [id,piece] of Object.entries<any>(m.pieces))for(const [anim,f] of Object.entries<any>(piece.files)){
    const buf=readFileSync(path.join(ROOT,OUT_DIR,f.file)),meta=await sharp(buf).metadata();
    assert.deepEqual([meta.width,meta.height],[f.cell[0]*f.frames,f.cell[1]*8],`${id}/${anim}`);
    assert.equal(createHash('sha256').update(buf).digest('hex'),f.sha256,`${id}/${anim} sha256`);
  }
});
