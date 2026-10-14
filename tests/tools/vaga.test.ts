// tools/vaga.mjs (the PC's slots for tools/foto.mjs, D-049; review of 101cd7d): a slot is its creator's, a stale one is
// taken back only when asked (photo pages, never browser-N) and only once, a release frees only one's own slot.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,utimesSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {claimSlot,lastBeat} from '../../tools/vaga.mjs';

const locks=()=>mkdtempSync(join(tmpdir(),'vaga-'));

test('takes the first free slot, writes its owner (JSON with a beat) and frees it on release',async()=>{
  const dir=locks();
  try{
    const a=await claimSlot({locks:dir,prefix:'foto-pagina',count:2,label:'a'}),b=await claimSlot({locks:dir,prefix:'foto-pagina',count:2,label:'b'});
    const owner=JSON.parse(readFileSync(join(dir,'foto-pagina-1','owner.json'),'utf8'));
    assert.equal(owner.label,'a');assert.equal(owner.pid,process.pid);assert.ok(Math.abs(owner.beat-Date.now())<5000);
    assert.ok(existsSync(join(dir,'foto-pagina-2')));
    a();assert.ok(!existsSync(join(dir,'foto-pagina-1')));
    b();assert.ok(!existsSync(join(dir,'foto-pagina-2')));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a stale slot (its owner stopped beating) is taken back when staleMs is given; a fresh one is waited for',async()=>{
  const dir=locks();
  try{
    mkdirSync(join(dir,'foto-pagina-1'));
    writeFileSync(join(dir,'foto-pagina-1','owner.json'),JSON.stringify({label:'morto',pid:999999,beat:Date.now()-60000}));
    const r=await claimSlot({locks:dir,prefix:'foto-pagina',count:1,label:'novo',staleMs:20000,maxWaitMs:2000});
    assert.equal(JSON.parse(readFileSync(join(dir,'foto-pagina-1','owner.json'),'utf8')).label,'novo');
    r();
    // A live owner (recent beat) is not taken: the wait times out.
    mkdirSync(join(dir,'foto-pagina-1'));
    writeFileSync(join(dir,'foto-pagina-1','owner.json'),JSON.stringify({label:'vivo',pid:999998,beat:Date.now()}));
    await assert.rejects(claimSlot({locks:dir,prefix:'foto-pagina',count:1,label:'x',staleMs:20000,pollMs:20,maxWaitMs:300}),/nenhuma livre/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a slot without an owner file (crashed right after mkdir) goes stale by the folder\'s mtime',async()=>{
  const dir=locks();
  try{
    const slot=join(dir,'foto-pagina-1');mkdirSync(slot);
    const old=(Date.now()-60000)/1000;utimesSync(slot,old,old);
    assert.ok(Date.now()-lastBeat(slot)>50000);
    const r=await claimSlot({locks:dir,prefix:'foto-pagina',count:1,label:'novo',staleMs:20000,maxWaitMs:2000});r();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('browser-N slots (no staleMs) are never taken back, however old: one only waits',async()=>{
  const dir=locks();
  try{
    mkdirSync(join(dir,'browser-1'));mkdirSync(join(dir,'browser-2'));
    writeFileSync(join(dir,'browser-1','owner.txt'),'Executor-X fila 2020-01-01T00:00:00Z\n');
    const old=(Date.now()-3600000)/1000;utimesSync(join(dir,'browser-1'),old,old);utimesSync(join(dir,'browser-2'),old,old);
    await assert.rejects(claimSlot({locks:dir,prefix:'browser',count:2,label:'foto',pollMs:20,maxWaitMs:300}),/nenhuma livre/);
    assert.ok(existsSync(join(dir,'browser-1','owner.txt')),'untouched');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('release frees only one\'s own slot: one taken back from a stalled holder stays with its new owner',async()=>{
  const dir=locks();
  try{
    const release=await claimSlot({locks:dir,prefix:'foto-pagina',count:1,label:'lento'});
    // Someone took it back meanwhile (as if this process had stalled past staleMs).
    writeFileSync(join(dir,'foto-pagina-1','owner.json'),JSON.stringify({label:'outro',pid:process.pid+1,beat:Date.now()}));
    release();
    assert.equal(JSON.parse(readFileSync(join(dir,'foto-pagina-1','owner.json'),'utf8')).label,'outro');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('count must be a positive integer (FOTO_PAGINAS=abc would loop forever)',async()=>{
  await assert.rejects(claimSlot({locks:locks(),prefix:'foto-pagina',count:Number.NaN,label:'x'}),RangeError);
});
