/**
 * Elenco P1 on the client (NEW-20261012-ORQ-elenco-p1): the coach, the motoboy and the influencer get procedural
 * textures (idle and acting), death pops, "what got you" copy and kill-cam captions; EnemyView.phase maps to their
 * state cues (render/phase-look.ts) without allocating per frame.
 */
import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ACTING_KINDS,ENEMY_ART,ENEMY_KINDS,ELITE_SCALE,FX,enemyKind,enemyTexture,hasActingPose,isEnemyKind,projectileTexture} from '../../src/client/render/keys.ts';
import {LOOK_BUFFED,LOOK_CHARGE,LOOK_LECTURE,LOOK_NONE,LOOK_POSE,PALESTRA_RADIUS,PHASE_ACTING,PHASE_BUFFED,SPARKLES,auraPulse,
  groundEllipse,headlightGlow,phaseLook,reflectGlint,sparkleFrame} from '../../src/client/render/phase-look.ts';
import {DEATH_LINES,KIND_STYLES,deathLine,deathLines,kindStyle} from '../../src/client/render/jokes.ts';
import {CAUSE_COPY,causeCopy,causeKind,emptyCauses,recordFall,resultCause} from '../../src/client/hud/cause.ts';
import {CRITTER_NAMES,KILLCAM_KIND_LINES,killcamCaption} from '../../src/client/fun/zueira.ts';
import {ENEMY_ART_ID,enemyPieceLoads,projectileLook} from '../../src/client/art/horde-art.ts';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {Projector} from '../../src/client/render/projector.ts';
import {elevation} from '../../src/maps/index.ts';

const NEW=['coach','motoboy','influencer'] as const;
const OLD=['bebado','anao-molotov','pombos','tio-pave','agiota','chefe'] as const;
const source=(path:string)=>readFileSync(fileURLToPath(new URL(`../../${path}`,import.meta.url)),'utf8');
afterEach(()=>setArtIndex(parseArtIndex({version:2,groups:{}})));

test('the three new kinds are known kinds with idle, acting and elite texture keys',()=>{
  for(const kind of NEW){
    assert.ok(isEnemyKind(kind)&&(ENEMY_KINDS as readonly string[]).includes(kind),kind);
    assert.equal(enemyKind(kind),kind,'no fallback to the bêbado');
    assert.equal(enemyTexture(kind),`horde:enemy:${kind}`);
    assert.equal(enemyTexture(kind,true),`horde:enemy:${kind}:elite`);
    assert.equal(enemyTexture(kind,false,true),`horde:enemy:${kind}:act`);
    assert.equal(enemyTexture(kind,true,true),`horde:enemy:${kind}:elite:act`);
    assert.ok(hasActingPose(kind));
  }
  assert.deepEqual([...ACTING_KINDS].sort(),[...NEW].sort());
  // Kinds without an acting pose ignore the flag (one texture each, as before); an unknown kind still falls back.
  for(const kind of OLD){assert.equal(enemyTexture(kind,false,true),enemyTexture(kind));assert.ok(!hasActingPose(kind));}
  assert.equal(enemyTexture('chefe',true,true),'horde:enemy:chefe');
  assert.equal(enemyTexture('dragao-novo',false,true),'horde:enemy:bebado');
});

test('procedural textures: drawn for both poses, sized apart from the current cast (phone-size silhouettes)',()=>{
  const textures=['enemies','index'].map(f=>source(`src/client/render/textures/${f}.ts`)).join('\n');
  for(const [kind,fn] of [['coach','drawCoach'],['motoboy','drawMotoboy'],['influencer','drawInfluencer']]){
    assert.match(textures,new RegExp(`function ${fn}\\(g:G,act=false\\)`),`${fn} draws an acting pose`);
    assert.match(textures,new RegExp(`${kind}:${fn}`),`${kind} is in DRAW`);
  }
  assert.match(textures,/if\(hasActingPose\(kind\)\)\{\s*make\(enemyTexture\(kind,false,true\)/,'the acting textures are generated');
  assert.match(textures,/make\(enemyTexture\(kind,true,true\)/,'and their elite variant');
  // Footprints (width × height) are unique across the whole cast, so no two critters share a silhouette box.
  const boxes=ENEMY_KINDS.map(k=>`${ENEMY_ART[k].width}x${ENEMY_ART[k].height}`);
  assert.equal(new Set(boxes).size,boxes.length,boxes.join(' '));
  for(const kind of NEW){
    const a=ENEMY_ART[kind];
    assert.ok(a.width>=60&&a.height>=80&&a.originY>.9&&a.bar>a.height*a.originY,`${kind} reads at phone size, bar above the head`);
    assert.ok(Math.ceil(a.height*ELITE_SCALE)<=256,'elite texture stays small');
  }
});

test('imported art: the new kinds map to their own importer id and stay procedural until the manifest has them',()=>{
  for(const kind of NEW)assert.equal(ENEMY_ART_ID[kind],kind);
  // A manifest with only the old cast queues nothing for the new kinds.
  setArtIndex(parseArtIndex({version:2,groups:{inimigos:{output:'public/art/inimigos',pieces:{
    bebado:{kind:'animations',files:{walk:{file:'bebado/walk.webp',cell:[128,128],frames:8,directions:8}}}}}}}));
  assert.ok(enemyPieceLoads(ENEMY_ART_ID.bebado).some(l=>l.key.startsWith('art:enemy:bebado:')));
  for(const kind of NEW)assert.deepEqual(enemyPieceLoads(ENEMY_ART_ID[kind]),[],kind);
  // Once a piece arrives under the kind's id, it is loaded like any other enemy's.
  setArtIndex(parseArtIndex({version:2,groups:{inimigos:{output:'public/art/inimigos',pieces:{
    coach:{kind:'animations',files:{walk:{file:'coach/walk.webp',cell:[128,128],frames:8,directions:8}}}}}}}));
  assert.ok(enemyPieceLoads(ENEMY_ART_ID.coach).some(l=>l.key==='art:enemy:coach:walk'));
});

test('death pops: the reviewed lines, all uppercase, deterministic, with their own colors',()=>{
  assert.deepEqual(DEATH_LINES.coach,['CHUVA DE POST-IT!','PALESTRA ENCERRADA!','SAIU DA ZONA DE VIDA!','CASE DE FRACASSO!','FEEDBACK RECEBIDO!','TROPEÇOU NO SLOGAN!']);
  assert.deepEqual(DEATH_LINES.motoboy,['PEDIDO ESPALHADO!','CHOVEU FEIJÃO!','MARMITADA!','SAIU PRA ENTREGA!','FREIOU NO POSTE!','BIIII... PLAFT!']);
  assert.deepEqual(DEATH_LINES.influencer,['PANTURRILHA FOI!','SHAPE DESMONTOU!','CÃIBRA AO VIVO!','STORY ENCERRADO!','UNFOLLOW ETERNO!','TÁ PAGO... AI!']);
  const all=Object.values(DEATH_LINES).flat();
  assert.equal(new Set(all).size,all.length,'no pop repeats across kinds');
  for(const kind of NEW){
    assert.equal(deathLines(kind),DEATH_LINES[kind]);
    const seen=new Set<string>();
    for(let i=0;i<60;i++){const line=deathLine(kind,`e${i}`);assert.equal(line,line.toLocaleUpperCase('pt-BR'));assert.equal(line,deathLine(kind,`e${i}`));seen.add(line);}
    assert.ok(seen.size>=4,`${kind} pops vary`);
    assert.equal(kindStyle(kind),KIND_STYLES[kind]);assert.match(kindStyle(kind).stroke,/^#[0-9a-f]{6}$/);
  }
  const strokes=ENEMY_KINDS.map(k=>KIND_STYLES[k].stroke);
  assert.equal(new Set(strokes).size,strokes.length,'every kind has its own pop color');
});

test('"what got you" copy and kill-cam captions for the new kinds',()=>{
  assert.deepEqual(CAUSE_COPY.coach,{name:'Coach Quântico',line:'O coach te motivou até o caixão'});
  assert.deepEqual(CAUSE_COPY.motoboy,{name:'Motoboy Kamikaze',line:'O motoboy te entregou no além'});
  assert.deepEqual(CAUSE_COPY.influencer,{name:'Influencer de Academia',line:'Teu tiro voltou. E ele filmou tudo'});
  for(const kind of NEW){
    assert.equal(causeKind(kind),kind);assert.equal(causeCopy(kind),CAUSE_COPY[kind]);
    const {line}=CAUSE_COPY[kind];assert.ok(line.length<=40,line);assert.doesNotMatch(line,/[A-ZÀ-Ú]{2}/,'no consecutive capitals');
    assert.ok(CRITTER_NAMES[kind]?.one&&CRITTER_NAMES[kind]?.the,kind);
    assert.equal(KILLCAM_KIND_LINES[kind]?.length,1);
    const caption=killcamCaption('Rita',kind,0);
    assert.equal(caption.template,KILLCAM_KIND_LINES[kind][0]);assert.ok(caption.line.startsWith('Rita '),caption.line);
  }
  const log=emptyCauses();recordFall(log,'me','motoboy');recordFall(log,'me','motoboy');
  assert.equal(resultCause(log,'me')?.text,'Te derrubou: Motoboy Kamikaze 2×');
});

test('lint traps: no selfie "pau" and nothing containing "pelad" in the new text',()=>{
  const text=[...NEW.flatMap(k=>[...DEATH_LINES[k],CAUSE_COPY[k].name,CAUSE_COPY[k].line,...KILLCAM_KIND_LINES[k],CRITTER_NAMES[k].one,CRITTER_NAMES[k].the])];
  for(const s of text){
    const low=s.toLocaleLowerCase('pt-BR');
    assert.ok(!low.includes('pelad'),s);assert.doesNotMatch(low,/(^|[^\p{L}])pau($|[^\p{L}])/u,s);
  }
});

test('phase visuals: acting per kind, buffed for any regular critter, the chefe and unknown phases show nothing',()=>{
  assert.equal(PHASE_ACTING,1);assert.equal(PHASE_BUFFED,2);
  assert.equal(phaseLook('coach',1),LOOK_LECTURE);assert.ok(LOOK_LECTURE.acting&&LOOK_LECTURE.aura&&!LOOK_LECTURE.sparkle);
  assert.equal(phaseLook('motoboy',1),LOOK_CHARGE);assert.ok(LOOK_CHARGE.acting&&LOOK_CHARGE.headlight&&!LOOK_CHARGE.aura);
  assert.equal(phaseLook('influencer',1),LOOK_POSE);assert.ok(LOOK_POSE.acting&&LOOK_POSE.reflect);
  for(const kind of ENEMY_KINDS){
    if(kind==='chefe')continue;
    assert.equal(phaseLook(kind,2),LOOK_BUFFED,kind);
    if(!hasActingPose(kind))assert.equal(phaseLook(kind,1),LOOK_NONE,`${kind} has no acting pose`);
  }
  assert.ok(LOOK_BUFFED.sparkle&&!LOOK_BUFFED.acting);
  // The chefe's phase is his boss phase (sim/boss.ts): never a buff or an act.
  for(const phase of [1,2,3])assert.equal(phaseLook('chefe',phase),LOOK_NONE);
  // Unknown phases (an older or newer server) are ignored.
  for(const kind of ENEMY_KINDS)for(const phase of [undefined,0,3,4,7,-1,1.5,NaN,Infinity])assert.equal(phaseLook(kind,phase),LOOK_NONE,`${kind} ${phase}`);
  for(const look of [LOOK_NONE,LOOK_LECTURE,LOOK_CHARGE,LOOK_POSE,LOOK_BUFFED])assert.ok(Object.isFrozen(look));
  // Every acting look swaps to a texture that exists for the kind.
  for(const kind of NEW)assert.ok(phaseLook(kind,1).acting&&enemyTexture(kind,false,phaseLook(kind,1).acting).endsWith(':act'));
});

test('the client lecture ring matches the sim PALESTRA radius',async()=>{
  const {PALESTRA}=await import('../../src/sim/enemies/catalog.ts');
  assert.equal(PALESTRA_RADIUS,PALESTRA.radius,'keep render/phase-look.ts in step with the sim');
});

test('the lecture ring is PALESTRA_RADIUS world units on the ground in every camera view (flat ground)',()=>{
  assert.equal(PALESTRA_RADIUS,3.5);
  const e=groundEllipse(PALESTRA_RADIUS,{rx:0,ry:0}),out={x:0,y:0};
  for(let view=0;view<4;view++){
    // The ring is drawn flat around the feet: compare with the projection minus the terrain height.
    const p=new Projector(view),c={...p.project(12,12,out)};c.y+=elevation(12,12);
    let maxX=0,maxY=0;
    for(let i=0;i<360;i++){const a=i/360*Math.PI*2;const x=12+Math.cos(a)*PALESTRA_RADIUS,y=12+Math.sin(a)*PALESTRA_RADIUS;p.project(x,y,out);out.y+=elevation(x,y);
      maxX=Math.max(maxX,Math.abs(out.x-c.x));maxY=Math.max(maxY,Math.abs(out.y-c.y));}
    assert.ok(Math.abs(maxX-e.rx)<.5&&Math.abs(maxY-e.ry)<.5,`view ${view}: ${maxX}×${maxY} vs ${e.rx}×${e.ry}`);
  }
});

test('reduced motion: the cues stand still (no pulse, orbit, twinkle, flicker or moving glint)',()=>{
  const f={dx:0,dy:0,r:0,alpha:0},g={dx:0,dy:0,r:0,alpha:0};
  for(const now of [0,333,5000,123456]){
    assert.equal(auraPulse(now,true),1);assert.equal(headlightGlow(now,.3,true),1);assert.equal(reflectGlint(now,true),reflectGlint(0,true));
    for(let i=0;i<SPARKLES;i++){sparkleFrame(i,now,.4,true,f);sparkleFrame(i,0,.4,true,g);assert.deepEqual(f,g);}
  }
  // With motion they do move (so the reduced branch is a real difference).
  sparkleFrame(0,0,.4,false,f);sparkleFrame(0,700,.4,false,g);assert.notDeepEqual(f,g);
  assert.notEqual(auraPulse(400,false),auraPulse(0,false));
});

test('no steady-state allocations: constant looks, caller-owned outputs and an allocation-free draw path',()=>{
  // The same frozen object for the same state, every call.
  for(let i=0;i<1000;i++){assert.equal(phaseLook('coach',1),LOOK_LECTURE);assert.equal(phaseLook('bebado',2),LOOK_BUFFED);}
  const out={dx:0,dy:0,r:0,alpha:0},axes={rx:0,ry:0};
  assert.equal(sparkleFrame(1,1234,.2,false,out),out,'writes into the caller frame');
  assert.equal(groundEllipse(2,axes),axes,'writes into the caller axes');
  // layers.ts: drawPhase uses scratch points and Graphics calls only (no closures, arrays, objects or `new`).
  const layers=source('src/client/render/layers.ts');
  const start=layers.indexOf('private drawPhase('),end=layers.indexOf('private barLift(');
  assert.ok(start>0&&end>start);
  const body=layers.slice(start,end).replace(/\/\*\*[\s\S]*?\*\//g,'').split('\n').filter(l=>!/^\s*private (ringPts|ellipseAxes|sparkle):/.test(l)).join('\n');
  assert.doesNotMatch(body,/\bnew\b|=>|\[\s*\]|\{\s*x:|Array\.from|\.map\(|\.\.\./,'drawPhase allocates');
  assert.match(layers,/private ringPts:Pt\[\]=Array\.from\(\{length:PHASE_RING_POINTS\}/,'scratch ring points made once');
  // The texture swap happens on a state change only (syncEnemy compares the key), never per frame.
  assert.match(layers,/a\.tex!==tex\)\{\s*a\.image\.setTexture\(tex\)/);
  // D-047: an açucarado critter (EnemyView.sugar) has a state too; so has a Cliente Prime (bancos, EnemyView.prime).
  assert.match(layers,/if\(a\.look!==LOOK_NONE\|\|a\.sugar\|\|a\.prime\)this\.drawPhase\(/,'nothing is drawn for a critter without a state');
  // The chefe keeps his boss phase; everyone else gets 1 there (no 'phase2-idle' on a buffed critter).
  assert.match(layers,/a\.bossPhase=kind==='chefe'\?view\.phase\?\?1:1;/);
});

test('a shot the influencer reflects reads as hostile: never the weapon art (R3)',()=>{
  const strip=(file:string)=>({kind:'frames',files:{sheet:{file,cell:[64,64] as [number,number],frames:8}}});
  setArtIndex(parseArtIndex({version:2,groups:{projeteis:{output:'public/art/projectiles',
    pieces:{chinelo:strip('chinelo.webp'),boleto:strip('boleto.webp'),'boleto-evo':strip('boleto-evo.webp'),pombo:strip('pombo.webp'),
      'boleto-juros':strip('boleto-juros.webp'),'garrafa-molotov':strip('garrafa-molotov.webp'),'tiro-aliado':strip('tiro-aliado.webp')}}}}));
  // Friendly: the weapon's own sheet, as before.
  for(const source of ['boleto','boleto-evo','pombo'])assert.equal(projectileLook(false,source)?.key,`art:proj:${source}`,source);
  // Reflected (hostile, a player weapon's source): no look at all, so layers.ts falls back to the hostile star.
  for(const source of ['boleto','boleto-evo','pombo','chinelo']){
    assert.equal(projectileLook(true,source),undefined,source);
    assert.equal(projectileTexture(true,source),FX.projHostile,source);
  }
  // Real hostile shots keep their art (the agiota's boleto com juros, the anão's bottle alias).
  assert.equal(projectileLook(true,'boleto-juros')?.key,'art:proj:boleto-juros');
  assert.equal(projectileLook(true,'molotov')?.key,'art:proj:garrafa-molotov');
});
