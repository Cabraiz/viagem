/**
 * "Levemente realista" lighting (card iluminacao-levemente-realista, after cronicas-do-imperio): ONE sun for the whole
 * scene and the numbers every pass shares — the ground shaders' sun, the cast shadows' length, the building and actor
 * tints and the one-pass colour grade with its vignette. `?luz=0` turns all of it off (today's look, to compare).
 *
 * The sun is fixed on the SCREEN (view space, the axes of render/city/projection.ts: qx−qy to the right, qx+qy down),
 * like Executor-8's city relief: light comes from the upper left in all four camera views, shadows fall right-down.
 * Pure (no Phaser): the grade is mirrored here in TypeScript so the contrast rule can be tested on the graded colours.
 */

/** Unit sun vector in view space: upper left, ~40° above the ground (Executor-8's relief sun, z lowered from 0.80). */
export const SUN_VIEW:readonly [number,number,number]=(()=>{
  const v=[-0.65,-0.32,0.62],l=Math.hypot(v[0],v[1],v[2]);
  return Object.freeze([v[0]/l,v[1]/l,v[2]/l]) as unknown as readonly [number,number,number];
})();
/** Cast shadow length on flat ground per unit of caster height (horizontal over vertical sun component, ≈1.17). */
export const SHADOW_PER_HEIGHT=Math.hypot(SUN_VIEW[0],SUN_VIEW[1])/SUN_VIEW[2];
/** GLSL literal of the sun, for the shaders that build their source from TS (`vec3 sun=${SUN_GLSL};`). */
export const SUN_GLSL=`normalize(vec3(${SUN_VIEW.map(v=>v.toFixed(5)).join(',')}))`;
/**
 * Cast shadow with the light on (card: ~35%): a dusky blue, not Breu, so snow in the shade goes cold and the darkest
 * ground (rubble on a shade slope) keeps the 0.131 floor of the contrast rule (Breu at 35% would not; tests pin it).
 */
export const LIT_SHADOW=Object.freeze({color:0x3c3f6e,alpha:0.35});

/** `?luz=0` (or `luz=off`) turns the lighting off; anything else, or no flag, keeps it on. */
export function lightEnabled(search:string=typeof location==='undefined'?'':location.search):boolean{
  const v=new URLSearchParams(search).get('luz');
  return v!=='0'&&v!=='off';
}

/**
 * Colour grade of one map: shadows a touch colder, lights a touch warmer (split toning by luminance, hue only: luma kept),
 * highlights above `pivot` lifted by `contrast`, a vignette darkening the corners by at most `vignette`. Darks never get
 * darker except under the vignette, so the Breu outline keeps its 3:1 (tests/client/light.test.ts).
 */
export interface Grade {readonly cool:readonly [number,number,number];readonly warm:readonly [number,number,number];readonly contrast:number;readonly pivot:number;readonly vignette:number}
export type LightWorld='cidade'|'infinito'|'ilha';
export const GRADES:Readonly<Record<LightWorld,Grade>>=Object.freeze({
  // Snow: bluish in the shade, golden in the sun (card), the strongest grade.
  cidade:Object.freeze({cool:Object.freeze([0.93,0.97,1.07]),warm:Object.freeze([1.03,1.01,0.97]),contrast:0.05,pivot:0.6,vignette:0.03}) as Grade,
  // Tropical green (D-022): lighter touch, the palette is already warm.
  infinito:Object.freeze({cool:Object.freeze([0.96,0.99,1.04]),warm:Object.freeze([1.04,1.01,0.95]),contrast:0.06,pivot:0.6,vignette:0.03}) as Grade,
  ilha:Object.freeze({cool:Object.freeze([0.96,0.99,1.04]),warm:Object.freeze([1.04,1.01,0.95]),contrast:0.06,pivot:0.6,vignette:0.03}) as Grade,
});
/** Luminance band of the split toning: below it the cold tint, above it the warm one (snow in the sun is the top). */
export const TONE_SPLIT=Object.freeze([0.3,0.95] as const);
/** Where the vignette starts and is full, as a share of the half diagonal from the screen centre. */
export const VIGNETTE_RANGE=Object.freeze([0.55,1.0] as const);

const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/**
 * The grade of one colour (r, g, b in 0..1) at `radius` (0 centre .. 1 corner, share of the half diagonal), `vignette`
 * on or off (economy mode turns it off). gradeGlsl is the same arithmetic without the vignette (an overlay: vignette.ts).
 */
export function gradeColor(rgb:readonly [number,number,number],g:Grade,radius=0,vignette=true):[number,number,number]{
  const L=rgb[0]*.299+rgb[1]*.587+rgb[2]*.114,t=smooth(TONE_SPLIT[0],TONE_SPLIT[1],L);
  const v=vignette?1-g.vignette*smooth(VIGNETTE_RANGE[0],VIGNETTE_RANGE[1],radius):1;
  const tinted=[0,1,2].map(i=>rgb[i]*(g.cool[i]+(g.warm[i]-g.cool[i])*t));
  // Hue only: the tinted colour keeps the source luma, so dark faces never sink toward the Breu outline.
  const L1=tinted[0]*.299+tinted[1]*.587+tinted[2]*.114,k=L/Math.max(L1,1e-4);
  return tinted.map(c=>{
    const h=c*k,lifted=h+Math.max(h-g.pivot,0)*g.contrast; // contrast lifts the highlights only
    return Math.max(0,Math.min(1,lifted*v));
  }) as [number,number,number];
}
export const rgbOf=(hex:number):[number,number,number]=>[(hex>>16&255)/255,(hex>>8&255)/255,(hex&255)/255];

/**
 * The grade as a GLSL function for the ground shaders (endless/island terrain, the city relief): they bake into cached
 * textures, so the grade costs nothing per frame and never touches the canvas antialias of the outlines (a post pass
 * would: its render target has no multisampling). Same arithmetic as gradeColor without the vignette (that one is an
 * overlay, render/vignette.ts). `?luz=0`: the identity.
 */
export function gradeGlsl(world:LightWorld,on=lightEnabled()):string{
  if(!on)return 'vec3 lightGrade(vec3 c){return c;}';
  const g=GRADES[world],v3=(v:readonly number[])=>`vec3(${v.map(x=>x.toFixed(3)).join(",")})`; // 3 decimals: multipliers, not palette tones (city-relevo test)
  return `vec3 lightGrade(vec3 c){
  vec3 w=vec3(.299,.587,.114);float L=dot(c,w);
  c*=mix(${v3(g.cool)},${v3(g.warm)},smoothstep(${TONE_SPLIT[0].toFixed(2)},${TONE_SPLIT[1].toFixed(2)},L));
  c*=L/max(dot(c,w),1e-4);
  return c+max(c-${g.pivot.toFixed(3)},0.0)*${g.contrast.toFixed(3)};
}`;
}

/**
 * Four-corner tints (Phaser setTint(topLeft, topRight, bottomLeft, bottomRight)) for art lit by the upper-left sun:
 * buildings get the warm sun side and a colder, darker shade side and foot; actors a light warm edge on the sun side
 * (multiplies: the Breu outline stays Breu).
 */
export const BUILDING_TINT=Object.freeze({topLeft:0xfffaf2,topRight:0xfafafd,bottomLeft:0xfaf7f2,bottomRight:0xf4f5fb});
export const ACTOR_TINT=Object.freeze({topLeft:0xfffaf0,topRight:0xf6f6fa,bottomLeft:0xf6f2ec,bottomRight:0xe6e9f2});
