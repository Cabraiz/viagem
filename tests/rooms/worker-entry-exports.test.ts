import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// workerd reads every export of the entry module as a handler: an exported string or number stops the Worker from
// starting ("Incorrect type for map entry ... not of type 'function or ExportedHandler'"), lote 20261030-045300.
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
const worker=read('../../multiplayer/worker.ts');
const classes=[...read('../../multiplayer/wrangler.jsonc').matchAll(/"class_name":\s*"(\w+)"/g)].map(m=>m[1]!);

test('wrangler.jsonc binds GameRoom and RoomIndex',()=>{
  assert.deepEqual([...classes].sort(),['GameRoom','RoomIndex']);
});
test('worker.ts exports only default, functions, classes and types',()=>{
  const bad=worker.split('\n').map((line,i)=>({line,n:i+1})).filter(({line})=>/^\s*export\b/.test(line)).filter(({line})=>
    !/^\s*export\s+(default\b|(async\s+)?function\b|(abstract\s+)?class\b|type\b|interface\b)/.test(line)&&!/^\s*export\s*\{/.test(line));
  assert.deepEqual(bad.map(b=>`${b.n}: ${b.line.trim()}`),[]);
});
test('worker.ts re-exports by name only the classes in wrangler.jsonc',()=>{
  const names=[...worker.matchAll(/^\s*export\s*\{([^}]*)\}/gm)].flatMap(m=>m[1]!.split(',').map(s=>s.trim()).filter(Boolean))
    .filter(name=>!name.startsWith('type '));
  for(const name of names)assert.ok(classes.includes(name),`export {${name}} is not a wrangler class`);
});
test('every wrangler class is exported by worker.ts',()=>{
  for(const name of classes)assert.match(worker,new RegExp(`^\\s*export\\s+(class\\s+${name}\\b|\\{[^}]*\\b${name}\\b[^}]*\\})`,'m'),name);
});
