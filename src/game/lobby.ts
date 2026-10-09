import type { HeroClass } from '../classes.ts';
import type { CoopClient } from './net/client.ts';
import type { RunState } from './net/run.ts';

// ---------- Pure helpers (no DOM, tested in node) ----------

/** Nicknames shown by the "Sortear" button; the HUD and sheet cap names at 20 characters. */
export const NICK_MAX=20;
const NICK_HEADS=['Capivara','Pastel','Coxinha','Tiozão','Pombo','Boleto','Chinelo','Pernilongo','Gosma','Marmita','Fiscal','Pavê','Biscoito','Sacolé'];
const NICK_TAILS=['Veloz','Turbo','do Grau','Lendário','Sem Wi-Fi','de Feira','Cansado','Fujão','Raiz','Nutella','do Bairro','Atrasado','de Ouro','Brabo'];

/** Funny nickname that fits NICK_MAX; `random` is injectable for tests (cosmetic only, never sim). */
export function suggestNickname(random:()=>number=Math.random,avoid=''){
  for(let attempt=0;attempt<20;attempt++){
    const head=NICK_HEADS[Math.floor(random()*NICK_HEADS.length)%NICK_HEADS.length];
    const tail=NICK_TAILS[Math.floor(random()*NICK_TAILS.length)%NICK_TAILS.length];
    const nick=`${head} ${tail}`;
    if(nick.length<=NICK_MAX&&nick!==avoid)return nick;
  }
  return 'Capivara Veloz'===avoid?'Pastel Turbo':'Capivara Veloz';
}

/** Rotating lines while the room waits. */
export const WAITING_LINES:readonly string[]=Object.freeze([
  'Esperando o amigo que disse "tô chegando" há 20 minutos.',
  'Alguém foi buscar água e sumiu.',
  'O Wi-Fi do vizinho está colaborando.',
  'Aquecendo o chinelo…',
  'Conferindo se o boleto venceu.',
  'A gosma também está esperando. Educada.',
  'Quem não estiver pronto paga a coxinha.',
  'O tio do pavê está ensaiando a piada.',
]);
export const WAITING_LINE_SECONDS=5;
export const waitingLine=(elapsedSeconds:number)=>WAITING_LINES[Number.isFinite(elapsedSeconds)?Math.floor(Math.max(0,elapsedSeconds)/WAITING_LINE_SECONDS)%WAITING_LINES.length:0];

/** Joke for each countdown second (3, 2, 1). */
export function countdownJoke(seconds:number){
  if(seconds>=3)return 'Desligando o fogão…';
  if(seconds===2)return 'Avisando a mãe que vai demorar…';
  if(seconds===1)return 'Segura o chinelo!';
  return 'Bora!';
}

/** Invite link, same format the island uses (`?room=` prefills the lobby). */
export const shareLink=(origin:string,code:string)=>`${origin.replace(/\/+$/,'')}/?room=${encodeURIComponent(code)}#personagem`;

export interface WaitingMember {id:string;name:string;ready:boolean;online:boolean;self:boolean}
export interface WaitingView {
  visible:boolean;
  phase:'lobby'|'countdown'|'hidden';
  members:WaitingMember[];
  readyCount:number;total:number;
  selfReady:boolean;
  /** Joined mid-countdown/combat: watches this round, cannot toggle ready. */
  selfSpectator:boolean;
  /** Countdown seconds (countdown phase only). */
  seconds?:number;
  /** Headline: who we wait for, or the countdown joke. */
  headline:string;
}

/** View model of the waiting room from the polled run state. Spectators are not counted. */
export function waitingRoomView(run:RunState|undefined,names:ReadonlyMap<string,{name:string}>,selfId:string,hz=20):WaitingView{
  const phase=run?.phase==='lobby'||run?.phase==='countdown'?run.phase:'hidden';
  const members:WaitingMember[]=(run?.members??[]).filter(m=>!m.spectator).map(m=>({
    id:m.id,name:names.get(m.id)?.name||'Alguém',ready:m.ready,online:m.online,self:m.id===selfId,
  })).sort((a,b)=>Number(b.self)-Number(a.self)||a.name.localeCompare(b.name,'pt-BR')||(a.id<b.id?-1:1));
  const readyCount=members.filter(m=>m.ready&&m.online).length,total=members.length;
  const selfReady=!!members.find(m=>m.self)?.ready;
  const selfSpectator=!!run?.members.find(m=>m.id===selfId)?.spectator;
  if(phase==='countdown'){
    const seconds=Math.max(0,Math.ceil((run?.remaining??0)/hz));
    return {visible:true,phase,members,readyCount,total,selfReady,selfSpectator,seconds,headline:countdownJoke(seconds)};
  }
  if(phase!=='hidden'&&selfSpectator)return {visible:true,phase,members,readyCount,total,selfReady,selfSpectator,headline:'Você assiste esta rodada. Pipoca liberada!'};
  const missing=members.filter(m=>!m.ready||!m.online);
  const headline=phase==='hidden'?''
    :total<=1?'Só você aqui. Chama a turma!'
    :!missing.length?'Todo mundo pronto. Milagre!'
    :missing.length===1?(missing[0].self?'Só falta você. Sem pressão.':`Só falta ${missing[0].name}. Sem pressão.`)
    :`Faltam ${missing.length}. Alguém foi ao banheiro.`;
  return {visible:phase!=='hidden',phase,members,readyCount,total,selfReady,selfSpectator,headline};
}

// ---------- DOM ----------

const escapeHtml=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);

/**
 * Waiting room panel inside the island shell (a modal dialog, so it must live inside it).
 * Polls client.run, shows while the run is in lobby/countdown and removes itself when the island closes.
 */
export function mountWaitingRoom(host:HTMLElement,client:Pick<CoopClient,'code'|'id'|'run'|'players'|'ready'|'connected'>,options:{origin?:string;now?:()=>number}={}){
  const now=options.now??(()=>performance.now());
  const started=now();
  const panel=document.createElement('section');panel.className='coop-wait';panel.setAttribute('aria-label','Sala de espera');
  panel.innerHTML=`<div class="coop-wait-code"><small>SALA</small><strong></strong><button class="coop-wait-share" type="button">Chamar a turma</button></div>
    <p class="coop-wait-headline" role="status" aria-live="polite"></p>
    <ul class="coop-wait-members"></ul>
    <p class="coop-wait-line"></p>
    <button class="coop-wait-ready" type="button" aria-pressed="false">Tô pronto!</button>
    <p class="coop-wait-count" aria-hidden="true"></p>`;
  const $=<T extends HTMLElement>(s:string)=>panel.querySelector<T>(s)!;
  $('.coop-wait-code strong').textContent=client.code;
  const link=shareLink(options.origin??location.origin,client.code);
  const shareButton=$<HTMLButtonElement>('.coop-wait-share');
  shareButton.addEventListener('click',async()=>{
    const say=(text:string)=>{shareButton.textContent=text;setTimeout(()=>{shareButton.textContent='Chamar a turma';},2500);};
    try{
      if(navigator.share){await navigator.share({title:'Viagem',text:`Bora pra ilha? Sala ${client.code}`,url:link});say('Convite enviado!');return;}
      await navigator.clipboard.writeText(link);say('Copiado! Manda no grupo da família.');
    }catch(error){
      if((error as DOMException)?.name==='AbortError')return;
      say(`Código: ${client.code}`);
    }
  });
  const readyButton=$<HTMLButtonElement>('.coop-wait-ready');
  let lastView:WaitingView|undefined;
  readyButton.addEventListener('click',()=>client.ready(!lastView?.selfReady));
  host.append(panel);
  let membersKey='';
  // Only touch text that changed, so the polite live region is not re-announced every poll.
  const setText=(el:HTMLElement,text:string)=>{if(el.textContent!==text)el.textContent=text;};
  const update=()=>{
    if(!panel.isConnected||!host.isConnected){clearInterval(timer);panel.remove();return;}
    const view=waitingRoomView(client.run,client.players,client.id);lastView=view;
    panel.hidden=!view.visible;
    if(!view.visible)return;
    panel.dataset.phase=view.phase;
    setText($('.coop-wait-headline'),view.headline);
    setText($('.coop-wait-line'),view.phase==='countdown'?'':waitingLine((now()-started)/1000));
    setText($('.coop-wait-count'),view.seconds!==undefined?String(view.seconds):'');
    // Ready players can still back out during the countdown (the server accepts it).
    readyButton.hidden=view.selfSpectator;
    readyButton.disabled=!client.connected;
    setText(readyButton,view.selfReady?'Ops, peraí':'Tô pronto!');
    readyButton.setAttribute('aria-pressed',String(view.selfReady));
    readyButton.classList.toggle('is-ready',view.selfReady);
    const key=JSON.stringify(view.members);
    if(key!==membersKey){
      membersKey=key;
      $('.coop-wait-members').innerHTML=view.members.map(m=>`<li class="${m.ready?'is-ready':''}${m.online?'':' is-away'}"><span aria-hidden="true">${m.ready?'✔':'💤'}</span>${escapeHtml(m.name)}${m.self?' <small>(você)</small>':''}<span class="sr-only">${m.ready?' pronto':' ainda não'}</span></li>`).join('');
    }
  };
  const timer=setInterval(update,200);update();
  return {panel,update,dispose(){clearInterval(timer);panel.remove();}};
}

export async function openLobby(hero:HeroClass,name:string){
  // Loaded together (CSS stays dynamic so the pure helpers above import in node tests).
  const [,{CoopClient}]=await Promise.all([import('./coop.css'),import('./net/client.ts')]);
  const dialog=document.createElement('dialog');dialog.className='coop-lobby';dialog.setAttribute('aria-label','Jogar com amigos');
  dialog.innerHTML=`<button class="coop-close" aria-label="Fechar">×</button><small>ILHA DO COMEÇO · COOPERATIVO</small><h2>Chama a turma.</h2><p>Até seis personagens na mesma ilha. Compartilhe o código, encontre os amigos e enfrentem as gosmas.</p><div class="coop-nick"><label for="coop-nick">Apelido na sala</label><div><input id="coop-nick" maxlength="${NICK_MAX}" autocomplete="nickname" spellcheck="false"/><button type="button" class="coop-nick-roll" aria-label="Sortear apelido engraçado">🎲 Sortear</button></div></div><button id="create-room">Criar sala</button><div class="coop-divider">ou entre na sala de alguém</div><form><label for="room-code">Código da sala</label><input id="room-code" maxlength="10" pattern="[a-fA-F0-9]{10}" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="10 letras e números"/><button type="submit">Entrar na sala</button></form><p class="coop-status" role="status"></p><small>Partidas de até 30 minutos. Pontos desta versão valem só na sala. As classes ainda compartilham o mesmo ataque básico.</small>`;
  document.body.append(dialog);dialog.showModal();
  const status=dialog.querySelector<HTMLElement>('.coop-status')!;
  const nickInput=dialog.querySelector<HTMLInputElement>('#coop-nick')!;
  nickInput.value=name.slice(0,NICK_MAX);
  dialog.querySelector('.coop-nick-roll')!.addEventListener('click',()=>{nickInput.value=suggestNickname(Math.random,nickInput.value);});
  const actionButtons=()=>dialog.querySelectorAll<HTMLButtonElement>('button:not(.coop-close):not(.coop-nick-roll)');
  for(const b of actionButtons())b.disabled=true;
  status.textContent='Preparando conexão com as salas…';
  let client:CoopClient|undefined,closed=false;
  const cancel=()=>{closed=true;client?.leave();dialog.close();dialog.remove();document.getElementById('confirm')?.focus();};
  dialog.querySelector('.coop-close')!.addEventListener('click',cancel);
  dialog.addEventListener('cancel',e=>{e.preventDefault();cancel();});
  const endpoint=await fetch('/multiplayer.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(c=>c?.endpoint as string|undefined).catch(()=>undefined);
  if(closed)return;
  const codeInput=dialog.querySelector<HTMLInputElement>('#room-code')!;
  codeInput.value=new URL(location.href).searchParams.get('room')?.toUpperCase()??'';
  let busy=false;
  async function enter(create:boolean){
    if(busy||closed)return;
    if(!endpoint){status.textContent='As salas ainda não estão disponíveis neste endereço. Tente novamente após a publicação.';return;}
    busy=true;for(const b of actionButtons())b.disabled=true;
    try{
      let code=codeInput.value.trim().toUpperCase();
      if(create){status.textContent='Criando sua sala…';const r=await fetch(new URL('/rooms',endpoint),{method:'POST',signal:AbortSignal.timeout(10000)});const data=await r.json();if(!r.ok)throw new Error(data.error??'Não foi possível criar a sala.');code=data.code;codeInput.value=code;}
      if(closed)return;
      if(!/^[A-F0-9]{10}$/.test(code))throw new Error('O código deve ter 10 letras e números.');
      const nick=nickInput.value.trim().slice(0,NICK_MAX)||name;
      client=new CoopClient(endpoint,code,nick,hero.id);client.onStatus=m=>{status.textContent=m;};await client.join();
      if(closed){client.leave();return;}
      const {openExploration}=await import('./explore.ts');dialog.close();dialog.remove();
      const joined=client;
      const opening=openExploration(hero,nick,joined);
      const layout=document.querySelector<HTMLElement>('dialog.explore-shell .explore-layout');
      if(layout)mountWaitingRoom(layout,joined);
      await opening;
    }catch(e){client?.leave();if(!closed)status.textContent=e instanceof Error?e.message:'A conexão falhou. Tente novamente.';}
    finally{busy=false;for(const b of dialog.querySelectorAll<HTMLButtonElement>('button'))b.disabled=false;}
  }
  dialog.querySelector('#create-room')!.addEventListener('click',()=>void enter(true));
  dialog.querySelector('form')!.addEventListener('submit',e=>{e.preventDefault();void enter(false);});
  for(const b of actionButtons())b.disabled=false;
  status.textContent=endpoint?'':'As salas ainda não estão disponíveis neste endereço.';
}
