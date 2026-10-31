/**
 * NEW-20261013-ORQ-papeis-de-inimigo (D-040): the roster of 176 (the nine hand-tuned kinds, the 164 pack entries and the
 * extra aberração-saci, NEW-20261029-ORQ-saci-elite-no-jogo, and mendigo, NEW-20261029-ORQ-so-3-inimigos, plus the
 * sanfoneiro, pack 6, sanfoneiro-brinquedo-no-jogo) and the 13 role profiles, as data.
 *  - the import is deterministic and complete: the committed file is what scripts/import-roster.mjs writes from the board
 *    packs (when the board is next to the repo) and has every pack row: 164 entries, 41 per pack, ids unique, roles valid
 *  - P0 entries carry their own lines (4 barks, 3 death lines, a pop) and every entry its death gag; P1/P2 only the gag
 *  - limits (bark/death ≤ 30, pop ALL CAPS ≤ 21, gag ≤ 60), the D-033 lint (brands, drugs, slurs, sexual terms, the
 *    'pau'/'pelad' traps), real accents, no line said twice across the roster, the roles and the nine's catalog
 *  - role profiles: the behavior each role runs on, its base kind, multipliers and threat; the nine map to their roles
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ENEMY_ROLES,LEGACY_KINDS,LEGACY_ROLE,ROLE_PROFILES,ROSTER,ROSTER_IDS,THREAT,entryLines,fallbackAccent,fallbackKind,isEnemyRole,
  isRosterId,roleOf,type EnemyRole} from '../../src/rules/index.ts';
import {ELITE,ENEMIES,BUFFED_LINES,DEVENDO_LINES,MARMITA_BOOM_LINES,MOTOBOY_HONK_LINES,PALESTRA_LINES,POSE_LINES,REFLECT_LINES} from '../../src/sim/enemies/catalog.ts';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..','..');
const board=[process.env.VIAGEM_BOARD,join(repo,'..','viagem-board'),join(repo,'..','..','viagem-board')]
  .find(d=>d&&existsSync(join(d,'design','proximos','04-INIMIGOS-1-RUA-E-BOTECO.md')));
const packs=ROSTER.filter(e=>!e.legacy&&e.pack<=4),extra=ROSTER.filter(e=>e.pack===5),p0=packs.filter(e=>e.priority==='P0');

test('import: the committed roster is what scripts/import-roster.mjs writes from the board packs (deterministic)',t=>{
  if(!board){t.skip('the board (viagem-board) is not next to the repo');return;}
  for(let run=0;run<2;run++){
    const r:{status:number|null;stdout:string;stderr:string}=spawnSync(process.execPath,[join(repo,'scripts','import-roster.mjs'),'--check',board],{encoding:'utf8'});
    assert.equal(r.status,0,`run ${run}: ${r.stderr}${r.stdout}`);
    assert.match(r.stdout,/enemy-roster\.ts is current \(176 entries\)/);
  }
});

test('complete: 176 entries (the nine + 164 from 4 packs of 41 + 2 extra + the sanfoneiro), unique ids, valid roles, cells and priorities, 64 P0',()=>{
  assert.equal(ROSTER.length,176);assert.equal(packs.length,164);
  assert.deepEqual(extra.map(e=>[e.id,e.role,e.priority]),[['aberracao-saci','chefe','P1'],['mendigo','corredor','P1']],'the extra entries: the saci chefão and the mendigo (só 3 inimigos)');
  assert.deepEqual(ROSTER.filter(e=>e.pack===6).map(e=>[e.id,e.role,e.priority]),[['sanfoneiro','corredor','P0']],'the drawn own entry: the sanfoneiro, last (card sanfoneiro-brinquedo-no-jogo)');
  assert.equal(ROSTER.at(-1)!.id,'sanfoneiro');
  assert.deepEqual(ROSTER.slice(0,9).map(e=>e.id),[...LEGACY_KINDS],'the nine come first, as LEGACY_KINDS');
  for(const pack of [1,2,3,4])assert.equal(packs.filter(e=>e.pack===pack).length,41,`pack ${pack}`);
  assert.equal(new Set(ROSTER_IDS).size,176,'ids unique');
  assert.equal(p0.length,64);
  for(const e of ROSTER){
    assert.match(e.id,/^[a-z0-9]+(-[a-z0-9]+)*$/,e.id);
    assert.ok(isEnemyRole(e.role),`${e.id}: role ${e.role}`);
    assert.ok(['P0','P1','P2'].includes(e.priority),e.id);
    assert.ok(Number.isInteger(e.accent)&&e.accent>=0&&e.accent<=0xffffff,`${e.id}: accent`);
    // The saci chefão keeps his own 256 px sheet (card saci-chefe-2x), not the chefe role's 384.
    assert.equal(e.cell,e.id==='aberracao-saci'?256:ROLE_PROFILES[e.role].cell,`${e.id}: the packs keep the role's cell`);
    assert.ok(Object.isFrozen(e),`${e.id} frozen`);
  }
  // Every role has entries; the two roles the rotation leaves out (boss) still have their data.
  for(const role of ENEMY_ROLES)assert.ok(packs.some(e=>e.role===role),`${role} has pack entries`);
  // The nine: their catalog names and the roles of their behaviors.
  for(const kind of LEGACY_KINDS){
    const e=ROSTER.find(x=>x.id===kind)!;
    assert.equal(e.legacy,true);assert.equal(e.pack,0);assert.equal(e.priority,'P0');
    assert.equal(e.name,ENEMIES[kind].name,kind);assert.equal(e.role,LEGACY_ROLE[kind],kind);
    assert.equal(e.accent,ENEMIES[kind].accent,kind);
    assert.equal(e.barks,undefined,`${kind}: its lines stay in the catalog`);
  }
  // Display-name overrides (D-033 lint and brands); the ids stay the art folders.
  assert.equal(ROSTER.find(e=>e.id==='peladeiro-de-vidro')!.name,'Boleiro com Joelho de Vidro');
  assert.equal(ROSTER.find(e=>e.id==='guru-do-linkedin')!.name,'Guru do Networking');
  assert.equal(ROSTER.find(e=>e.id==='crossfiteiro-do-pneu')!.name,'Marombeiro do Pneu');
});

test('copy: P0 entries have 4 barks, 3 death lines and a pop; every entry a gag; P1/P2 only the gag; limits',()=>{
  for(const e of ROSTER){
    assert.ok(e.gag&&[...e.gag].length<=60,`${e.id}: gag ≤ 60 (${e.gag})`);
    assert.ok([...e.name].length<=40,`${e.id}: name`);
    if(e.legacy)continue;
    if(e.priority==='P0'){
      assert.equal(e.barks?.length,4,`${e.id}: 4 barks`);assert.equal(e.deathLines?.length,3,`${e.id}: 3 death lines`);
      for(const l of [...e.barks!,...e.deathLines!])assert.ok([...l].length<=30,`${e.id}: "${l}" ≤ 30`);
      assert.ok(e.pop&&[...e.pop].length<=21,`${e.id}: pop ≤ 21`);
      assert.equal(e.pop,e.pop!.toLocaleUpperCase('pt-BR'),`${e.id}: pop in caps`);
      assert.ok(Object.isFrozen(e.barks)&&Object.isFrozen(e.deathLines),`${e.id}: lines frozen`);
    }else assert.ok(e.barks===undefined&&e.deathLines===undefined&&e.pop===undefined,`${e.id}: ${e.priority} has no own lines`);
  }
});

const hasWord=(low:string,w:string)=>new RegExp(`(^|[^\\p{L}\\d])${w}($|[^\\p{L}\\d])`,'u').test(low);
/** Every visible string of the roster and the roles. */
const rosterText=()=>[
  ...ROSTER.flatMap(e=>[e.name,e.gag,...e.barks??[],...e.deathLines??[],...e.pop?[e.pop]:[]]),
  ...Object.values(ROLE_PROFILES).flatMap(r=>[r.label,r.cause,...r.barks,...r.deathLines,...r.reactionLines,...r.pops]),
];
test('D-033 lint: no brand or third-party IP, drug, slur or sexual term, no "pau" nor "pelad"; real pt-BR accents',()=>{
  const banned=['resident','umbrella','raccoon','zumbi','zombie','blizzard','warcraft','capcom','nemesis','t-virus','ifood',
    'rappi','havaiana','coca-cola','netflix','whatsapp','instagram','tiktok','mcdonald','nescau','toddy','chevrolet','volkswagen',
    'sucrilhos','frozen','linkedin','crossfit','pix',
    'maconha','cocaína','cocaina','crack','lança-perfume','ecstasy','heroína','baseado','cheirad','chapad',
    'viado','traveco','baitola','retardad','mongoloide','buceta','xoxota','piroca','punheta','boquete','siririca',
    'sexo','transar','tesão','pelad','safad'];
  const bannedWords=['uber','99','leon','claire','jill','olaf','elsa','bicha','sapatão','aleijado','pau','rola','pica','gozar',
    'foder','fodendo','pinto','peitinho','bunduda','gostosa','zap'];
  const unaccented=['nao','voce','voces','sao','ate','tambem','entao','ninguem','tres','cafe','pe','ja','so','to','agua','mae','vo'];
  for(const s of rosterText()){
    const low=s.toLocaleLowerCase('pt-BR');
    for(const b of banned)assert.ok(!low.includes(b),`"${s}" mentions ${b}`);
    for(const w of bannedWords)assert.ok(!hasWord(low,w),`"${s}" mentions ${w}`);
    const words=low.split(/[^\p{L}]+/u);
    for(const w of unaccented)assert.ok(!words.includes(w),`"${s}" has unaccented "${w}"`);
  }
});

test('no line said twice: roster, role lines and the nine\'s catalog lists are all different',()=>{
  const seen=new Map<string,string>();
  const add=(line:string,who:string)=>{assert.ok(!seen.has(line),`"${line}" (${who}) repeats ${seen.get(line)}`);seen.set(line,who);};
  for(const [kind,def] of Object.entries(ENEMIES))for(const l of new Set([...def.barks,...def.deathLines,...def.reactionLines]))if(!seen.has(l))seen.set(l,kind);
  for(const l of [...ELITE.barks,...ELITE.deathLines,...PALESTRA_LINES,...BUFFED_LINES,...MOTOBOY_HONK_LINES,...MARMITA_BOOM_LINES,...POSE_LINES,...REFLECT_LINES,...DEVENDO_LINES])seen.set(l,'catalog');
  for(const r of Object.values(ROLE_PROFILES))for(const l of [...r.barks,...r.deathLines,...r.reactionLines])add(l,r.id);
  for(const e of ROSTER)for(const l of [...e.barks??[],...e.deathLines??[]])add(l,e.id);
});

test('role profiles: behavior, base kind, multipliers and threat; generic lines within the limits',()=>{
  const behavior:Record<EnemyRole,string>={corredor:'stagger',brutamontes:'brute',arremessador:'thrower',atirador:'ranged',suporte:'coach',
    palhaco:'joker',kamikaze:'kamikaze',enxame:'swarm',voador:'swarm',refletor:'poser',invocador:'summoner','mini-chefe':'minichefe',chefe:'boss'};
  const base:Record<EnemyRole,string>={corredor:'bebado',brutamontes:'tio-pave',arremessador:'anao-molotov',atirador:'agiota',suporte:'coach',
    palhaco:'tio-pave',kamikaze:'motoboy',enxame:'pombos',voador:'pombos',refletor:'influencer',invocador:'coach','mini-chefe':'tio-pave',chefe:'chefe'};
  assert.deepEqual(Object.keys(ROLE_PROFILES),[...ENEMY_ROLES]);
  for(const role of ENEMY_ROLES){
    const r=ROLE_PROFILES[role];
    assert.equal(r.id,role);assert.equal(r.behavior,behavior[role],role);assert.equal(r.base,base[role],role);
    for(const k of ['speed','damage','radius','xp'] as const)assert.ok(r[k]>0&&r[k]<=3,`${role}.${k}`);
    assert.ok(r.threat>=0,role);
    assert.ok(r.barks.length>=4&&r.deathLines.length>=3&&r.reactionLines.length>=3&&r.pops.length>=3,`${role}: lines`);
    for(const l of [...r.barks,...r.deathLines,...r.reactionLines])assert.ok([...l].length<=30,`${role}: "${l}"`);
    for(const p of r.pops){assert.ok([...p].length<=21,p);assert.equal(p,p.toLocaleUpperCase('pt-BR'),p);}
    assert.ok([...r.cause].length<=40&&!/[A-ZÀ-Ú]{2}/.test(r.cause),`${role}: cause "${r.cause}"`);
    assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.barks),role);
  }
  // The legacy doubles keep the round table's threat (swapping a kind for an entry of its role keeps the budget).
  for(const [kind,role] of Object.entries(LEGACY_ROLE))if(kind!=='chefe'&&role!=='atirador')
    assert.equal(ROLE_PROFILES[role].threat,THREAT[kind as keyof typeof THREAT],`${role} ↔ ${kind}`);
  assert.ok(ROLE_PROFILES.atirador.threat<THREAT.agiota,'an atirador has no devendo mark: a bit less than the agiota');
  // The mini-chefe as the round-5 elite (× ELITE_SIZE 1.35 on the Tio's 0.52 × multiplier) stays under the boss's 0.9.
  assert.ok(.52*ROLE_PROFILES['mini-chefe'].radius*1.35<=.9);
});

test('lookups: fallback kind and accent, own or role lines, unknown ids',()=>{
  for(const e of ROSTER){
    assert.ok(isRosterId(e.id));assert.equal(roleOf(e.id),e.role);
    assert.equal(fallbackKind(e.id),e.legacy?e.id:ROLE_PROFILES[e.role].base,e.id);
    assert.equal(fallbackAccent(e.id),e.legacy?undefined:e.accent,e.id);
    const lines=entryLines(e.id)!,role=ROLE_PROFILES[e.role];
    assert.equal(lines.name,e.name);assert.equal(lines.gag,e.gag);assert.equal(lines.cause,role.cause);assert.equal(lines.reactionLines,role.reactionLines);
    if(e.barks){assert.equal(lines.barks,e.barks);assert.equal(lines.deathLines,e.deathLines);assert.deepEqual(lines.pops,[e.pop]);}
    else{assert.equal(lines.barks,role.barks);assert.equal(lines.deathLines,role.deathLines);assert.equal(lines.pops,role.pops);}
  }
  for(const unknown of ['','gosma','pernilongo','fiscal','x'])assert.ok(!isRosterId(unknown)&&fallbackKind(unknown)===undefined&&entryLines(unknown)===undefined,unknown);
});
