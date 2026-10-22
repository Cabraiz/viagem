// scripts/folha-direito.mjs: the print sheet's right-button check (BUG-20261022-ORQ-botao-direito-anda). It failed ~2
// sheets in 3 since it was born: it read the drawn sprite while the hold-to-follow's late correction still slid it. Now it
// waits for the hero to settle and judges his prediction (net.predicted), which only his own steps move.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PREDICTED,PREDICTED_MOVE,SETTLE,SETTLE_MAX_MS,SETTLE_MS,rightVerdict} from '../../scripts/folha-direito.mjs';

type Net={predicted:{x:number;y:number};pending:unknown[]};
/** A fake page: window.__perfScene with a route and a net session the test moves on a timer. */
function page(net:Net|undefined,route:unknown[]=[]){(globalThis as {window?:unknown}).window={__perfScene:{route,hooks:{net}}};}
const later=(ms:number,fn:()=>void)=>setTimeout(fn,ms);

test('the numbers: still 1.2 s, given up at 12 s; a move over 0.15 u (1.5 steps of the city walk) is a walk',()=>{
  assert.equal(SETTLE_MS,1200);assert.equal(SETTLE_MAX_MS,12000);assert.equal(PREDICTED_MOVE,.15);
});

test('PREDICTED: the prediction (a copy), null without a net session',()=>{
  const net={predicted:{x:1,y:2},pending:[]};page(net);
  const q=PREDICTED()!;assert.deepEqual(q,{x:1,y:2});net.predicted.x=5;assert.equal(q.x,1);
  page(undefined);assert.equal(PREDICTED(),null);
});

test('SETTLE: waits while a route is left, steps are unacked or a late correction moves the prediction; then true',async()=>{
  const net:Net={predicted:{x:10,y:10},pending:[1,2,3]},route=[{x:1,y:1}];page(net,route);
  later(150,()=>route.length=0);
  later(300,()=>net.pending=[]);
  // The room's late answer after the ack: the prediction jumps once more.
  later(450,()=>net.predicted={x:10.8,y:10});
  const t0=performance.now();
  assert.equal(await SETTLE([300,5000]),true);
  assert.ok(performance.now()-t0>=450+300-50,`settled only after the last jump (${Math.round(performance.now()-t0)} ms)`);
});

test('SETTLE: false when the hero never settles (a steady walk) or there is no net session',async()=>{
  const net:Net={predicted:{x:0,y:0},pending:[]};page(net);
  const walk=setInterval(()=>{net.predicted={x:net.predicted.x+.1,y:0};},50);
  try{assert.equal(await SETTLE([300,800]),false);}finally{clearInterval(walk);}
  page(undefined);assert.equal(await SETTLE([300,800]),false);
});

test('verdict: a walk of the prediction fails, a still one passes, an unsettled hero only warns',()=>{
  const at={x:166.01,y:215.68};
  // The 22/10 sheet: the held attack slid the hero ~1 u along pombo poop.
  assert.deepEqual(rightVerdict({settled:true,before:{x:165.02,y:215.68},after:at},'1280×720'),{fail:'1280×720: botão direito andou com o herói 0.99 u (devia só atacar)'});
  assert.deepEqual(rightVerdict({settled:true,before:at,after:{x:at.x+.1,y:at.y}},'1280×720'),{},'under one and a half steps: still');
  assert.deepEqual(rightVerdict({settled:true,before:at,after:at},'390×844'),{});
  assert.match(rightVerdict({settled:false,before:at,after:{x:0,y:0}},'390×844').aviso!,/não assentou em 12 s.*andar não é julgado/);
  assert.match(rightVerdict({settled:true,before:null,after:at},'390×844').aviso!,/sem a posição prevista/);
});
