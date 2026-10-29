/**
 * Sound settings rows (VGM-050; config-audio-musica-efeitos): "Música" and "Efeitos", each a mute toggle and a 0–100 %
 * slider, then the vibration. One column, every target ≥ 44 px. Used by the game's gear (explore.ts), the menu's gear
 * (settings-dialog.ts) and the sound lab (?sandbox=audio). Changes apply live; a slider persists on release.
 */
import type { AudioEngine } from './engine.ts';
import { BUS_LABELS, BUSES, percentText, volumeValueText, type Bus } from './settings.ts';
import { icon } from '../ui/icon.ts';

const CSS=`
.audio-controls{display:grid;gap:10px;padding:10px 12px;border:2px solid var(--c-lilas);border-radius:var(--r-janela);background:var(--c-papel-claro);color:var(--c-lilas);font:700 14px var(--f-sistema);box-shadow:var(--s-2)}
.audio-controls button{-webkit-tap-highlight-color:transparent;touch-action:manipulation;font:inherit;cursor:pointer}
.audio-controls .audio-row{display:grid;grid-template-columns:minmax(4.6em,auto) 48px minmax(0,1fr);align-items:center;gap:10px}
.audio-controls .audio-row-title{font-weight:800;color:var(--c-lilas)}
.audio-controls .audio-mute{flex:none;width:48px;height:48px;min-height:48px;display:grid;place-items:center;padding:0;border:2px solid var(--c-lilas);border-radius:50%;background:var(--c-papel-claro);color:var(--c-lilas);font-size:26px;line-height:1;box-shadow:0 3px 0 color-mix(in srgb,var(--c-lilas) 33%,transparent)}
.audio-controls .audio-mute[aria-pressed=true]{background:var(--c-papel);border-color:var(--c-breu)}
.audio-controls .audio-mute:active,.audio-controls .audio-vibe:active{transform:translateY(2px);box-shadow:none}
.audio-controls .audio-volume{min-width:0;display:flex;align-items:center;gap:8px;min-height:48px}
.audio-controls .audio-volume input{flex:1;min-width:0;height:44px;margin:0;background:transparent;-webkit-appearance:none;appearance:none;touch-action:none;cursor:pointer}
.audio-controls .audio-row[data-muted=true] .audio-volume input{opacity:.45}
.audio-controls .audio-volume input::-webkit-slider-runnable-track{height:12px;border-radius:var(--r-ficha);border:2px solid var(--c-papel);background:linear-gradient(90deg,var(--c-lilas) var(--audio-fill,70%),var(--c-papel-claro) var(--audio-fill,70%))}
.audio-controls .audio-volume input::-moz-range-track{height:8px;border-radius:var(--r-ficha);border:2px solid var(--c-papel);background:var(--c-papel-claro)}
.audio-controls .audio-volume input::-moz-range-progress{height:8px;border-radius:var(--r-ficha);background:var(--c-lilas)}
.audio-controls .audio-volume input::-webkit-slider-thumb{-webkit-appearance:none;width:28px;height:28px;margin-top:-10px;border-radius:50%;border:3px solid var(--c-papel-claro);background:var(--c-lilas);box-shadow:0 2px 0 var(--c-breu)}
.audio-controls .audio-volume input::-moz-range-thumb{width:24px;height:24px;border-radius:50%;border:3px solid var(--c-papel-claro);background:var(--c-lilas);box-shadow:0 2px 0 var(--c-lilas)}
.audio-controls .audio-volume output{flex:none;min-width:3.4em;text-align:right;font-size:13px;white-space:nowrap;color:var(--c-lilas);font-variant-numeric:tabular-nums}
.audio-controls .audio-vibe{display:flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:6px 12px;border:2px solid var(--c-lilas);border-radius:var(--r-janela);background:var(--c-papel-claro);color:var(--c-lilas);font-size:14px;box-shadow:0 3px 0 color-mix(in srgb,var(--c-lilas) 27%,transparent)}
.audio-controls .audio-vibe[aria-pressed=true]{background:var(--c-lilas);color:var(--c-papel)}
.audio-controls .audio-note{font-size:12px;font-weight:400;color:var(--c-lilas);text-align:center}
`;

function injectCss(){
  if(document.querySelector('style[data-audio-controls]'))return;
  const style=document.createElement('style');
  style.dataset.audioControls='';
  style.textContent=CSS;
  document.head.append(style);
}

/** Accessible names of a row's controls (pt-BR). */
export const BUS_TEXTS:Readonly<Record<Bus,{mute:string;volume:string}>>=Object.freeze({
  music:{mute:'Silenciar música',volume:'Volume da música'},
  effects:{mute:'Silenciar efeitos',volume:'Volume dos efeitos'},
});

export function mountAudioControls(container:HTMLElement,engine:AudioEngine):()=>void{
  injectCss();
  const canVibrate=typeof navigator!=='undefined'&&typeof navigator.vibrate==='function';
  const root=document.createElement('div');
  root.className='audio-controls';
  root.setAttribute('role','group');
  root.setAttribute('aria-label','Som e vibração');
  root.innerHTML=BUSES.map(bus=>`<div class="audio-row" data-bus="${bus}" role="group" aria-label="${BUS_LABELS[bus]}">`
    +`<span class="audio-row-title" aria-hidden="true">${BUS_LABELS[bus]}</span>`
    +`<button type="button" class="audio-mute" aria-label="${BUS_TEXTS[bus].mute}"></button>`
    +`<label class="audio-volume"><input type="range" min="0" max="100" step="1" aria-label="${BUS_TEXTS[bus].volume}" /><output aria-hidden="true"></output></label></div>`).join('')
    +(canVibrate
      ?`<button type="button" class="audio-vibe"><span aria-hidden="true">${icon('vibrar')}</span> Vibrar</button>`
      :`<span class="audio-note">Vibração indisponível neste aparelho.</span>`);
  const vibe=root.querySelector<HTMLButtonElement>('.audio-vibe');
  const ac=new AbortController(),signal=ac.signal;

  const rows=BUSES.map(bus=>{
    const row=root.querySelector<HTMLElement>(`.audio-row[data-bus="${bus}"]`)!;
    const mute=row.querySelector<HTMLButtonElement>('.audio-mute')!;
    const range=row.querySelector<HTMLInputElement>('input')!;
    const output=row.querySelector('output')!;
    const render=()=>{
      const settings=engine.settings[bus],pct=Math.round(settings.volume*100);
      mute.innerHTML=icon(settings.muted?'mudo':'som');
      mute.setAttribute('aria-pressed',String(settings.muted));
      row.dataset.muted=String(settings.muted);
      if(document.activeElement!==range||range.value!==String(pct))range.value=String(pct);
      range.style.setProperty('--audio-fill',`${pct}%`);
      range.setAttribute('aria-valuetext',volumeValueText(settings));
      output.textContent=settings.muted?'mudo':percentText(settings.volume);
    };
    // `input` fires on every drag step: apply live without persisting; `change` (release) persists once.
    const apply=(persist:boolean)=>{
      const v=Number(range.value)/100;
      engine.setVolume(bus,v,{persist});
      if(v>0&&engine.settings[bus].muted)engine.setMuted(bus,false);
      render();
    };
    mute.addEventListener('click',()=>engine.setMuted(bus,!engine.settings[bus].muted),{signal});
    range.addEventListener('input',()=>apply(false),{signal});
    range.addEventListener('change',()=>apply(true),{signal});
    return render;
  });

  // The engine emits on every sound it plays too (dozens a second in a match: steps, the alarm, the fear's heartbeat):
  // the rows write only when the settings changed, or the page restyled the HUD on every frame
  // (BUG-20261025-ORQ-celular-travando, Chrome invalidation trace).
  let shown='';
  const render=()=>{
    const key=JSON.stringify([BUSES.map(bus=>engine.settings[bus]),engine.settings.vibration]);
    if(key===shown)return;
    shown=key;
    for(const renderRow of rows)renderRow();
    if(vibe){
      const on=engine.settings.vibration;
      vibe.setAttribute('aria-pressed',String(on));
      vibe.firstElementChild!.innerHTML=icon(on?'vibrar':'sem-vibrar');
    }
  };
  vibe?.addEventListener('click',()=>engine.setVibration(!engine.settings.vibration),{signal});
  const off=engine.onChange(render);
  render();
  container.append(root);

  return ()=>{
    off();
    ac.abort();
    root.remove();
  };
}
