/**
 * Waiting-room sandbox (cidade-09): `?sandbox=sala&papel=dono|convidado&players=1..6[&fase=countdown][&mapa=cidade-nevada]
 * [&baixando=0.4][&offline=1][&liberada=1]`. The real waiting room (lobby.ts mountWaitingRoom) with the map selector, over a
 * mock island with the explore shell's thumb controls and gear, so overlaps are visible in portrait and landscape.
 * A fake room answers `setMap` after 300 ms like the real one ({t:'map'}: the map changes and every ready resets).
 * `liberada=1` plays as if CITY_PLAYABLE were on. Fake data only; nothing talks to the server.
 * State for scripts: body[data-sent] (setMap messages, JSON), body[data-map] (the room's map).
 */
import '../coop.css';
import {mountWaitingRoom} from '../lobby.ts';
import {INFINITO_REF,type MapId,type MapRef} from '../../protocol/index.ts';
import type {RunState} from '../../contract/index.ts';

const params=new URLSearchParams(location.search);
const players=Math.max(1,Math.min(6,Number(params.get('players'))||1));
const owner=params.get('papel')!=='convidado';
const NAMES=['Capivara Turbo','Pastel de Feira','Zé do Pix Parcelado','Tia da Festa Junina','Pombo Sem Wi-Fi','Marmita Brabo'];
const CITY:MapRef={id:'cidade-nevada',version:1,hash:'c8acc6580b975beeaa4146330862597daa73cbe77b794c7287044ac97d1e6bb9'};
const refOf=(id:MapId)=>id==='cidade-nevada'?CITY:INFINITO_REF;

const style=document.createElement('style');
style.textContent=`
html,body{margin:0;height:100%;overflow:hidden;background:#8dcecc}
body>:not(.ss-layout){display:none!important}
.ss-layout{position:fixed;inset:0;overflow:hidden;background:radial-gradient(ellipse 46% 30% at 50% 52%,#7cbf6a 0 62%,#e9d79a 63% 70%,#a6e0dc 72%,#8dcecc 100%)}
.ss-mock{position:absolute;border:2px solid #fff8e9aa;background:#55466677;color:#fff9ed;font:700 12px system-ui;display:grid;place-items:center;pointer-events:none}
.ss-gear{top:max(12px,env(safe-area-inset-top));right:max(12px,env(safe-area-inset-right));width:48px;height:48px;border-radius:50%}
.ss-stick{bottom:max(14px,env(safe-area-inset-bottom));left:max(14px,env(safe-area-inset-left));width:112px;height:112px;border-radius:50%}
.ss-attack{bottom:max(24px,env(safe-area-inset-bottom));right:max(24px,env(safe-area-inset-right));width:82px;height:82px;border-radius:50%}
`;
document.head.append(style);

const layout=document.createElement('div');layout.className='ss-layout';
layout.innerHTML='<div class="ss-mock ss-gear">⚙</div><div class="ss-mock ss-stick">joystick</div><div class="ss-mock ss-attack">ataque</div>';
document.body.append(layout);

const ids=Array.from({length:players},(_,i)=>`p${i+1}`);
const self=owner?'p1':ids[Math.min(1,players-1)];
const run:RunState={round:1,phase:params.get('fase')==='countdown'?'countdown':'lobby',elapsed:0,remaining:params.get('fase')==='countdown'?50:0,
  owner:owner||players>1?'p1':'dono-fora',members:ids.map((id,i)=>({id,online:true,ready:i%2===1,spectator:false,...(i>=4?{bot:true as const}:{})}))};
const client={
  code:'C1DADE0909',id:self,run,connected:params.get('offline')!=='1',
  players:new Map(ids.map((id,i)=>[id,{name:NAMES[i]}])) as never,
  map:refOf(params.get('mapa')==='cidade-nevada'?'cidade-nevada':'infinito'),
  mapLoad:params.has('baixando')?{ref:CITY,progress:Number(params.get('baixando'))||0}:undefined as {ref:MapRef;progress:number}|undefined,
  ready(ready:boolean){const me=run.members.find(m=>m.id===self);if(me)me.ready=ready;},
  kick(){},addBot(){},removeBot(){},
  setMap(map:MapId){
    const sent=JSON.parse(document.body.dataset.sent??'[]');sent.push({t:'setMap',map});document.body.dataset.sent=JSON.stringify(sent);
    // The room: 300 ms later the map changes for everyone and the readies reset (bots stay ready).
    setTimeout(()=>{client.map=refOf(map);for(const m of run.members)m.ready=!!m.bot;document.body.dataset.map=map;},300);
    return true;
  },
};
document.body.dataset.map=client.map.id;
mountWaitingRoom(layout,client,{origin:location.origin,...(params.get('liberada')==='1'?{cityPlayable:true}:{})});
