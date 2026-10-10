/** `?sandbox=audio`: full-screen sound lab to hear every procedural sound on a phone (VGM-050). */
import { SOUND_IDS, type SoundId } from './audio/types.ts';
import { RECIPES, SOUND_EMOJI } from './audio/recipes.ts';
import { getAudio, MAX_VOICES } from './audio/engine.ts';
import { mountAudioControls } from './audio/controls.ts';

const PASTELS=[['#d6eee4','#75b8a6'],['#fbdcd8','#ed8f91'],['#e5ddf1','#a391d4'],['#fbefcb','#d9b04f'],['#d8e9f5','#73add1'],['#f6dcea','#d99bbf']];
const CHAOS_PLAYS=40,CHAOS_SPREAD_MS=900;

const CSS=`
.audio-lab{position:fixed;inset:0;z-index:2147483000;height:100vh;height:100dvh;overflow:hidden;overscroll-behavior:none;touch-action:manipulation;box-sizing:border-box;display:grid;gap:10px;
  grid-template:"head" auto "grid" minmax(0,1fr) "panel" auto/minmax(0,1fr);
  padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));
  background:radial-gradient(circle at 18% 12%,#fbdcd8 0 9%,transparent 9.5%),radial-gradient(circle at 88% 82%,#d6eee4 0 12%,transparent 12.5%),#f4eedc;
  color:#514464;font-family:var(--f-sistema);-webkit-user-select:none;user-select:none}
.audio-lab *{box-sizing:border-box}
.audio-lab-head{grid-area:head;display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px 10px;min-width:0}
.audio-lab-head div{flex:1;min-width:0}
.audio-lab h1{margin:0;font-size:24px;line-height:1.1;font-weight:1000;letter-spacing:-.5px;color:#fffef4;text-shadow:2px 3px 0 #776399,-1.5px -1.5px 0 #776399,1.5px -1.5px 0 #776399,-1.5px 1.5px 0 #776399}
.audio-lab-head>div>p{margin:5px 0 0;font:italic 13px var(--f-cartaz);color:#76645e}
.audio-lab-close{flex:none;width:44px;height:44px;border:2px solid #b4a4cd;border-radius:50%;background:#fffdf5;color:#7563ae;font-size:22px;line-height:1;cursor:pointer}
.audio-lab-grid{grid-area:grid;min-height:0;display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));grid-auto-rows:minmax(44px,1fr)}
.audio-lab-sound{position:relative;min-width:0;min-height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:6px;border:2px solid var(--ink);border-radius:18px;background:var(--bg);color:#514464;font:800 13px/1.15 var(--f-sistema);text-align:center;box-shadow:0 4px 0 var(--ink);cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.audio-lab-sound b{font-size:clamp(22px,5.2vmin,34px);line-height:1}
.audio-lab-sound span{overflow-wrap:anywhere}
.audio-lab-sound:active{transform:translateY(3px);box-shadow:0 1px 0 var(--ink)}
.audio-lab-sound.audio-ok{animation:audio-pop .28s ease-out}
.audio-lab-sound.audio-drop{animation:audio-shake .25s linear}
@keyframes audio-pop{40%{transform:scale(1.07) rotate(-2deg)}}
@keyframes audio-shake{25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
.audio-lab-panel{grid-area:panel;display:flex;flex-direction:column;gap:8px;min-width:0}
.audio-lab-row{display:flex;align-items:center;gap:8px}
.audio-lab-voices{flex:1;min-width:0;font-size:12px;line-height:1.35;color:#6d609e}
.audio-lab-voices strong{font-size:15px;color:#514464;font-variant-numeric:tabular-nums}
.audio-lab-voices small{display:block;color:#8b7865}
.audio-lab-chaos{flex:none;min-height:48px;padding:8px 18px;border:2px solid #bc664a;border-radius:24px;background:#ed8f91;color:#fffdf5;font:900 16px var(--f-sistema);text-shadow:0 1px 0 #bc664a;box-shadow:0 4px 0 #bc664a;cursor:pointer}
.audio-lab-chaos:active{transform:translateY(3px);box-shadow:0 1px 0 #bc664a}
.audio-lab-hint{flex:1 1 100%;margin:0;padding:8px 14px;border-radius:16px;background:#564580e6;color:#fffdf5;font-size:14px;font-weight:800;line-height:1.25;text-align:center;pointer-events:none;box-shadow:0 4px 12px #3e344e40;animation:audio-breathe 1.4s ease-in-out infinite}
.audio-lab-hint[hidden]{display:none}
@keyframes audio-breathe{50%{transform:scale(1.03)}}
@media (orientation:portrait){.audio-lab-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (orientation:landscape) and (max-height:600px){
  .audio-lab{grid-template:"grid head" auto "grid panel" minmax(0,1fr)/minmax(0,1fr) minmax(220px,34%);gap:8px 12px}
  .audio-lab-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
  .audio-lab h1{font-size:20px}.audio-lab-head>div>p{font-size:12px}
  .audio-lab-panel{justify-content:flex-end}
  .audio-lab-row{flex-wrap:wrap}
  .audio-lab-chaos{flex:1 1 100%}
  .audio-lab-hint{font-size:13px}
}
@media (prefers-reduced-motion:reduce){.audio-lab *{animation:none!important}}
`;

let open=false;

export function openAudioSandbox():void{
  if(open)return;
  open=true;
  const engine=getAudio();
  if(!document.querySelector('style[data-audio-lab]')){
    const style=document.createElement('style');
    style.dataset.audioLab='';
    style.textContent=CSS;
    document.head.append(style);
  }
  const html=document.documentElement,prevOverflow=html.style.overflow,prevBodyOverflow=document.body.style.overflow;
  html.style.overflow='hidden';document.body.style.overflow='hidden';

  const lab=document.createElement('section');
  lab.className='audio-lab';
  lab.setAttribute('role','dialog');
  lab.setAttribute('aria-modal','true');
  lab.setAttribute('aria-labelledby','audio-lab-title');
  lab.innerHTML=`<header class="audio-lab-head"><div><h1 id="audio-lab-title">Laboratório de barulho</h1><p>Aperte tudo. Os vizinhos já desistiram.</p></div><button type="button" class="audio-lab-close" aria-label="Fechar laboratório">×</button><p class="audio-lab-hint" role="status">Toque em qualquer lugar para liberar o som</p></header>
<div class="audio-lab-grid">${SOUND_IDS.map((id,i)=>{
  const [bg,ink]=PASTELS[i%PASTELS.length];
  return `<button type="button" class="audio-lab-sound" data-sound="${id}" style="--bg:${bg};--ink:${ink}"><b aria-hidden="true">${SOUND_EMOJI[id]}</b><span>${RECIPES[id].label}</span></button>`;
}).join('')}</div>
<div class="audio-lab-panel"><div class="audio-lab-controls"></div><div class="audio-lab-row"><div class="audio-lab-voices"><span>vozes ativas: <strong></strong></span><small aria-live="polite"></small></div><button type="button" class="audio-lab-chaos">Caos! 💥</button></div></div>
`;
  document.body.append(lab);

  const hint=lab.querySelector<HTMLElement>('.audio-lab-hint')!;
  const voiceCount=lab.querySelector<HTMLElement>('.audio-lab-voices strong')!;
  const chaosResult=lab.querySelector<HTMLElement>('.audio-lab-voices small')!;
  let chaosLine='Caos solta 40 golpes e gemas de uma vez.';
  // Polled every 250 ms: only touch the DOM when text changed, so the live region (chaos line) announces real news only.
  const setText=(el:HTMLElement,text:string)=>{if(el.textContent!==text)el.textContent=text;};
  const renderVoices=()=>{
    setText(voiceCount,`${engine.activeVoices()} / ${MAX_VOICES}`);
    setText(chaosResult,chaosLine);
    if(hint.hidden!==engine.unlocked)hint.hidden=engine.unlocked;
  };

  const timers=new Set<number>();
  const flash=(button:HTMLElement,ok:boolean)=>{
    button.classList.remove('audio-ok','audio-drop');
    void button.offsetWidth;
    button.classList.add(ok?'audio-ok':'audio-drop');
  };
  const onGrid=(event:Event)=>{
    const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-sound]');
    if(!button)return;
    engine.unlock();
    flash(button,engine.play(button.dataset.sound as SoundId));
    renderVoices();
  };
  const onChaos=()=>{
    engine.unlock();
    let played=0,dropped=0;
    for(let i=0;i<CHAOS_PLAYS;i++){
      const t=window.setTimeout(()=>{
        timers.delete(t);
        if(engine.play(Math.random()<0.55?'golpe':'gema'))played++;else dropped++;
        chaosLine=`Caos: ${played} tocaram, ${dropped} barrados pelo limite.`;
        renderVoices();
      },Math.random()*CHAOS_SPREAD_MS);
      timers.add(t);
    }
  };
  const grid=lab.querySelector('.audio-lab-grid')!;
  const chaos=lab.querySelector('.audio-lab-chaos')!;
  grid.addEventListener('click',onGrid);
  chaos.addEventListener('click',onChaos);
  const recheck=()=>queueMicrotask(renderVoices);
  document.addEventListener('pointerdown',recheck,true);

  const detachUnlock=engine.attachUnlock(document);
  const unmountControls=mountAudioControls(lab.querySelector<HTMLElement>('.audio-lab-controls')!,engine);
  const offChange=engine.onChange(renderVoices);
  const poll=window.setInterval(renderVoices,250);
  renderVoices();

  const close=()=>{
    open=false;
    timers.forEach(t=>clearTimeout(t));timers.clear();
    clearInterval(poll);offChange();unmountControls();detachUnlock();
    document.removeEventListener('pointerdown',recheck,true);
    grid.removeEventListener('click',onGrid);
    chaos.removeEventListener('click',onChaos);
    lab.remove();
    engine.suspend();
    html.style.overflow=prevOverflow;document.body.style.overflow=prevBodyOverflow;
    const url=new URL(location.href);url.searchParams.delete('sandbox');
    history.replaceState(history.state,'',url);
  };
  lab.querySelector('.audio-lab-close')!.addEventListener('click',close,{once:true});
}
