import './explore.css';
import type { HeroClass } from '../classes.ts';
import {landmarks,type Point} from './world.ts';
import type { CoopClient } from './net/client.ts';
import './coop.css';

let active=false;
export async function openExploration(hero:HeroClass,name:string,net?:CoopClient){
  if(active)return;
  active=true;
  const returnFocus=document.getElementById('confirm');
  const shell=document.createElement('dialog');shell.className='explore-shell';shell.setAttribute('aria-label','Ilha do Começo');shell.dataset.build='viagem-island-v1';
  shell.innerHTML=`<div class="explore-layout">
    <header class="explore-top"><div class="explore-title"><img alt=""/><div><h2>Ilha do Começo</h2><p>EXPLORAÇÃO SOLO · <span id="explorer-name"></span></p></div></div><button class="explore-exit">← Classes</button></header>
    <section class="explore-stage" aria-label="Mapa isométrico da Ilha do Começo">
      <div class="explore-canvas" role="application" tabindex="0" aria-label="Mapa explorável. Use as setas ou WASD, toque no chão ou arraste o direcional."></div>
      <div class="explore-quest"><small>PRIMEIROS PASSOS</small><strong>Conheça a ilha</strong><span id="explore-progress">0 de 3 lugares descobertos</span></div>
      <div class="explore-map" aria-hidden="true"><svg viewBox="0 0 100 100"><ellipse cx="50" cy="50" rx="39" ry="39" fill="#c8d795"/><path d="M50 68 35 47 69 47 50 24 35 47" fill="none" stroke="#f7e5b2" stroke-width="5"/><g fill="#a184b4"><circle cx="35" cy="47" r="3"/><circle cx="69" cy="47" r="3"/><circle cx="50" cy="24" r="3"/></g><circle id="explore-dot" cx="50" cy="68" r="4" fill="#fff7d3" stroke="#7e638f" stroke-width="2"/></svg></div>
      <div class="explore-notice" role="status">Toque na trilha para caminhar.</div>
      <div class="explore-loading" role="status">Preparando um lugar para sua história…</div>
    </section>
    <footer class="explore-controls"><div class="explore-stick" role="group" tabindex="0" aria-label="Direcional de movimento. Arraste ou use as setas."><span></span></div><div class="explore-help"><strong>Sem pressa. É só o começo.</strong><p>Toque no chão ou use o direcional.<br>Multiplayer e combate chegam depois.</p></div><div class="explore-actions"><button id="explore-trail">Seguir trilha ✦</button><button class="explore-pause" aria-pressed="false">Pausar</button></div></footer>
  </div>`;
  const $=<T extends HTMLElement>(selector:string)=>shell.querySelector<T>(selector)!;
  let attacking=false,attackQueuedUntil=0;
  if(net){
    shell.classList.add('coop-shell');shell.dataset.build='viagem-coop-v2';shell.dataset.room=net.code;
    $('.explore-title p').innerHTML='COOPERATIVO · <span id="explorer-name"></span>';
    $('.explore-quest').innerHTML='<small>A TURMA CONTRA AS GOSMAS</small><strong id="coop-objective">Protejam a ilha</strong><span id="coop-health"></span><div class="coop-party"></div>';
    $('.explore-help').innerHTML='<strong id="coop-code"></strong><p id="coop-network">Conectado</p><button id="coop-copy">Copiar convite</button>';
    $('#coop-code').textContent=`Sala ${net.code}`;
    $('.explore-actions').innerHTML='<button id="coop-attack">Atacar</button><button class="explore-pause" aria-pressed="false">Pausar controles</button>';
    const debug=document.createElement('details');debug.className='coop-debug';debug.innerHTML='<summary>Conexão da sala</summary><span id="coop-diagnostics"></span><br/><button id="coop-reconnect">Testar reconexão</button>';$('.explore-layout').append(debug);
    net.onStatus=m=>{$('#coop-network').textContent=m;};
    $('#coop-reconnect').addEventListener('click',()=>net.reconnect());
    $('#coop-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(`${location.origin}/?room=${net.code}#personagem`);$('#coop-network').textContent='Convite copiado!';}catch{$('#coop-network').textContent=`Compartilhe o código ${net.code}`;}});
    const attack=$('#coop-attack');attack.addEventListener('pointerdown',e=>{attacking=true;attack.setPointerCapture(e.pointerId);});
    attack.addEventListener('click',()=>{attackQueuedUntil=performance.now()+120;});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])attack.addEventListener(event,()=>{attacking=false;});
    attack.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter')attacking=true;});attack.addEventListener('keyup',()=>{attacking=false;});attack.addEventListener('blur',()=>{attacking=false;});
  }
  $('#explorer-name').textContent=name;
  shell.querySelector('img')!.src=`/art/portraits/${hero.id}-thumb.webp`;
  document.body.append(shell);shell.showModal();
  const abort=new AbortController(),signal=abort.signal;
  const direction:Point={x:0,y:0};
  const stick=$('.explore-stick'),knob=stick.querySelector('span')!;
  const stage=$('.explore-stage'),notice=$('.explore-notice');
  let controller:ReturnType<typeof import('./scene.ts').createIsland>|undefined;
  let closed=false,paused=false,pointer:number|undefined;
  const visited=new Set<number>();
  const reset=()=>{direction.x=direction.y=0;knob.style.transform='';pointer=undefined;};
  const close=()=>{
    if(closed)return;closed=true;active=false;abort.abort();reset();
    net?.leave();controller?.game.destroy(true);shell.close();shell.remove();returnFocus?.focus();
  };
  const pause=(value:boolean)=>{paused=value;attacking=false;reset();controller?.scene.setPaused(value);stage.classList.toggle('explore-paused',value);$('.explore-pause').textContent=value?'Continuar':net?'Pausar controles':'Pausar';$('.explore-pause').setAttribute('aria-pressed',String(value));};
  $('.explore-exit').addEventListener('click',close,{signal});
  shell.addEventListener('cancel',e=>{e.preventDefault();close();},{signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause(true);},{signal});
  window.addEventListener('blur',()=>pause(true),{signal});
  $('.explore-pause').addEventListener('click',()=>pause(!paused),{signal});
  if(!net)$('#explore-trail').addEventListener('click',()=>{pause(false);const next=landmarks.findIndex((_l,i)=>!visited.has(i));if(next>=0)controller?.scene.goTo(landmarks[next]);else notice.textContent='Ilha explorada! Agora escolha seu cantinho favorito.';},{signal});
  const updateStick=(event:PointerEvent)=>{
    const rect=stick.getBoundingClientRect(),max=rect.width*.27;
    const x=event.clientX-rect.left-rect.width/2,y=event.clientY-rect.top-rect.height/2;
    const length=Math.hypot(x,y),scale=Math.min(1,max/(length||1));
    direction.x=x*scale/max;direction.y=y*scale/max;
    knob.style.transform=`translate(${x*scale}px,${y*scale}px)`;
  };
  stick.addEventListener('pointerdown',event=>{if(pointer!==undefined)return;event.preventDefault();pause(false);pointer=event.pointerId;stick.setPointerCapture(pointer);updateStick(event);},{signal});
  stick.addEventListener('pointermove',event=>{if(event.pointerId===pointer)updateStick(event);},{signal});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])stick.addEventListener(type,reset,{signal});
  try{
    const {createIsland}=await import('./scene.ts');
    if(closed)return;
    controller=createIsland($('.explore-canvas'),{
      classId:hero.id,direction:()=>direction,net,attacking:()=>attacking||performance.now()<attackQueuedUntil,
      position:p=>{shell.dataset.playerX=p.x.toFixed(3);shell.dataset.playerY=p.y.toFixed(3);$('#explore-dot').setAttribute('cx',String(50+(p.x-12)*3.8));$('#explore-dot').setAttribute('cy',String(50+(p.y-12)*3.8));
        if(net){
          const self=net.players.get(net.id);shell.dataset.playerId=net.id;shell.dataset.connected=String(net.connected);shell.dataset.tick=String(net.tick);shell.dataset.players=String(net.players.size);
          $('#coop-health').textContent=`Você: ${self?.hp??0}♥ · ${self?.score??0} pontos na sala`;
          $('#coop-objective').textContent=net.victory?'A ilha é da turma!':self?.hp===0?'Recuperando o fôlego…':'Protejam a ilha';
          $('.coop-party').replaceChildren(...[...net.players.values()].map(player=>{const tag=document.createElement('span');tag.textContent=`${player.name} ${player.hp}♥${player.online?'':' ↻'}`;return tag;}));
          $('#coop-diagnostics').textContent=`${[...net.players.values()].filter(p=>p.online).length}/6 online · ${net.rtt} ms · tick ${net.tick} · ${net.pending.length} comandos pendentes`;
        }
      },
      discovered:i=>{visited.add(i);$('#explore-progress').textContent=`${visited.size} de 3 lugares descobertos`;notice.textContent=`${landmarks[i].name} · ${landmarks[i].detail}`;if(visited.size===3)$('#explore-trail').textContent='Ilha explorada ✓';},
      ready:()=>{$('.explore-loading').hidden=true;$('.explore-canvas').focus();},
      message:text=>{notice.textContent=text;},
    });
  }catch{if(!closed){$('.explore-loading').textContent='Não foi possível carregar a ilha. Volte às classes e tente novamente.';}}
}
