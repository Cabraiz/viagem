/**
 * Settings sandbox (config-audio-musica-efeitos, modo foto): `?sandbox=config[&cena=jogo|menu|sala]`.
 * - jogo: the game's gear window (explore.ts's `.explore-settings` dialog, its own CSS) with the economy row and the real
 *   sound rows (Música, Efeitos, vibration) on the shared engine; the match itself is not loaded (no Phaser, no room).
 * - sala: the gear's menu in a room (sandbox-menu.ts, NEW-20261009-UX-menu-e-conexao): `&vista=menu|config|sair`.
 * - menu: the creation menu's gear window (audio/settings-dialog.ts) over the real menu, as a tap on its gear opens it.
 * Ready: body[data-config-ready="1"].
 */
import '../explore.css';
import {getAudio} from '../audio/engine.ts';
import {mountAudioControls} from '../audio/controls.ts';
import {openSoundSettings} from '../audio/settings-dialog.ts';
import {icon} from '../ui/icon.ts';
import {openMenuSandbox} from './sandbox-menu.ts';

const cena=new URLSearchParams(location.search).get('cena'),scene=cena==='menu'||cena==='sala'?cena:'jogo';

if(scene==='sala')openMenuSandbox();
else if(scene==='menu')openSoundSettings(document.querySelector<HTMLElement>('.menu-config'));
else{
  const settings=document.createElement('dialog');settings.className='explore-settings';settings.setAttribute('aria-label','Configurações do jogo');
  settings.innerHTML=`<div class="explore-settings-heading"><h2>Configurações</h2><button class="explore-settings-close" aria-label="Voltar ao jogo">${icon('fechar',{size:32})}</button></div>`
    +`<div class="explore-settings-content"><div class="explore-economy explore-quality" role="group" aria-label="Qualidade"><span class="explore-economy-head"><span class="explore-economy-title">Qualidade</span><span class="explore-economy-tag" data-on="true">Automática</span></span><span class="explore-quality-levels"><button type="button" data-level="leve" aria-pressed="false">Leve</button><button type="button" data-level="normal" aria-pressed="true">Normal</button><button type="button" data-level="alta" aria-pressed="false">Alta</button></span><span class="explore-economy-note">O jogo inteiro, sem fritar a mão.</span></div><div class="explore-sound"></div></div>`;
  mountAudioControls(settings.querySelector<HTMLElement>('.explore-sound')!,getAudio());
  settings.querySelector('.explore-settings-close')!.addEventListener('click',()=>settings.close());
  document.body.append(settings);
  settings.showModal();
}
document.body.dataset.configReady='1';
