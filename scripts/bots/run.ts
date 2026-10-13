/**
 * VGM-045: six protocol bots play whole runs against a rooms Worker (`wrangler dev`), with the network faults a phone
 * meets, and leave the numbers in artifacts/bots/.
 *
 *   node --experimental-strip-types scripts/bots/run.ts [scenario ...] [--endpoint http://127.0.0.1:8817] [--spawn]
 *     scenarios: base | lag300 | reconnect20 | rematch | smoke | 3g | all (base lag300 reconnect20 rematch)
 *     --repeat N: play the scenario N times (3g: each match its own faults and loss, from the match number)
 *     --spawn: start `wrangler dev` here (MULTIPLAYER_PORT, see scripts/local-worker.mjs) and stop it at the end
 *     --out <dir>: artifacts folder (default artifacts/bots)
 *
 * The endpoint must run with ALLOW_LOCAL (the room's /lab gives the tick samples; the rematch scenario puts the team
 * down with the lab command). Exit code 1 when any scenario failed its checks.
 */
import WebSocket from 'ws';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {Bot} from './bot.ts';
import {Link} from './lab-socket.ts';
import {rates,TickStitcher,freePlan,percentile,mean,type MatchCost} from './metrics.ts';
import {PROTOCOL_VERSION} from '../../src/protocol/protocol4.ts';
import {UPDATE_NEEDED,ROOM_CLOSING_NOTICE} from '../../src/protocol/room.ts';
import {RECIPES} from '../../src/rules/stonewards.ts';

const ORIGIN='http://127.0.0.1:4187';
const CLASSES=['cidadao-comum','cidadao-comum','cidadao-comum','cidadao-comum','cidadao-comum','cidadao-comum'];
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const now=()=>performance.now();

export interface Fault {kind:'drop'|'outage';bot:number;ms?:number;
  /** Seconds after the combat start; with `phase`, the first moment in that round phase from then on. */
  at:number;phase?:'wave'|'prepare';
  /** outage: the app comes back to the foreground at the end (CoopClient's wake-up), instead of waiting for its heartbeat. */
  wake?:boolean}
export interface Scenario {name:string;title:string;rttMs:number;jitterMs:number;faults:Fault[];gate:boolean;
  /** 3g-rede-sem-teleporte: bandwidth each way (kbit/s) and messages losing a segment (%), see lab-socket.ts. */
  kbps?:number;lossPct?:number;
  /** 'try': ask for the rematch after the result (accepted or refused with the closing notice, both checked). */
  rematch:'try'|'play'|'none';
  /** Stop after this many seconds of combat (smoke); otherwise play to the result. */
  combatSeconds?:number;
  /** Put the whole team down after this many seconds of combat (lab command): a quick defeat. */
  downAt?:number;
  maxCombatMinutes:number}

export const SCENARIOS:Record<string,Scenario>={
  base:{name:'base',title:'6 bots, 150 ms, queda e retorno, quedas de rede de 5 s (app e rede), sétimo e versão velha recusados',rttMs:150,jitterMs:20,gate:true,rematch:'try',maxCombatMinutes:24,
    faults:[{kind:'drop',bot:2,at:75,phase:'wave'},{kind:'outage',bot:3,ms:5000,at:200,phase:'wave',wake:true},{kind:'outage',bot:4,ms:5000,at:330,phase:'prepare'}]},
  lag300:{name:'lag300',title:'6 bots, 300 ms de atraso (ida e volta) com 30 ms de variação, uma queda e retorno',rttMs:300,jitterMs:30,gate:false,rematch:'try',maxCombatMinutes:24,
    faults:[{kind:'drop',bot:1,at:240,phase:'wave'}]},
  reconnect20:{name:'reconnect20',title:'6 bots, 150 ms, sem rede por 20 s no meio de uma onda e no meio de um intervalo',rttMs:150,jitterMs:20,gate:false,rematch:'try',maxCombatMinutes:24,
    faults:[{kind:'outage',bot:2,ms:20000,at:240,phase:'wave'},{kind:'outage',bot:5,ms:20000,at:300,phase:'prepare'}]},
  rematch:{name:'rematch',title:'revanche: derrota rápida (time todo no chão pelo laboratório), revanche e a run nova começando zerada',rttMs:150,jitterMs:20,gate:false,rematch:'play',downAt:40,maxCombatMinutes:4,faults:[]},
  '3g':threeG(0),
  smoke:{name:'smoke',title:'fumaça: 6 bots, 150 ms, 40 s de combate e uma queda e retorno',rttMs:150,jitterMs:20,gate:true,rematch:'none',combatSeconds:40,maxCombatMinutes:2,
    faults:[{kind:'drop',bot:1,at:15}]},
};

/** Deterministic small PRNG (same faults for the same match number). */
function mulberry(seed:number){return ()=>{seed=(seed+0x6d2b79f5)|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
/**
 * 3g-rede-sem-teleporte, "3G ruim": 250 kbps, 800 ms round trip (±150), 2-5 % of messages losing a segment, and forced
 * drops: three phones lose the network for 3-10 s and one more has its connection reset, at times drawn from the match
 * number. 90 s of combat per match (the faults all land and heal inside it).
 */
export function threeG(match:number):Scenario{
  const rng=mulberry(match+1),faults:Fault[]=[];
  for(let bot=0;bot<6;bot++)if(bot%2===match%2)faults.push({kind:'outage',bot,ms:3000+Math.round(rng()*7000),at:8+Math.round(rng()*50)});
  faults.push({kind:'drop',bot:(match%2===0?1:0)+2*(match%3),at:15+Math.round(rng()*45)});
  const lossPct=Math.round((2+rng()*3)*10)/10;
  return {name:'3g',title:`3G ruim, partida ${match+1}: 250 kbps, 800 ms ±150, ${lossPct}% de perda, 3 sem rede por 3-10 s e 1 queda`,
    rttMs:800,jitterMs:150,kbps:250,lossPct,gate:false,rematch:'none',combatSeconds:90,maxCombatMinutes:3,faults};
}

interface Check {name:string;ok:boolean;detail?:string}
async function knock(endpoint:string,code:string,protocol:number,name:string):Promise<{message?:string;close?:number}>{
  const url=new URL(`/room/${code}`,endpoint);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  const ws=new WebSocket(url,{origin:ORIGIN});
  return new Promise(resolve=>{
    let message:string|undefined;
    const timer=setTimeout(()=>{ws.terminate();resolve({message});},8000);
    ws.on('open',()=>ws.send(JSON.stringify({t:'join',protocol,name,classId:'cidadao-comum'})));
    ws.on('message',(d,binary)=>{if(!binary){const m=JSON.parse(String(d));if(m.t==='error')message=m.message;}});
    ws.on('close',code=>{clearTimeout(timer);resolve({message,close:code});});
    ws.on('error',()=>{});
  });
}
async function until(predicate:()=>boolean,label:string,timeoutMs:number,every=100){
  const start=now();
  while(!predicate()){if(now()-start>timeoutMs)throw new Error(`Timeout: ${label}`);await sleep(every);}
}

export async function runScenario(endpoint:string,scenario:Scenario,log:(line:string)=>void){
  const checks:Check[]=[];
  const check=(name:string,ok:boolean,detail?:string)=>{checks.push({name,ok,...(detail?{detail}:{})});log(`${ok?'ok ':'FALHOU'} ${name}${detail?` (${detail})`:''}`);};
  const health=await (await fetch(`${endpoint}/health`)).json() as {protocol:number};
  check(`/health no protocolo ${PROTOCOL_VERSION}`,health.protocol===PROTOCOL_VERSION,`servidor ${health.protocol}`);
  const created=now();
  const res=await fetch(`${endpoint}/rooms`,{method:'POST',headers:{Origin:ORIGIN}});
  assert.equal(res.status,201,'room created');
  const {code}=await res.json() as {code:string};
  log(`sala ${code} (${scenario.name})`);
  const bots:Bot[]=[];
  const labPolls:any[]=[];const ticks=new TickStitcher();
  let labTimer:ReturnType<typeof setInterval>|undefined,labClosed=false;
  // Last poll right at the end of the combat, so the result screen's idle ticks stay out of the tick numbers.
  const closeLab=async()=>{
    if(labClosed)return;labClosed=true;clearInterval(labTimer);
    const last=await lab();if(last){ticks.add(last.ticks,last.tickSamples??[]);labPolls.push({t:Math.round((now()-combatStart)/1000),...strip(last)});}
  };
  const lab=async()=>{try{const r=await fetch(`${endpoint}/lab/${code}`,{headers:{Origin:ORIGIN}});if(!r.ok)return undefined;return await r.json() as any;}catch{return undefined;}};
  const faults:{fault:Fault;startedAt?:number;backAt?:number;sameId?:boolean;offlineMs?:number;done?:boolean}[]=scenario.faults.map(fault=>({fault}));
  let combatStart=0,combatEnd=0,leftAt=0,connectedAtEnd:boolean[]=[];
  const result:any={};
  try{
    for(let i=0;i<6;i++){
      const link=new Link(ORIGIN,{rttMs:scenario.rttMs,jitterMs:scenario.jitterMs,kbps:scenario.kbps,lossPct:scenario.lossPct});
      const bot=new Bot({endpoint,code,name:`Bot ${i+1}`,classId:CLASSES[i],index:i,link,log});
      bots.push(bot);await bot.join();
    }
    await until(()=>bots.every(b=>b.client.players.size===6),'six players in every frame',scenario.kbps?45000:15000);
    check('seis bots na mesma sala, seis jogadores em cada quadro',true);
    const world=bots[0].client.terrain.signature;
    check('mesmo mundo (assinatura do terreno) nos seis',bots.every(b=>b.client.terrain.signature===world),world);
    if(scenario.gate){
      const seventh=await knock(endpoint,code,PROTOCOL_VERSION,'Sétimo');
      check('sétimo jogador recusado com mensagem e 4003',/cheia/i.test(seventh.message??'')&&seventh.close===4003,`${seventh.message} / ${seventh.close}`);
      const old=await knock(endpoint,code,PROTOCOL_VERSION-1,'Versão velha');
      check(`aba no protocolo ${PROTOCOL_VERSION-1} recusada com o texto de atualizar`,old.message===UPDATE_NEEDED&&old.close===4003,`${old.message} / ${old.close}`);
      check('a sala segue com seis depois das recusas',bots.every(b=>b.client.players.size===6));
    }
    for(const b of bots)b.wantReady=true;
    await until(()=>bots.every(b=>b.run?.phase==='combat'),'combat start',scenario.kbps?60000:30000,50);
    combatStart=now();for(const b of bots)b.wantReady=false;
    const startTick=bots[0].client.feed.peek().tick;
    check('seis prontos, contagem e combate juntos',true);
    const first=await lab();if(first){ticks.add(first.ticks,first.tickSamples??[]);labPolls.push({t:0,...strip(first)});}
    labTimer=setInterval(async()=>{
      const l=await lab();if(!l)return;
      ticks.add(l.ticks,l.tickSamples??[]);labPolls.push({t:Math.round((now()-combatStart)/1000),...strip(l)});
      const v=bots[0].client.feed.peek(),wall=v.structures.find(s=>s.kind==='muralha');
      log(`round ${v.round?.index} ${v.round?.phase}, ${l.enemies} bichos, de pé ${v.players.filter(p=>!p.downed&&!p.eliminated).length}/6, nível ${v.team.level}, muralha ${Math.round(wall?.hp??0)}/${wall?.maxHp}, tick p95 ${l.tickP95} ms`);
    },30000);
    const phase=()=>bots[0].client.feed.peek().round?.phase;
    const seconds=()=>(now()-combatStart)/1000;
    let downSent=false;
    while(true){
      const run=bots.find(b=>b.client.connected)?.run;
      if(run?.phase==='result'||run?.phase==='lobby')break;
      if(scenario.combatSeconds!==undefined&&seconds()>=scenario.combatSeconds)break;
      // VGM-047's honest end: the Durable Object restarted (with wrangler dev, usually a file it watches changed).
      if(bots.some(b=>b.client.roomNotice))throw new Error(`A sala reiniciou no meio da run: ${bots.find(b=>b.client.roomNotice)!.client.roomNotice!.title}`);
      if(seconds()>scenario.maxCombatMinutes*60)throw new Error(`A run passou de ${scenario.maxCombatMinutes} min`);
      if(scenario.downAt!==undefined&&!downSent&&seconds()>=scenario.downAt){
        downSent=true;
        for(const b of bots){const s=(b.client as any).socket;if(s?.readyState===1)s.send(JSON.stringify({t:'lab',down:true}));}
        log('laboratório: time todo no chão');
      }
      for(const f of faults){
        if(f.startedAt!==undefined||seconds()<f.fault.at||(f.fault.phase&&phase()!==f.fault.phase))continue;
        f.startedAt=now();
        const bot=bots[f.fault.bot],id=bot.id,{round}=bot.client.feed.peek(),opened=bot.link.stats.opened;
        bot.event('fault',{...f.fault,round:round?.index,phase:round?.phase});
        // Back = a new connection opened, the welcome came (connected) and the frames show the six again.
        const back=async()=>{
          await until(()=>bot.link.stats.opened>opened&&bot.client.connected&&bot.client.players.size===6,'bot back',60000);
          f.backAt=now();f.sameId=bot.id===id;f.offlineMs=Math.round(f.backAt-f.startedAt!);f.done=true;
          bot.event('back',{offlineMs:f.offlineMs,sameId:f.sameId});
        };
        if(f.fault.kind==='drop'){bot.link.drop();void back().catch(e=>{f.done=true;bot.errors.push(String(e));});}
        else void bot.link.outage(f.fault.ms!).then(()=>{if(f.fault.wake)(bot.client as any).resume();return back();}).catch(e=>{f.done=true;bot.errors.push(String(e));});
      }
      await sleep(100);
    }
    combatEnd=now();
    connectedAtEnd=bots.map(b=>b.client.connected);
    await closeLab();
    result.simTicks=bots[0].client.feed.peek().tick-startTick;
    const smoke=scenario.combatSeconds!==undefined;
    if(!smoke){
      await until(()=>bots.every(b=>!b.client.connected||b.run?.phase==='result'),'result on every bot',15000);
      const outcomes=new Set(bots.filter(b=>b.client.connected).map(b=>b.run?.outcome));
      const view=bots[0].view(),wall=view.structures.find(s=>s.kind==='muralha');
      Object.assign(result,{outcome:bots[0].run?.outcome,round:view.round?.index,roundPhase:view.round?.phase,level:view.team.level,wall:wall?{hp:Math.round(wall.hp),maxHp:wall.maxHp}:undefined,
        camp:view.camp,players:view.players.map(p=>({name:p.name,hp:Math.round(p.hp),maxHp:p.maxHp,downed:!!p.downed,eliminated:!!p.eliminated,stats:p.stats,weapons:p.weapons.map(w=>`${w.id}:${w.level}`)}))});
      check('resultado igual nos seis',outcomes.size===1,[...outcomes].join(','));
      check('run terminou em vitória ou derrota (não em timeout)',result.outcome==='victory'||result.outcome==='defeat',`${result.outcome}, round ${result.round}`);
    }
    for(const f of faults){
      if(f.startedAt===undefined){check(`falha ${f.fault.kind} ${f.fault.ms??''} no bot ${f.fault.bot+1} aconteceu`,false,'a run acabou antes');continue;}
      await until(()=>!!f.done,'fault resolved',60000).catch(()=>{});
      check(`${f.fault.kind==='drop'?'queda e retorno':`sem rede ${f.fault.ms!/1000} s${f.fault.wake?' (app volta e acorda)':''}`} do Bot ${f.fault.bot+1}: volta com o mesmo personagem`,!!f.sameId,`${f.offlineMs} ms fora`);
    }
    // Forge and gathering: the team gathered something and the forger bought at least once (full runs past round 1).
    if(!smoke&&scenario.downAt===undefined){
      const forged=bots.flatMap(b=>b.forged),ok=forged.filter(f=>f.ok);
      const gathered=bots.reduce((a,b)=>a+(b.modes.gather??0),0);
      result.forge={tries:forged.length,ok:ok.length,byRecipe:Object.fromEntries(Object.keys(RECIPES).map(r=>[r,ok.filter(f=>f.recipe===r).length])),refused:forged.filter(f=>!f.ok).map(f=>f.reason)};
      if((result.round??0)>=2){
        check('Stonewards: coleta no intervalo (decisões de coleta) e forja aceita',gathered>0&&ok.length>0,`${gathered} decisões de coleta, ${ok.length}/${forged.length} forjas`);
      }
    }
    // Rematch.
    if(scenario.rematch!=='none'&&!smoke){
      const room=bots[0].run!.round;
      for(const b of bots)b.wantRematch=true;
      const settled=()=>bots.every(b=>!b.client.connected||(b.run?.round??0)>room)||bots.some(b=>b.notices.includes(ROOM_CLOSING_NOTICE));
      await until(settled,'rematch answer',20000).catch(()=>{});
      for(const b of bots)b.wantRematch=false;
      const accepted=bots.every(b=>!b.client.connected||(b.run?.round??0)>room),refused=bots.some(b=>b.notices.includes(ROOM_CLOSING_NOTICE));
      const left=Math.round((30*60_000-(now()-created))/60000);
      result.rematch={accepted,refused,roomMinutesLeft:left};
      if(scenario.rematch==='play'){
        check('revanche aceita: round da sala sobe e todos voltam à espera',accepted&&bots.every(b=>b.run?.phase==='lobby'),`round ${bots[0].run?.round}`);
        for(const b of bots)b.wantReady=true;
        await until(()=>bots.every(b=>b.run?.phase==='combat'),'rematch combat',30000,50);
        for(const b of bots)b.wantReady=false;
        await until(()=>bots.every(b=>b.client.feed.peek().players.length===6),'rematch frame',5000);
        const v=bots[0].client.feed.peek(),wall=v.structures.find(s=>s.kind==='muralha');
        const fresh=v.team.level===1&&v.players.every(p=>!p.downed&&!p.eliminated&&p.hp===p.maxHp)&&!!wall&&wall.hp===wall.maxHp&&(v.camp?.coco??0)===0&&(v.camp?.pedra??0)===0;
        check('revanche começa zerada: nível 1, todos de pé com vida cheia, muralha inteira, saldo zero',fresh,`nível ${v.team.level}, muralha ${wall?.hp}/${wall?.maxHp}`);
        await sleep(20000);
        check('a revanche roda (20 s de combate com seis)',bots.every(b=>b.run?.phase==='combat'&&b.client.connected));
      }else check('revanche respondida: aceita, ou recusada com o aviso de sala fechando (falta tempo para outra run)',accepted||refused,`${accepted?'aceita':refused?'recusada com aviso':'sem resposta'}, ${left} min de sala`);
    }
  }finally{
    await closeLab();
    leftAt=now();
    for(const b of bots)b.stop(true);
    await sleep(500);
  }
  // Errors: anything a person would have read as a failure, a frame that did not decode, an exception in a bot.
  const errors=bots.flatMap(b=>b.errors.map(e=>`${b.name}: ${e}`));
  const resyncs=bots.reduce((a,b)=>a+(b.link.stats.sentByType.resync??0),0);
  const faulted=new Set(scenario.faults.map(f=>f.bot));
  const replaced=bots.filter(b=>b.link.stats.closes.some(c=>c.code===4009)&&!faulted.has(b.index)).map(b=>b.name);
  const strayCloses=bots.flatMap(b=>b.link.stats.closes.filter(c=>c.code!==1000&&!faulted.has(b.index)).map(c=>`${b.name}:${c.code}`));
  check('nenhum erro nos bots (fatal, exceção)',errors.length===0,errors.slice(0,3).join(' | '));
  check('nenhum quadro que não decodificou (resync)',resyncs===0,`${resyncs}`);
  // On a lossy link (3g) a close nobody forced is what is being measured (quedas por partida), not a failure.
  if(scenario.kbps)check('nenhum bot trocado por outra aba (4009)',replaced.length===0,replaced.join(','));
  else check('nenhuma conexão fechada sem falha provocada',strayCloses.length===0&&replaced.length===0,strayCloses.concat(replaced).join(','));
  // 3g: every drop (forced or not), the way back, and the hero's corrections.
  const drops=bots.map(b=>({name:b.name,closes:b.link.stats.closes.filter(c=>c.code!==1000).length,fatal:b.errors.length>0,connected:connectedAtEnd[b.index]??b.client.connected,returned:b.events.filter(e=>e.kind==='back').length}));
  const corrections=bots.map(b=>({name:b.name,...b.corrections}));
  // Metrics over the combat window (seconds since each link's epoch).
  const perClient=bots.map(b=>{
    const from=Math.floor((combatStart-b.link.epoch)/1000),to=Math.floor(((combatEnd||leftAt)-b.link.epoch)/1000);
    const r=rates(b.link.seconds,from,to);
    return {name:b.name,rtt:{median:percentile(b.rtts,.5),p95:percentile(b.rtts,.95)},combat:r,
      sentByType:b.link.stats.sentByType,connections:b.link.stats.connects,failedConnects:b.link.stats.failedConnects,
      closes:b.link.stats.closes,modes:b.modes,casts:b.casts,forged:b.forged.length,events:b.events.filter(e=>e.kind!=='status'&&e.kind!=='choose').slice(-30)};
  });
  const incoming=bots.reduce((a,b)=>a+b.link.stats.sentMessages,0);
  const connections=bots.reduce((a,b)=>a+b.link.stats.opened,0)+(scenario.gate?2:0);
  const lastLab=labPolls.at(-1);
  const activeSeconds=Math.round((leftAt-created)/1000);
  const cost:MatchCost={incomingMessages:incoming,connections,otherRequests:2,activeSeconds,rowsWritten:(lastLab?.rosterWrites??0)+3};
  const combatSeconds=Math.round(((combatEnd||leftAt)-combatStart)/1000);
  const simTicks=result.simTicks??0;
  return {scenario:scenario.name,title:scenario.title,code,rttMs:scenario.rttMs,jitterMs:scenario.jitterMs,
    ok:checks.every(c=>c.ok),checks,result,combatSeconds,activeSeconds,
    tick:{...ticks.summary(),simTicksPerSecond:combatSeconds?Math.round(simTicks/combatSeconds*100)/100:0,encodeP50:lastLab?.encodeP50,encodeP95:lastLab?.encodeP95,note:'workerd local: relógio em ms inteiros (p50 0 = menos de 1 ms); medida de laboratório, 2 núcleos'},
    perClientMean:{upMsgsPerSec:round2(mean(perClient.map(c=>c.combat.upMsgs.mean))),downMsgsPerSec:round2(mean(perClient.map(c=>c.combat.downMsgs.mean))),
      downBytesPerSec:Math.round(mean(perClient.map(c=>c.combat.downBytes.mean))),downBytesPerSecP95:Math.round(mean(perClient.map(c=>c.combat.downBytes.p95))),
      upBytesPerSec:Math.round(mean(perClient.map(c=>c.combat.upBytes.mean)))},
    kbps:scenario.kbps,lossPct:scenario.lossPct,drops,corrections,unforcedCloses:strayCloses,
    faults:faults.map(f=>({...f.fault,offlineMs:f.offlineMs,sameId:f.sameId})),
    sentByType:bots.reduce((all,b)=>{for(const [k,v] of Object.entries(b.link.stats.sentByType))all[k]=(all[k]??0)+v;return all;},{} as Record<string,number>),
    cost,freePlan:freePlan(cost),perClient,lab:labPolls};
}
const round2=(n:number)=>Math.round(n*100)/100;
function strip(l:any){const {tickSamples:_s,connections,...rest}=l;return {...rest,connections:connections?.map((c:any)=>({frames:c.frames,bytes:c.bytes,received:c.received,pending:c.pending}))};}

/** Markdown table of a set of scenario reports (artifacts/bots/summary.md). */
export function summaryMarkdown(reports:any[]){
  const lines=['# VGM-045 · bots: resultados','',`Gerado em ${new Date().toISOString()} (laboratório: contêiner de 2 núcleos, wrangler dev local; não vale como celular real).`,'',
    '| cenário | resultado | round | duração do combate | tick p50/p95/pico (ms) | ticks/s | msgs jogador→sala por s | msgs sala→jogador por s | KB/s por cliente (média/p95) | partidas/dia Free |',
    '|---|---|---|---|---|---|---|---|---|---|'];
  for(const r of reports){
    const t=r.tick,m=r.perClientMean;
    lines.push(`| ${r.scenario} | ${r.ok?'✓':'✗'} ${r.result.outcome??'-'} | ${r.result.round??'-'} | ${Math.floor(r.combatSeconds/60)}:${String(r.combatSeconds%60).padStart(2,'0')} | ${t.p50}/${t.p95}/${t.max} | ${t.simTicksPerSecond} | ${m.upMsgsPerSec} | ${m.downMsgsPerSec} | ${(m.downBytesPerSec/1024).toFixed(1)}/${(m.downBytesPerSecP95/1024).toFixed(1)} | ${r.freePlan.matchesPerDay} (${r.freePlan.limit}) |`);
  }
  const full=reports.filter(r=>r.ok&&r.cost?.activeSeconds>300);
  if(full.length){
    const avg=(f:(r:any)=>number)=>Math.round(mean(full.map(f)));
    const cost:MatchCost={incomingMessages:avg(r=>r.cost.incomingMessages),connections:avg(r=>r.cost.connections),otherRequests:2,activeSeconds:avg(r=>r.cost.activeSeconds),rowsWritten:avg(r=>r.cost.rowsWritten)};
    const plan=freePlan(cost),combat=avg(r=>r.combatSeconds);
    // The input-10hz ceiling: every player walking and changing direction all the time (10 inputs/s) plus the ping.
    const ceiling=freePlan({...cost,incomingMessages:Math.round(cost.incomingMessages+6*combat*(10-mean(full.map(r=>r.perClientMean.upMsgsPerSec))))});
    lines.push('','## Plano Free (D-024)','',
      'Fonte: https://developers.cloudflare.com/durable-objects/platform/pricing/ (Free: 100 000 requisições/dia; cada conexão WebSocket é 1 requisição; 20 mensagens WebSocket recebidas = 1 requisição, as enviadas não contam; 13 000 GB-s/dia de duração, cobrados nos 128 MB do objeto enquanto houver WebSocket aceito; 100 000 linhas SQLite escritas/dia).','',
      `- Partida inteira medida (média de ${full.length} runs completas com 6 bots, da criação da sala à saída): ${cost.incomingMessages} mensagens recebidas, ${cost.connections} conexões, ${cost.activeSeconds} s de sala ativa, ${cost.rowsWritten} linhas escritas.`,
      `- Requisições: ${plan.requests} por partida → ${plan.byRequests} partidas/dia. Duração: ${plan.gbSeconds} GB-s por partida → ${plan.byDuration} partidas/dia. Linhas: ${plan.byRows} partidas/dia.`,
      `- **Estimativa: ${plan.matchesPerDay} partidas inteiras de 6 por dia (limite: ${plan.limit==='duration'?'duração':plan.limit==='requests'?'requisições':'linhas'}).** A duração não depende de quantos jogam: com 2 jogadores as mensagens caem, as partidas/dia quase não sobem.`,
      `- Cota do Worker (Free: 100 000 requisições/dia, separada da do Durable Object, https://developers.cloudflare.com/workers/platform/pricing/): o POST /rooms (mais o preflight OPTIONS no navegador) e cada upgrade de WebSocket passam pelo Worker antes da sala, ~${cost.connections+2} por partida → ~${Math.floor(100_000/(cost.connections+2))} partidas/dia; não é ela que limita.`,
      `- Teto do input-10hz (todo mundo mexendo o dedo o tempo todo, 10 mensagens/s em combate): ${ceiling.requests} requisições por partida → ${ceiling.matchesPerDay} partidas/dia (limite: ${ceiling.limit==='duration'?'duração':'requisições'}).`);
  }
  for(const r of reports){
    lines.push('',`## ${r.scenario}: ${r.title}`,'');
    for(const c of r.checks)lines.push(`- ${c.ok?'✓':'✗'} ${c.name}${c.detail?` (${c.detail})`:''}`);
    if(r.error){lines.push('',`Erro: ${String(r.error).split('\n')[0]}`);continue;}
    const types=Object.entries(r.sentByType??{}).sort((a:any,b:any)=>b[1]-a[1]).map(([k,v])=>`${k} ${v}`).join(', ');
    lines.push('',`Resultado: ${r.result.outcome??'-'} no round ${r.result.round??'-'}, nível ${r.result.level??'-'}, muralha ${r.result.wall?`${r.result.wall.hp}/${r.result.wall.maxHp}`:'-'}; forja ${r.result.forge?`${r.result.forge.ok}/${r.result.forge.tries} aceitas`:'-'}. Tick: p50 ${r.tick.p50} ms, p95 ${r.tick.p95}, p99 ${r.tick.p99}, pico ${r.tick.max} (${r.tick.over50ms} acima de 50 ms em ${r.tick.ticks}), ${r.tick.simTicksPerSecond} ticks/s.`,
      `RTT medido pelo cliente (ping): mediana ${Math.round(mean(r.perClient.map((c:any)=>c.rtt.median)))} ms. Mensagens que a sala recebeu, por tipo: ${types}.`,
      `Custo da partida: ${r.cost.incomingMessages} mensagens recebidas pela sala, ${r.cost.connections} conexões, ${r.cost.activeSeconds} s de sala ativa → ${r.freePlan.requests} requisições, ${r.freePlan.gbSeconds} GB-s.`);
  }
  return lines.join('\n')+'\n';
}

/**
 * 3g-rede-sem-teleporte: one row for all the 3g matches: drops (forced and not), the way back, who never came back,
 * and the hero's corrections (the raw reconcile jump, and per frame as drawn before and after the card).
 */
export function threeGMarkdown(reports:any[]){
  if(!reports.length)return '';
  // Time to come back: since the network was back (an outage's own length is not the client's doing), drops from the cut.
  const faults=reports.flatMap(r=>r.faults??[]),back=faults.filter((f:any)=>f.sameId),times=back.map((f:any)=>Math.max(0,f.offlineMs-(f.kind==='outage'?f.ms:0)) as number);
  const unforced=reports.reduce((a,r)=>a+(r.unforcedCloses?.length??0),0),forced=faults.length;
  const never=reports.reduce((a,r)=>a+(r.drops??[]).filter((d:any)=>d.fatal||!d.connected).length,0)+faults.filter((f:any)=>!f.sameId).length;
  const c=reports.flatMap(r=>r.corrections??[]);
  const sum=(f:(x:any)=>number)=>c.reduce((a,x)=>a+f(x),0),max=(f:(x:any)=>number)=>c.reduce((a,x)=>Math.max(a,f(x)),0);
  const px=(n:number)=>n.toFixed(1);
  const lines=['',`### 3G ruim: ${reports.length} partidas`,'',
    '| quedas por partida (forçadas + espontâneas) | voltaram | tempo para voltar depois que a rede volta (média / p95 / máx) | não voltaram | salto de reconciliação (pico / média) | correção visível antes: pico / média por quadro | depois: pico / média por quadro | escondidas no puf |',
    '|---|---|---|---|---|---|---|---|',
    `| ${((forced+unforced)/reports.length).toFixed(1)} (${forced} + ${unforced}) | ${back.length}/${forced} | ${(mean(times)/1000).toFixed(1)} / ${(percentile(times,.95)/1000).toFixed(1)} / ${(Math.max(0,...times)/1000).toFixed(1)} s | ${never} | ${px(max(x=>x.jumpPeak))} / ${px(sum(x=>x.jumpSum)/Math.max(1,sum(x=>x.reconciles)))} px | ${px(max(x=>x.before.peak))} / ${px(sum(x=>x.before.sum)/Math.max(1,sum(x=>x.before.frames)))} px (${sum(x=>x.before.snaps)} saltos) | ${px(max(x=>x.after.peak))} / ${px(sum(x=>x.after.sum)/Math.max(1,sum(x=>x.after.frames)))} px | ${sum(x=>x.hides)} |`,
    '',`px: tela no zoom 1 do mapa infinito (1 unidade = ${(42*Math.SQRT2).toFixed(1)} px). Reconciliações: ${sum(x=>x.reconciles)}.`];
  return lines.join('\n')+'\n';
}
async function main(){
  const args=process.argv.slice(2);
  const opt=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
  const names=args.filter((a,i)=>!a.startsWith('--')&&!(i>0&&['--endpoint','--out','--repeat'].includes(args[i-1])));
  const repeat=Math.max(1,Number(opt('--repeat'))||1);
  const list=(names.length?names:['smoke']).flatMap(n=>n==='all'?['base','lag300','reconnect20','rematch']:Array.from({length:repeat},()=>n));
  for(const n of list)if(!SCENARIOS[n])throw new Error(`Cenário desconhecido: ${n}`);
  const out=opt('--out')??join('artifacts','bots');mkdirSync(out,{recursive:true});
  let endpoint=opt('--endpoint')??process.env.MULTIPLAYER_ENDPOINT,stop:(()=>Promise<void>)|undefined,logPath:string|undefined;
  if(args.includes('--spawn')||!endpoint){
    const localWorker='../local-worker.mjs';
    const {startLocalWorker}=await import(localWorker) as {startLocalWorker:(o:{logPath:string})=>Promise<{endpoint:string;stop:()=>Promise<void>;logPath:string}>};
    const w=await startLocalWorker({logPath:join(out,'wrangler.log')});endpoint=w.endpoint;stop=w.stop;logPath=w.logPath;
  }
  const reports:any[]=[];
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  try{
    let threeGs=0;
    for(const [index,name] of list.entries()){
      const scenario=name==='3g'?threeG(threeGs++):SCENARIOS[name];
      const started=Date.now();
      const log=(line:string)=>console.log(`[${name} ${Math.round((Date.now()-started)/1000)}s] ${line}`);
      let report:any;
      try{report=await runScenario(endpoint!,scenario,log);}
      catch(e){report={scenario:name,title:scenario.title,ok:false,error:String((e as Error)?.stack??e),checks:[{name:'cenário rodou até o fim',ok:false,detail:String(e)}],result:{},tick:{},perClientMean:{},cost:{},freePlan:{}};log(`ERRO ${e}`);}
      reports.push(report);
      writeFileSync(join(out,`${name}-${index}-${stamp}.json`),JSON.stringify(report,null,1));
      console.log(`[${name}] ${report.ok?'OK':'FALHOU'} ${report.result?.outcome??''} round ${report.result?.round??'-'} · combate ${report.combatSeconds??'-'} s`);
    }
  }finally{await stop?.();}
  if(logPath&&existsSync(logPath)){
    const bad=readFileSync(logPath,'utf8').split('\n').filter(l=>/\b(Uncaught|Error|exception)\b/i.test(l)&&!/Proxy environment/.test(l));
    if(bad.length)console.log(`wrangler.log tem ${bad.length} linha(s) de erro, ex.: ${bad[0]}`);
    for(const [index,r] of reports.entries()){r.serverErrors=bad.slice(0,20);writeFileSync(join(out,`${r.scenario}-${index}-${stamp}.json`),JSON.stringify(r,null,1));}
  }
  const summary=summaryMarkdown(reports)+threeGMarkdown(reports.filter(r=>r.scenario==='3g'));
  writeFileSync(join(out,`summary-${stamp}.md`),summary);
  console.log(summary);
  if(reports.some(r=>!r.ok))process.exitCode=1;
}
if(import.meta.url===`file://${process.argv[1]}`||process.argv[1]?.endsWith('run.ts'))await main();
