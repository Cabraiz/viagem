// The print sheet's right-button check (scripts/folha-prints.mjs rightClick; NEW-20261021-ORQ-direito-ataca-e-cone-no-ar),
// pure enough for node (tests/tools/folha-direito.test.ts). BUG-20261022-ORQ-botao-direito-anda: the check read the drawn
// sprite ~1 s after the hold-to-follow, while the room's late correction of that walk still slid it (SelfCorrection fades
// at most a few px per frame, and swiftshader draws ~4 fps): "botão direito andou" on ~2 sheets in 3 since the check was
// born (af6fa43). Now it waits for the hero to settle and judges his prediction, which only his own steps (and the room's
// answer to them) move: the real fault it then caught was a held attack sliding a hero on pombo poop (maps/prediction.ts).

/** The hero's own position in the room (world units, the client's prediction), or null without a net session. In the page. */
export const PREDICTED=()=>{const n=window.__perfScene?.hooks?.net;return n?.predicted?{x:n.predicted.x,y:n.predicted.y}:null;};
/** The prediction moved more than this (world units; the city walk is ~2 u/s, a 50 ms step ~0.1 u): the button walked him. */
export const PREDICTED_MOVE=.15;
/** Still this long (ms) counts as settled; given up after SETTLE_MAX_MS (a warning, the walk is not judged). */
export const SETTLE_MS=1200,SETTLE_MAX_MS=12000;
/**
 * In the page: resolves true once the hero has no route left, every step acked (no pending input) and his prediction
 * still for `still` ms (a room that guessed past the stop answers late, after the ack); false after `max` ms or without
 * a net session.
 */
export const SETTLE=([still,max])=>new Promise(done=>{
  const end=performance.now()+max;let at=null,since=performance.now();
  const check=()=>{
    const s=window.__perfScene,n=s?.hooks?.net;
    if(!n?.predicted)return done(false);
    const q=n.predicted,quiet=!s.route?.length&&!n.pending?.length;
    if(!at||!quiet||Math.hypot(q.x-at.x,q.y-at.y)>.01){at={x:q.x,y:q.y};since=performance.now();}
    else if(performance.now()-since>=still)return done(true);
    if(performance.now()>end)return done(false);
    setTimeout(check,100);
  };
  check();
});
/**
 * The verdict of one hold: the sheet's fail (or warning) line, or '' when fine. `settled`: SETTLE's answer before the
 * press; `before`/`after`: PREDICTED around the hold.
 */
export function rightVerdict({settled,before,after},screen){
  if(!settled)return {aviso:`${screen}: botão direito: o herói não assentou em ${SETTLE_MAX_MS/1000} s depois do mouse (rota, passos sem ack ou correção); andar não é julgado`};
  if(!before||!after)return {aviso:`${screen}: botão direito: sem a posição prevista do herói (sem sala?); andar não é julgado`};
  const walked=Math.hypot(after.x-before.x,after.y-before.y);
  return walked>PREDICTED_MOVE?{fail:`${screen}: botão direito andou com o herói ${walked.toFixed(2)} u (devia só atacar)`}:{};
}
