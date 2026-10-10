import './explore.css';
import type { HeroClass } from '../classes.ts';
import {landmarks} from './world.ts';
import type { CoopClient } from './net/client.ts';
import './coop.css';
import {JoystickInput} from './joystick.ts';
import {RunHud} from './hud/hud.ts';
import {TOTAL_ROUNDS,type RunResult} from './hud/model.ts';
import {DamageTally} from './net/run-feed.ts';
import {ROOM_CLOSING_NOTICE} from './net/shared.ts';
import type {RunView} from './sim/view.ts';

/** Label of the result button when the room refuses another run (042a R2: not enough room lifetime left). */
const REMATCH_REFUSED='Criem uma sala nova';
/** Center banner while the socket is down (the client retries on its own). */
const RECONNECTING='Reconectando à turma…';

let active=false;
export async function openExploration(hero:HeroClass,name:string,net?:CoopClient){
  if(active)return;
  active=true;
  const returnFocus=document.getElementById('confirm');
  const shell=document.createElement('dialog');shell.className='explore-shell';shell.setAttribute('aria-label','Ilha do Começo');shell.dataset.build='viagem-island-v2';
  shell.innerHTML=`<div class="explore-layout">
    <div class="explore-camera" role="group" aria-label="Girar câmera"><button data-turn="-1" aria-label="Girar câmera para a esquerda" disabled>↶</button><span aria-live="polite">1 / 4</span><button data-turn="1" aria-label="Girar câmera para a direita" disabled>↷</button></div>
    <button class="explore-config" aria-label="Configurações do jogo" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3-1 3-3 1v4l2 1-2 2v3l3 1 1 3h5l1-3 3-1 2-3-2-2 2-2-2-3-3-1-1-3Z"/><circle cx="11.5" cy="12" r="3"/></svg></button>
    <header class="explore-top"><div class="explore-title"><img alt=""/><div><h2>Ilha do Começo</h2><p>EXPLORAÇÃO SOLO · <span id="explorer-name"></span></p></div></div><button class="explore-exit">← Classes</button></header>
    <section class="explore-stage" aria-label="Mapa isométrico da Ilha do Começo">
      <div class="explore-canvas" role="application" tabindex="0" aria-label="Mapa explorável. Use as setas ou WASD, toque no chão ou arraste o direcional."></div>
      <div class="explore-quest"><small>PRIMEIROS PASSOS</small><strong>Conheça a ilha</strong><span id="explore-progress">0 de 3 lugares descobertos</span></div>
      <div class="explore-map" aria-hidden="true"><svg viewBox="0 0 100 100"><ellipse cx="50" cy="50" rx="39" ry="39" fill="#c8d795"/><path d="M50 68 35 47 69 47 50 24 35 47" fill="none" stroke="#f7e5b2" stroke-width="5"/><g fill="#a184b4"><circle cx="35" cy="47" r="3"/><circle cx="69" cy="47" r="3"/><circle cx="50" cy="24" r="3"/></g><circle id="explore-dot" cx="50" cy="68" r="4" fill="#fff7d3" stroke="#7e638f" stroke-width="2"/></svg></div>
      <div class="explore-notice" role="status">Toque na trilha para caminhar.</div>
      <div class="explore-loading" role="status">Preparando um lugar para sua história…</div>
    </section>
    <footer class="explore-controls"><div class="explore-movement"><div class="explore-stick" role="group" tabindex="0" aria-label="Joystick de movimento. Arraste para andar ou use WASD e as setas."><span aria-hidden="true"></span></div><small>Arraste para andar</small></div><div class="explore-help"><strong>Sem pressa. É só o começo.</strong><p>Toque no chão ou use o direcional.<br>Multiplayer e combate chegam depois.</p></div><div class="explore-actions"><button id="explore-trail">Seguir trilha ✦</button><button class="explore-pause" aria-pressed="false">Pausar</button></div></footer>
  </div>`;
  const $=<T extends HTMLElement>(selector:string)=>shell.querySelector<T>(selector)!;
  let attacking=false,attackQueuedUntil=0,attackPointer:number|undefined;
  let hud:RunHud|undefined,resultShown:number|undefined;
  const damage=new DamageTally();
  if(net){
    shell.classList.add('coop-shell');shell.dataset.build='viagem-coop-v3';shell.dataset.room=net.code;
    $('.explore-notice').textContent='Arraste para andar. A arma atira sozinha; toque num bicho para priorizar o alvo.';
    $('.explore-title p').innerHTML='COOPERATIVO · <span id="explorer-name"></span>';
    $('.explore-quest').innerHTML='<small>A TURMA CONTRA AS GOSMAS</small><strong id="coop-objective">Protejam a ilha</strong><span id="coop-health"></span><div class="coop-party"></div>';
    $('.explore-help').innerHTML='<strong id="coop-code"></strong><p id="coop-network">Conectado</p><button id="coop-copy">Copiar convite</button>';
    $('#coop-code').textContent=`Sala ${net.code}`;
    // Weapons fire on their own: this slot is the class skill (the old "Atacar" already sent `skill`). Same look as before;
    // cooldown, icon and line come with NEW-20261006-E7-skill-hud-wiring and the DSG cards.
    $('.explore-actions').innerHTML='<button id="coop-attack" data-slot="skill" aria-label="Habilidade da classe">Habilidade</button><button class="explore-pause" aria-pressed="false">Pausar controles</button>';
    const debug=document.createElement('details');debug.className='coop-debug';debug.innerHTML='<summary>Conexão da sala</summary><span id="coop-diagnostics"></span><br/><button id="coop-reconnect">Testar reconexão</button>';$('.explore-layout').append(debug);
    // The run HUD (VGM-040) replaces the old .coop-run strip: ready lives in the waiting room, rematch on the result screen.
    hud=new RunHud($('.explore-layout'),{localId:net.id,onChoose:(offer,index)=>net.choose(offer,index),onRematch:()=>net.rematch(),onExit:()=>close()});
    hud.el.hidden=true;
    net.onStatus=m=>{$('#coop-network').textContent=m;};
    net.onNotice=message=>{if(message===ROOM_CLOSING_NOTICE&&resultShown!==undefined)hud?.rematchRefused(REMATCH_REFUSED);};
    $('#coop-reconnect').addEventListener('click',()=>net.reconnect());
    $('#coop-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(`${location.origin}/?room=${net.code}#personagem`);$('#coop-network').textContent='Convite copiado!';}catch{$('#coop-network').textContent=`Compartilhe o código ${net.code}`;}});
    const attack=$('#coop-attack');attack.addEventListener('pointerdown',e=>{if(e.button!==0||attackPointer!==undefined)return;e.preventDefault();pause(false);attackPointer=e.pointerId;attacking=true;attack.setPointerCapture(e.pointerId);});
    attack.addEventListener('click',()=>{pause(false);attackQueuedUntil=performance.now()+120;});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])attack.addEventListener(event,e=>{if((e as PointerEvent).pointerId===attackPointer){attacking=false;attackPointer=undefined;}});
    attack.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter')attacking=true;});attack.addEventListener('keyup',()=>{attacking=false;});attack.addEventListener('blur',()=>{attacking=false;});
  }
  // Only controls overlay the map. All secondary information lives in a native
  // modal so focus, Escape and touch input cannot leak into the running game.
  shell.dataset.build=net?'viagem-coop-v4':'viagem-island-v3';
  const settings=document.createElement('dialog');settings.className='explore-settings';settings.setAttribute('aria-label','Configurações do jogo');
  settings.innerHTML='<div class="explore-settings-heading"><h2>Configurações</h2><button class="explore-settings-close" aria-label="Voltar ao jogo">✕</button></div><div class="explore-settings-content"></div>';
  const settingsContent=settings.querySelector('.explore-settings-content')!;
  for(const selector of ['.explore-top','.explore-quest','.explore-map','.explore-help','.explore-notice','#explore-trail','.explore-pause','.coop-debug']){
    const element=shell.querySelector(selector);if(element)settingsContent.append(element);
  }
  $('.explore-movement small').remove();
  shell.append(settings);
  $('#explorer-name').textContent=name;
  shell.querySelector('img')!.src=`/art/portraits/${hero.id}-thumb.webp`;
  document.body.append(shell);shell.showModal();
  const abort=new AbortController(),signal=abort.signal;
  const direction=new JoystickInput();
  const stick=$('.explore-stick'),knob=stick.querySelector('span')!;
  const stage=$('.explore-stage'),notice=$('.explore-notice');
  let controller:ReturnType<typeof import('./scene.ts').createIsland>|undefined;
  let closed=false,paused=false;
  const visited=new Set<number>();
  /** Result screen data from the last view: the room sends outcome and duration, the HUD view has round, players and build. */
  const runResult=(victory:boolean,durationTicks:number):RunResult=>{
    const view:RunView|undefined=hud?.view;
    return {victory,durationTicks,round:Math.max(1,view?.round?.index??1),totalRounds:view?.round?.total||TOTAL_ROUNDS,seed:String(net?.terrain.seed??''),
      // Server counters when the room sends them (award-stats-server); the local damage sum is the old fallback.
      players:(view?.players??[]).map(p=>({...p,stats:p.stats?.downs!==undefined?{...p.stats}:{damage:damage.of(p.id),kills:0,revives:0,pickups:0}}))};
  };
  const reset=()=>{const pointer=direction.pointer;direction.reset();knob.style.transform='';stick.classList.remove('is-dragging');if(pointer!==undefined&&stick.hasPointerCapture(pointer))stick.releasePointerCapture(pointer);};
  const close=()=>{
    if(closed)return;closed=true;active=false;abort.abort();reset();
    net?.leave();hud?.destroy();controller?.game.destroy(true);settings.close();shell.close();shell.remove();returnFocus?.focus();
  };
  const pause=(value:boolean)=>{paused=value;if(value){attacking=false;attackPointer=undefined;attackQueuedUntil=0;reset();}controller?.scene.setPaused(value);stage.classList.toggle('explore-paused',value);$('.explore-pause').textContent=value?'Continuar':net?'Pausar controles':'Pausar';$('.explore-pause').setAttribute('aria-pressed',String(value));};
  const openSettings=()=>{pause(true);shell.classList.add('settings-open');settings.showModal();$('.explore-settings-close').focus();};
  const closeSettings=()=>{settings.close();shell.classList.remove('settings-open');pause(false);$('.explore-canvas').focus();};
  shell.dataset.cameraView='0';
  for(const button of shell.querySelectorAll<HTMLButtonElement>('[data-turn]'))button.addEventListener('click',()=>{
    if(!controller)return;reset();attacking=false;attackQueuedUntil=0;pause(false);
    const view=controller.scene.rotateCamera(Number(button.dataset.turn));
    shell.dataset.cameraView=String(view);$('.explore-camera span').textContent=`${view+1} / 4`;
    $('.explore-canvas').focus();
  },{signal});
  $('.explore-config').addEventListener('click',openSettings,{signal});
  $('.explore-settings-close').addEventListener('click',closeSettings,{signal});
  settings.addEventListener('cancel',e=>{e.preventDefault();e.stopPropagation();closeSettings();},{signal});
  $('.explore-exit').addEventListener('click',close,{signal});
  shell.addEventListener('cancel',e=>{e.preventDefault();openSettings();},{signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause(true);},{signal});
  window.addEventListener('blur',()=>pause(true),{signal});
  $('.explore-pause').addEventListener('click',closeSettings,{signal});
  if(!net)$('#explore-trail').addEventListener('click',()=>{closeSettings();const next=landmarks.findIndex((_l,i)=>!visited.has(i));if(next>=0)controller?.scene.goTo(landmarks[next]);else notice.textContent='Ilha explorada! Agora escolha seu cantinho favorito.';},{signal});
  const updateStick=(event:PointerEvent)=>{
    const rect=stick.getBoundingClientRect(),max=rect.width*.27;
    if(!direction.move(event.pointerId,event.clientX-rect.left-rect.width/2,event.clientY-rect.top-rect.height/2,max))return;
    knob.style.transform=`translate(${direction.x*max}px,${direction.y*max}px)`;
  };
  stick.addEventListener('pointerdown',event=>{
    if(event.button!==0||shell.dataset.out==='true'||!direction.start(event.pointerId))return;
    event.preventDefault();pause(false);stick.setPointerCapture(event.pointerId);
    stick.classList.add('is-dragging');updateStick(event);
  },{signal});
  stick.addEventListener('pointermove',updateStick,{signal});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])stick.addEventListener(type,event=>{
    if(direction.end((event as PointerEvent).pointerId))reset();
  },{signal});
  try{
    const {createIsland}=await import('./scene.ts');
    if(closed)return;
    controller=createIsland($('.explore-canvas'),{
      classId:hero.id,direction:()=>direction,net,attacking:()=>attacking||performance.now()<attackQueuedUntil,
      terrain:(seed,signature)=>{shell.dataset.terrainSeed=String(seed);shell.dataset.terrainSignature=signature;const info=document.createElement("p");info.textContent=`Ilha ${seed} · relevo procedural`;settingsContent.append(info);},
      visual:(animation,frame,sheets)=>{const canvas=$('.explore-canvas');canvas.dataset.spriteAnimation=animation;canvas.dataset.spriteFrame=frame;canvas.dataset.spriteSheets=String(sheets);},
      position:p=>{shell.dataset.playerX=p.x.toFixed(3);shell.dataset.playerY=p.y.toFixed(3);$('#explore-dot').setAttribute('cx',String(50+(p.x-12)*3.8));$('#explore-dot').setAttribute('cy',String(50+(p.y-12)*3.8));
        if(net){
          const self=net.players.get(net.id);shell.dataset.playerId=net.id;shell.dataset.connected=String(net.connected);shell.dataset.tick=String(net.tick);shell.dataset.players=String(net.players.size);
          $('#coop-health').textContent=`Você: ${self?.hp??0}♥`;
          const run=net.run,member=run?.members.find(p=>p.id===net.id);
          if(run){
            shell.dataset.runPhase=run.phase;shell.dataset.runRound=String(run.round);
            if(hud){
              // Shown by runView once it holds this run's state; until then the DOM may still show the last run's falls.
              if(run.phase!=='combat'&&run.phase!=='result')hud.el.hidden=true;
              if(run.phase==='result'&&resultShown!==run.round){resultShown=run.round;hud.showResult(runResult(run.outcome==='victory',run.elapsed));}
              else if(run.phase!=='result'&&resultShown!==undefined){resultShown=undefined;hud.hideResult();damage.reset();}
              shell.dataset.hudResult=String(resultShown!==undefined);
              hud.setNetwork(net.connected?undefined:RECONNECTING);
              hud.avoidHero(controller?.scene.heroScreenRect());
            }
            // Out of the run (bled out) or watching: the thumb controls go quiet; the HUD banner says why.
            const state=net.feed.players.get(net.id),out=run.phase==='combat'&&(!!state?.eliminated||!!member?.spectator);
            if(shell.dataset.out!==String(out)){shell.dataset.out=String(out);if(out)reset();}
            $<HTMLButtonElement>('#coop-attack').disabled=run.phase!=='combat'||!!member?.spectator||!!state?.eliminated||!!state?.downed||!net.connected;
          }
          $('#coop-objective').textContent=net.victory?'A ilha é da turma!':self?.hp===0?'Recuperando o fôlego…':'Protejam a ilha';
          $('.coop-party').replaceChildren(...[...net.players.values()].map(player=>{const tag=document.createElement('span');tag.textContent=`${player.name} ${player.hp}♥${player.online?'':' ↻'}`;return tag;}));
          $('#coop-diagnostics').textContent=`${[...net.players.values()].filter(p=>p.online).length}/6 online · ${net.rtt} ms · tick ${net.tick} · ${net.pending.length} comandos pendentes`;
        }
      },
      discovered:i=>{visited.add(i);$('#explore-progress').textContent=`${visited.size} de 3 lugares descobertos`;notice.textContent=`${landmarks[i].name} · ${landmarks[i].detail}`;if(visited.size===3)$('#explore-trail').textContent='Ilha explorada ✓';},
      runView:view=>{
        damage.add(view,id=>net!.players.has(id));
        const phase=net?.run?.phase;
        if(hud&&(phase==='combat'||phase==='result')){hud.update(phase==='result'?{...view,offers:[]}:view);hud.el.hidden=false;}
        shell.dataset.offers=String(view.offers.length);shell.dataset.enemies=String(view.enemies.length);
      },
      ready:()=>{for(const button of shell.querySelectorAll<HTMLButtonElement>('[data-turn]'))button.disabled=false;$('.explore-loading').hidden=true;$('.explore-canvas').focus();},
      message:text=>{notice.textContent=text;},
    });
    if(paused)controller.scene.setPaused(true);
  }catch{if(!closed){$('.explore-loading').textContent='Não foi possível carregar a ilha. Volte às classes e tente novamente.';}}
}
