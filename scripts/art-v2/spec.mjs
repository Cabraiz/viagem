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
  seamless:'textura contínua',nineslice:'moldura em 9 partes',icon:'ícone',
});

const enemy=(cell,anims)=>({cell,anims});
/**
 * Accepted formats per group; `kind` is the default when the piece has no sidecar saying otherwise. `character`: the
 * messages talk about feet and the figure ("boneco"); other groups talk about the drawing and its base.
 */
export const GROUPS=Object.freeze({
  inimigos:{
    title:'1. Inimigos',input:'inimigos',output:'public/art/enemies',kind:'animations',kinds:['animations'],anchor:ANCHOR,character:true,
    pieces:{
      bebado:enemy(128,{idle:6,walk:8,attack:6,hit:3,death:10}),
      'anao-molotov':enemy(112,{idle:6,walk:8,throw:8,hit:3,death:10}),
      pombos:enemy(96,{fly:6,poop:6,hit:2,death:6}),
      'tio-pave':enemy(160,{idle:6,walk:8,joke:8,shove:7,hit:3,death:10}),
      agiota:enemy(128,{idle:6,walk:8,throw:6,hit:3,death:8}),
      chefe:enemy(384,{idle:6,walk:8,slam:10,charge:8,summon:10,hit:3,'phase2-idle':6,death:16}),
      coach:enemy(128,{idle:6,walk:8,lecture:10,hit:3,death:8}),
      motoboy:enemy(160,{idle:4,aim:6,charge:6,crash:10}),
      influencer:enemy(160,{idle:6,walk:8,pose:8,hit:3,death:10}),
    },
  },
  personagens:{
    title:'2. Personagens (8 direções)',input:'personagens',output:'public/art/sprites',kind:'dir8',kinds:['dir8'],cell:192,footY:168,character:true,
    // Every class with an approved sheet in public/art/sprites/<id>.webp (its foot column comes from there).
    pieces:'classes',
  },
  chao:{
    title:'3. Chão e terreno',input:'cenario/chao',output:'public/art/ground',kind:'seamless',kinds:['seamless','frames'],size:512,
    // Subfolder per map (`cidade-nevada/`, `infinito/`…); `<material>-1..3.png`; `trans-<a>-<b>.png` are masks;
    // the sea-foam edge is 'frames' (1 view, 8 frames) through its sidecar {"kind":"frames","cell":[w,h]}.
    pieces:'any',nested:true,
  },
  predios:{
    title:'4. Construções',input:'cenario/predios',output:'public/art/city/buildings',kind:'views',kinds:['views'],views:4,
    // Anchor at the base corner, given by each sidecar.
    pieces:'any',
  },
  base:{
    title:'5. Base Stonewards',input:'cenario/base',output:'public/art/city/base',kind:'views',kinds:['views','frames'],views:4,pieces:'any',
  },
  props:{
    title:'6. Props e decoração',input:'cenario/props',output:'public/art/city/props',kind:'views',kinds:['views','nineslice'],views:4,pieces:'any',
  },
  itens:{
    title:'7. Itens, recursos e projéteis',input:'itens',output:'public/art/items',kind:'frames',kinds:['frames'],pieces:'any',
  },
  projeteis:{
    title:'7. Projéteis',input:'projeteis',output:'public/art/projectiles',kind:'frames',kinds:['frames'],pieces:'any',
  },
  efeitos:{
    title:'8. Efeitos e telegraphs',input:'efeitos',output:'public/art/fx',kind:'frames',kinds:['frames','seamless','nineslice'],pieces:'any',
    // Telegraph textures via sidecar: fill {"kind":"seamless","cell":[128,128],"transparent":true};
    // dashed border {"kind":"seamless","cell":[128,16],"wrap":"x","transparent":true}.
  },
  ui:{
    title:'9. Interface, ícones e adesivos',input:'ui',output:'public/art/ui',kind:'icon',kinds:['icon'],size:128,
    // `app-icon.png` is 512×512 and full-bleed opaque (its sidecar or these overrides).
    sizes:{'app-icon':512},opaque:{'app-icon':true},pieces:'any',
  },
});

/**
 * Result of one piece. `problems` are pt-BR sentences the user can act on, each naming the file and, when it applies,
 * the direction/view/row/column. `notes` are pt-BR informational sentences that do not block (missing optional parts,
 * assumed cell size, paginated sheet). `status`: 'aprovado' (written), 'reprovado' (nothing written for it), 'pendente' (absent).
 * `files`: the input files (relative to the delivery root); `outputs`: what was (or, validating only, would be) written.
 * @typedef {{group:string,id:string,status:'aprovado'|'reprovado'|'pendente',problems:string[],notes:string[],
 *   files:string[],outputs:string[],source?:string,thumb?:string}} PieceResult
 * Manifest written per group at `<output>/manifest.json`, merged with the previous one file by file (pieces and
 * sheets not delivered keep their entry): {version:2,group,pieces:{[id]:{kind,files:{[name]:{file? (single page),
 * cell:[w,h],frames?,views?,rows?,directions?,anchor?,fps?,slice?,mask?,wrap?,transparent?,
 * pages:[{file,columns,rows,firstFrame,frameCount,sha256}],sha256}},sha256}}}. A sheet over MAX_TEXTURE px is split
 * into pages `<name>-p1.webp`, `<name>-p2.webp`… with its frames in reading order.
 */
export const MANIFEST_VERSION=2;
