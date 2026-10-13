#!/usr/bin/env node
/**
 * NEW-20261013-ORQ-deploy-worker-sem-derrubar · `npm run deploy:rooms`: publishes the rooms Worker only when no room is
 * in a match. A deploy restarts every Durable Object, which sends a running match back to the lobby ("Round N se
 * perdeu"); this waits for /health/rooms to say `running: 0` (polling every 30 s, up to --wait minutes) and then runs
 * `wrangler deploy`.
 *
 *   node scripts/deploy-rooms.mjs [--wait 30] [--force] [--endpoint https://viagem-salas.viagem.workers.dev]
 *     --force: deploy now even with matches on (they go back to the lobby); --wait 0: only look, never wait;
 *     --dry-run: say what it would do and stop before wrangler (tests).
 *   A Worker that does not answer /health/rooms yet (deployed before this card) is deployed without waiting, once.
 */
import {spawnSync} from 'node:child_process';

const args=process.argv.slice(2);
const opt=(name,fallback)=>{const i=args.indexOf(name);return i>=0?args[i+1]:fallback;};
const endpoint=opt('--endpoint','https://viagem-salas.viagem.workers.dev').replace(/\/+$/,'');
const waitMin=Math.max(0,Number(opt('--wait','30'))||0),force=args.includes('--force'),dry=args.includes('--dry-run');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clock=ms=>new Date(ms).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});

async function rooms(){
  try{
    const r=await fetch(`${endpoint}/health/rooms`,{signal:AbortSignal.timeout(10_000),headers:{'Cache-Control':'no-store'}});
    // A Worker from before this card: /health/rooms falls to the origin check (403) or the 404.
    if(r.status===404||r.status===403)return {legacy:true};
    if(!r.ok)return {error:`HTTP ${r.status}`};
    return await r.json();
  }catch(e){return {error:String(e?.message??e)};}
}

const until=Date.now()+waitMin*60_000;
for(;;){
  const s=await rooms();
  if(s.legacy){console.log('O Worker no ar ainda não tem /health/rooms (anterior a este card): publico sem esperar.');break;}
  if(s.error){console.log(`Não consegui ler ${endpoint}/health/rooms (${s.error}).`);if(!force){console.log('Use --force para publicar mesmo assim.');process.exit(2);}break;}
  if(!s.running){console.log(`Nenhuma partida em andamento (${s.rooms} sala(s) abertas no lobby).`);break;}
  const line=`${s.running} partida(s) em andamento, ${s.players} pessoa(s); a última termina no máximo às ${clock(s.endsBy)}.`;
  if(force){console.log(`${line} --force: publicando mesmo assim (voltam para o lobby).`);break;}
  if(Date.now()>=until){console.log(`${line} Esperei ${waitMin} min. Rode de novo mais tarde, ou com --force.`);process.exit(3);}
  console.log(`${line} Esperando… (confiro de novo em 30 s)`);
  await sleep(30_000);
}
if(dry){console.log('dry-run: publicaria agora.');process.exit(0);}
const deploy=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','multiplayer/wrangler.jsonc'],{stdio:'inherit'});
process.exit(deploy.status??1);
