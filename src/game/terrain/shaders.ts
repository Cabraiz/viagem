// Adapted from Crônicas do Império render/terrain/relief.frag.glsl.
// Height intersections/materials are baked on view changes; only water animates.
// D-022 (tropical claro): the scene palette below recolors the approved materials by their luminance.
const common=`
precision highp float;
uniform vec2 resolution;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform float angle;
uniform float elapsed;
uniform vec2 areaOrigin;
uniform vec2 areaSize;
varying vec2 fragCoord;
vec2 rot(vec2 p){if(angle<0.5)return p;if(angle<1.5)return vec2(p.y,-p.x);if(angle<2.5)return -p;return vec2(-p.y,p.x);}
vec2 groundPoint(vec2 w,float z){return rot(vec2((w.y+z)/42.0+w.x/84.0,(w.y+z)/42.0-w.x/84.0)-12.0)+12.0;}
vec4 field(vec2 g){return texture2D(iChannel0,clamp(((g+4.0)*4.0+0.5)/129.0,0.003876,0.996124));}
float bed(vec2 g){return field(g).r*160.0-32.0;}
float h(vec2 g){return max(0.0,bed(g));}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);}
float fbm(vec2 p){return n(p)*0.52+n(p*2.13+37.2)*0.27+n(p*4.37+91.7)*0.14+n(p*8.61)*0.07;}
vec2 materialUV(vec2 p){return clamp(1.0-abs(fract(p*0.5)*2.0-1.0),0.001,0.999);}
vec3 material(sampler2D tex,vec2 p){vec2 q=mat2(0.8,-0.6,0.6,0.8)*p*1.37+vec2(3.27,8.41);float blend=smoothstep(0.30,0.70,fbm(p*1.7))*0.55;return mix(texture2D(tex,materialUV(p)).rgb,texture2D(tex,materialUV(q)).rgb,blend);}
float lum(vec3 c){return dot(c,vec3(.299,.587,.114));}
// Scene palette (D-022, docs/art-direction.md): warm sand, vivid green, turquoise water. Linear-ish sRGB 0..1.
const vec3 GRASS_DARK=vec3(.29,.56,.22),GRASS_LIGHT=vec3(.50,.76,.30),GRASS_SUN=vec3(.62,.82,.34);
const vec3 SAND_DARK=vec3(.86,.74,.52),SAND_LIGHT=vec3(.97,.89,.68);
const vec3 TRAIL_DARK=vec3(.74,.58,.38),TRAIL_LIGHT=vec3(.88,.74,.52);
const vec3 ROCK_DARK=vec3(.58,.60,.58),ROCK_LIGHT=vec3(.80,.80,.74);
const vec3 SEA_DEEP=vec3(.08,.52,.62),SEA_SHALLOW=vec3(.36,.82,.80),FOAM=vec3(.96,.98,.95);
vec2 world(){return areaOrigin+vec2(fragCoord.x,resolution.y-fragCoord.y)/resolution*areaSize;}
`;
export const landShader=common+`
float segment(vec2 p,vec2 a,vec2 b){vec2 d=b-a;return length(p-a-d*clamp(dot(p-a,d)/dot(d,d),0.0,1.0));}
void main(){
 vec2 w=world();float lo=0.0,hi=128.0;
 for(int i=0;i<18;i++){float z=(lo+hi)*0.5;if(z>h(groundPoint(w,z)))hi=z;else lo=z;}
 vec2 g=groundPoint(w,(lo+hi)*0.5);float ground=bed(g);
 if(ground<0.25){gl_FragColor=vec4(0);return;}
 vec4 data=field(g);float e=0.125;
 vec2 grad=vec2(bed(g+vec2(e,0))-bed(g-vec2(e,0)),bed(g+vec2(0,e))-bed(g-vec2(0,e)))/(e*84.0);
 vec3 sun=normalize(vec3(-0.65,-0.32,0.80)),normal=normalize(vec3(-grad,1.0));
 float diffuse=max(0.0,dot(normal,sun)),shadow=1.0;
 for(int i=1;i<=6;i++){float t=float(i)*0.35;float obstruction=h(g+sun.xy*t)-ground-sun.z*t*42.0;shadow=min(shadow,1.0-smoothstep(-4.0,8.0,obstruction)*0.65);}
 float macro=fbm(g*2.3),clumps=fbm(g*14.7+vec2(macro*6.0));
 float patches=smoothstep(0.38,0.64,macro+data.g*0.17);
 // D-022 tropical claro: the approved materials keep only their detail (luminance); color comes from the scene palette.
 float leaf=clamp((lum(material(iChannel1,g/4.0))-0.17)/0.26,0.0,1.0);
 vec3 color=mix(mix(GRASS_DARK,GRASS_LIGHT,leaf),mix(GRASS_DARK,GRASS_SUN,leaf),patches);
 float rock=smoothstep(0.2,0.8,length(grad)*0.9)*smoothstep(0.38,0.58,clumps);
 float stone=clamp((lum(material(iChannel2,g/3.1))-0.30)/0.22,0.0,1.0);
 color=mix(color,mix(ROCK_DARK,ROCK_LIGHT,stone),rock);
 float path=min(min(segment(g,vec2(12,17),vec2(8,11)),segment(g,vec2(8,11),vec2(17,11))),min(segment(g,vec2(8,11),vec2(12,5)),segment(g,vec2(12,5),vec2(17,11))));
 float trail=1.0-smoothstep(0.26,0.56,path+(macro-0.5)*0.12);
 color=mix(color,mix(TRAIL_DARK,TRAIL_LIGHT,stone),trail*.85);
 // Warm sand on the shore band, darker where the waves wet it.
 float beach=1.0-smoothstep(2.6,6.2,ground+(macro-0.5)*2.2);
 vec3 sand=mix(SAND_DARK,SAND_LIGHT,stone);
 sand=mix(sand,sand*vec3(0.86,0.86,0.84),1.0-smoothstep(0.25,1.4,ground));
 color=mix(color,sand,beach);
 // Simple light: soft slope shading and a short, light self-shadow (no heavy real-time lighting).
 color*=0.84+0.24*diffuse*mix(1.0,shadow,0.55);
 gl_FragColor=vec4(clamp(color,0.0,1.0),1.0);
}`;
export const waterShader=common+`
void main(){
 vec2 g=groundPoint(world(),0.0);float depth=max(0.0,-bed(g));
 vec2 flow=g*vec2(7.2,4.4)+vec2(elapsed*0.035,-elapsed*0.32);
 flow+=vec2(fbm(g*1.6),fbm(g*1.9+19.0))*2.4;
 float waterHeight=fbm(flow);
 vec2 waveGrad=vec2(fbm(flow+vec2(.07,0))-fbm(flow-vec2(.07,0)),fbm(flow+vec2(0,.07))-fbm(flow-vec2(0,.07)));
 vec3 riverBed=mix(SAND_DARK,SAND_LIGHT,clamp((lum(material(iChannel2,(g+waveGrad*.16)/4.2))-0.30)/0.22,0.0,1.0));
 float transmission=exp(-depth*.16);
 // Turquoise: sandy bed through shallow water, clear teal far out (never the old near-black sea).
 vec3 water=mix(SEA_DEEP,SEA_SHALLOW,smoothstep(0.0,0.55,transmission));
 water=mix(water,riverBed*vec3(.80,.97,.93),transmission*.55);
 vec3 wn=normalize(vec3(-waveGrad*3.2,1.0));
 float fresnel=.02+.08*pow(1.0-max(0.0,dot(wn,normalize(vec3(.5,.5,.75)))),3.0);
 vec3 sky=mix(vec3(.62,.86,.88),vec3(.84,.95,.94),fbm(flow*.13+48.0));
 water=mix(water,sky,fresnel);
 float glint=pow(max(0.0,dot(wn,normalize(vec3(-.15,-.09,1.0)))),90.0);
 float caustic=smoothstep(.63,.78,waterHeight);
 water+=vec3(.30,.32,.30)*glint*.30+vec3(.06,.08,.07)*caustic*(.2+transmission);
 float foam=(1.0-smoothstep(0.0,1.1,depth))*smoothstep(.58,.78,fbm(flow*1.6));
 water=mix(water,FOAM,foam*.6);
 gl_FragColor=vec4(clamp(water,0.0,1.0),1.0);
}`;
