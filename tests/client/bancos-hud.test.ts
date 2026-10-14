// Bancos on the HUD (card bancos-e-veiculos): the "$" marks of the minimap, the robbery row (once per robbery, quiet
// for a while per bank) and the city's arrow (one bank at most: the robbed one, else the nearest with notes; never an
// empty one, never one in view).
import test from 'node:test';
import assert from 'node:assert/strict';
import type {BankView} from '../../src/contract/index.ts';
import {BANK_ALERT_REPEAT_MS,BANK_MM_COLORS,BankAlert,bankExtras,robberyText} from '../../src/client/hud/bancos.ts';
import {bankForArrow,cityEdgeRank} from '../../src/client/hud/city/edges.ts';
import {EDGE_ICON} from '../../src/client/hud/edges.ts';
import {ICON_NAMES} from '../../src/client/ui/icon.ts';

const bank=(id:string,extra:Partial<BankView>={}):BankView=>({id,x:0,y:0,name:'juros',saldo:40,state:'aberto',...extra});

test('the minimap: a "$" per bank, Cone while robbed, dim when empty',()=>{
  const out=bankExtras([bank('a'),bank('b',{state:'bicho'}),bank('c',{state:'sem-cedulas',saldo:0})]);
  assert.deepEqual(out.map(x=>x.color),[BANK_MM_COLORS.cheio,BANK_MM_COLORS.bicho,BANK_MM_COLORS.vazio]);
  assert.ok(out.every(x=>x.kind==='banco'));assert.deepEqual(bankExtras(undefined),[]);
});

test('the robbery row: when a robbery starts, once; the same bank again only after the quiet time',()=>{
  const a=new BankAlert(),robbed=[bank('b',{state:'bicho'})];
  assert.equal(a.step([bank('b')],0).show,undefined);
  assert.deepEqual(a.step(robbed,1000).show,{text:robberyText(robbed[0]),bank:'b'});
  assert.equal(robberyText(robbed[0]),'Bicho sacando no Juros & Juros!');
  assert.equal(a.step(robbed,2000).show,undefined,'the same robbery');
  a.step([bank('b')],3000);
  assert.equal(a.step(robbed,4000).show,undefined,'a new robbery too soon');
  a.step([bank('b')],5000);
  assert.ok(a.step(robbed,1000+BANK_ALERT_REPEAT_MS).show,'after the quiet time');
  // Two robberies at once: one row, the other on the next view.
  const b=new BankAlert(),two=[bank('x',{state:'bicho'}),bank('y',{state:'bicho',name:'posto'})];
  assert.equal(b.step(two,0).show?.bank,'x');
  assert.equal(b.step(two,16).show?.bank,'y','the second robbery calls on the next view');
  assert.equal(b.step(two,32).show,undefined);
});

test('the arrow: the robbed bank first, else the nearest with notes; never an empty one or one in view',()=>{
  const off=()=>false,hero={x:0,y:0};
  const near=bank('near',{x:10,y:0}),far=bank('far',{x:50,y:0,state:'bicho'}),empty=bank('empty',{x:5,y:0,state:'sem-cedulas',saldo:0});
  assert.equal(bankForArrow([near,far,empty],hero,off)?.id,'far');
  assert.equal(bankForArrow([near,empty],hero,off)?.id,'near');
  assert.equal(bankForArrow([empty],hero,off),undefined);
  assert.equal(bankForArrow([near],hero,()=>true),undefined);
  assert.equal(cityEdgeRank({key:'banco:a',kind:'banco',screen:{x:0,y:0},distance:1,danger:true}),3.8,'a robbed bank before the base');
  assert.equal(cityEdgeRank({key:'banco:a',kind:'banco',screen:{x:0,y:0},distance:1}),4.2,'an idle one after it (review 1, L8)');
  assert.ok(cityEdgeRank({key:'base',kind:'base',screen:{x:0,y:0},distance:1})<4.2);
  assert.equal(EDGE_ICON.banco,'banco');assert.ok((ICON_NAMES as readonly string[]).includes('banco'));
});
