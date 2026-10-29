/**
 * NEW-20261029-ORQ-pix-sem-acumular (auditoria-economia-29-10 items 6 and 8): the bots' PIX tops the bank up to its next
 * purchase and no more, so the wallets stay apart; the Grana a bot keeps buys Dona Cida's sweets at the moto in a wave.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BANK_STEP,CIDA_BOT_REACH,bankNeed,cidaPick,pixAmount} from '../../multiplayer/bot-economia.ts';
import {CIDA_ITEMS,PIX_MAX} from '../../src/contract/index.ts';
import {forgePrice} from '../../src/rules/index.ts';
import {MAX_TOWERS,granaReserve} from '../../src/sim/index.ts';

type View=Parameters<typeof bankNeed>[0];
const SEATS=6,BUDGET=60;
function view(o:{phase?:'prepare'|'wave';forge?:Record<string,number>;towers?:number;at?:{x:number;y:number};stock?:number[];self?:Record<string,unknown>;objective?:boolean}={}):View{
  const players=Array.from({length:SEATS},(_,i)=>({id:`b${i}`,online:true,spectator:false,downed:false,eliminated:false,hp:100,x:50,y:50,...(i===1?o.self:{})}));
  if(o.at)Object.assign(players[1],o.at);
  return {tick:1000,round:{index:3,total:10,phase:o.phase??'wave',phaseEndsTick:2000,remaining:0},players,
    camp:{grana:0,...(o.forge?{forge:o.forge}:{})},
    structures:Array.from({length:o.towers??0},(_,i)=>({id:`t${i}`,kind:'torre-chinelo',x:0,y:0})),
    ...(o.objective===false?{}:{objective:{ended:false,etaS:300,budget:BUDGET,grana:0,stock:o.stock??CIDA_ITEMS.map(()=>4),moto:{x:10,y:10,mode:'anda'},car:{x:0,y:0,hits:0,limit:10,parts:0}}}),
  } as unknown as View;
}

test('the bank may hold its part of the bill and its dearest next purchase',()=>{
  const reserve=granaReserve(view());
  assert.equal(reserve,Math.ceil(BUDGET*1.3/SEATS));
  assert.equal(bankNeed(view()),reserve+forgePrice('torre-chinelo'),'a chinelo tower is the dearest at first');
  // The forge inflates: the gambiarra's price is what the bank lacks for it.
  assert.equal(bankNeed(view({forge:{gambiarra:3}})),reserve+forgePrice('gambiarra',{gambiarra:3}));
  // No room for another chinelo tower: a tower step or the gambiarra.
  assert.equal(bankNeed(view({towers:MAX_TOWERS})),reserve+Math.max(BANK_STEP,forgePrice('gambiarra')));
  // Without a forge (no camp) only a tower step.
  assert.equal(bankNeed({...view(),camp:undefined}),reserve+BANK_STEP);
});

test('PIX: what is above the sender\'s part, up to PIX_MAX and to what the bank lacks',()=>{
  const v=view(),reserve=granaReserve(v),need=bankNeed(v);
  assert.equal(pixAmount(v,reserve+20,0),20,'all of the surplus when the bank lacks more');
  assert.equal(pixAmount(v,reserve+500,0),Math.min(PIX_MAX,need));
  assert.equal(pixAmount(v,reserve+500,need-7),7,'only what tops the bank up');
  assert.equal(pixAmount(v,reserve+500,need),0,'a full bank gets nothing');
  assert.equal(pixAmount(v,reserve+500,need+700),0,'nor a rich one');
  assert.equal(pixAmount(v,reserve-5,0),0,'the sender keeps its part of the bill');
});

test('the audit\'s 6p: a bank that cannot spend no longer ends with everything',()=>{
  // The bank (slot 0) earns little (it builds), the others R$3 every step and send their PIX every 5 steps; the bank
  // buys nothing (units short). Before: everything above each part went to it.
  const v=view(),reserve=granaReserve(v),need=bankNeed(v);
  const run=(amount:(grana:number,bank:number)=>number)=>{
    const wallets=Array.from({length:SEATS},()=>0);let pixed=0;
    for(let step=1;step<=400;step++){
      wallets[0]+=step%10?0:1;
      for(let i=1;i<SEATS;i++)wallets[i]+=3;
      if(step%5)continue;
      for(let i=1;i<SEATS;i++){const a=amount(wallets[i],wallets[0]);if(a>=5){wallets[i]-=a;wallets[0]+=a;pixed+=a;}}
    }
    return {wallets,pixed,total:wallets.reduce((a,b)=>a+b,0)};
  };
  const before=run(grana=>Math.min(PIX_MAX,grana-reserve)),after=run((grana,bank)=>pixAmount(v,grana,bank));
  assert.ok(before.wallets[0]>before.total*.8,`before: the bank held ${before.wallets.join(',')}`);
  assert.ok(after.pixed<=need,`PIX in ${after.pixed} ≤ the bank's need ${need}`);
  assert.ok(after.wallets[0]<after.total/3,`after: ${after.wallets.join(',')}`);
  assert.ok(Math.min(...after.wallets.slice(1))>reserve,'every bot keeps its own Grana');
});

test('Dona Cida: at the moto in a wave, damage then guard then speed, never below what the bot keeps',()=>{
  const at={x:10+CIDA_BOT_REACH-.05,y:10},reserve=granaReserve(view()),rich=reserve+100;
  assert.equal(cidaPick(view({at}),'b1',rich),'pacoca');
  assert.equal(cidaPick(view({at,self:{mightUntil:1500}}),'b1',rich),'cocada','the paçoca still works');
  assert.equal(cidaPick(view({at,self:{mightUntil:1500,guardUntil:1500}}),'b1',rich),'brigadeiro');
  assert.equal(cidaPick(view({at,self:{mightUntil:900}}),'b1',rich),'pacoca','an effect that ended is bought again');
  assert.equal(cidaPick(view({at,stock:[4,0,4]}),'b1',rich),'cocada','out of stock');
  // Money: the paçoca (25) needs 25 above the bot's part; 20 gets the cocada, 15 the brigadeiro, 14 nothing.
  assert.equal(cidaPick(view({at}),'b1',reserve+20),'cocada');
  assert.equal(cidaPick(view({at}),'b1',reserve+15),'brigadeiro');
  assert.equal(cidaPick(view({at}),'b1',reserve+14),undefined);
  // The bank keeps its next purchase too.
  assert.equal(cidaPick(view({at}),'b1',bankNeed(view())+14,true),undefined);
  assert.equal(cidaPick(view({at}),'b1',bankNeed(view())+25,true),'pacoca');
});

test('Dona Cida: nothing away from the moto, in the intermission, down, or without the chaveiro',()=>{
  const at={x:10,y:10},rich=500;
  assert.equal(cidaPick(view({at:{x:10+CIDA_BOT_REACH+.1,y:10}}),'b1',rich),undefined);
  assert.equal(cidaPick(view({at,phase:'prepare'}),'b1',rich),undefined);
  assert.equal(cidaPick(view({at,self:{downed:true}}),'b1',rich),undefined);
  assert.equal(cidaPick(view({at,objective:false}),'b1',rich),undefined);
  assert.equal(cidaPick(view({at}),'nobody',rich),undefined);
});
