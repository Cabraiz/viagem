import type { HeroClass } from '../classes.ts';
import { CoopClient } from './net/client.ts';
import './coop.css';
export async function openLobby(hero:HeroClass,name:string){
  const dialog=document.createElement('dialog');dialog.className='coop-lobby';dialog.setAttribute('aria-label','Jogar com amigos');
  dialog.innerHTML=`<button class="coop-close" aria-label="Fechar">×</button><small>ILHA DO COMEÇO · COOPERATIVO</small><h2>Chama a turma.</h2><p>Até seis personagens na mesma ilha. Compartilhe o código, encontre os amigos e enfrentem as gosmas.</p><button id="create-room">Criar sala</button><div class="coop-divider">ou entre na sala de alguém</div><form><label for="room-code">Código da sala</label><input id="room-code" maxlength="10" pattern="[a-fA-F0-9]{10}" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="10 letras e números"/><button type="submit">Entrar na sala</button></form><p class="coop-status" role="status"></p><small>Partidas de até 30 minutos. Pontos desta versão valem só na sala. As classes ainda compartilham o mesmo ataque básico.</small>`;
  document.body.append(dialog);dialog.showModal();
  const status=dialog.querySelector<HTMLElement>('.coop-status')!;
  for(const b of dialog.querySelectorAll<HTMLButtonElement>('button:not(.coop-close)'))b.disabled=true;
  status.textContent='Preparando conexão com as salas…';
  let client:CoopClient|undefined,closed=false;
  const cancel=()=>{closed=true;client?.leave();dialog.close();dialog.remove();document.getElementById('confirm')?.focus();};
  dialog.querySelector('.coop-close')!.addEventListener('click',cancel);
  dialog.addEventListener('cancel',e=>{e.preventDefault();cancel();});
  const endpoint=await fetch('/multiplayer.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(c=>c?.endpoint as string|undefined).catch(()=>undefined);
  if(closed)return;
  const codeInput=dialog.querySelector<HTMLInputElement>('#room-code')!;
  codeInput.value=new URL(location.href).searchParams.get('room')?.toUpperCase()??'';
  let busy=false;
  async function enter(create:boolean){
    if(busy||closed)return;
    if(!endpoint){status.textContent='As salas ainda não estão disponíveis neste endereço. Tente novamente após a publicação.';return;}
    busy=true;for(const b of dialog.querySelectorAll<HTMLButtonElement>('button:not(.coop-close)'))b.disabled=true;
    try{
      let code=codeInput.value.trim().toUpperCase();
      if(create){status.textContent='Criando sua sala…';const r=await fetch(new URL('/rooms',endpoint),{method:'POST',signal:AbortSignal.timeout(10000)});const data=await r.json();if(!r.ok)throw new Error(data.error??'Não foi possível criar a sala.');code=data.code;codeInput.value=code;}
      if(closed)return;
      if(!/^[A-F0-9]{10}$/.test(code))throw new Error('O código deve ter 10 letras e números.');
      client=new CoopClient(endpoint,code,name,hero.id);client.onStatus=m=>{status.textContent=m;};await client.join();
      if(closed){client.leave();return;}
      const {openExploration}=await import('./explore.ts');dialog.close();dialog.remove();await openExploration(hero,name,client);
    }catch(e){client?.leave();if(!closed)status.textContent=e instanceof Error?e.message:'A conexão falhou. Tente novamente.';}
    finally{busy=false;for(const b of dialog.querySelectorAll<HTMLButtonElement>('button'))b.disabled=false;}
  }
  dialog.querySelector('#create-room')!.addEventListener('click',()=>void enter(true));
  dialog.querySelector('form')!.addEventListener('submit',e=>{e.preventDefault();void enter(false);});
  for(const b of dialog.querySelectorAll<HTMLButtonElement>('button:not(.coop-close)'))b.disabled=false;
  status.textContent=endpoint?'':'As salas ainda não estão disponíveis neste endereço.';
}
