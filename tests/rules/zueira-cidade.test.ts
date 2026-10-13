import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AVENUES,BARK_MAX,CIDADE_BARKS,CIDADE_BOSS_ROUND_NAMES,CIDADE_DEATH_LINES,CIDADE_ELITE_ROUND_NAMES,CIDADE_FORGE_LINES,
  CIDADE_HORN_LINES,CIDADE_MODIFIERS,CIDADE_REACTION_LINES,CIDADE_RECIPE_IDS,CIDADE_REGULAR_KINDS,CIDADE_RETREAT_LINES,CIDADE_ROUND_NAMES,
  CIDADE_TUTORIAL,CIDADE_TUTORIAL_SAY,CIDADE_VEHICLE,CIDADE_ZUEIRA,LABEL_MAX,cidadeModifierLabel,type CidadeModifier,
} from '../../src/rules/zueira-cidade.ts';
import {BOSS_ROUND_NAMES,ELITE_ROUND_NAMES,MODIFIERS,REGULAR_KINDS,RETREAT_LINES,ROUNDS,ROUND_NAMES,THREAT,modifierLabel} from '../../src/rules/waves.ts';
import {BURP_SLOW_LINES,DEVENDO_LINES,ELITE,ENEMIES,ENEMY_KINDS,FIRE_GROUND_LINES,PUDDLE_SLIP_LINES} from '../../src/sim/enemies/catalog.ts';
import {BOSS_LINES,BOSS_NAME} from '../../src/sim/boss.ts';
import {DEATH_LINES,GENERIC_LINES,SAY_TAGS} from '../../src/client/render/jokes.ts';
import {CAUSE_COPY} from '../../src/client/hud/cause.ts';
import {KILLCAM_ALONE,KILLCAM_KIND_LINES,KILLCAM_LINES} from '../../src/client/fun/zueira.ts';
import {HORN_LINES,RECIPES,RECIPE_IDS} from '../../src/rules/stonewards.ts';

const key=(s:string)=>s.trim().toLocaleLowerCase('pt-BR');
const len=(s:string)=>[...s].length;
const dupes=(list:readonly string[])=>{const seen=new Set<string>(),out:string[]=[];for(const s of list){const k=key(s);if(seen.has(k))out.push(s);seen.add(k);}return out;};
const ENEMY_LINE_KINDS=[...ENEMY_KINDS];
const barks=Object.values(CIDADE_BARKS).flat(),deaths=Object.values(CIDADE_DEATH_LINES).flat();
const reactions=Object.values(CIDADE_REACTION_LINES).flatMap(l=>l??[]);
const forge=Object.values(CIDADE_FORGE_LINES).flat();
const allRoundNames=[...CIDADE_ROUND_NAMES,...CIDADE_ELITE_ROUND_NAMES,...CIDADE_BOSS_ROUND_NAMES,CIDADE_TUTORIAL.roundName];
const labels=CIDADE_MODIFIERS.map(cidadeModifierLabel);
/** Every string a player can see (ids are English code, not shown). */
const allStrings=[
  ...allRoundNames,...CIDADE_MODIFIERS.flatMap(m=>[m.name,m.description]),...labels,...barks,...reactions,...deaths,
  ...CIDADE_RETREAT_LINES,...forge,...CIDADE_HORN_LINES,CIDADE_VEHICLE.name,...CIDADE_VEHICLE.intro,...CIDADE_VEHICLE.inspect,
  CIDADE_TUTORIAL.modifier,...CIDADE_TUTORIAL.intro,...CIDADE_TUTORIAL.arrival,
];
/** Fields that are identity or scheduling, not an effect. */
const NON_EFFECT=new Set(['id','name','description','banRounds']);
const MULTS=['countMult','hpMult','speedMult','sizeMult','groupSizeMult','cadenceMult'] as const;

test('cidade zueira has enough of everything',()=>{
  assert.ok(CIDADE_ROUND_NAMES.length>=20);
  assert.equal(CIDADE_ELITE_ROUND_NAMES.length,5);
  assert.equal(CIDADE_BOSS_ROUND_NAMES.length,5);
  assert.ok(CIDADE_MODIFIERS.length>=6);
  for(const kind of ENEMY_LINE_KINDS)assert.ok((CIDADE_BARKS[kind]?.length??0)>=5,`barks ${kind}`);
  assert.deepEqual(Object.keys(CIDADE_BARKS).sort(),[...ENEMY_LINE_KINDS].sort());
  for(const kind of REGULAR_KINDS)assert.ok((CIDADE_DEATH_LINES[kind]?.length??0)>=3,`death ${kind}`);
  // The laugh moment: the tio's joke stop (chance 1 in enemy-ai) always says one of these.
  const tio=CIDADE_REACTION_LINES['tio-pave']??[];
  assert.ok(tio.length>=5,'tio-pave reactions');
  for(const line of ['É pavê ou picolé?','Toc toc. Quem é? AVALANCHE!'])assert.ok(tio.includes(line),line);
  for(const kind of Object.keys(CIDADE_REACTION_LINES))assert.ok((ENEMY_KINDS as readonly string[]).includes(kind),kind);
  assert.deepEqual(Object.keys(CIDADE_DEATH_LINES).sort(),[...REGULAR_KINDS].sort());
  assert.ok(CIDADE_RETREAT_LINES.length>=6);
  // Forge lines for exactly the real recipes.
  assert.deepEqual([...CIDADE_RECIPE_IDS].sort(),[...RECIPE_IDS].sort());
  assert.deepEqual(Object.keys(CIDADE_FORGE_LINES).sort(),[...RECIPE_IDS].sort());
  for(const id of RECIPE_IDS)assert.ok(CIDADE_FORGE_LINES[id].length>=3,`forge ${id}`);
  assert.ok(CIDADE_HORN_LINES.length>=5);
  assert.ok(CIDADE_VEHICLE.name&&CIDADE_VEHICLE.id);
  assert.ok(CIDADE_VEHICLE.intro.length>=3&&CIDADE_VEHICLE.inspect.length>=3);
  // D-026: the start is a crashed helicopter (the map art has one); no line may describe another vehicle.
  assert.equal(CIDADE_VEHICLE.id,'heli-firma');assert.equal(CIDADE_VEHICLE.name,'Helicóptero da Firma');
  for(const s of [...CIDADE_VEHICLE.intro,...CIDADE_VEHICLE.inspect,CIDADE_TUTORIAL.modifier,...CIDADE_TUTORIAL.intro,...CIDADE_TUTORIAL.arrival])assert.ok(!/bal[ãa]o|cesto/i.test(s),s);
  // cidade-08: round 1 is the walk from the wreck to the plaza (director: round name/line and the heroes' say lines).
  assert.ok(CIDADE_TUTORIAL.roundName&&CIDADE_TUTORIAL.modifier);
  assert.ok(CIDADE_TUTORIAL.intro.length>=3,'intro balloon lines');
  assert.ok(CIDADE_TUTORIAL.arrival.length>=3,'arrival lines');
  assert.ok(/praça/i.test(CIDADE_TUTORIAL.modifier),'the banner line says where to go');
  // say keys: distinct, the vehicle's id as prefix, and not a client status tag (SAY_TAGS shows a tag instead of the line).
  const keys=Object.values(CIDADE_TUTORIAL_SAY);
  assert.equal(new Set(keys).size,keys.length);
  for(const k of keys){assert.match(k,/^heli-firma:[a-z]+$/);assert.ok(k.startsWith(`${CIDADE_VEHICLE.id}:`));assert.ok(!Object.hasOwn(SAY_TAGS,k),k);}
  // Mirrored types match the game.
  assert.deepEqual([...CIDADE_REGULAR_KINDS],[...REGULAR_KINDS]);
});

test('no repetition inside the city lists nor against the game lists',()=>{
  assert.deepEqual(dupes(allRoundNames),[],'round names (all three lists together)');
  assert.deepEqual(dupes(CIDADE_MODIFIERS.map(m=>m.id)),[],'modifier ids');
  assert.deepEqual(dupes(CIDADE_MODIFIERS.map(m=>m.name)),[],'modifier names');
  assert.deepEqual(dupes(CIDADE_MODIFIERS.map(m=>m.description)),[],'modifier descriptions');
  assert.deepEqual(dupes([...barks,...reactions,...deaths,...CIDADE_RETREAT_LINES]),[],'enemy lines (every kind and list together)');
  assert.deepEqual(dupes(forge),[],'forge');
  assert.deepEqual(dupes(CIDADE_HORN_LINES),[],'horn');
  assert.deepEqual(dupes([...CIDADE_VEHICLE.intro,...CIDADE_VEHICLE.inspect,CIDADE_TUTORIAL.modifier,...CIDADE_TUTORIAL.intro,...CIDADE_TUTORIAL.arrival]),[],'vehicle and tutorial');

  const against=(mine:readonly string[],theirs:readonly string[],what:string)=>{
    const game=new Set(theirs.map(key));
    assert.deepEqual(mine.filter(s=>game.has(key(s))),[],what);
  };
  against(allRoundNames,[...ROUND_NAMES,...ELITE_ROUND_NAMES,...BOSS_ROUND_NAMES],'round names vs waves.ts');
  against(CIDADE_MODIFIERS.map(m=>m.id),MODIFIERS.map(m=>m.id),'modifier ids vs waves.ts');
  against(CIDADE_MODIFIERS.map(m=>m.name),MODIFIERS.map(m=>m.name),'modifier names vs waves.ts');
  against(labels,MODIFIERS.map(modifierLabel),'modifier labels vs waves.ts');
  const gameLines=[...Object.values(ENEMIES).flatMap(e=>[...e.barks,...e.deathLines,...e.reactionLines]),
    ...ELITE.barks,...ELITE.deathLines,...RETREAT_LINES];
  against([...barks,...reactions,...deaths,...CIDADE_RETREAT_LINES],gameLines,'enemy lines vs catalog.ts and waves.ts');
  against(CIDADE_REACTION_LINES['tio-pave']??[],ENEMIES['tio-pave'].reactionLines,'tio reactions vs catalog.ts');
  against(forge,Object.values(RECIPES).flatMap(r=>r.lines),'forge vs stonewards recipes');
  against(CIDADE_HORN_LINES,HORN_LINES,'horn vs stonewards');
});

test('lengths fit the banners and balloons, no empty or padded strings',()=>{
  assert.equal(LABEL_MAX,46);assert.equal(BARK_MAX,30);
  const fit=(list:readonly string[],max:number,what:string)=>{
    for(const s of list){
      assert.ok(s.length>0&&s===s.trim()&&!/\s{2}/.test(s),`${what}: "${s}" is empty or padded`);
      assert.ok(len(s)<=max,`${what}: "${s}" has ${len(s)} > ${max}`);
    }
  };
  fit(labels,LABEL_MAX,'modifier label');
  fit(CIDADE_MODIFIERS.flatMap(m=>[m.id,m.name,m.description]),LABEL_MAX,'modifier field');
  fit(allRoundNames,LABEL_MAX,'round name');
  fit([...barks,...reactions,...deaths,...CIDADE_RETREAT_LINES],BARK_MAX,'enemy line');
  fit(CIDADE_VEHICLE.intro,LABEL_MAX,'vehicle intro');
  fit(CIDADE_VEHICLE.inspect,BARK_MAX,'vehicle inspect');
  fit([CIDADE_VEHICLE.id,CIDADE_VEHICLE.name],LABEL_MAX,'vehicle name');
  fit([CIDADE_TUTORIAL.roundName,CIDADE_TUTORIAL.modifier],LABEL_MAX,'tutorial banner');
  // cidade-08 review: the heroes' `say` lines are balloons (BARK_MAX), not banners; the vehicle's banner intro stays LABEL_MAX.
  fit(CIDADE_TUTORIAL.intro,BARK_MAX,'tutorial intro balloon');
  fit(CIDADE_TUTORIAL.arrival,BARK_MAX,'tutorial arrival');
  fit([...forge,...CIDADE_HORN_LINES],40,'forge/horn');
  // Ids are kebab-case like waves.ts.
  for(const m of CIDADE_MODIFIERS)assert.match(m.id,/^[a-z]+(-[a-z]+)*$/);
  assert.match(CIDADE_VEHICLE.id,/^[a-z]+(-[a-z]+)*$/);
});

/**
 * Threat approximation (same spirit as waves.ts, which keeps each modifier within ~0.9-1.15 of the round):
 * countMult x effective hpMult, both defaulting to 1. normalizeThreat already rescales count for composition, and
 * speed, ice, range and visibility are felt rather than counted, so they are left out. For a snowball (growth) the
 * effective hp is the mean of the spawn and the plaza-mouth hp, since hp grows linearly along the avenue.
 */
const threatEstimate=(m:CidadeModifier)=>{
  const hp=m.hpMult??1;
  return (m.countMult??1)*(m.growth?(hp+m.growth.hpMult)/2:hp);
};

test('every modifier effect is data, valid and roughly threat-neutral',()=>{
  const inRange=(v:unknown,lo:number,hi:number,what:string)=>
    assert.ok(typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi,`${what}=${String(v)} not in [${lo}, ${hi}]`);
  const validKinds=new Set<string>(REGULAR_KINDS);
  for(const m of CIDADE_MODIFIERS){
    const at=(f:string)=>`${m.id}.${f}`;
    assert.ok(Object.keys(m).some(k=>!NON_EFFECT.has(k)),`${m.id} has no effect field`);
    for(const f of MULTS)if(m[f]!==undefined)inRange(m[f],.3,2,at(f));
    for(const f of ['weights','share'] as const){
      const table=m[f];if(!table)continue;
      for(const [k,v] of Object.entries(table)){assert.ok(validKinds.has(k),at(`${f}.${k}`));inRange(v,0,1,at(`${f}.${k}`));}
    }
    if(m.share)assert.ok(Object.values(m.share).reduce((a,b)=>a+(b??0),0)<=1,at('share sum'));
    if(m.weights)assert.ok(Object.values(m.weights).some(v=>(v??0)>0),at('weights all zero'));
    if(m.formation!==undefined)assert.ok(['cluster','line','surround'].includes(m.formation),at('formation'));
    if(m.avenues!==undefined){
      assert.ok(m.avenues.length>0,at('avenues empty'));
      assert.equal(new Set(m.avenues).size,m.avenues.length,at('avenues repeated'));
      for(const a of m.avenues)assert.ok(AVENUES.includes(a),at(`avenues ${a}`));
    }
    if(m.alternateSide&&m.avenues)assert.ok(m.avenues.length>=2,at('alternateSide needs 2+ avenues'));
    if(m.ice){
      inRange(m.ice.slide,0,1,at('ice.slide'));
      if(m.ice.heroSlide!==undefined)inRange(m.ice.heroSlide,0,1,at('ice.heroSlide'));
      if(m.ice.kinds){assert.ok(m.ice.kinds.length>0,at('ice.kinds empty'));for(const k of m.ice.kinds)assert.ok(validKinds.has(k),at(`ice.kinds ${k}`));}
    }
    if(m.visibility!==undefined)assert.ok(m.visibility>0&&m.visibility<=1,at('visibility'));
    if(m.kindMult){
      assert.ok(Object.keys(m.kindMult).length>0,at('kindMult empty'));
      for(const [k,tweak] of Object.entries(m.kindMult)){
        assert.ok(validKinds.has(k),at(`kindMult.${k}`));
        assert.ok(tweak&&Object.keys(tweak).length>0,at(`kindMult.${k} empty`));
        for(const [f,v] of Object.entries(tweak!))inRange(v,.3,2,at(`kindMult.${k}.${f}`));
      }
    }
    if(m.growth){inRange(m.growth.sizeMult,.3,2,at('growth.sizeMult'));inRange(m.growth.hpMult,.3,2,at('growth.hpMult'));}
    for(const r of m.banRounds)assert.ok(Number.isInteger(r)&&r>=1&&r<=10,at(`banRounds ${r}`));
    assert.ok([3,4,5,6,7,8,9].some(r=>!m.banRounds.includes(r)),at('banned on every round 3-9'));
    inRange(threatEstimate(m),.75,1.4,at('threat estimate'));
  }
  // Finer check against the real round table: waves.ts composition + normalizeThreat, kindMult hp weighted by each
  // kind's threat share, growth averaged as above. Same 0.9-1.15 target as waves.ts with a little slack.
  const avg=(w:Partial<Record<string,number>>,hp:(k:string)=>number=()=>1)=>{
    let t=0,s=0;for(const k of REGULAR_KINDS){const v=w[k]??0;t+=v*THREAT[k]*hp(k);s+=v;}return s>0?t/s:1;
  };
  for(const m of CIDADE_MODIFIERS)for(let r=3;r<=9;r++){
    if(m.banRounds.includes(r))continue;
    const def=ROUNDS[r-1];
    let w:Partial<Record<string,number>>={...def.weights,...m.weights};
    if(m.share){
      const share=m.share as Record<string,number>,pinned=Object.values(share).reduce((a,b)=>a+b,0);
      const rest=REGULAR_KINDS.filter(k=>!(k in share)).reduce((n,k)=>n+(w[k]??0),0);
      w=Object.fromEntries(REGULAR_KINDS.map(k=>[k,k in share?share[k]:rest>0?(w[k]??0)*(1-pinned)/rest:0]));
    }
    let count=m.countMult??1;
    if(m.normalizeThreat)count*=Math.max(.4,Math.min(1.6,avg(def.weights)/avg(w)));
    const hp=m.growth?((m.hpMult??1)+m.growth.hpMult)/2:m.hpMult??1;
    const ratio=count*hp*avg(w,k=>m.kindMult?.[k as keyof typeof m.kindMult]?.hpMult??1)/avg(def.weights);
    inRange(ratio,.85,1.2,`${m.id} round ${r} threat`);
  }
  // Every modifier round (3-9) can draw at least two city modifiers.
  for(let r=3;r<=9;r++)assert.ok(CIDADE_MODIFIERS.filter(m=>!m.banRounds.includes(r)).length>=2,`round ${r}`);
});

test('the modifiers the card asks for are present by intent',()=>{
  const oneMouth=CIDADE_MODIFIERS.find(m=>m.avenues?.length===1);
  assert.ok(oneMouth,'everyone from one avenue');
  const popsicle=CIDADE_MODIFIERS.find(m=>(m.kindMult?.['tio-pave']?.speedMult??1)<1&&m.ice);
  assert.ok(popsicle,'only tio-pavê slower, on ice');
  // Only tio-pavê: no round-wide slowdown, no other kind slowed, ice limited to him.
  assert.ok((popsicle.speedMult??1)>=1);
  assert.deepEqual(Object.keys(popsicle.kindMult!),['tio-pave']);
  assert.deepEqual(popsicle.ice!.kinds,['tio-pave']);
  assert.ok(CIDADE_MODIFIERS.some(m=>m.ice&&!m.ice.plazaOnly&&!m.ice.kinds),'ice everywhere');
  assert.ok(CIDADE_MODIFIERS.some(m=>m.ice?.plazaOnly),'plaza/fountain ice');
});

/**
 * Every D-033 line a player can see outside the city tables: catalog, mechanics floaters, boss, waves, and the client's
 * death pops, "what got you" copy and kill-cam captions.
 */
const gameText=[
  ...Object.values(ENEMIES).flatMap(e=>[e.name,...e.barks,...e.deathLines,...e.reactionLines]),
  ELITE.name,...ELITE.barks,...ELITE.deathLines,...DEVENDO_LINES,...FIRE_GROUND_LINES,...PUDDLE_SLIP_LINES,...BURP_SLOW_LINES,
  BOSS_NAME,...Object.values(BOSS_LINES).flat(),...ROUND_NAMES,...ELITE_ROUND_NAMES,...BOSS_ROUND_NAMES,...RETREAT_LINES,
  ...MODIFIERS.map(modifierLabel),
  ...GENERIC_LINES,...Object.values(DEATH_LINES).flat(),...Object.values(CAUSE_COPY).flatMap(c=>[c.name,c.line]),
  ...KILLCAM_LINES,...Object.values(KILLCAM_KIND_LINES).flat(),...KILLCAM_ALONE,
];
const hasWord=(low:string,w:string)=>new RegExp(`(^|[^\\p{L}\\d])${w}($|[^\\p{L}\\d])`,'u').test(low);

/**
 * D-033 tone (heavy Adult Swim): alcohol, cigarettes and light swearing are allowed. Still banned: third-party IP
 * (Resident Evil and friends), real brands, drugs other than álcool/cigarro, slurs and sexual terms. The anão never
 * gets a height or child joke: no such word in his lists nor in any line that mentions him.
 */
test('D-033 content: no third-party brand or IP, drug, slur, sexual term or anão height joke; real pt-BR accents',()=>{
  const banned=['resident','umbrella','raccoon','zumbi','zombie','blizzard','warcraft','capcom','nemesis','t-virus','ifood',
    'rappi','havaiana','coca-cola','netflix','whatsapp','instagram','tiktok','mcdonald','nescau','toddy','chevrolet','volkswagen',
    'sucrilhos','frozen','fazer um boneco','boneco quer fazer',
    // Drugs other than álcool and cigarro.
    'maconha','cocaína','cocaina','crack','lança-perfume','ecstasy','heroína','baseado','cheirad','chapad',
    // Slurs and sexual terms (substrings that are never innocent in pt-BR).
    'viado','traveco','baitola','retardad','mongoloide','buceta','xoxota','piroca','punheta','boquete','siririca',
    'sexo','transar','tesão','pelad','safad'];
  const bannedWords=['uber','99','leon','claire','jill','olaf','elsa','bicha','sapatão','aleijado','pau','rola','pica','gozar',
    'foder','fodendo','pinto','peitinho','bunduda','gostosa'];
  for(const s of [...allStrings,...gameText]){
    const low=s.toLocaleLowerCase('pt-BR');
    for(const b of banned)assert.ok(!low.includes(b),`"${s}" mentions ${b}`);
    for(const w of bannedWords)assert.ok(!hasWord(low,w),`"${s}" mentions ${w}`);
  }
  // The anão rule: his own lines (catalog, city, client) and any line naming him.
  const height=['baixinh','nanic','tampinha','pequen','anãozinh','tamanho','altura','miúd','parquinho','crianç'];
  const anao=[...ENEMIES['anao-molotov'].barks,...ENEMIES['anao-molotov'].deathLines,...ENEMIES['anao-molotov'].reactionLines,
    ...CIDADE_BARKS['anao-molotov'],...CIDADE_DEATH_LINES['anao-molotov'],...DEATH_LINES['anao-molotov'],
    CAUSE_COPY['anao-molotov'].line,...KILLCAM_KIND_LINES['anao-molotov']??[],
    ...[...allStrings,...gameText].filter(s=>s.toLocaleLowerCase('pt-BR').includes('anão'))];
  assert.ok(anao.length>=20,'anão lines found');
  for(const s of anao){
    const low=s.toLocaleLowerCase('pt-BR');
    for(const h of height)assert.ok(!low.includes(h),`"${s}" is a height joke (${h})`);
  }
  const unaccented=['nao','voce','voces','sao','ate','tambem','entao','ninguem','tres','cafe','pe','ja','so','esta frio','ta frio','to','agua','mae','vo'];
  for(const s of allStrings){
    const words=s.toLocaleLowerCase('pt-BR').split(/[^\p{L}]+/u);
    for(const w of unaccented)if(!w.includes(' '))assert.ok(!words.includes(w),`"${s}" has unaccented "${w}"`);
    assert.ok(!/\b(esta|ta) frio\b/i.test(s),`"${s}" has unaccented "tá frio"`);
  }
});

test('everything is deep-frozen and the aggregate shares the same references',()=>{
  assert.throws(()=>{(CIDADE_ROUND_NAMES as string[]).push('x');});
  assert.throws(()=>{(CIDADE_MODIFIERS[0] as {name:string}).name='x';});
  assert.throws(()=>{(CIDADE_MODIFIERS[0].avenues as string[])[0]='sul';});
  assert.throws(()=>{(CIDADE_BARKS.chefe as string[])[0]='x';});
  assert.throws(()=>{(CIDADE_REACTION_LINES['tio-pave'] as string[]).push('x');});
  assert.throws(()=>{(CIDADE_FORGE_LINES as Record<string,unknown>).reparo=[];});
  assert.throws(()=>{(CIDADE_VEHICLE.intro as string[]).pop();});
  assert.throws(()=>{(CIDADE_TUTORIAL.arrival as string[]).push('x');});
  assert.throws(()=>{(CIDADE_TUTORIAL.intro as string[]).push('x');});
  assert.throws(()=>{(CIDADE_TUTORIAL as {roundName:string}).roundName='x';});
  assert.throws(()=>{(CIDADE_TUTORIAL_SAY as {intro:string}).intro='x';});
  assert.throws(()=>{(AVENUES as string[]).push('centro');});
  assert.throws(()=>{(CIDADE_ZUEIRA as {modifiers:unknown}).modifiers=[];});
  for(const m of CIDADE_MODIFIERS)for(const v of Object.values(m))if(v&&typeof v==='object')assert.ok(Object.isFrozen(v),m.id);
  assert.equal(CIDADE_ZUEIRA.roundNames,CIDADE_ROUND_NAMES);
  assert.equal(CIDADE_ZUEIRA.eliteRoundNames,CIDADE_ELITE_ROUND_NAMES);
  assert.equal(CIDADE_ZUEIRA.bossRoundNames,CIDADE_BOSS_ROUND_NAMES);
  assert.equal(CIDADE_ZUEIRA.modifiers,CIDADE_MODIFIERS);
  assert.equal(CIDADE_ZUEIRA.barks,CIDADE_BARKS);
  assert.equal(CIDADE_ZUEIRA.reactionLines,CIDADE_REACTION_LINES);
  assert.equal(CIDADE_ZUEIRA.deathLines,CIDADE_DEATH_LINES);
  assert.equal(CIDADE_ZUEIRA.retreatLines,CIDADE_RETREAT_LINES);
  assert.equal(CIDADE_ZUEIRA.forgeLines,CIDADE_FORGE_LINES);
  assert.equal(CIDADE_ZUEIRA.hornLines,CIDADE_HORN_LINES);
  assert.equal(CIDADE_ZUEIRA.vehicle,CIDADE_VEHICLE);
  assert.equal(CIDADE_ZUEIRA.tutorial,CIDADE_TUTORIAL);
});
