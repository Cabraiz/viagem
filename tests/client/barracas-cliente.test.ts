/**
 * NEW-20261023-ORQ-barracas-no-caminho, etapa 3 (the wire and the client):
 *  1. The phone's replay slows a hero on a barraca exactly as the room does (net/barraca-slow.ts over the frame's
 *     barracas = sim heroSlow over the pieces), so walking through a row never snaps back.
 *  2. hud/tralha picks a barraca like a barricada square (tap, COLETAR, the answer's words).
 *  3. The renderer's rules: the role, the lona from the id, the state from the life, the column; the grid rules (its
 *     2×2 footprint for the ghost's 'ocupado') and the minimap count it as a barricade.
 *  4. The wire: the kit and the structure kind travel by dictionary index; the art is a lite base piece.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CITY_BUILD_CELL,reconcile,simulate,slowAmong,slowStep,RADIUS,type Point} from '../../src/maps/index.ts';
import {BARRACA_HERO_SLOW,BARRACA_LONAS,FREE_PIECE_DEFS,KIT_IDS} from '../../src/rules/index.ts';
import {heroSlow,type PieceState} from '../../src/sim/towers/free-build.ts';
import type {StonewardsState} from '../../src/sim/stonewards/state.ts';
import {barracaRects,barracaSlow} from '../../src/client/net/barraca-slow.ts';
import {TralhaPick,squareAt,isTralhaKind} from '../../src/client/hud/tralha/model.ts';
import {barracaColumn,barracaEstado,barracaLona,structureRole} from '../../src/client/render/stonewards-rules.ts';
import {footprintCells,ghostRefusal,isGridPiece,cellRect} from '../../src/client/render/fortify-rules.ts';
import {BASE_ART} from '../../src/client/art/base-art.ts';
import {BASE_LITE_PIECES} from '../../src/client/render/city/art-plan.ts';
import {DICT} from '../../src/protocol/protocol4.ts';

const cell=CITY_BUILD_CELL;
const piece=(id:string,c:number,r:number):PieceState=>({id,kind:'barraca',cell:{c,r},owner:'mapa',x:(c+1)*cell,y:(r+1)*cell,hp:240,maxHp:240} as PieceState);
const view=(p:PieceState,hp=p.hp)=>({id:p.id,kind:'barraca',x:p.x,y:p.y,hp,maxHp:p.maxHp,c:p.cell.c,r:p.cell.r});

test('the replay slows on a barraca exactly where the room does', ()=>{
  const pieces=[piece('barraca-1',10,10),piece('barraca-2',12,10)];
  const state={defenses:{pieces}} as unknown as StonewardsState;
  const slow=barracaSlow(pieces.map(p=>view(p)))!;
  assert.ok(slow,'barracas in the frame: a slow');
  for(let x=8*cell;x<=15*cell;x+=cell/7)for(let y=8*cell;y<=13*cell;y+=cell/7){
    assert.equal(slow({x,y}),heroSlow(state,{x,y}),`at ${x.toFixed(2)},${y.toFixed(2)}`);
  }
  assert.equal(slow({x:11*cell,y:11*cell}),BARRACA_HERO_SLOW);
  assert.equal(slow({x:10*cell-RADIUS-.01,y:11*cell}),1,'just off the edge: free');
  assert.equal(barracaSlow([]),undefined,'none: no slow');
  assert.equal(barracaSlow([{...view(pieces[0]),hp:0}]),undefined,'a fallen one slows nobody');
  assert.deepEqual(barracaRects([view(pieces[0]),{id:'b',kind:'barricada',x:0,y:0,hp:200,c:0,r:0}]),[{x:10*cell,y:10*cell,w:2*cell,h:2*cell}]);
});

test('simulate/reconcile apply the slow after the cap, from where each step starts (the room\'s order)', ()=>{
  const pieces=[piece('barraca-1',10,10)],slow=barracaSlow(pieces.map(p=>view(p)))!;
  const state={defenses:{pieces}} as unknown as StonewardsState;
  const start:Point={x:8*cell,y:11*cell},inputs=Array.from({length:30},(_,i)=>({seq:i+1,x:1,y:0}));
  const replay=reconcile(start,inputs,undefined,{tick:100,slow});
  let p={...start};
  inputs.forEach((input,k)=>{const free=simulate(p,input,undefined,101+k);p=slowStep(p,free,heroSlow(state,p));});
  assert.deepEqual(replay,p);
  const plain=reconcile(start,inputs,undefined,{tick:100});
  assert.ok(plain.x>replay.x+.1,`through the barraca the hero walks less (${plain.x.toFixed(2)} vs ${replay.x.toFixed(2)})`);
  assert.equal(slowAmong([],{x:0,y:0},.5,RADIUS),1);
});

test('hud/tralha: a barraca is picked like a barricada square, and its coleta says so', ()=>{
  const b=view(piece('barraca-1',4,4)),list=[b];
  assert.equal(isTralhaKind('barraca'),true);
  assert.equal(squareAt(list,{x:5.5*cell,y:5.5*cell},cell)?.id,'barraca-1','its 2×2 cells');
  assert.equal(squareAt(list,{x:6.1*cell,y:5*cell},cell),undefined);
  const pick=new TralhaPick();
  assert.equal(pick.tap(list,{x:4.5*cell,y:4.5*cell},cell),true);
  let req=0;
  assert.equal(pick.act('coletar',{tralha:()=>++req},10),'sent');
  assert.equal(pick.answer({t:'coleta',req,ok:true,done:true} as never),'Barraca na mão! Monta onde quiser');
});

test('renderer rules: role, lona by id, state by life, column by view', ()=>{
  assert.equal(structureRole('barraca'),'barraca');
  const lonas=new Set(Array.from({length:40},(_,i)=>barracaLona(`barraca-${i}`,BARRACA_LONAS)));
  assert.deepEqual([...lonas].sort(),['lona-1','lona-2','lona-3'],'every lona shows up along a row');
  assert.equal(barracaLona('barraca-7',BARRACA_LONAS),barracaLona('barraca-7',BARRACA_LONAS),'same id, same stall');
  assert.equal(barracaEstado(240,240),'inteira');
  assert.equal(barracaEstado(150,240),'danificada','under 66%: torn');
  assert.equal(barracaEstado(10,240),'danificada');
  assert.equal(barracaEstado(0,240),'quebrada');
  for(const id of ['barraca-1','barraca-2']){
    const c0=barracaColumn(0,id);
    assert.ok(c0===0||c0===1);
    assert.equal(barracaColumn(1,id),1-c0,'a camera quarter turn mirrors it');
    assert.equal(barracaColumn(2,id),c0);
  }
});

test('grid rules: the ghost sees a barraca\'s 2×2 as occupied', ()=>{
  assert.equal(isGridPiece('barraca'),true);
  assert.deepEqual(footprintCells('barraca'),[...FREE_PIECE_DEFS.barraca.footprint]);
  const structures=[view(piece('barraca-1',4,4))];
  assert.equal(ghostRefusal(cellRect(5,5,1,1,cell),{cell,structures}),'ocupado');
  assert.equal(ghostRefusal(cellRect(6,6,1,1,cell),{cell,structures}),undefined);
});

test('wire and art: the kit and the kind by dictionary, the sheet a lite base piece with its lonas', ()=>{
  assert.ok(DICT.includes('barraca')&&DICT.includes('kit:barraca'));
  assert.ok(KIT_IDS.includes('kit:barraca'));
  assert.equal(BASE_ART.barraca,'barraca');
  assert.ok(BASE_LITE_PIECES.includes('barraca'));
  const base=JSON.parse(readFileSync(fileURLToPath(new URL('../../public/art/city/base/manifest.json',import.meta.url)),'utf8'));
  const sheet=base.pieces.barraca.files.sheet;
  for(let n=1;n<=BARRACA_LONAS;n++)for(const e of ['inteira','danificada','quebrada'])assert.ok(sheet.rows.includes(`lona-${n}:${e}`),`lona-${n}:${e}`);
  assert.deepEqual(sheet.liteCell,sheet.cell,'the lite copy keeps the cell');
});
