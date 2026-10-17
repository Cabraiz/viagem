// NEW-20261017-ORQ-fila-deploy-seguro: pages.yml publishes the site only when the live rooms Worker matches it in the
// protocol AND the maps (scripts/health-gate.mjs over /health). Both directions refuse: a Worker ahead of the site
// (lote 13: map v3 while the site still had v2) and a site ahead of the Worker (a map-only lote whose Worker deploy
// was skipped). The Worker side (/health tells its maps) is tests/rooms/room-index.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
// @ts-expect-error -- a plain .mjs script, no types
import {expected,gate} from '../../scripts/health-gate.mjs';

const want=expected();
const city=JSON.parse(readFileSync('public/maps/cidade-nevada.manifest.json','utf8'));
const health=(over:object={})=>({status:'ok',service:'viagem-salas',protocol:want.protocol,maps:{'cidade-nevada':{version:city.version,hash:city.hash}},build:'x',...over});

test('expected: the site\'s protocol and every map manifest it ships',()=>{
  assert.equal(want.protocol,JSON.parse(readFileSync('public/multiplayer.json','utf8')).protocol);
  assert.deepEqual(want.maps['cidade-nevada'],{version:city.version,hash:city.hash});
});

test('gate: the same protocol and maps pass; a Worker behind or ahead in the map, another protocol, or no maps at all refuse',()=>{
  assert.deepEqual(gate(health(),want),{ok:true,problems:[]});
  const map=(version:number,hash:string)=>health({maps:{'cidade-nevada':{version,hash}}});
  const behind=gate(map(city.version-1,'a'.repeat(64)),want);
  assert.equal(behind.ok,false);assert.match(behind.problems[0],new RegExp(`serve v${city.version-1} .*o site v${city.version}`));
  assert.equal(gate(map(city.version+1,'b'.repeat(64)),want).ok,false,'a Worker ahead of the site (lote 13)');
  assert.equal(gate(map(city.version,'c'.repeat(64)),want).ok,false,'same version, other bytes');
  assert.match(gate(health({protocol:want.protocol-1}),want).problems.join(),/protocolo: o Worker fala/);
  assert.match(gate(health({maps:undefined}),want).problems.join(),/sem maps: Worker anterior/);
  assert.equal(gate(undefined,want).ok,false);
});

/** The CLI against a local /health answering `body` (no retries). */
function cli(body:object):Promise<{code:number;out:string}>{
  return new Promise((done,fail)=>{
    const server=createServer((_,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(body));});
    server.listen(0,'127.0.0.1',()=>{
      const port=(server.address() as {port:number}).port;
      const p=spawn(process.execPath,['scripts/health-gate.mjs',`http://127.0.0.1:${port}/health`,'--tries','1'],{stdio:['ignore','pipe','pipe']});
      let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);
      p.on('error',fail);p.on('close',code=>{server.close();done({code:code??-1,out});});
    });
  });
}

test('the CLI pages.yml runs: exit 0 when the Worker matches, 1 with the reason when it is behind or ahead',async()=>{
  const ok=await cli(health());
  assert.equal(ok.code,0,ok.out);assert.match(ok.out,/casa com o site/);
  for(const v of [city.version-1,city.version+1]){
    const off=await cli(health({maps:{'cidade-nevada':{version:v,hash:'d'.repeat(64)}}}));
    assert.equal(off.code,1,off.out);assert.match(off.out,/::error::mapa cidade-nevada/);
  }
});
