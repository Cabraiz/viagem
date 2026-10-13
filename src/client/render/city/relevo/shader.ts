/**
 * Relief ground shader of the Cidade Nevada (card NEW-20261013-ORQ-cidade-relevo-pseudo-realista), adapted from
 * Crônicas do Império render/terrain/relief.frag.glsl like the island's terrain/shaders.ts: an orthographic ray per
 * pixel marched down the height field (coarse steps, then bisection), a normal from central differences, a soft
 * self-shadow towards a fixed screen-space sun, and a snow material mixed from the ground masks (field.ts).
 *
 * Colours are the closed city palette (palette.ts, "copy, don't invent") and light only ever blends between two of its
 * measured tones per material or lightens toward white (the contrast rule of palette.ts: the ground never goes darker
 * than its darkest palette tone, so the Breu outlines keep 3:1). Flat ground in full light sits on the palette base
 * colour, with drifts, grain and sparkles blending only toward that material's own palette tones.
 *
 * Coordinates: the quad covers `areaSize` projected px from `areaOrigin` (projection.ts screen space, z = 0 plane);
 * the bake is drawn with flipY (framebuffer rows run bottom-up), as in terrain/renderer.ts.
 */
import {CITY_PALETTE,MATERIALS} from '../palette.ts';
import {CLIFF_LIP_HEIGHT} from '../from-maps.ts';
import {HEIGHT_PX,TILE_X,TILE_Y} from '../projection.ts';

const vec3=(c:number)=>`vec3(${[(c>>16)&255,(c>>8)&255,c&255].map(v=>(v/255).toFixed(4)).join(',')})`;

/** Coarse ray steps over the chunk's own height range; 7 bisections refine the hit below 0.1 px. */
export const RELIEF_RAY_STEPS=48;
/** Render units per coarse step at most (~4 px): small chunks with low relief use fewer steps. */
export const RELIEF_STEP_UNITS=0.1;
/** Height (render units) of a cliff ledge over its ground: the cliff box's own, which it replaces. */
export const CLIFF_LIP=CLIFF_LIP_HEIGHT;

export const reliefShader=`
precision highp float;
uniform vec2 resolution;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform vec2 areaOrigin;
uniform vec2 areaSize;
uniform float view;
uniform vec2 pivot;
uniform vec2 gridOrigin;
uniform vec2 gridSize;
uniform float cellSize;
uniform float maxHeight;
uniform float rayTop;
uniform float raySteps;
uniform vec4 cellRect;
uniform float shadowSamples;
uniform float detail;
varying vec2 fragCoord;

const float TILE_X=${TILE_X.toFixed(1)},TILE_Y=${TILE_Y.toFixed(1)},HEIGHT_PX=${HEIGHT_PX.toFixed(1)};
// Render height units to the horizontal world units of the screen: a 1 u rise is HEIGHT_PX tall, a 1 u run along a
// grid axis is |(TILE_X, TILE_Y)| long, so slopes and shadows read the way they look.
// Shading slopes read steeper than they are, so gentle hills show at the fixed city zoom.
const float RELIEF_GAIN=1.8;
// Cliff ledges (cidade-caixas-de-cliff): the WC3 cliff lines are no longer boxes; their footprint is a rock ledge
// CLIFF_LIP render units proud of the ground (the box's own height, so the same space on screen), marched by the ray
// like the hills. Like the box it replaces: a snow top and rock faces round its edge. Nobody walks there (the
// footprint is blocked in the sim but for a few cells), and actors are drawn over the ground, so none is hidden.
const float CLIFF_LIP=${CLIFF_LIP.toFixed(2)};
const float RISE=${(HEIGHT_PX/Math.hypot(TILE_X,TILE_Y)).toFixed(4)};

const vec3 SNOW_CORE=${vec3(MATERIALS.pedra.clara)};
const vec3 SNOW=${vec3(CITY_PALETTE.neve)},SNOW_SUN=${vec3(MATERIALS['neve-tampa'].luz)},SNOW_SHADE=${vec3(CITY_PALETTE['neve-detalhe'])},SNOW_DEEP=${vec3(MATERIALS['neve-tampa'].escura)};
const vec3 PACKED=${vec3(CITY_PALETTE['neve-pisada'])},PACKED_DETAIL=${vec3(CITY_PALETTE['neve-pisada-detalhe'])};
const vec3 COBBLE=${vec3(CITY_PALETTE.calcada)},COBBLE_JOINT=${vec3(CITY_PALETTE['calcada-junta'])};
const vec3 ICE=${vec3(CITY_PALETTE.gelo)},ICE_DETAIL=${vec3(CITY_PALETTE['gelo-detalhe'])},ICE_GLINT=${vec3(CITY_PALETTE['gelo-brilho'])};
const vec3 WATER=${vec3(CITY_PALETTE.agua)},WATER_SHALLOW=${vec3(CITY_PALETTE['agua-raso'])};
const vec3 RUBBLE=${vec3(CITY_PALETTE['entulho-chao'])},RUBBLE_DETAIL=${vec3(CITY_PALETTE['entulho-chao-detalhe'])};
const vec3 ROCK_SUN=${vec3(MATERIALS.pedra.luz)},ROCK=${vec3(MATERIALS.pedra.clara)},ROCK_SHADE=${vec3(MATERIALS.pedra.escura)};

// Ground -> view rotation (projection.ts rotate) and its inverse.
vec2 rotv(vec2 p){if(view<0.5)return p;if(view<1.5)return vec2(-p.y,p.x);if(view<2.5)return -p;return vec2(p.y,-p.x);}
vec2 unrot(vec2 p){if(view<0.5)return p;if(view<1.5)return vec2(p.y,-p.x);if(view<2.5)return -p;return vec2(-p.y,p.x);}
// Cell coordinates (fractional, from the grid's north-west corner) under screen point s at height z (render units).
vec2 cellAt(vec2 s,float z){
 float sum=(s.y+z*HEIGHT_PX)/TILE_Y,diff=s.x/TILE_X;
 vec2 q=vec2(sum+diff,sum-diff)*0.5;
 return (unrot(q-pivot)+pivot-gridOrigin)/cellSize;
}
vec4 field(vec2 f){return texture2D(iChannel0,(clamp(f,vec2(0.0),gridSize)+0.5)/(gridSize+1.0));}
float H(vec2 f){return field(f).r*maxHeight;}
vec3 kinds(vec2 f){vec2 e=0.5/gridSize;return texture2D(iChannel1,clamp(f/gridSize,e,1.0-e)).rgb;}
vec3 cover(vec2 f){vec2 e=0.5/gridSize;return texture2D(iChannel2,clamp(f/gridSize,e,1.0-e)).rgb;}
// Ledge footprint, sharpened from the half-cell blend of the bilinear mask so its edge is a step, not a ramp.
float lip(vec2 f){return smoothstep(0.38,0.62,cover(f).b);}
// Height the light sees: the ground plus the cliff ledges.
float Hs(vec2 f){return H(f)+CLIFF_LIP*lip(f);}

// Sine-free hash (Hoskins) and value noise, as in terrain/shaders.ts.
float hash(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);}
float fbm(vec2 p){return n(p)*0.52+n(p*2.13+37.2)*0.27+n(p*4.37+91.7)*0.14+n(p*8.61)*0.07;}

// Light d relative to flat ground: d > 0 lightens toward the sun tone, d < 0 blends to the shade tone, then the deep one.
vec3 ramp(vec3 base,vec3 sun,vec3 shade,vec3 deep,float d){
 if(d>=0.0)return mix(base,sun,clamp(d/0.14,0.0,1.0));
 return d>-0.18?mix(base,shade,-d/0.18):mix(shade,deep,clamp((-d-0.18)/0.24,0.0,1.0));
}
// Snow has one more step: the lilac of a cast shadow's core (still a palette tone, luminance well over 0.131).
vec3 snowRamp(float d){return d>-0.42?ramp(SNOW,SNOW_SUN,SNOW_SHADE,SNOW_DEEP,d):mix(SNOW_DEEP,SNOW_CORE,clamp((-d-0.42)/0.35,0.0,0.6));}

void main(){
 vec2 s=areaOrigin+vec2(fragCoord.x,resolution.y-fragCoord.y)/resolution*areaSize;
 // March from the chunk's own ceiling down to 0, then refine: terraces and hills can hide the ground behind them.
 float stepZ=rayTop/max(1.0,raySteps),lo=0.0,hi=stepZ;
 for(int i=0;i<=${RELIEF_RAY_STEPS};i++){
  if(float(i)>raySteps)break;
  float z=max(0.0,rayTop-float(i)*stepZ);
  if(z<=Hs(cellAt(s,z))){lo=z;hi=z+stepZ;break;}
 }
 for(int i=0;i<7;i++){float z=(lo+hi)*0.5;if(z>Hs(cellAt(s,z)))hi=z;else lo=z;}
 vec2 f=cellAt(s,(lo+hi)*0.5);
 // Only the cells this chunk owns (plus its overlap ring): the neighbours draw theirs, decor and shadows included.
 if(f.x<cellRect.x||f.y<cellRect.y||f.x>=cellRect.z||f.y>=cellRect.w){gl_FragColor=vec4(0.0);return;}
 float ground=H(f);
 vec2 w=(f+gridOrigin/cellSize)*cellSize;

 // Normal in view space (screen-fixed sun whatever the camera turn).
 float e=0.2;
 vec3 kd=kinds(f),cv=cover(f);
 // Ledge: its top (inside the footprint, flat) and its faces (where the footprint steps, both sides of the edge).
 float ledge=lip(f);
 float stepAt=length(vec2(lip(f+vec2(e,0.0))-lip(f-vec2(e,0.0)),lip(f+vec2(0.0,e))-lip(f-vec2(0.0,e))));
 float face=smoothstep(0.08,0.35,stepAt);
 vec2 g=vec2(Hs(f+vec2(e,0.0))-Hs(f-vec2(e,0.0)),Hs(f+vec2(0.0,e))-Hs(f-vec2(0.0,e)))/(2.0*e*cellSize)*RISE*RELIEF_GAIN;
 vec3 sun=normalize(vec3(-0.65,-0.32,0.62));
 vec3 normal=normalize(vec3(-rotv(g),1.0));
 float diffuse=max(0.0,dot(normal,sun));
 // Soft self-shadow: a few taps towards the sun; terrain above the light ray darkens, never to black.
 float shadow=1.0,rise=sun.z/length(sun.xy);
 for(int i=1;i<=6;i++){
  if(float(i)>shadowSamples)break;
  float t=float(i)*0.45;
  vec2 o=unrot(normalize(sun.xy)*t)/cellSize;
  float obstruction=(Hs(f+o)-Hs(f))*RISE-t*rise;
  shadow=min(shadow,1.0-smoothstep(-0.05,0.35,obstruction)*0.75);
 }
 // Hollows hold a little shade (ambient occlusion from the four neighbours one cell away).
 float hollow=clamp(((Hs(f+vec2(1,0))+Hs(f-vec2(1,0))+Hs(f+vec2(0,1))+Hs(f-vec2(0,1)))*0.25-Hs(f))*RISE*0.6,0.0,0.25);
 float flatLit=sun.z;
 float d=diffuse*mix(1.0,shadow,0.85)-flatLit-hollow;

 float macro=fbm(w*0.32),grain=n(w*9.0),fine=n(w*31.0+vec2(17.0,3.0));
 float slope=length(g);

 // Fresh snow: soft drifts (bluer hollows of the macro noise), fine grain and a few sparkles in the sun.
 vec3 snow=snowRamp(d);
 snow=mix(snow,SNOW_SHADE,smoothstep(0.58,0.82,macro)*0.22);
 // Grain: towards the sun tone or the shade tone, never outside the pair.
 snow=mix(snow,grain>0.5?SNOW_SUN:SNOW_SHADE,abs(grain-0.5)*0.35*detail);
 snow=mix(snow,vec3(1.0),step(0.93,fine)*step(0.0,d)*0.35*detail);
 vec3 color=snow;

 // Trodden snow on the streets: ruts along a noise grain, ragged edges into the fresh snow.
 float rut=n(rotv(w)*vec2(0.9,7.0));
 vec3 trodden=ramp(mix(PACKED,PACKED_DETAIL,smoothstep(0.55,0.85,rut)*0.6),mix(PACKED,vec3(1.0),0.12),PACKED_DETAIL,PACKED_DETAIL,d);
 float pm=smoothstep(0.35,0.65,kd.r+(grain-0.5)*0.35);
 color=mix(color,trodden,pm);

 // Plaza stones: running bond with light joints and a dusting of snow.
 vec2 b=w*vec2(2.4,4.8);b.x+=floor(b.y)*0.5;vec2 bf=fract(b);
 float joint=1.0-smoothstep(0.04,0.10,min(min(bf.x,1.0-bf.x)*0.5,min(bf.y,1.0-bf.y)));
 vec3 cobble=ramp(mix(COBBLE,COBBLE_JOINT,joint*0.8),mix(COBBLE,vec3(1.0),0.12),COBBLE_JOINT,COBBLE_JOINT,d);
 cobble=mix(cobble,SNOW,smoothstep(0.62,0.85,macro+grain*0.15)*0.55);
 color=mix(color,cobble,smoothstep(0.3,0.7,kd.g));

 // Broken ground: blotches of the two rubble tones under patchy snow.
 vec3 rubble=ramp(mix(RUBBLE,RUBBLE_DETAIL,smoothstep(0.4,0.7,grain)),mix(RUBBLE,vec3(1.0),0.12),RUBBLE_DETAIL,RUBBLE_DETAIL,d);
 rubble=mix(rubble,snow,smoothstep(0.55,0.8,macro)*0.6);
 color=mix(color,rubble,smoothstep(0.3,0.7,cv.r));

 // Ice sheets: long streaks and a cold glint.
 float streak=n(rotv(w)*vec2(0.6,5.0)+macro*2.0);
 vec3 ice=mix(ICE,ICE_DETAIL,smoothstep(0.45,0.8,streak)*0.7);
 ice=mix(ice,ICE_GLINT,clamp(smoothstep(0.82,0.95,fine)*0.6*detail+max(0.0,d)*1.5,0.0,1.0));
 color=mix(color,ice,smoothstep(0.3,0.7,kd.b));

 // Exposed rock where the slope is steep (terrace edges, hillsides), snow kept on its flatter ledges.
 float rock=smoothstep(0.55,1.05,slope+(macro-0.5)*0.35)*(1.0-smoothstep(0.2,0.6,kd.g))*(1.0-cv.g);
 vec3 stone=ramp(mix(ROCK,ROCK_SHADE,smoothstep(0.5,0.8,grain)*0.5),ROCK_SUN,ROCK_SHADE,ROCK_SHADE,d);
 stone=mix(stone,snow,smoothstep(0.62,0.8,fine)*0.45);
 // Cliff ledges: rock on the faces (lit by the step's own normal), the top keeps a lighter cap of snow.
 rock=max(rock*(1.0-ledge*(1.0-face)),face);
 color=mix(color,stone,rock);
 color=mix(color,mix(SNOW_SUN,SNOW,smoothstep(0.6,0.9,macro)*0.5),ledge*(1.0-face)*0.7);

 // Water (fountain, lake): deep blue, shallow at its edge. The layer's decor still draws its rim and glints.
 vec3 water=mix(WATER,WATER_SHALLOW,1.0-smoothstep(0.55,0.95,cv.g));
 color=mix(color,water,smoothstep(0.42,0.52,cv.g));

 gl_FragColor=vec4(clamp(color,0.0,1.0),1.0);
}`;
