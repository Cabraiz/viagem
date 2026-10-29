/**
 * End-of-run result screen (VGM-040): victory/defeat headline with a joke subtitle, run stats
 * (time, round, seed), one compact card per player (portrait, build, contribution, joke awards)
 * and the rematch/exit buttons. Mobile only (D-009): big touch targets, no hover or keyboard paths.
 * Player names always go through textContent.
 */
import type {PlayerRunView} from '../../contract/index.ts';
import {railName} from '../render/map-label-rules.ts';
import {MAX_AWARDS_PER_PLAYER,awardsOf,computeAwards,type Award} from './awards.ts';
import {itemDisplay} from './items.ts';
import {sticker as drawSticker} from '../ui/sticker.ts';
import {formatDuration,teamOrder,type HudContext,type RunResult} from './model.ts';
import {causeCopy,resultCause,topCause,type CauseLog} from './cause.ts';
import {shareCard,shareResultImage} from './share-result.ts';
import {icon} from '../ui/icon.ts';
import {faceExpression,faceImg} from '../ui/face-crop.ts';
import {WALL_DOWN_LINES} from '../../rules/index.ts';
import {shameText} from '../fun/zueira.ts';
import type {MapId} from '../../protocol/index.ts';
import {objectiveBill,vaquinhaLine} from './chaveiro.ts';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
  const node=document.createElement(tag);node.className=className;parent?.append(node);return node;
};

const VICTORY_LINES=[
  'O síndico foi despejado',
  'O bêbado pediu a saideira',
  'Condomínio liberado, churrasco confirmado',
  'Nem o boleto segurou vocês',
];
const DEFEAT_LINES=[
  'o agiota cobrou com juros',
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

export function resultHeadline(result:Pick<RunResult,'victory'|'seed'|'wall'|'objective'>){
  // The chaveiro (D-047): the subtitle is why it ended (aberto, perda total, time caído, timeout).
  if(result.objective)return {title:result.victory?'Vitória!':'Derrota…',subtitle:objectiveBill(result.objective).reason};
  // The wall fell (VGM-046B): the subtitle says so, with one of its jokes.
  const lines=result.victory?VICTORY_LINES:result.wall?WALL_DOWN_LINES:DEFEAT_LINES;
  return {title:result.victory?'Vitória!':'Derrota…',subtitle:lines[seedIndex(result.seed,lines.length)]};
}

/** RunResult plus the room's map (cidade-10, explore.ts runResult): absent on the island and in older callers. */
export type MapRunResult=RunResult&{map?:MapId};
/** The stats line's last item: the city by name; elsewhere nothing (the seed is debug, revisao-visual §2.6). */
/**
 * The head's round line: "Rodada 3 de 10", "Onda N" with the chaveiro (D-047), or, in the nests mode (D-051, no waves),
 * the nests the team took down ("Ninhos 2/5"); the run's time already has its own line beside it.
 */
export function resultRoundLine(result:Pick<RunResult,'round'|'totalRounds'|'objective'>,nests?:{down:number;total:number}):string{
  if(nests&&result.objective)return `Ninhos ${nests.down}/${nests.total}`;
  return result.objective?objectiveBill(result.objective).wave:`Rodada ${result.round} de ${result.totalRounds}`;
}
export function resultSeedText(result:Pick<MapRunResult,'seed'|'map'>){
  return result.map==='cidade-nevada'?'Cidade Nevada':'';
}

/**
 * The defeat's second line (UX-resultado-revanche): "O que derrubou a turma: Tio do Pavê (4 quedas)" and, with rounds,
 * "Faltou 3 rodadas pro síndico". Undefined on a win or with nothing to say.
 */
export function defeatLine(result:Pick<RunResult,'victory'|'round'|'totalRounds'|'objective'>,causes:CauseLog){
  if(result.victory)return undefined;
  const parts:string[]=[];
  const team=topCause(causes);
  if(team)parts.push(`O que derrubou a turma: ${causeCopy(team.kind).name} (${team.count} ${team.count===1?'queda':'quedas'})`);
  const left=result.objective?0:result.totalRounds-result.round;
  if(left>0)parts.push(`Faltou ${left===1?'1 rodada':`${left} rodadas`} pro síndico`);
  return parts.length?parts.join('. '):undefined;
}

/** The room's rematch vote (RunState.rematchVotes): who said "topa", who is asked (people online) and the majority's clock. */
export interface RematchVotes {votes:readonly string[];voters:readonly string[];leftTicks?:number}
/**
 * The rematch button's words: "Revanche (2/4)" before the local vote, "Topei! (2/4)" after it, "Começa em 7 s (3/4)"
 * while a majority waits for the rest. A solo room says just "Revanche"; an older room (no votes) keeps its old words.
 */
export function rematchLabel(votes:RematchVotes|undefined,localId:string,asked:boolean,hz=20){
  if(!votes)return asked?'Esperando a galera…':'Revanche';
  const total=votes.voters.length,yes=votes.votes.filter(id=>votes.voters.includes(id)).length;
  const count=total>1?` (${yes}/${total})`:'';
  const mine=asked||votes.votes.includes(localId);
  if(votes.leftTicks!==undefined&&mine)return `Começa em ${Math.max(1,Math.ceil(votes.leftTicks/hz))} s${count}`;
  return `${mine?'Topei!':'Revanche'}${count}`;
}

/** 980 → "980", 9120 → "9,1k", 18420 → "18,4k", 123456 → "123k". */
export function compactNumber(value:number){
  const n=Math.max(0,Math.round(Number.isFinite(value)?value:0));
  if(n<1000)return String(n);
  if(n<100_000)return `${(Math.floor(n/100)/10).toFixed(1).replace('.',',').replace(',0','')}k`;
  return `${Math.floor(n/1000)}k`;
}

/** With 3+ players a card has this many build slots in one row (portrait / landscape); overflow becomes a "+N" chip.
 *  Slots are 28 px stickers 6 px apart (design review of DSG-adesivos-itens): 118 px beside the portrait fits 3, 207 px fits 6. */
export const BUILD_SLOTS={portrait:3,landscape:6} as const;
/** The card face's largest CSS size (hud.css .rh-rcard-img): 64 px with one or two cards, 40 px otherwise. */
export const RESULT_FACE_PX={big:64,card:40} as const;
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
/** The same verb where three buttons share one row (portrait): the crown says whose button it is (BUG-resultado-dono-6p-rola). */
export const MANAGE_SHORT='Arrumar';
/** The result's picture button: the same word on every screen, and what it does for screen readers and the tooltip. */
export const SHARE_LABEL='Foto',SHARE_ARIA='Foto dos prêmios: compartilhar';
/**
 * What "Foto" says for a moment after a try (compartilhar-avisa-falha): a failure and a download speak, on the button
 * (short, it is narrow) and to the screen reader (whole); a share or a cancel the player saw happen stay quiet.
 */
export function shareOutcome(how:'shared'|'downloaded'|'cancelled'|'failed'):{label:string;say:string}|undefined{
  if(how==='failed')return {label:'Não deu',say:'Não deu pra compartilhar. Tente de novo.'};
  if(how==='downloaded')return {label:'Salva',say:'Imagem salva'};
  return undefined;
}
export const SHARE_OUTCOME_MS=2500;
/**
 * The candidates for a card's name, longest first (design review of pacote-bugs-ux: "Seu", "Tia" alone lose the person,
 * and a name is never cut inside a word without "…"): the whole name, then whole words with "…", then the first word
 * cut with "…". The card writes the first that fits its lines (fitCardName). A last word of one digit stays, as on the
 * rail (railName): two bots of one class, "Viciado em Bet" and "Viciado em Bet 2", never both read "Viciado em…".
 */
export function nameCandidates(name:string):string[]{
  const full=name.trim(),all=full.split(/\s+/).filter(Boolean),out=[full];
  const num=all.length>1&&/^\d$/.test(all.at(-1)!)?` ${all.at(-1)}`:'',words=num?all.slice(0,-1):all;
  for(let k=words.length-1;k>=1;k--)out.push(`${words.slice(0,k).join(' ')}…${num}`);
  const first=[...(words[0]??'')];
  for(let n=first.length-1;n>=1;n--)out.push(`${first.slice(0,n).join('')}…${num}`);
  return out;
}
/** Writes into `el` the longest candidate of `name` that takes at most `lines` lines and has no word poking out. */
export function fitCardName(el:HTMLElement,name:string,lines:number){
  // offsetHeight, not the client rect: the PC card is zoomed (hud.css) and the rect would count the zoom the line height doesn't
  const line=parseFloat(getComputedStyle(el).lineHeight)||0;
  const fits=()=>el.scrollWidth<=el.clientWidth+1&&(!line||el.offsetHeight<=line*lines+1);
  for(const text of nameCandidates(name)){el.textContent=text;if(fits())return text;}
  return el.textContent;
}
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
  // The defeat's "O que derrubou a turma … Faltou N rodadas pro síndico" (UX-resultado-revanche).
  const lost=el('p','rh-result-lost',titles);lost.hidden=true;
  const stats=el('div','rh-result-stats',head);
  const time=el('span','rh-result-stat',stats),round=el('span','rh-result-stat',stats),seed=el('span','rh-result-seed',stats);
  // What downed you (UX-voce-e-dano f): critter sticker + name, one line.
  const cause=el('span','rh-result-stat rh-result-cause',stats);cause.hidden=true;
  const causeIcon=el('img','',cause);causeIcon.alt='';causeIcon.decoding='async';causeIcon.draggable=false;
  const causeText=el('span','',cause);
  // The chaveiro's bill (D-047): one ficha, the budget and the team's Grana; on a win he was not paid in full it wears
  // Cone and adds what was missing (the subtitle says "Vitória com dívida: abriu e levou o volante."). One more ficha of
  // the stats line: a wide screen keeps one row; 390×844 wraps it to a second row and six cards still fit under it.
  const bill=el('span','rh-result-stat rh-result-conta',stats);bill.hidden=true;bill.setAttribute('role','img');
  // The vaquinha (carteira-e-pix): who put how much into the bill, the R$ 0 with its joke; one more ficha, it wraps.
  const vaquinha=el('span','rh-result-stat rh-result-vaquinha',stats);vaquinha.hidden=true;

  // "Momento mais vergonhoso" (VGM-053B): a notice on the condo board, from the server's moment; hidden without one.
  const shame=el('aside','rh-result-shame',root);shame.hidden=true;
  const shameIcon=el('span','rh-result-shame-icon',shame);shameIcon.setAttribute('aria-hidden','true');
  const shameBody=el('p','rh-result-shame-body',shame);
  const shameTitle=el('strong','rh-result-shame-title',shameBody);shameTitle.textContent='Momento mais vergonhoso';
  const shameLine=el('span','rh-result-shame-text',shameBody),shameJoke=el('small','rh-result-shame-joke',shameBody);

  const grid=el('div','rh-result-grid',root);

  // The enemies the local hero killed that became matches (hud/perfis.ts fillResult); hidden with none.
  const matches=el('section','rh-result-matches',root);matches.hidden=true;matches.setAttribute('aria-label','Seus matches');
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
    // Landscape and wide rows say the whole verb; portrait's single row of three says "Arrumar" (CSS picks one).
    manage.innerHTML=managing?'Feito':`${icon('coroa')}<span class="rh-manage-long">${MANAGE_LABEL}</span><span class="rh-manage-short">${MANAGE_SHORT}</span>`;
    manage.setAttribute('aria-label',managing?'Feito, voltar aos prêmios':`${MANAGE_LABEL}: expulsar, tirar ou pôr bot`);
    actions.classList.toggle('has-manage',can);
    root.classList.toggle('is-managing',managing);
  };
  manage.addEventListener('click',()=>{managing=!managing;armed=undefined;syncManage();if(shownResult)renderGrid(shownResult.result,shownResult.ctx);});
  // Head (landscape) and actions share a row: CSS moves them via grid areas, DOM order stays readable.

  let asked=false,refused=false,rematchVotes:RematchVotes|undefined,localId='';
  /** Cards opened with a tap (all four numbers), by player id; cleared on every new result. */
  const openCards=new Set<string>();
  const syncRematch=()=>{
    if(refused)return;
    const mine=asked||!!rematchVotes?.votes.includes(localId);
    rematch.disabled=mine;rematch.textContent=rematchLabel(rematchVotes,localId,mine);rematch.classList.toggle('rh-waiting',mine);
  };
  const resetRematch=()=>{asked=false;refused=false;rematchVotes=undefined;syncRematch();};
  rematch.addEventListener('click',()=>{
    if(asked)return;
    asked=true;syncRematch();
    options.onRematch();
  });
  // "Foto" (camera sticker): a picture of the prizes for the group chat. One word on every screen (resultado-e-topo-com-rotulo:
  // the icon alone in portrait read as nothing): beside the sticker where the row is wide, under it where four buttons share it.
  const share=el('button','rh-result-btn rh-result-share');share.type='button';
  share.innerHTML=`${drawSticker('camera',{size:24})}<span class="rh-share-label">${SHARE_LABEL}</span>`;share.setAttribute('aria-label',SHARE_ARIA);share.title=SHARE_ARIA;
  const shareLabel=share.querySelector<HTMLElement>('.rh-share-label')!;
  const shareSaid=el('span','rh-sr');shareSaid.setAttribute('role','status');
  let shareTimer:ReturnType<typeof setTimeout>|undefined;
  const shareSay=(how:Parameters<typeof shareOutcome>[0])=>{
    clearTimeout(shareTimer);
    const out=shareOutcome(how);
    shareLabel.textContent=out?.label??SHARE_LABEL;shareSaid.textContent=out?.say??'';
    if(out)shareTimer=setTimeout(()=>{shareLabel.textContent=SHARE_LABEL;shareSaid.textContent='';},SHARE_OUTCOME_MS);
  };
  share.addEventListener('click',()=>{
    if(!shownResult||share.disabled)return;
    share.disabled=true;
    const {result,ctx,awards}=shownResult,players=teamOrder(result.players,ctx.localId);
    void shareResultImage(document,shareCard(resultHeadline(result),players,awards,ctx.localId),result.victory)
      .then(shareSay,()=>shareSay('failed')).finally(()=>{share.disabled=false;});
  });
  actions.insertBefore(share,exit);actions.insertBefore(shareSaid,exit);
  let exited=false;
  exit.addEventListener('click',()=>{if(exited)return;exited=true;options.onExit?.();});

  /** The chip of the shamed player's card (used when the notice on top does not fit the six cards). */
  let shameChip:{playerId:string;line:string;aria:string;key:string;source?:string}|undefined;
  /** The chip element and its card's list, while built (inserted only when used: the compact rules count children). */
  let chipEl:{chip:HTMLElement;list:HTMLElement}|undefined;
  const card=(player:PlayerRunView,awards:readonly Award[],ctx:HudContext&{slots:number;victory:boolean;facePx:number},index:number)=>{
    const node=el('article','rh-rcard');
    node.setAttribute('aria-label',player.name);
    node.style.setProperty('--i',String(index));
    const me=player.id===ctx.localId;
    node.classList.toggle('rh-me',me);
    if(player.spectator)node.dataset.state='spectator';

    const top=el('div','rh-rcard-top',node);
    // The face (rostos-hud): the outcome wins over caido here (a defeat ends with everyone down), so rindo on a win and
    // bravo on a loss (ui/face-crop.ts). At 64/52 px the thumb's crop would blur at DPR 3: `px` picks the 768 portrait.
    const expression=faceExpression({hp:player.hp,maxHp:player.maxHp,downed:!!player.downed,eliminated:player.eliminated,outcome:ctx.victory?'victory':'defeat'});
    top.append(faceImg(document,player.classId,{className:'rh-rcard-img',expression,portrait:ctx.portrait,px:ctx.facePx}));
    const id=el('div','rh-rcard-id',top);
    const name=el('strong','rh-rcard-name',id);name.textContent=player.name;name.dataset.full=player.name;
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

    // The prize first (UX-resultado-revanche): the joke is what the turma reads; the numbers come under it.
    const list=el('ul','rh-rcard-awards',node);
    const numbers=el('dl','rh-rcard-stats',node);
    const s=player.stats;
    const tally=ctx.tally.players.get(player.id);
    const rows:[string,number][]=[
      ['dano',s?.damage??0],
      ['salvou',Math.max(s?.revives??0,tally?.revives??0)],
      ['abates',Math.max(s?.kills??0,tally?.kills??0)],
      ['coletas',Math.max(s?.pickups??0,tally?.pickups??0)],
    ];
    // Two numbers show (dano, salvou); a tap on the card opens abates and coletas.
    for(const [label,value] of rows){
      const cell=el('div',label==='dano'||label==='salvou'?'rh-rstat':'rh-rstat rh-rstat-more',numbers);
      const dd=el('dd','rh-rstat-value',cell);dd.textContent=compactNumber(value);
      const dt=el('dt','rh-rstat-label',cell);dt.textContent=label;
    }

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
      const mark=el('span','rh-award-emoji',chip);mark.innerHTML=drawSticker(award.icon,{size:32});mark.setAttribute('aria-hidden','true');
      const text=el('span','rh-award-text',chip);
      const name=el('strong','rh-award-title',text);name.textContent=award.title;
      const line=el('small','rh-award-line',text);line.textContent=award.line;
      chip.setAttribute('aria-label',`${award.title}: ${award.line}`);
    }
    list.hidden=!awards.length;
    list.querySelector('.rh-award:not(.rh-award-shame)')?.classList.add('rh-award-top');
    // "✓ topa" (the room's rematch vote): a sticker on the card's corner.
    if(rematchVotes?.votes.includes(player.id)){const topa=el('span','rh-rcard-topa',node);topa.textContent='✓ topa';}
    node.classList.toggle('is-open',openCards.has(player.id));
    if(!managing){
      node.addEventListener('click',()=>{
        if(openCards.has(player.id))openCards.delete(player.id);else openCards.add(player.id);
        node.classList.toggle('is-open',openCards.has(player.id));fitCards();
      });
    }
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
    grid.replaceChildren(...players.map((player,index)=>card(player,awardsOf(awards,player.id),{...ctx,slots,victory:result.victory,facePx:count<=2?RESULT_FACE_PX.big:RESULT_FACE_PX.card},index)),...(tile?[addTile()]:[]));
    fitCards();
  };
  /**
   * The notice on top when the cards still fit under it (up to four players); otherwise it moves into the shamed
   * player's card as its first chip (that card shows two chips at most; the others fold: read aloud, shown by a tap on
   * the card), so six cards never scroll (VGM-053B).
   */
  const fitShame=()=>{
    if(!chipEl||!shameChip){shame.hidden=true;return;}
    const {chip,list}=chipEl,extra=[...list.querySelectorAll<HTMLElement>('.rh-award:not(.rh-award-shame)')].slice(MAX_AWARDS_PER_PLAYER-1);
    chip.remove();for(const a of extra)a.classList.remove('rh-award-folded');list.hidden=!list.children.length;
    shame.hidden=false;
    // Five or six cards (four in landscape: two rows) never have room for the notice (measured at 390×844 and 844×390,
    // 100% and 125%, long names); fewer only move it when they would scroll.
    const crowded=grid.children.length>=(landscape?.matches?4:5);
    if(!crowded&&(root.hidden||grid.scrollHeight<=grid.clientHeight+1))return;
    shame.hidden=true;list.prepend(chip);list.hidden=false;for(const a of extra)a.classList.add('rh-award-folded');
  };
  /**
   * Names in up to two lines (whole name, else whole words with "…"); if the cards would then scroll, one line. Then the
   * shame notice finds its place (it measures the grid too). Only once the screen is laid out.
   */
  const fitCards=()=>{
    if(root.hidden||typeof getComputedStyle!=='function'){fitShame();return;}
    const names=[...grid.querySelectorAll<HTMLElement>('.rh-rcard-name')];
    for(const n of names)fitCardName(n,n.dataset.full??n.textContent??'',2);
    fitShame();
    if(grid.scrollHeight>grid.clientHeight+1){for(const n of names)fitCardName(n,n.dataset.full??n.textContent??'',1);fitShame();}
    // Last resort (DSG-adesivos-itens: long vice lines like "Empatou em … e perdeu no desempate."): the award jokes go,
    // titles and stickers stay; each chip keeps its whole text in its aria-label.
    grid.classList.remove('rh-result-tight');root.classList.remove('rh-result-nolost');
    if(grid.scrollHeight>grid.clientHeight+1)grid.classList.add('rh-result-tight');
    // Then the defeat's "O que derrubou a turma" line (its cause is in the "Te derrubou" ficha too).
    if(grid.scrollHeight>grid.clientHeight+1)root.classList.add('rh-result-nolost');
  };
  const onTurn=()=>{if(shownResult&&!root.hidden)renderGrid(shownResult.result,shownResult.ctx);};
  landscape?.addEventListener('change',onTurn);

  return {
    el:root,matches,
    show(result:MapRunResult,ctx:HudContext,nests?:{down:number;total:number}){
      const headline=resultHeadline(result);
      root.dataset.outcome=result.victory?'victory':'defeat';
      title.textContent=headline.title;
      subtitle.textContent=headline.subtitle;
      const why=defeatLine(result,ctx.tally.causes);lost.hidden=!why;lost.textContent=why??'';
      time.innerHTML=`${icon('relogio')} ${formatDuration(result.durationTicks)}`;
      const conta=result.objective&&objectiveBill(result.objective);
      round.textContent=resultRoundLine(result,nests);
      bill.hidden=!conta;root.dataset.objetivo=conta?conta.cause:'';
      if(conta){
        // One ficha ("Orçamento R$ 456, grana R$ 372"): in landscape the head is one row and two fichas made it taller.
        bill.innerHTML=`Orçamento <b></b>, grana <b></b>${conta.debtVictory?', falta <b></b>':''}`;
        const [b1,b2,b3]=bill.querySelectorAll('b');b1.textContent=conta.budget;b2.textContent=conta.grana;if(b3)b3.textContent=conta.debt??'';
        bill.classList.toggle('rh-result-divida',conta.debtVictory);
        bill.setAttribute('aria-label',conta.aria);
      }
      const vaca=conta?vaquinhaLine(result.objective?.share,id=>{const p=result.players.find(q=>q.id===id);return id===ctx.localId?'Você':p?railName(p.name):'Alguém';}):undefined;
      vaquinha.hidden=!vaca;vaquinha.textContent=vaca?.text??'';
      if(vaca)vaquinha.setAttribute('aria-label',vaca.aria);else vaquinha.removeAttribute('aria-label');
      seed.textContent=resultSeedText(result);seed.hidden=!seed.textContent;
      const fell=resultCause(ctx.tally.causes,ctx.localId);
      cause.hidden=!fell;
      if(fell){causeText.textContent=fell.text;const src=ctx.critterIcon?.(fell.kind)??'';causeIcon.hidden=!src;if(src)causeIcon.src=src;cause.dataset.kind=fell.kind;}
      const moment=result.shame,who=moment&&result.players.find(p=>p.id===moment.player);
      shame.hidden=!moment||!who;shameChip=undefined;
      if(moment&&who){
        const copy=shameText(moment,who.id===ctx.localId?'Você':who.name,nests?'ninhos':result.objective?'onda':'round');
        // On the card the joke goes (design review D8): the sticker and the card already say who and what.
        shameChip={playerId:who.id,line:copy.joke,aria:`Momento mais vergonhoso: ${copy.text} ${copy.joke}`,key:moment.key,...(moment.source?{source:moment.source}:{})};
        shameLine.textContent=copy.text;shameJoke.textContent=copy.joke;
        const sticker=moment.source?ctx.critterIcon?.(moment.source):undefined;
        if(sticker){const img=document.createElement('img');img.src=sticker;img.alt='';img.decoding='async';img.draggable=false;shameIcon.replaceChildren(img);}
        else shameIcon.innerHTML=icon('suor',{size:32});
        shame.dataset.key=moment.key;
      }
      shownResult={result,ctx,awards:computeAwards(result,ctx.tally)};localId=ctx.localId;openCards.clear();
      managing=false;armed=undefined;syncManage();
      renderGrid(result,ctx);
      resetRematch();exited=false;
      root.hidden=false;
      fitCards();
      // A late font changes every width: fit again once the fonts are in.
      void document.fonts?.ready?.then(()=>{if(!root.hidden)fitCards();});
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
    refuse(label:string){asked=true;refused=true;rematch.disabled=true;rematch.classList.remove('rh-waiting');rematch.textContent=label;},
    /** The room's rematch vote (UX-resultado-revanche); undefined from an older room (the first tap starts it). */
    setRematch(next:RematchVotes|undefined){
      const before=JSON.stringify(rematchVotes?.votes??[]);rematchVotes=next;syncRematch();
      if(shownResult&&!root.hidden&&JSON.stringify(next?.votes??[])!==before){root.classList.remove('rh-result-in');renderGrid(shownResult.result,shownResult.ctx);}
    },
    destroy(){landscape?.removeEventListener('change',onTurn);clearTimeout(disarm);root.remove();},
  };
}
