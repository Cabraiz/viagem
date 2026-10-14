/**
 * The menu's gear (config-audio-musica-efeitos): a small "Configurações" window over the creation screens with the
 * sound rows (Música, Efeitos, vibration), so the menu music can be turned down before any match. Loaded on the first
 * tap of the gear (main.ts imports nothing from audio/ statically, menu-perf). Same look as the game's settings.
 */
import {getAudio} from './engine.ts';
import {mountAudioControls} from './controls.ts';
import {icon} from '../ui/icon.ts';

const CSS=`
.sound-settings{box-sizing:border-box;width:min(440px,calc(100vw - 28px));max-width:none;max-height:calc(100dvh - 28px);margin:auto;padding:20px;border:2px solid var(--c-breu);border-radius:var(--r-janela);background:var(--c-lilas);color:var(--c-papel);box-shadow:inset 0 0 0 2px var(--c-papel),var(--s-2);overflow:auto;overscroll-behavior:contain}
.sound-settings::backdrop{background:var(--c-veu)}
.sound-settings-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.sound-settings-heading h2{font:24px var(--f-cartaz);margin:0}
.sound-settings .sound-settings-close{display:grid;place-items:center;min-width:48px;min-height:48px;padding:0;border:2px solid var(--c-papel);border-radius:var(--r-janela);background:transparent;color:var(--c-papel);cursor:pointer}
@media(max-width:370px),(max-height:500px){.sound-settings{padding:16px}}
`;

let dialog:HTMLDialogElement|undefined;

/** Opens the menu's settings (built once); focus goes back to `opener` when it closes. */
export function openSoundSettings(opener?:HTMLElement|null):HTMLDialogElement{
  if(!dialog){
    const style=document.createElement('style');style.dataset.soundSettings='';style.textContent=CSS;document.head.append(style);
    const d=dialog=document.createElement('dialog');
    d.className='sound-settings';d.setAttribute('aria-labelledby','sound-settings-title');
    d.innerHTML=`<div class="sound-settings-heading"><h2 id="sound-settings-title">Configurações</h2><button type="button" class="sound-settings-close" aria-label="Fechar">${icon('fechar',{size:32})}</button></div><div class="sound-settings-content"></div>`;
    mountAudioControls(d.querySelector<HTMLElement>('.sound-settings-content')!,getAudio());
    d.querySelector('.sound-settings-close')!.addEventListener('click',()=>d.close());
    document.body.append(d);
  }
  const d=dialog;
  if(!d.open){d.addEventListener('close',()=>opener?.focus(),{once:true});d.showModal();}
  d.querySelector<HTMLElement>('.sound-settings-close')!.focus();
  return d;
}
