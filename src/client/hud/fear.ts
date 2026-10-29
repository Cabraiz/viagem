/**
 * The HUD side of the fear (card NEW-20261023-ORQ-fear-escuridao-sozinho, etapa 3; the scene draws the dark and the
 * arrow, render/fear-dark.ts): fed every frame through the scene's hooks.fear.
 * - the notice in the top band's announcement slot: "Não se afaste do bando" the first time the hero is alone (right at
 *   the start too); the last stretch has none (card heroi-fala-cade-amigos: the hero says it in a balloon, scene.ts);
 * - the allies' portraits dim while the hero is alone and they are out of reach (data-longe on the strip's member);
 * - the sound of the dark (audio/fear-sound.ts): the whisper and the heartbeat.
 * DOM writes only when something changed (the frame comes 60 times a second).
 */
import type {FearFrame} from '../render/fear-rules.ts';
import {FearSound} from '../audio/fear-sound.ts';
import {getAudio} from '../audio/engine.ts';
import {putHidden} from './dom-put.ts';

export interface FearRow {
  readonly el:HTMLElement;
  /** One frame of the dark; `far` the allies out of reach while alone (their portraits dim). */
  frame(frame:FearFrame,far:readonly string[]):void;
  /** Out of the run: no notice, no dim portrait, no sound. */
  clear():void;
  destroy():void;
}

export function createFearRow(doc:Document,team:HTMLElement):FearRow{
  const el=doc.createElement('div');el.className='rh-medo';el.setAttribute('role','status');el.hidden=true;
  const text=doc.createElement('span');text.className='rh-medo-texto';el.append(text);
  let sound:FearSound|undefined,dimmed='';
  const dim=(ids:readonly string[])=>{
    // The strip's size too: a member added later gets its state.
    const key=`${team.children.length}:${ids.join(',')}`;
    if(key===dimmed)return;
    dimmed=key;
    const set=new Set(ids);
    for(const member of team.querySelectorAll<HTMLElement>('.rh-member')){
      const far=set.has(member.dataset.id??'');
      if(far!==(member.dataset.longe!==undefined)){if(far)member.dataset.longe='';else delete member.dataset.longe;}
    }
  };
  const notice=(value:string)=>{
    putHidden(el,!value);
    if(text.textContent!==value)text.textContent=value;
  };
  return {el,
    frame(frame,far){
      notice(frame.notice?.text??'');
      dim(far);
      (sound??=new FearSound(getAudio())).update(frame.seconds,frame.thump,frame.look.final);
    },
    clear(){notice('');dim([]);sound?.stop();},
    destroy(){sound?.stop();sound=undefined;},
  };
}
