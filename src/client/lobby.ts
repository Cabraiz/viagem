import type { HeroClass } from '../rules/index.ts';
import type { CoopClient } from './net/client.ts';
import type { RunState } from '../contract/index.ts';
import { icon } from './ui/icon.ts';
import {railName} from './render/map-label-rules.ts';
import {inviteQuery} from './dev/ux-flag.ts';

// ---------- Pure helpers (no DOM, tested in node) ----------

/** Nicknames shown by the "Sortear" button; the HUD and sheet cap names at 20 characters. */
export const NICK_MAX=20;
const NICK_HEADS=['Capivara','Pastel','Coxinha','Tiozão','Pombo','Boleto','Chinelo','Molotov','Cachaça','Marmita','Agiota','Pavê','Biscoito','Sacolé'];
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
  'O bêbado também está esperando. Na saideira.',
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

/**
 * Invite link, same format the island uses (`?room=` prefills the lobby). `extra`: more query (`&dev=1&g=…` when this
 * tab chose "medir a turma" in the playtest, dev/ux-flag.ts inviteQuery).
 */
export const shareLink=(origin:string,code:string,extra='')=>`${origin.replace(/\/+$/,'')}/?room=${encodeURIComponent(code)}${extra}#personagem`;

/** `bot`: a room bot; `owner`: the dono da sala (D-025). */
export interface WaitingMember {id:string;name:string;ready:boolean;online:boolean;self:boolean;bot:boolean;owner:boolean}
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
  /** This player owns the room and may kick and add/remove bots now (lobby or countdown, D-025). */
  canManage:boolean;
  /** Seats left (six in all, bots count): "Adicionar bot" only while there is one. */
  seatsLeft:number;
}
/**
 * What an armed chip says (D-025, design review): the verb (a person is expelled, a bot is taken out), the first name
 * as the rail shows it, and what to do: "Expulsar Wagner? Toca de novo."
 */
export const confirmText=(m:Pick<WaitingMember,'name'|'bot'>)=>`${m.bot?'Tirar':'Expulsar'} ${railName(m.name)}? Toca de novo.`;
/** The owner's line in place of the waiting joke (the joke is optional; this line says what the chips do). */
export const OWNER_HINT='Você é o dono da sala. Toca num nome pra tirar.';
/** How long the owner news stays on top of the waiting room (ms). */
export const OWNER_NEWS_MS=4000;
/**
 * The owner news (D-025, UX review): the post moved ("Bia saiu. Agora quem manda é Caio." / "Agora a sala é sua."),
 * or a guest's first look ("Caio é dono da sala."). The owner's own first look says nothing (their line says it).
 */
export function ownerNotice(before:{name?:string}|undefined,after:string,mine:boolean):string|undefined{
  if(before)return mine?'Agora a sala é sua.':`${railName(before.name??'O dono')} saiu. Agora quem manda é ${railName(after)}.`;
  return mine?undefined:`${railName(after)} é dono da sala.`;
}
/** A second tap this soon after the first is the same finger bouncing, not a confirmation (ms). */
export const DOUBLE_TAP_MS=500;

/** View model of the waiting room from the polled run state. Spectators are not counted. */
export function waitingRoomView(run:RunState|undefined,names:ReadonlyMap<string,{name:string}>,selfId:string,hz=20):WaitingView{
  const phase=run?.phase==='lobby'||run?.phase==='countdown'?run.phase:'hidden';
  const members:WaitingMember[]=(run?.members??[]).filter(m=>!m.spectator).map(m=>({
    id:m.id,name:names.get(m.id)?.name||'Alguém',ready:m.ready,online:m.online,self:m.id===selfId,bot:!!m.bot,owner:!!run?.owner&&m.id===run.owner,
  })).sort((a,b)=>Number(b.self)-Number(a.self)||Number(a.bot)-Number(b.bot)||a.name.localeCompare(b.name,'pt-BR')||(a.id<b.id?-1:1));
  const canManage=phase!=='hidden'&&!!selfId&&run?.owner===selfId,seatsLeft=Math.max(0,6-(run?.members.length??0));
  const readyCount=members.filter(m=>m.ready&&m.online).length,total=members.length;
  const selfReady=!!members.find(m=>m.self)?.ready;
  const selfSpectator=!!run?.members.find(m=>m.id===selfId)?.spectator;
  if(phase==='countdown'){
    const seconds=Math.max(0,Math.ceil((run?.remaining??0)/hz));
    return {visible:true,phase,members,readyCount,total,selfReady,selfSpectator,seconds,headline:countdownJoke(seconds),canManage,seatsLeft};
  }
  if(phase!=='hidden'&&selfSpectator)return {visible:true,phase,members,readyCount,total,selfReady,selfSpectator,headline:'Você assiste esta rodada. Pipoca liberada!',canManage,seatsLeft};
  const missing=members.filter(m=>!m.ready||!m.online);
  // Who is here but not ready apart from who is away (fell off the network, or not back after a restart, VGM-047).
  const here=missing.filter(m=>m.online),away=missing.filter(m=>!m.online);
  const who=(list:WaitingMember[])=>list.length===1?(list[0].self?'você':list[0].name):list.length===2?`${list[0].self?'você':list[0].name} e ${list[1].self?'você':list[1].name}`:String(list.length);
  const awayText=away.length===1?`${away[0].name} ainda não voltou.`:`${away.length} ainda não voltaram.`;
  const headline=phase==='hidden'?''
    :total<=1?'Só você aqui. Chama a turma!'
    :!missing.length?'Todo mundo pronto. Milagre!'
    :away.length&&!here.length?(away.length===1?`Só falta ${away[0].name} voltar.`:awayText)
    :away.length?`${here.length===1?"Falta":"Faltam"} ${who(here)}. ${awayText}`
    :missing.length===1?(missing[0].self?'Só falta você. Sem pressão.':`Só falta ${missing[0].name}. Sem pressão.`)
    :`Faltam ${missing.length}. Alguém foi ao banheiro.`;
  return {visible:phase!=='hidden',phase,members,readyCount,total,selfReady,selfSpectator,headline,canManage,seatsLeft};
}

// ---------- DOM ----------

const escapeHtml=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);

/**
 * Waiting room panel inside the island shell (a modal dialog, so it must live inside it).
 * Polls client.run, shows while the run is in lobby/countdown and removes itself when the island closes.
 */
/** How long a chip waits for the confirming tap (ms) before it goes back to the name. */
export const CONFIRM_MS=3000;
/** A confirmed chip waits this long for the room before it is tappable again (lost on a bad network, refused). */
export const REARM_MS=1500;
export function mountWaitingRoom(host:HTMLElement,client:Pick<CoopClient,'code'|'id'|'run'|'players'|'ready'|'connected'>&Partial<Pick<CoopClient,'roomNotice'|'fatal'|'kick'|'addBot'|'removeBot'>>,options:{origin?:string;now?:()=>number}={}){
  const now=options.now??(()=>performance.now());
  const started=now();
  const panel=document.createElement('section');panel.className='coop-wait';panel.setAttribute('aria-label','Sala de espera');
  panel.innerHTML=`<div class="coop-wait-code"><small>SALA</small><strong></strong><button class="coop-wait-share" type="button">Chamar a turma</button></div>
    <div class="coop-wait-news" role="alert" hidden><strong></strong><span></span></div>
    <p class="coop-wait-owner" role="status" hidden></p>
    <p class="coop-wait-headline" role="status" aria-live="polite"></p>
    <ul class="coop-wait-members"></ul>
    <p class="coop-wait-line"></p>
    <div class="coop-wait-actions"><button class="coop-wait-ready" type="button" aria-pressed="false">Tô pronto!</button><button class="coop-wait-bot" type="button" hidden>${icon('robo')}<span>Adicionar bot</span></button></div>
    <p class="coop-wait-count" aria-hidden="true"></p>`;
  const $=<T extends HTMLElement>(s:string)=>panel.querySelector<T>(s)!;
  $('.coop-wait-code strong').textContent=client.code;
  // Read at each tap: the playtest's "Medir a turma" (dev only) may change what the invite carries.
  const link=()=>shareLink(options.origin??location.origin,client.code,inviteQuery(location.search));
  const shareButton=$<HTMLButtonElement>('.coop-wait-share');
  shareButton.addEventListener('click',async()=>{
    const say=(text:string)=>{shareButton.textContent=text;setTimeout(()=>{shareButton.textContent='Chamar a turma';},2500);};
    try{
      if(navigator.share){await navigator.share({title:'Viagem',text:`Bora pra sala ${client.code}? O bêbado não espera.`,url:link()});say('Convite enviado!');return;}
      await navigator.clipboard.writeText(link());say('Copiado! Manda no grupo da família.');
    }catch(error){
      if((error as DOMException)?.name==='AbortError')return;
      say(`Código: ${client.code}`);
    }
  });
  const readyButton=$<HTMLButtonElement>('.coop-wait-ready');
  let lastView:WaitingView|undefined;
  readyButton.addEventListener('click',()=>client.ready(!lastView?.selfReady));
  const botButton=$<HTMLButtonElement>('.coop-wait-bot');
  botButton.addEventListener('click',()=>{client.addBot?.();botButton.disabled=true;setTimeout(()=>{botButton.disabled=false;},400);});
  // The owner's chips (D-025): first tap asks ("Expulsar Bia? Toca de novo."), a second one between DOUBLE_TAP_MS and
  // CONFIRM_MS later does it (a bounce of the same finger is not a yes).
  let armed:{id:string;at:number;until:number}|undefined,disarm:ReturnType<typeof setTimeout>|undefined;
  const list=$('.coop-wait-members');
  list.addEventListener('click',event=>{
    const chip=(event.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
    if(!chip||!lastView?.canManage)return;
    const id=chip.dataset.id!,m=lastView.members.find(x=>x.id===id);
    if(!m||m.self)return;
    if(armed?.id===id&&now()-armed.at<DOUBLE_TAP_MS)return;
    if(armed?.id===id&&now()<=armed.until){
      armed=undefined;clearTimeout(disarm);
      if(m.bot)client.removeBot?.(id);else client.kick?.(id);
      // Gone at the next state; still there (offline, refused) after REARM_MS: the chip comes back, never a dead button.
      chip.disabled=true;clearTimeout(disarm);disarm=setTimeout(()=>{membersKey='';update();},REARM_MS);return;
    }
    armed={id,at:now(),until:now()+CONFIRM_MS};clearTimeout(disarm);disarm=setTimeout(()=>{armed=undefined;membersKey='';update();},CONFIRM_MS);
    membersKey='';update();
  });
  host.append(panel);
  let membersKey='',wasReady=new Set<string>();
  // Who owned the room last time we looked, and the names seen (the one who left is gone from the run state).
  let ownerSeen:string|undefined,ownerNews:{text:string;until:number}|undefined;
  const names=new Map<string,string>();
  // Only touch text that changed, so the polite live region is not re-announced every poll.
  const setText=(el:HTMLElement,text:string)=>{if(el.textContent!==text)el.textContent=text;};
  const update=()=>{
    if(!panel.isConnected||!host.isConnected){clearInterval(timer);clearTimeout(disarm);panel.remove();return;}
    const view=waitingRoomView(client.run,client.players,client.id);lastView=view;
    for(const m of view.members)names.set(m.id,m.name);
    const owner=client.run?.owner;
    if(owner&&owner!==ownerSeen){
      const text=ownerNotice(ownerSeen!==undefined?{name:names.get(ownerSeen)}:undefined,names.get(owner)??'Alguém',owner===client.id);
      ownerNews=text?{text,until:Infinity}:undefined;ownerSeen=owner;
    }
    // Stopped for good (kicked, another tab, version): the terminal window says why; nothing here answers any more.
    panel.hidden=!view.visible||!!client.fatal;
    if(!view.visible)return;
    panel.dataset.phase=view.phase;
    // After a restart of the room the run is gone (VGM-047, UX onda 5): the news goes on top, as a ficha, in place of
    // the headline, and the waiting joke is suspended until the next run starts.
    const news=client.roomNotice;
    panel.classList.toggle('has-notice',!!news);
    $('.coop-wait-news').hidden=!news;
    if(news){setText($('.coop-wait-news strong'),news.title);setText($('.coop-wait-news span'),news.body);}
    $('.coop-wait-headline').hidden=!!news&&view.phase!=='countdown';
    setText($('.coop-wait-headline'),view.headline);
    // The 4 s start when the island is on screen (the loading cover can sit over the room for a while on a slow phone).
    if(ownerNews?.until===Infinity&&!host.querySelector('.explore-loading:not([hidden])'))ownerNews.until=now()+OWNER_NEWS_MS;
    const ownerLine=$('.coop-wait-owner'),showNews=!!ownerNews&&now()<ownerNews.until;
    ownerLine.hidden=!showNews;if(showNews)setText(ownerLine,ownerNews!.text);
    const hint=view.canManage&&(view.members.length>1||view.seatsLeft>0);
    setText($('.coop-wait-line'),view.phase==='countdown'||news?'':hint?OWNER_HINT:waitingLine((now()-started)/1000));
    botButton.hidden=!view.canManage||view.seatsLeft<1||view.selfSpectator;
    panel.classList.toggle('is-owner',view.canManage);
    setText($('.coop-wait-count'),view.seconds!==undefined?String(view.seconds):'');
    // Ready players can still back out during the countdown (the server accepts it).
    readyButton.hidden=view.selfSpectator;
    readyButton.disabled=!client.connected;
    setText(readyButton,view.selfReady?'Ops, peraí':'Tô pronto!');
    readyButton.setAttribute('aria-pressed',String(view.selfReady));
    readyButton.classList.toggle('is-ready',view.selfReady);
    if(armed&&!view.members.some(m=>m.id===armed!.id&&!m.self))armed=undefined;
    const key=JSON.stringify([view.members,view.canManage,armed?.id]);
    if(key!==membersKey){
      membersKey=key;
      list.innerHTML=view.members.map(m=>{
        // Ready or waiting (check or clock) for everyone; a bot is always ready and wears the robot in the chip's corner,
        // so "pronto" never rests on the green alone. The crown marks the owner for everyone.
        const status=icon(m.ready?'pronto':'relogio'),robot=m.bot?`<span class="coop-wait-botmark">${icon('robo',{label:'bot'})}</span>`:'';
        const said=`${m.bot?' bot':''}${m.owner?', dono da sala':''}${m.ready?', pronto':', ainda não'}`;
        const crown=m.owner?icon('coroa',{className:'coop-wait-crown'}):'';
        // The ready pop plays once, when a chip turns ready, not on every rebuild of the list (the owner's taps rebuild it).
        // The owner's grid shows the rail's short name (unique for bots, like the HUD); the whole name is read aloud.
        const shown=view.canManage?railName(m.name):m.name;
        const cls=`${m.ready?'is-ready':''}${m.ready&&!wasReady.has(m.id)?' just-ready':''}${m.online?'':' is-away'}${m.bot?' is-bot':' is-person'}`;
        if(view.canManage&&!m.self){
          // A bot goes out by the door (neutral); a person is expelled: the cross, and a Cone edge on the chip.
          const ask=armed?.id===m.id,out=m.bot?'saiu':'fechar';
          const label=ask?confirmText(m):`${m.name}${said}. Tocar pra ${m.bot?'tirar':'expulsar'}.`;
          return `<li class="${cls}${ask?' is-asking':''}">${robot}<button type="button" data-id="${escapeHtml(m.id)}" aria-label="${escapeHtml(label)}">${ask?icon(out):status}<span>${escapeHtml(ask?confirmText(m):shown)}</span>${ask?'':crown+icon(out,{className:'coop-wait-out'})}</button></li>`;
        }
        return `<li class="${cls}">${robot}${status}<span${shown!==m.name?` aria-label="${escapeHtml(m.name)}"`:''}>${escapeHtml(shown)}</span>${m.self?' <small>(você)</small>':''}${crown}<span class="sr-only">${said}</span></li>`;
      }).join('');
      wasReady=new Set(view.members.filter(m=>m.ready).map(m=>m.id));
    }
  };
  const timer=setInterval(update,200);update();
  return {panel,update,dispose(){clearInterval(timer);panel.remove();}};
}

export async function openLobby(hero:HeroClass,name:string){
  // Loaded together (CSS stays dynamic so the pure helpers above import in node tests).
  const [,{CoopClient}]=await Promise.all([import('./coop.css'),import('./net/client.ts')]);
  const dialog=document.createElement('dialog');dialog.className='coop-lobby';dialog.setAttribute('aria-label','Jogar com amigos');
  dialog.innerHTML=`<button class="coop-close" aria-label="Fechar">${icon('fechar',{size:32})}</button><h2>Chama a turma.</h2><p>Até seis personagens na mesma sala. Compartilhe o código, encontre os amigos e enfrentem os bêbados.</p><div class="coop-nick"><label for="coop-nick">Apelido na sala</label><div><input id="coop-nick" maxlength="${NICK_MAX}" autocomplete="nickname" spellcheck="false"/><button type="button" class="coop-nick-roll" aria-label="Sortear apelido engraçado">${icon('dado')} Sortear</button></div></div><button id="create-room">Criar sala</button><div class="coop-divider">ou entre na sala de alguém</div><form><label for="room-code">Código da sala</label><input id="room-code" maxlength="10" pattern="[a-fA-F0-9]{10}" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="10 letras e números"/><button type="submit">Entrar na sala</button></form><p class="coop-status" role="status"></p><small>Partidas de até 30 minutos. Pontos desta versão valem só na sala. As classes ainda compartilham o mesmo ataque básico.</small>`;
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
  let busy=false,outdated=false;
  async function enter(create:boolean){
    if(busy||closed||outdated)return;
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
    }catch(e){
      const fatal=client?.fatal;client?.leave();
      if(closed)return;
      // Page and rooms disagree on the version: trying again gives the same refusal, so the doors close and the
      // reason shows right under them, in view in landscape too, with the reload button (UX onda 4).
      const panel=fatal?await import('./net-fatal.ts'):undefined;
      if(fatal&&panel?.needsUpdate(fatal)){
        outdated=true;status.textContent='';
        panel.showFatal(dialog.querySelector<HTMLElement>('form')!,fatal,{inline:true}).scrollIntoView({block:'center'});
        return;
      }
      status.textContent=e instanceof Error?e.message:'A conexão falhou. Tente novamente.';
    }
    finally{busy=false;for(const b of dialog.querySelectorAll<HTMLButtonElement>('button'))b.disabled=outdated&&!b.matches('.coop-close,.net-fatal-reload');}
  }
  dialog.querySelector('#create-room')!.addEventListener('click',()=>void enter(true));
  dialog.querySelector('form')!.addEventListener('submit',e=>{e.preventDefault();void enter(false);});
  for(const b of actionButtons())b.disabled=false;
  status.textContent=endpoint?'':'As salas ainda não estão disponíveis neste endereço.';
}
