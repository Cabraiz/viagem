/**
 * Art v2 importer contract (NEW-20261012-ORQ-importador-arte-a). Source of truth for the pieces:
 * the board's design/inventario-sprites.md (9 groups) and design/arte-v2.md §5–6.
 * Data only: every GROUP says where its pieces live under `arte-entrada/`, its default format (`kind`) and which formats
 * it accepts. A piece may carry a sidecar `<id>.json` (or `meta.json` inside an enemy folder) that sets its own
 * kind/cell/frames/views/rows/anchor/slice; the group defaults fill the rest. New families are new data, not new code.
 *
 * Formats (`kind`):
 *  - 'animations' (8 directions): folder `<group>/<id>/` with `<anim>.png` + `meta.json` {"cell":[w,h],"anchor":[0.5,0.88],"fps":{…}};
 *    each PNG is `frames` columns × 8 rows (DIRECTIONS order). Optional elite layer `<group>/elite/<id>-<anim>.png`,
 *    same grid, only the extra (badge/crown/aura): no foot rules.
 *  - 'dir8': player atlas `<group>/<id>.dir8.png`, 1152×4608 = 6 columns × 24 rows of 192: 8 blocks (DIRECTIONS) of
 *    idle/walk/attack rows. Output: today's 4-direction atlas from the diagonals (DIR4_FROM_DIR8, same offsets) plus a
 *    second 1152×2304 atlas with the cardinals, so no texture exceeds 4096 px. Optional `<id>.downed.png`
 *    (6 columns × 8 rows of 192, DIRECTIONS order).
 *  - 'views': `<id>.png`, `views` columns (camera 0°, 90°, 180°, 270°; or 1 for a symmetric top-down object) ×
 *    rows (states or animation frames, named in `rows`); cell and anchor from the sidecar.
 *  - 'frames': `<id>.png`, one row of `frames` cells, one view (items, projectiles, effects, the animated sea-foam edge
 *    of the ground); cell from the sidecar or square = image height (then the width must be a multiple of the height).
 *  - 'seamless': `<id>.png`, tiles with itself (opposite edges continue each other). Size: sidecar `cell:[w,h]`, else
 *    sidecar/group `size` (chao: 512), else any square. Sidecar `wrap`: 'xy' (default, both axes), 'x' (only left/right
 *    edges must meet: a horizontal strip such as the telegraph border 128×16) or 'y'. Opaque unless `transparent:true`
 *    (telegraph fill 128×128 and border may carry alpha). `mask:true` (transition `trans-<a>-<b>.png`): grayscale,
 *    always opaque, also seamless.
 *  - 'nineslice': `<id>.png`, exact `cell` size, transparent, sidecar `slice:[left,top,right,bottom]` insets in px.
 *  - 'icon': `<id>.png`, transparent square of exactly `size` px (128 for UI; the app icon 512). `opaque` (group map
 *    by id or sidecar `opaque:true`): a full-bleed opaque icon, only the size is checked.
 * Foot rules (anchor) apply only to what stands on the ground: 'animations', 'dir8' and 'views' with 4 views, always
 * against the PIECE's anchor; never to 'frames', 'icon', 'nineslice' or 'seamless'.
 * Partial delivery: an absent piece stays "pendente" and the game keeps its current art. Inside a piece, absent
 * optional parts (some enemy animations, the elite layer, the player's downed sheet or atlas) are NOTES, not
 * problems: the piece is approved for what came and the game keeps its current art for the rest.
 */
import {ENEMY_ROLES,ENEMY_TABLE} from './enemies-table.mjs';

export const DIRECTIONS=Object.freeze(['S','SW','W','NW','N','NE','E','SE']);
/** pt-BR names for messages. */
export const DIRECTION_NAMES=Object.freeze({S:'sul (de frente)',SW:'sudoeste',W:'oeste',NW:'noroeste',N:'norte (de costas)',NE:'nordeste',E:'leste',SE:'sudeste'});
/** Camera views of 4v pieces, in column order. */
export const VIEW_NAMES=Object.freeze(['0°','90°','180°','270°']);
/** Diagonals that map onto today's 4-direction atlas, in its block order (front-right, front-left, back-right, back-left). */
export const DIR4_FROM_DIR8=Object.freeze(['SE','SW','NE','NW']);
/** Cardinals in the second atlas, in this block order. */
export const CARDINALS=Object.freeze(['S','W','N','E']);
/** Facing directions drawn mirrored (feet at 191 − class column), as in docs/sprite-directions.md. */
export const LEFT=Object.freeze(new Set(['SW','W','NW']));
/** Characters and enemies stand on this point of their cell (fraction of width, height). */
export const ANCHOR=Object.freeze([0.5,0.88]);
/** Alpha above which a pixel counts as drawn. */
export const ALPHA_THRESHOLD=20;
/** Transparent margin every transparent cell keeps on all sides (nothing touches the cell border). */
export const PADDING=2;
/** Foot line tolerance as a fraction of the cell height; foot centre tolerance as a fraction of the cell width. */
export const FOOT_Y_TOLERANCE=.05,FOOT_X_TOLERANCE=.12;
/**
 * Animations whose frames leave the ground (flying, falling, being thrown back, jumping on someone): no foot rule at all.
 * `phase2-idle` and the rest stay grounded.
 */
export const AIRBORNE_ANIMS=Object.freeze(new Set(['fly','death','slam','crash','hit','throw','charge','poop']));
/**
 * Animations that lunge or lean sideways but keep the feet on the ground: the foot line (foot-y) still applies, the
 * foot centre (foot-x) does not.
 */
export const LUNGE_ANIMS=Object.freeze(new Set(['shove','attack','joke','summon','lecture','pose','aim']));
/**
 * Seamless rule, per wrapped edge split in SEAM_SEGMENTS stretches: the mean colour step across the edge in a stretch
 * may be at most SEAM_FACTOR × the SEAM_PERCENTILE of the same measure over every interior line of the image (the mean
 * step between neighbouring columns/rows over the same stretch). Comparing like with like keeps a correct
 * high-contrast tile (cobblestones whose grout line falls on the edge) under the limit (measured ≈ 1.3×), while a
 * broken stretch of a noisy tile is ≈ 3.4× and a smooth gradient that does not wrap is far above (≈ 200×).
 */
export const SEAM_FACTOR=2,SEAM_SEGMENTS=8,SEAM_PERCENTILE=.99;
/** Largest texture side the game loads; bigger sheets are paginated by the converter (a note, not a problem). */
export const MAX_TEXTURE=4096;
/** pt-BR name of each format, for messages (the id stays the value written in the sidecar "kind"). */
export const KIND_NAMES=Object.freeze({
  animations:'animação em 8 direções',dir8:'atlas de 8 direções',views:'vistas de câmera',frames:'quadros (1 vista)',
  seamless:'textura contínua',nineslice:'moldura em 9 partes',icon:'ícone',tower:'torre (base + arma)',
});

// ---------------------------------------------------------------- P0/P1 tables (inventário de sprites, 12/10/2026)
/**
 * Priorities of the inventory: 'P0' (MVP: absent → "pendente"), 'P1'/'P2' (absent → "opcional", never pending).
 * Every `expected` entry of a `pieces:'any'` group: {priority, kind?, cell?, frames? (int, or [min,max] when the
 * inventory gives a range: the sheet's frame count must fall in it), views?, rows?, anchor?, wrap?, transparent?,
 * slice?, size?, meta?}. An expected piece delivered WITHOUT a sidecar uses these values (so a 192×128 strip needs no
 * `<id>.json`); a sidecar overrides any of them (and its `meta` is merged over the table's). When the sidecar changes
 * the `kind`, only the table's `meta` and `priority` still apply. Extra ids (not in the table) stay accepted as before.
 *
 * Ids: pt-BR kebab-case, as the inventory writes the piece, normalised by these rules (the importer only accepts
 * [a-z0-9-]): accents dropped (água → agua, cocô → coco, ímã → ima, você → voce); articles/prepositions and
 * non-distinguishing qualifiers dropped ("banco da praça" → banco-praca, "carro velho com neve" → carro-velho,
 * "Arroto do Bêbado" → arroto); a piece with sizes in cells and variations is `<peça>-<a>x<b>-<n>` (1 variation still
 * `-1`); a series is `<peça>-<n>`; ground is `<mapa>/<material>-<n>` and `<mapa>/trans-<a>-<b>`. Collisions and splits:
 * the minimap marks are `marca-<x>` (marca-coco ≠ the Stonewards icon coco); `chinelo` is ONE ui file serving both the
 * Stonewards icon (i-chinelo) and the upgrade sticker (a-chinelo); the emotes reuse the icon ids (risada, boia, chamar,
 * suor); the fallen helicopter is `helicoptero-caido` (4v) + `helicoptero-fumaca` (8-frame loop).
 */
export const PRIORITIES=Object.freeze(['P0','P1','P2']);
const P0='P0',P1='P1',P2='P2';
const range=(n,f)=>Array.from({length:n},(_,i)=>f(i+1));
/** `<stem>-1..n` → entry. */
const series=(stem,n,entry)=>Object.fromEntries(range(n,i=>[`${stem}-${i}`,entry]));
/** `<stem>-<a>x<b>-1..n` per footprint → views entry with meta.footprint. */
const building=(stem,sizes,n,{priority=P0,ruin=false}={})=>Object.assign({},...sizes.map(([a,b])=>series(`${stem}-${a}x${b}`,n,
  {priority,views:4,meta:{footprint:[a,b],framesPerView:1,...(ruin?{ruin:true}:{})}})));
/** One-footprint-cell pieces (walls, cliffs): `<stem>-<part>-1..n`. */
const parts=(stem,names,n)=>Object.assign({},...names.map(p=>series(`${stem}-${p}`,n,{priority:P0,views:4,meta:{footprint:[1,1],framesPerView:1}})));
/** Animation rows `<name>-1..n`. */
const frameRows=(name,n)=>range(n,i=>`${name}-${i}`);

/** Ground kinds of the city renderer (Executor-3) per Cidade Nevada material. */
export const GROUND_KINDS=Object.freeze({
  'neve-fofa':'snow','neve-pisada':'packed','lama-gelo':'mud',paralelepipedo:'cobble','asfalto-rachado':'asphalt',
  calcada:'sidewalk',entulho:'rubble',gelo:'ice','agua-rasa':'water','vala-sarjeta':'gutter',
});
/** Infinite map / island materials (P1), with their ground kind. */
const GROUND_P1=Object.freeze({
  grama:'grass','capim-alto':'tall-grass','grama-seca':'dry-grass','terra-batida':'dirt',trilha:'trail',areia:'sand',
  'pedra-encosta':'slope-rock','rocha-nua':'bare-rock','agua-rasa':'water',mar:'sea',lama:'mud',
});
/** Transition mask `<mapa>/trans-<a>-<b>`: black = a, white = b; meta.between in ground kinds. */
const transition=(map,a,b,between,priority)=>[`${map}/trans-${a}-${b}`,{priority,kind:'seamless',mask:true,meta:{mask:true,between}}];
const CHAO=Object.freeze({
  ...Object.assign({},...Object.entries(GROUND_KINDS).map(([m,ground])=>series(`cidade-nevada/${m}`,3,{priority:P0,kind:'seamless',meta:{ground}}))),
  ...Object.fromEntries([
    transition('cidade-nevada','neve','asfalto',['snow','asphalt'],P0),
    transition('cidade-nevada','neve','paralelepipedo',['snow','cobble'],P0),
    transition('cidade-nevada','neve','lama',['snow','mud'],P0),
    transition('cidade-nevada','gelo','agua',['ice','water'],P0),
    transition('infinito','grama','areia',['grass','sand'],P1),
    transition('infinito','grama','terra',['grass','dirt'],P1),
    transition('infinito','grama','pedra',['grass','slope-rock'],P1),
    transition('infinito','areia','agua',['sand','water'],P1),
  ]),
  ...Object.assign({},...Object.entries(GROUND_P1).map(([m,ground])=>series(`infinito/${m}`,3,{priority:P1,kind:'seamless',meta:{ground}}))),
  'infinito/espuma-borda':{priority:P1,kind:'frames',frames:8,meta:{ground:'foam'}},
});
const PREDIOS=Object.freeze({
  ...building('casa-terrea',[[1,1],[2,1]],3,{ruin:true}),
  ...building('sobrado',[[2,1],[2,2]],3),
  ...building('predio',[[2,2],[3,2]],2),
  ...building('boteco-esquina',[[2,1]],1,{ruin:true}),
  ...building('mercadinho',[[2,2]],1),
  ...parts('muro-pedra',['reto','quina','ponta','t'],2),
  ...parts('penhasco',['reto','quina-interna','quina-externa'],2),
  ...building('entulho',[[1,1],[2,1]],3),
  ...building('garagem-oficina',[[2,1]],1,{priority:P1}),
  ...building('galpao',[[3,2]],1,{priority:P1}),
  'templo-murado-1':{priority:P1,views:4,meta:{framesPerView:1}},
  'arena-1':{priority:P1,views:4,meta:{framesPerView:1}},
  'portao-1':{priority:P1,views:4,meta:{framesPerView:1}},
});
const DAMAGE=['inteira','avariada','quase-caindo'];
/** `states`: the state names; `stateFrames`: frames per state when a state is an animation (its rows `<state>-1..n`). */
const stateful=(views,states,stateFrames)=>({priority:P0,views,
  rows:states.flatMap(s=>stateFrames?.[s]>1?frameRows(s,stateFrames[s]):[s]),meta:{states,...(stateFrames?{stateFrames}:{})}});
const BASE=Object.freeze({
  'chafariz-congelado':{priority:P0,views:4,meta:{footprint:[3,3]}},
  'muralha-acampamento':stateful(4,[...DAMAGE,'ruina']),
  barricada:stateful(4,[...DAMAGE,'quebrada']),
  forja:stateful(4,['parada','acesa'],{parada:1,acesa:6}),
  'torre-chinelo':stateful(1,['mira','aparecendo'],{mira:8,aparecendo:6}),
  'no-coco':stateful(4,['cheio','meio','vazio']),
  'no-pedra':stateful(4,['cheio','meio','vazio']),
  'helicoptero-caido':{priority:P0,views:4},
  'helicoptero-fumaca':{priority:P0,kind:'frames',frames:8},
  'caixa-saque':stateful(1,['fechada','abrindo'],{fechada:1,abrindo:6}),
  'anel-area':{priority:P0,kind:'frames',cell:[512,512],frames:1},
});
const prop=(id,extra={},priority=P0)=>[id,{priority,views:4,...extra,meta:{prop:id.replace(/-\d+$/,'')}}];
const PROPS=Object.freeze(Object.fromEntries([
  prop('poste',{rows:['aceso','apagado']}),
  ...range(2,i=>prop(`carro-velho-${i}`)),
  ...['onibus-tombado','ponto-onibus','banco-praca','lixeira','barril','caixote','orelhao','hidrante','placa-torta',
    'bicicleta-presa-gelo','varal-congelado'].map(id=>prop(id)),
  ...['boneco-neve-tio-pave','mesa-bar','isopor','churrasqueira-tambor','carrinho-supermercado','sofa-calcada',
    'cone-transito'].map(id=>prop(id)),
  ...range(6,i=>prop(`arvore-nevada-${i}`)),
  ...['rocha','coqueiro','arbusto'].flatMap(s=>range(3,i=>prop(`${s}-${i}`,{},P1))),
  ...['toco','tronco-caido','portal-praca','fonte','mirante'].map(id=>prop(id,{},P1)),
  ['plaquinha',{priority:P1,kind:'nineslice',meta:{prop:'plaquinha'}}],
]));
const strip=(cell,frames,priority=P0)=>({priority,kind:'frames',cell:Array.isArray(cell)?cell:[cell,cell],frames});
const ITENS=Object.freeze({
  'gema-pequena':strip(64,4),'gema-media':strip(64,4),'gema-grande':strip(64,4),
  coxinha:strip(64,4),ima:strip(64,4),bau:strip(64,4),'recurso-coco':strip(64,4),'recurso-pedra':strip(64,4),
  'boleto-chuva':strip(64,8,P1),
});
const PROJETEIS=Object.freeze({
  'tiro-aliado':strip(32,4),'garrafa-molotov':strip(64,8),'coco-pombo':strip(48,6),'coco-pombo-poca':strip(96,6),
  'boleto-juros':strip(48,8),
  // Any other critter shot (today's hostile star, keys.ts FX.projHostile); P1: the inventory has no row for it yet.
  'tiro-inimigo':strip(32,[1,4],P1),
  ...Object.fromEntries(['chinelo','boleto','cafe','guarda-chuva','pombo','audio','chinelo-evo','boleto-evo','cafe-evo']
    .map(id=>[id,strip(64,[6,8])])),
});
const EFEITOS=Object.freeze({
  'fogo-chao':strip(128,8),arroto:strip([192,128],6),'carimbo-chefe':strip(256,8),
  // Telegraph decorations with no inventory row yet (P1): the boss charge's chevron (drawn pointing right, +x) and the
  // explosion's pulsing target (src/client/render/telegraph-look.ts 'dash' and 'burst').
  'seta-investida':strip(64,[1,4],P1),'aviso-explosao':strip(128,[1,8],P1),
  'telegraph-enchimento':{priority:P0,kind:'seamless',cell:[128,128],transparent:true},
  'telegraph-borda':{priority:P0,kind:'seamless',cell:[128,16],wrap:'x',transparent:true},
  'aviso-spawn':strip(128,6),
  'morte-poof':strip(128,[8,10]),...series('morte-gosma',3,strip(128,[8,10])),'morte-explosao':strip(128,[8,10]),
  'impacto-faisca':strip(64,5),'impacto-poeira':strip(64,5),'impacto-neve':strip(64,5),
  'anel-alvo':strip(128,4),'anel-habilidade':strip(128,4),'marcador-destino':strip(128,4),
  'heroi-voce':strip(128,1),'caido-resgate':strip([128,256],6),'sombra-contato':strip([128,64],1),
  'olhos-escuro':strip([64,32],4,P1),'veu-apagao':{priority:P1},
  'balao-fala':{priority:P0,kind:'nineslice',cell:[96,64]},'etiqueta-devendo':{priority:P0,kind:'nineslice',cell:[96,64]},
  ...Object.fromEntries(['moldura','preenchimento','moldura-elite','preenchimento-elite']
    .map(p=>[`barra-vida-${p}`,{priority:P0,kind:'nineslice',cell:[64,12]}])),
});
/** UI ids (icons.svg `i-*`, stickers.svg `a-*`, plus the minimap marks), each with the SVG symbols it replaces. */
const UI_ICONS=['config','girar','bussola','agulha','letra-n','aviao','fechar','pronto','relogio','voltar','cadeado','dado',
  'coracao','som','mudo','vibrar','sem-vibrar','boia','sem-linha','pipoca','saiu','robo','coroa','base','chefe','onda','bau',
  'coco','pedra','muralha','corneta','fita','chinelo','dedao','gota','sacola','suor','balao','risada','chamar'];
const UI_STICKERS=['chinelo','boleto','cafe','guarda-chuva','pombo','audio','chinelo-evo','boleto-evo','cafe-evo','cafe-forte',
  'marmita','tenis','megafone','bone','ima','oculos','cartao','coxinha','misterio','banana','ambulancia','mochila','rodo',
  'antena','ima-ferradura','camera','coxinhas','bau-aberto','galo','borboleta','halter','foto'];
const UI_MARKS=['voce','aliado','caido','spawn','coco','pedra','barricada'];
const UI_EMOTES=new Set(['risada','boia','chamar','suor']);
/** The cast with a HUD icon `ui/inimigo-<id>` (D-033 plus the elenco P1; client src/client/render/keys.ts ENEMY_KINDS). */
export const UI_ENEMIES=Object.freeze(['bebado','anao-molotov','pombos','tio-pave','agiota','chefe','coach','motoboy','influencer']);
const UI=(()=>{
  const out={},add=(id,symbol,priority=P0)=>{
    const e=out[id]??={priority,meta:{replaces:[]}};
    if(symbol)e.meta.replaces.push(symbol);
    if(UI_EMOTES.has(id))e.meta.emote=true;
  };
  for(const id of UI_ICONS)add(id,`i-${id}`);
  for(const id of UI_STICKERS)add(id,`a-${id}`);
  for(const id of UI_MARKS)add(`marca-${id}`);
  for(const id of ['balanca','podio-2','podio-3','trave'])add(id,`a-${id}`,P1);
  // Critter HUD icons (the "what got you" line: revive banner and result), `inimigo-<inimigos id>`; P1 because the
  // inventory has no row for them yet (absent: the game shows the enemy sprite, src/client/art/hud-art.ts).
  for(const id of UI_ENEMIES){add(`inimigo-${id}`,undefined,P1);out[`inimigo-${id}`].meta.enemy=id;}
  out['app-icon']={priority:P1,meta:{replaces:[]}};
  return out;
})();

// ---------------------------------------------------------------- face avatars (board design/PACOTE-ROSTOS.md, §4b)
/**
 * The 35 playable classes, in src/rules/classes.ts order (a test keeps both lists equal; the importer runs in plain
 * node and cannot import the TS catalog). Face file: `rostos/<classe>-<expressão>.png`, 256×256, transparent.
 */
export const FACE_CLASSES=Object.freeze(['cidadao-comum','mendigo','viciado-em-bet','clt-cansado','motogirl','pedreiro',
  'vizinha-fofoqueira','tio-do-churrasco','maromba','feirante','tecnico-ti','streamer','coach','faxineira','concurseira',
  'vendedor-praia','roqueira','pagodeiro','caca-promocao','gambiarreiro','universitario','passageira','porteiro',
  'goleira','sensei','merendeira','rei-pastel','astrologa','rei-arraia','mae-pet','aposentado','salva-vidas',
  'conspiracionista','gamer-mobile','rainha-bateria']);
/** Expressions, in brief order: `normal` is P0 (default face), the other four P1. */
export const FACE_EXPRESSIONS=Object.freeze(['normal','ferido','caido','rindo','bravo']);
/** Canvas side and the diameter of the central circle the game crops to (nothing drawn outside it). */
export const FACE_SIZE=256,FACE_CIRCLE=240;
const ROSTOS=Object.freeze(Object.fromEntries(FACE_CLASSES.flatMap(c=>FACE_EXPRESSIONS.map(e=>
  [`${c}-${e}`,{priority:e==='normal'?P0:P1,meta:{face:c,expression:e}}]))));
/**
 * Why a `rostos/` id is not a face, as a pt-BR sentence (the importer prefixes the file name), or undefined when it is
 * `<classe>-<expressão>` of FACE_CLASSES × FACE_EXPRESSIONS.
 */
export function faceIdProblem(id){
  if(Object.hasOwn(ROSTOS,id))return undefined;
  const expression=FACE_EXPRESSIONS.find(e=>id.endsWith(`-${e}`));
  if(!expression){
    const last=id.includes('-')?id.slice(id.lastIndexOf('-')+1):id;
    return `expressão "${last}" desconhecida. O nome precisa terminar com uma das expressões ${FACE_EXPRESSIONS.join(', ')} (ex.: rostos/mendigo-rindo.png).`;
  }
  const face=id.slice(0,-expression.length-1);
  return `classe "${face}" desconhecida. Use o id de uma das ${FACE_CLASSES.length} classes antes da expressão (ex.: rostos/cidadao-comum-${expression}.png); a lista está em design/PACOTE-ROSTOS.md.`;
}

/**
 * D-037 rim of the style-A enemies, baked by convert.mjs into every base animation sheet (never the elite layer): an
 * outer ring of `color` at `alpha`, `width` px wide around the drawn alpha (alpha dilated with an anti-aliased edge,
 * drawn UNDER the sprite), per cell, clipped to the cell (the PADDING margin leaves room for it).
 */
export const RIM=Object.freeze({color:'#2A2018',alpha:.85,width:1.5});

/**
 * Rest animations of every enemy (D-051 nests; board design/proximos/11-O-QUE-FALTAVA.md §3): one row facing S, in the
 * enemy's own cell, `<anim>.png` + an optional `<anim>.meta.json`. Optional: absent ones are not even a note. No foot
 * rule (sitting, curled up, jumping awake). The elite layer may cover them too.
 */
export const REST_ANIMS=Object.freeze({sleep:6,wake:4});
/**
 * Round variants of the elite layer (11-O-QUE-FALTAVA §7): `elite/<id>-<variant>-<anim>.png`, the same grid as the base
 * animation, stored under the manifest key `elite/<variant>/<anim>`.
 */
export const ELITE_VARIANTS=Object.freeze({'tio-pave':Object.freeze(['picole']),pombos:Object.freeze(['gorro'])});
const enemy=(cell,anims,priority=P0)=>({cell,anims,priority});
/** The 9 enemies briefed first (D-033 + elenco P1), declared by hand. */
const LEGACY_ENEMIES=Object.freeze({
  bebado:enemy(128,{idle:6,walk:8,attack:6,hit:3,death:10}),
  'anao-molotov':enemy(112,{idle:6,walk:8,throw:8,hit:3,death:10}),
  pombos:enemy(96,{fly:6,poop:6,hit:2,death:6}),
  'tio-pave':enemy(160,{idle:6,walk:8,joke:8,shove:7,hit:3,death:10}),
  agiota:enemy(128,{idle:6,walk:8,throw:6,hit:3,death:8}),
  chefe:enemy(384,{idle:6,walk:8,slam:10,charge:8,summon:10,hit:3,'phase2-idle':6,death:16}),
  coach:enemy(128,{idle:6,walk:8,lecture:10,hit:3,death:8},P1),
  motoboy:enemy(160,{idle:4,aim:6,charge:6,crash:10},P1),
  influencer:enemy(160,{idle:6,walk:8,pose:8,hit:3,death:10},P1),
});
/**
 * The 164 enemies of the packs 04–07 (board design/proximos), from enemies-table.mjs (GENERATED by gen-enemies.mjs,
 * never typed by hand): each id gets its role's animations (03 §5) and its table row's cell and priority.
 */
export const PACK_ENEMIES=Object.freeze(Object.fromEntries(Object.entries(ENEMY_TABLE).map(([id,e])=>
  [id,{...enemy(e.cell,{...ENEMY_ROLES[e.role].anims},e.priority),role:e.role}])));
export {ENEMY_ROLES,ENEMY_TABLE};

/**
 * Towers (board design/proximos/08-TORRES.md), folder `torres/<id>/`, kind 'tower':
 *  - `base.png` + `base.json` {"kind":"views","cell":[W,H],"views":4,"rows":[…],"anchor":[0.5,Y],"meta":{"footprint":[a,b],"mount":[x,y]}}:
 *    4 views (VIEW_NAMES) × the rows TOWER_ROWS (a wall: TOWER_WALL_ROWS, and no weapon);
 *  - weapon + crew `idle.png` (TOWER_IDLE_FRAMES frames), `fire.png`, `reload.png` (any frame count): 8 rows
 *    (DIRECTIONS) of `meta.json` {"cell":[W,H],"anchor":[0.5,0.88],"fps":{…}} cells. Absent animations are notes.
 * Like the enemies, each animation may come as one PNG per direction `<anim>-<DIR>.png` (assembled by the importer).
 */
export const TOWER_ROWS=Object.freeze(['obra-1','obra-2','obra-3','pronta','danificada','ruina']);
export const TOWER_WALL_ROWS=Object.freeze(['pronta','danificada','ruina']);
export const TOWER_ANIMS=Object.freeze(['idle','fire','reload']);
export const TOWER_IDLE_FRAMES=4;
/**
 * Accepted formats per group; `kind` is the default when the piece has no sidecar saying otherwise. `character`: the
 * messages talk about feet and the figure ("boneco"); other groups talk about the drawing and its base.
 */
export const GROUPS=Object.freeze({
  inimigos:{
    title:'1. Inimigos',input:'inimigos',output:'public/art/enemies',kind:'animations',kinds:['animations'],anchor:ANCHOR,character:true,
    // D-037: style-A enemies get a dark outer rim baked at import (not on the elite layer). See RIM.
    rim:RIM,
    // The 9 first enemies stay exactly as declared; the pack enemies follow (generated table).
    pieces:{...LEGACY_ENEMIES,...PACK_ENEMIES},
  },
  personagens:{
    title:'2. Personagens (8 direções)',input:'personagens',output:'public/art/sprites',kind:'dir8',kinds:['dir8'],cell:192,footY:168,character:true,
    // Every class with an approved sheet in public/art/sprites/<id>.webp (its foot column comes from there).
    pieces:'classes',priorities:{_silhueta:P2},
  },
  chao:{
    title:'3. Chão e terreno',input:'cenario/chao',output:'public/art/ground',kind:'seamless',kinds:['seamless','frames'],size:512,
    // Subfolder per map (`cidade-nevada/`, `infinito/`…); `<material>-1..3.png`; `trans-<a>-<b>.png` are masks;
    // the sea-foam edge is 'frames' (1 view, 8 frames) through its sidecar {"kind":"frames","cell":[w,h]}.
    pieces:'any',nested:true,expected:CHAO,
  },
  predios:{
    title:'4. Construções',input:'cenario/predios',output:'public/art/city/buildings',kind:'views',kinds:['views'],views:4,
    // Anchor at the front-bottom corner of the footprint, given by each sidecar (with the cell).
    pieces:'any',expected:PREDIOS,
  },
  base:{
    title:'5. Base Stonewards',input:'cenario/base',output:'public/art/city/base',kind:'views',kinds:['views','frames'],views:4,pieces:'any',expected:BASE,
  },
  props:{
    title:'6. Props e decoração',input:'cenario/props',output:'public/art/city/props',kind:'views',kinds:['views','nineslice'],views:4,pieces:'any',expected:PROPS,
  },
  itens:{
    title:'7. Itens, recursos e projéteis',input:'itens',output:'public/art/items',kind:'frames',kinds:['frames'],pieces:'any',expected:ITENS,
  },
  projeteis:{
    title:'7. Projéteis',input:'projeteis',output:'public/art/projectiles',kind:'frames',kinds:['frames'],pieces:'any',expected:PROJETEIS,
  },
  efeitos:{
    title:'8. Efeitos e telegraphs',input:'efeitos',output:'public/art/fx',kind:'frames',kinds:['frames','seamless','nineslice'],pieces:'any',expected:EFEITOS,
    // Telegraph textures via sidecar: fill {"kind":"seamless","cell":[128,128],"transparent":true};
    // dashed border {"kind":"seamless","cell":[128,16],"wrap":"x","transparent":true}.
    // `fullBleed`: screen-wide overlays drawn up to the cell border on purpose (the blackout veil is a vignette whose
    // dark rim IS the edge): no PADDING rule for them.
    fullBleed:{'veu-apagao':true},
  },
  ui:{
    title:'9. Interface, ícones e adesivos',input:'ui',output:'public/art/ui',kind:'icon',kinds:['icon'],size:128,
    // `app-icon.png` is 512×512 and full-bleed opaque (its sidecar or these overrides).
    sizes:{'app-icon':512},opaque:{'app-icon':true},pieces:'any',expected:UI,
  },
  rostos:{
    title:'10. Rostos (avatares)',input:'rostos',output:'public/art/rostos',kind:'icon',kinds:['icon'],size:FACE_SIZE,
    // Face avatars `<classe>-<expressão>.png` (PACOTE-ROSTOS.md): 256 square, transparent, nothing drawn outside the
    // central circle of diameter `circle`; only the FACE_CLASSES × FACE_EXPRESSIONS ids (`checkId` refuses the rest).
    circle:FACE_CIRCLE,pieces:'any',expected:ROSTOS,checkId:faceIdProblem,
  },
  torres:{
    title:'11. Torres (defesas)',input:'torres',output:'public/art/towers',kind:'tower',kinds:['tower'],views:4,
    // One folder per tower (08-TORRES.md): base (4 views × construction/damage rows) + weapon (8 directions). Any id.
    pieces:'any',
  },
});

/** Priority of a piece: its `expected` entry, the enemy table, the group's `priorities` map; otherwise P0. */
export function priorityOf(spec,id){
  return spec.expected?.[id]?.priority??(spec.pieces&&typeof spec.pieces==='object'?spec.pieces[id]?.priority:undefined)
    ??spec.priorities?.[id]??'P0';
}
/** Index of every group manifest, read by the client (src/client/art/manifest.ts): `public/art/manifest.json`. */
export const INDEX_FILE='public/art/manifest.json';

/**
 * Result of one piece. `problems` are pt-BR sentences the user can act on, each naming the file and, when it applies,
 * the direction/view/row/column. `notes` are pt-BR informational sentences that do not block (missing optional parts,
 * assumed cell size, paginated sheet). `status`: 'aprovado' (written), 'reprovado' (nothing written for it), 'pendente' (a
 * P0 piece absent), 'opcional' (a P1/P2 piece absent: not pending), 'extra' (an enemy folder whose id is not in the
 * table: nothing written). `priority`: 'P0' | 'P1' | 'P2' (priorityOf).
 * `files`: the input files (relative to the delivery root); `outputs`: what was (or, validating only, would be) written.
 * @typedef {{group:string,id:string,status:'aprovado'|'reprovado'|'pendente'|'opcional'|'extra',priority?:string,problems:string[],notes:string[],
 *   files:string[],outputs:string[],source?:string,thumb?:string}} PieceResult
 * Manifest written per group at `<output>/manifest.json`, merged with the previous one file by file (pieces and
 * sheets not delivered keep their entry): {version:2,group,pieces:{[id]:{kind,files:{[name]:{file? (single page),
 * cell:[w,h],frames?,views?,rows?,directions?,anchor?,fps?,slice?,mask?,wrap?,transparent?,
 * rim?, pages:[{file,columns,rows,firstFrame,frameCount,sha256}],sha256}},sha256,meta?,rim?}}}. A sheet over MAX_TEXTURE
 * px is split into pages `<name>-p1.webp`, `<name>-p2.webp`… with its frames in reading order.
 * `rim` (piece and each rimmed file): RIM, when the converter baked the D-037 rim (enemies; never `elite/*` files).
 * `meta` (piece): render metadata from the `expected` table merged with the sidecar's `meta` (sidecar wins per key):
 *  - chao: `ground` (renderer ground kind: GROUND_KINDS, 'foam'…); masks `{mask:true, between:[a,b]}` (ground kinds,
 *    black = a, white = b).
 *  - predios: `footprint:[a,b]` (cells), `ruin:true` (ruined), `framesPerView` (1). Cell and anchor (front-bottom
 *    corner of the footprint) are in the file entry, from the sidecar.
 *  - base: `states` (state names, in row order) and, for animated states, `stateFrames:{[state]:n}` (rows
 *    `<state>-1..n`); `footprint` when the inventory gives it.
 *  - props: `prop` (prop kind: the id without its variation number, e.g. 'carro-velho').
 *  - ui: `replaces` (the icons.svg `i-*` / stickers.svg `a-*` symbols this file replaces), `emote:true` for emotes,
 *    `enemy` (inimigos id) for the critter HUD icons `inimigo-<id>`.
 *  - torres: `footprint:[a,b]` and `mount:[x,y]` (base.json meta; a wall has no mount). Files: `base` (views × rows)
 *    and the weapon's `idle`/`fire`/`reload` (8 directions).
 *  - rostos: `face` (class id) and `expression` (FACE_EXPRESSIONS); the client reads them via src/client/art/faces.ts.
 * Index (INDEX_FILE), rewritten after every run that wrote a group manifest: {version:2, groups:{[group]:{output,
 * pieces}}}, each group's `pieces` exactly as in its manifest.
 */
export const MANIFEST_VERSION=2;
