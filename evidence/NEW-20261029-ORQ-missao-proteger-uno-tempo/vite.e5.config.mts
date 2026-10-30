// Wrapper do vite para o GIF (recipe E6 29/10): cache no C:, só index.html no optimizeDeps, sem vigiar evidence/legado/public/art.
import {defineConfig,mergeConfig} from 'vite';
import base from '../../vite.config.ts';
const root=new URL('../../',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
export default defineConfig(async env=>mergeConfig(typeof base==='function'?await base(env):base,{
  root,cacheDir:'C:/Users/Cabraiz/AppData/Local/vite-e5',
  optimizeDeps:{entries:['index.html']},
  server:{host:'127.0.0.1',port:4270,strictPort:true,watch:{ignored:['**/evidence/**','**/legado/**','**/public/art/**','**/node_modules/**']}},
}));
