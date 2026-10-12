/**
 * tsconfig.pure.json (NEW-20261012-E7-tsconfig-setores-puros): the pure sectors compile without the DOM lib and
 * without Phaser. Planted files go to a temp folder and are compiled with a config that extends the real one,
 * so the test proves what `npm run check` enforces: browser globals and Phaser fail, the cross-runtime globals pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const tsc=join(root,'node_modules/typescript/bin/tsc');

/** Compiles the given files with the pure config; returns tsc's exit status and output. */
function compile(files:Record<string,string>){
  const dir=mkdtempSync(join(tmpdir(),'pure-'));
  try{
    for(const [name,source] of Object.entries(files))writeFileSync(join(dir,name),source);
    writeFileSync(join(dir,'tsconfig.json'),JSON.stringify({
      extends:join(root,'tsconfig.pure.json'),
      include:[join(root,'types/pure-runtime.d.ts'),...Object.keys(files).map(f=>join(dir,f))],
    }));
    const r=spawnSync(process.execPath,[tsc,'-p',join(dir,'tsconfig.json')],{encoding:'utf8',windowsHide:true});
    return {status:r.status,out:`${r.stdout}${r.stderr}`};
  }finally{rmSync(dir,{recursive:true,force:true});}
}

test('pure sectors: browser globals and Phaser fail the pure config',()=>{
  const planted:Record<string,string>={
    'window.ts':'export const w=()=>window.innerWidth;',
    'document.ts':'export const t=()=>document.title;',
    'element.ts':'export function f(e:HTMLElement){return e.id;}',
    'storage.ts':"export const k=()=>localStorage.getItem('x');",
    'frame.ts':'export const r=()=>requestAnimationFrame(()=>{});',
    'navigator.ts':'export const n=()=>navigator.userAgent;',
    'timer.ts':'export const s=()=>setTimeout(()=>{},1);',
    'console.ts':"export const c=()=>console.log('x');",
    'phaser.ts':"import Phaser from 'phaser';export const g=Phaser.Game;",
    'phaser-named.ts':"import {Scene} from 'phaser';export const s=Scene;",
    'phaser-type.ts':"import type {Scene} from 'phaser';export type S=Scene;",
    'phaser-deep.ts':"import P from 'phaser/src/phaser.js';export const g=P.Game;",
  };
  const {status,out}=compile(planted);
  assert.notEqual(status,0,'the pure config accepted browser globals / Phaser');
  for(const name of Object.keys(planted))assert.match(out,new RegExp(`${name.replace('.','\\.')}\\(\\d+,\\d+\\): error TS`),`plantada e NÃO pega: ${name}\n${out}`);
});

test('pure sectors: the cross-runtime globals compile',()=>{
  const {status,out}=compile({'ok.ts':[
    "export const bytes=new TextEncoder().encode('oi');",
    "export const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);",
    'export const copy=structuredClone({a:[1,2]});',
    'export const seed=crypto.getRandomValues(new Uint32Array(1))[0];',
    "export const hash=()=>crypto.subtle.digest('SHA-256',bytes);",
  ].join('\n')});
  assert.equal(status,0,out);
});
