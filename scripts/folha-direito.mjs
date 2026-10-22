// The print sheet's right-button check (scripts/folha-prints.mjs rightClick; NEW-20261021-ORQ-direito-ataca-e-cone-no-ar),
// pure enough for node (tests/tools/folha-direito.test.ts). BUG-20261022-ORQ-botao-direito-anda: the check compared the
// drawn sprite before and after the hold and failed ~2 sheets in 3 since it was born (af6fa43), on any branch, with the
// hero in his idle pose. Measured on CI (swiftshader, ~4 fps): the sprite still slid from the hold-to-follow's late
// correction, and the room's answer moved the prediction in whole walk steps (0.2 u in the city) along the last walk —
// the room guesses walk steps past a slow client's last report (input-track HORIZON_STEPS, never rewound) and its frames
// show them only as that client's clock moves on again, which the held attack's steps do. Neither is a step of the button.
// So: wait for the hero to settle, then fail only when his OWN input walks during the hold (a route, a walking intent or
// a pending step with a direction); a move of his room position is a warning with its size.

/** The hero's own position in the room (world units, the client's prediction), or null without a net session. In the page. */
export const PREDICTED=()=>{const n=window.__perfScene?.hooks?.net;return n?.predicted?{x:n.predicted.x,y:n.predicted.y}:null;};
/** The prediction moved more than this (world units; a city walk step is ~0.2 u): worth a warning. */
export const PREDICTED_MOVE=.15;
/** Still this long (ms) counts as settled; given up after SETTLE_MAX_MS (a warning, the walk is not judged). */
export const SETTLE_MS=1200,SETTLE_MAX_MS=12000;
/**
 * In the page: resolves true once the hero has no route left, every step acked (no pending input) and his prediction
 * still for `still` ms; false after `max` ms or without a net session.
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
 * In the page, every drawn frame for `n` frames or `ms` while the button is held: the hero's texture keys (the attack
 * frame) and his own walk — the longest route, the largest walking intent, the pending steps with a direction (the
 * inputs the room will walk) and whether the hold-to-follow was on.
 */
export const HOLD_SAMPLE=([n,ms])=>new Promise(done=>{
  const keys=[],own={route:0,intent:0,steps:0,follow:false},seen=new Set(),end=performance.now()+ms;
  const step=()=>{
    const s=window.__perfScene,a=s?.actor,net=s?.hooks?.net;
    if(a)keys.push(String(a.texture?.key??''));
    if(s){
      own.route=Math.max(own.route,s.route?.length??0);
      own.intent=Math.max(own.intent,s.intent?Math.hypot(s.intent.x,s.intent.y):0);
      own.follow||=!!s.hold?.held;
      for(const i of net?.pending??[])if(Math.hypot(i.x,i.y)>=.01&&!seen.has(i.seq)){seen.add(i.seq);own.steps++;}
    }
    if(keys.length<n&&performance.now()<end)requestAnimationFrame(step);else done({keys,own});
  };
  requestAnimationFrame(step);
});
/**
 * The verdict of one hold: {fail} when the button walked the hero (his own input), {aviso} lines otherwise worth a look,
 * {} when fine. `settled`: SETTLE before the press; `own`: HOLD_SAMPLE's; `before`/`after`: PREDICTED around the hold.
 */
export function rightVerdict({settled,own,before,after},screen){
  if(!settled)return {aviso:`${screen}: botão direito: o herói não assentou em ${SETTLE_MAX_MS/1000} s depois do mouse (rota, passos sem ack ou correção); andar não é julgado`};
  if(!own)return {aviso:`${screen}: botão direito: sem amostra do herói durante o botão (a página recarregou?); andar não é julgado`};
  const walked=[own.route?`rota de ${own.route} pontos`:'',own.intent>.05?'direção de andar':'',own.steps?`${own.steps} passos com direção`:'',own.follow?'segurar-e-seguir ligado':''].filter(Boolean);
  if(walked.length)return {fail:`${screen}: botão direito andou com o herói (${walked.join(', ')}; devia só atacar)`};
  const moved=before&&after?Math.hypot(after.x-before.x,after.y-before.y):0;
  return moved>PREDICTED_MOVE?{aviso:`${screen}: botão direito: a sala moveu o herói ${moved.toFixed(2)} u durante o ataque, sem passo dele (correção de rede)`}:{};
}
