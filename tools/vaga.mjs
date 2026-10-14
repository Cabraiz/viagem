// Vagas do PC (tools/foto.mjs; ESCALA.md): `<locks>/<prefixo>-N` criada com mkdir (atômico) é de quem a criou.
// - O dono grava `owner.json` {label, pid, at, beat} e renova `beat` a cada HEARTBEAT_MS enquanto segura a vaga.
// - Uma vaga só é tomada de volta quando o chamador pede (`staleMs`, as vagas de página do modo foto) e o dono parou de
//   bater há mais que isso (ou nunca gravou: o mtime da pasta). A tomada é atômica: a pasta velha é RENOMEADA para um nome
//   único antes de apagar, então dois que esperam nunca ficam com a mesma vaga.
// - As vagas `browser-N` (a fila e os roteiros antigos não batem) nunca são tomadas: sem `staleMs`, só se espera.
import {mkdirSync,readFileSync,renameSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const HEARTBEAT_MS=5000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/** When the slot's owner last showed life (ms epoch): its heartbeat, else the folder's mtime. */
export function lastBeat(dir){
  try{const o=JSON.parse(readFileSync(join(dir,'owner.json'),'utf8'));if(Number.isFinite(o.beat))return o.beat;}catch{}
  try{return statSync(dir).mtimeMs;}catch{return Date.now();}
}

/**
 * Waits for a free slot `<locks>/<prefix>-1..count` and holds it; resolves to release(). Options: staleMs (take back a
 * slot whose owner stopped beating this long ago; omit to never take one), heartbeatMs, pollMs, maxWaitMs (reject).
 */
export async function claimSlot({locks,prefix,count,label,staleMs,heartbeatMs=HEARTBEAT_MS,pollMs=250,maxWaitMs=Infinity}){
  if(!(Number.isInteger(count)&&count>=1))throw new RangeError(`vagas: count must be a positive integer, got ${count}`);
  mkdirSync(locks,{recursive:true});
  const start=Date.now();
  for(;;){
    for(let i=1;i<=count;i++){
      const dir=join(locks,`${prefix}-${i}`);
      try{mkdirSync(dir);}
      catch{
        if(staleMs!==undefined&&Date.now()-lastBeat(dir)>staleMs){
          // Take it back atomically: only the one whose rename succeeds removes it; the others see it gone or new.
          try{const old=`${dir}.velha-${process.pid}-${Date.now()}`;renameSync(dir,old);rmSync(old,{recursive:true,force:true});}catch{}
        }
        continue;
      }
      const write=()=>{try{writeFileSync(join(dir,'owner.json'),JSON.stringify({label,pid:process.pid,at:new Date(start).toISOString(),beat:Date.now()}));}catch{}};
      write();
      const timer=setInterval(write,heartbeatMs);timer.unref?.();
      let released=false;
      return ()=>{
        if(released)return;released=true;clearInterval(timer);
        // Only our own slot: a slot taken back from us (we stalled) now belongs to someone else.
        try{const o=JSON.parse(readFileSync(join(dir,'owner.json'),'utf8'));if(o.pid!==process.pid)return;}catch{}
        rmSync(dir,{recursive:true,force:true});
      };
    }
    if(Date.now()-start>maxWaitMs)throw new Error(`vagas ${prefix}: nenhuma livre em ${Math.round(maxWaitMs/1000)} s`);
    await sleep(pollMs);
  }
}
