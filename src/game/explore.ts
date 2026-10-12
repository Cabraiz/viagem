import './explore.css';
import type { HeroClass } from '../classes.ts';
import {landmarks} from './world.ts';
import type { CoopClient } from './net/client.ts';
import './coop.css';
import {JoystickInput} from './joystick.ts';
import {RunHud} from './hud/hud.ts';
import {auditBoxes,auditBoxesFromDom,measureZones,type Rect} from './hud/zones.ts';
import {freeAround} from './framing.ts';
import {TOTAL_ROUNDS,type RunResult} from './hud/model.ts';
import {DamageTally} from './net/run-feed.ts';
import {ROOM_CLOSING_NOTICE,KICKED_TITLE} from './net/shared.ts';
import {showFatal,showSlowLink,SLOW_LINK_MS} from './net-fatal.ts';
import type {RunView} from './sim/view.ts';
import {SkillButton} from './hud/skill.ts';
import {icon,compass} from '../ui/icon.ts';
import {RescueBoard} from './hud/rescue.ts';
import {loadEconomy,saveEconomy,toggleEconomy,autoEconomy,type EconomySettings,type KeyValue} from './economy.ts';

/** Economy toast (VGM-048): how long the "ligado sozinho" line stays before it leaves on its own. */
const ECONOMY_TOAST_MS=9000;
const economyStore=():KeyValue|null=>{try{return globalThis.localStorage??null;}catch{return null;}};
import {inviteQuery,uxMetricsEnabled} from './dev/ux-flag.ts';
import type {UxMetrics} from './dev/ux-metrics.ts';

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
    <div class="explore-camera" role="group" aria-label="Girar câmera"><button data-turn="-1" aria-label="Girar câmera para a esquerda" disabled>${icon('girar',{size:32,className:'ic-espelho'})}</button><span class="explore-view">${compass(0,{size:32})}<span class="sr-only" aria-live="polite">Vista 1 de 4</span></span><i class="explore-lock" aria-hidden="true">${icon('cadeado',{size:32})}</i><button data-turn="1" aria-label="Girar câmera para a direita" disabled>${icon('girar',{size:32})}</button><span class="explore-camera-hint" role="status" hidden>Gira no intervalo</span></div>
    <button class="explore-config" aria-label="Configurações do jogo" aria-haspopup="dialog">${icon('config',{size:32})}</button>
    <header class="explore-top"><div class="explore-title"><img alt=""/><div><h2>Ilha do Começo</h2><p>EXPLORAÇÃO SOLO · <span id="explorer-name"></span></p></div></div><button class="explore-exit">${icon('voltar')} Classes</button></header>
    <section class="explore-stage" aria-label="Mapa isométrico da Ilha do Começo">
      <div class="explore-canvas" role="application" tabindex="0" aria-label="Mapa explorável. Use as setas ou WASD, toque no chão ou arraste o direcional."></div>
      <div class="explore-quest"><small>PRIMEIROS PASSOS</small><strong>Conheça a ilha</strong><span id="explore-progress">0 de 3 lugares descobertos</span></div>
      <div class="explore-map" aria-hidden="true"><svg viewBox="0 0 100 100"><ellipse cx="50" cy="50" rx="39" ry="39" fill="#c8d795"/><path d="M50 68 35 47 69 47 50 24 35 47" fill="none" stroke="#f7e5b2" stroke-width="5"/><g fill="#a184b4"><circle cx="35" cy="47" r="3"/><circle cx="69" cy="47" r="3"/><circle cx="50" cy="24" r="3"/></g><circle id="explore-dot" cx="50" cy="68" r="4" fill="#fff7d3" stroke="#7e638f" stroke-width="2"/></svg></div>
      <div class="explore-notice" role="status">Toque na trilha para caminhar.</div>
      <div class="explore-loading" role="status">Preparando um lugar para sua história…</div>
    </section>
    <footer class="explore-controls"><div class="explore-movement"><div class="explore-stick" role="group" tabindex="0" aria-label="Joystick de movimento. Arraste para andar ou use WASD e as setas."><span aria-hidden="true"></span></div><small>Arraste para andar</small></div><div class="explore-help"><strong>Sem pressa. É só o começo.</strong><p>Toque no chão ou use o direcional.<br>Multiplayer e combate chegam depois.</p></div><div class="explore-actions"><button id="explore-trail">Seguir trilha</button><button class="explore-pause" aria-pressed="false">Pausar</button></div></footer>
  </div>`;
  const $=<T extends HTMLElement>(selector:string)=>shell.querySelector<T>(selector)!;
  /** The class skill button (E7-skill-hud-wiring): one tap, one cast; cooldown and "sem alvo" on the button. */
  let skill:SkillButton|undefined;
  let hud:RunHud|undefined,resultShown:number|undefined;
  let rescue:RescueBoard|undefined;
  /** The client stopped for good: its reason and a reload button replace "Reconectando…" (UX onda 4, B13). */
  let fatalShown:string|undefined;
  /** Playtest metrics (UX-playtest-metricas): only with ?dev=1, loaded on demand; every use is `ux?.`. */
  let ux:UxMetrics|undefined;
  // Dev overlay of the screen zones (UX-zonas-tela): ?zonas in the URL.
  let zoneOverlay=import.meta.env.DEV&&new URLSearchParams(location.search).has('zonas');
  const damage=new DamageTally();
  if(net){
    shell.classList.add('coop-shell');shell.dataset.build='viagem-coop-v3';shell.dataset.room=net.code;
    $('.explore-notice').textContent='Arraste para andar. A arma atira sozinha; toque num bicho para priorizar o alvo.';
    // The room plays on the endless map (D-019, terreno-em-blocos): no island words here; the island tour is solo only.
    shell.setAttribute('aria-label','Mapa da turma');$('.explore-title h2').textContent='Mapa da turma';
    $('.explore-stage').setAttribute('aria-label','Mapa sem fim da turma');
    $('.explore-title p').innerHTML='Jogando como <span id="explorer-name"></span>';
    $('.explore-quest').innerHTML='<small>A turma contra as gosmas</small><strong id="coop-objective">Segurem a muralha</strong><span id="coop-health"></span><div class="coop-party"></div>';
    // The island's little map (and its dot) has no meaning on the endless map: the HUD's minimap does that job.
    shell.querySelector('.explore-map')?.remove();
    $('.explore-help').innerHTML='<strong id="coop-code"></strong><p id="coop-network">Conectado</p><button id="coop-copy">Copiar convite</button>';
    $('#coop-code').textContent=`Sala ${net.code}`;
    // Weapons fire on their own: this slot is the class skill. One tap sends one {t:'cast'} (net.cast, input-10hz),
    // never during the cooldown; the button shows the cooldown and the caster's line comes as a balloon (`skill` event).
    $('.explore-actions').innerHTML='<button id="coop-attack" data-slot="skill">Habilidade</button><button class="explore-pause" aria-pressed="false">Pausar controles</button>';
    skill=new SkillButton($<HTMLButtonElement>('#coop-attack'),hero.id);
    const debug=document.createElement('details');debug.className='coop-debug';debug.innerHTML='<summary>Conexão da sala</summary><span id="coop-diagnostics"></span><br/><button id="coop-reconnect">Testar reconexão</button>';$('.explore-layout').append(debug);
    // The run HUD (VGM-040) replaces the old .coop-run strip: ready lives in the waiting room, rematch on the result screen.
    hud=new RunHud($('.explore-layout'),{localId:net.id,worldRescue:true,onChoose:(offer,index)=>net.choose(offer,index),onRematch:()=>net.rematch(),onExit:()=>close(),critterIcon:kind=>controller?.scene.critterIcon(kind),
      onForge:recipe=>net.forge(recipe),
      // The owner's commands from the result screen (D-025); the room checks owner, phase and round.
      onKick:id=>net.kick(id),onAddBot:()=>net.addBot(),onRemoveBot:id=>net.removeBot(id),
      // First-run coach (VGM-056): the hint steps aside from the hero at view rate.
      heroRect:()=>controller?.scene.heroScreenRect()});
    net.onForged=answer=>hud?.forged(answer);
    // Edge arrows, minimap, "Me salva" and the rescue lines (UX-bordas-fora-da-tela, ORQ-minimapa, UX-resgate-e-ping).
    rescue=new RescueBoard({net,hud,actions:$('.explore-actions'),scene:()=>controller?.scene,onTap:()=>pause(false)});
    if(uxMetricsEnabled(location.search))void import('./dev/ux-metrics.ts').then(m=>{
      if(closed||!hud)return;
      // It chains net.onCommand and net.onSos (RescueBoard's) and puts them back on destroy.
      ux=m.createUxMetrics(window,net);ux?.attachHud(hud);
      if(sceneReady)ux?.ready();
    }).catch(()=>undefined);
    hud.el.hidden=true;
    // Out or watching: a tap on a teammate's portrait makes the camera follow them (UX onda 4).
    // Capture phase: the HUD panels stop their own events from leaking into the game (VGM-040).
    hud.el.addEventListener('click',event=>{const member=(event.target as HTMLElement).closest<HTMLElement>('.rh-member[data-id]');if(member?.dataset.id)controller?.scene.watch(member.dataset.id);},true);
    // Dev server only (dropped from builds): the acceptance scripts read and poke the HUD (zones audit, boss marquee).
    if(import.meta.env.DEV){
      (window as unknown as {__hud?:RunHud}).__hud=hud;
      // The overlay module (and its CSS) is loaded on demand, so it never reaches the build.
      (window as unknown as {__zones?:unknown}).__zones={measure:()=>measureZones(),audit:(hero?:Rect)=>auditBoxes(auditBoxesFromDom(),measureZones(),hero),
        overlay:async(on:boolean)=>{zoneOverlay=on;const debug=await import('./hud/zones-debug.ts');if(!on)debug.clearZoneOverlay();else debug.drawZoneOverlay(measureZones());}};
    }
    net.onStatus=m=>{$('#coop-network').textContent=m;};
    net.onNotice=message=>{if(message===ROOM_CLOSING_NOTICE&&resultShown!==undefined)hud?.rematchRefused(REMATCH_REFUSED);};
    $('#coop-reconnect').addEventListener('click',()=>net.reconnect());
    $('#coop-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(`${location.origin}/?room=${net.code}${inviteQuery(location.search)}#personagem`);$('#coop-network').textContent='Convite copiado!';}catch{$('#coop-network').textContent=`Compartilhe o código ${net.code}`;}});
    // Pointer down answers at once (no wait for the click); a keyboard click (detail 0) is the debug fallback (D-009).
    const attack=$<HTMLButtonElement>('#coop-attack');
    const tapSkill=()=>{pause(false);skill?.tap(()=>net.cast(),performance.now());};
    attack.addEventListener('pointerdown',e=>{if(e.button!==0||attack.disabled)return;e.preventDefault();tapSkill();});
    attack.addEventListener('click',e=>{if(e.detail===0&&!attack.disabled)tapSkill();});
    net.onCast=result=>skill?.answer(result,performance.now());
  }
  // Only controls overlay the map. All secondary information lives in a native
  // modal so focus, Escape and touch input cannot leak into the running game.
  shell.dataset.build=net?'viagem-coop-v4':'viagem-island-v3';
  const settings=document.createElement('dialog');settings.className='explore-settings';settings.setAttribute('aria-label','Configurações do jogo');
  settings.innerHTML=`<div class="explore-settings-heading"><h2>Configurações</h2><button class="explore-settings-close" aria-label="Voltar ao jogo">${icon('fechar',{size:32})}</button></div><div class="explore-settings-content"></div>`;
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
  /** The economy toast's own clock (VGM-048), cleared on close. */
  let economyTimer:ReturnType<typeof setTimeout>|undefined;
  const visited=new Set<number>();
  /** Result screen data from the last view: the room sends outcome and duration, the HUD view has round, players and build. */
  const runResult=(victory:boolean,durationTicks:number):RunResult=>{
    const view:RunView|undefined=hud?.view;
    return {victory,durationTicks,round:Math.max(1,view?.round?.index??1),totalRounds:view?.round?.total||TOTAL_ROUNDS,seed:String(net?.terrain.seed??''),
      // Server counters when the room sends them (award-stats-server); the local damage sum is the old fallback.
      players:(view?.players??[]).map(p=>({...p,stats:p.stats?.downs!==undefined?{...p.stats}:{damage:damage.of(p.id),kills:0,revives:0,pickups:0}})),
      ...(!victory&&view?.camp?.wallDown?{wall:true}:{}),
      // The run's most embarrassing moment comes with the result state (VGM-053B).
      ...(net?.run?.shame?{shame:{...net.run.shame}}:{})};
  };
  const reset=()=>{const pointer=direction.pointer;direction.reset();knob.style.transform='';stick.classList.remove('is-dragging');if(pointer!==undefined&&stick.hasPointerCapture(pointer))stick.releasePointerCapture(pointer);};
  const close=()=>{
    if(closed)return;closed=true;active=false;abort.abort();reset();if(economyTimer)clearTimeout(economyTimer);
    ux?.destroy();net?.leave();rescue?.destroy();hud?.destroy();controller?.game.destroy(true);settings.close();shell.close();shell.remove();returnFocus?.focus();
  };
  const pause=(value:boolean)=>{paused=value;if(value)reset();controller?.scene.setPaused(value);stage.classList.toggle('explore-paused',value);$('.explore-pause').textContent=value?'Continuar':net?'Pausar controles':'Pausar';$('.explore-pause').setAttribute('aria-pressed',String(value));};
  const openSettings=()=>{pause(true);shell.classList.add('settings-open');settings.showModal();$('.explore-settings-close').focus();};
  const closeSettings=()=>{settings.close();shell.classList.remove('settings-open');pause(false);$('.explore-canvas').focus();};
  shell.dataset.cameraView='0';
  // The view turns only outside a wave (UX-camera-segue 4): the buttons go grey during it and come back in the intermission.
  // Locked is not disabled: the button still answers a tap with the lock's stamp beat and "Gira no intervalo" (UX onda 4 D3).
  let sceneReady=false,hintTimer:ReturnType<typeof setTimeout>|undefined;
  const cameraGroup=$('.explore-camera'),lock=$('.explore-lock'),hint=$('.explore-camera-hint');
  const syncTurn=()=>{
    const locked=!!controller?.scene.rotationLocked();shell.dataset.cameraLocked=String(locked);
    if(cameraGroup.dataset.locked!==String(locked))cameraGroup.dataset.locked=String(locked);
    for(const button of shell.querySelectorAll<HTMLButtonElement>('[data-turn]')){
      if(button.disabled!==!sceneReady)button.disabled=!sceneReady;
      if(button.getAttribute('aria-disabled')!==String(locked))button.setAttribute('aria-disabled',String(locked));
    }
    if(!locked&&!hint.hidden){hint.hidden=true;if(hintTimer)clearTimeout(hintTimer);}
  };
  const lockedTap=()=>{
    lock.classList.remove('is-beat');void lock.offsetWidth;lock.classList.add('is-beat');
    hint.hidden=false;if(hintTimer)clearTimeout(hintTimer);hintTimer=setTimeout(()=>{hint.hidden=true;},1500);
  };
  for(const button of shell.querySelectorAll<HTMLButtonElement>('[data-turn]'))button.addEventListener('click',()=>{
    if(controller?.scene.rotationLocked()){lockedTap();return;}
    if(!controller)return;reset();pause(false);
    const view=controller.scene.rotateCamera(Number(button.dataset.turn));
    shell.dataset.cameraView=String(view);
    // The compass needle turns with the view (the "1 / 4" left, DSG-icones-sistema); the text stays for screen readers.
    $('.explore-view .ic-bussola').outerHTML=compass(view,{size:32});$('.explore-view .sr-only').textContent=`Vista ${view+1} de 4`;
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
  // Consent (VGM-053B, D7): whether this player's embarrassing moment may show on the result, for everyone in the room.
  if(net){
    const shame=document.createElement('button');shame.type='button';shame.className='explore-shame';
    const sync=()=>{shame.setAttribute('aria-pressed',String(net.allowsShame));shame.textContent=net.allowsShame?'Meu momento vergonhoso: pode aparecer':'Meu momento vergonhoso: fica de fora';};
    sync();shame.addEventListener('click',()=>{net.setShamePref(!net.allowsShame);sync();},{signal});
    settingsContent.append(shame);
  }
  // Economy mode (VGM-048): 30 fps and fewer effects; persisted on this phone, turned on by itself when the game chokes.
  let economy:EconomySettings=loadEconomy(economyStore());
  const economyButton=document.createElement('button');economyButton.type='button';economyButton.className='explore-economy';
  economyButton.innerHTML='<span class="explore-economy-head"><span class="explore-economy-title">Modo econômico</span><span class="explore-economy-tag"></span></span>'
    +'<span class="explore-economy-note">Menos efeitos, jogo mais leve: poupa bateria.</span>';
  const economyTag=economyButton.querySelector<HTMLElement>('.explore-economy-tag')!;
  const economyToast=document.createElement('div');economyToast.className='economy-toast';economyToast.setAttribute('role','status');economyToast.hidden=true;
  economyToast.innerHTML=`<span class="economy-toast-icon">${icon('suor')}</span><p class="economy-toast-text"><strong>Modo econômico ligado</strong><span>Tava engasgando</span></p><button type="button" class="economy-toast-off">Desligar</button>`;
  // Coop: the HUD's announcement slot takes it in line (one row at a time, off the hero). Solo has no HUD and no watch.
  const hideEconomyToast=()=>{if(hud)hud.dropRow(economyToast);else economyToast.hidden=true;if(economyTimer)clearTimeout(economyTimer);economyTimer=undefined;};
  const syncEconomy=()=>{
    economyButton.setAttribute('aria-pressed',String(economy.on));
    economyTag.textContent=economy.on?'Ligado':'Desligado';economyTag.dataset.on=String(economy.on);
    shell.dataset.economy=String(economy.on);
  };
  const setEconomy=(next:EconomySettings)=>{economy=next;saveEconomy(economyStore(),economy);controller?.scene.setEconomy(economy.on);syncEconomy();};
  syncEconomy();
  economyButton.addEventListener('click',()=>{setEconomy(toggleEconomy(economy,!economy.on));hideEconomyToast();},{signal});
  economyToast.querySelector('button')!.addEventListener('click',event=>{event.stopPropagation();setEconomy(toggleEconomy(economy,false));hideEconomyToast();},{signal});
  // The toast sits over the map: its taps never reach the game (like the HUD panels).
  for(const type of ['pointerdown','touchstart'])economyToast.addEventListener(type,event=>event.stopPropagation(),{signal});
  // Near the top of the settings (the panel scrolls on a phone): right under the title and the way back.
  settingsContent.insertBefore(economyButton,settingsContent.querySelector('.explore-top')?.nextSibling??settingsContent.firstChild);
  if(!hud)$('.explore-layout').append(economyToast);
  const slow=()=>{
    const next=autoEconomy(economy);if(!next)return;
    setEconomy(next);
    if(hud){hud.queueRow(economyToast,ECONOMY_TOAST_MS);return;}
    economyToast.hidden=false;if(economyTimer)clearTimeout(economyTimer);economyTimer=setTimeout(hideEconomyToast,ECONOMY_TOAST_MS);
  };

  if(!net)$('#explore-trail').addEventListener('click',()=>{closeSettings();const next=landmarks.findIndex((_l,i)=>!visited.has(i));if(next>=0)controller?.scene.goTo(landmarks[next]);else notice.textContent='Ilha explorada! Agora escolha seu cantinho favorito.';},{signal});
  const updateStick=(event:PointerEvent)=>{
    const rect=stick.getBoundingClientRect(),max=rect.width*.27;
    if(!direction.move(event.pointerId,event.clientX-rect.left-rect.width/2,event.clientY-rect.top-rect.height/2,max))return;
    knob.style.transform=`translate(${direction.x*max}px,${direction.y*max}px)`;
    // The finger's first drag with a direction (playtest metrics; a tap on the stick is not a move).
    if(direction.x||direction.y)ux?.stick();
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
      classId:hero.id,direction:()=>direction,net,
      terrain:(seed,signature)=>{shell.dataset.terrainSeed=String(seed);shell.dataset.terrainSignature=signature;const info=document.createElement("p");info.textContent=net?.terrain.chunks?`Mapa ${seed}`:`Ilha ${seed}, relevo procedural`;settingsContent.append(info);},
      visual:(animation,frame,sheets)=>{const canvas=$('.explore-canvas');canvas.dataset.spriteAnimation=animation;canvas.dataset.spriteFrame=frame;canvas.dataset.spriteSheets=String(sheets);},
      position:p=>{shell.dataset.playerX=p.x.toFixed(3);shell.dataset.playerY=p.y.toFixed(3);if(!net){$('#explore-dot').setAttribute('cx',String(50+(p.x-12)*3.8));$('#explore-dot').setAttribute('cy',String(50+(p.y-12)*3.8));}
        if(net){
          const self=net.players.get(net.id);shell.dataset.playerId=net.id;shell.dataset.connected=String(net.connected);shell.dataset.tick=String(net.tick);shell.dataset.players=String(net.players.size);
          $('#coop-health').textContent=`Sua vida: ${self?.hp??0}`;
          // Long reconnection (UX onda 5): after SLOW_LINK_MS a second line and "Tentar de novo"; the stick dims while offline.
          shell.dataset.offline=String(!net.connected&&!net.fatal);
          showSlowLink($('.explore-layout'),!net.fatal&&net.offlineMs()>SLOW_LINK_MS,()=>net.retryNow());
          // Kicked (D-025): the room's text and a way back to the start; reloading would knock on the same door.
          if(net.fatal&&fatalShown!==net.fatal){fatalShown=net.fatal;showFatal($('.explore-layout'),net.fatal,net.kicked?{title:KICKED_TITLE,action:{label:'Voltar pro início',run:close}}:{});shell.dataset.fatal='true';if(net.kicked)shell.dataset.kicked='true';
            // Terminal here (another tab took the character, VGM-047): no stale offer or HUD left tappable behind the window.
            if(hud)hud.el.hidden=true;}
          const run=net.run,member=run?.members.find(p=>p.id===net.id);
          if(run){
            shell.dataset.runPhase=run.phase;shell.dataset.runRound=String(run.round);
            if(hud){
              // Shown by runView once it holds this run's state; until then the DOM may still show the last run's falls.
              if(run.phase!=='combat'&&run.phase!=='result')hud.el.hidden=true;
              if(run.phase==='result'&&resultShown!==run.round){resultShown=run.round;hud.showResult(runResult(run.outcome==='victory',run.elapsed));}
              else if(run.phase!=='result'&&resultShown!==undefined){resultShown=undefined;hud.hideResult();damage.reset();skill?.reset();}
              shell.dataset.hudResult=String(resultShown!==undefined);
              // After showResult: the coach's end-of-run rule already ran, the metrics read what it learned.
              ux?.tick();
              // Owner, bots and who is still here on the result screen (D-025): crown, robot, "Arrumar turma".
              if(run.phase==='result'){
                const ids=run.members.map(m=>m.id);
                hud.setRoster({owner:run.owner,canManage:net.isOwner,members:ids,bots:run.members.filter(m=>m.bot).map(m=>m.id),seatsLeft:Math.max(0,6-ids.length),
                  extra:[...net.players.values()].filter(p=>ids.includes(p.id)).map(p=>({id:p.id,name:p.name,classId:p.classId,hp:p.hp,maxHp:p.hp,online:p.online,spectator:false,weapons:[],passives:[],
                    ...(run.members.find(m=>m.id===p.id)?.bot?{bot:true}:{})}))});
              }
              hud.setNetwork(net.connected||net.fatal?undefined:RECONNECTING);
              hud.avoidHero(controller?.scene.heroScreenRect());
              // Stonewards (VGM-046B): where the hero is (the forge opens in the camp) and the base's bearing on screen (horn arrow).
              const wall=hud.view?.structures.find(s=>s.kind==='muralha'),heroBox=controller?.scene.heroScreenRect();
              let bearing:number|undefined;
              if(wall&&heroBox&&controller){const at=controller.scene.locate(wall).screen;bearing=Math.atan2(at.y-(heroBox.y+heroBox.height*.85),at.x-(heroBox.x+heroBox.width/2))*180/Math.PI;}
              hud.setHero({x:net.predicted.x,y:net.predicted.y,bearing});
              // The useful area goes to the scene for the follow camera (D-019, UX-camera-segue), only when the layout changed.
              const zones=controller?hud.zonesIfChanged():undefined;
              // Out of the round the waiting panel sits in the middle: the hero goes to the free band around it.
              const wait=run.phase!=='combat'?document.querySelector<HTMLElement>('.coop-wait:not([hidden])')?.getBoundingClientRect():undefined;
              const z=hud.zones(),thumbs=Math.min(z.leftThumb?.y??innerHeight,z.rightThumb?.y??innerHeight);
              if(controller)controller.scene.usefulArea=wait&&wait.width>0&&wait.height>0?freeAround({width:innerWidth,height:innerHeight},{x:wait.left,y:wait.top,width:wait.width,height:wait.height},thumbs):z.useful;
              // Out or watching: the camera follows a teammate; the banner names who (a tap on a portrait changes it).
              hud.setWatching(controller?.scene.watching()?.name);
              if(zones&&import.meta.env.DEV&&zoneOverlay)void import('./hud/zones-debug.ts').then(debug=>debug.drawZoneOverlay(zones));
            }
            // Out of the run (bled out) or watching: the thumb controls go quiet; the HUD banner says why.
            const state=net.feed.players.get(net.id),out=run.phase==='combat'&&(!!state?.eliminated||!!member?.spectator);
            if(shell.dataset.out!==String(out)){shell.dataset.out=String(out);if(out)reset();}
            $<HTMLButtonElement>('#coop-attack').disabled=run.phase!=='combat'||!!member?.spectator||!!state?.eliminated||!!state?.downed||!net.connected;
          }
          $('#coop-objective').textContent=net.victory?'O mapa é da turma!':self?.hp===0?'Recuperando o fôlego…':'Segurem a muralha';
          $('.coop-party').replaceChildren(...[...net.players.values()].map(player=>{const tag=document.createElement('span');tag.textContent=`${player.name}: ${player.hp} de vida${player.online?'':', reconectando'}`;return tag;}));
          syncTurn();
          $('#coop-diagnostics').textContent=`${[...net.players.values()].filter(p=>p.online).length}/6 online · ${net.rtt} ms · tick ${net.tick} · ${net.pending.length} comandos pendentes`;
        }
      },
      discovered:i=>{visited.add(i);$('#explore-progress').textContent=`${visited.size} de 3 lugares descobertos`;notice.textContent=`${landmarks[i].name} · ${landmarks[i].detail}`;if(visited.size===3)$('#explore-trail').innerHTML=`Ilha explorada ${icon('pronto')}`;},
      runView:view=>{
        damage.add(view,id=>net!.players.has(id));
        skill?.update(view.players.find(p=>p.id===net?.id),view.tick,performance.now());
        const phase=net?.run?.phase;
        if(hud&&(phase==='combat'||phase==='result')&&!net?.fatal){hud.update(phase==='result'?{...view,offers:[]}:view);hud.el.hidden=false;}
        if(phase==='combat')rescue?.view(view);
        // Every phase: the metrics keep the last event id across runs (D-011), and count only combat.
        ux?.view(view,net?{x:net.predicted.x,y:net.predicted.y}:undefined,phase==='combat');
        shell.dataset.offers=String(view.offers.length);shell.dataset.enemies=String(view.enemies.length);
      },
      // The kill-cam picture of the HUD (VGM-053B): the scene draws its second camera there.
      killcamRect:()=>hud?.killcamRect(),
      economy:economy.on,slow,
      ready:()=>{sceneReady=true;ux?.ready();syncTurn();$('.explore-loading').hidden=true;$('.explore-canvas').focus();},
      message:text=>{notice.textContent=text;},
    });
    if(paused)controller.scene.setPaused(true);
  }catch{if(!closed){$('.explore-loading').textContent=net?'Não foi possível carregar o mapa. Volte às classes e tente novamente.':'Não foi possível carregar a ilha. Volte às classes e tente novamente.';}}
}
