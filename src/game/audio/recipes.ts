/**
 * Procedural sound recipes (VGM-050). Pure data: no WebAudio here, so tests can inspect them.
 * Budget: each sound <= 1.6 s (golpe/gema <= 0.15 s), <= 8 tones, 30..8000 Hz, gain <= 0.6.
 */
import { SOUND_IDS, type SoundId, type SoundRecipe, type Tone } from './types.ts';

const LOW={type:'lowpass',freq:2600,q:0.7} as const;

function recipe(id:SoundId,label:string,throttleMs:number,priority:number,tones:Tone[],vibrate?:number[]):SoundRecipe{
  const out:SoundRecipe={id,label,throttleMs,priority,tones:Object.freeze(tones.map(t=>Object.freeze({...t})))};
  if(vibrate)out.vibrate=Object.freeze([...vibrate]);
  return Object.freeze(out);
}

/** Short melodic note helper (seconds, Hz). */
function note(wave:Tone['wave'],freq:number,at:number,dur:number,gain:number,extra:Partial<Tone>={}):Tone{
  return {wave,from:freq,to:freq,at,dur,gain,...extra};
}

const list:SoundRecipe[]=[
  // Tiny thwack: noise click plus a fast pitch drop. Fires constantly, so it is short and quiet.
  recipe('golpe','Golpe',45,0,[
    {wave:'noise',from:1800,to:900,at:0,dur:0.05,gain:0.3,attack:0.002,filter:{type:'bandpass',freq:1600,q:1.4}},
    {wave:'triangle',from:240,to:90,at:0,dur:0.09,gain:0.35,attack:0.002},
  ]),
  // Bright two-step blip.
  recipe('gema','Gema',35,0,[
    {wave:'sine',from:1320,to:1760,at:0,dur:0.06,gain:0.22,attack:0.002},
    note('sine',2640,0.045,0.07,0.12,{attack:0.002}),
  ]),
  // Happy arpeggio C-E-G-C with a sparkle on top.
  recipe('nivel','Subiu de nível',300,2,[
    note('square',523,0,0.14,0.14,{filter:LOW}),
    note('square',659,0.09,0.14,0.14,{filter:LOW}),
    note('square',784,0.18,0.14,0.14,{filter:LOW}),
    note('square',1047,0.27,0.4,0.15,{filter:LOW,vibrato:{rate:7,depth:8}}),
    note('triangle',2093,0.3,0.35,0.08),
  ]),
  // Sparkly confirm: rising triangle, two bells and a high shimmer.
  recipe('upgrade','Upgrade',120,2,[
    {wave:'triangle',from:880,to:1320,at:0,dur:0.12,gain:0.25},
    note('sine',1760,0.08,0.18,0.16),
    note('sine',2349,0.15,0.25,0.13),
    {wave:'noise',from:6500,to:6500,at:0.08,dur:0.28,gain:0.06,attack:0.03,filter:{type:'highpass',freq:6000}},
  ]),
  // Slide whistle "fiuuu" falling, then a cartoon thud.
  recipe('queda','Caiu!',250,3,[
    {wave:'sine',from:1600,to:280,at:0,dur:0.9,gain:0.35,attack:0.03,vibrato:{rate:6,depth:22}},
    {wave:'triangle',from:1600,to:280,at:0,dur:0.9,gain:0.1,attack:0.03},
    {wave:'triangle',from:130,to:45,at:0.88,dur:0.3,gain:0.5,attack:0.004},
    {wave:'noise',from:300,to:120,at:0.88,dur:0.2,gain:0.3,attack:0.004,filter:{type:'lowpass',freq:420}},
  ],[60,40,140]),
  // Rising cheerful "tchanã".
  recipe('resgate','Resgate',200,2,[
    note('square',523,0,0.12,0.16,{filter:LOW}),
    note('square',784,0.13,0.5,0.17,{filter:LOW,vibrato:{rate:6,depth:10}}),
    note('triangle',1047,0.13,0.5,0.16),
    note('sine',2093,0.16,0.4,0.07),
  ],[30]),
  // Low menacing brass with a sub rumble.
  recipe('chefe','Chefe chegou',1500,3,[
    {wave:'sawtooth',from:55,to:49,at:0,dur:1.4,gain:0.3,attack:0.12,filter:{type:'lowpass',freq:600,q:2}},
    {wave:'sawtooth',from:82.4,to:73.4,at:0,dur:1.4,gain:0.22,attack:0.15,filter:{type:'lowpass',freq:700,q:2}},
    {wave:'square',from:110,to:98,at:0.3,dur:1.1,gain:0.12,attack:0.2,vibrato:{rate:5,depth:3},filter:{type:'lowpass',freq:500}},
    {wave:'triangle',from:41,to:36,at:0,dur:1.5,gain:0.4,attack:0.25},
    {wave:'noise',from:150,to:90,at:0,dur:1.5,gain:0.35,attack:0.3,filter:{type:'lowpass',freq:180}},
  ],[200,80,300]),
  // Referee whistle trill, then a mini fanfare.
  recipe('round-inicio','Começa o round',800,2,[
    note('sine',2400,0,0.2,0.18,{vibrato:{rate:28,depth:140}}),
    note('square',523,0.24,0.1,0.15,{filter:LOW}),
    note('square',659,0.34,0.1,0.15,{filter:LOW}),
    note('square',784,0.44,0.38,0.16,{filter:LOW,vibrato:{rate:6,depth:9}}),
    note('triangle',1568,0.44,0.3,0.07),
  ]),
  // "Ta-dá" cadence with a soft cymbal.
  recipe('round-fim','Fim do round',800,2,[
    note('square',392,0,0.12,0.15,{filter:LOW}),
    note('square',523,0.14,0.65,0.15,{filter:LOW,vibrato:{rate:5,depth:6}}),
    note('triangle',659,0.14,0.65,0.15),
    note('triangle',784,0.14,0.65,0.13),
    {wave:'noise',from:7000,to:7000,at:0.14,dur:0.55,gain:0.07,attack:0.005,filter:{type:'highpass',freq:5500}},
  ]),
  // Clown horn "fom-fom": nasal sawtooth+square through a band-pass, second honk longer.
  recipe('buzina','Buzina',300,1,[
    {wave:'sawtooth',from:340,to:320,at:0,dur:0.17,gain:0.3,attack:0.01,filter:{type:'bandpass',freq:950,q:2.2}},
    {wave:'square',from:428,to:404,at:0,dur:0.17,gain:0.15,attack:0.01,filter:{type:'bandpass',freq:1200,q:2.2}},
    {wave:'sawtooth',from:340,to:300,at:0.23,dur:0.3,gain:0.3,attack:0.01,filter:{type:'bandpass',freq:950,q:2.2}},
    {wave:'square',from:428,to:380,at:0.23,dur:0.3,gain:0.15,attack:0.01,filter:{type:'bandpass',freq:1200,q:2.2}},
  ]),
  // Spring boing: rising pitch with a fast wobble.
  recipe('boing','Boing',150,1,[
    {wave:'triangle',from:170,to:540,at:0,dur:0.55,gain:0.42,attack:0.004,vibrato:{rate:14,depth:45}},
    {wave:'sine',from:85,to:270,at:0,dur:0.45,gain:0.22,attack:0.004,vibrato:{rate:14,depth:20}},
  ]),
  // Canned "ha-ha-ha": voiced pulses through a vowel-ish band-pass, falling pitch, breathy noise.
  recipe('risada','Risada',600,1,[
    ...[0,0.17,0.34,0.52,0.72].map((at,i):Tone=>({
      wave:'sawtooth',from:310-i*14,to:270-i*16,at,dur:i===4?0.26:0.13,gain:0.26,attack:0.012,
      filter:{type:'bandpass',freq:820-i*30,q:3},
    })),
    {wave:'noise',from:1300,to:1100,at:0,dur:0.5,gain:0.07,attack:0.02,filter:{type:'bandpass',freq:1300,q:1.5}},
    {wave:'noise',from:1200,to:900,at:0.5,dur:0.5,gain:0.07,attack:0.02,filter:{type:'bandpass',freq:1100,q:1.5}},
  ]),
  // Rubber stamp "tum" on paper (DSG-oferta-etiqueta): a dull low thump plus a short paper slap. The one show moment.
  recipe('carimbo','Carimbo',120,2,[
    {wave:'triangle',from:150,to:58,at:0,dur:0.14,gain:0.5,attack:0.002},
    {wave:'sine',from:95,to:48,at:0,dur:0.18,gain:0.3,attack:0.002},
    {wave:'noise',from:900,to:500,at:0,dur:0.06,gain:0.22,attack:0.001,filter:{type:'lowpass',freq:1400}},
  ],[15]),
];

export const RECIPES:Readonly<Record<SoundId,SoundRecipe>>=Object.freeze(
  Object.fromEntries(SOUND_IDS.map(id=>{
    const found=list.find(r=>r.id===id);
    if(!found)throw new Error(`missing recipe ${id}`);
    return [id,found];
  })) as Record<SoundId,SoundRecipe>,
);

export const SOUND_LABELS:Readonly<Record<SoundId,string>>=Object.freeze(
  Object.fromEntries(SOUND_IDS.map(id=>[id,RECIPES[id].label])) as Record<SoundId,string>,
);

/** Emoji shown next to each label in the sandbox and settings. */
export const SOUND_EMOJI:Readonly<Record<SoundId,string>>=Object.freeze({
  golpe:'👊',gema:'💎',nivel:'⭐',upgrade:'✨',queda:'🫠',resgate:'🤝',chefe:'👹',
  'round-inicio':'📣','round-fim':'🎉',buzina:'🤡',boing:'🌀',risada:'😂',
  // The stamp shows its own word instead of an emoji (D-020: no new emoji).
  carimbo:'tum',
});
