/**
 * BUG-20261012-E1-marquee-saida-paisagem: the round banner's exit (`rh-faixa`, 84% to 100%) used to slide 40 px up while
 * shrinking, so in a 844x390 landscape it sat over the XP bar and the "Nv" seal for about half a second (and over the
 * camp readout in a 390x844 portrait). The exit now fades in place. This reads the keyframes from hud.css and computes
 * the banner's box at every 50 ms of the 1.8 s run: it must stay inside the box it holds in its slot (the slot sits
 * below the XP bar and the camp readout, so a frame inside it covers neither). Reduced motion: no animation at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MARQUEE_MS} from '../../src/client/hud/zones.ts';

const CSS=readFileSync(new URL('../../src/client/hud/hud.css',import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');

type Box={left:number,top:number,right:number,bottom:number};
type Frame={at:number,opacity:number,transform:string};

/** The `@keyframes name{...}` block's stops, in order (`from`/`to` read as 0/100). */
function keyframes(name:string):Frame[]{
  const start=CSS.indexOf(`@keyframes ${name}{`);
  assert.ok(start>=0,`@keyframes ${name} in hud.css`);
  let depth=0,i=CSS.indexOf('{',start);const open=i;
  for(;i<CSS.length;i++){if(CSS[i]==='{')depth++;else if(CSS[i]==='}'&&--depth===0)break;}
  const body=CSS.slice(open+1,i),frames:Frame[]=[];
  for(const m of body.matchAll(/([\d.%,\sfromto]+)\{([^}]*)\}/g)){
    const decl=Object.fromEntries(m[2].split(';').filter(Boolean).map(d=>{const k=d.indexOf(':');return [d.slice(0,k).trim(),d.slice(k+1).trim()];}));
    for(const stop of m[1].split(',').map(s=>s.trim()).filter(Boolean)){
      const at=stop==='from'?0:stop==='to'?100:parseFloat(stop);
      frames.push({at,opacity:decl.opacity===undefined?1:Number(decl.opacity),transform:decl.transform??'none'});
    }
  }
  return frames.sort((a,b)=>a.at-b.at);
}

/** The uniform scale a keyframe transform applies; throws on anything that moves the box (translate, rotate, skew...). */
function scaleOf(transform:string):number{
  if(transform==='none')return 1;
  const parts=[...transform.matchAll(/([a-zA-Z0-9]+)\(([^)]*)\)/g)];
  assert.equal(parts.map(p=>p[0]).join(' '),transform.replace(/\s+/g,' ').trim(),`only functions in "${transform}"`);
  let s=1;
  for(const [,fn,arg] of parts){
    assert.equal(fn,'scale',`the banner's exit may only scale, found ${fn}(${arg})`);
    const values=arg.split(',').map(v=>Number(v.trim()));
    assert.ok(values.length===1||values[0]===values[1],`uniform scale, found scale(${arg})`);
    s*=values[0];
  }
  return s;
}

/** The banner's box at `t` ms (linear between stops: ease-out never overshoots), scaled about the transform origin. */
function boxAt(hold:Box,origin:{x:number,y:number},frames:Frame[],t:number,duration:number):{box:Box,opacity:number}{
  const p=Math.min(100,Math.max(0,t/duration*100));
  let a=frames[0],b=frames[frames.length-1];
  for(let k=0;k<frames.length-1;k++)if(p>=frames[k].at&&p<=frames[k+1].at){a=frames[k];b=frames[k+1];break;}
  const f=b.at===a.at?0:(p-a.at)/(b.at-a.at);
  const s=scaleOf(a.transform)+(scaleOf(b.transform)-scaleOf(a.transform))*f;
  const ox=hold.left+(hold.right-hold.left)*origin.x,oy=hold.top+(hold.bottom-hold.top)*origin.y;
  return {box:{left:ox+(hold.left-ox)*s,top:oy+(hold.top-oy)*s,right:ox+(hold.right-ox)*s,bottom:oy+(hold.bottom-oy)*s},
    opacity:a.opacity+(b.opacity-a.opacity)*f};
}

const rule=(selector:string)=>{
  const m=CSS.match(new RegExp(`(?:^|})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\{([^}]*)\\}`));
  assert.ok(m,`rule ${selector} in hud.css`);
  return m[1];
};

test('rh-faixa only scales, never above 1, so no frame leaves the banner box',()=>{
  const frames=keyframes('rh-faixa');
  assert.equal(frames[0].at,0);assert.equal(frames[frames.length-1].at,100);
  for(const f of frames){const s=scaleOf(f.transform);assert.ok(s>0&&s<=1,`scale ${s} at ${f.at}%`);}
  // The calm-banner rule (only the LEVEI stamp is a show): a small shrink, not a zoom.
  for(const f of frames)assert.ok(scaleOf(f.transform)>=0.9,`at most a 10% shrink at ${f.at}%`);
});

test('the banner scales about its top edge and runs MARQUEE_MS with an easing that does not overshoot',()=>{
  const marquee=rule('.rh-marquee');
  assert.match(marquee,/transform-origin:50% 0(?:[;\s]|$)/);
  const run=rule('.rh-marquee-in');
  const m=run.match(/animation:rh-faixa ([\d.]+)(m?s) (ease-out|ease|linear|ease-in|ease-in-out) both/);
  assert.ok(m,`animation shorthand: ${run}`);
  assert.equal(Number(m[1])*(m[2]==='s'?1000:1),MARQUEE_MS);
});

test('every 50 ms frame stays inside the held box: clear of the XP bar, the Nv seal and the camp readout',()=>{
  const frames=keyframes('rh-faixa');
  // Boxes measured in the HUD sandbox (state=prepare, DPR 3): held banner, XP bar, Nv seal, camp readout.
  const scenes:{name:string,hold:Box,others:Record<string,Box>}[]=[
    {name:'landscape 844x390',hold:{left:158,top:90,right:546,bottom:143},
      others:{xp:{left:255,top:52,right:675,bottom:78},nv:{left:255,top:52,right:307,bottom:78},camp:{left:460,top:8,right:689,bottom:48}}},
    {name:'portrait 390x844',hold:{left:78,top:160,right:374,bottom:217},
      others:{xp:{left:8,top:85,right:300,bottom:111},nv:{left:8,top:85,right:60,bottom:111},camp:{left:70,top:117,right:300,bottom:153}}},
  ];
  const overlap=(a:Box,b:Box)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
  for(const scene of scenes){
    for(const [k,b] of Object.entries(scene.others))assert.equal(overlap(scene.hold,b),0,`${scene.name}: held banner clear of ${k}`);
    for(let t=0;t<=MARQUEE_MS;t+=50){
      const {box,opacity}=boxAt(scene.hold,{x:.5,y:0},frames,t,MARQUEE_MS);
      const e=1e-9;
      assert.ok(box.left>=scene.hold.left-e&&box.right<=scene.hold.right+e&&box.top>=scene.hold.top-e&&box.bottom<=scene.hold.bottom+e,
        `${scene.name} t=${t}: ${JSON.stringify(box)} inside the held box`);
      if(opacity>0)for(const [k,b] of Object.entries(scene.others))assert.equal(overlap(box,b),0,`${scene.name} t=${t}: over ${k}`);
    }
  }
  // The old exit (translateY(-40px) scale(.4)) is what the parser must refuse.
  assert.throws(()=>scaleOf('translateY(-40px) scale(.4)'));
});

test('reduced motion: the banner does not animate (shown, then gone)',()=>{
  assert.match(CSS,/@media \(prefers-reduced-motion:reduce\)\{\s*\.rh \*,\.rh \*::before,\.rh \*::after\{animation:none!important/);
});
