/** Compact mobile sound settings: mute, volume and optional vibration (VGM-050). */
import type { AudioEngine } from './engine.ts';

const CSS=`
.audio-controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px;border:2px solid #b4a4cd;border-radius:16px;background:#fffdf5;color:#514464;font:700 13px 'Trebuchet MS',system-ui,sans-serif;box-shadow:0 4px 0 #7563ae33}
.audio-controls button{-webkit-tap-highlight-color:transparent;touch-action:manipulation;font:inherit;cursor:pointer}
.audio-mute{flex:none;width:48px;height:48px;display:grid;place-items:center;padding:0;border:2px solid #7563ae;border-radius:50%;background:#e5ddf1;font-size:26px;line-height:1;box-shadow:0 3px 0 #7563ae55}
.audio-mute[aria-pressed=true]{background:#f5d1c8;border-color:#bc664a;box-shadow:0 3px 0 #bc664a55}
.audio-mute:active,.audio-vibe:active{transform:translateY(2px);box-shadow:none}
.audio-volume{flex:1 1 140px;min-width:0;display:flex;align-items:center;gap:8px;min-height:48px}
.audio-volume input{flex:1;min-width:0;height:44px;margin:0;background:transparent;-webkit-appearance:none;appearance:none;touch-action:none;cursor:pointer}
.audio-volume input:disabled{opacity:.45}
.audio-volume input::-webkit-slider-runnable-track{height:12px;border-radius:8px;border:2px solid #b4a4cd;background:linear-gradient(90deg,#a193c5 var(--audio-fill,80%),#f1ebf8 var(--audio-fill,80%))}
.audio-volume input::-moz-range-track{height:8px;border-radius:8px;border:2px solid #b4a4cd;background:#f1ebf8}
.audio-volume input::-moz-range-progress{height:8px;border-radius:8px;background:#a193c5}
.audio-volume input::-webkit-slider-thumb{-webkit-appearance:none;width:28px;height:28px;margin-top:-10px;border-radius:50%;border:3px solid #fffdf5;background:#7563ae;box-shadow:0 2px 0 #564580}
.audio-volume input::-moz-range-thumb{width:24px;height:24px;border-radius:50%;border:3px solid #fffdf5;background:#7563ae;box-shadow:0 2px 0 #564580}
.audio-volume output{flex:none;min-width:3.2em;text-align:right;font-size:12px;color:#7563ae;font-variant-numeric:tabular-nums}
.audio-vibe{flex:none;min-height:44px;padding:6px 12px;border:2px solid #699e8b;border-radius:22px;background:#fffdf5;color:#46705f;font-size:12px;box-shadow:0 3px 0 #699e8b44}
.audio-vibe[aria-pressed=true]{background:#83b49d;color:#fff}
.audio-note{flex:1 1 100%;font-size:11px;font-weight:400;color:#8b7865;text-align:center}
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
