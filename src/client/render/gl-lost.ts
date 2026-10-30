// The phone dropped the game's WebGL context (out of GPU memory; auditoria-erros-cliente E1): the canvas goes black
// with no word. Phaser keeps the context restorable (it calls preventDefault on the loss); this only tells the player
// what happened and gives a way back. A restore before the tap takes the panel down again.
export const GL_LOST_TEXT='A tela do jogo apagou (o celular ficou sem memória). Toque em Voltar pra partida.';
export const GL_LOST_BUTTON='Voltar pra partida';

/** Calls lost/restored on the canvas's context events; returns the unsubscribe. */
export function watchGlLoss(canvas:EventTarget,{lost,restored}:{lost():void;restored():void}):()=>void{
  let down=false;
  const onLost=()=>{if(down)return;down=true;lost();},onRestored=()=>{if(!down)return;down=false;restored();};
  canvas.addEventListener('webglcontextlost',onLost);canvas.addEventListener('webglcontextrestored',onRestored);
  return ()=>{canvas.removeEventListener('webglcontextlost',onLost);canvas.removeEventListener('webglcontextrestored',onRestored);};
}

/** Where "Voltar pra partida" goes: the room link in coop (the room keeps the seat), a reload in solo. */
export function glLostTarget(code:string|undefined,invite:string):string|undefined{
  return code?`/?room=${code}${invite}#personagem`:undefined;
}
