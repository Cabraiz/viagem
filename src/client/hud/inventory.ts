/**
 * The manual combat's inventory (D-051, card NEW-20261014-E4-inventario-hud): 6 small slots by the attack button, like
 * Wild Rift's items. The rarity is the slot's border, a consumable's stack a number. A tap puts a weapon in the hand or
 * eats a consumable; holding (or dragging it off the bar) drops the item. With the 6 slots full, an item on the ground
 * within reach shows "Trocar" (it takes the place of the weapon in the hand). The room's refusals become a short line.
 * Desktop: keys 1–6 (Dona Cida's open tray keeps 1–3, desktop-input.ts cidaKeyOf). Only with `hand` (manual combat):
 * the automatic weapons have no inventory and the bar stays hidden.
 *
 * inventorySlots, swapCandidate, inventoryRefusalText and inventoryKeyOf are pure (tests); createInventory paints .rh-inv.
 */
import type {PlayerRunView,PickupView,RunView} from '../../contract/index.ts';
import type {HudContext,HudPart} from './model.ts';
import {itemDisplay} from './items.ts';
import {sticker} from '../ui/sticker.ts';
import {SHELL_DIALOG} from '../desktop-input.ts';

/** Inventory size (sim/inventory.ts INVENTORY_SLOTS; a test keeps them equal). */
export const INVENTORY_SLOTS=6;
/** How far "Trocar" reaches an item on the ground (sim/inventory.ts TAKE_REACH; a test keeps them equal). */
export const SWAP_REACH=1.2;
/** Holding a slot this long drops its item. */
export const HOLD_DROP_MS=500;
/** A finger that moves this far (px) is dragging the item: let go off the bar and it is dropped. */
export const DRAG_PX=24;
/** How long a refusal line stays over the bar. */
export const NOTE_MS=1600;

/** Rarity names (sim/weapons/arsenal.ts RARITY_NAME; a test keeps them equal). */
export const RARITY_NAME:Readonly<Record<number,string>>={1:'verde',2:'azul',3:'roxa',4:'dourada',5:'lendária'};

export interface InventorySlot {
  index:number;id:string;name:string;
  kind:'weapon'|'consumable';
  /** Weapon: rarity 1–5 (the border). */
  rarity?:number;
  /** Consumable: the stack (shown from 2). */
  stack?:number;
  hand:boolean;
}
/** The slots of the local player, in order (undefined: no inventory, the automatic weapons). */
export function inventorySlots(player:Pick<PlayerRunView,'weapons'|'hand'>|undefined):InventorySlot[]|undefined{
  if(!player||player.hand===undefined)return undefined;
  return player.weapons.slice(0,INVENTORY_SLOTS).map((item,index)=>{
    const display=itemDisplay(item.id),consumable=display.kind==='snack';
    return {index,id:item.id,name:display.name,kind:consumable?'consumable':'weapon',
      ...(consumable?{stack:item.level}:{rarity:Math.max(1,Math.min(5,item.level))}),hand:index===player.hand};
  });
}
/** The slot's accessible name: "Pistola (azul), na mão", "Coxinha, 2". */
export function slotLabel(slot:InventorySlot):string{
  if(slot.kind==='consumable')return `${slot.name}${(slot.stack??1)>1?`, ${slot.stack}`:''}: tocar para usar, segurar para largar`;
  return `${slot.name} (${RARITY_NAME[slot.rarity??1]})${slot.hand?', na mão':': tocar para equipar'}, segurar para largar`;
}

/**
 * The item on the ground "Trocar" takes: only with the 6 slots full (with room, walking over it picks it up), the
 * nearest `kind:'item'` within SWAP_REACH of the hero.
 */
export function swapCandidate(slots:readonly InventorySlot[]|undefined,pickups:readonly PickupView[],hero:{x:number;y:number}|undefined):PickupView|undefined{
  if(!slots||slots.length<INVENTORY_SLOTS||!hero)return undefined;
  let best:PickupView|undefined,bestD=SWAP_REACH;
  for(const p of pickups){
    if(p.kind!=='item'||!p.resource)continue;
    const d=Math.hypot(p.x-hero.x,p.y-hero.y);
    if(d<=bestD){best=p;bestD=d;}
  }
  return best;
}

/** The room's reasons ({t:'inv',ok:false,reason}, sim/inventory.ts InventoryRefusal) as a short line. */
const REFUSALS:Readonly<Record<string,string>>={
  far:'Chega mais perto',
  'last-weapon':'A última arma fica',
  full:'Mochila cheia',
  'not-weapon':'Isso não é arma',
  'not-consumable':'Isso não se come',
  unusable:'Vida já tá cheia',
  slot:'Esse espaço tá vazio',
  player:'Agora não dá',
  pickup:'O item sumiu',
};
export const inventoryRefusalText=(reason:string|undefined)=>REFUSALS[reason??'']??'Não deu';

type KeyLike={key?:string;code:string;repeat?:boolean;ctrlKey?:boolean;altKey?:boolean;metaKey?:boolean;shiftKey?:boolean;defaultPrevented?:boolean;target?:EventTarget|null};
type KeyTarget={tagName?:string;isContentEditable?:boolean;closest?(selector:string):unknown};
/**
 * The slot (0–5) of a desktop key 1–6, or undefined when the key stays with the page: a repeat, a modifier, typing in a
 * field, another window open over the match, or a key Dona Cida's open tray already took (her 1–3 buy; she handles
 * keydown in the capture phase and marks it defaultPrevented, so `cidaOpen` is only the belt to her braces).
 */
export function inventoryKeyOf(event:KeyLike,otherDialogOpen:boolean,cidaOpen=false):number|undefined{
  if(event.repeat||event.defaultPrevented||otherDialogOpen||event.ctrlKey||event.altKey||event.metaKey)return undefined;
  const target=event.target as KeyTarget|null|undefined,tag=target?.tagName?.toUpperCase();
  if(target?.isContentEditable||tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return undefined;
  if(target?.closest?.(`dialog[open]:not(${SHELL_DIALOG})`))return undefined;
  const n=Number(/^(?:Digit|Numpad)([1-6])$/.exec(event.code)?.[1]);
  if(!n)return undefined;
  if(cidaOpen&&n<=3)return undefined;
  return n-1;
}

export type InventoryCommand={t:'equip'|'use'|'drop';slot:number}|{t:'take';pickup:string};
/** What a tap on a slot sends: equip a weapon not in the hand, use a consumable; nothing for the weapon already held. */
export function tapCommand(slot:InventorySlot):InventoryCommand|undefined{
  if(slot.kind==='consumable')return {t:'use',slot:slot.index};
  return slot.hand?undefined:{t:'equip',slot:slot.index};
}

export interface InventoryOptions {
  /** net.inventory: false when nothing could be sent. */
  onCommand(command:InventoryCommand):boolean;
  /** Dona Cida's tray is open (her 1–3 win). */
  cidaOpen?():boolean;
}
export interface InventoryPart extends HudPart {
  setHero(at:{x:number;y:number}|undefined):void;
  /** The room's answer ({t:'inv'}, net.onInventory). */
  answer(result:{cmd:string;ok:boolean;reason?:string},now?:number):void;
  readonly shown:boolean;
}

/** Paints .rh-inv: the 6 slots, the "Trocar" button and the refusal line. */
export function createInventory(options:InventoryOptions,doc:Document=document):InventoryPart{
  const el=doc.createElement('div');el.className='rh-inv';el.hidden=true;el.setAttribute('role','group');el.setAttribute('aria-label','Mochila');
  const grid=doc.createElement('div');grid.className='rh-inv-slots';
  const swap=doc.createElement('button');swap.type='button';swap.className='rh-inv-trocar';swap.hidden=true;
  const note=doc.createElement('p');note.className='rh-inv-nota';note.setAttribute('role','status');note.hidden=true;
  el.append(note,swap,grid);
  const buttons:HTMLButtonElement[]=[];
  for(let i=0;i<INVENTORY_SLOTS;i++){
    const b=doc.createElement('button');b.type='button';b.className='rh-inv-slot';b.dataset.slot=String(i);
    b.innerHTML=`<span class="rh-inv-ic"></span><span class="rh-inv-pilha" aria-hidden="true"></span><span class="rh-inv-tecla" aria-hidden="true">${i+1}</span>`;
    grid.append(b);buttons.push(b);
  }
  let slots:InventorySlot[]|undefined,hero:{x:number;y:number}|undefined,pickups:readonly PickupView[]=[],candidate:PickupView|undefined;
  let live=false,noteTimer:ReturnType<typeof setTimeout>|undefined;
  const painted:string[]=[];
  const say=(text:string)=>{
    note.textContent=text;note.hidden=false;
    if(noteTimer)clearTimeout(noteTimer);
    noteTimer=setTimeout(()=>{note.hidden=true;noteTimer=undefined;},NOTE_MS);
  };
  const send=(command:InventoryCommand)=>{if(!options.onCommand(command))say(inventoryRefusalText('player'));};
  const paintSwap=()=>{
    candidate=live?swapCandidate(slots,pickups,hero):undefined;
    swap.hidden=!candidate;
    if(!candidate)return;
    const name=itemDisplay(candidate.resource!).name,key=`${candidate.id}`;
    if(swap.dataset.pickup!==key){swap.dataset.pickup=key;swap.innerHTML=`${sticker(itemDisplay(candidate.resource!).icon,{size:24})}<span>Trocar</span>`;swap.setAttribute('aria-label',`Trocar pela ${name}`);}
  };
  const paint=()=>{
    el.hidden=!live||!slots;
    for(let i=0;i<INVENTORY_SLOTS;i++){
      const b=buttons[i],s=slots?.[i];
      const key=s?`${s.id}|${s.rarity??''}|${s.stack??''}|${s.hand}`:'';
      if(painted[i]===key)continue;
      painted[i]=key;
      b.disabled=!s;b.dataset.empty=String(!s);b.dataset.hand=String(!!s?.hand);
      if(s?.rarity)b.dataset.rarity=String(s.rarity);else delete b.dataset.rarity;
      b.dataset.kind=s?.kind??'';
      b.querySelector('.rh-inv-ic')!.innerHTML=s?sticker(itemDisplay(s.id).icon,{size:24}):'';
      b.querySelector('.rh-inv-pilha')!.textContent=s?.kind==='consumable'&&(s.stack??1)>1?String(s.stack):'';
      b.setAttribute('aria-label',s?slotLabel(s):`Espaço ${i+1} vazio`);
      b.setAttribute('aria-pressed',String(!!s?.hand));
    }
    paintSwap();
  };
  // Tap / hold / drag on a slot (pointer events: finger and mouse alike).
  let press:{slot:number;x:number;y:number;timer:ReturnType<typeof setTimeout>;dropped:boolean;dragging:boolean;id:number}|undefined;
  const endPress=()=>{if(!press)return;clearTimeout(press.timer);buttons[press.slot].classList.remove('rh-inv-segurando','rh-inv-arrastando');press=undefined;};
  for(const b of buttons){
    const slot=Number(b.dataset.slot);
    b.addEventListener('pointerdown',e=>{
      if(e.button!==0||b.disabled)return;
      e.preventDefault();endPress();
      b.setPointerCapture?.(e.pointerId);
      const timer=setTimeout(()=>{if(!press||press.slot!==slot)return;press.dropped=true;b.classList.remove('rh-inv-segurando');send({t:'drop',slot});},HOLD_DROP_MS);
      press={slot,x:e.clientX,y:e.clientY,timer,dropped:false,dragging:false,id:e.pointerId};
      b.classList.add('rh-inv-segurando');
    });
    b.addEventListener('pointermove',e=>{
      if(!press||press.slot!==slot||press.dropped||press.dragging)return;
      if(Math.hypot(e.clientX-press.x,e.clientY-press.y)>=DRAG_PX){press.dragging=true;clearTimeout(press.timer);b.classList.remove('rh-inv-segurando');b.classList.add('rh-inv-arrastando');}
    });
    b.addEventListener('pointerup',e=>{
      if(!press||press.slot!==slot)return;
      const p=press;endPress();
      if(p.dropped)return;
      if(p.dragging){
        const r=grid.getBoundingClientRect(),inside=e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;
        if(!inside)send({t:'drop',slot});
        return;
      }
      const s=slots?.[slot];const command=s&&tapCommand(s);if(command)send(command);
    });
    b.addEventListener('pointercancel',endPress);
    // Keyboard click (detail 0): the debug fallback, like the skill button.
    b.addEventListener('click',e=>{if(e.detail!==0)return;const s=slots?.[slot];const command=s&&tapCommand(s);if(command)send(command);});
  }
  swap.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();if(candidate)send({t:'take',pickup:candidate.id});});
  swap.addEventListener('click',e=>{if(e.detail===0&&candidate)send({t:'take',pickup:candidate.id});});
  // The bar holds its own taps (VGM-040): nothing leaks to the joystick or the map.
  for(const type of ['pointerdown','pointerup','touchstart','mousedown','click'] as const)el.addEventListener(type,event=>event.stopPropagation());
  // Desktop keys 1–6 (bubble phase: Dona Cida's capture listener answers her 1–3 first).
  const onKey=(e:KeyboardEvent)=>{
    if(!live||!slots)return;
    const slot=inventoryKeyOf(e,!!doc.querySelector(`dialog[open]:not(${SHELL_DIALOG})`),options.cidaOpen?.());
    if(slot===undefined)return;
    const s=slots[slot];if(!s)return;
    e.preventDefault();const command=tapCommand(s);if(command)send(command);
  };
  doc.addEventListener('keydown',onKey);
  return {
    el,
    get shown(){return !el.hidden;},
    update(view:RunView,ctx:HudContext){
      const me=view.players.find(p=>p.id===ctx.localId);
      slots=inventorySlots(me);pickups=view.pickups;
      live=!!me&&!me.spectator&&!me.downed&&!me.eliminated&&me.hp>0;
      if(!live)endPress();
      paint();
    },
    setHero(at){hero=at&&{x:at.x,y:at.y};paintSwap();},
    answer(result){if(!result.ok)say(inventoryRefusalText(result.reason));},
    destroy(){doc.removeEventListener('keydown',onKey);endPress();if(noteTimer)clearTimeout(noteTimer);},
  };
}
