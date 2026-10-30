// BUG-20261014-ORQ-mapa-cache-velho: the site serves its files with max-age=600, so a returning player's browser can hand
// back a previous version for ten minutes after a deploy. Every fetch of a public file by a literal path must change its
// URL with the content (a ?query: a hash or a buster) or ask the cache to revalidate (cache: no-cache / no-store / reload).
// Phaser's image loads are not fetch() and not checked against a hash (a stale picture is cosmetic, not a refused map).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../..',import.meta.url));
const walk=(dir:string):string[]=>readdirSync(dir).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?walk(p):[p];});
// The dev-only sandboxes are not shipped to players.
const SOURCES=[...walk(join(ROOT,'src')).filter(p=>/\.ts$/.test(p)&&!/[\\/]sandboxes[\\/]/.test(p)),join(ROOT,'public','sw.js')];

/** Each fetch( call with its argument text (up to the matching parenthesis). */
function fetchCalls(text:string){
  const out:{at:number;args:string}[]=[];
  for(const m of text.matchAll(/\bfetch\(/g)){
    let depth=1,i=m.index!+m[0].length;
    for(;i<text.length&&depth;i++){const c=text[i];if(c==='(')depth++;else if(c===')')depth--;}
    out.push({at:m.index!,args:text.slice(m.index!+m[0].length,i-1)});
  }
  return out;
}

test('no fetch of a public file by a bare literal path: a ?version in the URL or a revalidating cache mode',()=>{
  const bad:string[]=[];let literal=0;
  for(const file of SOURCES){
    const text=readFileSync(file,'utf8');
    for(const {at,args} of fetchCalls(text)){
      const m=/^\s*(['"`])(\/[^'"`]*)\1/.exec(args);
      if(!m)continue;// a variable URL: covered where it is built (the city loader below; the art through its manifest)
      literal++;
      if(m[2].includes('?')||/cache\s*:\s*['"](no-cache|no-store|reload)['"]/.test(args))continue;
      bad.push(`${relative(ROOT,file)}:${text.slice(0,at).split('\n').length} fetch(${m[1]}${m[2]}${m[1]}…) has no version and no revalidating cache mode`);
    }
  }
  assert.ok(literal>=1,'the scan finds the literal fetches (multiplayer.json in the lobby)');
  assert.deepEqual(bad,[]);
});

test('the city loader fetches the city by its hash URL, the manifest with no-cache, and the service worker revalidates its downloads',()=>{
  const loader=readFileSync(join(ROOT,'src/client/net/city-asset-loader.ts'),'utf8');
  assert.match(loader,/fetcher\(cityAssetUrl\(hash\)/,'the city by its hash URL');
  assert.match(loader,/fetcher\(CITY_MANIFEST_URL,\{cache:'no-cache'/,'the manifest revalidated');
  assert.doesNotMatch(loader,/fetcher\(CITY_ASSET_URL/,'never the bare city URL');
  assert.match(readFileSync(join(ROOT,'public/sw.js'),'utf8'),/fetch\(request\.url,\{credentials:'same-origin',cache:'no-cache'\}\)/,'the worker refills a changed version from the site, not from the HTTP cache');
});
