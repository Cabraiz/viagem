// dist/art-versions.json (NEW-20261013-ORQ-3g-precarga-partida): {"/art/…": "<8 hex>", "/assets/…": "<8 hex>"}, the
// first 8 hex of each file's SHA-256. The service worker (public/sw.js) keeps a cached file while its version matches,
// so a deploy invalidates only the files whose content changed. Used by vite.config.ts at closeBundle.
import {createHash} from 'node:crypto';
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';

export const VERSION_HEX=8;
/** Short content version of a file. */
export const shortHash=content=>createHash('sha256').update(content).digest('hex').slice(0,VERSION_HEX);

const walk=dir=>{
  let out=[];
  let entries;try{entries=readdirSync(dir,{withFileTypes:true});}catch{return out;}
  for(const e of entries){const p=join(dir,e.name);if(e.isDirectory())out=out.concat(walk(p));else if(e.isFile())out.push(p);}
  return out;
};
/** Versions of every file under `<dist>/<folder>` for each folder, keyed by its public path, sorted. */
export function artVersions(dist,folders=['art','assets']){
  const map={};
  for(const folder of folders)for(const file of walk(join(dist,folder))){
    map['/'+relative(dist,file).split(sep).join('/')]=shortHash(readFileSync(file));
  }
  return Object.fromEntries(Object.entries(map).sort(([a],[b])=>a<b?-1:a>b?1:0));
}
/** Writes `<dist>/art-versions.json`; returns the map. */
export function writeArtVersions(dist){
  const map=artVersions(dist);
  writeFileSync(join(dist,'art-versions.json'),JSON.stringify(map));
  return map;
}
/** Vite plugin: after the bundle is written (dist/art copied from public/art, dist/assets emitted). */
export const artVersionsPlugin=()=>{
  let outDir='dist';
  return {
    name:'viagem-art-versions',
    apply:'build',
    configResolved(config){outDir=resolve(config.root,config.build.outDir);},
    closeBundle(){writeArtVersions(outDir);},
  };
};
