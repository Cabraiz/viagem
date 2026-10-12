/**
 * End-of-run result screen (VGM-040): victory/defeat headline with a joke subtitle, run stats
 * (time, round, seed), one compact card per player (portrait, build, contribution, joke awards)
 * and the rematch/exit buttons. Mobile only (D-009): big touch targets, no hover or keyboard paths.
 * Player names always go through textContent.
 */
import type {PlayerRunView} from '../sim/view.ts';
import {railName} from '../render/map-label-rules.ts';
import {MAX_AWARDS_PER_PLAYER,awardsOf,computeAwards,type Award} from './awards.ts';
import {itemDisplay} from './items.ts';
import {sticker as drawSticker} from '../../ui/sticker.ts';
import {formatDuration,teamOrder,type HudContext,type RunResult} from './model.ts';
import {resultCause} from './cause.ts';
import {icon} from '../../ui/icon.ts';
import {WALL_DOWN_LINES} from '../sim/stonewards/rules.ts';
import {shameText} from '../fun/zueira.ts';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
  const node=document.createElement(tag);node.className=className;parent?.append(node);return node;
};

const VICTORY_LINES=[
  'O síndico foi despejado',
  'A gosma pediu arrego',
  'Condomínio liberado, churrasco confirmado',
  'Nem o boleto segurou vocês',
];
const DEFEAT_LINES=[
  'a gosma venceu',
  'o síndico manda lembranças',
  'bateu a segunda-feira',
  'faltou só… tudo',
];

/** Stable string hash (FNV-1a) so the subtitle variant is the same on every client for a seed. */
export function seedIndex(seed:string,modulo:number){
  let hash=0x811c9dc5;
  for(let i=0;i<seed.length;i++){hash^=seed.charCodeAt(i);hash=Math.imul(hash,0x01000193);}
  return modulo>0?(hash>>>0)%modulo:0;
}

export function resultHeadline(result:Pick<RunResult,'victory'|'seed'|'wall'>){
  // The wall fell (VGM-046B): the subtitle says so, with one of its jokes.
  const lines=result.victory?VICTORY_LINES:result.wall?WALL_DOWN_LINES:DEFEAT_LINES;
  return {title:result.victory?'VITÓRIA!':'DERROTA…',subtitle:lines[seedIndex(result.seed,lines.length)]};
}

/** 980 → "980", 9120 → "9,1k", 18420 → "18,4k", 123456 → "123k". */
export function compactNumber(value:number){
  const n=Math.max(0,Math.round(Number.isFinite(value)?value:0));
  if(n<1000)return String(n);
  if(n<100_000)return `${(Math.floor(n/100)/10).toFixed(1).replace('.',',').replace(',0','')}k`;
  return `${Math.floor(n/1000)}k`;
}

/** With 3+ players a card has this many build slots in one row (portrait / landscape); overflow becomes a "+N" chip. */
export const BUILD_SLOTS={portrait:5,landscape:7} as const;
const LANDSCAPE='(max-height:500px)';

/** Build icons in display order (evolutions, weapons, passives; higher level first). With more items than slots,
 * the last slot becomes the "+N" chip, so the row never wraps. */
export function buildIcons(player:Pick<PlayerRunView,'weapons'|'passives'>,slots:number){
  const rank=(id:string)=>{const kind=itemDisplay(id).kind;return kind==='evolution'?0:kind==='weapon'?1:2;};
  const all=[...player.weapons,...player.passives].map((item,index)=>({item,index}))
    .sort((a,b)=>rank(a.item.id)-rank(b.item.id)||b.item.level-a.item.level||a.index-b.index).map(entry=>entry.item);
  if(all.length<=slots)return {items:all,hidden:[] as typeof all};
  const keep=Math.max(0,slots-1);
  return {items:all.slice(0,keep),hidden:all.slice(keep)};
}

/** Who owns the room, who is still in it and what the owner may do now (D-025); from the run state. */
export interface ResultRoster {
  owner?:string;
  /** The local player owns the room (result phase: kick and bots allowed). */
  canManage:boolean;
  /** Ids still in the room: a kicked player's or removed bot's card goes away. */
  members:readonly string[];
  /** Ids of the room bots (robot sticker). */
  bots:readonly string[];
  seatsLeft:number;
  /** Players in the room but not in the result (a bot added on this screen): a card without numbers worth reading. */
  extra:readonly PlayerRunView[];
}
/** The owner's buttons on a card: the verb, and the one-tap confirmation with the name. */
export const manageLabel=(player:Pick<PlayerRunView,'name'>&{bot?:boolean},asking:boolean)=>
  asking?`${player.bot?'Tirar':'Expulsar'} ${railName(player.name)}? Toca de novo.`:(player.bot?'Tirar bot':'Expulsar');
/** The owner's button on the result: what it does, with no room for "turma" to read as the team's score. */
export const MANAGE_LABEL='Arrumar a sala';
const CONFIRM_MS=3000,REARM_MS=1500,DOUBLE_TAP_MS=500;

const CONFETTI=18;
const CONFETTI_COLORS=['#f2c94c','#ed6f72','#75b8a6','#9fd8ff','#c8a8ff','#ffb347'];

export function createResultScreen(options:{onRematch():void;onExit?():void;onKick?(id:string):void;onAddBot?():void;onRemoveBot?(id:string):void}){
  const root=el('section','rh-result');
  root.hidden=true;
  root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-labelledby','rh-result-title');

  const fx=el('div','rh-result-fx',root);fx.setAttribute('aria-hidden','true');
  for(let i=0;i<CONFETTI;i++){
    const bit=el('i','rh-confetti',fx);
    bit.style.setProperty('--x',`${(i*37+11)%100}%`);
    bit.style.setProperty('--d',`${(i%6)*0.12}s`);
    bit.style.setProperty('--r',`${((i*53)%5-2)*160}deg`);
    bit.style.setProperty('--c',CONFETTI_COLORS[i%CONFETTI_COLORS.length]);
  }

  const head=el('header','rh-result-head',root);
  const titles=el('div','rh-result-titles',head);
  const title=el('h2','rh-result-title',titles);title.id='rh-result-title';
  const subtitle=el('p','rh-result-sub',titles);
  const stats=el('div','rh-result-stats',head);
  const time=el('span','rh-result-stat',stats),round=el('span','rh-result-stat',stats),seed=el('span','rh-result-seed',stats);
  // What downed you (UX-voce-e-dano f): critter sticker + name, one line.
  const cause=el('span','rh-result-stat rh-result-cause',stats);cause.hidden=true;
  const causeIcon=el('img','',cause);causeIcon.alt='';causeIcon.decoding='async';causeIcon.draggable=false;
  const causeText=el('span','',cause);

  // "Momento mais vergonhoso" (VGM-053B): a notice on the condo board, from the server's moment; hidden without one.
  const shame=el('aside','rh-result-shame',root);shame.hidden=true;
  const shameIcon=el('span','rh-result-shame-icon',shame);shameIcon.setAttribute('aria-hidden','true');
  const shameBody=el('p','rh-result-shame-body',shame);
  const shameTitle=el('strong','rh-result-shame-title',shameBody);shameTitle.textContent='Momento mais vergonhoso';
  const shameLine=el('span','rh-result-shame-text',shameBody),shameJoke=el('small','rh-result-shame-joke',shameBody);

  const grid=el('div','rh-result-grid',root);

  const actions=el('div','rh-result-actions',root);
  const rematch=el('button','rh-result-btn rh-result-rematch',actions);rematch.type='button';
  // The owner's "Arrumar turma" (D-025): the cards trade their prizes for "Expulsar" / "Tirar bot", plus "Adicionar bot".
  const manage=el('button','rh-result-btn rh-result-manage',actions);manage.type='button';manage.hidden=true;
  const exit=el('button','rh-result-btn rh-result-exit',actions);exit.type='button';exit.textContent='Sair';
  exit.hidden=!options.onExit;
  let roster:ResultRoster|undefined,managing=false,armed:{id:string;at:number;until:number}|undefined,disarm:ReturnType<typeof setTimeout>|undefined,rosterKey='';
  const syncManage=()=>{
    const can=!!roster?.canManage;if(!can)managing=false;
    manage.hidden=!can;manage.setAttribute('aria-pressed',String(managing));
    // Portrait has three buttons in 350 px: the crown and "Turma"; landscape has room for the whole verb.
    manage.innerHTML=managing?'Feito':`${icon('coroa')}<span>${MANAGE_LABEL}</span>`;
    manage.setAttribute('aria-label',managing?'Feito, voltar aos prêmios':`${MANAGE_LABEL}: expulsar, tirar ou pôr bot`);
    actions.classList.toggle('has-manage',can);
    root.classList.toggle('is-managing',managing);
  };
  manage.addEventListener('click',()=>{managing=!managing;armed=undefined;syncManage();if(shownResult)renderGrid(shownResult.result,shownResult.ctx);});
  // Head (landscape) and actions share a row: CSS moves them via grid areas, DOM order stays readable.

  let asked=false;
  const resetRematch=()=>{asked=false;rematch.disabled=false;rematch.textContent='Revanche';rematch.classList.remove('rh-waiting');};
  rematch.addEventListener('click',()=>{
    if(asked)return;
    asked=true;
    rematch.disabled=true;rematch.textContent='Esperando a galera…';rematch.classList.add('rh-waiting');
    options.onRematch();
  });
  let exited=false;
  exit.addEventListener('click',()=>{if(exited)return;exited=true;options.onExit?.();});

  /** The chip of the shamed player's card (used when the notice on top does not fit the six cards). */
  let shameChip:{playerId:string;line:string;aria:string;key:string;source?:string}|undefined;
  /** The chip element and its card's list, while built (inserted only when used: the compact rules count children). */
  let chipEl:{chip:HTMLElement;list:HTMLElement}|undefined;
  const card=(player:PlayerRunView,awards:readonly Award[],ctx:HudContext&{slots:number},index:number)=>{
    const node=el('article','rh-rcard');
    node.style.setProperty('--i',String(index));
    const me=player.id===ctx.localId;
    node.classList.toggle('rh-me',me);
    if(player.spectator)node.dataset.state='spectator';

    const top=el('div','rh-rcard-top',node);
    const img=el('img','rh-rcard-img',top);img.alt='';img.decoding='async';img.draggable=false;img.src=ctx.portrait(player.classId);
    const id=el('div','rh-rcard-id',top);
    const name=el('strong','rh-rcard-name',id);name.textContent=player.name;
    if(me){const tag=el('span','rh-rcard-tag',id);tag.textContent='Você';}
    // Robot sticker for a room bot, paper crown for the owner (D-025): shape, not color.
    const bot=player.bot||roster?.bots.includes(player.id);
    if(bot){const mark=el('span','rh-rcard-mark',id);mark.innerHTML=icon('robo',{label:'bot'});node.dataset.bot='true';}
    if(roster?.owner===player.id){const mark=el('span','rh-rcard-mark',id);mark.innerHTML=icon('coroa',{label:'dono da sala'});}

    const build=el('ul','rh-rcard-build',top);
    build.setAttribute('aria-label','Build');
    const shown=buildIcons(player,ctx.slots);
    for(const item of shown.items){
      const info=itemDisplay(item.id);
      const li=el('li','rh-rbuild',build);li.dataset.kind=info.kind;
      li.setAttribute('aria-label',`${info.name} nível ${item.level}`);
      el('span','rh-rbuild-icon',li).innerHTML=drawSticker(info.icon);
      const level=el('b','rh-rbuild-level',li);level.textContent=info.kind==='evolution'?'★':String(item.level);
    }
    if(shown.hidden.length){
      const more=el('li','rh-rbuild rh-rbuild-more',build);more.textContent=`+${shown.hidden.length}`;
      more.setAttribute('aria-label',`e mais: ${shown.hidden.map(item=>`${itemDisplay(item.id).name} nível ${item.level}`).join(', ')}`);
    }

    const numbers=el('dl','rh-rcard-stats',node);
    const s=player.stats;
    const tally=ctx.tally.players.get(player.id);
    const rows:[string,number][]=[
      ['dano',s?.damage??0],
      ['abates',Math.max(s?.kills??0,tally?.kills??0)],
      ['salvou',Math.max(s?.revives??0,tally?.revives??0)],
      ['coletas',Math.max(s?.pickups??0,tally?.pickups??0)],
    ];
    for(const [label,value] of rows){
      const cell=el('div','rh-rstat',numbers);
      const dd=el('dd','rh-rstat-value',cell);dd.textContent=compactNumber(value);
      const dt=el('dt','rh-rstat-label',cell);dt.textContent=label;
    }

    const list=el('ul','rh-rcard-awards',node);
    if(shameChip&&shameChip.playerId===player.id){
      const chip=el('li','rh-award rh-award-shame');chip.dataset.key=shameChip.key;chip.setAttribute('aria-label',shameChip.aria);chipEl={chip,list};
      const mark=el('span','rh-award-emoji',chip);mark.setAttribute('aria-hidden','true');
      const sticker=shameChip.source?ctx.critterIcon?.(shameChip.source):undefined;
      if(sticker){const img=document.createElement('img');img.src=sticker;img.alt='';img.decoding='async';img.draggable=false;mark.replaceChildren(img);}else mark.innerHTML=icon('suor');
      const text=el('span','rh-award-text',chip);
      const name=el('strong','rh-award-title',text);name.textContent='Momento mais vergonhoso';
      const line=el('small','rh-award-line',text);line.textContent=shameChip.line;
    }
    for(const award of awards){
      const chip=el('li','rh-award',list);
      const mark=el('span','rh-award-emoji',chip);mark.innerHTML=drawSticker(award.icon);mark.setAttribute('aria-hidden','true');
      const text=el('span','rh-award-text',chip);
      const name=el('strong','rh-award-title',text);name.textContent=award.title;
      const line=el('small','rh-award-line',text);line.textContent=award.line;
    }
    list.hidden=!awards.length;
    if(managing&&!me){
      const asking=armed?.id===player.id,who={name:player.name,bot:!!bot};
      // A bot goes out by the door (the neutral button); a person is expelled: the cross, outlined in Cone, lighter.
      const button=el('button',`rh-rcard-manage ${bot?'is-bot':'is-person'}`,node);button.type='button';button.dataset.id=player.id;
      button.classList.toggle('is-asking',asking);
      button.innerHTML=`${icon(bot?'saiu':'fechar')}<span></span>`;button.querySelector('span')!.textContent=manageLabel(who,asking);
      button.setAttribute('aria-label',asking?manageLabel(who,true):`${manageLabel(who,false)}: ${player.name}`);
      button.addEventListener('click',()=>{
        if(armed?.id===player.id&&Date.now()-armed.at<DOUBLE_TAP_MS)return; // the same finger bouncing
        if(armed?.id===player.id&&Date.now()<=armed.until){
          armed=undefined;clearTimeout(disarm);button.disabled=true;
          if(bot)options.onRemoveBot?.(player.id);else options.onKick?.(player.id);
          // The card goes with the next room state; if it is still here (bad network, refused), the button comes back.
          disarm=setTimeout(()=>{if(shownResult)renderGrid(shownResult.result,shownResult.ctx);},REARM_MS);
          return;
        }
        armed={id:player.id,at:Date.now(),until:Date.now()+CONFIRM_MS};clearTimeout(disarm);
        disarm=setTimeout(()=>{armed=undefined;if(shownResult)renderGrid(shownResult.result,shownResult.ctx);},CONFIRM_MS);
        if(shownResult)renderGrid(shownResult.result,shownResult.ctx);
      });
    }
    return node;
  };
  /** "Adicionar bot" as one more card in the grid while the owner arranges the room and a seat is free. */
  const addTile=()=>{
    const node=el('article','rh-rcard rh-rcard-add');
    const button=el('button','rh-rcard-manage rh-rcard-addbot',node);button.type='button';
    button.innerHTML=`${icon('robo',{size:32})}<span>Adicionar bot</span>`;
    button.addEventListener('click',()=>{button.disabled=true;options.onAddBot?.();setTimeout(()=>{button.disabled=false;},400);});
    return node;
  };

  // Build slots depend on orientation, so the grid is rebuilt when the phone turns (the cards just fade in again).
  let shownResult:{result:RunResult;ctx:HudContext;awards:Award[]}|undefined;
  const landscape=typeof matchMedia==='function'?matchMedia(LANDSCAPE):undefined;
  const renderGrid=(result:RunResult,ctx:HudContext)=>{
    // The prizes were decided when the run ended; a kick or a new bot on this screen moves cards, never prizes.
    const awards=shownResult?.result===result?shownResult.awards:computeAwards(result,ctx.tally);
    const inRoom=roster?[...result.players.filter(p=>roster!.members.includes(p.id)),...roster.extra.filter(p=>!result.players.some(q=>q.id===p.id))]:result.players;
    const players=teamOrder(inRoom,ctx.localId);
    const tile=managing&&!!roster&&roster.seatsLeft>0;
    const count=players.length+(tile?1:0);
    const slots=count>=3?BUILD_SLOTS[landscape?.matches?'landscape':'portrait']:Infinity;
    grid.dataset.count=String(count);chipEl=undefined;
    grid.replaceChildren(...players.map((player,index)=>card(player,awardsOf(awards,player.id),{...ctx,slots},index)),...(tile?[addTile()]:[]));
    fitShame();
  };
  /**
   * The notice on top when the cards still fit under it (up to four players); otherwise it moves into the shamed
   * player's card as its first chip (that card keeps two chips at most), so six cards never scroll (VGM-053B).
   */
  const fitShame=()=>{
    if(!chipEl||!shameChip){shame.hidden=true;return;}
    const {chip,list}=chipEl,extra=[...list.querySelectorAll<HTMLElement>('.rh-award:not(.rh-award-shame)')].slice(MAX_AWARDS_PER_PLAYER-1);
    chip.remove();for(const a of extra)a.hidden=false;list.hidden=!list.children.length;
    shame.hidden=false;
    // Five or six cards (four in landscape: two rows) never have room for the notice (measured at 390×844 and 844×390,
    // 100% and 125%, long names); fewer only move it when they would scroll.
    const crowded=grid.children.length>=(landscape?.matches?4:5);
    if(!crowded&&(root.hidden||grid.scrollHeight<=grid.clientHeight+1))return;
    shame.hidden=true;list.prepend(chip);list.hidden=false;for(const a of extra)a.hidden=true;
  };
  const onTurn=()=>{if(shownResult&&!root.hidden)renderGrid(shownResult.result,shownResult.ctx);};
  landscape?.addEventListener('change',onTurn);

  return {
    el:root,
    show(result:RunResult,ctx:HudContext){
      const headline=resultHeadline(result);
      root.dataset.outcome=result.victory?'victory':'defeat';
      title.textContent=headline.title;
      subtitle.textContent=headline.subtitle;
      time.innerHTML=`${icon('relogio')} ${formatDuration(result.durationTicks)}`;
      round.textContent=`Round ${result.round}/${result.totalRounds}`;
      seed.textContent=`seed ${result.seed}`;
      const fell=resultCause(ctx.tally.causes,ctx.localId);
      cause.hidden=!fell;
      if(fell){causeText.textContent=fell.text;const src=ctx.critterIcon?.(fell.kind)??'';causeIcon.hidden=!src;if(src)causeIcon.src=src;cause.dataset.kind=fell.kind;}
      const moment=result.shame,who=moment&&result.players.find(p=>p.id===moment.player);
      shame.hidden=!moment||!who;shameChip=undefined;
      if(moment&&who){
        const copy=shameText(moment,who.id===ctx.localId?'Você':who.name);
        // On the card the joke goes (design review D8): the sticker and the card already say who and what.
        shameChip={playerId:who.id,line:copy.joke,aria:`Momento mais vergonhoso: ${copy.text} ${copy.joke}`,key:moment.key,...(moment.source?{source:moment.source}:{})};
        shameLine.textContent=copy.text;shameJoke.textContent=copy.joke;
        const sticker=moment.source?ctx.critterIcon?.(moment.source):undefined;
        if(sticker){const img=document.createElement('img');img.src=sticker;img.alt='';img.decoding='async';img.draggable=false;shameIcon.replaceChildren(img);}
        else shameIcon.innerHTML=icon('suor',{size:32});
        shame.dataset.key=moment.key;
      }
      shownResult={result,ctx,awards:computeAwards(result,ctx.tally)};
      managing=false;armed=undefined;syncManage();
      renderGrid(result,ctx);
      resetRematch();exited=false;
      root.hidden=false;
      fitShame();
      // Restart the entrance animation on every show.
      root.classList.remove('rh-result-in');void root.offsetWidth;root.classList.add('rh-result-in');
    },
    hide(){shownResult=undefined;managing=false;armed=undefined;clearTimeout(disarm);root.hidden=true;root.classList.remove('rh-result-in','is-managing');},
    /** Owner, bots and who is still in the room (D-025); the grid follows only when something changed. */
    setRoster(next:ResultRoster){
      const key=JSON.stringify(next);
      if(key===rosterKey)return;
      rosterKey=key;roster=next;
      if(armed&&!next.members.includes(armed.id))armed=undefined;
      syncManage();
      if(shownResult&&!root.hidden){root.classList.remove('rh-result-in');renderGrid(shownResult.result,shownResult.ctx);}
    },
    /** The room refused the rematch (not enough lifetime left): the button stops waiting and says what to do. */
    refuse(label:string){asked=true;rematch.disabled=true;rematch.classList.remove('rh-waiting');rematch.textContent=label;},
    destroy(){landscape?.removeEventListener('change',onTurn);clearTimeout(disarm);root.remove();},
  };
}
