// writeIndex over an index a merge stopped on (bots-walk128-troca-perna, lote 20261028-002340): the queue's regen
// (tools/fila.mjs resolveIndexConflict) ran it on git's conflict markers, kept only the groups of GROUPS and dropped
// `bicos` (written by scripts/import-bicos.mjs, no spec), so tests/client/bicos-art.test.ts failed after the merge.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {readConflictedIndex,writeIndex} from '../../scripts/art-v2/convert.mjs';

const piece=(file:string,sha?:string)=>({kind:'views',files:{sheet:{file,cell:[4,4],...(sha?{sha256:sha}:{})}}});
const manifest=(dir:string,group:string,pieces:object)=>{
  mkdirSync(dir,{recursive:true});
  writeFileSync(path.join(dir,'manifest.json'),`${JSON.stringify({version:2,group,pieces},null,2)}\n`);
};

test('writeIndex on a conflicted index: both sides\' groups stay, a spec-less group from its own manifest, spec groups from theirs',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'art-index-conflict-'));
  try{
    const index=path.join(root,'public/art/manifest.json');
    mkdirSync(path.dirname(index),{recursive:true});
    const ours={version:2,groups:{bicos:{output:'public/art/city/bicos',pieces:{'bico-a':piece('a.webp')}},ui:{output:'public/art/ui',pieces:{}}}};
    const theirs={version:2,groups:{bicos:{output:'public/art/city/bicos',pieces:{'bico-b':piece('b.webp')}},ui:{output:'public/art/ui',pieces:{}},velho:{output:'public/art/velho',pieces:{x:piece('x.webp')}}}};
    writeFileSync(index,`<<<<<<< HEAD\n${JSON.stringify(ours)}\n=======\n${JSON.stringify(theirs)}\n>>>>>>> origin/main\n`);
    // The merge already joined the group manifests on disk.
    manifest(path.join(root,'public/art/city/bicos'),'bicos',{'bico-a':piece('a.webp','aa'),'bico-b':piece('b.webp','bb')});
    manifest(path.join(root,'public/art/ui'),'ui',{chinelo:piece('chinelo.webp','cc')});

    assert.deepEqual(Object.keys((await readConflictedIndex(index))!.groups).sort(),['bicos','ui','velho']);
    await writeIndex({ui:{output:'public/art/ui'}},{outRoot:root});
    const idx=JSON.parse(readFileSync(index,'utf8'));
    assert.deepEqual(Object.keys(idx.groups),['bicos','ui','velho']);
    assert.deepEqual(idx.groups.bicos.pieces,{'bico-a':piece('a.webp'),'bico-b':piece('b.webp')},'bicos: its merged manifest, lean');
    assert.deepEqual(idx.groups.ui.pieces,{chinelo:piece('chinelo.webp')});
    assert.deepEqual(idx.groups.velho,theirs.groups.velho,'no manifest on disk: the entry kept');
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('readConflictedIndex: no markers, or no side that parses → undefined (writeIndex then starts from the specs)',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'art-index-conflict-'));
  try{
    const file=path.join(root,'manifest.json');
    writeFileSync(file,'{"version":2,"groups":{}}\n');
    assert.equal(await readConflictedIndex(file),undefined);
    writeFileSync(file,'<<<<<<< HEAD\n{nope\n=======\n{also nope\n>>>>>>> x\n');
    assert.equal(await readConflictedIndex(file),undefined);
    assert.equal(await readConflictedIndex(path.join(root,'missing.json')),undefined);
  }finally{rmSync(root,{recursive:true,force:true});}
});
