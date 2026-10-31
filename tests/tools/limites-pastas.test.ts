// test-changed: imports-only (its path strings are fixtures, not dependencies)
// NEW-20261030-ORQ-trava-pastas-no-ci: the rules of tools/limites-pastas.mjs on planted trees. The check of the real
// src/ runs ONLY in .github/workflows/limites-pastas.yml, never here.
import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error -- a plain .mjs tool, no types
import {itensPorPasta,problemas,snapshot,LIMITE} from '../../tools/limites-pastas.mjs';

const arquivos=(pasta:string,n:number)=>Array.from({length:n},(_,i)=>`${pasta}/f${i}.ts`);

test('itensPorPasta: direct files and subfolders, each counted once',()=>{
  const c=itensPorPasta(['src/a.ts','src/x/b.ts','src/x/y/c.ts','src/x/y/d.ts','src/z/e.ts']);
  assert.deepEqual([...c],[['src',3],['src/x',2],['src/x/y',2],['src/z',1]]);
});

test('a planted folder with 7 items is red; 6 is green',()=>{
  const base={limite:LIMITE,pastas:{}};
  assert.equal(LIMITE,6);
  assert.deepEqual(problemas(itensPorPasta(arquivos('src/ok',6)),base),[]);
  const out=problemas(itensPorPasta(['src/a.ts',...arquivos('src/cheia',5),'src/cheia/sub/x.ts','src/cheia/sub2/y.ts']),base);
  assert.equal(out.length,1);
  assert.match(out[0],/^src\/cheia: 7 itens \(> 6\)/);
});

test('ratchet: a base folder cannot grow, may shrink above 6, and leaves the base at ≤ 6 or when gone',()=>{
  const base={limite:LIMITE,pastas:{'src/hud':10,'src/velha':8}};
  assert.deepEqual(problemas(itensPorPasta([...arquivos('src/hud',10),...arquivos('src/velha',8)]),base),[]);
  assert.deepEqual(problemas(itensPorPasta([...arquivos('src/hud',9),...arquivos('src/velha',8)]),base),[]);
  const cresceu=problemas(itensPorPasta([...arquivos('src/hud',11),...arquivos('src/velha',8)]),base);
  assert.equal(cresceu.length,1);assert.match(cresceu[0],/src\/hud: cresceu de 10 para 11/);
  const enxuta=problemas(itensPorPasta([...arquivos('src/hud',6),...arquivos('src/velha',8)]),base);
  assert.equal(enxuta.length,1);assert.match(enxuta[0],/src\/hud: agora tem 6 itens .*Tire a entrada/);
  const sumiu=problemas(itensPorPasta(arquivos('src/hud',10)),base);
  assert.equal(sumiu.length,1);assert.match(sumiu[0],/src\/velha: não existe mais/);
});

test('snapshot: only the folders above 6, so the tree it was taken from is green',()=>{
  const c=itensPorPasta([...arquivos('src/grande',9),...arquivos('src/pequena',6)]);
  const base=snapshot(c);
  assert.deepEqual(base,{limite:6,pastas:{'src/grande':9}});
  assert.deepEqual(problemas(c,base),[]);
});
