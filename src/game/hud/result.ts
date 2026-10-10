/**
 * End-of-run result screen (VGM-040): victory/defeat headline with a joke subtitle, run stats
 * (time, round, seed), one compact card per player (portrait, build, contribution, joke awards)
 * and the rematch/exit buttons. Mobile only (D-009): big touch targets, no hover or keyboard paths.
 * Player names always go through textContent.
 */
import type {PlayerRunView} from '../sim/view.ts';
import {awardsOf,computeAwards,type Award} from './awards.ts';
import {itemDisplay} from './items.ts';
import {formatDuration,teamOrder,type HudContext,type RunResult} from './model.ts';
import {resultCause} from './cause.ts';

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

export function resultHeadline(result:Pick<RunResult,'victory'|'seed'>){
  const lines=result.victory?VICTORY_LINES:DEFEAT_LINES;
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

const CONFETTI=18;
const CONFETTI_COLORS=['#f2c94c','#ed6f72','#75b8a6','#9fd8ff','#c8a8ff','#ffb347'];

export function createResultScreen(options:{onRematch():void;onExit?():void}){
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

  const grid=el('div','rh-result-grid',root);

  const actions=el('div','rh-result-actions',root);
  const rematch=el('button','rh-result-btn rh-result-rematch',actions);rematch.type='button';
  const exit=el('button','rh-result-btn rh-result-exit',actions);exit.type='button';exit.textContent='Sair';
  exit.hidden=!options.onExit;
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

    const build=el('ul','rh-rcard-build',top);
    build.setAttribute('aria-label','Build');
    const shown=buildIcons(player,ctx.slots);
    for(const item of shown.items){
      const info=itemDisplay(item.id);
      const li=el('li','rh-rbuild',build);li.dataset.kind=info.kind;
      li.setAttribute('aria-label',`${info.name} nível ${item.level}`);
      const icon=el('span','rh-rbuild-icon',li);icon.textContent=info.icon;
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
    for(const award of awards){
      const chip=el('li','rh-award',list);
      const emoji=el('span','rh-award-emoji',chip);emoji.textContent=award.emoji;emoji.setAttribute('aria-hidden','true');
      const text=el('span','rh-award-text',chip);
      const name=el('strong','rh-award-title',text);name.textContent=award.title;
      const line=el('small','rh-award-line',text);line.textContent=award.line;
    }
    list.hidden=!awards.length;
    return node;
  };

  // Build slots depend on orientation, so the grid is rebuilt when the phone turns (the cards just fade in again).
  let shownResult:{result:RunResult;ctx:HudContext}|undefined;
  const landscape=typeof matchMedia==='function'?matchMedia(LANDSCAPE):undefined;
  const renderGrid=(result:RunResult,ctx:HudContext)=>{
    const players=teamOrder(result.players,ctx.localId);
    const slots=players.length>=3?BUILD_SLOTS[landscape?.matches?'landscape':'portrait']:Infinity;
    const awards=computeAwards(result,ctx.tally);
    grid.dataset.count=String(players.length);
    grid.replaceChildren(...players.map((player,index)=>card(player,awardsOf(awards,player.id),{...ctx,slots},index)));
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
      time.textContent=`⏱ ${formatDuration(result.durationTicks)}`;
      round.textContent=`Round ${result.round}/${result.totalRounds}`;
      seed.textContent=`seed ${result.seed}`;
      const fell=resultCause(ctx.tally.causes,ctx.localId);
      cause.hidden=!fell;
      if(fell){causeText.textContent=fell.text;const src=ctx.critterIcon?.(fell.kind)??'';causeIcon.hidden=!src;if(src)causeIcon.src=src;cause.dataset.kind=fell.kind;}
      shownResult={result,ctx};
      renderGrid(result,ctx);
      resetRematch();exited=false;
      root.hidden=false;
      // Restart the entrance animation on every show.
      root.classList.remove('rh-result-in');void root.offsetWidth;root.classList.add('rh-result-in');
    },
    hide(){shownResult=undefined;root.hidden=true;root.classList.remove('rh-result-in');},
    /** The room refused the rematch (not enough lifetime left): the button stops waiting and says what to do. */
    refuse(label:string){asked=true;rematch.disabled=true;rematch.classList.remove('rh-waiting');rematch.textContent=label;},
    destroy(){landscape?.removeEventListener('change',onTurn);root.remove();},
  };
}
