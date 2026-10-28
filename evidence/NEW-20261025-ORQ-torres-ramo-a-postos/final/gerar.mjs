// Etapa 2 (card NEW-20261025-ORQ-torres-ramo-a-postos): arte final dos 7 postos do ramo A, madeira e sacos, com sombra,
// e a tripulação com idle e tiro engraçados (Adult Swim, design/HUMOR-ADULT-SWIM.md). Um Codex por vez (pesado --codex).
// O jogo desenha a BASE (4 vistas × obra-1..3, pronta, danificada, ruína) e, no ponto `mount`, a TRIPULAÇÃO em 8 direções
// (idle e fire). Por isso a base vem vazia, com o meio livre, e a tripulação é desenhada à parte, na altura do herói.
// Jobs (pasta <job>/ com prompt.txt, refs, meio.png, codex.log):
//   base1-<id>        4 vistas × (pronta, danificada)             refs: conceito A + estilo
//   base2-<id>        4 vistas × (obra-1, obra-2, obra-3, ruína)  ref: base1-<id>/meio.png
//   crew-<id>         a tripulação parada em S, SW, W, NW, N      ref: conceito A (o boneco chibi)
//   anim-<id>-<DIR>   16 poses 4×4: idle 0-7, tiro 8-15            ref: a célula DIR do crew-<id>
// uso: node gerar.mjs <job[,job…]>  (DRY=1 só escreve o prompt; sufixo -tN no job = tentativa N)
import {execFileSync,spawn} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';
const HERE=path.dirname(new URL(import.meta.url).pathname).replace(/^\/(\w:)/,'$1');
const PESADO='D:/Gits/viagem-board/tools/pesado.mjs',ME=process.env.ME??'E1';
export const DRAWN=['S','SW','W','NW','N'];
const LOOK={S:'facing the BOTTOM of the screen, towards the camera (front view)',
  SW:'facing the BOTTOM-LEFT of the screen (three-quarter front view, turned to our left)',
  W:'facing the LEFT of the screen (pure side view, profile pointing left)',
  NW:'facing the TOP-LEFT of the screen (three-quarter back view, turned away to our left)',
  N:'facing the TOP of the screen, away from the camera (back view: we see their backs, not their faces)'};

const SOLDIER='chibi cartoon soldiers exactly like the little soldier in conceito.png: big round olive helmet, big head (about 40 % of the body height), short stocky body, olive-drab winter uniform, brown gloves, expressive cartoon faces';
// cut: 'waist' = the crew stands behind a parapet and the game only shows them from the waist up (we cut the sheet);
// 'full' = they lie or kneel on an open roof/deck and are shown whole.
export const T={
  'vigia-do-predio':{name:'Guarita',fp:2,cut:'waist',
    post:'a small square WOODEN GUARD POST: a low plank platform raised on short log stilts (its floor at about knee height of the character), a waist-high parapet all around its edge made of sandbags on the front and weathered planks on the sides, a short 3-rung wooden ladder on one side, a little oil lantern hanging on a pole at one corner, one small crate by the ladder. NO roof. The middle of the platform is an EMPTY floor (the guard is added later by the game).',
    height:'about 0.7 times the character (top of the parapet)',
    crew:'ONE guard: a chubby young recruit whose helmet is a size too big for him, a wooden-stock rifle',
    idle:`0 alert, holding the rifle at his chest, looking ahead
1 his eyelids get heavy
2 his head nods forward, eyes closed
3 fast asleep standing, chin on his chest, mouth open, a snot bubble from his nose
4 still asleep, the snot bubble grows BIG
5 the bubble POPS: he jerks awake, the helmet bounced up off his head a little, eyes wide
6 eyes wide, he swings the rifle left and right, panicked, looking for the danger
7 he pretends nothing happened, rifle at his chest again, whistling (it loops to pose 0)`,
    fire:`8 he raises the rifle to his shoulder and aims straight ahead
9 he squeezes both eyes SHUT and scrunches his whole face, still aiming
10 the shot: the rifle kicks up and back into his shoulder, his helmet pops UP off his head (floating just above it)
11 the helmet high above his head, he blinks, surprised, the rifle still raised
12 the helmet falling back down
13 the helmet lands crooked over his eyes, he cannot see
14 he pushes the helmet back up with one hand
15 holding the rifle at his chest again, as pose 0`,
    fps:12},
  'vigias-armados':{name:'Mirante',fp:2,cut:'waist',
    post:'a WOODEN WATCHTOWER: four thick log legs with X cross-bracing and a wooden ladder up one side, carrying a square plank deck with a chest-high parapet all around made of sandbags and planks. NO roof (just an empty flag pole with a rag tied to one corner post). The deck floor in the middle is EMPTY (the two lookouts are added later by the game).',
    height:'about 1.5 times the character (top of the parapet)',
    crew:'TWO lookouts side by side: a tall skinny one with a long neck and a short fat one with a moustache; each has a rifle slung on his back, and there is only ONE pair of binoculars between them',
    idle:`0 the tall one looks through the binoculars, the short one stands bored next to him
1 the short one grabs the binoculars strap and tugs
2 a tug of war: both pull the binoculars, angry faces
3 the short one wins and looks through the binoculars, smug
4 the tall one pokes the short one's helmet with a finger
5 the short one sticks his tongue out at him, still holding the binoculars
6 the tall one snatches the binoculars back
7 as pose 0 again (it loops to pose 0)`,
    fire:`8 both swing their rifles off their backs and aim forward, side by side
9 both aim, concentrated
10 both shoot at the same instant: both rifles kick back
11 both JUMP, startled by the other's shot, staring at each other in shock
12 they hug each other in fear, rifles squeezed between them
13 they realise, push each other away, embarrassed
14 both straighten their helmets, looking away from each other
15 the rifles back on their shoulders, the tall one lifts the binoculars again, as pose 0`,
    fps:12},
  'atiradores-do-telhado':{name:'Andaime',fp:2,cut:'waist',
    post:'a SCAFFOLD SHOOTING PLATFORM: a sturdy timber scaffold (posts, cross braces, a ladder) carrying a square plank deck with a chest-high parapet all around of stacked sandbags with a few rusty steel sheets nailed on the front. NO roof. The deck floor in the middle is EMPTY (the three shooters are added later by the game). Sturdier and a bit taller than a simple watchtower.',
    height:'about 1.4 times the character (top of the parapet)',
    crew:'THREE shooters in a row, each with a rifle: on the left a skinny one eating a dry block of instant noodles, in the middle a sleepy one, on the right a vain one with a smartphone',
    idle:`0 all three stand in a row, rifles at their chests, looking ahead
1 the left one bites a crunchy dry block of instant noodles
2 the middle one does a HUGE yawn, mouth wide open
3 the right one holds his phone up for a selfie
4 all three squeeze in for the selfie: noodle in the left one's mouth, the middle one half asleep, the right one makes a peace sign
5 the selfie taken, all three blink
6 the right one checks the photo on his phone, the others look ahead again
7 as pose 0 again (it loops to pose 0)`,
    fire:`8 all three aim their rifles forward
9 a stadium WAVE: the left one fires and throws both arms (and the rifle) up
10 the middle one fires and throws his arms up, the left one coming down
11 the right one fires and throws his arms up, the middle one coming down
12 all three cheer with the rifles held high
13 the left one aims again, the others still cheering
14 the middle and right ones aim again
15 all three with the rifles at their chests, as pose 0`,
    fps:12},
  'ninho-de-metralhadora':{name:'Ninho',fp:3,cut:'waist',
    post:'a round MACHINE-GUN NEST at ground level: a thick ring of stacked sandbags (chest high) with a few log posts and planks holding them, a dirt and plank floor inside, ammo crates and a coil of ammo belt by the inner wall, a little camouflage net draped on one side. The middle of the ring is an EMPTY floor (the machine gun and its crew are added later by the game). Low and wide, solid.',
    height:'about 0.5 times the character (top of the sandbag ring)',
    crew:'a heavy machine gun on a tripod with TWO men: a big burly gunner with a huge moustache holding the gun\'s handles, and a tiny loader feeding the ammo belt; the gun points the way they face',
    idle:`0 the gunner holds the handles, the loader holds the belt, both look ahead
1 the gunner polishes the barrel with a rag
2 the gunner polishes lovingly, eyes closed
3 the gunner kisses the barrel, the loader looks disgusted
4 the loader chews gum
5 the loader blows a HUGE pink gum bubble
6 the bubble pops all over the loader's face, the gunner laughs
7 as pose 0 again (it loops to pose 0)`,
    fire:`8 the gunner grabs the handles, wild grin
9 firing: the gunner's whole body shakes, his cheeks and moustache jiggle to the left
10 still firing, shaking the other way, cheeks jiggling right, the helmet rattling
11 still firing, the loader squeezes his eyes and covers his ears
12 still firing, a spray of brass casings flies off the side of the gun
13 still firing, shaking, the casings bounce off the loader's helmet
14 still firing, the gunner screams with joy, teeth rattling
15 the gun stops, the gunner dazed with a happy smile, as pose 0`,
    fps:16},
  'guarnicao-do-predio':{name:'Trincheira',fp:3,cut:'waist',
    post:'a fortified TRENCH POST: a square earth mound with a deep plank-lined trench inside, a thick chest-high parapet all around of sandbags held by horizontal logs and posts, a firing step of planks, ammo crates, a radio with an antenna in one corner, a small flag on a stick. The middle (the trench floor) is EMPTY (the crew is added later by the game). The most robust post of the line: wider, thicker walls, double rows of sandbags.',
    height:'about 0.7 times the character (top of the parapet)',
    crew:'THREE riflemen of the garrison shoulder to shoulder: an old sergeant with a cigar, a young one with glasses, a big one with a headband; they play cards between fights (each holds a hand of cards), rifles slung',
    idle:`0 the three hold their hands of cards, rifles slung, looking at their cards
1 the sergeant slams a card down, mouth wide open shouting
2 the other two lean back in shock
3 the big one slams a card down even harder, angry
4 the young one quietly shows his card, smug
5 the sergeant and the big one stare at him, furious
6 the young one shrugs, grinning
7 as pose 0 again (it loops to pose 0)`,
    fire:`8 all three throw their cards in the air and grab their rifles
9 all three aim forward, cards fluttering above them
10 the left one fires (the rifle kicks), a card lands on the sergeant's helmet
11 the middle one fires
12 the right one fires
13 all three fire together
14 the sergeant fires, the card still on his helmet
15 the rifles slung, the three hold their cards again, as pose 0`,
    fps:18},
  'ninho-do-sniper':{name:'Tocaia',fp:2,cut:'full',
    post:'a slender SNIPER HIDE: a tall tower of four log legs with diagonal braces and a ladder, carrying a small square plank deck with a LOW knee-high rim of logs and a few sandbags, and a camouflage net with leaves hanging down the sides under the deck. NO roof. The deck top is an EMPTY open floor (the sniper team is added later by the game).',
    height:'about 1.6 times the character (top of the deck)',
    crew:'a sniper team on the deck: the SNIPER lies prone behind a long sniper rifle on a bipod, with a ridiculous little bush tied on top of his helmet as camouflage; the SPOTTER kneels next to him with binoculars',
    idle:`0 the sniper lies aiming, the spotter kneels with binoculars
1 a small bird lands on the end of the rifle barrel
2 the sniper stares at the bird, cross-eyed
3 the spotter waves his hand to shoo the bird
4 the bird hops onto the spotter's helmet instead
5 the spotter freezes, eyes rolled up at the bird on his head
6 the bird flies off (not drawn any more), the spotter sighs
7 as pose 0 again (it loops to pose 0)`,
    fire:`8 the sniper aims, the spotter looks through the binoculars
9 the sniper holds his breath, cheeks puffed, the spotter points ahead
10 the shot: the huge kick throws the sniper BACKWARDS, he slides back on his belly
11 the sniper sits up, dazed, helmet and bush crooked, eyes spinning
12 the spotter claps for him, proud
13 the sniper gives a dizzy thumbs up
14 the sniper lies back down behind the rifle
15 aiming again, as pose 0`,
    fps:6},
  'equipe-antimaterial':{name:'Casamata',fp:2,cut:'full',
    post:'a squat timber CASEMATE: low walls of thick horizontal logs and sandbags with narrow firing slits, a flat roof of logs covered with a layer of sandbags, a small ladder up the back, ammo crates. NO tall parts. The flat roof top is an EMPTY open floor (the gun team is added later by the game). The strongest-looking small post: heavy, low and stubborn.',
    height:'about 0.8 times the character (top of the roof)',
    crew:'an anti-materiel team on the roof: the GUNNER lies prone behind an ENORMOUS anti-materiel rifle (longer than both men) on a bipod resting on a sandbag; the LOADER kneels next to him holding one giant bullet',
    idle:`0 the gunner lies aiming the huge rifle, the loader kneels with the giant bullet
1 the gunner hugs the rifle like a teddy bear, cheek on the stock
2 the gunner fast asleep cuddling the rifle, drooling, smiling
3 the loader polishes the giant bullet with his sleeve
4 the loader pokes the gunner with the giant bullet
5 the gunner wakes up, wipes the drool, embarrassed
6 the gunner aims again, very serious, the loader rolls his eyes
7 as pose 0 again (it loops to pose 0)`,
    fire:`8 the gunner aims, the loader covers his ears
9 the gunner squeezes his eyes shut, bracing
10 the BOOM: the recoil shoves both men backwards, their helmets tipped back
11 both faces are BLACK with soot, hair and eyebrows smoking and frizzy, eyes blinking white
12 they look at each other, black faces, a cough
13 the loader wipes his face with his sleeve, the gunner wipes his with a glove
14 the gunner slides back up behind the rifle
15 aiming again, as pose 0`,
    fps:5},
};

const CODEX_ONLY='Use your built-in image generation tool to create ONE image and save it in the current folder as meio.png. Only generate and save: do NOT inspect or analyse files, do NOT run code, do NOT check the result with PIL or any script, do NOT draw with HTML/SVG/Python. Save exactly the image YOU generate in this run; never copy any other file from ~/.codex/generated_images. One generation call, then copy the file and stop.';
const STYLE='Game art for an isometric survival tower-defense game (a snowy, run-down Brazilian city outskirts). Same painted semi-realistic style as estilo.png, light from the top-left, a light dusting of snow on the top surfaces, a muted military palette (beige sandbags, weathered brown wood, olive drab, a little rusty steel). Material: WOOD AND SANDBAGS only (no concrete, no brick, no steel buildings).';
const CAMERA='Camera: the same isometric orthographic view as estilo.png (about 30 degrees from above, the square footprint seen as a 2:1 diamond, no perspective, no vanishing point).';
const SHADOW='SHADOW: the post casts its own soft dark shadow on the ground, falling to the bottom-right (light from the top-left), drawn as a darker area over the green background right next to its base, as part of the drawing. No other ground, no grass, no terrain plate beyond the post\'s own footprint.';
const VIEWS='The 4 columns are the 4 camera views of the SAME post: column 1 = view 0°, then the camera turns 90° around it for each next column (column 2 = 90°, column 3 = 180°, column 4 = 270°): the same post seen from its 4 sides, so the ladder, the lantern, the crates and the details move to the matching corner. Same size, same footprint diamond, same height in all 4 columns. EVERY column is the same isometric diamond view (we always look at a CORNER of the post, the front corner at the bottom): never a flat front view of one side (the first Andaime sheet drew columns 2-3 head-on, 28/10).';
const GRID=(c,r)=>`Layout: ${c} columns x ${r} rows of equal cells, the object centred in each cell with generous margins, its footprint diamond at the SAME place in every cell, nothing touching the cell borders. Background flat pure chroma green #00FF00 everywhere, NO text, NO labels, NO grid lines, NO frame.`;

function prompt(kind,id,dir){
  const t=T[id],fpTxt=`Footprint ${t.fp}x${t.fp} tiles: the post fills the width of its diamond.`;
  if(kind==='base1')return `${CODEX_ONLY}

${STYLE}
Subject: "${t.name}", a field defense post of the line (use conceito.png only for the look of its planks, logs and sandbags and its chunky cartoon finish; the SHAPE is the one described here, and the post is EMPTY, without any soldier). ${t.post}
Scale: the chibi character in estilo.png is the human scale: a sandbag parapet reaches his chest, a ladder rung fits his steps, a plank is as long as he is tall. Total height ${t.height}. It is a field post, NOT a building: no house, no windows, no roof tiles, no floors.
${fpTxt}
${CAMERA}
${SHADOW}
${VIEWS}
Rows: row 1 = the post finished and intact ("pronta"). Row 2 = the SAME post damaged ("danificada"): some sandbags torn open and sagging with sand spilling, a few planks broken or hanging, a scorch mark, but still standing and the same size.
${GRID(4,2)}
Use estilo.png only for the style, camera and scale: do not copy anything from it and do not draw its character.`;
  if(kind==='base2')return `${CODEX_ONLY}

${STYLE}
Subject: the construction stages and the ruin of the SAME defense post as ref.png ("${t.name}"; ref.png row 1 is the finished post in its 4 camera views). Keep exactly its footprint diamond, size, palette and the 4 views (columns) of ref.png. Empty post, no people.
Rows:
row 1 "obra-1": the footprint marked on the ground with wooden stakes and string, a pile of planks, a few stacked sandbags and a shovel (very low).
row 2 "obra-2": half built: the frame of logs and posts standing, part of the floor and only the lowest layer of sandbags, a ladder leaning on it.
row 3 "obra-3": almost done: everything built but a tarp over part of the parapet, a hammer and a bucket of nails, a few sandbags still to place.
row 4 "ruina": destroyed: a collapsed heap of broken planks, burst sandbags and spilled sand, a charred log, low to the ground, smoke-blackened.
${fpTxt}
${CAMERA}
${SHADOW}
${VIEWS}
${GRID(4,4)}`;
  if(kind==='crew')return `${CODEX_ONLY}

${STYLE}
Subject: the crew of the defense post "${t.name}", drawn alone (no post, no tower, no floor): ${t.crew}. They are ${SOLDIER}, sized like the character in estilo.png (the same total height when standing). Funny Adult Swim cartoon characters, each with a very distinct face and silhouette.
${t.cut==='waist'?'They stand upright on flat ground, full body visible (we will hide their legs behind the parapet in the game).':'They are on flat ground in their lying / kneeling pose, full body visible.'}
Pose: neutral and ready, as described for pose 0: ${t.idle.split('\n')[0].replace(/^0 /,'')}.
The 5 columns are the 5 directions the crew faces (they turn as one group, the weapons pointing the way they face): column 1 = facing the BOTTOM of the screen (front view, towards the camera); column 2 = facing the BOTTOM-LEFT (three-quarter front, turned to our left); column 3 = facing the LEFT (pure profile); column 4 = facing the TOP-LEFT (three-quarter back view); column 5 = facing the TOP of the screen (back view, we see their backs).
${CAMERA}
SHADOW: a small soft dark contact shadow on the ground right under them, drawn as a darker area over the green.
${GRID(5,1)}`;
  const d=dir;return `${CODEX_ONLY}

Subject: the SAME crew as ref.png (${t.crew}; ${SOLDIER}), same faces, same painted style, the SAME colours and the same light as ref.png.
BODY PROPORTIONS: EXACTLY the size and build of ref.png in every pose: if you put ref.png next to any pose, the helmets, heads, bodies and weapons are the same size.
Direction: the group is ${LOOK[d]}, exactly the same angle as ref.png, in every pose; the weapons point that way.
AIMING (poses 8-15): the weapons aim ${AIM[d]}.
${CAMERA}

Motion: an Adult Swim style funny animation in 16 poses: poses 0-7 are an IDLE loop between fights, poses 8-15 are the SHOT (it plays each time the post fires and ends back at pose 0).
${t.idle}
${t.fire}

They stay ${t.cut==='waist'?'standing':'lying / kneeling'} at EXACTLY the same place in all 16 poses (${t.cut==='waist'?'feet planted, no stepping':'bodies on the same spot unless a pose says they slide'}); only arms, heads and bodies move. Do NOT draw muzzle flashes, smoke, motion lines, stars or any effect (the game adds them). Everything stays inside its cell.
SHADOW: the same small soft dark contact shadow under them as in ref.png, in every pose.
Layout: 4 columns x 4 rows, equal cells, reading order (row 1: 0-3, row 2: 4-7, row 3: 8-11, row 4: 12-15), the SAME size and the same ground line (at 85% of each cell height) in every cell, centred, generous margins, nothing touching the cell borders. Background flat pure green #00FF00, NO text, NO grid lines, NO frame.`;
}

/** Where the weapons aim in the shot, per drawn direction (the Guarita's first N aimed to the left, 28/10). */
const AIM={S:'straight at the camera (bottom of the screen): we see the muzzles head-on',SW:'towards the BOTTOM-LEFT of the screen (diagonal, slightly downwards)',W:'straight to the LEFT',NW:'towards the TOP-LEFT of the screen (diagonal, slightly upwards)',N:'straight AWAY from the camera, towards the TOP of the screen: from behind we only see the barrels poking up above the shoulders or heads, NEVER pointing left or right'};
const REF=path.join(HERE,'..','refs'),CONC=path.join(HERE,'refs');
function refs(kind,id,dir){
  if(kind==='base1')return [[path.join(CONC,`conceito-a-${id}.png`),'conceito.png'],[path.join(REF,'ref-estilo.png'),'estilo.png']];
  if(kind==='base2')return [[path.join(HERE,`base1-${id}`,'meio.png'),'ref.png']];
  if(kind==='crew')return [[path.join(CONC,`conceito-a-${id}.png`),'conceito.png'],[path.join(REF,'ref-estilo.png'),'estilo.png']];
  return [[path.join(HERE,`crew-${id}`,`dir-${dir}.png`),'ref.png']];
}
function parse(job){
  const m=job.match(/^(base1|base2|crew|anim)-(.+?)(?:-(S|SW|W|NW|N))?(?:-(t\d+))?$/);
  if(!m||!T[m[2]]||(m[1]==='anim')!==!!m[3])throw new Error('job: '+job);
  return {kind:m[1],id:m[2],dir:m[3],t:m[4]};
}
async function run(job){
  const {kind,id,dir}=parse(job),out=path.join(HERE,job);fs.mkdirSync(out,{recursive:true});
  const rs=refs(kind,id,dir);for(const [src,name] of rs)fs.copyFileSync(src,path.join(out,name));
  fs.writeFileSync(path.join(out,'prompt.txt'),prompt(kind,id,dir));
  if(process.env.DRY){console.log(fs.readFileSync(path.join(out,'prompt.txt'),'utf8'));return;}
  for(;;){try{execFileSync('node',[PESADO,'pegar',ME,'--codex',`torres ${job}`],{stdio:'pipe'});break;}catch{await new Promise(r=>setTimeout(r,20000));}}
  const wsl=out.replace(/^(\w):/,(m,d)=>`/mnt/${d.toLowerCase()}`).split(String.fromCharCode(92)).join('/');
  const is=rs.map(([,n])=>`-i ${n}`).join(' ');
  const cmd=`cd '${wsl}' && codex exec -m gpt-6.1-sol -c model_reasoning_effort="low" --skip-git-repo-check --disable apps -s workspace-write "$(cat prompt.txt)" ${is} < /dev/null`;
  const t0=Date.now();
  try{await new Promise(res=>{const p=spawn('wsl',['-e','bash','-lc',cmd],{stdio:['ignore','pipe','pipe']});const log=fs.createWriteStream(path.join(out,'codex.log'));p.stdout.pipe(log);p.stderr.pipe(log);p.on('close',res);});}
  finally{execFileSync('node',[PESADO,'soltar',ME,'--codex'],{stdio:'pipe'});}
  // The copy out of WSL came cut once (construir-6): take the original the log names when it is bigger.
  const gen=[...fs.readFileSync(path.join(out,'codex.log'),'utf8').matchAll(/\/home\/[^\s`'"]*generated_images\/[^\s`'"]*\.png/g)].at(-1)?.[0];
  if(gen){try{const size=+execFileSync('wsl',['-e','stat','-c','%s',gen]).toString().trim(),have=fs.existsSync(path.join(out,'meio.png'))?fs.statSync(path.join(out,'meio.png')).size:0;
    if(size>have){execFileSync('wsl',['-e','cp',gen,`${wsl}/meio.png`]);console.log(job,'meio.png do original do Codex',have,'→',size);}}catch(e){console.log(job,'sem o original',String(e).slice(0,80));}}
  console.log(job,fs.existsSync(path.join(out,'meio.png'))?'ok':'SEM meio.png',Math.round((Date.now()-t0)/1000)+'s');
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/,'$1'))){
  for(const job of process.argv[2].split(','))await run(job);
}
