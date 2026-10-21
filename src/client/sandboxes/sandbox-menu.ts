/**
 * The match menu in a room (NEW-20261009-UX-menu-e-conexao, modo foto): `?sandbox=config&cena=sala[&vista=menu|config|sair]`.
 * explore.ts's `.explore-settings` dialog with the menu (hud/menu.ts) the way a room builds it: the room code and the
 * connection line, "Copiar convite", the economy and sound rows in "Configurações". No Phaser, no room: "Sair" only counts
 * (body[data-menu-leaves]) and "Continuar" closes the window.
 */
import '../explore.css';
import '../hud/menu.css';
import {getAudio} from '../audio/engine.ts';
import {mountAudioControls} from '../audio/controls.ts';
import {icon} from '../ui/icon.ts';
import {createGameMenu,type MenuView} from '../hud/menu.ts';

const VIEWS:Record<string,MenuView>={menu:'menu',config:'settings',sair:'confirm'};

export function openMenuSandbox(){
  const params=new URLSearchParams(location.search);
  const settings=document.createElement('dialog');settings.className='explore-settings';settings.setAttribute('aria-label','Configurações do jogo');
  settings.innerHTML=`<div class="explore-settings-heading"><h2>Configurações</h2><button class="explore-settings-close" aria-label="Voltar ao jogo">${icon('fechar',{size:32})}</button></div>`
    +`<div class="explore-settings-content"><button type="button" class="explore-economy" aria-pressed="false"><span class="explore-economy-head"><span class="explore-economy-title">Modo econômico</span><span class="explore-economy-tag" data-on="false">Desligado</span></span><span class="explore-economy-note">Menos efeitos, jogo mais leve: poupa bateria.</span></button><div class="explore-sound"></div></div>`;
  const content=settings.querySelector<HTMLElement>('.explore-settings-content')!;
  mountAudioControls(settings.querySelector<HTMLElement>('.explore-sound')!,getAudio());
  let leaves=0;
  const menu=createGameMenu(settings,settings.querySelector<HTMLElement>('.explore-settings-heading h2')!,content,{
    onResume:()=>settings.close(),onLeave:()=>{leaves++;document.body.dataset.menuLeaves=String(leaves);}});
  menu.status.innerHTML='<strong id="coop-code">Sala KZ7Q</strong><p id="coop-network">Conectado · até 6 amigos</p>';
  menu.invite.innerHTML='<button id="coop-copy">Copiar convite</button>';
  settings.querySelector('.explore-settings-close')!.addEventListener('click',()=>settings.close());
  settings.addEventListener('cancel',e=>{e.preventDefault();if(menu.view!=='menu')menu.show('menu');else settings.close();});
  document.body.append(settings);
  settings.showModal();
  menu.show(VIEWS[params.get('vista')??'menu']??'menu');
  document.body.dataset.menuLeaves='0';
}
