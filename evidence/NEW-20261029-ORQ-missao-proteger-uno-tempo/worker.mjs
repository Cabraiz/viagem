import {pathToFileURL} from 'node:url';
const {startLocalWorker}=await import(pathToFileURL(process.cwd()+'/scripts/local-worker.mjs').href);
const w=await startLocalWorker({port:8805,persist:'C:/Users/Cabraiz/AppData/Local/wrangler-state-e5',logPath:'C:/Users/Cabraiz/AppData/Local/Temp/e5-worker.log',label:'E5'});
console.log('WORKER',w.endpoint);setInterval(()=>{},1<<30);
