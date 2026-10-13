/**
 * NEW-20261013-ORQ-papeis-de-inimigo (D-040) on the client: a roster entry without art draws its role's fallback
 * texture (rules fallbackKind) with its accent as a tint; its death pop, the "what got you" copy and the kill-cam use the
 * roster text when present and the role's otherwise; the nine and unknown kinds are as before.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ENEMY_KINDS,ENEMY_TEXTURES,drawnKind,enemyKind,enemyTexture,fallbackTint} from '../../src/client/render/keys.ts';
import {DEATH_LINES,GENERIC_LINES,GENERIC_STYLE,KIND_STYLES,deathLine,deathLines,kindStyle,styleKey} from '../../src/client/render/jokes.ts';
import {CAUSE_COPY,causeCopy,emptyCauses,recordFall,resultCause} from '../../src/client/hud/cause.ts';
import {KILLCAM_KIND_LINES,killcamCaption,killcamKindLines,shameText} from '../../src/client/fun/zueira.ts';
import {ROLE_PROFILES,ROSTER} from '../../src/rules/index.ts';
import {LOOK_BUFFED,LOOK_LECTURE,LOOK_NONE,PHASE_ACTING,PHASE_BUFFED,phaseLook,viewPhaseLook} from '../../src/client/render/phase-look.ts';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const packs=ROSTER.filter(e=>!e.legacy);
const p0=packs.find(e=>e.priority==='P0')!,p1=packs.find(e=>e.priority==='P1')!;

test('fallback: a roster entry draws its role\'s base texture, tinted by its accent; the nine and unknown kinds as before',()=>{
  for(const k of ENEMY_KINDS){assert.equal(enemyKind(k),k);assert.equal(drawnKind(k),k);assert.equal(fallbackTint(k),undefined);}
  for(const e of packs){
    const base=ROLE_PROFILES[e.role].base;
    assert.equal(enemyKind(e.id),base,e.id);assert.equal(drawnKind(e.id),base);
    assert.equal(enemyTexture(e.id),enemyTexture(base));assert.ok(ENEMY_TEXTURES[enemyKind(e.id)]);
    const tint=fallbackTint(e.id)!;
    for(const shift of [16,8,0]){
      const a=(e.accent>>shift)&255,t=(tint>>shift)&255;
      assert.equal(t,Math.round((a+255)/2),`${e.id}: channel ${shift}`);
    }
  }
  assert.equal(fallbackTint('flanelinha-interdimensional'),0xf0bd95,'orange vest 0xe07a2a halfway to white');
  for(const unknown of ['gosma','x',''])assert.ok(enemyKind(unknown)==='bebado'&&drawnKind(unknown)===undefined&&fallbackTint(unknown)===undefined,unknown);
});

test('death pop: the nine their own, a P0 entry its pop, a P1/P2 entry its role\'s pops, unknown the generic; styles from the accent',()=>{
  for(const k of ENEMY_KINDS){assert.equal(deathLines(k),DEATH_LINES[k]);assert.equal(kindStyle(k),KIND_STYLES[k]);assert.equal(styleKey(k),k);}
  assert.deepEqual(deathLines(p0.id),[p0.pop]);assert.equal(deathLine(p0.id,'e-1'),p0.pop);
  assert.equal(deathLines(p1.id),ROLE_PROFILES[p1.role].pops);
  assert.ok(ROLE_PROFILES[p1.role].pops.includes(deathLine(p1.id,'e-7')));
  assert.equal(deathLine(p1.id,'e-7'),deathLine(p1.id,'e-7'),'same id, same pop on every phone');
  assert.equal(deathLines('gosma'),GENERIC_LINES);assert.equal(kindStyle('gosma'),GENERIC_STYLE);assert.equal(styleKey('gosma'),'generic');
  const style=kindStyle(p0.id);
  assert.equal(style,kindStyle(p0.id),'cached');assert.equal(style.fill,GENERIC_STYLE.fill);assert.equal(styleKey(p0.id),p0.id);
  assert.match(style.stroke,/^#[0-9a-f]{6}$/);
  const lum=(n:number)=>((n>>16)&255)+((n>>8)&255)+(n&255);
  assert.ok(lum(Number.parseInt(style.stroke.slice(1),16))<lum(p0.accent)&&lum(style.tint)>lum(p0.accent),'darker stroke, lighter tint');
});

test('"what got you" and the result line name a roster entry with its role\'s cause line; the nine and bichos as before',()=>{
  for(const k of ENEMY_KINDS)assert.equal(causeCopy(k),CAUSE_COPY[k]);
  assert.equal(causeCopy(undefined),CAUSE_COPY.bichos);assert.equal(causeCopy('gosma'),CAUSE_COPY.bichos);
  for(const e of packs){
    const copy=causeCopy(e.id);
    assert.deepEqual(copy,{name:e.name,line:ROLE_PROFILES[e.role].cause});assert.equal(causeCopy(e.id),copy,'cached');
    assert.ok(copy.line.length<=40&&!/[A-ZÀ-Ú]{2}/.test(copy.line),copy.line);
  }
  const log=emptyCauses();recordFall(log,'me',p0.id);recordFall(log,'me',p0.id);
  assert.equal(resultCause(log,'me')?.text,`Te derrubou: ${p0.name} 2×`);
});

test('kill-cam and shame: a roster entry\'s death gag as the kind line, its name in the moment; the nine as before',()=>{
  for(const [k,lines] of Object.entries(KILLCAM_KIND_LINES))assert.equal(killcamKindLines(k),lines);
  for(const e of packs){
    const [line]=killcamKindLines(e.id);
    assert.ok(line.startsWith(e.gag)&&/[.!?…]$/.test(line),line);
  }
  assert.deepEqual(killcamKindLines('gosma'),[]);
  const cap=killcamCaption('Rita',p0.id,0);
  assert.equal(cap.template,killcamKindLines(p0.id)[0]);assert.equal(cap.title,'Último bicho!');
  const shame=shameText({player:'a',key:'caiu',round:4,tick:1,source:p0.id},'Rita');
  assert.ok(shame.text.includes(p0.name),shame.text);
  assert.ok(shameText({player:'a',key:'caiu',round:4,tick:1,source:'bebado'},'Rita').text.includes('um bêbado do boteco'));
  assert.ok(shameText({player:'a',key:'caiu',round:4,tick:1,source:'gosma'},'Rita').text.includes('um bicho'));
});

test('phase look by roster id: the invocador (drawn as the coach) calling shows no lecture ring nor whiteboard; the suporte lectures',()=>{
  const invocadores=ROSTER.filter(e=>e.role==='invocador'),suportes=ROSTER.filter(e=>e.role==='suporte');
  assert.ok(invocadores.length&&suportes.length);
  for(const e of invocadores){
    assert.equal(enemyKind(e.id),'coach',`${e.id} borrows the coach's texture`);
    assert.equal(viewPhaseLook(e.id,enemyKind(e.id),PHASE_ACTING),LOOK_NONE,`${e.id}: calling is not a lecture`);
    assert.equal(viewPhaseLook(e.id,enemyKind(e.id),PHASE_BUFFED),LOOK_BUFFED,`${e.id}: buffed reads as on anyone`);
  }
  for(const e of suportes)assert.equal(viewPhaseLook(e.id,enemyKind(e.id),PHASE_ACTING),LOOK_LECTURE,e.id);
  for(const k of ENEMY_KINDS)for(const phase of [undefined,PHASE_ACTING,PHASE_BUFFED,7])assert.equal(viewPhaseLook(k,k,phase),phaseLook(k,phase),`${k} ${phase}`);
  // The horde renderer reads the look by the view's roster id, and the tint is set apart from the position snap.
  const layers=readFileSync(fileURLToPath(new URL('../../src/client/render/layers.ts',import.meta.url)),'utf8');
  assert.match(layers,/const look=viewPhaseLook\(view\.kind,kind,view\.phase\)/);
  assert.doesNotMatch(layers,/\bphaseLook\(/,'no lookup by the drawn kind alone');
  assert.doesNotMatch(layers,/setTint\(tint\);\}\}else if/,'the tint change does not skip the snap');
});
