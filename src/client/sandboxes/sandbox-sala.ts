/**
 * Waiting-room sandbox (cidade-09): `?sandbox=sala&papel=dono|convidado&players=1..6[&fase=countdown|combate][&mapa=cidade-nevada]
 * [&baixando=0.4][&offline=1][&liberada=1]`. The real waiting room (lobby.ts mountWaitingRoom) with the map selector, over a
 * mock island inside the explore shell's real markup (camera buttons, gear, joystick, skill button, the controls etiqueta)
 * with explore.css/coop.css, so overlaps and the phase's controls (controls-phase.ts) look as in production in portrait
 * and landscape. `fase=combate` shows the round's controls in the same boxes (the waiting window hides, as in the room).
 * A fake room answers `setMap` after 300 ms like the real one ({t:'map'}: the map changes and every ready resets).
 * `liberada=1` plays as if CITY_PLAYABLE were on. Fake data only; nothing talks to the server.
 * State for scripts: body[data-sent] (setMap messages, JSON), body[data-map] (the room's map); the shell carries
 * data-run-phase and data-controls like explore.ts.
 */
import '../explore.css';
import '../coop.css';
import {mountWaitingRoom} from '../lobby.ts';
import {controlsFor,applyControls,STICK_HTML,CONTROLS_HINT_HTML,SKILL_HTML} from '../controls-phase.ts';
import {SkillButton} from '../hud/skill.ts';
import {icon,compass} from '../ui/icon.ts';
import {INFINITO_REF,type MapId,type MapRef} from '../../protocol/index.ts';
import type {RunPhase,RunState} from '../../contract/index.ts';

const params=new URLSearchParams(location.search);
const players=Math.max(1,Math.min(6,Number(params.get('players'))||1));
const owner=params.get('papel')!=='convidado';
const NAMES=['Capivara Turbo','Pastel de Feira','Zé do Pix Parcelado','Tia da Festa Junina','Pombo Sem Wi-Fi','Marmita Brabo'];
const CITY:MapRef={id:'cidade-nevada',version:1,hash:'c8acc6580b975beeaa4146330862597daa73cbe77b794c7287044ac97d1e6bb9'};
const refOf=(id:MapId)=>id==='cidade-nevada'?CITY:INFINITO_REF;

const phase:RunPhase=params.get('fase')==='countdown'?'countdown':params.get('fase')==='combate'?'combat':'lobby';

const style=document.createElement('style');
style.textContent=`
html,body{margin:0;height:100%;overflow:hidden;background:#8dcecc}
body>:not(.ss-layout){display:none!important}
.ss-layout{position:fixed;inset:0;overflow:hidden;background:radial-gradient(ellipse 46% 30% at 50% 52%,#7cbf6a 0 62%,#e9d79a 63% 70%,#a6e0dc 72%,#8dcecc 100%)}
`;
document.head.append(style);

// The explore shell's controls as explore.ts builds them for a room (the settings-only parts left out).
const layout=document.createElement('div');layout.className='ss-layout explore-shell coop-shell';
layout.innerHTML=`<div class="explore-layout">
  <div class="explore-camera" role="group" aria-label="Girar câmera"><button data-turn="-1" aria-label="Girar câmera para a esquerda">${icon('girar',{size:32,className:'ic-espelho'})}</button><span class="explore-view">${compass(0,{size:32})}</span><i class="explore-lock" aria-hidden="true">${icon('cadeado',{size:32})}</i><button data-turn="1" aria-label="Girar câmera para a direita">${icon('girar',{size:32})}</button></div>
  <button class="explore-config" aria-label="Configurações do jogo">${icon('config',{size:32})}</button>
  <footer class="explore-controls"><div class="explore-movement">${STICK_HTML}${CONTROLS_HINT_HTML}</div><div class="explore-actions">${SKILL_HTML}</div></footer>
</div>`;
document.body.append(layout);
const shellLayout=layout.querySelector<HTMLElement>('.explore-layout')!;
new SkillButton(layout.querySelector<HTMLButtonElement>('#coop-attack')!,'cidadao-comum');

const ids=Array.from({length:players},(_,i)=>`p${i+1}`);
const self=owner?'p1':ids[Math.min(1,players-1)];
const run:RunState={round:1,phase,elapsed:0,remaining:phase==='countdown'?50:0,
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
mountWaitingRoom(shellLayout,client,{origin:location.origin,...(params.get('liberada')==='1'?{cityPlayable:true}:{})});
// The phase's thumb controls, as explore.ts sets them each frame (the fake room never changes phase).
const controls=controlsFor({phase:run.phase,offline:!client.connected});
layout.dataset.runPhase=run.phase;applyControls(layout,controls);
layout.querySelector<HTMLButtonElement>('#coop-attack')!.disabled=controls.skill!=='live';
