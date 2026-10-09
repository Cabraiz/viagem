import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isAllowedOrigin,PRODUCTION_ORIGINS,LOCAL_PORT,EXECUTOR_PORTS,CLOUD_EXECUTOR_PORTS} from '../multiplayer/origins.ts';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
const PROD=['https://viagem.cyou','https://www.viagem.cyou'];
const LOOKALIKES=['http://viagem.cyou','https://viagem.cyou.evil.com','https://evil.viagem.cyou','https://viagem.cyou/','https://VIAGEM.cyou',' https://viagem.cyou','https://viagem.cyou ','https://viagem.cyou:443'];
function expect(allowLocal:boolean,origins:string[],want:boolean){
  for(const origin of origins)assert.equal(isAllowedOrigin(origin,allowLocal),want,`${JSON.stringify(origin)} allowLocal=${allowLocal}`);
}
test('policy constants match the card: 4187 legacy plus executor ranges 4200-4299 (PC) and 4300-4399 (cloud)',()=>{
  assert.equal(LOCAL_PORT,4187);assert.deepEqual({...EXECUTOR_PORTS},{min:4200,max:4299});
  assert.deepEqual({...CLOUD_EXECUTOR_PORTS},{min:4300,max:4399});
  assert.deepEqual([...PRODUCTION_ORIGINS].sort(),[...PROD].sort());
});
test('production mode accepts only production origins and refuses every local origin',()=>{
  expect(false,PROD,true);
  expect(false,['http://127.0.0.1:4187','http://127.0.0.1:4205','http://127.0.0.1:4200','http://127.0.0.1:4299','http://127.0.0.1:4300','http://127.0.0.1:4330','http://127.0.0.1:4399','http://localhost:4205','http://localhost:4187','','null'],false);
});
test('dev mode accepts 4187 and both executor range bounds',()=>{
  expect(true,PROD,true);
  expect(true,['http://127.0.0.1:4187','http://127.0.0.1:4200','http://127.0.0.1:4205','http://127.0.0.1:4299',
    'http://127.0.0.1:4300','http://127.0.0.1:4310','http://127.0.0.1:4330','http://127.0.0.1:4331','http://127.0.0.1:4399'],true);
});
test('dev mode refuses out-of-range ports, malformed origins and other hosts',()=>{
  expect(true,[
    'http://127.0.0.1:4199','http://127.0.0.1:4400','http://127.0.0.1:4186','http://127.0.0.1:4188','http://127.0.0.1:5000','http://localhost:4330','https://127.0.0.1:4330','http://127.0.0.1:8787','http://127.0.0.1','http://127.0.0.1:80',
    'http://127.0.0.1:04205','http://127.0.0.1:4205/','https://127.0.0.1:4205','http://localhost:4205','http://127.0.0.2:4205',
    'http://127.0.0.1.evil.com:4205','http://evil.com/?x=http://127.0.0.1:4205','http://evil.com#http://127.0.0.1:4205','null','',
    'HTTP://127.0.0.1:4205',' http://127.0.0.1:4205','http://127.0.0.1:4205 ','http://127.0.0.1:4205\n','\thttp://127.0.0.1:4187',
    'http://user@127.0.0.1:4205','http://[::1]:4205','http://0.0.0.0:4205','http://127.0.0.1:42050',
  ],false);
});
test('production lookalikes are refused in both modes',()=>{
  expect(false,LOOKALIKES,false);expect(true,LOOKALIKES,false);
});
test('wrangler.jsonc keeps ALLOW_LOCAL false for the deployed worker',()=>{
  const json=read('../multiplayer/wrangler.jsonc').replace(/^\s*\/\/.*$/gm,'').replace(/\s\/\/.*$/gm,'');
  const config=JSON.parse(json);assert.equal(config.vars?.ALLOW_LOCAL,'false');
});
test('worker.ts delegates to isAllowedOrigin and no longer hardcodes the local origin',()=>{
  const source=read('../multiplayer/worker.ts');
  assert.match(source,/import\s*\{[^}]*\bisAllowedOrigin\b[^}]*\}\s*from\s*['"]\.\/origins(\.ts)?['"]/);
  assert.match(source,/isAllowedOrigin\([^;]*env\.ALLOW_LOCAL\s*===\s*['"]true['"]/);
  assert.doesNotMatch(source,/127\.0\.0\.1:4187/);
});
