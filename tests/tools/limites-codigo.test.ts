/**
 * Limites de código (evidence/estudo-arquivos-400-linhas.md, seção 7).
 *  1. Arquivo de src/ com mais de 400 linhas (como `wc -l`) que não está na base falha.
 *  2. Catraca: arquivo da base não pode crescer; ao chegar a ≤400 ou sumir, a entrada tem de sair da base.
 *  3. Setores (subconjunto do card; a regra completa é tests/arquitetura.test.ts):
 *     sim, rules, maps, protocol e contract não importam client; contract não importa nenhum setor;
 *     rules, maps e protocol não importam sim.
 *  4. Ciclos: no grafo de imports estáticos de runtime (sem `import type`), cada componente fortemente conexo
 *     com mais de um arquivo tem de caber num componente da base. Ciclo novo ou fusão de ciclos antigos falha.
 * O último teste planta cada violação num src/ em memória e exige vermelho.
 * Regravar a base (só o ORQ, num lote, com motivo no commit):
 *   node --experimental-strip-types tests/tools/limites-codigo.test.ts --gravar
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {join,dirname,resolve,relative,sep,posix} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'..','..');
const BASE_FILE=join(here,'limites-codigo.base.json');
export const LIMITE=400;

type Base={limite:number;grandes:Record<string,number>;ciclos:string[][]};
type Tree=Map<string,string>;

const COUNTED=/\.(ts|css|mjs|js|astro)$/;
const CODE=/\.(ts|mjs|js|astro)$/;
const SECTORS=['contract','rules','maps','sim','protocol','client'] as const;
type Sector=typeof SECTORS[number];

export function readSrc():Tree{
  const tree:Tree=new Map();
  const walk=(d:string)=>{for(const f of readdirSync(d)){
    const p=join(d,f);
    if(statSync(p).isDirectory())walk(p);
    else if(COUNTED.test(f))tree.set(relative(root,p).split(sep).join('/'),readFileSync(p,'utf8'));
  }};
  walk(join(root,'src'));
  return tree;
}

export const lines=(text:string)=>{let n=0;for(let i=0;i<text.length;i++)if(text.charCodeAt(i)===10)n++;return n;};

export function sectorOf(file:string):Sector|undefined{
  const top=file.split('/')[1];
  return (SECTORS as readonly string[]).includes(top)?top as Sector:undefined;
}

type Imp={spec:string;runtime:boolean};
/**
 * Static import/export … from (also multi-line), side-effect imports and literal dynamic imports.
 * Lines inside comments (`//`, ` * `) are skipped. Dynamic imports count for sectors, not for cycles
 * (they do not run at load time).
 */
export function importsOf(src:string):Imp[]{
  const out:Imp[]=[];
  const fromRe=/^[ \t]*(import|export)\s+(type\s+)?([^;=()'"`]*?)\s*from\s*['"]([^'"\n]+)['"]/gm;
  for(const m of src.matchAll(fromRe)){
    const names=m[3].trim();
    let typeOnly=!!m[2];
    const braces=/^\{([^}]*)\}$/.exec(names);
    if(!typeOnly&&braces){
      const parts=braces[1].split(',').map(s=>s.trim()).filter(Boolean);
      typeOnly=parts.length>0&&parts.every(p=>p.startsWith('type '));
    }
    out.push({spec:m[4],runtime:!typeOnly});
  }
  for(const m of src.matchAll(/^[ \t]*import\s*['"]([^'"\n]+)['"]/gm))out.push({spec:m[1],runtime:true});
  for(const m of src.matchAll(/^([^\n]*?)\bimport\(\s*['"]([^'"\n]+)['"]/gm)){
    const lead=m[1].trimStart();
    if(lead.startsWith('//')||lead.startsWith('*'))continue;
    out.push({spec:m[2],runtime:false});
  }
  return out;
}

function resolveSpec(from:string,spec:string,tree:Tree):string|undefined{
  if(!spec.startsWith('.'))return undefined;
  const base=posix.normalize(posix.join(posix.dirname(from),spec));
  const tries=[base,base+'.ts',base.replace(/\.js$/,'.ts'),base.replace(/\.mjs$/,'.mts'),base+'/index.ts',base+'.mjs',base+'.js'];
  return tries.find(t=>tree.has(t));
}

/** Strongly connected components with more than one file (Tarjan, iterative). */
export function cycles(graph:Map<string,string[]>):string[][]{
  let idx=0;const index=new Map<string,number>(),low=new Map<string,number>(),on=new Set<string>(),stack:string[]=[];
  const comps:string[][]=[];
  for(const start of graph.keys()){
    if(index.has(start))continue;
    const work:[string,number][]=[[start,0]];
    index.set(start,idx);low.set(start,idx);idx++;stack.push(start);on.add(start);
    while(work.length){
      const top=work[work.length-1];const [v,i]=top;const next=graph.get(v)??[];
      if(i<next.length){
        top[1]++;const w=next[i];
        if(!index.has(w)){index.set(w,idx);low.set(w,idx);idx++;stack.push(w);on.add(w);work.push([w,0]);}
        else if(on.has(w))low.set(v,Math.min(low.get(v)!,index.get(w)!));
        continue;
      }
      work.pop();
      if(work.length){const u=work[work.length-1][0];low.set(u,Math.min(low.get(u)!,low.get(v)!));}
      if(low.get(v)===index.get(v)){
        const comp:string[]=[];let w:string;
        do{w=stack.pop()!;on.delete(w);comp.push(w);}while(w!==v);
        if(comp.length>1)comps.push(comp.sort());
      }
    }
  }
  return comps.sort((a,b)=>a[0]<b[0]?-1:1);
}

export function graphOf(tree:Tree){
  const runtime=new Map<string,string[]>();
  const arrows:{from:string;to:string}[]=[];
  for(const [file,src] of tree){
    if(!CODE.test(file))continue;
    const deps:string[]=[];
    for(const imp of importsOf(src)){
      const to=resolveSpec(file,imp.spec,tree);
      if(!to)continue;
      arrows.push({from:file,to});
      if(imp.runtime&&CODE.test(to))deps.push(to);
    }
    runtime.set(file,deps);
  }
  return {runtime,arrows};
}

export function sectorProblems(arrows:{from:string;to:string}[]):string[]{
  const out:string[]=[];
  for(const {from,to} of arrows){
    const a=sectorOf(from),b=sectorOf(to);
    if(!a||!b||a===b)continue;
    if(a!=='client'&&b==='client')out.push(`${from} (${a}) importa client: ${to}`);
    else if(a==='contract')out.push(`${from} (contract) importa ${b}: ${to}`);
    else if((a==='rules'||a==='maps'||a==='protocol')&&b==='sim')out.push(`${from} (${a}) importa sim: ${to}`);
  }
  return out;
}

export function sizeProblems(tree:Tree,base:Base):string[]{
  const out:string[]=[];
  for(const [file,text] of tree){
    const n=lines(text);
    const max=base.grandes[file];
    if(max===undefined){if(n>base.limite)out.push(`${file}: ${n} linhas (> ${base.limite}). Corte em módulos de até ${base.limite}.`);}
    else if(n>max)out.push(`${file}: cresceu de ${max} para ${n} linhas. Arquivo da base só pode diminuir: ponha o acréscimo num módulo novo.`);
    else if(n<=base.limite)out.push(`${file}: agora tem ${n} linhas (≤ ${base.limite}). Tire a entrada de tests/tools/limites-codigo.base.json.`);
  }
  for(const file of Object.keys(base.grandes))if(!tree.has(file))out.push(`${file}: não existe mais. Tire (ou renomeie) a entrada da base.`);
  return out;
}

export function cycleProblems(found:string[][],base:Base):string[]{
  const out:string[]=[];
  for(const comp of found){
    const ok=base.ciclos.some(old=>{const s=new Set(old);return comp.every(f=>s.has(f));});
    if(!ok)out.push(`ciclo de import novo (${comp.length} arquivos): ${comp.join(' → ')}`);
  }
  return out;
}

export function check(tree:Tree,base:Base){
  const {runtime,arrows}=graphOf(tree);
  return {size:sizeProblems(tree,base),sector:sectorProblems(arrows),cycle:cycleProblems(cycles(runtime),base)};
}

function snapshot(tree:Tree):Base{
  const grandes:Record<string,number>={};
  for(const file of [...tree.keys()].sort()){const n=lines(tree.get(file)!);if(n>LIMITE)grandes[file]=n;}
  return {limite:LIMITE,grandes,ciclos:cycles(graphOf(tree).runtime)};
}

if(process.argv.includes('--gravar')){
  writeFileSync(BASE_FILE,JSON.stringify(snapshot(readSrc()),null,2)+'\n');
  console.log('base regravada:',BASE_FILE);
}

const base:Base=JSON.parse(readFileSync(BASE_FILE,'utf8'));
const tree=readSrc();
const result=check(tree,base);

test('nenhum arquivo de src/ passa de 400 linhas fora da base, e a base só diminui',()=>{
  assert.equal(base.limite,LIMITE);
  assert.deepEqual(result.size,[]);
});

test('setores: puros não importam client, contract não importa ninguém, rules/maps/protocol não importam sim',()=>{
  assert.deepEqual(result.sector,[]);
});

test('nenhum ciclo de import novo',()=>{
  assert.deepEqual(result.cycle,[]);
  const gone=base.ciclos.filter(old=>!cycles(graphOf(tree).runtime).some(c=>c.some(f=>old.includes(f))));
  if(gone.length)console.log(`limites-codigo: ${gone.length} ciclo(s) da base sumiram; enxugue a base com --gravar.`);
});

test('a trava pega o que deve (casos plantados) e não pega o que não deve',()=>{
  const body=(n:number)=>Array.from({length:n},(_,i)=>`export const v${i}=${i};`).join('\n')+'\n';
  const fake:Tree=new Map([
    ['src/sim/a.ts',"import {b} from './b';\nexport const a=b;\n"],
    ['src/sim/b.ts',"export const b=1;\n"],
    ['src/client/c.ts',"import {a} from '../sim/a';\nimport type {b} from '../sim/b';\nexport const c=a;\n"],
    ['src/contract/index.ts',"export const k=1;\n"],
    ['src/rules/r.ts',"import {k} from '../contract';\nexport const r=k;\n"],
    ['src/client/big.ts',body(400)],
    ['src/client/old.ts',body(500)],
  ]);
  const clean:Base={limite:LIMITE,grandes:{'src/client/old.ts':500},ciclos:[]};
  // Limpo: 400 linhas passa; client → sim não é regra deste teste (é do arquitetura.test.ts).
  assert.deepEqual(check(fake,clean),{size:[],sector:[],cycle:[]});

  // 401 linhas fora da base.
  const big=new Map(fake);big.set('src/client/big.ts',body(401));
  assert.match(check(big,clean).size.join('\n'),/big\.ts: 401 linhas/);
  // Arquivo da base que cresce, que encolhe até 400 e que some.
  const grew=new Map(fake);grew.set('src/client/old.ts',body(501));
  assert.match(check(grew,clean).size.join('\n'),/cresceu de 500 para 501/);
  const shrank=new Map(fake);shrank.set('src/client/old.ts',body(400));
  assert.match(check(shrank,clean).size.join('\n'),/Tire a entrada/);
  const gone=new Map(fake);gone.delete('src/client/old.ts');
  assert.match(check(gone,clean).size.join('\n'),/não existe mais/);

  // sim importando client (estático, multi-linha e dinâmico).
  const simClient=new Map(fake);
  simClient.set('src/sim/b.ts',"import {\n  c,\n} from '../client/c';\nexport const b=c;\n");
  assert.match(check(simClient,clean).sector.join('\n'),/src\/sim\/b\.ts \(sim\) importa client/);
  const dyn=new Map(fake);dyn.set('src/sim/b.ts',"export const b=1;\nexport const l=()=>import('../client/c');\n");
  assert.match(check(dyn,clean).sector.join('\n'),/importa client/);
  // contract importando, rules importando sim.
  const contractOut=new Map(fake);contractOut.set('src/contract/index.ts',"import {r} from '../rules/r';\nexport const k=1;\n");
  assert.match(check(contractOut,clean).sector.join('\n'),/\(contract\) importa rules/);
  const rulesSim=new Map(fake);rulesSim.set('src/rules/r.ts',"import {b} from '../sim/b';\nexport const r=b;\n");
  assert.match(check(rulesSim,clean).sector.join('\n'),/\(rules\) importa sim/);
  // Comentário com import não conta.
  const commented=new Map(fake);commented.set('src/sim/b.ts',"// const x=import('../client/c');\n/**\n * import('../client/c')\n */\nexport const b=1;\n");
  assert.deepEqual(check(commented,clean).sector,[]);

  // Ciclo novo, ciclo da base e fusão de ciclos.
  const loop=new Map(fake);loop.set('src/sim/b.ts',"import {a} from './a';\nexport const b=1;\nexport const z=()=>a;\n");
  assert.match(check(loop,clean).cycle.join('\n'),/ciclo de import novo \(2 arquivos\): src\/sim\/a\.ts → src\/sim\/b\.ts/);
  assert.deepEqual(check(loop,{...clean,ciclos:[['src/sim/a.ts','src/sim/b.ts']]}).cycle,[]);
  const typeLoop=new Map(fake);typeLoop.set('src/sim/b.ts',"import type {a} from './a';\nexport const b=1;\n");
  assert.deepEqual(check(typeLoop,clean).cycle,[]);
  const merged=new Map(loop);merged.set('src/rules/r.ts',"import {k} from '../contract';\nexport const r=k;\n");
  merged.set('src/sim/b.ts',"import {a} from './a';\nimport {c} from '../client/c';\nexport const b=1;\nexport const z=()=>[a,c];\n");
  assert.match(check(merged,{...clean,ciclos:[['src/sim/a.ts','src/sim/b.ts']]}).cycle.join('\n'),/3 arquivos/);
});
