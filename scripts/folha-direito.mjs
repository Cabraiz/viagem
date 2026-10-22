// The print sheet's right-button check (scripts/folha-prints.mjs rightClick; NEW-20261021-ORQ-direito-ataca-e-cone-no-ar),
// pure enough for node (tests/tools/folha-direito.test.ts). BUG-20261022-ORQ-botao-direito-anda: the check compared the
// drawn sprite before and after the hold and failed ~2 sheets in 3 since it was born (af6fa43), on any branch, with the
// hero in his idle pose. Measured on CI (swiftshader, ~4 fps): the sprite still slid from the hold-to-follow's late
// correction, and the room's answer moved the prediction in whole walk steps (0.2 u in the city) along the last walk —
// the room guesses walk steps past a slow client's last report (input-track HORIZON_STEPS, never rewound) and its frames
// show them only as that client's clock moves on again, which the held attack's steps do. Neither is a step of the button.
// So: wait for the hold-to-follow's route to end, mark where his own input stands just before the press, and fail only
// when that input walks during the hold (a new route, a walking intent from a still hero, new steps with a direction or
// the hold-to-follow on); a move of his room position is a warning with its size.

/** The hero's own position in the room (world units, the client's prediction), or null without a net session. In the page. */
export const PREDICTED=()=>{const n=window.__perfScene?.hooks?.net;return n?.predicted?{x:n.predicted.x,y:n.predicted.y}:null;};
/** The prediction moved more than this (world units; a city walk step is ~0.2 u): worth a warning. */
export const PREDICTED_MOVE=.15;
/** No route and no hold-to-follow for this long (ms) counts as settled; waited at most SETTLE_MAX_MS (then a warning). */
export const SETTLE_MS=600,SETTLE_MAX_MS=12000;
/** In the page: resolves true once the hero has had no route and no hold-to-follow for `still` ms; false after `max` ms. */
export const SETTLE=([still,max])=>new Promise(done=>{
  const end=performance.now()+max;let since=performance.now();
  const check=()=>{
    const s=window.__perfScene;
    if(!s)return done(false);
    if(s.route?.length||s.hold?.held)since=performance.now();
    else if(performance.now()-since>=still)return done(true);
    if(performance.now()>end)return done(false);
    setTimeout(check,100);
  };
  check();
});
/**
 * In the page, right before the press: where the hero's own input stands (his route, the last step he took) in
 * window.__holdBase, for HOLD_SAMPLE.
 */
export const HOLD_BASE=()=>{
  const s=window.__perfScene,n=s?.hooks?.net;
  const seq=n?.batcher?.seq??Math.max(0,...(n?.pending??[]).map(i=>i.seq));
  window.__holdBase={route:s?.route,routeLength:s?.route?.length??0,seq};
  return {routeLength:window.__holdBase.routeLength,seq};
};
/**
 * In the page, every drawn frame for `n` frames or `ms` while the button is held: the hero's texture keys (the attack
 * frame) and his own walk since HOLD_BASE — the longest new route, whether the hold-to-follow was on and, when he had
 * no route to finish, the largest walking intent and the steps after the press with a direction (the inputs the room walks).
 */
export const HOLD_SAMPLE=([n,ms])=>new Promise(done=>{
  const base=window.__holdBase??{route:undefined,routeLength:0,seq:Infinity};
  const keys=[],own={route:0,intent:0,steps:0,follow:false},seen=new Set(),end=performance.now()+ms;
  const step=()=>{
    const s=window.__perfScene,a=s?.actor,net=s?.hooks?.net;
    if(a)keys.push(String(a.texture?.key??''));
    if(s){
      if(s.route&&s.route!==base.route)own.route=Math.max(own.route,s.route.length);
      if(!base.routeLength)own.intent=Math.max(own.intent,s.intent?Math.hypot(s.intent.x,s.intent.y):0);
      own.follow||=!!s.hold?.held;
      if(!base.routeLength)for(const i of net?.pending??[])if(i.seq>base.seq&&Math.hypot(i.x,i.y)>=.01&&!seen.has(i.seq)){seen.add(i.seq);own.steps++;}
    }
    if(keys.length<n&&performance.now()<end)requestAnimationFrame(step);else done({keys,own});
  };
  requestAnimationFrame(step);
});
/**
 * The verdict of one hold: {fail} when the button walked the hero (his own input), {aviso} lines worth a look, {} when
 * fine. `settled`: SETTLE before the press (an unsettled hero is still judged, against HOLD_BASE); `own`: HOLD_SAMPLE's;
 * `before`/`after`: PREDICTED around the hold.
 */
export function rightVerdict({settled,own,before,after},screen){
  const avisos=settled?[]:[`${screen}: botão direito: o herói ainda andava a rota do mouse depois de ${SETTLE_MAX_MS/1000} s (julgado contra o que ele já fazia)`];
  if(!own)return {aviso:[...avisos,`${screen}: botão direito: sem amostra do herói durante o botão (a página recarregou?); andar não é julgado`].join(' | ')};
  const walked=[own.route?`rota nova de ${own.route} pontos`:'',own.intent>.05?'direção de andar':'',own.steps?`${own.steps} passos com direção`:'',own.follow?'segurar-e-seguir ligado':''].filter(Boolean);
  const moved=before&&after?Math.hypot(after.x-before.x,after.y-before.y):0;
  if(!walked.length&&moved>PREDICTED_MOVE)avisos.push(`${screen}: botão direito: a sala moveu o herói ${moved.toFixed(2)} u durante o ataque, sem passo dele (correção de rede)`);
  return {...(walked.length?{fail:`${screen}: botão direito andou com o herói (${walked.join(', ')}; devia só atacar)`}:{}),...(avisos.length?{aviso:avisos.join(' | ')}:{})};
}
