/**
 * Settings sandbox (config-audio-musica-efeitos, modo foto): `?sandbox=config[&cena=jogo|menu]`.
 * - jogo: the game's gear window (explore.ts's `.explore-settings` dialog, its own CSS) with the economy row and the real
 *   sound rows (Música, Efeitos, vibration) on the shared engine; the match itself is not loaded (no Phaser, no room).
 * - menu: the creation menu's gear window (audio/settings-dialog.ts) over the real menu, as a tap on its gear opens it.
 * Ready: body[data-config-ready="1"].
 */
import '../explore.css';
import {getAudio} from '../audio/engine.ts';
import {mountAudioControls} from '../audio/controls.ts';
import {openSoundSettings} from '../audio/settings-dialog.ts';
import {icon} from '../ui/icon.ts';

const scene=new URLSearchParams(location.search).get('cena')==='menu'?'menu':'jogo';

if(scene==='menu')openSoundSettings(document.querySelector<HTMLElement>('.menu-config'));
else{
  const settings=document.createElement('dialog');settings.className='explore-settings';settings.setAttribute('aria-label','Configurações do jogo');
  settings.innerHTML=`<div class="explore-settings-heading"><h2>Configurações</h2><button class="explore-settings-close" aria-label="Voltar ao jogo">${icon('fechar',{size:32})}</button></div>`
    +`<div class="explore-settings-content"><button type="button" class="explore-economy" aria-pressed="false"><span class="explore-economy-head"><span class="explore-economy-title">Modo econômico</span><span class="explore-economy-tag" data-on="false">Desligado</span></span><span class="explore-economy-note">Menos efeitos, jogo mais leve: poupa bateria.</span></button><div class="explore-sound"></div></div>`;
  mountAudioControls(settings.querySelector<HTMLElement>('.explore-sound')!,getAudio());
  settings.querySelector('.explore-settings-close')!.addEventListener('click',()=>settings.close());
  document.body.append(settings);
  settings.showModal();
}
document.body.dataset.configReady='1';
