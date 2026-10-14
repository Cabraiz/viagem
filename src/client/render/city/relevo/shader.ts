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
import {SUN_GLSL,gradeGlsl} from '../../light.ts';
import {ALBEDO_GRID,ALBEDO_MEANS,ALBEDO_SLOTS} from './albedo-meta.ts';

const vec3=(c:number)=>`vec3(${[(c>>16)&255,(c>>8)&255,c&255].map(v=>(v/255).toFixed(4)).join(',')})`;

/**
 * Ground albedo (card NEW-20261014-ORQ-chao-albedo-cidade): how much of each material's own colour survives the palette
 * tint (0: only its light and shade, 1: its full colour). The palette keeps the colour; the photo brings the detail.
 * Ice is the most saturated photo: its tint dominates (D-038 review of the delivery).
 */
export const ALBEDO_CHROMA={neve:.5,'neve-pisada':.7,calcada:.6,gelo:.2,terra:.7,asfalto:.5} as const;
/**
 * World units one photo spans (its mirrored pair twice that). Larger than life on purpose: at the game's camera a real
 * sett (~28 in a photo of ~2.8 m) is ~4 px and reads as grain; the paving and the ice are drawn ~3× life size.
 */
export const ALBEDO_SPAN_UNITS={neve:4.4,'neve-pisada':4.4,calcada:6.6,gelo:6.6,terra:4.4,asfalto:4.4} as const;
/** How strongly the photo's detail shows over the palette tone (0 none .. 1 all): the snows stay quiet under the figures. */
export const ALBEDO_STRENGTH={neve:.55,'neve-pisada':.7,calcada:.9,gelo:.6,terra:.8,asfalto:.7} as const;
/** The albedo's detail never takes a tone further than this from its palette base (the palette's contrast rule). */
export const ALBEDO_SPAN={lo:.72,hi:1.22} as const;
const slot=(name:typeof ALBEDO_SLOTS[number])=>ALBEDO_SLOTS.indexOf(name).toFixed(1);
const mean=(name:typeof ALBEDO_SLOTS[number])=>`vec3(${ALBEDO_MEANS[ALBEDO_SLOTS.indexOf(name)].map(v=>v.toFixed(4)).join(',')})`;
const albedo=(name:typeof ALBEDO_SLOTS[number])=>
  `albedoDetail(${slot(name)},w,${mean(name)},${ALBEDO_CHROMA[name].toFixed(2)},${(1/ALBEDO_SPAN_UNITS[name]).toFixed(4)},${ALBEDO_STRENGTH[name].toFixed(2)})`;

/** Coarse ray steps over the chunk's own height range; 7 bisections refine the hit below 0.1 px. */
export const RELIEF_RAY_STEPS=48;
/** Render units per coarse step at most (~4 px): small chunks with low relief use fewer steps. */
export const RELIEF_STEP_UNITS=0.1;

export const reliefShader=`
precision highp float;
uniform vec2 resolution;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
uniform float albedoOn;
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
// Cliff ridges (cidade-caixas-de-cliff): the WC3 cliff lines (thin barriers, mostly on level ground) are no longer
// boxes but a rounded ridge as high as the box was (BERM), marched by the ray like the hills: snow on its crest, rock
// on its steep flanks in the box's own wall tones (light facing screen left-down, dark right-down). The rise starts
// inside the footprint's edge band, so the walkable ground next to it stays within a few px of groundZ.
const float BERM=${CLIFF_LIP_HEIGHT.toFixed(2)};
const float RISE=${(HEIGHT_PX/Math.hypot(TILE_X,TILE_Y)).toFixed(4)};

const vec3 SNOW_CORE=${vec3(MATERIALS.pedra.clara)};
const vec3 SNOW=${vec3(CITY_PALETTE.neve)},SNOW_SUN=${vec3(MATERIALS['neve-tampa'].luz)},SNOW_SHADE=${vec3(CITY_PALETTE['neve-detalhe'])},SNOW_DEEP=${vec3(MATERIALS['neve-tampa'].escura)};
const vec3 PACKED=${vec3(CITY_PALETTE['neve-pisada'])},PACKED_DETAIL=${vec3(CITY_PALETTE['neve-pisada-detalhe'])};
const vec3 COBBLE=${vec3(CITY_PALETTE.calcada)},COBBLE_JOINT=${vec3(CITY_PALETTE['calcada-junta'])};
const vec3 ICE=${vec3(CITY_PALETTE.gelo)},ICE_DETAIL=${vec3(CITY_PALETTE['gelo-detalhe'])},ICE_GLINT=${vec3(CITY_PALETTE['gelo-brilho'])};
const vec3 WATER=${vec3(CITY_PALETTE.agua)},WATER_SHALLOW=${vec3(CITY_PALETTE['agua-raso'])};
const vec3 RUBBLE=${vec3(CITY_PALETTE['entulho-chao'])},RUBBLE_DETAIL=${vec3(CITY_PALETTE['entulho-chao-detalhe'])};
const vec3 CLIFF_LIGHT=${vec3(CITY_PALETTE['penhasco-clara'])},CLIFF_DARK=${vec3(CITY_PALETTE['penhasco-escura'])},CLIFF_CAP=${vec3(CITY_PALETTE['penhasco-tampa'])};
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
// Ridge profile across the footprint (the bilinear cell mask is 0.5 on its edge, 1 in the middle of a cell).
float berm(vec2 f){float m=smoothstep(0.3,0.95,cover(f).b);return m*m*(3.0-2.0*m);}
// Height the ray and the light see: the ground plus the cliff ridges.
float Hs(vec2 f){return H(f)+BERM*berm(f);}

// Sine-free hash (Hoskins) and value noise, as in terrain/shaders.ts.
float hash(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);}
float fbm(vec2 p){return n(p)*0.52+n(p*2.13+37.2)*0.27+n(p*4.37+91.7)*0.14+n(p*8.61)*0.07;}

// Ground albedo (scripts/chao-albedo.mjs): a 4×2 atlas of seamless material photos, each slot padded by mirroring.
// material() as in Crônicas (terrain/shaders.ts): two reads, the second turned and offset, blended by fbm, with mirrored
// UVs, so the tile never shows a seam nor a repeat. One photo spans ALBEDO_SPAN_UNITS world units (per material).
const vec2 ALBEDO_GRID=vec2(${ALBEDO_GRID.cols.toFixed(1)},${ALBEDO_GRID.rows.toFixed(1)});
const float ALBEDO_INSET=${(ALBEDO_GRID.pad/ALBEDO_GRID.tile).toFixed(5)};
vec2 materialUV(vec2 p){return clamp(1.0-abs(fract(p*0.5)*2.0-1.0),0.001,0.999);}
vec3 albedoAt(float slot,vec2 uv){vec2 cell=vec2(mod(slot,ALBEDO_GRID.x),floor(slot/ALBEDO_GRID.x));return texture2D(iChannel3,(cell+ALBEDO_INSET+uv*(1.0-2.0*ALBEDO_INSET))/ALBEDO_GRID).rgb;}
vec3 material(float slot,vec2 p){vec2 q=mat2(0.8,-0.6,0.6,0.8)*p*1.37+vec2(3.27,8.41);float blend=smoothstep(0.30,0.70,fbm(p*1.7))*0.55;return mix(albedoAt(slot,materialUV(p)),albedoAt(slot,materialUV(q)),blend);}
// The photo's detail as a ratio around 1 over its own mean: its light and shade, and the chroma share of its own colour. The
// caller multiplies the palette tone by it (1 when the atlas is not in: the procedural ground of before).
vec3 albedoDetail(float slot,vec2 w,vec3 mean,float chroma,float perUnit,float strength){
 vec3 a=material(slot,w*perUnit);
 float l=dot(a,vec3(.299,.587,.114))/dot(mean,vec3(.299,.587,.114));
 vec3 r=clamp(mix(vec3(l),a/mean,chroma),${ALBEDO_SPAN.lo.toFixed(2)},${ALBEDO_SPAN.hi.toFixed(2)});
 return mix(vec3(1.0),r,albedoOn*strength);
}

// Light d relative to flat ground: d > 0 lightens toward the sun tone, d < 0 blends to the shade tone, then the deep one.
vec3 ramp(vec3 base,vec3 sun,vec3 shade,vec3 deep,float d){
 if(d>=0.0)return mix(base,sun,clamp(d/0.14,0.0,1.0));
 return d>-0.18?mix(base,shade,-d/0.18):mix(shade,deep,clamp((-d-0.18)/0.24,0.0,1.0));
}
// Snow has one more step: the lilac of a cast shadow's core (still a palette tone, luminance well over 0.131).
vec3 snowRamp(float d){return d>-0.42?ramp(SNOW,SNOW_SUN,SNOW_SHADE,SNOW_DEEP,d):mix(SNOW_DEEP,SNOW_CORE,clamp((-d-0.42)/0.35,0.0,0.6));}

${gradeGlsl('cidade')}
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
 vec2 w=(f+gridOrigin/cellSize)*cellSize;

 // Normal in view space (screen-fixed sun whatever the camera turn).
 vec3 kd=kinds(f),cv=cover(f);
 float cliff=smoothstep(0.3,0.6,cv.b);
 float e=0.12;
 vec2 g=vec2(Hs(f+vec2(e,0.0))-Hs(f-vec2(e,0.0)),Hs(f+vec2(0.0,e))-Hs(f-vec2(0.0,e)))/(2.0*e*cellSize)*RISE*RELIEF_GAIN;
 vec3 sun=${SUN_GLSL}; // the scene's one sun (render/light.ts), fixed on the screen
 vec3 normal=normalize(vec3(-rotv(g),1.0));
 float diffuse=max(0.0,dot(normal,sun));
 // Soft self-shadow: a few taps towards the sun; terrain above the light ray darkens, never to black.
 float shadow=1.0,rise=sun.z/length(sun.xy),h0=Hs(f);
 for(int i=1;i<=6;i++){
  if(float(i)>shadowSamples)break;
  float t=float(i)*0.45;
  vec2 o=unrot(normalize(sun.xy)*t)/cellSize;
  float obstruction=(Hs(f+o)-h0)*RISE-t*rise;
  shadow=min(shadow,1.0-smoothstep(-0.05,0.35,obstruction)*0.75);
 }
 // Hollows hold a little shade (ambient occlusion from the four neighbours one cell away).
 float hollow=clamp(((Hs(f+vec2(1,0))+Hs(f-vec2(1,0))+Hs(f+vec2(0,1))+Hs(f-vec2(0,1)))*0.25-h0)*RISE*0.6,0.0,0.25);
 float flatLit=sun.z;
 float d=diffuse*mix(1.0,shadow,0.85)-flatLit-hollow;

 float macro=fbm(w*0.32),grain=n(w*9.0),fine=n(w*31.0+vec2(17.0,3.0));
 // With the albedo in, the photo carries the small detail: the procedural grain and sparkles drop to a trace.
 float proc=detail*(1.0-0.75*albedoOn);
 float slope=length(g);

 // Fresh snow: soft drifts (bluer hollows of the macro noise), fine grain and a few sparkles in the sun.
 vec3 snow=snowRamp(d);
 snow=mix(snow,SNOW_SHADE,smoothstep(0.58,0.82,macro)*0.22);
 // Grain: towards the sun tone or the shade tone, never outside the pair.
 snow=mix(snow,grain>0.5?SNOW_SUN:SNOW_SHADE,abs(grain-0.5)*0.35*proc);
 snow*=${albedo('neve')};
 snow=mix(snow,vec3(1.0),step(0.93,fine)*step(0.0,d)*0.35*detail);
 vec3 color=snow;

 // Trodden snow on the streets: ruts along a noise grain, ragged edges into the fresh snow.
 float rut=n(rotv(w)*vec2(0.9,7.0));
 vec3 trodden=ramp(mix(PACKED,PACKED_DETAIL,smoothstep(0.55,0.85,rut)*0.6),mix(PACKED,vec3(1.0),0.12),PACKED_DETAIL,PACKED_DETAIL,d);
 trodden*=${albedo('neve-pisada')};
 float pm=smoothstep(0.35,0.65,kd.r+(grain-0.5)*0.35);
 color=mix(color,trodden,pm);

 // Plaza stones: running bond with light joints and a dusting of snow.
 vec2 b=w*vec2(2.4,4.8);b.x+=floor(b.y)*0.5;vec2 bf=fract(b);
 float joint=1.0-smoothstep(0.04,0.10,min(min(bf.x,1.0-bf.x)*0.5,min(bf.y,1.0-bf.y)));
 vec3 cobble=ramp(mix(COBBLE,COBBLE_JOINT,joint*0.8),mix(COBBLE,vec3(1.0),0.12),COBBLE_JOINT,COBBLE_JOINT,d);
 // With the albedo: its own stones and joints instead of the drawn running bond.
 cobble=mix(cobble,ramp(COBBLE,mix(COBBLE,vec3(1.0),0.12),COBBLE_JOINT,COBBLE_JOINT,d)*${albedo('calcada')},albedoOn);
 cobble=mix(cobble,SNOW,smoothstep(0.62,0.85,macro+grain*0.15)*0.55*(1.0-0.5*albedoOn));
 color=mix(color,cobble,smoothstep(0.3,0.7,kd.g));

 // Broken ground: blotches of the two rubble tones under patchy snow.
 vec3 rubble=ramp(mix(RUBBLE,RUBBLE_DETAIL,smoothstep(0.4,0.7,grain)),mix(RUBBLE,vec3(1.0),0.12),RUBBLE_DETAIL,RUBBLE_DETAIL,d);
 rubble*=${albedo('terra')};
 rubble=mix(rubble,snow,smoothstep(0.55,0.8,macro)*0.6);
 color=mix(color,rubble,smoothstep(0.3,0.7,cv.r));

 // Ice sheets: long streaks and a cold glint.
 float streak=n(rotv(w)*vec2(0.6,5.0)+macro*2.0);
 vec3 ice=mix(ICE,ICE_DETAIL,smoothstep(0.45,0.8,streak)*0.7);
 ice*=${albedo('gelo')};
 ice=mix(ice,ICE_GLINT,clamp(smoothstep(0.82,0.95,fine)*0.6*detail+max(0.0,d)*1.5,0.0,1.0));
 color=mix(color,ice,smoothstep(0.3,0.7,kd.b));

 // Exposed rock where the slope is steep (terrace edges, hillsides), snow kept on its flatter ledges.
 float rock=smoothstep(0.55,1.05,slope+(macro-0.5)*0.35)*(1.0-smoothstep(0.2,0.6,kd.g))*(1.0-cv.g);
 vec3 stone=ramp(mix(ROCK,ROCK_SHADE,smoothstep(0.5,0.8,grain)*0.5),ROCK_SUN,ROCK_SHADE,ROCK_SHADE,d);
 stone=mix(stone,snow,smoothstep(0.62,0.8,fine)*0.45);
 color=mix(color,stone,rock);
 // Cliff ridges: rock on the steep flanks, in the cliff box's own wall tones and convention (the flank facing screen
 // left-down light, right-down dark, whatever the sun), broken by snow streaks; the crest keeps the box's cap snow.
 // Only the flanks facing the camera (towards larger qx + qy): a back flank grazed by the ray stays snow, not a dotted line.
 float flank=smoothstep(0.85,0.6,normal.z)*cliff*smoothstep(-0.1,0.2,normal.x+normal.y);
 vec3 cliffRock=mix(CLIFF_LIGHT,CLIFF_DARK,smoothstep(-0.25,0.25,normal.x-normal.y));
 cliffRock=mix(cliffRock,CLIFF_DARK,smoothstep(0.5,0.8,grain)*0.35);
 color=mix(color,mix(CLIFF_CAP,SNOW_SUN,0.5),cliff*(1.0-flank)*0.5);
 color=mix(color,cliffRock,flank*(1.0-smoothstep(0.7,0.85,fine+grain*0.3)*0.5));

 // Water (fountain, lake): deep blue, shallow at its edge. The layer's decor still draws its rim and glints.
 vec3 water=mix(WATER,WATER_SHALLOW,1.0-smoothstep(0.55,0.95,cv.g));
 color=mix(color,water,smoothstep(0.42,0.52,cv.g));

 gl_FragColor=vec4(clamp(lightGrade(color),0.0,1.0),1.0); // lighting card: warm/cool grade, baked (identity with ?luz=0)
}`;
