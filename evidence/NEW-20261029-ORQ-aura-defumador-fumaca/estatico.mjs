// Servidor estático mínimo do dist/ (sem vite, sem Worker) para os prints do sandbox: node estatico.mjs <dist> <porta>
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,extname,normalize} from 'node:path';
const [root,port]=process.argv.slice(2);
const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png',
  '.svg':'image/svg+xml','.woff2':'font/woff2','.ogg':'audio/ogg','.mp3':'audio/mpeg','.wasm':'application/wasm','.webmanifest':'application/manifest+json'};
createServer(async(req,res)=>{
  const path=normalize(decodeURIComponent(new URL(req.url,'http://x').pathname)).replace(/^([/\\])+/,'');
  for(const p of [path,join(path,'index.html'),'index.html']){
    try{const body=await readFile(join(root,p));res.writeHead(200,{'content-type':TYPES[extname(p)]??'application/octet-stream'});res.end(body);return;}catch{}
  }
  res.writeHead(404);res.end();
}).listen(Number(port),'127.0.0.1',()=>console.log(`estatico ${root} em ${port} pid ${process.pid}`));
