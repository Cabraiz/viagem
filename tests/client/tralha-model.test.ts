/**
 * NEW-20261021-ORQ-barricada-construir part 2, the client's tralha (hud/tralha/model.ts): the square under a point, the
 * tap and the hover, the gold outline (the alert's red wins), the two circles' requests and the answers in words.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {TralhaPick,squareAt,tralhaRefusalText,INTERATIVO_COR} from '../../src/client/hud/tralha/model.ts';
import {COLETAR_SECONDS,DESTRUIR_PIX} from '../../src/rules/index.ts';
import {SIM_HZ} from '../../src/contract/index.ts';

const cell=.88;
const sq=(id:string,c:number,r:number,extra:object={})=>({id,kind:'barricada',x:(c+.5)*cell,y:(r+.5)*cell,hp:200,c,r,...extra});

test('squareAt: the standing barricada on the cell under the point; a fallen one or another kind is not', ()=>{
  const list=[sq('a',3,4),sq('b',5,4,{hp:0}),{id:'m',kind:'muro',x:0,y:0,hp:250,c:6,r:4}];
  assert.equal(squareAt(list,{x:3.2*cell,y:4.9*cell},cell)?.id,'a');
  assert.equal(squareAt(list,{x:5.5*cell,y:4.5*cell},cell),undefined);
  assert.equal(squareAt(list,{x:6.5*cell,y:4.5*cell},cell),undefined);
  // barricada-2x: a square covers its 2×2 cells (3..4 × 4..5), not the next ones.
  assert.equal(squareAt(list,{x:4.9*cell,y:5.9*cell},cell)?.id,'a');
  assert.equal(squareAt(list,{x:2.9*cell,y:4.5*cell},cell),undefined);
  assert.equal(squareAt(list,{x:3.5*cell,y:6.1*cell},cell),undefined);
  assert.equal(INTERATIVO_COR,0xffd23f,'Amarelo Encarte');
});

test('tap selects, hover outlines, the alert wins; a gone square drops the selection', ()=>{
  const pick=new TralhaPick(),list=[sq('a',3,4),sq('b',8,8,{untilTick:200})];
  assert.equal(pick.tap(list,{x:3.5*cell,y:4.5*cell},cell),true);
  assert.equal(pick.outline(list,100),'a');
  assert.equal(pick.tap(list,{x:0,y:0},cell),false,'elsewhere: not ours');
  assert.equal(pick.selected,undefined);
  assert.equal(pick.move(list,{x:8.5*cell,y:8.5*cell},cell),true);
  assert.equal(pick.outline(list,100),undefined,'the car alert glows red instead');
  assert.equal(pick.outline(list,200),'b','the alert is over');
  pick.tap(list,{x:3.5*cell,y:4.5*cell},cell);
  pick.sync([sq('b',8,8)]);
  assert.equal(pick.selected,undefined);
});

test('the circles send for the selected square; the answers in words; the coleta bar', ()=>{
  const pick=new TralhaPick(),sent:string[]=[],net={tralha:(k:'destruir'|'coletar',id:string)=>{sent.push(`${k}:${id}`);return sent.length;}};
  assert.equal(pick.act('destruir',net,0),'none');
  pick.tap([sq('a',3,4)],{x:3.5*cell,y:4.5*cell},cell);
  assert.equal(pick.act('destruir',net,0),'sent');
  assert.equal(pick.answer({t:'destruiu',req:1,ok:true,pix:DESTRUIR_PIX}),`+R$ ${DESTRUIR_PIX}: virou sucata`);
  pick.tap([sq('a',3,4)],{x:3.5*cell,y:4.5*cell},cell);
  assert.equal(pick.act('coletar',net,100),'sent');
  assert.deepEqual(sent,['destruir:a','coletar:a']);
  assert.equal(pick.answer({t:'coleta',req:2,ok:true,until:100+COLETAR_SECONDS*SIM_HZ}),undefined);
  assert.equal(pick.progress(100+COLETAR_SECONDS*SIM_HZ/2),.5);
  assert.equal(pick.answer({t:'coleta',req:2,ok:false,reason:'apanhou'}),'Apanhou, largou a tralha');
  assert.equal(pick.progress(200),undefined);
  assert.equal(pick.answer({t:'coleta',req:99,ok:true}),undefined,'not ours');
  assert.equal(tralhaRefusalText('xyz'),'Agora não dá');
});
