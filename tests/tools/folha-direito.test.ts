// scripts/folha-direito.mjs: the print sheet's right-button check (BUG-20261022-ORQ-botao-direito-anda). It failed ~2
// sheets in 3 since it was born: it compared the drawn sprite, which the room's late answer to the hold-to-follow still
// moved (whole walk steps along the last walk, revealed as the held attack's steps moved the slow client's clock on). Now
// it waits for the hero to settle and fails only when his own input walks during the hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import {HOLD_SAMPLE,PREDICTED,PREDICTED_MOVE,SETTLE,SETTLE_MAX_MS,SETTLE_MS,rightVerdict} from '../../scripts/folha-direito.mjs';

type Step={seq:number;x:number;y:number};
type Net={predicted:{x:number;y:number};pending:Step[]};
type Scene={route:unknown[];intent?:{x:number;y:number};hold?:{held:boolean};actor?:{texture:{key:string}};hooks:{net?:Net}};
/** A fake page: window.__perfScene, and requestAnimationFrame as a 20 ms timer (node has none). */
function page(scene:Scene){
  const g=globalThis as {window?:unknown;requestAnimationFrame?:(f:()=>void)=>void};
  g.window={__perfScene:scene};g.requestAnimationFrame=f=>{setTimeout(f,20);};
}
const scene=(net?:Net,extra:Partial<Scene>={}):Scene=>({route:[],intent:{x:0,y:0},hold:{held:false},actor:{texture:{key:'sprite16:viciado-em-bet:idle:S'}},hooks:{net},...extra});
const later=(ms:number,fn:()=>void)=>setTimeout(fn,ms);
const still={route:0,intent:0,steps:0,follow:false};

test('the numbers: still 1.2 s, given up at 12 s; a room move over 0.15 u (a city walk step is ~0.2 u) is worth a warning',()=>{
  assert.equal(SETTLE_MS,1200);assert.equal(SETTLE_MAX_MS,12000);assert.equal(PREDICTED_MOVE,.15);
});

test('PREDICTED: the prediction (a copy), null without a net session',()=>{
  const net={predicted:{x:1,y:2},pending:[]};page(scene(net));
  const q=PREDICTED()!;assert.deepEqual(q,{x:1,y:2});net.predicted.x=5;assert.equal(q.x,1);
  page(scene());assert.equal(PREDICTED(),null);
});

test('SETTLE: waits while a route is left, steps are unacked or a late correction moves the prediction; then true',async()=>{
  const net:Net={predicted:{x:10,y:10},pending:[{seq:1,x:1,y:0}]},s=scene(net,{route:[{x:1,y:1}]});page(s);
  later(150,()=>s.route.length=0);
  later(300,()=>net.pending=[]);
  later(450,()=>net.predicted={x:10.8,y:10});
  const t0=performance.now();
  assert.equal(await SETTLE([300,5000]),true);
  assert.ok(performance.now()-t0>=450+300-50,`settled only after the last jump (${Math.round(performance.now()-t0)} ms)`);
});

test('SETTLE: false when the hero never settles (a steady walk) or there is no net session',async()=>{
  const net:Net={predicted:{x:0,y:0},pending:[]};page(scene(net));
  const walk=setInterval(()=>{net.predicted={x:net.predicted.x+.1,y:0};},50);
  try{assert.equal(await SETTLE([300,800]),false);}finally{clearInterval(walk);}
  page(scene());assert.equal(await SETTLE([300,800]),false);
});

test('HOLD_SAMPLE: an attack held in place shows the attack and no walk of his own, even while the room moves him',async()=>{
  // The 22/10 sheet: attack steps without a direction pending, the prediction jumping 0.99 u (the room's answer).
  const net:Net={predicted:{x:165.02,y:215.68},pending:[{seq:40,x:0,y:0}]},s=scene(net);page(s);
  later(60,()=>{s.actor!.texture.key='sprite16:viciado-em-bet:attack:S';net.predicted={x:166.01,y:215.68};net.pending=[{seq:41,x:0,y:0}];});
  const {keys,own}=await HOLD_SAMPLE([20,300]);
  assert.ok(keys.some(k=>/attack/.test(k)),keys.join());
  assert.deepEqual(own,still);
});

test('HOLD_SAMPLE: a route, a walking intent, pending steps with a direction (each counted once) or the follow are his walk',async()=>{
  const net:Net={predicted:{x:0,y:0},pending:[{seq:1,x:1,y:0}]},s=scene(net);page(s);
  later(40,()=>{net.pending=[{seq:1,x:1,y:0},{seq:2,x:.7071,y:.7071},{seq:3,x:0,y:0}];s.intent={x:.7,y:.7};s.route=[{x:1,y:1},{x:2,y:2}];s.hold={held:true};});
  later(100,()=>{s.intent={x:0,y:0};s.route=[];s.hold={held:false};});
  const {own}=await HOLD_SAMPLE([20,300]);
  assert.equal(own.route,2);assert.ok(Math.abs(own.intent-Math.hypot(.7,.7))<1e-9);assert.equal(own.steps,2);assert.equal(own.follow,true);
});

test('verdict: his own walk fails; the room moving him only warns; an unsettled hero or a missing sample only warns',()=>{
  const at={x:166.01,y:215.68},before={x:165.02,y:215.68};
  assert.deepEqual(rightVerdict({settled:true,own:still,before,after:at},'1280×720'),{aviso:'1280×720: botão direito: a sala moveu o herói 0.99 u durante o ataque, sem passo dele (correção de rede)'});
  assert.deepEqual(rightVerdict({settled:true,own:still,before:at,after:{x:at.x+.1,y:at.y}},'1280×720'),{},'under a walk step: nothing to say');
  assert.deepEqual(rightVerdict({settled:true,own:{route:3,intent:1,steps:4,follow:false},before:at,after:at},'390×844'),
    {fail:'390×844: botão direito andou com o herói (rota de 3 pontos, direção de andar, 4 passos com direção; devia só atacar)'});
  assert.deepEqual(rightVerdict({settled:true,own:{...still,follow:true},before:at,after:at},'390×844'),
    {fail:'390×844: botão direito andou com o herói (segurar-e-seguir ligado; devia só atacar)'});
  assert.match(rightVerdict({settled:false,own:{...still,steps:9},before:at,after:at},'390×844').aviso!,/não assentou em 12 s.*andar não é julgado/);
  assert.match(rightVerdict({settled:true,own:null,before:at,after:at},'390×844').aviso!,/sem amostra/);
});
