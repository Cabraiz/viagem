/**
 * GIF and prints on GitHub Actions (NEW-20261025-ORQ-cicd-gif-prints): the pure parts of the recorder
 * (scripts/gravar-partida.mjs: options, roteiros, keys, GIF delays, the sheet's frames, the summary) and of the PC's
 * tool (tools/gif-ci.mjs: arguments, the dispatch body, finding a request's run, the board's line), and the workflow's
 * safety (read-only, separate from prints.yml). Nothing here opens a browser or touches the network or git.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-expect-error plain ESM script without types
import * as gravar from '../../scripts/gravar-partida.mjs';
// @ts-expect-error plain ESM tool without types
import * as gif from '../../tools/gif-ci.mjs';

test('gravar: options and their defaults',()=>{
  const o=gravar.parseOpts(['out']);
  assert.equal(o.out,'out');
  assert.deepEqual([o.roteiros,o.telas,o.segundos,o.fps,o.modo,o.gif,o.zeroErros,o.dicas,o.escolher],[['parado'],['celular'],20,5,'normal',true,false,false,true]);
  const all=gravar.parseOpts(['x','--roteiro','todos','--tela','ambas','--segundos','30','--sem-gif','--url','https://viagem.cyou/','--build','79854879cde4']);
  assert.deepEqual(all.roteiros,['parado','andando','uno']);
  assert.deepEqual(all.telas,['celular','pc']);
  assert.equal(all.url,'https://viagem.cyou');
  assert.equal(all.gif,false);
  assert.throws(()=>gravar.parseOpts(['x','--roteiro','voar']),/roteiro desconhecido/);
  assert.throws(()=>gravar.parseOpts(['x','--segundos','500']));
  assert.throws(()=>gravar.parseOpts(['x','--build','main']));
  assert.throws(()=>gravar.parseOpts(['x','--url','viagem.cyou']));
  assert.throws(()=>gravar.parseOpts(['x','--roteiro']),/sem valor/);
});

test('gravar: the phone is 390x844 at 3x with touch, the PC 1335x620',()=>{
  assert.deepEqual([gravar.TELAS.celular.viewport,gravar.TELAS.celular.deviceScaleFactor,gravar.TELAS.celular.hasTouch],[{width:390,height:844},3,true]);
  assert.deepEqual([gravar.TELAS.pc.viewport,gravar.TELAS.pc.deviceScaleFactor,gravar.TELAS.pc.hasTouch],[{width:1335,height:620},1,false]);
});

test('gravar: every roteiro fills its seconds exactly',()=>{
  for(const [name,make] of Object.entries(gravar.ROTEIROS) as [string,(s:number)=>{dir?:{x:number;y:number};ms:number}[]][]){
    for(const s of [3,20,37]){
      const steps=make(s),total=steps.reduce((a,b)=>a+b.ms,0);
      if(name==='andando')assert.ok(Math.abs(total-s*1000)<=8,`${name} ${s}s: ${total}`);
      else assert.equal(total,s*1000,`${name} ${s}s`);
    }
  }
  const lap=gravar.ROTEIROS.andando(16);
  assert.equal(new Set(lap.map((st:{dir:{x:number;y:number}})=>`${st.dir.x},${st.dir.y}`)).size,8,'the eight directions');
  assert.ok(gravar.ROTEIROS.parado(10).every((st:{dir?:unknown})=>!st.dir));
  // uno: every step out comes back (the hero stays beside the Uno where the team spawns).
  const sum=gravar.ROTEIROS.uno(5.6).reduce((a:{x:number;y:number},st:{dir?:{x:number;y:number};ms:number})=>st.dir?{x:a.x+st.dir.x*st.ms,y:a.y+st.dir.y*st.ms}:a,{x:0,y:0});
  assert.deepEqual(sum,{x:0,y:0});
});

test('gravar: keys of a direction are desktop-input.ts MOVE_KEYS',()=>{
  assert.deepEqual(gravar.keysOf(undefined),[]);
  assert.deepEqual(gravar.keysOf({x:0,y:-1}),['KeyW']);
  assert.deepEqual(gravar.keysOf({x:1,y:1}),['KeyS','KeyD']);
  assert.deepEqual(gravar.keysOf({x:-1,y:0}),['KeyA']);
  assert.deepEqual(gravar.keysOf({x:0.95,y:-0.1}),['KeyD'],'snapped: a small part is no key');
  assert.deepEqual(gravar.keysOf({x:-3,y:-2.5}),['KeyW','KeyA']);
  assert.deepEqual(gravar.toward({x:0,y:0},{x:3,y:4}),{x:0.6,y:0.8});
  assert.equal(gravar.toward({x:5,y:5},{x:5,y:5}),undefined);
});

test('gravar: GIF delays follow the capture times, clamped; the sheet spreads its frames',()=>{
  assert.deepEqual(gravar.gifDelays([]),[]);
  assert.deepEqual(gravar.gifDelays([5]),[200]);
  assert.deepEqual(gravar.gifDelays([0,200,410,2000,2005]),[200,210,1590,20,210]);
  assert.deepEqual(gravar.gifDelays([0,9000]),[5000,5000]);
  assert.deepEqual(gravar.pickFrames([0,16,33,150,210,260,420].map(t=>({t})),5).map((f:{t:number})=>f.t),[0,210,420],'5 frames/s at most');
  assert.deepEqual(gravar.sheetFrames(5),[0,1,2,3,4]);
  assert.deepEqual(gravar.sheetFrames(100),[0,14,28,42,57,71,85,99]);
});

test('gravar: build ids of one commit',()=>{
  assert.ok(gravar.sameBuild('79854879cde4','79854879cde4cafe'));
  assert.ok(gravar.sameBuild('79854879cde4cafe','79854879cde4'));
  assert.ok(!gravar.sameBuild('','79854879'));
  assert.ok(!gravar.sameBuild('12345678','79854879'));
});

test('gravar: the summary has at most 10 lines and says what failed',()=>{
  const ok={roteiro:'andando',tela:'celular',modo:'normal',erros:[],quadros:50,duracaoMs:10000,entrouMs:9200,gifKB:4000,escolhas:1,fpsJogo:30,falha:''};
  assert.equal(gravar.resumoLinhas([ok])[0],'✅ andando celular: entrou em 9 s · 50 quadros (5.0/s) · jogo a 30 fps · gif 4000 KB · 1 carta(s) escolhida(s) · 0 erros');
  assert.match(gravar.resumoLinhas([{...ok,erros:['console: x']}])[0],/^⚠️ .*1 erro\(s\): console: x/);
  assert.equal(gravar.resumoLinhas([{...ok,modo:'chaveiro',falha:'não entrou em 180 s'}])[0],'❌ andando celular chaveiro: não entrou em 180 s');
  assert.equal(gravar.resumoLinhas([ok],{origem:'https://viagem.cyou'})[0],'Partida solo em https://viagem.cyou');
  assert.equal(gravar.resumoLinhas([{...ok,quadros:0,gifKB:0,escolhas:0,fpsJogo:0}])[0],'✅ andando celular: entrou em 9 s · 0 erros','prints only (--sem-gif)');
  const many=gravar.resumoLinhas(Array.from({length:14},()=>ok));
  assert.equal(many.length,10);
  assert.equal(many[9],'… e mais 5');
});

test('gif-ci: arguments',()=>{
  assert.deepEqual(gif.parseArgs(['vgm/x']),{cmd:'gif',target:'vgm/x',roteiro:'parado',flags:{}});
  assert.deepEqual(gif.parseArgs(['vgm/x','uno','--tela','ambas','--segundos','30']),{cmd:'gif',target:'vgm/x',roteiro:'uno',flags:{tela:'ambas',segundos:'30'}});
  assert.deepEqual(gif.parseArgs(['site','--sha','abc']),{cmd:'site',flags:{sha:'abc'}});
  assert.throws(()=>gif.parseArgs([]),/uso/);
  assert.throws(()=>gif.parseArgs(['vgm/x','voar']),/roteiro/);
  assert.throws(()=>gif.parseArgs(['vgm/x','--tela','tv']),/--tela/);
  assert.throws(()=>gif.parseArgs(['vgm/x','--segundos','2']),/--segundos/);
  assert.throws(()=>gif.parseArgs(['vgm/x','--push']),/desconhecida/);
});

test('gif-ci: the dispatch body and finding the request\'s run',()=>{
  const id=gif.pedidoId(new Date('2026-10-25T14:05:06.789Z'),()=>0.5);
  assert.equal(id,'20261025140506-8000');
  assert.deepEqual(gif.dispatchBody({sha:'a'.repeat(40),roteiro:'andando',pedido:id}),
    {ref:'main',inputs:{ref:'a'.repeat(40),roteiro:'andando',tela:'celular',segundos:'20',modo:'normal',pedido:id}});
  const runs=[{id:1,display_title:'GIF 20261025140506-0001 parado celular x'},{id:2,display_title:`GIF ${id} andando celular ${'a'.repeat(40)}`}];
  assert.equal(gif.runOfPedido(runs,id).id,2);
  assert.equal(gif.runOfPedido(runs,'20261025140506'),undefined,'the whole id, not a prefix');
});

test('gif-ci: the site run and the board line',()=>{
  const runs=[
    {run_number:3,status:'completed',display_title:'Site bbbbbbbbbbbbbbbb'},
    {run_number:5,status:'in_progress',display_title:'Site cccccccccccccccc'},
    {run_number:4,status:'completed',display_title:'Site aaaaaaaaaaaaaaaa'},
    {run_number:9,status:'completed',display_title:'GIF x parado celular y'},
  ];
  assert.equal(gif.siteRun(runs).run_number,4,'the newest finished site run');
  assert.equal(gif.siteRun(runs,'bbbbbbb').run_number,3);
  assert.equal(gif.siteRun(runs,'ccc'),undefined,'not finished yet');
  assert.equal(gif.siteLine({sha12:'aaaaaaaaaaaa',conclusion:'success',resumo:'Partida solo em https://viagem.cyou (build a)\n✅ parado celular: entrou em 9 s\n',url:'U',at:'2026-10-25T14:05:06Z'}),
    '- 2026-10-25 14:05Z `aaaaaaaaaaaa` ok: ✅ parado celular: entrou em 9 s (U)');
  assert.match(gif.siteLine({sha12:'a',conclusion:'failure',resumo:'',url:'U',at:'2026-10-25T14:05:06Z'}),/FALHOU: \(sem resumo\)/);
  assert.equal(gif.safe('vgm/cicd gif'),'vgm-cicd-gif');
});

test('gif.yml: read-only, its own name (not "Prints"), both triggers, the recorder\'s outputs',()=>{
  const yml=readFileSync(new URL('../../.github/workflows/gif.yml',import.meta.url),'utf8');
  assert.match(yml,/^name: GIF$/m);
  assert.doesNotMatch(yml,/^name: Prints$/m,'the board\'s vigia-prints delivers every "Prints" run as a sheet');
  assert.match(yml,/^permissions:\n {2}contents: read$/m);
  assert.doesNotMatch(yml,/write|secrets\./,'no write permission, no secret');
  assert.match(yml,/workflows: \['Publish viagem \(rooms Worker \+ frontend\)'\]/);
  const pages=readFileSync(new URL('../../.github/workflows/pages.yml',import.meta.url),'utf8');
  assert.match(pages,/^name: Publish viagem \(rooms Worker \+ frontend\)$/m,'workflow_run names pages.yml exactly');
  assert.match(yml,/conclusion == 'success'/,'the site print only after a deploy that went through');
  assert.match(yml,/node \.\.\/scripts\/gravar-partida\.mjs \.\.\/gif-out/);
  assert.match(yml,/name: gif-\$\{\{ inputs\.pedido/,'the artifact tools/gif-ci.mjs looks for');
  assert.match(yml,/name: site-\$\{\{ steps\.sha\.outputs\.short \}\}/);
  assert.match(yml,/run-name: .*format\('GIF \{0\}/,'the request id in the run name (runOfPedido)');
});

test('gravar: tremorOf counts the drawn hero stepping back against its walk, and those in contact',()=>{
  const rows:[number,number,number][]=[];
  for(let i=0;i<40;i++)rows.push([i*.05-(i===25?.1:0),0,i>20?0:1]);
  const t=gravar.tremorOf(rows);
  assert.equal(t.recuos,1);assert.equal(t.recuosContato,1);assert.ok(Math.abs(t.maxRecuo-.05)<1e-9,`${t.maxRecuo}`);
  assert.ok(t.quadros>=28&&t.contato>=18);
  // Standing still is not a walk: no frames counted.
  assert.equal(gravar.tremorOf(Array.from({length:30},()=>[1,1,0])).quadros,0);
});
