// deploy-worker-sem-derrubar: scripts/deploy-rooms.mjs publishes only when /health/rooms says no match is on (--dry-run).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';

/** A stand-in Worker answering /health/rooms with `body` (or 404: a Worker from before this card). */
async function worker(status:number,body:object){
  const server=createServer((req,res)=>{res.writeHead(req.url==='/health/rooms'?status:404,{'Content-Type':'application/json'});res.end(JSON.stringify(body));});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const {port}=server.address() as {port:number};
  return {endpoint:`http://127.0.0.1:${port}`,close:()=>server.close()};
}
function run(args:string[]){
  return new Promise<{code:number|null;out:string}>(resolve=>{
    const p=spawn(process.execPath,['scripts/deploy-rooms.mjs','--dry-run',...args]);let out='';
    p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);p.on('close',code=>resolve({code,out}));
  });
}

test('no match on: it publishes; matches on: it waits, gives up after --wait (0 here) and says when they end',async()=>{
  const idle=await worker(200,{rooms:3,running:0,players:0,endsBy:0});
  try{
    const r=await run(['--endpoint',idle.endpoint,'--wait','0']);assert.equal(r.code,0);assert.match(r.out,/Nenhuma partida/);assert.match(r.out,/publicaria agora/);
    // It names the commit it would publish (BUILD_SHA, answered by /health after the deploy).
    assert.match(r.out,/Publicando o Worker do commit [0-9a-f]{12}(-sujo)? \(/);
  }finally{idle.close();}
  const busy=await worker(200,{rooms:3,running:2,players:5,endsBy:Date.now()+600_000});
  try{
    const r=await run(['--endpoint',busy.endpoint,'--wait','0']);
    assert.equal(r.code,3);assert.match(r.out,/2 partida\(s\) em andamento, 5 pessoa\(s\)/);assert.doesNotMatch(r.out,/publicaria/);
    const f=await run(['--endpoint',busy.endpoint,'--force']);
    assert.equal(f.code,0);assert.match(f.out,/--force/);assert.match(f.out,/publicaria agora/);
  }finally{busy.close();}
});

test('a Worker from before /health/rooms (404, or 403 from its origin check) is published without waiting; an unreadable one needs --force',async()=>{
  for(const status of [404,403]){
    const old=await worker(status,{});
    try{const r=await run(['--endpoint',old.endpoint,'--wait','0']);assert.equal(r.code,0);assert.match(r.out,/anterior a este card/);}finally{old.close();}
  }
  const broken=await worker(500,{});
  try{
    const r=await run(['--endpoint',broken.endpoint,'--wait','0']);assert.equal(r.code,2);
    assert.equal((await run(['--endpoint',broken.endpoint,'--force'])).code,0);
  }finally{broken.close();}
});

test('--skip-if-busy (CI): matches still on when the wait runs out: no deploy, exit 0',async()=>{
  const busy=await worker(200,{rooms:1,running:1,players:2,endsBy:Date.now()+600_000});
  try{const r=await run(['--endpoint',busy.endpoint,'--wait','0','--skip-if-busy']);assert.equal(r.code,0);assert.match(r.out,/não foi publicado agora/);assert.doesNotMatch(r.out,/publicaria/);}finally{busy.close();}
});
