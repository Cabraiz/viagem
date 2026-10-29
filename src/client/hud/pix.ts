/**
 * The PIX to a friend on the phone (card NEW-20261014-ORQ-carteira-e-pix; board plans/carteira-pix-proposta.md §3,
 * contract wallet.ts):
 * - a tap (or a mouse click: pointerdown covers both) on a friend's portrait in the team strip opens a balloon by it:
 *   the friend's name and balance, and four buttons, R$ 5 · R$ 10 · R$ 25 · tudo (my balance up to PIX_MAX); a button
 *   over my balance is off. One tap sends, no second dialog; the pressed button waits for the room's answer; a refusal
 *   shows its PIX_REFUSALS line in the balloon for PIX_REFUSAL_MS; an accepted PIX closes it (the event's toast says so).
 *   The balloon closes PIX_BALLOON_MS after the last touch, or on a tap outside it;
 * - it does not open on my own portrait, for a spectator (me or the friend), while I am caído or out (those keep the
 *   camera's "seguir", explore.ts), outside a run's combat or intermission, or in the level-up pause (D-050, ctx.pause):
 *   then the tap falls through to the portrait's name (team.ts NAME_TAP_MS). When it opens, the tap stops here, so the
 *   name does not show under the balloon;
 * - the 'pix' event: the receiver reads "Ana te mandou um Pix de R$ 10 — 'pro pastel'", the sender "Pix de R$ 10 pra
 *   Ana enviado" (a row of the announcement slot); others read nothing (the phone stays lean), and every screen flashes
 *   the receiver's portrait Cartolina for PIX_FLASH_MS.
 * A friend's balance shows only in this balloon (decision 2 of the proposal: the top bar shows my wallet only).
 * No CSS import here (the module stays importable by node tests): hud.ts imports pix.css.
 */
import {PIX_BALLOON_MS,PIX_MAX,PIX_MEMOS,PIX_QUICK,PIX_REFUSALS,type PixResult} from '../../contract/index.ts';
import type {PlayerRunView,RunView,SimEvent} from '../../contract/index.ts';
import {railName} from '../render/map-label-rules.ts';
import {granaText,reaisText} from './price.ts';
import type {HudContext,HudPart} from './model.ts';

/** A refusal's line stays this long in the balloon (ms). */
export const PIX_REFUSAL_MS=1500;
/** The toast's time in the announcement slot (ms). */
export const PIX_TOAST_MS=3200;
/** The receiver's portrait flashes Cartolina this long (pix.css: three 400 ms beats). */
export const PIX_FLASH_MS=1200;
/** A sent PIX the room has not answered after this long: the button comes back with PIX_NO_ANSWER (ms). */
export const PIX_WAIT_MS=3000;
/** The tap could not reach the room (offline, not in a run). */
export const PIX_OFFLINE='Sem conexão agora.';
/** The room did not answer in PIX_WAIT_MS. */
export const PIX_NO_ANSWER='A sala não respondeu. Tenta de novo.';

/** The players' balances ride on the wire with them (contract SimPlayer.grana; absent = 0). */
type WithWallet=PlayerRunView&{grana?:number};
const whole=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)?Math.max(0,Math.floor(n)):0;
/** A player's balance as the view carries it (absent = 0). */
export const granaOf=(player:PlayerRunView|undefined)=>whole((player as WithWallet|undefined)?.grana);
/** My wallet: CampView.grana is the viewer's own (contract view.ts); without a camp, my player's balance. */
export function myGrana(view:Pick<RunView,'camp'|'players'>,localId:string){
  const camp=view.camp?.grana;
  return typeof camp==='number'&&Number.isFinite(camp)?whole(camp):granaOf(view.players.find(p=>p.id===localId));
}

/** Why the balloon does not open on a portrait (undefined: it opens). */
export type PixBlock='me'|'seat'|'down'|'friend'|'phase'|'pause';
export interface PixGate {
  /** The HUD is on screen and not on the result (RunHud). */
  live:boolean;
  /** The level-up pause (D-050) holds the run. */
  paused:boolean;
}
export function pixBlock(view:Pick<RunView,'players'|'round'|'wave'>,localId:string,id:string,gate:PixGate):PixBlock|undefined{
  if(id===localId)return 'me';
  const me=view.players.find(p=>p.id===localId),friend=view.players.find(p=>p.id===id);
  if(!me||me.spectator)return 'seat';
  if(me.downed||me.eliminated)return 'down';
  if(!friend||friend.spectator)return 'friend';
  if(!gate.live||!(view.round??view.wave))return 'phase';
  if(gate.paused)return 'pause';
  return undefined;
}

/** One of the balloon's buttons: `all` is "tudo" (my balance up to PIX_MAX). */
export interface PixButton {amount:number;all:boolean;label:string;enabled:boolean;aria:string}
export function pixButtons(mine:number):PixButton[]{
  const have=whole(mine),all=Math.min(have,PIX_MAX);
  return [
    ...PIX_QUICK.map(amount=>({amount,all:false,label:granaText(amount),enabled:amount<=have,aria:`Mandar ${reaisText(amount)}${amount>have?': falta grana':''}`})),
    {amount:all,all:true,label:'tudo',enabled:all>0,aria:all>0?`Mandar tudo, ${reaisText(all)}`:'Mandar tudo: você tá sem grana'},
  ];
}

type PixEvent=Extract<SimEvent,{type:'pix'}>;
/** The toast of a 'pix' event for this screen: the receiver's, the sender's, or none (someone else's PIX). */
export function pixToast(event:Pick<PixEvent,'from'|'to'|'amount'|'memo'>,localId:string,nameOf:(id:string)=>string):{text:string;mine:boolean}|undefined{
  const amount=granaText(event.amount);
  if(event.to===localId){
    const memo=Number.isInteger(event.memo)?PIX_MEMOS[event.memo]:undefined;
    return {text:`${nameOf(event.from)} te mandou um Pix de ${amount}${memo?` — '${memo}'`:''}`,mine:false};
  }
  if(event.from===localId)return {text:`Pix de ${amount} pra ${nameOf(event.to)} enviado`,mine:true};
  return undefined;
}

/**
 * The balloon's state (pure: the clock comes in, node pins it down). Every send carries a token: an answer for a
 * balloon that closed or moved to another friend since is dropped.
 */
export class PixBalloon {
  friend?:string;
  touched=0;
  pending?:{token:number;amount:number;all:boolean;since:number};
  refusal?:{text:string;until:number};
  private token=0;
  open(id:string,now:number){this.friend=id;this.touched=now;this.pending=undefined;this.refusal=undefined;this.token++;}
  close(){this.friend=undefined;this.pending=undefined;this.refusal=undefined;this.token++;}
  /** A touch inside the balloon keeps it open PIX_BALLOON_MS more. */
  touch(now:number){if(this.friend)this.touched=now;}
  /** A button: the token to answer with, or undefined (closed, already waiting, or the button is off). */
  press(button:Pick<PixButton,'amount'|'all'|'enabled'>,now:number):number|undefined{
    if(!this.friend||this.pending||!button.enabled||button.amount<=0)return undefined;
    this.refusal=undefined;this.touched=now;
    this.pending={token:this.token,amount:button.amount,all:button.all,since:now};
    return this.token;
  }
  /** The room's answer (undefined: the tap never reached it). Accepted closes the balloon; refused shows the line. */
  answer(token:number,result:PixResult|undefined,now:number,offline=PIX_OFFLINE){
    if(!this.pending||this.pending.token!==token)return;
    this.pending=undefined;
    if(result?.ok){this.close();return;}
    this.refusal={text:result?PIX_REFUSALS[result.reason]??PIX_REFUSALS.phase:offline,until:now+PIX_REFUSAL_MS};
    this.touched=now;
  }
  /** Time passes: a lost answer gives up, a refusal's line goes, an untouched balloon closes. */
  step(now:number){
    if(this.pending&&now-this.pending.since>=PIX_WAIT_MS)this.answer(this.pending.token,undefined,now,PIX_NO_ANSWER);
    if(this.refusal&&now>=this.refusal.until)this.refusal=undefined;
    if(this.friend&&!this.pending&&!this.refusal&&now-this.touched>=PIX_BALLOON_MS)this.close();
  }
}

export interface Box {x:number;y:number;width:number;height:number}
/** The balloon keeps this far from the screen's edges and from the portrait (px). */
export const PIX_MARGIN=8,PIX_GAP=8;
/**
 * Where the balloon goes, in the HUD's px: under the portrait on the phone (the fan sits in the top band, so the
 * balloon stays in the upper screen, far from the joystick and the skill button), right of it on the desktop (the
 * team's column), under it when the right side has no room. Clamped into the screen; `beak` is where the portrait's
 * centre falls along the balloon's edge (its little arrow, pix.css --rh-pix-bico).
 */
export function pixSpot(portrait:Box,size:{width:number;height:number},screen:{width:number;height:number},side:'below'|'right'){
  const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
  const cx=portrait.x+portrait.width/2,cy=portrait.y+portrait.height/2;
  if(side==='right'&&portrait.x+portrait.width+PIX_GAP+size.width<=screen.width-PIX_MARGIN){
    const y=clamp(cy-size.height/2,PIX_MARGIN,Math.max(PIX_MARGIN,screen.height-PIX_MARGIN-size.height));
    return {x:portrait.x+portrait.width+PIX_GAP,y,side:'right' as const,beak:Math.round(cy-y)};
  }
  const x=clamp(cx-size.width/2,PIX_MARGIN,Math.max(PIX_MARGIN,screen.width-PIX_MARGIN-size.width));
  return {x,y:portrait.y+portrait.height+PIX_GAP,side:'below' as const,beak:Math.round(cx-x)};
}

export interface PixOptions {
  /** The HUD's root (.rh): the portraits live under it and so does the balloon. */
  root:HTMLElement;
  /** Sends the PIX (net client.pix); undefined: the tap cannot reach the room now. */
  send(to:string,amount:number):Promise<PixResult>|undefined;
  /** Shows the toast row in the announcement slot (RunHud.queueRow); `mine`: an answer to my own tap. */
  say(row:HTMLElement,mine:boolean):void;
  /** The HUD is on screen and not on the result. */
  live():boolean;
  /** The clock (ms); performance.now by default. */
  now?():number;
}
export interface PixPart extends HudPart {
  /** The toast's row (one, reused). */
  readonly toast:HTMLElement;
  readonly state:PixBalloon;
}

const MEMBER='.rh-member[data-id]';
/** A pointer event's target as an element (a text node's parent). */
const elementOf=(target:EventTarget|null)=>{
  const node=target as (Node&{closest?:unknown})|null;
  return (node&&typeof node.closest==='function'?node:node?.parentElement??null) as Element|null;
};

export function createPix(options:PixOptions):PixPart{
  const doc=options.root.ownerDocument,now=options.now??(()=>performance.now());
  const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
    const node=doc.createElement(tag);node.className=className;parent?.append(node);return node;
  };
  const state=new PixBalloon();
  const balloon=el('section','rh-pix');balloon.hidden=true;balloon.setAttribute('role','dialog');
  const head=el('div','rh-pix-head',balloon);
  const name=el('strong','rh-pix-nome',head),saldo=el('span','rh-pix-saldo',head);
  const row=el('div','rh-pix-botoes',balloon);
  const line=el('p','rh-pix-linha',balloon);line.hidden=true;line.setAttribute('role','status');
  const buttons=[...PIX_QUICK.map(()=>false),true].map(all=>{
    const button=el('button','rh-pix-btn',row);button.type='button';if(all)button.dataset.tudo='';
    const label=el('span','rh-pix-valor',button),sub=el('small','rh-pix-sub',button);sub.hidden=!all;
    return {button,label,sub,all};
  });
  const toast=el('div','rh-pix-toast');toast.setAttribute('role','status');toast.hidden=true;

  let last:RunView|undefined,localId='',paused=false,seen=-1,anchor:HTMLElement|undefined,lastRender='';
  const flashes=new Map<string,number>();
  const players=()=>last?.players??[];
  const nameOf=(id:string)=>{const p=players().find(q=>q.id===id);return p?railName(p.name):'Alguém';};
  const memberOf=(id:string)=>[...options.root.querySelectorAll<HTMLElement>(MEMBER)].find(m=>m.dataset.id===id);
  const current=()=>last?pixButtons(myGrana(last,localId)):pixButtons(0);

  const place=()=>{
    if(!anchor?.isConnected)return;
    const r=anchor.getBoundingClientRect(),box=options.root.getBoundingClientRect();
    const at=pixSpot({x:r.left-box.left,y:r.top-box.top,width:r.width,height:r.height},{width:balloon.offsetWidth,height:balloon.offsetHeight},
      {width:box.width,height:box.height},options.root.dataset.hud==='fone'?'below':'right');
    balloon.style.left=`${Math.round(at.x)}px`;balloon.style.top=`${Math.round(at.y)}px`;
    balloon.dataset.lado=at.side;balloon.style.setProperty('--rh-pix-bico',`${at.beak}px`);
  };
  const render=()=>{
    const id=state.friend;
    if(!id||!last){if(!balloon.hidden){balloon.hidden=true;lastRender='';}anchor=undefined;return;}
    const friend=players().find(p=>p.id===id),list=current();
    const key=`${id}|${friend?.name}|${granaOf(friend)}|${list.map(b=>`${b.amount}${b.enabled?'+':'-'}`).join()}|${state.pending?.amount??''}${state.pending?.all?'t':''}|${state.refusal?.text??''}`;
    if(key===lastRender&&!balloon.hidden)return;
    lastRender=key;
    const who=friend?railName(friend.name):'';
    name.textContent=`Pix pra ${who}`;saldo.textContent=`tem ${granaText(granaOf(friend))}`;
    balloon.setAttribute('aria-label',`Pix pra ${who}, que tem ${reaisText(granaOf(friend))}`);
    list.forEach((b,i)=>{
      const n=buttons[i],waiting=state.pending?.all===b.all&&(b.all||state.pending?.amount===b.amount);
      n.button.disabled=!b.enabled||!!state.pending;
      n.button.toggleAttribute('aria-busy',!!waiting);n.button.classList.toggle('rh-pix-esperando',!!waiting);
      n.label.textContent=waiting?'…':b.label;
      if(b.all)n.sub.textContent=granaText(b.amount);
      n.button.setAttribute('aria-label',b.aria);n.button.dataset.valor=String(b.amount);
    });
    line.hidden=!state.refusal;line.textContent=state.refusal?.text??'';
    const opening=balloon.hidden;balloon.hidden=false;
    if(opening)place();
  };
  const close=()=>{state.close();render();};
  const open=(id:string,member:HTMLElement)=>{state.open(id,now());anchor=member;lastRender='';render();place();};

  // Portraits: the capture phase on the HUD's root runs before the strip's own handlers (team.ts's name, hud.ts's
  // stopPropagation), so stopping the tap here keeps the name from showing while the balloon opens.
  const onPortrait=(event:Event)=>{
    const target=elementOf(event.target);
    if(!target||balloon.contains(target))return;
    const member=target.closest<HTMLElement>(MEMBER),id=member?.dataset.id;
    if(!member||!id||!last)return;
    if(state.friend===id){event.stopPropagation();close();return;}
    if(pixBlock(last,localId,id,{live:options.live(),paused})){if(state.friend)close();return;}
    event.stopPropagation();open(id,member);
  };
  // A tap anywhere else closes it (the document's capture phase: the canvas and the joystick are outside the HUD).
  const onOutside=(event:Event)=>{
    if(!state.friend)return;
    const target=elementOf(event.target);
    if(target&&(balloon.contains(target)||target.closest(MEMBER)))return;
    close();
  };
  options.root.addEventListener('pointerdown',onPortrait,true);
  doc.addEventListener('pointerdown',onOutside,true);
  // The balloon is an interactive panel: its taps never reach the game (like the HUD's panels, hud.ts).
  for(const type of ['pointerdown','pointerup','touchstart','mousedown','click'] as const)balloon.addEventListener(type,event=>{
    event.stopPropagation();if(type==='pointerdown')state.touch(now());
  });
  buttons.forEach((n,i)=>n.button.addEventListener('click',()=>{
    const b=current()[i],to=state.friend,token=state.press(b,now());
    if(token===undefined||!to)return;
    render();
    let sent:Promise<PixResult>|undefined;
    try{sent=options.send(to,b.amount);}catch{sent=undefined;}
    if(!sent){state.answer(token,undefined,now());render();return;}
    sent.then(result=>{state.answer(token,result,now());render();},()=>{state.answer(token,undefined,now(),PIX_NO_ANSWER);render();});
  }));

  const flash=(id:string,at:number)=>{
    const member=memberOf(id);if(!member)return;
    // Restart the beat when a second PIX lands during the first one's flash.
    if('pix' in member.dataset){delete member.dataset.pix;void member.offsetWidth;}
    member.dataset.pix='';flashes.set(id,at+PIX_FLASH_MS);
  };
  const stepFlashes=(at:number)=>{
    for(const [id,until] of flashes)if(at>=until){flashes.delete(id);const member=memberOf(id);if(member)delete member.dataset.pix;}
  };

  return {el:balloon,toast,state,
    update(view:RunView,ctx:HudContext){
      last=view;localId=ctx.localId;
      // D-050: HudContext.pause (the level-up pause's channel into the HUD) where that card has landed.
      paused=!!(ctx as HudContext&{pause?:unknown}).pause;
      const at=now();
      for(const event of view.events){
        if(event.eventId<=seen)continue;
        seen=event.eventId;
        if(event.type!=='pix')continue;
        const said=pixToast(event,localId,nameOf);
        if(said){toast.textContent=said.text;options.say(toast,said.mine);}
        flash(event.to,at);
      }
      stepFlashes(at);
      state.step(at);
      if(state.friend&&(pixBlock(view,localId,state.friend,{live:options.live(),paused})||!anchor?.isConnected))state.close();
      render();
    },
    destroy(){
      options.root.removeEventListener('pointerdown',onPortrait,true);doc.removeEventListener('pointerdown',onOutside,true);
      for(const id of flashes.keys()){const member=memberOf(id);if(member)delete member.dataset.pix;}
      flashes.clear();balloon.remove();toast.remove();
    }};
}
