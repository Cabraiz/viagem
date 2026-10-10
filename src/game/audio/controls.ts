/** Compact mobile sound settings: mute, volume and optional vibration (VGM-050). */
import type { AudioEngine } from './engine.ts';

const CSS=`
.audio-controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px;border:2px solid var(--c-lilas);border-radius:var(--r-janela);background:var(--c-papel-claro);color:var(--c-lilas);font:700 13px var(--f-sistema);box-shadow:var(--s-2)}
.audio-controls button{-webkit-tap-highlight-color:transparent;touch-action:manipulation;font:inherit;cursor:pointer}
.audio-mute{flex:none;width:48px;height:48px;display:grid;place-items:center;padding:0;border:2px solid var(--c-lilas);border-radius:50%;background:var(--c-papel-claro);font-size:26px;line-height:1;box-shadow:0 3px 0 color-mix(in srgb,var(--c-lilas) 33%,transparent)}
.audio-mute[aria-pressed=true]{background:var(--c-papel);border-color:var(--c-breu);box-shadow:0 3px 0 color-mix(in srgb,var(--c-lilas) 33%,transparent)}
.audio-mute:active,.audio-vibe:active{transform:translateY(2px);box-shadow:none}
.audio-volume{flex:1 1 140px;min-width:0;display:flex;align-items:center;gap:8px;min-height:48px}
.audio-volume input{flex:1;min-width:0;height:44px;margin:0;background:transparent;-webkit-appearance:none;appearance:none;touch-action:none;cursor:pointer}
.audio-volume input:disabled{opacity:.45}
.audio-volume input::-webkit-slider-runnable-track{height:12px;border-radius:var(--r-ficha);border:2px solid var(--c-papel);background:linear-gradient(90deg,var(--c-lilas) var(--audio-fill,80%),var(--c-papel-claro) var(--audio-fill,80%))}
.audio-volume input::-moz-range-track{height:8px;border-radius:var(--r-ficha);border:2px solid var(--c-papel);background:var(--c-papel-claro)}
.audio-volume input::-moz-range-progress{height:8px;border-radius:var(--r-ficha);background:var(--c-lilas)}
.audio-volume input::-webkit-slider-thumb{-webkit-appearance:none;width:28px;height:28px;margin-top:-10px;border-radius:50%;border:3px solid var(--c-papel-claro);background:var(--c-lilas);box-shadow:0 2px 0 var(--c-breu)}
.audio-volume input::-moz-range-thumb{width:24px;height:24px;border-radius:50%;border:3px solid var(--c-papel-claro);background:var(--c-lilas);box-shadow:0 2px 0 var(--c-lilas)}
.audio-volume output{flex:none;min-width:3.2em;text-align:right;font-size:12px;color:var(--c-lilas);font-variant-numeric:tabular-nums}
.audio-vibe{flex:none;min-height:44px;padding:6px 12px;border:2px solid var(--c-lilas);border-radius:var(--r-janela);background:var(--c-papel-claro);color:var(--c-lilas);font-size:12px;box-shadow:0 3px 0 color-mix(in srgb,var(--c-lilas) 27%,transparent)}
.audio-vibe[aria-pressed=true]{background:var(--c-lilas);color:var(--c-papel)}
.audio-note{flex:1 1 100%;font-size:11px;font-weight:400;color:var(--c-lilas);text-align:center}
`;

function injectCss(){
  if(document.querySelector('style[data-audio-controls]'))return;
  const style=document.createElement('style');
  style.dataset.audioControls='';
  style.textContent=CSS;
  document.head.append(style);
}

export function mountAudioControls(container:HTMLElement,engine:AudioEngine):()=>void{
  injectCss();
  const canVibrate=typeof navigator!=='undefined'&&typeof navigator.vibrate==='function';
  const root=document.createElement('div');
  root.className='audio-controls';
  root.setAttribute('role','group');
  root.setAttribute('aria-label','Som e vibração');
  root.innerHTML=`<button type="button" class="audio-mute" aria-label="Som mudo"></button>`
    +`<label class="audio-volume"><input type="range" min="0" max="100" step="1" aria-label="Volume" /><output aria-hidden="true"></output></label>`
    +(canVibrate
      ?`<button type="button" class="audio-vibe"><span aria-hidden="true">📳</span> Vibrar</button>`
      :`<span class="audio-note">Vibração indisponível neste aparelho.</span>`);
  const mute=root.querySelector<HTMLButtonElement>('.audio-mute')!;
  const range=root.querySelector<HTMLInputElement>('input')!;
  const output=root.querySelector('output')!;
  const vibe=root.querySelector<HTMLButtonElement>('.audio-vibe');

  const render=()=>{
    const {volume,muted,vibration}=engine.settings;
    const pct=Math.round(Math.max(0,Math.min(1,volume))*100);
    mute.textContent=muted?'🔇':'🔊';
    mute.setAttribute('aria-pressed',String(muted));
    if(document.activeElement!==range||range.value!==String(pct))range.value=String(pct);
    range.style.setProperty('--audio-fill',`${pct}%`);
    range.setAttribute('aria-valuetext',muted?`${pct}%, mudo`:`${pct}%`);
    output.textContent=muted?'mudo':`${pct}%`;
    if(vibe){
      vibe.setAttribute('aria-pressed',String(vibration));
      vibe.firstElementChild!.textContent=vibration?'📳':'📴';
    }
  };

  const onMute=()=>engine.setMuted(!engine.settings.muted);
  // `input` fires on every drag step: apply live without persisting; `change` (release) persists once.
  const applyRange=(persist:boolean)=>{
    const v=Number(range.value)/100;
    if(persist)engine.setVolume(v);else engine.setVolume(v,{persist:false});
    if(v>0&&engine.settings.muted)engine.setMuted(false);
    render();
  };
  const onRange=()=>applyRange(false);
  const onRangeCommit=()=>applyRange(true);
  const onVibe=()=>engine.setVibration(!engine.settings.vibration);
  mute.addEventListener('click',onMute);
  range.addEventListener('input',onRange);
  range.addEventListener('change',onRangeCommit);
  vibe?.addEventListener('click',onVibe);
  const off=engine.onChange(render);
  render();
  container.append(root);

  return ()=>{
    off();
    mute.removeEventListener('click',onMute);
    range.removeEventListener('input',onRange);
    range.removeEventListener('change',onRangeCommit);
    vibe?.removeEventListener('click',onVibe);
    root.remove();
  };
}
