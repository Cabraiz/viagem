/**
 * tools/ci.mjs (NEW-20261014-ORQ-ci-github-shards-e-bench): the pure parts (arguments, targets and early stop,
 * annotation chunks, shard balance, bench params) and the API client's shared cache / ETag / rate-limit wait with a
 * fake fetch. Nothing here touches the network or git.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error plain ESM tool without types
import * as ci from '../../tools/ci.mjs';

test('ci: arguments, ranges and targets',()=>{
  assert.deepEqual(ci.parseArgs(['bench','vgm/x','--seeds','1-4','--json','--target=2/8','--no-towers']),
    {cmd:'bench',args:['vgm/x'],flags:{seeds:'1-4',json:true,target:'2/8','no-towers':true}});
  assert.throws(()=>ci.parseArgs(['bench','--seeds']));
  assert.deepEqual(ci.parseRange('3,1-2,3'),[1,2,3]);
  assert.throws(()=>ci.parseRange('a'));
  assert.deepEqual(ci.parseTarget('2/8'),{k:2,n:8});
  assert.deepEqual(ci.parseTarget('3'),{k:3,n:null});
  assert.equal(ci.parseTarget(''),null);
  assert.throws(()=>ci.parseTarget('2/0'));
  assert.equal(ci.neededWins({k:2,n:8},16),4);
  assert.equal(ci.neededWins({k:2,n:8},4),1);
  assert.equal(ci.neededWins({k:3,n:null},16),3);
});

test('ci: early stop decides only when the result can no longer flip',()=>{
  const t=ci.parseTarget('2/8'),totals={1:8};
  const o=(...wins:boolean[])=>wins.map(win=>({players:1,win}));
  assert.equal(ci.earlyDecision(o(false,false,false),totals,t).decision,null);
  // 0 wins of 7 played, 1 left: at most 1 < 2 → fail.
  assert.equal(ci.earlyDecision(o(false,false,false,false,false,false,false),totals,t).decision,'fail');
  assert.equal(ci.earlyDecision(o(true,false,true),totals,t).decision,'pass');
  // Two team sizes: one passed, the other still open → keep running; any fail → fail.
  const two={1:4,6:4},t2=ci.parseTarget('1/4');
  assert.equal(ci.earlyDecision([{players:1,win:true}],two,t2).decision,null);
  assert.equal(ci.earlyDecision([{players:1,win:true},{players:6,win:true}],two,t2).decision,'pass');
  const d=ci.earlyDecision([{players:6,win:false},{players:6,win:false},{players:6,win:false},{players:6,win:false}],two,t2);
  assert.equal(d.decision,'fail');
  assert.deepEqual(d.groups[6],{wins:0,done:4,total:4,need:1,state:'fail'});
});

test('ci: notices chunk, escape and join back',()=>{
  const text='a%b\nline 2: x,y\n'+'z'.repeat(25);
  const lines=ci.noticeLines('bench-summary',text,{size:10});
  assert.ok(lines.length>1);
  assert.match(lines[0],/^::notice title=bench-summary 1\/\d+::a%25b%0A/);
  // The API returns the unescaped message and title.
  const unescape=(s:string)=>s.replace(/%0A/g,'\n').replace(/%0D/g,'\r').replace(/%3A/g,':').replace(/%2C/g,',').replace(/%25/g,'%');
  const api=lines.map(l=>{const m=/^::notice title=(.*?)::(.*)$/s.exec(l)!;return {title:unescape(m[1]),message:unescape(m[2])};}).reverse();
  assert.equal(ci.joinAnnotations(api,'bench-summary'),text);
  assert.equal(ci.joinAnnotations(api,'bench-verdict'),null);
  assert.equal(ci.noticeLines('ci-ok','{}').length,1);
  assert.equal(ci.noticeLines('ci-ok','{}')[0],'::notice title=ci-ok::{}');
  const many=ci.noticeLines('x','y'.repeat(100),{size:5,max:3});
  assert.equal(many.length,3);assert.match(many[2],/truncated/);
});

test('ci: shards are balanced by the timings and cover every file once',()=>{
  const files=['a','b','c','d','e','f','g'].map(x=>`tests/${x}.test.ts`);
  const timings={'tests/a.test.ts':9000,'tests/b.test.ts':5000,'tests/c.test.ts':4000};
  const shards=ci.shardFiles(files,timings,3);
  assert.deepEqual(shards.flatMap((s:{files:string[]})=>s.files).sort(),files);
  assert.ok(shards[0].files.includes('tests/a.test.ts'));
  const ms=shards.map((s:{ms:number})=>s.ms);
  assert.ok(Math.max(...ms)-Math.min(...ms)<=5000+ci.FILE_OVERHEAD_MS);
  assert.deepEqual(ci.shardFiles(files,timings,3),shards);
  const real=ci.listTests();
  assert.ok(real.includes('tests/tools/ci.test.ts'));
});

test('ci: shard report lines',()=>{
  assert.deepEqual(ci.reportLines({failed:[],durations:{'tests/a.test.ts':10}},'1/6',0),
    ['::notice title=ci-ok::{"shard":"1/6","files":1}','::notice title=ci-timings 1-6::{"tests/a.test.ts":10}']);
  assert.equal(ci.reportLines({failed:['tests/b.test.ts'],durations:{}},'2/6',1)[0],'::notice title=ci-failed::["tests/b.test.ts"]');
  assert.match(ci.reportLines(null,'3/6',1)[0],/^::notice title=ci-failed::\["\(shard 3\/6: exit 1/);
});

test('ci: bench params, hash and matrix',()=>{
  const p=ci.benchParams({seeds:'1-3',players:'1,6',target:'2/8',sha:'abc',branch:'vgm/x'});
  assert.deepEqual(p.seeds,[1,2,3]);assert.deepEqual(p.players,[1,6]);
  assert.equal(p.world,'cidade');assert.equal(p.towers,true);assert.equal(p.capMin,null);
  assert.equal(ci.benchMatrix(p).include.length,6);
  assert.deepEqual(ci.benchMatrix(p).include[1],{seed:1,players:6});
  // Branch, sha, base and target do not change the result key; the params do.
  assert.equal(ci.paramsHash(p),ci.paramsHash(ci.benchParams({seeds:[1,2,3],players:[1,6],branch:'main',sha:'def'})));
  assert.notEqual(ci.paramsHash(p),ci.paramsHash(ci.benchParams({seeds:'1-3',players:'1,6',objective:'chaveiro'})));
  assert.equal(ci.benchArgs(ci.benchParams({objective:'chaveiro',capMin:'25',towers:false})),'--objective chaveiro --cap-min 25 --no-towers');
  assert.equal(ci.benchArgs(p),'');
  assert.throws(()=>ci.benchParams({world:'ilha'}));
  assert.throws(()=>ci.benchParams({players:'7'}));
  assert.deepEqual(ci.runJobKey('run 12-6p'),{seed:12,players:6});
  assert.equal(ci.runJobKey('aggregate'),null);
});

interface FakeRes {status:number;headers?:Record<string,string>;body?:unknown}
function fakeFetch(responses:FakeRes[]){
  const calls:{url:string;headers:Record<string,string>}[]=[];
  const fetch=async(url:string,init:{headers:Record<string,string>})=>{
    calls.push({url,headers:init.headers});
    const r=responses.shift();
    if(!r)throw new Error('unexpected request');
    const h=Object.fromEntries(Object.entries(r.headers??{}).map(([k,v])=>[k.toLowerCase(),v]));
    return {status:r.status,ok:r.status>=200&&r.status<300,headers:{get:(k:string)=>h[k.toLowerCase()]??null},json:async()=>r.body};
  };
  return {fetch,calls};
}
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ci-cache-test-'));

test('ci api: a fresh shared body costs no request; an old one is revalidated with its ETag (304 reuses it)',async()=>{
  const dir=tmp();let t=1_000_000;
  const {fetch,calls}=fakeFetch([{status:200,headers:{etag:'"v1"','x-ratelimit-remaining':'50'},body:{n:1}},{status:304,headers:{'x-ratelimit-remaining':'50'}}]);
  const api=ci.createApi({fetch,token:undefined,cacheDir:dir,now:()=>t,sleep:async()=>{},log:()=>{}});
  assert.deepEqual((await api.get('/x')).body,{n:1});
  t+=10_000;
  // A second executor (another client on the same cache dir) inside FRESH_MS: no request at all.
  const other=ci.createApi({fetch,token:undefined,cacheDir:dir,now:()=>t,sleep:async()=>{},log:()=>{}});
  assert.equal((await other.get('/x')).cached,'fresh');
  assert.equal(calls.length,1);
  t+=ci.FRESH_MS;
  const r=await api.get('/x');
  assert.equal(r.cached,'304');assert.deepEqual(r.body,{n:1});
  assert.equal(calls.length,2);
  assert.equal(calls[1].headers['If-None-Match'],'"v1"');
  assert.equal(calls[0].headers.Authorization,undefined);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('ci api: an exhausted rate limit sleeps until the reset (shared), then retries once',async()=>{
  const dir=tmp();let t=1_000_000;const slept:number[]=[];const logs:string[]=[];
  const reset=String(Math.floor(t/1000)+120);
  const {fetch,calls}=fakeFetch([
    {status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':reset}},
    {status:200,headers:{'x-ratelimit-remaining':'59'},body:{ok:true}},
  ]);
  const api=ci.createApi({fetch,token:'tok',cacheDir:dir,now:()=>t,sleep:async(ms:number)=>{slept.push(ms);t+=ms;},log:(m:string)=>logs.push(m)});
  assert.deepEqual((await api.get('/y')).body,{ok:true});
  assert.equal(calls.length,2);
  assert.equal(slept.length,1);
  assert.ok(slept[0]>=119_000&&slept[0]<=122_000);
  assert.match(logs[0],/sleeping until/);
  assert.equal(calls[0].headers.Authorization,'Bearer tok');
  // A 200 that leaves 0 requests also makes the next caller (any executor) wait for the reset before asking.
  const reset2=String(Math.floor(t/1000)+60);
  const f2=fakeFetch([{status:200,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':reset2},body:1},{status:200,headers:{'x-ratelimit-remaining':'60'},body:2}]);
  const api2=ci.createApi({fetch:f2.fetch,cacheDir:dir,now:()=>t,sleep:async(ms:number)=>{slept.push(ms);t+=ms;},log:()=>{},freshMs:0});
  await api2.get('/z1');
  await api2.get('/z2');
  assert.equal(slept.length,2);
  assert.ok(slept[1]>=59_000);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('ci api: 404 is a value, other errors are infra',async()=>{
  const dir=tmp();
  const {fetch}=fakeFetch([{status:404},{status:500}]);
  const api=ci.createApi({fetch,cacheDir:dir,sleep:async()=>{},log:()=>{}});
  assert.equal((await api.get('/missing')).status,404);
  await assert.rejects(api.get('/boom'),ci.InfraError);
  fs.rmSync(dir,{recursive:true,force:true});
});
