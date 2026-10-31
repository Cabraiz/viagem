/**
 * NEW-20261030-ORQ-sons-ganhos-e-receitas (auditoria-sons-30-10 §2d and §4): the file sounds' gains bring every one within
 * ±6 dB of the median effective level (the file's RMS plus its gain), and the six new procedural recipes (vitória,
 * derrota, chaveiro, the critter's attack, the saci's whistle and the sanfona's bellows) are short, finite and under 0 dBFS.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES} from '../../src/client/audio/recipes.ts';
import {SFX,sfxNames} from '../../src/client/audio/sfx.ts';
import {SOUND_IDS,recipeLength,type SoundId,type SoundRecipe,type Tone} from '../../src/client/audio/types.ts';

/**
 * The files' RMS in dBFS (auditoria-sons-30-10-niveis.tsv: the whole file measured, 30/10), keyed by file name: a sound
 * with takes has one line per take (`bicho-acerto-1`...). A new or reimported file must add its line here; the
 * footstep's takes are left out (alignTake brings each to ALIGN_LEVEL_DB).
 */
const RMS:Readonly<Record<string,number>>={
  audio:-15.9,'bau-comum':-20.8,'bau-epico':-24.8,'bau-lendario':-24.3,'bau-raro':-16.8,'bicho-acerto-1':-14.4,
  'bicho-morte-1':-15.8,boing:-17.3,boleto:-27.2,buzina:-17.3,'caca-niquel':-18.8,cafe:-18.2,carimbo:-14.5,
  'chefe-acerto':-15.8,'chefe-morte-1':-19.8,'chefe-passo':-22.2,chefe:-18.2,chinelo:-13.7,coxinha:-15.6,'dano-heroi':-14.5,
  empurrar:-17.3,escopeta:-18.0,faca:-15.6,gema:-11.7,golpe:-11.6,'guarda-chuva':-23.7,ima:-12.5,levantar:-16.8,
  macarico:-17.3,nivel:-18.8,'p12-aura':-17.3,'p12-bumerangue':-16.8,'p12-lancado':-16.8,'p12-leque':-18.2,
  'p12-mina':-23.0,'p12-nuvem':-17.1,'p12-orbita':-16.7,'p12-ricochete':-17.1,'p12-teleguiado':-15.7,'p12-tiro':-19.0,
  'p12-torreta':-18.6,pistola:-16.9,pombo:-18.0,queda:-17.4,resgate:-17.1,rifle:-18.5,risada:-20.5,rojao:-22.0,
  'round-fim':-17.9,'round-inicio':-18.5,submetralhadora:-20.2,'torre-antiaerea':-19.4,'torre-antimaterial':-19.9,
  'torre-arame':-17.1,'torre-construir':-23.0,'torre-foguete':-17.7,'torre-fuzil':-18.2,'torre-gustavao':-21.2,
  'torre-holofote':-25.7,'torre-metralhadora':-19.9,'torre-morteiro':-18.7,'torre-obus':-20.1,'torre-pistola':-18.5,
  'torre-radar':-15.9,'torre-rojao':-21.3,'torre-rotativa':-20.1,'torre-sniper':-18.4,'ui-abrir':-19.0,'ui-botao':-21.9,
  'ui-carta':-14.8,'ui-erro':-15.1,'ui-fechar':-19.8,upgrade:-17.6,
  // TangoFlux 30/10 (NEW-20261029-ORQ-sons-novos-tangoflux): the new takes and the five new sounds.
  'bicho-acerto-2':-16.2,'bicho-acerto-3':-15.6,'bicho-morte-2':-19.8,'bicho-morte-3':-22.3,'chefe-morte-2':-22.4,
  'chefe-morte-3':-20.2,'ultimo-bicho':-16.8,apagao:-17.3,'caixa-registradora':-17.8,'peca-cai':-17.4,'ninho-acordou':-15.9,
};
/** `ima` never plays (the magnet falls back to `gema`, events.ts) and stays as hidden legacy: its level waits for its cue. */
const UNHEARD=new Set<SoundId>(['ima']);
const LIMIT_DB=6;
const db=(gain:number)=>20*Math.log10(gain);
/** The sound a file belongs to: its own name, or the name without the take's `-N`. */
const soundOf=(file:string)=>(file in SFX?file:file.replace(/-\d+$/,'')) as SoundId;

test('the audit\'s gains: the quiet tower, weapon and mine up, the gem, the stamp and the card down',()=>{
  const want:Partial<Record<SoundId,number>>={boleto:1,'torre-holofote':.9,'torre-rojao':.55,'p12-mina':.65,gema:.25,carimbo:.35,'ui-carta':.4};
  for(const [id,gain] of Object.entries(want) as [SoundId,number][])assert.equal(SFX[id].gain,gain,id);
  // Only their own level moved: the groups they left keep theirs.
  assert.equal(SFX.cafe.gain,.45);assert.equal(SFX['torre-pistola'].gain,.32);assert.equal(SFX['p12-tiro'].gain,.4);assert.equal(SFX['ui-botao'].gain,.6);
  assert.equal(SFX.boleto.throttleMs,SFX.cafe.throttleMs);assert.equal(SFX['ui-carta'].priority,SFX['ui-botao'].priority);
});

test('the level map: every file heard sits within ±6 dB of the median effective level',()=>{
  const heard=Object.keys(RMS).filter(file=>!UNHEARD.has(soundOf(file)));
  for(const file of heard)assert.ok(SFX[soundOf(file)]&&!SFX[soundOf(file)].align,`${file}: a sound, not aligned`);
  const level=new Map(heard.map(file=>[file,RMS[file]+db(SFX[soundOf(file)].gain)]));
  const sorted=[...level.values()].sort((a,b)=>a-b),mid=sorted.length/2;
  const median=sorted.length%2?sorted[Math.floor(mid)]:(sorted[mid-1]+sorted[mid])/2;
  assert.ok(Math.abs(median+25)<1,`median ${median.toFixed(1)} dB`);
  const off=[...level].filter(([,v])=>Math.abs(v-median)>LIMIT_DB).map(([id,v])=>`${id} ${(v-median).toFixed(1)} dB`);
  assert.deepEqual(off,[],'out of the band');
  // Every file sound but the footstep is in the map: a new file cannot skip it.
  const files=new Set(sfxNames().filter(n=>!n.startsWith('passo-neve-')));
  assert.deepEqual([...files].filter(n=>!(n in RMS)),[],'files missing from the map');
});

// ---- the new recipes ----

const NEW=['vitoria','derrota','chaveiro-chega','bicho-ataque','saci-assobio','sanfona'] as const;
const SR=22050;

/** A seeded noise in [-1, 1], as the engine's buffer. */
function noise(seed:number){let s=seed>>>0||1;return ()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/2**31-1;};}
/** One wave's value at phase p (cycles). */
function wave(kind:Tone['wave'],p:number){
  const f=p-Math.floor(p);
  return kind==='sine'?Math.sin(2*Math.PI*f):kind==='square'?(f<.5?1:-1):kind==='sawtooth'?2*f-1:1-4*Math.abs(f-.5);
}
/**
 * Renders a recipe as the engine schedules it (engine.ts schedule: linear attack from silence, exponential decay to
 * silence, exponential glide, vibrato), the filters left out: their bound is the resonance (peakBound).
 */
function render(r:SoundRecipe){
  const out=new Float64Array(Math.ceil((recipeLength(r)+.05)*SR));
  r.tones.forEach((t,i)=>{
    const dur=Math.max(.01,t.dur),attack=Math.min(dur*.9,Math.max(.001,t.attack??.005)),peak=Math.min(1,t.gain),rnd=noise(i+1);
    const n0=Math.round(t.at*SR),n=Math.round(dur*SR);let phase=0;
    for(let k=0;k<n&&n0+k<out.length;k++){
      const s=k/SR,env=s<attack?.0001+(peak-.0001)*s/attack:peak*(.0001/peak)**((s-attack)/(dur-attack));
      const freq=t.from*(t.to/t.from)**(s/dur)+(t.vibrato?t.vibrato.depth*Math.sin(2*Math.PI*t.vibrato.rate*s):0);
      phase+=freq/SR;
      out[n0+k]+=env*(t.wave==='noise'?rnd():wave(t.wave,phase));
    }
  });
  return out;
}
/** A lowpass or highpass rings up to its Q in dB (Web Audio); a band-pass peaks at 1. */
const resonance=(t:Tone)=>t.filter&&t.filter.type!=='bandpass'?10**(Math.max(0,t.filter.q??1)/20):1;
/** The worst case: every tone sounding at a moment at its peak, in phase, each through its filter's resonance. */
function peakBound(r:SoundRecipe){
  return Math.max(...r.tones.map(a=>r.tones.filter(b=>b.at<=a.at&&a.at<b.at+b.dur).reduce((sum,b)=>sum+b.gain*resonance(b),0)));
}

test('six new recipes: registered, recipe only, labelled, short, finite and under 0 dBFS',()=>{
  for(const id of NEW){
    assert.ok((SOUND_IDS as readonly string[]).includes(id),id);
    const r=RECIPES[id];
    assert.equal(r.id,id);assert.ok(r.label.trim(),id);
    assert.equal(SFX[id].takes,0,`${id}: no file (TangoFlux waits for the license)`);assert.ok(!sfxNames().includes(id));
    assert.equal(SFX[id].throttleMs,r.throttleMs);assert.equal(SFX[id].priority,r.priority);
    const len=recipeLength(r);
    assert.ok(len>0&&len<1.5,`${id} lasts ${len.toFixed(2)} s`);
    assert.ok(r.tones.length<=8,id);
    for(const t of r.tones)for(const v of [t.from,t.to,t.at,t.dur,t.gain,t.attack??0,t.filter?.freq??0,t.vibrato?.depth??0])assert.ok(Number.isFinite(v),id);
    const pcm=render(r);let peak=0;
    for(const v of pcm){assert.ok(Number.isFinite(v),`${id}: NaN in the render`);peak=Math.max(peak,Math.abs(v));}
    assert.ok(peak>.05,`${id} is heard (peak ${peak.toFixed(2)})`);
    assert.ok(db(peak)<0,`${id} peak ${db(peak).toFixed(1)} dBFS`);
    assert.ok(db(peakBound(r))<0,`${id} worst case ${db(peakBound(r)).toFixed(1)} dBFS`);
  }
});

test('each new recipe fits its moment',()=>{
  const {vitoria,derrota,'chaveiro-chega':chaveiro,'bicho-ataque':ataque,'saci-assobio':saci,sanfona}=RECIPES;
  // The run's ends are heard over everything and never twice in a row.
  for(const r of [vitoria,derrota]){assert.equal(r.priority,3,r.id);assert.ok(r.throttleMs>=2000,r.id);}
  // Victory climbs, the sad trombone falls note by note.
  const pitch=(r:SoundRecipe,wave:Tone['wave'])=>r.tones.filter(t=>t.wave===wave).sort((a,b)=>a.at-b.at).map(t=>t.from);
  const up=pitch(vitoria,'square'),down=pitch(derrota,'sawtooth');
  assert.ok(up.length>=3&&up.every((f,i)=>!i||f>up[i-1]),`vitória climbs ${up}`);
  assert.ok(down.length>=4&&down.every((f,i)=>!i||f<down[i-1]),`derrota falls ${down}`);
  // The critter's bite fires with the crowd: short, over the hits but under the moments, its own throttle.
  assert.ok(recipeLength(ataque)<=.2,'the bite is short');
  assert.ok(ataque.priority>RECIPES.golpe.priority&&ataque.priority<2&&ataque.throttleMs>=RECIPES.golpe.throttleMs);
  assert.equal(ataque.vibrate,undefined,'no buzz for every bite');
  // The chaveiro jingles keys (high, metallic) before the horn; the saci whistles high; the sanfona is a reedy chord.
  assert.ok(chaveiro.tones.filter(t=>t.from>=3000).length>=3,'keys');
  assert.ok(saci.tones.filter(t=>t.wave==='sine').every(t=>t.from>=1200&&!!t.vibrato),'a wavering whistle');
  assert.ok(sanfona.tones.filter(t=>t.wave==='sawtooth').length>=2,'reeds');
  const reeds=sanfona.tones.filter(t=>t.wave==='sawtooth').map(t=>t.from);
  assert.ok(reeds.some((f,i)=>reeds.some((g,j)=>i!==j&&Math.abs(f-g)>0&&Math.abs(f-g)<4)),'two reeds a little apart: the musette beat');
});
