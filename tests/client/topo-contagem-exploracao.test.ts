/**
 * NEW-20261025-ORQ-topo-sem-icone-contagem-exploracao: the top's green bar has no moto before the clock, and in the time
 * to explore (inicio-no-uno-caixas-120) it shows the seconds left as a bare number (120, 119…); outside it, the chaveiro's
 * m:ss as before. The waiting room has no map choice any more (the room opens on ROOM_DEFAULT_MAP).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SIM_HZ,type RunView} from '../../src/contract/index.ts';
import {barClock} from '../../src/client/hud/camp.ts';
import {exploraLeft} from '../../src/client/hud/model.ts';
import {ROOM_DEFAULT_MAP} from '../../src/protocol/index.ts';

const from=1000,explora={from,until:from+120*SIM_HZ};
const viewAt=(tick:number)=>({tick,round:{index:1,total:10,remaining:0,phase:'wave',phaseEndsTick:0},
  objective:{ended:false,etaS:669,moto:{mode:'anda'}},enemies:[],players:[],events:[],structures:[]}) as unknown as RunView;

test('exploraLeft: 120 at the first tick, whole seconds down to 1, nothing outside the window',()=>{
  assert.equal(exploraLeft(from-1,explora),undefined,'before it');
  assert.equal(exploraLeft(from,explora),120);
  assert.equal(exploraLeft(from+1,explora),120,'a part of a second still counts as one');
  assert.equal(exploraLeft(from+SIM_HZ,explora),119);
  assert.equal(exploraLeft(explora.until-1,explora),1);
  assert.equal(exploraLeft(explora.until,explora),undefined,'the wave leaves: back to the clock');
  assert.equal(exploraLeft(from,undefined),undefined);
});

test("the phone's bar: the seconds left in the time to explore, the chaveiro's m:ss outside it, no moto in either",()=>{
  const exploring=barClock(viewAt(from+SIM_HZ),explora)!;
  assert.deepEqual({icon:exploring.icon,text:exploring.text},{icon:undefined,text:'119'});
  assert.match(exploring.aria,/Exploração: faltam 119 s/);
  const after=barClock(viewAt(explora.until),explora)!;
  assert.deepEqual({icon:after.icon,text:after.text},{icon:undefined,text:'11:09'});
  assert.deepEqual(barClock(viewAt(from))&&barClock(viewAt(from))!.text,'11:09','no window: the chaveiro');
});

test('no moto sticker on the top (chip and bar), the seconds written in place (no innerHTML per second)',()=>{
  const read=(f:string)=>readFileSync(new URL(`../../src/client/hud/${f}`,import.meta.url),'utf8');
  const topbar=read('topbar.ts'),camp=read('camp.ts');
  assert.doesNotMatch(topbar,/icon\('moto'\)/);assert.doesNotMatch(camp,/icon:'moto'|'moto'\|/);
  // The number goes through putIconNumber (markup rebuilt only when the sticker changes; a second is the <b>'s text).
  assert.match(topbar,/putIconNumber\(eta\.lastElementChild as HTMLElement,clock\.held\?icon\('cadeado'\):''/);
  assert.match(camp,/putIconNumber\(clockPicture,bar\.icon\?icon\(bar\.icon\):'',bar\.text\)/);
});

test('the waiting room: no map selector mounted, the room still opens on the city',()=>{
  const lobby=readFileSync(new URL('../../src/client/lobby.ts',import.meta.url),'utf8');
  assert.doesNotMatch(lobby,/mountMapSelector|coop-wait-map/);
  assert.equal(ROOM_DEFAULT_MAP,'cidade-nevada');
});
