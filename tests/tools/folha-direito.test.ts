// scripts/folha-direito.mjs: the print sheet's right-button check (BUG-20261022-ORQ-botao-direito-anda). It failed ~2
// sheets in 3 since it was born: it compared the drawn sprite, which the room's late answer to the hold-to-follow still
// moved (whole walk steps along the last walk, revealed as the held attack's steps moved the slow client's clock on). Now
// it marks where his own input stands right before the press and fails only when that input walks during the hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import {HOLD_BASE,HOLD_SAMPLE,PREDICTED,PREDICTED_MOVE,SETTLE,SETTLE_MAX_MS,SETTLE_MS,rightVerdict} from '../../scripts/folha-direito.mjs';

type Step={seq:number;x:number;y:number};
type Net={predicted:{x:number;y:number};pending:Step[];batcher?:{seq:number}};
type Scene={route:unknown[];intent?:{x:number;y:number};hold?:{held:boolean};actor?:{texture:{key:string}};hooks:{net?:Net}};
/** A fake page: window.__perfScene, and requestAnimationFrame as a 20 ms timer (node has none). */
function page(scene:Scene){
  const g=globalThis as {window?:unknown;requestAnimationFrame?:(f:()=>void)=>void};
  g.window={__perfScene:scene};g.requestAnimationFrame=f=>{setTimeout(f,20);};
}
const scene=(net?:Net,extra:Partial<Scene>={}):Scene=>({route:[],intent:{x:0,y:0},hold:{held:false},actor:{texture:{key:'sprite16:viciado-em-bet:idle:S'}},hooks:{net},...extra});
const later=(ms:number,fn:()=>void)=>setTimeout(fn,ms);
const still={route:0,intent:0,steps:0,follow:false};

test('the numbers: no route for 0.6 s, waited at most 12 s; a room move over 0.15 u (a city walk step is ~0.2 u) is worth a warning',()=>{
  assert.equal(SETTLE_MS,600);assert.equal(SETTLE_MAX_MS,12000);assert.equal(PREDICTED_MOVE,.15);
});

test('PREDICTED: the prediction (a copy), null without a net session',()=>{
  const net={predicted:{x:1,y:2},pending:[]};page(scene(net));
  const q=PREDICTED()!;assert.deepEqual(q,{x:1,y:2});net.predicted.x=5;assert.equal(q.x,1);
  page(scene());assert.equal(PREDICTED(),null);
});

test('SETTLE: waits for the route to end and the hold-to-follow to be off; false when it never does or with no scene',async()=>{
  const s=scene({predicted:{x:0,y:0},pending:[]},{route:[{x:1,y:1}],hold:{held:true}});page(s);
  later(150,()=>s.hold={held:false});
  later(300,()=>s.route=[]);
  const t0=performance.now();
  assert.equal(await SETTLE([300,5000]),true);
  assert.ok(performance.now()-t0>=300+300-50,`settled only after the route (${Math.round(performance.now()-t0)} ms)`);
  page(scene(undefined,{route:[{x:1,y:1}]}));assert.equal(await SETTLE([300,600]),false);
  delete (globalThis as {window?:{__perfScene?:unknown}}).window!.__perfScene;assert.equal(await SETTLE([300,600]),false);
});

test('HOLD_SAMPLE: an attack held in place shows the attack and no walk of his own, even while the room moves him',async()=>{
  // The 22/10 sheet: attack steps without a direction, older walking steps still unacked, the prediction jumping 0.99 u.
  const net:Net={predicted:{x:165.02,y:215.68},pending:[{seq:38,x:1,y:0},{seq:39,x:1,y:0}],batcher:{seq:39}},s=scene(net);page(s);
  assert.deepEqual(HOLD_BASE(),{routeLength:0,seq:39});
  later(60,()=>{s.actor!.texture.key='sprite16:viciado-em-bet:attack:S';net.predicted={x:166.01,y:215.68};net.pending=[{seq:39,x:1,y:0},{seq:40,x:0,y:0},{seq:41,x:0,y:0}];});
  const {keys,own}=await HOLD_SAMPLE([20,300]);
  assert.ok(keys.some(k=>/attack/.test(k)),keys.join());
  assert.deepEqual(own,still);
});

test('HOLD_SAMPLE: a new route, a walking intent, new steps with a direction (each once) or the follow are his walk',async()=>{
  const net:Net={predicted:{x:0,y:0},pending:[{seq:1,x:1,y:0}],batcher:{seq:1}},s=scene(net);page(s);HOLD_BASE();
  later(40,()=>{net.pending=[{seq:1,x:1,y:0},{seq:2,x:.7071,y:.7071},{seq:3,x:0,y:0},{seq:4,x:0,y:1}];s.intent={x:.7,y:.7};s.route=[{x:1,y:1},{x:2,y:2}];s.hold={held:true};});
  later(100,()=>{s.intent={x:0,y:0};s.route=[];s.hold={held:false};});
  const {own}=await HOLD_SAMPLE([20,300]);
  assert.equal(own.route,2);assert.ok(Math.abs(own.intent-Math.hypot(.7,.7))<1e-9);assert.equal(own.steps,2,'steps 2 and 4: after the press, with a direction');assert.equal(own.follow,true);
});

test('HOLD_SAMPLE: a hero still walking the mouse route at the press is judged on a new route and the follow only',async()=>{
  const old=[{x:1,y:1},{x:2,y:2}],net:Net={predicted:{x:0,y:0},pending:[],batcher:{seq:10}},s=scene(net,{route:old,intent:{x:1,y:0}});page(s);
  assert.deepEqual(HOLD_BASE(),{routeLength:2,seq:10});
  later(40,()=>{old.shift();net.pending=[{seq:11,x:1,y:0},{seq:12,x:1,y:0}];});
  assert.deepEqual((await HOLD_SAMPLE([20,300])).own,still,'the old route walking on is not the button');
  page(s);HOLD_BASE();later(40,()=>{s.route=[{x:5,y:5}];});
  assert.equal((await HOLD_SAMPLE([20,300])).own.route,1,'a new route is');
});

test('verdict: his own walk fails; the room moving him only warns; an unsettled hero warns and is still judged',()=>{
  const at={x:166.01,y:215.68},before={x:165.02,y:215.68};
  assert.deepEqual(rightVerdict({settled:true,own:still,before,after:at},'1280×720'),{aviso:'1280×720: botão direito: a sala moveu o herói 0.99 u durante o ataque, sem passo dele (correção de rede)'});
  assert.deepEqual(rightVerdict({settled:true,own:still,before:at,after:{x:at.x+.1,y:at.y}},'1280×720'),{},'under a walk step: nothing to say');
  assert.deepEqual(rightVerdict({settled:true,own:{route:3,intent:1,steps:4,follow:false},before:at,after:{x:170,y:215}},'390×844'),
    {fail:'390×844: botão direito andou com o herói (rota nova de 3 pontos, direção de andar, 4 passos com direção; devia só atacar)'});
  const late=rightVerdict({settled:false,own:{...still,follow:true},before:at,after:at},'390×844');
  assert.equal(late.fail,'390×844: botão direito andou com o herói (segurar-e-seguir ligado; devia só atacar)');
  assert.match(late.aviso!,/ainda andava a rota do mouse depois de 12 s/);
  assert.deepEqual(rightVerdict({settled:false,own:still,before:at,after:at},'390×844').fail,undefined);
  assert.match(rightVerdict({settled:true,own:null,before:at,after:at},'390×844').aviso!,/sem amostra/);
});
