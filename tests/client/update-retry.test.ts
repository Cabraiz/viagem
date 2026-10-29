// nao-e-versao-nova (auditoria multijogador 29/10, achado 3): a 3G stall in combat looped on "Saiu versão nova" with the
// same build for 6 min. The site naming this very build SAME_BUILD_ASKS times turns the window into "Reconectar".
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RETRY_S,SAME_BUILD_ASKS,UPDATE_TEXT,retryLine,startUpdateRetry,type RetryState} from '../../src/client/ui/update-retry.ts';

function clock(){
  let now=0,seq=0;const timers=new Map<number,{at:number;run:()=>void}>();
  return {
    setTimeout:(run:()=>void,ms:number)=>{const id=++seq;timers.set(id,{at:now+ms,run});return id;},
    clearTimeout:(id:unknown)=>{timers.delete(id as number);},
    async advance(ms:number){
      const end=now+ms;
      for(;;){
        const next=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
        if(!next)break;
        timers.delete(next[0]);now=next[1].at;next[1].run();
        await new Promise(r=>setImmediate(r));
      }
      now=end;
    },
  };
}
const flush=()=>new Promise(r=>setImmediate(r));

test('update-retry: the same build SAME_BUILD_ASKS times → "stuck" (Reconectar); it keeps asking and a new build still reloads',async()=>{
  assert.equal(SAME_BUILD_ASKS,2);
  const c=clock(),shown:RetryState[]=[];let site='b1',reloads=0;
  startUpdateRetry({current:'b1',fetchVersion:async()=>site,reload:()=>{reloads++;},show:s=>shown.push(s),setTimeout:c.setTimeout,clearTimeout:c.clearTimeout});
  await flush();
  assert.deepEqual(shown.at(-1),{kind:'waiting',seconds:RETRY_S},'one answer: still waiting for the new build');
  await c.advance(RETRY_S*1000);
  assert.deepEqual(shown.at(-1),{kind:'stuck',seconds:RETRY_S},'twice the same build: not a new version');
  await c.advance(RETRY_S*1000);
  assert.equal(shown.at(-1)?.kind,'stuck');
  site='b2';
  await c.advance(RETRY_S*1000);
  assert.equal(reloads,1);assert.deepEqual(shown.at(-1),{kind:'reloading'});
});

test('update-retry: failed asks (offline) never count as "the same build"',async()=>{
  const c=clock(),shown:RetryState[]=[];
  const retry=startUpdateRetry({current:'b1',fetchVersion:async()=>undefined,reload:()=>{},show:s=>shown.push(s),setTimeout:c.setTimeout,clearTimeout:c.clearTimeout});
  await flush();await c.advance(5*RETRY_S*1000);
  assert.ok(shown.every(s=>s.kind!=='stuck'));
  retry.stop();
});

test('update-retry: the stuck line and the button; the panel switches to the client\'s restart (seat kept)',()=>{
  assert.equal(retryLine({kind:'stuck',seconds:4}),UPDATE_TEXT.stuck(4));
  assert.match(UPDATE_TEXT.stuck(4),/Reconectar/);assert.doesNotMatch(UPDATE_TEXT.stuck(4),/versão nova/);
  assert.equal(UPDATE_TEXT.reconnect,'Reconectar');
  const fatal=readFileSync('src/client/net-fatal.ts','utf8'),explore=readFileSync('src/client/explore.ts','utf8');
  assert.match(fatal,/state\.kind==='stuck'/);assert.match(fatal,/panel!\.action=reconnect\?\?/);
  assert.match(explore,/\{reconnect:\(\)=>net\.restart\(\)\}/);
  assert.match(explore,/else if\(!net\.fatal&&fatalShown\)\{fatalShown=undefined;hideFatal\(/);
});
