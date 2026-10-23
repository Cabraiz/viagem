// bau-mostra-o-premio: the crate shows what it gave (sticker + name in the rarity colour), found from the views alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ChestPrizes,PRIZE_CLAIM_MS,PRIZE_GLOW,PRIZE_HOLD_MS,PRIZE_MS,PRIZE_RISE_MS,PRIZE_SAFE,RARITY_COLOR,inventoryGains,prizeLook,prizeMotion,prizeSpot}
  from '../../src/client/render/arsenal-rules.ts';
import {ALLY_PRIZE,ARSENAL_PUSH_MS,SANDBOX_ALLY,SELF_PRIZES,arsenalView} from '../../src/client/sandboxes/arsenal-view.ts';
import {itemDisplay} from '../../src/client/hud/items.ts';
import {KIT_IDS} from '../../src/rules/index.ts';

const hero=(id:string,weapons:{id:string;level:number}[])=>({id,weapons});

test('inventoryGains: a new slot, a second copy, a grown stack; never a weapon levelling up', () => {
  assert.deepEqual(inventoryGains(undefined,[{id:'faca',level:1}]),[],'the first view is no gain');
  assert.deepEqual(inventoryGains([{id:'faca',level:1}],[{id:'faca',level:1},{id:'pistola',level:2}]),['pistola']);
  assert.deepEqual(inventoryGains([{id:'faca',level:1}],[{id:'faca',level:1},{id:'faca',level:3}]),['faca']);
  assert.deepEqual(inventoryGains([{id:'faca',level:1},{id:'coxinha',level:1}],[{id:'faca',level:1},{id:'coxinha',level:3}]),['coxinha']);
  assert.deepEqual(inventoryGains([{id:'faca',level:1}],[{id:'faca',level:2}]),[]);
  assert.deepEqual(inventoryGains([{id:'faca',level:1},{id:'pistola',level:1}],[{id:'faca',level:1}]),[],'a drop is no gain');
});

test('ChestPrizes: the opener claims its gain of the same view, once; other heroes keep theirs', () => {
  const prizes=new ChestPrizes();
  prizes.observe([hero('a',[{id:'faca',level:1}]),hero('b',[{id:'faca',level:1}])],[],0);
  prizes.observe([hero('a',[{id:'faca',level:1},{id:'pistola',level:2}]),hero('b',[{id:'faca',level:1},{id:KIT_IDS[0],level:1}])],[],50);
  assert.equal(prizes.claim('a',{x:0,y:0},50),'pistola');
  assert.equal(prizes.claim('a',{x:0,y:0},50),undefined,'claimed once');
  assert.equal(prizes.claim('b',undefined,60),KIT_IDS[0]);
});

test('ChestPrizes: a full inventory: the item that fell at the crate; a stale gain is not the prize', () => {
  const prizes=new ChestPrizes();
  prizes.observe([hero('a',[{id:'faca',level:1}])],[{id:'item-9',kind:'item',resource:'escopeta',x:20,y:20}],0);
  prizes.observe([hero('a',[{id:'faca',level:1}])],[{id:'item-9',kind:'item',resource:'escopeta',x:20,y:20},{id:'item-10',kind:'item',resource:'rifle',x:5,y:5}],50);
  assert.equal(prizes.claim('a',{x:30,y:30},50),undefined,'no item near that crate');
  assert.equal(prizes.claim('a',{x:5.2,y:5.1},50),'rifle');
  prizes.observe([hero('a',[{id:'faca',level:1},{id:'pistola',level:1}])],[],100);
  assert.equal(prizes.claim('a',undefined,100+PRIZE_CLAIM_MS+1),undefined,'too old to be this crate');
});

test('prizeLook: the inventory sticker and name, the crate colour, a stronger glow on the gold and legendary', () => {
  const look=prizeLook('pistola',4);
  assert.equal(look.name,'Trinta-e-Oitão do Vô');
  assert.equal(look.icon,itemDisplay('pistola').icon);
  assert.equal(look.color,RARITY_COLOR[4]);
  assert.ok(!/verde|azul|roxa|dourada|lendária/i.test(look.name),'no rarity word');
  const kit=prizeLook(KIT_IDS.find(id=>id.includes('vigia'))??KIT_IDS[0],1);
  assert.equal(kit.name,itemDisplay(kit.id).name);
  assert.ok(PRIZE_GLOW[4]>PRIZE_GLOW[3]&&PRIZE_GLOW[5]>=PRIZE_GLOW[4]&&PRIZE_GLOW[1]<PRIZE_GLOW[3]);
});

test('prizeMotion: rises fading in with a hop over its rest, stays, fades out; none after', () => {
  const at=(t:number)=>prizeMotion(t)!;
  assert.equal(at(0).alpha,0);
  assert.ok(at(PRIZE_RISE_MS*.4).alpha>.5&&at(PRIZE_RISE_MS*.4).alpha<1,'fading in');
  let top=0;for(let t=0;t<PRIZE_RISE_MS;t+=10)top=Math.max(top,at(t).lift);
  assert.ok(top>1.05,'the hop goes over the rest');
  assert.deepEqual(at(PRIZE_RISE_MS+10),{alpha:1,lift:1,scale:1});
  assert.ok(at(PRIZE_MS-10).alpha<.1);
  assert.equal(prizeMotion(PRIZE_MS),undefined);
  assert.ok(PRIZE_RISE_MS>=500&&PRIZE_RISE_MS<=700&&PRIZE_HOLD_MS>=1000&&PRIZE_HOLD_MS<=1400,'~0,6 s up, ~1,2 s in the air');
  for(let t=0;t<PRIZE_RISE_MS;t+=10)assert.ok(prizeMotion(t,true)!.lift<=1,'reduced motion: no hop');
});

test('prizeSpot: inside the view it stays; near the HUD corners and bottom it comes in', () => {
  const view={x:100,y:200,width:400,height:800},o={x:0,y:0};
  assert.deepEqual(prizeSpot(300,500,view,o),{x:300,y:500});
  assert.deepEqual(prizeSpot(490,990,view,{x:0,y:0}),{x:100+400*PRIZE_SAFE.right,y:200+800*PRIZE_SAFE.bottom});
  assert.deepEqual(prizeSpot(0,0,view,{x:0,y:0}),{x:100+400*PRIZE_SAFE.left,y:200+800*PRIZE_SAFE.top});
  assert.ok(PRIZE_SAFE.bottom<=.7,'clear of the Atacar button and the inventory');
});

test('ChestPrizes: the newest gain is the prize (an older one was something else)', () => {
  const prizes=new ChestPrizes();
  prizes.observe([hero('a',[{id:'faca',level:1}])],[],0);
  prizes.observe([hero('a',[{id:'faca',level:1},{id:'pistola',level:1}])],[],100);
  prizes.observe([hero('a',[{id:'faca',level:1},{id:'pistola',level:1},{id:'rifle',level:3}])],[],400);
  assert.equal(prizes.claim('a',undefined,400),'rifle');
});

test('sandbox arsenal-view: every crate opened gives its prize as the sim does', () => {
  const base={tick:0,players:[],enemies:[],pickups:[],projectiles:[],telegraphs:[],events:[]} as unknown as Parameters<typeof arsenalView>[0];
  const prizes=new ChestPrizes(),got:{player:string;rarity:number;item?:string}[]=[];
  const crates=new Map<string,{x:number;y:number}>();
  for(let t=0;t<4*3000;t+=ARSENAL_PUSH_MS){
    const v=arsenalView(base,10,10,t,'pistola');
    prizes.observe(v.players,v.pickups,t);
    for(const e of v.events)if(e.type==='pickup'&&e.kind==='chest')got.push({player:e.player,rarity:e.value,item:prizes.claim(e.player,crates.get(e.pickup),t)});
    for(const k of v.pickups)if(k.kind==='chest')crates.set(k.id,{x:k.x,y:k.y});
  }
  const mine=got.filter(g=>g.player!==SANDBOX_ALLY);
  assert.deepEqual(mine.map(g=>[g.rarity,g.item]),SELF_PRIZES.map(p=>[p.rarity,p.item]));
  assert.ok(got.filter(g=>g.player===SANDBOX_ALLY).every(g=>g.item===ALLY_PRIZE));
});

test('prizeSpot: a long name stays inside the screen edges', () => {
  const view={x:0,y:0,width:412,height:915};
  assert.equal(prizeSpot(10,400,view,{x:0,y:0},120).x,120);
  assert.equal(prizeSpot(400,400,view,{x:0,y:0},120).x,292);
  assert.equal(prizeSpot(400,400,view,{x:0,y:0},300).x,206,'wider than the view: centred');
});
