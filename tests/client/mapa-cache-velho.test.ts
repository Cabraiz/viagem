// BUG-20261014-ORQ-mapa-cache-velho: a returning player whose browser cached the previous city ("Não foi possível
// carregar o mapa" in production after the 1.7× city). Its own file: a fresh module, so the real city is downloaded here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadCity,cityAssetUrl} from '../../src/client/net/city-asset-loader.ts';

const MANIFEST=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const TEXT=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');

test('the city URL carries the manifest hash; a stale copy (wrong hash) gets one cache:reload retry and recovers',async()=>{
  assert.equal(cityAssetUrl(MANIFEST.hash),`/maps/cidade-nevada.json?h=${MANIFEST.hash}`);
  const calls:[string,RequestCache|undefined][]=[];
  // The "HTTP cache" answers the plain request with another version; only a reload reaches the site.
  const fetcher=async(url:string,init?:RequestInit)=>{calls.push([url,init?.cache]);return new Response(init?.cache==='reload'?TEXT:TEXT+' ');};
  assert.equal(await loadCity({id:'cidade-nevada',version:MANIFEST.version,hash:MANIFEST.hash},()=>{},fetcher),undefined,'the city loads');
  assert.deepEqual(calls,[[cityAssetUrl(MANIFEST.hash),undefined],[cityAssetUrl(MANIFEST.hash),'reload']],'the stale copy, then one reload, never the bare URL');
});
