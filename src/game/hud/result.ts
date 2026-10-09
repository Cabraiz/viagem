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

  const card=(player:PlayerRunView,awards:readonly Award[],ctx:HudContext,index:number)=>{
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
    for(const item of [...player.weapons,...player.passives]){
      const info=itemDisplay(item.id);
      const li=el('li','rh-rbuild',build);li.dataset.kind=info.kind;
      li.setAttribute('aria-label',`${info.name} nível ${item.level}`);
      const icon=el('span','rh-rbuild-icon',li);icon.textContent=info.icon;
      const level=el('b','rh-rbuild-level',li);level.textContent=info.kind==='evolution'?'★':String(item.level);
    }

    const numbers=el('dl','rh-rcard-stats',node);
    const s=player.stats;
    const tally=ctx.tally.players.get(player.id);
    const rows:[string,number][]=[
      ['dano',s?.damage??0],
      ['abates',Math.max(s?.kills??0,tally?.kills??0)],
      ['resgates',Math.max(s?.revives??0,tally?.revives??0)],
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
      const players=teamOrder(result.players,ctx.localId);
      const awards=computeAwards(result,ctx.tally);
      grid.dataset.count=String(players.length);
      grid.replaceChildren(...players.map((player,index)=>card(player,awardsOf(awards,player.id),ctx,index)));
      resetRematch();exited=false;
      root.hidden=false;
      // Restart the entrance animation on every show.
      root.classList.remove('rh-result-in');void root.offsetWidth;root.classList.add('rh-result-in');
    },
    hide(){root.hidden=true;root.classList.remove('rh-result-in');},
    destroy(){root.remove();},
  };
}
